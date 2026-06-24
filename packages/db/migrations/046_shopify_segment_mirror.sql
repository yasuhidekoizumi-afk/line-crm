-- ============================================================
-- Shopify 顧客セグメントのミラー取り込み対応
-- ============================================================
-- 既存の rule ベース（ハーネス独自ルール）に加え、Shopify ネイティブの
-- 顧客セグメント(Customer Segments)を source='shopify' として取り込めるようにする。
-- メンバーは Shopify の customerSegmentMembers から取得し、LINE 連携済みの顧客のみ
-- segment_members に保存する（配信先として配信フォームに表示される）。
--
-- 大きいセグメントは1回の Worker 実行では取り切れない（サブリクエスト上限）ため、
-- sync_cursor / sync_status で「分割・再開可能」な同期に対応する。

ALTER TABLE segments ADD COLUMN source TEXT NOT NULL DEFAULT 'rule';  -- 'rule' | 'shopify'
ALTER TABLE segments ADD COLUMN shopify_segment_id TEXT;              -- gid://shopify/Segment/...
ALTER TABLE segments ADD COLUMN sync_cursor TEXT;                     -- 分割同期の再開カーソル（GraphQL endCursor）
ALTER TABLE segments ADD COLUMN sync_status TEXT;                     -- NULL(完了/通常) | 'syncing'(同期中) | 'error'
ALTER TABLE segments ADD COLUMN sync_error TEXT;                      -- 直近の同期エラー文言

CREATE INDEX IF NOT EXISTS idx_segments_shopify ON segments(shopify_segment_id);
