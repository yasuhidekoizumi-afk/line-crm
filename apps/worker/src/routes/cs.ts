/**
 * CS Phase 1: 統合受信箱 + AIトリアージ
 *
 * エンドポイント:
 *   POST /webhooks/gmail            Gmail Pub/Sub からの push notification
 *   POST /api/cs/triage/:chatId     手動再トリアージ
 *   GET  /api/cs/drafts             承認待ち下書き一覧
 *   GET  /api/cs/chats/:id/draft    特定チャットの下書き取得
 *   POST /api/cs/drafts/:id/approve 下書き承認 → 送信
 *   POST /api/cs/drafts/:id/reject  下書き却下
 *   GET  /api/cs/dashboard          CSダッシュボード集計
 *   GET  /api/cs/faqs               FAQ一覧
 *   POST /api/cs/gmail/watch        Gmail watch登録（手動 or cron）
 *
 * 設計書: docs/CS_PHASE1_DESIGN.md
 */
import { Hono } from 'hono';
import {
  GmailClient,
  extractMessageBody,
  extractEmailAddress,
  buildRfc822,
  type ServiceAccountKey,
} from '@line-crm/email-sdk';
import { triageMessage, type FaqLite, type CsCustomerContext } from '@line-crm/ai-sdk';
import {
  jstNow,
  insertCsMessage,
  findCsMessageByExternalId,
  findChatByExternalThread,
  createEmailChat,
  getOrCreateEmailFriend,
  updateChatAiStatus,
  createAiDraft,
  getAiDraftById,
  listPendingAiDrafts,
  approveAiDraft,
  markAiDraftSent,
  rejectAiDraft,
  getActiveFaqs,
  findCustomerLink,
  upsertCustomerLink,
  upsertGmailWatchState,
  logAiDecision,
  type CsChannel,
} from '@line-crm/db';
import {
  notifyL3Escalation,
  notifyL2DraftReady,
} from '../services/cs-slack-notify.js';
import { fetchShopifyCustomerContext } from '../services/shopify-customer-context.js';
import { getShopifyAdminToken } from '../utils/shopify-token.js';
import type { Env } from '../index.js';

export const cs = new Hono<Env>();

// ==================== チャネル設定 ====================

/**
 * 受信メールの宛先（To/Delivered-To）からCSチャネル種別を判定。
 * 監視はラベル付き受信箱だが、エイリアス → 実ユーザー転送経由で
 * 元の宛先を判別する必要がある。
 */
function detectChannelFromHeaders(toHeader: string | null, deliveredTo: string | null): CsChannel | null {
  const haystack = `${toHeader ?? ''} ${deliveredTo ?? ''}`.toLowerCase();
  if (haystack.includes('support@oryzae.site')) return 'email_support';
  if (haystack.includes('customer-support@oryzae.shop')) return 'email_customer_support';
  return null;
}

/**
 * 監視対象Gmailアカウント（実ユーザー）。
 * support@oryzae.site / customer-support@oryzae.shop はエイリアスで実体が無いため、
 * 実ユーザーに集約して受信し、Gmailフィルタで `CS_LABEL_NAME` を自動付与する運用。
 */
const MONITORED_GMAIL_ACCOUNTS = ['yasuhide.koizumi@oryzae.site'];

/** Gmailフィルタで自動付与するラベル名（小泉さん側で要設定） */
const CS_LABEL_NAME = 'CS';

function getServiceAccount(env: Env['Bindings']): ServiceAccountKey | null {
  const json = env.GCP_SERVICE_ACCOUNT_JSON;
  if (!json) return null;
  try {
    return JSON.parse(json) as ServiceAccountKey;
  } catch (e) {
    console.error('[cs] GCP_SERVICE_ACCOUNT_JSON parse failed', e);
    return null;
  }
}

// ==================== Gmail Pub/Sub Webhook ====================

cs.post('/webhooks/gmail', async (c) => {
  try {
    // Pub/Sub push 形式: { message: { data: base64(JSON), messageId, publishTime }, subscription }
    const body = await c.req.json<{
      message?: { data?: string; messageId?: string };
      subscription?: string;
    }>();
    const dataB64 = body.message?.data;
    if (!dataB64) {
      console.warn('[cs/gmail-webhook] no message.data');
      return c.json({ success: true, ignored: true });
    }

    const decoded = atob(dataB64);
    const notification = JSON.parse(decoded) as { emailAddress: string; historyId: string };

    // 非同期処理 → ペイロードはWaitUntilで処理
    c.executionCtx.waitUntil(
      processGmailNotification(c.env, notification).catch((e) =>
        console.error('[cs/gmail-webhook] processing error:', e),
      ),
    );

    return c.json({ success: true });
  } catch (e) {
    console.error('[cs/gmail-webhook] error:', e);
    return c.json({ success: false, error: String(e) }, 500);
  }
});

