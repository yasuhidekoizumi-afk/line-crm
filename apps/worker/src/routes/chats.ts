import { Hono } from 'hono';
import { extractFlexAltText } from '../utils/flex-alt-text.js';
import { toDisplayContent } from '../utils/message-preview.js';
import { sendCsEmailReply } from '../services/cs-email-reply.js';
import { classifyAndSaveChatIntent } from '../services/chat-intent.js';
import {
  getOperators, getOperatorById, createOperator, updateOperator, deleteOperator,
  getChats, getChatById, createChat, updateChat, markChatsRead, jstNow,
} from '@line-crm/db';
import type { Env } from '../index.js';

const chats = new Hono<Env>();

// ========== オペレーターCRUD ==========

chats.get('/api/operators', async (c) => {
  try {
    const items = await getOperators(c.env.DB);
    return c.json({ success: true, data: items.map((o) => ({ id: o.id, name: o.name, email: o.email, role: o.role, isActive: Boolean(o.is_active), createdAt: o.created_at, updatedAt: o.updated_at })) });
  } catch { return c.json({ success: false, error: 'Internal server error' }, 500); }
});

chats.post('/api/operators', async (c) => {
  try {
    const body = await c.req.json<{ name: string; email: string; role?: string }>();
    if (!body.name || !body.email) return c.json({ success: false, error: 'name and email are required' }, 400);
    const item = await createOperator(c.env.DB, body);
    return c.json({ success: true, data: { id: item.id, name: item.name, email: item.email, role: item.role } }, 201);
  } catch { return c.json({ success: false, error: 'Internal server error' }, 500); }
});

chats.put('/api/operators/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const body = await c.req.json();
    await updateOperator(c.env.DB, id, body);
    const updated = await getOperatorById(c.env.DB, id);
    if (!updated) return c.json({ success: false, error: 'Not found' }, 404);
    return c.json({ success: true, data: { id: updated.id, name: updated.name, email: updated.email, role: updated.role, isActive: Boolean(updated.is_active) } });
  } catch { return c.json({ success: false, error: 'Internal server error' }, 500); }
});

chats.delete('/api/operators/:id', async (c) => {
  try { await deleteOperator(c.env.DB, c.req.param('id')); return c.json({ success: true, data: null }); }
  catch { return c.json({ success: false, error: 'Internal server error' }, 500); }
});

// ========== チャット一覧 ==========

/**
 * 未読数の定義（単一の情報源）。
 * 「スタッフの最終返信時刻」と「会話の既読位置(last_read_at)」のうち新しい方より後に届いた
 * 受信メッセージ数。一覧のバッジ・「未読」フィルタ・未読順ソートはすべてこの式を通す。
 * 対応済み(resolved)は未読として数えない（新着が来れば status は unread に戻る）。
 */
const UNREAD_EXPR = `(CASE WHEN c.status = 'resolved' THEN 0 ELSE (
  SELECT COUNT(*) FROM messages_log i
  WHERE i.friend_id = c.friend_id
    AND i.direction = 'incoming'
    AND i.created_at > MAX(COALESCE(staff_reply.last_reply_at, ''), COALESCE(c.last_read_at, ''))
) END)`;

/** 一覧1件分の共通SELECT（外側でフィルタ・ページングを掛ける） */
const CHAT_LIST_SELECT = `SELECT
  c.id, c.friend_id, c.operator_id, c.status, c.notes, c.last_message_at, c.created_at, c.updated_at,
  c.channel, c.customer_email, c.ai_status, c.ai_category, c.ai_money_flag,
  c.ai_intent, c.ai_intent_reason, c.ai_intent_at,
  c.assigned_staff_id, c.assigned_at, c.last_read_at,
  f.display_name, f.picture_url, f.line_user_id, f.line_account_id,
  sm.name AS assigned_staff_name,
  ${UNREAD_EXPR} AS unread_count,
  (SELECT MAX(i3.created_at) FROM messages_log i3
    WHERE i3.friend_id = c.friend_id AND i3.direction = 'incoming') AS last_incoming_at
FROM chats c
LEFT JOIN friends f ON c.friend_id = f.id
LEFT JOIN staff_members sm ON sm.id = c.assigned_staff_id
LEFT JOIN (
  SELECT friend_id, MAX(created_at) AS last_reply_at
  FROM messages_log
  WHERE direction = 'outgoing' AND broadcast_id IS NULL AND scenario_step_id IS NULL
  GROUP BY friend_id
) staff_reply ON staff_reply.friend_id = c.friend_id`;

