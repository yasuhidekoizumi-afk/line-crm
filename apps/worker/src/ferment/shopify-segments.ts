/**
 * FERMENT: Shopify 顧客セグメントの取り込み（ミラー）
 *
 * Shopify Admin GraphQL の Customer Segments を取得し、各セグメントのメンバー
 * （顧客）を customerSegmentMembers から取り出して、ハーネスの segments /
 * segment_members に写し取る。LINE 連携済み（line_user_id あり）の顧客のみを
 * 配信対象として保存する。
 *
 * 大きいセグメントは1回の Worker 実行で取り切れない（サブリクエスト上限 ~1000）ため、
 * sync_cursor / sync_status を使って「分割・再開可能」に同期する。
 *
 * 呼び出し元:
 *   - apps/worker/src/ferment/routes/shopify-segments.ts（手動）
 *   - apps/worker/src/ferment/cron-segments.ts（定期）
 */

import { getShopifyAdminToken } from '../utils/shopify-token.js';
import { getSegmentById, updateSegment } from '@line-crm/db';

/** Shopify 同期に必要な環境変数（FermentEnv['Bindings'] の部分集合） */
export type ShopifySegmentEnv = {
  DB: D1Database;
  SHOPIFY_SHOP_DOMAIN?: string;
  SHOPIFY_ADMIN_TOKEN?: string;
  SHOPIFY_CLIENT_ID?: string;
  SHOPIFY_CLIENT_SECRET?: string;
};

const API_VERSION = '2024-01';

/**
 * 1チャンク（1 Worker 実行）で取得するメンバーページ数の上限。
 * 1ページ250件に対して D1 参照・挿入が複数回走るため、Workers のサブリクエスト上限に
 * 余裕を持たせて 8 ページ（=最大2,000件/実行）に制限する。
 */
const MAX_PAGES_PER_CHUNK = 8;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Shopify Admin GraphQL を叩く。スロットリング(THROTTLED/429)は指数バックオフで再試行。
 */
