/**
 * FERMENT: 統合顧客 API
 *
 * GET    /api/customers
 * GET    /api/customers/:id
 * PUT    /api/customers/:id
 * GET    /api/customers/:id/events
 * GET    /api/customers/:id/emails
 */

import { Hono } from 'hono';
import {
  getCustomers,
  getCustomerById,
  updateCustomer,
  getCustomerEvents,
  getEmailLogs,
  countCustomers,
} from '@line-crm/db';
import type { FermentEnv } from '../types.js';

export const customerRoutes = new Hono<FermentEnv>();

// 一覧
customerRoutes.get('/', async (c) => {
  try {
    const region = c.req.query('region');
    const subscribed = c.req.query('subscribed_email');
    const limit = Number(c.req.query('limit') ?? 50);
    const offset = Number(c.req.query('offset') ?? 0);

    const [items, total] = await Promise.all([
      getCustomers(c.env.DB, {
        region,
        subscribed_email: subscribed !== undefined ? subscribed === 'true' : undefined,
        limit,
        offset,
      }),
      countCustomers(c.env.DB),
    ]);

    return c.json({
      success: true,
      data: items,
      meta: { total, limit, offset },
    });
  } catch (err) {
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// 単一取得
customerRoutes.get('/:id', async (c) => {
  try {
    const item = await getCustomerById(c.env.DB, c.req.param('id'));
    if (!item) return c.json({ success: false, error: 'Not found' }, 404);
    return c.json({ success: true, data: item });
  } catch (err) {
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// 更新
customerRoutes.put('/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const existing = await getCustomerById(c.env.DB, id);
    if (!existing) return c.json({ success: false, error: 'Not found' }, 404);

    const body = await c.req.json<Record<string, unknown>>();
    await updateCustomer(c.env.DB, id, body);
    const updated = await getCustomerById(c.env.DB, id);
    return c.json({ success: true, data: updated });
  } catch (err) {
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// イベントタイムライン
customerRoutes.get('/:id/events', async (c) => {
  try {
    const id = c.req.param('id');
    const existing = await getCustomerById(c.env.DB, id);
    if (!existing) return c.json({ success: false, error: 'Not found' }, 404);

    const limit = Number(c.req.query('limit') ?? 50);
    const events = await getCustomerEvents(c.env.DB, id, limit);
    return c.json({ success: true, data: events });
  } catch (err) {
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// メール送信履歴
customerRoutes.get('/:id/emails', async (c) => {
  try {
    const id = c.req.param('id');
    const existing = await getCustomerById(c.env.DB, id);
    if (!existing) return c.json({ success: false, error: 'Not found' }, 404);

    const limit = Number(c.req.query('limit') ?? 50);
    const logs = await getEmailLogs(c.env.DB, { customer_id: id, limit });
    return c.json({ success: true, data: logs });
  } catch (err) {
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});
