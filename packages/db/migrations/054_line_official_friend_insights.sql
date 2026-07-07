-- LINE公式アカウントマネージャーの友だちInsight日次値

CREATE TABLE IF NOT EXISTS line_official_friend_insights (
  id TEXT PRIMARY KEY,
  line_account_id TEXT NOT NULL REFERENCES line_accounts (id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  followers INTEGER,
  targeted_reaches INTEGER,
  blocks INTEGER,
  status TEXT NOT NULL,
  fetched_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  UNIQUE (line_account_id, date)
);

CREATE INDEX IF NOT EXISTS idx_line_official_friend_insights_account_date
  ON line_official_friend_insights (line_account_id, date DESC);
