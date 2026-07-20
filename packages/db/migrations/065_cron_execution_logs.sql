CREATE TABLE IF NOT EXISTS cron_execution_logs (
  id TEXT PRIMARY KEY,
  job_name TEXT NOT NULL,
  trigger_source TEXT NOT NULL,
  cron_expression TEXT,
  status TEXT NOT NULL CHECK (status IN ('running', 'succeeded', 'failed')),
  error_message TEXT,
  started_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_cron_execution_logs_job_started
  ON cron_execution_logs(job_name, started_at DESC);
