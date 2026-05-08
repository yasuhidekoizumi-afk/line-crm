/** Shopify 注文 BI ルート */
import { Hono } from 'hono';
import { authMiddleware } from '../middleware/auth.js';
import { persistShopifyOrder, getBackfillProgress, updateBackfillProgress, type ShopifyOrderPayload } from '../services/shopify-orders.js';
import type { Env } from '../index.js';

const shopifyOrders = new Hono<Env>();
shopifyOrders.use('/api/shopify/orders/*', authMiddleware);
const BACKFILL_LIMIT = 20, SHOPIFY_API_VERSION = '2024-10';

shopifyOrders.post('/api/shopify/orders/backfill', async (c) => {
  const sd = c.env.SHOPIFY_SHOP_DOMAIN, at = c.env.SHOPIFY_ADMIN_TOKEN;
  if (!sd || !at) return c.json({ success: false, error: 'Shopify credentials not configured' }, 500);
  const p = await getBackfillProgress(c.env.DB, 'orders');
  const sc = p?.cursor ?? '', tp = p?.total_processed ?? 0;
  await updateBackfillProgress(c.env.DB, 'orders', { status: 'running' });
  const params = new URLSearchParams({ status: 'any', limit: String(BACKFILL_LIMIT), order: 'created_at asc' });
  if (sc) params.set('created_at_min', sc);
  try {
    const res = await fetch(`https://${sd}/admin/api/${SHOPIFY_API_VERSION}/orders.json?${params}`, { headers: { 'X-Shopify-Access-Token': at, 'Content-Type': 'application/json' } });
    if (!res.ok) { const b = await res.text(); await updateBackfillProgress(c.env.DB, 'orders', { status: 'failed', last_error: `${res.status}: ${b.slice(0, 500)}` }); return c.json({ success: false, error: `Shopify ${res.status}: ${b.slice(0, 500)}` }, 502); }
    const data = (await res.json()) as { orders?: ShopifyOrderPayload[] };
    const orders = data.orders ?? [];
    let ins = 0, upd = 0, fail = 0; const fids: string[] = [];
    let maxCA: string | null = null;
    for (const o of orders) { if (o.created_at && (!maxCA || o.created_at > maxCA)) maxCA = o.created_at; }
    for (const o of orders) { try { const r = await persistShopifyOrder(c.env.DB, o, 'backfill', sd); if (r.inserted) ins++; else upd++; } catch { fail++; if (fids.length < 10) fids.push(String(o.id)); } }
    let nc = sc; if (maxCA) { const t = new Date(maxCA).getTime(); if (Number.isFinite(t)) nc = new Date(t + 1000).toISOString(); }
    const done = orders.length < BACKFILL_LIMIT;
    await updateBackfillProgress(c.env.DB, 'orders', { cursor: done ? null : nc, total_processed: tp + ins + upd, status: done ? 'completed' : 'idle', last_error: fail > 0 ? `${fail} failed (sample: ${fids.join(',')})` : null });
    return c.json({ success: true, data: { batch_size: orders.length, inserted: ins, updated: upd, failed: fail, failed_ids: fids, total_processed: tp + ins + upd, next_cursor: done ? null : nc, done } });
  } catch (e) { const msg = e instanceof Error ? e.message : String(e); await updateBackfillProgress(c.env.DB, 'orders', { status: 'failed', last_error: msg }); return c.json({ success: false, error: `Shopify fetch failed: ${msg}` }, 502); }
});
shopifyOrders.get('/api/shopify/orders/backfill/status', async (c) => { const p = await getBackfillProgress(c.env.DB, 'orders'); return c.json({ success: true, data: p ?? { status: 'not_started', total_processed: 0 } }); });
shopifyOrders.post('/api/shopify/orders/backfill/reset', async (c) => { await c.env.DB.prepare(`DELETE FROM shopify_backfill_progress WHERE job_name='orders'`).run(); return c.json({ success: true, data: { reset: true } }); });

