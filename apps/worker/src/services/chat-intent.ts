import { classifyChatIntent } from '@line-crm/ai-sdk';
import { jstNow } from '@line-crm/db';
import type { Env } from '../index.js';

export type ChatIntentLabel = 'needs_reply' | 'closing' | 'unclear';

/**
 * 顧客の最終メッセージの意図を判定して chats に保存する。
 *
 * LINE公式アカウント管理画面から返信している運用では、Messaging API から
 * 「自分が送った返信」を取得できない。未読数・経過日数は返信状況を表さないため、
 * 顧客側の最終メッセージが「まだ何かを求めているか」だけを判定して候補を絞る。
 */
export async function classifyAndSaveChatIntent(
  env: Env['Bindings'],
  chatId: string,
): Promise<ChatIntentLabel | null> {
  if (!env.GEMINI_API_KEY) return null;

  const row = await env.DB.prepare(
    `SELECT c.friend_id, f.display_name,
       (SELECT m.content FROM messages_log m
         WHERE m.friend_id = c.friend_id AND m.direction = 'incoming'
         ORDER BY m.created_at DESC LIMIT 1) AS last_body,
       (SELECT MAX(i.created_at) FROM messages_log i
         WHERE i.friend_id = c.friend_id AND i.direction = 'incoming') AS last_incoming
     FROM chats c LEFT JOIN friends f ON f.id = c.friend_id
     WHERE c.id = ?`,
  )
    .bind(chatId)
    .first<{ friend_id: string; display_name: string | null; last_body: string | null; last_incoming: string | null }>();

  // 顧客からの受信が無い会話は判定しない（判定しても意味がない）
  if (!row?.last_body || !row.last_incoming) return null;

  const ctx = await env.DB.prepare(
    `SELECT direction, content FROM messages_log
     WHERE friend_id = ? AND created_at < ?
     ORDER BY created_at DESC LIMIT 3`,
  )
    .bind(row.friend_id, row.last_incoming)
    .all<{ direction: string; content: string }>();

  const previousContext = ((ctx.results ?? []) as { direction: string; content: string }[])
    .reverse()
    .map((r) => `${r.direction === 'incoming' ? '顧客' : '店'}: ${(r.content ?? '').slice(0, 120)}`);

  const result = await classifyChatIntent(env.GEMINI_API_KEY, {
    lastMessage: row.last_body,
    previousContext,
    customerName: row.display_name,
  });

  await env.DB.prepare(
    `UPDATE chats SET ai_intent = ?, ai_intent_reason = ?, ai_intent_at = ? WHERE id = ?`,
  )
    .bind(result.intent, result.reason, jstNow(), chatId)
    .run();

  return result.intent;
}
