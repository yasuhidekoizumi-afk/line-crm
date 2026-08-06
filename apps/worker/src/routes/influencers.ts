import { Hono } from 'hono'
import { getLineAccountByChannelId, getLineAccountById } from '@line-crm/db'
import { verifyLineUserFromToken } from '../services/email-link.js'
import { requireLineAccountAccess } from '../middleware/account-access.js'
import { notifyInfluencerRegistration } from '../services/influencer-slack-notify.js'
import type { Env } from '../index.js'

const influencers = new Hono<Env>()

type ProfileInput = {
  instagramHandle?: string | null
  categories?: string[]
  followerBand?: string | null
  contactEmail?: string | null
  contactPhone?: string | null
  ageGroup?: string | null
  gender?: string | null
  giftingInterests?: string[]
  dietaryNotes?: string | null
  hasShopifyPurchase?: boolean
  privacyConsent?: boolean
  registrationSource?: 'line' | 'manual'
  contactMethod?: 'line' | 'instagram_dm'
}
type ManualProfileInput = ProfileInput & { displayName?: string | null }
type AddressInput = {
  recipientName?: string | null
  postalCode?: string | null
  prefecture?: string | null
  addressLine1?: string | null
  addressLine2?: string | null
  phone?: string | null
}
type GiftingLogInput = {
  friendId?: string
  productName?: string
  productPageUrl?: string | null
  status?: string
  requestedAt?: string | null
  shippedAt?: string | null
  postPublishedAt?: string | null
  postType?: string | null
  postUrl?: string | null
  reach?: number | null
  impressions?: number | null
  likes?: number | null
  comments?: number | null
  saves?: number | null
  effectNotes?: string | null
}
const GIFTING_STATUSES = new Set(['requested', 'accepted', 'shipped', 'posted', 'declined', 'cancelled'])

function cleanText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed.slice(0, max) : null
}
function cleanList(value: unknown, maxItems = 10): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim().slice(0, 60))
    .filter(Boolean)
    .slice(0, maxItems)
}
function cleanDate(value: unknown): string | null {
  const date = cleanText(value, 10)
  return date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null
}
function cleanCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null
}
function isValidShippingAddress(address: AddressInput | undefined): boolean {
  if (!address) return false
  const required = [address.recipientName, address.prefecture, address.addressLine1, address.phone]
  return required.every((value) => Boolean(cleanText(value, 200))) && /^\d{3}-\d{4}$/.test(cleanText(address.postalCode, 8) ?? '')
}
function serialize(row: Record<string, unknown>) {
  return {
    friendId: row.friend_id,
    displayName: row.display_name,
    pictureUrl: row.picture_url,
    lineAccountId: row.line_account_id,
    isFollowing: Boolean(row.is_following),
    instagramHandle: row.instagram_handle,
    categories: JSON.parse((row.categories_json as string) || '[]'),
    followerBand: row.follower_band,
    contactEmail: row.contact_email,
    contactPhone: row.contact_phone,
    ageGroup: row.age_group,
    gender: row.gender,
    giftingInterests: JSON.parse((row.gifting_interests_json as string) || '[]'),
    dietaryNotes: row.dietary_notes,
    hasShopifyPurchase: Boolean(row.has_shopify_purchase),
    privacyConsentAt: row.privacy_consent_at,
    profileCompletedAt: row.profile_completed_at,
    updatedAt: row.profile_updated_at,
    registrationSource: row.registration_source ?? 'line',
    contactMethod: row.contact_method ?? 'line',
    address: row.recipient_name
      ? {
          recipientName: row.recipient_name,
          postalCode: row.postal_code,
          prefecture: row.prefecture,
          addressLine1: row.address_line1,
          addressLine2: row.address_line2,
          phone: row.address_phone,
          confirmedAt: row.confirmed_at,
        }
      : null,
  }
}

async function findFriendForAccount(db: D1Database, lineUserId: string, lineAccountId: string) {
  return db.prepare('SELECT id FROM friends WHERE line_user_id = ? AND line_account_id = ? LIMIT 1').bind(lineUserId, lineAccountId).first<{ id: string }>()
}

/**
 * 公開URLではLINEのチャネルIDを使えるようにし、DB内部IDに正規化する。
 * 管理画面や既存URLが内部IDを渡した場合もそのまま利用できる。
 */
