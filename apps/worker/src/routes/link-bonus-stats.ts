/**
 * LINE連携ボーナス付与の集計エンドポイント（管理用）。
 *
 * 用途:
 *  - 自社版 LINE Harness 切替後に「実際に自社版で連携した人」を確認するため。
 *  - reason='LINE連携ボーナス' の transaction を since 以降で集計。
 *  - friend_id 単位の DISTINCT 数 = 連携人数。
 *
 * 認証: 他の admin endpoint と同じく内部用ノーガード（呼び出しは Worker URL を知る人のみ）。
 *
 * 呼び方:
 *   POST /api/admin/link-bonus-stats
 *   body: { since?: 'YYYY-MM-DD'（既定 2026-04-01）, daily?: boolean }
 */
import { Hono } from 'hono';
import type { Env } from '../index.js';

const linkBonusStats = new Hono<Env>();

linkBonusStats.post('/api/admin/link-bonus-stats', async (c) => {
  const body = await c.req
    .json<{ since?: string; daily?: boolean }>()
    .catch(() => ({} as { since?: string; daily?: boolean }));

  const since = body.since ?? '2026-04-01';
  const wantDaily = body.daily ?? false;

  try {
    // 期間内に LINE連携ボーナス を受け取ったユニーク friend_id 数 + 合計ポイント
    const totals = await c.env.DB
      .prepare(
        `SELECT
           COUNT(DISTINCT friend_id) AS unique_friends,
           COUNT(*)                  AS transaction_count,
           COALESCE(SUM(points), 0)  AS total_points,
           MIN(created_at)           AS first_at,
           MAX(created_at)           AS last_at
         FROM loyalty_transactions
         WHERE reason = 'LINE連携ボーナス' AND created_at >= ?`,
      )
      .bind(since)
      .first<{
        unique_friends: number;
        transaction_count: number;
        total_points: number;
        first_at: string | null;
        last_at: string | null;
      }>();

    // 期間全体(=since指定なしの場合との比較)も取って参考値として出す
    const allTime = await c.env.DB
      .prepare(
        `SELECT
           COUNT(DISTINCT friend_id) AS unique_friends,
           COUNT(*)                  AS transaction_count,
           COALESCE(SUM(points), 0)  AS total_points
         FROM loyalty_transactions
         WHERE reason = 'LINE連携ボーナス'`,
      )
      .first<{ unique_friends: number; transaction_count: number; total_points: number }>();

    let daily: Array<{ date: string; count: number; points: number }> = [];
    if (wantDaily) {
      const rows = await c.env.DB
        .prepare(
          `SELECT substr(created_at, 1, 10) AS date,
                  COUNT(DISTINCT friend_id) AS count,
                  COALESCE(SUM(points), 0)  AS points
           FROM loyalty_transactions
           WHERE reason = 'LINE連携ボーナス' AND created_at >= ?
           GROUP BY substr(created_at, 1, 10)
           ORDER BY date ASC`,
        )
        .bind(since)
        .all<{ date: string; count: number; points: number }>();
      daily = rows.results;
    }

    return c.json({
      success: true,
      data: {
        since,
        since_period: {
          uniqueFriends: totals?.unique_friends ?? 0,
          transactionCount: totals?.transaction_count ?? 0,
          totalPoints: totals?.total_points ?? 0,
          firstAt: totals?.first_at ?? null,
          lastAt: totals?.last_at ?? null,
        },
        all_time: {
          uniqueFriends: allTime?.unique_friends ?? 0,
          transactionCount: allTime?.transaction_count ?? 0,
          totalPoints: allTime?.total_points ?? 0,
        },
        ...(wantDaily ? { daily } : {}),
      },
    });
  } catch (err) {
    console.error('POST /api/admin/link-bonus-stats error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

export { linkBonusStats };
