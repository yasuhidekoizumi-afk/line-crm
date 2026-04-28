/**
 * Shopify 注文 BI ルート
 *
 * - /api/shopify/orders/backfill         — 全期間バックフィル（1バッチずつ進める）
 * - /api/shopify/orders/backfill/status  — 進捗取得
 * - /api/shopify/orders/backfill/reset   — 進捗リセット
 * - /api/shopify/orders/stats            — 集計サマリ
 *
 * バックフィル設計:
 *   - Shopify Admin REST `/orders.json` を created_at 昇順で取得（100件/バッチ）
 *   - 失敗があっても break しない（cursor を進めて先に進む）
 *   - cursor は **取得した全注文の最大 created_at + 1ms**（成功/失敗問わず）
 *     → 同一注文で永久ループしない
 */

import { Hono } from 'hono';
import { authMiddleware } from '../middleware/auth.js';
import {
  persistShopifyOrder,
  getBackfillProgress,
  updateBackfillProgress,
  type ShopifyOrderPayload,
} from '../services/shopify-orders.js';
import type { Env } from '../index.js';

const shopifyOrders = new Hono<Env>();

shopifyOrders.use('/api/shopify/orders/*', authMiddleware);

const BACKFILL_LIMIT = 20;
const SHOPIFY_API_VERSION = '2024-10';

