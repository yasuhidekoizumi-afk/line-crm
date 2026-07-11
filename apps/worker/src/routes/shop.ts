/**
 * LIFF Shop API — LINE内ポイント利用〜ShopifyカートURL発行
 *
 * エンドポイント:
 *   POST /api/shop/balance  — LINE userId からポイント残高を返す
 *   POST /api/shop/checkout — 割引コード発行 + カートURL生成
 */

import { Hono } from 'hono';
import {
  getFriendByLineUserId,
  getLoyaltyPoint,
  upsertLoyaltyPoint,
  addLoyaltyTransaction,
  determineRank,
  getLoyaltySetting,
} from '@line-crm/db';
import { getShopifyAdminToken } from '../utils/shopify-token.js';
import type { Env } from '../index.js';

const shop = new Hono<Env>();

// 設定可能な商品一覧（variantId は Shopify管理画面 > 商品 > バリエーション から取得）
const FEATURED_VARIANTS = new Set([
  '45285682806943', // PLAIN プレーン 200g
  '62613611020447', // BANANA COCONUTS 200g
  '45285711675551', // DRIED FRUIT 200g
  '40611894853791', // 人気3種セット
]);

// ── POST /api/shop/balance ────────────────────────

shop.post('/api/shop/balance', async (c) => {
  try {
    const body = await c.req.json<{ lineUserId: string }>();
    if (!body.lineUserId) {
      return c.json({ success: false, error: 'lineUserId は必須です' }, 400);
    }

    const friend = await getFriendByLineUserId(c.env.DB, body.lineUserId);
    if (!friend) {
      return c.json({ success: false, error: 'LINE連携が見つかりません。先に友だち追加してください。' }, 404);
    }

    const point = await getLoyaltyPoint(c.env.DB, friend.id);
    if (!point) {
      return c.json({
        success: true,
        data: {
          balance: 0,
          limitedBalance: 0,
          limitedExpiresAt: null,
          totalSpent: 0,
        },
      });
    }

    return c.json({
      success: true,
      data: {
        balance: point.balance,
        limitedBalance: point.limited_balance ?? 0,
        limitedExpiresAt: point.limited_expires_at ?? null,
        totalSpent: point.total_spent,
      },
    });
  } catch (e) {
    console.error('shop balance error:', e);
    return c.json({ success: false, error: '残高の取得に失敗しました' }, 500);
  }
});

// ── POST /api/shop/checkout ───────────────────────

shop.post('/api/shop/checkout', async (c) => {
  try {
    const body = await c.req.json<{
      lineUserId: string;
      variantId: string;
      points: number;
    }>();

    if (!body.lineUserId || !body.variantId || !body.points) {
      return c.json({ success: false, error: 'lineUserId, variantId, points は必須です' }, 400);
    }

    // 許可されたvariantかチェック
    if (!FEATURED_VARIANTS.has(body.variantId)) {
      return c.json({ success: false, error: 'この商品は現在ご利用いただけません' }, 400);
    }

    // LINE userId → friend → ポイント残高
    const friend = await getFriendByLineUserId(c.env.DB, body.lineUserId);
    if (!friend) {
      return c.json({ success: false, error: 'LINE連携が見つかりません' }, 404);
    }

    const point = await getLoyaltyPoint(c.env.DB, friend.id);
    if (!point) {
      return c.json({ success: false, error: 'ポイント残高がありません' }, 400);
    }

    const totalBalance = point.balance + (point.limited_balance ?? 0);
    if (totalBalance < body.points) {
      return c.json({
        success: false,
        error: `ポイント残高が不足しています（現在 ${totalBalance}pt / 必要 ${body.points}pt）`,
      }, 400);
    }

    // 利用ptは100単位
    const usePoints = Math.floor(body.points / 100) * 100;
    if (usePoints <= 0) {
      return c.json({ success: false, error: 'ポイントは100pt以上でご利用ください' }, 400);
    }

    // Shopify接続情報
    const shopDomain = c.env.SHOPIFY_SHOP_DOMAIN;
    const adminToken = await getShopifyAdminToken(c.env);
    if (!shopDomain || !adminToken) {
      return c.json({ success: false, error: 'Shopify設定が未構成です' }, 500);
    }

    const shopifyCustomerId = point.shopify_customer_id;
    if (!shopifyCustomerId) {
      return c.json({ success: false, error: 'Shopifyアカウントと連携されていません。マイページからLINE連携を行ってください。' }, 400);
    }

    // 割引コード生成（ORYZAE-{下6桁}-{タイムスタンプ}）
    const pointValueSetting = await getLoyaltySetting(c.env.DB, 'point_value').catch(() => null);
    const pointValue = parseFloat(pointValueSetting ?? '1') || 1;
    const discountAmount = Math.floor(usePoints * pointValue);
    const code = `ORYZAE-${shopifyCustomerId.slice(-6)}-${Date.now().toString(36).toUpperCase()}`;

    // Shopify Price Rule 作成
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
      console.error('Shopify Price Rule creation failed:', err);
      return c.json({ success: false, error: '割引コードの発行に失敗しました' }, 500);
    }

    const priceRuleData = (await priceRuleRes.json()) as { price_rule: { id: number } };
    const priceRuleId = priceRuleData.price_rule.id;

    // Discount Code 登録
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
      console.error('Shopify Discount Code creation failed:', err);
      return c.json({ success: false, error: '割引コードの発行に失敗しました' }, 500);
    }

    // ポイント消費（期間限定 → 通常の順）
    const limitedToUse = Math.min(point.limited_balance ?? 0, usePoints);
    const balanceToUse = usePoints - limitedToUse;
    const newBalance = point.balance - balanceToUse;
    const newLimitedBalance = (point.limited_balance ?? 0) - limitedToUse;
    const newRank = determineRank(point.total_spent);

    const newLimitedExpiresAt =
      newLimitedBalance > 0 ? point.limited_expires_at : null;

    await upsertLoyaltyPoint(c.env.DB, point.friend_id, {
      balance: newBalance,
      limitedBalance: newLimitedBalance,
      totalSpent: point.total_spent,
      rank: newRank,
      shopifyCustomerId: point.shopify_customer_id ?? undefined,
      limitedExpiresAt: newLimitedExpiresAt ?? undefined,
    });

    const grandTotalAfter = newBalance + newLimitedBalance;
    const limitedPart = limitedToUse > 0 ? `limited=${limitedToUse}` : 'limited=0';
    const balancePart = balanceToUse > 0 ? `balance=${balanceToUse}` : 'balance=0';
    const expPart = point.limited_expires_at
      ? `exp=${point.limited_expires_at}`
      : 'exp=none';

    await addLoyaltyTransaction(c.env.DB, {
      friendId: point.friend_id,
      type: 'redeem',
      points: -usePoints,
      balanceAfter: grandTotalAfter,
      reason: `ポイント利用（¥${discountAmount}割引 / コード: ${code}）[内訳:${limitedPart},${balancePart},${expPart}]`,
    });

    // カートURL生成
    const cartUrl = `https://${shopDomain}/cart/${body.variantId}:1?discount=${encodeURIComponent(code)}`;

    return c.json({
      success: true,
      data: {
        cartUrl,
        code,
        discountAmount,
        newBalance: grandTotalAfter,
      },
    });
  } catch (e) {
    console.error('shop checkout error:', e);
    return c.json({ success: false, error: 'チェックアウト処理に失敗しました' }, 500);
  }
});

export { shop };
