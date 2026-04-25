import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { LineClient } from '@line-crm/line-sdk';
import { getLineAccounts } from '@line-crm/db';
import { processStepDeliveries } from './services/step-delivery.js';
import { processScheduledBroadcasts } from './services/broadcast.js';
import { processReminderDeliveries } from './services/reminder-delivery.js';
import { checkAccountHealth } from './services/ban-monitor.js';
import { refreshLineAccessTokens } from './services/token-refresh.js';
import { authMiddleware } from './middleware/auth.js';
import { rateLimitMiddleware } from './middleware/rate-limit.js';
import { webhook } from './routes/webhook.js';
import { friends } from './routes/friends.js';
import { tags } from './routes/tags.js';
import { scenarios } from './routes/scenarios.js';
import { broadcasts } from './routes/broadcasts.js';
import { users } from './routes/users.js';
import { lineAccounts } from './routes/line-accounts.js';
import { conversions } from './routes/conversions.js';
import { affiliates } from './routes/affiliates.js';
import { openapi } from './routes/openapi.js';
import { liffRoutes } from './routes/liff.js';
// Round 3 ルート
import { webhooks } from './routes/webhooks.js';
import { calendar } from './routes/calendar.js';
import { reminders } from './routes/reminders.js';
import { scoring } from './routes/scoring.js';
import { templates } from './routes/templates.js';
import { chats } from './routes/chats.js';
import { notifications } from './routes/notifications.js';
import { stripe } from './routes/stripe.js';
import { health } from './routes/health.js';
import { automations } from './routes/automations.js';
import { richMenus } from './routes/rich-menus.js';
import { trackedLinks } from './routes/tracked-links.js';
import { forms } from './routes/forms.js';
import { adPlatforms } from './routes/ad-platforms.js';
import { staff } from './routes/staff.js';
import { images } from './routes/images.js';
import { loyalty } from './routes/loyalty.js';
import { rewards } from './routes/rewards.js';
import { shopifyWebhooks } from './routes/shopify-webhooks.js';
import { processLoyaltyExpirations } from './services/loyalty-expiry.js';
// FERMENT: メールマーケティング拡張
import {
  emailApiRouter,
  segmentRoutes,
  customerRoutes,
  webhookRoutes as fermentWebhookRoutes,
  publicEmailRoutes,
  backfillRoutes,
  formAdminRoutes,
  formPublicRoutes,
  cartWebhookRoutes,
  reviewRoutes,
  reviewAdminRoutes,
  smsRoutes,
  recommendRoutes,
  insightRoutes,
} from './ferment/routes/index.js';
import { recomputeAllCustomerInsights } from './ferment/cron-insights.js';
import { processScheduledEmailCampaigns } from './ferment/cron-campaigns.js';
import { processFlowDeliveries } from './ferment/cron-flows.js';
import { recomputeAllSegments } from './ferment/cron-segments.js';
import { sendDailySummary } from './ferment/cron-daily-summary.js';

export type Env = {
  Bindings: {
    DB: D1Database;
    IMAGES: R2Bucket;
    LINE_CHANNEL_SECRET: string;
    LINE_CHANNEL_ACCESS_TOKEN: string;
    API_KEY: string;
    LIFF_URL: string;
    LINE_CHANNEL_ID: string;
    LINE_LOGIN_CHANNEL_ID: string;
    LINE_LOGIN_CHANNEL_SECRET: string;
    WORKER_URL: string;
    X_HARNESS_URL?: string;
    SHOPIFY_ADMIN_TOKEN?: string;
    SHOPIFY_SHOP_DOMAIN?: string;
    // FERMENT 追加シークレット
    RESEND_API_KEY?: string;
    RESEND_WEBHOOK_SECRET?: string;
    ANTHROPIC_API_KEY?: string;
    GEMINI_API_KEY?: string;
    SLACK_WEBHOOK_URL?: string;
    FERMENT_SHOPIFY_WEBHOOK_SECRET?: string;
    FERMENT_HMAC_SECRET?: string;
    // FERMENT 追加 vars
    FERMENT_FROM_EMAIL_JP?: string;
    FERMENT_FROM_EMAIL_US?: string;
    FERMENT_FROM_NAME_JP?: string;
    FERMENT_FROM_NAME_US?: string;
    FERMENT_UNSUBSCRIBE_BASE_URL?: string;
  };
  Variables: {
    staff: { id: string; name: string; role: 'owner' | 'admin' | 'staff' };
  };
};

const app = new Hono<Env>();

// CORS — allow all origins for MVP
app.use('*', cors({ origin: '*' }));

// Rate limiting — runs before auth to block abuse early
app.use('*', rateLimitMiddleware);

// Auth middleware — skips /webhook and /docs automatically
app.use('*', authMiddleware);

// Mount route groups — MVP & Round 2
app.route('/', webhook);
app.route('/', friends);
app.route('/', tags);
app.route('/', scenarios);
app.route('/', broadcasts);
app.route('/', users);
app.route('/', lineAccounts);
app.route('/', conversions);
app.route('/', affiliates);
app.route('/', openapi);
app.route('/', liffRoutes);

// Mount route groups — Round 3
app.route('/', webhooks);
app.route('/', calendar);
app.route('/', reminders);
app.route('/', scoring);
app.route('/', templates);
app.route('/', chats);
app.route('/', notifications);
app.route('/', stripe);
app.route('/', health);
app.route('/', automations);
app.route('/', richMenus);
app.route('/', trackedLinks);
app.route('/', forms);
app.route('/', adPlatforms);
app.route('/', staff);
app.route('/', images);
app.route('/', loyalty);
app.route('/', rewards);
app.route('/', shopifyWebhooks);

