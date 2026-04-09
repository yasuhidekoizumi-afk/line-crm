import { Hono } from 'hono';
import {
  getLoyaltyPoint,
  getLoyaltyPoints,
  getLoyaltyTransactions,
  getLoyaltyStats,
  upsertLoyaltyPoint,
  addLoyaltyTransaction,
  determineRank,
  calculatePoints,
  type LoyaltyRank,
} from '@line-crm/db';
import type { Env } from '../index.js';

const loyalty = new Hono<Env>();

// GET /api/loyalty/stats — ランク別サマリー
loyalty.get('/api/loyalty/stats', async (c) => {
  try {
    const stats = await getLoyaltyStats(c.env.DB);
    return c.json({ success: true, data: stats });
  } catch (e) {
    return c.json({ success: false, error: 'Failed to fetch stats' }, 500);
  }
});

// GET /api/loyalty — ポイント一覧（検索・ランク絞り込み）
loyalty.get('/api/loyalty', async (c) => {
  try {
    const limit = Math.min(Number(c.req.query('limit') ?? '20'), 100);
    const offset = Number(c.req.query('offset') ?? '0');
    const rankParam = c.req.query('rank');
    const rank = rankParam ? (rankParam as LoyaltyRank) : undefined;
    const search = c.req.query('search') ?? undefined;

    const result = await getLoyaltyPoints(c.env.DB, { limit, offset, rank, search });
    return c.json({ success: true, data: result });
  } catch (e) {
    return c.json({ success: false, error: 'Failed to fetch loyalty points' }, 500);
  }
});

// GET /api/loyalty/:friendId — 個別ポイント残高
loyalty.get('/api/loyalty/:friendId', async (c) => {
  try {
    const point = await getLoyaltyPoint(c.env.DB, c.req.param('friendId'));
    if (!point) return c.json({ success: false, error: 'Not found' }, 404);
    return c.json({ success: true, data: point });
  } catch (e) {
    return c.json({ success: false, error: 'Failed to fetch loyalty point' }, 500);
  }
});

// GET /api/loyalty/:friendId/transactions — 取引履歴
loyalty.get('/api/loyalty/:friendId/transactions', async (c) => {
  try {
    const limit = Math.min(Number(c.req.query('limit') ?? '20'), 100);
    const offset = Number(c.req.query('offset') ?? '0');
    const result = await getLoyaltyTransactions(c.env.DB, c.req.param('friendId'), { limit, offset });
    return c.json({ success: true, data: result });
  } catch (e) {
    return c.json({ success: false, error: 'Failed to fetch transactions' }, 500);
  }
});

// POST /api/loyalty/:friendId/adjust — ポイント手動調整（スタッフ操作）
loyalty.post('/api/loyalty/:friendId/adjust', async (c) => {
  try {
    const friendId = c.req.param('friendId');
    const body = await c.req.json<{ points: number; reason: string }>();

    if (typeof body.points !== 'number' || body.points === 0) {
      return c.json({ success: false, error: 'points must be a non-zero number' }, 400);
    }
    if (!body.reason || body.reason.trim() === '') {
      return c.json({ success: false, error: 'reason is required' }, 400);
    }

    const current = await getLoyaltyPoint(c.env.DB, friendId);
    const currentBalance = current?.balance ?? 0;
    const currentTotalSpent = current?.total_spent ?? 0;
    const newBalance = Math.max(0, currentBalance + body.points);
    const newRank = determineRank(currentTotalSpent);

    const staff = c.get('staff');

    await upsertLoyaltyPoint(c.env.DB, friendId, {
      balance: newBalance,
      totalSpent: currentTotalSpent,
      rank: newRank,
      shopifyCustomerId: current?.shopify_customer_id ?? undefined,
    });

    await addLoyaltyTransaction(c.env.DB, {
      friendId,
      type: 'adjust',
      points: body.points,
      balanceAfter: newBalance,
      reason: body.reason.trim(),
      staffId: staff?.id,
    });

    return c.json({ success: true, data: { balance: newBalance, rank: newRank } });
  } catch (e) {
    return c.json({ success: false, error: 'Failed to adjust points' }, 500);
  }
});

// POST /api/loyalty/award — 購入ポイント付与（Shopify Webhook / GAS から呼ぶ）
loyalty.post('/api/loyalty/award', async (c) => {
  try {
    const body = await c.req.json<{
      friendId: string;
      orderAmount: number;
      orderId?: string;
      shopifyCustomerId?: string;
    }>();

    if (!body.friendId || typeof body.orderAmount !== 'number' || body.orderAmount <= 0) {
      return c.json({ success: false, error: 'friendId and orderAmount are required' }, 400);
    }

    const current = await getLoyaltyPoint(c.env.DB, body.friendId);
    const currentBalance = current?.balance ?? 0;
    const currentTotalSpent = current?.total_spent ?? 0;

    const newTotalSpent = currentTotalSpent + body.orderAmount;
    const currentRank = determineRank(currentTotalSpent);
    const earnedPoints = calculatePoints(body.orderAmount, currentRank);
    const newBalance = currentBalance + earnedPoints;
    const newRank = determineRank(newTotalSpent);

    await upsertLoyaltyPoint(c.env.DB, body.friendId, {
      balance: newBalance,
      totalSpent: newTotalSpent,
      rank: newRank,
      shopifyCustomerId: body.shopifyCustomerId ?? current?.shopify_customer_id ?? undefined,
    });

    await addLoyaltyTransaction(c.env.DB, {
      friendId: body.friendId,
      type: 'award',
      points: earnedPoints,
      balanceAfter: newBalance,
      reason: `購入ポイント付与（¥${body.orderAmount.toLocaleString('ja-JP')}）`,
      orderId: body.orderId,
    });

    return c.json({
      success: true,
      data: {
        earnedPoints,
        balance: newBalance,
        rank: newRank,
        rankChanged: newRank !== currentRank,
        previousRank: currentRank,
      },
    });
  } catch (e) {
    return c.json({ success: false, error: 'Failed to award points' }, 500);
  }
});

export { loyalty };