shopifyOrders.post('/api/shopify/orders/backfill', async (c) => {
  const shopDomain = c.env.SHOPIFY_SHOP_DOMAIN;
  const adminToken = c.env.SHOPIFY_ADMIN_TOKEN;
  if (!shopDomain || !adminToken) {
    return c.json({ success: false, error: 'Shopify credentials not configured' }, 500);
  }

  const progress = await getBackfillProgress(c.env.DB, 'orders');
  const sinceCursor = progress?.cursor ?? '';
  const totalProcessed = progress?.total_processed ?? 0;

  await updateBackfillProgress(c.env.DB, 'orders', { status: 'running' });

  const params = new URLSearchParams({
    status: 'any',
    limit: String(BACKFILL_LIMIT),
    order: 'created_at asc',
  });
  if (sinceCursor) params.set('created_at_min', sinceCursor);

  const url = `https://${shopDomain}/admin/api/${SHOPIFY_API_VERSION}/orders.json?${params.toString()}`;
  const startedAt = Date.now();

  let res: Response;
  try {
    res = await fetch(url, {
      headers: { 'X-Shopify-Access-Token': adminToken, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await updateBackfillProgress(c.env.DB, 'orders', { status: 'failed', last_error: msg });
    return c.json({ success: false, error: `Shopify fetch failed: ${msg}` }, 502);
  }

  if (!res.ok) {
    const body = await res.text();
    await updateBackfillProgress(c.env.DB, 'orders', {
      status: 'failed',
      last_error: `${res.status}: ${body.slice(0, 500)}`,
    });
    return c.json({ success: false, error: `Shopify ${res.status}: ${body.slice(0, 500)}` }, 502);
  }

  const data = (await res.json()) as { orders?: ShopifyOrderPayload[] };
  const orders = data.orders ?? [];

  let inserted = 0;
  let updated = 0;
  let failed = 0;
  const failedIds: string[] = [];

  // 取得した全注文の最大 created_at（成功/失敗問わず）でカーソル前進
  let maxCreatedAt: string | null = null;
  for (const order of orders) {
    if (order.created_at) {
      if (!maxCreatedAt || order.created_at > maxCreatedAt) maxCreatedAt = order.created_at;
    }
  }

  for (const order of orders) {
    try {
      const result = await persistShopifyOrder(c.env.DB, order, 'backfill', shopDomain);
      if (result.inserted) inserted++;
      else updated++;
    } catch (e) {
      failed++;
      if (failedIds.length < 10) failedIds.push(String(order.id));
      console.error('[backfill] persist failed for order', order.id, e);
      // break しない: 失敗をスキップして次の注文へ
    }
  }

  let nextCursor = sinceCursor;
  if (maxCreatedAt) {
    const t = new Date(maxCreatedAt).getTime();
    if (Number.isFinite(t)) nextCursor = new Date(t + 1000).toISOString(); // +1秒（Shopify APIの精度を考慮）
  }

  // バッチ件数 < limit なら本当に終了
  const done = orders.length < BACKFILL_LIMIT;

  await updateBackfillProgress(c.env.DB, 'orders', {
    cursor: done ? null : nextCursor,
    total_processed: totalProcessed + inserted + updated,
    status: done ? 'completed' : 'idle',
    last_error: failed > 0 ? `${failed} failed (sample: ${failedIds.join(',')})` : null,
  });

  return c.json({
    success: true,
    data: {
      batch_size: orders.length,
      inserted,
      updated,
      failed,
      failed_ids: failedIds,
      total_processed: totalProcessed + inserted + updated,
      next_cursor: done ? null : nextCursor,
      done,
      elapsed_ms: Date.now() - startedAt,
    },
  });
});

shopifyOrders.get('/api/shopify/orders/backfill/status', async (c) => {
  const progress = await getBackfillProgress(c.env.DB, 'orders');
  if (!progress) return c.json({ success: true, data: { status: 'not_started', total_processed: 0 } });
  return c.json({ success: true, data: progress });
});

shopifyOrders.post('/api/shopify/orders/backfill/reset', async (c) => {
  await c.env.DB
    .prepare(`DELETE FROM shopify_backfill_progress WHERE job_name = 'orders'`)
    .run();
  return c.json({ success: true, data: { reset: true } });
});

shopifyOrders.get('/api/shopify/orders/stats', async (c) => {
  const from = c.req.query('from');
  const to = c.req.query('to');

  let where = `cancelled_at IS NULL AND (financial_status IS NULL OR financial_status NOT IN ('refunded', 'voided'))`;
  const binds: string[] = [];
  if (from) { where += ` AND processed_at >= ?`; binds.push(from); }
  if (to)   { where += ` AND processed_at < ?`;  binds.push(to); }

  const totals = await c.env.DB
    .prepare(
      `SELECT
         COUNT(*) AS order_count,
         COALESCE(SUM(total_price), 0) AS total_revenue,
         COUNT(DISTINCT shopify_customer_id) AS unique_customers,
         COALESCE(SUM(CASE WHEN customer_orders_count = 1 THEN 1 ELSE 0 END), 0) AS new_customer_orders,
         COALESCE(SUM(CASE WHEN friend_id IS NOT NULL THEN 1 ELSE 0 END), 0) AS line_linked_orders
       FROM shopify_orders WHERE ${where}`,
    )
    .bind(...binds)
    .first();

  return c.json({ success: true, data: totals ?? null });
});

// ─── 商品別 集計（売上・LINE経由比率）
shopifyOrders.get('/api/shopify/orders/products-stats', async (c) => {
  const limit = Math.min(Number(c.req.query('limit') ?? 20), 100);
  const from = c.req.query('from');
  const to = c.req.query('to');

  let where = `o.cancelled_at IS NULL AND (o.financial_status IS NULL OR o.financial_status NOT IN ('refunded','voided'))`;
  const binds: (string | number)[] = [];
  if (from) { where += ` AND o.processed_at >= ?`; binds.push(from); }
  if (to)   { where += ` AND o.processed_at < ?`;  binds.push(to); }

  const rows = await c.env.DB
    .prepare(
      `SELECT
         oi.title,
         oi.product_type,
         COUNT(DISTINCT oi.shopify_order_id) AS order_count,
         COALESCE(SUM(oi.quantity), 0) AS units_sold,
         ROUND(COALESCE(SUM(oi.price * oi.quantity), 0)) AS gross_revenue,
         ROUND(COALESCE(SUM(CASE WHEN o.friend_id IS NOT NULL THEN oi.price * oi.quantity ELSE 0 END), 0)) AS line_revenue,
         ROUND(100.0 * COALESCE(SUM(CASE WHEN o.friend_id IS NOT NULL THEN oi.price * oi.quantity ELSE 0 END), 0)
               / NULLIF(SUM(oi.price * oi.quantity), 0), 1) AS line_share_pct
       FROM shopify_order_items oi
       JOIN shopify_orders o ON o.shopify_order_id = oi.shopify_order_id
       WHERE ${where}
       GROUP BY oi.title
       ORDER BY gross_revenue DESC
       LIMIT ?`,
    )
    .bind(...binds, limit)
    .all();

  return c.json({ success: true, data: rows.results ?? [] });
});

export { shopifyOrders };
