/**
 * CSメール返信の送信。
 *
 * 既存の CS 自動返信（routes/cs.ts の sendReply）と同じ経路（Gmail API + ドメイン委任）を使い、
 * チャット画面から手動で返信できるようにするための共通処理。
 *
 * 送信元は実ユーザー（CS_GMAIL_SENDER_EMAIL）、Reply-To に窓口エイリアスを設定する。
 */
import { GmailClient, buildRfc822, type ServiceAccountKey } from '@line-crm/email-sdk';
import { insertCsMessage } from '@line-crm/db';

export type CsEmailChannel = 'email_support' | 'email_customer_support' | 'email';

interface CsEmailEnv {
  GCP_SERVICE_ACCOUNT_JSON?: string;
  CS_GMAIL_SENDER_EMAIL?: string;
}

function getServiceAccount(env: CsEmailEnv): ServiceAccountKey | null {
  const json = env.GCP_SERVICE_ACCOUNT_JSON;
  if (!json) return null;
  try {
    return JSON.parse(json) as ServiceAccountKey;
  } catch (error) {
    console.error('[cs-email] GCP_SERVICE_ACCOUNT_JSON parse failed', error);
    return null;
  }
}

function getSenderEmail(env: CsEmailEnv): string {
  return env.CS_GMAIL_SENDER_EMAIL || 'yasuhide.koizumi@oryzae.site';
}

function getVisibleAlias(channel: string): string {
  return channel === 'email_customer_support' ? 'customer-support@oryzae.shop' : 'support@oryzae.site';
}

export interface SendCsEmailInput {
  chatId: string;
  customerEmail: string;
  channel?: string | null;
  subject?: string | null;
  text: string;
  threadId?: string | null;
}

export async function sendCsEmailReply(
  env: CsEmailEnv & { DB: D1Database },
  input: SendCsEmailInput,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const text = input.text.trim();
  if (!text) return { ok: false, error: '本文が空です' };
  if (!input.customerEmail) return { ok: false, error: '送信先メールアドレスがありません' };

  const serviceAccount = getServiceAccount(env);
  if (!serviceAccount) return { ok: false, error: 'メール送信の設定（サービスアカウント）がありません' };

  const senderUser = getSenderEmail(env);
  const alias = getVisibleAlias(input.channel ?? 'email');
  const baseSubject = input.subject?.trim() || 'お問い合わせ';
  const subject = /^re:/i.test(baseSubject) ? baseSubject : `Re: ${baseSubject}`;

  const client = new GmailClient(serviceAccount, senderUser);
  const raw = buildRfc822({
    from: `オリゼ カスタマーサポート <${senderUser}>`,
    to: input.customerEmail,
    subject,
    text,
    replyTo: alias,
  });

  try {
    const sent = await client.sendMessage(raw, input.threadId ?? undefined);
    await insertCsMessage(env.DB, {
      id: crypto.randomUUID(),
      chat_id: input.chatId,
      channel: 'email',
      direction: 'outgoing',
      external_id: sent.id,
      from_address: senderUser,
      to_address: input.customerEmail,
      subject,
      body_text: text,
      body_html: null,
      raw_metadata: JSON.stringify({ threadId: sent.threadId, manual: true }),
    });
    return { ok: true, id: sent.id };
  } catch (error) {
    console.error('[cs-email] send failed:', error);
    return { ok: false, error: 'メールを送信できませんでした（Gmail設定を確認してください）' };
  }
}
