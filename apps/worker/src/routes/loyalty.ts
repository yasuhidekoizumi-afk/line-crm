import { Hono } from 'hono';
import {
  getLoyaltyPoint,
  getLoyaltyPointByShopifyCustomerId,
  getLoyaltyPoints,
  getLoyaltyTransactions,
  getLoyaltyTransactionsByShopifyCustomerId,
  getLoyaltyStats,
  getLoyaltySettings,
  getLoyaltySetting,
  setLoyaltySetting,
  getCampaigns,
  getCampaign,
  getActiveCampaigns,
  createCampaign,
  updateCampaign,
  deleteCampaign,
  applyCampaigns,
  getLatestRedeemTransaction,
  getExpiringSoonPoints,
  upsertLoyaltyPoint,
  addLoyaltyTransaction,
  determineRank,
  calculatePoints,
  type LoyaltyRank,
  type CampaignCondition,
  type CampaignActionType,
  type CampaignStatus,
} from '@line-crm/db';
import { saveOrderMetafields, saveCustomerMetafields } from '../services/shopify.js';
import type { Env } from '../index.js';

const loyalty = new Hono<Env>();

// GET /api/loyalty/settings — 設定一覧取得
loyalty.get('/api/loyalty/settings', async (c) => {
  try {
    const settings = await getLoyaltySettings(c.env.DB);
    return c.json({ success: true, data: settings });
  } catch (e) {
    return c.json({ success: false, error: 'Failed to fetch settings' }, 500);
  }
});

// PUT /api/loyalty/settings/:key — 設定値を更新
loyalty.put('/api/loyalty/settings/:key', async (c) => {
  try {
    const key = c.req.param('key');
    const NUMERIC_KEYS = ['point_rate', 'point_value', 'registration_bonus', 'expiry_days'];
    const FLAG_KEYS = ['yen_only', 'order_metafield_enabled', 'customer_metafield_enabled', 'subscription_points_enabled'];
    const VALID_KEYS = [...NUMERIC_KEYS, ...FLAG_KEYS];
    if (!VALID_KEYS.includes(key)) {
      return c.json({ success: false, error: '無効な設定キーです' }, 400);
    }
    const body = await c.req.json<{ value: string }>();
    if (body.value === undefined || body.value === null) {
      return c.json({ success: false, error: 'value は必須です' }, 400);
    }
    // フラグ系（0/1）バリデーション
    if (FLAG_KEYS.includes(key)) {
      if (body.value !== '0' && body.value !== '1') {
        return c.json({ success: false, error: '0 または 1 で入力してください' }, 400);
      }
      await setLoyaltySetting(c.env.DB, key, body.value);
      return c.json({ success: true });
    }
    // 数値系バリデーション
    const num = parseFloat(body.value);
    if (isNaN(num) || num < 0) {
      return c.json({ success: false, error: '数値（0以上）で入力してください' }, 400);
    }
    if (key === 'point_rate' && num > 1) {
      return c.json({ success: false, error: 'ポイント還元率は 1.0（100%）以下にしてください' }, 400);
    }
    if (key === 'expiry_days' && (!Number.isInteger(num) || num < 0)) {
      return c.json({ success: false, error: '有効期限は0以上の整数で入力してください（0=無期限）' }, 400);
    }
    await setLoyaltySetting(c.env.DB, key, String(num));
    return c.json({ success: true });
  } catch (e) {
    return c.json({ success: false, error: 'Failed to update setting' }, 500);
  }
});

// ──────────────────────────────────────────────────────────
// キャンペーン CRUD
// ──────────────────────────────────────────────────────────

// GET /api/loyalty/campaigns
loyalty.get('/api/loyalty/campaigns', async (c) => {
  try {
    const campaigns = await getCampaigns(c.env.DB);
    return c.json({ success: true, data: campaigns });
  } catch (e) {
    return c.json({ success: false, error: 'Failed to fetch campaigns' }, 500);
  }
});

