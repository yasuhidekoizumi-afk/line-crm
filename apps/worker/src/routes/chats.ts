import { Hono } from 'hono';
import { extractFlexAltText } from '../utils/flex-alt-text.js';
import {
  getOperators,
  getOperatorById,
  createOperator,
  updateOperator,
  deleteOperator,
  getChats,
  getChatById,
  createChat,
  updateChat,
  jstNow,
} from '@line-crm/db';
import type { Env } from '../index.js';

const chats = new Hono<Env>();

function clampLoadingSeconds(value: number | undefined): number {
  const n = Number.isFinite(value) ? Math.floor(value as number) : 5;
  return Math.min(60, Math.max(5, n));
}

async function startLoadingAnimation(
  accessToken: string,
  chatId: string,
  loadingSeconds: number,
): Promise<void> {
  const response = await fetch('https://api.line.me/v2/bot/chat/loading/start', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ chatId, loadingSeconds }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(
      detail
        ? `LINE API error: ${response.status} - ${detail}`
        : `LINE API error: ${response.status}`,
    );
  }
}

// ========== オペレーターCRUD ==========

chats.get('/api/operators', async (c) => {
  try {
    const items = await getOperators(c.env.DB);
    return c.json({
      success: true,
      data: items.map((o) => ({
        id: o.id,
        name: o.name,
        email: o.email,
        role: o.role,
        isActive: Boolean(o.is_active),
        createdAt: o.created_at,
        updatedAt: o.updated_at,
      })),
    });
  } catch (err) {
    console.error('GET /api/operators error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

chats.post('/api/operators', async (c) => {
  try {
    const body = await c.req.json<{ name: string; email: string; role?: string }>();
    if (!body.name || !body.email) return c.json({ success: false, error: 'name and email are required' }, 400);
    const item = await createOperator(c.env.DB, body);
    return c.json({ success: true, data: { id: item.id, name: item.name, email: item.email, role: item.role } }, 201);
  } catch (err) {
    console.error('POST /api/operators error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

chats.put('/api/operators/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const body = await c.req.json();
    await updateOperator(c.env.DB, id, body);
    const updated = await getOperatorById(c.env.DB, id);
    if (!updated) return c.json({ success: false, error: 'Not found' }, 404);
    return c.json({ success: true, data: { id: updated.id, name: updated.name, email: updated.email, role: updated.role, isActive: Boolean(updated.is_active) } });
  } catch (err) {
    console.error('PUT /api/operators/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

chats.delete('/api/operators/:id', async (c) => {
  try {
    await deleteOperator(c.env.DB, c.req.param('id'));
    return c.json({ success: true, data: null });
  } catch (err) {
    console.error('DELETE /api/operators/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// ========== チャットCRUD ==========

chats.get('/api/chats', async (c) => {
  try {
    const status = c.req.query('status') ?? undefined;
    const operatorId = c.req.query('operatorId') ?? undefined;
    const lineAccountId = c.req.query('lineAccountId') ?? undefined;
    // channel: 'line' | 'email_support' | 'email_customer_support' | 'email' (= 全メール)
    const channel = c.req.query('channel') ?? undefined;

    // JOIN friends to get display_name and picture_url
    let sql = `SELECT c.*, f.display_name, f.picture_url, f.line_user_id
               FROM chats c
               LEFT JOIN friends f ON c.friend_id = f.id`;
    const conditions: string[] = [];
    const bindings: unknown[] = [];

    if (status) {
      conditions.push('c.status = ?');
      bindings.push(status);
    }
    if (operatorId) {
      conditions.push('c.operator_id = ?');
      bindings.push(operatorId);
    }
    if (lineAccountId) {
      // メールチャットは LINE アカウントに紐付かないので除外せず通す
      conditions.push("(f.line_account_id = ? OR c.channel LIKE 'email_%')");
      bindings.push(lineAccountId);
    }
    if (channel === 'email') {
      conditions.push("c.channel LIKE 'email_%'");
    } else if (channel) {
      conditions.push('c.channel = ?');
      bindings.push(channel);
    }

    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }
    sql += ' ORDER BY c.last_message_at DESC';

    const stmt = bindings.length > 0
      ? c.env.DB.prepare(sql).bind(...bindings)
      : c.env.DB.prepare(sql);
    const result = await stmt.all();

    return c.json({
      success: true,
      data: result.results.map((ch: Record<string, unknown>) => {
        const isEmail = typeof ch.channel === 'string' && (ch.channel as string).startsWith('email_');
        const name = isEmail
          ? (ch.customer_email as string | null) || (ch.display_name as string | null) || '不明'
          : (ch.display_name as string | null) || '名前なし';
        return {
          id: ch.id,
          friendId: ch.friend_id,
          friendName: name,
          friendPictureUrl: isEmail ? null : (ch.picture_url || null),
          operatorId: ch.operator_id,
          status: ch.status,
          notes: ch.notes,
          lastMessageAt: ch.last_message_at,
          createdAt: ch.created_at,
          updatedAt: ch.updated_at,
          channel: ch.channel ?? 'line',
          customerEmail: ch.customer_email ?? null,
          aiStatus: ch.ai_status ?? null,
          aiCategory: ch.ai_category ?? null,
          aiMoneyFlag: !!ch.ai_money_flag,
        };
      }),
    });
  } catch (err) {
    console.error('GET /api/chats error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

chats.get('/api/chats/:id', async (c) => {
  try {
    const item = await getChatById(c.env.DB, c.req.param('id'));
    if (!item) return c.json({ success: false, error: 'Chat not found' }, 404);

    // 友だち情報を取得
    const friend = await c.env.DB
      .prepare(`SELECT display_name, picture_url, line_user_id FROM friends WHERE id = ?`)
      .bind(item.friend_id)
      .first<{ display_name: string | null; picture_url: string | null; line_user_id: string }>();

    // LINE側メッセージ（messages_log）+ メール側メッセージ（cs_messages）をマージ
    const [lineMessages, csMessages, chatExt] = await Promise.all([
      c.env.DB
        .prepare(`SELECT id, direction, message_type, content, created_at FROM messages_log WHERE friend_id = ? ORDER BY created_at ASC LIMIT 200`)
        .bind(item.friend_id)
        .all(),
      c.env.DB
        .prepare(`SELECT id, direction, subject, body_text, from_address, to_address, created_at FROM cs_messages WHERE chat_id = ? ORDER BY created_at ASC LIMIT 200`)
        .bind(item.id)
        .all(),
      c.env.DB
        .prepare(`SELECT channel, customer_email, ai_status, ai_category, ai_confidence, ai_money_flag FROM chats WHERE id = ?`)
        .bind(item.id)
        .first<{ channel: string | null; customer_email: string | null; ai_status: string | null; ai_category: string | null; ai_confidence: number | null; ai_money_flag: number | null }>(),
    ]);

    interface UnifiedMessage {
      id: string;
      direction: string;
      messageType: string;
      content: string;
      createdAt: string;
      meta?: { subject?: string | null; from?: string | null; to?: string | null };
    }
    const unified: UnifiedMessage[] = [];
    for (const m of lineMessages.results as Record<string, unknown>[]) {
      unified.push({
        id: m.id as string,
        direction: m.direction as string,
        messageType: m.message_type as string,
        content: m.content as string,
        createdAt: m.created_at as string,
      });
    }
    for (const m of csMessages.results as Record<string, unknown>[]) {
      unified.push({
        id: m.id as string,
        direction: m.direction as string,
        messageType: 'email',
        content: (m.body_text as string) ?? '',
        createdAt: m.created_at as string,
        meta: {
          subject: (m.subject as string | null) ?? null,
          from: (m.from_address as string | null) ?? null,
          to: (m.to_address as string | null) ?? null,
        },
      });
    }
    unified.sort((a, b) => a.createdAt.localeCompare(b.createdAt));

    const isEmail = typeof chatExt?.channel === 'string' && chatExt.channel.startsWith('email_');
    const displayName = isEmail
      ? (chatExt?.customer_email ?? friend?.display_name ?? '不明')
      : (friend?.display_name ?? '名前なし');

    return c.json({
      success: true,
      data: {
        id: item.id,
        friendId: item.friend_id,
        friendName: displayName,
        friendPictureUrl: isEmail ? null : (friend?.picture_url || null),
        operatorId: item.operator_id,
        status: item.status,
        notes: item.notes,
        lastMessageAt: item.last_message_at,
        createdAt: item.created_at,
        channel: chatExt?.channel ?? 'line',
        customerEmail: chatExt?.customer_email ?? null,
        aiStatus: chatExt?.ai_status ?? null,
        aiCategory: chatExt?.ai_category ?? null,
        aiConfidence: chatExt?.ai_confidence ?? null,
        aiMoneyFlag: !!chatExt?.ai_money_flag,
        messages: unified,
      },
    });
  } catch (err) {
    console.error('GET /api/chats/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

chats.post('/api/chats', async (c) => {
  try {
    const body = await c.req.json<{ friendId: string; operatorId?: string; lineAccountId?: string | null }>();
    if (!body.friendId) return c.json({ success: false, error: 'friendId is required' }, 400);
    const item = await createChat(c.env.DB, body);
    // Save line_account_id if provided
    if (body.lineAccountId) {
      await c.env.DB.prepare(`UPDATE chats SET line_account_id = ? WHERE id = ?`)
        .bind(body.lineAccountId, item.id).run();
    }
    return c.json({ success: true, data: { id: item.id, friendId: item.friend_id, status: item.status } }, 201);
  } catch (err) {
    console.error('POST /api/chats error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// チャットのアサイン/ステータス更新/ノート更新
chats.put('/api/chats/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const body = await c.req.json<{ operatorId?: string | null; status?: string; notes?: string }>();
    await updateChat(c.env.DB, id, body);
    const updated = await getChatById(c.env.DB, id);
    if (!updated) return c.json({ success: false, error: 'Not found' }, 404);
    return c.json({
      success: true,
      data: { id: updated.id, friendId: updated.friend_id, operatorId: updated.operator_id, status: updated.status, notes: updated.notes },
    });
  } catch (err) {
    console.error('PUT /api/chats/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// オペレーター入力中のローディング表示を開始
chats.post('/api/chats/:id/loading', async (c) => {
  try {
    const chatId = c.req.param('id');
    const chat = await getChatById(c.env.DB, chatId);
    if (!chat) return c.json({ success: false, error: 'Chat not found' }, 404);

    let loadingSecondsInput: number | undefined;
    try {
      const body = await c.req.json<{ loadingSeconds?: number }>();
      loadingSecondsInput = body.loadingSeconds;
    } catch {
      loadingSecondsInput = undefined;
    }
    const loadingSeconds = clampLoadingSeconds(loadingSecondsInput);

    const friend = await c.env.DB
      .prepare(`SELECT * FROM friends WHERE id = ?`)
      .bind(chat.friend_id)
      .first<{ id: string; line_user_id: string }>();
    if (!friend) return c.json({ success: false, error: 'Friend not found' }, 404);

    await startLoadingAnimation(
      c.env.LINE_CHANNEL_ACCESS_TOKEN,
      friend.line_user_id,
      loadingSeconds,
    );

    return c.json({ success: true, data: { started: true, loadingSeconds } });
  } catch (err) {
    console.error('POST /api/chats/:id/loading error:', err);
    const message = err instanceof Error ? err.message : 'Internal server error';
    return c.json({ success: false, error: message }, 500);
  }
});

// オペレーターからメッセージ送信
chats.post('/api/chats/:id/send', async (c) => {
  try {
    const chatId = c.req.param('id');
    const chat = await getChatById(c.env.DB, chatId);
    if (!chat) return c.json({ success: false, error: 'Chat not found' }, 404);

    const body = await c.req.json<{ messageType?: string; content: string }>();
    if (!body.content) return c.json({ success: false, error: 'content is required' }, 400);

    const friend = await c.env.DB
      .prepare(`SELECT * FROM friends WHERE id = ?`)
      .bind(chat.friend_id)
      .first<{ id: string; line_user_id: string }>();
    if (!friend) return c.json({ success: false, error: 'Friend not found' }, 404);

    // LINE APIでメッセージ送信
    const { LineClient } = await import('@line-crm/line-sdk');
    const lineClient = new LineClient(c.env.LINE_CHANNEL_ACCESS_TOKEN);
    const messageType = body.messageType ?? 'text';

    if (messageType === 'text') {
      await lineClient.pushTextMessage(friend.line_user_id, body.content);
    } else if (messageType === 'flex') {
      const contents = JSON.parse(body.content);
      await lineClient.pushFlexMessage(friend.line_user_id, extractFlexAltText(contents), contents);
    }

    // メッセージログに記録
    const logId = crypto.randomUUID();
    await c.env.DB
      .prepare(`INSERT INTO messages_log (id, friend_id, direction, message_type, content, created_at) VALUES (?, ?, 'outgoing', ?, ?, ?)`)
      .bind(logId, friend.id, messageType, body.content, jstNow())
      .run();

    // チャットの最終メッセージ日時を更新
    await updateChat(c.env.DB, chatId, { status: 'in_progress', lastMessageAt: jstNow() });

    return c.json({ success: true, data: { sent: true, messageId: logId } });
  } catch (err) {
    console.error('POST /api/chats/:id/send error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

export { chats };
