import { getShopifyAdminToken } from '../utils/shopify-token.js';
import type { RefundCodeEnv } from './loyalty-code-refund.js';

// ────────────────────────────────────────────────────────────────────
// バグB「未使用ポイント割引コードの返金」— 実態把握用の【読み取り専用】試算
//
// 目的:
//   返金候補(未解決の redeem)のうち、Shopify 上で「本当に1度も使われていない／
//   既に存在しない」コードが何件・何ポイントあるかを、DBにもShopifyにも一切
//   書き込まずに数える。小泉さんへの正確な報告と、実行前の規模確定に使う。
//
// 照合方式(効率と確実性):
//   1コードずつ REST で照会するとCloudflareのサブリクエスト上限にすぐ達するため、
//   Shopify GraphQL の codeDiscountNodeByCode を「エイリアスで一括(既定50件/回)」呼び、
//   数リクエストで全候補の使用回数(asyncUsageCount)をまとめて取得する。
//     - codeDiscount が null     : コードが存在しない（=使えない）→ 返金対象
//     - asyncUsageCount > 0       : 使用済み（正常利用）→ 返金しない
//     - asyncUsageCount === 0     : 未使用で存在 → 返金対象
//   コード単位で一意化して数える（実際の返金もコード単位で1回のため）。
// ────────────────────────────────────────────────────────────────────

export interface PreviewRefundResult {
  candidates: number;       // 候補 redeem 行数（猶予超過・未解決・会員）
  uniqueCodes: number;      // 一意なコード数（実際の照合対象）
  held: number;             // ①保持中: コードが存在・未使用（=マイページに「保留中」表示）→ 残す(救済しない)
  heldPoints: number;
  used: number;             // ②使用済み: コードが存在・使用回数≧1（=買い物で消費）→ 絶対に救済しない
  gone: number;             // ③消失: Shopify上にコードが無い（=取り戻せない）→ 救済候補(実返金前に注文照合)
  gonePoints: number;
  skippedNoAmount: number;  // コード/金額が読めず対象外
  errors: number;           // 照会できなかったコード数（次回再試行可）
  errorSamples: string[];   // エラー実文言（先頭5件）
  graceDays: number;
}

const GQL_BATCH = 50; // 1 GraphQL リクエストでまとめて照会するコード数

