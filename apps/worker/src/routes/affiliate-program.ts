import { Hono } from 'hono';
import {
  createAffiliateProgramPartner,
  getAffiliateProgramPartnerById,
  getAffiliateProgramReport,
  listAffiliateProgramOrders,
  listAffiliateProgramPartners,
  recordAffiliateProgramOrder,
  updateAffiliateProgramCommissionStatus,
  updateAffiliateProgramPartner,
  type AffiliateProgramCommission,
  type AffiliateProgramCommissionStatus,
  type AffiliateProgramOrder,
  type AffiliateProgramPartner,
} from '@line-crm/db';
import type { Env } from '../index.js';

const affiliateProgram = new Hono<Env>();

function serializePartner(row: AffiliateProgramPartner) {
  return {
    id: row.id,
    name: row.name,
    code: row.code,
    email: row.email,
    partnerType: row.partner_type,
    commissionType: row.commission_type,
    commissionRate: row.commission_rate,
    fixedAmount: row.fixed_amount,
    cookieDays: row.cookie_days,
    status: row.status,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function serializeOrder(row: AffiliateProgramOrder & { partner_name?: string; commission_amount?: number; commission_status?: AffiliateProgramCommissionStatus }) {
  return {
    id: row.id,
    partnerId: row.partner_id,
    partnerName: row.partner_name ?? null,
    affiliateCode: row.affiliate_code,
    shopifyOrderId: row.shopify_order_id,
    shopifyOrderNumber: row.shopify_order_number,
    shopifyCustomerId: row.shopify_customer_id,
    customerEmail: row.customer_email,
    subtotalPrice: row.subtotal_price,
    totalPrice: row.total_price,
    currency: row.currency,
    financialStatus: row.financial_status,
    cancelledAt: row.cancelled_at,
    orderedAt: row.ordered_at,
    attributionSource: row.attribution_source,
    rawAffiliateValue: row.raw_affiliate_value,
    commissionAmount: row.commission_amount ?? null,
    commissionStatus: row.commission_status ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function serializeCommission(row: AffiliateProgramCommission) {
  return {
    id: row.id,
    affiliateOrderId: row.affiliate_order_id,
    partnerId: row.partner_id,
    basisAmount: row.basis_amount,
    commissionType: row.commission_type,
    commissionRate: row.commission_rate,
    fixedAmount: row.fixed_amount,
    commissionAmount: row.commission_amount,
    status: row.status,
    approvedAt: row.approved_at,
    rejectedAt: row.rejected_at,
    paidAt: row.paid_at,
    payoutId: row.payout_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// GET /api/affiliate-program/partners
affiliateProgram.get('/api/affiliate-program/partners', async (c) => {
  try {
    const partners = await listAffiliateProgramPartners(c.env.DB);
    return c.json({ success: true, data: partners.map(serializePartner) });
  } catch (err) {
    console.error('GET /api/affiliate-program/partners error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// POST /api/affiliate-program/partners
affiliateProgram.post('/api/affiliate-program/partners', async (c) => {
  try {
    const body = await c.req.json<{
      name: string;
      code: string;
      email?: string | null;
      partnerType?: 'standard' | 'special' | 'fixed';
      commissionType?: 'percentage' | 'fixed';
      commissionRate?: number;
      fixedAmount?: number | null;
      cookieDays?: number;
      notes?: string | null;
    }>();
    if (!body.name?.trim() || !body.code?.trim()) {
      return c.json({ success: false, error: 'name and code are required' }, 400);
    }
    if (body.commissionRate !== undefined && (body.commissionRate < 0 || body.commissionRate > 1)) {
      return c.json({ success: false, error: 'commissionRate must be between 0 and 1' }, 400);
    }
    const partner = await createAffiliateProgramPartner(c.env.DB, body);
    return c.json({ success: true, data: serializePartner(partner) }, 201);
  } catch (err) {
    console.error('POST /api/affiliate-program/partners error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// GET /api/affiliate-program/partners/:id
affiliateProgram.get('/api/affiliate-program/partners/:id', async (c) => {
  try {
    const partner = await getAffiliateProgramPartnerById(c.env.DB, c.req.param('id'));
    if (!partner) return c.json({ success: false, error: 'Partner not found' }, 404);
    return c.json({ success: true, data: serializePartner(partner) });
  } catch (err) {
    console.error('GET /api/affiliate-program/partners/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// PUT /api/affiliate-program/partners/:id
affiliateProgram.put('/api/affiliate-program/partners/:id', async (c) => {
  try {
    const body = await c.req.json<{
      name?: string;
      email?: string | null;
      partnerType?: 'standard' | 'special' | 'fixed';
      commissionType?: 'percentage' | 'fixed';
      commissionRate?: number;
      fixedAmount?: number | null;
      cookieDays?: number;
      status?: 'active' | 'paused' | 'archived';
      notes?: string | null;
    }>();
    if (body.commissionRate !== undefined && (body.commissionRate < 0 || body.commissionRate > 1)) {
      return c.json({ success: false, error: 'commissionRate must be between 0 and 1' }, 400);
    }
    const partner = await updateAffiliateProgramPartner(c.env.DB, c.req.param('id'), body);
    if (!partner) return c.json({ success: false, error: 'Partner not found' }, 404);
    return c.json({ success: true, data: serializePartner(partner) });
  } catch (err) {
    console.error('PUT /api/affiliate-program/partners/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// GET /api/affiliate-program/orders
affiliateProgram.get('/api/affiliate-program/orders', async (c) => {
  try {
    const orders = await listAffiliateProgramOrders(c.env.DB, {
      partnerId: c.req.query('partnerId'),
      startDate: c.req.query('startDate'),
      endDate: c.req.query('endDate'),
      limit: c.req.query('limit') ? Number(c.req.query('limit')) : undefined,
      offset: c.req.query('offset') ? Number(c.req.query('offset')) : undefined,
    });
    return c.json({ success: true, data: orders.map(serializeOrder) });
  } catch (err) {
    console.error('GET /api/affiliate-program/orders error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// POST /api/affiliate-program/orders/manual — 手動/検証用の成果記録
affiliateProgram.post('/api/affiliate-program/orders/manual', async (c) => {
  try {
    const body = await c.req.json<{
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
    }>();
    if (!body.affiliateCode?.trim() || !body.shopifyOrderId?.trim()) {
      return c.json({ success: false, error: 'affiliateCode and shopifyOrderId are required' }, 400);
    }
    const result = await recordAffiliateProgramOrder(c.env.DB, {
      ...body,
      attributionSource: 'manual',
      rawAffiliateValue: body.affiliateCode,
    });
    return c.json({
      success: true,
      data: {
        ...result,
        partner: result.partner ? serializePartner(result.partner) : undefined,
        order: result.order ? serializeOrder(result.order) : undefined,
        commission: result.commission ? serializeCommission(result.commission) : undefined,
      },
    }, result.recorded ? 201 : 200);
  } catch (err) {
    console.error('POST /api/affiliate-program/orders/manual error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// GET /api/affiliate-program/report
affiliateProgram.get('/api/affiliate-program/report', async (c) => {
  try {
    const report = await getAffiliateProgramReport(c.env.DB, {
      startDate: c.req.query('startDate'),
      endDate: c.req.query('endDate'),
    });
    return c.json({ success: true, data: report });
  } catch (err) {
    console.error('GET /api/affiliate-program/report error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// PATCH /api/affiliate-program/commissions/:id/status
affiliateProgram.patch('/api/affiliate-program/commissions/:id/status', async (c) => {
  try {
    const body = await c.req.json<{ status: AffiliateProgramCommissionStatus }>();
    if (!['pending', 'approved', 'rejected', 'paid'].includes(body.status)) {
      return c.json({ success: false, error: 'invalid status' }, 400);
    }
    const commission = await updateAffiliateProgramCommissionStatus(c.env.DB, c.req.param('id'), body.status);
    if (!commission) return c.json({ success: false, error: 'Commission not found' }, 404);
    return c.json({ success: true, data: serializeCommission(commission) });
  } catch (err) {
    console.error('PATCH /api/affiliate-program/commissions/:id/status error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

export { affiliateProgram };
