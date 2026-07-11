-- ============================================================
-- Migration 057: reward_items に購入履歴必須フラグを追加
-- ノベルティ交換時に購入実績（total_spent > 0）を要求するため
-- ============================================================

ALTER TABLE reward_items ADD COLUMN requires_purchase_history INTEGER NOT NULL DEFAULT 0;
