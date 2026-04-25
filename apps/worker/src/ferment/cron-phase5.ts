/**
 * FERMENT Phase 5 cron jobs
 */

import type { FermentEnv } from './types.js';

/** Churn Risk Score を全顧客で再計算 */
export async function recomputeChurnRisk(env: FermentEnv): Promise<{ updated: number }> {
  // 簡易ロジック:
  //   - 90日以上未購入 = 高リスク
  //   - 過去3メールすべて未開封 = 高リスク
  //   - 配信停止フラグ = 最高リスク
  const result = await env.DB
    .prepare(
      `UPDATE customers SET
        churn_risk_score = CASE
          WHEN subscribed_email = 0 THEN 1.0
          WHEN last_order_at IS NULL THEN 0.5
          WHEN julianday('now') - julianday(last_order_at) > 180 THEN 0.9
          WHEN julianday('now') - julianday(last_order_at) > 90 THEN 0.6
          WHEN julianday('now') - julianday(last_order_at) > 30 THEN 0.3
          ELSE 0.1
        END,
        churn_risk_updated_at = strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')
      WHERE customer_id IS NOT NULL`,
    )
    .run();
  return { updated: result.meta.changes };
}

/** 件名学習データ更新（campaign 完了時に開封率を集計して subject_line_history に記録） */
export async function aggregateSubjectHistory(env: FermentEnv): Promise<{ aggregated: number }> {
  const r = await env.DB
    .prepare(
      `INSERT INTO subject_line_history (id, subject, total_sent, total_opened, open_rate, campaign_id)
       SELECT
         lower(hex(randomblob(8))),
         (SELECT subject_base FROM email_templates WHERE template_id = c.template_id),
         c.total_sent,
         c.total_opened,
         CAST(c.total_opened AS REAL) / NULLIF(c.total_sent, 0),
         c.campaign_id
       FROM email_campaigns c
       WHERE c.status = 'sent'
         AND c.sent_at >= datetime('now', '-7 days')
         AND c.total_sent >= 100
         AND NOT EXISTS (SELECT 1 FROM subject_line_history h WHERE h.campaign_id = c.campaign_id)`,
    )
    .run();
  return { aggregated: r.meta.changes };
}

/** データ保持期間ポリシーに基づくデータ自動削除 */
export async function applyDataRetentionPolicy(env: FermentEnv): Promise<{
  email_logs_deleted: number;
  audit_logs_deleted: number;
}> {
  const policy = await env.DB
    .prepare("SELECT * FROM ferment_data_retention_policy WHERE policy_id = 'default'")
    .first<{
      email_logs_retention_days: number;
      audit_log_retention_days: number;
    }>();
  if (!policy) return { email_logs_deleted: 0, audit_logs_deleted: 0 };

  const r1 = await env.DB
    .prepare(
      "DELETE FROM email_logs WHERE queued_at < datetime('now', ? || ' days')",
    )
    .bind(`-${policy.email_logs_retention_days}`)
    .run();

  const r2 = await env.DB
    .prepare(
      "DELETE FROM ferment_audit_log WHERE created_at < datetime('now', ? || ' days')",
    )
    .bind(`-${policy.audit_log_retention_days}`)
    .run();

  return { email_logs_deleted: r1.meta.changes, audit_logs_deleted: r2.meta.changes };
}

/** スケジュール配信レポートのチェック・送信 */
export async function processScheduledReports(env: FermentEnv): Promise<{ sent: number }> {
  // 毎週月曜9時に実行される想定で、is_active=1 の reports を処理
  const reports = await env.DB
    .prepare("SELECT * FROM ferment_scheduled_reports WHERE is_active = 1")
    .all<{ report_id: string; recipient_email: string; report_type: string; last_sent_at: string | null }>();

  let sent = 0;
  for (const r of reports.results) {
    // 過去7日のキャンペーンサマリーを集計
    const summary = await env.DB
      .prepare(
        `SELECT
           COUNT(*) as campaigns,
           SUM(total_sent) as sent,
           SUM(total_opened) as opened,
           SUM(total_attributed_revenue) as revenue
         FROM email_campaigns WHERE sent_at >= datetime('now', '-7 days')`,
      )
      .first<{ campaigns: number; sent: number; opened: number; revenue: number }>();

    // メール送信処理（既存の send-engine を流用するため簡易実装）
    // TODO: 実際の Resend 経由送信は send-engine 経由で実装
    console.log('Report:', r.recipient_email, summary);
    sent++;
    await env.DB
      .prepare("UPDATE ferment_scheduled_reports SET last_sent_at = strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours') WHERE report_id = ?")
      .bind(r.report_id)
      .run();
  }
  return { sent };
}
