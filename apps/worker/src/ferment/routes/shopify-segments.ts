/**
 * FERMENT: Shopify セグメント取り込み API
 *
 * GET    /api/shopify-segments              Shopifyの顧客セグメント一覧 + ミラー状況
 * POST   /api/shopify-segments/mirror       取り込みON（ミラー作成）→ 初回同期を1チャンク実行
 * DELETE /api/shopify-segments/mirror/:id   取り込みOFF（ミラー削除）
 * POST   /api/shopify-segments/mirror/:id/sync  手動同期（続き / 再同期）
 *
 * 取り込んだセグメントは source='shopify' の通常セグメントなので、
 * 既存の配信フォーム（targetType='segment'）にそのまま宛先として表示される。
 */

import { Hono } from 'hono';
import {
  getSegments,
  getSegmentById,
  createSegment,
  deleteSegment,
  generateFermentId,
} from '@line-crm/db';
import { listShopifySegments, syncShopifySegmentChunk } from '../shopify-segments.js';
import type { FermentEnv } from '../types.js';

export const shopifySegmentRoutes = new Hono<FermentEnv>();

// Shopify の顧客セグメント一覧 + ハーネス側のミラー状況
shopifySegmentRoutes.get('/', async (c) => {
  try {
    const [native, harness] = await Promise.all([
      listShopifySegments(c.env),
      getSegments(c.env.DB),
    ]);
    const mirrored = new Map(
      harness
        .filter((s) => s.source === 'shopify' && s.shopify_segment_id)
        .map((s) => [s.shopify_segment_id as string, s]),
    );
    const items = native.map((n) => {
      const m = mirrored.get(n.gid);
      return {
        gid: n.gid,
        name: n.name,
        query: n.query,
        last_edit_date: n.lastEditDate,
        mirrored: !!m,
        segment_id: m?.segment_id ?? null,
        member_count: m?.customer_count ?? null,
        sync_status: m?.sync_status ?? null,
        last_synced_at: m?.last_computed_at ?? null,
      };
    });
    return c.json({ success: true, data: items });
  } catch (err) {
    console.error('[shopify-segments] list error:', err);
    return c.json(
      { success: false, error: `Shopifyセグメント取得エラー: ${String(err).slice(0, 200)}` },
      500,
    );
  }
});

// 取り込みON（ミラー作成）→ 初回同期を1チャンク実行
shopifySegmentRoutes.post('/mirror', async (c) => {
  try {
    const body = await c.req.json<{ gid: string; name: string; query?: string }>();
    if (!body.gid || !body.name) {
      return c.json({ success: false, error: 'gid と name は必須です' }, 400);
    }

    // 既存ミラーがあれば再利用（重複作成を防ぐ）
    const existing = (await getSegments(c.env.DB)).find(
      (s) => s.source === 'shopify' && s.shopify_segment_id === body.gid,
    );
    let segmentId = existing?.segment_id;
    if (!segmentId) {
      segmentId = generateFermentId('seg');
      await createSegment(c.env.DB, {
        segment_id: segmentId,
        name: body.name,
        description: body.query ? `Shopifyセグメント: ${body.query}` : 'Shopifyセグメント（取り込み）',
        // source='shopify' のメンバーは Shopify から同期するため rules は評価に使わない
        rules: '{"operator":"AND","conditions":[]}',
        channel_scope: 'line',
        source: 'shopify',
        shopify_segment_id: body.gid,
      });
    }

    const sync = await syncShopifySegmentChunk(c.env, segmentId);
    const segment = await getSegmentById(c.env.DB, segmentId);
    return c.json({ success: true, data: { segment, sync } }, 201);
  } catch (err) {
    console.error('[shopify-segments] mirror error:', err);
    return c.json({ success: false, error: `取り込みエラー: ${String(err).slice(0, 200)}` }, 500);
  }
});

// 取り込みOFF（ミラー削除）
shopifySegmentRoutes.delete('/mirror/:segmentId', async (c) => {
  try {
    const id = c.req.param('segmentId');
    const seg = await getSegmentById(c.env.DB, id);
    if (!seg) return c.json({ success: false, error: 'Not found' }, 404);
    if (seg.source !== 'shopify') {
      return c.json({ success: false, error: 'Shopifyミラーではありません' }, 400);
    }
    await deleteSegment(c.env.DB, id);
    return c.json({ success: true });
  } catch (err) {
    console.error('[shopify-segments] delete error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// 手動同期（続き / 再同期）。done=false なら続きが残っている。
shopifySegmentRoutes.post('/mirror/:segmentId/sync', async (c) => {
  try {
    const id = c.req.param('segmentId');
    const seg = await getSegmentById(c.env.DB, id);
    if (!seg) return c.json({ success: false, error: 'Not found' }, 404);
    if (seg.source !== 'shopify') {
      return c.json({ success: false, error: 'Shopifyミラーではありません' }, 400);
    }
    const sync = await syncShopifySegmentChunk(c.env, id);
    return c.json({ success: true, data: sync });
  } catch (err) {
    console.error('[shopify-segments] sync error:', err);
    return c.json({ success: false, error: `同期エラー: ${String(err).slice(0, 200)}` }, 500);
  }
});
