-- ============================================
-- FERMENT Phase 5: エンタープライズ機能
-- Migration: 025
-- ============================================

-- 5-A1: 二重オプトイン
ALTER TABLE customers ADD COLUMN double_optin_token TEXT;
ALTER TABLE customers ADD COLUMN double_optin_confirmed_at TEXT;
ALTER TABLE customers ADD COLUMN double_optin_sent_at TEXT;
-- subscribed_email = 0 と confirmed_at IS NULL で「未確認」状態

-- 5-A2: 権限管理（既存 staff の role を活用、ferment 専用権限を追加）
CREATE TABLE IF NOT EXISTS ferment_role_permissions (
  role          TEXT PRIMARY KEY,
  -- JSON: { templates: 'edit', campaigns: 'send', forms: 'view', ... }
  permissions   TEXT NOT NULL DEFAULT '{}',
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);
INSERT OR IGNORE INTO ferment_role_permissions (role, permissions) VALUES
  ('owner',  '{"templates":"edit","campaigns":"send","forms":"edit","segments":"edit","reviews":"manage","analytics":"view","settings":"edit"}'),
  ('admin',  '{"templates":"edit","campaigns":"send","forms":"edit","segments":"edit","reviews":"manage","analytics":"view"}'),
  ('staff',  '{"templates":"view","campaigns":"draft","forms":"view","segments":"view","reviews":"view","analytics":"view"}');

-- 5-A6: フロー Webhook アクション・マルチパス
ALTER TABLE email_flow_steps ADD COLUMN action_type TEXT DEFAULT 'send_email';
-- send_email / send_sms / wait / branch / webhook / add_tag / remove_tag
ALTER TABLE email_flow_steps ADD COLUMN action_config TEXT DEFAULT '{}';
ALTER TABLE email_flow_steps ADD COLUMN parent_step_id TEXT;
ALTER TABLE email_flow_steps ADD COLUMN branch_label TEXT;

-- 5-A7: 変更履歴・バージョン管理
CREATE TABLE IF NOT EXISTS ferment_version_history (
  version_id    TEXT PRIMARY KEY,
  entity_type   TEXT NOT NULL,
  entity_id     TEXT NOT NULL,
  version_num   INTEGER NOT NULL,
  snapshot      TEXT NOT NULL,
  changed_by    TEXT,
  change_note   TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);
CREATE INDEX IF NOT EXISTS idx_version_entity ON ferment_version_history(entity_type, entity_id, version_num DESC);

-- 5-A9: Profile-Centric Triggers のためのフロー入会条件
ALTER TABLE email_flows ADD COLUMN profile_filter TEXT;
-- JSON セグメントルール（同じ DSL）

-- 5-B10: Churn Risk Score
ALTER TABLE customers ADD COLUMN churn_risk_score REAL DEFAULT 0;
ALTER TABLE customers ADD COLUMN churn_risk_updated_at TEXT;

-- 5-B11: AI Subject Line Assistant 学習用
CREATE TABLE IF NOT EXISTS subject_line_history (
  id            TEXT PRIMARY KEY,
  subject       TEXT NOT NULL,
  total_sent    INTEGER NOT NULL DEFAULT 0,
  total_opened  INTEGER NOT NULL DEFAULT 0,
  open_rate     REAL DEFAULT 0,
  campaign_id   TEXT,
  recorded_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);
CREATE INDEX IF NOT EXISTS idx_subject_open_rate ON subject_line_history(open_rate DESC);

-- 5-B13: ブランドキット
CREATE TABLE IF NOT EXISTS ferment_brand_kit (
  brand_id      TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  primary_color TEXT NOT NULL DEFAULT '#225533',
  accent_color  TEXT NOT NULL DEFAULT '#C8DCC8',
  text_color    TEXT NOT NULL DEFAULT '#333333',
  bg_color      TEXT NOT NULL DEFAULT '#fafaf7',
  font_family   TEXT NOT NULL DEFAULT '-apple-system, sans-serif',
  logo_url      TEXT,
  is_default    INTEGER DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);
INSERT OR IGNORE INTO ferment_brand_kit (brand_id, name, primary_color, accent_color, is_default)
  VALUES ('brand_oryzae_default', 'オリゼ ブランド', '#225533', '#C8DCC8', 1);

-- 5-B14: スケジュール配信レポート
CREATE TABLE IF NOT EXISTS ferment_scheduled_reports (
  report_id     TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  recipient_email TEXT NOT NULL,
  schedule_cron TEXT NOT NULL DEFAULT '0 9 * * 1', -- 毎週月曜9時
  report_type   TEXT NOT NULL DEFAULT 'weekly_summary',
  is_active     INTEGER DEFAULT 1,
  last_sent_at  TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

-- 5-C: フォーム拡張（A/Bテスト・URL/デバイス制御・頻度制御）
ALTER TABLE ferment_forms ADD COLUMN url_match_pattern TEXT;
ALTER TABLE ferment_forms ADD COLUMN device_filter TEXT DEFAULT 'all';
-- all / mobile / desktop / tablet
ALTER TABLE ferment_forms ADD COLUMN show_frequency_days INTEGER DEFAULT 7;
ALTER TABLE ferment_forms ADD COLUMN ab_variant_b_config TEXT;

-- 5-C コンプライアンス
CREATE TABLE IF NOT EXISTS gdpr_deletion_requests (
  request_id    TEXT PRIMARY KEY,
  email         TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending',
  -- pending / processing / completed / rejected
  reason        TEXT,
  requested_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  processed_at  TEXT
);

CREATE TABLE IF NOT EXISTS ferment_audit_log (
  audit_id      TEXT PRIMARY KEY,
  user_id       TEXT,
  user_name     TEXT,
  action        TEXT NOT NULL,
  entity_type   TEXT,
  entity_id     TEXT,
  details       TEXT,
  ip_address    TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);
CREATE INDEX IF NOT EXISTS idx_audit_user ON ferment_audit_log(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON ferment_audit_log(entity_type, entity_id, created_at DESC);

-- データ保持期間設定
CREATE TABLE IF NOT EXISTS ferment_data_retention_policy (
  policy_id     TEXT PRIMARY KEY DEFAULT 'default',
  email_logs_retention_days INTEGER DEFAULT 730,
  inactive_customer_purge_days INTEGER DEFAULT 0,  -- 0 = しない
  audit_log_retention_days INTEGER DEFAULT 365,
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);
INSERT OR IGNORE INTO ferment_data_retention_policy (policy_id) VALUES ('default');

-- 5-C コメント機能（テンプレ・キャンペーンへのコメント）
CREATE TABLE IF NOT EXISTS ferment_comments (
  comment_id    TEXT PRIMARY KEY,
  entity_type   TEXT NOT NULL,
  entity_id     TEXT NOT NULL,
  user_name     TEXT,
  body          TEXT NOT NULL,
  resolved      INTEGER DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);
CREATE INDEX IF NOT EXISTS idx_comments_entity ON ferment_comments(entity_type, entity_id);

-- 5-C 動的画像 (商品レコメンドで使用)
ALTER TABLE customer_product_affinity ADD COLUMN dynamic_banner_url TEXT;

-- 5-C キャンペーン承認ワークフロー
ALTER TABLE email_campaigns ADD COLUMN approval_status TEXT DEFAULT 'none';
-- none / pending / approved / rejected
ALTER TABLE email_campaigns ADD COLUMN approved_by TEXT;
ALTER TABLE email_campaigns ADD COLUMN approved_at TEXT;