/**
 * 「要返信候補」の絞り込み（判断ではなく、人が見る順番を決めるためのヒント）。
 * 文面の語だけで「返信不要なお礼」と「返信が必要な依頼」は区別できないため、
 * これで自動クローズはしない。UIのフィルタとしてだけ使う。
 */
const ATTENTION_KEYWORDS = [
  '退会', '解約', '返金', '返品', '交換', '届かない', '届きません', '未着', '不良', '破損', '壊れ',
  '賞味期限', '在庫', 'ないのでしょ', '間違', 'キャンセル', '変更', '修正', '依頼', '相談', '苦情', 'クレーム',
];
const ATTENTION_EXPR = (alias: string) => `EXISTS (
  SELECT 1 FROM messages_log a
  WHERE a.friend_id = ${alias}.friend_id AND a.direction = 'incoming'
    AND a.created_at = (SELECT MAX(a2.created_at) FROM messages_log a2
                        WHERE a2.friend_id = ${alias}.friend_id AND a2.direction = 'incoming')
    AND (${ATTENTION_KEYWORDS.map(() => "a.content LIKE ?").join(' OR ')})
)`;

/** 未読がある会話の「最後の顧客メッセージからの経過日数」。未読が無ければ null。 */
function waitingDays(lastIncomingAt: string | null, unreadCount: number): number | null {
  if (!lastIncomingAt || unreadCount <= 0) return null;
  const ts = Date.parse(lastIncomingAt);
  if (Number.isNaN(ts)) return null;
  return Math.max(0, Math.floor((Date.now() - ts) / 86_400_000));
}

/**
 * 一覧用の付加情報（最終メッセージのプレビュー・タグ）をまとめて取得する。
 * D1のバインド上限（100）に収めるため friend_id を90件ずつ区切る。
 */
async function enrichChatList(
  db: D1Database,
  friendIds: string[],
): Promise<{ preview: Map<string, string>; tags: Map<string, string[]> }> {
  const preview = new Map<string, string>();
  const tags = new Map<string, string[]>();
  const CHUNK = 90;

  for (let i = 0; i < friendIds.length; i += CHUNK) {
    const chunk = friendIds.slice(i, i + CHUNK);
    const placeholders = chunk.map(() => '?').join(',');
    const [previewRes, tagRes] = await Promise.all([
      // 最終メッセージのプレビュー（配信行は本文を持たないので配信タイトルを使う）
      db
        .prepare(
          `SELECT ml.friend_id,
             CASE
               WHEN ml.broadcast_id IS NOT NULL AND COALESCE(ml.content, '') = '' THEN '📢 ' || COALESCE(b.title, '一斉配信')
               WHEN ml.message_type = 'text' THEN substr(ml.content, 1, 120)
               WHEN ml.message_type = 'multi' THEN '📢 配信メッセージ'
               WHEN ml.message_type = 'image' THEN '[画像]'
               WHEN ml.message_type = 'sticker' THEN '[スタンプ]'
               WHEN ml.message_type = 'flex' THEN '[カード]'
               WHEN ml.message_type = 'imagemap' THEN '[リッチメッセージ]'
               ELSE substr(COALESCE(ml.content, ''), 1, 120)
             END AS preview
           FROM messages_log ml
           LEFT JOIN broadcasts b ON b.id = ml.broadcast_id
           WHERE ml.friend_id IN (${placeholders})
             AND ml.created_at = (SELECT MAX(m2.created_at) FROM messages_log m2 WHERE m2.friend_id = ml.friend_id)`,
        )
        .bind(...chunk)
        .all<{ friend_id: string; preview: string }>(),
      db
        .prepare(
          `SELECT ft.friend_id, GROUP_CONCAT(t.name, '|') AS names
           FROM friend_tags ft JOIN tags t ON t.id = ft.tag_id
           WHERE ft.friend_id IN (${placeholders}) GROUP BY ft.friend_id`,
        )
        .bind(...chunk)
        .all<{ friend_id: string; names: string }>(),
    ]);

    for (const row of previewRes.results ?? []) {
      if (!preview.has(row.friend_id)) preview.set(row.friend_id, row.preview ?? '');
    }
    for (const row of tagRes.results ?? []) {
      tags.set(row.friend_id, String(row.names ?? '').split('|').filter(Boolean));
    }
  }

  return { preview, tags };
}

