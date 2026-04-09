-- ============================================================
-- Round 5: ロイヤルティポイント有効期限管理
-- ============================================================

-- expires_at: award トランザクションの有効期限（付与から1年）
ALTER TABLE loyalty_transactions ADD COLUMN expires_at TEXT;

-- source_tx_id: expire トランザクションが参照する award の id（冪等性担保）
ALTER TABLE loyalty_transactions ADD COLUMN source_tx_id TEXT;

-- 既存の award トランザクションに expires_at をバックフィル（付与日 + 1年）
UPDATE loyalty_transactions
SET expires_at = replace(datetime(substr(created_at, 1, 19), '+1 year'), ' ', 'T') || '.000+09:00'
WHERE type = 'award' AND expires_at IS NULL;

-- インデックス
CREATE INDEX IF NOT EXISTS idx_loyalty_tx_expires ON loyalty_transactions (expires_at);
CREATE INDEX IF NOT EXISTS idx_loyalty_tx_source ON loyalty_transactions (source_tx_id);
