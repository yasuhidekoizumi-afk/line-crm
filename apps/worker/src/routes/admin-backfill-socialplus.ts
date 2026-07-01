import { Hono } from 'hono';
import { LineClient } from '@line-crm/line-sdk';
import { upsertCustomer, generateFermentId, getLineAccountById } from '@line-crm/db';
import type { Env } from '../index.js';

/**
 * Shopify顧客メタフィールド `socialplus.line`（値=LINE userId）を line-crm に取り込む
 * バックフィル用エンドポイント。
 *
 * 背景:
 *   CRM Plus(SocialPLUS) 時代の LINE 連携情報は Shopify 顧客メタフィールドに残っている
 *   （`namespace=socialplus, key=line`）。自社ハーネスの `friends` / `customers` には未取込のため、
 *   Shopifyで「LINE登録済み」であっても LINE 配信は届かない状態が続いている。
 *
 * 処理:
 *   1. LINE Messaging API `getProfile(userId)` で現在の友だち状態を確認
 *      - 成功 → is_following=1、表示名・アイコンURL・ステータスメッセージ取得
 *      - 404 → is_following=0（ブロック済み or 初めから友だちでない）で friends 行を作成
 *      - その他エラー → skipped でカウント、次のitemへ
 *   2. `friends` を line_user_id をキーに UPSERT
 *   3. `customers` を shopify_customer_id_jp をキーに UPSERT。既存行の line_user_id が
 *      合成値（`shopify:<id>` 形式）や null なら本物のLINE IDで上書きする
 *
 * 呼び出し:
 *   POST /api/admin/backfill/socialplus-line
 *   body: {
 *     items: [{ shopifyCustomerId: "1234", lineUserId: "Uabc...", email?, firstName?, lastName? }],
 *     lineAccountId?: string  // 省略時は is_active=1 の最古の line_account、なければ env.LINE_CHANNEL_ACCESS_TOKEN
 *   }
 *
 * 想定チャンクサイズ: 100〜200件/呼び出し（Cloudflare Worker のサブリクエスト上限内）。
 */

const adminBackfillSocialplus = new Hono<Env>();

type BackfillItem = {
  shopifyCustomerId: string;
  lineUserId: string;
  email?: string | null;
  firstName?: string | null;
  lastName?: string | null;
};

type BackfillBody = {
  items?: BackfillItem[];
  lineAccountId?: string | null;
};

type ItemResult = {
  shopifyCustomerId: string;
  lineUserId: string;
  isFollowing: 0 | 1 | null;      // null = プロファイル取得失敗（skipped）
  friendAction: 'inserted' | 'updated' | 'skipped';
  customerAction: 'linked' | 'created' | 'conflict' | 'skipped';
  error?: string;
};

/** LINE userId の形式検証（U + 32文字） */
function isValidLineUserId(uid: string): boolean {
  return uid.startsWith('U') && uid.length === 33;
}

/** Shopify GID を数値IDに剥がす。既に数値ならそのまま */
function normalizeShopifyId(raw: string): string | null {
  if (!raw) return null;
  const m = raw.trim().match(/(\d{5,})/);
  return m ? m[1] : null;
}

/** null/undefined/空文字 を undefined に統一 */
function cleanStr(v: string | null | undefined): string | undefined {
  if (v === null || v === undefined) return undefined;
  const s = String(v).trim();
  return s.length > 0 ? s : undefined;
}