async function processGmailNotification(
  env: Env['Bindings'],
  notification: { emailAddress: string; historyId: string },
): Promise<void> {
  const sa = getServiceAccount(env);
  if (!sa) {
    console.error('[cs/gmail] service account not configured');
    return;
  }

  const client = new GmailClient(sa, notification.emailAddress);

  // 前回のhistoryIdから差分取得
  const watchState = await env.DB.prepare(`SELECT history_id FROM gmail_watch_state WHERE email_address = ?`)
    .bind(notification.emailAddress)
    .first<{ history_id: string | null }>();

  const messageIds: Array<{ id: string; threadId: string }> = [];

  // CSラベルが付いたメッセージのみ取得（フィルタで自動付与済み想定）
  // q: は listMessages のみ。history APIには labelId フィルタが効くのでそちらを利用。
  if (watchState?.history_id) {
    try {
      const history = await client.listHistory(watchState.history_id);
      for (const item of history.history ?? []) {
        for (const added of item.messagesAdded ?? []) {
          // ラベル確認はメッセージ取得時に行う（history APIが返すlabelIdsを利用）
          if (!added.message.labelIds || added.message.labelIds.length === 0) {
            // labelIdsが無いケースは次の判定に任せる
          }
          messageIds.push({ id: added.message.id, threadId: added.message.threadId });
        }
      }
    } catch (e) {
      console.error('[cs/gmail] history fetch failed, falling back to recent list:', e);
      const list = await client.listMessages({ q: `label:${CS_LABEL_NAME} newer_than:1d`, maxResults: 5 });
      for (const m of list.messages ?? []) messageIds.push(m);
    }
  } else {
    const list = await client.listMessages({ q: `label:${CS_LABEL_NAME} newer_than:1d`, maxResults: 3 });
    for (const m of list.messages ?? []) messageIds.push(m);
  }

  // 新historyId保存
  await upsertGmailWatchState(env.DB, notification.emailAddress, notification.historyId, '');

  // 各メッセージ処理
  for (const { id, threadId } of messageIds) {
    const dup = await findCsMessageByExternalId(env.DB, id);
    if (dup) continue;
    try {
      await ingestGmailMessage(env, client, id, threadId);
    } catch (e) {
      console.error(`[cs/gmail] ingest message ${id} failed:`, e);
    }
  }
}

async function ingestGmailMessage(
  env: Env['Bindings'],
  client: GmailClient,
  messageId: string,
  threadId: string,
): Promise<void> {
  const message = await client.getMessage(messageId, 'full');

  // CSラベルが付いていないメッセージはスキップ（個人メール混入防止）
  // labelIds は CS_LABEL_NAME 文字列ではなくID形式なので、ラベル名でフィルタするため
  // ヘッダー側のDelivered-To/Toで宛先を見て判定する。
  const headers = Object.fromEntries(
    (message.payload?.headers ?? []).map((h) => [h.name.toLowerCase(), h.value]),
  );
  const channel = detectChannelFromHeaders(headers['to'] ?? null, headers['delivered-to'] ?? null);
  if (!channel) {
    // CSアドレス宛ではない（個人メール）
    return;
  }

  const extracted = extractMessageBody(message);
  const fromEmail = extractEmailAddress(extracted.from);
  if (!fromEmail) {
    console.warn(`[cs/gmail] no from address for message ${messageId}`);
    return;
  }

  // 自分自身からのメール（送信メール）は無視
  if (fromEmail.endsWith('@oryzae.site') || fromEmail.endsWith('@oryzae.shop')) {
    return;
  }

  // chat upsert（threadId基準）
  let chat = await findChatByExternalThread(env.DB, threadId);
  if (!chat) {
    const friend = await getOrCreateEmailFriend(env.DB, fromEmail, extracted.from?.split('<')[0]?.trim() || fromEmail);
    const created = await createEmailChat(env.DB, {
      channel,
      external_thread_id: threadId,
      customer_email: fromEmail,
      friend_id: friend.id,
    });
    chat = { id: created.id };
    // customer_links upsert
    await upsertCustomerLink(env.DB, {
      email: fromEmail,
      line_friend_id: friend.id,
      display_name: extracted.from?.split('<')[0]?.trim() || fromEmail,
    });
  }

  // メッセージ保存
  const csMessageId = crypto.randomUUID();
  await insertCsMessage(env.DB, {
    id: csMessageId,
    chat_id: chat.id,
    channel: 'email',
    direction: 'incoming',
    external_id: messageId,
    from_address: extracted.from,
    to_address: extracted.to,
    subject: extracted.subject,
    body_text: extracted.text,
    body_html: extracted.html,
    raw_metadata: JSON.stringify({ date: extracted.date, threadId }),
  });

  // last_message_at更新
  await env.DB.prepare(`UPDATE chats SET last_message_at = ?, status = 'unread', updated_at = ? WHERE id = ?`)
    .bind(jstNow(), jstNow(), chat.id)
    .run();

  // AIトリアージ実行
  await runTriageForMessage(env, chat.id, csMessageId, extracted.text, extracted.subject, fromEmail, channel);
}

