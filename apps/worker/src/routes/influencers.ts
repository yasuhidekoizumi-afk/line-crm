import { Hono } from 'hono';
import { getLineAccountByChannelId, getLineAccountById } from '@line-crm/db';
import { verifyLineUserFromToken } from '../services/email-link.js';
import { requireLineAccountAccess } from '../middleware/account-access.js';
import type { Env } from '../index.js';

const influencers = new Hono<Env>();

type ProfileInput = {
  instagramHandle?: string | null; categories?: string[]; followerBand?: string | null;
  contactEmail?: string | null; contactPhone?: string | null; ageGroup?: string | null;
  gender?: string | null; giftingInterests?: string[]; dietaryNotes?: string | null;
  privacyConsent?: boolean;
};
type AddressInput = {
  recipientName?: string | null; postalCode?: string | null; prefecture?: string | null;
  addressLine1?: string | null; addressLine2?: string | null; phone?: string | null;
};

function cleanText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}
function cleanList(value: unknown, maxItems = 10): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string').map((item) => item.trim().slice(0, 60)).filter(Boolean).slice(0, maxItems);
}
function serialize(row: Record<string, unknown>) {
  return {
    friendId: row.friend_id, displayName: row.display_name, pictureUrl: row.picture_url,
    lineAccountId: row.line_account_id, isFollowing: Boolean(row.is_following),
    instagramHandle: row.instagram_handle, categories: JSON.parse((row.categories_json as string) || '[]'),
    followerBand: row.follower_band, contactEmail: row.contact_email, contactPhone: row.contact_phone,
    ageGroup: row.age_group, gender: row.gender, giftingInterests: JSON.parse((row.gifting_interests_json as string) || '[]'),
    dietaryNotes: row.dietary_notes, privacyConsentAt: row.privacy_consent_at,
    profileCompletedAt: row.profile_completed_at, updatedAt: row.profile_updated_at,
    address: row.recipient_name ? { recipientName: row.recipient_name, postalCode: row.postal_code, prefecture: row.prefecture, addressLine1: row.address_line1, addressLine2: row.address_line2, phone: row.address_phone, confirmedAt: row.confirmed_at } : null,
  };
}

async function findFriendForAccount(db: D1Database, lineUserId: string, lineAccountId: string) {
  return db.prepare('SELECT id FROM friends WHERE line_user_id = ? AND line_account_id = ? LIMIT 1')
    .bind(lineUserId, lineAccountId).first<{ id: string }>();
}

/**
 * 公開URLではLINEのチャネルIDを使えるようにし、DB内部IDに正規化する。
 * 管理画面や既存URLが内部IDを渡した場合もそのまま利用できる。
 */
async function resolveLineAccountId(db: D1Database, accountReference: string): Promise<string | null> {
  const byId = await getLineAccountById(db, accountReference);
  if (byId) return byId.id;
  const byChannelId = await getLineAccountByChannelId(db, accountReference);
  return byChannelId?.id ?? null;
}

async function upsertProfile(db: D1Database, friendId: string, profile: ProfileInput, address?: AddressInput) {
  const now = new Date().toISOString();
  await db.prepare(`INSERT INTO influencer_profiles (
      friend_id, instagram_handle, categories_json, follower_band, contact_email, contact_phone, age_group, gender,
      gifting_interests_json, dietary_notes, privacy_consent_at, profile_completed_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(friend_id) DO UPDATE SET instagram_handle=excluded.instagram_handle, categories_json=excluded.categories_json,
      follower_band=excluded.follower_band, contact_email=excluded.contact_email, contact_phone=excluded.contact_phone,
      age_group=excluded.age_group, gender=excluded.gender, gifting_interests_json=excluded.gifting_interests_json,
      dietary_notes=excluded.dietary_notes, privacy_consent_at=COALESCE(influencer_profiles.privacy_consent_at, excluded.privacy_consent_at),
      profile_completed_at=excluded.profile_completed_at, updated_at=excluded.updated_at`)
    .bind(friendId, cleanText(profile.instagramHandle, 80), JSON.stringify(cleanList(profile.categories)), cleanText(profile.followerBand, 40),
      cleanText(profile.contactEmail, 254), cleanText(profile.contactPhone, 30), cleanText(profile.ageGroup, 30), cleanText(profile.gender, 30),
      JSON.stringify(cleanList(profile.giftingInterests)), cleanText(profile.dietaryNotes, 1000), profile.privacyConsent ? now : null, now, now).run();
  if (address) {
    await db.prepare(`INSERT INTO influencer_shipping_addresses (friend_id, recipient_name, postal_code, prefecture, address_line1, address_line2, phone, confirmed_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(friend_id) DO UPDATE SET recipient_name=excluded.recipient_name, postal_code=excluded.postal_code,
      prefecture=excluded.prefecture, address_line1=excluded.address_line1, address_line2=excluded.address_line2,
      phone=excluded.phone, confirmed_at=excluded.confirmed_at, updated_at=excluded.updated_at`)
      .bind(friendId, cleanText(address.recipientName, 100), cleanText(address.postalCode, 20), cleanText(address.prefecture, 30),
        cleanText(address.addressLine1, 200), cleanText(address.addressLine2, 200), cleanText(address.phone, 30), now, now).run();
  }
}

