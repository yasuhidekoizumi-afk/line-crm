-- ============================================================
-- 054_egift_pilot.sql
-- eGiftパイロット: 誕生日・記念日の友達にミニグラノーラギフトを贈る導線
--
-- 対象: LINE連携済み既存顧客（贈り主）→ 友達（受贈者）に無料ギフト
-- KGI: 受贈者の初回購入転換
-- 必須KPI: 受贈者のLINE友だち化
-- ============================================================

-- キャンペーン管理
CREATE TABLE IF NOT EXISTS egift_campaigns (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft', -- draft / active / paused / completed
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  daily_winner_limit INTEGER NOT NULL DEFAULT 10,
  total_gift_limit INTEGER,
  target_sku TEXT,
  target_product_id TEXT,
  target_variant_id TEXT,
  inventory_budget INTEGER,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

-- 贈り主の応募
CREATE TABLE IF NOT EXISTS egift_applications (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES egift_campaigns(id) ON DELETE CASCADE,
  giver_friend_id TEXT NOT NULL REFERENCES friends(id) ON DELETE CASCADE,
  occasion TEXT NOT NULL, -- birthday / anniversary / other
  message TEXT,
  status TEXT NOT NULL DEFAULT 'applied', -- applied / won / lost / cancelled
  lottery_weight REAL NOT NULL DEFAULT 1,
  applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  decided_at TEXT,
  UNIQUE(campaign_id, giver_friend_id)
);
CREATE INDEX IF NOT EXISTS idx_egift_applications_campaign ON egift_applications(campaign_id);
CREATE INDEX IF NOT EXISTS idx_egift_applications_giver ON egift_applications(giver_friend_id);
CREATE INDEX IF NOT EXISTS idx_egift_applications_status ON egift_applications(status);

-- 発行されたギフト
CREATE TABLE IF NOT EXISTS egift_gifts (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES egift_campaigns(id) ON DELETE CASCADE,
  application_id TEXT NOT NULL REFERENCES egift_applications(id) ON DELETE CASCADE,
  giver_friend_id TEXT NOT NULL REFERENCES friends(id) ON DELETE CASCADE,
  gift_token_hash TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'issued',
  -- issued / opened / line_added / redeemed / fulfilled / expired / cancelled
  issued_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  first_opened_at TEXT,
  line_added_at TEXT,
  redeemed_at TEXT,
  fulfilled_at TEXT,
  expires_at TEXT NOT NULL,
  redeem_expires_at TEXT NOT NULL,
  recipient_friend_id TEXT REFERENCES friends(id) ON DELETE SET NULL,
  recipient_email TEXT,
  recipient_phone_hash TEXT,
  recipient_name TEXT,
  recipient_zip TEXT,
  recipient_address TEXT,
  shopify_coupon_code TEXT,
  attributed_order_id TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);
CREATE INDEX IF NOT EXISTS idx_egift_gifts_campaign ON egift_gifts(campaign_id);
CREATE INDEX IF NOT EXISTS idx_egift_gifts_recipient_friend ON egift_gifts(recipient_friend_id);
CREATE INDEX IF NOT EXISTS idx_egift_gifts_status ON egift_gifts(status);
CREATE INDEX IF NOT EXISTS idx_egift_gifts_token_hash ON egift_gifts(gift_token_hash);

-- イベントログ（開封・友だち化・引換・初回購入 etc.）
CREATE TABLE IF NOT EXISTS egift_events (
  id TEXT PRIMARY KEY,
  gift_id TEXT NOT NULL REFERENCES egift_gifts(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  -- issued / opened / line_add_clicked / line_added / redeemed / fulfilled / first_purchase / expired / blocked
  friend_id TEXT REFERENCES friends(id) ON DELETE SET NULL,
  metadata TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);
CREATE INDEX IF NOT EXISTS idx_egift_events_gift ON egift_events(gift_id);
CREATE INDEX IF NOT EXISTS idx_egift_events_type ON egift_events(event_type);

-- 受贈者の購入記録（KGI計測用）
CREATE TABLE IF NOT EXISTS egift_recipient_purchases (
  id TEXT PRIMARY KEY,
  gift_id TEXT NOT NULL REFERENCES egift_gifts(id) ON DELETE CASCADE,
  recipient_friend_id TEXT REFERENCES friends(id) ON DELETE SET NULL,
  shopify_order_id TEXT NOT NULL,
  shopify_customer_id TEXT,
  is_first_order INTEGER NOT NULL DEFAULT 0,
  order_total REAL NOT NULL,
  gross_profit_estimate REAL,
  attribution_status TEXT NOT NULL DEFAULT 'eligible',
  -- eligible / excluded_affiliate / excluded_existing_customer / duplicate
  purchased_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  UNIQUE(gift_id, shopify_order_id)
);
CREATE INDEX IF NOT EXISTS idx_egift_purchases_gift ON egift_recipient_purchases(gift_id);
CREATE INDEX IF NOT EXISTS idx_egift_purchases_order ON egift_recipient_purchases(shopify_order_id);
