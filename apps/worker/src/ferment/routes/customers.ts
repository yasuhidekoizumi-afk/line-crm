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
  getFriendByLineUserId,
  getLoyaltyPoint,
  getFriendTags,
} from '@line-crm/db';
import { getShopifyAdminToken } from '../../utils/shopify-token.js';
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

// 統合プロフィール: LINE ID / 名前 / タグ / 購入履歴 / 誕生日 / ポイント / フォロー状態 を1回で返す
customerRoutes.get('/:id/profile', async (c) => {
  try {
    const id = c.req.param('id');
    const customer = await getCustomerById(c.env.DB, id);
    if (!customer) return c.json({ success: false, error: 'Not found' }, 404);

    let friend: { id: string; is_following: number } | null = null;
    let points: { balance: number; rank: string } | null = null;
    let orders: unknown[] = [];
    const tagSet = new Set<string>();

    // customers.tags（カンマ区切り）を統合
    if (customer.tags) {
      for (const t of customer.tags.split(',')) {
        const v = t.trim();
        if (v) tagSet.add(v);
      }
    }

    if (customer.line_user_id) {
      const f = await getFriendByLineUserId(c.env.DB, customer.line_user_id);
      if (f) {
        friend = { id: f.id, is_following: f.is_following };
        const lp = await getLoyaltyPoint(c.env.DB, f.id);
        if (lp) points = { balance: lp.balance, rank: lp.rank };
        const ftags = await getFriendTags(c.env.DB, f.id);
        for (const t of ftags) tagSet.add(t.name);
        const ord = await c.env.DB
          .prepare(
            'SELECT shopify_order_number, total_price, processed_at FROM shopify_orders WHERE friend_id = ? AND cancelled_at IS NULL ORDER BY processed_at DESC LIMIT 30',
          )
          .bind(f.id)
          .all();
        orders = ord.results;
      }
    }

    // 誕生日: Shopifyメタフィールド(facts/birth_date)を都度取得（best-effort・失敗してもプロフィールは返す）
    let birthday: string | null = null;
    if (customer.shopify_customer_id_jp && c.env.SHOPIFY_SHOP_DOMAIN) {
      try {
        const token = await getShopifyAdminToken(c.env);
        if (token) {
          const res = await fetch(
            `https://${c.env.SHOPIFY_SHOP_DOMAIN}/admin/api/2024-01/customers/${customer.shopify_customer_id_jp}/metafields.json?namespace=facts&key=birth_date`,
            { headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' } },
          );
          if (res.ok) {
            const j = await res.json<{ metafields?: { value: string }[] }>();
            birthday = j.metafields?.[0]?.value ?? null;
          }
        }
      } catch (e) {
        console.error('birthday metafield fetch failed:', e);
      }
    }

    return c.json({
      success: true,
      data: { customer, friend, points, tags: Array.from(tagSet), orders, birthday },
    });
  } catch (err) {
    console.error('GET /api/customers/:id/profile error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});
