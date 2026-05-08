-- 035_performance_indexes.sql
-- チャット・メッセージのパフォーマンス改善インデックス追加

-- messages_log: friend_id + created_at 複合インデックス（WHERE friend_id= ORDER BY created_at をカバー）
CREATE INDEX IF NOT EXISTS idx_messages_log_friend_created ON messages_log (friend_id, created_at);

-- chats: last_message_at インデックス（ORDER BY last_message_at DESC を高速化）
CREATE INDEX IF NOT EXISTS idx_chats_last_message_at ON chats (last_message_at);

-- chats: channel インデックス（channelフィルター高速化）
CREATE INDEX IF NOT EXISTS idx_chats_channel ON chats (channel);
