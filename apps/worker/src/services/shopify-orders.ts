/**
 * Shopify 注文の永続化サービス
 *
 * - リアルタイム Webhook (shopify-webhooks.ts) と
 *   全期間バックフィル (routes/shopify-orders.ts) の双方から呼ばれる。
 * - shopify_orders / shopify_order_items に UPSERT する。
 * - shopify_customer_id から FERMENT customers と LINE-CRM friends を解決し、
 *   解決できたものだけ FK を埋める（後追い解決可）。
 * - FERMENT 既存の events.order_placed / customers.ltv 更新パスは破壊しない。
 */

export interface ShopifyOrderPayload {
  id: number | string;
  name?: string;
  email?: string | null;
  phone?: string | null;
  total_price?: string | number;
  subtotal_price?: string | number | null;
  total_tax?: string | number | null;
  total_discounts?: string | number | null;
  total_shipping_price_set?: { shop_money?: { amount?: string | number } };
  currency?: string;
  financial_status?: string | null;
  fulfillment_status?: string | null;
  cancelled_at?: string | null;
  source_name?: string | null;
  landing_site?: string | null;
  referring_site?: string | null;
  tags?: string | null;
  processed_at?: string | null;
  created_at?: string;
  updated_at?: string | null;
  customer?: {
    id?: number | string;
    email?: string | null;
    phone?: string | null;
    orders_count?: number;
  } | null;
  line_items?: Array<{
    id: number | string;
    product_id?: number | string | null;
    variant_id?: number | string | null;
    sku?: string | null;
    title?: string | null;
    variant_title?: string | null;
    product_type?: string | null;
    vendor?: string | null;
    quantity: number;
    price: string | number;
    total_discount?: string | number | null;
    taxable?: boolean;
    requires_shipping?: boolean;
  }>;
}

export interface PersistOrderResult {
  shopifyOrderId: string;
  customerId: string | null;
  friendId: string | null;
  inserted: boolean;
  itemCount: number;
}

const toNum = (v: string | number | null | undefined): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : null;
};

const toStr = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  return String(v);
};

async function resolveLinkedIds(
  db: D1Database,
  shopifyCustomerId: string | null,
  email: string | null,
): Promise<{ customer_id: string | null; friend_id: string | null }> {
  if (!shopifyCustomerId && !email) return { customer_id: null, friend_id: null };
  const emailLower = email ? email.toLowerCase() : null;
  const rows = await db
    .prepare(
      `SELECT 'customer' AS kind, customer_id AS id FROM customers
         WHERE (?1 IS NOT NULL AND (shopify_customer_id_jp = ?1 OR shopify_customer_id_us = ?1))
            OR (?2 IS NOT NULL AND email = ?2)
       UNION ALL
       SELECT 'friend' AS kind, friend_id AS id FROM loyalty_points
         WHERE ?1 IS NOT NULL AND shopify_customer_id = ?1`,
    )
    .bind(shopifyCustomerId, emailLower)
    .all<{ kind: string; id: string }>();

  let customer_id: string | null = null;
  let friend_id: string | null = null;
  for (const r of rows.results ?? []) {
    if (r.kind === 'customer' && !customer_id) customer_id = r.id;
    if (r.kind === 'friend' && !friend_id) friend_id = r.id;
  }
  return { customer_id, friend_id };
}

/**
 * Shopify 注文を shopify_orders / shopify_order_items に UPSERT する。
 *
 * line_items は SQLite の bind variable 上限 (~1000) を超えないよう
 * 50 件ずつチャンク insert する（14 cols × 50 = 700 で安全圏）。
 */
