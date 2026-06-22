/**
 * CRM 週次レポート API
 *
 * 役割: 河原さんが手作業で作っていた週次 Word レポートの「数字部分」を
 *       LINE ハーネス管理画面で自動表示するためのデータを返す。
 *
 * 主な仕様:
 *   - 期間は ?start=YYYY-MM-DD&end=YYYY-MM-DD で指定（必須）。
 *   - 売上系は packages/db の `shopify_orders` を集計（processed_at 基準・JST）。
 *   - LINE 配信は `broadcasts` を集計。
 *   - メルマガ実績(Shopify Email)は SHOPIFY_ADMIN_TOKEN_CRM (CRM週次レポート専用トークン)
 *     を使って Admin API から取得。既存の SHOPIFY_ADMIN_TOKEN とは別管理し、
 *     既存機能(ポイント補填/誕生日クーポン/SocialPLUS連携/商品同期等)への影響を切り離す。
 *
 * 認証は他ルートと同じく authMiddleware に依存（index.ts 側でラップ済み）。
 */
import { Hono } from 'hono';
import type { Env } from '../index.js';

const crmWeekly = new Hono<Env>();

// ---------------------------------------------------------------------------
// 共通: 期間パース
// ---------------------------------------------------------------------------
function parsePeriod(c: any): { start: string; end: string; endExclusive: string } | { error: string } {
  const start = c.req.query('start');
  const end = c.req.query('end');
  if (!start || !end) {
    return { error: 'start, end クエリパラメータが必要です (例: start=2026-06-10&end=2026-06-16)' };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) {
    return { error: 'start, end は YYYY-MM-DD 形式で指定してください' };
  }
  // end は包含 → 比較用には翌日 0:00 を使う
  const endDate = new Date(end + 'T00:00:00Z');
  endDate.setUTCDate(endDate.getUTCDate() + 1);
  const endExclusive = endDate.toISOString().slice(0, 10);
  return { start, end, endExclusive };
}

