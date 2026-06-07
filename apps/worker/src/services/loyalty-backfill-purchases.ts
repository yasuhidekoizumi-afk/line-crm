import {
  getLoyaltyPointByShopifyCustomerId,
  upsertLoyaltyPoint,
  addLoyaltyTransaction,
  determineRank,
  calculatePoints,
  getLoyaltySetting,
  type LoyaltyPointRow,
} from '@line-crm/db';
import { getShopifyAdminToken } from '../utils/shopify-token.js';
import { classifyBackfillOrder, type BackfillOrder } from './loyalty-backfill-core.js';

// ────────────────────────────────────────────────────────────────────
// バグA: 移管後の「付与漏れ購入ポイント」補填（Shopify 直読み版）
//
// なぜ Shopify を直接読むか:
//   付与漏れの原因(注文 webhook の宛先が旧GAS)で、自社の注文台帳 shopify_orders も
//   5/8 以降が欠落している。台帳を読むと取りこぼすため、おおもとの Shopify を直接見る。
//
// 仕様:
//   - 対象 = since(既定2026-04-15)以降の有効注文 × 会員(loyalty_points有り) × award未付与。
//   - LINE通知なし。マイページ履歴(reason)に残すのみ。
//   - 冪等: 既に award がある order_id は付与しない。同一注文の重複も seen で除外。
//   - dryRun(既定true)は集計のみ。execute は1回 maxAward 件まで(古い順)。
//   ※ 判定ロジック(classifyBackfillOrder)は ./loyalty-backfill-core.ts に分離(テスト対象)。
// ────────────────────────────────────────────────────────────────────

export type { BackfillOrder };

export interface BackfillEnv {
  DB: D1Database;
  SHOPIFY_SHOP_DOMAIN?: string;
  SHOPIFY_CLIENT_ID?: string;
  SHOPIFY_CLIENT_SECRET?: string;
  SHOPIFY_ADMIN_TOKEN?: string;
}

export interface BackfillSummary {
  dryRun: boolean;
  since: string;
  scannedOrders: number;     // Shopify から取得した注文数
  targetOrders: number;      // 補填対象の注文数
  targetAmountJpy: number;   // 対象注文の売上合計
  estimatedPoints: number;   // 付与見込み(ランク倍率込み)
  awarded: number;           // 実際に付与した件数(execute時)
  awardedPoints: number;     // 実際に付与したpt
  errors: number;
  pagesFetched: number;
  hitPageCap: boolean;       // ページ上限に達した(=取得しきれていない可能性)
}

const SHOPIFY_API_VERSION = '2024-10';
const PAGE_SIZE = 250;

/** Link ヘッダから rel="next" の URL を取り出す */
function parseNextLink(linkHeader: string | null): string | null {
  if (!linkHeader) return null;
  const m = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
  return m ? m[1] : null;
}

/**
 * since 以降の有効注文を Shopify から取得し、付与漏れ(会員×award未付与)を補填する。
 * dryRun=true なら集計のみ。
 */
