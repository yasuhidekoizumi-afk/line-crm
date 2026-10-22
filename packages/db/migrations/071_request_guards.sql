-- 顧客向けAPIの列挙・総当たり対策カウンタ（IP単位・1分窓）
-- in-memory ではisolateをまたぐと効かないため、D1に永続化する。
CREATE TABLE IF NOT EXISTS request_guards (
  key          TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  count        INTEGER NOT NULL DEFAULT 0,
  customer_ids TEXT NOT NULL DEFAULT ''
);