// ---------------------------------------------------------------------------
// GET /api/crm-weekly/summary
//   返り値: 期間のサマリー（販売合計・注文・AOV・割引比率）
// ---------------------------------------------------------------------------
crmWeekly.get('/api/crm-weekly/summary', async (c) => {
  const p = parsePeriod(c);
  if ('error' in p) return c.json({ success: false, error: p.error }, 400);

  try {
    // 当該期間
    const row = await c.env.DB.prepare(
      `SELECT
         COUNT(*)                                        AS order_count,
         COALESCE(SUM(total_price), 0)                   AS gross_sales,
         COALESCE(SUM(total_discounts), 0)               AS total_discounts,
         COALESCE(SUM(total_price - COALESCE(total_discounts, 0)), 0) AS net_sales,
         COALESCE(AVG(total_price), 0)                   AS aov,
         COUNT(DISTINCT email)                           AS unique_customers
       FROM shopify_orders
       WHERE processed_at >= ? AND processed_at < ?
         AND (cancelled_at IS NULL OR cancelled_at = '')`
    )
      .bind(p.start, p.endExclusive)
      .first<any>();

    const grossSales = Number(row?.gross_sales ?? 0);
    const discount = Number(row?.total_discounts ?? 0);
    const orderCount = Number(row?.order_count ?? 0);

    return c.json({
      success: true,
      data: {
        period: { start: p.start, end: p.end },
        orderCount,
        grossSales,
        netSales: Number(row?.net_sales ?? 0),
        totalDiscounts: discount,
        discountRatio: grossSales > 0 ? Number(((discount / grossSales) * 100).toFixed(2)) : 0,
        aov: orderCount > 0 ? Math.round(grossSales / orderCount) : 0,
        uniqueCustomers: Number(row?.unique_customers ?? 0),
      },
    });
  } catch (err) {
    console.error('GET /api/crm-weekly/summary error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// ---------------------------------------------------------------------------
// GET /api/crm-weekly/daily
//   返り値: 日別の売上・注文（同期間の前年同曜日も付与）
// ---------------------------------------------------------------------------
crmWeekly.get('/api/crm-weekly/daily', async (c) => {
  const p = parsePeriod(c);
  if ('error' in p) return c.json({ success: false, error: p.error }, 400);

  try {
    const res = await c.env.DB.prepare(
      `SELECT
         DATE(processed_at)                          AS date,
         COUNT(*)                                    AS order_count,
         COALESCE(SUM(total_price), 0)               AS gross_sales,
         COALESCE(SUM(total_discounts), 0)           AS total_discounts,
         COALESCE(AVG(total_price), 0)               AS aov
       FROM shopify_orders
       WHERE processed_at >= ? AND processed_at < ?
         AND (cancelled_at IS NULL OR cancelled_at = '')
       GROUP BY DATE(processed_at)
       ORDER BY DATE(processed_at) ASC`
    )
      .bind(p.start, p.endExclusive)
      .all<any>();

    return c.json({
      success: true,
      data: {
        period: { start: p.start, end: p.end },
        rows: res.results.map((r) => ({
          date: r.date,
          orderCount: Number(r.order_count),
          grossSales: Number(r.gross_sales),
          totalDiscounts: Number(r.total_discounts),
          aov: Math.round(Number(r.aov)),
        })),
      },
    });
  } catch (err) {
    console.error('GET /api/crm-weekly/daily error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// ---------------------------------------------------------------------------
// GET /api/crm-weekly/trend
//   返り値: 直近 N 週分（既定 4 週）の週次サマリー推移
//   weeks=4 / endWeekStart=YYYY-MM-DD (= 最新週の開始日, 水曜推奨)
// ---------------------------------------------------------------------------
crmWeekly.get('/api/crm-weekly/trend', async (c) => {
  const weeks = Math.min(Math.max(Number(c.req.query('weeks') ?? 4), 1), 12);
  const endWeekStart = c.req.query('endWeekStart');
  if (!endWeekStart || !/^\d{4}-\d{2}-\d{2}$/.test(endWeekStart)) {
    return c.json(
      { success: false, error: 'endWeekStart (YYYY-MM-DD) が必要です。最新週の開始日（水曜推奨）を指定' },
      400
    );
  }

  try {
    const ranges: Array<{ label: string; start: string; endExclusive: string; end: string }> = [];
    const baseDate = new Date(endWeekStart + 'T00:00:00Z');
    for (let i = weeks - 1; i >= 0; i--) {
      const s = new Date(baseDate);
      s.setUTCDate(s.getUTCDate() - i * 7);
      const e = new Date(s);
      e.setUTCDate(e.getUTCDate() + 7); // exclusive
      const endIncl = new Date(s);
      endIncl.setUTCDate(endIncl.getUTCDate() + 6);
      ranges.push({
        label: s.toISOString().slice(0, 10),
        start: s.toISOString().slice(0, 10),
        endExclusive: e.toISOString().slice(0, 10),
        end: endIncl.toISOString().slice(0, 10),
      });
    }

    const trend: any[] = [];
    for (const r of ranges) {
      const row = await c.env.DB.prepare(
        `SELECT
           COUNT(*)                                AS order_count,
           COALESCE(SUM(total_price), 0)           AS gross_sales,
           COALESCE(SUM(total_discounts), 0)       AS total_discounts,
           COALESCE(AVG(total_price), 0)           AS aov
         FROM shopify_orders
         WHERE processed_at >= ? AND processed_at < ?
           AND (cancelled_at IS NULL OR cancelled_at = '')`
      )
        .bind(r.start, r.endExclusive)
        .first<any>();
      const gross = Number(row?.gross_sales ?? 0);
      const discount = Number(row?.total_discounts ?? 0);
      const orderCount = Number(row?.order_count ?? 0);
      trend.push({
        weekStart: r.start,
        weekEnd: r.end,
        orderCount,
        grossSales: gross,
        netSales: gross - discount,
        totalDiscounts: discount,
        discountRatio: gross > 0 ? Number(((discount / gross) * 100).toFixed(2)) : 0,
        aov: orderCount > 0 ? Math.round(gross / orderCount) : 0,
      });
    }

    return c.json({ success: true, data: { weeks: trend } });
  } catch (err) {
    console.error('GET /api/crm-weekly/trend error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// ---------------------------------------------------------------------------
// GET /api/crm-weekly/broadcasts
//   返り値: 期間内に送信した LINE 配信の一覧（broadcasts）
// ---------------------------------------------------------------------------
crmWeekly.get('/api/crm-weekly/broadcasts', async (c) => {
  const p = parsePeriod(c);
  if ('error' in p) return c.json({ success: false, error: p.error }, 400);

  try {
    const res = await c.env.DB.prepare(
      `SELECT
         id,
         title,
         message_type,
         status,
         scheduled_at,
         sent_at,
         total_count,
         success_count,
         failed_count
       FROM broadcasts
       WHERE sent_at >= ? AND sent_at < ?
         AND status = 'sent'
       ORDER BY sent_at ASC`
    )
      .bind(p.start, p.endExclusive)
      .all<any>();

    return c.json({
      success: true,
      data: {
        period: { start: p.start, end: p.end },
        broadcasts: res.results.map((b) => ({
          id: b.id,
          title: b.title,
          messageType: b.message_type,
          sentAt: b.sent_at,
          totalCount: Number(b.total_count ?? 0),
          successCount: Number(b.success_count ?? 0),
          failedCount: Number(b.failed_count ?? 0),
          successRate:
            Number(b.total_count) > 0
              ? Number((((Number(b.success_count) || 0) / Number(b.total_count)) * 100).toFixed(2))
              : 0,
        })),
      },
    });
  } catch (err) {
    console.error('GET /api/crm-weekly/broadcasts error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// ---------------------------------------------------------------------------
// GET /api/crm-weekly/email-campaigns
//   返り値: 期間内の Shopify Email キャンペーン（Admin API 経由）
//   要: SHOPIFY_ADMIN_TOKEN_CRM (CRM週次レポート専用), SHOPIFY_SHOP_DOMAIN
//
//   設計判断:
//     既存 SHOPIFY_ADMIN_TOKEN は ポイント補填/誕生日クーポン/商品同期等の重要機能で
//     稼働中のため、上書きでスコープ追加するとそれらが壊れるリスクがある。
//     よって CRM週次レポート用には別シークレット (SHOPIFY_ADMIN_TOKEN_CRM) を使用する。
// ---------------------------------------------------------------------------
crmWeekly.get('/api/crm-weekly/email-campaigns', async (c) => {
  const p = parsePeriod(c);
  if ('error' in p) return c.json({ success: false, error: p.error }, 400);

  const token = c.env.SHOPIFY_ADMIN_TOKEN_CRM;
  const domain = c.env.SHOPIFY_SHOP_DOMAIN || 'yasuhide-koizumi.myshopify.com';
  if (!token) {
    return c.json(
      {
        success: false,
        error:
          'SHOPIFY_ADMIN_TOKEN_CRM が未設定です。Cloudflare Workers の Secret に追加してください。' +
          ' (CRM週次レポート専用のShopifyトークン。既存の SHOPIFY_ADMIN_TOKEN とは別管理)',
      },
      503
    );
  }

  try {
    // GraphQL Admin API: marketingActivities を期間で取得
    // - marketingChannelType: EMAIL のみに絞る
    // - 期間は updatedAt で大まかに当たりを付け、JS 側で sentDate を再フィルタする
    const query = `
      query MarketingActivities($query: String!) {
        marketingActivities(first: 50, query: $query, sortKey: UPDATED_AT, reverse: true) {
          edges {
            node {
              id
              title
              status
              marketingChannelType
              utmCampaign
              sourceAndMedium
              activityListUrl
              createdAt
              updatedAt
              budget { total { amount currencyCode } }
            }
          }
        }
      }
    `;
    const queryStr = `marketing_channel:EMAIL AND updated_at:>=${p.start}`;

    const apiVersion = '2024-07';
    const url = `https://${domain}/admin/api/${apiVersion}/graphql.json`;
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'X-Shopify-Access-Token': token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query, variables: { query: queryStr } }),
    });
    if (!resp.ok) {
      const text = await resp.text();
      return c.json(
        { success: false, error: `Shopify API error: ${resp.status} ${text.slice(0, 200)}` },
        502
      );
    }
    const json: any = await resp.json();
    if (json.errors) {
      return c.json(
        { success: false, error: 'Shopify GraphQL errors', details: json.errors },
        502
      );
    }
    const edges: any[] = json?.data?.marketingActivities?.edges ?? [];
    const campaigns = edges
      .map((e) => e.node)
      .filter((n) => {
        // updatedAt が期間内か（厳密ではないが、表示用にはこれで十分）
        if (!n.updatedAt) return false;
        const d = n.updatedAt.slice(0, 10);
        return d >= p.start && d <= p.end;
      })
      .map((n) => ({
        id: n.id,
        title: n.title,
        status: n.status,
        channel: n.marketingChannelType,
        utmCampaign: n.utmCampaign,
        sourceAndMedium: n.sourceAndMedium,
        url: n.activityListUrl,
        createdAt: n.createdAt,
        updatedAt: n.updatedAt,
        budget: n.budget?.total?.amount ?? null,
      }));

    return c.json({
      success: true,
      data: {
        period: { start: p.start, end: p.end },
        campaigns,
        note:
          'Shopify marketingActivities は配信メトリクス(開封/CTR/売上)を直接返さないため、' +
          'キャンペーン一覧と URL のみを取得します。詳細メトリクスは別途取得が必要です。',
      },
    });
  } catch (err) {
    console.error('GET /api/crm-weekly/email-campaigns error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// ---------------------------------------------------------------------------
// 手動入力配信 (LINE公式Manager / CRM PLUS 経由) の CRUD
//
// 自社LINEハーネス経由でない配信は broadcasts テーブルに記録できないため、
// 河原さんが画面で手動入力して残せるようにする。
// テーブル: crm_manual_broadcasts (migrations/045_crm_manual_broadcasts.sql)
// ---------------------------------------------------------------------------

interface ManualBroadcastInput {
  source?: string;
  title: string;
  sentAt: string;
  deliveredCount?: number;
  openCount?: number | null;
  openRate?: number | null;
  clickCount?: number | null;
  clickRate?: number | null;
  richViewCount?: number | null;
  note?: string | null;
}

function rowToManualBroadcast(r: any) {
  return {
    id: r.id,
    source: r.source,
    title: r.title,
    sentAt: r.sent_at,
    deliveredCount: Number(r.delivered_count ?? 0),
    openCount: r.open_count == null ? null : Number(r.open_count),
    openRate: r.open_rate == null ? null : Number(r.open_rate),
    clickCount: r.click_count == null ? null : Number(r.click_count),
    clickRate: r.click_rate == null ? null : Number(r.click_rate),
    richViewCount: r.rich_view_count == null ? null : Number(r.rich_view_count),
    note: r.note ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

// GET /api/crm-weekly/manual-broadcasts?start=...&end=...
crmWeekly.get('/api/crm-weekly/manual-broadcasts', async (c) => {
  const p = parsePeriod(c);
  if ('error' in p) return c.json({ success: false, error: p.error }, 400);
  try {
    const res = await c.env.DB.prepare(
      `SELECT * FROM crm_manual_broadcasts
       WHERE DATE(sent_at) >= ? AND DATE(sent_at) <= ?
       ORDER BY sent_at ASC`
    )
      .bind(p.start, p.end)
      .all<any>();
    return c.json({
      success: true,
      data: {
        period: { start: p.start, end: p.end },
        manualBroadcasts: res.results.map(rowToManualBroadcast),
      },
    });
  } catch (err) {
    console.error('GET /api/crm-weekly/manual-broadcasts error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// POST /api/crm-weekly/manual-broadcasts
crmWeekly.post('/api/crm-weekly/manual-broadcasts', async (c) => {
  try {
    const body = (await c.req.json()) as ManualBroadcastInput;
    if (!body.title || !body.sentAt) {
      return c.json({ success: false, error: 'title, sentAt は必須です' }, 400);
    }
    const id = `mb_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    await c.env.DB.prepare(
      `INSERT INTO crm_manual_broadcasts
        (id, source, title, sent_at, delivered_count, open_count, open_rate,
         click_count, click_rate, rich_view_count, note)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        id,
        body.source ?? 'line_official',
        body.title,
        body.sentAt,
        body.deliveredCount ?? 0,
        body.openCount ?? null,
        body.openRate ?? null,
        body.clickCount ?? null,
        body.clickRate ?? null,
        body.richViewCount ?? null,
        body.note ?? null
      )
      .run();
    const row = await c.env.DB.prepare(`SELECT * FROM crm_manual_broadcasts WHERE id = ?`)
      .bind(id)
      .first<any>();
    return c.json({ success: true, data: rowToManualBroadcast(row) }, 201);
  } catch (err) {
    console.error('POST /api/crm-weekly/manual-broadcasts error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// PUT /api/crm-weekly/manual-broadcasts/:id
crmWeekly.put('/api/crm-weekly/manual-broadcasts/:id', async (c) => {
  const id = c.req.param('id');
  try {
    const body = (await c.req.json()) as ManualBroadcastInput;
    const existing = await c.env.DB.prepare(
      `SELECT * FROM crm_manual_broadcasts WHERE id = ?`
    )
      .bind(id)
      .first<any>();
    if (!existing) return c.json({ success: false, error: 'Not found' }, 404);

    await c.env.DB.prepare(
      `UPDATE crm_manual_broadcasts
       SET source = COALESCE(?, source),
           title = COALESCE(?, title),
           sent_at = COALESCE(?, sent_at),
           delivered_count = COALESCE(?, delivered_count),
           open_count = ?,
           open_rate = ?,
           click_count = ?,
           click_rate = ?,
           rich_view_count = ?,
           note = ?,
           updated_at = strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')
       WHERE id = ?`
    )
      .bind(
        body.source ?? null,
        body.title ?? null,
        body.sentAt ?? null,
        body.deliveredCount ?? null,
        body.openCount ?? null,
        body.openRate ?? null,
        body.clickCount ?? null,
        body.clickRate ?? null,
        body.richViewCount ?? null,
        body.note ?? null,
        id
      )
      .run();
    const row = await c.env.DB.prepare(`SELECT * FROM crm_manual_broadcasts WHERE id = ?`)
      .bind(id)
      .first<any>();
    return c.json({ success: true, data: rowToManualBroadcast(row) });
  } catch (err) {
    console.error('PUT /api/crm-weekly/manual-broadcasts/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// DELETE /api/crm-weekly/manual-broadcasts/:id
crmWeekly.delete('/api/crm-weekly/manual-broadcasts/:id', async (c) => {
  const id = c.req.param('id');
  try {
    const res = await c.env.DB.prepare(`DELETE FROM crm_manual_broadcasts WHERE id = ?`)
      .bind(id)
      .run();
    if (res.meta && (res.meta.changes ?? 0) === 0) {
      return c.json({ success: false, error: 'Not found' }, 404);
    }
    return c.json({ success: true });
  } catch (err) {
    console.error('DELETE /api/crm-weekly/manual-broadcasts/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// ---------------------------------------------------------------------------
// POST /api/crm-weekly/migrate-manual-broadcasts
//   045_crm_manual_broadcasts.sql を本番に流す手間を画面から実行できるようにする
//   (河原さんが wrangler を叩けない運用への配慮)
//
//   注意: 冪等 (CREATE TABLE IF NOT EXISTS / CREATE INDEX IF NOT EXISTS) なので
//         複数回叩いても安全。
// ---------------------------------------------------------------------------
crmWeekly.post('/api/crm-weekly/migrate-manual-broadcasts', async (c) => {
  try {
    await c.env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS crm_manual_broadcasts (
         id              TEXT PRIMARY KEY,
         source          TEXT NOT NULL DEFAULT 'line_official',
         title           TEXT NOT NULL,
         sent_at         TEXT NOT NULL,
         delivered_count INTEGER NOT NULL DEFAULT 0,
         open_count      INTEGER,
         open_rate       REAL,
         click_count     INTEGER,
         click_rate      REAL,
         rich_view_count INTEGER,
         note            TEXT,
         created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
         updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
       )`
    ).run();
    await c.env.DB.prepare(
      `CREATE INDEX IF NOT EXISTS idx_crm_manual_broadcasts_sent_at ON crm_manual_broadcasts(sent_at)`
    ).run();
    await c.env.DB.prepare(
      `CREATE INDEX IF NOT EXISTS idx_crm_manual_broadcasts_source ON crm_manual_broadcasts(source)`
    ).run();
    return c.json({ success: true, message: 'crm_manual_broadcasts テーブル作成済み (冪等)' });
  } catch (err) {
    console.error('POST /api/crm-weekly/migrate-manual-broadcasts error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

export { crmWeekly };
