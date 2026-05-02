-- ============================================
-- broadcasts + segments 連携: LINE一斉配信でFERMENTセグメントをターゲットに指定可能に
-- Migration: 034
-- 作成日: 2026-05-02
-- 説明:
--   1. broadcasts に target_segment_id カラム追加
--   2. target_type の CHECK 制約を ('all','tag','segment') に拡張
--      （SQLite は ALTER TABLE での CHECK 変更不可 → テーブル再作成）
-- ============================================

-- Step 1: 既存テーブルの名前を変更
ALTER TABLE broadcasts RENAME TO broadcasts_old;

-- Step 2: 新しい制約でテーブルを再作成
CREATE TABLE IF NOT EXISTS broadcasts (
  id              TEXT PRIMARY KEY,
  title           TEXT NOT NULL,
  message_type    TEXT NOT NULL CHECK (message_type IN ('text', 'image', 'flex')),
  message_content TEXT NOT NULL,
  target_type     TEXT NOT NULL CHECK (target_type IN ('all', 'tag', 'segment')) DEFAULT 'all',
  target_tag_id   TEXT REFERENCES tags (id) ON DELETE SET NULL,
  target_segment_id TEXT REFERENCES segments(segment_id) ON DELETE SET NULL,
  status          TEXT NOT NULL CHECK (status IN ('draft', 'scheduled', 'sending', 'sent')) DEFAULT 'draft',
  scheduled_at    TEXT,
  sent_at         TEXT,
  total_count     INTEGER NOT NULL DEFAULT 0,
  success_count   INTEGER NOT NULL DEFAULT 0,
  line_account_id TEXT,
  alt_text        TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

-- Step 3: 既存データを移行
INSERT INTO broadcasts (
  id, title, message_type, message_content, target_type, target_tag_id, 
  target_segment_id, status, scheduled_at, sent_at, total_count, success_count,
  line_account_id, alt_text, created_at
)
SELECT 
  id, title, message_type, message_content, target_type, target_tag_id,
  NULL, status, scheduled_at, sent_at, total_count, success_count,
  line_account_id, alt_text, created_at
FROM broadcasts_old;

-- Step 4: インデックスを再作成
CREATE INDEX IF NOT EXISTS idx_broadcasts_status ON broadcasts (status);

-- Step 5: 旧テーブルを削除
DROP TABLE broadcasts_old;
