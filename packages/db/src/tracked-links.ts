import { jstNow } from './utils.js';
// =============================================================================
// Tracked Links — URL click tracking with automatic actions
// =============================================================================

export interface TrackedLink {
  id: string;
  name: string;
  original_url: string;
  tag_id: string | null;
  scenario_id: string | null;
  broadcast_id: string | null;
  is_active: number;
  click_count: number;
  created_at: string;
  updated_at: string;
}

export interface LinkClick {
  id: string;
  tracked_link_id: string;
  friend_id: string | null;
  clicked_at: string;
}

// ── CRUD ─────────────────────────────────────────────────────────────────────

export async function getTrackedLinks(db: D1Database): Promise<TrackedLink[]> {
  const result = await db
    .prepare(`SELECT * FROM tracked_links ORDER BY created_at DESC`)
    .all<TrackedLink>();
  return result.results;
}

export async function getTrackedLinkById(
  db: D1Database,
  id: string,
): Promise<TrackedLink | null> {
  return db
    .prepare(`SELECT * FROM tracked_links WHERE id = ?`)
    .bind(id)
    .first<TrackedLink>();
}

export interface CreateTrackedLinkInput {
  name: string;
  originalUrl: string;
  tagId?: string | null;
  scenarioId?: string | null;
  broadcastId?: string | null;
}

export async function createTrackedLink(
  db: D1Database,
  input: CreateTrackedLinkInput,
): Promise<TrackedLink> {
  const id = crypto.randomUUID();
  const now = jstNow();

  try {
    await db
      .prepare(
        `INSERT INTO tracked_links (id, name, original_url, tag_id, scenario_id, broadcast_id, is_active, click_count, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 1, 0, ?, ?)`,
      )
      .bind(
        id,
        input.name,
        input.originalUrl,
        input.tagId ?? null,
        input.scenarioId ?? null,
        input.broadcastId ?? null,
        now,
        now,
      )
      .run();
  } catch (e) {
    if (!String(e).includes('broadcast_id')) throw e;
    await db
      .prepare(
        `INSERT INTO tracked_links (id, name, original_url, tag_id, scenario_id, is_active, click_count, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 1, 0, ?, ?)`,
      )
      .bind(id, input.name, input.originalUrl, input.tagId ?? null, input.scenarioId ?? null, now, now)
      .run();
  }

  return (await getTrackedLinkById(db, id))!;
}

export async function deleteTrackedLink(db: D1Database, id: string): Promise<void> {
  await db.prepare(`DELETE FROM tracked_links WHERE id = ?`).bind(id).run();
}

// ── Click Recording ───────────────────────────────────────────────────────────

export async function recordLinkClick(
  db: D1Database,
  trackedLinkId: string,
  friendId?: string | null,
): Promise<LinkClick> {
  const id = crypto.randomUUID();
  const now = jstNow();

  await db
    .prepare(
      `INSERT INTO link_clicks (id, tracked_link_id, friend_id, clicked_at)
       VALUES (?, ?, ?, ?)`,
    )
    .bind(id, trackedLinkId, friendId ?? null, now)
    .run();

  await db
    .prepare(
      `UPDATE tracked_links SET click_count = click_count + 1, updated_at = ? WHERE id = ?`,
    )
    .bind(now, trackedLinkId)
    .run();

  return (await db
    .prepare(`SELECT * FROM link_clicks WHERE id = ?`)
    .bind(id)
    .first<LinkClick>())!;
}

export interface LinkClickWithFriend extends LinkClick {
  friend_display_name: string | null;
}

export async function getLinkClicks(
  db: D1Database,
  trackedLinkId: string,
): Promise<LinkClickWithFriend[]> {
  const result = await db
    .prepare(
      `SELECT lc.*, f.display_name as friend_display_name
       FROM link_clicks lc
       LEFT JOIN friends f ON f.id = lc.friend_id
       WHERE lc.tracked_link_id = ?
       ORDER BY lc.clicked_at DESC`,
    )
    .bind(trackedLinkId)
    .all<LinkClickWithFriend>();
  return result.results;
}

// ── Clicked but did not buy ──────────────────────────────────────────────────

export interface ClickedNonBuyerQueryInput {
  trackedLinkId: string;
  productId?: string | null;
  variantId?: string | null;
  sku?: string | null;
  windowDays?: number | null;
  limit?: number | null;
  offset?: number | null;
}

