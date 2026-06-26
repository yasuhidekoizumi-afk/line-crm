-- ============================================
-- 全 message_type CHECK 制約に 'imagemap' を追加
-- Migration: 047
-- 作成日: 2026-06-25
-- 説明:
--   公式LINEでいう「リッチメッセージ」(LINE Messaging API の imagemap message) を
--   broadcasts / scenario_steps / reminder_steps / templates の各テーブルで保存できるよう、
--   message_type の CHECK 制約に 'imagemap' を追加する。
--   既存タイプ ('text','image','flex','multi','carousel') はそのまま動作する（後方互換）。
--   SQLite は CHECK 制約の ALTER 不可のため、各テーブルを再作成する（040/041 パターン踏襲）。
--
--   保存形式: message_type='imagemap' のとき、message_content は
--     { baseUrl, altText, baseSize: {width, height}, actions: [...] }
--   の JSON 文字列。Worker 側で parse して LINE API へそのまま転送する。
-- ============================================

-- =============================================
-- broadcasts: 'text','image','flex','multi','imagemap'
-- =============================================
ALTER TABLE broadcasts RENAME TO broadcasts_old;

CREATE TABLE IF NOT EXISTS broadcasts (
  id              TEXT PRIMARY KEY,
  title           TEXT NOT NULL,
  message_type    TEXT NOT NULL CHECK (message_type IN ('text', 'image', 'flex', 'multi', 'imagemap')),
  message_content TEXT NOT NULL,
  target_type     TEXT NOT NULL CHECK (target_type IN ('all', 'tag', 'segment', 'individual')) DEFAULT 'all',
  target_tag_id   TEXT REFERENCES tags (id) ON DELETE SET NULL,
  target_segment_id TEXT REFERENCES segments(segment_id) ON DELETE SET NULL,
  target_friend_ids TEXT,
  status          TEXT NOT NULL CHECK (status IN ('draft', 'scheduled', 'sending', 'sent')) DEFAULT 'draft',
  scheduled_at    TEXT,
  sent_at         TEXT,
  total_count     INTEGER NOT NULL DEFAULT 0,
  success_count   INTEGER NOT NULL DEFAULT 0,
  failed_count    INTEGER NOT NULL DEFAULT 0,
  error_summary   TEXT,
  line_account_id TEXT,
  alt_text        TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

INSERT INTO broadcasts (
  id, title, message_type, message_content, target_type, target_tag_id,
  target_segment_id, target_friend_ids, status, scheduled_at, sent_at,
  total_count, success_count, line_account_id, alt_text, created_at
)
SELECT
  id, title, message_type, message_content, target_type, target_tag_id,
  target_segment_id, target_friend_ids, status, scheduled_at, sent_at,
  total_count, success_count, line_account_id, alt_text, created_at
FROM broadcasts_old;

CREATE INDEX IF NOT EXISTS idx_broadcasts_status ON broadcasts (status);

DROP TABLE broadcasts_old;

-- =============================================
-- templates: 'text','image','flex','carousel','multi','imagemap'
-- =============================================
ALTER TABLE templates RENAME TO templates_old;

CREATE TABLE IF NOT EXISTS templates (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  category        TEXT NOT NULL DEFAULT 'general',
  message_type    TEXT NOT NULL CHECK (message_type IN ('text', 'image', 'flex', 'carousel', 'multi', 'imagemap')),
  message_content TEXT NOT NULL,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

INSERT INTO templates (id, name, category, message_type, message_content, created_at, updated_at)
SELECT id, name, category, message_type, message_content, created_at, updated_at
FROM templates_old;

CREATE INDEX IF NOT EXISTS idx_templates_category ON templates (category);

DROP TABLE templates_old;

-- =============================================
-- scenario_steps: 'text','image','flex','imagemap'
-- =============================================
ALTER TABLE scenario_steps RENAME TO scenario_steps_old;

CREATE TABLE IF NOT EXISTS scenario_steps (
  id              TEXT PRIMARY KEY,
  scenario_id     TEXT NOT NULL REFERENCES scenarios (id) ON DELETE CASCADE,
  step_order      INTEGER NOT NULL,
  delay_minutes   INTEGER NOT NULL DEFAULT 0,
  message_type    TEXT NOT NULL CHECK (message_type IN ('text', 'image', 'flex', 'imagemap')),
  message_content TEXT NOT NULL,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  UNIQUE (scenario_id, step_order)
);

INSERT INTO scenario_steps (id, scenario_id, step_order, delay_minutes, message_type, message_content, created_at)
SELECT id, scenario_id, step_order, delay_minutes, message_type, message_content, created_at
FROM scenario_steps_old;

CREATE INDEX IF NOT EXISTS idx_scenario_steps_scenario_id ON scenario_steps (scenario_id);

DROP TABLE scenario_steps_old;

-- =============================================
-- reminder_steps: 'text','image','flex','imagemap'
-- =============================================
ALTER TABLE reminder_steps RENAME TO reminder_steps_old;

CREATE TABLE IF NOT EXISTS reminder_steps (
  id              TEXT PRIMARY KEY,
  reminder_id     TEXT NOT NULL REFERENCES reminders (id) ON DELETE CASCADE,
  offset_minutes  INTEGER NOT NULL,
  message_type    TEXT NOT NULL CHECK (message_type IN ('text', 'image', 'flex', 'imagemap')),
  message_content TEXT NOT NULL,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

INSERT INTO reminder_steps (id, reminder_id, offset_minutes, message_type, message_content, created_at)
SELECT id, reminder_id, offset_minutes, message_type, message_content, created_at
FROM reminder_steps_old;

CREATE INDEX IF NOT EXISTS idx_reminder_steps_reminder ON reminder_steps (reminder_id);

DROP TABLE reminder_steps_old;
