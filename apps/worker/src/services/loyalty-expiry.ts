import {
  getExpiredUnprocessedAwards,
  getLoyaltyPoint,
  upsertLoyaltyPoint,
  addLoyaltyTransaction,
  determineRank,
} from '@line-crm/db';

/**
 * 期限切れポイントのバッチ処理
 * cron から呼ぶ。冪等設計（source_tx_id で二重処理防止）。
 */
export async function processLoyaltyExpirations(
  db: D1Database,
): Promise<{ processed: number }> {
  const expiredAwards = await getExpiredUnprocessedAwards(db);
  if (!expiredAwards.length) return { processed: 0 };

  let processed = 0;

  for (const award of expiredAwards) {
    try {
      const unspent = await calcUnspentFromAward(db, award.friend_id, award.award_id, award.points);

      if (unspent > 0) {
        const point = await getLoyaltyPoint(db, award.friend_id);
        const currentBalance = point?.balance ?? 0;
        const newBalance = Math.max(0, currentBalance - unspent);
        const newRank = determineRank(point?.total_spent ?? 0);

        await upsertLoyaltyPoint(db, award.friend_id, {
          balance: newBalance,
          totalSpent: point?.total_spent ?? 0,
          rank: newRank,
          shopifyCustomerId: point?.shopify_customer_id ?? undefined,
        });

        await addLoyaltyTransaction(db, {
          friendId: award.friend_id,
          type: 'expire',
          points: -unspent,
          balanceAfter: newBalance,
          reason: 'ポイント有効期限切れ',
          sourceTxId: award.award_id,
        });
      } else {
        // 全て消費済み — 処理済みとしてマークするだけ（0pt expire）
        const point = await getLoyaltyPoint(db, award.friend_id);
        const currentBalance = point?.balance ?? 0;
        await db
          .prepare(
            `INSERT INTO loyalty_transactions
               (id, friend_id, type, points, balance_after, reason, created_at, expires_at, source_tx_id)
             VALUES (?, ?, 'expire', 0, ?, '有効期限切れ（消費済み）', ?, NULL, ?)`,
          )
          .bind(
            crypto.randomUUID(),
            award.friend_id,
            currentBalance,
            new Date().toISOString(),
            award.award_id,
          )
          .run();
      }

      processed++;
    } catch (e) {
      console.error(`[loyalty-expiry] Failed to process award ${award.award_id} for ${award.friend_id}:`, e);
    }
  }

  return { processed };
}

/**
 * FIFO: 指定された award トランザクションから未使用のポイント数を計算する
 */
async function calcUnspentFromAward(
  db: D1Database,
  friendId: string,
  awardId: string,
  awardPoints: number,
): Promise<number> {
  // 消費済み合計（redeem + expire）
  const consumed = await db
    .prepare(
      `SELECT COALESCE(SUM(ABS(points)), 0) as total
       FROM loyalty_transactions
       WHERE friend_id = ? AND type IN ('redeem', 'expire')`,
    )
    .bind(friendId)
    .first<{ total: number }>();

  // 全 award を付与日時昇順で取得（FIFO）
  const allAwards = await db
    .prepare(
      `SELECT id, points FROM loyalty_transactions
       WHERE friend_id = ? AND type = 'award'
       ORDER BY created_at ASC`,
    )
    .bind(friendId)
    .all<{ id: string; points: number }>();

  let remaining = consumed?.total ?? 0;

  for (const a of allAwards.results) {
    const used = Math.min(remaining, a.points);
    remaining -= used;
    const unspent = a.points - used;

    if (a.id === awardId) {
      return unspent;
    }
  }

  return awardPoints; // fallback
}
