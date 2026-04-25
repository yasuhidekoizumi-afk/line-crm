/**
 * FERMENT: メールキャンペーン API
 *
 * GET    /api/email/campaigns
 * GET    /api/email/campaigns/:id
 * POST   /api/email/campaigns
 * PUT    /api/email/campaigns/:id
 * DELETE /api/email/campaigns/:id
 * POST   /api/email/campaigns/:id/schedule
 * POST   /api/email/campaigns/:id/send
 * POST   /api/email/campaigns/:id/cancel
 * GET    /api/email/campaigns/:id/stats
 */

import { Hono } from 'hono';
import {
  getEmailCampaigns,
  getEmailCampaignById,
  createEmailCampaign,
  updateEmailCampaign,
  deleteEmailCampaign,
  getSegmentMembersWithEmail,
  getCampaignStats,
  generateFermentId,
} from '@line-crm/db';
import { executeCampaign } from '../send-engine.js';
import type { FermentEnv } from '../types.js';

export const emailCampaignRoutes = new Hono<FermentEnv>();

// 一覧
emailCampaignRoutes.get('/campaigns', async (c) => {
  try {
    const status = c.req.query('status');
    const limit = Number(c.req.query('limit') ?? 50);
    const offset = Number(c.req.query('offset') ?? 0);
    const items = await getEmailCampaigns(c.env.DB, { status, limit, offset });
    return c.json({ success: true, data: items });
  } catch (err) {
    console.error('[FERMENT] GET /campaigns error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// 単一取得
emailCampaignRoutes.get('/campaigns/:id', async (c) => {
  try {
    const item = await getEmailCampaignById(c.env.DB, c.req.param('id'));
    if (!item) return c.json({ success: false, error: 'Not found' }, 404);
    return c.json({ success: true, data: item });
  } catch (err) {
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// 作成
emailCampaignRoutes.post('/campaigns', async (c) => {
  try {
    const body = await c.req.json<{
      name: string;
      template_id?: string;
      segment_id?: string;
      scheduled_at?: string;
    }>();

    if (!body.name) {
      return c.json({ success: false, error: 'name は必須です' }, 400);
    }

    const campaignId = generateFermentId('cmp');
    await createEmailCampaign(c.env.DB, {
      campaign_id: campaignId,
      name: body.name,
      template_id: body.template_id ?? null,
      segment_id: body.segment_id ?? null,
      status: 'draft',
      scheduled_at: body.scheduled_at ?? null,
      sent_at: null,
      variant_config: null,
      total_targets: 0,
      total_sent: 0,
      total_opened: 0,
      total_clicked: 0,
      total_bounced: 0,
      total_converted: 0,
      total_revenue: 0,
    });

    const created = await getEmailCampaignById(c.env.DB, campaignId);
    return c.json({ success: true, data: created }, 201);
  } catch (err) {
    console.error('[FERMENT] POST /campaigns error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// 更新
emailCampaignRoutes.put('/campaigns/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const existing = await getEmailCampaignById(c.env.DB, id);
    if (!existing) return c.json({ success: false, error: 'Not found' }, 404);

    // 送信済み or 送信中は編集不可
    if (['sending', 'sent'].includes(existing.status)) {
      return c.json({ success: false, error: '送信済みのキャンペーンは編集できません' }, 400);
    }

    const body = await c.req.json<Record<string, unknown>>();
    await updateEmailCampaign(c.env.DB, id, body);
    const updated = await getEmailCampaignById(c.env.DB, id);
    return c.json({ success: true, data: updated });
  } catch (err) {
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// 削除
emailCampaignRoutes.delete('/campaigns/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const existing = await getEmailCampaignById(c.env.DB, id);
    if (!existing) return c.json({ success: false, error: 'Not found' }, 404);

    if (existing.status === 'sending') {
      return c.json({ success: false, error: '配信中のキャンペーンは削除できません' }, 400);
    }

    await deleteEmailCampaign(c.env.DB, id);
    return c.json({ success: true });
  } catch (err) {
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// 予約配信
emailCampaignRoutes.post('/campaigns/:id/schedule', async (c) => {
  try {
    const id = c.req.param('id');
    const existing = await getEmailCampaignById(c.env.DB, id);
    if (!existing) return c.json({ success: false, error: 'Not found' }, 404);

    const body = await c.req.json<{ scheduled_at: string }>();
    if (!body.scheduled_at) {
      return c.json({ success: false, error: 'scheduled_at は必須です' }, 400);
    }

    await updateEmailCampaign(c.env.DB, id, {
      status: 'scheduled',
      scheduled_at: body.scheduled_at,
    });

    return c.json({ success: true });
  } catch (err) {
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// 即時配信
emailCampaignRoutes.post('/campaigns/:id/send', async (c) => {
  try {
    const id = c.req.param('id');
    const existing = await getEmailCampaignById(c.env.DB, id);
    if (!existing) return c.json({ success: false, error: 'Not found' }, 404);

    if (!existing.template_id) {
      return c.json({ success: false, error: 'テンプレートが未設定です' }, 400);
    }
    if (!existing.segment_id) {
      return c.json({ success: false, error: 'セグメントが未設定です' }, 400);
    }

    // 対象顧客数を計算
    const targets = await getSegmentMembersWithEmail(c.env.DB, existing.segment_id, 10000, 0);
    await updateEmailCampaign(c.env.DB, id, { total_targets: targets.length });

    // 配信実行（非同期: waitUntil で実行するのが理想だが、ここでは同期で最初のバッチのみ）
    const result = await executeCampaign(id, c.env);

    return c.json({
      success: true,
      data: {
        sent: result.sent,
        failed: result.failed,
        done: result.done,
        total_targets: targets.length,
      },
    });
  } catch (err) {
    console.error('[FERMENT] POST /campaigns/:id/send error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// キャンセル
emailCampaignRoutes.post('/campaigns/:id/cancel', async (c) => {
  try {
    const id = c.req.param('id');
    const existing = await getEmailCampaignById(c.env.DB, id);
    if (!existing) return c.json({ success: false, error: 'Not found' }, 404);

    if (existing.status === 'sent') {
      return c.json({ success: false, error: '送信済みはキャンセルできません' }, 400);
    }

    await updateEmailCampaign(c.env.DB, id, { status: 'canceled' });
    return c.json({ success: true });
  } catch (err) {
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// 統計
emailCampaignRoutes.get('/campaigns/:id/stats', async (c) => {
  try {
    const id = c.req.param('id');
    const campaign = await getEmailCampaignById(c.env.DB, id);
    if (!campaign) return c.json({ success: false, error: 'Not found' }, 404);

    const stats = await getCampaignStats(c.env.DB, id);
    const openRate =
      stats.sent > 0 ? ((stats.opened / stats.sent) * 100).toFixed(1) : '0.0';
    const clickRate =
      stats.sent > 0 ? ((stats.clicked / stats.sent) * 100).toFixed(1) : '0.0';

    return c.json({
      success: true,
      data: {
        campaign_id: id,
        name: campaign.name,
        status: campaign.status,
        ...stats,
        open_rate: openRate,
        click_rate: clickRate,
      },
    });
  } catch (err) {
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});
