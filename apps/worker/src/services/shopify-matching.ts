/**
 * バッチ: 全未マッチ注文 + 全友だち を一括マッチング
 */
export async function batchMatchAll(
  db: D1Database,
  options: { limit?: number; useCustomerName?: boolean } = {},
): Promise<{
  totalUnmatchedOrders: number;
  matched: number;
  skipped: number;
  errors: number;
  results: Array<{
    shopify_order_id: string;
    customer_name: string | null;
    friend_name: string | null;
    matched_by: string;
  }>;
}> {
  const limit = options.limit ?? 500;
  const useCN = options.useCustomerName ?? false;

  try {
    // customer_name は NULL でも許可。名前があれば名前マッチ、なければ email/phone/ID マッチ
    const nameCol = useCN ? ', customer_name' : '';
    const nameColNull = useCN ? '' : ', NULL as customer_name';

    const unmatchOrders = await db
      .prepare(`SELECT shopify_order_id, shopify_customer_id${nameCol}${nameColNull}, email, phone FROM shopify_orders WHERE friend_id IS NULL AND cancelled_at IS NULL ORDER BY processed_at DESC LIMIT ?`)
      .bind(limit)
      .all<ShopifyOrderForMatch>();

    const results: Array<{ shopify_order_id: string; customer_name: string | null; friend_name: string | null; matched_by: string }> = [];
    let matched = 0;
    let skipped = 0;
    let errors = 0;

    for (const order of unmatchOrders.results) {
      try {
        const candidate = await matchShopifyOrderToFriend(db, order);
        if (candidate && candidate.score >= 60) {
          const ok = await applyMatch(db, order.shopify_order_id, candidate.id, order.shopify_customer_id);
          if (ok) {
            matched++;
            results.push({
              shopify_order_id: order.shopify_order_id,
              customer_name: order.customer_name,
              friend_name: candidate.displayName,
              matched_by: candidate.matchedBy,
            });
          } else {
            errors++;
          }
        } else {
          skipped++;
        }
      } catch {
        errors++;
      }
    }

    return {
      totalUnmatchedOrders: unmatchOrders.results.length,
      matched,
      skipped,
      errors,
      results,
    };
  } catch (e) {
    return {
      totalUnmatchedOrders: 0,
      matched: 0,
      skipped: 0,
      errors: 1,
      results: [],
    };
  }
}