chats.get('/api/chats', async (c) => {
  try {
    const status = c.req.query('status') ?? undefined;
    const operatorId = c.req.query('operatorId') ?? undefined;
    const lineAccountId = c.req.query('lineAccountId') ?? undefined;
    const channel = c.req.query('channel') ?? undefined;
    const assignedStaffId = c.req.query('assignedStaffId') ?? undefined;
    const intent = c.req.query('intent') ?? undefined;
    const q = (c.req.query('q') ?? '').trim();
    const attention = c.req.query('attention') === '1';
    const limit = Math.min(Math.max(Number(c.req.query('limit') ?? '100') || 100, 1), 500);
    const offset = Math.max(Number(c.req.query('offset') ?? '0') || 0, 0);
    const sortParam = c.req.query('sort');
    const sort = sortParam === 'unread' ? 'unread' : sortParam === 'stale' ? 'stale' : 'recent';

    // 要返信候補の判定は必要時だけ計算する（全件にEXISTSを回すと重い）
    const attentionParams = attention ? ATTENTION_KEYWORDS.map((k) => `%${k}%`) : [];
    const innerSql = attention
      ? `SELECT x.*, ${ATTENTION_EXPR('x')} AS needs_attention FROM (${CHAT_LIST_SELECT}) x`
      : `SELECT * FROM (${CHAT_LIST_SELECT}) x`;

    const conditions: string[] = [];
    const bindings: unknown[] = [];

    // 「未読」はメッセージベース。chats.status とは別軸（status は対応状況）。
    if (status === 'unread') {
      conditions.push('x.unread_count > 0');
    } else if (status) {
      conditions.push('x.status = ?'); bindings.push(status);
    }
    if (operatorId) { conditions.push('x.operator_id = ?'); bindings.push(operatorId); }
    // 選択中の公式LINEだけを表示する。メール問い合わせはアカウントに紐付かないため、
    // ここで混ぜるとギフティング担当者が別窓口の会話を見られてしまう。
    if (lineAccountId) { conditions.push('x.line_account_id = ?'); bindings.push(lineAccountId); }
    if (channel === 'email') { conditions.push("x.channel LIKE 'email_%'"); } else if (channel) { conditions.push('x.channel = ?'); bindings.push(channel); }
    if (assignedStaffId === 'me') {
      const staff = c.get('staff') as { id: string } | undefined;
      if (staff?.id) { conditions.push('x.assigned_staff_id = ?'); bindings.push(staff.id); }
    } else if (assignedStaffId) {
      conditions.push('x.assigned_staff_id = ?'); bindings.push(assignedStaffId);
    }
    // 顧客の最終メッセージの意図（AI判定済みのものだけ）
    if (intent === 'needs_reply' || intent === 'closing' || intent === 'unclear' || intent === 'unchecked') {
      if (intent === 'unchecked') conditions.push('x.ai_intent IS NULL');
      else { conditions.push('x.ai_intent = ?'); bindings.push(intent); }
    }
    if (q) {
      // 名前・メール・タグをサーバー側で検索する（読み込み済み分だけの検索をやめる）
      const like = `%${q}%`;
      conditions.push(`(COALESCE(x.display_name, '') LIKE ? OR COALESCE(x.customer_email, '') LIKE ?
        OR EXISTS (SELECT 1 FROM friend_tags ft JOIN tags t ON t.id = ft.tag_id
                   WHERE ft.friend_id = x.friend_id AND t.name LIKE ?))`);
      bindings.push(like, like, like);
    }

    if (attention) { conditions.push('x.needs_attention = 1'); }

    // 条件は外側の別名に付け替えて使う（一覧と件数で同じ条件を共有する）
    const whereFor = (alias: string) =>
      conditions.length > 0
        ? ' WHERE ' + conditions.map((cd) => cd.replace(/\bx\./g, `${alias}.`)).join(' AND ')
        : '';
    const order = sort === 'unread'
      ? ' ORDER BY x.unread_count DESC, x.last_message_at DESC'
      : sort === 'stale'
        ? ' ORDER BY (x.unread_count > 0) DESC, x.last_incoming_at ASC'
        : ' ORDER BY x.last_message_at DESC';

    const [listRes, countRes] = await Promise.all([
      c.env.DB.prepare(`${innerSql}${whereFor('x')}${order} LIMIT ? OFFSET ?`)
        .bind(...attentionParams, ...bindings, limit, offset)
        .all(),
      c.env.DB.prepare(`SELECT COUNT(*) AS n FROM (${innerSql}) cnt${whereFor('cnt')}`)
        .bind(...attentionParams, ...bindings)
        .first<{ n: number }>(),
    ]);

    const rows = (listRes.results ?? []) as Record<string, unknown>[];
    const friendIds = Array.from(new Set(rows.map((row) => String(row.friend_id ?? '')).filter(Boolean)));
    const enriched = friendIds.length > 0
      ? await enrichChatList(c.env.DB, friendIds).catch(() => ({ preview: new Map<string, string>(), tags: new Map<string, string[]>() }))
      : { preview: new Map<string, string>(), tags: new Map<string, string[]>() };

    const total = Number(countRes?.n ?? 0);

    return c.json({
      success: true,
      data: rows.map((ch: Record<string, unknown>) => {
        const isEmail = typeof ch.channel === 'string' && (ch.channel as string).startsWith('email_');
        const name = isEmail ? (ch.customer_email as string | null) || (ch.display_name as string | null) || '不明' : (ch.display_name as string | null) || '名前なし';
        const friendId = String(ch.friend_id ?? '');
        return {
          id: ch.id, friendId: ch.friend_id, friendName: name, friendPictureUrl: isEmail ? null : (ch.picture_url || null),
          operatorId: ch.operator_id, status: ch.status, notes: ch.notes, lastMessageAt: ch.last_message_at,
          createdAt: ch.created_at, updatedAt: ch.updated_at, channel: ch.channel ?? 'line', customerEmail: ch.customer_email ?? null,
          aiStatus: ch.ai_status ?? null, aiCategory: ch.ai_category ?? null, aiMoneyFlag: !!ch.ai_money_flag,
          aiIntent: ch.ai_intent ?? null, aiIntentReason: ch.ai_intent_reason ?? null, aiIntentAt: ch.ai_intent_at ?? null,
          assignedStaffId: ch.assigned_staff_id ?? null, assignedStaffName: ch.assigned_staff_name ?? null,
          lastReadAt: ch.last_read_at ?? null,
          lastIncomingAt: (ch.last_incoming_at as string | null) ?? null,
          waitingDays: waitingDays((ch.last_incoming_at as string | null) ?? null, Number(ch.unread_count ?? 0)),
          needsAttention: !!ch.needs_attention,
          preview: enriched.preview.get(friendId) ?? '',
          unreadCount: Number(ch.unread_count ?? 0),
          tags: enriched.tags.get(friendId) ?? [],
        };
      }),
      meta: { total, limit, offset, hasMore: offset + rows.length < total },
    });
  } catch { return c.json({ success: false, error: 'Internal server error' }, 500); }
});

