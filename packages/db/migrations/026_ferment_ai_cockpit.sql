-- ============================================
-- FERMENT AI コックピット (Phase B-1)
-- Migration: 026
-- ============================================

-- AI 戦略提案の日次キャッシュ
CREATE TABLE IF NOT EXISTS ai_strategy_proposals (
  proposal_id   TEXT PRIMARY KEY,
  date          TEXT NOT NULL,                -- YYYY-MM-DD
  proposals     TEXT NOT NULL,                -- JSON: TOP 3 アクション
  warnings      TEXT,                         -- JSON: 警告リスト
  data_snapshot TEXT,                         -- JSON: 元データのスナップショット
  ai_model      TEXT NOT NULL,
  ai_cost_usd   REAL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_strategy_date ON ai_strategy_proposals(date);

-- 提案の採用追跡
CREATE TABLE IF NOT EXISTS ai_proposal_actions (
  action_id     TEXT PRIMARY KEY,
  proposal_id   TEXT NOT NULL,
  rank          INTEGER NOT NULL,
  status        TEXT NOT NULL DEFAULT 'proposed',
  -- proposed / approved / executed / rejected / edited
  approved_by   TEXT,
  campaign_id   TEXT,
  decided_at    TEXT,
  outcome       TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);
CREATE INDEX IF NOT EXISTS idx_proposal_actions_proposal ON ai_proposal_actions(proposal_id);
CREATE INDEX IF NOT EXISTS idx_proposal_actions_status ON ai_proposal_actions(status);

-- AI チャット履歴
CREATE TABLE IF NOT EXISTS ai_chat_history (
  chat_id       TEXT PRIMARY KEY,
  user_id       TEXT,
  user_name     TEXT,
  user_message  TEXT NOT NULL,
  ai_response   TEXT NOT NULL,
  ai_model      TEXT NOT NULL,
  ai_cost_usd   REAL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);
CREATE INDEX IF NOT EXISTS idx_chat_user ON ai_chat_history(user_id, created_at DESC);

-- 異常検知ログ
CREATE TABLE IF NOT EXISTS ai_anomaly_alerts (
  alert_id      TEXT PRIMARY KEY,
  alert_type    TEXT NOT NULL,
  -- open_rate_drop / bounce_spike / cost_overrun / cron_stuck / unsubscribe_spike
  severity      TEXT NOT NULL,
  -- info / warning / critical
  message       TEXT NOT NULL,
  metric_value  REAL,
  threshold     REAL,
  resolved      INTEGER DEFAULT 0,
  notified_slack INTEGER DEFAULT 0,
  detected_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  resolved_at   TEXT
);
CREATE INDEX IF NOT EXISTS idx_anomaly_type_time ON ai_anomaly_alerts(alert_type, detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_anomaly_unresolved ON ai_anomaly_alerts(resolved, detected_at DESC);

-- 週次振り返り保存
CREATE TABLE IF NOT EXISTS ai_weekly_reports (
  report_id     TEXT PRIMARY KEY,
  week_start    TEXT NOT NULL,
  week_end      TEXT NOT NULL,
  summary       TEXT NOT NULL,
  metrics_json  TEXT,
  ai_model      TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_weekly_start ON ai_weekly_reports(week_start);

-- AI コスト・利用状況の日次集計
CREATE TABLE IF NOT EXISTS ai_usage_stats (
  date          TEXT PRIMARY KEY,            -- YYYY-MM-DD
  strategy_calls INTEGER DEFAULT 0,
  chat_calls    INTEGER DEFAULT 0,
  subject_calls INTEGER DEFAULT 0,
  body_calls    INTEGER DEFAULT 0,
  total_cost_usd REAL DEFAULT 0,
  budget_alert_sent INTEGER DEFAULT 0
);

-- Kill Switch（一時停止フラグ）
CREATE TABLE IF NOT EXISTS ai_kill_switch (
  scope         TEXT PRIMARY KEY,
  -- all / strategy / chat / cron
  enabled       INTEGER NOT NULL DEFAULT 0,
  reason        TEXT,
  enabled_by    TEXT,
  enabled_at    TEXT,
  disabled_at   TEXT
);
INSERT OR IGNORE INTO ai_kill_switch (scope, enabled) VALUES ('all', 0), ('strategy', 0), ('chat', 0), ('cron', 0);