async function profileRow(db: D1Database, friendId: string) {
  return db.prepare(`SELECT f.id AS friend_id, f.display_name, f.picture_url, f.line_account_id, f.is_following,
      p.instagram_handle, p.categories_json, p.follower_band, p.contact_email, p.contact_phone, p.age_group, p.gender,
      p.gifting_interests_json, p.dietary_notes, p.privacy_consent_at, p.profile_completed_at, p.updated_at AS profile_updated_at,
      a.recipient_name, a.postal_code, a.prefecture, a.address_line1, a.address_line2, a.phone AS address_phone, a.confirmed_at
    FROM friends f LEFT JOIN influencer_profiles p ON p.friend_id=f.id
    LEFT JOIN influencer_shipping_addresses a ON a.friend_id=f.id WHERE f.id=?`).bind(friendId).first<Record<string, unknown>>();
}

// LIFF: 本人だけが自分のプロフィールを取得・更新する。アカウント指定で別公式LINEとの混線を防ぐ。
influencers.post('/api/liff/influencer-profile', async (c) => {
  const body = await c.req.json<{ accessToken?: string; idToken?: string; lineAccountId?: string }>();
  if (!body.lineAccountId) return c.json({ success: false, error: 'lineAccountId is required' }, 400);
  const verified = await verifyLineUserFromToken(c.env, body);
  if (!verified.ok) return c.json({ success: false, error: verified.error }, verified.status);
  const lineAccountId = await resolveLineAccountId(c.env.DB, body.lineAccountId);
  if (!lineAccountId) return c.json({ success: false, error: 'LINE公式アカウントが見つかりません' }, 404);
  const friend = await findFriendForAccount(c.env.DB, verified.lineUserId, lineAccountId);
  if (!friend) return c.json({ success: false, error: 'この公式LINEの友だちとして確認できません' }, 403);
  const row = await profileRow(c.env.DB, friend.id);
  return c.json({ success: true, data: row ? serialize(row) : null });
});

influencers.put('/api/liff/influencer-profile', async (c) => {
  const body = await c.req.json<{ accessToken?: string; idToken?: string; lineAccountId?: string; profile?: ProfileInput; address?: AddressInput }>();
  if (!body.lineAccountId || !body.profile?.privacyConsent) return c.json({ success: false, error: '同意とlineAccountIdは必須です' }, 400);
  const verified = await verifyLineUserFromToken(c.env, body);
  if (!verified.ok) return c.json({ success: false, error: verified.error }, verified.status);
  const lineAccountId = await resolveLineAccountId(c.env.DB, body.lineAccountId);
  if (!lineAccountId) return c.json({ success: false, error: 'LINE公式アカウントが見つかりません' }, 404);
  const friend = await findFriendForAccount(c.env.DB, verified.lineUserId, lineAccountId);
  if (!friend) return c.json({ success: false, error: 'この公式LINEの友だちとして確認できません' }, 403);
  await upsertProfile(c.env.DB, friend.id, body.profile, body.address);
  return c.json({ success: true, data: serialize((await profileRow(c.env.DB, friend.id))!) });
});

influencers.get('/api/influencers', async (c) => {
  const lineAccountId = c.req.query('lineAccountId');
  const denied = await requireLineAccountAccess(c, lineAccountId);
  if (denied) return denied;
  const q = cleanText(c.req.query('q'), 100);
  const result = await c.env.DB.prepare(`SELECT f.id AS friend_id, f.display_name, f.picture_url, f.line_account_id, f.is_following,
      p.instagram_handle, p.categories_json, p.follower_band, p.contact_email, p.contact_phone, p.age_group, p.gender,
      p.gifting_interests_json, p.dietary_notes, p.privacy_consent_at, p.profile_completed_at, p.updated_at AS profile_updated_at,
      a.recipient_name, a.postal_code, a.prefecture, a.address_line1, a.address_line2, a.phone AS address_phone, a.confirmed_at
    FROM friends f INNER JOIN influencer_profiles p ON p.friend_id=f.id
    LEFT JOIN influencer_shipping_addresses a ON a.friend_id=f.id
    WHERE f.line_account_id=? ${q ? 'AND (f.display_name LIKE ? OR p.instagram_handle LIKE ?)' : ''}
    ORDER BY p.updated_at DESC LIMIT 200`).bind(...(q ? [lineAccountId!, `%${q}%`, `%${q}%`] : [lineAccountId!])).all<Record<string, unknown>>();
  return c.json({ success: true, data: result.results.map(serialize) });
});

influencers.patch('/api/influencers/:friendId', async (c) => {
  const existing = await c.env.DB.prepare('SELECT line_account_id FROM friends WHERE id=?').bind(c.req.param('friendId')).first<{ line_account_id: string | null }>();
  const denied = await requireLineAccountAccess(c, existing?.line_account_id);
  if (denied) return denied;
  const body = await c.req.json<{ profile: ProfileInput; address?: AddressInput }>();
  await upsertProfile(c.env.DB, c.req.param('friendId'), body.profile ?? {}, body.address);
  const updated = await profileRow(c.env.DB, c.req.param('friendId'));
  return c.json({ success: true, data: serialize(updated!) });
});

export { influencers };