export async function persistShopifyOrder(
  db: D1Database,
  order: ShopifyOrderPayload,
  ingestedVia: 'webhook' | 'backfill',
  shopDomain = 'yasuhide-koizumi.myshopify.com',
): Promise<PersistOrderResult> {
  const shopifyOrderId = String(order.id);
  const shopifyCustomerId = order.customer?.id != null ? String(order.customer.id) : null;
  const email = order.email ?? order.customer?.email ?? null;
  const phone = order.phone ?? order.customer?.phone ?? null;

  const { customer_id, friend_id } = await resolveLinkedIds(db, shopifyCustomerId, email);

  const existing = await db
    .prepare(`SELECT shopify_order_id FROM shopify_orders WHERE shopify_order_id = ? LIMIT 1`)
    .bind(shopifyOrderId)
    .first();

  const totalShipping = toNum(order.total_shipping_price_set?.shop_money?.amount) ?? null;
  const processedAt = order.processed_at ?? order.created_at ?? new Date().toISOString();
  const createdAtShopify = order.created_at ?? processedAt;

  await db
    .prepare(
      `INSERT INTO shopify_orders (
         shopify_order_id, shopify_order_number, shop_domain,
         customer_id, friend_id, shopify_customer_id, email, phone,
         total_price, subtotal_price, total_tax, total_discounts, total_shipping, currency,
         financial_status, fulfillment_status, cancelled_at,
         source_name, landing_site, referring_site, tags,
         customer_orders_count,
         processed_at, created_at_shopify, updated_at_shopify, ingested_via
       ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(shopify_order_id) DO UPDATE SET
         shopify_order_number  = excluded.shopify_order_number,
         customer_id           = COALESCE(excluded.customer_id, shopify_orders.customer_id),
         friend_id             = COALESCE(excluded.friend_id, shopify_orders.friend_id),
         shopify_customer_id   = excluded.shopify_customer_id,
         email                 = excluded.email,
         phone                 = excluded.phone,
         total_price           = excluded.total_price,
         subtotal_price        = excluded.subtotal_price,
         total_tax             = excluded.total_tax,
         total_discounts       = excluded.total_discounts,
         total_shipping        = excluded.total_shipping,
         currency              = excluded.currency,
         financial_status      = excluded.financial_status,
         fulfillment_status    = excluded.fulfillment_status,
         cancelled_at          = excluded.cancelled_at,
         source_name           = excluded.source_name,
         landing_site          = excluded.landing_site,
         referring_site        = excluded.referring_site,
         tags                  = excluded.tags,
         customer_orders_count = excluded.customer_orders_count,
         processed_at          = excluded.processed_at,
         updated_at_shopify    = excluded.updated_at_shopify`,
    )
    .bind(
      shopifyOrderId,
      order.name ?? null,
      shopDomain,
      customer_id,
      friend_id,
      shopifyCustomerId,
      email,
      phone,
      toNum(order.total_price) ?? 0,
      toNum(order.subtotal_price),
      toNum(order.total_tax),
      toNum(order.total_discounts),
      totalShipping,
      order.currency ?? 'JPY',
      order.financial_status ?? null,
      order.fulfillment_status ?? null,
      order.cancelled_at ?? null,
      order.source_name ?? null,
      order.landing_site ?? null,
      order.referring_site ?? null,
      order.tags ?? null,
      order.customer?.orders_count ?? null,
      processedAt,
      createdAtShopify,
      order.updated_at ?? null,
      ingestedVia,
    )
    .run();

  await db.prepare(`DELETE FROM shopify_order_items WHERE shopify_order_id = ?`)
    .bind(shopifyOrderId)
    .run();

  const items = order.line_items ?? [];
  const ITEM_CHUNK = 50;
  for (let i = 0; i < items.length; i += ITEM_CHUNK) {
    const chunk = items.slice(i, i + ITEM_CHUNK);
    const placeholders = chunk.map(() => `(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).join(',');
    const flat: (string | number | null)[] = [];
    for (const li of chunk) {
      flat.push(
        String(li.id),
        shopifyOrderId,
        toStr(li.product_id),
        toStr(li.variant_id),
        li.sku ?? null,
        li.title ?? null,
        li.variant_title ?? null,
        li.product_type ?? null,
        li.vendor ?? null,
        li.quantity,
        toNum(li.price) ?? 0,
        toNum(li.total_discount),
        li.taxable === false ? 0 : 1,
        li.requires_shipping === false ? 0 : 1,
      );
    }
    await db
      .prepare(
        `INSERT INTO shopify_order_items (
           shopify_line_item_id, shopify_order_id,
           shopify_product_id, shopify_variant_id, sku,
           title, variant_title, product_type, vendor,
           quantity, price, total_discount, taxable, requires_shipping
         ) VALUES ${placeholders}`,
      )
      .bind(...flat)
      .run();
  }

  return {
    shopifyOrderId,
    customerId: customer_id,
    friendId: friend_id,
    inserted: !existing,
    itemCount: items.length,
  };
}

export async function getBackfillProgress(
  db: D1Database,
  jobName: string,
): Promise<{ cursor: string | null; total_processed: number; status: string } | null> {
  return await db
    .prepare(
      `SELECT cursor, total_processed, status
       FROM shopify_backfill_progress WHERE job_name = ? LIMIT 1`,
    )
    .bind(jobName)
    .first<{ cursor: string | null; total_processed: number; status: string }>();
}

export async function updateBackfillProgress(
  db: D1Database,
  jobName: string,
  patch: { cursor?: string | null; total_processed?: number; status?: string; last_error?: string | null },
): Promise<void> {
  const existing = await getBackfillProgress(db, jobName);
  const now = new Date().toISOString();
  if (!existing) {
    await db
      .prepare(
        `INSERT INTO shopify_backfill_progress
         (job_name, cursor, total_processed, last_run_at, status, last_error)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        jobName,
        patch.cursor ?? null,
        patch.total_processed ?? 0,
        now,
        patch.status ?? 'idle',
        patch.last_error ?? null,
      )
      .run();
    return;
  }
  await db
    .prepare(
      `UPDATE shopify_backfill_progress
         SET cursor = COALESCE(?, cursor),
             total_processed = COALESCE(?, total_processed),
             last_run_at = ?,
             status = COALESCE(?, status),
             last_error = ?
       WHERE job_name = ?`,
    )
    .bind(
      patch.cursor ?? null,
      patch.total_processed ?? null,
      now,
      patch.status ?? null,
      patch.last_error ?? null,
      jobName,
    )
    .run();
}