// FERMENT ルート登録
// 認証が必要な API エンドポイント
app.route('/api/email', emailApiRouter);
app.route('/api/segments', segmentRoutes);
app.route('/api/customers', customerRoutes);
app.route('/api/ferment/backfill', backfillRoutes);
app.route('/api/forms', formAdminRoutes);
app.route('/api/reviews', reviewAdminRoutes);
app.route('/api/sms', smsRoutes);
app.route('/api/ferment/recommend', recommendRoutes);
app.route('/api/ferment/insights', insightRoutes);
// 認証不要の公開エンドポイント（auth middleware は内部でスキップ済み）
app.route('/forms', formPublicRoutes);
app.route('/reviews', reviewRoutes);
app.route('/webhook/shopify', cartWebhookRoutes);
app.route('/email', publicEmailRoutes);
// Webhook（署名検証を使用するため Bearer 認証はスキップ）
app.route('/webhook', fermentWebhookRoutes);

// Short link: /r/:ref → landing page with LINE open button
app.get('/r/:ref', (c) => {
  const ref = c.req.param('ref');
  const liffUrl = c.env.LIFF_URL;
  if (!liffUrl) {
    return c.json({ error: 'LIFF_URL is not configured. Set it via wrangler secret put LIFF_URL.' }, 500);
  }
  const target = `${liffUrl}?ref=${encodeURIComponent(ref)}`;

  return c.html(`<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>LINE Harness</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Hiragino Sans',system-ui,sans-serif;background:#0d1117;color:#fff;display:flex;justify-content:center;align-items:center;min-height:100vh}
.card{text-align:center;max-width:400px;width:90%;padding:48px 24px}
h1{font-size:28px;font-weight:800;margin-bottom:8px}
.sub{font-size:14px;color:rgba(255,255,255,0.5);margin-bottom:40px}
.btn{display:block;width:100%;padding:18px;border:none;border-radius:12px;font-size:18px;font-weight:700;text-decoration:none;text-align:center;color:#fff;background:#06C755;transition:opacity .15s}
.btn:active{opacity:.85}
.note{font-size:12px;color:rgba(255,255,255,0.3);margin-top:24px;line-height:1.6}
</style>
</head>
<body>
<div class="card">
<h1>LINE Harness</h1>
<p class="sub">L社 / U社 の無料代替 OSS</p>
<a href="${target}" class="btn">LINE で体験する</a>
<p class="note">友だち追加するだけで<br>ステップ配信・フォーム・自動返信を体験できます</p>
</div>
</body>
</html>`);
});

// Convenience redirect for /book path
app.get('/book', (c) => c.redirect('/?page=book'));

// 404 fallback — JSON for API paths, plain for others (Workers Assets SPA fallback handles it)
app.notFound((c) => {
  const path = new URL(c.req.url).pathname;
  if (path.startsWith('/api/') || path === '/webhook' || path === '/docs' || path === '/openapi.json') {
    return c.json({ success: false, error: 'Not found' }, 404);
  }
  return c.notFound();
});

// Scheduled handler for cron triggers — runs for all active LINE accounts
async function scheduled(
  _event: ScheduledEvent,
  env: Env['Bindings'],
  _ctx: ExecutionContext,
): Promise<void> {
  // Get all active accounts from DB, plus the default env account
  const dbAccounts = await getLineAccounts(env.DB);
  const activeTokens = new Set<string>();

  // Default account from env
  activeTokens.add(env.LINE_CHANNEL_ACCESS_TOKEN);

  // DB accounts
  for (const account of dbAccounts) {
    if (account.is_active) {
      activeTokens.add(account.channel_access_token);
    }
  }

  // Run delivery for each account
  const jobs = [];
  for (const token of activeTokens) {
    const lineClient = new LineClient(token);
    jobs.push(
      processStepDeliveries(env.DB, lineClient, env.WORKER_URL),
      processScheduledBroadcasts(env.DB, lineClient, env.WORKER_URL),
      processReminderDeliveries(env.DB, lineClient),
    );
  }
  jobs.push(checkAccountHealth(env.DB));
  jobs.push(refreshLineAccessTokens(env.DB));
  jobs.push(processLoyaltyExpirations(env.DB));

  // FERMENT: cron 種別に応じた処理を追加
  // "*/5 * * * *"  → 5分毎（既存）
  // "*/10 * * * *" → 10分毎: キャンペーン配信チェック + フロー配信
  // "0 * * * *"    → 1時間毎: セグメント再計算
  // "0 0 * * *"    → 毎日 0:00 UTC (9:00 JST): 日次サマリー
  const cronExpr = (_event as ScheduledEvent).cron;
  if (cronExpr === '*/10 * * * *') {
    jobs.push(processScheduledEmailCampaigns(env));
    jobs.push(processFlowDeliveries(env));
  } else if (cronExpr === '0 * * * *') {
    jobs.push(recomputeAllSegments(env));
  } else if (cronExpr === '0 0 * * *') {
    jobs.push(sendDailySummary(env));
    // 日次：顧客インサイト（CLV / 購入確率 / 最適送信時刻）の再計算
    jobs.push(recomputeAllCustomerInsights(env).then(() => undefined));
  } else {
    // デフォルト（5分毎）でもキャンペーン・フロー処理を実行
    jobs.push(processScheduledEmailCampaigns(env));
    jobs.push(processFlowDeliveries(env));
  }

  await Promise.allSettled(jobs);
}

export default {
  fetch: app.fetch,
  scheduled,
};