// ========== 既読・担当 ==========

chats.post('/api/chats/read-all', async (c) => {
  try {
    const body = await c.req.json<{ ids?: string[] }>().catch(() => ({ ids: [] as string[] }));
    const ids = Array.isArray(body.ids) ? body.ids.filter((id): id is string => typeof id === 'string').slice(0, 500) : [];
    if (ids.length === 0) return c.json({ success: false, error: 'ids is required' }, 400);
    const updated = await markChatsRead(c.env.DB, ids, jstNow());
    return c.json({ success: true, data: { updated } });
  } catch { return c.json({ success: false, error: 'Internal server error' }, 500); }
});

chats.post('/api/chats/:id/read', async (c) => {
  try {
    const id = c.req.param('id');
    const chat = await getChatById(c.env.DB, id);
    if (!chat) return c.json({ success: false, error: 'Chat not found' }, 404);
    const readAt = jstNow();
    await updateChat(c.env.DB, id, { lastReadAt: readAt });
    return c.json({ success: true, data: { id, lastReadAt: readAt } });
  } catch { return c.json({ success: false, error: 'Internal server error' }, 500); }
});

/**
 * 自分を担当にする。既に別の人が担当している場合は上書きせず現状を返す
 * （同時対応の取り合いを避ける。交代したいときは PUT で明示的に指定する）。
 */
