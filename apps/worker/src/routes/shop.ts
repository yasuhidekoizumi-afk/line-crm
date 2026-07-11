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
  // グラノーラ200g
  { variantId: '45285682806943', title: 'PLAIN プレーン 200g', price: 1080, category: 'グラノーラ',
    imageUrl: 'https://cdn.shopify.com/s/files/1/0504/3280/2975/files/31_b0628529-e595-4585-b2ca-bd8a56605925.png' },
  { variantId: '62613611020447', title: 'BANANA COCONUTS 200g', price: 1080, category: 'グラノーラ',
    imageUrl: 'https://cdn.shopify.com/s/files/1/0504/3280/2975/files/33_1d355fd0-c79a-4e8d-8e8a-12cfdefc58fa.png' },
  { variantId: '45285711675551', title: 'DRIED FRUIT 200g', price: 1080, category: 'グラノーラ',
    imageUrl: 'https://cdn.shopify.com/s/files/1/0504/3280/2975/files/35_e5dc6afb-a252-4bba-8d1f-dcc339b0b992.png' },
  // グラノーラ700g
  { variantId: '45285682839711', title: 'PLAIN プレーン 700g', price: 2980, category: 'グラノーラ',
    imageUrl: 'https://cdn.shopify.com/s/files/1/0504/3280/2975/files/31_b0628529-e595-4585-b2ca-bd8a56605925.png' },
  { variantId: '62613611053215', title: 'BANANA COCONUTS 700g', price: 2980, category: 'グラノーラ',
    imageUrl: 'https://cdn.shopify.com/s/files/1/0504/3280/2975/files/33_1d355fd0-c79a-4e8d-8e8a-12cfdefc58fa.png' },
  { variantId: '45285711708319', title: 'DRIED FRUIT 700g', price: 2980, category: 'グラノーラ',
    imageUrl: 'https://cdn.shopify.com/s/files/1/0504/3280/2975/files/35_e5dc6afb-a252-4bba-8d1f-dcc339b0b992.png' },
  // セット
  { variantId: '40611894853791', title: '人気3種セット', price: 3240, category: 'セット',
    imageUrl: 'https://cdn.shopify.com/s/files/1/0504/3280/2975/files/L2A0295.jpg?v=1741329747' },
  // 甘酒
  { variantId: '44744722120863', title: '米麹甘酒 プレーン 550g', price: 1120, category: '甘酒',
    imageUrl: 'https://cdn.shopify.com/s/files/1/0504/3280/2975/files/31_b0628529-e595-4585-b2ca-bd8a56605925.png' },
  // ソース・調味料
  { variantId: '46655182635167', title: '麹マヨ 1本', price: 800, category: 'ソース',
    imageUrl: 'https://cdn.shopify.com/s/files/1/0504/3280/2975/files/31_b0628529-e595-4585-b2ca-bd8a56605925.png' },
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
    // 買ったカテゴリの商品を優先。同じカテゴリ内は価格順。
    // 購入履歴なし → 全カテゴリから1つずつ代表商品を出す

    let products: CatalogProduct[];

    if (purchasedVariantIds.size > 0) {
      // 買ったことのあるカテゴリを集計
      const purchasedCategories = new Set<string>();
      for (const p of CATALOG) {
        if (purchasedVariantIds.has(p.variantId)) {
          purchasedCategories.add(p.category);
        }
      }

      // 買ったカテゴリの商品を先頭に、それ以外を後ろに
      const sameCategory: CatalogProduct[] = [];
      const otherCategory: CatalogProduct[] = [];

      for (const p of CATALOG) {
        if (purchasedCategories.has(p.category)) {
          sameCategory.push(p);
        } else {
          otherCategory.push(p);
        }
      }

      // 同じカテゴリ内は価格の安い順
      sameCategory.sort((a, b) => a.price - b.price);
      otherCategory.sort((a, b) => a.price - b.price);

      products = [...sameCategory, ...otherCategory];
    } else {
      // 購入履歴なし → 全商品（カテゴリごとに1アイテムずつ、価格順）
      const seen = new Set<string>();
      const picked: CatalogProduct[] = [];
      for (const p of CATALOG) {
        if (!seen.has(p.category)) {
          seen.add(p.category);
          picked.push(p);
        }
      }
      // 残りも追加
      for (const p of CATALOG) {
        if (!picked.includes(p)) picked.push(p);
      }
      products = picked;
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
