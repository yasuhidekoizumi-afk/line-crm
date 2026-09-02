import { getLoyaltyPoint, getLoyaltySetting, mutateLoyaltyPoint } from '@line-crm/db';
import { getShopifyAdminToken } from '../utils/shopify-token.js';

export interface DirectPointRedemptionEnv {
  DB: D1Database;
  SHOPIFY_SHOP_DOMAIN?: string;
  SHOPIFY_CLIENT_ID?: string;
  SHOPIFY_CLIENT_SECRET?: string;
  SHOPIFY_ADMIN_TOKEN?: string;
}

type Reservation = {
  id: string;
  friend_id: string;
  shopify_customer_id: string;
  shopify_discount_code: string;
  points: number;
  discount_amount: number;
  status: 'active' | 'consuming' | 'consumed' | 'cancelled' | 'failed';
};

const now = () => new Date().toISOString();
const SHOPIFY_API_VERSION = '2026-07';

type DiscountCreateResponse = {
  data?: { discountCodeBasicCreate?: { codeDiscountNode?: { id?: string } | null; userErrors?: Array<{ field?: string[]; message?: string; code?: string }> } | null };
  errors?: Array<{ message?: string; extensions?: { code?: string } }>;
};

function isShopifyAccessError(status: number, payload: DiscountCreateResponse): boolean {
  if (status === 401 || status === 403) return true;
  return JSON.stringify(payload).toLowerCase().includes('access denied');
}

async function deleteShopifyCode(env: DirectPointRedemptionEnv, code: string): Promise<boolean> {
  const shopDomain = env.SHOPIFY_SHOP_DOMAIN;
  const adminToken = await getShopifyAdminToken(env);
  if (!shopDomain || !adminToken) return false;
  const lookup = await fetch(`https://${shopDomain}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': adminToken },
    body: JSON.stringify({
      query: 'query($code:String!){ codeDiscountNodeByCode(code:$code){ id } }',
      variables: { code },
    }),
  });
  if (!lookup.ok) return false;
  const lookupJson = await lookup.json() as { data?: { codeDiscountNodeByCode?: { id?: string } | null }; errors?: unknown };
  const id = lookupJson.data?.codeDiscountNodeByCode?.id;
  if (lookupJson.errors || !id) return !lookupJson.errors;
  const deleted = await fetch(`https://${shopDomain}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': adminToken },
    body: JSON.stringify({
      query: 'mutation($id:ID!){ discountCodeDelete(id:$id){ userErrors{ message } } }',
      variables: { id },
    }),
  });
  if (!deleted.ok) return false;
  const deletedJson = await deleted.json() as { data?: { discountCodeDelete?: { userErrors?: unknown[] } }; errors?: unknown };
  return !deletedJson.errors && (deletedJson.data?.discountCodeDelete?.userErrors?.length ?? 0) === 0;
}

export async function getActiveDirectPointReservation(
  db: D1Database,
  friendId: string,
): Promise<Reservation | null> {
  return db.prepare(
    `SELECT id, friend_id, shopify_customer_id, shopify_discount_code, points, discount_amount, status
     FROM loyalty_redemption_reservations
     WHERE friend_id = ? AND status IN ('active', 'consuming')
     ORDER BY created_at DESC LIMIT 1`,
  ).bind(friendId).first<Reservation>();
}

