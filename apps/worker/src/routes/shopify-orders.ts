shopifyOrders.get('/api/shopify/orders/customer-summary/:friendId', async (c) => {
  const friendId = c.req.param('friendId');
  try {
    // 1. friends → metadata.email または user_id → users.email でメールを取得
    const f = await c.env.DB.prepare(`SELECT metadata, user_id FROM friends WHERE id=?`).bind(friendId).first<{ metadata: string | null; user_id: string | null }>();
    let email: string | null = null;
    if (f?.metadata) { try { const m = JSON.parse(f.metadata); email = m.email ?? null; } catch {} }
    if (!email && f?.user_id) { const u = await c.env.DB.prepare(`SELECT email FROM users WHERE id=?`).bind(f.user_id).first<{ email: string | null }>(); if (u?.email) email = u.email; }

    // 2. loyalty_points → shopify_customer_id
    const lp = await c.env.DB.prepare(`SELECT shopify_customer_id FROM loyalty_points WHERE friend_id=?`).bind(friendId).first<{ shopify_customer_id: string | null }>();
    const scId = lp?.shopify_customer_id ?? null;

    // 3. 全条件でクエリ（friend_id / shopify_customer_id / email）
    let where = `friend_id = ?`;
    const binds: (string | null)[] = [friendId];
    if (scId) { where += ` OR shopify_customer_id = ?`; binds.push(scId); }
    if (email) { where += ` OR email = ?`; binds.push(email); }

    const summary = await c.env.DB.prepare(`SELECT COUNT(*) AS total_orders, COALESCE(SUM(total_price),0) AS total_spent, MIN(processed_at) AS first_order_at, MAX(processed_at) AS last_order_at, COALESCE(SUM(CASE WHEN cancelled_at IS NULL THEN 1 ELSE 0 END),0) AS completed_orders FROM shopify_orders WHERE ${where}`).bind(...binds).first();

    const recentItems = await c.env.DB.prepare(`SELECT oi.title, oi.quantity, oi.price, o.processed_at, oi.shopify_order_id FROM shopify_order_items oi JOIN shopify_orders o ON o.shopify_order_id=oi.shopify_order_id WHERE ${where} ORDER BY o.processed_at DESC LIMIT 5`).bind(...binds).all();

    return c.json({ success: true, data: { summary: summary ?? { total_orders: 0, total_spent: 0, first_order_at: null, last_order_at: null, completed_orders: 0 }, recent_items: recentItems.results ?? [], debug: { scId, email, friendId } } });
  } catch (e) { return c.json({ success: false, error: String(e) }); }
});
