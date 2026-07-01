-- ============================================
-- ORYZAEポイント制度 7月先行検証ログ
-- Migration: 052
-- 作成日: 2026-07-01
-- 説明:
--   2026年7月の「毎月のおすそわけポイント」「いつもありがとうポイント」
--   先行検証に必要な、対象者固定・holdout・二重付与防止・通知追跡用の
--   監査ログを追加する。
--
--   既存の loyalty_transactions は残高変更の事実を記録する台帳。
--   この migration では、その前段の「誰を対象にしたか」「なぜ付与/非付与に
--   したか」「通知できたか」を campaign_key 単位で追えるようにする。
-- ============================================

CREATE TABLE IF NOT EXISTS loyalty_campaign_grants (
  id                     TEXT PRIMARY KEY,
  campaign_key           TEXT NOT NULL,
  customer_id            TEXT REFERENCES customers (customer_id) ON DELETE SET NULL,
  friend_id              TEXT REFERENCES friends (id) ON DELETE SET NULL,
  line_user_id            TEXT NOT NULL,
  shopify_customer_id     TEXT NOT NULL,
  segment                TEXT NOT NULL,
  points                 INTEGER NOT NULL DEFAULT 0,
  expires_at             TEXT,
  idempotency_key         TEXT NOT NULL UNIQUE,
  source_event_id         TEXT NOT NULL,
  holdout                INTEGER NOT NULL DEFAULT 0,
  status                 TEXT NOT NULL DEFAULT 'planned'
                         CHECK (status IN ('planned', 'awarded', 'skipped', 'failed')),
  loyalty_transaction_id TEXT REFERENCES loyalty_transactions (id) ON DELETE SET NULL,
  reason                 TEXT,
  error                  TEXT,
  created_by             TEXT NOT NULL DEFAULT 'system',
  created_at             TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at             TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

CREATE INDEX IF NOT EXISTS idx_loyalty_campaign_grants_campaign
  ON loyalty_campaign_grants (campaign_key);

CREATE INDEX IF NOT EXISTS idx_loyalty_campaign_grants_customer
  ON loyalty_campaign_grants (customer_id);

CREATE INDEX IF NOT EXISTS idx_loyalty_campaign_grants_friend
  ON loyalty_campaign_grants (friend_id);

CREATE INDEX IF NOT EXISTS idx_loyalty_campaign_grants_line
  ON loyalty_campaign_grants (line_user_id);

CREATE INDEX IF NOT EXISTS idx_loyalty_campaign_grants_shopify
  ON loyalty_campaign_grants (shopify_customer_id);

CREATE INDEX IF NOT EXISTS idx_loyalty_campaign_grants_segment
  ON loyalty_campaign_grants (segment);

CREATE INDEX IF NOT EXISTS idx_loyalty_campaign_grants_status
  ON loyalty_campaign_grants (status);

CREATE INDEX IF NOT EXISTS idx_loyalty_campaign_grants_holdout
  ON loyalty_campaign_grants (campaign_key, holdout);

CREATE TABLE IF NOT EXISTS loyalty_campaign_notifications (
  id                TEXT PRIMARY KEY,
  grant_id          TEXT REFERENCES loyalty_campaign_grants (id) ON DELETE CASCADE,
  campaign_key      TEXT NOT NULL,
  customer_id       TEXT REFERENCES customers (customer_id) ON DELETE SET NULL,
  friend_id         TEXT REFERENCES friends (id) ON DELETE SET NULL,
  line_user_id       TEXT NOT NULL,
  notification_type TEXT NOT NULL
                    CHECK (notification_type IN ('award', 'expiry_reminder')),
  status            TEXT NOT NULL DEFAULT 'planned'
                    CHECK (status IN ('planned', 'sent', 'skipped', 'failed')),
  scheduled_at      TEXT,
  sent_at           TEXT,
  error             TEXT,
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

CREATE INDEX IF NOT EXISTS idx_loyalty_campaign_notifications_campaign
  ON loyalty_campaign_notifications (campaign_key);

CREATE INDEX IF NOT EXISTS idx_loyalty_campaign_notifications_grant
  ON loyalty_campaign_notifications (grant_id);

CREATE INDEX IF NOT EXISTS idx_loyalty_campaign_notifications_customer
  ON loyalty_campaign_notifications (customer_id);

CREATE INDEX IF NOT EXISTS idx_loyalty_campaign_notifications_line
  ON loyalty_campaign_notifications (line_user_id);

CREATE INDEX IF NOT EXISTS idx_loyalty_campaign_notifications_status
  ON loyalty_campaign_notifications (status);

CREATE INDEX IF NOT EXISTS idx_loyalty_campaign_notifications_schedule
  ON loyalty_campaign_notifications (notification_type, scheduled_at, status);