// ==================== トリアージ実行 ====================

async function runTriageForMessage(
  env: Env['Bindings'],
  chatId: string,
  messageId: string,
  text: string,
  subject: string | null,
  customerEmail: string | null,
  channel: CsChannel,
  opts?: { lineFriendId?: string | null; allowAutoSend?: boolean; customerName?: string | null },
): Promise<void> {
  if (!env.GEMINI_API_KEY) {
    console.error('[cs/triage] GEMINI_API_KEY missing');
    return;
  }

  // 顧客カルテ取得（LINE harness DB + Shopify Admin API）
  // LINEは友だちID、メールはアドレスで名寄せする。メール未連携のLINE友だちは
  // Shopify照会をスキップし、LINEの表示名だけを渡す（推測で名寄せしない）。
  const link = await findCustomerLink(env.DB, customerEmail
    ? { email: customerEmail }
    : { line_friend_id: opts?.lineFriendId ?? undefined });
  const shopifyCtx = customerEmail
    ? await fetchShopifyCustomerContext(
        env.SHOPIFY_SHOP_DOMAIN,
        (await getShopifyAdminToken(env)) ?? undefined,
        customerEmail,
      )
    : null;
  // Shopify顧客IDが取れたら customer_links を更新（次回以降の名寄せ高速化）
  if (shopifyCtx?.customer && (!link?.shopify_customer_id || link.display_name !== shopifyCtx.customer.name)) {
    await upsertCustomerLink(env.DB, {
      email: customerEmail,
      display_name: shopifyCtx.customer.name,
    });
  }

  const recentOrdersForPrompt = (shopifyCtx?.recent_orders ?? []).map((o) => ({
    name: `${o.name} (${o.ordered_at}, ¥${o.total}, ${o.payment_status ?? '?'}/${o.fulfillment_status ?? '?'}): ${o.items.join(', ')}`,
    ordered_at: o.ordered_at,
    status: `${o.payment_status ?? '?'} / ${o.fulfillment_status ?? '?'}`,
  }));

  const customer: CsCustomerContext = {
    name: shopifyCtx?.customer?.name ?? link?.display_name ?? opts?.customerName ?? null,
    email: customerEmail,
    ltv: shopifyCtx?.customer?.ltv_jpy ?? null,
    recent_orders: recentOrdersForPrompt,
    past_chats_summary: shopifyCtx?.customer
      ? `Shopify顧客: 累計${shopifyCtx.customer.orders_count}回購入 / 登録${shopifyCtx.customer.customer_since}${shopifyCtx.customer.tags.length ? ` / タグ: ${shopifyCtx.customer.tags.join(', ')}` : ''}`
      : null,
  };

  const faqRows = await getActiveFaqs(env.DB);
  const faqs: FaqLite[] = faqRows.map((f) => ({
    id: f.id,
    category: f.category,
    question: f.question,
    answer: f.answer,
    keywords: f.keywords,
    l1_eligible: f.l1_eligible,
  }));

  const result = await triageMessage(env.GEMINI_API_KEY, {
    messageText: text,
    subject,
    customer,
    faqs,
  });

  // chats.ai_status等を更新
  // 自動送信しない設定（LINEのトリアージ等）では L1 でも「下書き待ち」として扱う
  const allowAutoSend = opts?.allowAutoSend ?? true;
  let newAiStatus: 'l1_auto_replied' | 'l2_draft_pending' | 'l3_escalated';
  if (result.level === 'L1' && result.draft_text && allowAutoSend) {
    newAiStatus = 'l1_auto_replied';
  } else if (result.level === 'L2' || (result.level === 'L1' && result.draft_text)) {
    newAiStatus = 'l2_draft_pending';
  } else {
    newAiStatus = 'l3_escalated';
  }

  await updateChatAiStatus(env.DB, chatId, {
    ai_status: newAiStatus,
    ai_category: result.category,
    ai_confidence: result.confidence,
    ai_money_flag: result.money_flag,
  });

  await logAiDecision(env.DB, {
    chat_id: chatId,
    message_id: messageId,
    level: result.level,
    category: result.category,
    confidence: result.confidence,
    matched_faq_id: result.matched_faq_id,
    money_flag: result.money_flag ? 1 : 0,
    prompt_tokens: result.prompt_tokens,
    completion_tokens: result.completion_tokens,
    cost_jpy: result.cost_jpy,
    outcome: result.level === 'L1' && allowAutoSend ? 'auto_sent' : null,
    outcome_at: result.level === 'L1' && allowAutoSend ? jstNow() : null,
  });

  const shouldAutoSend = allowAutoSend && result.level === 'L1' && Boolean(result.draft_text) && result.confidence >= 0.9;

  let sentByAi = false;
  if (shouldAutoSend) {
    // L1: 即返信（confidence 0.9以上かつFAQ完全一致）
    const sent = await sendReply(env, chatId, messageId, result.draft_text!, channel, customerEmail, subject);
    sentByAi = sent.ok;
    if (!sent.ok) console.error('[cs] L1 auto-reply failed:', sent.error);
  }

  // 自動送信しなかった・失敗した場合は下書きに落とす（黙って消さない）
  const shouldDraft = !sentByAi && Boolean(result.draft_text) && (result.level === 'L2' || result.level === 'L1');
  if (shouldDraft) {
    // L2: 下書き作成 → Slack通知（承認は人間）
    await createAiDraft(env.DB, {
      chat_id: chatId,
      message_id: messageId,
      draft_text: result.draft_text!,
      draft_metadata: {
        category: result.category,
        confidence: result.confidence,
        matched_faq_id: result.matched_faq_id,
        money_flag: result.money_flag,
        reasoning: result.reasoning,
      },
    });
    await notifyL2DraftReady(env, {
      chat_id: chatId,
      customer_name: customer.name,
      channel,
      category: result.category,
      money_flag: result.money_flag,
    });
    // L1自動送信に失敗して下書きへ落ちた場合に備え、状態を下書き待ちに揃える
    await updateChatAiStatus(env.DB, chatId, { ai_status: 'l2_draft_pending' });
  } else if (!sentByAi) {
    // L3: エスカレ通知
    await notifyL3Escalation(env, {
      chat_id: chatId,
      customer_name: customer.name,
      customer_email: customerEmail,
      channel,
      category: result.category,
      confidence: result.confidence,
      money_flag: result.money_flag,
      snippet: text.slice(0, 600),
    });
  }
}

