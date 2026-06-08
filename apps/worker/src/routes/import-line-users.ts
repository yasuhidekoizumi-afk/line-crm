import { Hono } from 'hono';
import { upsertCustomer, generateFermentId } from '@line-crm/db';
import type { Env } from '../index.js';

const importLineUsers = new Hono<Env>();

/** gid://shopify/Customer/123 や 123 から数値IDを取り出す */
function extractShopifyId(raw?: string): string | null {
  if (!raw) return null;
  const m = raw.trim().match(/(\d{5,})/);
  return m ? m[1] : null;
}

/**
 * CRM PLUS(SocialPLUS) ユーザーCSVの取り込み。
 *
 * CSV列: LINE UID / ソーシャルPLUS ID / ユーザー ID(=gid://shopify/Customer/...) / 友だち状態(follow|unfollow) / 各日時
 *
 * - friends: line_user_id で upsert。友だち状態 follow→is_following=1, unfollow→0。
 * - customers: Shopify顧客ID(ユーザー ID列)で既存のShopify顧客行に line_user_id を結合
 *   （→ Shopify由来の名前・購入金額・注文数がLINE顧客として表示される）。
 *   Shopify行がまだ無ければ最小行を作成（後続のShopifyバックフィルが名前・購入を埋める）。
 *
 * mode='rollback': 以前の取り込みで作った中途半端な顧客(source='crmplus_import')を削除。
 *
 * データはMac→自社Worker/D1のみ。第三者を経由しない。1リクエスト100件程度を推奨。
 */
importLineUsers.post('/api/admin/import-line-users', async (c) => {
  const body = await c.req
    .json<{ users?: { uid: string; shopifyId?: string; status?: string }[]; lineAccountId?: string; mode?: string }>()
    .catch(() => ({} as { users?: { uid: string; shopifyId?: string; status?: string }[]; lineAccountId?: string; mode?: string }));
  const db = c.env.DB;

  // ── 後始末: 中途半端に作った取り込み顧客を削除 ──
  if (body.mode === 'rollback') {
    await db.prepare("DELETE FROM segment_members WHERE customer_id IN (SELECT customer_id FROM customers WHERE source = 'crmplus_import')").run();
    await db.prepare("DELETE FROM events WHERE customer_id IN (SELECT customer_id FROM customers WHERE source = 'crmplus_import')").run();
    const r = await db.prepare("DELETE FROM customers WHERE source = 'crmplus_import'").run();
    return c.json({ success: true, data: { rolledBack: (r as unknown as { meta?: { changes?: number } }).meta?.changes ?? 0 } });
  }

  const users = body.users ?? [];
  if (!Array.isArray(users) || users.length === 0) {
    return c.json({ success: false, error: 'users は必須です' }, 400);
  }

  let accountId = body.lineAccountId ?? null;
  if (!accountId) {
    const acc = await db.prepare('SELECT id FROM line_accounts WHERE is_active = 1 ORDER BY created_at ASC LIMIT 1').first<{ id: string }>();
    accountId = acc?.id ?? null;
  }

  const now = new Date().toISOString();
  let friendsInserted = 0, friendsUpdated = 0, customersLinked = 0, customersCreated = 0, conflicts = 0, skipped = 0;

  for (const u of users) {
    const uid = (u.uid ?? '').trim();
    if (!uid.startsWith('U')) { skipped++; continue; }
    const isFollowing = (u.status ?? '').trim().toLowerCase() === 'follow' ? 1 : 0;
    const sid = extractShopifyId(u.shopifyId);

    try {
      // friends を upsert（フォロー状態を follow/unfollow から正しく反映）
      const ef = await db.prepare('SELECT id FROM friends WHERE line_user_id = ?').bind(uid).first<{ id: string }>();
      if (ef) {
        await db.prepare('UPDATE friends SET is_following = ?, line_account_id = COALESCE(line_account_id, ?), updated_at = ? WHERE line_user_id = ?')
          .bind(isFollowing, accountId, now, uid).run();
        friendsUpdated++;
      } else {
        await db.prepare('INSERT INTO friends (id, line_user_id, is_following, line_account_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
          .bind(crypto.randomUUID(), uid, isFollowing, accountId, now, now).run();
        friendsInserted++;
      }

      // customers: Shopify顧客ID で結合
      if (sid) {
        const byShop = await db.prepare('SELECT customer_id, line_user_id FROM customers WHERE shopify_customer_id_jp = ? LIMIT 1')
          .bind(sid).first<{ customer_id: string; line_user_id: string | null }>();
        if (byShop) {
          if (!byShop.line_user_id) {
            try {
              await db.prepare('UPDATE customers SET line_user_id = ?, updated_at = ? WHERE customer_id = ?').bind(uid, now, byShop.customer_id).run();
              customersLinked++;
            } catch { conflicts++; }
          } else {
            customersLinked++; // 既に紐付け済み
          }
        } else {
          // Shopify顧客がまだharnessに無い → 最小行を作成（後のShopifyバックフィルが名前・購入を充填）
          const byLine = await db.prepare('SELECT customer_id FROM customers WHERE line_user_id = ? LIMIT 1').bind(uid).first<{ customer_id: string }>();
          if (byLine) {
            await db.prepare('UPDATE customers SET shopify_customer_id_jp = COALESCE(shopify_customer_id_jp, ?), updated_at = ? WHERE customer_id = ?').bind(sid, now, byLine.customer_id).run();
            customersLinked++;
          } else {
            try {
              await upsertCustomer(db, { customer_id: generateFermentId('cu'), line_user_id: uid, shopify_customer_id_jp: sid, region: 'JP', language: 'ja', source: 'crmplus_import' });
              customersCreated++;
            } catch { conflicts++; }
          }
        }
      } else {
        // Shopify ID 無し → line_user_id だけの顧客（無ければ作成）
        const byLine = await db.prepare('SELECT customer_id FROM customers WHERE line_user_id = ? LIMIT 1').bind(uid).first<{ customer_id: string }>();
        if (!byLine) {
          try {
            await upsertCustomer(db, { customer_id: generateFermentId('cu'), line_user_id: uid, region: 'JP', language: 'ja', source: 'crmplus_import' });
            customersCreated++;
          } catch { conflicts++; }
        }
      }
    } catch (err) {
      console.error(`import-line-users failed for ${uid}:`, err);
      skipped++;
    }
  }

  return c.json({
    success: true,
    data: { received: users.length, friendsInserted, friendsUpdated, customersLinked, customersCreated, conflicts, skipped, lineAccountId: accountId },
  });
});

export { importLineUsers };
