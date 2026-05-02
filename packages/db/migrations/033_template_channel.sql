-- ============================================
-- templates + email_templates: チャネル区分の明確化
-- Migration: 033
-- 作成日: 2026-05-01
-- 説明: email_templates に channel カラムを追加して一貫性を持たせる
-- 注意: データ形式が根本的に異なるためテーブル統合は行わない
-- ============================================

ALTER TABLE email_templates ADD COLUMN channel TEXT NOT NULL DEFAULT 'email';