// ==================== 返信送信 ====================

/**
 * チャネルに応じたReply-To表示用アドレス
 */
function getVisibleAlias(channel: CsChannel): string {
  switch (channel) {
    case 'email_customer_support':
      return 'customer-support@oryzae.shop';
    case 'email_support':
    default:
      return 'support@oryzae.site';
  }
}

/**
 * Gmail API で impersonate 可能な実ユーザーアドレスを取得。
 * support@oryzae.site / customer-support@oryzae.shop はエイリアス（実体無し）のため、
 * Gmail API のドメイン委任では impersonate できない。そのため実ユーザー受信箱から送信し、
 * Reply-To ヘッダーで表示上の送信元を設定する。
 * 環境変数 CS_GMAIL_SENDER_EMAIL で設定可能、未設定時は yasuhide.koizumi@oryzae.site にフォールバック。
 */
function getSenderEmail(env: Env['Bindings']): string {
  return env.CS_GMAIL_SENDER_EMAIL || 'yasuhide.koizumi@oryzae.site';
}

async function sendReply(
  env: Env['Bindings'],
  chatId: string,
  inReplyToMessageId: string,
  replyText: string,
  channel: CsChannel,
  customerEmail: string | null,
  origSubject: string | null,
): Promise<{ ok: boolean; error?: string }> {
  if (channel === 'line') {
    // LINEは pushMessage で送る（replyToken は受信から約1分で失効し、承認時には使えない）
    const row = await env.DB.prepare(
      `SELECT f.id AS friend_id, f.line_user_id, la.channel_access_token
       FROM chats c JOIN friends f ON f.id = c.friend_id
       LEFT JOIN line_accounts la ON la.id = f.line_account_id
       WHERE c.id = ?`,
    )
      .bind(chatId)
      .first<{ friend_id: string; line_user_id: string | null; channel_access_token: string | null }>();
    if (!row?.line_user_id) {
      console.error('[cs/sendReply] LINE friend not found', chatId);
      return { ok: false, error: 'LINEの友だち情報が見つかりません' };
    }
    const token = row.channel_access_token || env.LINE_CHANNEL_ACCESS_TOKEN;
    if (!token) {
      console.error('[cs/sendReply] LINE token missing');
      return { ok: false, error: 'LINE送信設定が見つかりません' };
    }
    const { LineClient } = await import('@line-crm/line-sdk');
    try {
      await new LineClient(token).pushTextMessage(row.line_user_id, replyText);
    } catch (err) {
      console.error('[cs/sendReply] LINE push failed', err);
      return { ok: false, error: 'LINE側で送信できませんでした' };
    }
    // 会話履歴にも残す（CS画面と未読判定は messages_log を見るため）
    await env.DB.prepare(
      `INSERT INTO messages_log (id, friend_id, direction, message_type, content, created_at)
       VALUES (?, ?, 'outgoing', 'text', ?, ?)`,
    )
      .bind(crypto.randomUUID(), row.friend_id, replyText, jstNow())
      .run();
    return { ok: true };
  }

  if (!customerEmail) {
    console.error('[cs/sendReply] customer email missing');
    return { ok: false, error: '送信先メールアドレスがありません' };
  }

  const sa = getServiceAccount(env);
  if (!sa) {
    console.error('[cs/sendReply] service account not configured');
    return { ok: false, error: 'メール送信の認証情報が未設定です' };
  }

  const senderUser = getSenderEmail(env);
  const visibleAlias = getVisibleAlias(channel);
  const subject = origSubject?.startsWith('Re: ') ? origSubject : `Re: ${origSubject ?? 'お問い合わせ'}`;
  const client = new GmailClient(sa, senderUser);
  const raw = buildRfc822({
    from: `オリゼ カスタマーサポート <${senderUser}>`,
    to: customerEmail,
    subject,
    text: replyText,
    replyTo: visibleAlias,
  });

  // threadIdを取得
  const cmsg = await env.DB.prepare(`SELECT raw_metadata FROM cs_messages WHERE id = ?`)
    .bind(inReplyToMessageId)
    .first<{ raw_metadata: string | null }>();
  let threadId: string | undefined;
  if (cmsg?.raw_metadata) {
    try {
      const meta = JSON.parse(cmsg.raw_metadata) as { threadId?: string };
      threadId = meta.threadId;
    } catch {
      // ignore
    }
  }

  const sent = await client.sendMessage(raw, threadId);

  // 送信メッセージを保存
  await insertCsMessage(env.DB, {
    id: crypto.randomUUID(),
    chat_id: chatId,
    channel: 'email',
    direction: 'outgoing',
    external_id: sent.id,
    from_address: senderUser,
    to_address: customerEmail,
    subject,
    body_text: replyText,
    body_html: null,
    raw_metadata: JSON.stringify({ threadId: sent.threadId, automated: true }),
  });
  return { ok: true };
}

