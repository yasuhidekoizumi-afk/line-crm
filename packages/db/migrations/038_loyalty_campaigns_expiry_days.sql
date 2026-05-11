-- ============================================================
-- Round 38: loyalty_campaigns に expiry_days 追加
-- キャンペーンごとに期間限定ポイントの期限を設定可能に
-- NULL = グローバル設定（loyalty_settings の expiry_days）を使用
-- ============================================================

ALTER TABLE loyalty_campaigns ADD COLUMN expiry_days INTEGER;

-- 既存のキャンペーンは expiry_days = NULL（グローバル設定に従う）
-- 新しいキャンペーン作成時に UI から設定可能
