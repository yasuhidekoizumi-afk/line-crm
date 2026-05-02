-- ============================================
-- broadcasts + email_campaigns 統合: クロスチャネル一斉配信対応
-- Migration: 032
-- 作成日: 2026-05-01
-- 説明: email_campaigns を拡張して LINE 一斉配信も保持できるようにする
-- ============================================

-- email_campaigns にクロスチャネル対応カラムを追加
ALTER TABLE email_campaigns ADD COLUMN channel TEXT NOT NULL DEFAULT 'email';
ALTER TABLE email_campaigns ADD COLUMN message_type TEXT;
ALTER TABLE email_campaigns ADD COLUMN message_content TEXT;
ALTER TABLE email_campaigns ADD COLUMN target_type TEXT DEFAULT 'all';
ALTER TABLE email_campaigns ADD COLUMN target_tag_id TEXT REFERENCES tags(id) ON DELETE SET NULL;
ALTER TABLE email_campaigns ADD COLUMN line_account_id TEXT;
ALTER TABLE email_campaigns ADD COLUMN alt_text TEXT;
