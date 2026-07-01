-- ORYZAEポイント制度 2026年7月先行検証 対象者固定SQL
-- 前提: packages/db/migrations/052_oryzae_points_pilot_logs.sql 適用済み
--
-- 対象定義:
--   customers.line_user_id IS NOT NULL
--   customers.shopify_customer_id_jp IS NOT NULL
--
-- 直近30日購入者:
--   2026-06-01T00:00:00 以降に、キャンセル/void/refundedではないShopify注文がある人
--
-- 方針:
-- - 直近30日購入者には2行作る
--   - monthly_osusowake_202507_pilot: 100pt
--   - active_thanks_202507_pilot: 200pt
-- - 直近30日購入なし会員は deterministic に20%を配布、80%を検証用の非配布群にする
-- - 実行をやり直しても idempotency_key で二重作成しない

WITH eligible AS (
  SELECT
    c.customer_id,
    c.line_user_id,
    c.shopify_customer_id_jp AS shopify_customer_id,
    MIN(f.id) AS friend_id
  FROM customers c
  LEFT JOIN friends f ON f.line_user_id = c.line_user_id
  WHERE c.line_user_id IS NOT NULL
    AND c.shopify_customer_id_jp IS NOT NULL
  GROUP BY c.customer_id, c.line_user_id, c.shopify_customer_id_jp
),
recent_orders AS (
  SELECT
    e.customer_id,
    MAX(o.processed_at) AS last_order_at
  FROM eligible e
  JOIN shopify_orders o ON o.shopify_customer_id = e.shopify_customer_id
  WHERE o.cancelled_at IS NULL
    AND COALESCE(o.financial_status, '') NOT IN ('voided', 'refunded')
    AND substr(o.processed_at, 1, 19) >= '2026-06-01T00:00:00'
  GROUP BY e.customer_id
),
recent_order_ids AS (
  SELECT
    e.customer_id,
    MIN(o.shopify_order_id) AS shopify_order_id
  FROM eligible e
  JOIN recent_orders r ON r.customer_id = e.customer_id
  JOIN shopify_orders o
    ON o.shopify_customer_id = e.shopify_customer_id
   AND o.processed_at = r.last_order_at
  GROUP BY e.customer_id
),
inactive_ranked AS (
  SELECT
    e.*,
    ROW_NUMBER() OVER (ORDER BY e.line_user_id) AS rn,
    COUNT(*) OVER () AS total_count
  FROM eligible e
  WHERE e.customer_id NOT IN (SELECT customer_id FROM recent_orders)
),
grant_rows AS (
  SELECT
    'monthly_osusowake_202507_pilot:' || e.customer_id AS id,
    'monthly_osusowake_202507_pilot' AS campaign_key,
    e.customer_id,
    e.friend_id,
    e.line_user_id,
    e.shopify_customer_id,
    'active_30d' AS segment,
    100 AS points,
    '2026-07-15T23:59:59.000+09:00' AS expires_at,
    'monthly_osusowake_202507_pilot:' || e.customer_id AS idempotency_key,
    'monthly_202507:' || e.customer_id AS source_event_id,
    0 AS holdout,
    'planned' AS status,
    '毎月のおすそわけポイント ※マイページとLINEの連携をされている方にお送りします' AS reason
  FROM eligible e
  JOIN recent_orders r ON r.customer_id = e.customer_id

  UNION ALL

  SELECT
    'active_thanks_202507_pilot:' || e.customer_id AS id,
    'active_thanks_202507_pilot' AS campaign_key,
    e.customer_id,
    e.friend_id,
    e.line_user_id,
    e.shopify_customer_id,
    'active_30d' AS segment,
    200 AS points,
    '2026-07-15T23:59:59.000+09:00' AS expires_at,
    'active_thanks_202507_pilot:' || e.customer_id AS idempotency_key,
    COALESCE(roi.shopify_order_id, 'active_30d:' || e.customer_id) AS source_event_id,
    0 AS holdout,
    'planned' AS status,
    'いつもありがとうポイント ※前月にオリゼ商品をご購入の方にお送りします' AS reason
  FROM eligible e
  JOIN recent_orders r ON r.customer_id = e.customer_id
  LEFT JOIN recent_order_ids roi ON roi.customer_id = e.customer_id

  UNION ALL

  SELECT
    'monthly_osusowake_202507_pilot:' || i.customer_id AS id,
    'monthly_osusowake_202507_pilot' AS campaign_key,
    i.customer_id,
    i.friend_id,
    i.line_user_id,
    i.shopify_customer_id,
    'no_recent_purchase_30d_treatment' AS segment,
    100 AS points,
    '2026-07-15T23:59:59.000+09:00' AS expires_at,
    'monthly_osusowake_202507_pilot:' || i.customer_id AS idempotency_key,
    'monthly_202507:' || i.customer_id AS source_event_id,
    0 AS holdout,
    'planned' AS status,
    '毎月のおすそわけポイント ※マイページとLINEの連携をされている方にお送りします' AS reason
  FROM inactive_ranked i
  WHERE i.rn <= CAST((i.total_count + 4) / 5 AS INTEGER)

  UNION ALL

  SELECT
    'monthly_osusowake_202507_pilot_holdout:' || i.customer_id AS id,
    'monthly_osusowake_202507_pilot' AS campaign_key,
    i.customer_id,
    i.friend_id,
    i.line_user_id,
    i.shopify_customer_id,
    'no_recent_purchase_30d_holdout' AS segment,
    0 AS points,
    NULL AS expires_at,
    'monthly_osusowake_202507_pilot_holdout:' || i.customer_id AS idempotency_key,
    'monthly_202507:' || i.customer_id AS source_event_id,
    1 AS holdout,
    'skipped' AS status,
    '毎月のおすそわけポイント 検証用非配布群' AS reason
  FROM inactive_ranked i
  WHERE i.rn > CAST((i.total_count + 4) / 5 AS INTEGER)
)
INSERT OR IGNORE INTO loyalty_campaign_grants (
  id,
  campaign_key,
  customer_id,
  friend_id,
  line_user_id,
  shopify_customer_id,
  segment,
  points,
  expires_at,
  idempotency_key,
  source_event_id,
  holdout,
  status,
  reason,
  created_by
)
SELECT
  id,
  campaign_key,
  customer_id,
  friend_id,
  line_user_id,
  shopify_customer_id,
  segment,
  points,
  expires_at,
  idempotency_key,
  source_event_id,
  holdout,
  status,
  reason,
  'system'
FROM grant_rows;

SELECT
  campaign_key,
  segment,
  holdout,
  status,
  COUNT(*) AS rows,
  COALESCE(SUM(points), 0) AS total_points
FROM loyalty_campaign_grants
WHERE campaign_key IN ('monthly_osusowake_202507_pilot', 'active_thanks_202507_pilot')
GROUP BY campaign_key, segment, holdout, status
ORDER BY campaign_key, segment, holdout;