shopifyOrders.get('/api/shopify/orders/stats', async (c) => {
  const from = c.req.query('from'), to = c.req.query('to');
  let w = `cancelled_at IS NULL AND (financial_status IS NULL OR financial_status NOT IN ('refunded','voided'))`;
  const b: string[] = []; if (from) { w += ` AND processed_at>=?`; b.push(from); } if (to) { w += ` AND processed_at<?`; b.push(to); }
  const t = await c.env.DB.prepare(`SELECT COUNT(*) AS order_count, COALESCE(SUM(total_price),0) AS total_revenue, COUNT(DISTINCT shopify_customer_id) AS unique_customers, COALESCE(SUM(CASE WHEN customer_orders_count=1 THEN 1 ELSE 0 END),0) AS new_customer_orders, COALESCE(SUM(CASE WHEN friend_id IS NOT NULL THEN 1 ELSE 0 END),0) AS line_linked_orders FROM shopify_orders WHERE ${w}`).bind(...b).first();
  return c.json({ success: true, data: t ?? null });
});

shopifyOrders.get('/api/shopify/orders/timeseries', async (c) => {
  const g = (c.req.query('granularity') ?? 'day') as string, rv = (c.req.query('range') ?? '30d') as string, cf = c.req.query('from'), ct = c.req.query('to');
  const now = new Date(), today = now.toISOString().slice(0, 10);
  let fd: string|null = null, td: string|null = today, pfd: string|null = null, ptd: string|null = null;
  if (cf && ct) { fd = cf; td = ct; } else { const dm: Record<string, number> = { '7d': 7, '30d': 30, '90d': 90, '180d': 180, '1y': 365 }; if (rv !== 'all' && dm[rv]) { const d = new Date(now); d.setDate(d.getDate() - dm[rv]); fd = d.toISOString().slice(0, 10); const p = new Date(d); p.setDate(p.getDate() - dm[rv]); pfd = p.toISOString().slice(0, 10); ptd = fd; } }
  const bucket = g === 'month' ? `SUBSTR(processed_at,1,7)` : g === 'week' ? `strftime('%Y-W%W',processed_at)` : `SUBSTR(processed_at,1,10)`;
  const vf = `cancelled_at IS NULL AND (financial_status IS NULL OR financial_status NOT IN ('refunded','voided'))`;
  const sb: string[] = []; let sw = vf; if (fd) { sw += ` AND processed_at>=?`; sb.push(fd); } if (td) { sw += ` AND processed_at<?`; sb.push(td); }
  const sr = await c.env.DB.prepare(`SELECT ${bucket} AS period, COUNT(*) AS orders, COALESCE(SUM(total_price),0) AS revenue, COALESCE(SUM(CASE WHEN friend_id IS NOT NULL THEN total_price ELSE 0 END),0) AS line_revenue, COALESCE(SUM(CASE WHEN friend_id IS NOT NULL THEN 1 ELSE 0 END),0) AS line_orders, COUNT(DISTINCT shopify_customer_id) AS unique_customers FROM shopify_orders WHERE ${sw} GROUP BY period ORDER BY period`).bind(...sb).all();
  const sm = await c.env.DB.prepare(`SELECT COUNT(*) AS total_orders, COALESCE(SUM(total_price),0) AS total_revenue, COALESCE(SUM(CASE WHEN friend_id IS NOT NULL THEN total_price ELSE 0 END),0) AS line_revenue, COUNT(DISTINCT shopify_customer_id) AS unique_customers FROM shopify_orders WHERE ${sw}`).bind(...sb).first();
  let cmp: any = null;
  if (!cf && !ct && pfd && ptd) { const p = await c.env.DB.prepare(`SELECT COALESCE(SUM(total_price),0) AS prev_total_revenue FROM shopify_orders WHERE ${vf} AND processed_at>=? AND processed_at<?`).bind(pfd, ptd).first(); const pv = (p as any)?.prev_total_revenue ?? 0; const cv = (sm as any)?.total_revenue ?? 0; cmp = { prev_total_revenue: pv, pct_change: pv > 0 ? Math.round(((cv - pv) / pv) * 1000) / 10 : null }; }
  return c.json({ success: true, data: { granularity: g, range: rv, from: fd, to: td, series: sr.results ?? [], summary: sm ?? { total_orders: 0, total_revenue: 0, line_revenue: 0, unique_customers: 0 }, comparison: cmp } });
});

