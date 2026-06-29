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
  recordAffiliateProgramOrder,
} from '@line-crm/db';
import { saveOrderMetafields, saveCustomerMetafields } from '../services/shopify.js';
import { persistShopifyOrder, type ShopifyOrderPayload } from '../services/shopify-orders.js';
import { refundUnusedPointCode, findPendingCodeByFriendId } from '../services/loyalty-code-refund.js';
import { getShopifyAdminToken } from '../utils/shopify-token.js';
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

function findAttributeValue(
  attrs: Array<{ name?: string; key?: string; value?: string | number | null }> | undefined,
  keys: string[],
): string | null {
  if (!attrs) return null;
  const lowerKeys = new Set(keys.map((k) => k.toLowerCase()));
  for (const attr of attrs) {
    const name = (attr.name ?? attr.key ?? '').trim().toLowerCase();
    if (!lowerKeys.has(name)) continue;
    const value = attr.value == null ? '' : String(attr.value).trim();
    if (value) return value;
  }
  return null;
}

function extractAffiliateCodeFromOrder(order: {
  note_attributes?: Array<{ name?: string; key?: string; value?: string | number | null }>;
  line_items?: Array<{ properties?: Array<{ name?: string; key?: string; value?: string | number | null }> }>;
}): { code: string | null; source: 'cart_attribute' | 'note_attribute' } {
  const keys = ['affiliate_code', 'aff', '_affiliate_code', '_aff'];
  const noteValue = findAttributeValue(order.note_attributes, keys);
  if (noteValue) return { code: noteValue, source: 'cart_attribute' };
  for (const item of order.line_items ?? []) {
    const propValue = findAttributeValue(item.properties, keys);
    if (propValue) return { code: propValue, source: 'note_attribute' };
  }
  return { code: null, source: 'cart_attribute' };
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
    email?: string | null;
    total_price?: string;
    subtotal_price?: string;
    currency?: string;
    customer?: { id?: number | string; tags?: string; email?: string | null };
    line_items?: Array<{ product_id?: number; product_type?: string; vendor?: string; properties?: Array<{ name: string; value: string }> }>;
    note_attributes?: Array<{ name: string; value: string }>;
    financial_status?: string;
    cancelled_at?: string | null;
    created_at?: string;
    processed_at?: string;
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

  const orderId = String(order.id);
  const affiliateAttribution = extractAffiliateCodeFromOrder(order);
  if (affiliateAttribution.code) {
    c.executionCtx?.waitUntil(
      recordAffiliateProgramOrder(c.env.DB, {
        affiliateCode: affiliateAttribution.code,
        shopifyOrderId: orderId,
        shopifyOrderNumber: order.name ?? null,
        shopifyCustomerId: order.customer?.id != null ? String(order.customer.id) : null,
        customerEmail: order.email ?? order.customer?.email ?? null,
        subtotalPrice: order.subtotal_price ? parseFloat(order.subtotal_price) : null,
        totalPrice: order.total_price ? parseFloat(order.total_price) : null,
        currency: order.currency ?? 'JPY',
        financialStatus: order.financial_status ?? null,
        cancelledAt: order.cancelled_at ?? null,
        orderedAt: order.processed_at ?? order.created_at ?? null,
        attributionSource: affiliateAttribution.source,
        rawAffiliateValue: affiliateAttribution.code,
      })
        .then((r) => {
          if (r.recorded) console.log(`[affiliate-program] recorded order=${orderId} code=${affiliateAttribution.code}`);
          else if (r.reason && r.reason !== 'partner_not_found') console.log(`[affiliate-program] skipped order=${orderId} reason=${r.reason}`);
        })
        .catch((err) => console.error('[affiliate-program] record failed:', err)),
    );
  }

  if (order.cancelled_at) {
    return c.json({ success: true, data: { skipped: true, reason: 'cancelled' } });
  }
  if (!order.customer?.id) {
    return c.json({ success: true, data: { skipped: true, reason: 'no_customer' } });
  }

  const shopifyCustomerId = String(order.customer.id);
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
    balanceAfter: newBalance + (existing.limited_balance ?? 0),
    reason: `購入ポイント付与（¥${orderAmount.toLocaleString('ja-JP')}）`,
    orderId,
    expiryDays,
  });

  // ── バグB 安全網(B1): 注文確定時、未使用のポイント割引コードが残っていたら自動返還 ──
  // この注文でコードを「使った」場合は Shopify の usage_count が増えているため、
  // refundUnusedPointCode 内で used 判定され返金されない（＝正常利用は守られる）。
  // 別クーポンで購入した等でコードが未使用のままなら、ここで返してポイントが宙に浮くのを防ぐ。
  c.executionCtx?.waitUntil(
    (async () => {
      try {
        const pendingCode = await findPendingCodeByFriendId(c.env.DB, existing.friend_id);
        if (!pendingCode) return;
        const r = await refundUnusedPointCode(c.env, shopifyCustomerId, pendingCode, 'order_paid');
        if (r.refunded) {
          console.log(`[orders-paid] 未使用コード自動返還: ${pendingCode} +${r.refundPoints}pt (cust=${shopifyCustomerId})`);
        }
      } catch (err) {
        console.error('[orders-paid] 未使用コード自動返還に失敗:', err);
      }
    })(),
  );

  const shopDomain = c.env.SHOPIFY_SHOP_DOMAIN;
  const adminToken = await getShopifyAdminToken(c.env);
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
    balanceAfter: newBalance + (current.limited_balance ?? 0),
    reason: `注文キャンセルによるポイント返還（注文#${orderId}）`,
    orderId,
  });

  return c.json({ success: true, data: { refundedPoints: awardTx.points, balance: newBalance } });
});

// POST /api/shopify/webhooks/orders-fulfilled — Shopify 注文発送(履行)Webhook
//   発送されたら、LINE連携済みの顧客へ追跡リンク付きで「発送しました🚚」を送る。
//   送信処理は waitUntil で非同期実行（Shopifyへは即200を返す）。機能フラグで既定OFF。
shopifyWebhooks.post('/api/shopify/webhooks/orders-fulfilled', async (c) => {
  const rawBody = await c.req.text();
  const secret = (c.env as unknown as Record<string, string | undefined>).SHOPIFY_WEBHOOK_SECRET;
  if (!secret) return c.json({ success: false, error: 'Webhook secret not configured' }, 500);
  if (!verifyTokenParam(c.req.url, secret)) return c.json({ success: false, error: 'Invalid token' }, 401);

  let order: import('../services/shipping-line-notify.js').ShipOrderLite;
  try {
    order = JSON.parse(rawBody);
  } catch {
    return c.json({ success: false, error: 'Invalid JSON' }, 400);
  }

  // 発送LINE通知（非同期・失敗してもwebhook応答に影響させない）
  c.executionCtx?.waitUntil(
    import('../services/shipping-line-notify.js')
      .then(({ notifyOrderShipped }) => notifyOrderShipped(c.env, order))
      .then((r) => {
        if (r.sent) console.log(`[ship-notify] sent order=${order.id} friend=${r.friendId}`);
        else if (r.reason === 'push_error') console.error(`[ship-notify] push_error order=${order.id}: ${r.error}`);
      })
      .catch((err) => console.error('[ship-notify] error:', err)),
  );

  return c.json({ success: true });
});

export { shopifyWebhooks };
