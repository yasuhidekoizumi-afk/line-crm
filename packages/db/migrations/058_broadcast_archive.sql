-- 058: 一斉配信一覧のアーカイブ表示
--
-- 配信履歴は削除せず残す。通常一覧から片付けるための archived_at を追加する。

ALTER TABLE broadcasts ADD COLUMN archived_at TEXT;

CREATE INDEX IF NOT EXISTS idx_broadcasts_archived_at ON broadcasts (archived_at);
