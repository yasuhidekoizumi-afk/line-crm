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
  expires_at: string | null;
  source_tx_id: string | null;
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

export function calculatePoints(orderAmount: number, rank: LoyaltyRank, rate = 0.01): number {
  return Math.floor(orderAmount * rate * RANK_MULTIPLIERS[rank]);
}

// --- キャンペーン ---

export type CampaignActionType = 'rate_multiply' | 'rate_add' | 'fixed_points';
export type CampaignStatus = 'active' | 'draft';

export type CampaignCondition =
  | { type: 'customer_tag';     value: string }  // 顧客タグが value を含む
  | { type: 'product_tag';      value: string }  // 商品タグが value を含む
  | { type: 'product_id';       value: string }  // 商品ID（カンマ区切り）
  | { type: 'product_type';     value: string }  // 商品タイプが value を含む
  | { type: 'collection_id';    value: string }  // コレクションID（カンマ区切り）
  | { type: 'min_order_amount'; value: number }  // 注文金額が value 以上
  | { type: 'order_count_gte';  value: number }  // 累計注文回数が value 以上
  | { type: 'total_spent_gte';  value: number };  // 累計購入金額が value 以上

export interface LoyaltyCampaignRow {
  id: string;
  name: string;
  description: string | null;
  status: CampaignStatus;
  starts_at: string | null;
  ends_at: string | null;
  conditions: string; // JSON
  action_type: CampaignActionType;
  action_value: number;
  created_at: string;
  updated_at: string;
}

export interface LoyaltyCampaign extends Omit<LoyaltyCampaignRow, 'conditions'> {
  conditions: CampaignCondition[];
}

function parseCampaign(row: LoyaltyCampaignRow): LoyaltyCampaign {
  return { ...row, conditions: JSON.parse(row.conditions || '[]') };
}

export async function getCampaigns(db: D1Database): Promise<LoyaltyCampaign[]> {
  const rows = await db
    .prepare(`SELECT * FROM loyalty_campaigns ORDER BY created_at DESC`)
    .all<LoyaltyCampaignRow>();
  return rows.results.map(parseCampaign);
}

export async function getActiveCampaigns(db: D1Database): Promise<LoyaltyCampaign[]> {
  const now = new Date().toISOString();
  const rows = await db
    .prepare(`
      SELECT * FROM loyalty_campaigns
      WHERE status = 'active'
        AND (starts_at IS NULL OR starts_at <= ?)
        AND (ends_at   IS NULL OR ends_at   >= ?)
      ORDER BY created_at ASC
    `)
    .bind(now, now)
    .all<LoyaltyCampaignRow>();
  return rows.results.map(parseCampaign);
}

export async function getCampaign(db: D1Database, id: string): Promise<LoyaltyCampaign | null> {
  const row = await db
    .prepare(`SELECT * FROM loyalty_campaigns WHERE id = ?`)
    .bind(id)
    .first<LoyaltyCampaignRow>();
  return row ? parseCampaign(row) : null;
}

