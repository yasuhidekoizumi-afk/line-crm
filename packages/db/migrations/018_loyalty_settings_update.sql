-- 会員登録ボーナスをどこポイ設定値に合わせて更新
UPDATE loyalty_settings SET value = '300', updated_at = datetime('now') WHERE key = 'registration_bonus';

-- 有効期限（日数）を設定可能に追加
INSERT OR IGNORE INTO loyalty_settings (key, value, label, updated_at)
VALUES ('expiry_days', '365', '有効期限（日数）', datetime('now'));
