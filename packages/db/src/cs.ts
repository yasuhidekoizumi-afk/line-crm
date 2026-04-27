/**
 * CS Phase 1: 統合受信箱 + AIトリアージ
 * 設計書: docs/CS_PHASE1_DESIGN.md
 */
import { jstNow } from './utils.js';

// ===== Types =====

export type CsChannel = 'line' | 'email_support' | 'email_customer_support';
export type AiStatus =
  | 'pending'
  | 'l1_auto_replied'
  | 'l2_draft_pending'
  | 'l2_approved'
  | 'l3_escalated'
  | 'human_handled'
  | 'resolved';
export type AiCategory = 'faq' | 'order_status' | 'refund' | 'complaint' | 'product_question' | 'other';
export type AiLevel = 'L1' | 'L2' | 'L3';
export type DraftStatus = 'pending' | 'approved' | 'edited' | 'rejected' | 'sent';

export interface CsMessageRow {
  id: string;
  chat_id: string;
  channel: 'line' | 'email';
  direction: 'incoming' | 'outgoing';
  external_id: string | null;
  from_address: string | null;
  to_address: string | null;
  subject: string | null;
  body_text: string;
  body_html: string | null;
  raw_metadata: string | null;
  created_at: string;
}

export interface AiDraftRow {
  id: string;
  chat_id: string;
  message_id: string;
  draft_text: string;
  draft_metadata: string | null;
  status: DraftStatus;
  approved_by: string | null;
  approved_at: string | null;
  final_text: string | null;
  rejection_reason: string | null;
  created_at: string;
}

