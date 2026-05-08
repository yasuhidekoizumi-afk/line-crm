import { Hono } from 'hono';
import { authMiddleware } from '../middleware/auth.js';
import { batchMatchAll, matchShopifyOrderToFriend, applyMatch } from '../services/shopify-matching.js';
import type { Env } from '../index.js';

const shopifyAutoMatch = new Hono<Env>();
shopifyAutoMatch.use('/api/shopify/auto-match/*', authMiddleware);

// GET /api/shopify/auto-match/stats — 未マッチ注文の統計
shopifyAutoMatch.get('/api/shopify/auto-match/stats', async (c) => {
  const total = await c.env.DB
    .prepare(`SELECT COUNT(*) as n FROM shopify_orders WHERE friend_id IS NULL AND cancelled_at IS NULL`)
    .first<{ n: number }>();

  const withName = await c.env.DB
    .prepare(`SELECT COUNT(*) as n FROM shopify_orders WHERE friend_id IS NULL AND cancelled_at IS NULL AND customer_name IS NOT NULL`)
    .first<{ n: number }>();

  return c.json({
    success: true,
    data: {
      totalUnmatched: total?.n ?? 0,
      withName: withName?.n ?? 0,
      withoutName: (total?.n ?? 0) - (withName?.n ?? 0),
    },
  });
});

// POST /api/shopify/auto-match/run — バッチマッチング実行
shopifyAutoMatch.post('/api/shopify/auto-match/run', async (c) => {
  try {
    const body = await c.req.json<{ limit?: number }>().catch(() => ({}));
    const result = await batchMatchAll(c.env.DB, { limit: body.limit ?? 500 });
    return c.json({ success: true, data: result });
  } catch (e) {
    return c.json({ success: false, error: String(e) }, 500);
  }
});

// POST /api/shopify/auto-match/single — 単一注文マッチング（デバッグ用）
shopifyAutoMatch.post('/api/shopify/auto-match/single', async (c) => {
  try {
    const body = await c.req.json<{ shopifyOrderId: string }>();
    const order = await c.env.DB
      .prepare(`SELECT shopify_order_id, shopify_customer_id, customer_name, email, phone FROM shopify_orders WHERE shopify_order_id = ?`)
      .bind(body.shopifyOrderId)
      .first();

    if (!order) return c.json({ success: false, error: 'Order not found' }, 404);

    const candidate = await matchShopifyOrderToFriend(c.env.DB, order as any);

    if (candidate) {
      await applyMatch(c.env.DB, body.shopifyOrderId, candidate.id, (order as any).shopify_customer_id);
    }

    return c.json({ success: true, data: { order, candidate } });
  } catch (e) {
    return c.json({ success: false, error: String(e) }, 500);
  }
});

export { shopifyAutoMatch };
