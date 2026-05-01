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

/**
 * GET /api/admin/diagnostics/reminders-overview
 * リマインダ全体像。各 reminder ごとの enroll 件数 / 直近の配信件数を返す。
 */
diagnostics.get('/api/admin/diagnostics/reminders-overview', async (c) => {
  try {
    const reminders = await c.env.DB
      .prepare(
        `SELECT r.id, r.name, r.is_active,
                (SELECT COUNT(*) FROM friend_reminders fr WHERE fr.reminder_id = r.id) AS enrolled_total,
                (SELECT COUNT(*) FROM friend_reminders fr WHERE fr.reminder_id = r.id AND fr.status = 'active')    AS enrolled_active,
                (SELECT COUNT(*) FROM friend_reminders fr WHERE fr.reminder_id = r.id AND fr.status = 'completed') AS enrolled_completed,
                (SELECT COUNT(*) FROM friend_reminders fr WHERE fr.reminder_id = r.id AND fr.status = 'cancelled') AS enrolled_cancelled
         FROM reminders r
         ORDER BY r.created_at DESC`,
      )
      .all<{
        id: string;
        name: string;
        is_active: number;
        enrolled_total: number;
        enrolled_active: number;
        enrolled_completed: number;
        enrolled_cancelled: number;
      }>();

    return c.json({
      success: true,
      data: {
        reminders: reminders.results,
      },
    });
  } catch (err) {
    console.error('GET /api/admin/diagnostics/reminders-overview error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

/**
 * GET /api/admin/diagnostics/cart-message-history
 * messages_log から「カート」「チェックアウト」「checkout_url」を含む outgoing
 * メッセージの直近 50 件と総件数を返す。実際にどれだけカート系通知が
 * LINE に飛んだかを確認する用。
 */
diagnostics.get('/api/admin/diagnostics/cart-message-history', async (c) => {
  try {
    const totalRow = await c.env.DB
      .prepare(
        `SELECT COUNT(*) AS n FROM messages_log
         WHERE direction = 'outgoing'
           AND (content LIKE '%カートに商品が残っています%'
                OR content LIKE '%チェックアウトが未完了%'
                OR content LIKE '%checkouts/c/%'
                OR content LIKE '%abandoned_checkout_url%')`,
      )
      .first<{ n: number }>();

    const recent = await c.env.DB
      .prepare(
        `SELECT m.id, m.friend_id, m.message_type, m.created_at,
                f.line_user_id, f.display_name,
                substr(m.content, 1, 200) AS content_excerpt
         FROM messages_log m
         LEFT JOIN friends f ON f.id = m.friend_id
         WHERE m.direction = 'outgoing'
           AND (m.content LIKE '%カートに商品が残っています%'
                OR m.content LIKE '%チェックアウトが未完了%'
                OR m.content LIKE '%checkouts/c/%'
                OR m.content LIKE '%abandoned_checkout_url%')
         ORDER BY m.created_at DESC
         LIMIT 50`,
      )
      .all<{
        id: string;
        friend_id: string;
        message_type: string;
        created_at: string;
        line_user_id: string | null;
        display_name: string | null;
        content_excerpt: string;
      }>();

    return c.json({
      success: true,
      data: {
        total_cart_messages: totalRow?.n ?? 0,
        recent: recent.results,
      },
    });
  } catch (err) {
    console.error('GET /api/admin/diagnostics/cart-message-history error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

/**
 * GET /api/admin/diagnostics/scenarios-overview
 * scenarios と各シナリオの enroll 件数を返す。
 * 「カート」「checkout」を名称に含むシナリオは別軸でも返す。
 */
diagnostics.get('/api/admin/diagnostics/scenarios-overview', async (c) => {
  try {
    const all = await c.env.DB
      .prepare(
        `SELECT s.id, s.name, s.is_active,
                (SELECT COUNT(*) FROM friend_scenarios fs WHERE fs.scenario_id = s.id) AS enrolled_total,
                (SELECT COUNT(*) FROM friend_scenarios fs WHERE fs.scenario_id = s.id AND fs.status = 'active') AS enrolled_active
         FROM scenarios s
         ORDER BY s.created_at DESC`,
      )
      .all<{ id: string; name: string; is_active: number; enrolled_total: number; enrolled_active: number }>()
      .catch(() => ({ results: [] as { id: string; name: string; is_active: number; enrolled_total: number; enrolled_active: number }[] }));

    return c.json({
      success: true,
      data: {
        scenarios: all.results,
      },
    });
  } catch (err) {
    console.error('GET /api/admin/diagnostics/scenarios-overview error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

export { diagnostics };
