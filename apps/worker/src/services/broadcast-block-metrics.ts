/**
 * 配信単位のブロック率計算（068）。
 *
 * 送信から24時間以上経過した配信について:
 *   unfollow_count_24h = 送信以降の累積unfollow数
 *   unfollow_rate_24h_pct = (累積 - 送信直後スナップショット) ÷ 成功配信数 × 100
 *
 * ponytail: 72h版は24h版の運用実感が出てから。
 */
export async function computeBroadcastUnfollowRates(db: D1Database): Promise<number> {
  const result = await db
    .prepare(
      `WITH unfollow_since AS (
         SELECT b.id,
                (SELECT COUNT(*) FROM line_follow_events e
                 WHERE e.event_type = 'unfollow'
                   AND e.created_at >= b.sent_at
                   AND (b.line_account_id IS NULL OR e.line_account_id = b.line_account_id)) AS unf
         FROM broadcasts b
         WHERE b.status = 'sent'
           AND b.sent_at IS NOT NULL
           AND b.unfollow_count_24h IS NULL
           AND b.sent_at <= strftime('%Y-%m-%dT%H:%M:%f', 'now', '-24 hours', '+9 hours')
       )
       UPDATE broadcasts SET
         unfollow_count_24h = unfollow_since.unf,
         unfollow_rate_24h_pct = ROUND(
           100.0 * (unfollow_since.unf - COALESCE(broadcasts.unfollow_count_at_send, 0))
           / NULLIF(broadcasts.success_count, 0), 2)
       FROM unfollow_since
       WHERE broadcasts.id = unfollow_since.id`,
    )
    .run();
  return result.meta?.changes ?? 0;
}
