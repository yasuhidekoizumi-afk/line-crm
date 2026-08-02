-- LINEを利用しないインフルエンサーも管理画面から登録できるようにする。
-- 登録経路と担当者が使う連絡手段をプロフィールに保持する。

ALTER TABLE influencer_profiles ADD COLUMN registration_source TEXT NOT NULL DEFAULT 'line'
  CHECK (registration_source IN ('line', 'manual'));

ALTER TABLE influencer_profiles ADD COLUMN contact_method TEXT NOT NULL DEFAULT 'line'
  CHECK (contact_method IN ('line', 'instagram_dm'));

CREATE INDEX IF NOT EXISTS idx_influencer_profiles_contact_method
  ON influencer_profiles(contact_method);
