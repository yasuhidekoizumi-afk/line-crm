import { jstNow } from './utils.js';

export type RewardItemStatus = 'active' | 'draft';
export type ExchangeStatus = 'pending' | 'fulfilled' | 'cancelled';

export interface RewardItemRow {
  id: string;
  name: string;
  description: string | null;
  image_url: string | null;
  required_points: number;
  status: RewardItemStatus;
  track_inventory: number; // 0 | 1
  stock: number | null;
  requires_shipping: number; // 0 | 1
  created_at: string;
  updated_at: string;
}

export interface RewardExchangeRow {
  id: string;
  friend_id: string;
  reward_item_id: string;
  reward_item_name: string;
  points_spent: number;
  status: ExchangeStatus;
  shopify_customer_id: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

// ── アイテム CRUD ─────────────────────────────────────────────

export async function getRewardItems(
  db: D1Database,
  opts: { statusFilter?: RewardItemStatus | 'all' } = {},
): Promise<RewardItemRow[]> {
  const filter = opts.statusFilter ?? 'all';
  if (filter === 'all') {
    const rows = await db
      .prepare(`SELECT * FROM reward_items ORDER BY created_at DESC`)
      .all<RewardItemRow>();
    return rows.results;
  }
  const rows = await db
    .prepare(`SELECT * FROM reward_items WHERE status = ? ORDER BY created_at DESC`)
    .bind(filter)
    .all<RewardItemRow>();
  return rows.results;
}

export async function getRewardItem(db: D1Database, id: string): Promise<RewardItemRow | null> {
  return db.prepare(`SELECT * FROM reward_items WHERE id = ?`).bind(id).first<RewardItemRow>();
}

export async function createRewardItem(
  db: D1Database,
  input: {
    name: string;
    description?: string;
    image_url?: string;
    required_points: number;
    status?: RewardItemStatus;
    track_inventory?: boolean;
    stock?: number | null;
    requires_shipping?: boolean;
  },
): Promise<string> {
  const id = crypto.randomUUID();
  const now = jstNow();
  await db
    .prepare(
      `INSERT INTO reward_items
         (id, name, description, image_url, required_points, status, track_inventory, stock, requires_shipping, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      input.name,
      input.description ?? null,
      input.image_url ?? null,
      input.required_points,
      input.status ?? 'draft',
      input.track_inventory ? 1 : 0,
      input.stock ?? null,
      input.requires_shipping ? 1 : 0,
      now,
      now,
    )
    .run();
  return id;
}

export async function updateRewardItem(
  db: D1Database,
  id: string,
  updates: Partial<{
    name: string;
    description: string | null;
    image_url: string | null;
    required_points: number;
    status: RewardItemStatus;
    track_inventory: boolean;
    stock: number | null;
    requires_shipping: boolean;
  }>,
): Promise<void> {
  const now = jstNow();
  const fields: string[] = [];
  const values: unknown[] = [];
  for (const [k, v] of Object.entries(updates)) {
    if (k === 'track_inventory' || k === 'requires_shipping') {
      fields.push(`${k} = ?`);
      values.push(v ? 1 : 0);
    } else {
      fields.push(`${k} = ?`);
      values.push(v ?? null);
    }
  }
  if (!fields.length) return;
  fields.push('updated_at = ?');
  values.push(now, id);
  await db
    .prepare(`UPDATE reward_items SET ${fields.join(', ')} WHERE id = ?`)
    .bind(...values)
    .run();
}

export async function deleteRewardItem(db: D1Database, id: string): Promise<void> {
  await db.prepare(`DELETE FROM reward_items WHERE id = ?`).bind(id).run();
}

// ── 在庫デクリメント ──────────────────────────────────────────

export async function decrementRewardStock(db: D1Database, id: string): Promise<boolean> {
  const item = await getRewardItem(db, id);
  if (!item) return false;
  if (!item.track_inventory || item.stock === null) return true; // 在庫追跡なし or 無制限
  if (item.stock <= 0) return false; // 在庫切れ
  await db
    .prepare(`UPDATE reward_items SET stock = stock - 1, updated_at = ? WHERE id = ?`)
    .bind(jstNow(), id)
    .run();
  return true;
}

// ── 交換申請 ─────────────────────────────────────────────────

export async function createRewardExchange(
  db: D1Database,
  input: {
    friendId: string;
    rewardItemId: string;
    rewardItemName: string;
    pointsSpent: number;
    shopifyCustomerId?: string;
  },
): Promise<string> {
  const id = crypto.randomUUID();
  const now = jstNow();
  await db
    .prepare(
      `INSERT INTO reward_exchanges
         (id, friend_id, reward_item_id, reward_item_name, points_spent, status, shopify_customer_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?)`,
    )
    .bind(
      id,
      input.friendId,
      input.rewardItemId,
      input.rewardItemName,
      input.pointsSpent,
      input.shopifyCustomerId ?? null,
      now,
      now,
    )
    .run();
  return id;
}

export async function getRewardExchanges(
  db: D1Database,
  opts: { limit?: number; offset?: number; status?: ExchangeStatus | 'all' } = {},
): Promise<{ items: (RewardExchangeRow & { display_name: string | null })[]; total: number }> {
  const limit = opts.limit ?? 20;
  const offset = opts.offset ?? 0;
  const statusFilter = opts.status && opts.status !== 'all' ? opts.status : null;

  const where = statusFilter ? `WHERE re.status = '${statusFilter}'` : '';

  const countRow = await db
    .prepare(`SELECT COUNT(*) as n FROM reward_exchanges re ${where}`)
    .first<{ n: number }>();

  const rows = await db
    .prepare(
      `SELECT re.*, f.display_name
       FROM reward_exchanges re
       LEFT JOIN friends f ON f.id = re.friend_id
       ${where}
       ORDER BY re.created_at DESC
       LIMIT ? OFFSET ?`,
    )
    .bind(limit, offset)
    .all<RewardExchangeRow & { display_name: string | null }>();

  return { items: rows.results, total: countRow?.n ?? 0 };
}

export async function updateRewardExchangeStatus(
  db: D1Database,
  id: string,
  status: ExchangeStatus,
  notes?: string,
): Promise<void> {
  const now = jstNow();
  await db
    .prepare(`UPDATE reward_exchanges SET status = ?, notes = ?, updated_at = ? WHERE id = ?`)
    .bind(status, notes ?? null, now, id)
    .run();
}
