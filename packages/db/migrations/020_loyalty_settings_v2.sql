-- Migration 020: どこポイ互換設定フラグを追加
-- yen_only: 日本円（JPY）以外の注文はポイント付与をスキップ
-- order_metafield_enabled: 注文メタフィールドに付与/利用ポイントを保存
-- customer_metafield_enabled: 顧客メタフィールドに保有ポイントを保存
-- subscription_points_enabled: サブスクリプション注文にもポイントを付与するか

INSERT OR IGNORE INTO loyalty_settings (key, value) VALUES ('yen_only', '1');
INSERT OR IGNORE INTO loyalty_settings (key, value) VALUES ('order_metafield_enabled', '1');
INSERT OR IGNORE INTO loyalty_settings (key, value) VALUES ('customer_metafield_enabled', '0');
INSERT OR IGNORE INTO loyalty_settings (key, value) VALUES ('subscription_points_enabled', '1');
