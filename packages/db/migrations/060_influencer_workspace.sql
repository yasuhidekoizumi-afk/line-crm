-- インフルエンサー公式LINE専用ワークスペース
-- 担当者をLINEアカウント単位で制限し、プロフィールと発送先を分離して保存する。

CREATE TABLE IF NOT EXISTS staff_line_account_permissions (
  staff_member_id TEXT NOT NULL REFERENCES staff_members(id) ON DELETE CASCADE,
  line_account_id TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  account_role TEXT NOT NULL CHECK (account_role IN ('account_admin', 'operator')) DEFAULT 'operator',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  PRIMARY KEY (staff_member_id, line_account_id)
);

CREATE INDEX IF NOT EXISTS idx_staff_account_permissions_account
  ON staff_line_account_permissions(line_account_id);

CREATE TABLE IF NOT EXISTS influencer_profiles (
  friend_id TEXT PRIMARY KEY REFERENCES friends(id) ON DELETE CASCADE,
  instagram_handle TEXT,
  categories_json TEXT NOT NULL DEFAULT '[]',
  follower_band TEXT,
  contact_email TEXT,
  contact_phone TEXT,
  age_group TEXT,
  gender TEXT,
  gifting_interests_json TEXT NOT NULL DEFAULT '[]',
  dietary_notes TEXT,
  privacy_consent_at TEXT,
  profile_completed_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

CREATE TABLE IF NOT EXISTS influencer_shipping_addresses (
  friend_id TEXT PRIMARY KEY REFERENCES friends(id) ON DELETE CASCADE,
  recipient_name TEXT,
  postal_code TEXT,
  prefecture TEXT,
  address_line1 TEXT,
  address_line2 TEXT,
  phone TEXT,
  confirmed_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);
