import {
  getLoyaltyPoint,
  getLoyaltySetting,
  getActiveCampaigns,
  applyCampaigns,
  upsertLoyaltyPoint,
  addLoyaltyTransaction,
  determineRank,
  calculatePoints,
} from '@line-crm/db';

export interface BackfillResult {
  processed: number;
  skipped: number;
  totalPointsAwarded: number;
  details: Array<{ orderId: string; points: number; amount: number; skipped?: string }>;
}

/**
 * LINE連携した友だちに対し、保留中のShopify注文ポイントを遡及付与する。
 * 冪等性：同一order_idで既にaward済みのものはスキップ。処理済みはpending_ordersから削除。
 */
export async function backfillPendingOrders(
  db: D1Database,
  friendId: string,
  shopifyCustomerId: string,
): Promise<BackfillResult> {
  const result: BackfillResult = { processed: 0, skipped: 0, totalPointsAwarded: 0, details: [] };

  const pending = await db
    .prepare(
      `SELECT order_id, order_amount, currency FROM loyalty_pending_orders
       WHERE shopify_customer_id = ? AND processed_at IS NULL
       ORDER BY created_at ASC`,
    )
    .bind(shopifyCustomerId)
    .all<{ order_id: string; order_amount: number; currency: string | null }>();

  const rows = pending.results ?? [];
  if (rows.length === 0) return result;

  const [pointRateSetting, expiryDaysSetting, yenOnlySetting] = await Promise.all([
    getLoyaltySetting(db, 'point_rate').catch(() => null),
    getLoyaltySetting(db, 'expiry_days').catch(() => null),
    getLoyaltySetting(db, 'yen_only').catch(() => null),
  ]);
  const pointRate = parseFloat(pointRateSetting ?? '0.01') || 0.01;
  const expiryDays = parseInt(expiryDaysSetting ?? '365', 10) || 365;
  const activeCampaigns = await getActiveCampaigns(db).catch(() => []);

  for (const row of rows) {
    const orderId = row.order_id;

    // 既に付与されているか
    const dup = await db
      .prepare(`SELECT 1 FROM loyalty_transactions WHERE order_id = ? AND type = 'award' LIMIT 1`)
      .bind(orderId)
      .first();
    if (dup) {
      result.skipped++;
      result.details.push({ orderId, points: 0, amount: row.order_amount, skipped: 'already_awarded' });
      await db
        .prepare(`UPDATE loyalty_pending_orders SET processed_at = ? WHERE order_id = ?`)
        .bind(new Date().toISOString(), orderId)
        .run();
      continue;
    }

    if ((yenOnlySetting ?? '1') === '1' && row.currency && row.currency !== 'JPY') {
      result.skipped++;
      result.details.push({ orderId, points: 0, amount: row.order_amount, skipped: 'non_jpy' });
      await db
        .prepare(`UPDATE loyalty_pending_orders SET processed_at = ? WHERE order_id = ?`)
        .bind(new Date().toISOString(), orderId)
        .run();
      continue;
    }

    // 現在の残高・累計で計算（注文順にロール）
    const current = await getLoyaltyPoint(db, friendId);
    const currentBalance = current?.balance ?? 0;
    const currentTotalSpent = current?.total_spent ?? 0;
    const currentRank = determineRank(currentTotalSpent);
    const basePoints = calculatePoints(row.order_amount, currentRank, pointRate);

    const { finalPoints: earnedPoints } = applyCampaigns(
      basePoints,
      row.order_amount,
      { customerTags: [], productTags: [], productIds: [], productTypes: [], collectionIds: [], totalSpent: currentTotalSpent },
      activeCampaigns,
    );

    const newTotalSpent = currentTotalSpent + row.order_amount;
    const newBalance = currentBalance + earnedPoints;
    const newRank = determineRank(newTotalSpent);

    await upsertLoyaltyPoint(db, friendId, {
      balance: newBalance,
      totalSpent: newTotalSpent,
      rank: newRank,
      shopifyCustomerId,
    });

    await addLoyaltyTransaction(db, {
      friendId,
      type: 'award',
      points: earnedPoints,
      balanceAfter: newBalance,
      reason: `LINE連携時の遡及付与（¥${row.order_amount.toLocaleString('ja-JP')}）`,
      orderId,
      expiryDays,
    });

    await db
      .prepare(`UPDATE loyalty_pending_orders SET processed_at = ? WHERE order_id = ?`)
      .bind(new Date().toISOString(), orderId)
      .run();

    result.processed++;
    result.totalPointsAwarded += earnedPoints;
    result.details.push({ orderId, points: earnedPoints, amount: row.order_amount });
  }

  return result;
}
