/**
 * LINE連携特典: 送料無料クーポン発行（2026-06-19 切替予定の新特典）
 *
 * 背景:
 *   連携特典を「300pt付与」から「送料無料クーポン」へ切り替える（6/22新LP対応）。
 *   切替は loyalty_settings の link_reward_type = 'free_shipping' で行い、
 *   未設定/'points' の間は従来どおり300pt付与（このファイルは呼ばれない）。
 *
 * 仕様（2026-06-11 河原さん承認の推奨案）:
 *   - 送料100%OFF（target_type: shipping_line / value: -100%）
 *   - 本人限定（prerequisite_customer_ids）・1人1回・全体でも1回使い切り
 *   - 有効期限: 発行から link_coupon_expiry_days 日（既定30日）
 *   - 最低購入金額なし
 *
 * 実装はポイント→クーポン変換（loyalty.ts redeem）と同じ
 * Price Rule + Discount Code の REST パターンを踏襲。
 */
import { getShopifyAdminToken } from '../utils/shopify-token.js';

interface EnvLike {
  SHOPIFY_SHOP_DOMAIN?: string;
  SHOPIFY_ADMIN_TOKEN?: string;
  SHOPIFY_CLIENT_ID?: string;
  SHOPIFY_CLIENT_SECRET?: string;
}

export type IssueCouponResult =
  | { ok: true; code: string; endsAt: string }
  | { ok: false; error: string };

export async function issueFreeShippingCoupon(
  env: EnvLike,
  shopifyCustomerId: string,
  expiryDays = 30,
): Promise<IssueCouponResult> {
  const shopDomain = env.SHOPIFY_SHOP_DOMAIN;
  const adminToken = await getShopifyAdminToken(env);
  if (!shopDomain || !adminToken) {
    return { ok: false, error: 'Shopify 設定が未構成です' };
  }

  const code = `LINESHIP-${shopifyCustomerId.slice(-6)}-${Date.now().toString(36).toUpperCase()}`;
  const startsAt = new Date();
  const endsAt = new Date(startsAt.getTime() + expiryDays * 24 * 60 * 60 * 1000);

  // 1) Price Rule 作成（送料100%OFF・本人限定・1回限り）
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
          title: `LINE連携特典 送料無料 ${code}`,
          target_type: 'shipping_line',
          target_selection: 'all',
          allocation_method: 'each',
          value_type: 'percentage',
          value: '-100.0',
          customer_selection: 'prerequisite',
          prerequisite_customer_ids: [shopifyCustomerId],
          once_per_customer: true,
          usage_limit: 1,
          starts_at: startsAt.toISOString(),
          ends_at: endsAt.toISOString(),
        },
      }),
    },
  );
  if (!priceRuleRes.ok) {
    const err = await priceRuleRes.text().catch(() => '');
    return { ok: false, error: `Price Rule 作成失敗: ${priceRuleRes.status} ${err.slice(0, 200)}` };
  }
  const priceRuleData = (await priceRuleRes.json()) as { price_rule: { id: number } };

  // 2) Discount Code 作成
  const discountRes = await fetch(
    `https://${shopDomain}/admin/api/2024-10/price_rules/${priceRuleData.price_rule.id}/discount_codes.json`,
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
    const err = await discountRes.text().catch(() => '');
    return { ok: false, error: `Discount Code 作成失敗: ${discountRes.status} ${err.slice(0, 200)}` };
  }

  return { ok: true, code, endsAt: endsAt.toISOString() };
}
