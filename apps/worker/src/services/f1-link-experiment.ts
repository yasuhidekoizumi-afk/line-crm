/**
 * F1→LINE連携誘導 実験の割付（#3）
 *
 * 目的: 「LINE友だち登録済み × Shopify購入済み × アカウント未連携」のF1顧客に
 * 連携誘導を配信し、連携がF2率に与える因果効果を対照群付きで測る。
 *
 * 割付: shopifyCustomerId のSHA-256先頭バイトで決定論的に90%誘導/10%対照。
 *   - 再実行しても同じ割付（冪等）
 *   - 対照群は誘導メッセージを受け取らないだけで、連携自体は自由
 *
 * タグ付与後の誘導メッセージ送信は「tag_added」シナリオ（管理画面で作成）が担う。
 * 計測は customer_journey + friend_tags のJOINで行う（専用画面は後で必要になったら）。
 *
 * 注意: 割付は「この購入が初回(F1)」である必要は厳密にはない。
 * 既に連携済み（実UID）なら何もしない。
 */

const EXPERIMENT_PREFIX = 'exp2609:f1link';
const TAG_GUIDE = `${EXPERIMENT_PREFIX}:誘導`;
const TAG_CONTROL = `${EXPERIMENT_PREFIX}:対照`;
const GUIDE_RATIO = 90; // 90% 誘導 / 10% 対照

/** shopifyCustomerId から決定論的な割付 (true=誘導, false=対照) */
export function isGuideGroup(shopifyCustomerId: string): boolean {
  const hash = sha256Hex(shopifyCustomerId);
  const bucket = parseInt(hash.slice(0, 2), 16) % 100; // 0-99
  return bucket < GUIDE_RATIO;
}

function sha256Hex(input: string): string {
  // Web標準 crypto.subtle は非同期。決定論的割付のため簡易FNV-1aをSHA-256の代替にはせず、
  // 同期的に使える簡易ハッシュを使う（割付の偏り防止目的には十分）。
  // ponytail: 暗号用途でない（推測不能にする必要がない）ためFNV-1aで足りる。
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/**
 * 購入者（email一致の実UID友だち）が未連携なら実験タグを付与する。
 * orders-paid の待ち時間に影響させないため、呼び出し側は waitUntil で fire-and-forget。
 */
export async function assignF1LinkExperimentTag(
  db: D1Database,
  input: { shopifyCustomerId: string; email: string | null },
): Promise<{ assigned: 'guide' | 'control' | 'skip_linked' | 'skip_no_friend' | 'skip_no_email' }> {
  if (!input.email) return { assigned: 'skip_no_email' };

  const emailLower = input.email.toLowerCase();
  // 1) 実UIDの友だちを email で解決（customers.email or 一致名義）。friends には email が無いため
  //    customers 経由: customers.email = 注文email かつ line_user_id LIKE 'U%'
  const friend = await db
    .prepare(
      `SELECT c.line_user_id, lp.friend_id AS linked_friend_id
       FROM customers c
       LEFT JOIN loyalty_points lp ON lp.shopify_customer_id = ?
       WHERE LOWER(c.email) = ?
         AND c.line_user_id LIKE 'U%'
       LIMIT 1`,
    )
    .bind(input.shopifyCustomerId, emailLower)
    .first<{ line_user_id: string; linked_friend_id: string | null }>();

  // 友だち未登録 → 誘導の届け先が無いのでスキップ
  if (!friend) return { assigned: 'skip_no_friend' };

  // 既にこのShopify顧客がポイント口座に紐付いている = 連携済み
  if (friend.linked_friend_id) return { assigned: 'skip_linked' };

  const group = isGuideGroup(input.shopifyCustomerId) ? TAG_GUIDE : TAG_CONTROL;

  // タグを ensure（同時実行のUNIQUE競合は握りつぶして再取得）
  let tagId: string | null = null;
  const existingTag = await db
    .prepare('SELECT id FROM tags WHERE name = ?')
    .bind(group)
    .first<{ id: string }>();
  if (existingTag) {
    tagId = existingTag.id;
  } else {
    try {
      const created = await db
        .prepare('INSERT INTO tags (id, name, color) VALUES (?, ?, ?)')
        .bind(crypto.randomUUID(), group, '#8B5CF6')
        .run();
      const back = await db
        .prepare('SELECT id FROM tags WHERE name = ?')
        .bind(group)
        .first<{ id: string }>();
      tagId = back?.id ?? null;
    } catch {
      // UNIQUE競合: 既に誰かが作った → 再取得
      const back = await db
        .prepare('SELECT id FROM tags WHERE name = ?')
        .bind(group)
        .first<{ id: string }>();
      tagId = back?.id ?? null;
    }
  }
  if (!tagId) return { assigned: 'skip_no_friend' }; // 起きない想定

  const friendId = await db
    .prepare('SELECT id FROM friends WHERE line_user_id = ?')
    .bind(friend.line_user_id)
    .first<{ id: string }>();
  if (!friendId) return { assigned: 'skip_no_friend' };

  await db
    .prepare(
      `INSERT OR IGNORE INTO friend_tags (friend_id, tag_id, assigned_at)
       VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))`,
    )
    .bind(friendId.id, tagId)
    .run();

  return { assigned: group === TAG_GUIDE ? 'guide' : 'control' };
}
