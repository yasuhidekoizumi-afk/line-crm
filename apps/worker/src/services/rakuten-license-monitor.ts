/**
 * 楽天 RMS licenseKey 多層期限監視
 *
 * Layer 1: カレンダーアラート（cron 1日1回） - このファイル
 * Layer 2: 401検知（API失敗時） - rakuten-sdk + ingest 側
 * Layer 3: UI（/cs/settings） - apps/web
 * Layer 4: 疎通確認（counts.get） - 新キー登録時
 *
 * 設計書: docs/CS_RAKUTEN_RMS_DESIGN.md
 */
import {
  getRakutenCredential,
  updateRakutenNotificationLog,
  type RakutenCredentialRow,
} from '@line-crm/db';

const SLACK_API_BASE = 'https://slack.com/api';

/** アラートマイルストーン: 残日数 → メッセージプレフィックス */
const MILESTONES: Array<{ days: number; emoji: string; level: string }> = [
  { days: 30, emoji: '📅', level: 'info' },
  { days: 14, emoji: '⚠️', level: 'warning' },
  { days: 7, emoji: '🟠', level: 'urgent' },
  { days: 1, emoji: '🔴', level: 'critical' },
  { days: 0, emoji: '🚨', level: 'expired' },
];

export interface LicenseMonitorEnv {
  DB: D1Database;
  SLACK_BOT_TOKEN?: string;
  SLACK_WEBHOOK_URL?: string;
  CS_SLACK_CHANNEL_ID?: string;
  WORKER_URL?: string;
  LIFF_URL?: string;
}

function settingsUrl(env: LicenseMonitorEnv): string {
  const base = env.LIFF_URL ?? env.WORKER_URL ?? 'https://app.example.com';
  return `${base.replace(/\/$/, '')}/cs/settings`;
}

async function postSlackAlert(
  env: LicenseMonitorEnv,
  text: string,
  blocks: unknown[],
): Promise<void> {
  if (env.SLACK_BOT_TOKEN && env.CS_SLACK_CHANNEL_ID) {
    try {
      const res = await fetch(`${SLACK_API_BASE}/chat.postMessage`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.SLACK_BOT_TOKEN}`,
          'Content-Type': 'application/json; charset=utf-8',
        },
        body: JSON.stringify({ channel: env.CS_SLACK_CHANNEL_ID, text, blocks }),
      });
      const json = (await res.json()) as { ok: boolean; error?: string };
      if (!json.ok) console.error('[rakuten-license] slack postMessage failed:', json.error);
    } catch (e) {
      console.error('[rakuten-license] slack post exception:', e);
    }
    return;
  }
  if (env.SLACK_WEBHOOK_URL) {
    await fetch(env.SLACK_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, blocks }),
    }).catch(() => {});
  }
}

/**
 * 楽天 licenseKey の残日数を確認し、マイルストーン到達時に Slack 通知。
 * 既に通知済みのマイルストーンは notification_log で記録され重複しない。
 */
export async function checkRakutenLicenseExpiry(env: LicenseMonitorEnv): Promise<{ checked: boolean; alerted: number }> {
  const cred = await getRakutenCredential(env.DB);
  if (!cred) return { checked: false, alerted: 0 };

  const now = Date.now();
  const expiresMs = new Date(cred.expires_at).getTime();
  const daysLeft = Math.ceil((expiresMs - now) / 86_400_000);

  let log: Record<string, string> = {};
  try {
    log = cred.notification_log ? (JSON.parse(cred.notification_log) as Record<string, string>) : {};
  } catch {
    log = {};
  }

  let alerted = 0;
  let logChanged = false;
  for (const m of MILESTONES) {
    const key = `${m.days}d`;
    if (daysLeft <= m.days && !log[key]) {
      await sendMilestoneAlert(env, m, daysLeft, cred);
      log[key] = new Date().toISOString();
      logChanged = true;
      alerted++;
    }
  }

  if (logChanged) {
    await updateRakutenNotificationLog(env.DB, log);
  }

  return { checked: true, alerted };
}

async function sendMilestoneAlert(
  env: LicenseMonitorEnv,
  m: { days: number; emoji: string; level: string },
  actualDaysLeft: number,
  cred: RakutenCredentialRow,
): Promise<void> {
  const url = settingsUrl(env);

  let titleText: string;
  let body: string;

  if (m.days === 30) {
    titleText = `${m.emoji} 楽天 licenseKey 更新予告（30日前）`;
    body = `楽天 RMS の licenseKey は *${actualDaysLeft}日後* に失効します（${cred.expires_at.slice(0, 10)}）。\n余裕を持って RMS 管理画面で再発行してください。`;
  } else if (m.days === 14) {
    titleText = `${m.emoji} 楽天 licenseKey 更新リマインド（2週間前）`;
    body = `*${actualDaysLeft}日後* に楽天連携が止まります。\n手順: RMS 管理画面 → 6. WEB API サービス → ライセンスキー再発行 → harness 設定で新キー登録`;
  } else if (m.days === 7) {
    titleText = `${m.emoji} 楽天 licenseKey 更新緊急（1週間前）`;
    body = `あと *${actualDaysLeft}日* で楽天連携が停止します。今すぐ RMS で再発行してください。`;
  } else if (m.days === 1) {
    titleText = `${m.emoji} 楽天 licenseKey 更新クリティカル（明日失効）`;
    body = `明日 ${cred.expires_at.slice(0, 10)} に楽天連携が停止します。今すぐ更新作業を実施してください。`;
  } else {
    titleText = `${m.emoji} 楽天 licenseKey が失効しました`;
    body = `楽天 RMS の licenseKey が失効しました。新しい license key を発行・登録するまで楽天連携は停止します。`;
  }

  const blocks = [
    { type: 'header', text: { type: 'plain_text', text: titleText } },
    { type: 'section', text: { type: 'mrkdwn', text: body } },
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: 'CS 設定を開く' },
          url,
          style: m.days <= 1 ? 'danger' : 'primary',
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: 'RMS 管理画面' },
          url: 'https://mms.rakuten.co.jp/',
        },
      ],
    },
  ];

  await postSlackAlert(env, titleText, blocks);
}

/** licenseKey 失効を即時 Slack 通知（API 401 時） */
export async function notifyRakutenLicenseExpiredNow(
  env: LicenseMonitorEnv,
  errorMsg: string,
): Promise<void> {
  const url = settingsUrl(env);
  const blocks = [
    { type: 'header', text: { type: 'plain_text', text: '🚨 楽天連携が停止しました' } },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*licenseKey が失効・無効になりました*\n楽天 API 呼び出しが 401 で失敗しました。新しい license key を RMS 管理画面で発行し、harness の CS 設定画面で登録してください。\n\n*エラー詳細*: \`${errorMsg.slice(0, 200)}\``,
      },
    },
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: 'CS 設定を開く' },
          url,
          style: 'danger',
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: 'RMS 管理画面' },
          url: 'https://mms.rakuten.co.jp/',
        },
      ],
    },
  ];
  await postSlackAlert(env, '🚨 楽天 licenseKey 失効を検知', blocks);
}
