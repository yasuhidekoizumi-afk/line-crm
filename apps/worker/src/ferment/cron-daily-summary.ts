/**
 * FERMENT: 日次サマリー Slack 通知 cron
 *
 * 毎日 9:00 JST (UTC 0:00) に実行 (wrangler.toml: "0 0 * * *")
 * 前日の配信データを集計して #marketing チャンネルに投稿する。
 *
 * 呼び出し元:
 *   - apps/worker/src/index.ts (scheduled handler)
 */

import { notifySlack } from './slack-notifier.js';

interface FermentEnv {
  DB: D1Database;
  SLACK_WEBHOOK_URL?: string;
}

/**
 * 前日の配信サマリーを集計して Slack に投稿する
 */
export async function sendDailySummary(env: FermentEnv): Promise<void> {
  if (!env.SLACK_WEBHOOK_URL) return;

  // 前日の範囲（JST ベース）
  const now = new Date();
  const todayJst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  todayJst.setUTCHours(0, 0, 0, 0);
  const yesterdayEnd = new Date(todayJst.getTime() - 1).toISOString();
  const yesterdayStart = new Date(todayJst.getTime() - 24 * 60 * 60 * 1000).toISOString();

  try {
    const stats = await env.DB
      .prepare(
        `SELECT
           COUNT(*) as total_sent,
           SUM(CASE WHEN opened_at IS NOT NULL THEN 1 ELSE 0 END) as opened,
           SUM(CASE WHEN first_clicked_at IS NOT NULL THEN 1 ELSE 0 END) as clicked,
           SUM(CASE WHEN status = 'bounced' THEN 1 ELSE 0 END) as bounced,
           SUM(CASE WHEN unsubscribed_at IS NOT NULL THEN 1 ELSE 0 END) as unsubscribed,
           SUM(revenue) as revenue
         FROM email_logs
         WHERE queued_at BETWEEN ? AND ?`,
      )
      .bind(yesterdayStart, yesterdayEnd)
      .first<{
        total_sent: number;
        opened: number;
        clicked: number;
        bounced: number;
        unsubscribed: number;
        revenue: number;
      }>();

    if (!stats || stats.total_sent === 0) return;

    const openRate =
      stats.total_sent > 0 ? ((stats.opened / stats.total_sent) * 100).toFixed(1) : '0.0';
    const clickRate =
      stats.total_sent > 0 ? ((stats.clicked / stats.total_sent) * 100).toFixed(1) : '0.0';
    const bounceRate =
      stats.total_sent > 0 ? ((stats.bounced / stats.total_sent) * 100).toFixed(1) : '0.0';

    const dateLabel = yesterdayStart.slice(0, 10);

    await notifySlack({
      webhookUrl: env.SLACK_WEBHOOK_URL,
      channel: '#marketing',
      title: `📊 FERMENT 日次レポート (${dateLabel})`,
      fields: [
        { label: '配信数', value: String(stats.total_sent) },
        { label: '開封率', value: `${openRate}% (${stats.opened})` },
        { label: 'クリック率', value: `${clickRate}% (${stats.clicked})` },
        { label: 'バウンス率', value: `${bounceRate}% (${stats.bounced})` },
        { label: '解除数', value: String(stats.unsubscribed) },
        {
          label: '配信経由売上',
          value: stats.revenue > 0 ? `¥${stats.revenue.toLocaleString()}` : '¥0',
        },
      ],
      color: 'good',
    });
  } catch (err) {
    console.error('[FERMENT] 日次サマリー送信エラー:', err);
  }
}
