/**
 * FERMENT: 配信停止管理 API
 *
 * GET    /api/email/suppressions
 * POST   /api/email/suppressions
 * DELETE /api/email/suppressions/:email
 */

import { Hono } from 'hono';
import { getSuppressions, addSuppression, removeSuppression } from '@line-crm/db';
import type { FermentEnv } from '../types.js';

export const suppressionRoutes = new Hono<FermentEnv>();

suppressionRoutes.get('/suppressions', async (c) => {
  try {
    const limit = Number(c.req.query('limit') ?? 50);
    const offset = Number(c.req.query('offset') ?? 0);
    const items = await getSuppressions(c.env.DB, limit, offset);
    return c.json({ success: true, data: items });
  } catch (err) {
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

suppressionRoutes.post('/suppressions', async (c) => {
  try {
    const body = await c.req.json<{ email: string; reason?: string; notes?: string }>();
    if (!body.email) return c.json({ success: false, error: 'email は必須です' }, 400);

    await addSuppression(c.env.DB, body.email, body.reason ?? 'manual', body.notes);
    return c.json({ success: true });
  } catch (err) {
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

suppressionRoutes.delete('/suppressions/:email', async (c) => {
  try {
    const email = decodeURIComponent(c.req.param('email'));
    await removeSuppression(c.env.DB, email);
    return c.json({ success: true });
  } catch (err) {
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});
