/**
 * FERMENT: セグメント API
 *
 * GET    /api/segments
 * GET    /api/segments/:id
 * POST   /api/segments
 * PUT    /api/segments/:id
 * DELETE /api/segments/:id
 * POST   /api/segments/:id/recompute
 * GET    /api/segments/:id/members
 */

import { Hono } from 'hono';
import {
  getSegments,
  getSegmentById,
  createSegment,
  updateSegment,
  deleteSegment,
  getSegmentMemberIds,
  getSegmentMembersWithEmail,
  generateFermentId,
} from '@line-crm/db';
import { computeSegment } from '../segment-engine.js';
import type { FermentEnv } from '../types.js';

export const segmentRoutes = new Hono<FermentEnv>();

// 一覧
segmentRoutes.get('/', async (c) => {
  try {
    const items = await getSegments(c.env.DB);
    return c.json({ success: true, data: items });
  } catch (err) {
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// 単一取得
segmentRoutes.get('/:id', async (c) => {
  try {
    const item = await getSegmentById(c.env.DB, c.req.param('id'));
    if (!item) return c.json({ success: false, error: 'Not found' }, 404);
    return c.json({ success: true, data: item });
  } catch (err) {
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// 作成
segmentRoutes.post('/', async (c) => {
  try {
    const body = await c.req.json<{
      name: string;
      description?: string;
      rules: object;
      channel_scope?: string;
    }>();

    if (!body.name) return c.json({ success: false, error: 'name は必須です' }, 400);
    if (!body.rules) return c.json({ success: false, error: 'rules は必須です' }, 400);

    const segmentId = generateFermentId('seg');
    await createSegment(c.env.DB, {
      segment_id: segmentId,
      name: body.name,
      description: body.description ?? null,
      rules: JSON.stringify(body.rules),
      channel_scope: body.channel_scope ?? 'all',
    });

    const created = await getSegmentById(c.env.DB, segmentId);
    return c.json({ success: true, data: created }, 201);
  } catch (err) {
    console.error('[FERMENT] POST /segments error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// 更新
segmentRoutes.put('/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const existing = await getSegmentById(c.env.DB, id);
    if (!existing) return c.json({ success: false, error: 'Not found' }, 404);

    const body = await c.req.json<Record<string, unknown>>();
    // rules オブジェクトを JSON 文字列に変換
    if (body.rules && typeof body.rules === 'object') {
      body.rules = JSON.stringify(body.rules);
    }
    await updateSegment(c.env.DB, id, body);
    const updated = await getSegmentById(c.env.DB, id);
    return c.json({ success: true, data: updated });
  } catch (err) {
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// 削除
segmentRoutes.delete('/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const existing = await getSegmentById(c.env.DB, id);
    if (!existing) return c.json({ success: false, error: 'Not found' }, 404);

    await deleteSegment(c.env.DB, id);
    return c.json({ success: true });
  } catch (err) {
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// 手動再計算
segmentRoutes.post('/:id/recompute', async (c) => {
  try {
    const id = c.req.param('id');
    const existing = await getSegmentById(c.env.DB, id);
    if (!existing) return c.json({ success: false, error: 'Not found' }, 404);

    const count = await computeSegment(id, c.env.DB);
    return c.json({ success: true, data: { customer_count: count } });
  } catch (err) {
    console.error('[FERMENT] POST /segments/:id/recompute error:', err);
    return c.json({ success: false, error: `再計算エラー: ${String(err)}` }, 500);
  }
});

// メンバー一覧
segmentRoutes.get('/:id/members', async (c) => {
  try {
    const id = c.req.param('id');
    const existing = await getSegmentById(c.env.DB, id);
    if (!existing) return c.json({ success: false, error: 'Not found' }, 404);

    const limit = Number(c.req.query('limit') ?? 100);
    const offset = Number(c.req.query('offset') ?? 0);
    const withEmail = c.req.query('with_email') === 'true';

    const data = withEmail
      ? await getSegmentMembersWithEmail(c.env.DB, id, limit, offset)
      : await getSegmentMemberIds(c.env.DB, id);

    return c.json({
      success: true,
      data,
      meta: {
        total: existing.customer_count,
        limit,
        offset,
      },
    });
  } catch (err) {
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});
