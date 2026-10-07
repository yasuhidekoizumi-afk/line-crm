// 注文確定済みの利用ポイントを、未使用コードの保留ポイントに含めない。
export async function getPendingLoyaltyCode(db: D1Database, friendId: string) {
  const latest = await db
    .prepare(`SELECT reason, points FROM loyalty_transactions
      WHERE friend_id = ? AND type = 'redeem' AND order_id IS NULL
        AND reason NOT LIKE '[取り消し済み]%'
        AND reason NOT LIKE '[利用済み]%'
        AND reason NOT LIKE '%注文確定%'
        AND reason LIKE '%コード: %'
      ORDER BY created_at DESC LIMIT 1`)
    .bind(friendId)
    .first<{ reason: string; points: number }>();
  const code = latest?.reason?.match(/コード: ([A-Z0-9-]+)/)?.[1];
  if (!code || !latest || latest.points >= 0) return null;
  const discount = latest.reason.match(/¥([0-9,]+)割引/);
  return {
    code,
    discount: discount ? parseInt(discount[1].replace(/,/g, ''), 10) : null,
    points: Math.abs(latest.points),
  };
}
