/**
 * Shopify → LINE 友だち 自動マッチングサービス
 *
 * 戦略:
 * 1. shopify_customer_id 経由の既存紐付け確認
 * 2. 名前正規化マッチ（姓名の順序入れ替え・スペース除去）
 * 3. メールアドレスマッチ（Shopify email ↔ users.email → friends.user_id）
 * 4. 電話番号マッチ（Shopify phone ↔ friends.metadata.phone）
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
  matchedBy: 'name_exact' | 'name_partial' | 'phone' | 'email' | 'shopify_customer_id';
}

function normalizeNameForMatch(name: string): string {
  return name.replace(/[\u3000\s]+/g, '').replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0)).toLowerCase();
}

function generateNameVariations(name: string): string[] {
  const normalized = normalizeNameForMatch(name);
  const parts = name.trim().split(/[\s\u3000]+/);
  const variations = new Set<string>();
  variations.add(normalized);
  if (parts.length >= 2) {
    variations.add(normalizeNameForMatch(parts.join('')));
    variations.add(normalizeNameForMatch([...parts].reverse().join('')));
    for (const part of parts) { if (part.length >= 2) variations.add(normalizeNameForMatch(part)); }
  }
  return [...variations];
}

async function findFriendByName(db: D1Database, customerName: string): Promise<{ friendId: string; displayName: string; matchedBy: string } | null> {
  try {
    const variations = generateNameVariations(customerName);
    for (const v of variations) {
      const friend = await db.prepare(`SELECT id, display_name FROM friends WHERE REPLACE(LOWER(display_name), ' ', '') = REPLACE(LOWER(?), ' ', '') LIMIT 1`).bind(v).first<{ id: string; display_name: string }>();
      if (friend) return { friendId: friend.id, displayName: friend.display_name, matchedBy: 'name_exact' };
    }
    for (const v of variations.slice(0, 2)) {
      const friend = await db.prepare(`SELECT id, display_name FROM friends WHERE display_name LIKE ? COLLATE NOCASE LIMIT 1`).bind(`%${v}%`).first<{ id: string; display_name: string }>();
      if (friend) return { friendId: friend.id, displayName: friend.display_name, matchedBy: 'name_partial' };
    }
  } catch {}
  return null;
}

async function findFriendByPhone(db: D1Database, phone: string): Promise<{ friendId: string; displayName: string } | null> {
  try {
    const normalized = phone.replace(/^\+81/, '0').replace(/[-\s]/g, '');
    if (normalized.length < 10) return null;
    const friend = await db.prepare(`SELECT id, display_name FROM friends WHERE metadata LIKE ? LIMIT 1`).bind(`%${normalized}%`).first<{ id: string; display_name: string }>();
    if (friend) return { friendId: friend.id, displayName: friend.display_name };
  } catch {}
  return null;
}

async function findFriendByEmail(db: D1Database, email: string): Promise<{ friendId: string; displayName: string } | null> {
  if (!email) return null;
  const normalized = email.toLowerCase().trim();
  try {
    const friend = await db.prepare(`SELECT id, display_name FROM friends WHERE LOWER(json_extract(metadata, '$.email')) = ? LIMIT 1`).bind(normalized).first<{ id: string; display_name: string }>();
    if (friend) return { friendId: friend.id, displayName: friend.display_name };
  } catch {}
  try {
    const user = await db.prepare(`SELECT id FROM users WHERE LOWER(email) = ? LIMIT 1`).bind(normalized).first<{ id: string }>();
    if (user) {
      const friendByUser = await db.prepare(`SELECT id, display_name FROM friends WHERE user_id = ? LIMIT 1`).bind(user.id).first<{ id: string; display_name: string }>();
      if (friendByUser) return { friendId: friendByUser.id, displayName: friendByUser.display_name };
    }
  } catch {}
  return null;
}

export async function matchShopifyOrderToFriend(db: D1Database, order: ShopifyOrderForMatch): Promise<FriendCandidate | null> {
  if (order.shopify_customer_id) {
    try {
      const existing = await db.prepare(`SELECT friend_id FROM loyalty_points WHERE shopify_customer_id = ? LIMIT 1`).bind(order.shopify_customer_id).first<{ friend_id: string }>();
      if (existing?.friend_id) {
        const friend = await db.prepare(`SELECT display_name FROM friends WHERE id = ?`).bind(existing.friend_id).first<{ display_name: string }>();
        return { id: existing.friend_id, displayName: friend?.display_name || '', score: 100, matchedBy: 'shopify_customer_id' };
      }
    } catch {}
  }
  if (order.customer_name) {
    const nameMatch = await findFriendByName(db, order.customer_name);
    if (nameMatch) return { ...nameMatch, score: nameMatch.matchedBy === 'name_exact' ? 95 : 70 };
  }
  if (order.email) {
    const emailMatch = await findFriendByEmail(db, order.email);
    if (emailMatch) return { ...emailMatch, score: 80, matchedBy: 'email' };
  }
  if (order.phone) {
    const phoneMatch = await findFriendByPhone(db, order.phone);
    if (phoneMatch) return { ...phoneMatch, score: 60, matchedBy: 'phone' };
  }
  return null;
}

export async function applyMatch(db: D1Database, shopifyOrderId: string, friendId: string, shopifyCustomerId: string | null): Promise<boolean> {
  try {
    if (shopifyCustomerId) {
      const existing = await db.prepare(`SELECT id FROM loyalty_points WHERE friend_id = ?`).bind(friendId).first<{ id: string }>();
      if (existing) {
        await db.prepare(`UPDATE loyalty_points SET shopify_customer_id = ? WHERE friend_id = ? AND (shopify_customer_id IS NULL OR shopify_customer_id = '')`).bind(shopifyCustomerId, friendId).run();
      } else {
        await db.prepare(`INSERT INTO loyalty_points (id, friend_id, balance, total_spent, rank, shopify_customer_id) VALUES (?, ?, 0, 0, 'レギュラー', ?)`).bind(crypto.randomUUID(), friendId, shopifyCustomerId).run();
      }
    }
    await db.prepare(`UPDATE shopify_orders SET friend_id = ? WHERE shopify_order_id = ?`).bind(friendId, shopifyOrderId).run();
    return true;
  } catch { return false; }
}

export async function batchMatchAll(db: D1Database, options: { limit?: number; useCustomerName?: boolean } = {}): Promise<{
  totalUnmatchedOrders: number; matched: number; skipped: number; errors: number;
  results: Array<{ shopify_order_id: string; customer_name: string | null; friend_name: string | null; matched_by: string }>;
}> {
  const limit = options.limit ?? 500;
  const useCN = options.useCustomerName ?? false;
  try {
    const nameCol = useCN ? ', customer_name' : '';
    const nameColNull = useCN ? '' : ', NULL as customer_name';
    const unmatchOrders = await db.prepare(`SELECT shopify_order_id, shopify_customer_id${nameCol}${nameColNull}, email, phone FROM shopify_orders WHERE friend_id IS NULL AND cancelled_at IS NULL ORDER BY processed_at DESC LIMIT ?`).bind(limit).all<ShopifyOrderForMatch>();
    const results: any[] = [];
    let matched = 0, skipped = 0, errors = 0;
    for (const order of unmatchOrders.results) {
      try {
        const candidate = await matchShopifyOrderToFriend(db, order);
        if (candidate && candidate.score >= 60) {
          const ok = await applyMatch(db, order.shopify_order_id, candidate.id, order.shopify_customer_id);
          if (ok) { matched++; results.push({ shopify_order_id: order.shopify_order_id, customer_name: order.customer_name, friend_name: candidate.displayName, matched_by: candidate.matchedBy }); }
          else { errors++; }
        } else { skipped++; }
      } catch { errors++; }
    }
    return { totalUnmatchedOrders: unmatchOrders.results.length, matched, skipped, errors, results };
  } catch { return { totalUnmatchedOrders: 0, matched: 0, skipped: 0, errors: 1, results: [] }; }
}
