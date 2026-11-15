/**
 * 配信単位のブロック率計算（068、2026-11-15に式を修正）。
 *
 * 旧式: unfollow_count_24h = 送信以降の累積unfollow数 − 送信直後スナップショット
 *   スナップショットは「送信前24時間の解除数」で累積とは基準が違うため、差し引くと
 *   1名配信が47,700%、負値6件という破綻値になる（本番実測 2026-11-15）。
 *
 * 新式: unfollow_count_24h = 送信時刻から24時間の窓に入るunfollow数
 *   （スナップショットに依存しない）。分母は success_count、全員配信のみ total_count。
 *
 * ponytail: 72h版は24h版の運用実感が出てから。
 */
export async function computeBroadcastUnfollowRates(db: D1Database): Promise<number> {
  const result = await db
    .prepare(
      `WITH unfollow_window AS (
         SELECT b.id,
                (SELECT COUNT(*) FROM line_follow_events e
                 WHERE e.event_type = 'unfollow'
                   AND datetime(e.created_at) >= datetime(b.sent_at)
                   AND datetime(e.created_at) < datetime(b.sent_at, '+24 hours')
                   AND (b.line_account_id IS NULL OR e.line_account_id = b.line_account_id)) AS unf
         FROM broadcasts b
         WHERE b.status = 'sent'
           AND b.sent_at IS NOT NULL
           AND b.unfollow_count_24h IS NULL
           AND datetime(b.sent_at) <= datetime('now', '-24 hours')
       )
       UPDATE broadcasts SET
         unfollow_count_24h = unfollow_window.unf,
         unfollow_rate_24h_pct = CASE
           WHEN COALESCE(
                  NULLIF(broadcasts.success_count, 0),
                  CASE WHEN broadcasts.target_type = 'all' THEN broadcasts.total_count ELSE 0 END
                ) > 0
             THEN ROUND(
               100.0 * unfollow_window.unf
               / COALESCE(
                   NULLIF(broadcasts.success_count, 0),
                   CASE WHEN broadcasts.target_type = 'all' THEN broadcasts.total_count ELSE 0 END
                 ), 2)
           ELSE NULL
         END
       FROM unfollow_window
       WHERE broadcasts.id = unfollow_window.id`,
    )
    .run();
  return result.meta?.changes ?? 0;
}

/**
 * 1配信の24時間ブロック率を読み取り時に計算する（保存値に依存しない）。
 * 送信から24時間経っていない配信は「集計中」として null を返す。
 */
export async function getBroadcastBlockStats(
  db: D1Database,
  broadcast: {
    sent_at: string | null;
    success_count: number | null;
    total_count: number | null;
    target_type: string;
    line_account_id: string | null;
  },
): Promise<{ unfollowCount: number | null; rate: number | null }> {
  if (!broadcast.sent_at) return { unfollowCount: null, rate: null };
  const sentMs = new Date(broadcast.sent_at).getTime();
  if (!Number.isFinite(sentMs) || Date.now() - sentMs < 24 * 60 * 60 * 1000) {
    return { unfollowCount: null, rate: null };
  }

  try {
    const row = await db
      .prepare(
        `SELECT COUNT(*) AS count
         FROM line_follow_events
         WHERE event_type = 'unfollow'
           AND datetime(created_at) >= datetime(?)
           AND datetime(created_at) < datetime(?, '+24 hours')
           AND (? IS NULL OR line_account_id = ?)`,
      )
      .bind(broadcast.sent_at, broadcast.sent_at, broadcast.line_account_id, broadcast.line_account_id)
      .first<{ count: number }>();

    const unfollowCount = row?.count ?? 0;
    const denominator = broadcast.success_count
      || (broadcast.target_type === 'all' ? (broadcast.total_count ?? 0) : 0);
    return {
      unfollowCount,
      // 少数配信の率は意味を持たないため、LINE公式統計と同じく20人未満は率を出さない
      rate: denominator >= 20 ? (unfollowCount / denominator) * 100 : null,
    };
  } catch (error) {
    console.warn('[broadcast] block stats unavailable:', error);
    return { unfollowCount: null, rate: null };
  }
}
