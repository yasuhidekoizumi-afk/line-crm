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

export const backfillRoutes = new Hono<{ Bindings: FermentEnv }>()

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
      await upsertCustomer(db, {
        customer_id: generateFermentId('cu'),
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
