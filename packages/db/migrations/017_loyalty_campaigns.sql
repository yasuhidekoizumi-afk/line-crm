-- ============================================================
-- Round 7: ロイヤルティ キャンペーン（条件付与）
-- ============================================================

CREATE TABLE IF NOT EXISTS loyalty_campaigns (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT,
  status      TEXT NOT NULL DEFAULT 'draft', -- 'active' | 'draft'
  starts_at   TEXT,                           -- NULL = 無制限
  ends_at     TEXT,
  -- 条件（JSON 配列）
  -- 例: [{"type":"customer_tag","value":"ゴールド"},{"type":"product_tag","value":"granola"}]
  conditions  TEXT NOT NULL DEFAULT '[]',
  -- アクション
  action_type  TEXT NOT NULL DEFAULT 'rate_multiply', -- 'rate_multiply' | 'rate_add' | 'fixed_points'
  action_value REAL NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_loyalty_campaigns_status ON loyalty_campaigns (status);
