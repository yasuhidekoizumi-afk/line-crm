/**
 * FERMENT バックフィル：既存 friends + loyalty_points → customers への一括移行
 *
 * 設計方針:
 * - Worker 単体実行で Shopify API レート制限（2 req/s）と CPU 制限（30秒）を両立させるため、
 *   1バッチ = 50件 の小分け処理。呼び出し側がオフセットをインクリメントしてループ。
 * - LINE 友だち全員を customers に投入（Shopify 未紐付けは email=NULL で保持）
 * - Shopify 紐付けあり → Admin API で email / total_spent / orders_count を取得
 */

import { Hono } from 'hono'
import { generateFermentId, upsertCustomer } from '@line-crm/db'
import type { FermentEnv } from './types'

const BATCH_SIZE = 50
const SHOPIFY_RATE_MS = 550 // ~1.8 req/s に抑える

export const backfillRoutes = new Hono<FermentEnv>()

/**
 * バッチ1回分を処理。
 * Body: { offset?: number, limit?: number, region?: 'JP' | 'US' }
 * Response: { processed, synced_from_shopify, next_offset, done }
 */
backfillRoutes.post('/customers', async (c) => {
  const body = await c.req.json<{ offset?: number; limit?: number; region?: 'JP' | 'US' }>()
    .catch(() => ({} as { offset?: number; limit?: number; region?: 'JP' | 'US' }))
  const offset = body.offset ?? 0
  const limit = Math.min(body.limit ?? BATCH_SIZE, 100)
  const region = body.region ?? 'JP'

  const db = c.env.DB
  const shopifyDomain = c.env.SHOPIFY_SHOP_DOMAIN
  const shopifyToken = c.env.SHOPIFY_ADMIN_TOKEN

  // friends + loyalty_points を LEFT JOIN
  const rows = await db.prepare(`
    SELECT
      f.id                       AS friend_id,
      f.line_user_id             AS line_user_id,
      f.display_name             AS display_name,
      f.created_at               AS friend_created_at,
      lp.shopify_customer_id     AS shopify_customer_id,
      lp.total_spent             AS total_spent,
      lp.balance                 AS balance,
      lp.rank                    AS rank
    FROM friends f
    LEFT JOIN loyalty_points lp ON lp.friend_id = f.id
    WHERE f.is_following = 1
    ORDER BY f.created_at ASC
    LIMIT ? OFFSET ?
  `).bind(limit, offset).all<{
    friend_id: string
    line_user_id: string
    display_name: string | null
    friend_created_at: string
    shopify_customer_id: string | null
    total_spent: number | null
    balance: number | null
    rank: string | null
  }>()

  let synced = 0
  let skipped = 0

  for (const row of rows.results ?? []) {
    let email: string | null = null
    let orderCount = 0
    let lastOrderAt: string | null = null
    let ltv = row.total_spent ?? 0
    const tags: string[] = []
    if (row.rank) tags.push(`rank:${row.rank}`)

    // Shopify 紐付けがあれば email と orders_count を取得
    if (row.shopify_customer_id && shopifyDomain && shopifyToken) {
      try {
        const shopifyRes = await fetch(
          `https://${shopifyDomain}/admin/api/2024-01/customers/${row.shopify_customer_id}.json`,
          {
            headers: {
              'X-Shopify-Access-Token': shopifyToken,
              'Content-Type': 'application/json',
            },
          }
        )
        if (shopifyRes.ok) {
          const json = await shopifyRes.json<{
            customer?: {
              email: string | null
              orders_count: number
              total_spent: string
              last_order_name?: string
              updated_at: string
              tags: string
            }
          }>()
          if (json.customer) {
            email = json.customer.email
            orderCount = json.customer.orders_count
            lastOrderAt = json.customer.updated_at
            // Shopify の total_spent は文字列の金額（USD / JPY 両対応のため Math.floor）
            const shopifyLtv = Math.floor(parseFloat(json.customer.total_spent ?? '0'))
            if (shopifyLtv > ltv) ltv = shopifyLtv
            if (json.customer.tags) {
              tags.push(...json.customer.tags.split(',').map((t) => t.trim()).filter(Boolean))
            }
          }
        }
        // レート制限対応
        await new Promise((r) => setTimeout(r, SHOPIFY_RATE_MS))
      } catch (err) {
        console.error(`Shopify fetch failed for ${row.shopify_customer_id}:`, err)
      }
    }

    try {
      // line_user_id で既存 customer を探す（再実行時の重複回避）
      const existing = await db.prepare(
        'SELECT customer_id FROM customers WHERE line_user_id = ?'
      ).bind(row.line_user_id).first<{ customer_id: string }>();
      const customerId = existing?.customer_id ?? generateFermentId('cu');

      await upsertCustomer(db, {
        customer_id: customerId,
        email,
        line_user_id: row.line_user_id,
        display_name: row.display_name,
        region,
        language: region === 'US' ? 'en' : 'ja',
        ltv,
        ltv_currency: region === 'US' ? 'USD' : 'JPY',
        order_count: orderCount,
        last_order_at: lastOrderAt,
        subscribed_email: email ? 1 : 0, // メールあれば暫定で購読扱い
        tags: tags.length > 0 ? tags.join(',') : null,
      })
      synced++
    } catch (err) {
      console.error(`Upsert failed for friend ${row.friend_id}:`, err)
      skipped++
    }
  }

  const processed = rows.results?.length ?? 0
  const done = processed < limit

  return c.json({
    success: true,
    data: {
      processed,
      synced,
      skipped,
      next_offset: offset + processed,
      done,
    },
  })
})

