-- 067_customer_matching_audit.sql
-- 顧客同定（customer matching）の監査カラム追加。
--
-- 背景: F1顧客 35,748人中 25,618人が friend_id=NULL（LINE配信が届かない）。
-- 同定方法ごとの信頼度を保存し、低信頼マッチは自動確定せず確認対象にする。
--
-- match_source の値:
--   'shopify_customer_id' : loyalty_points.shopify_customer_id 経由（信頼度高）
--   'friend_direct'       : shopify_orders.friend_id 直接（信頼度高）
--   'customer_join'       : customers.shopify_customer_id_jp 経由（信頼度高）
--   'email'               : メール一致（信頼度中）
--   'phone'               : 電話一致（信頼度中）
--   'name'                : 氏名一致（信頼度低・要確認）
--   NULL                  : 未同定

ALTER TABLE customer_journey ADD COLUMN match_source TEXT;
ALTER TABLE customer_journey ADD COLUMN match_confirmed_at TEXT;

CREATE INDEX IF NOT EXISTS idx_journey_match_source ON customer_journey(match_source);
CREATE INDEX IF NOT EXISTS idx_journey_null_friend ON customer_journey(shopify_customer_id) WHERE friend_id IS NULL;
