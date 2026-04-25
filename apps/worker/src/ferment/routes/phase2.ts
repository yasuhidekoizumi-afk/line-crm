/**
 * FERMENT Phase 2: 高度機能ルート集約
 *
 * - Shopify カート Webhook（リアルタイム同期）
 * - レビュー受信フォーム
 * - SMS 送信トリガー
 * - 商品レコメンド取得
 */

import { Hono } from 'hono';
import { generateFermentId } from '@line-crm/db';
import type { FermentEnv } from '../types.js';

// ─── Shopify カート Webhook ──────────────────────────

export const cartWebhookRoutes = new Hono<FermentEnv>();

cartWebhookRoutes.post('/cart', async (c) => {
  const body = await c.req.json<{
    id?: string;
    token?: string;
    email?: string;
    line_items?: Array<{ title?: string; quantity?: number; price?: string }>;
    total_price?: string;
    currency?: string;
    abandoned_checkout_url?: string;
  }>().catch(() => ({}));

  const cartId = String(body.id ?? body.token ?? generateFermentId('cart'));
  const email = body.email?.toLowerCase() ?? null;
  if (!email && !body.id) {
    return c.json({ success: false, error: 'no email or cart id' }, 400);
  }

  // 既存 customer 検索
  let customerId: string | null = null;
  if (email) {
    const existing = await c.env.DB
      .prepare('SELECT customer_id FROM customers WHERE email = ? LIMIT 1')
      .bind(email)
      .first<{ customer_id: string }>();
    customerId = existing?.customer_id ?? null;
  }

  await c.env.DB
    .prepare(
      `INSERT INTO customer_cart_states (cart_id, customer_id, email, region, cart_data, abandoned_at)
       VALUES (?, ?, ?, 'JP', ?, strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
       ON CONFLICT(cart_id) DO UPDATE SET
         cart_data = excluded.cart_data,
         abandoned_at = excluded.abandoned_at,
         updated_at = strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')`,
    )
    .bind(cartId, customerId, email, JSON.stringify(body))
    .run();

  return c.json({ success: true, data: { cart_id: cartId } });
});

cartWebhookRoutes.post('/cart/recovered', async (c) => {
  const body = await c.req.json<{ id?: string; token?: string }>().catch(() => ({}));
  const cartId = String(body.id ?? body.token ?? '');
  if (!cartId) return c.json({ success: false }, 400);
  await c.env.DB
    .prepare("UPDATE customer_cart_states SET recovered_at = strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours') WHERE cart_id = ?")
    .bind(cartId)
    .run();
  return c.json({ success: true });
});

// ─── レビュー受信（公開エンドポイント） ──────────────

export const reviewRoutes = new Hono<FermentEnv>();

reviewRoutes.post('/submit', async (c) => {
  const body = await c.req.json<{
    email?: string;
    order_id?: string;
    product_id?: string;
    product_title?: string;
    rating?: number;
    comment?: string;
  }>().catch(() => ({}));

  if (!body.email || !body.rating) {
    return c.json({ success: false, error: 'email and rating required' }, 400);
  }
  if (body.rating < 1 || body.rating > 5) {
    return c.json({ success: false, error: 'rating must be 1-5' }, 400);
  }

  const customer = await c.env.DB
    .prepare('SELECT customer_id FROM customers WHERE email = ? LIMIT 1')
    .bind(body.email.toLowerCase())
    .first<{ customer_id: string }>();

  await c.env.DB
    .prepare(
      `INSERT INTO customer_reviews (review_id, customer_id, email, shopify_order_id, shopify_product_id, product_title, rating, comment, is_published)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`,
    )
    .bind(
      generateFermentId('rev'),
      customer?.customer_id ?? null,
      body.email.toLowerCase(),
      body.order_id ?? null,
      body.product_id ?? null,
      body.product_title ?? null,
      body.rating,
      body.comment ?? null,
    )
    .run();

  return c.json({ success: true }, 200, { 'Access-Control-Allow-Origin': '*' });
});

reviewRoutes.options('/submit', (c) =>
  c.text('', 204, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  }),
);

// ─── レビュー管理 API（認証あり） ──────────────────

export const reviewAdminRoutes = new Hono<FermentEnv>();

reviewAdminRoutes.get('/', async (c) => {
  const r = await c.env.DB
    .prepare('SELECT * FROM customer_reviews ORDER BY created_at DESC LIMIT 100')
    .all();
  return c.json({ success: true, data: r.results });
});

reviewAdminRoutes.put('/:id/publish', async (c) => {
  await c.env.DB
    .prepare('UPDATE customer_reviews SET is_published = 1 WHERE review_id = ?')
    .bind(c.req.param('id'))
    .run();
  return c.json({ success: true });
});

reviewAdminRoutes.delete('/:id', async (c) => {
  await c.env.DB
    .prepare('DELETE FROM customer_reviews WHERE review_id = ?')
    .bind(c.req.param('id'))
    .run();
  return c.json({ success: true });
});

