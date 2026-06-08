import { Hono } from 'hono';
import { upsertCustomer, generateFermentId } from '@line-crm/db';
import type { Env } from '../index.js';

const importLineUsers = new Hono<Env>();

/**
 * CRM PLUS (SocialPLUS) のユーザーエクスポートCSVを LINEハーネスに取り込む。
 *
 * 目的: SocialPLUS が長年蓄積した LINEユーザーID(20,645件規模)を harness に移し、
 *       セグメント/個別配信の到達範囲を CRM PLUS と同等にする（解約前の重要タスク）。
 *
 * データの流れ: 河原さんのMac(CSV) → このエンドポイント(自社Worker/D1)。第三者を経由しない。
 *
 * body: {
 *   users: [{ uid: string, status?: string, addedAt?: string }],  // CSVの LINE UID / 友だち状態 / 友だち追加日時
 *   lineAccountId?: string                                          // 省略時は最初のアクティブアカウント
 * }
 * 1回のPOSTは100件程度を推奨（D1のCPU時間内に収めるため）。クライアント側でバッチ呼び出しする。
 */
importLineUsers.post('/api/admin/import-line-users', async (c) => {
  const body = await c.req
    .json<{ users?: { uid: string; status?: string; addedAt?: string }[]; lineAccountId?: string }>()
    .catch(() => ({} as { users?: { uid: string; status?: string; addedAt?: string }[]; lineAccountId?: string }));
  const users = body.users ?? [];
  if (!Array.isArray(users) || users.length === 0) {
    return c.json({ success: false, error: 'users は必須です' }, 400);
  }

  const db = c.env.DB;

  // 取り込み先のLINEアカウント（指定が無ければ最初のアクティブアカウント）
  let accountId = body.lineAccountId ?? null;
  if (!accountId) {
    const acc = await db
      .prepare('SELECT id FROM line_accounts WHERE is_active = 1 ORDER BY created_at ASC LIMIT 1')
      .first<{ id: string }>();
    accountId = acc?.id ?? null;
  }

  let friendsInserted = 0;
  let friendsUpdated = 0;
  let customersCreated = 0;
  let skipped = 0;
  const now = new Date().toISOString();

  for (const u of users) {
    const uid = (u.uid ?? '').trim();
    // 有効な LINE ユーザーID（U で始まる）以外は除外
    if (!uid.startsWith('U')) {
      skipped++;
      continue;
    }
    // 友だち状態が「友だち」のみ is_following=1、それ以外(ブロック/退会等)は 0
    const isFollowing = (u.status ?? '').includes('友だち') ? 1 : 0;
    const createdAt = u.addedAt && u.addedAt.trim() ? u.addedAt.trim() : now;

    try {
      // friends を upsert（line_user_id が UNIQUE）
      const existing = await db
        .prepare('SELECT id FROM friends WHERE line_user_id = ?')
        .bind(uid)
        .first<{ id: string }>();
      if (existing) {
        await db
          .prepare(
            'UPDATE friends SET is_following = ?, line_account_id = COALESCE(line_account_id, ?), updated_at = ? WHERE line_user_id = ?',
          )
          .bind(isFollowing, accountId, now, uid)
          .run();
        friendsUpdated++;
      } else {
        await db
          .prepare(
            'INSERT INTO friends (id, line_user_id, is_following, line_account_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
          )
          .bind(crypto.randomUUID(), uid, isFollowing, accountId, createdAt, now)
          .run();
        friendsInserted++;
      }

      // customers にも line_user_id を持つ行を用意（セグメント配信の対象にするため）。
      // 既に line_user_id 紐付けの顧客があれば作らない（購入データを壊さない）。
      const existCust = await db
        .prepare('SELECT customer_id FROM customers WHERE line_user_id = ? LIMIT 1')
        .bind(uid)
        .first<{ customer_id: string }>();
      if (!existCust) {
        await upsertCustomer(db, {
          customer_id: generateFermentId('cu'),
          line_user_id: uid,
          region: 'JP',
          language: 'ja',
          source: 'crmplus_import',
        });
        customersCreated++;
      }
    } catch (err) {
      console.error(`import-line-users failed for ${uid}:`, err);
      skipped++;
    }
  }

  return c.json({
    success: true,
    data: {
      received: users.length,
      friendsInserted,
      friendsUpdated,
      customersCreated,
      skipped,
      lineAccountId: accountId,
    },
  });
});

export { importLineUsers };
