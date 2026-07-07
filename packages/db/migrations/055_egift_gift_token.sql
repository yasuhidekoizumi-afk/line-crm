-- 055: eGift — ギフトURL再構築用に生トークンを保存
ALTER TABLE egift_gifts ADD COLUMN gift_token TEXT;