export async function createDirectPointReservation(
  env: DirectPointRedemptionEnv,
  input: { friendId: string; shopifyCustomerId: string; points: number },
): Promise<{ ok: true; code: string; points: number; discountAmount: number } | { ok: false; error: string }> {
  if (!Number.isInteger(input.points) || input.points < 100 || input.points % 100 !== 0) {
    return { ok: false, error: 'ポイントは100pt単位で指定してください' };
  }
  const point = await getLoyaltyPoint(env.DB, input.friendId);
  const total = (point?.balance ?? 0) + (point?.limited_balance ?? 0);
  if (total < input.points) return { ok: false, error: 'ポイント残高が不足しています' };

  const existing = await getActiveDirectPointReservation(env.DB, input.friendId);
  if (existing) return { ok: false, error: 'すでにポイント利用を選択しています。取り消してから変更してください' };

  const shopDomain = env.SHOPIFY_SHOP_DOMAIN;
  const adminToken = await getShopifyAdminToken(env);
  if (!shopDomain || !adminToken) return { ok: false, error: 'Shopify設定を確認できませんでした' };

  const pointValue = parseFloat((await getLoyaltySetting(env.DB, 'point_value').catch(() => '1')) ?? '1') || 1;
  const discountAmount = Math.floor(input.points * pointValue);
  const code = `ORYZAE-DR-${input.shopifyCustomerId.slice(-6)}-${Date.now().toString(36).toUpperCase()}`;
  const requestBody = JSON.stringify({
      query: `mutation CreatePointDiscount($basicCodeDiscount: DiscountCodeBasicInput!) {
        discountCodeBasicCreate(basicCodeDiscount: $basicCodeDiscount) {
          codeDiscountNode { id }
          userErrors { field message code }
        }
      }`,
      variables: {
        basicCodeDiscount: {
          title: `ポイント利用予約 ${code}`,
          code,
          startsAt: now(),
          customerSelection: {
            customers: { add: [`gid://shopify/Customer/${input.shopifyCustomerId}`] },
          },
          customerGets: {
            value: { discountAmount: { amount: String(discountAmount), appliesOnEachItem: false } },
            items: { all: true },
          },
          combinesWith: {
            productDiscounts: true,
            orderDiscounts: true,
            shippingDiscounts: true,
          },
          appliesOncePerCustomer: true,
          usageLimit: 1,
        },
      },
    });
  const createDiscount = async (token: string) => {
    const response = await fetch(`https://${shopDomain}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
      body: requestBody,
    });
    const payload = await response.json().catch(() => ({})) as DiscountCreateResponse;
    return { response, payload };
  };

  let attempt = await createDiscount(adminToken);
  // 短命トークンのアプリに write_discounts がない場合のみ、既存の管理トークンへ退避する。
  // 通信失敗や5xxでは重複作成を避けるため再試行しない。
  if (isShopifyAccessError(attempt.response.status, attempt.payload)
      && env.SHOPIFY_ADMIN_TOKEN
      && env.SHOPIFY_ADMIN_TOKEN !== adminToken) {
    attempt = await createDiscount(env.SHOPIFY_ADMIN_TOKEN);
  }
  const discountJson = attempt.payload;
  const discountResult = discountJson.data?.discountCodeBasicCreate;
  if (!attempt.response.ok || discountJson.errors || !discountResult?.codeDiscountNode?.id || (discountResult.userErrors?.length ?? 0) > 0) {
    console.error('[direct-point-redemption] Shopify discount creation failed', {
      status: attempt.response.status,
      graphqlErrors: discountJson.errors,
      userErrors: discountResult?.userErrors,
    });
    return { ok: false, error: 'ポイント割引の準備に失敗しました' };
  }

  const timestamp = now();
  try {
    await env.DB.prepare(
      `INSERT INTO loyalty_redemption_reservations
       (id, friend_id, shopify_customer_id, shopify_discount_code, points, discount_amount, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
    ).bind(crypto.randomUUID(), input.friendId, input.shopifyCustomerId, code, input.points, discountAmount, timestamp, timestamp).run();
  } catch (_) {
    await deleteShopifyCode(env, code);
    return { ok: false, error: 'すでにポイント利用を選択しています。画面を更新して確認してください' };
  }
  return { ok: true, code, points: input.points, discountAmount };
}

export async function cancelDirectPointReservation(
  env: DirectPointRedemptionEnv,
  input: { friendId: string; shopifyCustomerId: string },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const reservation = await getActiveDirectPointReservation(env.DB, input.friendId);
  if (!reservation || reservation.shopify_customer_id !== input.shopifyCustomerId) return { ok: false, error: '取り消すポイント利用が見つかりません' };
  if (!await deleteShopifyCode(env, reservation.shopify_discount_code)) return { ok: false, error: '取り消しに失敗しました。時間をおいてお試しください' };
  await env.DB.prepare(
    `UPDATE loyalty_redemption_reservations SET status = 'cancelled', updated_at = ? WHERE id = ? AND status = 'active'`,
  ).bind(now(), reservation.id).run();
  return { ok: true };
}

/** 注文Webhookからのみ呼ぶ。予約時には残高を一切減らさない。 */
export async function consumeDirectPointReservationForOrder(
  env: DirectPointRedemptionEnv,
  input: { friendId: string; shopifyCustomerId: string | null; orderId: string; code: string },
): Promise<{ consumed: boolean; error?: string }> {
  const reservation = await env.DB.prepare(
    `SELECT id, friend_id, shopify_customer_id, shopify_discount_code, points, discount_amount, status
     FROM loyalty_redemption_reservations
     WHERE shopify_discount_code = ? AND friend_id = ? AND status = 'active' LIMIT 1`,
  ).bind(input.code, input.friendId).first<Reservation>();
  if (!reservation) return { consumed: false };
  if (input.shopifyCustomerId && reservation.shopify_customer_id !== input.shopifyCustomerId) {
    return { consumed: false, error: 'customer_mismatch' };
  }
  const locked = await env.DB.prepare(
    `UPDATE loyalty_redemption_reservations SET status = 'consuming', updated_at = ? WHERE id = ? AND status = 'active'`,
  ).bind(now(), reservation.id).run();
  if ((locked.meta?.changes ?? 0) !== 1) return { consumed: false };

  const point = await getLoyaltyPoint(env.DB, input.friendId);
  const limited = point?.limited_balance ?? 0;
  const regular = point?.balance ?? 0;
  if (limited + regular < reservation.points) {
    await env.DB.prepare(`UPDATE loyalty_redemption_reservations SET status = 'failed', updated_at = ? WHERE id = ?`)
      .bind(now(), reservation.id).run();
    return { consumed: false, error: 'insufficient_balance' };
  }
  const limitedToUse = Math.min(limited, reservation.points);
  const regularToUse = reservation.points - limitedToUse;
  await mutateLoyaltyPoint(env.DB, {
    friendId: input.friendId,
    deltaBalance: -regularToUse,
    deltaLimited: -limitedToUse,
    txType: 'redeem',
    orderId: input.orderId,
    reason: `ポイント利用（¥${reservation.discount_amount}割引 / 注文確定）`,
  });
  await env.DB.prepare(
    `UPDATE loyalty_redemption_reservations
     SET status = 'consumed', order_id = ?, consumed_at = ?, updated_at = ? WHERE id = ?`,
  ).bind(input.orderId, now(), now(), reservation.id).run();
  return { consumed: true };
}
