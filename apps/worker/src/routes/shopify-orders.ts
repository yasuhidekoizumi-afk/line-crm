// デバッグ用: friendId に対する全解決パスをダンプ
shopifyOrders.get('/api/shopify/orders/customer-summary/:friendId/debug', async (c) => {
  const friendId = c.req.param('friendId');
  const result: any = { friendId, steps: {} };
  try {
    const lp = await c.env.DB.prepare(`SELECT * FROM loyalty_points WHERE friend_id=?`).bind(friendId).first();
    result.steps.loyalty_points = lp ?? null;
    const friend = await c.env.DB.prepare(`SELECT id, user_id, metadata FROM friends WHERE id=?`).bind(friendId).first();
    result.steps.friend = friend ?? null;
    let email: string | null = null;
    if (friend?.metadata) { try { const m = JSON.parse(friend.metadata as string); email = m.email ?? null; } catch {} }
    if (!email && (friend as any)?.user_id) { const u = await c.env.DB.prepare(`SELECT id, email FROM users WHERE id=?`).bind((friend as any).user_id).first(); result.steps.user = u ?? null; if (u?.email) email = u.email as string; }
    result.steps.resolved_email = email;
    if (email) {
      const ordersByEmail = await c.env.DB.prepare(`SELECT shopify_order_id, email, total_price, processed_at FROM shopify_orders WHERE email=? LIMIT 5`).bind(email).all();
      result.steps.orders_by_email = ordersByEmail.results ?? [];
    }
    if (lp?.shopify_customer_id) {
      const ordersByScid = await c.env.DB.prepare(`SELECT shopify_order_id, shopify_customer_id, total_price, processed_at FROM shopify_orders WHERE shopify_customer_id=? LIMIT 5`).bind(lp.shopify_customer_id).all();
      result.steps.orders_by_scid = ordersByScid.results ?? [];
    }
    const ordersByFid = await c.env.DB.prepare(`SELECT shopify_order_id, friend_id, total_price, processed_at FROM shopify_orders WHERE friend_id=? LIMIT 5`).bind(friendId).all();
    result.steps.orders_by_friend_id = ordersByFid.results ?? [];
    return c.json({ success: true, data: result });
  } catch (e) { return c.json({ success: false, error: String(e) }, 500); }
});
