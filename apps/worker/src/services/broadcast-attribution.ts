import { broadcastUtmCampaign } from '../utils/tracked-link-utm.js';

/**
 * 配信→売上の帰属（2026-11-15 実装）。
 *
 * 2つの数字を上下限として出す。どちらか一方だけを出すと誤読する。
 *   1. クリック経由（下限）: 識別できたクリック → 7日以内の注文。last-click（直近のクリック）で1注文1配信に寄せる。
 *      link_clicks.friend_id は全体の14.6%しか埋まっていないため、これは「少なくともこれだけ」の数字。
 *   2. 配信対象者の購入（上限）: 配信対象者の7日以内の注文。オーガニック購入を含むため上限側。
 *      broadcast_recipient_sends に受信者が残っている配信のみ算出できる（全員配信は不可）。
 *
 * 貢献利益は出さない: shopify_products が空で原価がD1に無い（2026-11-15時点）。
 */
export interface BroadcastAttribution {
  windowDays: number;
  /** 配信経由（下限）: friend_idのlast-click + landing_siteのUTM の統合 */
  clickOrders: number;
  clickRevenue: number;
  clickAov: number | null;
  /** うち landing_site のUTMで一致した注文（2026-11-15以降の配信で増える） */
  utmOrders: number;
  utmRevenue: number;
  /** 配信対象者の購入（上限・オーガニック込み） */
  recipientOrders: number | null;
  recipientRevenue: number | null;
  recipientCount: number;
  revenuePerRecipient: number | null;
  /** 受信者リストが残っているか（全員配信は false） */
  hasRecipientList: boolean;
}

const PAID_STATUSES = "('paid','partially_paid','partially_refunded')";

export async function getBroadcastAttribution(
  db: D1Database,
  broadcast: {
    id: string;
    sent_at: string | null;
    target_type: string;
    total_count: number | null;
    success_count: number | null;
    line_account_id: string | null;
  },
  windowDays = 7,
): Promise<BroadcastAttribution | null> {
  if (!broadcast.sent_at) return null;

  const windowEnd = `datetime(?, '+${windowDays} days')`;
  const campaign = broadcastUtmCampaign(broadcast.id);

  // 1. 配信経由（friend_idのlast-click と landing_site のUTMを統合・注文IDで重複排除）
  const clickRow = await db
    .prepare(
      `WITH click_orders AS (
         SELECT o.shopify_order_id AS id, o.total_price AS price
         FROM shopify_orders o
         WHERE o.friend_id IS NOT NULL
           AND o.cancelled_at IS NULL
           AND o.financial_status IN ${PAID_STATUSES}
           AND datetime(o.created_at_shopify) >= datetime(?)
           AND datetime(o.created_at_shopify) < ${windowEnd}
           AND (SELECT t.broadcast_id
                FROM link_clicks c
                JOIN tracked_links t ON t.id = c.tracked_link_id
                WHERE c.friend_id = o.friend_id
                  AND datetime(c.clicked_at) <= datetime(o.created_at_shopify)
                  AND datetime(c.clicked_at) >= datetime(o.created_at_shopify, '-${windowDays} days')
                ORDER BY datetime(c.clicked_at) DESC
                LIMIT 1) = ?
       ),
       utm_orders AS (
         SELECT o.shopify_order_id AS id, o.total_price AS price
         FROM shopify_orders o
         WHERE o.cancelled_at IS NULL
           AND o.financial_status IN ${PAID_STATUSES}
           AND datetime(o.created_at_shopify) >= datetime(?)
           AND datetime(o.created_at_shopify) < ${windowEnd}
           AND o.landing_site LIKE ?
       ),
       merged AS (
         SELECT id, price FROM click_orders
         UNION
         SELECT id, price FROM utm_orders
       )
       SELECT COUNT(*) AS orders,
              COALESCE(SUM(price), 0) AS revenue,
              COALESCE(SUM(CASE WHEN id IN (SELECT id FROM utm_orders) THEN 1 ELSE 0 END), 0) AS utm_orders,
              COALESCE(SUM(CASE WHEN id IN (SELECT id FROM utm_orders) THEN price ELSE 0 END), 0) AS utm_revenue
       FROM merged`,
    )
    .bind(
      broadcast.sent_at, broadcast.sent_at, broadcast.id,
      broadcast.sent_at, broadcast.sent_at, `%utm_campaign=${campaign}%`,
    )
    .first<{ orders: number; revenue: number; utm_orders: number; utm_revenue: number }>();

  // 2. 配信対象者の購入（受信者リストがある配信のみ）
  const recipientRow = await db
    .prepare(
      `SELECT COUNT(*) AS recipients
       FROM broadcast_recipient_sends
       WHERE broadcast_id = ?`,
    )
    .bind(broadcast.id)
    .first<{ recipients: number }>();
  const recipientCount = recipientRow?.recipients ?? 0;

  let recipientOrders: number | null = null;
  let recipientRevenue: number | null = null;
  if (recipientCount > 0) {
    const row = await db
      .prepare(
        `SELECT COUNT(*) AS orders, COALESCE(SUM(so.total_price), 0) AS revenue
         FROM shopify_orders so
         WHERE so.friend_id IS NOT NULL
           AND so.cancelled_at IS NULL
           AND so.financial_status IN ${PAID_STATUSES}
           AND datetime(so.created_at_shopify) >= datetime(?)
           AND datetime(so.created_at_shopify) < ${windowEnd}
           AND so.friend_id IN (
             SELECT f.id FROM friends f
             JOIN broadcast_recipient_sends r ON r.line_user_id = f.line_user_id
             WHERE r.broadcast_id = ?
           )`,
      )
      .bind(broadcast.sent_at, broadcast.sent_at, broadcast.id)
      .first<{ orders: number; revenue: number }>();
    recipientOrders = row?.orders ?? 0;
    recipientRevenue = row?.revenue ?? 0;
  }

  const clickOrders = clickRow?.orders ?? 0;
  const clickRevenue = clickRow?.revenue ?? 0;

  const utmOrders = clickRow?.utm_orders ?? 0;
  const utmRevenue = clickRow?.utm_revenue ?? 0;

  return {
    windowDays,
    clickOrders,
    clickRevenue,
    clickAov: clickOrders > 0 ? clickRevenue / clickOrders : null,
    utmOrders,
    utmRevenue,
    recipientOrders,
    recipientRevenue,
    recipientCount,
    revenuePerRecipient: recipientRevenue != null && recipientCount > 0
      ? recipientRevenue / recipientCount
      : null,
    hasRecipientList: recipientCount > 0,
  };
}
