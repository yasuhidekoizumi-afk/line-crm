/**
 * FERMENT: Webhook 受信エンドポイント
 *
 * POST /webhook/resend    — Resend のイベント受信（開封・クリック・バウンス等）
 * POST /webhook/shopify/jp — Shopify JP からの注文・顧客イベント
 * POST /webhook/shopify/us — Shopify US からの注文・顧客イベント
 */

import { Hono } from 'hono';
import {
  updateEmailLogByResendId,
  addSuppression,
  updateCustomer,
  getCustomerByEmail,
  upsertCustomer,
  createEvent,
  generateFermentId,
  getEmailFlows,
  createEnrollment,
  getEmailFlowSteps,
} from '@line-crm/db';
import { verifyResendWebhook, parseResendWebhookEvent } from '@line-crm/email-sdk';
import type { FermentEnv } from '../types.js';

export const webhookRoutes = new Hono<FermentEnv>();

// ============================================================
// Resend Webhook
// ============================================================

webhookRoutes.post('/resend', async (c) => {
  try {
    const rawBody = await c.req.text();
    const secret = c.env.RESEND_WEBHOOK_SECRET ?? '';

    // 署名検証
    if (secret) {
      const valid = await verifyResendWebhook(c.req.raw.headers, rawBody, secret);
      if (!valid) {
        return c.json({ error: 'Invalid signature' }, 401);
      }
    }

    const event = parseResendWebhookEvent(rawBody);
    if (!event) return c.json({ error: 'Invalid payload' }, 400);

    const resendId = event.data.email_id;
    const now = new Date().toISOString();

    switch (event.type) {
      case 'email.sent':
        await updateEmailLogByResendId(c.env.DB, resendId, { status: 'sent', sent_at: now });
        break;

      case 'email.delivered':
        await updateEmailLogByResendId(c.env.DB, resendId, { status: 'delivered', delivered_at: now });
        break;

      case 'email.opened': {
        // opened_at は初回のみ更新（二重カウント防止）
        const log = await c.env.DB
          .prepare('SELECT log_id, customer_id, opened_at FROM email_logs WHERE resend_id = ?')
          .bind(resendId)
          .first<{ log_id: string; customer_id: string | null; opened_at: string | null }>();

        if (log && !log.opened_at) {
          await updateEmailLogByResendId(c.env.DB, resendId, { status: 'opened', opened_at: now });

          // events テーブルに記録
          if (log.customer_id) {
            await createEvent(c.env.DB, {
              event_id: generateFermentId('ev'),
              customer_id: log.customer_id,
              event_type: 'email_opened',
              source: 'email',
              properties: JSON.stringify({ resend_id: resendId }),
            });
          }
        }
        break;
      }

      case 'email.clicked': {
        const log = await c.env.DB
          .prepare('SELECT log_id, customer_id, first_clicked_at FROM email_logs WHERE resend_id = ?')
          .bind(resendId)
          .first<{ log_id: string; customer_id: string | null; first_clicked_at: string | null }>();

        if (log && !log.first_clicked_at) {
          await updateEmailLogByResendId(c.env.DB, resendId, {
            status: 'clicked',
            first_clicked_at: now,
          });

          if (log.customer_id) {
            await createEvent(c.env.DB, {
              event_id: generateFermentId('ev'),
              customer_id: log.customer_id,
              event_type: 'email_clicked',
              source: 'email',
              properties: JSON.stringify({ resend_id: resendId, link: event.data.click?.link }),
            });
          }
        }
        break;
      }

      case 'email.bounced': {
        await updateEmailLogByResendId(c.env.DB, resendId, { status: 'bounced', bounced_at: now });

        const toEmail = event.data.to[0];
        if (toEmail) {
          // 配信停止リストに追加
          await addSuppression(c.env.DB, toEmail, 'bounced');

          // 顧客の email_bounced フラグを更新
          const customer = await getCustomerByEmail(c.env.DB, toEmail);
          if (customer) {
            await updateCustomer(c.env.DB, customer.customer_id, { email_bounced: 1 });
          }
        }
        break;
      }

      case 'email.complained': {
        const toEmail = event.data.to[0];
        if (toEmail) {
          await addSuppression(c.env.DB, toEmail, 'complained');
        }
        break;
      }
    }

    return c.json({ ok: true });
  } catch (err) {
    console.error('[FERMENT] Resend Webhook エラー:', err);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

// ============================================================
// Shopify Webhook（JP/US 共通）
// ============================================================

async function handleShopifyWebhook(
  c: Parameters<Parameters<typeof webhookRoutes.post>[1]>[0],
  region: 'JP' | 'US',
): Promise<Response> {
  // 共有シークレット認証
  const token = c.req.header('X-Ferment-Token') ?? c.req.header('x-ferment-token');
  const expectedToken = c.env.FERMENT_SHOPIFY_WEBHOOK_SECRET;
  if (expectedToken && token !== expectedToken) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  try {
    const body = await c.req.json<{
      event_type: string;
      customer?: {
        shopify_id?: string;
        email?: string;
        display_name?: string;
        tags?: string[];
      };
      order?: {
        id?: string;
        total?: number;
        currency?: string;
        line_items?: Array<{ title: string; quantity: number }>;
      };
      properties?: Record<string, unknown>;
    }>();

    const now = new Date().toISOString();
    const { event_type, customer: shopifyCustomer, order } = body;

    // 顧客情報を upsert
    let customerId: string | null = null;
    if (shopifyCustomer?.email) {
      const existing = await getCustomerByEmail(c.env.DB, shopifyCustomer.email);
      customerId = existing?.customer_id ?? generateFermentId('cu');

      const shopifyIdField =
        region === 'JP' ? 'shopify_customer_id_jp' : 'shopify_customer_id_us';

      await upsertCustomer(c.env.DB, {
        customer_id: customerId,
        email: shopifyCustomer.email,
        display_name: shopifyCustomer.display_name ?? null,
        region,
        language: region === 'JP' ? 'ja' : 'en',
        [shopifyIdField]: shopifyCustomer.shopify_id ?? null,
        tags: shopifyCustomer.tags ? JSON.stringify(shopifyCustomer.tags) : null,
        source: `shopify_${region.toLowerCase()}`,
      });
    }

    // イベントを記録
    if (customerId) {
      await createEvent(c.env.DB, {
        event_id: generateFermentId('ev'),
        customer_id: customerId,
        event_type,
        source: `shopify_${region.toLowerCase()}`,
        properties: JSON.stringify(body.properties ?? order ?? {}),
      });
    }

    // 注文イベントの場合は LTV を更新
    if (event_type === 'order_placed' && customerId && order?.total) {
      const existing = await c.env.DB
        .prepare('SELECT ltv, order_count FROM customers WHERE customer_id = ?')
        .bind(customerId)
        .first<{ ltv: number; order_count: number }>();

      if (existing) {
        const newLtv = existing.ltv + order.total;
        const newCount = existing.order_count + 1;
        const newAvg = Math.floor(newLtv / newCount);
        const productNames =
          order.line_items?.map((li) => li.title) ?? [];

        await updateCustomer(c.env.DB, customerId, {
          ltv: newLtv,
          order_count: newCount,
          avg_order_value: newAvg,
          last_order_at: now,
          preferred_products: productNames.length > 0 ? JSON.stringify(productNames.slice(0, 5)) : undefined,
        });
      }
    }

    // フロートリガー: event_type に合致するフローに enrollment を作成
    if (customerId) {
      const allFlows = await getEmailFlows(c.env.DB);
      for (const flow of allFlows) {
        if (!flow.is_active || !flow.trigger_type || !flow.trigger_config) continue;

        try {
          const config = JSON.parse(flow.trigger_config) as { event_type?: string };
          if (flow.trigger_type === 'event' && config.event_type === event_type) {
            const steps = await getEmailFlowSteps(c.env.DB, flow.flow_id);
            const firstStep = steps.find((s) => s.step_order === 0);
            const nextSendAt = new Date(
              Date.now() + (firstStep?.delay_hours ?? 0) * 60 * 60 * 1000,
            ).toISOString();

            await createEnrollment(c.env.DB, {
              enrollment_id: generateFermentId('enr'),
              flow_id: flow.flow_id,
              customer_id: customerId,
              next_send_at: nextSendAt,
            });
          }
        } catch {
          // trigger_config のパースエラーは無視
        }
      }
    }

    return c.json({ ok: true });
  } catch (err) {
    console.error(`[FERMENT] Shopify ${region} Webhook エラー:`, err);
    return c.json({ error: 'Internal server error' }, 500);
  }
}

webhookRoutes.post('/shopify/jp', (c) => handleShopifyWebhook(c, 'JP'));
webhookRoutes.post('/shopify/us', (c) => handleShopifyWebhook(c, 'US'));
