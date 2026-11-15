-- 2026-11-15 /broadcasts ブロック率の再計算（旧式の破綻値を正す）
--
-- 背景: 旧実装は「送信以降の累積unfollow数 − 送信前24時間の解除数」を成功数で割っていた。
--       基準が違う2つを差し引くため、1名配信が47,700%、負値6件という値になっていた。
-- 新式: 送信時刻から24時間の窓に入るunfollow数 ÷ 配信成功数（全員配信は total_count）。
--       20人未満の配信は率を出さない（LINE公式統計と同じ扱い）。
--
-- 実行:
--   cd line-crm/apps/worker
--   script -q /dev/null npx wrangler d1 execute DB --remote \
--     --command "$(cat ../../docs/repair/2026-11-15-broadcast-block-rate.sql)"
--
-- 冪等: 何度実行しても同じ結果になる（イベントから毎回計算し直す）。
WITH unfollow_window AS (
  SELECT b.id,
         (SELECT COUNT(*) FROM line_follow_events e
          WHERE e.event_type = 'unfollow'
            AND datetime(e.created_at) >= datetime(b.sent_at)
            AND datetime(e.created_at) < datetime(b.sent_at, '+24 hours')
            AND (b.line_account_id IS NULL OR e.line_account_id = b.line_account_id)) AS unf
  FROM broadcasts b
  WHERE b.status = 'sent'
    AND b.sent_at IS NOT NULL
)
UPDATE broadcasts SET
  unfollow_count_24h = unfollow_window.unf,
  unfollow_rate_24h_pct = CASE
    WHEN COALESCE(
           NULLIF(broadcasts.success_count, 0),
           CASE WHEN broadcasts.target_type = 'all' THEN broadcasts.total_count ELSE 0 END
         ) >= 20
      THEN ROUND(
        100.0 * unfollow_window.unf
        / COALESCE(
            NULLIF(broadcasts.success_count, 0),
            CASE WHEN broadcasts.target_type = 'all' THEN broadcasts.total_count ELSE 0 END
          ), 2)
    ELSE NULL
  END
FROM unfollow_window
WHERE broadcasts.id = unfollow_window.id;
