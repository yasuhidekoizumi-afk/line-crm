-- ============================================
-- 楽天 RMS WEB SERVICE 統合 (CS Phase 2)
-- Migration: 029
-- 設計書: docs/CS_RAKUTEN_RMS_DESIGN.md
-- ============================================

-- chats テーブルに 'rakuten' チャネルを許容（既に CHECK 制約は無いので追加不要）
-- channel カラムは TEXT のままで OK

-- 楽天 RMS 認証情報（シングルトン）
CREATE TABLE IF NOT EXISTS rakuten_rms_credentials (
  id                TEXT PRIMARY KEY DEFAULT 'default',
  issued_at         TEXT NOT NULL,
  expires_at        TEXT NOT NULL,                -- issued_at + 90日
  last_verified_at  TEXT,                          -- counts.get で疎通確認した日時
  status            TEXT NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'expired', 'rotating', 'unverified')),
  notification_log  TEXT,                          -- JSON: {"30d":"2026-..","14d":...}
  pause_polling     INTEGER NOT NULL DEFAULT 0,    -- 1 = ポーリング停止
  last_error        TEXT,                          -- 直近のエラーメッセージ
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

-- 楽天問い合わせメタデータ（cs_messages とは別; 楽天固有フィールドが多いため）
CREATE TABLE IF NOT EXISTS rakuten_inquiries (
  id                  TEXT PRIMARY KEY,
  rakuten_inquiry_id  TEXT NOT NULL UNIQUE,         -- 楽天側の問い合わせID
  chat_id             TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  customer_email      TEXT,                          -- マスクメール（顧客の本来メアドは見えない）
  customer_name       TEXT,
  order_number        TEXT,                          -- 注文番号（あれば）
  inquiry_type        TEXT,                          -- '商品問い合わせ' / '注文後' / '店舗' 等
  rakuten_status      TEXT NOT NULL DEFAULT 'unread', -- '未読' / '対応中' / '完了'
  is_read             INTEGER NOT NULL DEFAULT 0,
  is_completed        INTEGER NOT NULL DEFAULT 0,
  raw_metadata        TEXT,                          -- JSON: API原文（デバッグ・将来の追加処理用）
  fetched_at          TEXT NOT NULL,
  last_synced_at      TEXT,                          -- 楽天側の更新を最後に同期した日時
  created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);
CREATE INDEX IF NOT EXISTS idx_rakuten_inquiry_status ON rakuten_inquiries(rakuten_status);
CREATE INDEX IF NOT EXISTS idx_rakuten_inquiry_chat ON rakuten_inquiries(chat_id);
CREATE INDEX IF NOT EXISTS idx_rakuten_inquiry_completed ON rakuten_inquiries(is_completed, fetched_at DESC);

-- 楽天 API 呼び出しログ（運用監視・レート制限管理）
CREATE TABLE IF NOT EXISTS rakuten_api_call_log (
  id              TEXT PRIMARY KEY,
  endpoint        TEXT NOT NULL,                   -- 'inquiries.get' 等
  status          INTEGER,                          -- HTTP status code
  request_summary TEXT,                             -- 簡易リクエスト情報
  error_message   TEXT,
  duration_ms     INTEGER,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);
CREATE INDEX IF NOT EXISTS idx_rakuten_api_log_created ON rakuten_api_call_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rakuten_api_log_status ON rakuten_api_call_log(status);