export async function createCampaign(
  db: D1Database,
  input: {
    name: string;
    description?: string;
    status?: CampaignStatus;
    starts_at?: string;
    ends_at?: string;
    conditions?: CampaignCondition[];
    action_type: CampaignActionType;
    action_value: number;
  },
): Promise<string> {
  const id = crypto.randomUUID();
  const now = jstNow();
  await db
    .prepare(`
      INSERT INTO loyalty_campaigns
        (id, name, description, status, starts_at, ends_at, conditions, action_type, action_value, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .bind(
      id,
      input.name,
      input.description ?? null,
      input.status ?? 'draft',
      input.starts_at ?? null,
      input.ends_at ?? null,
      JSON.stringify(input.conditions ?? []),
      input.action_type,
      input.action_value,
      now,
      now,
    )
    .run();
  return id;
}

export async function updateCampaign(
  db: D1Database,
  id: string,
  updates: Partial<{
    name: string;
    description: string | null;
    status: CampaignStatus;
    starts_at: string | null;
    ends_at: string | null;
    conditions: CampaignCondition[];
    action_type: CampaignActionType;
    action_value: number;
  }>,
): Promise<void> {
  const now = jstNow();
  const fields: string[] = [];
  const values: unknown[] = [];
  for (const [k, v] of Object.entries(updates)) {
    fields.push(`${k} = ?`);
    values.push(k === 'conditions' ? JSON.stringify(v) : v);
  }
  if (!fields.length) return;
  fields.push('updated_at = ?');
  values.push(now, id);
  await db.prepare(`UPDATE loyalty_campaigns SET ${fields.join(', ')} WHERE id = ?`).bind(...values).run();
}

export async function deleteCampaign(db: D1Database, id: string): Promise<void> {
  await db.prepare(`DELETE FROM loyalty_campaigns WHERE id = ?`).bind(id).run();
}

/**
 * アクティブなキャンペーンを適用してポイントを計算する
 * @param basePoints   calculatePoints() で算出した基本ポイント数
 * @param orderAmount  注文金額
 * @param context      顧客タグ・商品タグ等の情報
 * @param campaigns    getActiveCampaigns() の結果
 */
export function applyCampaigns(
  basePoints: number,
  orderAmount: number,
  context: {
    customerTags?: string[];
    productTags?: string[];
    productIds?: string[];
    productTypes?: string[];
    collectionIds?: string[];
    orderCount?: number;
    totalSpent?: number;
  },
  campaigns: LoyaltyCampaign[],
): { finalPoints: number; appliedCampaigns: string[] } {
  let finalPoints = basePoints;
  const appliedCampaigns: string[] = [];

  for (const campaign of campaigns) {
    // 条件チェック
    const matched = campaign.conditions.every((cond) => {
      switch (cond.type) {
        case 'customer_tag':
          return (context.customerTags ?? []).some((t) => t.toLowerCase().includes(cond.value.toLowerCase()));
        case 'product_tag':
          return (context.productTags ?? []).some((t) => t.toLowerCase().includes(cond.value.toLowerCase()));
        case 'product_id': {
          const ids = cond.value.split(',').map((s) => s.trim());
          return (context.productIds ?? []).some((id) => ids.includes(id));
        }
        case 'product_type':
          return (context.productTypes ?? []).some((t) => t.toLowerCase().includes(cond.value.toLowerCase()));
        case 'collection_id': {
          const ids = cond.value.split(',').map((s) => s.trim());
          return (context.collectionIds ?? []).some((id) => ids.includes(id));
        }
        case 'min_order_amount':
          return orderAmount >= cond.value;
        case 'order_count_gte':
          return (context.orderCount ?? 0) >= cond.value;
        case 'total_spent_gte':
          return (context.totalSpent ?? 0) >= cond.value;
        default:
          return false;
      }
    });

    if (!matched) continue;

    appliedCampaigns.push(campaign.name);

    switch (campaign.action_type) {
      case 'rate_multiply':
        finalPoints = Math.floor(finalPoints * campaign.action_value);
        break;
      case 'rate_add':
        // 基本ポイントへの上乗せ（追加 N% 分）
        finalPoints = finalPoints + Math.floor(orderAmount * (campaign.action_value / 100));
        break;
      case 'fixed_points':
        finalPoints = Math.floor(campaign.action_value);
        break;
    }
  }

  return { finalPoints, appliedCampaigns };
}

// --- 設定ヘルパー ---

export interface LoyaltySetting {
  key: string;
  value: string;
  label: string;
  updated_at: string;
}

export async function getLoyaltySettings(db: D1Database): Promise<LoyaltySetting[]> {
  const rows = await db
    .prepare(`SELECT key, value, label, updated_at FROM loyalty_settings ORDER BY key`)
    .all<LoyaltySetting>();
  return rows.results;
}

export async function getLoyaltySetting(db: D1Database, key: string): Promise<string | null> {
  const row = await db
    .prepare(`SELECT value FROM loyalty_settings WHERE key = ?`)
    .bind(key)
    .first<{ value: string }>();
  return row?.value ?? null;
}

export async function setLoyaltySetting(db: D1Database, key: string, value: string): Promise<void> {
  const now = jstNow();
  await db
    .prepare(`UPDATE loyalty_settings SET value = ?, updated_at = ? WHERE key = ?`)
    .bind(value, now, key)
    .run();
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
    sourceTxId?: string;
    expiryDays?: number; // award トランザクションの有効期限（日数）。省略時は365日
  },
): Promise<void> {
  const now = jstNow();
  const days = input.expiryDays ?? 365;
  // award トランザクションは付与日 + expiryDays 日で失効
  const expiresAt =
    input.type === 'award'
      ? new Date(new Date(now).getTime() + days * 24 * 60 * 60 * 1000).toISOString().replace('Z', '+09:00').replace(/\.\d{3}/, '.000')
      : null;
  await db
    .prepare(
      `INSERT INTO loyalty_transactions (id, friend_id, type, points, balance_after, reason, order_id, staff_id, created_at, expires_at, source_tx_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      expiresAt,
      input.sourceTxId ?? null,
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

export async function getLoyaltyPointByShopifyCustomerId(
  db: D1Database,
  shopifyCustomerId: string,
): Promise<LoyaltyPointRow | null> {
  return db
    .prepare(`SELECT * FROM loyalty_points WHERE shopify_customer_id = ?`)
    .bind(shopifyCustomerId)
    .first<LoyaltyPointRow>();
}

// Shopify顧客IDでトランザクション履歴取得
export async function getLoyaltyTransactionsByShopifyCustomerId(
  db: D1Database,
  shopifyCustomerId: string,
  opts: { limit?: number; offset?: number } = {},
): Promise<{ items: LoyaltyTransactionRow[]; total: number }> {
  const limit = opts.limit ?? 10;
  const offset = opts.offset ?? 0;

  const pointRow = await db
    .prepare(`SELECT friend_id FROM loyalty_points WHERE shopify_customer_id = ?`)
    .bind(shopifyCustomerId)
    .first<{ friend_id: string }>();

  if (!pointRow) return { items: [], total: 0 };

  const countRow = await db
    .prepare(`SELECT COUNT(*) as n FROM loyalty_transactions WHERE friend_id = ?`)
    .bind(pointRow.friend_id)
    .first<{ n: number }>();

  const rows = await db
    .prepare(`SELECT * FROM loyalty_transactions WHERE friend_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?`)
    .bind(pointRow.friend_id, limit, offset)
    .all<LoyaltyTransactionRow>();

  return { items: rows.results, total: countRow?.n ?? 0 };
}

// 次に失効するポイント（FIFO計算）
export async function getExpiringSoonPoints(
  db: D1Database,
  friendId: string,
): Promise<{ points: number; expires_at: string } | null> {
  const now = new Date().toISOString();

  // 未失効の award を古い順に取得
  const awards = await db
    .prepare(`SELECT id, points, created_at, expires_at FROM loyalty_transactions WHERE friend_id = ? AND type = 'award' AND expires_at > ? ORDER BY created_at ASC`)
    .bind(friendId, now)
    .all<{ id: string; points: number; created_at: string; expires_at: string }>();

  if (!awards.results.length) return null;

  // 消費済みポイントの合計（redeem + expire）
  const consumed = await db
    .prepare(`SELECT COALESCE(SUM(ABS(points)), 0) as total FROM loyalty_transactions WHERE friend_id = ? AND type IN ('redeem', 'expire')`)
    .bind(friendId)
    .first<{ total: number }>();

  let remaining = consumed?.total ?? 0;
  for (const award of awards.results) {
    if (remaining >= award.points) {
      remaining -= award.points;
      continue;
    }
    // このバッチにまだポイントが残っている
    const leftInBatch = award.points - remaining;
    return { points: leftInBatch, expires_at: award.expires_at };
  }
  return null;
}

// 期限切れの未処理 award トランザクションを取得
export async function getExpiredUnprocessedAwards(
  db: D1Database,
): Promise<{ friend_id: string; award_id: string; points: number }[]> {
  const now = new Date().toISOString();

  const rows = await db
    .prepare(`
      SELECT lt.friend_id, lt.id as award_id, lt.points
      FROM loyalty_transactions lt
      WHERE lt.type = 'award'
        AND lt.expires_at IS NOT NULL
        AND lt.expires_at <= ?
        AND NOT EXISTS (
          SELECT 1 FROM loyalty_transactions ex
          WHERE ex.type = 'expire' AND ex.source_tx_id = lt.id
        )
      ORDER BY lt.expires_at ASC
    `)
    .bind(now)
    .all<{ friend_id: string; award_id: string; points: number }>();

  return rows.results;
}

export async function getLatestRedeemTransaction(
  db: D1Database,
  friendId: string,
): Promise<LoyaltyTransactionRow | null> {
  return db
    .prepare(
      `SELECT * FROM loyalty_transactions WHERE friend_id = ? AND type = 'redeem' ORDER BY created_at DESC LIMIT 1`,
    )
    .bind(friendId)
    .first<LoyaltyTransactionRow>();
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