chats.post('/api/chats/:id/claim', async (c) => {
  try {
    const id = c.req.param('id');
    const staff = c.get('staff') as { id: string; name: string } | undefined;
    if (!staff?.id) return c.json({ success: false, error: 'Unauthorized' }, 401);
    const chat = await c.env.DB.prepare(
      `SELECT c.assigned_staff_id, sm.name AS assigned_staff_name FROM chats c
       LEFT JOIN staff_members sm ON sm.id = c.assigned_staff_id WHERE c.id = ?`,
    ).bind(id).first<{ assigned_staff_id: string | null; assigned_staff_name: string | null }>();
    if (!chat) return c.json({ success: false, error: 'Chat not found' }, 404);
    if (chat.assigned_staff_id && chat.assigned_staff_id !== staff.id) {
      return c.json({ success: false, error: `${chat.assigned_staff_name ?? '他のスタッフ'}が対応中です` }, 409);
    }
    await updateChat(c.env.DB, id, { assignedStaffId: staff.id });
    return c.json({ success: true, data: { id, assignedStaffId: staff.id, assignedStaffName: staff.name } });
  } catch { return c.json({ success: false, error: 'Internal server error' }, 500); }
});

// ========== 意図判定（要確認候補の抽出） ==========

/**
 * 顧客の最終メッセージの意図をAIで判定する。1回の最大は20件。
 * 残件数を返すので、画面から繰り返し呼べばバックフィルになる。
 *
 * 未読数・経過日数は「ハーネス上に返信記録があるか」しか表さないため、
 * 候補抽出は顧客側の意図（needs_reply / closing / unclear）で行う。
 */
