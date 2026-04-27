/**
 * Shopify 顧客コンテキスト取得
 *
 * AIトリアージのプロンプトに注入するため、メールアドレスから顧客の
 * 購入履歴・LTV・最近の注文ステータスを取得する。
 */

interface ShopifyCustomer {
  id: number;
  email: string;
  first_name: string | null;
  last_name: string | null;
  total_spent: string;
  orders_count: number;
  tags: string;
  created_at: string;
}

interface ShopifyLineItem {
  title: string;
  quantity: number;
  variant_title?: string | null;
}

interface ShopifyOrder {
  id: number;
  name: string;
  created_at: string;
  total_price: string;
  financial_status: string | null;
  fulfillment_status: string | null;
  line_items: ShopifyLineItem[];
}

export interface ShopifyCustomerContext {
  customer: {
    name: string;
    ltv_jpy: number;
    orders_count: number;
    tags: string[];
    customer_since: string;
  } | null;
  recent_orders: Array<{
    name: string;
    ordered_at: string;
    total: string;
    payment_status: string | null;
    fulfillment_status: string | null;
    items: string[];
  }>;
}

/**
 * メールアドレスから顧客と直近の注文を取得して AIプロンプト用にまとめる。
 * Shopify未連携 or エラー時は null を返す（処理を止めない）。
 */
export async function fetchShopifyCustomerContext(
  shopDomain: string | undefined,
  adminToken: string | undefined,
  email: string,
): Promise<ShopifyCustomerContext | null> {
  if (!shopDomain || !adminToken) return null;
  try {
    // 1. 顧客検索
    const searchUrl = `https://${shopDomain}/admin/api/2024-10/customers/search.json?query=${encodeURIComponent(`email:${email}`)}&limit=1`;
    const searchRes = await fetch(searchUrl, {
      headers: { 'X-Shopify-Access-Token': adminToken },
    });
    if (!searchRes.ok) {
      console.warn(`[shopify-context] customer search failed (${searchRes.status})`);
      return null;
    }
    const searchJson = (await searchRes.json()) as { customers?: ShopifyCustomer[] };
    const customer = searchJson.customers?.[0];
    if (!customer) return { customer: null, recent_orders: [] };

    // 2. 直近の注文取得（最大5件）
    const ordersUrl = `https://${shopDomain}/admin/api/2024-10/customers/${customer.id}/orders.json?status=any&limit=5`;
    const ordersRes = await fetch(ordersUrl, {
      headers: { 'X-Shopify-Access-Token': adminToken },
    });
    let orders: ShopifyOrder[] = [];
    if (ordersRes.ok) {
      const ordersJson = (await ordersRes.json()) as { orders?: ShopifyOrder[] };
      orders = ordersJson.orders ?? [];
    }

    return {
      customer: {
        name: [customer.last_name, customer.first_name].filter(Boolean).join(' ') || customer.email,
        ltv_jpy: Math.round(Number(customer.total_spent) || 0),
        orders_count: customer.orders_count,
        tags: customer.tags ? customer.tags.split(',').map((t) => t.trim()).filter(Boolean) : [],
        customer_since: customer.created_at.slice(0, 10),
      },
      recent_orders: orders.map((o) => ({
        name: o.name,
        ordered_at: o.created_at.slice(0, 10),
        total: o.total_price,
        payment_status: o.financial_status,
        fulfillment_status: o.fulfillment_status,
        items: o.line_items.slice(0, 5).map(
          (li) => `${li.title}${li.variant_title ? ` (${li.variant_title})` : ''} × ${li.quantity}`,
        ),
      })),
    };
  } catch (e) {
    console.error('[shopify-context] error:', e);
    return null;
  }
}
