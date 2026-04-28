-- ============================================================
-- 029_customer_journey.sql
-- 顧客ジャーニー集約テーブル（Phase 2: 2回目購入フック効果測定の基盤）
--
-- 目的:
--   - shopify_orders から派生して「顧客ごとの初回〜2回目購入」の旅路を1行で持つ
--   - レギュラー → シルバー昇格率（=2回目購入率）が真のKPI（Discovery で判明）
--   - 日次バッチで recompute 可能（顧客追加・LINE連携状態変化に追随）
-- ============================================================

CREATE TABLE IF NOT EXISTS customer_journey (
  shopify_customer_id        TEXT PRIMARY KEY,
  customer_id                TEXT,                          -- FERMENT customers.customer_id
  friend_id                  TEXT,                          -- LINE-CRM friends.id

  -- 初回購入
  first_order_at             TEXT NOT NULL,                 -- ISO8601
  first_order_id             TEXT NOT NULL,
  first_order_value          REAL NOT NULL,
  first_was_line_linked      INTEGER NOT NULL DEFAULT 0,    -- 初回購入時点でLINE連携済みだったか

  -- 2回目購入（NULL なら未到達）
  second_order_at            TEXT,
  second_order_id            TEXT,
  second_order_value         REAL,
  days_to_second             INTEGER,                       -- first_order から second_order までの日数
  second_was_line_linked     INTEGER,                       -- 2回目時点でLINE連携済みだったか

  -- 累計
  total_orders               INTEGER NOT NULL DEFAULT 1,
  total_revenue              REAL NOT NULL DEFAULT 0,

  -- 現状
  is_currently_line_linked   INTEGER NOT NULL DEFAULT 0,
  current_loyalty_rank       TEXT,                          -- ダイヤモンド/プラチナ/ゴールド/シルバー/レギュラー/null

  -- コホート（=初回購入月、'2025-04' 形式）
  cohort_month               TEXT NOT NULL,

  computed_at                TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

CREATE INDEX IF NOT EXISTS idx_journey_first_order  ON customer_journey(first_order_at);
CREATE INDEX IF NOT EXISTS idx_journey_cohort       ON customer_journey(cohort_month);
CREATE INDEX IF NOT EXISTS idx_journey_friend       ON customer_journey(friend_id);
CREATE INDEX IF NOT EXISTS idx_journey_second       ON customer_journey(second_order_at);
CREATE INDEX IF NOT EXISTS idx_journey_rank         ON customer_journey(current_loyalty_rank);
CREATE INDEX IF NOT EXISTS idx_journey_line_linked  ON customer_journey(is_currently_line_linked);
