import { jstNow } from './utils.js';

// =============================================================================
// eGift Pilot — Types
// =============================================================================

export type EgiftCampaignStatus = 'draft' | 'active' | 'paused' | 'completed';
export type EgiftApplicationStatus = 'applied' | 'won' | 'lost' | 'cancelled';
export type EgiftGiftStatus = 'issued' | 'opened' | 'line_added' | 'redeemed' | 'fulfilled' | 'expired' | 'cancelled';
export type EgiftEventType = 'issued' | 'opened' | 'line_add_clicked' | 'line_added' | 'redeemed' | 'fulfilled' | 'first_purchase' | 'expired' | 'blocked';
export type EgiftOccasion = 'birthday' | 'anniversary' | 'other';

export interface EgiftCampaign {
  id: string;
  name: string;
  status: EgiftCampaignStatus;
  starts_at: string;
  ends_at: string;
  daily_winner_limit: number;
  total_gift_limit: number | null;
  target_sku: string | null;
  target_product_id: string | null;
  target_variant_id: string | null;
  inventory_budget: number | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface EgiftApplication {
  id: string;
  campaign_id: string;
  giver_friend_id: string;
  occasion: EgiftOccasion;
  message: string | null;
  status: EgiftApplicationStatus;
  lottery_weight: number;
  applied_at: string;
  decided_at: string | null;
}

export interface EgiftGift {
  id: string;
  campaign_id: string;
  application_id: string;
  giver_friend_id: string;
  gift_token_hash: string;
  status: EgiftGiftStatus;
  issued_at: string;
  first_opened_at: string | null;
  line_added_at: string | null;
  redeemed_at: string | null;
  fulfilled_at: string | null;
  expires_at: string;
  redeem_expires_at: string;
  recipient_friend_id: string | null;
  recipient_email: string | null;
  recipient_phone_hash: string | null;
  recipient_name: string | null;
  recipient_zip: string | null;
  recipient_address: string | null;
  shopify_coupon_code: string | null;
  attributed_order_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface EgiftEvent {
  id: string;
  gift_id: string;
  event_type: EgiftEventType;
  friend_id: string | null;
  metadata: string | null;
  created_at: string;
}

export interface EgiftRecipientPurchase {
  id: string;
  gift_id: string;
  recipient_friend_id: string | null;
  shopify_order_id: string;
  shopify_customer_id: string | null;
  is_first_order: number;
  order_total: number;
  gross_profit_estimate: number | null;
  attribution_status: string;
  purchased_at: string;
  created_at: string;
}

export interface EgiftKpi {
  applications: number;
  winners: number;
  issuedGifts: number;
  openedGifts: number;
  lineAddedGifts: number;
  redeemedGifts: number;
  fulfilledGifts: number;
  firstPurchaseRecipients: number;
  friendAddRate: number;
  redeemRate: number;
  firstPurchaseRate: number;
  blockedRecipients: number;
}

// =============================================================================
// Campaign CRUD
// =============================================================================

export async function createEgiftCampaign(
  db: D1Database,
  input: {
    name: string;
    startsAt: string;
    endsAt: string;
    dailyWinnerLimit?: number;
    totalGiftLimit?: number | null;
    targetSku?: string | null;
    targetProductId?: string | null;
    targetVariantId?: string | null;
    inventoryBudget?: number | null;
    notes?: string | null;
  },
): Promise<EgiftCampaign> {
  const id = crypto.randomUUID();
  const now = jstNow();
  await db
    .prepare(
      `INSERT INTO egift_campaigns (id, name, status, starts_at, ends_at, daily_winner_limit, total_gift_limit, target_sku, target_product_id, target_variant_id, inventory_budget, notes, created_at, updated_at)
       VALUES (?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id, input.name, input.startsAt, input.endsAt,
      input.dailyWinnerLimit ?? 10, input.totalGiftLimit ?? null,
      input.targetSku ?? null, input.targetProductId ?? null,
      input.targetVariantId ?? null, input.inventoryBudget ?? null,
      input.notes ?? null, now, now,
    )
    .run();
  return (await getEgiftCampaignById(db, id))!;
}

export async function getEgiftCampaignById(db: D1Database, id: string): Promise<EgiftCampaign | null> {
  return db.prepare('SELECT * FROM egift_campaigns WHERE id = ?').bind(id).first<EgiftCampaign>();
}

export async function listEgiftCampaigns(db: D1Database): Promise<EgiftCampaign[]> {
  const result = await db.prepare('SELECT * FROM egift_campaigns ORDER BY created_at DESC').all<EgiftCampaign>();
  return result.results;
}

export async function activateEgiftCampaign(db: D1Database, id: string): Promise<void> {
  await db.prepare('UPDATE egift_campaigns SET status = ?, updated_at = ? WHERE id = ?')
    .bind('active', jstNow(), id).run();
}

export async function deleteEgiftCampaign(db: D1Database, id: string): Promise<void> {
  // ON DELETE CASCADE により egift_applications → egift_gifts → egift_events / egift_recipient_purchases も自動削除
  await db.prepare('DELETE FROM egift_campaigns WHERE id = ?').bind(id).run();
}

// =============================================================================
// Applications (贈り主応募)
// =============================================================================

export async function createEgiftApplication(
  db: D1Database,
  input: {
    campaignId: string;
    giverFriendId: string;
    occasion: EgiftOccasion;
    message?: string | null;
    lotteryWeight?: number;
  },
): Promise<EgiftApplication> {
  const id = crypto.randomUUID();
  const now = jstNow();
  await db
    .prepare(
      `INSERT INTO egift_applications (id, campaign_id, giver_friend_id, occasion, message, status, lottery_weight, applied_at)
       VALUES (?, ?, ?, ?, ?, 'applied', ?, ?)`,
    )
    .bind(id, input.campaignId, input.giverFriendId, input.occasion, input.message ?? null, input.lotteryWeight ?? 1, now)
    .run();
  return (await getEgiftApplicationById(db, id))!;
}

export async function getEgiftApplicationById(db: D1Database, id: string): Promise<EgiftApplication | null> {
  return db.prepare('SELECT * FROM egift_applications WHERE id = ?').bind(id).first<EgiftApplication>();
}

export async function getApplicationCountForCampaign(db: D1Database, campaignId: string): Promise<number> {
  const row = await db.prepare('SELECT COUNT(*) as cnt FROM egift_applications WHERE campaign_id = ?')
    .bind(campaignId).first<{ cnt: number }>();
  return row?.cnt ?? 0;
}

// =============================================================================
// Lottery (抽選)
// =============================================================================

export interface LotteryCandidate {
  applicationId: string;
  giverFriendId: string;
  giverDisplayName: string | null;
  rank: string | null;
  lotteryWeight: number;
}

export async function getLotteryCandidates(
  db: D1Database,
  campaignId: string,
  date: string,
): Promise<LotteryCandidate[]> {
  // 当日まだ抽選されていない応募者を取得。ランク情報もJOINで取得。
  const result = await db
    .prepare(
      `SELECT
         ea.id AS applicationId,
         ea.giver_friend_id AS giverFriendId,
         f.display_name AS giverDisplayName,
         COALESCE(lp.rank, 'レギュラー') AS rank,
         ea.lottery_weight AS lotteryWeight
       FROM egift_applications ea
       JOIN friends f ON f.id = ea.giver_friend_id
       LEFT JOIN loyalty_points lp ON lp.friend_id = ea.giver_friend_id
       WHERE ea.campaign_id = ?
         AND ea.status = 'applied'
         AND DATE(ea.applied_at) <= DATE(?)
       ORDER BY ea.applied_at ASC`,
    )
    .bind(campaignId, date)
    .all<LotteryCandidate>();
  return result.results;
}

// =============================================================================
// Gifts
// =============================================================================

async function sha256hex(input: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function createEgiftGift(
  db: D1Database,
  input: {
    campaignId: string;
    applicationId: string;
    giverFriendId: string;
    giftToken: string;
    expiresAt: string;
    redeemExpiresAt: string;
  },
): Promise<EgiftGift> {
  const id = crypto.randomUUID();
  const now = jstNow();
  const tokenHash = await sha256hex(input.giftToken);
  await db
    .prepare(
      `INSERT INTO egift_gifts (id, campaign_id, application_id, giver_friend_id, gift_token_hash, status, issued_at, expires_at, redeem_expires_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'issued', ?, ?, ?, ?, ?)`,
    )
    .bind(id, input.campaignId, input.applicationId, input.giverFriendId, tokenHash, now, input.expiresAt, input.redeemExpiresAt, now, now)
    .run();

  // record event
  await recordEgiftEvent(db, id, 'issued', input.giverFriendId, null);

  return (await getEgiftGiftById(db, id))!;
}

export async function getEgiftGiftById(db: D1Database, id: string): Promise<EgiftGift | null> {
  return db.prepare('SELECT * FROM egift_gifts WHERE id = ?').bind(id).first<EgiftGift>();
}

export async function getEgiftGiftByTokenHash(db: D1Database, tokenHash: string): Promise<EgiftGift | null> {
  return db.prepare('SELECT * FROM egift_gifts WHERE gift_token_hash = ?').bind(tokenHash).first<EgiftGift>();
}

// =============================================================================
// Gift Lifecycle
// =============================================================================

export async function markGiftOpened(db: D1Database, giftId: string): Promise<void> {
  const now = jstNow();
  await db.prepare(
    `UPDATE egift_gifts SET status = 'opened', first_opened_at = ?, updated_at = ? WHERE id = ? AND status = 'issued'`,
  ).bind(now, now, giftId).run();
  await recordEgiftEvent(db, giftId, 'opened', null, null);
}

export async function markGiftLineAdded(db: D1Database, giftId: string, recipientFriendId: string): Promise<void> {
  const now = jstNow();
  await db.prepare(
    `UPDATE egift_gifts SET status = 'line_added', recipient_friend_id = ?, line_added_at = ?, updated_at = ? WHERE id = ? AND status IN ('issued', 'opened')`,
  ).bind(recipientFriendId, now, now, giftId).run();
  await recordEgiftEvent(db, giftId, 'line_added', recipientFriendId, null);
}

export async function redeemGift(
  db: D1Database,
  giftId: string,
  input: {
    recipientFriendId: string;
    email: string;
    phone: string;
    name: string;
    zip: string;
    address: string;
    shopifyCouponCode: string;
  },
): Promise<void> {
  const now = jstNow();
  // 簡易ハッシュ（本番ではより強固なハッシュ推奨）
  const phoneHash = input.phone ? await sha256hex(input.phone) : null;
  await db.prepare(
    `UPDATE egift_gifts
     SET status = 'redeemed',
         recipient_email = ?,
         recipient_phone_hash = ?,
         recipient_name = ?,
         recipient_zip = ?,
         recipient_address = ?,
         shopify_coupon_code = ?,
         redeemed_at = ?,
         updated_at = ?
     WHERE id = ? AND status IN ('issued', 'opened', 'line_added')`,
  ).bind(input.email, phoneHash, input.name, input.zip, input.address, input.shopifyCouponCode, now, now, giftId).run();
  await recordEgiftEvent(db, giftId, 'redeemed', input.recipientFriendId, null);
}

// =============================================================================
// Events
// =============================================================================

export async function recordEgiftEvent(
  db: D1Database,
  giftId: string,
  eventType: EgiftEventType,
  friendId: string | null,
  metadata: string | null,
): Promise<void> {
  const id = crypto.randomUUID();
  const now = jstNow();
  await db.prepare(
    `INSERT INTO egift_events (id, gift_id, event_type, friend_id, metadata, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).bind(id, giftId, eventType, friendId, metadata ?? null, now).run();
}

// =============================================================================
// KPI
// =============================================================================

export async function getEgiftCampaignKpi(db: D1Database, campaignId: string): Promise<EgiftKpi> {
  const stats = await db.prepare(
    `SELECT
       status,
       COUNT(*) as cnt
     FROM egift_gifts
     WHERE campaign_id = ?
     GROUP BY status`,
  ).bind(campaignId).all<{ status: string; cnt: number }>();

  const byStatus: Record<string, number> = {};
  for (const row of stats.results) {
    byStatus[row.status] = row.cnt;
  }

  const applications = await getApplicationCountForCampaign(db, campaignId);
  const winners = byStatus['issued'] ?? 0;
  const issuedGifts = winners;
  const openedGifts = (byStatus['opened'] ?? 0) + (byStatus['line_added'] ?? 0) + (byStatus['redeemed'] ?? 0) + (byStatus['fulfilled'] ?? 0);
  const lineAddedGifts = (byStatus['line_added'] ?? 0) + (byStatus['redeemed'] ?? 0) + (byStatus['fulfilled'] ?? 0);
  const redeemedGifts = (byStatus['redeemed'] ?? 0) + (byStatus['fulfilled'] ?? 0);
  const fulfilledGifts = byStatus['fulfilled'] ?? 0;

  const purchaseRow = await db.prepare(
    `SELECT COUNT(DISTINCT recipient_friend_id) as cnt FROM egift_recipient_purchases WHERE gift_id IN (SELECT id FROM egift_gifts WHERE campaign_id = ?)`,
  ).bind(campaignId).first<{ cnt: number }>();
  const firstPurchaseRecipients = purchaseRow?.cnt ?? 0;

  const blockedRow = await db.prepare(
    `SELECT COUNT(*) as cnt FROM egift_events WHERE gift_id IN (SELECT id FROM egift_gifts WHERE campaign_id = ?) AND event_type = 'blocked'`,
  ).bind(campaignId).first<{ cnt: number }>();
  const blockedRecipients = blockedRow?.cnt ?? 0;

  return {
    applications,
    winners,
    issuedGifts,
    openedGifts,
    lineAddedGifts,
    redeemedGifts,
    fulfilledGifts,
    firstPurchaseRecipients,
    friendAddRate: openedGifts > 0 ? lineAddedGifts / openedGifts : 0,
    redeemRate: lineAddedGifts > 0 ? redeemedGifts / lineAddedGifts : 0,
    firstPurchaseRate: redeemedGifts > 0 ? firstPurchaseRecipients / redeemedGifts : 0,
    blockedRecipients,
  };
}

// =============================================================================
// Recipient Purchases (初回購入計測)
// =============================================================================

export async function recordRecipientPurchase(
  db: D1Database,
  input: {
    giftId: string;
    recipientFriendId: string | null;
    shopifyOrderId: string;
    shopifyCustomerId: string | null;
    isFirstOrder: boolean;
    orderTotal: number;
    grossProfitEstimate?: number | null;
    attributionStatus?: string;
    purchasedAt: string;
  },
): Promise<void> {
  const id = crypto.randomUUID();
  const now = jstNow();
  await db.prepare(
    `INSERT INTO egift_recipient_purchases (id, gift_id, recipient_friend_id, shopify_order_id, shopify_customer_id, is_first_order, order_total, gross_profit_estimate, attribution_status, purchased_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    id, input.giftId, input.recipientFriendId, input.shopifyOrderId,
    input.shopifyCustomerId ?? null, input.isFirstOrder ? 1 : 0, input.orderTotal,
    input.grossProfitEstimate ?? null, input.attributionStatus ?? 'eligible',
    input.purchasedAt, now,
  ).run();
}
