-- ============================================
-- broadcasts: 複数メッセージ対応 (message_type='multi')
-- Migration: 040
-- 作成日: 2026-06-10
-- 説明:
--   message_type の CHECK を ('text','image','flex','multi') に拡張する。
--   'multi' のとき message_content は [{type,content,altText?}, ...] のJSON配列
--   （最大5件: LINE Messaging API 仕様）。
--   既存の 'text'/'image'/'flex' レコードはそのまま動作する（後方互換）。
--   SQLite は CHECK 制約の ALTER 不可のためテーブル再作成。
-- ============================================

-- Step 1: 既存テーブルをリネーム
ALTER TABLE broadcasts RENAME TO broadcasts_old;

-- Step 2: 新CHECK制約でテーブルを再作成
CREATE TABLE IF NOT EXISTS broadcasts (
  id              TEXT PRIMARY KEY,
  title           TEXT NOT NULL,
  message_type    TEXT NOT NULL CHECK (message_type IN ('text', 'image', 'flex', 'multi')),
  message_content TEXT NOT NULL,
  target_type     TEXT NOT NULL CHECK (target_type IN ('all', 'tag', 'segment', 'individual')) DEFAULT 'all',
  target_tag_id   TEXT REFERENCES tags (id) ON DELETE SET NULL,
  target_segment_id TEXT REFERENCES segments(segment_id) ON DELETE SET NULL,
  target_friend_ids TEXT,
  status          TEXT NOT NULL CHECK (status IN ('draft', 'scheduled', 'sending', 'sent')) DEFAULT 'draft',
  scheduled_at    TEXT,
  sent_at         TEXT,
  total_count     INTEGER NOT NULL DEFAULT 0,
  success_count   INTEGER NOT NULL DEFAULT 0,
  failed_count    INTEGER NOT NULL DEFAULT 0,
  error_summary   TEXT,
  line_account_id TEXT,
  alt_text        TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

-- Step 3: 既存データを移行（failed_count/error_summary は本番DBに無い可能性があるため
--          カラム指定で除外し、新テーブル側の DEFAULT/NULL を利用する。）
INSERT INTO broadcasts (
  id, title, message_type, message_content, target_type, target_tag_id,
  target_segment_id, target_friend_ids, status, scheduled_at, sent_at,
  total_count, success_count, line_account_id, alt_text, created_at
)
SELECT
  id, title, message_type, message_content, target_type, target_tag_id,
  target_segment_id, target_friend_ids, status, scheduled_at, sent_at,
  total_count, success_count, line_account_id, alt_text, created_at
FROM broadcasts_old;

-- Step 4: インデックス再作成
CREATE INDEX IF NOT EXISTS idx_broadcasts_status ON broadcasts (status);

-- Step 5: 旧テーブル削除
DROP TABLE broadcasts_old;
