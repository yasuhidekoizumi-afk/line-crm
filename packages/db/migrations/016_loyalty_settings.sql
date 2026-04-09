-- ============================================================
-- Round 6: ロイヤルティ設定テーブル
-- ============================================================

CREATE TABLE IF NOT EXISTS loyalty_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  label      TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- デフォルト値を挿入
INSERT OR IGNORE INTO loyalty_settings (key, value, label, updated_at) VALUES
  ('point_rate',         '0.01', 'ポイント還元率（例: 0.01 = 1%）',          datetime('now')),
  ('point_value',        '1',    'ポイント価値（1pt = N円）',                  datetime('now')),
  ('registration_bonus', '0',    '新規会員登録ボーナス（0=無効, 付与ポイント数）', datetime('now'));
