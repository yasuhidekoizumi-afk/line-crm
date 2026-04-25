-- ============================================
-- FERMENT: Email Marketing Extension
-- Migration: 021
-- 作成日: 2026-04-24
-- 説明: LINE × メール統合マーケティング基盤のテーブル追加
-- ============================================

-- ============================================================
-- 統合顧客マスタ（LINE × メール × Shopify 統合）
-- ============================================================
CREATE TABLE IF NOT EXISTS customers (
  customer_id           TEXT PRIMARY KEY,            -- cu_xxxxx (プレフィックス付きUUID)
  email                 TEXT UNIQUE,
  line_user_id          TEXT UNIQUE,                 -- friends.line_user_id と対応
  shopify_customer_id_jp TEXT,
  shopify_customer_id_us TEXT,
  display_name          TEXT,
  region                TEXT DEFAULT 'JP',           -- 'JP' or 'US'
  language              TEXT DEFAULT 'ja',           -- 'ja' or 'en'
  ltv                   INTEGER DEFAULT 0,           -- 累計購入額（税抜、円 or USD cents）
  ltv_currency          TEXT DEFAULT 'JPY',
  order_count           INTEGER DEFAULT 0,
  first_order_at        TEXT,
  last_order_at         TEXT,
  avg_order_value       INTEGER DEFAULT 0,
  preferred_products    TEXT,                        -- JSON array
  tags                  TEXT,                        -- JSON array e.g. ["VIP","first_time"]
  subscribed_email      INTEGER DEFAULT 1,           -- boolean (0/1)
  subscribed_line       INTEGER DEFAULT 1,
  email_bounced         INTEGER DEFAULT 0,
  email_verified_at     TEXT,
  source                TEXT,                        -- 初回獲得チャネル
  notes                 TEXT,
  created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);
CREATE INDEX IF NOT EXISTS idx_customers_email       ON customers(email);
CREATE INDEX IF NOT EXISTS idx_customers_line        ON customers(line_user_id);
CREATE INDEX IF NOT EXISTS idx_customers_shopify_jp  ON customers(shopify_customer_id_jp);
CREATE INDEX IF NOT EXISTS idx_customers_shopify_us  ON customers(shopify_customer_id_us);
CREATE INDEX IF NOT EXISTS idx_customers_region      ON customers(region);
CREATE INDEX IF NOT EXISTS idx_customers_last_order  ON customers(last_order_at);

-- ============================================================
-- 行動イベント（全チャネル共通）
-- ============================================================
-- event_type 一覧:
--   page_viewed, product_viewed, cart_added, cart_abandoned,
--   checkout_started, order_placed, order_fulfilled,
--   email_sent, email_opened, email_clicked, email_bounced, email_unsubscribed,
--   line_sent, line_delivered, line_opened, line_clicked,
--   subscribed, unsubscribed, tag_added, tag_removed
CREATE TABLE IF NOT EXISTS events (
  event_id     TEXT PRIMARY KEY,                    -- ev_xxxxx
  customer_id  TEXT,
  event_type   TEXT NOT NULL,
  source       TEXT,                                -- 'shopify_jp','shopify_us','rakuten','amazon','line','email','manual'
  properties   TEXT,                                -- JSON
  occurred_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  FOREIGN KEY (customer_id) REFERENCES customers(customer_id)
);
CREATE INDEX IF NOT EXISTS idx_events_customer   ON events(customer_id);
CREATE INDEX IF NOT EXISTS idx_events_type       ON events(event_type);
CREATE INDEX IF NOT EXISTS idx_events_occurred   ON events(occurred_at);