// POST /api/loyalty/campaigns
loyalty.post('/api/loyalty/campaigns', async (c) => {
  try {
    const body = await c.req.json<{
      name: string;
      description?: string;
      status?: CampaignStatus;
      starts_at?: string;
      ends_at?: string;
      conditions?: CampaignCondition[];
      action_type: CampaignActionType;
      action_value: number;
    }>();
    if (!body.name?.trim()) return c.json({ success: false, error: 'name は必須です' }, 400);
    if (!body.action_type) return c.json({ success: false, error: 'action_type は必須です' }, 400);
    if (typeof body.action_value !== 'number') return c.json({ success: false, error: 'action_value は数値で指定してください' }, 400);
    const id = await createCampaign(c.env.DB, body);
    return c.json({ success: true, data: { id } }, 201);
  } catch (e) {
    return c.json({ success: false, error: 'Failed to create campaign' }, 500);
  }
});

// GET /api/loyalty/campaigns/:id
loyalty.get('/api/loyalty/campaigns/:id', async (c) => {
  try {
    const campaign = await getCampaign(c.env.DB, c.req.param('id'));
    if (!campaign) return c.json({ success: false, error: 'Not found' }, 404);
    return c.json({ success: true, data: campaign });
  } catch (e) {
    return c.json({ success: false, error: 'Failed to fetch campaign' }, 500);
  }
});

// PUT /api/loyalty/campaigns/:id
loyalty.put('/api/loyalty/campaigns/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const existing = await getCampaign(c.env.DB, id);
    if (!existing) return c.json({ success: false, error: 'Not found' }, 404);
    const body = await c.req.json<Record<string, unknown>>();
    await updateCampaign(c.env.DB, id, body as Parameters<typeof updateCampaign>[2]);
    return c.json({ success: true });
  } catch (e) {
    return c.json({ success: false, error: 'Failed to update campaign' }, 500);
  }
});

// DELETE /api/loyalty/campaigns/:id
loyalty.delete('/api/loyalty/campaigns/:id', async (c) => {
  try {
    await deleteCampaign(c.env.DB, c.req.param('id'));
    return c.json({ success: true });
  } catch (e) {
    return c.json({ success: false, error: 'Failed to delete campaign' }, 500);
  }
});

// GET /api/loyalty/period-stats — 今月 vs 先月の KPI 比較
loyalty.get('/api/loyalty/period-stats', async (c) => {
  try {
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth(); // 0-indexed

    // 今月 1日 00:00 JST
    const thisMonthStart = new Date(y, m, 1).toISOString().slice(0, 10) + 'T00:00:00.000+09:00';
    // 先月 1日 〜 今月 1日
    const lastMonthStart = new Date(y, m - 1, 1).toISOString().slice(0, 10) + 'T00:00:00.000+09:00';
    const lastMonthEnd   = thisMonthStart;

    const [thisTx, lastTx, thisNew, lastNew] = await Promise.all([
      c.env.DB
        .prepare(`SELECT type, COALESCE(SUM(ABS(points)), 0) as total FROM loyalty_transactions WHERE type IN ('award','redeem') AND created_at >= ? GROUP BY type`)
        .bind(thisMonthStart)
        .all<{ type: string; total: number }>(),
      c.env.DB
        .prepare(`SELECT type, COALESCE(SUM(ABS(points)), 0) as total FROM loyalty_transactions WHERE type IN ('award','redeem') AND created_at >= ? AND created_at < ? GROUP BY type`)
        .bind(lastMonthStart, lastMonthEnd)
        .all<{ type: string; total: number }>(),
      c.env.DB
        .prepare(`SELECT COUNT(*) as n FROM loyalty_points WHERE created_at >= ?`)
        .bind(thisMonthStart)
        .first<{ n: number }>(),
      c.env.DB
        .prepare(`SELECT COUNT(*) as n FROM loyalty_points WHERE created_at >= ? AND created_at < ?`)
        .bind(lastMonthStart, lastMonthEnd)
        .first<{ n: number }>(),
    ]);

    const toMap = (rows: { type: string; total: number }[]) => {
      const m: Record<string, number> = { award: 0, redeem: 0 };
      for (const r of rows) m[r.type] = r.total;
      return m;
    };

    const thisMap = toMap(thisTx.results);
    const lastMap = toMap(lastTx.results);

    return c.json({
      success: true,
      data: {
        current:  { awarded: thisMap.award, redeemed: thisMap.redeem, newMembers: thisNew?.n ?? 0 },
        previous: { awarded: lastMap.award, redeemed: lastMap.redeem, newMembers: lastNew?.n ?? 0 },
      },
    });
  } catch (e) {
    return c.json({ success: false, error: 'Failed to fetch period stats' }, 500);
  }
});

