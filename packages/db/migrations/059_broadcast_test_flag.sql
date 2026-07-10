-- 059_broadcast_test_flag.sql
--
-- テスト配信は同日重複除外の対象外にするため、配信単位で判定できるフラグを追加する。

ALTER TABLE broadcasts ADD COLUMN is_test INTEGER NOT NULL DEFAULT 0;
