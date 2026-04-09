-- ポイント交換アイテムテーブル
CREATE TABLE IF NOT EXISTS reward_items (
  id               TEXT    PRIMARY KEY,
  name             TEXT    NOT NULL,
  description      TEXT,
  image_url        TEXT,
  required_points  INTEGER NOT NULL DEFAULT 0,
  status           TEXT    NOT NULL DEFAULT 'draft',   -- 'active' | 'draft'
  track_inventory  INTEGER NOT NULL DEFAULT 0,          -- 0=false, 1=true
  stock            INTEGER,                             -- NULL=無制限
  requires_shipping INTEGER NOT NULL DEFAULT 0,         -- 0=false, 1=true
  created_at       TEXT    NOT NULL,
  updated_at       TEXT    NOT NULL
);

-- 交換履歴テーブル
CREATE TABLE IF NOT EXISTS reward_exchanges (
  id                 TEXT    PRIMARY KEY,
  friend_id          TEXT    NOT NULL,
  reward_item_id     TEXT    NOT NULL,
  reward_item_name   TEXT    NOT NULL,
  points_spent       INTEGER NOT NULL,
  status             TEXT    NOT NULL DEFAULT 'pending', -- 'pending' | 'fulfilled' | 'cancelled'
  shopify_customer_id TEXT,
  notes              TEXT,
  created_at         TEXT    NOT NULL,
  updated_at         TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_reward_exchanges_friend_id ON reward_exchanges (friend_id);
CREATE INDEX IF NOT EXISTS idx_reward_exchanges_status    ON reward_exchanges (status);
