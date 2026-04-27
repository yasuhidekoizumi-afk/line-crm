/**
 * Shopify 商品ルート
 *
 * - GET /api/shopify/products             — 商品一覧（画像URL付き）
 * - GET /api/shopify/products/search?q=   — 名前部分一致で商品検索
 *
 * Admin API REST `products.json` をキャッシュ無しで都度叩く。
 * 商品数が多い場合は将来 D1 にキャッシュする想定。
 */

import { Hono } from 'hono';
import { authMiddleware } from '../middleware/auth.js';
import type { Env } from '../index.js';

export const shopifyProducts = new Hono<Env>();

shopifyProducts.use('/api/shopify/products*', authMiddleware);

const SHOPIFY_API_VERSION = '2024-10';

interface ShopifyProductImage {
  id: number;
  src: string;
}

interface ShopifyProduct {
  id: number;
  title: string;
  handle: string;
  status: string;
  vendor: string;
  product_type: string;
  image: ShopifyProductImage | null;
  images: ShopifyProductImage[];
}

interface ProductSummary {
  id: string;
  title: string;
  handle: string;
  image_url: string | null;
}

async function fetchShopifyProducts(
  shopDomain: string,
  adminToken: string,
  params: { search?: string; limit?: number } = {},
): Promise<ProductSummary[]> {
  const limit = Math.min(params.limit ?? 50, 250);
  const url = new URL(`https://${shopDomain}/admin/api/${SHOPIFY_API_VERSION}/products.json`);
  url.searchParams.set('limit', String(limit));
  url.searchParams.set('status', 'active');
  url.searchParams.set('fields', 'id,title,handle,status,vendor,product_type,image,images');
  if (params.search) url.searchParams.set('title', params.search);

  const res = await fetch(url.toString(), {
    headers: {
      'X-Shopify-Access-Token': adminToken,
      'Accept': 'application/json',
    },
  });
  if (!res.ok) {
    throw new Error(`Shopify ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  const data = await res.json<{ products: ShopifyProduct[] }>();
  return data.products.map((p) => ({
    id: String(p.id),
    title: p.title,
    handle: p.handle,
    image_url: p.image?.src ?? p.images?.[0]?.src ?? null,
  }));
}

shopifyProducts.get('/api/shopify/products', async (c) => {
  const shopDomain = c.env.SHOPIFY_SHOP_DOMAIN;
  const adminToken = c.env.SHOPIFY_ADMIN_TOKEN;
  if (!shopDomain || !adminToken) {
    return c.json({ success: false, error: 'SHOPIFY_SHOP_DOMAIN / SHOPIFY_ADMIN_TOKEN not configured' }, 503);
  }
  const search = c.req.query('q') ?? c.req.query('search') ?? undefined;
  const limit = c.req.query('limit') ? Number(c.req.query('limit')) : 50;
  try {
    const products = await fetchShopifyProducts(shopDomain, adminToken, { search, limit });
    return c.json({ success: true, data: products });
  } catch (err) {
    console.error('[shopify-products] error:', err);
    return c.json({ success: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

// 商品 ID 配列を渡して商品サマリを取得（複数）
shopifyProducts.post('/api/shopify/products/lookup', async (c) => {
  const shopDomain = c.env.SHOPIFY_SHOP_DOMAIN;
  const adminToken = c.env.SHOPIFY_ADMIN_TOKEN;
  if (!shopDomain || !adminToken) {
    return c.json({ success: false, error: 'Shopify not configured' }, 503);
  }
  const body = await c.req.json<{ ids?: string[] }>();
  const ids = (body.ids ?? []).filter(Boolean);
  if (ids.length === 0) return c.json({ success: true, data: [] });
  try {
    const url = new URL(`https://${shopDomain}/admin/api/${SHOPIFY_API_VERSION}/products.json`);
    url.searchParams.set('ids', ids.join(','));
    url.searchParams.set('fields', 'id,title,handle,image,images');
    const res = await fetch(url.toString(), {
      headers: {
        'X-Shopify-Access-Token': adminToken,
        'Accept': 'application/json',
      },
    });
    if (!res.ok) throw new Error(`Shopify ${res.status}`);
    const data = await res.json<{ products: ShopifyProduct[] }>();
    return c.json({
      success: true,
      data: data.products.map((p) => ({
        id: String(p.id),
        title: p.title,
        handle: p.handle,
        image_url: p.image?.src ?? p.images?.[0]?.src ?? null,
      })),
    });
  } catch (err) {
    console.error('[shopify-products] lookup error:', err);
    return c.json({ success: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

export { fetchShopifyProducts };
