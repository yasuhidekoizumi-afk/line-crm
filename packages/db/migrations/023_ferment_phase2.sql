-- ============================================
-- FERMENT Phase 2 + 3: 高度機能用テーブル追加
-- Migration: 023
-- ============================================

-- カスタマーへの拡張カラム
ALTER TABLE customers ADD COLUMN phone TEXT;
ALTER TABLE customers ADD COLUMN subscribed_sms INTEGER DEFAULT 0;
ALTER TABLE customers ADD COLUMN predicted_next_order_at TEXT;
ALTER TABLE customers ADD COLUMN predicted_clv INTEGER DEFAULT 0;
ALTER TABLE customers ADD COLUMN purchase_probability_30d REAL DEFAULT 0;
ALTER TABLE customers ADD COLUMN best_send_hour INTEGER;
ALTER TABLE customers ADD COLUMN avg_purchase_interval_days INTEGER;

-- カート状態（Shopify からのリアルタイム同期）
CREATE TABLE IF NOT EXISTS customer_cart_states (
  cart_id          TEXT PRIMARY KEY,
  customer_id      TEXT REFERENCES customers(customer_id) ON DELETE CASCADE,
  email            TEXT,
  region           TEXT NOT NULL DEFAULT 'JP',
  -- カート JSON: line_items, total, currency 等
  cart_data        TEXT NOT NULL,
  abandoned_at     TEXT,
  recovered_at     TEXT,
  reminder_sent_count INTEGER DEFAULT 0,
  last_reminder_at TEXT,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

CREATE INDEX IF NOT EXISTS idx_cart_customer ON customer_cart_states(customer_id);
CREATE INDEX IF NOT EXISTS idx_cart_email ON customer_cart_states(email);
CREATE INDEX IF NOT EXISTS idx_cart_abandoned ON customer_cart_states(abandoned_at);

-- A/B テスト用キャンペーンバリアント
CREATE TABLE IF NOT EXISTS email_campaign_variants (
  variant_id       TEXT PRIMARY KEY,
  campaign_id      TEXT NOT NULL REFERENCES email_campaigns(campaign_id) ON DELETE CASCADE,
  -- バリアント名: 'A', 'B', 'C'
  variant_name     TEXT NOT NULL,
  subject_override TEXT,
  body_html_override TEXT,
  -- 配分比率（合計100にする想定）
  weight           INTEGER DEFAULT 50,
  -- 実績
  total_sent       INTEGER DEFAULT 0,
  total_opened     INTEGER DEFAULT 0,
  total_clicked    INTEGER DEFAULT 0,
  is_winner        INTEGER DEFAULT 0,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

CREATE INDEX IF NOT EXISTS idx_variant_campaign ON email_campaign_variants(campaign_id);

-- 商品レコメンド用：顧客×商品の関連度
CREATE TABLE IF NOT EXISTS customer_product_affinity (
  customer_id      TEXT NOT NULL REFERENCES customers(customer_id) ON DELETE CASCADE,
  shopify_product_id TEXT NOT NULL,
  product_title    TEXT,
  product_url      TEXT,
  product_image    TEXT,
  affinity_score   REAL DEFAULT 0,
  computed_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  PRIMARY KEY (customer_id, shopify_product_id)
);

CREATE INDEX IF NOT EXISTS idx_affinity_customer ON customer_product_affinity(customer_id, affinity_score DESC);

-- グローバル人気商品（フォールバック用）
CREATE TABLE IF NOT EXISTS popular_products (
  shopify_product_id TEXT PRIMARY KEY,
  title            TEXT NOT NULL,
  url              TEXT NOT NULL,
  image            TEXT,
  category         TEXT,
  rank             INTEGER DEFAULT 999,
  region           TEXT DEFAULT 'JP',
  updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

CREATE INDEX IF NOT EXISTS idx_popular_rank ON popular_products(region, rank);

-- レビュー
CREATE TABLE IF NOT EXISTS customer_reviews (
  review_id        TEXT PRIMARY KEY,
  customer_id      TEXT REFERENCES customers(customer_id) ON DELETE SET NULL,
  email            TEXT,
  shopify_order_id TEXT,
  shopify_product_id TEXT,
  product_title    TEXT,
  rating           INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
  comment          TEXT,
  is_published     INTEGER DEFAULT 0,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

CREATE INDEX IF NOT EXISTS idx_reviews_customer ON customer_reviews(customer_id);
CREATE INDEX IF NOT EXISTS idx_reviews_product ON customer_reviews(shopify_product_id);
CREATE INDEX IF NOT EXISTS idx_reviews_published ON customer_reviews(is_published, created_at DESC);

-- SMS 送信ログ
CREATE TABLE IF NOT EXISTS sms_logs (
  log_id           TEXT PRIMARY KEY,
  to_phone         TEXT NOT NULL,
  customer_id      TEXT REFERENCES customers(customer_id) ON DELETE SET NULL,
  campaign_id      TEXT REFERENCES email_campaigns(campaign_id) ON DELETE SET NULL,
  body             TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'queued',
  twilio_sid       TEXT,
  error_message    TEXT,
  queued_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  sent_at          TEXT
);

CREATE INDEX IF NOT EXISTS idx_sms_customer ON sms_logs(customer_id);
CREATE INDEX IF NOT EXISTS idx_sms_status ON sms_logs(status);
