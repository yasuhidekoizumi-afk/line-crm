/**
 * FERMENT Phase 4 cron 集約
 *
 * - A/B テスト勝者選定（送信から1時間後）
 * - カゴ落ちリマインダー（abandoned 1時間 / 24時間後）
 * - 商品レコメンド affinity 計算（日次）
 * - 週次メールカウントリセット
 * - スケジュール送信実行（best_send_hour 用）
 */

import { generateFermentId } from '@line-crm/db';
import type { FermentEnv } from './types.js';

// ─── A/B テスト勝者選定 ───────────────────────────

export async function selectABWinners(env: FermentEnv): Promise<{ selected: number }> {
  // 配信開始から1時間以上経過した A/B キャンペーンを取得
  const candidates = await env.DB
    .prepare(
      `SELECT DISTINCT c.campaign_id FROM email_campaigns c
       INNER JOIN email_campaign_variants v ON v.campaign_id = c.campaign_id
       WHERE c.status = 'sending'
         AND c.sent_at IS NOT NULL
         AND c.sent_at < datetime('now', '-1 hour')
         AND NOT EXISTS (SELECT 1 FROM email_campaign_variants WHERE campaign_id = c.campaign_id AND is_winner = 1)`,
    )
    .all<{ campaign_id: string }>();

  let selected = 0;
  for (const { campaign_id } of candidates.results) {
    const variants = await env.DB
      .prepare(
        `SELECT variant_id, total_sent, total_opened, total_clicked
         FROM email_campaign_variants WHERE campaign_id = ?`,
      )
      .bind(campaign_id)
      .all<{ variant_id: string; total_sent: number; total_opened: number; total_clicked: number }>();

    if (variants.results.length < 2) continue;
    // 勝者 = open rate 最高
    let best = variants.results[0];
    let bestRate = best.total_sent > 0 ? best.total_opened / best.total_sent : 0;
    for (const v of variants.results) {
      const rate = v.total_sent > 0 ? v.total_opened / v.total_sent : 0;
      if (rate > bestRate) { best = v; bestRate = rate; }
    }
    await env.DB
      .prepare('UPDATE email_campaign_variants SET is_winner = 1 WHERE variant_id = ?')
      .bind(best.variant_id)
      .run();
    selected++;
  }
  return { selected };
}

// ─── カゴ落ちリマインダー ─────────────────────────

export async function processCartReminders(env: FermentEnv): Promise<{ sent: number }> {
  // 1時間以上前にカート放棄、未復帰、未送信 or 24時間以上経過で未送信2回目
  const carts = await env.DB
    .prepare(
      `SELECT cart_id, customer_id, email, cart_data, reminder_sent_count
         FROM customer_cart_states
         WHERE recovered_at IS NULL
           AND email IS NOT NULL
           AND ((reminder_sent_count = 0 AND abandoned_at < datetime('now', '-1 hour'))
             OR (reminder_sent_count = 1 AND last_reminder_at < datetime('now', '-23 hour')
                 AND abandoned_at < datetime('now', '-24 hour')))
         LIMIT 100`,
    )
    .all<{ cart_id: string; customer_id: string | null; email: string; cart_data: string; reminder_sent_count: number }>();

  let sent = 0;
  for (const c of carts.results) {
    // 簡易：本配信は send-engine が必要だが、最小実装として scheduled_email_sends に投入
    await env.DB
      .prepare(
        `INSERT INTO scheduled_email_sends
         (scheduled_id, campaign_id, customer_id, template_id, variant_id, scheduled_at, status)
         VALUES (?, NULL, ?, NULL, NULL, strftime('%Y-%m-%dT%H:%M:%f','now','+9 hours'), 'pending_cart_reminder')`,
      )
      .bind(generateFermentId('sched'), c.customer_id ?? generateFermentId('cu'))
      .run();
    await env.DB
      .prepare(
        `UPDATE customer_cart_states
         SET reminder_sent_count = reminder_sent_count + 1,
             last_reminder_at = strftime('%Y-%m-%dT%H:%M:%f','now','+9 hours')
         WHERE cart_id = ?`,
      )
      .bind(c.cart_id)
      .run();
    sent++;
  }
  return { sent };
}

// ─── 商品レコメンド affinity 計算 ─────────────────

export async function recomputeProductAffinity(env: FermentEnv): Promise<{ customers_processed: number }> {
  // 簡易：customers.tags ベースで人気商品を顧客にスコアリング
  // 実際の協調フィルタリングは Shopify orders API が必要なので、初期はタグマッチング
  const popular = await env.DB
    .prepare(`SELECT shopify_product_id, title, url, image, category FROM popular_products LIMIT 30`)
    .all<{ shopify_product_id: string; title: string; url: string; image: string | null; category: string | null }>();

  if (popular.results.length === 0) return { customers_processed: 0 };

  const customers = await env.DB
    .prepare(`SELECT customer_id, tags, ltv FROM customers WHERE order_count >= 1 LIMIT 500`)
    .all<{ customer_id: string; tags: string | null; ltv: number | null }>();

  let processed = 0;
  for (const c of customers.results) {
    const cTags = (c.tags ?? '').split(',').map((t) => t.trim().toLowerCase());
    for (const p of popular.results) {
      // タグカテゴリマッチで軽い affinity スコア
      const cat = (p.category ?? '').toLowerCase();
      let score = Math.random() * 0.3 + 0.5; // ベース
      if (cat && cTags.some((t) => t.includes(cat))) score += 0.2;
      if ((c.ltv ?? 0) >= 5000) score += 0.1;

      await env.DB
        .prepare(
          `INSERT INTO customer_product_affinity
           (customer_id, shopify_product_id, product_title, product_url, product_image, affinity_score, computed_at)
           VALUES (?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%f','now','+9 hours'))
           ON CONFLICT(customer_id, shopify_product_id) DO UPDATE SET
             affinity_score = excluded.affinity_score,
             computed_at = excluded.computed_at`,
        )
        .bind(c.customer_id, p.shopify_product_id, p.title, p.url, p.image, score)
        .run();
    }
    processed++;
  }
  return { customers_processed: processed };
}

// ─── 週次メールカウントリセット ──────────────────

export async function resetWeeklyEmailCounts(env: FermentEnv): Promise<{ reset: number }> {
  const r = await env.DB
    .prepare(
      `UPDATE customers SET weekly_email_count = 0,
         weekly_count_reset_at = strftime('%Y-%m-%dT%H:%M:%f','now','+9 hours')
       WHERE weekly_count_reset_at IS NULL OR weekly_count_reset_at < datetime('now', '-7 days')`,
    )
    .run();
  return { reset: r.meta?.changes ?? 0 };
}

// ─── スケジュール送信処理（best_send_hour 用） ──

export async function processScheduledSends(env: FermentEnv): Promise<{ processed: number }> {
  const due = await env.DB
    .prepare(
      `SELECT scheduled_id FROM scheduled_email_sends
       WHERE status = 'pending' AND scheduled_at <= strftime('%Y-%m-%dT%H:%M:%f','now','+9 hours')
       LIMIT 100`,
    )
    .all<{ scheduled_id: string }>();
  let processed = 0;
  for (const s of due.results) {
    await env.DB
      .prepare("UPDATE scheduled_email_sends SET status='sent', sent_at=strftime('%Y-%m-%dT%H:%M:%f','now','+9 hours') WHERE scheduled_id=?")
      .bind(s.scheduled_id)
      .run();
    processed++;
  }
  return { processed };
}
