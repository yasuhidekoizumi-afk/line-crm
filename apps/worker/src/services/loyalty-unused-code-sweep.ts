import { getLoyaltySetting } from '@line-crm/db';
import { refundUnusedPointCode, type RefundCodeEnv } from './loyalty-code-refund.js';

// ────────────────────────────────────────────────────────────────────
// B2: 未使用ポイント割引コードの定期自動返還（cron）
//
// 背景:
//   ポイント利用(redeem)は「コード発行時に即減算」する設計のため、
//   コードを使わず放置されるとポイントが宙に浮く（消えたまま）。
//   B1(注文時の自動返還)は webhook 経由でしか発火しないため、
//   購入が無いまま放置された分はこの cron が拾って返す。
//
// 安全装置:
//   1. ON/OFF フラグ: loyalty_settings.unused_code_auto_refund_enabled === '1' の
//      ときだけ動作（デフォルト= 未設定 = OFF）。過去分の一斉返還が暴発しない。
//   2. 猶予期間: 発行から GRACE_DAYS 日たった未使用コードのみ対象（直近の利用予定を尊重）。
//   3. 1回の上限: LIMIT 件まで（段階的・観測可能に処理。日次cronなので数日かけて消化）。
//   4. 使用済みは [利用済み] を付けて次回以降スキャンしない（無駄な再チェック防止）。
//   返金本体は cancel-code と同じ refundUnusedPointCode を再利用（食い違い防止）。
// ────────────────────────────────────────────────────────────────────

const DEFAULT_GRACE_DAYS = 14; // 発行から何日たった未使用を対象にするか
const DEFAULT_LIMIT = 50;      // 1回の実行で処理する最大件数

export interface SweepResult {
  enabled: boolean;
  scanned: number;
  refunded: number;
  refundedPoints: number;
  usedSkipped: number;
  errors: number;
}

export async function sweepUnusedPointCodes(
  env: RefundCodeEnv,
  opts: { graceDays?: number; limit?: number } = {},
): Promise<SweepResult> {
  const result: SweepResult = {
    enabled: false, scanned: 0, refunded: 0, refundedPoints: 0, usedSkipped: 0, errors: 0,
  };

  // 安全装置①: 設定が '1' のときだけ動く（デフォルト OFF）
  const enabled = await getLoyaltySetting(env.DB, 'unused_code_auto_refund_enabled').catch(() => null);
  if (enabled !== '1') return result;
  result.enabled = true;

  const graceDays = opts.graceDays ?? DEFAULT_GRACE_DAYS;
  const limit = opts.limit ?? DEFAULT_LIMIT;
  // 猶予期間のカットオフ。14日スパンなので時差9hの誤差は無視できる（おおよその閾値）。
  const cutoffIso = new Date(Date.now() - graceDays * 24 * 60 * 60 * 1000).toISOString();

  // 未解決(取り消し済み/利用済みでない)で、猶予期間を過ぎた redeem を古い順に取得
  const rows = await env.DB
    .prepare(
      `SELECT lt.id AS tx_id, lt.reason AS reason, lp.shopify_customer_id AS scid
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
    .bind(cutoffIso, limit)
    .all<{ tx_id: string; reason: string; scid: string }>();

  for (const row of rows.results ?? []) {
    result.scanned++;
    const codeMatch = row.reason?.match(/コード: ([A-Z0-9-]+)/);
    if (!codeMatch) continue;
    const code = codeMatch[1];

    try {
      const r = await refundUnusedPointCode(env, row.scid, code, 'cron');
      if (r.refunded) {
        // 返金成功。当該 redeem は refundUnusedPointCode 内で [取り消し済み] 済み。
        result.refunded++;
        result.refundedPoints += r.refundPoints ?? 0;
      } else if (r.reason === 'used') {
        // 使用済み（正常利用）。次回以降スキャンしないよう [利用済み] を付ける。
        result.usedSkipped++;
        await env.DB
          .prepare(
            `UPDATE loyalty_transactions SET reason = '[利用済み] ' || reason
             WHERE id = ? AND reason NOT LIKE '[利用済み]%' AND reason NOT LIKE '[取り消し済み]%'`,
          )
          .bind(row.tx_id)
          .run();
      }
      // それ以外(no_redeem / shopify_error 等)は印を付けず、次回再試行する。
    } catch (e) {
      result.errors++;
      console.error(`[unused-code-sweep] code=${code} 返還失敗:`, e);
    }
  }

  if (result.refunded > 0 || result.usedSkipped > 0) {
    console.log(
      `[unused-code-sweep] scanned=${result.scanned} refunded=${result.refunded}(+${result.refundedPoints}pt) used=${result.usedSkipped} errors=${result.errors}`,
    );
  }
  return result;
}
