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
  options: { expireLimited?: boolean } = {},
): Promise<{ processed: number }> {
  // 期間限定ポイントの失効（運用判断で有効化する。既定はOFF）
  if (options.expireLimited) {
    await expireLimitedBalances(db);
  }

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
          balanceAfter: newBalance + (point?.limited_balance ?? 0),
          reason: 'ポイント有効期限切れ',
          sourceTxId: award.award_id,
        }).catch((err) => {
          // 一意制約（同じawardの二重失効）は正常系として無視する
          const msg = err instanceof Error ? err.message : String(err);
          if (!msg.includes('UNIQUE') && !msg.includes('constraint')) throw err;
        });
      } else {
        // 全て消費済み — 処理済みとしてマークするだけ（0pt expire）
        const point = await getLoyaltyPoint(db, award.friend_id);
        const currentBalance = point?.balance ?? 0;
        await db
          .prepare(
            `INSERT OR IGNORE INTO loyalty_transactions
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
 *
 * 注意: '[取り消し済み]' プレフィックス付きの redeem は実際には消費していない
 * （cancel-code で返還済み）ため、consumed から除外する必要がある。
 * これを含めると、未消費判定が低めになり期限切れ時に balance から
 * 過剰に引かれてしまう (画山さん事例で発覚)。
 */
async function calcUnspentFromAward(
  db: D1Database,
  friendId: string,
  awardId: string,
  awardPoints: number,
): Promise<number> {
  // 消費済み合計（redeem + expire、ただし [取り消し済み] プレフィックスは除外）
  const consumed = await db
    .prepare(
      `SELECT COALESCE(SUM(ABS(points)), 0) as total
       FROM loyalty_transactions
       WHERE friend_id = ?
         AND type IN ('redeem', 'expire')
         AND (reason IS NULL OR reason NOT LIKE '[取り消し済み]%')`,
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

/**
 * 期間限定ポイント（limited_balance）の失効。
 * 既定は無効で、LIMITED_POINT_EXPIRY_ENABLED=1 のときだけ動く。
 * 有効化すると期限切れの限定ポイントが残高から消えるため、運用判断が必要。
 */
async function expireLimitedBalances(db: D1Database): Promise<void> {
  const rows = await db
    .prepare(
      `SELECT friend_id, limited_balance
       FROM loyalty_points
       WHERE limited_balance > 0
         AND limited_expires_at IS NOT NULL
         AND datetime(limited_expires_at) <= datetime('now')`,
    )
    .all<{ friend_id: string; limited_balance: number }>();

  for (const row of rows.results ?? []) {
    try {
      const point = await getLoyaltyPoint(db, row.friend_id);
      if (!point) continue;
      await upsertLoyaltyPoint(db, row.friend_id, {
        balance: point.balance,
        limitedBalance: 0,
        limitedExpiresAt: null,
        totalSpent: point.total_spent ?? 0,
        rank: determineRank(point.total_spent ?? 0),
        shopifyCustomerId: point.shopify_customer_id ?? undefined,
      });
      await addLoyaltyTransaction(db, {
        friendId: row.friend_id,
        type: 'expire',
        points: -row.limited_balance,
        balanceAfter: point.balance,
        reason: '期間限定ポイント有効期限切れ',
      }).catch(() => undefined);
    } catch (error) {
      console.error(`[loyalty-expiry] limited expiry failed for ${row.friend_id}:`, error);
    }
  }
}
