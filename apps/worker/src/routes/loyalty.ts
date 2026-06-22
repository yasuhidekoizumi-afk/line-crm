import { Hono } from 'hono';
import { checkCustomerSig } from '../utils/customer-sig.js';
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
  RANK_THRESHOLDS,
  RANK_MULTIPLIERS,
  getFriendByLineUserId,
  type LoyaltyRank,
  type CampaignCondition,
  type CampaignActionType,
  type CampaignStatus,
} from '@line-crm/db';
import { saveOrderMetafields, saveCustomerMetafields } from '../services/shopify.js';
import { backfillPendingOrders } from '../services/loyalty-backfill.js';
import { refundUnusedPointCode } from '../services/loyalty-code-refund.js';
import { runPurchaseBackfill } from '../services/loyalty-backfill-purchases.js';
import { previewUnusedCodeRefunds } from '../services/loyalty-code-refund-preview.js';
import { sweepUnusedPointCodes } from '../services/loyalty-unused-code-sweep.js';
import { rescueSocialplusCustomer, sweepSocialplusUnlinked } from '../services/loyalty-socialplus-rescue.js';
import { getShopifyAdminToken } from '../utils/shopify-token.js';
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
    const NUMERIC_KEYS = ['point_rate', 'point_value', 'registration_bonus', 'expiry_days', 'link_coupon_expiry_days'];
    const FLAG_KEYS = ['yen_only', 'order_metafield_enabled', 'customer_metafield_enabled', 'subscription_points_enabled', 'link_bonus_enabled'];
    // 列挙値キー（許可された値のみ受け付ける）
    const ENUM_KEYS: Record<string, string[]> = { link_reward_type: ['points', 'free_shipping'] };
    const VALID_KEYS = [...NUMERIC_KEYS, ...FLAG_KEYS, ...Object.keys(ENUM_KEYS)];
    if (!VALID_KEYS.includes(key)) {
      return c.json({ success: false, error: '無効な設定キーです' }, 400);
    }
    const body = await c.req.json<{ value: string }>();
    if (body.value === undefined || body.value === null) {
      return c.json({ success: false, error: 'value は必須です' }, 400);
    }
    // 列挙値系（link_reward_type 等）: 許可リスト内の値のみ
    if (key in ENUM_KEYS) {
      if (!ENUM_KEYS[key].includes(body.value)) {
        return c.json({ success: false, error: `${key} は ${ENUM_KEYS[key].join(' / ')} のいずれかで入力してください` }, 400);
      }
      await setLoyaltySetting(c.env.DB, key, body.value);
      return c.json({ success: true });
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
      expiry_days?: number | null;
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

// GET /api/loyalty/period-stats — 期間指定 KPI（期間・比較方法をクエリで選択）
loyalty.get('/api/loyalty/period-stats', async (c) => {
  try {
    const period = c.req.query('period') || 'this_month';
    const compare = c.req.query('compare') || 'previous_period';

    const VALID_PERIODS = ['this_month', 'last_month', 'yesterday', 'last_7d', 'last_30d', 'last_90d', 'this_year'];
    const VALID_COMPARES = ['previous_period', 'previous_day', 'previous_year', 'none'];
    if (!VALID_PERIODS.includes(period)) {
      return c.json({ success: false, error: `Invalid period: ${period}` }, 400);
    }
    if (!VALID_COMPARES.includes(compare)) {
      return c.json({ success: false, error: `Invalid compare: ${compare}` }, 400);
    }

    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth();

    // 現在期間の開始・終了を計算
    let currentStart: Date;
    let currentEnd = now;

    switch (period) {
      case 'this_month':
        currentStart = new Date(y, m, 1);
        break;
      case 'last_month':
        currentStart = new Date(y, m - 1, 1);
        currentEnd = new Date(y, m, 1);
        break;
      case 'yesterday': {
        const todayStart = new Date(y, m, now.getDate());
        currentStart = new Date(todayStart.getTime() - 86400000);
        currentEnd = todayStart;
        break;
      }
      case 'last_7d':
        currentStart = new Date(now.getTime() - 7 * 86400000);
        break;
      case 'last_30d':
        currentStart = new Date(now.getTime() - 30 * 86400000);
        break;
      case 'last_90d':
        currentStart = new Date(now.getTime() - 90 * 86400000);
        break;
      case 'this_year':
        currentStart = new Date(y, 0, 1);
        break;
      default:
        currentStart = new Date(y, m, 1);
    }

    const fmtStart = (d: Date) => d.toISOString().slice(0, 10) + 'T00:00:00.000+09:00';
    const fmtEnd = (d: Date) => d.toISOString();

    const currentStartStr = fmtStart(currentStart);
    const currentEndStr = fmtEnd(currentEnd);

    // 現在期間のデータ
    const [currentTx, currentNew] = await Promise.all([
      c.env.DB
        .prepare(`SELECT type, COALESCE(SUM(ABS(points)), 0) as total FROM loyalty_transactions WHERE type IN ('award','redeem') AND created_at >= ? AND created_at <= ? GROUP BY type`)
        .bind(currentStartStr, currentEndStr)
        .all<{ type: string; total: number }>(),
      c.env.DB
        .prepare(`SELECT COUNT(*) as n FROM loyalty_points WHERE created_at >= ? AND created_at <= ?`)
        .bind(currentStartStr, currentEndStr)
        .first<{ n: number }>(),
    ]);

    const toMap = (rows: { type: string; total: number }[]) => {
      const m: Record<string, number> = { award: 0, redeem: 0 };
      for (const r of rows) m[r.type] = r.total;
      return m;
    };

    const currentMap = toMap(currentTx.results);
    let previousData = { awarded: 0, redeemed: 0, newMembers: 0 };

    // 比較期間のデータ
    if (compare !== 'none') {
      let prevStart: Date;
      let prevEnd: Date;

      if (compare === 'previous_year') {
        prevStart = new Date(currentStart.getTime() - 365 * 86400000);
        prevEnd = new Date(currentEnd.getTime() - 365 * 86400000);
      } else if (compare === 'previous_day') {
        prevStart = new Date(currentStart.getTime() - 86400000);
        prevEnd = new Date(currentEnd.getTime() - 86400000);
      } else {
        // previous_period: 同じ長さの直前の期間
        const duration = currentEnd.getTime() - currentStart.getTime();
        prevStart = new Date(currentStart.getTime() - duration);
        prevEnd = currentStart;
      }

      const prevStartStr = fmtStart(prevStart);
      const prevEndStr = fmtEnd(prevEnd);

      const [prevTx, prevNew] = await Promise.all([
        c.env.DB
          .prepare(`SELECT type, COALESCE(SUM(ABS(points)), 0) as total FROM loyalty_transactions WHERE type IN ('award','redeem') AND created_at >= ? AND created_at < ? GROUP BY type`)
          .bind(prevStartStr, prevEndStr)
          .all<{ type: string; total: number }>(),
        c.env.DB
          .prepare(`SELECT COUNT(*) as n FROM loyalty_points WHERE created_at >= ? AND created_at < ?`)
          .bind(prevStartStr, prevEndStr)
          .first<{ n: number }>(),
      ]);

      const prevMap = toMap(prevTx.results);
      previousData = {
        awarded: prevMap.award,
        redeemed: prevMap.redeem,
        newMembers: prevNew?.n ?? 0,
      };
    }

    return c.json({
      success: true,
      data: {
        current: {
          awarded: currentMap.award,
          redeemed: currentMap.redeem,
          newMembers: currentNew?.n ?? 0,
        },
        previous: previousData,
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
    // 'env-owner' は staff_members に存在しないため FK 制約違反になる
    const staffId = staff?.id && staff.id !== 'env-owner' ? staff.id : undefined;

    await upsertLoyaltyPoint(c.env.DB, friendId, {
      balance: newBalance,
      limitedBalance: current.limited_balance ?? 0,
      totalSpent: currentTotalSpent,
      rank: newRank,
      shopifyCustomerId: current?.shopify_customer_id ?? undefined,
    });

    const grandTotalAfter = newBalance + (current?.limited_balance ?? 0);
    await addLoyaltyTransaction(c.env.DB, {
      friendId,
      type: 'adjust',
      points: body.points,
      balanceAfter: grandTotalAfter,
      reason: body.reason.trim(),
      staffId,
    });

    return c.json({ success: true, data: { balance: newBalance, rank: newRank } });
  } catch (e) {
    console.error('adjust points error:', e);
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
      sendLineNotification?: boolean; // falseでLINE通知を抑制（管理画面操作など）
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
    const { finalPoints: earnedPoints, appliedCampaigns, expiryDays: campaignExpiryDays } = applyCampaigns(
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

    // 通常ポイントと期間限定ポイントを分割
    // 基本1倍分（×ランク倍率）→ balance（通常）
    // キャンペーン上乗せ分 → limited_balance（期間限定）
    const hasCampaignBonus = appliedCampaigns.length > 0 && earnedPoints > basePoints;
    const regularPoints = hasCampaignBonus ? basePoints : earnedPoints;
    const limitedPoints = hasCampaignBonus ? earnedPoints - basePoints : 0;

    const newBalance = currentBalance + regularPoints;
    const newLimitedBalance = (current?.limited_balance ?? 0) + limitedPoints;

    // 期間限定ポイントの期限
    const effectiveExpiryDays = campaignExpiryDays ?? expiryDays;
    let limitedExpiresAt: string | null = null;
    if (limitedPoints > 0) {
      const expiry = new Date();
      expiry.setDate(expiry.getDate() + effectiveExpiryDays);
      limitedExpiresAt = expiry.toISOString();
    }

    const newRank = determineRank(newTotalSpent);
    const effectiveCustomerId = body.shopifyCustomerId ?? current?.shopify_customer_id ?? undefined;

    await upsertLoyaltyPoint(c.env.DB, body.friendId, {
      balance: newBalance,
      limitedBalance: newLimitedBalance,
      limitedExpiresAt,
      totalSpent: newTotalSpent,
      rank: newRank,
      shopifyCustomerId: effectiveCustomerId,
    });

    await addLoyaltyTransaction(c.env.DB, {
      friendId: body.friendId,
      type: 'award',
      points: earnedPoints,
      balanceAfter: newBalance + newLimitedBalance,
      reason: `購入ポイント付与（¥${body.orderAmount.toLocaleString('ja-JP')}）${appliedCampaigns.length > 0 ? `【${appliedCampaigns.join(', ')}】` : ''}`,
      orderId: body.orderId,
      expiryDays: effectiveExpiryDays,
    });

    // Shopify メタフィールド保存（非同期・失敗しても付与には影響させない）
    const shopDomain = c.env.SHOPIFY_SHOP_DOMAIN;
    const adminToken = await getShopifyAdminToken(c.env);
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

    // LINE通知を非同期で送信
    const lineToken = c.env.LINE_CHANNEL_ACCESS_TOKEN;
    if (lineToken && body.sendLineNotification !== false) {
      c.executionCtx?.waitUntil(
        (async () => {
          try {
            // 友だちのLINEユーザーIDを取得
            const friendRow = await c.env.DB
              .prepare('SELECT line_user_id, display_name FROM friends WHERE id = ?')
              .bind(body.friendId)
              .first<{ line_user_id: string; display_name: string }>();
            if (!friendRow?.line_user_id?.startsWith('U')) return; // 実LINEユーザーのみ

            // メッセージテキストを構築
            let msg = `🌟 ORYZAEポイントを獲得しました

`;
            msg += `💰 獲得ポイント: ${earnedPoints}pt
`;
            if (regularPoints > 0) msg += `・通常ポイント: ${regularPoints}pt
`;
            if (limitedPoints > 0) {
              const d = new Date(limitedExpiresAt!);
              msg += `・期間限定ポイント: ${limitedPoints}pt（${d.getMonth()+1}/${d.getDate()}まで）
`;
            }
            msg += `
📊 現在の残高: ${newBalance}pt`;
            if (newLimitedBalance > 0) msg += `（＋期間限定${newLimitedBalance}pt）`;
            msg += `
🏅 ランク: ${newRank}`;
            if (newRank !== currentRank) msg += `（${currentRank}からアップ！）`;
            if (appliedCampaigns.length > 0) msg += `
🎁 キャンペーン: ${appliedCampaigns.join('・')}`;

            await fetch('https://api.line.me/v2/bot/message/push', {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${lineToken}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                to: friendRow.line_user_id,
                messages: [{ type: 'text', text: msg }],
              }),
            });
          } catch (_e) {
            // LINE通知の失敗はポイント付与に影響させない
          }
        })()
      );
    }

    return c.json({
      success: true,
      data: {
        earnedPoints,
        regularPoints,
        limitedPoints,
        limitedExpiresAt,
        balance: newBalance,
        limitedBalance: newLimitedBalance,
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
    // キャンセル: limited_balance → balance の順で減算（redeemの逆順）
    const limitedRefund = Math.min(current.limited_balance ?? 0, refundPoints);
    const balanceRefund = refundPoints - limitedRefund;
    const newBalance = Math.max(0, current.balance - balanceRefund);
    const newLimitedBalance = Math.max(0, (current.limited_balance ?? 0) - limitedRefund);
    const newRank = determineRank(current.total_spent);
    const effectiveCustomerId = body.shopifyCustomerId ?? current.shopify_customer_id ?? undefined;

    await upsertLoyaltyPoint(c.env.DB, awardTx.friend_id, {
      balance: newBalance,
      limitedBalance: newLimitedBalance,
      limitedExpiresAt: newLimitedBalance > 0 ? current.limited_expires_at : null,
      totalSpent: current.total_spent,
      rank: newRank,
      shopifyCustomerId: effectiveCustomerId,
    });

    await addLoyaltyTransaction(c.env.DB, {
      friendId: awardTx.friend_id,
      type: 'adjust',
      points: -refundPoints,
      balanceAfter: newBalance + newLimitedBalance,
      reason: `注文キャンセルによるポイント返還（注文ID: ${body.orderId}）`,
      orderId: body.orderId,
    });

    // 顧客メタフィールド更新
    const shopDomain = c.env.SHOPIFY_SHOP_DOMAIN;
    const adminToken = await getShopifyAdminToken(c.env);
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
    // 本人確認（REQUIRE_CUSTOMER_SIG=1 のときのみ必須・段階導入）
    const sigErr = await checkCustomerSig(c, c.req.param('shopifyCustomerId'));
    if (sigErr) return sigErr;
    const point = await getLoyaltyPointByShopifyCustomerId(
      c.env.DB,
      c.req.param('shopifyCustomerId'),
    );
    if (!point) {
      const rank_definitions = RANK_THRESHOLDS.map((r) => ({
        rank: r.rank,
        min_spent: r.minSpent,
        multiplier: RANK_MULTIPLIERS[r.rank],
      }));
      return c.json({
        success: true,
        data: {
          linked: false,
          balance: 0,
          paid_balance: 0,
          bonus_balance: 0,
          limited_balance: 0,
          limited_expires_at: null,
          rank: 'レギュラー',
          total_spent: 0,
          pending_code: null,
          rank_definitions,
          next_rank: { rank: 'シルバー', min_spent: 10_000, remaining: 10_000 },
        },
      });
    }

    // 最新の割引コードを reason から抽出
    let pendingCode: string | null = null;
    let pendingDiscount: number | null = null;
    let pendingPoints: number | null = null;
    try {
      const latest = await c.env.DB
        .prepare(`SELECT reason, points FROM loyalty_transactions WHERE friend_id = ? AND type = 'redeem' AND reason NOT LIKE '[取り消し済み]%' AND reason NOT LIKE '[利用済み]%' ORDER BY created_at DESC LIMIT 1`)
        .bind(point.friend_id)
        .first<{ reason: string; points: number }>();
      if (latest?.reason) {
        const m = latest.reason.match(/コード: ([A-Z0-9-]+)/);
        if (m) pendingCode = m[1];
        const d = latest.reason.match(/¥([0-9,]+)割引/);
        if (d) pendingDiscount = parseInt(d[1].replace(/,/g, ''), 10);
        if (typeof latest.points === 'number') pendingPoints = Math.abs(latest.points);
      }
    } catch (_) {}

    // 期限切れが近いポイントを取得
    let expiringSoon: { points: number; expires_at: string } | null = null;
    try {
      expiringSoon = await getExpiringSoonPoints(c.env.DB, point.friend_id);
    } catch (_) {}

    // ランク定義（顧客向け表示用）
    const rank_definitions = RANK_THRESHOLDS.map((r) => ({
      rank: r.rank,
      min_spent: r.minSpent,
      multiplier: RANK_MULTIPLIERS[r.rank],
    }));

    // 次のランク情報
    let next_rank: { rank: string; min_spent: number; remaining: number } | null = null;
    for (const r of RANK_THRESHOLDS) {
      if (r.minSpent > point.total_spent) {
        next_rank = { rank: r.rank, min_spent: r.minSpent, remaining: r.minSpent - point.total_spent };
        break;
      }
    }

    return c.json({
      success: true,
      data: {
        linked: true,
        friend_id: point.friend_id,
        balance: point.balance,
        paid_balance: 0,
        bonus_balance: point.balance,
        limited_balance: point.limited_balance ?? 0,
        limited_expires_at: point.limited_expires_at,
        rank: point.rank,
        total_spent: point.total_spent,
        pending_code: pendingCode,
        pending_discount: pendingDiscount,
        pending_points: pendingPoints,
        expiring_soon: expiringSoon,
        rank_definitions,
        next_rank,
      },
    });
  } catch (e) {
    return c.json({ success: false, error: 'Failed to fetch loyalty point' }, 500);
  }
});

// GET /api/loyalty/shopify/:shopifyCustomerId/history — 取引履歴（Shopify マイページ）
loyalty.get('/api/loyalty/shopify/:shopifyCustomerId/history', async (c) => {
  try {
    // 本人確認（REQUIRE_CUSTOMER_SIG=1 のときのみ必須・段階導入）
    const sigErr = await checkCustomerSig(c, c.req.param('shopifyCustomerId'));
    if (sigErr) return sigErr;
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

// POST /api/loyalty/shopify/:shopifyCustomerId/profile-birthday — 誕生日登録 + 100pt付与
loyalty.post('/api/loyalty/shopify/:shopifyCustomerId/profile-birthday', async (c) => {
  try {
    // 本人確認（REQUIRE_CUSTOMER_SIG=1 のときのみ必須・段階導入）
    const sigErr = await checkCustomerSig(c, c.req.param('shopifyCustomerId'));
    if (sigErr) return sigErr;
    const shopifyCustomerId = c.req.param('shopifyCustomerId');
    const body = await c.req.json<{ birthday: string }>();
    const { birthday } = body;

    if (!birthday || !/^\d{4}-\d{2}-\d{2}$/.test(birthday)) {
      return c.json({ success: false, error: '誕生日は YYYY-MM-DD 形式で指定してください' }, 400);
    }

    // 0. 先にLINE連携を確認する。未連携のまま誕生日メタフィールドを保存すると、
    //    100pt付与は弾かれるのに「既に登録済み」状態になり二度と受け取れない罠があった。
    //    そのため保存より前にチェックし、未連携なら何も保存せず code:'not_linked' を返す
    //    （フロントはこれを見てLINE連携へ誘導。連携後に登録すれば100ptを受け取れる）。
    const point = await getLoyaltyPointByShopifyCustomerId(c.env.DB, shopifyCustomerId);
    if (!point) {
      return c.json(
        { success: false, code: 'not_linked', error: '先にLINE連携が必要です。LINE連携してから誕生日を登録すると100ptを受け取れます。' },
        400,
      );
    }

    // 1. Shopify Customer メタフィールドに誕生日を保存
    const adminToken = await getShopifyAdminToken(c.env);
    const shopDomain = c.env.SHOPIFY_SHOP_DOMAIN || 'yasuhide-koizumi.myshopify.com';

    if (!adminToken) {
      return c.json({ success: false, error: 'Shopify API token not configured' }, 500);
    }

    // 既存メタフィールドをチェック
    const checkResp = await fetch(
      `https://${shopDomain}/admin/api/2026-04/customers/${shopifyCustomerId}/metafields.json?namespace=facts&key=birth_date`,
      { headers: { 'X-Shopify-Access-Token': adminToken } }
    );
    if (checkResp.ok) {
      const checkData = await checkResp.json() as { metafields: Array<{ value: string }> };
      if (checkData.metafields?.length > 0 && checkData.metafields[0].value) {
        return c.json({ success: false, error: '誕生日は既に登録されています' }, 400);
      }
    }

    // メタフィールド保存
    const saveResp = await fetch(
      `https://${shopDomain}/admin/api/2026-04/customers/${shopifyCustomerId}/metafields.json`,
      {
        method: 'POST',
        headers: {
          'X-Shopify-Access-Token': adminToken,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          metafield: { namespace: 'facts', key: 'birth_date', value: birthday, type: 'date' },
        }),
      }
    );
    if (!saveResp.ok) {
      const errText = await saveResp.text();
      console.error('birthday metafield save failed:', saveResp.status, errText);
      return c.json({ success: false, error: '誕生日の保存に失敗しました' }, 500);
    }

    // 2. friend_id（上の連携チェックで取得済みの point から）
    const friendId = point.friend_id;
    const current = await getLoyaltyPoint(c.env.DB, friendId);
    const currentBalance = current?.balance ?? 0;
    const currentLimited = current?.limited_balance ?? 0;
    const awardedPoints = 100;

    // 誕生日登録ボーナスは「生年月日という個人情報を提供してくれたお礼」であり、
    // 購買促進ボーナスではないため、通常ポイント (balance) として無期限で付与する。
    // 期間限定 (limited_balance) にすると「条件付きで罠あり」と感じられ、
    // 登録CVR低下 → 誕生月クーポンセグメント施策の弱体化につながる。
    // 購買促進は別途「誕生月クーポン」(期間限定) で担う設計。
    const newBalance = currentBalance + awardedPoints;
    const balanceAfter = newBalance + currentLimited;
    await upsertLoyaltyPoint(c.env.DB, friendId, {
      balance: newBalance,
      totalSpent: current?.total_spent ?? 0,
      rank: (current?.rank as LoyaltyRank) ?? 'レギュラー',
      shopifyCustomerId,
      // limitedBalance / limitedExpiresAt は意図的に渡さない (PR #112 により既存値保持)
    });

    await addLoyaltyTransaction(c.env.DB, {
      friendId,
      type: 'award',
      points: awardedPoints,
      balanceAfter,
      reason: `誕生日登録ボーナス: +${awardedPoints}pt`,
      expiryDays: 0, // 通常ポイント (balance) として無期限付与のため
    });

    // 誕生日クーポン自動配信用に、誕生日を自社D1にも保存（毎日Shopify全件走査を避けるため）
    await c.env.DB.prepare(`UPDATE loyalty_points SET birthday = ? WHERE friend_id = ?`)
      .bind(birthday, friendId).run().catch(() => {});

    // 4. LINE or メール通知（非同期・失敗しても付与には影響させない）
    c.executionCtx?.waitUntil(
      (async () => {
        try {
          const friendRow = await c.env.DB
            .prepare('SELECT line_user_id, display_name FROM friends WHERE id = ?')
            .bind(friendId)
            .first<{ line_user_id: string; display_name: string }>();

          const displayName = friendRow?.display_name || 'お客様';
          const birthdayParts = birthday.split('-');
          const bdayDisplay = `${birthdayParts[1]}月${birthdayParts[2]}日`;

          // LINE連携済み → LINEプッシュ
          if (friendRow?.line_user_id?.startsWith('U') && c.env.LINE_CHANNEL_ACCESS_TOKEN) {
            const lineMsg =
              `🎂 ${displayName}さん、誕生日登録ありがとうございます！\n\n` +
              `誕生日: ${bdayDisplay}\n` +
              `✨ ${awardedPoints}ptをプレゼントしました\n\n` +
              `📊 現在の残高: ${balanceAfter}pt\n` +
              `🛒 カートでポイントをご利用いただけます`;

            await fetch('https://api.line.me/v2/bot/message/push', {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${c.env.LINE_CHANNEL_ACCESS_TOKEN}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                to: friendRow.line_user_id,
                messages: [{ type: 'text', text: lineMsg }],
              }),
            });
          } else if (c.env.RESEND_API_KEY && c.env.FERMENT_FROM_EMAIL_JP) {
            const shopDomain = c.env.SHOPIFY_SHOP_DOMAIN || 'yasuhide-koizumi.myshopify.com';
            const adminToken = await getShopifyAdminToken(c.env);
            if (adminToken) {
              // 人気商品をShopify Storefront APIから動的に取得
              let recommendHtml = '';
              try {
                const prodResp = await fetch(
                  'https://oryzae.shop/collections/all/products.json?sort_by=best-selling&limit=50',
                  { headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' } }
                );
                if (prodResp.ok) {
                  const prodData = await prodResp.json() as { products: Array<{ handle: string; title: string; images: Array<{ src: string }>; variants: Array<{ price: string }> }> };
                  const products = (prodData.products || [])
                    .filter(p => p.variants?.[0] && !p.title.includes('(定期)') && parseFloat(p.variants[0].price) >= 1000)
                    .slice(0, 3);
                    if (products.length > 0) {
                    recommendHtml = products.map(p =>
                      `<table cellpadding="0" cellspacing="0" border="0" style="width:100%;margin-bottom:8px;"><tr>` +
                        `<td style="width:50px;padding:0;vertical-align:middle;">` +
                          `<a href="https://oryzae.shop/products/${p.handle}" style="text-decoration:none;display:block;">` +
                            (p.images?.[0]?.src
                              ? `<img src="${p.images[0].src}" alt="" width="50" height="50" style="display:block;width:50px;height:50px;border-radius:8px;border:0;" />`
                              : `<div style="width:50px;height:50px;line-height:50px;text-align:center;font-size:22px;border-radius:8px;background:#fbf6ed;">🏷️</div>`) +
                          `</a>` +
                        `</td>` +
                        `<td style="padding:0 0 0 12px;vertical-align:middle;">` +
                          `<a href="https://oryzae.shop/products/${p.handle}" style="text-decoration:none;display:block;">` +
                            `<div style="font-size:13px;font-weight:600;color:#1a1a1a;">${p.title}</div>` +
                            `<div style="font-size:11px;color:#999;">¥${Number(p.variants[0].price).toLocaleString('ja-JP')}（100pt使える）</div>` +
                          `</a>` +
                        `</td>` +
                      `</tr></table>`
                    ).join('');
                  }
                }
              } catch (_ee) {}
              if (!recommendHtml) {
                recommendHtml =
                  `<table cellpadding="0" cellspacing="0" border="0" style="width:100%;margin-bottom:8px;"><tr>` +
                    `<td style="width:50px;padding:0;vertical-align:middle;text-align:center;"><div style="width:50px;height:50px;line-height:50px;font-size:22px;border-radius:8px;background:#fbf6ed;">🥣</div></td>` +
                    `<td style="padding:0 0 0 12px;vertical-align:middle;">` +
                      `<a href="https://oryzae.shop/products/set-fav" style="text-decoration:none;display:block;"><div style="font-size:13px;font-weight:600;color:#1a1a1a;">人気3種セット</div><div style="font-size:11px;color:#999;">¥3,240（100pt使える）</div></a>` +
                    `</td></tr></table>` +
                  `<table cellpadding="0" cellspacing="0" border="0" style="width:100%;margin-bottom:8px;"><tr>` +
                    `<td style="width:50px;padding:0;vertical-align:middle;text-align:center;"><div style="width:50px;height:50px;line-height:50px;font-size:22px;border-radius:8px;background:#fbf6ed;">🍶</div></td>` +
                    `<td style="padding:0 0 0 12px;vertical-align:middle;">` +
                      `<a href="https://oryzae.shop/products/oryzae-drink3" style="text-decoration:none;display:block;"><div style="font-size:13px;font-weight:600;color:#1a1a1a;">オリゼの甘酒3種セット</div><div style="font-size:11px;color:#999;">¥3,360（100pt使える）</div></a>` +
                    `</td></tr></table>` +
                  `<table cellpadding="0" cellspacing="0" border="0" style="width:100%;"><tr>` +
                    `<td style="width:50px;padding:0;vertical-align:middle;text-align:center;"><div style="width:50px;height:50px;line-height:50px;font-size:22px;border-radius:8px;background:#fbf6ed;">🍫</div></td>` +
                    `<td style="padding:0 0 0 12px;vertical-align:middle;">` +
                      `<a href="https://oryzae.shop/products/granola-bar" style="text-decoration:none;display:block;"><div style="font-size:13px;font-weight:600;color:#1a1a1a;">米麹グラノーラバー</div><div style="font-size:11px;color:#999;">¥1,980（100pt使える）</div></a>` +
                    `</td></tr></table>`;
              }

              const custResp = await fetch(
                `https://${shopDomain}/admin/api/2026-04/customers/${shopifyCustomerId}.json`,
                { headers: { 'X-Shopify-Access-Token': adminToken } }
              );
              if (custResp.ok) {
                const custData = await custResp.json() as { customer: { email: string } };
                const email = custData.customer?.email;
                if (email) {
                  await fetch('https://api.resend.com/emails', {
                    method: 'POST',
                    headers: {
                      'Authorization': `Bearer ${c.env.RESEND_API_KEY}`,
                      'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                      from: c.env.FERMENT_FROM_EMAIL_JP,
                      to: [email],
                      subject: '🎂 誕生日登録ありがとうございます！100ptをプレゼント',
                      html: `
                        <div style="font-family:'Zen Kaku Gothic New','Hiragino Sans',sans-serif;max-width:480px;margin:0 auto;background:#faf8f4;">
                          <div style="background:#b8860b;padding:20px;text-align:center;">
                            <div style="font-size:36px;margin-bottom:4px;">🎂</div>
                            <h1 style="color:#fff;font-size:18px;margin:0;font-weight:700;">誕生日登録ありがとうございます</h1>
                          </div>

                          <div style="padding:24px 20px;background:#fff;margin:0 12px;border-radius:0 0 12px 12px;">
                            <p style="margin:0 0 16px;font-size:14px;color:#333;line-height:1.7;">
                              ${displayName}さん<br>
                              誕生日を登録いただきありがとうございます！<br>
                              <strong style="color:#b8860b;font-size:18px;">100pt</strong>をプレゼントしました 🎉
                            </p>

                            <div style="background:#fbf6ed;border:1px solid #ead6b0;border-radius:10px;padding:16px;margin:0 0 20px;">
                              <table style="width:100%;font-size:13px;color:#5c4a2e;">
                                <tr><td style="padding:4px 0;">誕生日</td><td style="padding:4px 0;font-weight:600;text-align:right;">${bdayDisplay}</td></tr>
                                <tr><td style="padding:4px 0;">プレゼント</td><td style="padding:4px 0;font-weight:600;text-align:right;color:#b8860b;">100pt</td></tr>
                                <tr><td style="padding:4px 0;">現在の残高</td><td style="padding:4px 0;font-weight:600;text-align:right;">${balanceAfter}pt</td></tr>
                              </table>
                            </div>

                            <a href="https://oryzae.shop/cart"
                              style="display:block;text-align:center;padding:14px;background:#b8860b;color:#fff;border-radius:10px;font-size:15px;font-weight:700;text-decoration:none;margin:0 0 8px;">
                              100ptをお得に使う 🛒
                            </a>
                            <p style="margin:0 0 20px;font-size:12px;color:#999;text-align:center;">100ptがカートでのお支払いに使えます</p>

                            <div style="margin:0 0 20px;">
                              <p style="margin:0 0 10px;font-size:13px;font-weight:600;color:#5c4a2e;">🍚 人気の商品</p>
                              ${recommendHtml}
                            </div>

                            <p style="margin:0 0 20px;font-size:13px;color:#b8860b;text-align:center;font-weight:500;">
                              🎁 誕生月には特別クーポンをお届けします。お楽しみに！
                            </p>

                            <p style="margin:0;font-size:12px;color:#999;text-align:center;">
                              ポイントは無期限でご利用いただけます。<br>
                              カートでもポイント残高をご確認いただけます。
                            </p>
                          </div>

                          <div style="padding:16px 20px;text-align:center;">
                            <p style="margin:0;font-size:11px;color:#aaa;">
                              株式会社オリゼ<br>
                              <a href="https://oryzae.shop" style="color:#b8860b;text-decoration:none;">https://oryzae.shop</a>
                            </p>
                          </div>
                        </div>
                      `,
                    }),
                  });
                }
              }
            }
          }
        } catch (_e) {
          console.error('birthday notification error:', _e);
        }
      })()
    );

    return c.json({
      success: true,
      data: {
        earnedPoints: awardedPoints,
        limitedExpiresAt,
        birthday,
        message: `🎂 誕生日登録ありがとうございます！${awardedPoints}ptを付与しました`,
      },
    });
  } catch (e) {
    console.error('profile birthday error:', e);
    return c.json({ success: false, error: '誕生日登録に失敗しました' }, 500);
  }
});

// POST /api/loyalty/shopify/:shopifyCustomerId/redeem — ポイント → 割引コード発行
loyalty.post('/api/loyalty/shopify/:shopifyCustomerId/redeem', async (c) => {
  try {
    // 本人確認（REQUIRE_CUSTOMER_SIG=1 のときのみ必須・段階導入）
    const sigErr = await checkCustomerSig(c, c.req.param('shopifyCustomerId'));
    if (sigErr) return sigErr;
    const shopifyCustomerId = c.req.param('shopifyCustomerId');
    const body = await c.req.json<{ points: number }>(); // 使うポイント数（100pt単位）

    if (!body.points || body.points <= 0 || body.points % 100 !== 0) {
      return c.json(
        { success: false, error: 'points は 100 の倍数で指定してください' },
        400,
      );
    }

    const point = await getLoyaltyPointByShopifyCustomerId(c.env.DB, shopifyCustomerId);
    if (!point) {
      return c.json({ success: false, error: 'ポイント残高がありません' }, 400);
    }
    const totalBalance = point.balance + (point.limited_balance ?? 0);
    if (totalBalance < body.points) {
      return c.json({ success: false, error: `ポイント残高が不足しています（現在 ${totalBalance}pt）` }, 400);
    }

    // 既存の未使用コードがあれば発行をブロック
    const shopDomain = c.env.SHOPIFY_SHOP_DOMAIN;
    const adminToken = await getShopifyAdminToken(c.env);
    try {
      const latestRedeem = await c.env.DB
        .prepare(`SELECT reason FROM loyalty_transactions WHERE friend_id = ? AND type = 'redeem' AND reason NOT LIKE '[取り消し済み]%' AND reason NOT LIKE '[利用済み]%' ORDER BY created_at DESC LIMIT 1`)
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

    // 3) ポイント残高を減算（期間限定 → 通常の順で消費）
    const limitedToUse = Math.min(point.limited_balance ?? 0, body.points);
    const balanceToUse = body.points - limitedToUse;
    const newBalance = point.balance - balanceToUse;
    const newLimitedBalance = (point.limited_balance ?? 0) - limitedToUse;
    const newRank = determineRank(point.total_spent);

    await upsertLoyaltyPoint(c.env.DB, point.friend_id, {
      balance: newBalance,
      limitedBalance: newLimitedBalance,
      limitedExpiresAt: newLimitedBalance > 0 ? point.limited_expires_at : null,
      totalSpent: point.total_spent,
      rank: newRank,
      shopifyCustomerId,
    });

    // 内訳タグを reason に埋め込む（cancel-code が逆順返還するために必要）
    // フォーマット: [内訳:limited=<N>,balance=<N>,exp=<ISO|none>]
    const breakdownTag = `[内訳:limited=${limitedToUse},balance=${balanceToUse},exp=${point.limited_expires_at ?? 'none'}]`;

    await addLoyaltyTransaction(c.env.DB, {
      friendId: point.friend_id,
      type: 'redeem',
      points: -body.points,
      balanceAfter: newBalance + newLimitedBalance,
      reason: `ポイント利用（¥${discountAmount}割引 / コード: ${code}）${breakdownTag}`,
    });

    return c.json({
      success: true,
      data: {
        code,
        discountAmount,
        pointsUsed: body.points,
        balanceAfter: newBalance,
        limitedBalanceAfter: newLimitedBalance,
        breakdown: { balance: balanceToUse, limited: limitedToUse },
      },
    });
  } catch (e) {
    return c.json({ success: false, error: 'Failed to redeem points' }, 500);
  }
});

// POST /api/loyalty/shopify/:shopifyCustomerId/cancel-code — 未使用割引コードをキャンセルしてポイント返還
loyalty.post('/api/loyalty/shopify/:shopifyCustomerId/cancel-code', async (c) => {
  try {
    // 本人確認（REQUIRE_CUSTOMER_SIG=1 のときのみ必須・段階導入）
    const sigErr = await checkCustomerSig(c, c.req.param('shopifyCustomerId'));
    if (sigErr) return sigErr;
    const shopifyCustomerId = c.req.param('shopifyCustomerId');
    const body = await c.req.json<{ code: string }>();

    if (!body.code || typeof body.code !== 'string') {
      return c.json({ success: false, error: 'code は必須です' }, 400);
    }

    // 返金処理は共通関数 refundUnusedPointCode に集約（注文時/cron の自動返還と同一ロジック）
    const result = await refundUnusedPointCode(c.env, shopifyCustomerId, body.code, 'manual');

    if (!result.refunded) {
      switch (result.reason) {
        case 'not_owned':
          return c.json({ success: false, error: '指定されたコードはこのアカウントのものではありません' }, 403);
        case 'no_point':
          return c.json({ success: false, error: 'ポイント情報が見つかりません' }, 404);
        case 'shopify_unconfigured':
          return c.json({ success: false, error: 'Shopify 設定が未構成です' }, 500);
        case 'shopify_error':
          return c.json({ success: false, error: 'Shopify API エラー、またはコード状況の確認・削除に失敗しました' }, 500);
        case 'used':
          return c.json({ success: false, error: 'このコードはすでに使用済みのためキャンセルできません' }, 400);
        case 'no_redeem':
          return c.json({ success: false, error: 'すでに取り消し済み、または対象の利用記録が見つかりません' }, 400);
        case 'amount_unknown':
          return c.json({ success: false, error: '返還ポイント数を特定できませんでした' }, 500);
        default:
          return c.json({ success: false, error: 'コードの取り消しに失敗しました' }, 500);
      }
    }

    return c.json({
      success: true,
      data: { refundPoints: result.refundPoints, balance: result.balance, rank: result.rank },
    });
  } catch (e) {
    return c.json({ success: false, error: 'Failed to cancel code' }, 500);
  }
});

// ────────────────────────────────────────────────────────────────────
// POST /api/loyalty/admin/backfill-purchases
//   新システム移管後(既定 2026-04-15〜)の「付与漏れ購入ポイント」を補填する管理用バッチ。
//   - 認証必須(authMiddleware: Bearer API_KEY)。
//   - 対象 = since以降の有効注文(Shopify を直接読む) × 会員 × award未付与。
//     ※付与漏れと同じ原因で自社台帳 shopify_orders も 5/8 以降が欠落しているため、
//       台帳ではなく Shopify を直接読む（取りこぼし防止）。
//   - LINE通知は送らず、マイページ履歴(reason)に残すのみ。冪等(同一order_idは二重付与しない)。
//   指定方法は2通り（どちらでも可）:
//     (a) URLクエリ:  ?dryRun=false&maxAward=1&since=2026-04-15   ← ターミナルから安全（推奨）
//     (b) JSON body:  { since?, dryRun?(既定true), maxAward?, maxPages? }
//   ※クエリと body の両方があればクエリを優先する。
// ────────────────────────────────────────────────────────────────────
loyalty.post('/api/loyalty/admin/backfill-purchases', async (c) => {
  try {
    const body = await c.req
      .json<{ since?: string; dryRun?: boolean; maxAward?: number; maxPages?: number }>()
      .catch(() => ({} as { since?: string; dryRun?: boolean; maxAward?: number; maxPages?: number }));

    // ── クエリパラメータ指定を優先する ──
    // 背景: ターミナル(zsh)で `-d '{"dryRun":false,...}'` を渡すと、引用符や { } の
    //   解釈で JSON body がサーバに届かず、安全側の dryRun(集計のみ)に化けることがある。
    //   そこで URL クエリ(?dryRun=false&maxAward=1&since=2026-04-15)でも指定できるようにする。
    const q = c.req.query();
    const toInt = (v: string | undefined): number | undefined => {
      if (v === undefined) return undefined;
      const n = parseInt(v, 10);
      return Number.isFinite(n) ? n : undefined; // 数値でなければ無視（暴走防止）
    };
    const since = q.since ?? body.since;
    // dryRun は明示的に 'false' のときだけ false（それ以外は安全側=集計のみ）
    const dryRun = q.dryRun !== undefined ? q.dryRun !== 'false' : body.dryRun;
    const maxAward = toInt(q.maxAward) ?? body.maxAward;
    const maxPages = toInt(q.maxPages) ?? body.maxPages;

    const summary = await runPurchaseBackfill(c.env, { since, dryRun, maxAward, maxPages });
    return c.json({ success: true, data: summary });
  } catch (e) {
    return c.json({ success: false, error: e instanceof Error ? e.message : 'backfill-purchases failed' }, 500);
  }
});

// ────────────────────────────────────────────────────────────────────
// POST /api/loyalty/admin/preview-unused-code-refunds
//   バグB(未使用ポイント割引コードの返金)の【実態把握・読み取り専用】試算。
//   返金候補のうち Shopify で本当に未使用/存在しないコードを数え、実際の返金件数・
//   ポイントを返す。DB にも Shopify にも一切書き込まない（返金は行わない）。
//   Shopify 照合は GraphQL codeDiscountNodeByCode のエイリアス一括(50件/回)で行うため、
//   全候補(~200件)を1回の実行でまとめて数えられる。
//   省略可クエリ: limit(候補上限・既定1000) / graceDays(既定14)。
//   認証必須(authMiddleware: Bearer API_KEY)。
// ────────────────────────────────────────────────────────────────────
loyalty.post('/api/loyalty/admin/preview-unused-code-refunds', async (c) => {
  try {
    const q = c.req.query();
    const toIntQ = (v: string | undefined): number | undefined => {
      if (v === undefined) return undefined;
      const n = parseInt(v, 10);
      return Number.isFinite(n) ? n : undefined;
    };
    const result = await previewUnusedCodeRefunds(c.env, {
      limit: toIntQ(q.limit),
      graceDays: toIntQ(q.graceDays),
    });
    return c.json({ success: true, data: result });
  } catch (e) {
    return c.json({ success: false, error: e instanceof Error ? e.message : 'preview-unused-code-refunds failed' }, 500);
  }
});

// ────────────────────────────────────────────────────────────────────
// POST /api/loyalty/admin/refund-unused-codes
//   バグB(未使用ポイント割引コードの返金)の【手動・少量ずつ】実行トリガー。
//   B2スイープを force=true で呼び、1回あたり max 件まで返金する（既定20=サブリクエスト上限内）。
//   未使用コードのみ返金（使用済みは [利用済み] 印を付けてスキップ）。冪等(返金済みは
//   [取り消し済み] 除外)。返り値に refunded/usedSkipped/errors/errorSamples を含め、毎回確認可能。
//   例: ?max=20&graceDays=14   （hasMore 的に scanned<候補数の間は再実行して消化）
//   認証必須(authMiddleware: Bearer API_KEY)。
// ────────────────────────────────────────────────────────────────────
loyalty.post('/api/loyalty/admin/refund-unused-codes', async (c) => {
  try {
    const q = c.req.query();
    const toIntQ = (v: string | undefined): number | undefined => {
      if (v === undefined) return undefined;
      const n = parseInt(v, 10);
      return Number.isFinite(n) ? n : undefined;
    };
    const result = await sweepUnusedPointCodes(c.env, {
      force: true,
      limit: toIntQ(q.max) ?? toIntQ(q.limit),
      graceDays: toIntQ(q.graceDays),
    });
    return c.json({ success: true, data: result });
  } catch (e) {
    return c.json({ success: false, error: e instanceof Error ? e.message : 'refund-unused-codes failed' }, 500);
  }
});

// ────────────────────────────────────────────────────────────────────
// POST /api/loyalty/admin/refund-specific-codes
//   指定したコードだけをピンポイント返金する管理用ツール（③消失=取り戻せない人の個別救済）。
//   items に「顧客ID:コード」をカンマ区切りで列挙（JSON body不要・URLクエリ）。
//   例: ?items=8036778115231:ORYZAE-115231-MOJW0F7I,6345312469151:ORYZAE-469151-MOWSRDY5
//   各コードは共通の refundUnusedPointCode で処理するため、万一「使用済み(Shopifyで回数≧1)」の
//   コードを指定しても used 判定で返金されない（安全装置は共通）。冪等(返金済みは [取り消し済み] 除外)。
//   ※消失コードは Shopify で使用回数を確認できないため、呼ぶ前に注文履歴で「未使用」を確認済みのものだけ渡すこと。
//   認証必須(authMiddleware: Bearer API_KEY)。
// ────────────────────────────────────────────────────────────────────
loyalty.post('/api/loyalty/admin/refund-specific-codes', async (c) => {
  try {
    const itemsRaw = (c.req.query('items') ?? '').trim();
    const items = itemsRaw.split(',').map((s) => s.trim()).filter(Boolean);
    if (items.length === 0) {
      return c.json({ success: false, error: 'items は「顧客ID:コード」のカンマ区切りで指定してください' }, 400);
    }
    if (items.length > 50) {
      return c.json({ success: false, error: 'items は一度に最大50件まで' }, 400);
    }
    const results: Array<{ scid: string; code: string; refunded: boolean; refundPoints?: number; reason: string }> = [];
    for (const item of items) {
      const idx = item.indexOf(':');
      if (idx <= 0) {
        results.push({ scid: '', code: item, refunded: false, reason: 'bad_format' });
        continue;
      }
      const scid = item.slice(0, idx).trim();
      const code = item.slice(idx + 1).trim();
      // 自動返還と同じ文言('cron')で記録：「未使用の割引コード分のポイントをお戻ししました」
      const r = await refundUnusedPointCode(c.env, scid, code, 'cron');
      results.push({ scid, code, refunded: r.refunded, refundPoints: r.refundPoints, reason: r.reason });
    }
    const refunded = results.filter((r) => r.refunded).length;
    const refundedPoints = results.reduce((s, r) => s + (r.refunded ? (r.refundPoints ?? 0) : 0), 0);
    return c.json({ success: true, data: { refunded, refundedPoints, results } });
  } catch (e) {
    return c.json({ success: false, error: e instanceof Error ? e.message : 'refund-specific-codes failed' }, 500);
  }
});

// ────────────────────────────────────────────────────────────────────
// POST /api/loyalty/admin/rescue-socialplus-link?scid=<ShopifyCustomerId>&bonusSince=2026-04-15
//   旧CRM PLUS(SocialPLUS)の id-connect-line ページでLINE連携したが、自社ポイントに
//   未登録の顧客を救済する。Shopify顧客の `socialplus.line`(LINE UID) で自社に紐付け、
//   未付与の **LINE連携ボーナス+300pt** と(誕生日登録済なら) **誕生日登録ボーナス+100pt** を付与。
//   - bonusSince(YYYY-MM-DD・任意): 指定時、顧客作成日がそれ以降の人だけボーナス付与。
//     それより古い顧客は「紐付けのみ」(linked_no_bonus)。移管(4/15)前から連携していた人は
//     旧システム時代にボーナスを受けている可能性があり二重付与を避けるため（補填方針と同じ線引き）。
//   - 冪等: 既に自社連携(loyalty_points に shopify_customer_id 行あり)なら何もしない。
//     LINE UID 側に既存行がある場合は「紐付けのみ(ボーナス付与なし=二重防止)」。
//   - 通知なし(addLoyaltyTransaction 直書き)。購入ポイントは別途 backfill-purchases で。
//   認証必須(authMiddleware: Bearer API_KEY)。
// ────────────────────────────────────────────────────────────────────
loyalty.post('/api/loyalty/admin/rescue-socialplus-link', async (c) => {
  try {
    const scid = (c.req.query('scid') ?? '').trim();
    if (!scid) return c.json({ success: false, error: 'scid は必須です' }, 400);
    const bonusSince = (c.req.query('bonusSince') ?? '').trim();
    if (bonusSince && !/^\d{4}-\d{2}-\d{2}$/.test(bonusSince)) {
      return c.json({ success: false, error: 'bonusSince は YYYY-MM-DD 形式で指定してください' }, 400);
    }
    // 実体は services/loyalty-socialplus-rescue.ts（日次cronと同じロジック）
    const r = await rescueSocialplusCustomer(c.env, scid, { bonusSince: bonusSince || undefined });
    if (r.action === 'error') return c.json({ success: false, step: r.step, error: r.error }, 500);
    return c.json({ success: true, data: r });
  } catch (e) {
    return c.json({ success: false, error: e instanceof Error ? e.message : 'rescue-socialplus-link failed' }, 500);
  }
});

// ────────────────────────────────────────────────────────────────────
// POST /api/loyalty/admin/rescue-socialplus-sweep?sinceHours=48&limit=30
//   日次cron(自動救済)と同じスイープを手動実行する（設定フラグ無視=force）。動作テスト用。
//   「最近更新された顧客」だけ走査して新規被害を回収する軽量版。
//   認証必須(authMiddleware: Bearer API_KEY)。
// ────────────────────────────────────────────────────────────────────
loyalty.post('/api/loyalty/admin/rescue-socialplus-sweep', async (c) => {
  try {
    const toIntQ = (v: string | undefined): number | undefined => {
      if (v === undefined) return undefined;
      const n = parseInt(v, 10);
      return Number.isFinite(n) ? n : undefined;
    };
    const r = await sweepSocialplusUnlinked(c.env, {
      force: true,
      sinceHours: toIntQ(c.req.query('sinceHours')),
      limit: toIntQ(c.req.query('limit')),
    });
    return c.json({ success: true, data: r });
  } catch (e) {
    return c.json({ success: false, error: e instanceof Error ? e.message : 'rescue-socialplus-sweep failed' }, 500);
  }
});

// ────────────────────────────────────────────────────────────────────
// POST /api/loyalty/admin/test-shipping-notify?orderId=<注文の数値ID>
//   発送LINE通知の動作テスト。指定注文をShopifyから取得し、force=trueで通知を送る
//   （機能フラグOFF・重複ログを無視して送るので、自分の注文で見た目を確認できる）。
//   注文は発送済み(追跡情報あり)を推奨。認証必須。
// ────────────────────────────────────────────────────────────────────
loyalty.post('/api/loyalty/admin/test-shipping-notify', async (c) => {
  try {
    const orderId = (c.req.query('orderId') ?? '').trim();
    if (!orderId) return c.json({ success: false, error: 'orderId は必須です（注文の数値ID）' }, 400);

    const shopDomain = c.env.SHOPIFY_SHOP_DOMAIN;
    const adminToken = await getShopifyAdminToken(c.env);
    if (!shopDomain || !adminToken) return c.json({ success: false, error: 'Shopify 設定が未構成です' }, 500);

    const res = await fetch(`https://${shopDomain}/admin/api/2024-10/graphql.json`, {
      method: 'POST',
      headers: { 'X-Shopify-Access-Token': adminToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: `query($id:ID!){ order(id:$id){ name customer{ legacyResourceId } lineItems(first:20){ nodes{ title quantity } } fulfillments(first:5){ status trackingInfo{ number url company } } } }`,
        variables: { id: `gid://shopify/Order/${orderId}` },
      }),
    });
    if (!res.ok) return c.json({ success: false, error: `Shopify ${res.status}` }, 500);
    const j = (await res.json()) as {
      data?: { order?: { name?: string; customer?: { legacyResourceId?: string } | null;
        lineItems?: { nodes?: Array<{ title?: string; quantity?: number }> };
        fulfillments?: Array<{ status?: string; trackingInfo?: Array<{ number?: string; url?: string; company?: string }> }> } | null };
      errors?: unknown;
    };
    if (j.errors || !j.data?.order) return c.json({ success: false, error: '注文が見つかりません', detail: JSON.stringify(j.errors ?? {}).slice(0, 200) }, 404);
    const o = j.data.order;

    // GraphQL の形を ShipOrderLite に変換（fulfillment.status は大文字enum → 小文字化）
    const order = {
      id: orderId,
      name: o.name ?? null,
      customer: o.customer?.legacyResourceId ? { id: o.customer.legacyResourceId } : null,
      line_items: (o.lineItems?.nodes ?? []).map((li) => ({ title: li.title ?? null, quantity: li.quantity ?? 1 })),
      fulfillments: (o.fulfillments ?? []).map((f) => {
        const t = (f.trackingInfo ?? [])[0] ?? {};
        return {
          status: (f.status ?? 'success').toLowerCase(),
          tracking_number: t.number ?? null,
          tracking_url: t.url ?? null,
          tracking_company: t.company ?? null,
        };
      }),
    };

    // ?first=1 で「初回案内（📣）」付きの見た目をプレビューできる（テスト用）
    const forceFirstTime = c.req.query('first') === '1';
    // ?toLineUserId=U... で、注文の購入者ではなく指定したLINEへ直接送る（チーム内レビュー用）
    const toLineUserId = (c.req.query('toLineUserId') ?? '').trim();
    const overrideLineUserId = toLineUserId.startsWith('U') ? toLineUserId : undefined;
    const { notifyOrderShipped } = await import('../services/shipping-line-notify.js');
    const r = await notifyOrderShipped(c.env, order, { force: true, forceFirstTime, overrideLineUserId });
    return c.json({ success: true, data: r });
  } catch (e) {
    return c.json({ success: false, error: e instanceof Error ? e.message : 'test-shipping-notify failed' }, 500);
  }
});

// ────────────────────────────────────────────────────────────────────
// POST /api/loyalty/admin/register-fulfillment-webhook
//   orders/fulfilled の Shopify Webhook を自社ワーカーに登録する（自己登録）。
//   コールバックURLに ?token=SHOPIFY_WEBHOOK_SECRET を付けるため、河原さんが
//   シークレット値を知らなくても1コマンドで安全に登録できる。冪等（重複時はその旨返す）。
//   認証必須。
// ────────────────────────────────────────────────────────────────────
loyalty.post('/api/loyalty/admin/register-fulfillment-webhook', async (c) => {
  try {
    const env = c.env as unknown as Record<string, string | undefined>;
    const shopDomain = c.env.SHOPIFY_SHOP_DOMAIN;
    const adminToken = await getShopifyAdminToken(c.env);
    const secret = env.SHOPIFY_WEBHOOK_SECRET;
    const workerUrl = (env.WORKER_URL || 'https://oryzae-line-crm.oryzae.workers.dev').replace(/\/$/, '');
    if (!shopDomain || !adminToken) return c.json({ success: false, error: 'Shopify 設定が未構成です' }, 500);
    if (!secret) return c.json({ success: false, error: 'SHOPIFY_WEBHOOK_SECRET が未設定です' }, 500);

    const callbackUrl = `${workerUrl}/api/shopify/webhooks/orders-fulfilled?token=${secret}`;
    const res = await fetch(`https://${shopDomain}/admin/api/2024-10/graphql.json`, {
      method: 'POST',
      headers: { 'X-Shopify-Access-Token': adminToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: `mutation($url:URL!){ webhookSubscriptionCreate(topic: ORDERS_FULFILLED, webhookSubscription:{ callbackUrl:$url, format: JSON }){ webhookSubscription{ id } userErrors{ field message } } }`,
        variables: { url: callbackUrl },
      }),
    });
    if (!res.ok) return c.json({ success: false, error: `Shopify ${res.status}` }, 500);
    const j = (await res.json()) as {
      data?: { webhookSubscriptionCreate?: { webhookSubscription?: { id?: string } | null; userErrors?: { message: string }[] } };
      errors?: unknown;
    };
    const userErrors = j.data?.webhookSubscriptionCreate?.userErrors ?? [];
    const id = j.data?.webhookSubscriptionCreate?.webhookSubscription?.id;
    if (id) {
      // コールバックURLにはシークレットが含まれるため、応答ではマスクして返す
      return c.json({ success: true, data: { action: 'registered', id, callbackUrl: `${workerUrl}/api/shopify/webhooks/orders-fulfilled?token=***` } });
    }
    const already = userErrors.some((e) => /already|taken|exist/i.test(e.message));
    if (already) return c.json({ success: true, data: { action: 'already_registered', userErrors } });
    return c.json({ success: false, error: 'registration failed', detail: JSON.stringify(j.errors ?? userErrors).slice(0, 300) }, 500);
  } catch (e) {
    return c.json({ success: false, error: e instanceof Error ? e.message : 'register-fulfillment-webhook failed' }, 500);
  }
});

// ────────────────────────────────────────────────────────────────────
// POST /api/loyalty/admin/scan-socialplus-unlinked?limit=500&cursor=<endCursor>
//   Shopify顧客を走査し「socialplus.line(旧CRM PLUS連携) がある × 自社loyalty未登録」=
//   小川様と同じ被害の人数を数える。affectedSample に対象 scid を最大30件返す。
//   1回 limit 件(既定500・最大1000)走査し、nextCursor/hasMore でページング(全件は繰り返し)。
//   ※read-only(数えるだけ)。各顧客の socialplus.line は customers クエリで一括取得(追加subreqなし)、
//     loyalty照合は D1。認証必須(authMiddleware: Bearer API_KEY)。
// ────────────────────────────────────────────────────────────────────
loyalty.post('/api/loyalty/admin/scan-socialplus-unlinked', async (c) => {
  try {
    const limit = Math.min(Math.max(parseInt(c.req.query('limit') ?? '500', 10) || 500, 50), 1000);
    const shopDomain = c.env.SHOPIFY_SHOP_DOMAIN;
    const adminToken = await getShopifyAdminToken(c.env);
    if (!shopDomain || !adminToken) return c.json({ success: false, error: 'Shopify 設定が未構成です' }, 500);

    const QUERY = `query($cursor:String){ customers(first:250, after:$cursor){ nodes{ legacyResourceId line: metafield(namespace:"socialplus", key:"line"){ value } } pageInfo{ hasNextPage endCursor } } }`;

    let scanned = 0, withSocialplus = 0, linked = 0, affected = 0;
    const affectedSample: string[] = [];
    let nextCursor: string | null = c.req.query('cursor') || null;
    let hasMore = true;

    while (scanned < limit && hasMore) {
      const res = await fetch(`https://${shopDomain}/admin/api/2024-10/graphql.json`, {
        method: 'POST',
        headers: { 'X-Shopify-Access-Token': adminToken, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: QUERY, variables: { cursor: nextCursor } }),
      });
      if (!res.ok) return c.json({ success: false, error: `Shopify ${res.status}`, scanned, nextCursor }, 500);
      const j = (await res.json()) as {
        data?: { customers?: { nodes?: Array<{ legacyResourceId?: string; line?: { value?: string } | null }>; pageInfo?: { hasNextPage?: boolean; endCursor?: string | null } } };
        errors?: unknown;
      };
      if (j.errors) return c.json({ success: false, error: 'Shopify GraphQL error', detail: JSON.stringify(j.errors).slice(0, 200) }, 500);
      const conn = j.data?.customers;
      for (const n of conn?.nodes ?? []) {
        scanned++;
        const sp = (n.line?.value ?? '').trim();
        if (!sp) continue; // socialplus連携なし
        withSocialplus++;
        const scid = String(n.legacyResourceId ?? '');
        if (!scid) continue;
        const lp = await getLoyaltyPointByShopifyCustomerId(c.env.DB, scid).catch(() => null);
        if (lp) {
          linked++;
        } else {
          affected++;
          // 1バッチ(最大1000人)の affected を全件返す（実測最大37件/バッチなので50で十分）。
          // 一括救済のとき、このリストをそのまま rescue-socialplus-link に渡す。
          if (affectedSample.length < 50) affectedSample.push(scid);
        }
      }
      hasMore = !!conn?.pageInfo?.hasNextPage;
      nextCursor = conn?.pageInfo?.endCursor ?? null;
    }

    return c.json({ success: true, data: { scanned, withSocialplus, linked, affected, affectedSample, nextCursor, hasMore } });
  } catch (e) {
    return c.json({ success: false, error: e instanceof Error ? e.message : 'scan-socialplus-unlinked failed' }, 500);
  }
});

// ────────────────────────────────────────────────────────────────────
// POST /api/loyalty/admin/birthday-coupon-run?mode=dryrun|test|live&force=1&today=MM-DD
//   誕生日クーポン処理を手動実行。mode/force で上書き（未指定は設定値）。
//   dryrun=対象を数えるだけ(発行も送信もしない) / test=テスト送り先(河原さん)だけに発行＋送信 /
//   live=当日誕生日の全対象へ発行＋送信。today=MM-DD で「今日」を上書き(動作確認用)。認証必須。
// ────────────────────────────────────────────────────────────────────
loyalty.post('/api/loyalty/admin/birthday-coupon-run', async (c) => {
  try {
    const modeQ = c.req.query('mode');
    const mode = modeQ === 'dryrun' || modeQ === 'test' || modeQ === 'live' ? modeQ : undefined;
    const force = c.req.query('force') === '1';
    const todayQ = c.req.query('today') ?? '';
    const todayMMDD = /^\d{2}-\d{2}$/.test(todayQ) ? todayQ : undefined;
    const { processBirthdayCoupons } = await import('../services/birthday-coupon.js');
    const r = await processBirthdayCoupons(c.env, { mode, force, todayMMDD });
    return c.json({ success: true, data: r });
  } catch (e) {
    return c.json({ success: false, error: e instanceof Error ? e.message : 'birthday-coupon-run failed' }, 500);
  }
});

// ────────────────────────────────────────────────────────────────────
// POST /api/loyalty/admin/email-link-lookup?email=foo@example.com
//   メール起点LINE連携(email-link)のスモークテスト。メールは送らず、連携もしない。
//   「入力メール → Shopify顧客ID」の特定だけを確認する（認証必須・読み取りのみ）。
//   ※本番有効化前の動作確認用。GraphQL email検索の挙動を実データで検証できる。
// ────────────────────────────────────────────────────────────────────
loyalty.post('/api/loyalty/admin/email-link-lookup', async (c) => {
  try {
    const email = (c.req.query('email') ?? '').trim().toLowerCase();
    if (!email) return c.json({ success: false, error: 'email クエリは必須です' }, 400);
    const { findShopifyCustomerByEmail } = await import('../services/email-link.js');
    const result = await findShopifyCustomerByEmail(c.env, email);
    return c.json({
      success: true,
      email,
      found: typeof result === 'string',
      shopifyCustomerId: typeof result === 'string' ? result : null,
      ambiguous: result === 'ambiguous',
    });
  } catch (e) {
    return c.json({ success: false, error: e instanceof Error ? e.message : 'email-link-lookup failed' }, 500);
  }
});

// ────────────────────────────────────────────────────────────────────
// POST /api/loyalty/admin/birthday-backfill
//   既に誕生日登録済み(誕生日登録ボーナス履歴あり)で D1 birthday 未設定の連携顧客について、
//   Shopify の facts.birth_date を読んで loyalty_points.birthday に書き写す（一度だけ実行）。
//   登録者は少数なので対象を絞って取得（全件走査しない）。認証必須・読み込みのみ→自社DB更新。
// ────────────────────────────────────────────────────────────────────
loyalty.post('/api/loyalty/admin/birthday-backfill', async (c) => {
  try {
    const shopDomain = c.env.SHOPIFY_SHOP_DOMAIN;
    const adminToken = await getShopifyAdminToken(c.env);
    if (!shopDomain || !adminToken) return c.json({ success: false, error: 'Shopify 設定が未構成です' }, 500);

    const rows = await c.env.DB
      .prepare(
        `SELECT lp.shopify_customer_id AS scid, lp.friend_id AS fid
         FROM loyalty_points lp
         WHERE lp.shopify_customer_id IS NOT NULL AND lp.birthday IS NULL
           AND EXISTS (SELECT 1 FROM loyalty_transactions t WHERE t.friend_id = lp.friend_id AND t.reason LIKE '誕生日登録ボーナス%')
         LIMIT 500`,
      )
      .all<{ scid: string; fid: string }>();
    const candidates = rows.results ?? [];

    let updated = 0, noBirthday = 0, errors = 0;
    const errorSamples: string[] = [];
    for (const row of candidates) {
      try {
        const res = await fetch(
          `https://${shopDomain}/admin/api/2024-10/customers/${row.scid}/metafields.json?namespace=facts&key=birth_date`,
          { headers: { 'X-Shopify-Access-Token': adminToken } },
        );
        if (!res.ok) { errors++; if (errorSamples.length < 5) errorSamples.push(`${row.scid}: ${res.status}`); continue; }
        const j = (await res.json()) as { metafields?: Array<{ value?: string }> };
        const bday = ((j.metafields ?? [])[0]?.value ?? '').trim();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(bday)) { noBirthday++; continue; }
        await c.env.DB.prepare(`UPDATE loyalty_points SET birthday = ? WHERE friend_id = ?`).bind(bday, row.fid).run();
        updated++;
      } catch (e) {
        errors++; if (errorSamples.length < 5) errorSamples.push(`${row.scid}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    return c.json({ success: true, data: { candidates: candidates.length, updated, noBirthday, errors, errorSamples } });
  } catch (e) {
    return c.json({ success: false, error: e instanceof Error ? e.message : 'birthday-backfill failed' }, 500);
  }
});

// ────────────────────────────────────────────────────────────────────
// POST /api/loyalty/campaign-award — キャンペーンポイント付与（LP 等から呼ぶ）
//
// 8周年 LINE 連携特典など、定義済みキャンペーン (campaign_key) に対して
// 期間限定ポイントを付与する。point-charge Worker からの移行先。
//
// body: { campaign_key, lineUserId?, shopifyCustomerId? }
//   - lineUserId が指定されていれば friend を直接特定
//   - lineUserId 無しで shopifyCustomerId のみなら loyalty_points 経由で friend 解決
//   - friend が見つからない場合は 'not_linked' を返す
//
// 重複ガード: loyalty_transactions.order_id = '<campaign_key>-<friend_id>'
// ────────────────────────────────────────────────────────────────────
const CAMPAIGN_AWARD_RULES: Record<string, { points: number; label: string }> = {
  '8th_anniversary_88pt': { points: 388, label: '8周年キャンペーンLINE連携特典' },
};

loyalty.post('/api/loyalty/campaign-award', async (c) => {
  try {
    const body = await c.req.json<{
      campaign_key: string;
      lineUserId?: string;
      shopifyCustomerId?: string;
    }>();

    if (!body.campaign_key) {
      return c.json({ success: false, error: 'campaign_key は必須です' }, 400);
    }
    if (!body.lineUserId && !body.shopifyCustomerId) {
      return c.json({ success: false, error: 'lineUserId または shopifyCustomerId が必要です' }, 400);
    }

    const rule = CAMPAIGN_AWARD_RULES[body.campaign_key];
    if (!rule) {
      return c.json({ success: false, error: `未定義のキャンペーン: ${body.campaign_key}` }, 400);
    }

    // friend を特定
    let friendId: string | null = null;
    let shopifyCustomerId: string | null = body.shopifyCustomerId ?? null;
    if (body.lineUserId) {
      const friend = await getFriendByLineUserId(c.env.DB, body.lineUserId);
      if (friend) friendId = friend.id;
    }
    if (!friendId && shopifyCustomerId) {
      const lp = await getLoyaltyPointByShopifyCustomerId(c.env.DB, shopifyCustomerId);
      if (lp) friendId = lp.friend_id;
    }
    if (!friendId) {
      return c.json(
        {
          success: false,
          error: 'not_linked',
          message: 'LINE連携が完了していません。先に友だち追加・連携してください。',
        },
        400,
      );
    }

    // 期限設定を取得 (campaign_expiry_config テーブル、デフォルト 60 日)
    const expiryConfig = await c.env.DB
      .prepare(`SELECT expiry_days FROM campaign_expiry_config WHERE campaign_key = ? AND is_active = 1`)
      .bind(body.campaign_key)
      .first<{ expiry_days: number }>();
    const expiryDays = expiryConfig?.expiry_days ?? 60;
    const now = new Date();
    const jstNow = new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString().replace('Z', '+09:00');
    const jstExpiry = new Date(now.getTime() + (9 * 60 + expiryDays * 24 * 60) * 60 * 1000)
      .toISOString()
      .replace('Z', '+09:00');

    // 重複ガード
    const orderId = `${body.campaign_key}-${friendId}`;
    const existing = await c.env.DB
      .prepare(`SELECT id FROM loyalty_transactions WHERE order_id = ? LIMIT 1`)
      .bind(orderId)
      .first();
    if (existing) {
      return c.json({
        success: true,
        data: {
          awarded: false,
          reason: '既に付与済み',
          campaign_key: body.campaign_key,
        },
      });
    }

    // shopifyCustomerId が未指定の場合は loyalty_points から取得
    if (!shopifyCustomerId) {
      const lp = await getLoyaltyPoint(c.env.DB, friendId);
      shopifyCustomerId = lp?.shopify_customer_id ?? null;
    }

    // loyalty_points に limited_balance を加算
    const current = await getLoyaltyPoint(c.env.DB, friendId);
    const newLimited = (current?.limited_balance ?? 0) + rule.points;
    // 期限: 既存があれば早い方を優先 (安全側)
    let mergedExpiry: string = jstExpiry;
    if (current?.limited_expires_at) {
      mergedExpiry = new Date(current.limited_expires_at) < new Date(jstExpiry)
        ? current.limited_expires_at
        : jstExpiry;
    }
    const rank = (current?.rank as LoyaltyRank) ?? 'レギュラー';

    await upsertLoyaltyPoint(c.env.DB, friendId, {
      balance: current?.balance ?? 0,
      limitedBalance: newLimited,
      limitedExpiresAt: mergedExpiry,
      totalSpent: current?.total_spent ?? 0,
      rank,
      shopifyCustomerId: shopifyCustomerId ?? undefined,
    });

    const totalAfter = (current?.balance ?? 0) + newLimited;
    await addLoyaltyTransaction(c.env.DB, {
      friendId,
      type: 'award',
      points: rule.points,
      balanceAfter: totalAfter,
      reason: `${rule.label}: +${rule.points}pt（${expiryDays}日期限）`,
      orderId,
    });

    return c.json({
      success: true,
      data: {
        awarded: true,
        friend_id: friendId,
        shopify_customer_id: shopifyCustomerId,
        points: rule.points,
        campaign_key: body.campaign_key,
        expires_at: mergedExpiry,
        expiry_days: expiryDays,
      },
    });
  } catch (err) {
    console.error('POST /api/loyalty/campaign-award error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// POST /api/loyalty/link-shopify — LINE友だちとShopify顧客を紐付けて保留注文を自動バックフィル + 連携ボーナス付与
loyalty.post('/api/loyalty/link-shopify', async (c) => {
  try {
    const body = await c.req.json<{ friendId: string; shopifyCustomerId: string }>();
    if (!body.friendId || !body.shopifyCustomerId) {
      return c.json({ success: false, error: 'friendId と shopifyCustomerId は必須です' }, 400);
    }

    // 他の友だちが既にこのShopify顧客と紐付いていないかチェック
    const existing = await getLoyaltyPointByShopifyCustomerId(c.env.DB, body.shopifyCustomerId);
    if (existing && existing.friend_id !== body.friendId) {
      return c.json({
        success: false,
        error: 'この Shopify 顧客 ID は既に別の友だちに紐付いています',
        data: { linked_friend_id: existing.friend_id },
      }, 409);
    }

    // 紐付け（既存 loyalty_points を作成 or shopify_customer_id を更新）
    const current = await getLoyaltyPoint(c.env.DB, body.friendId);
    await upsertLoyaltyPoint(c.env.DB, body.friendId, {
      balance: current?.balance ?? 0,
      limitedBalance: current?.limited_balance ?? 0,
      totalSpent: current?.total_spent ?? 0,
      rank: current?.rank ?? 'レギュラー',
      shopifyCustomerId: body.shopifyCustomerId,
    });

    // LINE連携ボーナス（友だち単位で1回のみ・冪等性確保）
    const bonusEnabledSetting = await getLoyaltySetting(c.env.DB, 'link_bonus_enabled').catch(() => null);
    const bonusPointsSetting = await getLoyaltySetting(c.env.DB, 'link_bonus_points').catch(() => null);
    const bonusEnabled = (bonusEnabledSetting ?? '1') === '1';
    const bonusPoints = parseInt(bonusPointsSetting ?? '300', 10) || 300;

    let bonusAwarded = 0;
    if (bonusEnabled && bonusPoints > 0) {
      const existingBonus = await c.env.DB
        .prepare(`SELECT 1 FROM loyalty_transactions WHERE friend_id = ? AND reason = 'LINE連携ボーナス' LIMIT 1`)
        .bind(body.friendId)
        .first();
      if (!existingBonus) {
        const beforeBonus = await getLoyaltyPoint(c.env.DB, body.friendId);
        const newBalance = (beforeBonus?.balance ?? 0) + bonusPoints;
        await upsertLoyaltyPoint(c.env.DB, body.friendId, {
          balance: newBalance,
          limitedBalance: beforeBonus?.limited_balance ?? 0,
          totalSpent: beforeBonus?.total_spent ?? 0,
          rank: beforeBonus?.rank ?? 'レギュラー',
          shopifyCustomerId: body.shopifyCustomerId,
        });
        await addLoyaltyTransaction(c.env.DB, {
          friendId: body.friendId,
          type: 'adjust',
          points: bonusPoints,
          balanceAfter: newBalance + (beforeBonus?.limited_balance ?? 0),
          reason: 'LINE連携ボーナス',
        });
        bonusAwarded = bonusPoints;
      }
    }

    // 保留注文をバックフィル
    const backfill = await backfillPendingOrders(c.env.DB, body.friendId, body.shopifyCustomerId);

    return c.json({ success: true, data: { ...backfill, bonusAwarded } });
  } catch (e) {
    return c.json({ success: false, error: 'Failed to link and backfill' }, 500);
  }
});

// POST /api/loyalty/shopify/:shopifyCustomerId/backfill-pending — 管理者用：既存連携先の保留注文を手動でバックフィル
loyalty.post('/api/loyalty/shopify/:shopifyCustomerId/backfill-pending', async (c) => {
  try {
    const shopifyCustomerId = c.req.param('shopifyCustomerId');
    const point = await getLoyaltyPointByShopifyCustomerId(c.env.DB, shopifyCustomerId);
    if (!point) {
      return c.json({ success: false, error: 'この Shopify 顧客 ID は LINE に連携されていません' }, 404);
    }
    const backfill = await backfillPendingOrders(c.env.DB, point.friend_id, shopifyCustomerId);
    return c.json({ success: true, data: backfill });
  } catch (e) {
    return c.json({ success: false, error: 'Failed to backfill' }, 500);
  }
});

// POST /api/loyalty/admin/link-by-name — 管理用：名前で友だちを検索してShopify連携
loyalty.post('/api/loyalty/admin/link-by-name', async (c) => {
  try {
    const body = await c.req.json<{ displayName: string; shopifyCustomerId: string }>();
    if (!body.displayName || !body.shopifyCustomerId) {
      return c.json({ success: false, error: 'displayName と shopifyCustomerId は必須です' }, 400);
    }

    // 名前で友だちを検索
    const friend = await c.env.DB
      .prepare('SELECT id, display_name FROM friends WHERE display_name LIKE ? LIMIT 1')
      .bind(`%${body.displayName}%`)
      .first<{ id: string; display_name: string }>();

    if (!friend) {
      return c.json({ success: false, error: `名前 "${body.displayName}" に一致する友だちが見つかりません` }, 404);
    }

    // 既存の紐付けをチェック
    const existing = await getLoyaltyPointByShopifyCustomerId(c.env.DB, body.shopifyCustomerId);
    if (existing && existing.friend_id !== friend.id) {
      return c.json({
        success: false,
        error: `このShopify顧客IDは既に別の友だち(ID: ${existing.friend_id})に紐付いています`,
      }, 409);
    }

    // 紐付け実行
    const current = await getLoyaltyPoint(c.env.DB, friend.id);
    await upsertLoyaltyPoint(c.env.DB, friend.id, {
      balance: current?.balance ?? 0,
      limitedBalance: current?.limited_balance ?? 0,
      totalSpent: current?.total_spent ?? 0,
      rank: current?.rank ?? 'レギュラー',
      shopifyCustomerId: body.shopifyCustomerId,
    });

    return c.json({
      success: true,
      data: {
        friendId: friend.id,
        displayName: friend.display_name,
        shopifyCustomerId: body.shopifyCustomerId,
      },
    });
  } catch (e) {
    return c.json({ success: false, error: 'Failed to link by name' }, 500);
  }
});

// ────────────────────────────────────────────────────────────────────
// POST /api/loyalty/admin/test-link-coupon — 送料無料クーポン通知の動作テスト
//
// link_reward_type を全体ONにする前に、本番の連携クーポン発行＋LINE通知が
// 正しく動くかを「指定した相手1人だけ」で試す。
//   body: { shopifyCustomerId: string, lineUserId?: string, expiryDays?: number }
//   - shopifyCustomerId: クーポンを発行する対象（本人限定クーポンになる）
//   - lineUserId: 指定すると、その人のLINEへ本番と同じ文面で通知を送る（省略時は発行のみ）
//   ※ loyalty_transactions には記録しない（テストなので「受領済み」扱いにしない）。
//   ※ 認証必須（authMiddleware: Bearer API_KEY）。
// ────────────────────────────────────────────────────────────────────
loyalty.post('/api/loyalty/admin/test-link-coupon', async (c) => {
  try {
    const body = await c.req.json<{ shopifyCustomerId?: string; lineUserId?: string; expiryDays?: number }>().catch(() => ({}));
    const shopifyCustomerId = (body.shopifyCustomerId ?? '').trim();
    if (!shopifyCustomerId) {
      return c.json({ success: false, error: 'shopifyCustomerId は必須です' }, 400);
    }
    const expiryDays = body.expiryDays && body.expiryDays > 0 ? body.expiryDays : 30;

    // 1) 本番と同じ発行ロジックでクーポンを作る
    const { issueFreeShippingCoupon } = await import('../services/link-reward-coupon.js');
    const issued = await issueFreeShippingCoupon(c.env, shopifyCustomerId, expiryDays);
    if (!issued.ok) {
      return c.json({ success: false, error: `クーポン発行失敗: ${issued.error}` }, 500);
    }

    // 2) lineUserId 指定時は、本番と同じ文面でLINE通知を送る
    // LINE通知の宛先を決める:
    //  - lineUserId 明示指定があればそれを使う
    //  - 無ければ shopifyCustomerId から「ハーネスの正しい line_user_id」を逆引き
    //    （CRM Plus時代のsocialplus.line値とは別。誤送信防止のため必ずハーネス側を使う）
    let targetLineUserId: string | null = body.lineUserId ?? null;
    let resolvedFrom = body.lineUserId ? 'param' : null;
    if (!targetLineUserId) {
      const row = await c.env.DB
        .prepare('SELECT f.line_user_id AS uid FROM loyalty_points lp JOIN friends f ON f.id = lp.friend_id WHERE lp.shopify_customer_id = ? AND f.line_user_id IS NOT NULL LIMIT 1')
        .bind(shopifyCustomerId)
        .first<{ uid: string }>();
      if (row?.uid) { targetLineUserId = row.uid; resolvedFrom = 'shopify_customer_id'; }
    }

    let pushed = false;
    let pushError: string | null = null;
    if (targetLineUserId) {
      try {
        const { LineClient } = await import('@line-crm/line-sdk');
        const accountRow = await c.env.DB
          .prepare('SELECT channel_access_token FROM line_accounts WHERE is_active = 1 LIMIT 1')
          .first<{ channel_access_token: string }>();
        const accessToken = accountRow?.channel_access_token ?? c.env.LINE_CHANNEL_ACCESS_TOKEN;
        const expDisp = new Date(issued.endsAt).toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo', year: 'numeric', month: 'long', day: 'numeric' });
        const lines = [
          '【テスト送信】',
          '🎁 LINE連携ありがとうございます！',
          '',
          `送料無料クーポン：${issued.code}`,
          `有効期限：${expDisp}`,
          '',
          'お会計画面のクーポンコード欄に入力すると送料が無料になります（1回限り）。',
        ];
        await new LineClient(accessToken).pushMessage(targetLineUserId, [{ type: 'text', text: lines.join('\n') }]);
        pushed = true;
      } catch (e) {
        pushError = e instanceof Error ? e.message : String(e);
      }
    }

    return c.json({
      success: true,
      data: {
        code: issued.code,
        endsAt: issued.endsAt,
        pushed,
        pushError,
        lineUserResolvedFrom: resolvedFrom,  // 'param' | 'shopify_customer_id' | null
        lineUserFound: !!targetLineUserId,   // false の場合この顧客はハーネス未連携（通知できない）
        note: targetLineUserId
          ? 'これはテスト発行です。loyalty_transactionsには記録していません。本番と同じクーポン＋通知です。'
          : 'クーポンは発行しましたが、この顧客のハーネスLINE連携が見つからずLINE通知は送れませんでした（lineUserId を明示指定すれば送れます）。',
      },
    });
  } catch (e) {
    console.error('POST /api/loyalty/admin/test-link-coupon error:', e);
    return c.json({ success: false, error: e instanceof Error ? e.message : 'test-link-coupon failed' }, 500);
  }
});

export { loyalty };