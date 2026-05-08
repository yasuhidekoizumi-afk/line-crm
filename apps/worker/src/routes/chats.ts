import { Hono } from 'hono';
import { extractFlexAltText } from '../utils/flex-alt-text.js';
import {
  getOperators, getOperatorById, createOperator, updateOperator, deleteOperator,
  getChats, getChatById, createChat, updateChat, jstNow,
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

// ========== チャット一覧（パフォーマンス改善: LIMIT追加） ==========

chats.get('/api/chats', async (c) => {
  try {
    const status = c.req.query('status') ?? undefined;
    const operatorId = c.req.query('operatorId') ?? undefined;
    const lineAccountId = c.req.query('lineAccountId') ?? undefined;
    const channel = c.req.query('channel') ?? undefined;

    let sql = `SELECT c.id, c.friend_id, c.operator_id, c.status, c.notes, c.last_message_at, c.created_at, c.updated_at, c.channel, c.customer_email, c.ai_status, c.ai_category, c.ai_money_flag,
               f.display_name, f.picture_url, f.line_user_id
               FROM chats c LEFT JOIN friends f ON c.friend_id = f.id`;
    const conditions: string[] = [];
    const bindings: unknown[] = [];

    if (status) { conditions.push('c.status = ?'); bindings.push(status); }
    if (operatorId) { conditions.push('c.operator_id = ?'); bindings.push(operatorId); }
    if (lineAccountId) { conditions.push("(f.line_account_id = ? OR c.channel LIKE 'email_%')"); bindings.push(lineAccountId); }
    if (channel === 'email') { conditions.push("c.channel LIKE 'email_%'"); } else if (channel) { conditions.push('c.channel = ?'); bindings.push(channel); }

    if (conditions.length > 0) sql += ' WHERE ' + conditions.join(' AND ');
    sql += ' ORDER BY c.last_message_at DESC LIMIT 100';

    const stmt = bindings.length > 0 ? c.env.DB.prepare(sql).bind(...bindings) : c.env.DB.prepare(sql);
    const result = await stmt.all();

    return c.json({
      success: true,
      data: result.results.map((ch: Record<string, unknown>) => {
        const isEmail = typeof ch.channel === 'string' && (ch.channel as string).startsWith('email_');
        const name = isEmail ? (ch.customer_email as string | null) || (ch.display_name as string | null) || '不明' : (ch.display_name as string | null) || '名前なし';
        return { id: ch.id, friendId: ch.friend_id, friendName: name, friendPictureUrl: isEmail ? null : (ch.picture_url || null), operatorId: ch.operator_id, status: ch.status, notes: ch.notes, lastMessageAt: ch.last_message_at, createdAt: ch.created_at, updatedAt: ch.updated_at, channel: ch.channel ?? 'line', customerEmail: ch.customer_email ?? null, aiStatus: ch.ai_status ?? null, aiCategory: ch.ai_category ?? null, aiMoneyFlag: !!ch.ai_money_flag };
      }),
    });
  } catch { return c.json({ success: false, error: 'Internal server error' }, 500); }
});

// ========== チャット詳細（パフォーマンス改善: LIMIT 200→30、contentは件数分だけ後で取得） ==========

chats.get('/api/chats/:id', async (c) => {
  try {
    const item = await getChatById(c.env.DB, c.req.param('id'));
    if (!item) return c.json({ success: false, error: 'Chat not found' }, 404);

    const [friend, lineMessages, csMessages, chatExt] = await Promise.all([
      c.env.DB.prepare(`SELECT display_name, picture_url, line_user_id FROM friends WHERE id = ?`).bind(item.friend_id).first(),
      c.env.DB.prepare(`SELECT id, direction, message_type, content, created_at FROM messages_log WHERE friend_id = ? ORDER BY created_at ASC LIMIT 30`).bind(item.friend_id).all(),
      c.env.DB.prepare(`SELECT id, direction, subject, body_text, from_address, to_address, created_at FROM cs_messages WHERE chat_id = ? ORDER BY created_at ASC LIMIT 30`).bind(item.id).all(),
      c.env.DB.prepare(`SELECT channel, customer_email, ai_status, ai_category, ai_confidence, ai_money_flag FROM chats WHERE id = ?`).bind(item.id).first(),
    ]);

    interface UnifiedMessage { id: string; direction: string; messageType: string; content: string; createdAt: string; meta?: { subject?: string | null; from?: string | null; to?: string | null } }
    const unified: UnifiedMessage[] = [];
    for (const m of lineMessages.results as Record<string, unknown>[]) {
      unified.push({ id: m.id as string, direction: m.direction as string, messageType: m.message_type as string, content: m.content as string, createdAt: m.created_at as string });
    }
    for (const m of csMessages.results as Record<string, unknown>[]) {
      unified.push({ id: m.id as string, direction: m.direction as string, messageType: 'email', content: (m.body_text as string) ?? '', createdAt: m.created_at as string, meta: { subject: (m.subject as string | null) ?? null, from: (m.from_address as string | null) ?? null, to: (m.to_address as string | null) ?? null } });
    }
    unified.sort((a, b) => a.createdAt.localeCompare(b.createdAt));

    const isEmail = typeof chatExt?.channel === 'string' && (chatExt.channel as string).startsWith('email_');
    const displayName = isEmail ? (chatExt?.customer_email as string | null) ?? (friend as any)?.display_name ?? '不明' : (friend as any)?.display_name ?? '名前なし';

    return c.json({
      success: true,
      data: { id: item.id, friendId: item.friend_id, friendName: displayName, friendPictureUrl: isEmail ? null : (friend as any)?.picture_url ?? null, operatorId: item.operator_id, status: item.status, notes: item.notes, lastMessageAt: item.last_message_at, createdAt: item.created_at, channel: chatExt?.channel ?? 'line', customerEmail: chatExt?.customer_email ?? null, aiStatus: chatExt?.ai_status ?? null, aiCategory: chatExt?.ai_category ?? null, aiConfidence: (chatExt as any)?.ai_confidence ?? null, aiMoneyFlag: !!(chatExt as any)?.ai_money_flag, messages: unified },
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
    const body = await c.req.json<{ operatorId?: string | null; status?: string; notes?: string }>();
    await updateChat(c.env.DB, id, body);
    const updated = await getChatById(c.env.DB, id);
    if (!updated) return c.json({ success: false, error: 'Not found' }, 404);
    return c.json({ success: true, data: { id: updated.id, friendId: updated.friend_id, operatorId: updated.operator_id, status: updated.status, notes: updated.notes } });
  } catch { return c.json({ success: false, error: 'Internal server error' }, 500); }
});

chats.post('/api/chats/:id/send', async (c) => {
  try {
    const chatId = c.req.param('id');
    const chat = await getChatById(c.env.DB, chatId);
    if (!chat) return c.json({ success: false, error: 'Chat not found' }, 404);
    const body = await c.req.json<{ messageType?: string; content: string }>();
    if (!body.content) return c.json({ success: false, error: 'content is required' }, 400);
    const friend = await c.env.DB.prepare(`SELECT * FROM friends WHERE id = ?`).bind(chat.friend_id).first();
    if (!friend) return c.json({ success: false, error: 'Friend not found' }, 404);
    const { LineClient } = await import('@line-crm/line-sdk');
    const lineClient = new LineClient(c.env.LINE_CHANNEL_ACCESS_TOKEN);
    const messageType = body.messageType ?? 'text';
    if (messageType === 'text') { await lineClient.pushTextMessage((friend as any).line_user_id, body.content); }
    else if (messageType === 'flex') { const contents = JSON.parse(body.content); await lineClient.pushFlexMessage((friend as any).line_user_id, extractFlexAltText(contents), contents); }
    const logId = crypto.randomUUID();
    await c.env.DB.prepare(`INSERT INTO messages_log (id, friend_id, direction, message_type, content, created_at) VALUES (?, ?, 'outgoing', ?, ?, ?)`).bind(logId, (friend as any).id, messageType, body.content, jstNow()).run();
    await updateChat(c.env.DB, chatId, { status: 'in_progress', lastMessageAt: jstNow() });
    return c.json({ success: true, data: { sent: true, messageId: logId } });
  } catch { return c.json({ success: false, error: 'Internal server error' }, 500); }
});

export { chats };
