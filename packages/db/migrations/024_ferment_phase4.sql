-- ============================================
-- FERMENT Phase 4: 高度機能完成 + 差別化 + UX
-- Migration: 024
-- ============================================

-- 4-B 9: Smart Send Frequency 用カラム
ALTER TABLE customers ADD COLUMN last_email_sent_at TEXT;
ALTER TABLE customers ADD COLUMN weekly_email_count INTEGER DEFAULT 0;
ALTER TABLE customers ADD COLUMN weekly_count_reset_at TEXT;
ALTER TABLE customers ADD COLUMN max_emails_per_week INTEGER DEFAULT 3;

-- 4-B 6: 収益貢献分析 用カラム
ALTER TABLE email_logs ADD COLUMN attributed_revenue INTEGER DEFAULT 0;
ALTER TABLE email_logs ADD COLUMN attributed_order_id TEXT;
ALTER TABLE email_logs ADD COLUMN attributed_at TEXT;

-- email_campaigns に総収益貢献カラム追加
ALTER TABLE email_campaigns ADD COLUMN total_attributed_revenue INTEGER DEFAULT 0;
ALTER TABLE email_campaigns ADD COLUMN total_attributed_orders INTEGER DEFAULT 0;

-- 4-A 5: 配信スケジュール（best_send_hour 用キュー）
CREATE TABLE IF NOT EXISTS scheduled_email_sends (
  scheduled_id     TEXT PRIMARY KEY,
  campaign_id      TEXT REFERENCES email_campaigns(campaign_id) ON DELETE CASCADE,
  customer_id      TEXT NOT NULL REFERENCES customers(customer_id) ON DELETE CASCADE,
  template_id      TEXT,
  variant_id       TEXT,
  scheduled_at     TEXT NOT NULL,
  sent_at          TEXT,
  status           TEXT NOT NULL DEFAULT 'pending',
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

CREATE INDEX IF NOT EXISTS idx_scheduled_status ON scheduled_email_sends(status, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_scheduled_customer ON scheduled_email_sends(customer_id);

-- 4-C 13: フォーム拡張：exit-intent / 多段階トリガー
ALTER TABLE ferment_forms ADD COLUMN trigger_type TEXT DEFAULT 'time_delay';
-- trigger_type: 'time_delay' (既定3秒), 'exit_intent', 'scroll_depth', 'manual'
ALTER TABLE ferment_forms ADD COLUMN trigger_value INTEGER DEFAULT 3000;
-- time_delay: ms, scroll_depth: % (例 50)
ALTER TABLE ferment_forms ADD COLUMN form_steps TEXT DEFAULT '[]';
-- 多段階フォーム用 JSON

-- 4-A 1: A/B テスト統合（campaign 全体を A/B 化）
ALTER TABLE email_campaigns ADD COLUMN ab_test_enabled INTEGER DEFAULT 0;
ALTER TABLE email_campaigns ADD COLUMN ab_test_sample_pct INTEGER DEFAULT 20;
ALTER TABLE email_campaigns ADD COLUMN ab_test_winner_metric TEXT DEFAULT 'open_rate';
ALTER TABLE email_campaigns ADD COLUMN ab_test_decided_at TEXT;
ALTER TABLE email_campaigns ADD COLUMN ab_test_winner_variant TEXT;

-- 4-C 14: スパムスコア事前チェック
ALTER TABLE email_templates ADD COLUMN spam_score REAL;
ALTER TABLE email_templates ADD COLUMN spam_warnings TEXT;
ALTER TABLE email_templates ADD COLUMN spam_checked_at TEXT;

-- 4-A 4: カートリマインドの送信ステート
ALTER TABLE customer_cart_states ADD COLUMN reminder_status TEXT DEFAULT 'pending';
-- pending / first_sent / second_sent / final_sent / recovered

-- インデックス
CREATE INDEX IF NOT EXISTS idx_customers_created_month ON customers(substr(created_at, 1, 7));
CREATE INDEX IF NOT EXISTS idx_email_logs_attributed_order ON email_logs(attributed_order_id);
CREATE INDEX IF NOT EXISTS idx_cart_reminder_status ON customer_cart_states(reminder_status);
