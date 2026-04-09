-- ============================================================
-- Round 4: ロイヤルティポイント管理
-- ============================================================

CREATE TABLE IF NOT EXISTS loyalty_points (
  id              TEXT PRIMARY KEY,
  friend_id       TEXT NOT NULL REFERENCES friends (id) ON DELETE CASCADE,
  balance         INTEGER NOT NULL DEFAULT 0,
  total_spent     INTEGER NOT NULL DEFAULT 0,
  rank            TEXT NOT NULL DEFAULT 'レギュラー' CHECK (rank IN ('レギュラー', 'シルバー', 'ゴールド', 'プラチナ', 'ダイヤモンド')),
  shopify_customer_id TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  UNIQUE (friend_id)
);

CREATE INDEX IF NOT EXISTS idx_loyalty_points_friend ON loyalty_points (friend_id);
CREATE INDEX IF NOT EXISTS idx_loyalty_points_rank ON loyalty_points (rank);
CREATE INDEX IF NOT EXISTS idx_loyalty_points_shopify ON loyalty_points (shopify_customer_id);

CREATE TABLE IF NOT EXISTS loyalty_transactions (
  id          TEXT PRIMARY KEY,
  friend_id   TEXT NOT NULL REFERENCES friends (id) ON DELETE CASCADE,
  type        TEXT NOT NULL CHECK (type IN ('award', 'redeem', 'adjust', 'expire')),
  points      INTEGER NOT NULL,
  balance_after INTEGER NOT NULL,
  reason      TEXT,
  order_id    TEXT,
  staff_id    TEXT REFERENCES staff_members (id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

CREATE INDEX IF NOT EXISTS idx_loyalty_tx_friend ON loyalty_transactions (friend_id);
CREATE INDEX IF NOT EXISTS idx_loyalty_tx_created ON loyalty_transactions (created_at);
CREATE INDEX IF NOT EXISTS idx_loyalty_tx_type ON loyalty_transactions (type);
