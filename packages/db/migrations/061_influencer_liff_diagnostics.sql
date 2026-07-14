-- LIFF本人IDとWebhook友だちIDの照合失敗を、個人IDを保存せずに診断する。
CREATE TABLE IF NOT EXISTS influencer_liff_diagnostics (
  id TEXT PRIMARY KEY,
  line_account_id TEXT NOT NULL,
  account_reference TEXT NOT NULL,
  liff_user_fingerprint TEXT NOT NULL,
  liff_user_known_account_id TEXT,
  target_friend_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_influencer_liff_diagnostics_created
  ON influencer_liff_diagnostics (created_at DESC);
