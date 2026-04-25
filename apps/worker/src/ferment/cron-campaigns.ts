/**
 * FERMENT: スケジュール済みキャンペーンの自動配信 cron
 *
 * 10分毎に実行 (wrangler.toml の cron: every 10 minutes)
 * scheduled_at <= now かつ status = 'scheduled' のキャンペーンを配信開始する。
 *
 * 呼び出し元:
 *   - apps/worker/src/index.ts (scheduled handler)
 */

import { getScheduledCampaignsDue, updateEmailCampaign, getSegmentMembersWithEmail } from '@line-crm/db';
import { executeCampaign } from './send-engine.js';
import { notifySlack } from './slack-notifier.js';

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
}

/**
 * 送信時刻を過ぎたスケジュール済みキャンペーンを処理する
 */
export async function processScheduledEmailCampaigns(env: FermentEnv): Promise<void> {
  const dueCampaigns = await getScheduledCampaignsDue(env.DB);

  for (const campaign of dueCampaigns) {
    console.log(`[FERMENT] キャンペーン配信開始: ${campaign.campaign_id} (${campaign.name})`);

    try {
      // 対象顧客数を取得して total_targets を更新
      if (campaign.segment_id) {
        const sample = await getSegmentMembersWithEmail(env.DB, campaign.segment_id, 1, 0);
        const allMembers = await getSegmentMembersWithEmail(env.DB, campaign.segment_id, 10000, 0);
        await updateEmailCampaign(env.DB, campaign.campaign_id, {
          total_targets: allMembers.length,
        });
      }

      await executeCampaign(campaign.campaign_id, env);
    } catch (err) {
      console.error(`[FERMENT] キャンペーン配信エラー: ${campaign.campaign_id}`, err);
      await updateEmailCampaign(env.DB, campaign.campaign_id, { status: 'failed' });

      if (env.SLACK_WEBHOOK_URL) {
        await notifySlack({
          webhookUrl: env.SLACK_WEBHOOK_URL,
          channel: '#marketing-alerts',
          title: `🚨 キャンペーン配信失敗: ${campaign.name}`,
          fields: [
            { label: 'Campaign ID', value: campaign.campaign_id },
            { label: 'エラー', value: String(err) },
          ],
          color: 'danger',
        });
      }
    }
  }
}
