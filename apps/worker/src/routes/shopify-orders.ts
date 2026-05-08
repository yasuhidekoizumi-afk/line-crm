/**
 * Shopify 注文 BI ルート
 *
 * - /api/shopify/orders/backfill             — 全期間バックフィル（1バッチずつ進める）
 * - /api/shopify/orders/backfill/status      — 進捗取得
 * - /api/shopify/orders/backfill/reset       — 進捗リセット
 * - /api/shopify/orders/stats                — 集計サマリ
 * - /api/shopify/orders/timeseries           — 時系列集計（granularity/range または from/to 指定可）
 * - /api/shopify/orders/customer-summary/:friendId — 顧客別注文サマリー
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
  if (!shopDomain || !adminToken) return c.json({ success: false, error: 'Shopify credentials not configured' }, 500);
  const progress = await getBackfillProgress(c.env.DB, 'orders');
  const sinceCursor = progress?.cursor ?? '';
  const totalProcessed = progress?.total_processed ?? 0;
  await updateBackfillProgress(c.env.DB, 'orders', { status: 'running' });
  const params = new URLSearchParams({ status: 'any', limit: String(BACKFILL_LIMIT), order: 'created_at asc' });
  if (sinceCursor) params.set('created_at_min', sinceCursor);
  const url = `https://${shopDomain}/admin/api/${SHOPIFY_API_VERSION}/orders.json?${params.toString()}`;
  const startedAt = Date.now();
  let res: Response;
  try { res = await fetch(url, { headers: { 'X-Shopify-Access-Token': adminToken, 'Content-Type': 'application/json' } }); }
  catch (e) { const msg = e instanceof Error ? e.message : String(e); await updateBackfillProgress(c.env.DB, 'orders', { status: 'failed', last_error: msg }); return c.json({ success: false, error: `Shopify fetch failed: ${msg}` }, 502); }
  if (!res.ok) { const body = await res.text(); await updateBackfillProgress(c.env.DB, 'orders', { status: 'failed', last_error: `${res.status}: ${body.slice(0, 500)}` }); return c.json({ success: false, error: `Shopify ${res.status}: ${body.slice(0, 500)}` }, 502); }
  const data = (await res.json()) as { orders?: ShopifyOrderPayload[] };
  const orders = data.orders ?? [];
  let inserted = 0, updated = 0, failed = 0; const failedIds: string[] = [];
  let maxCreatedAt: string | null = null;
  for (const order of orders) { if (order.created_at) { if (!maxCreatedAt || order.created_at > maxCreatedAt) maxCreatedAt = order.created_at; } }
  for (const order of orders) { try { const result = await persistShopifyOrder(c.env.DB, order, 'backfill', shopDomain); if (result.inserted) inserted++; else updated++; } catch (e) { failed++; if (failedIds.length < 10) failedIds.push(String(order.id)); } }
  let nextCursor = sinceCursor;
  if (maxCreatedAt) { const t = new Date(maxCreatedAt).getTime(); if (Number.isFinite(t)) nextCursor = new Date(t + 1000).toISOString(); }
  const done = orders.length < BACKFILL_LIMIT;
  await updateBackfillProgress(c.env.DB, 'orders', { cursor: done ? null : nextCursor, total_processed: totalProcessed + inserted + updated, status: done ? 'completed' : 'idle', last_error: failed > 0 ? `${failed} failed (sample: ${failedIds.join(',')})` : null });
  return c.json({ success: true, data: { batch_size: orders.length, inserted, updated, failed, failed_ids: failedIds, total_processed: totalProcessed + inserted + updated, next_cursor: done ? null : nextCursor, done, elapsed_ms: Date.now() - startedAt } });
});

shopifyOrders.get('/api/shopify/orders/backfill/status', async (c) => { const progress = await getBackfillProgress(c.env.DB, 'orders'); if (!progress) return c.json({ success: true, data: { status: 'not_started', total_processed: 0 } }); return c.json({ success: true, data: progress }); });
shopifyOrders.post('/api/shopify/orders/backfill/reset', async (c) => { await c.env.DB.prepare(`DELETE FROM shopify_backfill_progress WHERE job_name = 'orders'`).run(); return c.json({ success: true, data: { reset: true } }); });

shopifyOrders.get('/api/shopify/orders/stats', async (c) => {
  const from = c.req.query('from'), to = c.req.query('to');
  let where = `cancelled_at IS NULL AND (financial_status IS NULL OR financial_status NOT IN ('refunded','voided'))`;
  const binds: string[] = []; if (from) { where += ` AND processed_at >= ?`; binds.push(from); } if (to) { where += ` AND processed_at < ?`; binds.push(to); }
  const totals = await c.env.DB.prepare(`SELECT COUNT(*) AS order_count, COALESCE(SUM(total_price),0) AS total_revenue, COUNT(DISTINCT shopify_customer_id) AS unique_customers, COALESCE(SUM(CASE WHEN customer_orders_count=1 THEN 1 ELSE 0 END),0) AS new_customer_orders, COALESCE(SUM(CASE WHEN friend_id IS NOT NULL THEN 1 ELSE 0 END),0) AS line_linked_orders FROM shopify_orders WHERE ${where}`).bind(...binds).first();
  return c.json({ success: true, data: totals ?? null });
});

shopifyOrders.get('/api/shopify/orders/timeseries', async (c) => {
  const granularity = (c.req.query('granularity') ?? 'day') as 'day' | 'week' | 'month';
  const range = (c.req.query('range') ?? '30d') as '7d' | '30d' | '90d' | '180d' | '1y' | 'all';
  const customFrom = c.req.query('from'), customTo = c.req.query('to');
  const now = new Date(); const today = now.toISOString().slice(0, 10);
  let fromDate: string | null = null, toDate: string | null = today, prevFromDate: string | null = null, prevToDate: string | null = null;
  if (customFrom && customTo) { fromDate = customFrom; toDate = customTo; }
  else { const rangeDays: Record<string, number> = { '7d': 7, '30d': 30, '90d': 90, '180d': 180, '1y': 365 }; if (range !== 'all') { const d = new Date(now); d.setDate(d.getDate() - rangeDays[range]); fromDate = d.toISOString().slice(0, 10); const p1 = new Date(d); p1.setDate(p1.getDate() - rangeDays[range]); prevFromDate = p1.toISOString().slice(0, 10); prevToDate = fromDate; } }
  const bucket = granularity === 'month' ? `SUBSTR(processed_at, 1, 7)` : granularity === 'week' ? `strftime('%Y-W%W', processed_at)` : `SUBSTR(processed_at, 1, 10)`;
  const validFilter = `cancelled_at IS NULL AND (financial_status IS NULL OR financial_status NOT IN ('refunded','voided'))`;
  const seriesBinds: string[] = []; let seriesWhere = validFilter; if (fromDate) { seriesWhere += ` AND processed_at >= ?`; seriesBinds.push(fromDate); } if (toDate) { seriesWhere += ` AND processed_at < ?`; seriesBinds.push(toDate); }
  const seriesRes = await c.env.DB.prepare(`SELECT ${bucket} AS period, COUNT(*) AS orders, COALESCE(SUM(total_price),0) AS revenue, COALESCE(SUM(CASE WHEN friend_id IS NOT NULL THEN total_price ELSE 0 END),0) AS line_revenue, COALESCE(SUM(CASE WHEN friend_id IS NOT NULL THEN 1 ELSE 0 END),0) AS line_orders, COUNT(DISTINCT shopify_customer_id) AS unique_customers FROM shopify_orders WHERE ${seriesWhere} GROUP BY period ORDER BY period`).bind(...seriesBinds).all();
  const summary = await c.env.DB.prepare(`SELECT COUNT(*) AS total_orders, COALESCE(SUM(total_price),0) AS total_revenue, COALESCE(SUM(CASE WHEN friend_id IS NOT NULL THEN total_price ELSE 0 END),0) AS line_revenue, COUNT(DISTINCT shopify_customer_id) AS unique_customers FROM shopify_orders WHERE ${seriesWhere}`).bind(...seriesBinds).first<{ total_orders: number; total_revenue: number; line_revenue: number; unique_customers: number }>();
  let comparison: { prev_total_revenue: number; pct_change: number | null } | null = null;
  if (!customFrom && !customTo && prevFromDate && prevToDate) { const prev = await c.env.DB.prepare(`SELECT COALESCE(SUM(total_price),0) AS prev_total_revenue FROM shopify_orders WHERE ${validFilter} AND processed_at >= ? AND processed_at < ?`).bind(prevFromDate, prevToDate).first<{ prev_total_revenue: number }>(); const prevRev = prev?.prev_total_revenue ?? 0; const curRev = summary?.total_revenue ?? 0; comparison = { prev_total_revenue: prevRev, pct_change: prevRev > 0 ? Math.round(((curRev - prevRev) / prevRev) * 1000) / 10 : null }; }
  return c.json({ success: true, data: { granularity, range, from: fromDate, to: toDate, series: seriesRes.results ?? [], summary: summary ?? { total_orders: 0, total_revenue: 0, line_revenue: 0, unique_customers: 0 }, comparison } });
});

shopifyOrders.get('/api/shopify/orders/kpi-bar', async (c) => {
  const now = new Date(); const todayStr = now.toISOString().slice(0, 10);
  const weekStart = new Date(now); const dow = (weekStart.getDay() + 6) % 7; weekStart.setDate(weekStart.getDate() - dow); const weekStartStr = weekStart.toISOString().slice(0, 10);
  const monthStartStr = todayStr.slice(0, 7) + '-01';
  const ninetyAgo = new Date(now); ninetyAgo.setDate(ninetyAgo.getDate() - 90); const ninetyStartStr = ninetyAgo.toISOString().slice(0, 10);
  const prevWeekStart = new Date(weekStart); prevWeekStart.setDate(prevWeekStart.getDate() - 7); const prevWeekStartStr = prevWeekStart.toISOString().slice(0, 10);
  const monthCursor = new Date(now); monthCursor.setMonth(monthCursor.getMonth() - 1); const prevMonthStartStr = monthCursor.toISOString().slice(0, 7) + '-01';
  const yesterday = new Date(now); yesterday.setDate(yesterday.getDate() - 1); const yesterdayStr = yesterday.toISOString().slice(0, 10);
  const validFilter = `cancelled_at IS NULL AND (financial_status IS NULL OR financial_status NOT IN ('refunded','voided'))`;
  const result = await c.env.DB.prepare(`SELECT COALESCE(SUM(CASE WHEN processed_at>=? THEN total_price ELSE 0 END),0) AS today_revenue, SUM(CASE WHEN processed_at>=? THEN 1 ELSE 0 END) AS today_orders, COALESCE(SUM(CASE WHEN processed_at>=? AND processed_at<? THEN total_price ELSE 0 END),0) AS yesterday_revenue, COALESCE(SUM(CASE WHEN processed_at>=? THEN total_price ELSE 0 END),0) AS week_revenue, SUM(CASE WHEN processed_at>=? THEN 1 ELSE 0 END) AS week_orders, COALESCE(SUM(CASE WHEN processed_at>=? AND processed_at<? THEN total_price ELSE 0 END),0) AS prev_week_revenue, COALESCE(SUM(CASE WHEN processed_at>=? THEN total_price ELSE 0 END),0) AS month_revenue, SUM(CASE WHEN processed_at>=? THEN 1 ELSE 0 END) AS month_orders, COUNT(DISTINCT CASE WHEN processed_at>=? THEN shopify_customer_id END) AS month_customers, COALESCE(SUM(CASE WHEN processed_at>=? AND friend_id IS NOT NULL THEN total_price ELSE 0 END),0) AS month_line_revenue, COALESCE(SUM(CASE WHEN processed_at>=? AND processed_at<? THEN total_price ELSE 0 END),0) AS prev_month_revenue, COALESCE(SUM(CASE WHEN processed_at>=? THEN total_price ELSE 0 END),0) AS d90_revenue, SUM(CASE WHEN processed_at>=? THEN 1 ELSE 0 END) AS d90_orders FROM shopify_orders WHERE ${validFilter}`).bind(todayStr, todayStr, yesterdayStr, todayStr, weekStartStr, weekStartStr, prevWeekStartStr, weekStartStr, monthStartStr, monthStartStr, monthStartStr, monthStartStr, prevMonthStartStr, monthStartStr, ninetyStartStr, ninetyStartStr).first<Record<string, number>>();
  const r = result ?? {}; const pct = (cur: number, prev: number): number | null => prev > 0 ? Math.round(((cur - prev) / prev) * 1000) / 10 : null;
  return c.json({ success: true, data: { today: { revenue: r.today_revenue, orders: r.today_orders, dod_pct: pct(r.today_revenue, r.yesterday_revenue) }, week: { revenue: r.week_revenue, orders: r.week_orders, wow_pct: pct(r.week_revenue, r.prev_week_revenue) }, month: { revenue: r.month_revenue, orders: r.month_orders, customers: r.month_customers, line_revenue: r.month_line_revenue, line_share_pct: r.month_revenue > 0 ? Math.round((r.month_revenue / r.month_revenue) * 1000) / 10 : 0, mom_pct: pct(r.month_revenue, r.prev_month_revenue) }, d90: { revenue: r.d90_revenue, orders: r.d90_orders } } });
});

shopifyOrders.get('/api/shopify/orders/products-stats', async (c) => {
  const limit = Math.min(Number(c.req.query('limit') ?? 20), 100); const from = c.req.query('from'), to = c.req.query('to');
  let where = `o.cancelled_at IS NULL AND (o.financial_status IS NULL OR o.financial_status NOT IN ('refunded','voided'))`;
  const binds: (string | number)[] = []; if (from) { where += ` AND o.processed_at >= ?`; binds.push(from); } if (to) { where += ` AND o.processed_at < ?`; binds.push(to); }
  const rows = await c.env.DB.prepare(`SELECT oi.title, oi.product_type, COUNT(DISTINCT oi.shopify_order_id) AS order_count, COALESCE(SUM(oi.quantity),0) AS units_sold, ROUND(COALESCE(SUM(oi.price*oi.quantity),0)) AS gross_revenue, ROUND(COALESCE(SUM(CASE WHEN o.friend_id IS NOT NULL THEN oi.price*oi.quantity ELSE 0 END),0)) AS line_revenue, ROUND(100.0*COALESCE(SUM(CASE WHEN o.friend_id IS NOT NULL THEN oi.price*oi.quantity ELSE 0 END),0)/NULLIF(SUM(oi.price*oi.quantity),0),1) AS line_share_pct FROM shopify_order_items oi JOIN shopify_orders o ON o.shopify_order_id=oi.shopify_order_id WHERE ${where} GROUP BY oi.title ORDER BY gross_revenue DESC LIMIT ?`).bind(...binds, limit).all();
  return c.json({ success: true, data: rows.results ?? [] });
});

// ─── 顧客情報パネル用: friend_id に紐づく注文サマリー
shopifyOrders.get('/api/shopify/orders/customer-summary/:friendId', async (c) => {
  const friendId = c.req.param('friendId');
  try {
    const summary = await c.env.DB.prepare(`SELECT COUNT(*) AS total_orders, COALESCE(SUM(total_price),0) AS total_spent, MIN(processed_at) AS first_order_at, MAX(processed_at) AS last_order_at, COALESCE(SUM(CASE WHEN cancelled_at IS NULL THEN 1 ELSE 0 END),0) AS completed_orders FROM shopify_orders WHERE friend_id = ?`).bind(friendId).first();
    const recentItems = await c.env.DB.prepare(`SELECT oi.title, oi.quantity, oi.price, o.processed_at, oi.shopify_order_id FROM shopify_order_items oi JOIN shopify_orders o ON o.shopify_order_id=oi.shopify_order_id WHERE o.friend_id=? ORDER BY o.processed_at DESC LIMIT 5`).bind(friendId).all();
    return c.json({ success: true, data: { summary: summary ?? { total_orders: 0, total_spent: 0, first_order_at: null, last_order_at: null, completed_orders: 0 }, recent_items: recentItems.results ?? [] } });
  } catch { return c.json({ success: false, error: 'Internal server error' }, 500); }
});

export { shopifyOrders };