/**
 * POST /shopify-customers
 * Shopify Admin API から全顧客を一括取得して customers テーブルに upsert。
 * Body: { page_info?: string, region?: 'JP' | 'US' }
 * Response: { processed, synced, skipped, next_page_info, done }
 */
backfillRoutes.post('/shopify-customers', async (c) => {
  const body = await c.req.json<{ page_info?: string; since_id?: string; region?: 'JP' | 'US' }>()
    .catch(() => ({} as { page_info?: string; since_id?: string; region?: 'JP' | 'US' }))
  const region = body.region ?? 'JP'
  const pageInfo = body.page_info
  const sinceId = body.since_id

  const db = c.env.DB
  const shopifyDomain = c.env.SHOPIFY_SHOP_DOMAIN
  const shopifyToken = c.env.SHOPIFY_ADMIN_TOKEN

  if (!shopifyDomain || !shopifyToken) {
    return c.json({ success: false, error: 'Shopify credentials not configured' }, 500)
  }

  // Shopify Admin API: 250件/req のページング
  let url = `https://${shopifyDomain}/admin/api/2024-01/customers.json?limit=250`
  if (pageInfo) {
    url += `&page_info=${encodeURIComponent(pageInfo)}`
  } else if (sinceId) {
    url += `&since_id=${encodeURIComponent(sinceId)}`
  }

  const shopifyRes = await fetch(url, {
    headers: { 'X-Shopify-Access-Token': shopifyToken, 'Content-Type': 'application/json' },
  })
  if (!shopifyRes.ok) {
    const text = await shopifyRes.text()
    return c.json({ success: false, error: `Shopify API ${shopifyRes.status}: ${text.slice(0, 200)}` }, 500)
  }

  const json = await shopifyRes.json<{
    customers: Array<{
      id: number
      email: string | null
      first_name: string | null
      last_name: string | null
      orders_count: number
      total_spent: string
      tags: string
      created_at: string
      updated_at: string
      last_order_id?: number | null
      accepts_marketing: boolean
      email_marketing_consent?: { state: string } | null
    }>
  }>()

  // Link header から next page_info を抽出
  const linkHeader = shopifyRes.headers.get('link') ?? shopifyRes.headers.get('Link')
  let nextPageInfo: string | null = null
  if (linkHeader) {
    const m = linkHeader.match(/<[^>]*[?&]page_info=([^&>]+)[^>]*>;\s*rel="next"/)
    if (m) nextPageInfo = decodeURIComponent(m[1])
  }

  let synced = 0
  let skipped = 0

  // shopify_customer_id_jp / _us の選択
  const shopifyIdField = region === 'US' ? 'shopify_customer_id_us' : 'shopify_customer_id_jp'

  for (const sc of json.customers) {
    try {
      const shopifyIdStr = String(sc.id)
      // 既存 customer を検索（shopify_customer_id 経由 or email 経由）
      const existing = await db.prepare(
        `SELECT customer_id FROM customers WHERE ${shopifyIdField} = ? OR (email IS NOT NULL AND email = ?) LIMIT 1`
      ).bind(shopifyIdStr, sc.email ?? '').first<{ customer_id: string }>()

      const customerId = existing?.customer_id ?? generateFermentId('cu')

      // loyalty_points 経由で line_user_id を逆引き
      const lpRow = await db.prepare(
        'SELECT f.line_user_id, f.display_name FROM loyalty_points lp JOIN friends f ON f.id = lp.friend_id WHERE lp.shopify_customer_id = ? LIMIT 1'
      ).bind(shopifyIdStr).first<{ line_user_id: string; display_name: string | null }>()

      const displayName = sc.first_name || sc.last_name
        ? `${sc.first_name ?? ''} ${sc.last_name ?? ''}`.trim()
        : lpRow?.display_name ?? null

      const isSubscribed = sc.email
        ? (sc.email_marketing_consent?.state === 'subscribed' || sc.accepts_marketing ? 1 : 0)
        : 0

      const tags: string[] = []
      if (sc.tags) tags.push(...sc.tags.split(',').map((t) => t.trim()).filter(Boolean))

      await upsertCustomer(db, {
        customer_id: customerId,
        email: sc.email,
        line_user_id: lpRow?.line_user_id ?? null,
        [shopifyIdField]: shopifyIdStr,
        display_name: displayName,
        region,
        language: region === 'US' ? 'en' : 'ja',
        ltv: Math.floor(parseFloat(sc.total_spent ?? '0')),
        ltv_currency: region === 'US' ? 'USD' : 'JPY',
        order_count: sc.orders_count,
        last_order_at: sc.updated_at,
        subscribed_email: isSubscribed,
        tags: tags.length > 0 ? tags.join(',') : null,
      } as Parameters<typeof upsertCustomer>[1])
      synced++
    } catch (err) {
      console.error(`Shopify customer upsert failed for ${sc.id}:`, err)
      skipped++
    }
  }

  return c.json({
    success: true,
    data: {
      processed: json.customers.length,
      synced,
      skipped,
      next_page_info: nextPageInfo,
      done: !nextPageInfo,
    },
  })
})

/**
 * GET /customers/status - バックフィル進捗確認
 */
backfillRoutes.get('/customers/status', async (c) => {
  const db = c.env.DB
  const totalFriends = await db.prepare('SELECT COUNT(*) as n FROM friends WHERE is_following = 1').first<{ n: number }>()
  const totalCustomers = await db.prepare('SELECT COUNT(*) as n FROM customers').first<{ n: number }>()
  const withEmail = await db.prepare('SELECT COUNT(*) as n FROM customers WHERE email IS NOT NULL').first<{ n: number }>()

  return c.json({
    success: true,
    data: {
      total_friends: totalFriends?.n ?? 0,
      total_customers: totalCustomers?.n ?? 0,
      with_email: withEmail?.n ?? 0,
      progress_pct: totalFriends?.n ? Math.round(((totalCustomers?.n ?? 0) / totalFriends.n) * 100) : 0,
    },
  })
})
