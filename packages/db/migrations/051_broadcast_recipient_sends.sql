-- 051_broadcast_recipient_sends.sql
-- LINE一斉配信の同日重複除外用に、送信成功済みの line_user_id を記録する。

CREATE TABLE IF NOT EXISTS broadcast_recipient_sends (
  id              TEXT PRIMARY KEY,
  broadcast_id    TEXT NOT NULL,
  line_user_id    TEXT NOT NULL,
  line_account_id TEXT,
  sent_date       TEXT NOT NULL,
  sent_at         TEXT NOT NULL,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  UNIQUE (broadcast_id, line_user_id)
);

CREATE INDEX IF NOT EXISTS idx_broadcast_recipient_sends_date_account_user
  ON broadcast_recipient_sends (sent_date, line_account_id, line_user_id);
