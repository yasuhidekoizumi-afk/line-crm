/**
 * 顧客ジャーニー BI ルート
 *
 * - POST /api/customer-journey/recompute  — 全件リビルド
 * - GET  /api/customer-journey/funnel     — 2回目購入ファネル（コホート横断）
 * - GET  /api/customer-journey/cohort     — コホート別 2回目購入率（月別マトリクス）
 * - GET  /api/customer-journey/segment    — LINE連携 × 経過日数 × 昇格率
 *
 * 認証: Bearer API_KEY
 */

import { Hono } from 'hono';
import { authMiddleware } from '../middleware/auth.js';
import { recomputeCustomerJourney } from '../services/customer-journey.js';
import type { Env } from '../index.js';

const customerJourney = new Hono<Env>();

customerJourney.use('/api/customer-journey/*', authMiddleware);

// ─── 全件リビルド ───────────────────────────────────
customerJourney.post('/api/customer-journey/recompute', async (c) => {
  try {
    const result = await recomputeCustomerJourney(c.env.DB);
    return c.json({ success: true, data: result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[customer-journey/recompute] failed:', e);
    return c.json({ success: false, error: msg }, 500);
  }
});

// ─── 2回目購入ファネル（全期間サマリ）
// 結果: 初回購入者総数 / 2回目到達数 / LINE連携あり vs なし の昇格率
customerJourney.get('/api/customer-journey/funnel', async (c) => {
  const from = c.req.query('from'); // YYYY-MM-DD
  const to = c.req.query('to');

  let where = '1=1';
  const binds: string[] = [];
  if (from) { where += ' AND first_order_at >= ?'; binds.push(from); }
  if (to)   { where += ' AND first_order_at < ?'; binds.push(to); }

  const stats = await c.env.DB
    .prepare(
      `SELECT
         CASE WHEN is_currently_line_linked = 1 THEN 'LINE連携あり' ELSE 'LINE連携なし' END AS segment,
         COUNT(*) AS first_order_customers,
         SUM(CASE WHEN second_order_at IS NOT NULL THEN 1 ELSE 0 END) AS repeat_customers,
         ROUND(100.0 * SUM(CASE WHEN second_order_at IS NOT NULL THEN 1 ELSE 0 END) / COUNT(*), 1) AS repeat_rate_pct,
         SUM(CASE WHEN days_to_second <= 7 THEN 1 ELSE 0 END) AS repeat_within_7d,
         SUM(CASE WHEN days_to_second <= 30 THEN 1 ELSE 0 END) AS repeat_within_30d,
         SUM(CASE WHEN days_to_second <= 90 THEN 1 ELSE 0 END) AS repeat_within_90d,
         ROUND(AVG(days_to_second), 1) AS avg_days_to_second,
         ROUND(SUM(total_revenue) / COUNT(*)) AS ltv
       FROM customer_journey
       WHERE ${where}
       GROUP BY segment
       ORDER BY segment DESC`,
    )
    .bind(...binds)
    .all();

  return c.json({ success: true, data: stats.results ?? [] });
});

// ─── コホート別 2回目購入率（月別マトリクス）
customerJourney.get('/api/customer-journey/cohort', async (c) => {
  const from = c.req.query('from');
  const to = c.req.query('to');

  let where = '1=1';
  const binds: string[] = [];
  if (from) { where += " AND cohort_month >= ?"; binds.push(from.slice(0, 7)); }
  if (to)   { where += " AND cohort_month <= ?"; binds.push(to.slice(0, 7)); }

  const cohorts = await c.env.DB
    .prepare(
      `SELECT
         cohort_month,
         COUNT(*) AS first_order_customers,
         SUM(CASE WHEN second_order_at IS NOT NULL THEN 1 ELSE 0 END) AS repeat_customers,
         ROUND(100.0 * SUM(CASE WHEN second_order_at IS NOT NULL THEN 1 ELSE 0 END) / COUNT(*), 1) AS repeat_rate_pct,
         SUM(CASE WHEN is_currently_line_linked = 1 THEN 1 ELSE 0 END) AS line_linked_customers,
         ROUND(100.0 * SUM(CASE WHEN is_currently_line_linked = 1 THEN 1 ELSE 0 END) / COUNT(*), 1) AS line_link_rate_pct,
         SUM(CASE WHEN is_currently_line_linked = 1 AND second_order_at IS NOT NULL THEN 1 ELSE 0 END) AS line_repeat_customers,
         ROUND(100.0 * SUM(CASE WHEN is_currently_line_linked = 1 AND second_order_at IS NOT NULL THEN 1 ELSE 0 END)
               / NULLIF(SUM(CASE WHEN is_currently_line_linked = 1 THEN 1 ELSE 0 END), 0), 1) AS line_repeat_rate_pct,
         SUM(CASE WHEN is_currently_line_linked = 0 AND second_order_at IS NOT NULL THEN 1 ELSE 0 END) AS noline_repeat_customers,
         ROUND(100.0 * SUM(CASE WHEN is_currently_line_linked = 0 AND second_order_at IS NOT NULL THEN 1 ELSE 0 END)
               / NULLIF(SUM(CASE WHEN is_currently_line_linked = 0 THEN 1 ELSE 0 END), 0), 1) AS noline_repeat_rate_pct
       FROM customer_journey
       WHERE ${where}
       GROUP BY cohort_month
       ORDER BY cohort_month`,
    )
    .bind(...binds)
    .all();

  return c.json({ success: true, data: cohorts.results ?? [] });
});

// ─── 流入チャネル別 売上（landing_site UTM ベース）
// utm_source / utm_medium を解析して email / line / tiktok / meta / google / other に分類
customerJourney.get('/api/customer-journey/traffic-source', async (c) => {
  const from = c.req.query('from');
  const to = c.req.query('to');

  let where = `cancelled_at IS NULL AND (financial_status IS NULL OR financial_status NOT IN ('refunded','voided'))`;
  const binds: string[] = [];
  if (from) { where += ` AND processed_at >= ?`; binds.push(from); }
  if (to)   { where += ` AND processed_at < ?`;  binds.push(to); }

  const rows = await c.env.DB
    .prepare(
      `SELECT
         CASE
           WHEN landing_site LIKE '%utm_source=email%' OR landing_site LIKE '%utm_medium=email%' THEN 'email'
           WHEN landing_site LIKE '%utm_source=line%' OR landing_site LIKE '%utm_medium=line%' THEN 'line'
           WHEN landing_site LIKE '%utm_source=tiktok%' THEN 'tiktok'
           WHEN landing_site LIKE '%utm_source=facebook%' OR landing_site LIKE '%utm_source=meta%' OR landing_site LIKE '%utm_source=instagram%' THEN 'meta'
           WHEN landing_site LIKE '%utm_source=google%' THEN 'google'
           WHEN landing_site LIKE '%utm%' THEN 'other_utm'
           WHEN landing_site IS NULL OR landing_site = '' THEN 'none'
           ELSE 'direct'
         END AS source,
         COUNT(*) AS orders,
         COUNT(DISTINCT shopify_customer_id) AS unique_customers,
         COALESCE(ROUND(SUM(total_price)), 0) AS revenue,
         COALESCE(ROUND(SUM(CASE WHEN customer_orders_count = 1 THEN total_price ELSE 0 END)), 0) AS new_customer_revenue,
         COALESCE(SUM(CASE WHEN customer_orders_count = 1 THEN 1 ELSE 0 END), 0) AS new_customer_orders,
         COALESCE(SUM(CASE WHEN friend_id IS NOT NULL THEN 1 ELSE 0 END), 0) AS line_linked_orders,
         COALESCE(ROUND(SUM(total_price) / NULLIF(COUNT(*), 0)), 0) AS aov,
         COALESCE(ROUND(SUM(total_price) / NULLIF(COUNT(DISTINCT shopify_customer_id), 0)), 0) AS revenue_per_customer
       FROM shopify_orders
       WHERE ${where}
       GROUP BY source
       ORDER BY revenue DESC`,
    )
    .bind(...binds)
    .all();

  return c.json({ success: true, data: rows.results ?? [] });
});

// ─── チャネルマトリクス（LINE × Email 4象限）
customerJourney.get('/api/customer-journey/channel-matrix', async (c) => {
  const from = c.req.query('from');
  const to = c.req.query('to');

  let where = `o.cancelled_at IS NULL
    AND (o.financial_status IS NULL OR o.financial_status NOT IN ('refunded','voided'))
    AND o.shopify_customer_id IS NOT NULL`;
  const binds: string[] = [];
  if (from) { where += ` AND o.processed_at >= ?`; binds.push(from); }
  if (to)   { where += ` AND o.processed_at < ?`;  binds.push(to); }

  const rows = await c.env.DB
    .prepare(
      `SELECT
         CASE WHEN o.friend_id IS NOT NULL THEN 1 ELSE 0 END AS line_linked,
         CASE WHEN c.subscribed_email = 1 THEN 1 ELSE 0 END AS email_subscribed,
         COUNT(DISTINCT o.shopify_customer_id) AS customers,
         COUNT(*) AS orders,
         COALESCE(ROUND(SUM(o.total_price)), 0) AS revenue,
         COALESCE(ROUND(SUM(o.total_price) / NULLIF(COUNT(DISTINCT o.shopify_customer_id), 0)), 0) AS ltv,
         COALESCE(ROUND(SUM(o.total_price) / NULLIF(COUNT(*), 0)), 0) AS aov
       FROM shopify_orders o
       LEFT JOIN customers c ON c.customer_id = o.customer_id
       WHERE ${where}
       GROUP BY line_linked, email_subscribed
       ORDER BY ltv DESC`,
    )
    .bind(...binds)
    .all();

  return c.json({ success: true, data: rows.results ?? [] });
});

// ─── セグメント別 (LINE連携・ロイヤルティランク・経過日数バケット)
customerJourney.get('/api/customer-journey/segment', async (c) => {
  const stats = await c.env.DB
    .prepare(
      `SELECT
         COALESCE(current_loyalty_rank, '未連携') AS rank,
         COUNT(*) AS first_order_customers,
         SUM(CASE WHEN second_order_at IS NOT NULL THEN 1 ELSE 0 END) AS repeat_customers,
         ROUND(100.0 * SUM(CASE WHEN second_order_at IS NOT NULL THEN 1 ELSE 0 END) / COUNT(*), 1) AS repeat_rate_pct,
         SUM(CASE WHEN days_to_second BETWEEN 0 AND 7 THEN 1 ELSE 0 END) AS within_7d,
         SUM(CASE WHEN days_to_second BETWEEN 8 AND 30 THEN 1 ELSE 0 END) AS within_30d,
         SUM(CASE WHEN days_to_second BETWEEN 31 AND 90 THEN 1 ELSE 0 END) AS within_90d,
         SUM(CASE WHEN days_to_second > 90 THEN 1 ELSE 0 END) AS over_90d,
         ROUND(AVG(days_to_second), 1) AS avg_days_to_second,
         ROUND(SUM(total_revenue) / COUNT(*)) AS ltv,
         ROUND(AVG(total_orders), 2) AS avg_total_orders
       FROM customer_journey
       GROUP BY rank
       ORDER BY ltv DESC`,
    )
    .all();

  return c.json({ success: true, data: stats.results ?? [] });
});

export { customerJourney };
