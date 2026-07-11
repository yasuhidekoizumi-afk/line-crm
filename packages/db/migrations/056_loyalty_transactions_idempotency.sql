-- ============================================================
-- Migration 056: loyalty_transactions に冪等キーとメタデータを追加
--
-- 用途: Judge.me レビュー投稿の webhook 受信時に、
--       同じレビューを二重処理しないようにする。
--       また、review_id / product_handle / rating 等の
--       メタデータを JSON で保存し、後続の分析に使う。
-- ============================================================

ALTER TABLE loyalty_transactions ADD COLUMN idempotency_key TEXT;
ALTER TABLE loyalty_transactions ADD COLUMN metadata TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_loyalty_tx_idempotency
  ON loyalty_transactions (idempotency_key)
  WHERE idempotency_key IS NOT NULL;
