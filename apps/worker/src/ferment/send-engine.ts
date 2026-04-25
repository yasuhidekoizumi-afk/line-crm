/**
 * FERMENT: メール配信実行エンジン
 *
 * キャンペーン・フローのメール配信を実行するコアロジック。
 * Resend API を呼び出し、結果を email_logs に記録する。
 *
 * 呼び出し元:
 *   - apps/worker/src/ferment/routes/campaigns.ts (即時配信・スケジュール)
 *   - apps/worker/src/ferment/cron-campaigns.ts (定期チェック)
 *   - apps/worker/src/ferment/cron-flows.ts (フロー配信)
 *
 * 依存:
 *   - packages/email-sdk (Resend クライアント)
 *   - apps/worker/src/ferment/personalize.ts
 *   - @line-crm/db
 */

import { sendEmail } from '@line-crm/email-sdk';
import {
  getEmailCampaignById,
  getEmailTemplateById,
  getSegmentMembersWithEmail,
  isSuppressed,
  createEmailLog,
  updateEmailLog,
  updateEmailCampaign,
  generateFermentId,
  type Customer,
  type EmailTemplate,
} from '@line-crm/db';
import { personalizeEmail } from './personalize.js';
import { notifySlack } from './slack-notifier.js';

/** Worker の Env 型（index.ts で定義される完全な型を参照） */
interface FermentEnv {
  DB: D1Database;
  RESEND_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
  GEMINI_API_KEY?: string;
  SLACK_WEBHOOK_URL?: string;
  FERMENT_FROM_EMAIL_JP?: string;
  FERMENT_FROM_EMAIL_US?: string;
  FERMENT_FROM_NAME_JP?: string;
  FERMENT_FROM_NAME_US?: string;
  FERMENT_UNSUBSCRIBE_BASE_URL?: string;
  FERMENT_HMAC_SECRET?: string;
  WORKER_URL?: string;
}

/** メール1通を送信してログに記録する */
async function sendOneEmail(
  customer: Customer,
  template: EmailTemplate,
  campaignId: string | null,
  flowId: string | null,
  stepId: string | null,
  env: FermentEnv,
): Promise<{ ok: boolean; logId: string }> {
  const logId = generateFermentId('log');

  // パーソナライズ
  const content = await personalizeEmail(template, customer, {
    ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY,
    GEMINI_API_KEY: env.GEMINI_API_KEY,
    FERMENT_UNSUBSCRIBE_BASE_URL: env.FERMENT_UNSUBSCRIBE_BASE_URL,
    FERMENT_HMAC_SECRET: env.FERMENT_HMAC_SECRET,
  });

  // 送信元情報（リージョン別）
  const fromName =
    customer.region === 'US'
      ? (env.FERMENT_FROM_NAME_US ?? 'ORYZAE')
      : (env.FERMENT_FROM_NAME_JP ?? 'オリゼ');
  const fromEmail =
    customer.region === 'US'
      ? (env.FERMENT_FROM_EMAIL_US ?? 'noreply@mail.oryzae.com')
      : (env.FERMENT_FROM_EMAIL_JP ?? 'noreply@mail.oryzae.jp');
  const from = template.from_email
    ? `${template.from_name} <${template.from_email}>`
    : `${fromName} <${fromEmail}>`;

  // List-Unsubscribe ヘッダー設定（CAN-SPAM / RFC 8058 対応）
  const unsubscribeUrl = content.html.match(/href="([^"]*unsubscribe[^"]*)"/)?.at(1);
  const headers: Record<string, string> = {};
  if (unsubscribeUrl) {
    headers['List-Unsubscribe'] = `<${unsubscribeUrl}>`;
    headers['List-Unsubscribe-Post'] = 'List-Unsubscribe=One-Click';
  }

  // ログを queued で作成
  await createEmailLog(env.DB, {
    log_id: logId,
    customer_id: customer.customer_id,
    campaign_id: campaignId,
    flow_id: flowId,
    step_id: stepId,
    template_id: template.template_id,
    to_email: customer.email!,
    subject: content.subject,
    body_html: content.html,
    variant: content.variant ?? null,
    resend_id: null,
    status: 'queued',
    sent_at: null,
    delivered_at: null,
    opened_at: null,
    first_clicked_at: null,
    bounced_at: null,
    unsubscribed_at: null,
    converted_at: null,
    revenue: 0,
    error_message: null,
  });

  // Resend API で送信
  const result = await sendEmail(env.RESEND_API_KEY ?? '', {
    from,
    to: customer.email!,
    subject: content.subject,
    html: content.html,
    text: content.text || undefined,
    replyTo: template.reply_to ?? undefined,
    headers,
    tags: [
      { name: 'campaign_id', value: campaignId ?? 'flow' },
      { name: 'template_id', value: template.template_id },
    ],
  });

  if (result.ok && result.resendId) {
    await updateEmailLog(env.DB, logId, {
      status: 'sent',
      resend_id: result.resendId,
      sent_at: new Date().toISOString(),
    });
  } else {
    await updateEmailLog(env.DB, logId, {
      status: 'failed',
      error_message: result.error ?? 'Unknown error',
    });
  }

  return { ok: result.ok, logId };
}

