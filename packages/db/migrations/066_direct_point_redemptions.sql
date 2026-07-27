-- カートで選択したポイント利用の予約。
-- ポイント残高は注文確定Webhookでのみ減算するため、未購入で残高が消えない。
CREATE TABLE IF NOT EXISTS loyalty_redemption_reservations (
  id TEXT PRIMARY KEY,
  friend_id TEXT NOT NULL REFERENCES friends (id) ON DELETE CASCADE,
  shopify_customer_id TEXT NOT NULL,
  shopify_discount_code TEXT NOT NULL UNIQUE,
  points INTEGER NOT NULL CHECK (points > 0 AND points % 100 = 0),
  discount_amount INTEGER NOT NULL CHECK (discount_amount > 0),
  status TEXT NOT NULL CHECK (status IN ('active', 'consuming', 'consumed', 'cancelled', 'failed')) DEFAULT 'active',
  order_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  consumed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_loyalty_redemption_reservations_friend_status
  ON loyalty_redemption_reservations (friend_id, status);
CREATE INDEX IF NOT EXISTS idx_loyalty_redemption_reservations_code
  ON loyalty_redemption_reservations (shopify_discount_code);
CREATE UNIQUE INDEX IF NOT EXISTS idx_loyalty_redemption_one_active_per_friend
  ON loyalty_redemption_reservations (friend_id)
  WHERE status IN ('active', 'consuming');
