/**
 * 顧客ジャーニー集約サービス
 *
 * shopify_orders から各 shopify_customer_id ごとの初回〜2回目購入の旅路を集約。
 * 結果は customer_journey テーブルに UPSERT。
 */

export interface RecomputeResult {
  total_customers: number;
  with_repeat: number;
  elapsed_ms: number;
}

const VALID_ORDER_WHERE = `cancelled_at IS NULL
  AND (financial_status IS NULL OR financial_status NOT IN ('refunded','voided'))
  AND shopify_customer_id IS NOT NULL`;

const LINE_LINK_CTES = `
  customer_line_by_shopify AS (
    SELECT
      shopify_customer_id_jp AS shopify_customer_id,
      MAX(CASE WHEN line_user_id LIKE 'U%' THEN 1 ELSE 0 END) AS has_line
    FROM customers
    WHERE shopify_customer_id_jp IS NOT NULL
    GROUP BY shopify_customer_id_jp
  ),
  customer_line_by_customer AS (
    SELECT
      customer_id,
      MAX(CASE WHEN line_user_id LIKE 'U%' THEN 1 ELSE 0 END) AS has_line
    FROM customers
    WHERE customer_id IS NOT NULL
    GROUP BY customer_id
  )`;

const HAS_LINE_LINK_EXPR = `CASE
  WHEN ff.line_user_id LIKE 'U%'
    OR fs.line_user_id LIKE 'U%'
    OR COALESCE(cls.has_line, 0) = 1
    OR COALESCE(clc.has_line, 0) = 1
  THEN 1 ELSE 0 END`;

/**
 * customer_journey をリビルドする。
 *
 * WorkersのCPU/時間制限対策のため、1回で最大900顧客まで処理。
 * 残りは次のcron呼び出しで継続される。
 *
 * LINE連携判定は以下を統合する:
 * - shopify_orders.friend_id → friends.line_user_id LIKE 'U%'（直接LINE friend）
 * - customers.shopify_customer_id_jp → customers.line_user_id LIKE 'U%'（CRMPLUS移管データ）
 * - customers.customer_id → customers.line_user_id LIKE 'U%'（FERMENT/customer経由）
 */
