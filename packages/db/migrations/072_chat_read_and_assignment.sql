-- ============================================
-- チャット v2: 会話単位の既読位置 + 担当者
-- Migration: 072
-- 設計書: docs/CHATS_V2_DESIGN.md
-- ============================================

-- 既読位置。未読数 = max(last_read_at, スタッフ最終返信時刻) より後の受信メッセージ数
ALTER TABLE chats ADD COLUMN last_read_at TEXT;
-- 対応者（staff_members.id）。operators テーブルは0件で実質未使用のため staff を使う
ALTER TABLE chats ADD COLUMN assigned_staff_id TEXT;
ALTER TABLE chats ADD COLUMN assigned_at TEXT;

CREATE INDEX IF NOT EXISTS idx_chats_assigned ON chats(assigned_staff_id);
CREATE INDEX IF NOT EXISTS idx_messages_log_friend_created ON messages_log(friend_id, created_at DESC);
