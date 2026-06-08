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
// 重要(取りこぼし対策):
//   既存の cancel-code 系は price_rules を 250 件だけ取得して title 検索するため、
//   割引が 250 件を超えると「見つからない=削除済み」と誤判定し、まだ使えるコードを
//   未使用とみなす危険がある。ここでは Shopify の discount code 直接ルックアップ
//   (`/discount_codes/lookup.json?code=`) を使い、件数に依存せず確実に判定する。
//     - 404                : コードが存在しない（=使えない）→ 返金対象
//     - 200 & usage_count>0 : 使用済み（正常利用）→ 返金しない
//     - 200 & usage_count=0 : 未使用で存在 → 返金対象
//
// ※ Shopify REST のレート制限(バースト40)があるため、limit は小さめ(既定20)にして
//   offset でページングし、複数回に分けて全件を見る想定。
// ────────────────────────────────────────────────────────────────────

export interface PreviewRefundResult {
  scanned: number;          // この回でチェックしたコード数
  refundable: number;       // 返金対象（未使用 or Shopify上に存在しない）
  refundablePoints: number; // 返金対象の合計ポイント
  used: number;             // 使用済み（返金しない）
  skippedNoAmount: number;  // コード/金額が読めず対象外
  errors: number;           // Shopify照会エラー等（次回再試行可）
  errorSamples: string[];   // エラー実文言（先頭5件）
  offset: number;
  limit: number;
  hasMore: boolean;         // まだ後続の候補が残っている（offset を進めて再実行）
}

/** Shopify 上のコードの状態を確実に判定する（読み取りのみ） */
async function lookupCodeUsage(
  shopDomain: string,
  adminToken: string,
  code: string,
): Promise<{ exists: boolean; usageCount: number }> {
  // discount code 直接ルックアップ。存在すれば 303→対象リソースへ追従し usage_count を得る。
  const res = await fetch(
    `https://${shopDomain}/admin/api/2024-10/discount_codes/lookup.json?code=${encodeURIComponent(code)}`,
    { headers: { 'X-Shopify-Access-Token': adminToken } },
  );
  if (res.status === 404) return { exists: false, usageCount: 0 };
  if (!res.ok) throw new Error(`lookup ${res.status}`);
  const data = (await res.json()) as { discount_code?: { usage_count?: number } };
  if (!data.discount_code) return { exists: false, usageCount: 0 };
  return { exists: true, usageCount: data.discount_code.usage_count ?? 0 };
}

export async function previewUnusedCodeRefunds(
  env: RefundCodeEnv,
  opts: { limit?: number; offset?: number; graceDays?: number } = {},
): Promise<PreviewRefundResult> {
  const limit = Math.min(Math.max(opts.limit ?? 20, 1), 50);
  const offset = Math.max(opts.offset ?? 0, 0);
  const graceDays = opts.graceDays ?? 14;
  const cutoffIso = new Date(Date.now() - graceDays * 24 * 60 * 60 * 1000).toISOString();

  const result: PreviewRefundResult = {
    scanned: 0, refundable: 0, refundablePoints: 0, used: 0,
    skippedNoAmount: 0, errors: 0, errorSamples: [], offset, limit, hasMore: false,
  };

  const shopDomain = env.SHOPIFY_SHOP_DOMAIN;
  const adminToken = await getShopifyAdminToken(env);
  if (!shopDomain || !adminToken) throw new Error('Shopify credentials not configured');

  // 返金候補: 未解決(取り消し/利用済みでない)・猶予期間超過・会員、の redeem を古い順。
  // hasMore 判定のため limit+1 件取得。
  const rows = await env.DB
    .prepare(
      `SELECT lt.reason AS reason, lp.shopify_customer_id AS scid
       FROM loyalty_transactions lt
       JOIN loyalty_points lp ON lp.friend_id = lt.friend_id
       WHERE lt.type = 'redeem'
         AND lt.reason NOT LIKE '[取り消し済み]%'
         AND lt.reason NOT LIKE '[利用済み]%'
         AND lt.created_at < ?
         AND lp.shopify_customer_id IS NOT NULL
       ORDER BY lt.created_at ASC
       LIMIT ? OFFSET ?`,
    )
    .bind(cutoffIso, limit + 1, offset)
    .all<{ reason: string; scid: string }>();

  const list = rows.results ?? [];
  result.hasMore = list.length > limit;
  const batch = list.slice(0, limit);

  for (const row of batch) {
    result.scanned++;
    const codeMatch = row.reason?.match(/コード: ([A-Z0-9-]+)/);
    const amountMatch = row.reason?.match(/¥(\d+)割引/);
    const code = codeMatch?.[1];
    const pts = amountMatch ? parseInt(amountMatch[1], 10) : 0;
    if (!code || pts <= 0) {
      result.skippedNoAmount++;
      continue;
    }
    try {
      const { exists, usageCount } = await lookupCodeUsage(shopDomain, adminToken, code);
      if (exists && usageCount > 0) {
        result.used++;
        continue;
      }
      // 未使用 or Shopify上に存在しない → 返金対象
      result.refundable++;
      result.refundablePoints += pts;
    } catch (e) {
      result.errors++;
      if (result.errorSamples.length < 5) {
        result.errorSamples.push(`code=${code}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  return result;
}