/** GraphQL エイリアスで複数コードの使用状況をまとめて取得（read-only） */
async function fetchUsageMap(
  shopDomain: string,
  adminToken: string,
  codes: string[],
  onError: (msg: string) => void,
): Promise<Map<string, { exists: boolean; usageCount: number }>> {
  const map = new Map<string, { exists: boolean; usageCount: number }>();
  for (let i = 0; i < codes.length; i += GQL_BATCH) {
    const batch = codes.slice(i, i + GQL_BATCH);
    const aliases = batch
      .map(
        (code, j) =>
          `c${j}: codeDiscountNodeByCode(code: ${JSON.stringify(code)}) { codeDiscount { __typename ... on DiscountCodeBasic { asyncUsageCount } } }`,
      )
      .join('\n');
    const query = `query {\n${aliases}\n}`;
    try {
      const res = await fetch(`https://${shopDomain}/admin/api/2024-10/graphql.json`, {
        method: 'POST',
        headers: { 'X-Shopify-Access-Token': adminToken, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
      });
      if (!res.ok) {
        onError(`graphql ${res.status} (batch ${i}-${i + batch.length})`);
        continue; // このバッチのコードは map 未登録 → 呼び出し側で errors 扱い
      }
      const json = (await res.json()) as {
        data?: Record<string, { codeDiscount?: { asyncUsageCount?: number } | null } | null>;
        errors?: unknown;
      };
      if (json.errors) {
        onError(`graphql errors: ${JSON.stringify(json.errors).slice(0, 200)}`);
        continue;
      }
      batch.forEach((code, j) => {
        const node = json.data?.[`c${j}`];
        const cd = node?.codeDiscount;
        if (!cd) map.set(code, { exists: false, usageCount: 0 });
        else map.set(code, { exists: true, usageCount: cd.asyncUsageCount ?? 0 });
      });
    } catch (e) {
      onError(`batch ${i}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return map;
}

export async function previewUnusedCodeRefunds(
  env: RefundCodeEnv,
  opts: { limit?: number; graceDays?: number } = {},
): Promise<PreviewRefundResult> {
  const maxCandidates = Math.min(Math.max(opts.limit ?? 1000, 1), 5000);
  const graceDays = opts.graceDays ?? 14;
  const cutoffIso = new Date(Date.now() - graceDays * 24 * 60 * 60 * 1000).toISOString();

  const result: PreviewRefundResult = {
    candidates: 0, uniqueCodes: 0, held: 0, heldPoints: 0, used: 0, gone: 0, gonePoints: 0,
    skippedNoAmount: 0, errors: 0, errorSamples: [], graceDays,
  };

  const shopDomain = env.SHOPIFY_SHOP_DOMAIN;
  const adminToken = await getShopifyAdminToken(env);
  if (!shopDomain || !adminToken) throw new Error('Shopify credentials not configured');

  // 返金候補: 未解決(取り消し/利用済みでない)・猶予期間超過・会員、の redeem を古い順。
  const rows = await env.DB
    .prepare(
      `SELECT lt.reason AS reason
       FROM loyalty_transactions lt
       JOIN loyalty_points lp ON lp.friend_id = lt.friend_id
       WHERE lt.type = 'redeem'
         AND lt.reason NOT LIKE '[取り消し済み]%'
         AND lt.reason NOT LIKE '[利用済み]%'
         AND lt.created_at < ?
         AND lp.shopify_customer_id IS NOT NULL
       ORDER BY lt.created_at ASC
       LIMIT ?`,
    )
    .bind(cutoffIso, maxCandidates)
    .all<{ reason: string }>();

  // コード単位で一意化（返金はコード単位で1回のため）。金額は最初の出現を採用。
  const codeToPts = new Map<string, number>();
  for (const row of rows.results ?? []) {
    result.candidates++;
    const code = row.reason?.match(/コード: ([A-Z0-9-]+)/)?.[1];
    const pts = parseInt(row.reason?.match(/¥(\d+)割引/)?.[1] ?? '0', 10);
    if (!code || !Number.isFinite(pts) || pts <= 0) {
      result.skippedNoAmount++;
      continue;
    }
    if (!codeToPts.has(code)) codeToPts.set(code, pts);
  }

  const codes = [...codeToPts.keys()];
  result.uniqueCodes = codes.length;

  const usageMap = await fetchUsageMap(shopDomain, adminToken, codes, (msg) => {
    // エラー件数はコード単位で下のループで加算する。ここでは文言サンプルのみ保持。
    if (result.errorSamples.length < 5) result.errorSamples.push(msg);
  });

  for (const code of codes) {
    const u = usageMap.get(code);
    const pts = codeToPts.get(code) ?? 0;
    if (!u) {
      // 照会できなかった（バッチ失敗等）→ 安全側でどこにも数えない（救済対象に含めない）
      result.errors++;
      continue;
    }
    if (u.exists && u.usageCount > 0) {
      // ②使用済み（買い物で消費）→ 絶対に救済しない
      result.used++;
      continue;
    }
    if (u.exists) {
      // ①保持中（存在・未使用）→ 残す（マイページの「保留中」表示で本人に委ねる）
      result.held++;
      result.heldPoints += pts;
      continue;
    }
    // ③消失（Shopify上にコードが無い）→ 取り戻せない救済候補。
    //   ※実際の返金前に「その人がそのコードで注文したか」を注文履歴で照合し、
    //     “使った後に消えた”を排除してから救済する（別ステップ）。
    result.gone++;
    result.gonePoints += pts;
  }

  return result;
}
