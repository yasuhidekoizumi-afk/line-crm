import { Hono } from 'hono';
import type { Env } from '../index.js';

/**
 * セキュリティインシデント調査用の診断エンドポイント。
 *
 * 認証: X-Diag-Token ヘッダ または ?diag_token クエリで env.DIAG_TOKEN と
 * 一致する場合のみ通す。authMiddleware からは skip リスト経由で外している
 * （インシデント対応専用の独立した認証経路を確保するため）。
 *
 * 提供する情報:
 *  - GET /api/admin/diagnostics/shopify-link-collisions
 *      LINE と Shopify 顧客の紐付けが「異常」なレコードを抽出する。
 *  - GET /api/admin/diagnostics/cart-state-stats
 *      customer_cart_states テーブルの直近件数・誤受信件数を返す。
 */

const diagnostics = new Hono<Env>();

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

diagnostics.use('/api/admin/diagnostics/*', async (c, next) => {
  const expected = c.env.DIAG_TOKEN;
  if (!expected) {
    return c.json({ success: false, error: 'DIAG_TOKEN not configured' }, 503);
  }
  const headerToken = c.req.header('X-Diag-Token') ?? c.req.header('x-diag-token');
  const queryToken = c.req.query('diag_token');
  const provided = headerToken ?? queryToken ?? '';
  if (!provided || !constantTimeEqual(provided, expected)) {
    return c.json({ success: false, error: 'Unauthorized' }, 401);
  }
  return next();
});

interface CollisionRow {
  shopify_customer_id: string;
  friend_count: number;
  friend_ids: string;
  line_user_ids: string;
  display_names: string;
}

diagnostics.get('/api/admin/diagnostics/shopify-link-collisions', async (c) => {
  try {
    // a) 1 つの shopify_customer_id に複数 friend が紐付いているケース
    const multiFriend = await c.env.DB
      .prepare(
        `SELECT
            lp.shopify_customer_id              AS shopify_customer_id,
            COUNT(*)                            AS friend_count,
            GROUP_CONCAT(lp.friend_id, ',')     AS friend_ids,
            GROUP_CONCAT(f.line_user_id, ',')   AS line_user_ids,
            GROUP_CONCAT(f.display_name, ' | ') AS display_names
         FROM loyalty_points lp
         LEFT JOIN friends f ON f.id = lp.friend_id
         WHERE lp.shopify_customer_id IS NOT NULL
           AND lp.shopify_customer_id != ''
         GROUP BY lp.shopify_customer_id
         HAVING COUNT(*) > 1
         ORDER BY friend_count DESC, lp.shopify_customer_id ASC
         LIMIT 200`,
      )
      .all<CollisionRow>();

    // b) 全体カウント
    const totalLinked = await c.env.DB
      .prepare(
        `SELECT COUNT(*) AS n
         FROM loyalty_points
         WHERE shopify_customer_id IS NOT NULL AND shopify_customer_id != ''`,
      )
      .first<{ n: number }>();

    const distinctShopifyIds = await c.env.DB
      .prepare(
        `SELECT COUNT(DISTINCT shopify_customer_id) AS n
         FROM loyalty_points
         WHERE shopify_customer_id IS NOT NULL AND shopify_customer_id != ''`,
      )
      .first<{ n: number }>();

    return c.json({
      success: true,
      data: {
        summary: {
          total_linked_friends: totalLinked?.n ?? 0,
          distinct_shopify_customer_ids: distinctShopifyIds?.n ?? 0,
          collision_groups: multiFriend.results.length,
        },
        collisions: multiFriend.results.map((r) => ({
          shopify_customer_id: r.shopify_customer_id,
          friend_count: r.friend_count,
          friend_ids: (r.friend_ids ?? '').split(','),
          line_user_ids: (r.line_user_ids ?? '').split(','),
          display_names: (r.display_names ?? '').split(' | '),
        })),
      },
    });
  } catch (err) {
    console.error('GET /api/admin/diagnostics/shopify-link-collisions error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

diagnostics.get('/api/admin/diagnostics/cart-state-stats', async (c) => {
  try {
    const total = await c.env.DB
      .prepare(`SELECT COUNT(*) AS n FROM customer_cart_states`)
      .first<{ n: number }>()
      .catch(() => null);
    const last7d = await c.env.DB
      .prepare(`SELECT COUNT(*) AS n FROM customer_cart_states WHERE abandoned_at >= datetime('now', '-7 days')`)
      .first<{ n: number }>()
      .catch(() => null);
    const recovered = await c.env.DB
      .prepare(`SELECT COUNT(*) AS n FROM customer_cart_states WHERE recovered_at IS NOT NULL`)
      .first<{ n: number }>()
      .catch(() => null);
    const sent = await c.env.DB
      .prepare(`SELECT SUM(reminder_sent_count) AS n FROM customer_cart_states`)
      .first<{ n: number }>()
      .catch(() => null);

    return c.json({
      success: true,
      data: {
        total: total?.n ?? null,
        last_7d_abandoned: last7d?.n ?? null,
        recovered: recovered?.n ?? null,
        total_reminders_sent: sent?.n ?? null,
      },
    });
  } catch (err) {
    console.error('GET /api/admin/diagnostics/cart-state-stats error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

export { diagnostics };
