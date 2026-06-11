-- ============================================
-- templates: 複数メッセージ対応 (message_type='multi')
-- Migration: 041
-- 作成日: 2026-06-11
-- 説明:
--   一斉配信(broadcasts)と同じく、テンプレートでも複数メッセージブロックを
--   保存できるよう message_type の CHECK を ('text','image','flex','carousel','multi')
--   に拡張する。'multi' のとき message_content は [{type,content,altText?}, ...]
--   の JSON 配列（最大5件・LINE Messaging API 仕様）。
--   既存の単一タイプはそのまま動作する（後方互換）。
--   SQLite は CHECK 制約の ALTER 不可のためテーブル再作成。
-- ============================================

-- Step 1: 既存テーブルをリネーム
ALTER TABLE templates RENAME TO templates_old;

-- Step 2: 新CHECK制約でテーブルを再作成
CREATE TABLE IF NOT EXISTS templates (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  category        TEXT NOT NULL DEFAULT 'general',
  message_type    TEXT NOT NULL CHECK (message_type IN ('text', 'image', 'flex', 'carousel', 'multi')),
  message_content TEXT NOT NULL,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

-- Step 3: 既存データを移行
INSERT INTO templates (id, name, category, message_type, message_content, created_at, updated_at)
SELECT id, name, category, message_type, message_content, created_at, updated_at
FROM templates_old;

-- Step 4: 旧テーブル削除
DROP TABLE templates_old;
