/**
 * FERMENT: Slack 通知クライアント
 *
 * 呼び出し元:
 *   - apps/worker/src/ferment/send-engine.ts
 *   - apps/worker/src/ferment/cron-daily-summary.ts
 */

interface SlackNotifyParams {
  webhookUrl: string;
  channel: string;
  title: string;
  fields: Array<{ label: string; value: string }>;
  color?: 'good' | 'warning' | 'danger';
}

/**
 * Slack Incoming Webhook でメッセージを送信する
 */
export async function notifySlack(params: SlackNotifyParams): Promise<void> {
  const { webhookUrl, title, fields, color = 'good' } = params;

  const colorMap = { good: '#36a64f', warning: '#ffa500', danger: '#ff0000' };
  const hexColor = colorMap[color];

  const body = {
    attachments: [
      {
        color: hexColor,
        title,
        fields: fields.map((f) => ({
          title: f.label,
          value: f.value,
          short: true,
        })),
        footer: 'FERMENT',
        ts: Math.floor(Date.now() / 1000),
      },
    ],
  };

  try {
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (err) {
    console.error('[FERMENT] Slack 通知エラー:', err);
  }
}
