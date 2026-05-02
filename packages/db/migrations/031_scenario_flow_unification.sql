-- ============================================
-- scenarios + email_flows 統合: クロスチャネルフロー対応
-- Migration: 031
-- 作成日: 2026-05-01
-- 説明: email_flow_steps を拡張して LINE メッセージも保持できるようにする
--   - channel: 'email' or 'line' で配信チャネルを指定
--   - message_type, message_content: LINEメッセージ用（scenario_steps から移植）
--   - condition_type, condition_value, next_step_on_false: 条件分岐（scenario_steps から移植）
--   - line_account_id: マルチアカウント対応
-- ============================================

-- email_flow_steps にクロスチャネル対応カラムを追加
ALTER TABLE email_flow_steps ADD COLUMN channel TEXT NOT NULL DEFAULT 'email';
ALTER TABLE email_flow_steps ADD COLUMN message_type TEXT;
ALTER TABLE email_flow_steps ADD COLUMN message_content TEXT;
ALTER TABLE email_flow_steps ADD COLUMN condition_type TEXT;
ALTER TABLE email_flow_steps ADD COLUMN condition_value TEXT;
ALTER TABLE email_flow_steps ADD COLUMN next_step_on_false TEXT;
ALTER TABLE email_flow_steps ADD COLUMN action_type TEXT NOT NULL DEFAULT 'send_email';

-- email_flows にマルチアカウント対応
ALTER TABLE email_flows ADD COLUMN line_account_id TEXT;
