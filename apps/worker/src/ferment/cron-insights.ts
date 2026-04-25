/**
 * FERMENT: 顧客インサイト計算 cron
 *
 * 日次実行で全顧客の以下を再計算:
 *   - 平均購入間隔
 *   - 次回購入予測日
 *   - 30日以内の購入確率
 *   - 予測 CLV
 *   - 最適な送信時刻（過去開封ログから）
 */

import type { FermentEnv } from './types.js';

interface CustomerForCalc {
  customer_id: string;
  ltv: number | null;
  order_count: number | null;
  first_order_at: string | null;
  last_order_at: string | null;
  created_at: string;
}

const MS_PER_DAY = 1000 * 60 * 60 * 24;

function daysBetween(a: string, b: string): number {
  return Math.max(0, Math.floor((new Date(b).getTime() - new Date(a).getTime()) / MS_PER_DAY));
}

/** 簡易 CLV 計算: 平均購入額 × 推定残存購入回数 */
function calculateCLV(c: CustomerForCalc): number {
  if (!c.order_count || c.order_count === 0 || !c.ltv) return 0;
  const aov = c.ltv / c.order_count;  // 平均購入額
  // 推定残存購入回数（顧客寿命 36ヶ月想定、すでに経過した期間を引く）
  const ageDays = c.created_at ? daysBetween(c.created_at, new Date().toISOString()) : 0;
  const remainingMonths = Math.max(0, 36 - ageDays / 30);
  const monthlyOrderRate = c.order_count / Math.max(1, ageDays / 30);
  const remainingOrders = remainingMonths * monthlyOrderRate;
  return Math.floor(aov * remainingOrders);
}

/** 30日以内の購入確率（指数減衰モデル） */
function calculate30dProbability(avgIntervalDays: number, daysSinceLast: number): number {
  if (avgIntervalDays <= 0) return 0;
  // 30日以内に「次の購入時期に到達する確率」
  const targetDay = avgIntervalDays;
  const daysUntilTarget = Math.max(0, targetDay - daysSinceLast);
  if (daysUntilTarget > 30) return 0.05;  // 余裕がある = 低確率
  // 残り日数が短いほど確率高
  return Math.max(0, Math.min(0.95, 1 - daysUntilTarget / 30));
}

/** 顧客ごとに最適な送信時刻を過去の opened_at ログから抽出 */
async function calculateBestSendHour(env: FermentEnv, customerId: string): Promise<number | null> {
  const r = await env.DB
    .prepare(
      `SELECT
         CAST(strftime('%H', opened_at) AS INTEGER) as hour,
         COUNT(*) as cnt
       FROM email_logs
       WHERE customer_id = ? AND opened_at IS NOT NULL
       GROUP BY hour
       ORDER BY cnt DESC
       LIMIT 1`,
    )
    .bind(customerId)
    .first<{ hour: number; cnt: number }>();
  return r?.hour ?? null;
}

/** メイン: 全顧客のインサイトを再計算 */
export async function recomputeAllCustomerInsights(env: FermentEnv): Promise<{
  total_processed: number;
  updated: number;
  errors: number;
}> {
  const BATCH = 200;
  let offset = 0;
  let updated = 0;
  let errors = 0;
  let totalProcessed = 0;

  while (true) {
    const batch = await env.DB
      .prepare(
        `SELECT customer_id, ltv, order_count, first_order_at, last_order_at, created_at
           FROM customers WHERE order_count >= 1 LIMIT ? OFFSET ?`,
      )
      .bind(BATCH, offset)
      .all<CustomerForCalc>();
    if (batch.results.length === 0) break;

    for (const c of batch.results) {
      totalProcessed++;
      try {
        const now = new Date().toISOString();

        // 平均購入間隔
        let avgInterval = 0;
        if (c.order_count && c.order_count > 1 && c.first_order_at && c.last_order_at) {
          const span = daysBetween(c.first_order_at, c.last_order_at);
          avgInterval = Math.max(1, Math.round(span / (c.order_count - 1)));
        }

        // 次回購入予測日
        let predictedNext: string | null = null;
        if (avgInterval > 0 && c.last_order_at) {
          const nextDate = new Date(new Date(c.last_order_at).getTime() + avgInterval * MS_PER_DAY);
          predictedNext = nextDate.toISOString();
        }

        // 30日以内購入確率
        const daysSinceLast = c.last_order_at ? daysBetween(c.last_order_at, now) : 9999;
        const prob = calculate30dProbability(avgInterval, daysSinceLast);

        // 予測 CLV
        const clv = calculateCLV(c);

        // 最適送信時刻
        const bestHour = await calculateBestSendHour(env, c.customer_id);

        await env.DB
          .prepare(
            `UPDATE customers SET
               avg_purchase_interval_days = ?,
               predicted_next_order_at = ?,
               purchase_probability_30d = ?,
               predicted_clv = ?,
               best_send_hour = ?
             WHERE customer_id = ?`,
          )
          .bind(avgInterval, predictedNext, prob, clv, bestHour, c.customer_id)
          .run();
        updated++;
      } catch (e) {
        console.error('insight calc error for', c.customer_id, e);
        errors++;
      }
    }

    offset += BATCH;
    if (batch.results.length < BATCH) break;
  }

  return { total_processed: totalProcessed, updated, errors };
}
