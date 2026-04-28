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