// GET /api/loyalty/activity — 全体取引履歴（スタッフ向け）
loyalty.get('/api/loyalty/activity', async (c) => {
  try {
    const limit  = Math.min(Number(c.req.query('limit')  ?? '30'), 100);
    const offset = Number(c.req.query('offset') ?? '0');
    const type   = c.req.query('type');    // award | redeem | adjust | expire
    const from   = c.req.query('from');    // ISO date string
    const to     = c.req.query('to');

    let where = '1=1';
    const bindings: unknown[] = [];
    if (type)  { where += ' AND lt.type = ?';          bindings.push(type); }
    if (from)  { where += ' AND lt.created_at >= ?';   bindings.push(from); }
    if (to)    { where += ' AND lt.created_at <= ?';   bindings.push(to); }

    const countRow = await c.env.DB
      .prepare(`SELECT COUNT(*) as n FROM loyalty_transactions lt WHERE ${where}`)
      .bind(...bindings)
      .first<{ n: number }>();

    const rows = await c.env.DB
      .prepare(`
        SELECT lt.id, lt.friend_id, lt.type, lt.points, lt.balance_after,
               lt.reason, lt.order_id, lt.created_at, lt.expires_at,
               f.display_name, f.picture_url
        FROM loyalty_transactions lt
        LEFT JOIN friends f ON f.id = lt.friend_id
        WHERE ${where}
        ORDER BY lt.created_at DESC
        LIMIT ? OFFSET ?
      `)
      .bind(...bindings, limit, offset)
      .all<{
        id: string; friend_id: string; type: string; points: number;
        balance_after: number; reason: string | null; order_id: string | null;
        created_at: string; expires_at: string | null;
        display_name: string | null; picture_url: string | null;
      }>();

    return c.json({ success: true, data: { items: rows.results, total: countRow?.n ?? 0 } });
  } catch (e) {
    return c.json({ success: false, error: 'Failed to fetch activity' }, 500);
  }
});

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
      currency?: string;          // 通貨コード（例: "JPY", "USD"）
      isSubscription?: boolean;   // サブスクリプション注文フラグ
      customerTags?: string[];
      productTags?: string[];
      productIds?: string[];
      productTypes?: string[];
      collectionIds?: string[];
      orderCount?: number;
    }>();

    if (!body.friendId || typeof body.orderAmount !== 'number' || body.orderAmount <= 0) {
      return c.json({ success: false, error: 'friendId and orderAmount are required' }, 400);
    }

    // 設定を並行取得
    const [
      pointRateSetting,
      expiryDaysSetting,
      yenOnlySetting,
      orderMetafieldSetting,
      customerMetafieldSetting,
      subscriptionPointsSetting,
    ] = await Promise.all([
      getLoyaltySetting(c.env.DB, 'point_rate').catch(() => null),
      getLoyaltySetting(c.env.DB, 'expiry_days').catch(() => null),
      getLoyaltySetting(c.env.DB, 'yen_only').catch(() => null),
      getLoyaltySetting(c.env.DB, 'order_metafield_enabled').catch(() => null),
      getLoyaltySetting(c.env.DB, 'customer_metafield_enabled').catch(() => null),
      getLoyaltySetting(c.env.DB, 'subscription_points_enabled').catch(() => null),
    ]);

    // 日本円以外スキップ
    if ((yenOnlySetting ?? '1') === '1' && body.currency && body.currency !== 'JPY') {
      return c.json({
        success: true,
        data: { earnedPoints: 0, balance: 0, rank: 'レギュラー', skipped: true, reason: 'non_jpy_currency' },
      });
    }

    // サブスクリプション注文スキップ
    if ((subscriptionPointsSetting ?? '1') === '0' && body.isSubscription) {
      return c.json({
        success: true,
        data: { earnedPoints: 0, balance: 0, rank: 'レギュラー', skipped: true, reason: 'subscription_disabled' },
      });
    }

    const current = await getLoyaltyPoint(c.env.DB, body.friendId);
    const currentBalance = current?.balance ?? 0;
    const currentTotalSpent = current?.total_spent ?? 0;

    const newTotalSpent = currentTotalSpent + body.orderAmount;
    const currentRank = determineRank(currentTotalSpent);
    const pointRate = parseFloat(pointRateSetting ?? '0.01') || 0.01;
    const expiryDays = parseInt(expiryDaysSetting ?? '365', 10) || 365;
    const basePoints = calculatePoints(body.orderAmount, currentRank, pointRate);

    // キャンペーン適用
    const activeCampaigns = await getActiveCampaigns(c.env.DB).catch(() => []);
    const { finalPoints: earnedPoints, appliedCampaigns } = applyCampaigns(
      basePoints,
      body.orderAmount,
      {
        customerTags:  body.customerTags ?? [],
        productTags:   body.productTags ?? [],
        productIds:    body.productIds ?? [],
        productTypes:  body.productTypes ?? [],
        collectionIds: body.collectionIds ?? [],
        orderCount:    body.orderCount,
        totalSpent:    currentTotalSpent,
      },
      activeCampaigns,
    );

    const newBalance = currentBalance + earnedPoints;
    const newRank = determineRank(newTotalSpent);
    const effectiveCustomerId = body.shopifyCustomerId ?? current?.shopify_customer_id ?? undefined;

    await upsertLoyaltyPoint(c.env.DB, body.friendId, {
      balance: newBalance,
      totalSpent: newTotalSpent,
      rank: newRank,
      shopifyCustomerId: effectiveCustomerId,
    });

    await addLoyaltyTransaction(c.env.DB, {
      friendId: body.friendId,
      type: 'award',
      points: earnedPoints,
      balanceAfter: newBalance,
      reason: `購入ポイント付与（¥${body.orderAmount.toLocaleString('ja-JP')}）`,
      orderId: body.orderId,
      expiryDays,
    });

    // Shopify メタフィールド保存（非同期・失敗しても付与には影響させない）
    const shopDomain = c.env.SHOPIFY_SHOP_DOMAIN;
    const adminToken = c.env.SHOPIFY_ADMIN_TOKEN;
    if (shopDomain && adminToken) {
      const metafieldJobs: Promise<void>[] = [];
      if ((orderMetafieldSetting ?? '1') === '1' && body.orderId) {
        metafieldJobs.push(
          saveOrderMetafields(shopDomain, adminToken, body.orderId, { awarded_points: earnedPoints }).catch(() => {}),
        );
      }
      if ((customerMetafieldSetting ?? '0') === '1' && effectiveCustomerId) {
        metafieldJobs.push(
          saveCustomerMetafields(shopDomain, adminToken, effectiveCustomerId, newBalance).catch(() => {}),
        );
      }
      if (metafieldJobs.length > 0) {
        c.executionCtx?.waitUntil(Promise.all(metafieldJobs));
      }
    }

    return c.json({
      success: true,
      data: {
        earnedPoints,
        balance: newBalance,
        rank: newRank,
        rankChanged: newRank !== currentRank,
        previousRank: currentRank,
        appliedCampaigns,
      },
    });
  } catch (e) {
    return c.json({ success: false, error: 'Failed to award points' }, 500);
  }
});

