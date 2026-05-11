-- ============================================================
-- Round 39: loyalty_points に limited_balance を追加
-- 通常ポイント（balance）と期間限定ポイント（limited_balance）を分離
-- ============================================================

ALTER TABLE loyalty_points ADD COLUMN limited_balance INTEGER NOT NULL DEFAULT 0;
ALTER TABLE loyalty_points ADD COLUMN limited_expires_at TEXT;

-- 既存のポイントは全て通常ポイントとして残る（limited_balance = 0）
-- 今後キャンペーン経由で付与された上乗せ分が limited_balance に入る