// ============================================================
// キャンペーン配信
// ============================================================

/**
 * キャンペーンのメールを一斉配信する
 *
 * 設計:
 * - 対象顧客を 500件ずつバッチ処理
 * - Resend のレート制限（2 req/s）に合わせて間隔調整
 * - Workers の CPU 制限を考慮し、1バッチ = 最大 100通 に制限
 *   （大規模配信は Cron で継続呼び出し）
 *
 * @param campaignId キャンペーン ID
 * @param env Worker 環境変数
 * @param batchOffset 再開時のオフセット
 */
export async function executeCampaign(
  campaignId: string,
  env: FermentEnv,
  batchOffset = 0,
): Promise<{ sent: number; failed: number; done: boolean }> {
  const campaign = await getEmailCampaignById(env.DB, campaignId);
  if (!campaign) throw new Error(`Campaign not found: ${campaignId}`);
  if (!campaign.template_id) throw new Error(`Campaign has no template: ${campaignId}`);

  const template = await getEmailTemplateById(env.DB, campaign.template_id);
  if (!template) throw new Error(`Template not found: ${campaign.template_id}`);

  // 送信中ステータスに更新
  if (campaign.status === 'scheduled' || campaign.status === 'draft') {
    await updateEmailCampaign(env.DB, campaignId, { status: 'sending' });
  }

  const BATCH_SIZE = 100; // 1回のバッチで処理する上限
  const customers = campaign.segment_id
    ? await getSegmentMembersWithEmail(env.DB, campaign.segment_id, BATCH_SIZE, batchOffset)
    : [];

  let sent = 0;
  let failed = 0;

  for (const customer of customers) {
    if (!customer.email) continue;

    // 配信停止リストチェック
    const suppressed = await isSuppressed(env.DB, customer.email);
    if (suppressed) continue;

    const { ok } = await sendOneEmail(customer, template, campaignId, null, null, env);
    if (ok) sent++;
    else failed++;

    // Resend レート制限対応: 500ms 待機（2 req/s）
    // Workers では setTimeout が使えないため fetch で代替
    await new Promise<void>((resolve) => setTimeout(resolve, 500));
  }

  const isLastBatch = customers.length < BATCH_SIZE;

  if (isLastBatch) {
    // 全送信完了
    const now = new Date().toISOString();
    await updateEmailCampaign(env.DB, campaignId, {
      status: 'sent',
      sent_at: now,
      total_sent: campaign.total_sent + sent,
    });

    // Slack 通知
    if (env.SLACK_WEBHOOK_URL) {
      await notifySlack({
        webhookUrl: env.SLACK_WEBHOOK_URL,
        channel: '#marketing',
        title: `📧 キャンペーン配信完了: ${campaign.name}`,
        fields: [
          { label: '送信数', value: String(campaign.total_sent + sent) },
          { label: '失敗数', value: String(failed) },
          { label: '完了時刻', value: now },
        ],
        color: failed > 0 ? 'warning' : 'good',
      });
    }
  }

  return { sent, failed, done: isLastBatch };
}

// ============================================================
// フロー配信（単一ステップ）
// ============================================================

/**
 * フローの1ステップを特定顧客に配信する
 *
 * 呼び出し元: cron-flows.ts の enrollment 処理
 */
export async function executeFlowStep(
  customer: Customer,
  templateId: string,
  flowId: string,
  stepId: string,
  env: FermentEnv,
): Promise<{ ok: boolean }> {
  if (!customer.email) return { ok: false };

  const suppressed = await isSuppressed(env.DB, customer.email);
  if (suppressed) return { ok: false };

  const template = await getEmailTemplateById(env.DB, templateId);
  if (!template) return { ok: false };

  const { ok } = await sendOneEmail(customer, template, null, flowId, stepId, env);
  return { ok };
}