adminBackfillSocialplus.post('/api/admin/backfill/socialplus-line', async (c) => {
  const body = await c.req.json<BackfillBody>().catch(() => ({} as BackfillBody));
  const db = c.env.DB;

  const items = Array.isArray(body.items) ? body.items : [];
  if (items.length === 0) {
    return c.json({ success: false, error: 'items は必須です（配列）' }, 400);
  }

  // ── LINE Client 準備 ──
  // 重要: LINEアカウントが複数ある場合、間違ったチャネルで getProfile すると
  // 本来フォロー中の人も 404 扱いになり is_following=0 で誤取り込みされる。
  // そのため:
  //   - lineAccountId 明示指定 → その口
  //   - 未指定 + active が1つだけ → その口を使う
  //   - 未指定 + active が2つ以上 → 400 で拒否（人手で明示させる）
  //   - 未指定 + active が0 → env フォールバック（dev想定）
  let accountId: string | null = body.lineAccountId ?? null;
  let accessToken = c.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (accountId) {
    const acc = await getLineAccountById(db, accountId).catch(() => null);
    if (!acc?.channel_access_token) {
      return c.json({ success: false, error: `指定された lineAccountId=${accountId} が見つからないか、channel_access_token が未設定です` }, 400);
    }
    accessToken = acc.channel_access_token;
  } else {
    const accs = await db
      .prepare('SELECT id, name, channel_access_token FROM line_accounts WHERE is_active = 1 ORDER BY created_at ASC')
      .all<{ id: string; name: string; channel_access_token: string }>();
    const rows = accs.results ?? [];
    if (rows.length > 1) {
      return c.json(
        {
          success: false,
          error:
            'lineAccountId 未指定ですが active な LINEアカウントが2つ以上あります。' +
            '誤ったチャネルで getProfile すると本来フォロー中の人も 404 扱いになり ' +
            'is_following=0 で誤取り込みされるため、明示指定してください。',
          availableAccounts: rows.map((r) => ({ id: r.id, name: r.name })),
        },
        400,
      );
    }
    if (rows.length === 1) {
      accountId = rows[0].id;
      accessToken = rows[0].channel_access_token;
    }
    // rows.length === 0 の場合は env のトークンで動く（dev 想定）
  }
  const lineClient = new LineClient(accessToken);

  const now = new Date().toISOString();
  const results: ItemResult[] = [];
  const stats = {
    received: items.length,
    profilesOk: 0,
    profilesNotFriend: 0,
    profileErrors: 0,
    friendsInserted: 0,
    friendsUpdated: 0,
    customersLinked: 0,
    customersCreated: 0,
    conflicts: 0,
    skipped: 0,
  };

  for (const raw of items) {
    const uid = cleanStr(raw.lineUserId) ?? '';
    const sid = normalizeShopifyId(cleanStr(raw.shopifyCustomerId) ?? '');
    const email = cleanStr(raw.email);
    const first = cleanStr(raw.firstName);
    const last = cleanStr(raw.lastName);
    const shopifyFallbackName = [last, first].filter(Boolean).join(' ') || undefined;

    if (!isValidLineUserId(uid) || !sid) {
      stats.skipped++;
      results.push({
        shopifyCustomerId: sid ?? '',
        lineUserId: uid,
        isFollowing: null,
        friendAction: 'skipped',
        customerAction: 'skipped',
        error: 'invalid_input',
      });
      continue;
    }

    // 1. getProfile で現況取得
    let isFollowing: 0 | 1 = 0;
    let displayName: string | undefined;
    let pictureUrl: string | undefined;
    let statusMessage: string | undefined;
    let profileError: string | undefined;
    try {
      const profile = await lineClient.getProfile(uid);
      isFollowing = 1;
      displayName = profile.displayName;
      pictureUrl = profile.pictureUrl;
      statusMessage = profile.statusMessage;
      stats.profilesOk++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // 404 系のメッセージなら「友だちでない」と判断
      if (/\b404\b|not found|status\s*404/i.test(msg)) {
        isFollowing = 0;
        stats.profilesNotFriend++;
      } else {
        profileError = msg;
        stats.profileErrors++;
        stats.skipped++;
        results.push({
          shopifyCustomerId: sid,
          lineUserId: uid,
          isFollowing: null,
          friendAction: 'skipped',
          customerAction: 'skipped',
          error: `getProfile_failed: ${msg.slice(0, 200)}`,
        });
        continue;
      }
    }

    // 表示名フォールバック（未フォロー時 or LINE側に表示名がない時）
    if (!displayName && shopifyFallbackName) displayName = shopifyFallbackName;

    let friendAction: ItemResult['friendAction'] = 'skipped';
    let customerAction: ItemResult['customerAction'] = 'skipped';

    try {
      // 2. friends UPSERT
      const ef = await db
        .prepare('SELECT id, display_name, picture_url FROM friends WHERE line_user_id = ?')
        .bind(uid)
        .first<{ id: string; display_name: string | null; picture_url: string | null }>();

      if (ef) {
        // 既存友だち: 最新情報でマージ更新（既存の非nullを優先しつつ新しい値で上書き）
        await db
          .prepare(
            `UPDATE friends
               SET display_name = COALESCE(?, display_name),
                   picture_url = COALESCE(?, picture_url),
                   status_message = COALESCE(?, status_message),
                   is_following = ?,
                   line_account_id = COALESCE(line_account_id, ?),
                   updated_at = ?
             WHERE line_user_id = ?`,
          )
          .bind(
            displayName ?? null,
            pictureUrl ?? null,
            statusMessage ?? null,
            isFollowing,
            accountId,
            now,
            uid,
          )
          .run();
        stats.friendsUpdated++;
        friendAction = 'updated';
      } else {
        await db
          .prepare(
            `INSERT INTO friends
               (id, line_user_id, display_name, picture_url, status_message, is_following, line_account_id, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            crypto.randomUUID(),
            uid,
            displayName ?? null,
            pictureUrl ?? null,
            statusMessage ?? null,
            isFollowing,
            accountId,
            now,
            now,
          )
          .run();
        stats.friendsInserted++;
        friendAction = 'inserted';
      }

      // 3. customers UPSERT（shopify_customer_id_jp を主キーに扱う）
      const byShop = await db
        .prepare('SELECT customer_id, line_user_id FROM customers WHERE shopify_customer_id_jp = ? LIMIT 1')
        .bind(sid)
        .first<{ customer_id: string; line_user_id: string | null }>();

      if (byShop) {
        if (byShop.line_user_id === uid) {
          // 既に本物のUIDで紐付き済み
          customerAction = 'linked';
          stats.customersLinked++;
        } else {
          // 上書き可否: 既存値が null または `shopify:<id>` 合成値のときだけ上書きする。
          // 別の本物UID（別のU始まり33文字）が入っている場合は絶対に上書きしない — 別人と誤結合するリスク。
          const isNullOrSynthetic =
            !byShop.line_user_id || byShop.line_user_id.startsWith('shopify:');
          if (!isNullOrSynthetic) {
            stats.conflicts++;
            customerAction = 'conflict';
          } else {
            // UNIQUE制約回避: 同じ uid が別行にあるかチェック
            const other = await db
              .prepare('SELECT customer_id FROM customers WHERE line_user_id = ? AND customer_id != ? LIMIT 1')
              .bind(uid, byShop.customer_id)
              .first<{ customer_id: string }>();
            if (other) {
              stats.conflicts++;
              customerAction = 'conflict';
            } else {
              await db
                .prepare(
                  `UPDATE customers
                     SET line_user_id = ?,
                         display_name = COALESCE(?, display_name),
                         email = COALESCE(email, ?),
                         updated_at = ?
                   WHERE customer_id = ?`,
                )
                .bind(uid, displayName ?? null, email ?? null, now, byShop.customer_id)
                .run();
              stats.customersLinked++;
              customerAction = 'linked';
            }
          }
        }
      } else {
        // Shopify行なし: 別に uid で存在するか確認
        const byLine = await db
          .prepare('SELECT customer_id FROM customers WHERE line_user_id = ? LIMIT 1')
          .bind(uid)
          .first<{ customer_id: string }>();
        if (byLine) {
          await db
            .prepare(
              `UPDATE customers
                 SET shopify_customer_id_jp = COALESCE(shopify_customer_id_jp, ?),
                     display_name = COALESCE(display_name, ?),
                     email = COALESCE(email, ?),
                     updated_at = ?
               WHERE customer_id = ?`,
            )
            .bind(sid, displayName ?? null, email ?? null, now, byLine.customer_id)
            .run();
          stats.customersLinked++;
          customerAction = 'linked';
        } else {
          try {
            await upsertCustomer(db, {
              customer_id: generateFermentId('cu'),
              email: email ?? null,
              line_user_id: uid,
              shopify_customer_id_jp: sid,
              display_name: displayName ?? null,
              region: 'JP',
              language: 'ja',
              source: 'socialplus_backfill',
            });
            stats.customersCreated++;
            customerAction = 'created';
          } catch (err) {
            stats.conflicts++;
            customerAction = 'conflict';
            console.error('backfill customer insert conflict:', err);
          }
        }
      }

      results.push({
        shopifyCustomerId: sid,
        lineUserId: uid,
        isFollowing,
        friendAction,
        customerAction,
        error: profileError,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      stats.skipped++;
      results.push({
        shopifyCustomerId: sid,
        lineUserId: uid,
        isFollowing,
        friendAction,
        customerAction,
        error: `db_error: ${msg.slice(0, 200)}`,
      });
      console.error(`backfill db failed for uid=${uid} sid=${sid}:`, err);
    }
  }

  return c.json({
    success: true,
    data: {
      ...stats,
      lineAccountId: accountId,
      results, // 呼び元でログ出力・失敗リトライに使う
    },
  });
});

export { adminBackfillSocialplus };