async function shopifyGraphQL<T>(
  env: ShopifySegmentEnv,
  query: string,
  variables: Record<string, unknown>,
): Promise<T> {
  const domain = env.SHOPIFY_SHOP_DOMAIN;
  const token = await getShopifyAdminToken(env);
  if (!domain || !token) throw new Error('Shopify credentials not configured');

  const url = `https://${domain}/admin/api/${API_VERSION}/graphql.json`;
  let lastErr = '';
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables }),
    });

    // レート制限（HTTP 429）は待って再試行
    if (res.status === 429) {
      lastErr = '429 Too Many Requests';
      await sleep(1000 * (attempt + 1));
      continue;
    }
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Shopify GraphQL ${res.status}: ${text.slice(0, 200)}`);
    }

    const json = await res.json<{
      data?: T;
      errors?: Array<{ message: string; extensions?: { code?: string } }>;
    }>();

    // コストベースのスロットリングは 200 + errors[].extensions.code='THROTTLED' で返る
    if (json.errors && json.errors.length > 0) {
      const throttled = json.errors.some((e) => e.extensions?.code === 'THROTTLED');
      if (throttled) {
        lastErr = 'THROTTLED';
        await sleep(1200 * (attempt + 1));
        continue;
      }
      throw new Error(`Shopify GraphQL errors: ${JSON.stringify(json.errors).slice(0, 300)}`);
    }
    if (!json.data) throw new Error('Shopify GraphQL: no data');
    return json.data;
  }
  throw new Error(`Shopify GraphQL 再試行上限: ${lastErr}`);
}

export interface ShopifyNativeSegment {
  gid: string; // gid://shopify/Segment/123
  name: string;
  query: string;
  lastEditDate: string | null;
}

/** Shopify の顧客セグメント一覧を全件取得する（ページング） */
export async function listShopifySegments(env: ShopifySegmentEnv): Promise<ShopifyNativeSegment[]> {
  const out: ShopifyNativeSegment[] = [];
  let after: string | null = null;
  // セグメント数は高々数百。安全側に最大10ページ（=2500件）で打ち切る。
  for (let page = 0; page < 10; page++) {
    const data = await shopifyGraphQL<{
      segments: {
        nodes: Array<{ id: string; name: string; query: string; lastEditDate: string | null }>;
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
      };
    }>(
      env,
      `query($after: String) {
        segments(first: 250, after: $after) {
          nodes { id name query lastEditDate }
          pageInfo { hasNextPage endCursor }
        }
      }`,
      { after },
    );
    for (const n of data.segments.nodes) {
      out.push({ gid: n.id, name: n.name, query: n.query, lastEditDate: n.lastEditDate ?? null });
    }
    if (!data.segments.pageInfo.hasNextPage) break;
    after = data.segments.pageInfo.endCursor;
  }
  return out;
}

/** customerSegmentMembers の1ページ（最大250件）を取得し、顧客ID(数字)とnextCursorを返す */
async function fetchMemberPage(
  env: ShopifySegmentEnv,
  source: { segmentGid: string } | { queryId: string },
  after: string | null,
): Promise<{ customerIds: string[]; nextCursor: string | null }> {
  const byQuery = 'queryId' in source;
  const data = await shopifyGraphQL<{
    customerSegmentMembers: {
      edges: Array<{ node: { id: string } }>;
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
    };
  }>(
    env,
    `query($segmentId: ID, $queryId: ID, $after: String) {
      customerSegmentMembers(first: 250, segmentId: $segmentId, queryId: $queryId, after: $after) {
        edges { node { id } }
        pageInfo { hasNextPage endCursor }
      }
    }`,
    {
      segmentId: byQuery ? null : source.segmentGid,
      queryId: byQuery ? source.queryId : null,
      after,
    },
  );
  const conn = data.customerSegmentMembers;
  // node.id = gid://shopify/CustomerSegmentMember/<customerId>（数字部分が顧客ID = legacyResourceId）
  const customerIds = conn.edges
    .map((e) => {
      const m = e.node.id.match(/(\d+)\s*$/);
      return m ? m[1] : '';
    })
    .filter(Boolean);
  return {
    customerIds,
    nextCursor: conn.pageInfo.hasNextPage ? conn.pageInfo.endCursor : null,
  };
}

async function createCustomerSegmentMembersQuery(
  env: ShopifySegmentEnv,
  segmentGid: string,
): Promise<{ id: string; done: boolean; currentCount: number }> {
  const data = await shopifyGraphQL<{
    customerSegmentMembersQueryCreate: {
      customerSegmentMembersQuery: { id: string; done: boolean; currentCount: number } | null;
      userErrors: Array<{ field?: string[] | null; message: string }>;
    };
  }>(
    env,
    `mutation($input: CustomerSegmentMembersQueryInput!) {
      customerSegmentMembersQueryCreate(input: $input) {
        customerSegmentMembersQuery { id done currentCount }
        userErrors { field message }
      }
    }`,
    { input: { segmentId: segmentGid } },
  );
  const payload = data.customerSegmentMembersQueryCreate;
  if (payload.userErrors.length > 0 || !payload.customerSegmentMembersQuery) {
    throw new Error(`Shopify async segment query errors: ${JSON.stringify(payload.userErrors).slice(0, 300)}`);
  }
  return payload.customerSegmentMembersQuery;
}

async function getCustomerSegmentMembersQuery(
  env: ShopifySegmentEnv,
  queryId: string,
): Promise<{ id: string; done: boolean; currentCount: number }> {
  const data = await shopifyGraphQL<{
    customerSegmentMembersQuery: { id: string; done: boolean; currentCount: number };
  }>(
    env,
    `query($id: ID!) {
      customerSegmentMembersQuery(id: $id) { id done currentCount }
    }`,
    { id: queryId },
  );
  return data.customerSegmentMembersQuery;
}

type SyncCursorState = { after: string | null; queryId?: string };

function parseSyncCursor(raw: string | null): SyncCursorState {
  if (!raw) return { after: null };
  try {
    const parsed = JSON.parse(raw) as Partial<SyncCursorState>;
    if (typeof parsed === 'object' && parsed) {
      return {
        after: typeof parsed.after === 'string' ? parsed.after : null,
        queryId: typeof parsed.queryId === 'string' ? parsed.queryId : undefined,
      };
    }
  } catch {
    // 旧形式のカーソルはそのまま after として扱う。
  }
  return { after: raw };
}

function stringifySyncCursor(state: SyncCursorState): string | null {
  if (!state.after && !state.queryId) return null;
  return JSON.stringify(state);
}

function requiresAsyncSegmentQuery(err: unknown): boolean {
  return String(err).includes('USE_CUSTOMER_SEGMENT_MEMBERS_QUERY_CREATE_MUTATION');
}

/** Shopify 顧客ID配列 → ハーネスの LINE 連携済み customer_id 配列に変換する */
async function mapToLineLinkedCustomerIds(db: D1Database, shopifyIds: string[]): Promise<string[]> {
  const out: string[] = [];
  const chunk = 90; // D1 のバインド上限対策
  for (let i = 0; i < shopifyIds.length; i += chunk) {
    const part = shopifyIds.slice(i, i + chunk);
    if (part.length === 0) continue;
    const placeholders = part.map(() => '?').join(', ');
    const res = await db
      .prepare(
        `SELECT customer_id FROM customers
         WHERE line_user_id IS NOT NULL AND shopify_customer_id_jp IN (${placeholders})`,
      )
      .bind(...part)
      .all<{ customer_id: string }>();
    for (const r of res.results) out.push(r.customer_id);
  }
  return out;
}

/** segment_members へ追記（INSERT OR IGNORE） */
async function appendMembers(db: D1Database, segmentId: string, customerIds: string[]): Promise<void> {
  const chunk = 40;
  for (let i = 0; i < customerIds.length; i += chunk) {
    const part = customerIds.slice(i, i + chunk);
    if (part.length === 0) continue;
    const placeholders = part.map(() => '(?, ?)').join(', ');
    const binds: string[] = [];
    for (const cid of part) binds.push(segmentId, cid);
    await db
      .prepare(`INSERT OR IGNORE INTO segment_members (segment_id, customer_id) VALUES ${placeholders}`)
      .bind(...binds)
      .run();
  }
}

export interface SyncChunkResult {
  done: boolean;          // このセグメントの同期が完了したか
  processedPages: number; // この実行で処理したメンバーページ数
  totalMembers: number;   // 現在の段階での累積メンバー数（LINE連携済み）
}

async function countSegmentMembers(db: D1Database, segmentId: string): Promise<number> {
  const row = await db
    .prepare('SELECT COUNT(*) as n FROM segment_members WHERE segment_id = ?')
    .bind(segmentId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

/**
 * Shopify セグメントを「分割・再開可能」に同期する（1チャンク分）。
 *
 * - 同期開始時（sync_status != 'syncing'）: 既存メンバーを全削除して 'syncing' にする
 * - sync_cursor からメンバーページを最大 MAX_PAGES_PER_CHUNK 件取得
 *   → LINE 連携済みにマップ → segment_members へ追記
 * - 続きがあれば cursor を保存して 'syncing' のまま（次回 cron / 手動で再開）
 * - 全件取り切ったら sync_status=null・customer_count を確定
 */
export async function syncShopifySegmentChunk(
  env: ShopifySegmentEnv,
  segmentId: string,
): Promise<SyncChunkResult> {
  const segment = await getSegmentById(env.DB, segmentId);
  if (!segment) throw new Error(`Segment not found: ${segmentId}`);
  if (segment.source !== 'shopify' || !segment.shopify_segment_id) {
    throw new Error(`Shopify セグメントではありません: ${segmentId}`);
  }
  const gid = segment.shopify_segment_id;

  // 再開判定: 'syncing' / 'error' でカーソルがある場合は続き、それ以外は新規同期（メンバーを一旦クリア）
  let cursor: string | null;
  let queryId: string | undefined;
  if ((segment.sync_status === 'syncing' || segment.sync_status === 'error') && segment.sync_cursor) {
    const state = parseSyncCursor(segment.sync_cursor);
    cursor = state.after;
    queryId = state.queryId;
    await updateSegment(env.DB, segmentId, { sync_status: 'syncing', sync_error: null });
  } else {
    cursor = null;
    await env.DB.prepare('DELETE FROM segment_members WHERE segment_id = ?').bind(segmentId).run();
    await updateSegment(env.DB, segmentId, { sync_status: 'syncing', sync_cursor: null, sync_error: null });
  }

  let pages = 0;
  try {
    while (pages < MAX_PAGES_PER_CHUNK) {
      if (queryId) {
        const asyncQuery = await getCustomerSegmentMembersQuery(env, queryId);
        if (!asyncQuery.done) {
          await updateSegment(env.DB, segmentId, {
            sync_status: 'syncing',
            sync_cursor: stringifySyncCursor({ queryId, after: cursor }),
            customer_count: await countSegmentMembers(env.DB, segmentId),
            last_computed_at: new Date().toISOString(),
          });
          return { done: false, processedPages: pages, totalMembers: await countSegmentMembers(env.DB, segmentId) };
        }
      }

      let page: { customerIds: string[]; nextCursor: string | null };
      try {
        page = await fetchMemberPage(env, queryId ? { queryId } : { segmentGid: gid }, cursor);
      } catch (err) {
        if (!queryId && requiresAsyncSegmentQuery(err)) {
          const asyncQuery = await createCustomerSegmentMembersQuery(env, gid);
          queryId = asyncQuery.id;
          await updateSegment(env.DB, segmentId, {
            sync_status: 'syncing',
            sync_cursor: stringifySyncCursor({ queryId, after: null }),
            customer_count: await countSegmentMembers(env.DB, segmentId),
            last_computed_at: new Date().toISOString(),
          });
          return { done: false, processedPages: pages, totalMembers: await countSegmentMembers(env.DB, segmentId) };
        }
        throw err;
      }
      const { customerIds, nextCursor } = page;
      pages++;
      if (customerIds.length > 0) {
        const harnessIds = await mapToLineLinkedCustomerIds(env.DB, customerIds);
        if (harnessIds.length > 0) await appendMembers(env.DB, segmentId, harnessIds);
      }
      cursor = nextCursor;
      if (!nextCursor) break;
    }
  } catch (err) {
    const totalMembers = await countSegmentMembers(env.DB, segmentId);
    await updateSegment(env.DB, segmentId, {
      sync_status: 'error',
      sync_error: String(err).slice(0, 300),
      sync_cursor: stringifySyncCursor({ queryId, after: cursor }),
      customer_count: totalMembers,
      last_computed_at: new Date().toISOString(),
    });
    throw err;
  }

  const totalMembers = await countSegmentMembers(env.DB, segmentId);
  const done = cursor === null;
  const now = new Date().toISOString();

  await updateSegment(env.DB, segmentId, {
    sync_status: done ? null : 'syncing',
    sync_cursor: done ? null : stringifySyncCursor({ queryId, after: cursor }),
    sync_error: null,
    customer_count: totalMembers,
    last_computed_at: now,
  });

  return { done, processedPages: pages, totalMembers };
}
