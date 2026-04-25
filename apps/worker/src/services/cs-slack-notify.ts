/**
 * CS Phase 1: Slack通知サービス
 *
 * - L3エスカレーション → 即時通知
 * - L2下書き滞留（30分超） → 滞留通知
 * - L1自動返信 → 静かに（必要なら投稿）
 *
 * 設計書: docs/CS_PHASE1_DESIGN.md
 */

const SLACK_API_BASE = 'https://slack.com/api';

export interface CsSlackEnv {
  SLACK_BOT_TOKEN?: string;
  SLACK_WEBHOOK_URL?: string;
  CS_SLACK_CHANNEL_ID?: string;
  WORKER_URL?: string;
  LIFF_URL?: string;
}

/** チャットへのリンク（Web UIに飛ばす） */
function chatUrl(env: CsSlackEnv, chatId: string): string {
  const base = env.LIFF_URL ?? env.WORKER_URL ?? 'https://app.example.com';
  return `${base.replace(/\/$/, '')}/chats?id=${chatId}`;
}

async function postToChannel(env: CsSlackEnv, blocks: unknown[], text: string): Promise<void> {
  const channel = env.CS_SLACK_CHANNEL_ID;
  if (env.SLACK_BOT_TOKEN && channel) {
    try {
      const res = await fetch(`${SLACK_API_BASE}/chat.postMessage`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.SLACK_BOT_TOKEN}`,
          'Content-Type': 'application/json; charset=utf-8',
        },
        body: JSON.stringify({ channel, text, blocks }),
      });
      const json = (await res.json()) as { ok: boolean; error?: string };
      if (!json.ok) console.error('[cs-slack] chat.postMessage failed:', json.error);
    } catch (e) {
      console.error('[cs-slack] postToChannel exception:', e);
    }
    return;
  }
  if (env.SLACK_WEBHOOK_URL) {
    try {
      await fetch(env.SLACK_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, blocks }),
      });
    } catch (e) {
      console.error('[cs-slack] webhook failed:', e);
    }
  }
}

/** L3エスカレーション通知 */
export async function notifyL3Escalation(
  env: CsSlackEnv,
  input: {
    chat_id: string;
    customer_name?: string | null;
    customer_email?: string | null;
    channel: string;
    category: string;
    confidence: number;
    money_flag: boolean;
    snippet: string;
  },
): Promise<void> {
  const customer = input.customer_name ?? input.customer_email ?? '不明';
  const moneyTag = input.money_flag ? ' 💰金銭関連' : '';
  const text = `🚨 CS L3エスカレーション: ${customer}（${input.channel}）`;
  const blocks = [
    { type: 'header', text: { type: 'plain_text', text: '🚨 CSエスカレーション' } },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*顧客*\n${customer}` },
        { type: 'mrkdwn', text: `*チャネル*\n${input.channel}` },
        { type: 'mrkdwn', text: `*カテゴリ*\n${input.category}${moneyTag}` },
        { type: 'mrkdwn', text: `*信頼度*\n${(input.confidence * 100).toFixed(0)}%` },
      ],
    },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `*問い合わせ内容*\n>>>${input.snippet.slice(0, 600)}` },
    },
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: 'harness で開く' },
          url: chatUrl(env, input.chat_id),
          style: 'primary',
        },
      ],
    },
  ];
  await postToChannel(env, blocks, text);
}

/** L2下書き作成通知 */
export async function notifyL2DraftReady(
  env: CsSlackEnv,
  input: {
    chat_id: string;
    customer_name?: string | null;
    channel: string;
    category: string;
    money_flag: boolean;
  },
): Promise<void> {
  const customer = input.customer_name ?? '不明';
  const moneyTag = input.money_flag ? ' 💰' : '';
  const text = `📝 CS L2下書き承認待ち: ${customer}（${input.channel}）${moneyTag}`;
  const blocks = [
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `📝 *AI下書き承認待ち*${moneyTag}\n*顧客*: ${customer}\n*カテゴリ*: ${input.category}` },
    },
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: '下書きを確認' },
          url: chatUrl(env, input.chat_id),
        },
      ],
    },
  ];
  await postToChannel(env, blocks, text);
}

/** 滞留通知（cronから呼ぶ） */
export async function notifyDraftBacklog(env: CsSlackEnv, count: number, oldestMinutes: number): Promise<void> {
  if (count === 0) return;
  const text = `⏰ CS下書き承認待ち滞留: ${count}件（最古${oldestMinutes}分前）`;
  await postToChannel(env, [{ type: 'section', text: { type: 'mrkdwn', text } }], text);
}