-- ============================================================
-- メールテンプレート
-- ============================================================
CREATE TABLE IF NOT EXISTS email_templates (
  template_id       TEXT PRIMARY KEY,               -- tpl_xxxxx
  name              TEXT NOT NULL,
  category          TEXT,                           -- 'welcome','cart','winback','newsletter','transactional'
  language          TEXT DEFAULT 'ja',
  subject_base      TEXT,                           -- 基本件名（AI置換のベース）
  preheader_base    TEXT,
  body_html         TEXT,                           -- HTML 本文（{{placeholder}} 対応）
  body_text         TEXT,                           -- プレーンテキスト版
  ai_system_prompt  TEXT,                           -- Claude への system prompt
  ai_enabled        INTEGER DEFAULT 0,              -- AI パーソナライズ有効フラグ
  from_name         TEXT DEFAULT 'オリゼ',
  from_email        TEXT,
  reply_to          TEXT,
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

-- ============================================================
-- メールキャンペーン（一斉配信）
-- ============================================================
CREATE TABLE IF NOT EXISTS email_campaigns (
  campaign_id     TEXT PRIMARY KEY,                 -- cmp_xxxxx
  name            TEXT NOT NULL,
  template_id     TEXT,
  segment_id      TEXT,                             -- ターゲットセグメント
  status          TEXT DEFAULT 'draft',             -- draft | scheduled | sending | sent | failed | canceled
  scheduled_at    TEXT,
  sent_at         TEXT,
  variant_config  TEXT,                             -- A/B テスト設定 JSON
  total_targets   INTEGER DEFAULT 0,
  total_sent      INTEGER DEFAULT 0,
  total_opened    INTEGER DEFAULT 0,
  total_clicked   INTEGER DEFAULT 0,
  total_bounced   INTEGER DEFAULT 0,
  total_converted INTEGER DEFAULT 0,
  total_revenue   INTEGER DEFAULT 0,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  FOREIGN KEY (template_id) REFERENCES email_templates(template_id)
);
CREATE INDEX IF NOT EXISTS idx_campaigns_status    ON email_campaigns(status);
CREATE INDEX IF NOT EXISTS idx_campaigns_scheduled ON email_campaigns(scheduled_at);

-- ============================================================
-- メールフロー（ステップ配信）
-- ============================================================
CREATE TABLE IF NOT EXISTS email_flows (
  flow_id        TEXT PRIMARY KEY,                  -- flw_xxxxx
  name           TEXT NOT NULL,
  description    TEXT,
  trigger_type   TEXT,                              -- 'event' | 'segment_enter' | 'manual'
  trigger_config TEXT,                              -- JSON
  is_active      INTEGER DEFAULT 0,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

-- ============================================================
-- フロー内のステップ
-- ============================================================
CREATE TABLE IF NOT EXISTS email_flow_steps (
  step_id       TEXT PRIMARY KEY,                   -- stp_xxxxx
  flow_id       TEXT NOT NULL,
  step_order    INTEGER NOT NULL,
  delay_hours   INTEGER DEFAULT 0,                  -- 前ステップからの遅延（時間）
  template_id   TEXT,
  condition     TEXT,                               -- 条件スキップ用 JSON
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  FOREIGN KEY (flow_id) REFERENCES email_flows(flow_id),
  FOREIGN KEY (template_id) REFERENCES email_templates(template_id)
);
CREATE INDEX IF NOT EXISTS idx_flow_steps_flow ON email_flow_steps(flow_id, step_order);

-- ============================================================
-- 顧客ごとのフロー進行管理
-- ============================================================
CREATE TABLE IF NOT EXISTS email_flow_enrollments (
  enrollment_id    TEXT PRIMARY KEY,                -- enr_xxxxx
  flow_id          TEXT NOT NULL,
  customer_id      TEXT NOT NULL,
  current_step     INTEGER DEFAULT 0,
  status           TEXT DEFAULT 'active',           -- active | completed | canceled
  enrolled_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  next_send_at     TEXT,
  completed_at     TEXT,
  FOREIGN KEY (flow_id) REFERENCES email_flows(flow_id),
  FOREIGN KEY (customer_id) REFERENCES customers(customer_id)
);
CREATE INDEX IF NOT EXISTS idx_enrollments_next_send ON email_flow_enrollments(next_send_at, status);
CREATE INDEX IF NOT EXISTS idx_enrollments_customer  ON email_flow_enrollments(customer_id);

-- ============================================================
-- セグメント定義（LINE × メール共通）
-- ============================================================
CREATE TABLE IF NOT EXISTS segments (
  segment_id      TEXT PRIMARY KEY,                 -- seg_xxxxx
  name            TEXT NOT NULL,
  description     TEXT,
  rules           TEXT NOT NULL DEFAULT '{}',       -- JSON: 条件式
  channel_scope   TEXT DEFAULT 'all',               -- 'email' | 'line' | 'all'
  customer_count  INTEGER DEFAULT 0,
  last_computed_at TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

-- ============================================================
-- セグメントのメンバー（スナップショット）
-- ============================================================
CREATE TABLE IF NOT EXISTS segment_members (
  segment_id  TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  added_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  PRIMARY KEY (segment_id, customer_id),
  FOREIGN KEY (segment_id) REFERENCES segments(segment_id),
  FOREIGN KEY (customer_id) REFERENCES customers(customer_id)
);
CREATE INDEX IF NOT EXISTS idx_segment_members_customer ON segment_members(customer_id);

-- ============================================================
-- メール配信ログ（1通ごと）
-- ============================================================
CREATE TABLE IF NOT EXISTS email_logs (
  log_id          TEXT PRIMARY KEY,                 -- log_xxxxx
  customer_id     TEXT,
  campaign_id     TEXT,                             -- 一斉配信の場合
  flow_id         TEXT,                             -- フロー配信の場合
  step_id         TEXT,
  template_id     TEXT,
  to_email        TEXT NOT NULL,
  subject         TEXT,
  body_html       TEXT,                             -- 実際に送った本文（AI生成結果保存）
  variant         TEXT,                             -- A/B テストのバリアント名
  resend_id       TEXT,                             -- Resend API が返す ID
  status          TEXT DEFAULT 'queued',            -- queued | sent | delivered | opened | clicked | bounced | failed
  queued_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  sent_at         TEXT,
  delivered_at    TEXT,
  opened_at       TEXT,
  first_clicked_at TEXT,
  bounced_at      TEXT,
  unsubscribed_at TEXT,
  converted_at    TEXT,
  revenue         INTEGER DEFAULT 0,
  error_message   TEXT,
  FOREIGN KEY (customer_id) REFERENCES customers(customer_id)
);
CREATE INDEX IF NOT EXISTS idx_email_logs_customer  ON email_logs(customer_id);
CREATE INDEX IF NOT EXISTS idx_email_logs_campaign  ON email_logs(campaign_id);
CREATE INDEX IF NOT EXISTS idx_email_logs_status    ON email_logs(status);
CREATE INDEX IF NOT EXISTS idx_email_logs_sent      ON email_logs(sent_at);
CREATE INDEX IF NOT EXISTS idx_email_logs_resend_id ON email_logs(resend_id);

-- ============================================================
-- 配信停止管理
-- ============================================================
CREATE TABLE IF NOT EXISTS email_suppressions (
  email         TEXT PRIMARY KEY,
  reason        TEXT,                               -- 'unsubscribed' | 'bounced' | 'complained' | 'manual'
  suppressed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  notes         TEXT
);
