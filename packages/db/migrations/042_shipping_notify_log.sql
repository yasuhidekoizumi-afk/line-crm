-- ============================================================
-- 発送LINE通知（Phase 1）
--   注文が発送(orders/fulfilled)されたら、LINE連携済みの顧客へ
--   追跡リンク付きで「発送しました」をLINE送信する機能。
-- ============================================================

-- 重複送信防止ログ（1注文につき1回だけ通知する）
CREATE TABLE IF NOT EXISTS shipping_notify_log (
  order_id        TEXT PRIMARY KEY,
  friend_id       TEXT,
  line_user_id    TEXT,
  tracking_number TEXT,
  sent_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

-- 機能フラグ（既定OFF=0。動作確認後に1へ）
INSERT OR IGNORE INTO loyalty_settings (key, value, label, updated_at) VALUES
  ('shipping_line_notify_enabled', '0', '発送LINE通知の有効化（1=ON / 0=OFF）', datetime('now'));