// POST /api/loyalty/order-cancelled — 注文キャンセル時のポイント返還（GAS から呼ぶ）
loyalty.post('/api/loyalty/order-cancelled', async (c) => {
  try {
    const body = await c.req.json<{
      orderId: string;
      shopifyCustomerId?: string;
    }>();

    if (!body.orderId) {
      return c.json({ success: false, error: 'orderId は必須です' }, 400);
    }

    // キャンセルされた注文の award トランザクションを取得
    const awardTx = await c.env.DB
      .prepare(`SELECT * FROM loyalty_transactions WHERE order_id = ? AND type = 'award' ORDER BY created_at DESC LIMIT 1`)
      .bind(body.orderId)
      .first<{ id: string; friend_id: string; points: number; balance_after: number }>();

    if (!awardTx) {
      // 付与記録なし（ポイント非対象の注文）→ 正常終了
      return c.json({ success: true, data: { refundedPoints: 0, message: '対象のポイント付与記録なし' } });
    }

    // すでに返還済みかチェック（同一 order_id の adjust で「キャンセル」reason が存在するか）
    const existingCancel = await c.env.DB
      .prepare(`SELECT id FROM loyalty_transactions WHERE order_id = ? AND type = 'adjust' AND reason LIKE '%注文キャンセル%' LIMIT 1`)
      .bind(body.orderId)
      .first<{ id: string }>();
    if (existingCancel) {
      return c.json({ success: true, data: { refundedPoints: 0, message: 'すでに返還済みです' } });
    }

    const current = await getLoyaltyPoint(c.env.DB, awardTx.friend_id);
    if (!current) {
      return c.json({ success: false, error: 'ポイント情報が見つかりません' }, 404);
    }

    const refundPoints = awardTx.points; // 付与したポイント数（正の値）
    const newBalance = Math.max(0, current.balance - refundPoints);
    const newRank = determineRank(current.total_spent);
    const effectiveCustomerId = body.shopifyCustomerId ?? current.shopify_customer_id ?? undefined;

    await upsertLoyaltyPoint(c.env.DB, awardTx.friend_id, {
      balance: newBalance,
      totalSpent: current.total_spent,
      rank: newRank,
      shopifyCustomerId: effectiveCustomerId,
    });

    await addLoyaltyTransaction(c.env.DB, {
      friendId: awardTx.friend_id,
      type: 'adjust',
      points: -refundPoints,
      balanceAfter: newBalance,
      reason: `注文キャンセルによるポイント返還（注文ID: ${body.orderId}）`,
      orderId: body.orderId,
    });

    // 顧客メタフィールド更新
    const shopDomain = c.env.SHOPIFY_SHOP_DOMAIN;
    const adminToken = c.env.SHOPIFY_ADMIN_TOKEN;
    if (shopDomain && adminToken && effectiveCustomerId) {
      const customerMetafieldSetting = await getLoyaltySetting(c.env.DB, 'customer_metafield_enabled').catch(() => null);
      if ((customerMetafieldSetting ?? '0') === '1') {
        c.executionCtx?.waitUntil(
          saveCustomerMetafields(shopDomain, adminToken, effectiveCustomerId, newBalance).catch(() => {}),
        );
      }
    }

    return c.json({
      success: true,
      data: { refundedPoints: refundPoints, balance: newBalance, rank: newRank },
    });
  } catch (e) {
    return c.json({ success: false, error: 'Failed to process order cancellation' }, 500);
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
      return c.json({
        success: true,
        data: { balance: 0, rank: 'レギュラー', total_spent: 0, pending_code: null },
      });
    }

    // 最新の割引コードを reason から抽出
    let pendingCode: string | null = null;
    try {
      const latest = await c.env.DB
        .prepare(`SELECT reason FROM loyalty_transactions WHERE friend_id = ? AND type = 'redeem' AND reason NOT LIKE '[取り消し済み]%' ORDER BY created_at DESC LIMIT 1`)
        .bind(point.friend_id)
        .first<{ reason: string }>();
      if (latest?.reason) {
        const m = latest.reason.match(/コード: ([A-Z0-9-]+)/);
        if (m) pendingCode = m[1];
      }
    } catch (_) {}

    // 期限切れが近いポイントを取得
    let expiringSoon: { points: number; expires_at: string } | null = null;
    try {
      expiringSoon = await getExpiringSoonPoints(c.env.DB, point.friend_id);
    } catch (_) {}

    return c.json({
      success: true,
      data: {
        balance: point.balance,
        rank: point.rank,
        total_spent: point.total_spent,
        pending_code: pendingCode,
        expiring_soon: expiringSoon,
      },
    });
  } catch (e) {
    return c.json({ success: false, error: 'Failed to fetch loyalty point' }, 500);
  }
});

