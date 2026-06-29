-- 誕生日クーポン配信ログの状態管理を追加
-- 043適用済みDBへの互換migration。LINE配信の成功・失敗を区別する。

ALTER TABLE birthday_coupon_log ADD COLUMN status TEXT NOT NULL DEFAULT 'sent';
ALTER TABLE birthday_coupon_log ADD COLUMN error_message TEXT;

CREATE INDEX IF NOT EXISTS idx_birthday_coupon_log_status ON birthday_coupon_log (status);
