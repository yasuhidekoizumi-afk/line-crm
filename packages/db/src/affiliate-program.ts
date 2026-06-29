import { jstNow } from './utils.js';

export type AffiliateProgramPartnerType = 'standard' | 'special' | 'fixed';
export type AffiliateProgramCommissionType = 'percentage' | 'fixed';
export type AffiliateProgramPartnerStatus = 'active' | 'paused' | 'archived';
export type AffiliateProgramCommissionStatus = 'pending' | 'approved' | 'rejected' | 'paid';
export type AffiliateProgramAttributionSource = 'cart_attribute' | 'note_attribute' | 'manual' | 'backfill';

export interface AffiliateProgramPartner {
  id: string;
  name: string;
  code: string;
  email: string | null;
  partner_type: AffiliateProgramPartnerType;
  commission_type: AffiliateProgramCommissionType;
  commission_rate: number;
  fixed_amount: number | null;
  cookie_days: number;
  status: AffiliateProgramPartnerStatus;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface AffiliateProgramOrder {
  id: string;
  partner_id: string;
  affiliate_code: string;
  shopify_order_id: string;
  shopify_order_number: string | null;
  shopify_customer_id: string | null;
  customer_email: string | null;
  subtotal_price: number;
  total_price: number;
  currency: string;
  financial_status: string | null;
  cancelled_at: string | null;
  ordered_at: string;
  attribution_source: AffiliateProgramAttributionSource;
  raw_affiliate_value: string | null;
  created_at: string;
  updated_at: string;
}

export interface AffiliateProgramCommission {
  id: string;
  affiliate_order_id: string;
  partner_id: string;
  basis_amount: number;
  commission_type: AffiliateProgramCommissionType;
  commission_rate: number | null;
  fixed_amount: number | null;
  commission_amount: number;
  status: AffiliateProgramCommissionStatus;
  approved_at: string | null;
  rejected_at: string | null;
  paid_at: string | null;
  payout_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface AffiliateProgramPartnerReport {
  partnerId: string;
  name: string;
  code: string;
  partnerType: AffiliateProgramPartnerType;
  commissionType: AffiliateProgramCommissionType;
  commissionRate: number;
  fixedAmount: number | null;
  status: AffiliateProgramPartnerStatus;
  orderCount: number;
  approvedOrderCount: number;
  revenue: number;
  commissionPending: number;
  commissionApproved: number;
  commissionPaid: number;
  lastOrderedAt: string | null;
}

export interface CreateAffiliateProgramPartnerInput {
  name: string;
  code: string;
  email?: string | null;
  partnerType?: AffiliateProgramPartnerType;
  commissionType?: AffiliateProgramCommissionType;
  commissionRate?: number;
  fixedAmount?: number | null;
  cookieDays?: number;
  notes?: string | null;
}

export interface UpdateAffiliateProgramPartnerInput {
  name?: string;
  email?: string | null;
  partnerType?: AffiliateProgramPartnerType;
  commissionType?: AffiliateProgramCommissionType;
  commissionRate?: number;
  fixedAmount?: number | null;
  cookieDays?: number;
  status?: AffiliateProgramPartnerStatus;
  notes?: string | null;
}

export interface RecordAffiliateProgramOrderInput {
  affiliateCode: string;
  shopifyOrderId: string;
  shopifyOrderNumber?: string | null;
  shopifyCustomerId?: string | null;
  customerEmail?: string | null;
  subtotalPrice?: number | null;
  totalPrice?: number | null;
  currency?: string | null;
  financialStatus?: string | null;
  cancelledAt?: string | null;
  orderedAt?: string | null;
  attributionSource?: AffiliateProgramAttributionSource;
  rawAffiliateValue?: string | null;
}

export interface RecordAffiliateProgramOrderResult {
  recorded: boolean;
  reason?: 'missing_code' | 'partner_not_found' | 'partner_inactive' | 'cancelled' | 'duplicate';
  partner?: AffiliateProgramPartner;
  order?: AffiliateProgramOrder;
  commission?: AffiliateProgramCommission;
}

function normalizeCode(code: string): string {
  return code.trim().replace(/^aff[:=_-]?/i, '').toUpperCase();
}

function toMoneyNumber(value: number | null | undefined): number {
  if (value === null || value === undefined || !Number.isFinite(value)) return 0;
  return value;
}

export function calculateAffiliateProgramCommission(
  basisAmount: number,
  partner: Pick<AffiliateProgramPartner, 'commission_type' | 'commission_rate' | 'fixed_amount'>,
): number {
  if (basisAmount <= 0) return 0;
  if (partner.commission_type === 'fixed') {
    return Math.max(0, Math.floor(partner.fixed_amount ?? 0));
  }
  return Math.max(0, Math.floor(basisAmount * partner.commission_rate));
}

export async function listAffiliateProgramPartners(db: D1Database): Promise<AffiliateProgramPartner[]> {
  const r = await db
    .prepare(`SELECT * FROM affiliate_program_partners ORDER BY created_at DESC`)
    .all<AffiliateProgramPartner>();
  return r.results ?? [];
}

export async function getAffiliateProgramPartnerById(db: D1Database, id: string): Promise<AffiliateProgramPartner | null> {
  return db.prepare(`SELECT * FROM affiliate_program_partners WHERE id = ?`).bind(id).first<AffiliateProgramPartner>();
}

export async function getAffiliateProgramPartnerByCode(db: D1Database, code: string): Promise<AffiliateProgramPartner | null> {
  return db
    .prepare(`SELECT * FROM affiliate_program_partners WHERE code = ?`)
    .bind(normalizeCode(code))
    .first<AffiliateProgramPartner>();
}

export async function createAffiliateProgramPartner(
  db: D1Database,
  input: CreateAffiliateProgramPartnerInput,
): Promise<AffiliateProgramPartner> {
  const id = crypto.randomUUID();
  const now = jstNow();
  const partnerType = input.partnerType ?? 'standard';
  const commissionType = input.commissionType ?? (partnerType === 'fixed' ? 'fixed' : 'percentage');
  const commissionRate = input.commissionRate ?? (partnerType === 'special' ? 0.15 : 0.10);
  const fixedAmount = commissionType === 'fixed' ? (input.fixedAmount ?? 500) : (input.fixedAmount ?? null);

  await db
    .prepare(
      `INSERT INTO affiliate_program_partners (
         id, name, code, email, partner_type, commission_type, commission_rate,
         fixed_amount, cookie_days, status, notes, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)`,
    )
    .bind(
      id,
      input.name.trim(),
      normalizeCode(input.code),
      input.email ?? null,
      partnerType,
      commissionType,
      commissionRate,
      fixedAmount,
      input.cookieDays ?? 30,
      input.notes ?? null,
      now,
      now,
    )
    .run();

  return (await getAffiliateProgramPartnerById(db, id))!;
}

export async function updateAffiliateProgramPartner(
  db: D1Database,
  id: string,
  updates: UpdateAffiliateProgramPartnerInput,
): Promise<AffiliateProgramPartner | null> {
  const fields: string[] = [];
  const values: unknown[] = [];
  const push = (field: string, value: unknown) => {
    fields.push(`${field} = ?`);
    values.push(value);
  };

  if (updates.name !== undefined) push('name', updates.name.trim());
  if (updates.email !== undefined) push('email', updates.email);
  if (updates.partnerType !== undefined) push('partner_type', updates.partnerType);
  if (updates.commissionType !== undefined) push('commission_type', updates.commissionType);
  if (updates.commissionRate !== undefined) push('commission_rate', updates.commissionRate);
  if (updates.fixedAmount !== undefined) push('fixed_amount', updates.fixedAmount);
  if (updates.cookieDays !== undefined) push('cookie_days', updates.cookieDays);
  if (updates.status !== undefined) push('status', updates.status);
  if (updates.notes !== undefined) push('notes', updates.notes);

  if (fields.length === 0) return getAffiliateProgramPartnerById(db, id);
  push('updated_at', jstNow());
  values.push(id);
  await db.prepare(`UPDATE affiliate_program_partners SET ${fields.join(', ')} WHERE id = ?`).bind(...values).run();
  return getAffiliateProgramPartnerById(db, id);
}

export async function recordAffiliateProgramOrder(
  db: D1Database,
  input: RecordAffiliateProgramOrderInput,
): Promise<RecordAffiliateProgramOrderResult> {
  const code = normalizeCode(input.affiliateCode ?? '');
  if (!code) return { recorded: false, reason: 'missing_code' };
  if (input.cancelledAt) return { recorded: false, reason: 'cancelled' };

  const partner = await getAffiliateProgramPartnerByCode(db, code);
  if (!partner) return { recorded: false, reason: 'partner_not_found' };
  if (partner.status !== 'active') return { recorded: false, reason: 'partner_inactive', partner };

  const existing = await db
    .prepare(`SELECT id FROM affiliate_program_orders WHERE shopify_order_id = ? LIMIT 1`)
    .bind(input.shopifyOrderId)
    .first<{ id: string }>();
  if (existing) return { recorded: false, reason: 'duplicate', partner };

  const now = jstNow();
  const orderId = crypto.randomUUID();
  const commissionId = crypto.randomUUID();
  const subtotal = toMoneyNumber(input.subtotalPrice);
  const total = toMoneyNumber(input.totalPrice);
  const basisAmount = subtotal > 0 ? subtotal : total;
  const commissionAmount = calculateAffiliateProgramCommission(basisAmount, partner);

  await db
    .prepare(
      `INSERT INTO affiliate_program_orders (
         id, partner_id, affiliate_code, shopify_order_id, shopify_order_number,
         shopify_customer_id, customer_email, subtotal_price, total_price, currency,
         financial_status, cancelled_at, ordered_at, attribution_source,
         raw_affiliate_value, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      orderId,
      partner.id,
      code,
      input.shopifyOrderId,
      input.shopifyOrderNumber ?? null,
      input.shopifyCustomerId ?? null,
      input.customerEmail ?? null,
      subtotal,
      total,
      input.currency ?? 'JPY',
      input.financialStatus ?? null,
      input.cancelledAt ?? null,
      input.orderedAt ?? now,
      input.attributionSource ?? 'cart_attribute',
      input.rawAffiliateValue ?? input.affiliateCode,
      now,
      now,
    )
    .run();

  await db
    .prepare(
      `INSERT INTO affiliate_program_commissions (
         id, affiliate_order_id, partner_id, basis_amount, commission_type,
         commission_rate, fixed_amount, commission_amount, status, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
    )
    .bind(
      commissionId,
      orderId,
      partner.id,
      basisAmount,
      partner.commission_type,
      partner.commission_type === 'percentage' ? partner.commission_rate : null,
      partner.commission_type === 'fixed' ? partner.fixed_amount : null,
      commissionAmount,
      now,
      now,
    )
    .run();

  const order = (await db.prepare(`SELECT * FROM affiliate_program_orders WHERE id = ?`).bind(orderId).first<AffiliateProgramOrder>())!;
  const commission = (await db.prepare(`SELECT * FROM affiliate_program_commissions WHERE id = ?`).bind(commissionId).first<AffiliateProgramCommission>())!;
  return { recorded: true, partner, order, commission };
}

export async function listAffiliateProgramOrders(
  db: D1Database,
  opts: { partnerId?: string; startDate?: string; endDate?: string; limit?: number; offset?: number } = {},
): Promise<Array<AffiliateProgramOrder & { partner_name: string; commission_amount: number; commission_status: AffiliateProgramCommissionStatus }>> {
  const where: string[] = [];
  const values: unknown[] = [];
  if (opts.partnerId) { where.push('o.partner_id = ?'); values.push(opts.partnerId); }
  if (opts.startDate) { where.push('datetime(o.ordered_at) >= datetime(?)'); values.push(opts.startDate); }
  if (opts.endDate) { where.push('datetime(o.ordered_at) <= datetime(?)'); values.push(opts.endDate); }
  const sqlWhere = where.length ? `WHERE ${where.join(' AND ')}` : '';
  values.push(Math.min(opts.limit ?? 100, 500), opts.offset ?? 0);

  const r = await db
    .prepare(
      `SELECT o.*, p.name AS partner_name, c.commission_amount, c.status AS commission_status
       FROM affiliate_program_orders o
       JOIN affiliate_program_partners p ON p.id = o.partner_id
       JOIN affiliate_program_commissions c ON c.affiliate_order_id = o.id
       ${sqlWhere}
       ORDER BY datetime(o.ordered_at) DESC
       LIMIT ? OFFSET ?`,
    )
    .bind(...values)
    .all<AffiliateProgramOrder & { partner_name: string; commission_amount: number; commission_status: AffiliateProgramCommissionStatus }>();
  return r.results ?? [];
}

export async function getAffiliateProgramReport(
  db: D1Database,
  opts: { startDate?: string; endDate?: string } = {},
): Promise<AffiliateProgramPartnerReport[]> {
  const dateWhere: string[] = [];
  const values: unknown[] = [];
  if (opts.startDate) { dateWhere.push('datetime(o.ordered_at) >= datetime(?)'); values.push(opts.startDate); }
  if (opts.endDate) { dateWhere.push('datetime(o.ordered_at) <= datetime(?)'); values.push(opts.endDate); }
  const orderFilter = dateWhere.length ? `AND ${dateWhere.join(' AND ')}` : '';

  const r = await db
    .prepare(
      `SELECT
         p.id AS partner_id,
         p.name,
         p.code,
         p.partner_type,
         p.commission_type,
         p.commission_rate,
         p.fixed_amount,
         p.status,
         COUNT(o.id) AS order_count,
         SUM(CASE WHEN c.status IN ('approved','paid') THEN 1 ELSE 0 END) AS approved_order_count,
         COALESCE(SUM(o.total_price), 0) AS revenue,
         COALESCE(SUM(CASE WHEN c.status = 'pending' THEN c.commission_amount ELSE 0 END), 0) AS commission_pending,
         COALESCE(SUM(CASE WHEN c.status = 'approved' THEN c.commission_amount ELSE 0 END), 0) AS commission_approved,
         COALESCE(SUM(CASE WHEN c.status = 'paid' THEN c.commission_amount ELSE 0 END), 0) AS commission_paid,
         MAX(o.ordered_at) AS last_ordered_at
       FROM affiliate_program_partners p
       LEFT JOIN affiliate_program_orders o ON o.partner_id = p.id ${orderFilter}
       LEFT JOIN affiliate_program_commissions c ON c.affiliate_order_id = o.id
       GROUP BY p.id
       ORDER BY order_count DESC, p.created_at DESC`,
    )
    .bind(...values)
    .all<{
      partner_id: string;
      name: string;
      code: string;
      partner_type: AffiliateProgramPartnerType;
      commission_type: AffiliateProgramCommissionType;
      commission_rate: number;
      fixed_amount: number | null;
      status: AffiliateProgramPartnerStatus;
      order_count: number;
      approved_order_count: number;
      revenue: number;
      commission_pending: number;
      commission_approved: number;
      commission_paid: number;
      last_ordered_at: string | null;
    }>();

  return (r.results ?? []).map((row) => ({
    partnerId: row.partner_id,
    name: row.name,
    code: row.code,
    partnerType: row.partner_type,
    commissionType: row.commission_type,
    commissionRate: row.commission_rate,
    fixedAmount: row.fixed_amount,
    status: row.status,
    orderCount: row.order_count,
    approvedOrderCount: row.approved_order_count,
    revenue: row.revenue,
    commissionPending: row.commission_pending,
    commissionApproved: row.commission_approved,
    commissionPaid: row.commission_paid,
    lastOrderedAt: row.last_ordered_at,
  }));
}

export async function updateAffiliateProgramCommissionStatus(
  db: D1Database,
  commissionId: string,
  status: AffiliateProgramCommissionStatus,
): Promise<AffiliateProgramCommission | null> {
  const now = jstNow();
  const extraField = status === 'approved' ? ', approved_at = ?'
    : status === 'rejected' ? ', rejected_at = ?'
      : status === 'paid' ? ', paid_at = ?'
        : '';
  const binds: unknown[] = [status, now];
  if (extraField) binds.push(now);
  binds.push(commissionId);
  await db
    .prepare(`UPDATE affiliate_program_commissions SET status = ?, updated_at = ?${extraField} WHERE id = ?`)
    .bind(...binds)
    .run();
  return db.prepare(`SELECT * FROM affiliate_program_commissions WHERE id = ?`).bind(commissionId).first<AffiliateProgramCommission>();
}
