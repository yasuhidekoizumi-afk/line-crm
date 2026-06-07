// ────────────────────────────────────────────────────────────────────
// バグA 補填の「判定ロジック」だけを切り出した純粋モジュール（依存なし）。
// 副作用・外部依存が無いので、デプロイ不要でユニットテストできる。
// ────────────────────────────────────────────────────────────────────

/** Shopify 注文の判定に必要な最小情報 */
export interface BackfillOrder {
  id: string;             // Shopify order.id（数値文字列）
  scid: string;           // Shopify customer.id
  amount: number;         // total_price（円・税込）
  currency?: string | null;
  financialStatus?: string | null;
  cancelledAt?: string | null;
  processedAt?: string | null;
}

export type BackfillSkipReason =
  | 'ok'
  | 'no_customer'
  | 'duplicate'
  | 'cancelled'
  | 'refunded'
  | 'non_jpy'
  | 'zero_amount'
  | 'already_awarded'
  | 'not_member';

/**
 * 1注文を「付与漏れ補填の対象」とすべきか判定する純粋関数。
 *  - すでに award 済み / 会員でない / キャンセル・返金 / 円以外 / 0円 / 重複 は対象外。
 *  - 弾く理由も返すので集計・デバッグに使える。
 */
export function classifyBackfillOrder(
  o: BackfillOrder,
  isAwarded: (orderId: string) => boolean,
  isMember: (scid: string) => boolean,
  seen: Set<string>,
): { ok: boolean; reason: BackfillSkipReason } {
  if (!o.id || !o.scid) return { ok: false, reason: 'no_customer' };
  if (seen.has(o.id)) return { ok: false, reason: 'duplicate' };
  if (o.cancelledAt) return { ok: false, reason: 'cancelled' };
  if (o.financialStatus === 'refunded' || o.financialStatus === 'voided') return { ok: false, reason: 'refunded' };
  if (o.currency && o.currency !== 'JPY') return { ok: false, reason: 'non_jpy' };
  if (!(o.amount > 0)) return { ok: false, reason: 'zero_amount' };
  if (isAwarded(o.id)) return { ok: false, reason: 'already_awarded' };
  if (!isMember(o.scid)) return { ok: false, reason: 'not_member' };
  return { ok: true, reason: 'ok' };
}