export interface QueryWithBindings {
  sql: string;
  bindings: unknown[];
}

export interface ClickedNonBuyerFriend {
  friend_id: string;
  line_user_id: string;
  display_name: string | null;
  picture_url: string | null;
  click_count: number;
  first_clicked_at: string;
  last_clicked_at: string;
}

function normalizeWindowDays(windowDays?: number | null): number {
  const n = Number(windowDays ?? 3);
  if (!Number.isFinite(n) || n <= 0) return 3;
  return Math.min(Math.floor(n), 90);
}

function buildProductMatcher(input: ClickedNonBuyerQueryInput): QueryWithBindings {
  const parts: string[] = [];
  const bindings: unknown[] = [];

  if (input.productId) {
    parts.push('oi.shopify_product_id = ?');
    bindings.push(input.productId);
  }
  if (input.variantId) {
    parts.push('oi.shopify_variant_id = ?');
    bindings.push(input.variantId);
  }
  if (input.sku) {
    parts.push('oi.sku = ?');
    bindings.push(input.sku);
  }

  if (parts.length === 0) {
    throw new Error('productId, variantId, or sku is required');
  }

  return { sql: `(${parts.join(' OR ')})`, bindings };
}

export function buildClickedNonBuyerQuery(input: ClickedNonBuyerQueryInput): QueryWithBindings {
  if (!input.trackedLinkId) {
    throw new Error('trackedLinkId is required');
  }

  const productMatcher = buildProductMatcher(input);
  const windowDays = normalizeWindowDays(input.windowDays);
  const limit = Math.min(Math.max(Number(input.limit ?? 500), 1), 5000);
  const offset = Math.max(Number(input.offset ?? 0), 0);

  return {
    sql: `
      WITH friend_clicks AS (
        SELECT
          lc.friend_id,
          COUNT(*) AS click_count,
          MIN(lc.clicked_at) AS first_clicked_at,
          MAX(lc.clicked_at) AS last_clicked_at
        FROM link_clicks lc
        WHERE lc.tracked_link_id = ?
          AND lc.friend_id IS NOT NULL
        GROUP BY lc.friend_id
      )
      SELECT
        f.id AS friend_id,
        f.line_user_id,
        f.display_name,
        f.picture_url,
        fc.click_count,
        fc.first_clicked_at,
        fc.last_clicked_at
      FROM friend_clicks fc
      JOIN friends f ON f.id = fc.friend_id
      WHERE f.is_following = 1
        AND f.line_user_id LIKE 'U%'
        AND NOT EXISTS (
          SELECT 1
          FROM shopify_orders o
          JOIN shopify_order_items oi ON oi.shopify_order_id = o.shopify_order_id
          WHERE o.friend_id = fc.friend_id
            AND o.cancelled_at IS NULL
            AND (o.financial_status IS NULL OR o.financial_status NOT IN ('refunded', 'voided'))
            AND ${productMatcher.sql}
            AND datetime(o.processed_at) >= datetime(fc.first_clicked_at)
            AND datetime(o.processed_at) < datetime(fc.first_clicked_at, '+' || ? || ' days')
        )
      ORDER BY fc.last_clicked_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `,
    bindings: [input.trackedLinkId, ...productMatcher.bindings, windowDays],
  };
}

export async function getClickedNonBuyers(
  db: D1Database,
  input: ClickedNonBuyerQueryInput,
): Promise<ClickedNonBuyerFriend[]> {
  const query = buildClickedNonBuyerQuery(input);
  const result = await db
    .prepare(query.sql)
    .bind(...query.bindings)
    .all<ClickedNonBuyerFriend>();
  return result.results;
}

export async function addTagToClickedNonBuyers(
  db: D1Database,
  input: ClickedNonBuyerQueryInput & { tagId: string },
): Promise<{ taggedCount: number; friendIds: string[] }> {
  if (!input.tagId) {
    throw new Error('tagId is required');
  }

  const friends = await getClickedNonBuyers(db, input);
  if (friends.length === 0) {
    return { taggedCount: 0, friendIds: [] };
  }

  const now = jstNow();
  for (const friend of friends) {
    await db
      .prepare(
        `INSERT OR IGNORE INTO friend_tags (friend_id, tag_id, assigned_at)
         VALUES (?, ?, ?)`,
      )
      .bind(friend.friend_id, input.tagId, now)
      .run();
  }

  return { taggedCount: friends.length, friendIds: friends.map((f) => f.friend_id) };
}
