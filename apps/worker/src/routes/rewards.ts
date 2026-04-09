import { Hono } from 'hono';
import {
  getRewardItems,
  getRewardItem,
  createRewardItem,
  updateRewardItem,
  deleteRewardItem,
  decrementRewardStock,
  createRewardExchange,
  getRewardExchanges,
  updateRewardExchangeStatus,
  getLoyaltyPoint,
  getLoyaltyPointByShopifyCustomerId,
  upsertLoyaltyPoint,
  addLoyaltyTransaction,
  type RewardItemStatus,
  type ExchangeStatus,
} from '@line-crm/db';
import type { Env } from '../index.js';

const rewards = new Hono<Env>();

// ── 公開 API（Shopify ウィジェット用・認証不要）────────────────

// GET /api/rewards — アクティブなアイテム一覧
rewards.get('/api/rewards', async (c) => {
  try {
    const items = await getRewardItems(c.env.DB, { statusFilter: 'active' });
    return c.json({ success: true, data: items });
  } catch {
    return c.json({ success: false, error: 'Failed to fetch rewards' }, 500);
  }
});

// POST /api/rewards/:id/exchange — ポイントでアイテム交換
rewards.post('/api/rewards/:id/exchange', async (c) => {
  try {
    const itemId = c.req.param('id');
    const body = await c.req.json<{
      shopifyCustomerId?: string;
      friendId?: string;
    }>();

    // friend_id を解決
    let point = null;
    if (body.friendId) {
      point = await getLoyaltyPoint(c.env.DB, body.friendId);
    } else if (body.shopifyCustomerId) {
      point = await getLoyaltyPointByShopifyCustomerId(c.env.DB, body.shopifyCustomerId);
    }
    if (!point) return c.json({ success: false, error: '会員情報が見つかりません' }, 404);

    const item = await getRewardItem(c.env.DB, itemId);
    if (!item) return c.json({ success: false, error: 'アイテムが見つかりません' }, 404);
    if (item.status !== 'active') return c.json({ success: false, error: 'このアイテムは現在交換できません' }, 400);

    // ポイント残高チェック
    if (point.balance < item.required_points) {
      return c.json({
        success: false,
        error: `ポイントが不足しています（必要: ${item.required_points}pt / 残高: ${point.balance}pt）`,
      }, 400);
    }

    // 在庫チェック＆デクリメント
    const stockOk = await decrementRewardStock(c.env.DB, itemId);
    if (!stockOk) return c.json({ success: false, error: '在庫がありません' }, 400);

    // ポイント消費
    const newBalance = point.balance - item.required_points;
    await upsertLoyaltyPoint(c.env.DB, point.friend_id, {
      balance: newBalance,
      totalSpent: point.total_spent,
      rank: point.rank,
      shopifyCustomerId: point.shopify_customer_id ?? undefined,
    });
    await addLoyaltyTransaction(c.env.DB, {
      friendId: point.friend_id,
      type: 'redeem',
      points: -item.required_points,
      balanceAfter: newBalance,
      reason: `アイテム交換: ${item.name}`,
    });

    // 交換申請を記録
    const exchangeId = await createRewardExchange(c.env.DB, {
      friendId: point.friend_id,
      rewardItemId: itemId,
      rewardItemName: item.name,
      pointsSpent: item.required_points,
      shopifyCustomerId: body.shopifyCustomerId ?? point.shopify_customer_id ?? undefined,
    });

    return c.json({
      success: true,
      data: { exchangeId, newBalance, itemName: item.name, pointsSpent: item.required_points },
    });
  } catch (e) {
    return c.json({ success: false, error: 'Failed to exchange' }, 500);
  }
});

// ── 管理 API（認証あり）──────────────────────────────────────

// GET /api/rewards/admin — 全アイテム（管理用）
rewards.get('/api/rewards/admin', async (c) => {
  try {
    const items = await getRewardItems(c.env.DB, { statusFilter: 'all' });
    return c.json({ success: true, data: items });
  } catch {
    return c.json({ success: false, error: 'Failed to fetch rewards' }, 500);
  }
});

// POST /api/rewards/admin — アイテム作成
rewards.post('/api/rewards/admin', async (c) => {
  try {
    const body = await c.req.json<{
      name: string;
      description?: string;
      image_url?: string;
      required_points: number;
      status?: RewardItemStatus;
      track_inventory?: boolean;
      stock?: number | null;
      requires_shipping?: boolean;
    }>();
    if (!body.name?.trim()) return c.json({ success: false, error: 'name は必須です' }, 400);
    if (typeof body.required_points !== 'number' || body.required_points < 0) {
      return c.json({ success: false, error: 'required_points は0以上の数値で指定してください' }, 400);
    }
    const id = await createRewardItem(c.env.DB, body);
    return c.json({ success: true, data: { id } }, 201);
  } catch {
    return c.json({ success: false, error: 'Failed to create reward item' }, 500);
  }
});

// GET /api/rewards/admin/:id
rewards.get('/api/rewards/admin/:id', async (c) => {
  try {
    const item = await getRewardItem(c.env.DB, c.req.param('id'));
    if (!item) return c.json({ success: false, error: 'Not found' }, 404);
    return c.json({ success: true, data: item });
  } catch {
    return c.json({ success: false, error: 'Failed to fetch reward item' }, 500);
  }
});

// PUT /api/rewards/admin/:id
rewards.put('/api/rewards/admin/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const existing = await getRewardItem(c.env.DB, id);
    if (!existing) return c.json({ success: false, error: 'Not found' }, 404);
    const body = await c.req.json<Parameters<typeof updateRewardItem>[2]>();
    await updateRewardItem(c.env.DB, id, body);
    return c.json({ success: true });
  } catch {
    return c.json({ success: false, error: 'Failed to update reward item' }, 500);
  }
});

// DELETE /api/rewards/admin/:id
rewards.delete('/api/rewards/admin/:id', async (c) => {
  try {
    await deleteRewardItem(c.env.DB, c.req.param('id'));
    return c.json({ success: true });
  } catch {
    return c.json({ success: false, error: 'Failed to delete reward item' }, 500);
  }
});

// GET /api/rewards/exchanges — 交換申請一覧（管理用）
rewards.get('/api/rewards/exchanges', async (c) => {
  try {
    const status = (c.req.query('status') ?? 'all') as ExchangeStatus | 'all';
    const limit = parseInt(c.req.query('limit') ?? '20', 10);
    const offset = parseInt(c.req.query('offset') ?? '0', 10);
    const result = await getRewardExchanges(c.env.DB, { status, limit, offset });
    return c.json({ success: true, data: result.items, total: result.total });
  } catch {
    return c.json({ success: false, error: 'Failed to fetch exchanges' }, 500);
  }
});

// PUT /api/rewards/exchanges/:id/status — 申請ステータス更新
rewards.put('/api/rewards/exchanges/:id/status', async (c) => {
  try {
    const id = c.req.param('id');
    const body = await c.req.json<{ status: ExchangeStatus; notes?: string }>();
    const VALID = ['pending', 'fulfilled', 'cancelled'];
    if (!VALID.includes(body.status)) {
      return c.json({ success: false, error: 'status は pending / fulfilled / cancelled のいずれかです' }, 400);
    }
    await updateRewardExchangeStatus(c.env.DB, id, body.status, body.notes);
    return c.json({ success: true });
  } catch {
    return c.json({ success: false, error: 'Failed to update exchange status' }, 500);
  }
});

export { rewards };
