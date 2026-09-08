-- 068_broadcast_block_metrics.sql
-- 配信単位のブロック率計測（安全装置の率ベース化）。
--
-- 背景: 現状の緊急停止は「1時間に解除10件=warning / 30件=danger」の絶対件数のみ。
-- 母数と無関係なため「大配信で多少切れた」と「小配信で軒並み切られた」を区別できない。
--
-- 設計:
--   - broadcasts に送信直後と24h後の解除数スナップショットを記録
--   - line_follow_events（unfollow）は既存のテーブルを流用（再構築しない）
--   - 増分 unfollow_delta_24h と率 unfollow_rate_24h_pct を計算
--
-- ponytail: 72hスナップショットは24h版の運用実感が出てから追加。

ALTER TABLE broadcasts ADD COLUMN unfollow_count_at_send INTEGER;
ALTER TABLE broadcasts ADD COLUMN unfollow_count_24h INTEGER;
ALTER TABLE broadcasts ADD COLUMN unfollow_rate_24h_pct REAL;

CREATE INDEX IF NOT EXISTS idx_broadcasts_unfollow_rate ON broadcasts(unfollow_rate_24h_pct) WHERE unfollow_rate_24h_pct IS NOT NULL;
