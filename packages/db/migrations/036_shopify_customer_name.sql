-- ============================================================
-- 036_shopify_customer_name.sql
-- Shopify 注文に customer_name（氏名）カラム追加 + マッチング用インデックス
-- ============================================================

-- shopify_orders に customer_name（氏名）を追加
ALTER TABLE shopify_orders ADD COLUMN customer_name TEXT;

-- マッチング用インデックス
CREATE INDEX IF NOT EXISTS idx_shopify_orders_customer_name ON shopify_orders(customer_name);

-- 未マッチ注文数 可視化のためのインデックス
CREATE INDEX IF NOT EXISTS idx_shopify_orders_friend_id_null ON shopify_orders(friend_id) WHERE friend_id IS NULL;
