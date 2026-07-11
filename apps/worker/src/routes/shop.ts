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
} from '@line-crm/db';
import { getShopifyAdminToken } from '../utils/shopify-token.js';
import type { Env } from '../index.js';

const shop = new Hono<Env>();

// ── 商品カタログ（表示順＝おすすめ度のフォールバック） ──

interface CatalogProduct {
  variantId: string;
  title: string;
  price: number;
  category: string;
  imageUrl?: string;
}

const CATALOG: CatalogProduct[] = [
  { variantId: '40611894853791', title: '人気3種セット（プレーン/チョコ/バナナココナッツ）', price: 3240, category: 'セット',
    imageUrl: 'https://cdn.shopify.com/s/files/1/0504/3280/2975/files/L2A0295.jpg?v=1741329747' },
  { variantId: '45285682806943', title: 'PLAIN プレーン 200g', price: 1080, category: 'グラノーラ200g',
    imageUrl: 'https://cdn.shopify.com/s/files/1/0504/3280/2975/files/31_b0628529-e595-4585-b2ca-bd8a56605925.png' },
  { variantId: '62613611020447', title: 'BANANA COCONUTS 200g', price: 1080, category: 'グラノーラ200g',
    imageUrl: 'https://cdn.shopify.com/s/files/1/0504/3280/2975/files/33_1d355fd0-c79a-4e8d-8e8a-12cfdefc58fa.png' },
  { variantId: '45285711675551', title: 'DRIED FRUIT 200g', price: 1080, category: 'グラノーラ200g',
    imageUrl: 'https://cdn.shopify.com/s/files/1/0504/3280/2975/files/35_e5dc6afb-a252-4bba-8d1f-dcc339b0b992.png' },
];

const CATALOG_BY_ID = new Map(CATALOG.map(p => [p.variantId, p]));

// 許可されたvariant（checkout時に使う）
const FEATURED_VARIANTS = new Set(CATALOG.map(p => p.variantId));

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

// ── POST /api/shop/products ───────────────────────

/** 購入履歴からパーソナライズされた商品一覧を返す */
shop.post('/api/shop/products', async (c) => {
  try {
    const { lineUserId } = await c.req.json<{ lineUserId: string }>();
    if (!lineUserId) return c.json({ success: false, error: 'lineUserId は必須です' }, 400);

    const friend = await getFriendByLineUserId(c.env.DB, lineUserId);
    if (!friend) return c.json({ success: false, error: 'LINE連携がありません' }, 404);

    const point = await getLoyaltyPoint(c.env.DB, friend.id);
    const shopifyCustomerId = point?.shopify_customer_id;

    // 購入済みvariant IDを取得（Shopify Admin API、非同期）
    let purchasedVariantIds = new Set<string>();
    if (shopifyCustomerId) {
      try {
        const shopDomain = c.env.SHOPIFY_SHOP_DOMAIN;
        const adminToken = await getShopifyAdminToken(c.env);
        if (shopDomain && adminToken) {
          const ordersRes = await fetch(
            `https://${shopDomain}/admin/api/2024-10/orders.json?customer_id=${shopifyCustomerId}&status=any&limit=30&fields=id,line_items`,
            { headers: { 'X-Shopify-Access-Token': adminToken } },
          );
          if (ordersRes.ok) {
            const ordersData = await ordersRes.json() as {
              orders: Array<{ line_items: Array<{ variant_id: number }> }>;
            };
            for (const order of ordersData.orders) {
              for (const li of order.line_items) {
                const vid = String(li.variant_id);
                if (FEATURED_VARIANTS.has(vid)) purchasedVariantIds.add(vid);
              }
            }
          }
        }
      } catch { /* fallback to bestsellers */ }
    }

    // ── レコメンドロジック ──
    // ルール1: 購入済み商品を最優先（知ってるものに使う）
    // ルール2: 同じカテゴリの未購入品を1つ追加（ソフトクロスセル）
    // ルール3: 購入履歴ゼロならベストセラー順

    const purchased: CatalogProduct[] = [];
    const unpurchased: CatalogProduct[] = [];

    for (const p of CATALOG) {
      if (purchasedVariantIds.has(p.variantId)) {
        purchased.push(p);
      } else {
        unpurchased.push(p);
      }
    }

    let products: CatalogProduct[];

    if (purchased.length > 0) {
      // 購入済みを先頭に、同じカテゴリの未購入品を1つ追加
      const purchasedCategories = new Set(purchased.map(p => p.category));
      const similar = unpurchased.find(p => purchasedCategories.has(p.category));

      products = [...purchased];
      if (similar) products.push(similar);
      // それでも3商品未満なら、ベストセラー順で補完
      for (const p of unpurchased) {
        if (products.length >= 3) break;
        if (!products.includes(p)) products.push(p);
      }
    } else {
      // 購入履歴なし → ベストセラー（カタログ定義順 = 人気3種セットが先頭）
      products = [...CATALOG];
    }

    return c.json({
      success: true,
      data: products.map(p => ({
        variantId: p.variantId,
        title: p.title,
        price: p.price,
        imageUrl: p.imageUrl,
      })),
    });
  } catch (e) {
    console.error('shop products error:', e);
    return c.json({ success: false, error: '商品一覧の取得に失敗しました' }, 500);
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

    // 割引額 = ポイント数（1pt = ¥1）
    const discountAmount = usePoints;

    // 割引コード生成（ポイント数を埋め込む: ORYZAE-{pt}-{cid6}-{ts}）
    // ポイント消費は注文支払完了Webhook（orders-paid）で行う
    const code = `ORYZAE-${usePoints}-${shopifyCustomerId.slice(-6)}-${Date.now().toString(36).toUpperCase()}`;

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

    // NOTE: ポイント消費はここでは行わない。実際の消費は
    // Shopify Webhook orders-paid で、注文が確定してから行う。

    // カートURL生成
    const cartUrl = `https://${shopDomain}/cart/${body.variantId}:1?discount=${encodeURIComponent(code)}`;

    return c.json({
      success: true,
      data: {
        cartUrl,
        code,
        discountAmount,
        newBalance: totalBalance, // 消費前の残高（消費は注文確定後）
      },
    });
  } catch (e) {
    console.error('shop checkout error:', e);
    return c.json({ success: false, error: 'チェックアウト処理に失敗しました' }, 500);
  }
});

export { shop };
