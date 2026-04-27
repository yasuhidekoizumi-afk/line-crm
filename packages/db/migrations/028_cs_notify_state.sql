-- CS draft backlog notification cooldown state.
-- Single-row table (id=1). Prevents the */5 min cron from spamming Slack
-- when the backlog stays the same.
CREATE TABLE IF NOT EXISTS cs_notify_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  last_notified_at TEXT NOT NULL,
  last_count INTEGER NOT NULL
);
