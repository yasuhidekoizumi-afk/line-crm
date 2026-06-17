import { Hono } from 'hono';
import {
  getLineAccounts,
  getLineAccountById,
  createLineAccount,
  updateLineAccount,
  deleteLineAccount,
} from '@line-crm/db';
import type { LineAccount as DbLineAccount } from '@line-crm/db';
import { requireRole } from '../middleware/role-guard.js';
import type { Env } from '../index.js';

const lineAccounts = new Hono<Env>();

function serializeLineAccount(row: DbLineAccount) {
  return {
    id: row.id,
    channelId: row.channel_id,
    name: row.name,
    isActive: Boolean(row.is_active),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    // Intentionally omit channelAccessToken and channelSecret from list responses
  };
}

function serializeLineAccountFull(row: DbLineAccount) {
  return {
    ...serializeLineAccount(row),
    channelAccessToken: row.channel_access_token,
    channelSecret: row.channel_secret,
  };
}

// Fetch bot profile (displayName, pictureUrl) from LINE API
async function fetchBotProfile(accessToken: string): Promise<{ displayName?: string; pictureUrl?: string; basicId?: string }> {
  try {
    const res = await fetch('https://api.line.me/v2/bot/info', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return {};
    const data = await res.json() as { displayName?: string; pictureUrl?: string; basicId?: string };
    return { displayName: data.displayName, pictureUrl: data.pictureUrl, basicId: data.basicId };
  } catch {
    return {};
  }
}

// GET /api/line-accounts - list all (with LINE profile + stats)
lineAccounts.get('/api/line-accounts', async (c) => {
  try {
    const db = c.env.DB;
    const items = await getLineAccounts(db);

    // Get stats for all accounts in parallel
    const results = await Promise.all(
      items.map(async (item) => {
        const [profile, friendCount, scenarioCount, msgCount] = await Promise.all([
          fetchBotProfile(item.channel_access_token),
          db.prepare(`SELECT COUNT(*) as count FROM friends WHERE is_following = 1 AND line_account_id = ?`).bind(item.id).first<{ count: number }>(),
          db.prepare(
            `SELECT COUNT(*) as count FROM friend_scenarios fs
             INNER JOIN friends f ON f.id = fs.friend_id
             WHERE fs.status = 'active' AND f.line_account_id = ?`,
          ).bind(item.id).first<{ count: number }>(),
          db.prepare(
            `SELECT COUNT(*) as count FROM messages_log ml
             INNER JOIN friends f ON f.id = ml.friend_id
             WHERE ml.direction = 'outgoing' AND (ml.delivery_type IS NULL OR ml.delivery_type = 'push') AND ml.created_at >= date('now', '-30 days') AND f.line_account_id = ?`,
          ).bind(item.id).first<{ count: number }>(),
        ]);

        return {
          ...serializeLineAccount(item),
          displayName: profile.displayName || item.name,
          pictureUrl: profile.pictureUrl || null,
          basicId: profile.basicId || null,
          stats: {
            friendCount: friendCount?.count ?? 0,
            activeScenarios: scenarioCount?.count ?? 0,
            messagesThisMonth: msgCount?.count ?? 0,
          },
        };
      }),
    );
    return c.json({ success: true, data: results });
  } catch (err) {
    console.error('GET /api/line-accounts error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// GET /api/line-accounts/:id - get single (secrets only for owner/admin)
lineAccounts.get('/api/line-accounts/:id', async (c) => {
  try {
    const account = await getLineAccountById(c.env.DB, c.req.param('id'));
    if (!account) {
      return c.json({ success: false, error: 'LINE account not found' }, 404);
    }
    const staff = c.get('staff');
    const data = staff?.role === 'staff'
      ? serializeLineAccount(account)
      : serializeLineAccountFull(account);
    return c.json({ success: true, data });
  } catch (err) {
    console.error('GET /api/line-accounts/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// POST /api/line-accounts - create
lineAccounts.post('/api/line-accounts', requireRole('owner', 'admin'), async (c) => {
  try {
    const body = await c.req.json<{
      channelId: string;
      name: string;
      channelAccessToken: string;
      channelSecret: string;
    }>();

    if (!body.channelId || !body.name || !body.channelAccessToken || !body.channelSecret) {
      return c.json(
        { success: false, error: 'channelId, name, channelAccessToken, and channelSecret are required' },
        400,
      );
    }

    const account = await createLineAccount(c.env.DB, body);
    return c.json({ success: true, data: serializeLineAccountFull(account) }, 201);
  } catch (err) {
    console.error('POST /api/line-accounts error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// PUT /api/line-accounts/:id - update
lineAccounts.put('/api/line-accounts/:id', requireRole('owner', 'admin'), async (c) => {
  try {
    const id = c.req.param('id')!;
    const body = await c.req.json<{
      name?: string;
      channelAccessToken?: string;
      channelSecret?: string;
      isActive?: boolean;
    }>();

    const updated = await updateLineAccount(c.env.DB, id, {
      name: body.name,
      channel_access_token: body.channelAccessToken,
      channel_secret: body.channelSecret,
      is_active: body.isActive !== undefined ? (body.isActive ? 1 : 0) : undefined,
    });

    if (!updated) {
      return c.json({ success: false, error: 'LINE account not found' }, 404);
    }
    return c.json({ success: true, data: serializeLineAccountFull(updated) });
  } catch (err) {
    console.error('PUT /api/line-accounts/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// DELETE /api/line-accounts/:id - delete
lineAccounts.delete('/api/line-accounts/:id', requireRole('owner', 'admin'), async (c) => {
  try {
    await deleteLineAccount(c.env.DB, c.req.param('id')!);
    return c.json({ success: true, data: null });
  } catch (err) {
    console.error('DELETE /api/line-accounts/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// GET /api/line/quota - 当月の配信数/上限（LINE公式ダッシュボードと同じ数字）
// totalUsage = 上限にカウントされた送信通数（公式の分子・例 41,717通）
// limit      = 当月のメッセージ配信上限（公式の分母・例 110,000通。type='none'なら無制限）
// 任意で ?accountId= 指定。未指定なら is_active なアカウントを使用。
lineAccounts.get('/api/line/quota', async (c) => {
  try {
    const accountId = c.req.query('accountId');
    const row = accountId
      ? await c.env.DB.prepare('SELECT channel_access_token FROM line_accounts WHERE id = ? LIMIT 1').bind(accountId).first<{ channel_access_token: string }>()
      : await c.env.DB.prepare('SELECT channel_access_token FROM line_accounts WHERE is_active = 1 ORDER BY created_at ASC LIMIT 1').first<{ channel_access_token: string }>();

    const token = row?.channel_access_token ?? c.env.LINE_CHANNEL_ACCESS_TOKEN;
    if (!token) {
      return c.json({ success: false, error: 'LINEアカウントが見つかりません' }, 404);
    }

    const { LineClient } = await import('@line-crm/line-sdk');
    const client = new LineClient(token);
    const [quota, consumption] = await Promise.all([
      client.getMessageQuota(),
      client.getMessageQuotaConsumption(),
    ]);

    const totalUsage = consumption.totalUsage ?? 0;
    const limit = quota.type === 'limited' ? (quota.value ?? null) : null;

    return c.json({
      success: true,
      data: {
        totalUsage,                 // 当月の送信通数（分子）
        limit,                      // 当月の上限（分母・無制限ならnull）
        type: quota.type,           // 'limited' | 'none'
        remaining: limit !== null ? Math.max(0, limit - totalUsage) : null,
        usagePct: limit ? Math.round((totalUsage / limit) * 100) : null,
      },
    });
  } catch (err) {
    console.error('GET /api/line/quota error:', err);
    return c.json({ success: false, error: '配信数の取得に失敗しました' }, 500);
  }
});

export { lineAccounts };
