-- ============================================
-- チャット v2: 最終メッセージの意図分類（要確認候補の抽出）
-- Migration: 073
-- 設計書: docs/CHATS_V2_DESIGN.md §6
--
-- 背景: LINE公式アカウント管理画面で返信している運用では Messaging API から
-- 「自分が送った返信」を取得できない。未読数・経過日数は返信状況を表さないため、
-- 顧客の最終メッセージの意図（要返信 / お礼・締め / 判断不能）を保存して候補を絞る。
-- ============================================

ALTER TABLE chats ADD COLUMN ai_intent TEXT;
  -- 'needs_reply' | 'closing' | 'unclear'
ALTER TABLE chats ADD COLUMN ai_intent_reason TEXT;
ALTER TABLE chats ADD COLUMN ai_intent_at TEXT;

CREATE INDEX IF NOT EXISTS idx_chats_ai_intent ON chats(ai_intent);
