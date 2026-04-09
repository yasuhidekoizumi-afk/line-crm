/**
 * Shopify Admin API ユーティリティ
 * - 注文メタフィールドへの付与/利用ポイント保存
 * - 顧客メタフィールドへの保有ポイント保存
 */

/**
 * 注文メタフィールドに付与/利用ポイントを保存
 * namespace: loyalty, key: awarded_points / used_points
 */
export async function saveOrderMetafields(
  shopDomain: string,
  adminToken: string,
  orderId: string,
  fields: { awarded_points?: number; used_points?: number },
): Promise<void> {
  const entries: Array<{ key: string; value: string }> = [];
  if (fields.awarded_points !== undefined) {
    entries.push({ key: 'awarded_points', value: String(fields.awarded_points) });
  }
  if (fields.used_points !== undefined) {
    entries.push({ key: 'used_points', value: String(fields.used_points) });
  }
  if (entries.length === 0) return;

  await Promise.allSettled(
    entries.map(({ key, value }) =>
      fetch(
        `https://${shopDomain}/admin/api/2024-10/orders/${orderId}/metafields.json`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Shopify-Access-Token': adminToken,
          },
          body: JSON.stringify({
            metafield: {
              namespace: 'loyalty',
              key,
              value,
              type: 'number_integer',
            },
          }),
        },
      ),
    ),
  );
}

/**
 * 顧客メタフィールドに保有ポイントを保存
 * namespace: loyalty, key: points
 */
export async function saveCustomerMetafields(
  shopDomain: string,
  adminToken: string,
  customerId: string,
  loyaltyPoints: number,
): Promise<void> {
  await fetch(
    `https://${shopDomain}/admin/api/2024-10/customers/${customerId}/metafields.json`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': adminToken,
      },
      body: JSON.stringify({
        metafield: {
          namespace: 'loyalty',
          key: 'points',
          value: String(loyaltyPoints),
          type: 'number_integer',
        },
      }),
    },
  );
}
