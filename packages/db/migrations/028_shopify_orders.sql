-- ============================================================
-- 028_shopify_orders.sql
-- Shopify 注文の永続化（CRM × 売上アトリビューションBI 基盤）
-- ============================================================

CREATE TABLE IF NOT EXISTS shopify_orders (
  shopify_order_id      TEXT PRIMARY KEY,
  shopify_order_number  TEXT,
  shop_domain           TEXT NOT NULL DEFAULT 'yasuhide-koizumi.myshopify.com',
  customer_id           TEXT,
  friend_id             TEXT,
  shopify_customer_id   TEXT,
  email                 TEXT,
  phone                 TEXT,
  total_price           REAL NOT NULL,
  subtotal_price        REAL,
  total_tax             REAL,
  total_discounts       REAL,
  total_shipping        REAL,
  currency              TEXT NOT NULL DEFAULT 'JPY',
  financial_status      TEXT,
  fulfillment_status    TEXT,
  cancelled_at          TEXT,
  source_name           TEXT,
  landing_site          TEXT,
  referring_site        TEXT,
  tags                  TEXT,
  customer_orders_count INTEGER,
  processed_at          TEXT NOT NULL,
  created_at_shopify    TEXT NOT NULL,
  updated_at_shopify    TEXT,
  raw_payload           TEXT,
  ingested_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  ingested_via          TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_shopify_orders_customer_id   ON shopify_orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_shopify_orders_friend_id     ON shopify_orders(friend_id);
CREATE INDEX IF NOT EXISTS idx_shopify_orders_shopify_cust  ON shopify_orders(shopify_customer_id);
CREATE INDEX IF NOT EXISTS idx_shopify_orders_email         ON shopify_orders(email);
CREATE INDEX IF NOT EXISTS idx_shopify_orders_processed     ON shopify_orders(processed_at);
CREATE INDEX IF NOT EXISTS idx_shopify_orders_financial     ON shopify_orders(financial_status);

CREATE TABLE IF NOT EXISTS shopify_order_items (
  shopify_line_item_id  TEXT PRIMARY KEY,
  shopify_order_id      TEXT NOT NULL,
  shopify_product_id    TEXT,
  shopify_variant_id    TEXT,
  sku                   TEXT,
  title                 TEXT,
  variant_title         TEXT,
  product_type          TEXT,
  vendor                TEXT,
  quantity              INTEGER NOT NULL,
  price                 REAL NOT NULL,
  total_discount        REAL,
  taxable               INTEGER DEFAULT 1,
  requires_shipping     INTEGER DEFAULT 1,
  FOREIGN KEY (shopify_order_id) REFERENCES shopify_orders(shopify_order_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_order_items_order    ON shopify_order_items(shopify_order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_product  ON shopify_order_items(shopify_product_id);
CREATE INDEX IF NOT EXISTS idx_order_items_sku      ON shopify_order_items(sku);

CREATE TABLE IF NOT EXISTS shopify_products (
  shopify_product_id    TEXT PRIMARY KEY,
  title                 TEXT,
  product_type          TEXT,
  vendor                TEXT,
  tags                  TEXT,
  status                TEXT,
  cost_price            REAL,
  raw_payload           TEXT,
  created_at_shopify    TEXT,
  updated_at_shopify    TEXT,
  ingested_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);
CREATE INDEX IF NOT EXISTS idx_shopify_products_type   ON shopify_products(product_type);
CREATE INDEX IF NOT EXISTS idx_shopify_products_vendor ON shopify_products(vendor);

CREATE TABLE IF NOT EXISTS order_attributions (
  attribution_id        TEXT PRIMARY KEY,
  shopify_order_id      TEXT NOT NULL,
  customer_id           TEXT,
  friend_id             TEXT,
  attribution_source    TEXT NOT NULL,
  source_id             TEXT,
  click_at              TEXT,
  window_days           INTEGER,
  computed_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  UNIQUE(shopify_order_id, attribution_source, source_id),
  FOREIGN KEY (shopify_order_id) REFERENCES shopify_orders(shopify_order_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_attr_order    ON order_attributions(shopify_order_id);
CREATE INDEX IF NOT EXISTS idx_attr_customer ON order_attributions(customer_id);
CREATE INDEX IF NOT EXISTS idx_attr_friend   ON order_attributions(friend_id);
CREATE INDEX IF NOT EXISTS idx_attr_source   ON order_attributions(attribution_source, source_id);

CREATE TABLE IF NOT EXISTS shopify_backfill_progress (
  job_name              TEXT PRIMARY KEY,
  cursor                TEXT,
  total_processed       INTEGER NOT NULL DEFAULT 0,
  last_run_at           TEXT,
  status                TEXT NOT NULL DEFAULT 'idle',
  last_error            TEXT
);