// ==================== API: 下書き管理 ====================

cs.get('/api/cs/drafts', async (c) => {
  try {
    const limit = Number(c.req.query('limit') ?? 50);
    const drafts = await listPendingAiDrafts(c.env.DB, limit);
    return c.json({
      success: true,
      data: drafts.map((d) => ({
        id: d.id,
        chatId: d.chat_id,
        messageId: d.message_id,
        draftText: d.draft_text,
        metadata: d.draft_metadata ? JSON.parse(d.draft_metadata) : null,
        createdAt: d.created_at,
      })),
    });
  } catch (e) {
    console.error('GET /api/cs/drafts error:', e);
    return c.json({ success: false, error: `一覧取得失敗: ${String(e).slice(0, 400)}` }, 500);
  }
});

cs.get('/api/cs/chats/:id/draft', async (c) => {
  try {
    const chatId = c.req.param('id');
    const draft = await c.env.DB.prepare(
      `SELECT * FROM ai_drafts WHERE chat_id = ? AND status = 'pending' ORDER BY created_at DESC LIMIT 1`,
    )
      .bind(chatId)
      .first<{ id: string; draft_text: string; draft_metadata: string | null; created_at: string }>();
    if (!draft) return c.json({ success: true, data: null });
    return c.json({
      success: true,
      data: {
        id: draft.id,
        draftText: draft.draft_text,
        metadata: draft.draft_metadata ? JSON.parse(draft.draft_metadata) : null,
        createdAt: draft.created_at,
      },
    });
  } catch (e) {
    console.error('GET /api/cs/chats/:id/draft error:', e);
    return c.json({ success: false, error: `取得失敗: ${String(e).slice(0, 400)}` }, 500);
  }
});