// GET /api/loyalty/shopify/:shopifyCustomerId/history — 取引履歴（Shopify マイページ）
loyalty.get('/api/loyalty/shopify/:shopifyCustomerId/history', async (c) => {
  try {
    const limit = Math.min(Number(c.req.query('limit') ?? '10'), 50);
    const offset = Number(c.req.query('offset') ?? '0');
    const result = await getLoyaltyTransactionsByShopifyCustomerId(
      c.env.DB,
      c.req.param('shopifyCustomerId'),
      { limit, offset },
    );
    return c.json({ success: true, data: result });
  } catch (e) {
    return c.json({ success: false, error: 'Failed to fetch history' }, 500);
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

    // 既存の未使用コードがあれば発行をブロック
    const shopDomain = c.env.SHOPIFY_SHOP_DOMAIN;
    const adminToken = c.env.SHOPIFY_ADMIN_TOKEN;
    try {
      const latestRedeem = await c.env.DB
        .prepare(`SELECT reason FROM loyalty_transactions WHERE friend_id = ? AND type = 'redeem' AND reason NOT LIKE '[取り消し済み]%' ORDER BY created_at DESC LIMIT 1`)
        .bind(point.friend_id)
        .first<{ reason: string }>();
      const existingCodeMatch = latestRedeem?.reason?.match(/コード: ([A-Z0-9-]+)/);
      if (existingCodeMatch && shopDomain && adminToken) {
        const existingCode = existingCodeMatch[1];
        const rulesRes = await fetch(
          `https://${shopDomain}/admin/api/2024-10/price_rules.json?limit=250`,
          { headers: { 'X-Shopify-Access-Token': adminToken } },
        );
        if (rulesRes.ok) {
          const { price_rules } = await rulesRes.json() as { price_rules: { id: number; title: string }[] };
          const rule = price_rules.find((r) => r.title === `ポイント割引 ${existingCode}`);
          if (rule) {
            const dcRes = await fetch(
              `https://${shopDomain}/admin/api/2024-10/price_rules/${rule.id}/discount_codes.json`,
              { headers: { 'X-Shopify-Access-Token': adminToken } },
            );
            if (dcRes.ok) {
              const { discount_codes } = await dcRes.json() as { discount_codes: { usage_count: number }[] };
              if (discount_codes[0]?.usage_count === 0) {
                return c.json({
                  success: false,
                  error: `未使用の割引コードがあります: ${existingCode}。先にご利用いただくか、取り消してからお試しください。`,
                  existing_code: existingCode,
                }, 400);
              }
            }
          }
        }
      }
    } catch (_) { /* チェック失敗は無視して続行 */ }

    // Shopify Admin API でディスカウントコードを発行
    if (!shopDomain || !adminToken) {
      return c.json(
        { success: false, error: 'Shopify 設定が未構成です（サーバー管理者にお問い合わせください）' },
        500,
      );
    }

    const pointValueSetting = await getLoyaltySetting(c.env.DB, 'point_value').catch(() => null);
    const pointValue = parseFloat(pointValueSetting ?? '1') || 1;
    const discountAmount = Math.floor(body.points * pointValue); // 1pt = pointValue円
    const code = `ORYZAE-${shopifyCustomerId.slice(-6)}-${Date.now().toString(36).toUpperCase()}`;

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

// POST /api/loyalty/shopify/:shopifyCustomerId/cancel-code — 未使用割引コードをキャンセルしてポイント返還
loyalty.post('/api/loyalty/shopify/:shopifyCustomerId/cancel-code', async (c) => {
  try {
    const shopifyCustomerId = c.req.param('shopifyCustomerId');
    const body = await c.req.json<{ code: string }>();

    if (!body.code || typeof body.code !== 'string') {
      return c.json({ success: false, error: 'code は必須です' }, 400);
    }
    const code = body.code.trim().toUpperCase();

    // コードがこの顧客のものか確認（コード末尾6桁 = customer ID 末尾6桁）
    const expectedSuffix = shopifyCustomerId.slice(-6);
    if (!code.startsWith(`ORYZAE-${expectedSuffix}-`)) {
      return c.json({ success: false, error: '指定されたコードはこのアカウントのものではありません' }, 403);
    }

    const point = await getLoyaltyPointByShopifyCustomerId(c.env.DB, shopifyCustomerId);
    if (!point) {
      return c.json({ success: false, error: 'ポイント情報が見つかりません' }, 404);
    }

    const shopDomain = c.env.SHOPIFY_SHOP_DOMAIN;
    const adminToken = c.env.SHOPIFY_ADMIN_TOKEN;
    if (!shopDomain || !adminToken) {
      return c.json({ success: false, error: 'Shopify 設定が未構成です' }, 500);
    }

    // Price Rule を title で検索
    const searchRes = await fetch(
      `https://${shopDomain}/admin/api/2024-10/price_rules.json?limit=250`,
      { headers: { 'X-Shopify-Access-Token': adminToken } },
    );
    if (!searchRes.ok) {
      return c.json({ success: false, error: 'Shopify API エラー' }, 500);
    }
    const { price_rules } = (await searchRes.json()) as { price_rules: { id: number; title: string }[] };
    const rule = price_rules.find((r) => r.title === `ポイント割引 ${code}`);
    if (!rule) {
      return c.json({ success: false, error: 'コードが見つかりません（すでに削除済みの可能性があります）' }, 404);
    }

    // Discount Code の使用状況を確認
    const dcRes = await fetch(
      `https://${shopDomain}/admin/api/2024-10/price_rules/${rule.id}/discount_codes.json`,
      { headers: { 'X-Shopify-Access-Token': adminToken } },
    );
    if (!dcRes.ok) {
      return c.json({ success: false, error: 'コード状況の確認に失敗しました' }, 500);
    }
    const { discount_codes } = (await dcRes.json()) as { discount_codes: { usage_count: number }[] };
    if (discount_codes[0]?.usage_count > 0) {
      return c.json({ success: false, error: 'このコードはすでに使用済みのためキャンセルできません' }, 400);
    }

    // Price Rule（＝割引コード）を削除
    const delRes = await fetch(
      `https://${shopDomain}/admin/api/2024-10/price_rules/${rule.id}.json`,
      { method: 'DELETE', headers: { 'X-Shopify-Access-Token': adminToken } },
    );
    if (!delRes.ok && delRes.status !== 404) {
      return c.json({ success: false, error: 'コードの削除に失敗しました' }, 500);
    }

    // 元のポイント数を reason から逆算
    const latestRedeem = await c.env.DB
      .prepare(`SELECT reason FROM loyalty_transactions WHERE friend_id = ? AND type = 'redeem' AND reason LIKE ? ORDER BY created_at DESC LIMIT 1`)
      .bind(point.friend_id, `%コード: ${code}%`)
      .first<{ reason: string }>();
    const m = latestRedeem?.reason?.match(/¥(\d+)割引/);
    const refundPoints = m ? parseInt(m[1], 10) : 0;

    if (refundPoints <= 0) {
      return c.json({ success: false, error: '返還ポイント数を特定できませんでした' }, 500);
    }

    // ポイント残高を返還
    const newBalance = point.balance + refundPoints;
    const newRank = determineRank(point.total_spent);
    await upsertLoyaltyPoint(c.env.DB, point.friend_id, {
      balance: newBalance,
      totalSpent: point.total_spent,
      rank: newRank,
      shopifyCustomerId,
    });

    await addLoyaltyTransaction(c.env.DB, {
      friendId: point.friend_id,
      type: 'adjust',
      points: refundPoints,
      balanceAfter: newBalance,
      reason: `コード取り消しによるポイント返還（${code} 未使用削除）`,
    });

    // 元の redeem トランザクションを「取り消し済み」にマーク
    await c.env.DB
      .prepare(`UPDATE loyalty_transactions SET reason = '[取り消し済み] ' || reason WHERE friend_id = ? AND type = 'redeem' AND reason LIKE ?`)
      .bind(point.friend_id, `%コード: ${code}%`)
      .run();


    return c.json({
      success: true,
      data: { refundPoints, balance: newBalance, rank: newRank },
    });
  } catch (e) {
    return c.json({ success: false, error: 'Failed to cancel code' }, 500);
  }
});

export { loyalty };
