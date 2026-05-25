import { Hono } from 'hono';
import {
  getLoyaltyPointByShopifyCustomerId,
  getLoyaltyPoint,
  getLoyaltySetting,
  getActiveCampaigns,
  applyCampaigns,
  upsertLoyaltyPoint,
  addLoyaltyTransaction,
  determineRank,
  calculatePoints,
} from '@line-crm/db';
import { saveOrderMetafields, saveCustomerMetafields } from '../services/shopify.js';
import { persistShopifyOrder, type ShopifyOrderPayload } from '../services/shopify-orders.js';
import type { Env } from '../index.js';

const shopifyWebhooks = new Hono<Env>();

function verifyTokenParam(url: string, expected: string): boolean {
  try {
    const u = new URL(url);
    const token = u.searchParams.get('token') ?? '';
    if (token.length !== expected.length) return false;
    let diff = 0;
    for (let i = 0; i < token.length; i++) diff |= token.charCodeAt(i) ^ expected.charCodeAt(i);
    return diff === 0;
  } catch {
    return false;
  }
}

// POST /api/shopify/webhooks/orders-paid — Shopify 注文支払完了 Webhook
shopifyWebhooks.post('/api/shopify/webhooks/orders-paid', async (c) => {
  const rawBody = await c.req.text();
  const secret = (c.env as unknown as Record<string, string | undefined>).SHOPIFY_WEBHOOK_SECRET;
  if (!secret) {
    return c.json({ success: false, error: 'Webhook secret not configured' }, 500);
  }
  if (!verifyTokenParam(c.req.url, secret)) {
    return c.json({ success: false, error: 'Invalid token' }, 401);
  }

  let order: {
    id: number | string;
    name?: string;
    total_price?: string;
    currency?: string;
    customer?: { id?: number | string; tags?: string };
    line_items?: Array<{ product_id?: number; product_type?: string; vendor?: string; properties?: Array<{ name: string; value: string }> }>;
    financial_status?: string;
    cancelled_at?: string | null;
  };
  try {
    order = JSON.parse(rawBody);
  } catch {
    return c.json({ success: false, error: 'Invalid JSON' }, 400);
  }

  // BI 永続化: shopify_orders / shopify_order_items に UPSERT（独立処理、失敗握りつぶし）
  c.executionCtx?.waitUntil(
    persistShopifyOrder(c.env.DB, order as ShopifyOrderPayload, 'webhook').catch((err) => {
      console.error('[shopify-webhooks] persistShopifyOrder failed:', err);
    }),
  );

  if (order.cancelled_at) {
    return c.json({ success: true, data: { skipped: true, reason: 'cancelled' } });
  }
  if (!order.customer?.id) {
    return c.json({ success: true, data: { skipped: true, reason: 'no_customer' } });
  }

  const shopifyCustomerId = String(order.customer.id);
  const orderId = String(order.id);
  const orderAmount = Math.floor(parseFloat(order.total_price ?? '0'));
  if (orderAmount <= 0) {
    return c.json({ success: true, data: { skipped: true, reason: 'zero_amount' } });
  }

  // 友だち紐付け確認
  const existing = await getLoyaltyPointByShopifyCustomerId(c.env.DB, shopifyCustomerId);
  if (!existing) {
    // LINE 未連携顧客 — 保留テーブルに記録（後で紐付け時にバックフィル可能）
    try {
      await c.env.DB
        .prepare(
          `INSERT OR IGNORE INTO loyalty_pending_orders
           (order_id, shopify_customer_id, order_amount, currency, order_payload, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .bind(orderId, shopifyCustomerId, orderAmount, order.currency ?? 'JPY', rawBody, new Date().toISOString())
        .run();
    } catch {
      // テーブル未作成でも Webhook 自体は 200 で返し Shopify に成功を返す
    }
    return c.json({ success: true, data: { pending: true, reason: 'line_not_linked' } });
  }

  // 既に付与済みかチェック（冪等性）
  const dup = await c.env.DB
    .prepare(`SELECT 1 FROM loyalty_transactions WHERE order_id = ? AND type = 'award' LIMIT 1`)
    .bind(orderId)
    .first();
  if (dup) {
    return c.json({ success: true, data: { skipped: true, reason: 'already_awarded' } });
  }

  const [pointRateSetting, expiryDaysSetting, yenOnlySetting, orderMfSetting, customerMfSetting] = await Promise.all([
    getLoyaltySetting(c.env.DB, 'point_rate').catch(() => null),
    getLoyaltySetting(c.env.DB, 'expiry_days').catch(() => null),
    getLoyaltySetting(c.env.DB, 'yen_only').catch(() => null),
    getLoyaltySetting(c.env.DB, 'order_metafield_enabled').catch(() => null),
    getLoyaltySetting(c.env.DB, 'customer_metafield_enabled').catch(() => null),
  ]);

  if ((yenOnlySetting ?? '1') === '1' && order.currency && order.currency !== 'JPY') {
    return c.json({ success: true, data: { skipped: true, reason: 'non_jpy' } });
  }

  const current = await getLoyaltyPoint(c.env.DB, existing.friend_id);
  const currentBalance = current?.balance ?? 0;
  const currentTotalSpent = current?.total_spent ?? 0;
  const currentRank = determineRank(currentTotalSpent);
  const pointRate = parseFloat(pointRateSetting ?? '0.01') || 0.01;
  const expiryDays = parseInt(expiryDaysSetting ?? '365', 10) || 365;
  const basePoints = calculatePoints(orderAmount, currentRank, pointRate);

  const customerTags = order.customer?.tags ? order.customer.tags.split(',').map((t) => t.trim()) : [];
  const productIds = (order.line_items ?? []).map((li) => String(li.product_id ?? '')).filter(Boolean);
  const productTypes = (order.line_items ?? []).map((li) => li.product_type ?? '').filter(Boolean);

  const activeCampaigns = await getActiveCampaigns(c.env.DB).catch(() => []);
  const { finalPoints: earnedPoints, appliedCampaigns } = applyCampaigns(
    basePoints,
    orderAmount,
    { customerTags, productTags: [], productIds, productTypes, collectionIds: [], totalSpent: currentTotalSpent },
    activeCampaigns,
  );

  const newTotalSpent = currentTotalSpent + orderAmount;
  const newBalance = currentBalance + earnedPoints;
  const newRank = determineRank(newTotalSpent);

  await upsertLoyaltyPoint(c.env.DB, existing.friend_id, {
    balance: newBalance,
    totalSpent: newTotalSpent,
    rank: newRank,
    shopifyCustomerId,
  });

  await addLoyaltyTransaction(c.env.DB, {
    friendId: existing.friend_id,
    type: 'award',
    points: earnedPoints,
    balanceAfter: newBalance,
    reason: `購入ポイント付与（¥${orderAmount.toLocaleString('ja-JP')}）`,
    orderId,
    expiryDays,
  });

  const shopDomain = c.env.SHOPIFY_SHOP_DOMAIN;
  const adminToken = c.env.SHOPIFY_ADMIN_TOKEN;
  if (shopDomain && adminToken) {
    const jobs: Promise<void>[] = [];
    if ((orderMfSetting ?? '1') === '1') {
      jobs.push(saveOrderMetafields(shopDomain, adminToken, orderId, { awarded_points: earnedPoints }).catch(() => {}));
    }
    if ((customerMfSetting ?? '0') === '1') {
      jobs.push(saveCustomerMetafields(shopDomain, adminToken, shopifyCustomerId, newBalance).catch(() => {}));
    }
    if (jobs.length > 0) c.executionCtx?.waitUntil(Promise.all(jobs));
  }

  return c.json({
    success: true,
    data: { earnedPoints, balance: newBalance, rank: newRank, appliedCampaigns },
  });
});

// POST /api/shopify/webhooks/orders-cancelled — 注文キャンセル Webhook
shopifyWebhooks.post('/api/shopify/webhooks/orders-cancelled', async (c) => {
  const rawBody = await c.req.text();
  const secret = (c.env as unknown as Record<string, string | undefined>).SHOPIFY_WEBHOOK_SECRET;
  if (!secret) return c.json({ success: false, error: 'Webhook secret not configured' }, 500);
  if (!verifyTokenParam(c.req.url, secret)) return c.json({ success: false, error: 'Invalid token' }, 401);

  let order: { id: number | string };
  try {
    order = JSON.parse(rawBody);
  } catch {
    return c.json({ success: false, error: 'Invalid JSON' }, 400);
  }
  const orderId = String(order.id);

  const awardTx = await c.env.DB
    .prepare(`SELECT id, friend_id, points FROM loyalty_transactions WHERE order_id = ? AND type = 'award' ORDER BY created_at DESC LIMIT 1`)
    .bind(orderId)
    .first<{ id: string; friend_id: string; points: number }>();
  if (!awardTx) return c.json({ success: true, data: { skipped: true, reason: 'no_award_tx' } });

  const already = await c.env.DB
    .prepare(`SELECT 1 FROM loyalty_transactions WHERE order_id = ? AND type = 'adjust' AND reason LIKE '%キャンセル%' LIMIT 1`)
    .bind(orderId)
    .first();
  if (already) return c.json({ success: true, data: { skipped: true, reason: 'already_refunded' } });

  const current = await getLoyaltyPoint(c.env.DB, awardTx.friend_id);
  if (!current) return c.json({ success: true, data: { skipped: true, reason: 'no_loyalty_point' } });

  const newBalance = current.balance - awardTx.points;
  const newTotalSpent = current.total_spent; // 総購入額はそのまま（保守的）
  const newRank = determineRank(newTotalSpent);

  await upsertLoyaltyPoint(c.env.DB, awardTx.friend_id, {
    balance: newBalance,
    totalSpent: newTotalSpent,
    rank: newRank,
    shopifyCustomerId: current.shopify_customer_id ?? undefined,
  });

  await addLoyaltyTransaction(c.env.DB, {
    friendId: awardTx.friend_id,
    type: 'adjust',
    points: -awardTx.points,
    balanceAfter: newBalance,
    reason: `注文キャンセルによるポイント返還（注文#${orderId}）`,
    orderId,
  });

  return c.json({ success: true, data: { refundedPoints: awardTx.points, balance: newBalance } });
});

export { shopifyWebhooks };
