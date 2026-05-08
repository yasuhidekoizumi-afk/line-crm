// ─── 顧客情報パネル用: friend_id に紐づく注文サマリー
shopifyOrders.get('/api/shopify/orders/customer-summary/:friendId', async (c) => {
  const friendId = c.req.param('friendId');
  try {
    const summary = await c.env.DB
      .prepare(`SELECT
          COUNT(*) AS total_orders,
          COALESCE(SUM(total_price), 0) AS total_spent,
          MIN(processed_at) AS first_order_at,
          MAX(processed_at) AS last_order_at,
          COALESCE(SUM(CASE WHEN cancelled_at IS NULL THEN 1 ELSE 0 END), 0) AS completed_orders
        FROM shopify_orders
        WHERE friend_id = ?`)
      .bind(friendId)
      .first();

    const recentItems = await c.env.DB
      .prepare(`SELECT oi.title, oi.quantity, oi.price, o.processed_at, oi.shopify_order_id
        FROM shopify_order_items oi
        JOIN shopify_orders o ON o.shopify_order_id = oi.shopify_order_id
        WHERE o.friend_id = ?
        ORDER BY o.processed_at DESC
        LIMIT 5`)
      .bind(friendId)
      .all();

    return c.json({ success: true, data: { summary: summary ?? { total_orders: 0, total_spent: 0, first_order_at: null, last_order_at: null, completed_orders: 0 }, recent_items: recentItems.results ?? [] } });
  } catch { return c.json({ success: false, error: 'Internal server error' }, 500); }
});
