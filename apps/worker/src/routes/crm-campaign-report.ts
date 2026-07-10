import { Hono } from 'hono';
import type { Env } from '../index.js';
import { getShopifyAdminToken } from '../utils/shopify-token.js';

const crmCampaignReport = new Hono<Env>();
const SHOPIFY_API_VERSION = '2024-10';

type Period = { start: string; end: string; endExclusive: string };

function parsePeriod(c: any): Period | { error: string } {
  const start = c.req.query('start');
  const end = c.req.query('end');
  if (!start || !end) return { error: 'start, end が必要です' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) {
    return { error: 'start, end は YYYY-MM-DD 形式で指定してください' };
  }
  const endDate = new Date(`${end}T00:00:00Z`);
  endDate.setUTCDate(endDate.getUTCDate() + 1);
  return { start, end, endExclusive: endDate.toISOString().slice(0, 10) };
}

function toNumber(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function isValidOrder(order: any): boolean {
  if (order.cancelled_at) return false;
  const status = String(order.financial_status ?? '').toLowerCase();
  return status !== 'refunded' && status !== 'voided';
}

function isLineLikeOrder(order: any): boolean {
  const text = `${order.landing_site ?? ''} ${order.referring_site ?? ''} ${order.source_name ?? ''}`.toLowerCase();
  return (
    text.includes('utm_source=line') ||
    text.includes('line') ||
    text.includes('srclt=oa') ||
    text.includes('_ly_src=oa') ||
    text.includes('ldtag_cl=')
  );
}

function isOatsCrunchOrder(order: any): boolean {
  const landing = String(order.landing_site ?? '').toLowerCase();
  if (landing.includes('oats-crunch')) return true;
  const items = Array.isArray(order.line_items) ? order.line_items : [];
  return items.some((item: any) => {
    const text = `${item.title ?? ''} ${item.sku ?? ''}`.toLowerCase();
    return text.includes('oats') || text.includes('crunch') || text.includes('クランチ');
  });
}

function addSales(summary: any, order: any): void {
  const revenue = toNumber(order.total_price);
  summary.orders += 1;
  summary.revenue += revenue;
  summary.discounts += toNumber(order.total_discounts);
  if (isLineLikeOrder(order)) {
    summary.lineOrders += 1;
    summary.lineRevenue += revenue;
  }
  if (isOatsCrunchOrder(order)) {
    summary.oatsOrders += 1;
    summary.oatsRevenue += revenue;
  }
}

async function fetchShopifyOrders(env: Env['Bindings'], period: Period): Promise<{
  status: 'ok' | 'unavailable' | 'error';
  error: string | null;
  orders: any[];
}> {
  const domain = env.SHOPIFY_SHOP_DOMAIN || 'yasuhide-koizumi.myshopify.com';
  const token = await getShopifyAdminToken(env);
  if (!domain || !token) {
    return { status: 'unavailable', error: 'Shopify credentials not configured', orders: [] };
  }

  const params = new URLSearchParams({
    status: 'any',
    limit: '250',
    order: 'processed_at asc',
    processed_at_min: `${period.start}T00:00:00+09:00`,
    processed_at_max: `${period.endExclusive}T00:00:00+09:00`,
    fields: [
      'id',
      'name',
      'email',
      'total_price',
      'subtotal_price',
      'total_discounts',
      'currency',
      'financial_status',
      'fulfillment_status',
      'cancelled_at',
      'source_name',
      'landing_site',
      'referring_site',
      'processed_at',
      'created_at',
      'updated_at',
      'customer',
      'line_items',
    ].join(','),
  });

  let nextUrl: string | null = `https://${domain}/admin/api/${SHOPIFY_API_VERSION}/orders.json?${params}`;
  const orders: any[] = [];
  let pages = 0;

  while (nextUrl && pages < 20) {
    pages += 1;
    const response = await fetch(nextUrl, {
      headers: {
        'X-Shopify-Access-Token': token,
        'Content-Type': 'application/json',
      },
    });
    if (!response.ok) {
      const text = await response.text();
      return { status: 'error', error: `Shopify ${response.status}: ${text.slice(0, 300)}`, orders };
    }
    const json = (await response.json()) as { orders?: any[] };
    orders.push(...(json.orders ?? []));

    const link = response.headers.get('link') ?? '';
    const next = link
      .split(',')
      .map((part) => part.trim())
      .find((part) => part.includes('rel="next"'));
    const match = next?.match(/<([^>]+)>/);
    nextUrl = match?.[1] ?? null;
  }

  return { status: 'ok', error: null, orders };
}

crmCampaignReport.get('/api/crm-campaign-report', async (c) => {
  const period = parsePeriod(c);
  if ('error' in period) return c.json({ success: false, error: period.error }, 400);

  const [
    d1Sales,
    d1Freshness,
    broadcasts,
    orphanSends,
    clickDaily,
    clickLinks,
    emailState,
    followDaily,
  ] = await Promise.all([
    c.env.DB.prepare(
      `SELECT
         COUNT(*) AS orders,
         COALESCE(SUM(total_price), 0) AS revenue,
         COALESCE(SUM(total_discounts), 0) AS discounts,
         COALESCE(SUM(CASE WHEN lower(COALESCE(landing_site,'')) LIKE '%oats-crunch%' THEN 1 ELSE 0 END), 0) AS oats_orders,
         COALESCE(SUM(CASE WHEN lower(COALESCE(landing_site,'')) LIKE '%oats-crunch%' THEN total_price ELSE 0 END), 0) AS oats_revenue,
         COALESCE(SUM(CASE WHEN lower(COALESCE(landing_site,'')) LIKE '%line%' OR lower(COALESCE(referring_site,'')) LIKE '%line%' THEN 1 ELSE 0 END), 0) AS line_orders,
         COALESCE(SUM(CASE WHEN lower(COALESCE(landing_site,'')) LIKE '%line%' OR lower(COALESCE(referring_site,'')) LIKE '%line%' THEN total_price ELSE 0 END), 0) AS line_revenue
       FROM shopify_orders
       WHERE processed_at >= ? AND processed_at < ?
         AND cancelled_at IS NULL
         AND (financial_status IS NULL OR financial_status NOT IN ('refunded', 'voided'))`,
    ).bind(period.start, period.endExclusive).first<any>(),
    c.env.DB.prepare(
      `SELECT
         COUNT(*) AS total_orders,
         MIN(processed_at) AS min_processed_at,
         MAX(processed_at) AS max_processed_at,
         MIN(ingested_at) AS min_ingested_at,
         MAX(ingested_at) AS max_ingested_at
       FROM shopify_orders`,
    ).first<any>(),
    c.env.DB.prepare(
      `SELECT
         b.id,
         b.title,
         b.sent_at,
         b.target_type,
         s.name AS segment_name,
         t.name AS tag_name,
         b.total_count,
         b.success_count,
         b.failed_count,
         la.name AS line_account_name,
         COUNT(lc.id) AS click_count,
         COUNT(DISTINCT COALESCE(lc.friend_id, lc.id)) AS unique_click_count
       FROM broadcasts b
       LEFT JOIN segments s ON s.segment_id = b.target_segment_id
       LEFT JOIN tags t ON t.id = b.target_tag_id
       LEFT JOIN line_accounts la ON la.id = b.line_account_id
       LEFT JOIN tracked_links tl ON tl.broadcast_id = b.id
       LEFT JOIN link_clicks lc ON lc.tracked_link_id = tl.id
         AND lc.clicked_at >= ? AND lc.clicked_at < ?
       WHERE b.sent_at >= ? AND b.sent_at < ?
         AND b.status = 'sent'
       GROUP BY b.id
       ORDER BY b.sent_at ASC`,
    ).bind(period.start, period.endExclusive, period.start, period.endExclusive).all<any>(),
    c.env.DB.prepare(
      `SELECT
         brs.broadcast_id,
         brs.sent_date,
         COUNT(*) AS sends,
         COUNT(DISTINCT brs.line_user_id) AS unique_users,
         MIN(brs.sent_at) AS first_sent_at,
         MAX(brs.sent_at) AS last_sent_at,
         tl.id AS tracked_link_id,
         tl.original_url,
         tl.click_count
       FROM broadcast_recipient_sends brs
       LEFT JOIN broadcasts b ON b.id = brs.broadcast_id
       LEFT JOIN tracked_links tl ON tl.broadcast_id IS NULL
         AND tl.created_at >= datetime(brs.sent_at, '-2 minutes')
         AND tl.created_at <= datetime(brs.sent_at, '+2 minutes')
       WHERE brs.sent_at >= ? AND brs.sent_at < ?
         AND b.id IS NULL
       GROUP BY brs.broadcast_id, brs.sent_date, tl.id
       ORDER BY first_sent_at ASC`,
    ).bind(period.start, period.endExclusive).all<any>(),
    c.env.DB.prepare(
      `SELECT
         substr(lc.clicked_at, 1, 10) AS date,
         COUNT(*) AS clicks,
         COUNT(DISTINCT lc.tracked_link_id) AS links,
         COUNT(DISTINCT lc.friend_id) AS identified_friends
       FROM link_clicks lc
       WHERE lc.clicked_at >= ? AND lc.clicked_at < ?
       GROUP BY substr(lc.clicked_at, 1, 10)
       ORDER BY date ASC`,
    ).bind(period.start, period.endExclusive).all<any>(),
    c.env.DB.prepare(
      `SELECT
         tl.id,
         tl.name,
         tl.original_url,
         tl.broadcast_id,
         b.title AS broadcast_title,
         COUNT(lc.id) AS clicks,
         COUNT(DISTINCT COALESCE(lc.friend_id, lc.id)) AS unique_clicks,
         MIN(lc.clicked_at) AS first_clicked_at,
         MAX(lc.clicked_at) AS last_clicked_at
       FROM link_clicks lc
       JOIN tracked_links tl ON tl.id = lc.tracked_link_id
       LEFT JOIN broadcasts b ON b.id = tl.broadcast_id
       WHERE lc.clicked_at >= ? AND lc.clicked_at < ?
       GROUP BY tl.id
       ORDER BY clicks DESC, first_clicked_at ASC`,
    ).bind(period.start, period.endExclusive).all<any>(),
    c.env.DB.prepare(
      `SELECT
         (SELECT COUNT(*) FROM crm_manual_broadcasts WHERE sent_at >= ? AND sent_at < ?) AS manual_broadcasts,
         (SELECT COUNT(*) FROM email_campaigns WHERE COALESCE(sent_at, send_at, scheduled_at, created_at) >= ? AND COALESCE(sent_at, send_at, scheduled_at, created_at) < ?) AS email_campaigns,
         (SELECT COUNT(*) FROM email_logs WHERE COALESCE(sent_at, queued_at) >= ? AND COALESCE(sent_at, queued_at) < ?) AS email_logs,
         (SELECT MAX(COALESCE(sent_at, send_at, scheduled_at, created_at)) FROM email_campaigns) AS latest_email_campaign_at,
         (SELECT MAX(COALESCE(sent_at, queued_at)) FROM email_logs) AS latest_email_log_at`,
    ).bind(period.start, period.endExclusive, period.start, period.endExclusive, period.start, period.endExclusive).first<any>(),
    c.env.DB.prepare(
      `SELECT
         substr(created_at, 1, 10) AS date,
         SUM(CASE WHEN event_type = 'follow' THEN 1 ELSE 0 END) AS follows,
         SUM(CASE WHEN event_type = 'unfollow' THEN 1 ELSE 0 END) AS unfollows
       FROM line_follow_events
       WHERE created_at >= ? AND created_at < ?
       GROUP BY substr(created_at, 1, 10)
       ORDER BY date ASC`,
    ).bind(period.start, period.endExclusive).all<any>(),
  ]);

  const live = await fetchShopifyOrders(c.env, period);
  const validLiveOrders = live.orders.filter(isValidOrder);
  const liveSummary = {
    orders: 0,
    revenue: 0,
    discounts: 0,
    lineOrders: 0,
    lineRevenue: 0,
    oatsOrders: 0,
    oatsRevenue: 0,
  };
  const dailyMap = new Map<string, any>();
  for (const order of validLiveOrders) {
    addSales(liveSummary, order);
    const date = String(order.processed_at ?? order.created_at ?? '').slice(0, 10);
    if (!date) continue;
    const row = dailyMap.get(date) ?? { date, orders: 0, revenue: 0, lineOrders: 0, lineRevenue: 0, oatsOrders: 0, oatsRevenue: 0 };
    addSales(row, order);
    dailyMap.set(date, row);
  }

  return c.json({
    success: true,
    data: {
      period: { start: period.start, end: period.end },
      sales: {
        d1: {
          orders: Number(d1Sales?.orders ?? 0),
          revenue: Number(d1Sales?.revenue ?? 0),
          discounts: Number(d1Sales?.discounts ?? 0),
          lineOrders: Number(d1Sales?.line_orders ?? 0),
          lineRevenue: Number(d1Sales?.line_revenue ?? 0),
          oatsOrders: Number(d1Sales?.oats_orders ?? 0),
          oatsRevenue: Number(d1Sales?.oats_revenue ?? 0),
        },
        liveShopify: {
          status: live.status,
          error: live.error,
          fetchedOrders: live.orders.length,
          ...liveSummary,
          daily: Array.from(dailyMap.values()).sort((a, b) => a.date.localeCompare(b.date)),
        },
        d1Freshness: d1Freshness ?? null,
      },
      line: {
        broadcasts: broadcasts.results ?? [],
        orphanSends: orphanSends.results ?? [],
        followDaily: followDaily.results ?? [],
      },
      traffic: {
        daily: clickDaily.results ?? [],
        links: clickLinks.results ?? [],
      },
      email: emailState ?? null,
    },
  });
});

export { crmCampaignReport };
