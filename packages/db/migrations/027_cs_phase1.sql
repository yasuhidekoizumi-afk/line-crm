-- ============================================
-- CS Phase 1: 統合受信箱 + AIトリアージ
-- Migration: 027
-- 設計書: docs/CS_PHASE1_DESIGN.md
-- ============================================

-- chats拡張: チャネル・AI状態
ALTER TABLE chats ADD COLUMN channel TEXT NOT NULL DEFAULT 'line';
  -- 'line' | 'email_support' | 'email_customer_support'
ALTER TABLE chats ADD COLUMN external_thread_id TEXT;
  -- Gmailスレッド識別子（メールの場合）
ALTER TABLE chats ADD COLUMN customer_email TEXT;
ALTER TABLE chats ADD COLUMN ai_status TEXT;
  -- 'pending' | 'l1_auto_replied' | 'l2_draft_pending' | 'l2_approved'
  -- | 'l3_escalated' | 'human_handled' | 'resolved'
ALTER TABLE chats ADD COLUMN ai_category TEXT;
  -- 'faq' | 'order_status' | 'refund' | 'complaint' | 'product_question' | 'other'
ALTER TABLE chats ADD COLUMN ai_confidence REAL;
ALTER TABLE chats ADD COLUMN ai_money_flag INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_chats_channel ON chats(channel);
CREATE INDEX IF NOT EXISTS idx_chats_ai_status ON chats(ai_status);
CREATE INDEX IF NOT EXISTS idx_chats_external_thread ON chats(external_thread_id);

-- メッセージ拡張用テーブル（chatsに紐付くCS固有メッセージ）
-- LINE側はmessages_logを使い続ける。Email側はここに格納しchat_idで束ねる。
CREATE TABLE IF NOT EXISTS cs_messages (
  id              TEXT PRIMARY KEY,
  chat_id         TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  channel         TEXT NOT NULL,           -- 'line' | 'email'
  direction       TEXT NOT NULL CHECK (direction IN ('incoming', 'outgoing')),
  external_id     TEXT,                    -- GmailメッセージID等
  from_address    TEXT,
  to_address      TEXT,
  subject         TEXT,
  body_text       TEXT NOT NULL,
  body_html       TEXT,
  raw_metadata    TEXT,                    -- JSON: ヘッダー等
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);
CREATE INDEX IF NOT EXISTS idx_cs_messages_chat ON cs_messages(chat_id);
CREATE INDEX IF NOT EXISTS idx_cs_messages_external ON cs_messages(external_id);
CREATE INDEX IF NOT EXISTS idx_cs_messages_created ON cs_messages(created_at DESC);

-- AI下書き（L2承認キュー）
CREATE TABLE IF NOT EXISTS ai_drafts (
  id              TEXT PRIMARY KEY,
  chat_id         TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  message_id      TEXT NOT NULL,           -- cs_messages.id or messages_log.id
  draft_text      TEXT NOT NULL,
  draft_metadata  TEXT,                    -- JSON: 参照FAQ・カテゴリ・confidence
  status          TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'edited', 'rejected', 'sent')),
  approved_by     TEXT REFERENCES staff_members(id) ON DELETE SET NULL,
  approved_at     TEXT,
  final_text      TEXT,
  rejection_reason TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);
CREATE INDEX IF NOT EXISTS idx_ai_drafts_chat ON ai_drafts(chat_id);
CREATE INDEX IF NOT EXISTS idx_ai_drafts_status ON ai_drafts(status);

-- 顧客名寄せ（LINE friend ↔ メール ↔ Shopify顧客）
CREATE TABLE IF NOT EXISTS customer_links (
  id                  TEXT PRIMARY KEY,
  line_friend_id      TEXT,
  email               TEXT,
  shopify_customer_id TEXT,
  freee_partner_id    TEXT,
  display_name        TEXT,
  notes               TEXT,
  created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_links_line ON customer_links(line_friend_id) WHERE line_friend_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_links_email ON customer_links(email) WHERE email IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_links_shopify ON customer_links(shopify_customer_id) WHERE shopify_customer_id IS NOT NULL;

-- FAQ知識ベース（Sheets同期）
CREATE TABLE IF NOT EXISTS faq_entries (
  id              TEXT PRIMARY KEY,
  category        TEXT NOT NULL,
  question        TEXT NOT NULL,
  answer          TEXT NOT NULL,
  keywords        TEXT,                    -- カンマ区切り
  l1_eligible     INTEGER NOT NULL DEFAULT 0,
  active          INTEGER NOT NULL DEFAULT 1,
  source_row      INTEGER,
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);
CREATE INDEX IF NOT EXISTS idx_faq_active ON faq_entries(active, l1_eligible);
CREATE INDEX IF NOT EXISTS idx_faq_category ON faq_entries(category);

-- AI判定ログ（精度モニタリング）
CREATE TABLE IF NOT EXISTS ai_decision_log (
  id              TEXT PRIMARY KEY,
  chat_id         TEXT NOT NULL,
  message_id      TEXT NOT NULL,
  level           TEXT NOT NULL CHECK (level IN ('L1', 'L2', 'L3')),
  category        TEXT,
  confidence      REAL,
  matched_faq_id  TEXT,
  money_flag      INTEGER NOT NULL DEFAULT 0,
  prompt_tokens   INTEGER,
  completion_tokens INTEGER,
  cost_jpy        REAL,
  outcome         TEXT,                    -- auto_sent / approved / edited / rejected / escalated
  outcome_at      TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);
CREATE INDEX IF NOT EXISTS idx_ai_decision_chat ON ai_decision_log(chat_id);
CREATE INDEX IF NOT EXISTS idx_ai_decision_created ON ai_decision_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_decision_level ON ai_decision_log(level);

-- Gmail watch状態管理（cron再登録用）
CREATE TABLE IF NOT EXISTS gmail_watch_state (
  email_address   TEXT PRIMARY KEY,
  history_id      TEXT,
  expiration      TEXT,
  last_renewed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);
