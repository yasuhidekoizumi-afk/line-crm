import { Hono } from 'hono';
import {
  getLoyaltyPoint,
  getLoyaltyPointByShopifyCustomerId,
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

// ============================================================
// カスタマー向けエンドポイント（Shopify マイページから呼ぶ）
// 認証: Shopify の customer_id をキーにする。
// 認証ヘッダーは不要（Shopify Liquid から AJAX で呼ぶため）。
// ただし CORS は Worker 側で * を許可済み。
// ============================================================

// GET /api/loyalty/shopify/:shopifyCustomerId — ポイント残高確認
loyalty.get('/api/loyalty/shopify/:shopifyCustomerId', async (c) => {
  try {
    const point = await getLoyaltyPointByShopifyCustomerId(
      c.env.DB,
      c.req.param('shopifyCustomerId'),
    );
    if (!point) {
      // 未購入ユーザーはポイントなし → 0 を返す
      return c.json({
        success: true,
        data: { balance: 0, rank: 'レギュラー', total_spent: 0 },
      });
    }
    return c.json({
      success: true,
      data: {
        balance: point.balance,
        rank: point.rank,
        total_spent: point.total_spent,
      },
    });
  } catch (e) {
    return c.json({ success: false, error: 'Failed to fetch loyalty point' }, 500);
  }
});

// POST /api/loyalty/shopify/:shopifyCustomerId/redeem — ポイント → 割引コード発行
loyalty.post('/api/loyalty/shopify/:shopifyCustomerId/redeem', async (c) => {
  try {
    const shopifyCustomerId = c.req.param('shopifyCustomerId');
    const body = await c.req.json<{ points: number }>(); // 使うポイント数（100pt単位）

    if (!body.points || body.points <= 0 || body.points % 100 !== 0) {
      return c.json(
        { success: false, error: 'points は 100 の倍数で指定してください' },
        400,
      );
    }

    const point = await getLoyaltyPointByShopifyCustomerId(c.env.DB, shopifyCustomerId);
    if (!point || point.balance < body.points) {
      return c.json({ success: false, error: 'ポイント残高が不足しています' }, 400);
    }

    // Shopify Admin API でディスカウントコードを発行
    const shopDomain = c.env.SHOPIFY_SHOP_DOMAIN;
    const adminToken = c.env.SHOPIFY_ADMIN_TOKEN;
    if (!shopDomain || !adminToken) {
      return c.json(
        { success: false, error: 'Shopify 設定が未構成です（サーバー管理者にお問い合わせください）' },
        500,
      );
    }

    const discountAmount = body.points; // 100pt = ¥100
    const code = `KOJIPOP-${shopifyCustomerId.slice(-6)}-${Date.now().toString(36).toUpperCase()}`;

    // 1) Price Rule 作成
    const priceRuleRes = await fetch(
      `https://${shopDomain}/admin/api/2024-10/price_rules.json`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': adminToken,
        },
        body: JSON.stringify({
          price_rule: {
            title: `ポイント割引 ${code}`,
            target_type: 'line_item',
            target_selection: 'all',
            allocation_method: 'across',
            value_type: 'fixed_amount',
            value: `-${discountAmount}`,
            customer_selection: 'prerequisite',
            prerequisite_customer_ids: [shopifyCustomerId],
            once_per_customer: true,
            usage_limit: 1,
            starts_at: new Date().toISOString(),
          },
        }),
      },
    );

    if (!priceRuleRes.ok) {
      const err = await priceRuleRes.text();
      return c.json({ success: false, error: `Shopify Price Rule 作成失敗: ${err}` }, 500);
    }

    const priceRuleData = (await priceRuleRes.json()) as { price_rule: { id: number } };
    const priceRuleId = priceRuleData.price_rule.id;

    // 2) Discount Code 作成
    const discountRes = await fetch(
      `https://${shopDomain}/admin/api/2024-10/price_rules/${priceRuleId}/discount_codes.json`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': adminToken,
        },
        body: JSON.stringify({ discount_code: { code } }),
      },
    );

    if (!discountRes.ok) {
      const err = await discountRes.text();
      return c.json({ success: false, error: `Shopify Discount Code 作成失敗: ${err}` }, 500);
    }

    // 3) ポイント残高を減算
    const newBalance = point.balance - body.points;
    const newRank = determineRank(point.total_spent);
    await upsertLoyaltyPoint(c.env.DB, point.friend_id, {
      balance: newBalance,
      totalSpent: point.total_spent,
      rank: newRank,
      shopifyCustomerId,
    });

    await addLoyaltyTransaction(c.env.DB, {
      friendId: point.friend_id,
      type: 'redeem',
      points: -body.points,
      balanceAfter: newBalance,
      reason: `ポイント利用（¥${discountAmount}割引 / コード: ${code}）`,
    });

    return c.json({
      success: true,
      data: {
        code,
        discountAmount,
        pointsUsed: body.points,
        balanceAfter: newBalance,
      },
    });
  } catch (e) {
    return c.json({ success: false, error: 'Failed to redeem points' }, 500);
  }
});

export { loyalty };
