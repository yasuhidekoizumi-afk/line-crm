/**
 * 顧客ジャーニー集約サービス
 *
 * shopify_orders から各 shopify_customer_id ごとの初回〜2回目購入の旅路を集約。
 * 結果は customer_journey テーブルに UPSERT。
 *
 * 真のKPI（Discovery で判明）:
 *   レギュラー → シルバー の昇格率 = 2回目購入率
 *   LINE連携だけではLTV ¥3,742（未連携 ¥3,931 とほぼ同等）
 *   シルバー以上に育成できないとLINE連携の価値ゼロ
 *
 * このサービスはその「2回目購入率」をコホート × LINE連携状態 × 経過日数で測定可能にする。
 */

export interface RecomputeResult {
  total_customers: number;
  with_repeat: number;
  elapsed_ms: number;
}

const VALID_ORDER_FILTER = `cancelled_at IS NULL
  AND (financial_status IS NULL OR financial_status NOT IN ('refunded','voided'))
  AND shopify_customer_id IS NOT NULL`;

/**
 * customer_journey をフルリビルドする。
 *
 * 大規模顧客データでも安全に動かすため、複数の SELECT で集計しつつ
 * 100件チャンクで UPSERT する。
 */
export async function recomputeCustomerJourney(db: D1Database): Promise<RecomputeResult> {
  const startedAt = Date.now();

  // 1. 顧客ごとの集計を1クエリで取得
  //    - first_order: 最初の processed_at の order
  //    - second_order: 2番目
  //    - 累計: total_orders, total_revenue
  //    - 現状: is_currently_line_linked = MAX(friend_id IS NOT NULL)
  const rows = await db
    .prepare(
      `WITH ordered AS (
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
           MAX(CASE WHEN friend_id IS NOT NULL THEN 1 ELSE 0 END) OVER (PARTITION BY shopify_customer_id) AS is_currently_line_linked,
           MAX(customer_id) OVER (PARTITION BY shopify_customer_id) AS resolved_customer_id,
           MAX(friend_id)   OVER (PARTITION BY shopify_customer_id) AS resolved_friend_id
         FROM shopify_orders
         WHERE ${VALID_ORDER_FILTER}
       )
       SELECT
         f.shopify_customer_id,
         f.resolved_customer_id   AS customer_id,
         f.resolved_friend_id     AS friend_id,
         f.processed_at           AS first_order_at,
         f.shopify_order_id       AS first_order_id,
         f.total_price            AS first_order_value,
         CASE WHEN f.friend_id IS NOT NULL THEN 1 ELSE 0 END AS first_was_line_linked,
         s.processed_at           AS second_order_at,
         s.shopify_order_id       AS second_order_id,
         s.total_price            AS second_order_value,
         CASE WHEN s.friend_id IS NOT NULL THEN 1 ELSE 0 END AS second_was_line_linked,
         f.total_orders,
         f.total_revenue,
         f.is_currently_line_linked
       FROM ordered f
       LEFT JOIN ordered s
         ON s.shopify_customer_id = f.shopify_customer_id AND s.rn = 2
       WHERE f.rn = 1`,
    )
    .all<{
      shopify_customer_id: string;
      customer_id: string | null;
      friend_id: string | null;
      first_order_at: string;
      first_order_id: string;
      first_order_value: number;
      first_was_line_linked: number;
      second_order_at: string | null;
      second_order_id: string | null;
      second_order_value: number | null;
      second_was_line_linked: number | null;
      total_orders: number;
      total_revenue: number;
      is_currently_line_linked: number;
    }>();

  const customers = rows.results ?? [];

  // 2. ロイヤルティランクを friend_id ごとに取得（一度だけ）
  const linkedFriendIds = customers.map((c) => c.friend_id).filter((f): f is string => !!f);
  const rankMap = new Map<string, string>();
  if (linkedFriendIds.length > 0) {
    // 100件ずつ IN で引く
    for (let i = 0; i < linkedFriendIds.length; i += 100) {
      const chunk = linkedFriendIds.slice(i, i + 100);
      const placeholders = chunk.map(() => '?').join(',');
      const lpRows = await db
        .prepare(`SELECT friend_id, rank FROM loyalty_points WHERE friend_id IN (${placeholders})`)
        .bind(...chunk)
        .all<{ friend_id: string; rank: string }>();
      for (const r of lpRows.results ?? []) {
        if (r.rank) rankMap.set(r.friend_id, r.rank);
      }
    }
  }

  // 3. 100件ずつ UPSERT
  let withRepeat = 0;
  const CHUNK = 50;
  for (let i = 0; i < customers.length; i += CHUNK) {
    const chunk = customers.slice(i, i + CHUNK);
    const placeholders = chunk.map(() => '(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').join(',');
    const flat: (string | number | null)[] = [];
    for (const c of chunk) {
      const cohort = c.first_order_at.slice(0, 7);
      const daysToSecond = c.second_order_at
        ? Math.round(
            (new Date(c.second_order_at).getTime() - new Date(c.first_order_at).getTime()) / 86400000,
          )
        : null;
      const rank = c.friend_id ? rankMap.get(c.friend_id) ?? 'レギュラー' : null;
      if (c.second_order_at) withRepeat++;
      flat.push(
        c.shopify_customer_id,
        c.customer_id,
        c.friend_id,
        c.first_order_at,
        c.first_order_id,
        c.first_order_value,
        c.first_was_line_linked,
        c.second_order_at,
        c.second_order_id,
        c.second_order_value,
        daysToSecond,
        c.second_was_line_linked,
        c.total_orders,
        c.total_revenue,
        c.is_currently_line_linked,
        rank,
        cohort,
      );
    }
    await db
      .prepare(
        `INSERT INTO customer_journey (
           shopify_customer_id, customer_id, friend_id,
           first_order_at, first_order_id, first_order_value, first_was_line_linked,
           second_order_at, second_order_id, second_order_value, days_to_second, second_was_line_linked,
           total_orders, total_revenue,
           is_currently_line_linked, current_loyalty_rank, cohort_month
         ) VALUES ${placeholders}
         ON CONFLICT(shopify_customer_id) DO UPDATE SET
           customer_id              = excluded.customer_id,
           friend_id                = excluded.friend_id,
           first_order_at           = excluded.first_order_at,
           first_order_id           = excluded.first_order_id,
           first_order_value        = excluded.first_order_value,
           first_was_line_linked    = excluded.first_was_line_linked,
           second_order_at          = excluded.second_order_at,
           second_order_id          = excluded.second_order_id,
           second_order_value       = excluded.second_order_value,
           days_to_second           = excluded.days_to_second,
           second_was_line_linked   = excluded.second_was_line_linked,
           total_orders             = excluded.total_orders,
           total_revenue            = excluded.total_revenue,
           is_currently_line_linked = excluded.is_currently_line_linked,
           current_loyalty_rank     = excluded.current_loyalty_rank,
           cohort_month             = excluded.cohort_month,
           computed_at              = CURRENT_TIMESTAMP`,
      )
      .bind(...flat)
      .run();
  }

  return {
    total_customers: customers.length,
    with_repeat: withRepeat,
    elapsed_ms: Date.now() - startedAt,
  };
}
