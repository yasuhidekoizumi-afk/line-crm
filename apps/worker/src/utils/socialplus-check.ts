/**
 * Shopify Admin API を使い、Shopify顧客が
 * CRM Plus (SocialPLUS) 時代に既にLINE連携済みかを判定する。
 *
 * 判定根拠: SocialPLUS は Shopify Customer メタフィールド
 *   namespace='socialplus' key='line' value=<LINE userId>
 * を書き込む。これが存在する顧客は CRM Plus 時代に連携済み。
 *
 * 自社版への移行期、CRM Plus で連携済みの顧客が新しい LINE連携を踏むと
 * 自社DB上は「初回連携」扱いで300ptボーナスが二重付与されてしまう問題への対策。
 *
 * 使い方:
 *   const linked = await isAlreadyLinkedViaSocialPlus(c.env, shopifyCustomerId);
 *   if (linked.linked) { bonusAwarded = 0; }
 */

interface EnvLike {
  SHOPIFY_SHOP_DOMAIN?: string;
  SHOPIFY_ADMIN_TOKEN?: string;
}

export interface SocialPlusLinkCheck {
  /** CRM Plus 時代に LINE 連携済みか */
  linked: boolean;
  /** 判定根拠（ログ・デバッグ用） */
  reason: 'metafield_present' | 'metafield_absent' | 'api_error' | 'env_missing';
  /** API失敗時のエラーメッセージ */
  error?: string;
  /** 取得できた LINE userId（あれば） */
  lineUserId?: string;
}

export async function isAlreadyLinkedViaSocialPlus(
  env: EnvLike,
  shopifyCustomerId: string,
): Promise<SocialPlusLinkCheck> {
  const shopDomain = env.SHOPIFY_SHOP_DOMAIN;
  const token = env.SHOPIFY_ADMIN_TOKEN;
  if (!shopDomain || !token) {
    return { linked: false, reason: 'env_missing' };
  }

  try {
    const url = `https://${shopDomain}/admin/api/2026-04/customers/${encodeURIComponent(shopifyCustomerId)}/metafields.json?namespace=socialplus&key=line`;
    const res = await fetch(url, {
      headers: { 'X-Shopify-Access-Token': token, 'Accept': 'application/json' },
    });
    if (!res.ok) {
      return { linked: false, reason: 'api_error', error: `HTTP ${res.status}` };
    }
    const json = await res.json<{ metafields?: Array<{ namespace?: string; key?: string; value?: string }> }>();
    const hit = (json.metafields ?? []).find(
      (m) => m.namespace === 'socialplus' && m.key === 'line' && typeof m.value === 'string' && m.value.length > 0,
    );
    if (hit) {
      return { linked: true, reason: 'metafield_present', lineUserId: hit.value };
    }
    return { linked: false, reason: 'metafield_absent' };
  } catch (err) {
    return {
      linked: false,
      reason: 'api_error',
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
