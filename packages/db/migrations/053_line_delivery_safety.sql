-- LINE配信事故の検知・停止用ログ

CREATE TABLE IF NOT EXISTS line_follow_events (
  id TEXT PRIMARY KEY,
  line_user_id TEXT NOT NULL,
  line_account_id TEXT,
  friend_id TEXT,
  event_type TEXT NOT NULL CHECK (event_type IN ('follow', 'unfollow')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

CREATE INDEX IF NOT EXISTS idx_line_follow_events_account_time
  ON line_follow_events (line_account_id, created_at);

CREATE INDEX IF NOT EXISTS idx_line_follow_events_type_time
  ON line_follow_events (event_type, created_at);

CREATE TABLE IF NOT EXISTS system_flags (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);
