-- 公式ショップでの購入経験を、ギフティング選定時の参考情報として保存する。
ALTER TABLE influencer_profiles ADD COLUMN has_shopify_purchase INTEGER NOT NULL DEFAULT 0;
