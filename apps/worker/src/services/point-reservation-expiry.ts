/**
 * ポイント利用予約（loyalty_redemption_reservations）の自動失効。
 *
 * 背景（2026-10 実測）:
 *   予約は Shopify の割引コードを発行するだけでポイントは減らさず、
 *   「注文確定」か「顧客の取消」でしか解除されなかった。放置予約が 71件・21,600pt 分あり、
 *   該当顧客は「すでにポイント利用を選択しています」で永久にブロックされていた。
 *
 * 方針:
 *   - 予約から2時間で失効させる（購買セッションは通常2時間以内に収まる）。
 *   - 失効時は Shopify の割引コードも削除する。コードを残すと
 *     「ポイントだけ減らず割引だけ使える」穴になるため、削除に失敗したら予約を戻して再試行する。
 *   - Shopify 呼び出しは deleteCode として注入し、この関数はDB操作だけを持つ（テスト可能）。
 */

/** 予約の有効期限（分） */
export const RESERVATION_TTL_MINUTES = 120;

export interface ReservationRow {
  id: string;
  friend_id: string;
  shopify_customer_id: string;
  shopify_discount_code: string;
  points: number;
  discount_amount: number;
  status: string;
  created_at: string;
}

/**
 * D1Database とテスト用の偽DBの両方を受ける最小インターフェース。
 * 呼び出し側で run() / all() の戻り値を使うため、結果型は緩めにしている。
 */
export interface ReservationDb {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  prepare: (sql: string) => { bind: (...args: any[]) => any };
}

type DeleteCode = (code: string) => Promise<boolean>;

/** 予約1件を失効させる。コード削除に失敗したら元に戻して false を返す。 */
export async function expireReservationRow(
  db: ReservationDb,
  deleteCode: DeleteCode,
  reservation: ReservationRow,
): Promise<boolean> {
  const nowIso = new Date().toISOString();
  const claimed = await db
    .prepare(
      `UPDATE loyalty_redemption_reservations SET status = 'cancelled', updated_at = ?
       WHERE id = ? AND status IN ('active', 'consuming')`,
    )
    .bind(nowIso, reservation.id)
    .run();
  if ((claimed?.meta?.changes ?? 0) !== 1) return false;

  const deleted = await deleteCode(reservation.shopify_discount_code);
  if (!deleted) {
    // コードを消せないまま予約だけ解除すると「割引だけ使える」穴ができるので戻して再試行する
    await db
      .prepare(
        `UPDATE loyalty_redemption_reservations SET status = 'active', updated_at = ?
         WHERE id = ? AND status = 'cancelled'`,
      )
      .bind(nowIso, reservation.id)
      .run();
    return false;
  }
  return true;
}

/** 期限切れの予約をまとめて失効させる（毎分のcronから呼ぶ）。 */
export async function expireStaleReservations(
  db: ReservationDb,
  deleteCode: DeleteCode,
  options: { limit?: number; ttlMinutes?: number } = {},
): Promise<{ expired: number; failed: number }> {
  const limit = Math.max(1, options.limit ?? 20);
  const ttlMinutes = Math.max(1, options.ttlMinutes ?? RESERVATION_TTL_MINUTES);
  const cutoff = new Date(Date.now() - ttlMinutes * 60_000).toISOString();

  const stale = await db
    .prepare(
      `SELECT id, friend_id, shopify_customer_id, shopify_discount_code, points, discount_amount, status, created_at
       FROM loyalty_redemption_reservations
       WHERE status = 'active' AND created_at < ?
       ORDER BY created_at ASC LIMIT ?`,
    )
    .bind(cutoff, limit)
    .all();

  let expired = 0;
  let failed = 0;
  for (const reservation of (stale?.results ?? []) as ReservationRow[]) {
    if (await expireReservationRow(db, deleteCode, reservation)) expired += 1;
    else failed += 1;
  }
  return { expired, failed };
}