export async function recomputeCustomerJourney(db: D1Database): Promise<RecomputeResult> {
  const startedAt = Date.now();

  // まだ処理されていない顧客IDを取得（SQLite bind 変数上限 999 を避けるため900件）
  const unprocessedResult = await db
    .prepare(
      `SELECT DISTINCT so.shopify_customer_id
       FROM shopify_orders so
       WHERE so.cancelled_at IS NULL
         AND (so.financial_status IS NULL OR so.financial_status NOT IN ('refunded','voided'))
         AND so.shopify_customer_id IS NOT NULL
         AND so.shopify_customer_id NOT IN (
           SELECT shopify_customer_id FROM customer_journey
         )
       ORDER BY so.shopify_customer_id
       LIMIT 900`,
    )
    .all<{ shopify_customer_id: string }>();

  const unprocessed = (unprocessedResult.results ?? []).map((r) => r.shopify_customer_id);

  // 未処理がなければ全削除して再構築（初回実行時）
  if (unprocessed.length === 0) {
    // 既に全件処理済みかチェック
    const totalResult = await db
      .prepare(`SELECT COUNT(*) AS total FROM customer_journey`)
      .first<{ total: number }>();
    const total = totalResult?.total ?? 0;

    if (total === 0) {
      // 初回: テーブルが空。shopify_ordersから直接INSERT（先頭900顧客相当）
      await db
        .prepare(
          `INSERT INTO customer_journey (
             shopify_customer_id, customer_id, friend_id,
             first_order_at, first_order_id, first_order_value, first_was_line_linked,
             second_order_at, second_order_id, second_order_value, days_to_second, second_was_line_linked,
             total_orders, total_revenue,
             is_currently_line_linked, current_loyalty_rank, cohort_month,
             computed_at
           )
           WITH ordered AS (
             SELECT
               shopify_customer_id,
               shopify_order_id,
               processed_at,
               total_price,
               friend_id,
               customer_id,
               ROW_NUMBER() OVER (PARTITION BY shopify_customer_id ORDER BY processed_at ASC) AS rn,
               COUNT(*)        OVER (PARTITION BY shopify_customer_id) AS total_orders,
               SUM(total_price) OVER (PARTITION BY shopify_customer_id) AS total_revenue,
               MAX(customer_id) OVER (PARTITION BY shopify_customer_id) AS resolved_customer_id,
               MAX(friend_id)   OVER (PARTITION BY shopify_customer_id) AS resolved_friend_id
             FROM shopify_orders
             WHERE ${VALID_ORDER_WHERE}
             LIMIT 900
           ),
           ${LINE_LINK_CTES}
           SELECT
             f.shopify_customer_id,
             f.resolved_customer_id,
             f.resolved_friend_id,
             f.processed_at,
             f.shopify_order_id,
             f.total_price,
             CASE WHEN ff.line_user_id LIKE 'U%' OR COALESCE(cls.has_line, 0) = 1 OR COALESCE(clc.has_line, 0) = 1 THEN 1 ELSE 0 END,
             s.processed_at,
             s.shopify_order_id,
             s.total_price,
             CAST(julianday(s.processed_at) - julianday(f.processed_at) AS INTEGER),
             CASE WHEN fs.line_user_id LIKE 'U%' OR COALESCE(cls.has_line, 0) = 1 OR COALESCE(clc.has_line, 0) = 1 THEN 1 ELSE 0 END,
             f.total_orders,
             f.total_revenue,
             ${HAS_LINE_LINK_EXPR},
             NULL,
             SUBSTR(f.processed_at, 1, 7),
             strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')
           FROM ordered f
           LEFT JOIN ordered s
             ON s.shopify_customer_id = f.shopify_customer_id AND s.rn = 2
           LEFT JOIN friends ff ON ff.id = f.friend_id
           LEFT JOIN friends fs ON fs.id = s.friend_id
           LEFT JOIN customer_line_by_shopify cls ON cls.shopify_customer_id = f.shopify_customer_id
           LEFT JOIN customer_line_by_customer clc ON clc.customer_id = f.resolved_customer_id
           WHERE f.rn = 1`,
        )
        .run();
    }
  } else {
    // 未処理顧客がいる → それらを batch で INSERT
    const ph = unprocessed.map(() => '?').join(',');
    await db
      .prepare(
        `INSERT INTO customer_journey (
           shopify_customer_id, customer_id, friend_id,
           first_order_at, first_order_id, first_order_value, first_was_line_linked,
           second_order_at, second_order_id, second_order_value, days_to_second, second_was_line_linked,
           total_orders, total_revenue,
           is_currently_line_linked, current_loyalty_rank, cohort_month,
           computed_at
         )
         WITH ordered AS (
           SELECT
             shopify_customer_id,
             shopify_order_id,
             processed_at,
             total_price,
             friend_id,
             customer_id,
             ROW_NUMBER() OVER (PARTITION BY shopify_customer_id ORDER BY processed_at ASC) AS rn,
             COUNT(*)        OVER (PARTITION BY shopify_customer_id) AS total_orders,
             SUM(total_price) OVER (PARTITION BY shopify_customer_id) AS total_revenue,
             MAX(customer_id) OVER (PARTITION BY shopify_customer_id) AS resolved_customer_id,
             MAX(friend_id)   OVER (PARTITION BY shopify_customer_id) AS resolved_friend_id
           FROM shopify_orders
           WHERE ${VALID_ORDER_WHERE}
             AND shopify_customer_id IN (${ph})
         ),
         ${LINE_LINK_CTES}
         SELECT
           f.shopify_customer_id,
           f.resolved_customer_id,
           f.resolved_friend_id,
           f.processed_at,
           f.shopify_order_id,
           f.total_price,
           CASE WHEN ff.line_user_id LIKE 'U%' OR COALESCE(cls.has_line, 0) = 1 OR COALESCE(clc.has_line, 0) = 1 THEN 1 ELSE 0 END,
           s.processed_at,
           s.shopify_order_id,
           s.total_price,
           CAST(julianday(s.processed_at) - julianday(f.processed_at) AS INTEGER),
           CASE WHEN fs.line_user_id LIKE 'U%' OR COALESCE(cls.has_line, 0) = 1 OR COALESCE(clc.has_line, 0) = 1 THEN 1 ELSE 0 END,
           f.total_orders,
           f.total_revenue,
           ${HAS_LINE_LINK_EXPR},
           NULL,
           SUBSTR(f.processed_at, 1, 7),
           strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')
         FROM ordered f
         LEFT JOIN ordered s
           ON s.shopify_customer_id = f.shopify_customer_id AND s.rn = 2
         LEFT JOIN friends ff ON ff.id = f.friend_id
         LEFT JOIN friends fs ON fs.id = s.friend_id
         LEFT JOIN customer_line_by_shopify cls ON cls.shopify_customer_id = f.shopify_customer_id
         LEFT JOIN customer_line_by_customer clc ON clc.customer_id = f.resolved_customer_id
         WHERE f.rn = 1`,
      )
      .bind(...unprocessed)
      .run();
  }

  // ロイヤルティランクを一括UPDATE
  await db
    .prepare(
      `UPDATE customer_journey
       SET current_loyalty_rank = COALESCE(
         (SELECT lp.rank FROM loyalty_points lp WHERE lp.friend_id = customer_journey.friend_id LIMIT 1),
         'レギュラー'
       )
       WHERE friend_id IS NOT NULL
         AND current_loyalty_rank IS NULL`,
    )
    .run();

  // 結果件数を取得
  const countResult = await db
    .prepare(`SELECT COUNT(*) AS total, SUM(CASE WHEN second_order_at IS NOT NULL THEN 1 ELSE 0 END) AS with_repeat FROM customer_journey`)
    .first<{ total: number; with_repeat: number }>();

  return {
    total_customers: countResult?.total ?? 0,
    with_repeat: countResult?.with_repeat ?? 0,
    elapsed_ms: Date.now() - startedAt,
  };
}
