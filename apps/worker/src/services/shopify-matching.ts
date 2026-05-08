/**
 * Shopify → LINE 友だち 自動マッチングサービス
 *
 * 戦略:
 * 1. 名前正規化マッチ（姓名の順序入れ替え・スペース除去・ひらがな変換）
 * 2. 電話番号マッチ（Shopify phone ↔ friends.metadata.phone）
 * 3. 複合マッチ（部分一致 + 電話番号）
 *
 * マッチしたら loyalty_points.shopify_customer_id をセットし、
 * shopify_orders.friend_id も更新する。
 */

export interface ShopifyOrderForMatch {
  shopify_order_id: string;
  shopify_customer_id: string | null;
  customer_name: string | null;
  email: string | null;
  phone: string | null;
}

export interface FriendCandidate {
  id: string;
  displayName: string;
  score: number;
  matchedBy: 'name_exact' | 'name_partial' | 'phone' | 'name_phone';
}

/**
 * 名前を正規化して比較用キーを生成
 * - 全角英数字→半角
 * - スペース除去
 * - ひらがな・カタカナ混在対応はそのまま（どちらも出現するため）
 */
function normalizeNameForMatch(name: string): string {
  return name
    .replace(/[\u3000\s]+/g, '')  // スペース除去
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))  // 全角→半角
    .toLowerCase();
}

/**
 * 姓名を入れ替えたバリエーションを生成
 * 「さの よしこ」「佐野 よしこ」→ ["さのよしこ", "佐野よしこ"]
 * 姓名の順序入れ替え: "さの よしこ" → ["さのよしこ", "よしこさの"]
 */
function generateNameVariations(name: string): string[] {
  const normalized = normalizeNameForMatch(name);
  const parts = name.trim().split(/[\s\u3000]+/);
  const variations = new Set<string>();
  variations.add(normalized);

  if (parts.length >= 2) {
    // 姓→名 の順で結合
    variations.add(normalizeNameForMatch(parts.join('')));
    // 名→姓 の順で結合
    variations.add(normalizeNameForMatch([...parts].reverse().join('')));
    // 各パート単独（名だけ、姓だけ）
    for (const part of parts) {
      if (part.length >= 2) variations.add(normalizeNameForMatch(part));
    }
  }

  return [...variations];
}

/**
 * Shopify 注文の顧客名から、一致する LINE 友だちを検索
 */
async function findFriendByName(
  db: D1Database,
  customerName: string,
): Promise<{ friendId: string; displayName: string; matchedBy: string } | null> {
  const variations = generateNameVariations(customerName);
  
  // Step 1: 完全一致（正規化後）
  for (const v of variations) {
    const friend = await db
      .prepare(`SELECT id, display_name FROM friends WHERE REPLACE(LOWER(display_name), ' ', '') = REPLACE(LOWER(?), ' ', '') LIMIT 1`)
      .bind(v)
      .first<{ id: string; display_name: string }>();
    if (friend) {
      return { friendId: friend.id, displayName: friend.display_name, matchedBy: 'name_exact' };
    }
  }

  // Step 2: 部分一致（name が display_name に含まれる または その逆）
  for (const v of variations.slice(0, 2)) {
    const friend = await db
      .prepare(`SELECT id, display_name FROM friends WHERE display_name LIKE ? COLLATE NOCASE LIMIT 1`)
      .bind(`%${v}%`)
      .first<{ id: string; display_name: string }>();
    if (friend) {
      return { friendId: friend.id, displayName: friend.display_name, matchedBy: 'name_partial' };
    }
  }

  return null;
}

/**
 * 電話番号で友だちを検索（metadata.phone）
 */
async function findFriendByPhone(
  db: D1Database,
  phone: string,
): Promise<{ friendId: string; displayName: string } | null> {
  // 電話番号正規化：+81→0, ハイフン除去
  const normalized = phone
    .replace(/^\+81/, '0')
    .replace(/[-\s]/g, '');

  if (normalized.length < 10) return null;

  // metadata JSON 内の phone を検索
  const friend = await db
    .prepare(`SELECT id, display_name FROM friends WHERE metadata LIKE ? LIMIT 1`)
    .bind(`%${normalized}%`)
    .first<{ id: string; display_name: string }>();

  if (friend) {
    // 厳密に検証
    try {
      const metaStr = await db.prepare(`SELECT metadata FROM friends WHERE id = ?`).bind(friend.id).first<{ metadata: string }>();
      if (metaStr?.metadata) {
        const meta = JSON.parse(metaStr.metadata);
        const metaPhone = (meta.phone || '').replace(/[-\s]/g, '');
        if (metaPhone === normalized || metaPhone === phone.replace(/^\+81/, '0').replace(/[-\s]/g, '')) {
          return { friendId: friend.id, displayName: friend.display_name };
        }
      }
    } catch {
      // metadata パース失敗 → 曖昧マッチとみなす（LIKE でヒットしているので）
      return { friendId: friend.id, displayName: friend.display_name };
    }
  }

  return null;
}