chats.post('/api/chats/intent-classify', async (c) => {
  try {
    if (!c.env.GEMINI_API_KEY) return c.json({ success: false, error: 'GEMINI_API_KEY が未設定です' }, 400);
    const body = await c.req
      .json<{ limit?: number; chatIds?: string[] }>()
      .catch(() => ({} as { limit?: number; chatIds?: string[] }));
    const limit = Math.min(Math.max(Number(body.limit ?? 10) || 10, 1), 20);
    const ids = Array.isArray(body.chatIds)
      ? body.chatIds.filter((v): v is string => typeof v === 'string').slice(0, limit)
      : [];

    const pendingWhere = `(SELECT MAX(i.created_at) FROM messages_log i WHERE i.friend_id = c.friend_id AND i.direction = 'incoming') IS NOT NULL
      AND (c.ai_intent IS NULL OR c.ai_intent_at IS NULL
           OR c.ai_intent_at < (SELECT MAX(i2.created_at) FROM messages_log i2 WHERE i2.friend_id = c.friend_id AND i2.direction = 'incoming'))`;

    const targets = ids.length > 0
      ? ids
      : (((await c.env.DB.prepare(
          `SELECT c.id FROM chats c WHERE ${pendingWhere} ORDER BY c.last_message_at DESC LIMIT ?`,
        ).bind(limit).all<{ id: string }>()).results) ?? []).map((r) => r.id);

    const counts = { needs_reply: 0, closing: 0, unclear: 0, skipped: 0 };
    for (const id of targets) {
      const intent = await classifyAndSaveChatIntent(c.env, id);
      if (intent) counts[intent] += 1;
      else counts.skipped += 1;
    }

    const remaining = await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM chats c WHERE ${pendingWhere}`).first<{ n: number }>();

    return c.json({
      success: true,
      data: { processed: targets.length, ...counts, remaining: Number(remaining?.n ?? 0) },
    });
  } catch { return c.json({ success: false, error: 'Internal server error' }, 500); }
});

// ========== チャット詳細（パフォーマンス改善: LIMIT 200→30、contentは件数分だけ後で取得） ==========

chats.get('/api/chats/:id', async (c) => {
  try {
    const item = await getChatById(c.env.DB, c.req.param('id'));
    if (!item) return c.json({ success: false, error: 'Chat not found' }, 404);

    // ページング: before（これより古いメッセージを取る）/ limit（既定30・最大100）
    const before = c.req.query('before') ?? null;
    const limit = Math.min(Math.max(Number(c.req.query('limit') ?? '30') || 30, 1), 100);
    const lineWhere = before ? 'AND ml.created_at < ?' : '';
    const emailWhere = before ? 'AND created_at < ?' : '';
    const lineStmt = before
      ? c.env.DB.prepare(`SELECT ml.id, ml.direction, ml.message_type, COALESCE(NULLIF(ml.content, ''), b.message_content, '') AS content, ml.created_at FROM messages_log ml LEFT JOIN broadcasts b ON b.id = ml.broadcast_id WHERE ml.friend_id = ? ${lineWhere} ORDER BY ml.created_at DESC LIMIT ?`).bind(item.friend_id, before, limit)
      : c.env.DB.prepare(`SELECT ml.id, ml.direction, ml.message_type, COALESCE(NULLIF(ml.content, ''), b.message_content, '') AS content, ml.created_at FROM messages_log ml LEFT JOIN broadcasts b ON b.id = ml.broadcast_id WHERE ml.friend_id = ? ${lineWhere} ORDER BY ml.created_at DESC LIMIT ?`).bind(item.friend_id, limit);
    const emailStmt = before
      ? c.env.DB.prepare(`SELECT id, direction, subject, body_text, from_address, to_address, created_at FROM cs_messages WHERE chat_id = ? ${emailWhere} ORDER BY created_at DESC LIMIT ?`).bind(item.id, before, limit)
      : c.env.DB.prepare(`SELECT id, direction, subject, body_text, from_address, to_address, created_at FROM cs_messages WHERE chat_id = ? ${emailWhere} ORDER BY created_at DESC LIMIT ?`).bind(item.id, limit);

    const [friend, lineMessages, csMessages, chatExt] = await Promise.all([
      c.env.DB.prepare(`SELECT display_name, picture_url, line_user_id FROM friends WHERE id = ?`).bind(item.friend_id).first(),
      // 一斉配信の控えは本文を複製せず保存している（D1の容量・リクエスト上限対策）ため、
      // 配信本体から本文を補完する。個別送信・シナリオ配信は従来どおり content を持つ。
      // 直近N件を取る（ASC+LIMITだと「古いN件」になり、最新の返信が見えなくなる）。
      lineStmt.all(),
      emailStmt.all(),
      c.env.DB.prepare(
        `SELECT c.channel, c.customer_email, c.ai_status, c.ai_category, c.ai_confidence, c.ai_money_flag,
                c.ai_intent, c.ai_intent_reason, c.ai_intent_at,
                c.assigned_staff_id, c.assigned_at, c.last_read_at, sm.name AS assigned_staff_name
         FROM chats c LEFT JOIN staff_members sm ON sm.id = c.assigned_staff_id WHERE c.id = ?`,
      ).bind(item.id).first(),
    ]);

    interface UnifiedMessage { id: string; direction: string; messageType: string; content: string; createdAt: string; meta?: { subject?: string | null; from?: string | null; to?: string | null } }
    const unified: UnifiedMessage[] = [];
    for (const m of lineMessages.results as Record<string, unknown>[]) {
      const type = m.message_type as string;
      // 画像はUI側で表示できるよう、JSON（URL）をそのまま返す
      const content = type === 'image' ? ((m.content as string) ?? '') : toDisplayContent(type, (m.content as string) ?? '');
      unified.push({ id: m.id as string, direction: m.direction as string, messageType: type, content, createdAt: m.created_at as string });
    }
    for (const m of csMessages.results as Record<string, unknown>[]) {
      unified.push({ id: m.id as string, direction: m.direction as string, messageType: 'email', content: (m.body_text as string) ?? '', createdAt: m.created_at as string, meta: { subject: (m.subject as string | null) ?? null, from: (m.from_address as string | null) ?? null, to: (m.to_address as string | null) ?? null } });
    }
    unified.sort((a, b) => a.createdAt.localeCompare(b.createdAt));

    // これより古いメッセージが残っているか（「もっと見る」の表示判定）
    const oldestShown = unified[0]?.createdAt ?? null;
    let hasMore = false;
    if (oldestShown) {
      const [olderLine, olderEmail] = await Promise.all([
        c.env.DB.prepare(`SELECT 1 AS x FROM messages_log WHERE friend_id = ? AND created_at < ? LIMIT 1`).bind(item.friend_id, oldestShown).first(),
        c.env.DB.prepare(`SELECT 1 AS x FROM cs_messages WHERE chat_id = ? AND created_at < ? LIMIT 1`).bind(item.id, oldestShown).first(),
      ]);
      hasMore = Boolean(olderLine || olderEmail);
    }

    const isEmail = typeof chatExt?.channel === 'string' && (chatExt.channel as string).startsWith('email_');
    const displayName = isEmail ? (chatExt?.customer_email as string | null) ?? (friend as any)?.display_name ?? '不明' : (friend as any)?.display_name ?? '名前なし';

    return c.json({
      success: true,
      data: {
        id: item.id, friendId: item.friend_id, friendName: displayName, friendPictureUrl: isEmail ? null : (friend as any)?.picture_url ?? null,
        operatorId: item.operator_id, status: item.status, notes: item.notes, lastMessageAt: item.last_message_at, createdAt: item.created_at,
        channel: chatExt?.channel ?? 'line', customerEmail: chatExt?.customer_email ?? null,
        aiStatus: chatExt?.ai_status ?? null, aiCategory: chatExt?.ai_category ?? null, aiConfidence: (chatExt as any)?.ai_confidence ?? null, aiMoneyFlag: !!(chatExt as any)?.ai_money_flag,
        aiIntent: (chatExt as any)?.ai_intent ?? null, aiIntentReason: (chatExt as any)?.ai_intent_reason ?? null, aiIntentAt: (chatExt as any)?.ai_intent_at ?? null,
        assignedStaffId: (chatExt as any)?.assigned_staff_id ?? null, assignedStaffName: (chatExt as any)?.assigned_staff_name ?? null,
        assignedAt: (chatExt as any)?.assigned_at ?? null, lastReadAt: (chatExt as any)?.last_read_at ?? null,
        messages: unified, hasMore,
      },
    });
  } catch { return c.json({ success: false, error: 'Internal server error' }, 500); }
});

chats.post('/api/chats', async (c) => {
  try {
    const body = await c.req.json<{ friendId: string; operatorId?: string; lineAccountId?: string | null }>();
    if (!body.friendId) return c.json({ success: false, error: 'friendId is required' }, 400);
    const item = await createChat(c.env.DB, body);
    if (body.lineAccountId) { await c.env.DB.prepare(`UPDATE chats SET line_account_id = ? WHERE id = ?`).bind(body.lineAccountId, item.id).run(); }
    return c.json({ success: true, data: { id: item.id, friendId: item.friend_id, status: item.status } }, 201);
  } catch { return c.json({ success: false, error: 'Internal server error' }, 500); }
});

chats.put('/api/chats/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const body = await c.req.json<{ operatorId?: string | null; status?: string; notes?: string; assignedStaffId?: string | null }>();
    await updateChat(c.env.DB, id, body);
    const updated = await getChatById(c.env.DB, id);
    if (!updated) return c.json({ success: false, error: 'Not found' }, 404);
    return c.json({ success: true, data: { id: updated.id, friendId: updated.friend_id, operatorId: updated.operator_id, status: updated.status, notes: updated.notes, assignedStaffId: updated.assigned_staff_id ?? null } });
  } catch { return c.json({ success: false, error: 'Internal server error' }, 500); }
});

chats.post('/api/chats/:id/send', async (c) => {
  try {
    const chatId = c.req.param('id');
    const chat = await getChatById(c.env.DB, chatId);
    if (!chat) return c.json({ success: false, error: 'Chat not found' }, 404);
    const body = await c.req.json<{ messageType?: string; content: string }>();
    if (!body.content) return c.json({ success: false, error: 'content is required' }, 400);

    // メール問い合わせのチャットは Gmail 経由でメールとして返信する（LINE送信は不可）
    const emailChat = await c.env.DB.prepare(
      `SELECT channel, customer_email, external_thread_id FROM chats WHERE id = ?`,
    )
      .bind(chatId)
      .first<{ channel: string | null; customer_email: string | null; external_thread_id: string | null }>();
    if (emailChat?.channel?.startsWith('email_')) {
      if (!emailChat.customer_email) {
        return c.json({ success: false, error: '送信先メールアドレスがありません' }, 400);
      }
      const lastIncoming = await c.env.DB.prepare(
        `SELECT subject, raw_metadata FROM cs_messages WHERE chat_id = ? AND direction = 'incoming' ORDER BY created_at DESC LIMIT 1`,
      )
        .bind(chatId)
        .first<{ subject: string | null; raw_metadata: string | null }>();
      let threadId = emailChat.external_thread_id;
      if (lastIncoming?.raw_metadata) {
        try {
          const meta = JSON.parse(lastIncoming.raw_metadata) as { threadId?: string };
          threadId = meta.threadId ?? threadId;
        } catch {
          // メタデータが壊れていてもスレッドIDなしで送信する
        }
      }
      const sent = await sendCsEmailReply(c.env, {
        chatId,
        customerEmail: emailChat.customer_email,
        channel: emailChat.channel,
        subject: lastIncoming?.subject ?? null,
        text: body.content,
        threadId,
      });
      if (!sent.ok) return c.json({ success: false, error: sent.error }, 502);
      await updateChat(c.env.DB, chatId, { status: 'in_progress', lastMessageAt: jstNow() });
      return c.json({ success: true, data: { sent: true, messageId: sent.id, channel: 'email' } });
    }
    // 複数公式LINEでは、会話相手が登録した公式LINEのチャネルアクセストークンで送信する。
    // 環境変数の共通トークンを使うと、別アカウントとして送信されて失敗する。
    // ただしアカウント未設定の友だち（旧データ）でも返信できるよう、LEFT JOINにして
    // 既定トークンへフォールバックする。
    const friend = await c.env.DB.prepare(`SELECT f.*, la.channel_access_token
      FROM friends f LEFT JOIN line_accounts la ON la.id = f.line_account_id
      WHERE f.id = ?`).bind(chat.friend_id).first();
    if (!friend) return c.json({ success: false, error: 'Friend not found' }, 404);
    const token = (friend as { channel_access_token?: string | null }).channel_access_token
      || c.env.LINE_CHANNEL_ACCESS_TOKEN;
    if (!token) return c.json({ success: false, error: 'LINE送信設定が見つかりません' }, 400);
    const { LineClient } = await import('@line-crm/line-sdk');
    const lineClient = new LineClient(token);
    const messageType = body.messageType ?? 'text';
    try {
      if (messageType === 'text') { await lineClient.pushTextMessage((friend as any).line_user_id, body.content); }
      else if (messageType === 'flex') { const contents = JSON.parse(body.content); await lineClient.pushFlexMessage((friend as any).line_user_id, extractFlexAltText(contents), contents); }
      else if (messageType === 'image') {
        const parsed = JSON.parse(body.content) as { originalContentUrl?: string; previewImageUrl?: string };
        if (!parsed.originalContentUrl) return c.json({ success: false, error: '画像URLが不正です' }, 400);
        await lineClient.pushMessage((friend as any).line_user_id, [{
          type: 'image',
          originalContentUrl: parsed.originalContentUrl,
          previewImageUrl: parsed.previewImageUrl || parsed.originalContentUrl,
        }]);
      }
      else if (messageType === 'sticker') {
        const parsed = JSON.parse(body.content) as { packageId?: string; stickerId?: string };
        if (!parsed.packageId || !parsed.stickerId) return c.json({ success: false, error: 'スタンプIDが不正です' }, 400);
        // line-sdk の Message 型に sticker が無いため、送信時のみ形を合わせる
        await lineClient.pushMessage((friend as any).line_user_id, [{
          type: 'sticker',
          packageId: parsed.packageId,
          stickerId: parsed.stickerId,
        }] as unknown as Parameters<typeof lineClient.pushMessage>[1]);
      }
      else { return c.json({ success: false, error: `未対応のメッセージ種別です: ${messageType}` }, 400); }
    } catch (sendErr) {
      console.error('POST /api/chats/:id/send LINE error:', sendErr);
      return c.json({ success: false, error: 'LINE側で送信できませんでした。時間をおいて再度お試しください。' }, 502);
    }
    const logId = crypto.randomUUID();
    await c.env.DB.prepare(`INSERT INTO messages_log (id, friend_id, direction, message_type, content, created_at) VALUES (?, ?, 'outgoing', ?, ?, ?)`).bind(logId, (friend as any).id, messageType, body.content, jstNow()).run();
    await updateChat(c.env.DB, chatId, { status: 'in_progress', lastMessageAt: jstNow() });
    return c.json({ success: true, data: { sent: true, messageId: logId } });
  } catch { return c.json({ success: false, error: 'Internal server error' }, 500); }
});

export { chats };
