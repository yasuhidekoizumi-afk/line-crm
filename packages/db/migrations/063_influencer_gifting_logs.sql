-- インフルエンサーごとのギフティング案件・投稿実績を残す台帳。
-- 数字はSNS担当者が投稿後に手入力し、案件単位で比較できるようにする。
CREATE TABLE IF NOT EXISTS influencer_gifting_logs (
  id TEXT PRIMARY KEY,
  friend_id TEXT NOT NULL REFERENCES friends(id) ON DELETE CASCADE,
  line_account_id TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  product_name TEXT NOT NULL,
  product_page_url TEXT,
  status TEXT NOT NULL DEFAULT 'requested'
    CHECK (status IN ('requested', 'accepted', 'shipped', 'posted', 'declined', 'cancelled')),
  requested_at TEXT,
  shipped_at TEXT,
  post_published_at TEXT,
  post_type TEXT,
  post_url TEXT,
  reach INTEGER,
  impressions INTEGER,
  likes INTEGER,
  comments INTEGER,
  saves INTEGER,
  effect_notes TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

CREATE INDEX IF NOT EXISTS idx_influencer_gifting_logs_account_created
  ON influencer_gifting_logs(line_account_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_influencer_gifting_logs_friend
  ON influencer_gifting_logs(friend_id, updated_at DESC);