cs.post('/api/cs/drafts/:id/approve', async (c) => {
  try {
    const id = c.req.param('id');
    const body = await c.req.json<{ finalText?: string; approvedBy?: string }>();
    const draft = await getAiDraftById(c.env.DB, id);
    if (!draft) return c.json({ success: false, error: 'Draft not found' }, 404);
    if (draft.status !== 'pending') return c.json({ success: false, error: 'Already processed' }, 400);
    // ログイン中のスタッフを既定の承認者にする（画面からIDを渡させない）
    const staff = c.get('staff') as { id: string } | undefined;
    const approvedBy = body.approvedBy ?? staff?.id ?? 'env-owner';

    const finalText = body.finalText ?? draft.draft_text;
    const edited = body.finalText !== undefined && body.finalText !== draft.draft_text;

    // 送信してから承認を確定する。順序を逆にすると、送信に失敗しても
    // 下書きが「承認済み」で消え、顧客に届かないまま処理済みになる。
    const chat = await c.env.DB.prepare(`SELECT * FROM chats WHERE id = ?`).bind(draft.chat_id).first<{
      id: string;
      channel: string;
      customer_email: string | null;
      external_thread_id: string | null;
    }>();
    let sent: { ok: boolean; error?: string } = { ok: false, error: 'チャットが見つかりません' };
    if (chat?.channel?.startsWith('email_') && chat.customer_email) {
      const lastMsg = await c.env.DB.prepare(
        `SELECT subject FROM cs_messages WHERE chat_id = ? AND direction = 'incoming' ORDER BY created_at DESC LIMIT 1`,
      )
        .bind(chat.id)
        .first<{ subject: string | null }>();
      sent = await sendReply(
        c.env,
        chat.id,
        draft.message_id,
        finalText,
        chat.channel as CsChannel,
        chat.customer_email,
        lastMsg?.subject ?? null,
      );
    } else if (chat) {
      // LINEの承認も同じ経路で送る（pushMessage）。ここを空けると下書きが
      // 承認済みになるのに顧客へ届かない。
      sent = await sendReply(c.env, chat.id, draft.message_id, finalText, 'line', null, null);
    }
    if (!sent.ok) {
      return c.json({ success: false, error: sent.error ?? '送信に失敗しました' }, 502);
    }

    await approveAiDraft(c.env.DB, id, approvedBy, finalText, edited);

    await markAiDraftSent(c.env.DB, id);
    await updateChatAiStatus(c.env.DB, draft.chat_id, { ai_status: 'l2_approved' });

    // 結果ログ更新
    await c.env.DB.prepare(
      `UPDATE ai_decision_log SET outcome = ?, outcome_at = ? WHERE chat_id = ? AND outcome IS NULL`,
    )
      .bind(edited ? 'edited' : 'approved', jstNow(), draft.chat_id)
      .run();

    return c.json({ success: true, data: { id, sent: true } });
  } catch (e) {
    console.error('POST /api/cs/drafts/:id/approve error:', e);
    return c.json({ success: false, error: `送信失敗: ${String(e).slice(0, 400)}` }, 500);
  }
});

