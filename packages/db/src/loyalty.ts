import { jstNow } from './utils.js';

export type LoyaltyRank = 'レギュラー' | 'シルバー' | 'ゴールド' | 'プラチナ' | 'ダイヤモンド';
export type TransactionType = 'award' | 'redeem' | 'adjust' | 'expire';

export interface LoyaltyPointRow {
  id: string;
  friend_id: string;
  balance: number;
  total_spent: number;
  rank: LoyaltyRank;
  shopify_customer_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface LoyaltyTransactionRow {
  id: string;
  friend_id: string;
  type: TransactionType;
  points: number;
  balance_after: number;
  reason: string | null;
  order_id: string | null;
  staff_id: string | null;
  created_at: string;
}

// ランク閾値（累計購入額 円）
const RANK_THRESHOLDS: { rank: LoyaltyRank; minSpent: number }[] = [
  { rank: 'ダイヤモンド', minSpent: 300_000 },
  { rank: 'プラチナ',     minSpent: 100_000 },
  { rank: 'ゴールド',     minSpent:  30_000 },
  { rank: 'シルバー',     minSpent:  10_000 },
  { rank: 'レギュラー',   minSpent:       0 },
];

export function determineRank(totalSpent: number): LoyaltyRank {
  for (const { rank, minSpent } of RANK_THRESHOLDS) {
    if (totalSpent >= minSpent) return rank;
  }
  return 'レギュラー';
}

// ポイント倍率
const RANK_MULTIPLIERS: Record<LoyaltyRank, number> = {
  'レギュラー':   1.0,
  'シルバー':     1.5,
  'ゴールド':     2.0,
  'プラチナ':     3.0,
  'ダイヤモンド': 5.0,
};

export function calculatePoints(orderAmount: number, rank: LoyaltyRank): number {
  const rate = 0.01; // 1%
  return Math.floor(orderAmount * rate * RANK_MULTIPLIERS[rank]);
}

// --- クエリヘルパー ---

export async function getLoyaltyPoint(db: D1Database, friendId: string): Promise<LoyaltyPointRow | null> {
  return db.prepare(`SELECT * FROM loyalty_points WHERE friend_id = ?`).bind(friendId).first<LoyaltyPointRow>();
}

export async function getLoyaltyPoints(
  db: D1Database,
  opts: { limit?: number; offset?: number; rank?: LoyaltyRank; search?: string } = {},
): Promise<{ items: (LoyaltyPointRow & { display_name: string | null; picture_url: string | null })[]; total: number }> {
  const limit = opts.limit ?? 20;
  const offset = opts.offset ?? 0;

  let where = '1=1';
  const bindings: unknown[] = [];

  if (opts.rank) {
    where += ' AND lp.rank = ?';
    bindings.push(opts.rank);
  }
  if (opts.search) {
    where += ' AND f.display_name LIKE ?';
    bindings.push(`%${opts.search}%`);
  }

  const countRow = await db
    .prepare(`SELECT COUNT(*) as n FROM loyalty_points lp JOIN friends f ON f.id = lp.friend_id WHERE ${where}`)
    .bind(...bindings)
    .first<{ n: number }>();

  const rows = await db
    .prepare(
      `SELECT lp.*, f.display_name, f.picture_url
       FROM loyalty_points lp
       JOIN friends f ON f.id = lp.friend_id
       WHERE ${where}
       ORDER BY lp.balance DESC
       LIMIT ? OFFSET ?`,
    )
    .bind(...bindings, limit, offset)
    .all<LoyaltyPointRow & { display_name: string | null; picture_url: string | null }>();

  return { items: rows.results, total: countRow?.n ?? 0 };
}

export async function upsertLoyaltyPoint(
  db: D1Database,
  friendId: string,
  updates: { balance: number; totalSpent: number; rank: LoyaltyRank; shopifyCustomerId?: string },
): Promise<void> {
  const now = jstNow();
  await db
    .prepare(
      `INSERT INTO loyalty_points (id, friend_id, balance, total_spent, rank, shopify_customer_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (friend_id) DO UPDATE SET
         balance = excluded.balance,
         total_spent = excluded.total_spent,
         rank = excluded.rank,
         shopify_customer_id = COALESCE(excluded.shopify_customer_id, loyalty_points.shopify_customer_id),
         updated_at = excluded.updated_at`,
    )
    .bind(
      crypto.randomUUID(),
      friendId,
      updates.balance,
      updates.totalSpent,
      updates.rank,
      updates.shopifyCustomerId ?? null,
      now,
      now,
    )
    .run();
}

export async function addLoyaltyTransaction(
  db: D1Database,
  input: {
    friendId: string;
    type: TransactionType;
    points: number;
    balanceAfter: number;
    reason?: string;
    orderId?: string;
    staffId?: string;
  },
): Promise<void> {
  const now = jstNow();
  await db
    .prepare(
      `INSERT INTO loyalty_transactions (id, friend_id, type, points, balance_after, reason, order_id, staff_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      crypto.randomUUID(),
      input.friendId,
      input.type,
      input.points,
      input.balanceAfter,
      input.reason ?? null,
      input.orderId ?? null,
      input.staffId ?? null,
      now,
    )
    .run();
}

export async function getLoyaltyTransactions(
  db: D1Database,
  friendId: string,
  opts: { limit?: number; offset?: number } = {},
): Promise<{ items: LoyaltyTransactionRow[]; total: number }> {
  const limit = opts.limit ?? 20;
  const offset = opts.offset ?? 0;

  const countRow = await db
    .prepare(`SELECT COUNT(*) as n FROM loyalty_transactions WHERE friend_id = ?`)
    .bind(friendId)
    .first<{ n: number }>();

  const rows = await db
    .prepare(
      `SELECT * FROM loyalty_transactions WHERE friend_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    )
    .bind(friendId, limit, offset)
    .all<LoyaltyTransactionRow>();

  return { items: rows.results, total: countRow?.n ?? 0 };
}

export async function getLoyaltyStats(db: D1Database): Promise<{
  total: number;
  byRank: Record<LoyaltyRank, number>;
  totalPointsAwarded: number;
  totalPointsRedeemed: number;
}> {
  const rankRows = await db
    .prepare(`SELECT rank, COUNT(*) as n FROM loyalty_points GROUP BY rank`)
    .all<{ rank: LoyaltyRank; n: number }>();

  const txRows = await db
    .prepare(
      `SELECT type, SUM(ABS(points)) as total FROM loyalty_transactions WHERE type IN ('award','redeem') GROUP BY type`,
    )
    .all<{ type: string; total: number }>();

  const totalRow = await db
    .prepare(`SELECT COUNT(*) as n FROM loyalty_points`)
    .first<{ n: number }>();

  const byRank: Record<LoyaltyRank, number> = {
    'レギュラー': 0, 'シルバー': 0, 'ゴールド': 0, 'プラチナ': 0, 'ダイヤモンド': 0,
  };
  for (const row of rankRows.results) byRank[row.rank] = row.n;

  let totalPointsAwarded = 0;
  let totalPointsRedeemed = 0;
  for (const row of txRows.results) {
    if (row.type === 'award') totalPointsAwarded = row.total;
    if (row.type === 'redeem') totalPointsRedeemed = row.total;
  }

  return { total: totalRow?.n ?? 0, byRank, totalPointsAwarded, totalPointsRedeemed };
}
