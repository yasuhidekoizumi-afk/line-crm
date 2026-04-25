/**
 * FERMENT: メールフロー API
 *
 * GET    /api/email/flows
 * GET    /api/email/flows/:id
 * POST   /api/email/flows
 * PUT    /api/email/flows/:id
 * DELETE /api/email/flows/:id
 * POST   /api/email/flows/:id/steps
 * PUT    /api/email/flows/:id/steps/:stepId
 * DELETE /api/email/flows/:id/steps/:stepId
 * POST   /api/email/flows/:id/enroll
 */

import { Hono } from 'hono';
import {
  getEmailFlows,
  getEmailFlowById,
  createEmailFlow,
  updateEmailFlow,
  deleteEmailFlow,
  getEmailFlowSteps,
  createEmailFlowStep,
  deleteEmailFlowStep,
  createEnrollment,
  generateFermentId,
} from '@line-crm/db';
import type { FermentEnv } from '../types.js';

export const emailFlowRoutes = new Hono<FermentEnv>();

// 一覧
emailFlowRoutes.get('/flows', async (c) => {
  try {
    const items = await getEmailFlows(c.env.DB);
    return c.json({ success: true, data: items });
  } catch (err) {
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// 単一取得（ステップ含む）
emailFlowRoutes.get('/flows/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const [flow, steps] = await Promise.all([
      getEmailFlowById(c.env.DB, id),
      getEmailFlowSteps(c.env.DB, id),
    ]);
    if (!flow) return c.json({ success: false, error: 'Not found' }, 404);
    return c.json({ success: true, data: { ...flow, steps } });
  } catch (err) {
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// 作成
emailFlowRoutes.post('/flows', async (c) => {
  try {
    const body = await c.req.json<{
      name: string;
      description?: string;
      trigger_type?: string;
      trigger_config?: object;
      is_active?: boolean;
    }>();

    if (!body.name) return c.json({ success: false, error: 'name は必須です' }, 400);

    const flowId = generateFermentId('flw');
    await createEmailFlow(c.env.DB, {
      flow_id: flowId,
      name: body.name,
      description: body.description ?? null,
      trigger_type: body.trigger_type ?? null,
      trigger_config: body.trigger_config ? JSON.stringify(body.trigger_config) : null,
      is_active: body.is_active ? 1 : 0,
    });

    const [created, steps] = await Promise.all([
      getEmailFlowById(c.env.DB, flowId),
      getEmailFlowSteps(c.env.DB, flowId),
    ]);
    return c.json({ success: true, data: { ...created, steps } }, 201);
  } catch (err) {
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// 更新
emailFlowRoutes.put('/flows/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const existing = await getEmailFlowById(c.env.DB, id);
    if (!existing) return c.json({ success: false, error: 'Not found' }, 404);

    const body = await c.req.json<Record<string, unknown>>();
    if (typeof body.is_active === 'boolean') body.is_active = body.is_active ? 1 : 0;
    if (body.trigger_config && typeof body.trigger_config === 'object') {
      body.trigger_config = JSON.stringify(body.trigger_config);
    }
    await updateEmailFlow(c.env.DB, id, body);
    const updated = await getEmailFlowById(c.env.DB, id);
    return c.json({ success: true, data: updated });
  } catch (err) {
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// 削除
emailFlowRoutes.delete('/flows/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const existing = await getEmailFlowById(c.env.DB, id);
    if (!existing) return c.json({ success: false, error: 'Not found' }, 404);

    await deleteEmailFlow(c.env.DB, id);
    return c.json({ success: true });
  } catch (err) {
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// ステップ追加
emailFlowRoutes.post('/flows/:id/steps', async (c) => {
  try {
    const flowId = c.req.param('id');
    const flow = await getEmailFlowById(c.env.DB, flowId);
    if (!flow) return c.json({ success: false, error: 'Not found' }, 404);

    const body = await c.req.json<{
      step_order: number;
      delay_hours?: number;
      template_id?: string;
      condition?: object;
    }>();

    const stepId = generateFermentId('stp');
    await createEmailFlowStep(c.env.DB, {
      step_id: stepId,
      flow_id: flowId,
      step_order: body.step_order,
      delay_hours: body.delay_hours ?? 0,
      template_id: body.template_id ?? null,
      condition: body.condition ? JSON.stringify(body.condition) : null,
    });

    const steps = await getEmailFlowSteps(c.env.DB, flowId);
    return c.json({ success: true, data: steps }, 201);
  } catch (err) {
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// ステップ削除
emailFlowRoutes.delete('/flows/:id/steps/:stepId', async (c) => {
  try {
    await deleteEmailFlowStep(c.env.DB, c.req.param('stepId'));
    return c.json({ success: true });
  } catch (err) {
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// 顧客をフローに手動投入
emailFlowRoutes.post('/flows/:id/enroll', async (c) => {
  try {
    const flowId = c.req.param('id');
    const flow = await getEmailFlowById(c.env.DB, flowId);
    if (!flow) return c.json({ success: false, error: 'Not found' }, 404);

    const body = await c.req.json<{ customer_id: string; delay_hours?: number }>();
    if (!body.customer_id) {
      return c.json({ success: false, error: 'customer_id は必須です' }, 400);
    }

    // 最初のステップの送信時刻を計算
    const steps = await getEmailFlowSteps(c.env.DB, flowId);
    const firstStep = steps.find((s) => s.step_order === 0);
    const delayHours = body.delay_hours ?? firstStep?.delay_hours ?? 0;
    const nextSendAt = new Date(Date.now() + delayHours * 60 * 60 * 1000).toISOString();

    const enrollmentId = generateFermentId('enr');
    await createEnrollment(c.env.DB, {
      enrollment_id: enrollmentId,
      flow_id: flowId,
      customer_id: body.customer_id,
      next_send_at: nextSendAt,
    });

    return c.json({ success: true, data: { enrollment_id: enrollmentId } }, 201);
  } catch (err) {
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});