cs.post('/api/cs/drafts/:id/reject', async (c) => {
  try {
    const id = c.req.param('id');
    const body = await c.req.json<{ reason: string; rejectedBy?: string }>();
    const draft = await getAiDraftById(c.env.DB, id);
    if (!draft) return c.json({ success: false, error: 'Draft not found' }, 404);
    const staff = c.get('staff') as { id: string } | undefined;
    await rejectAiDraft(c.env.DB, id, body.rejectedBy ?? staff?.id ?? 'env-owner', body.reason);
    await updateChatAiStatus(c.env.DB, draft.chat_id, { ai_status: 'human_handled' });
    await c.env.DB.prepare(
      `UPDATE ai_decision_log SET outcome = ?, outcome_at = ? WHERE chat_id = ? AND outcome IS NULL`,
    )
      .bind('rejected', jstNow(), draft.chat_id)
      .run();
    return c.json({ success: true });
  } catch (e) {
    console.error('POST /api/cs/drafts/:id/reject error:', e);
    return c.json({ success: false, error: `却下処理失敗: ${String(e).slice(0, 400)}` }, 500);
  }
});

// ==================== API: ダッシュボード ====================

cs.get('/api/cs/dashboard', async (c) => {
  try {
    const sinceParam = c.req.query('since') ?? '7'; // 過去N日
    const days = Math.max(1, Math.min(90, Number(sinceParam)));
    const sinceDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    const levelStats = await c.env.DB.prepare(
      `SELECT level, COUNT(*) as cnt, AVG(confidence) as avg_conf, SUM(cost_jpy) as cost
       FROM ai_decision_log WHERE created_at >= ? GROUP BY level`,
    )
      .bind(sinceDate)
      .all<{ level: string; cnt: number; avg_conf: number; cost: number }>();

    const outcomeStats = await c.env.DB.prepare(
      `SELECT outcome, COUNT(*) as cnt FROM ai_decision_log WHERE created_at >= ? AND outcome IS NOT NULL GROUP BY outcome`,
    )
      .bind(sinceDate)
      .all<{ outcome: string; cnt: number }>();

    const categoryStats = await c.env.DB.prepare(
      `SELECT category, COUNT(*) as cnt FROM ai_decision_log WHERE created_at >= ? GROUP BY category ORDER BY cnt DESC`,
    )
      .bind(sinceDate)
      .all<{ category: string; cnt: number }>();

    // 「今日やること」集計: L3滞留・金銭フラグ・古い承認待ち・日別トレンド
    const [l3Pending, moneyFlagCount, oldestDraft, dailyTrend] = await Promise.all([
      // L3エスカレ中のチャット（未解決）
      c.env.DB.prepare(
        `SELECT COUNT(*) AS cnt, COALESCE(MAX(
           CAST((julianday('now','+9 hours') - julianday(updated_at)) * 24 AS INTEGER)
         ), 0) AS oldest_hours
         FROM chats WHERE ai_status = 'l3_escalated'`,
      ).first<{ cnt: number; oldest_hours: number }>(),
      // 期間内の金銭フラグ付き判定（事故監視）
      c.env.DB.prepare(
        `SELECT COUNT(*) AS cnt FROM ai_decision_log
         WHERE created_at >= ? AND money_flag = 1`,
      )
        .bind(sinceDate)
        .first<{ cnt: number }>(),
      // 最古の承認待ち下書き（経過時間）
      c.env.DB.prepare(
        `SELECT ai_drafts.created_at FROM ai_drafts
         JOIN chats ON chats.id = ai_drafts.chat_id
         WHERE ai_drafts.status = 'pending' AND chats.ai_status = 'l2_draft_pending'
         ORDER BY ai_drafts.created_at ASC LIMIT 1`,
      ).first<{ created_at: string }>(),
      // 日別トレンド（期間内を日単位で集計）
      c.env.DB.prepare(
        `SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS cnt
         FROM ai_decision_log WHERE created_at >= ?
         GROUP BY substr(created_at, 1, 10) ORDER BY day`,
      )
        .bind(sinceDate)
        .all<{ day: string; cnt: number }>(),
    ]);

    return c.json({
      success: true,
      data: {
        days,
        byLevel: levelStats.results,
        byOutcome: outcomeStats.results,
        byCategory: categoryStats.results,
        l3PendingCnt: l3Pending?.cnt ?? 0,
        l3OldestHours: l3Pending?.oldest_hours ?? 0,
        moneyFlagCount: moneyFlagCount?.cnt ?? 0,
        oldestPendingDraftAt: oldestDraft?.created_at ?? null,
        dailyTrend: dailyTrend?.results ?? [],
      },
    });
  } catch (e) {
    console.error('GET /api/cs/dashboard error:', e);
    return c.json({ success: false, error: `集計取得失敗: ${String(e).slice(0, 400)}` }, 500);
  }
});