/**
 * メインのマッチング関数
 * Shopify 注文から LINE 友だちを特定する
 */
export async function matchShopifyOrderToFriend(
  db: D1Database,
  order: ShopifyOrderForMatch,
): Promise<FriendCandidate | null> {
  // 既存の shopify_customer_id 経由のマッチを確認
  if (order.shopify_customer_id) {
    const existing = await db
      .prepare(`SELECT friend_id FROM loyalty_points WHERE shopify_customer_id = ? LIMIT 1`)
      .bind(order.shopify_customer_id)
      .first<{ friend_id: string }>();
    if (existing?.friend_id) {
      const friend = await db
        .prepare(`SELECT display_name FROM friends WHERE id = ?`)
        .bind(existing.friend_id)
        .first<{ display_name: string }>();
      return { id: existing.friend_id, displayName: friend?.display_name || '', score: 100, matchedBy: 'name_exact' };
    }
  }

  // 名前マッチ
  if (order.customer_name) {
    const nameMatch = await findFriendByName(db, order.customer_name);
    if (nameMatch) {
      const score = nameMatch.matchedBy === 'name_exact' ? 95 : 70;
      return { ...nameMatch, score };
    }
  }

  // 電話番号マッチ
  if (order.phone) {
    const phoneMatch = await findFriendByPhone(db, order.phone);
    if (phoneMatch) {
      return { ...phoneMatch, score: 60, matchedBy: 'phone' };
    }
  }

  return null;
}

/**
 * マッチ結果を loyalty_points と shopify_orders に反映
 */
export async function applyMatch(
  db: D1Database,
  shopifyOrderId: string,
  friendId: string,
  shopifyCustomerId: string | null,
): Promise<boolean> {
  // loyalty_points に shopify_customer_id をセット
  if (shopifyCustomerId) {
    const existing = await db
      .prepare(`SELECT id FROM loyalty_points WHERE friend_id = ?`)
      .bind(friendId)
      .first<{ id: string }>();
    
    if (existing) {
      await db
        .prepare(`UPDATE loyalty_points SET shopify_customer_id = ? WHERE friend_id = ? AND (shopify_customer_id IS NULL OR shopify_customer_id = '')`)
        .bind(shopifyCustomerId, friendId)
        .run();
    } else {
      await db
        .prepare(`INSERT INTO loyalty_points (id, friend_id, balance, total_spent, rank, shopify_customer_id) VALUES (?, ?, 0, 0, 'レギュラー', ?)`)
        .bind(crypto.randomUUID(), friendId, shopifyCustomerId)
        .run();
    }
  }

  // shopify_orders の friend_id を更新
  await db
    .prepare(`UPDATE shopify_orders SET friend_id = ? WHERE shopify_order_id = ?`)
    .bind(friendId, shopifyOrderId)
    .run();

  return true;
}

/**
 * バッチ: 全未マッチ注文 + 全友だち を一括マッチング
 */
export async function batchMatchAll(
  db: D1Database,
  options: { limit?: number; minConfidence?: number } = {},
): Promise<{
  totalUnmatchedOrders: number;
  matched: number;
  skipped: number;
  results: Array<{
    shopify_order_id: string;
    customer_name: string | null;
    friend_name: string | null;
    matched_by: string;
  }>;
}> {
  const limit = options.limit ?? 500;

  // 未マッチ注文を取得
  const unmatchOrders = await db
    .prepare(`SELECT shopify_order_id, shopify_customer_id, customer_name, email, phone FROM shopify_orders WHERE friend_id IS NULL AND cancelled_at IS NULL AND customer_name IS NOT NULL ORDER BY processed_at DESC LIMIT ?`)
    .bind(limit)
    .all<ShopifyOrderForMatch>();

  const results: Array<{ shopify_order_id: string; customer_name: string | null; friend_name: string | null; matched_by: string }> = [];
  let matched = 0;
  let skipped = 0;

  for (const order of unmatchOrders.results) {
    const candidate = await matchShopifyOrderToFriend(db, order);
    if (candidate && candidate.score >= 70) {
      await applyMatch(db, order.shopify_order_id, candidate.id, order.shopify_customer_id);
      matched++;
      results.push({
        shopify_order_id: order.shopify_order_id,
        customer_name: order.customer_name,
        friend_name: candidate.displayName,
        matched_by: candidate.matchedBy,
      });
    } else {
      skipped++;
    }
  }

  return {
    totalUnmatchedOrders: unmatchOrders.results.length,
    matched,
    skipped,
    results,
  };
}