// ─── SMS 送信（Twilio） ────────────────────────────

export const smsRoutes = new Hono<FermentEnv>();

smsRoutes.post('/send', async (c) => {
  const body = await c.req.json<{ to: string; message: string; customer_id?: string }>();
  if (!body.to || !body.message) {
    return c.json({ success: false, error: 'to and message required' }, 400);
  }
  // Twilio API（環境変数が設定されている場合）
  const sid = (c.env as { TWILIO_ACCOUNT_SID?: string }).TWILIO_ACCOUNT_SID;
  const token = (c.env as { TWILIO_AUTH_TOKEN?: string }).TWILIO_AUTH_TOKEN;
  const from = (c.env as { TWILIO_FROM?: string }).TWILIO_FROM;

  const logId = generateFermentId('sms');
  await c.env.DB
    .prepare(
      'INSERT INTO sms_logs (log_id, to_phone, customer_id, body, status) VALUES (?, ?, ?, ?, ?)',
    )
    .bind(logId, body.to, body.customer_id ?? null, body.message, sid ? 'queued' : 'simulated')
    .run();

  if (!sid || !token || !from) {
    // Twilio 未設定なら simulated（DB ログのみ）
    return c.json({ success: true, data: { log_id: logId, simulated: true } });
  }

  try {
    const resp = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + btoa(`${sid}:${token}`),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ To: body.to, From: from, Body: body.message }).toString(),
    });
    const json = await resp.json<{ sid?: string; message?: string }>();
    if (resp.ok && json.sid) {
      await c.env.DB
        .prepare("UPDATE sms_logs SET status='sent', twilio_sid=?, sent_at=strftime('%Y-%m-%dT%H:%M:%f','now','+9 hours') WHERE log_id=?")
        .bind(json.sid, logId)
        .run();
      return c.json({ success: true, data: { log_id: logId, twilio_sid: json.sid } });
    }
    await c.env.DB
      .prepare("UPDATE sms_logs SET status='failed', error_message=? WHERE log_id=?")
      .bind(json.message ?? 'unknown', logId)
      .run();
    return c.json({ success: false, error: json.message ?? 'Twilio error' }, 500);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await c.env.DB
      .prepare("UPDATE sms_logs SET status='failed', error_message=? WHERE log_id=?")
      .bind(msg, logId)
      .run();
    return c.json({ success: false, error: msg }, 500);
  }
});

// ─── 商品レコメンド取得 ─────────────────────────────

export const recommendRoutes = new Hono<FermentEnv>();

recommendRoutes.get('/customer/:id', async (c) => {
  const id = c.req.param('id');
  // 1. 顧客固有のアフィニティ
  const personal = await c.env.DB
    .prepare(
      'SELECT shopify_product_id, product_title, product_url, product_image, affinity_score FROM customer_product_affinity WHERE customer_id = ? ORDER BY affinity_score DESC LIMIT 6',
    )
    .bind(id)
    .all();

  // 2. 不足分は人気商品で補完
  const personalIds = (personal.results as Array<{ shopify_product_id: string }>).map((r) => r.shopify_product_id);
  const need = 6 - personal.results.length;
  let popular: { results: unknown[] } = { results: [] };
  if (need > 0) {
    const placeholders = personalIds.length > 0 ? personalIds.map(() => '?').join(',') : "''";
    popular = await c.env.DB
      .prepare(
        `SELECT shopify_product_id, title as product_title, url as product_url, image as product_image, 0 as affinity_score
         FROM popular_products WHERE region = 'JP' AND shopify_product_id NOT IN (${placeholders}) ORDER BY rank ASC LIMIT ?`,
      )
      .bind(...personalIds, need)
      .all();
  }
  return c.json({
    success: true,
    data: {
      personal: personal.results,
      popular: popular.results,
    },
  });
});

// ─── 予測 CLV 取得 ───────────────────────────────

export const insightRoutes = new Hono<FermentEnv>();

insightRoutes.get('/customer/:id', async (c) => {
  const r = await c.env.DB
    .prepare(
      `SELECT customer_id, email, ltv, predicted_clv, predicted_next_order_at,
              purchase_probability_30d, best_send_hour, avg_purchase_interval_days
         FROM customers WHERE customer_id = ?`,
    )
    .bind(c.req.param('id'))
    .first();
  if (!r) return c.json({ success: false, error: 'not found' }, 404);
  return c.json({ success: true, data: r });
});

insightRoutes.get('/summary', async (c) => {
  const summary = await c.env.DB
    .prepare(
      `SELECT
         COUNT(*) as total,
         COUNT(CASE WHEN predicted_clv > 0 THEN 1 END) as with_clv,
         AVG(predicted_clv) as avg_clv,
         SUM(predicted_clv) as total_clv,
         COUNT(CASE WHEN purchase_probability_30d >= 0.5 THEN 1 END) as high_intent
       FROM customers WHERE email IS NOT NULL`,
    )
    .first();
  return c.json({ success: true, data: summary });
});