export async function runPurchaseBackfill(
  env: BackfillEnv,
  opts: { since?: string; dryRun?: boolean; maxAward?: number; maxPages?: number } = {},
): Promise<BackfillSummary> {
  const since = (opts.since ?? '2026-04-15').trim();
  const dryRun = opts.dryRun !== false;
  const maxAward = Math.min(Math.max(opts.maxAward ?? 200, 1), 500);
  const maxPages = Math.min(Math.max(opts.maxPages ?? 12, 1), 40);

  const summary: BackfillSummary = {
    dryRun, since, scannedOrders: 0, targetOrders: 0, targetAmountJpy: 0,
    estimatedPoints: 0, awarded: 0, awardedPoints: 0, errors: 0, pagesFetched: 0, hitPageCap: false,
  };

  const shopDomain = env.SHOPIFY_SHOP_DOMAIN;
  const adminToken = await getShopifyAdminToken(env);
  if (!shopDomain || !adminToken) throw new Error('Shopify credentials not configured');

  const pointRate = parseFloat((await getLoyaltySetting(env.DB, 'point_rate').catch(() => null)) ?? '0.01') || 0.01;
  const expiryDays = parseInt((await getLoyaltySetting(env.DB, 'expiry_days').catch(() => null)) ?? '365', 10) || 365;

  // 既付与の order_id 集合（数値=購入由来のみ）
  const awardedRows = await env.DB
    .prepare(`SELECT DISTINCT order_id FROM loyalty_transactions WHERE type='award' AND order_id GLOB '[0-9]*'`)
    .all<{ order_id: string }>();
  const awardedSet = new Set<string>((awardedRows.results ?? []).map((r) => String(r.order_id)));

  // 会員(loyalty_points)の現在値キャッシュ。execute では付与のたびに更新して残高を積む。
  const memberCache = new Map<string, LoyaltyPointRow | null>();
  const getMember = async (scid: string): Promise<LoyaltyPointRow | null> => {
    if (memberCache.has(scid)) return memberCache.get(scid) ?? null;
    const row = await getLoyaltyPointByShopifyCustomerId(env.DB, scid).catch(() => null);
    memberCache.set(scid, row);
    return row;
  };

  const seen = new Set<string>();

  // Shopify 注文をページング取得（created_at 昇順）
  const firstParams = new URLSearchParams({
    status: 'any', limit: String(PAGE_SIZE), order: 'created_at asc',
    created_at_min: since,
    fields: 'id,customer,total_price,currency,financial_status,cancelled_at,processed_at,created_at',
  });
  let nextUrl: string | null = `https://${shopDomain}/admin/api/${SHOPIFY_API_VERSION}/orders.json?${firstParams}`;

  while (nextUrl) {
    if (summary.pagesFetched >= maxPages) { summary.hitPageCap = true; break; }
    const res = await fetch(nextUrl, { headers: { 'X-Shopify-Access-Token': adminToken, 'Content-Type': 'application/json' } });
    if (!res.ok) throw new Error(`Shopify ${res.status}: ${(await res.text()).slice(0, 300)}`);
    summary.pagesFetched++;
    const data = (await res.json()) as {
      orders?: Array<{ id: number | string; customer?: { id?: number | string } | null; total_price?: string; currency?: string; financial_status?: string; cancelled_at?: string | null; processed_at?: string }>;
    };
    const orders = data.orders ?? [];

    for (const raw of orders) {
      summary.scannedOrders++;
      const o: BackfillOrder = {
        id: raw.id != null ? String(raw.id) : '',
        scid: raw.customer?.id != null ? String(raw.customer.id) : '',
        amount: Math.floor(parseFloat(raw.total_price ?? '0')),
        currency: raw.currency ?? null,
        financialStatus: raw.financial_status ?? null,
        cancelledAt: raw.cancelled_at ?? null,
        processedAt: raw.processed_at ?? null,
      };

      // 会員判定（非同期なので isMember を都度評価）
      const member = o.scid ? await getMember(o.scid) : null;
      const decision = classifyBackfillOrder(
        o,
        (id) => awardedSet.has(id),
        () => member != null,
        seen,
      );
      if (!decision.ok) continue;
      seen.add(o.id);

      const rank = determineRank(member!.total_spent ?? 0);
      const pts = calculatePoints(o.amount, rank, pointRate);
      summary.targetOrders++;
      summary.targetAmountJpy += o.amount;
      summary.estimatedPoints += pts;

      if (dryRun) continue;
      if (summary.awarded >= maxAward) continue; // 上限到達後は集計のみ続行
      if (pts <= 0) continue;

      try {
        // 同一顧客の複数注文を順に積む（キャッシュ値を更新）
        const cur = member!;
        const newBalance = cur.balance + pts;
        const newSpent = (cur.total_spent ?? 0) + o.amount;
        await upsertLoyaltyPoint(env.DB, cur.friend_id, {
          balance: newBalance, totalSpent: newSpent, rank: determineRank(newSpent), shopifyCustomerId: o.scid,
        });
        await addLoyaltyTransaction(env.DB, {
          friendId: cur.friend_id, type: 'award', points: pts,
          balanceAfter: newBalance + (cur.limited_balance ?? 0),
          reason: `システム不具合により付与されていなかった購入ポイントを補填しました（注文 ${o.id}）`,
          orderId: o.id, expiryDays,
        });
        // キャッシュ更新（次の同一顧客注文に反映）＋ 二重付与防止セットにも追加
        memberCache.set(o.scid, { ...cur, balance: newBalance, total_spent: newSpent });
        awardedSet.add(o.id);
        summary.awarded++;
        summary.awardedPoints += pts;
      } catch (e) {
        summary.errors++;
        console.error(`[backfill-purchases] order=${o.id} 付与失敗:`, e);
      }
    }

    nextUrl = parseNextLink(res.headers.get('Link') ?? res.headers.get('link'));
  }

  if (summary.targetOrders > 0) {
    console.log(`[backfill-purchases] dryRun=${dryRun} scanned=${summary.scannedOrders} target=${summary.targetOrders}(¥${summary.targetAmountJpy}/~${summary.estimatedPoints}pt) awarded=${summary.awarded} pages=${summary.pagesFetched}`);
  }
  return summary;
}
