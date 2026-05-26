interface ShopifyTokenEnv {
  SHOPIFY_CLIENT_ID?: string;
  SHOPIFY_CLIENT_SECRET?: string;
  SHOPIFY_SHOP_DOMAIN?: string;
  SHOPIFY_ADMIN_TOKEN?: string;
}

let cachedToken: string | null = null;
let cachedTokenExpiresAt = 0;

/**
 * Shopify Admin API のアクセストークンを取得する。
 *
 * SHOPIFY_CLIENT_ID と SHOPIFY_CLIENT_SECRET が設定されている場合は、
 * Shopify Token Exchange (`client_credentials` grant) で短命トークンを発行し、
 * 期限の 5 分前まで in-memory にキャッシュする（isolate 単位）。
 *
 * 未設定なら静的な SHOPIFY_ADMIN_TOKEN にフォールバック。
 */
export async function getShopifyAdminToken(env: ShopifyTokenEnv): Promise<string | null> {
  if (cachedToken && Date.now() < cachedTokenExpiresAt) {
    return cachedToken;
  }
  if (env.SHOPIFY_CLIENT_ID && env.SHOPIFY_CLIENT_SECRET) {
    const shopDomain = env.SHOPIFY_SHOP_DOMAIN || 'yasuhide-koizumi.myshopify.com';
    try {
      const resp = await fetch(`https://${shopDomain}/admin/oauth/access_token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: env.SHOPIFY_CLIENT_ID,
          client_secret: env.SHOPIFY_CLIENT_SECRET,
          grant_type: 'client_credentials',
        }),
      });
      if (resp.ok) {
        const data = (await resp.json()) as { access_token: string; expires_in: number };
        cachedToken = data.access_token;
        cachedTokenExpiresAt = Date.now() + (data.expires_in - 300) * 1000;
        return cachedToken;
      }
      console.error('[shopify-token] Token Exchange failed:', resp.status, await resp.text());
    } catch (err) {
      console.error('[shopify-token] Token Exchange error:', err);
    }
  }
  return env.SHOPIFY_ADMIN_TOKEN ?? null;
}