cs.get('/api/cs/faqs', async (c) => {
  try {
    const faqs = await getActiveFaqs(c.env.DB);
    return c.json({ success: true, data: faqs });
  } catch (e) {
    console.error('GET /api/cs/faqs error:', e);
    return c.json({ success: false, error: `FAQ取得失敗: ${String(e).slice(0, 400)}` }, 500);
  }
});

// ==================== Gmail watch登録 ====================

cs.post('/api/cs/gmail/watch', async (c) => {
  try {
    const sa = getServiceAccount(c.env);
    if (!sa) return c.json({ success: false, error: 'Service account not configured' }, 500);

    const topic = c.env.GCP_PUBSUB_TOPIC ?? 'projects/oryzae/topics/cs-gmail-inbound';
    const results: Array<{ email: string; ok: boolean; error?: string; expiration?: string; labelId?: string }> = [];

    for (const email of MONITORED_GMAIL_ACCOUNTS) {
      try {
        const client = new GmailClient(sa, email);
        // CSラベルIDを取得（事前にユーザー側で「CS」ラベル + フィルタ作成済み想定）
        const labels = await client.listLabels();
        const csLabel = labels.labels?.find((l) => l.name === CS_LABEL_NAME);
        if (!csLabel) {
          results.push({
            email,
            ok: false,
            error: `Label "${CS_LABEL_NAME}" not found. Create it in Gmail first (with a filter that auto-applies to CS-bound mail).`,
          });
          continue;
        }
        const watch = await client.watch(topic, [csLabel.id]);
        await upsertGmailWatchState(c.env.DB, email, watch.historyId, watch.expiration);
        results.push({ email, ok: true, expiration: watch.expiration, labelId: csLabel.id });
      } catch (e) {
        results.push({ email, ok: false, error: String(e) });
      }
    }

    return c.json({ success: true, data: results });
  } catch (e) {
    console.error('POST /api/cs/gmail/watch error:', e);
    return c.json({ success: false, error: `watch登録失敗: ${String(e).slice(0, 400)}` }, 500);
  }
});

// ==================== 手動再トリアージ ====================

cs.post('/api/cs/triage/:chatId', async (c) => {
  try {
    const chatId = c.req.param('chatId');
    const lastMsg = await c.env.DB.prepare(
      `SELECT * FROM cs_messages WHERE chat_id = ? AND direction = 'incoming' ORDER BY created_at DESC LIMIT 1`,
    )
      .bind(chatId)
      .first<{
        id: string;
        body_text: string;
        subject: string | null;
        from_address: string | null;
      }>();
    if (!lastMsg) return c.json({ success: false, error: 'No incoming message' }, 404);

    const chat = await c.env.DB.prepare(`SELECT channel, customer_email FROM chats WHERE id = ?`)
      .bind(chatId)
      .first<{ channel: string; customer_email: string | null }>();
    if (!chat?.customer_email) return c.json({ success: false, error: 'No customer email' }, 400);

    await runTriageForMessage(
      c.env,
      chatId,
      lastMsg.id,
      lastMsg.body_text,
      lastMsg.subject,
      chat.customer_email,
      chat.channel as CsChannel,
    );

    return c.json({ success: true });
  } catch (e) {
    console.error('POST /api/cs/triage/:chatId error:', e);
    return c.json({ success: false, error: `トリアージ失敗: ${String(e).slice(0, 400)}` }, 500);
  }
});

// ==================== LINE受信からのトリアージ（webhook連携） ====================

/**
 * LINEの受信メッセージをAIトリアージに掛ける。
 * 送信は必ず人間承認に回す（allowAutoSend=false）。webhook側のLINE自動返信
 * （LINE_AI_AUTOREPLY_ENABLED）と二重返信しないための設計。
 */
export async function runLineTriage(
  env: Env['Bindings'],
  params: { chatId: string; friendId: string; messageId: string; text: string; customerName?: string | null },
): Promise<void> {
  await runTriageForMessage(
    env,
    params.chatId,
    params.messageId,
    params.text,
    null,
    null,
    'line',
    { lineFriendId: params.friendId, allowAutoSend: false, customerName: params.customerName ?? null },
  );
}
