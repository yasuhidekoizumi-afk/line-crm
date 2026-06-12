-- ============================================================
-- 誕生日クーポン自動配信
--   設計: docs/BIRTHDAY_TRIGGER_DESIGN.md / 文面: docs/BIRTHDAY_TRIGGER_MESSAGES_2026-06.md
--   仕様: 誕生日当日に、直近注文額 <5,000円→送料無料 / ≥5,000円→500円OFF を出し分け。
--         有効期限=誕生日+14日。年1回（冪等）。LINE連携済みへ配信。
--   ※本番有効化(birthday_coupon_enabled=1)＋cron結線は小泉さんOK後（設計書の保護ゾーン）。
-- ============================================================

-- 誕生日をD1に持つ（毎日Shopify全件走査を避けて軽くする）。YYYY-MM-DD。
ALTER TABLE loyalty_points ADD COLUMN birthday TEXT;
CREATE INDEX IF NOT EXISTS idx_loyalty_points_birthday ON loyalty_points (birthday);

-- 年1回の冪等ログ（同一顧客×同一年に二重発行/配信しない安全装置）
CREATE TABLE IF NOT EXISTS birthday_coupon_log (
  id                  TEXT PRIMARY KEY,
  shopify_customer_id TEXT NOT NULL,
  friend_id           TEXT,
  year                INTEGER NOT NULL,
  coupon_type         TEXT,        -- 'free_shipping' | 'fixed_500'
  code                TEXT,
  channel             TEXT,        -- 'line' | 'test'
  recent_amount       INTEGER,
  sent_at             TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  UNIQUE (shopify_customer_id, year)
);

-- 設定（既定 = 安全側）
--   birthday_coupon_enabled        : 緊急停止スイッチ。0=停止(既定) / 1=稼働
--   birthday_coupon_mode           : dryrun=予行演習(発行も送信もしない) / test=自分だけ / live=本番
--   birthday_coupon_test_recipient : テストモードの送り先 Shopify顧客ID（河原さん）
INSERT OR IGNORE INTO loyalty_settings (key, value, label, updated_at) VALUES
  ('birthday_coupon_enabled',        '0',             '誕生日クーポン自動配信の有効化（1=ON / 0=緊急停止）', datetime('now')),
  ('birthday_coupon_mode',           'dryrun',        '誕生日クーポンの動作モード（dryrun / test / live）',   datetime('now')),
  ('birthday_coupon_test_recipient', '5524849623199', 'テストモードの送り先 Shopify顧客ID（河原さん）',        datetime('now'));