shopifyOrders.get('/api/shopify/orders/kpi-bar', async (c) => {
  const now = new Date(), ts = now.toISOString().slice(0, 10);
  const ws = new Date(now); ws.setDate(ws.getDate() - ((ws.getDay() + 6) % 7)); const wsS = ws.toISOString().slice(0, 10);
  const ms = ts.slice(0, 7) + '-01', na = new Date(now); na.setDate(na.getDate() - 90); const naS = na.toISOString().slice(0, 10);
  const pw = new Date(ws); pw.setDate(pw.getDate() - 7); const pwS = pw.toISOString().slice(0, 10);
  const pm = new Date(now); pm.setMonth(pm.getMonth() - 1); const pmS = pm.toISOString().slice(0, 7) + '-01';
  const yd = new Date(now); yd.setDate(yd.getDate() - 1); const ydS = yd.toISOString().slice(0, 10);
  const vf = `cancelled_at IS NULL AND (financial_status IS NULL OR financial_status NOT IN ('refunded','voided'))`;
  const r = await c.env.DB.prepare(`SELECT COALESCE(SUM(CASE WHEN processed_at>=? THEN total_price ELSE 0 END),0) AS today_revenue, SUM(CASE WHEN processed_at>=? THEN 1 ELSE 0 END) AS today_orders, COALESCE(SUM(CASE WHEN processed_at>=? AND processed_at<? THEN total_price ELSE 0 END),0) AS yesterday_revenue, COALESCE(SUM(CASE WHEN processed_at>=? THEN total_price ELSE 0 END),0) AS week_revenue, SUM(CASE WHEN processed_at>=? THEN 1 ELSE 0 END) AS week_orders, COALESCE(SUM(CASE WHEN processed_at>=? AND processed_at<? THEN total_price ELSE 0 END),0) AS prev_week_revenue, COALESCE(SUM(CASE WHEN processed_at>=? THEN total_price ELSE 0 END),0) AS month_revenue, SUM(CASE WHEN processed_at>=? THEN 1 ELSE 0 END) AS month_orders, COUNT(DISTINCT CASE WHEN processed_at>=? THEN shopify_customer_id END) AS month_customers, COALESCE(SUM(CASE WHEN processed_at>=? AND friend_id IS NOT NULL THEN total_price ELSE 0 END),0) AS month_line_revenue, COALESCE(SUM(CASE WHEN processed_at>=? AND processed_at<? THEN total_price ELSE 0 END),0) AS prev_month_revenue, COALESCE(SUM(CASE WHEN processed_at>=? THEN total_price ELSE 0 END),0) AS d90_revenue, SUM(CASE WHEN processed_at>=? THEN 1 ELSE 0 END) AS d90_orders FROM shopify_orders WHERE ${vf}`).bind(ts, ts, ydS, ts, wsS, wsS, pwS, wsS, ms, ms, ms, ms, pmS, ms, naS, naS).first() as any;
  const pct = (c: number, p: number) => p > 0 ? Math.round(((c - p) / p) * 1000) / 10 : null;
  return c.json({ success: true, data: { today: { revenue: r?.today_revenue ?? 0, orders: r?.today_orders ?? 0, dod_pct: pct(r?.today_revenue ?? 0, r?.yesterday_revenue ?? 0) }, week: { revenue: r?.week_revenue ?? 0, orders: r?.week_orders ?? 0, wow_pct: pct(r?.week_revenue ?? 0, r?.prev_week_revenue ?? 0) }, month: { revenue: r?.month_revenue ?? 0, orders: r?.month_orders ?? 0, customers: r?.month_customers ?? 0, line_revenue: r?.month_line_revenue ?? 0, line_share_pct: (r?.month_revenue ?? 0) > 0 ? Math.round(((r?.month_revenue ?? 0) / (r?.month_revenue ?? 1)) * 1000) / 10 : 0, mom_pct: pct(r?.month_revenue ?? 0, r?.prev_month_revenue ?? 0) }, d90: { revenue: r?.d90_revenue ?? 0, orders: r?.d90_orders ?? 0 } } });
});

