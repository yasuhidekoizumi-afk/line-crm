/**
 * FERMENT: メール配信ログ API
 *
 * GET /api/email/logs
 * GET /api/email/logs/:id
 */

import { Hono } from 'hono';
import { getEmailLogs, getEmailLogById } from '@line-crm/db';
import type { FermentEnv } from '../types.js';

export const emailLogRoutes = new Hono<FermentEnv>();

emailLogRoutes.get('/logs', async (c) => {
  try {
    const campaignId = c.req.query('campaign_id');
    const customerId = c.req.query('customer_id');
    const limit = Number(c.req.query('limit') ?? 50);
    const offset = Number(c.req.query('offset') ?? 0);

    const items = await getEmailLogs(c.env.DB, { campaign_id: campaignId, customer_id: customerId, limit, offset });
    return c.json({ success: true, data: items });
  } catch (err) {
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

emailLogRoutes.get('/logs/:id', async (c) => {
  try {
    const item = await getEmailLogById(c.env.DB, c.req.param('id'));
    if (!item) return c.json({ success: false, error: 'Not found' }, 404);
    return c.json({ success: true, data: item });
  } catch (err) {
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});
