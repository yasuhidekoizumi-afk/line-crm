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
    const search = c.req.query('q') ?? c.req.query('search');
    const limit = Number(c.req.query('limit') ?? 50);
    const offset = Number(c.req.query('offset') ?? 0);
    const subscribedEmail = subscribed !== undefined ? subscribed === 'true' : undefined;

    const [items, total] = await Promise.all([
      getCustomers(c.env.DB, {
        region,
        subscribed_email: subscribedEmail,
        search,
        limit,
        offset,
      }),
      countCustomers(c.env.DB, { region, subscribed_email: subscribedEmail, search }),
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

// Shopify購入タグの一覧（セグメント条件のプルダウン用）。
// customers.tags（カンマ区切り）から重複を除いて返す。LINE登録者が持つタグのみ。
// 注意: '/:id' より前に登録すること（でないと id='shopify-tags' として解釈される）。
customerRoutes.get('/shopify-tags', async (c) => {
  try {
    const rows = await c.env.DB
      .prepare("SELECT DISTINCT tags FROM customers WHERE tags IS NOT NULL AND tags != '' AND line_user_id IS NOT NULL")
      .all<{ tags: string }>();
    const set = new Set<string>();
    for (const r of rows.results ?? []) {
      for (const t of (r.tags ?? '').split(',')) {
        const v = t.trim();
        if (v) set.add(v);
      }
    }
    const list = Array.from(set).sort((a, b) => a.localeCompare(b, 'ja'));
    return c.json({ success: true, data: list });
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
    // friendTags: 編集可能なLINE友だちタグ（ID付き・タグ管理用）。shopifyTags: 読み取り専用のShopify顧客タグ。
    let friendTags: { id: string; name: string; color: string }[] = [];
    const shopifyTags: string[] = [];

    // customers.tags（カンマ区切り・Shopify由来）は読み取り専用として返す
    if (customer.tags) {
      for (const t of customer.tags.split(',')) {
        const v = t.trim();
        if (v) shopifyTags.push(v);
      }
    }

    if (customer.line_user_id) {
      const f = await getFriendByLineUserId(c.env.DB, customer.line_user_id);
      if (f) {
        friend = { id: f.id, is_following: f.is_following };
        const lp = await getLoyaltyPoint(c.env.DB, f.id);
        if (lp) points = { balance: lp.balance, rank: lp.rank };
        const ftags = await getFriendTags(c.env.DB, f.id);
        friendTags = ftags.map((t) => ({ id: t.id, name: t.name, color: t.color }));
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
      data: { customer, friend, points, friendTags, shopifyTags, orders, birthday },
    });
  } catch (err) {
    console.error('GET /api/customers/:id/profile error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});