shopifyOrders.get('/api/shopify/orders/products-stats', async (c) => {
  const limit = Math.min(Number(c.req.query('limit') ?? 20), 100), from = c.req.query('from'), to = c.req.query('to');
  let wh = `o.cancelled_at IS NULL AND (o.financial_status IS NULL OR o.financial_status NOT IN ('refunded','voided'))`;
  const b: (string|number)[] = []; if (from) { wh += ` AND o.processed_at>=?`; b.push(from); } if (to) { wh += ` AND o.processed_at<?`; b.push(to); }
  const rows = await c.env.DB.prepare(`SELECT oi.title, oi.product_type, COUNT(DISTINCT oi.shopify_order_id) AS order_count, COALESCE(SUM(oi.quantity),0) AS units_sold, ROUND(COALESCE(SUM(oi.price*oi.quantity),0)) AS gross_revenue, ROUND(COALESCE(SUM(CASE WHEN o.friend_id IS NOT NULL THEN oi.price*oi.quantity ELSE 0 END),0)) AS line_revenue, ROUND(100.0*COALESCE(SUM(CASE WHEN o.friend_id IS NOT NULL THEN oi.price*oi.quantity ELSE 0 END),0)/NULLIF(SUM(oi.price*oi.quantity),0),1) AS line_share_pct FROM shopify_order_items oi JOIN shopify_orders o ON o.shopify_order_id=oi.shopify_order_id WHERE ${wh} GROUP BY oi.title ORDER BY gross_revenue DESC LIMIT ?`).bind(...b, limit).all();
  return c.json({ success: true, data: rows.results ?? [] });
});

// 顧客情報パネル用: friend_id / shopify_customer_id / email のいずれかで注文検索
shopifyOrders.get('/api/shopify/orders/customer-summary/:friendId', async (c) => {
  const friendId = c.req.param('friendId');
  try {
    const lp = await c.env.DB.prepare(`SELECT shopify_customer_id FROM loyalty_points WHERE friend_id=?`).bind(friendId).first<{ shopify_customer_id: string | null }>();
    const friend = await c.env.DB.prepare(`SELECT metadata FROM friends WHERE id=?`).bind(friendId).first<{ metadata: string | null }>();
    let email: string | null = null;
    if (friend?.metadata) { try { const m = JSON.parse(friend.metadata); email = m.email ?? null; } catch {} }
    const scId = lp?.shopify_customer_id ?? null;
    const summary = await c.env.DB.prepare(`SELECT COUNT(*) AS total_orders, COALESCE(SUM(total_price),0) AS total_spent, MIN(processed_at) AS first_order_at, MAX(processed_at) AS last_order_at, COALESCE(SUM(CASE WHEN cancelled_at IS NULL THEN 1 ELSE 0 END),0) AS completed_orders FROM shopify_orders WHERE friend_id=? OR (shopify_customer_id=? AND ? IS NOT NULL) OR (email=? AND ? IS NOT NULL)`).bind(friendId, scId, scId, email, email).first();
    const recentItems = await c.env.DB.prepare(`SELECT oi.title, oi.quantity, oi.price, o.processed_at, oi.shopify_order_id FROM shopify_order_items oi JOIN shopify_orders o ON o.shopify_order_id=oi.shopify_order_id WHERE o.friend_id=? OR (o.shopify_customer_id=? AND ? IS NOT NULL) OR (o.email=? AND ? IS NOT NULL) ORDER BY o.processed_at DESC LIMIT 5`).bind(friendId, scId, scId, email, email).all();
    return c.json({ success: true, data: { summary: summary ?? { total_orders: 0, total_spent: 0, first_order_at: null, last_order_at: null, completed_orders: 0 }, recent_items: recentItems.results ?? [] } });
  } catch { return c.json({ success: false, error: 'Internal server error' }, 500); }
});

export { shopifyOrders };