async function resolveLineAccountId(db: D1Database, accountReference: string): Promise<string | null> {
  const byId = await getLineAccountById(db, accountReference)
  if (byId) return byId.id
  const byChannelId = await getLineAccountByChannelId(db, accountReference)
  return byChannelId?.id ?? null
}

/** 個人を再識別できない短縮ハッシュで、LIFFとWebhookの照合失敗だけを診断する。 */
async function identityFingerprint(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(digest)]
    .slice(0, 8)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

async function recordIdentityMismatch(db: D1Database, accountReference: string, lineAccountId: string, lineUserId: string): Promise<void> {
  const known = await db.prepare('SELECT line_account_id FROM friends WHERE line_user_id=? LIMIT 1').bind(lineUserId).first<{ line_account_id: string | null }>()
  const target = await db.prepare('SELECT COUNT(*) AS count FROM friends WHERE line_account_id=? AND is_following=1').bind(lineAccountId).first<{ count: number }>()
  await db
    .prepare(
      `INSERT INTO influencer_liff_diagnostics (
      id, line_account_id, account_reference, liff_user_fingerprint,
      liff_user_known_account_id, target_friend_count, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(crypto.randomUUID(), lineAccountId, accountReference, await identityFingerprint(lineUserId), known?.line_account_id ?? null, target?.count ?? 0, new Date().toISOString())
    .run()
}

async function upsertProfile(db: D1Database, friendId: string, profile: ProfileInput, address?: AddressInput) {
  const now = new Date().toISOString()
  await db
    .prepare(
      `INSERT INTO influencer_profiles (
      friend_id, instagram_handle, categories_json, follower_band, contact_email, contact_phone, age_group, gender,
      gifting_interests_json, dietary_notes, has_shopify_purchase, privacy_consent_at, profile_completed_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(friend_id) DO UPDATE SET instagram_handle=excluded.instagram_handle, categories_json=excluded.categories_json,
      follower_band=excluded.follower_band, contact_email=excluded.contact_email, contact_phone=excluded.contact_phone,
      age_group=excluded.age_group, gender=excluded.gender, gifting_interests_json=excluded.gifting_interests_json,
      dietary_notes=excluded.dietary_notes, has_shopify_purchase=excluded.has_shopify_purchase,
      privacy_consent_at=COALESCE(influencer_profiles.privacy_consent_at, excluded.privacy_consent_at),
      profile_completed_at=excluded.profile_completed_at, updated_at=excluded.updated_at`
    )
    .bind(friendId, cleanText(profile.instagramHandle, 80), JSON.stringify(cleanList(profile.categories)), cleanText(profile.followerBand, 40), cleanText(profile.contactEmail, 254), cleanText(profile.contactPhone, 30), cleanText(profile.ageGroup, 30), cleanText(profile.gender, 30), JSON.stringify(cleanList(profile.giftingInterests)), cleanText(profile.dietaryNotes, 1000), profile.hasShopifyPurchase ? 1 : 0, profile.privacyConsent ? now : null, now, now)
    .run()
  if (address) await upsertShippingAddress(db, friendId, address)
}

async function upsertShippingAddress(db: D1Database, friendId: string, address: AddressInput) {
  const now = new Date().toISOString()
  await db
    .prepare(
      `INSERT INTO influencer_shipping_addresses (friend_id, recipient_name, postal_code, prefecture, address_line1, address_line2, phone, confirmed_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(friend_id) DO UPDATE SET recipient_name=excluded.recipient_name, postal_code=excluded.postal_code,
      prefecture=excluded.prefecture, address_line1=excluded.address_line1, address_line2=excluded.address_line2,
      phone=excluded.phone, confirmed_at=excluded.confirmed_at, updated_at=excluded.updated_at`
    )
    .bind(friendId, cleanText(address.recipientName, 100), cleanText(address.postalCode, 20), cleanText(address.prefecture, 30), cleanText(address.addressLine1, 200), cleanText(address.addressLine2, 200), cleanText(address.phone, 30), now, now)
    .run()
}

async function profileRow(db: D1Database, friendId: string) {
  return db
    .prepare(
      `SELECT f.id AS friend_id, f.display_name, f.picture_url, f.line_account_id, f.is_following,
      p.instagram_handle, p.categories_json, p.follower_band, p.contact_email, p.contact_phone, p.age_group, p.gender,
      p.gifting_interests_json, p.dietary_notes, p.has_shopify_purchase, p.privacy_consent_at, p.profile_completed_at, p.updated_at AS profile_updated_at,
      CASE WHEN f.line_user_id LIKE 'manual:%' THEN 'manual' ELSE 'line' END AS registration_source,
      CASE WHEN f.line_user_id LIKE 'manual:%' THEN 'instagram_dm' ELSE 'line' END AS contact_method,
      a.recipient_name, a.postal_code, a.prefecture, a.address_line1, a.address_line2, a.phone AS address_phone, a.confirmed_at
    FROM friends f LEFT JOIN influencer_profiles p ON p.friend_id=f.id
    LEFT JOIN influencer_shipping_addresses a ON a.friend_id=f.id WHERE f.id=?`
    )
    .bind(friendId)
    .first<Record<string, unknown>>()
}

function serializeGiftingLog(row: Record<string, unknown>) {
  return {
    id: row.id,
    friendId: row.friend_id,
    lineAccountId: row.line_account_id,
    creatorName: row.display_name,
    instagramHandle: row.instagram_handle,
    productName: row.product_name,
    productPageUrl: row.product_page_url,
    status: row.status,
    requestedAt: row.requested_at,
    shippedAt: row.shipped_at,
    postPublishedAt: row.post_published_at,
    postType: row.post_type,
    postUrl: row.post_url,
    reach: row.reach,
    impressions: row.impressions,
    likes: row.likes,
    comments: row.comments,
    saves: row.saves,
    effectNotes: row.effect_notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

async function giftingLogRow(db: D1Database, id: string) {
  return db
    .prepare(
      `SELECT g.*, f.display_name, p.instagram_handle
    FROM influencer_gifting_logs g
    INNER JOIN friends f ON f.id = g.friend_id
    LEFT JOIN influencer_profiles p ON p.friend_id = g.friend_id
    WHERE g.id=?`
    )
    .bind(id)
    .first<Record<string, unknown>>()
}

function giftingLogValues(input: GiftingLogInput) {
  const status = typeof input.status === 'string' && GIFTING_STATUSES.has(input.status) ? input.status : 'requested'
  return {
    productName: cleanText(input.productName, 160),
    productPageUrl: cleanText(input.productPageUrl, 1000),
    status,
    requestedAt: cleanDate(input.requestedAt),
    shippedAt: cleanDate(input.shippedAt),
    postPublishedAt: cleanDate(input.postPublishedAt),
    postType: cleanText(input.postType, 40),
    postUrl: cleanText(input.postUrl, 1000),
    reach: cleanCount(input.reach),
    impressions: cleanCount(input.impressions),
    likes: cleanCount(input.likes),
    comments: cleanCount(input.comments),
    saves: cleanCount(input.saves),
    effectNotes: cleanText(input.effectNotes, 2000),
  }
}

// LIFF: 本人だけが自分のプロフィールを取得・更新する。アカウント指定で別公式LINEとの混線を防ぐ。
influencers.post('/api/liff/influencer-profile', async (c) => {
  const body = await c.req.json<{
    accessToken?: string
    idToken?: string
    lineAccountId?: string
  }>()
  if (!body.lineAccountId) return c.json({ success: false, error: 'lineAccountId is required' }, 400)
  const verified = await verifyLineUserFromToken(c.env, body)
  if (!verified.ok) return c.json({ success: false, error: verified.error }, verified.status)
  const lineAccountId = await resolveLineAccountId(c.env.DB, body.lineAccountId)
  if (!lineAccountId) return c.json({ success: false, error: 'LINE公式アカウントが見つかりません' }, 404)
  const friend = await findFriendForAccount(c.env.DB, verified.lineUserId, lineAccountId)
  if (!friend) {
    await recordIdentityMismatch(c.env.DB, body.lineAccountId, lineAccountId, verified.lineUserId)
    return c.json({ success: false, error: 'この公式LINEの友だちとして確認できません' }, 403)
  }
  const row = await profileRow(c.env.DB, friend.id)
  return c.json({ success: true, data: row ? serialize(row) : null })
})

influencers.put('/api/liff/influencer-profile', async (c) => {
  const body = await c.req.json<{
    accessToken?: string
    idToken?: string
    lineAccountId?: string
    profile?: ProfileInput
    address?: AddressInput
  }>()
  if (!body.lineAccountId || !body.profile?.privacyConsent) return c.json({ success: false, error: '同意とlineAccountIdは必須です' }, 400)
  if (!isValidShippingAddress(body.address))
    return c.json(
      {
        success: false,
        error: '発送先の必須項目を入力し、郵便番号は123-4567形式で入力してください',
      },
      400
    )
  const verified = await verifyLineUserFromToken(c.env, body)
  if (!verified.ok) return c.json({ success: false, error: verified.error }, verified.status)
  const lineAccountId = await resolveLineAccountId(c.env.DB, body.lineAccountId)
  if (!lineAccountId) return c.json({ success: false, error: 'LINE公式アカウントが見つかりません' }, 404)
  const friend = await findFriendForAccount(c.env.DB, verified.lineUserId, lineAccountId)
  if (!friend) {
    await recordIdentityMismatch(c.env.DB, body.lineAccountId, lineAccountId, verified.lineUserId)
    return c.json({ success: false, error: 'この公式LINEの友だちとして確認できません' }, 403)
  }
  const existingProfile = await c.env.DB.prepare('SELECT friend_id FROM influencer_profiles WHERE friend_id=? LIMIT 1').bind(friend.id).first()
  await upsertProfile(c.env.DB, friend.id, body.profile, body.address)
  if (!existingProfile) {
    await notifyInfluencerRegistration(c.env, {
      lineAccountId,
      registrationSource: 'line',
    })
  }
  return c.json({
    success: true,
    data: serialize((await profileRow(c.env.DB, friend.id))!),
  })
})

// 配送先だけをいつでも変更できる専用画面。プロフィール本体は変更しない。
influencers.post('/api/liff/influencer-shipping-address', async (c) => {
  const body = await c.req.json<{
    accessToken?: string
    idToken?: string
    lineAccountId?: string
  }>()
  if (!body.lineAccountId) return c.json({ success: false, error: 'lineAccountId is required' }, 400)
  const verified = await verifyLineUserFromToken(c.env, body)
  if (!verified.ok) return c.json({ success: false, error: verified.error }, verified.status)
  const lineAccountId = await resolveLineAccountId(c.env.DB, body.lineAccountId)
  if (!lineAccountId) return c.json({ success: false, error: 'LINE公式アカウントが見つかりません' }, 404)
  const friend = await findFriendForAccount(c.env.DB, verified.lineUserId, lineAccountId)
  if (!friend) return c.json({ success: false, error: 'この公式LINEの友だちとして確認できません' }, 403)
  return c.json({
    success: true,
    data: serialize((await profileRow(c.env.DB, friend.id))!),
  })
})

influencers.put('/api/liff/influencer-shipping-address', async (c) => {
  const body = await c.req.json<{
    accessToken?: string
    idToken?: string
    lineAccountId?: string
    address?: AddressInput
  }>()
  if (!body.lineAccountId || !isValidShippingAddress(body.address))
    return c.json(
      {
        success: false,
        error: '発送先の必須項目を入力し、郵便番号は123-4567形式で入力してください',
      },
      400
    )
  const verified = await verifyLineUserFromToken(c.env, body)
  if (!verified.ok) return c.json({ success: false, error: verified.error }, verified.status)
  const lineAccountId = await resolveLineAccountId(c.env.DB, body.lineAccountId)
  if (!lineAccountId) return c.json({ success: false, error: 'LINE公式アカウントが見つかりません' }, 404)
  const friend = await findFriendForAccount(c.env.DB, verified.lineUserId, lineAccountId)
  if (!friend) return c.json({ success: false, error: 'この公式LINEの友だちとして確認できません' }, 403)
  await upsertShippingAddress(c.env.DB, friend.id, body.address!)
  return c.json({
    success: true,
    data: serialize((await profileRow(c.env.DB, friend.id))!),
  })
})

influencers.get('/api/influencers', async (c) => {
  const lineAccountId = c.req.query('lineAccountId')
  const denied = await requireLineAccountAccess(c, lineAccountId)
  if (denied) return denied
  const q = cleanText(c.req.query('q'), 100)
  const contactMethod = c.req.query('contactMethod')
  if (contactMethod && contactMethod !== 'line' && contactMethod !== 'instagram_dm') {
    return c.json({ success: false, error: '連絡手段が不正です' }, 400)
  }
  const result = await c.env.DB.prepare(
    `SELECT f.id AS friend_id, f.display_name, f.picture_url, f.line_account_id, f.is_following,
      p.instagram_handle, p.categories_json, p.follower_band, p.contact_email, p.contact_phone, p.age_group, p.gender,
      p.gifting_interests_json, p.dietary_notes, p.has_shopify_purchase, p.privacy_consent_at, p.profile_completed_at, p.updated_at AS profile_updated_at,
      CASE WHEN f.line_user_id LIKE 'manual:%' THEN 'manual' ELSE 'line' END AS registration_source,
      CASE WHEN f.line_user_id LIKE 'manual:%' THEN 'instagram_dm' ELSE 'line' END AS contact_method,
      a.recipient_name, a.postal_code, a.prefecture, a.address_line1, a.address_line2, a.phone AS address_phone, a.confirmed_at
    FROM friends f INNER JOIN influencer_profiles p ON p.friend_id=f.id
    LEFT JOIN influencer_shipping_addresses a ON a.friend_id=f.id
    WHERE f.line_account_id=? ${contactMethod === 'instagram_dm' ? "AND f.line_user_id LIKE 'manual:%'" : contactMethod === 'line' ? "AND f.line_user_id NOT LIKE 'manual:%'" : ''} ${q ? 'AND (f.display_name LIKE ? OR p.instagram_handle LIKE ?)' : ''}
    ORDER BY p.updated_at DESC LIMIT 200`
  )
    .bind(lineAccountId!, ...(q ? [`%${q}%`, `%${q}%`] : []))
    .all<Record<string, unknown>>()
  return c.json({ success: true, data: result.results.map(serialize) })
})

// LINEを使わないクリエイターを、担当者がInstagram DM運用として登録する。
influencers.post('/api/influencers/manual', async (c) => {
  const body = await c.req.json<{
    lineAccountId?: string
    profile?: ManualProfileInput
    address?: AddressInput
  }>()
  const denied = await requireLineAccountAccess(c, body.lineAccountId, true)
  if (denied) return denied
  const displayName = cleanText(body.profile?.displayName, 100)
  const instagramHandle = cleanText(body.profile?.instagramHandle, 80)
  const hasRequiredProfile = Boolean(displayName && instagramHandle && cleanList(body.profile?.categories).length > 0 && cleanText(body.profile?.followerBand, 40) && cleanText(body.profile?.contactEmail, 254) && body.profile?.privacyConsent)
  if (!hasRequiredProfile || !isValidShippingAddress(body.address)) {
    return c.json(
      {
        success: false,
        error: '必須プロフィール、本人同意、配送先を確認してください。郵便番号は123-4567形式で入力してください',
      },
      400
    )
  }
  const id = crypto.randomUUID()
  const now = new Date().toISOString()
  await c.env.DB.prepare(
    `INSERT INTO friends (
      id, line_user_id, display_name, is_following, line_account_id, created_at, updated_at
    ) VALUES (?, ?, ?, 0, ?, ?, ?)`
  )
    .bind(id, `manual:${id}`, displayName, body.lineAccountId, now, now)
    .run()
  await upsertProfile(
    c.env.DB,
    id,
    {
      ...body.profile,
      instagramHandle,
      registrationSource: 'manual',
      contactMethod: 'instagram_dm',
      privacyConsent: true,
    },
    body.address
  )
  await notifyInfluencerRegistration(c.env, {
    lineAccountId: body.lineAccountId!,
    registrationSource: 'manual',
  })
  return c.json({ success: true, data: serialize((await profileRow(c.env.DB, id))!) }, 201)
})

influencers.patch('/api/influencers/:friendId', async (c) => {
  const existing = await c.env.DB.prepare('SELECT line_account_id FROM friends WHERE id=?').bind(c.req.param('friendId')).first<{ line_account_id: string | null }>()
  const denied = await requireLineAccountAccess(c, existing?.line_account_id)
  if (denied) return denied
  const body = await c.req.json<{
    profile: ProfileInput
    address?: AddressInput
  }>()
  await upsertProfile(c.env.DB, c.req.param('friendId'), body.profile ?? {}, body.address)
  const updated = await profileRow(c.env.DB, c.req.param('friendId'))
  return c.json({ success: true, data: serialize(updated!) })
})

// ギフティング案件の台帳。商品ページ、送付日、投稿URLと手入力の効果指標を案件単位で保存する。
influencers.get('/api/influencer-gifting', async (c) => {
  const lineAccountId = c.req.query('lineAccountId')
  const denied = await requireLineAccountAccess(c, lineAccountId)
  if (denied) return denied
  const result = await c.env.DB.prepare(
    `SELECT g.*, f.display_name, p.instagram_handle
    FROM influencer_gifting_logs g
    INNER JOIN friends f ON f.id = g.friend_id
    LEFT JOIN influencer_profiles p ON p.friend_id = g.friend_id
    WHERE g.line_account_id=? ORDER BY COALESCE(g.post_published_at, g.shipped_at, g.requested_at, g.created_at) DESC LIMIT 500`
  )
    .bind(lineAccountId!)
    .all<Record<string, unknown>>()
  return c.json({
    success: true,
    data: result.results.map(serializeGiftingLog),
  })
})

influencers.post('/api/influencer-gifting', async (c) => {
  const body = await c.req.json<GiftingLogInput & { lineAccountId?: string }>()
  const denied = await requireLineAccountAccess(c, body.lineAccountId, true)
  if (denied) return denied
  if (!body.friendId || !cleanText(body.productName, 160)) return c.json({ success: false, error: 'クリエイターと商品名は必須です' }, 400)
  const friend = await c.env.DB.prepare('SELECT id FROM friends WHERE id=? AND line_account_id=?').bind(body.friendId, body.lineAccountId).first()
  if (!friend)
    return c.json(
      {
        success: false,
        error: '選択中のLINEアカウントのクリエイターではありません',
      },
      400
    )
  const values = giftingLogValues(body)
  const id = crypto.randomUUID()
  const now = new Date().toISOString()
  await c.env.DB.prepare(
    `INSERT INTO influencer_gifting_logs (
    id, friend_id, line_account_id, product_name, product_page_url, status, requested_at, shipped_at, post_published_at,
    post_type, post_url, reach, impressions, likes, comments, saves, effect_notes, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(id, body.friendId, body.lineAccountId, values.productName, values.productPageUrl, values.status, values.requestedAt, values.shippedAt, values.postPublishedAt, values.postType, values.postUrl, values.reach, values.impressions, values.likes, values.comments, values.saves, values.effectNotes, now, now)
    .run()
  return c.json(
    {
      success: true,
      data: serializeGiftingLog((await giftingLogRow(c.env.DB, id))!),
    },
    201
  )
})

influencers.patch('/api/influencer-gifting/:id', async (c) => {
  const existing = await giftingLogRow(c.env.DB, c.req.param('id'))
  if (!existing) return c.json({ success: false, error: 'ギフティング履歴が見つかりません' }, 404)
  const denied = await requireLineAccountAccess(c, existing.line_account_id as string, true)
  if (denied) return denied
  const body = await c.req.json<GiftingLogInput>()
  const values = giftingLogValues({ ...existing, ...body })
  if (!values.productName) return c.json({ success: false, error: '商品名は必須です' }, 400)
  await c.env.DB.prepare(
    `UPDATE influencer_gifting_logs SET
    product_name=?, product_page_url=?, status=?, requested_at=?, shipped_at=?, post_published_at=?, post_type=?, post_url=?,
    reach=?, impressions=?, likes=?, comments=?, saves=?, effect_notes=?, updated_at=? WHERE id=?`
  )
    .bind(values.productName, values.productPageUrl, values.status, values.requestedAt, values.shippedAt, values.postPublishedAt, values.postType, values.postUrl, values.reach, values.impressions, values.likes, values.comments, values.saves, values.effectNotes, new Date().toISOString(), c.req.param('id'))
    .run()
  return c.json({
    success: true,
    data: serializeGiftingLog((await giftingLogRow(c.env.DB, c.req.param('id')))!),
  })
})

export { influencers }