export interface CustomerLinkRow {
  id: string;
  line_friend_id: string | null;
  email: string | null;
  shopify_customer_id: string | null;
  freee_partner_id: string | null;
  display_name: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface FaqEntryRow {
  id: string;
  category: string;
  question: string;
  answer: string;
  keywords: string | null;
  l1_eligible: number;
  active: number;
  source_row: number | null;
  updated_at: string;
}

export interface AiDecisionLogRow {
  id: string;
  chat_id: string;
  message_id: string;
  level: AiLevel;
  category: string | null;
  confidence: number | null;
  matched_faq_id: string | null;
  money_flag: number;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  cost_jpy: number | null;
  outcome: string | null;
  outcome_at: string | null;
  created_at: string;
}

export interface GmailWatchStateRow {
  email_address: string;
  history_id: string | null;
  expiration: string | null;
  last_renewed_at: string;
}

// ===== cs_messages =====

export async function insertCsMessage(
  db: D1Database,
  input: Omit<CsMessageRow, 'created_at'>,
): Promise<CsMessageRow> {
  const now = jstNow();
  await db
    .prepare(
      `INSERT INTO cs_messages (id, chat_id, channel, direction, external_id, from_address, to_address, subject, body_text, body_html, raw_metadata, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      input.id,
      input.chat_id,
      input.channel,
      input.direction,
      input.external_id,
      input.from_address,
      input.to_address,
      input.subject,
      input.body_text,
      input.body_html,
      input.raw_metadata,
      now,
    )
    .run();
  return { ...input, created_at: now };
}

export async function getCsMessagesByChat(db: D1Database, chatId: string): Promise<CsMessageRow[]> {
  const result = await db
    .prepare(`SELECT * FROM cs_messages WHERE chat_id = ? ORDER BY created_at ASC`)
    .bind(chatId)
    .all<CsMessageRow>();
  return result.results;
}

export async function findCsMessageByExternalId(
  db: D1Database,
  externalId: string,
): Promise<CsMessageRow | null> {
  return db
    .prepare(`SELECT * FROM cs_messages WHERE external_id = ? LIMIT 1`)
    .bind(externalId)
    .first<CsMessageRow>();
}

// ===== ai_drafts =====

/**
 * AI下書きを作成 or 上書き。同一チャットに pending 下書きが既に存在する場合は
 * 新規 INSERT せず既存行を UPDATE し、最新の triage 結果で上書きする。
 * これにより同じチャットで再 triage が走っても下書きが無限増殖しない。
 */
export async function createAiDraft(
  db: D1Database,
  input: {
    chat_id: string;
    message_id: string;
    draft_text: string;
    draft_metadata?: Record<string, unknown>;
  },
): Promise<AiDraftRow> {
  const now = jstNow();
  const metaJson = input.draft_metadata ? JSON.stringify(input.draft_metadata) : null;

  // 既存 pending 下書きを探す
  const existing = await db
    .prepare(`SELECT id FROM ai_drafts WHERE chat_id = ? AND status = 'pending' ORDER BY created_at DESC LIMIT 1`)
    .bind(input.chat_id)
    .first<{ id: string }>();

  if (existing) {
    await db
      .prepare(
        `UPDATE ai_drafts SET message_id = ?, draft_text = ?, draft_metadata = ?, created_at = ? WHERE id = ?`,
      )
      .bind(input.message_id, input.draft_text, metaJson, now, existing.id)
      .run();
    return (await getAiDraftById(db, existing.id))!;
  }

  const id = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO ai_drafts (id, chat_id, message_id, draft_text, draft_metadata, status, created_at)
       VALUES (?, ?, ?, ?, ?, 'pending', ?)`,
    )
    .bind(id, input.chat_id, input.message_id, input.draft_text, metaJson, now)
    .run();
  return (await getAiDraftById(db, id))!;
}

export async function getAiDraftById(db: D1Database, id: string): Promise<AiDraftRow | null> {
  return db.prepare(`SELECT * FROM ai_drafts WHERE id = ?`).bind(id).first<AiDraftRow>();
}

export async function getAiDraftByChatId(db: D1Database, chatId: string): Promise<AiDraftRow | null> {
  return db
    .prepare(`SELECT * FROM ai_drafts WHERE chat_id = ? AND status = 'pending' ORDER BY created_at DESC LIMIT 1`)
    .bind(chatId)
    .first<AiDraftRow>();
}

export async function listPendingAiDrafts(db: D1Database, limit = 50): Promise<AiDraftRow[]> {
  const result = await db
    .prepare(`SELECT * FROM ai_drafts WHERE status = 'pending' ORDER BY created_at DESC LIMIT ?`)
    .bind(limit)
    .all<AiDraftRow>();
  return result.results;
}

export async function approveAiDraft(
  db: D1Database,
  id: string,
  approvedBy: string,
  finalText: string,
  edited: boolean,
): Promise<void> {
  const now = jstNow();
  await db
    .prepare(
      `UPDATE ai_drafts SET status = ?, approved_by = ?, approved_at = ?, final_text = ? WHERE id = ?`,
    )
    .bind(edited ? 'edited' : 'approved', approvedBy, now, finalText, id)
    .run();
}

export async function markAiDraftSent(db: D1Database, id: string): Promise<void> {
  await db.prepare(`UPDATE ai_drafts SET status = 'sent' WHERE id = ?`).bind(id).run();
}

export async function rejectAiDraft(
  db: D1Database,
  id: string,
  rejectedBy: string,
  reason: string,
): Promise<void> {
  const now = jstNow();
  await db
    .prepare(
      `UPDATE ai_drafts SET status = 'rejected', approved_by = ?, approved_at = ?, rejection_reason = ? WHERE id = ?`,
    )
    .bind(rejectedBy, now, reason, id)
    .run();
}

// ===== chats拡張カラム更新 =====

export async function updateChatAiStatus(
  db: D1Database,
  chatId: string,
  updates: {
    ai_status?: AiStatus;
    ai_category?: AiCategory | null;
    ai_confidence?: number | null;
    ai_money_flag?: boolean;
  },
): Promise<void> {
  const sets: string[] = [];
  const values: unknown[] = [];
  if (updates.ai_status !== undefined) { sets.push('ai_status = ?'); values.push(updates.ai_status); }
  if (updates.ai_category !== undefined) { sets.push('ai_category = ?'); values.push(updates.ai_category); }
  if (updates.ai_confidence !== undefined) { sets.push('ai_confidence = ?'); values.push(updates.ai_confidence); }
  if (updates.ai_money_flag !== undefined) { sets.push('ai_money_flag = ?'); values.push(updates.ai_money_flag ? 1 : 0); }
  if (sets.length === 0) return;
  sets.push('updated_at = ?');
  values.push(jstNow());
  values.push(chatId);
  await db.prepare(`UPDATE chats SET ${sets.join(', ')} WHERE id = ?`).bind(...values).run();
}

export async function findChatByExternalThread(
  db: D1Database,
  threadId: string,
): Promise<{ id: string } | null> {
  return db
    .prepare(`SELECT id FROM chats WHERE external_thread_id = ? LIMIT 1`)
    .bind(threadId)
    .first<{ id: string }>();
}

/**
 * メールチャット用の「仮想friend」を取得 or 作成。
 * friends.line_user_id を `email:<address>` で一意キーにして
 * メール顧客もLINEユーザーと同じcustomer体系で扱う。
 */
export async function getOrCreateEmailFriend(
  db: D1Database,
  email: string,
  displayName?: string,
): Promise<{ id: string }> {
  const lineUserId = `email:${email.toLowerCase()}`;
  const existing = await db
    .prepare(`SELECT id FROM friends WHERE line_user_id = ?`)
    .bind(lineUserId)
    .first<{ id: string }>();
  if (existing) return existing;

  const id = crypto.randomUUID();
  const now = jstNow();
  await db
    .prepare(
      `INSERT INTO friends (id, line_user_id, display_name, is_following, created_at, updated_at)
       VALUES (?, ?, ?, 1, ?, ?)`,
    )
    .bind(id, lineUserId, displayName ?? email, now, now)
    .run();
  return { id };
}

export async function createEmailChat(
  db: D1Database,
  input: {
    channel: CsChannel;
    external_thread_id: string;
    customer_email: string;
    friend_id: string; // getOrCreateEmailFriend()の結果
  },
): Promise<{ id: string }> {
  const id = crypto.randomUUID();
  const now = jstNow();
  await db
    .prepare(
      `INSERT INTO chats (id, friend_id, status, channel, external_thread_id, customer_email, ai_status, last_message_at, created_at, updated_at)
       VALUES (?, ?, 'unread', ?, ?, ?, 'pending', ?, ?, ?)`,
    )
    .bind(id, input.friend_id, input.channel, input.external_thread_id, input.customer_email, now, now, now)
    .run();
  return { id };
}

export async function getCsChats(
  db: D1Database,
  opts: { ai_status?: AiStatus; channel?: CsChannel; limit?: number } = {},
): Promise<Array<Record<string, unknown>>> {
  const conditions: string[] = [];
  const values: unknown[] = [];
  if (opts.ai_status) { conditions.push('ai_status = ?'); values.push(opts.ai_status); }
  if (opts.channel) { conditions.push('channel = ?'); values.push(opts.channel); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  values.push(opts.limit ?? 100);
  const result = await db
    .prepare(`SELECT * FROM chats ${where} ORDER BY last_message_at DESC LIMIT ?`)
    .bind(...values)
    .all();
  return result.results as Array<Record<string, unknown>>;
}

// ===== customer_links =====

export async function findCustomerLink(
  db: D1Database,
  query: { line_friend_id?: string; email?: string; shopify_customer_id?: string },
): Promise<CustomerLinkRow | null> {
  if (query.line_friend_id) {
    const r = await db.prepare(`SELECT * FROM customer_links WHERE line_friend_id = ? LIMIT 1`)
      .bind(query.line_friend_id).first<CustomerLinkRow>();
    if (r) return r;
  }
  if (query.email) {
    const r = await db.prepare(`SELECT * FROM customer_links WHERE email = ? LIMIT 1`)
      .bind(query.email).first<CustomerLinkRow>();
    if (r) return r;
  }
  if (query.shopify_customer_id) {
    const r = await db.prepare(`SELECT * FROM customer_links WHERE shopify_customer_id = ? LIMIT 1`)
      .bind(query.shopify_customer_id).first<CustomerLinkRow>();
    if (r) return r;
  }
  return null;
}

export async function upsertCustomerLink(
  db: D1Database,
  input: Partial<Omit<CustomerLinkRow, 'id' | 'created_at' | 'updated_at'>>,
): Promise<CustomerLinkRow> {
  const existing = await findCustomerLink(db, {
    line_friend_id: input.line_friend_id ?? undefined,
    email: input.email ?? undefined,
    shopify_customer_id: input.shopify_customer_id ?? undefined,
  });
  const now = jstNow();
  if (existing) {
    const sets: string[] = [];
    const values: unknown[] = [];
    for (const [k, v] of Object.entries(input)) {
      if (v !== undefined && v !== null) {
        sets.push(`${k} = ?`);
        values.push(v);
      }
    }
    if (sets.length === 0) return existing;
    sets.push('updated_at = ?');
    values.push(now);
    values.push(existing.id);
    await db.prepare(`UPDATE customer_links SET ${sets.join(', ')} WHERE id = ?`).bind(...values).run();
    return (await db.prepare(`SELECT * FROM customer_links WHERE id = ?`).bind(existing.id).first<CustomerLinkRow>())!;
  }
  const id = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO customer_links (id, line_friend_id, email, shopify_customer_id, freee_partner_id, display_name, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      input.line_friend_id ?? null,
      input.email ?? null,
      input.shopify_customer_id ?? null,
      input.freee_partner_id ?? null,
      input.display_name ?? null,
      input.notes ?? null,
      now,
      now,
    )
    .run();
  return (await db.prepare(`SELECT * FROM customer_links WHERE id = ?`).bind(id).first<CustomerLinkRow>())!;
}

// ===== faq_entries =====

export async function getActiveFaqs(db: D1Database): Promise<FaqEntryRow[]> {
  const result = await db
    .prepare(`SELECT * FROM faq_entries WHERE active = 1 ORDER BY category, question`)
    .all<FaqEntryRow>();
  return result.results;
}

export async function getFaqById(db: D1Database, id: string): Promise<FaqEntryRow | null> {
  return db.prepare(`SELECT * FROM faq_entries WHERE id = ?`).bind(id).first<FaqEntryRow>();
}

export async function upsertFaqFromSheetRow(
  db: D1Database,
  input: {
    source_row: number;
    category: string;
    question: string;
    answer: string;
    keywords?: string;
    l1_eligible?: boolean;
    active?: boolean;
  },
): Promise<void> {
  const existing = await db
    .prepare(`SELECT id FROM faq_entries WHERE source_row = ? LIMIT 1`)
    .bind(input.source_row)
    .first<{ id: string }>();
  const now = jstNow();
  if (existing) {
    await db
      .prepare(
        `UPDATE faq_entries SET category = ?, question = ?, answer = ?, keywords = ?, l1_eligible = ?, active = ?, updated_at = ? WHERE id = ?`,
      )
      .bind(
        input.category,
        input.question,
        input.answer,
        input.keywords ?? null,
        input.l1_eligible ? 1 : 0,
        input.active === false ? 0 : 1,
        now,
        existing.id,
      )
      .run();
  } else {
    const id = crypto.randomUUID();
    await db
      .prepare(
        `INSERT INTO faq_entries (id, category, question, answer, keywords, l1_eligible, active, source_row, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        id,
        input.category,
        input.question,
        input.answer,
        input.keywords ?? null,
        input.l1_eligible ? 1 : 0,
        input.active === false ? 0 : 1,
        input.source_row,
        now,
      )
      .run();
  }
}

// ===== ai_decision_log =====

export async function logAiDecision(
  db: D1Database,
  input: Omit<AiDecisionLogRow, 'id' | 'created_at'>,
): Promise<void> {
  const id = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO ai_decision_log (id, chat_id, message_id, level, category, confidence, matched_faq_id, money_flag, prompt_tokens, completion_tokens, cost_jpy, outcome, outcome_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      input.chat_id,
      input.message_id,
      input.level,
      input.category,
      input.confidence,
      input.matched_faq_id,
      input.money_flag,
      input.prompt_tokens,
      input.completion_tokens,
      input.cost_jpy,
      input.outcome,
      input.outcome_at,
      jstNow(),
    )
    .run();
}

// ===== gmail_watch_state =====

export async function getGmailWatchState(
  db: D1Database,
  emailAddress: string,
): Promise<GmailWatchStateRow | null> {
  return db
    .prepare(`SELECT * FROM gmail_watch_state WHERE email_address = ?`)
    .bind(emailAddress)
    .first<GmailWatchStateRow>();
}

export async function upsertGmailWatchState(
  db: D1Database,
  emailAddress: string,
  historyId: string,
  expiration: string,
): Promise<void> {
  const now = jstNow();
  await db
    .prepare(
      `INSERT INTO gmail_watch_state (email_address, history_id, expiration, last_renewed_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(email_address) DO UPDATE SET history_id = excluded.history_id, expiration = excluded.expiration, last_renewed_at = excluded.last_renewed_at`,
    )
    .bind(emailAddress, historyId, expiration, now)
    .run();
}

export async function listGmailWatchStates(db: D1Database): Promise<GmailWatchStateRow[]> {
  const result = await db
    .prepare(`SELECT * FROM gmail_watch_state ORDER BY email_address`)
    .all<GmailWatchStateRow>();
  return result.results;
}
