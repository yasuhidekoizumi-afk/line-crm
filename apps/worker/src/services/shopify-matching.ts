/**
 * raw_payload から customer_name を抽出して shopify_orders テーブルを更新
 * raw_payload がない場合、email/phone は既存カラムから使う
 */
export async function extractNamesFromPayload(db: D1Database): Promise<{ scanned: number; updated: number; errors: number }> {
  let updated = 0, errors = 0;
  const BATCH = 500;
  let offset = 0;
  let scanned = 0;

  while (true) {
    // raw_payloadカラムがあれば使う、なければスキップ
    let rows: { shopify_order_id: string; raw_payload: string | null }[];
    try {
      const r = await db.prepare(
        `SELECT shopify_order_id, raw_payload FROM shopify_orders WHERE customer_name IS NULL AND raw_payload IS NOT NULL ORDER BY shopify_order_id LIMIT ? OFFSET ?`
      ).bind(BATCH, offset).all<{ shopify_order_id: string; raw_payload: string | null }>();
      rows = r.results;
    } catch {
      // raw_payload カラムがない
      return { scanned: 0, updated: 0, errors: 0 };
    }

    if (rows.length === 0) break;
    scanned += rows.length;

    for (const row of rows) {
      try {
        const payload = JSON.parse(row.raw_payload || '{}');
        let name: string | null = null;
        const billing = payload.billing_address || payload.billingAddress;
        if (billing?.name && typeof billing.name === 'string' && billing.name.trim()) {
          name = billing.name.trim();
        } else {
          const cust = payload.customer;
          if (cust) {
            const first = cust.first_name || cust.firstName || '';
            const last = cust.last_name || cust.lastName || '';
            const full = `${last} ${first}`.trim();
            if (full) name = full;
          }
        }
        if (name) {
          await db.prepare(`UPDATE shopify_orders SET customer_name = ? WHERE shopify_order_id = ?`).bind(name, row.shopify_order_id).run();
          updated++;
        }
      } catch { errors++; }
    }
    offset += BATCH;
  }

  return { scanned, updated, errors };
}
