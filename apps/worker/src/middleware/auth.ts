import type { Context, Next } from 'hono';
import { getStaffByApiKey } from '@line-crm/db';
import type { Env } from '../index.js';

export async function authMiddleware(c: Context<Env>, next: Next): Promise<Response | void> {
  // Skip auth for the LINE webhook endpoint — it uses signature verification instead
  // Skip auth for OpenAPI docs — public documentation
  const path = new URL(c.req.url).pathname;
  if (
    path === '/webhook' ||
    path === '/docs' ||
    path === '/openapi.json' ||
    path === '/api/affiliates/click' ||
    path.startsWith('/t/') ||
    path.startsWith('/r/') ||
    path.startsWith('/images/') ||
    path.startsWith('/api/liff/') ||
    path.startsWith('/auth/') ||
    path === '/api/integrations/stripe/webhook' ||
    path.startsWith('/api/shopify/webhooks/') ||
    path.match(/^\/api\/webhooks\/incoming\/[^/]+\/receive$/) ||
    path.match(/^\/api\/forms\/[^/]+\/submit$/) ||
    path.match(/^\/api\/forms\/[^/]+$/) || // GET form definition (public for LIFF)
    path.match(/^\/api\/loyalty\/shopify\/[^/]+$/) || // GET loyalty balance (Shopify customer page)
    path.match(/^\/api\/loyalty\/shopify\/[^/]+\/redeem$/) || // POST redeem (Shopify customer page)
    path.match(/^\/api\/loyalty\/shopify\/[^/]+\/cancel-code$/) || // POST cancel code (Shopify customer page)
    path.match(/^\/api\/loyalty\/shopify\/[^/]+\/history$/) || // GET history (Shopify customer page)
    path === '/api/rewards' || // GET active reward items (Shopify widget)
    path.match(/^\/api\/rewards\/[^/]+\/exchange$/) || // POST exchange (Shopify widget)
    // FERMENT: 認証不要エンドポイント
    path.startsWith('/email/unsubscribe') ||          // 配信停止ページ
    path.startsWith('/email/view/') ||                // 開封トラッキングピクセル
    path === '/webhook/resend' ||                     // Resend Webhook（署名検証を使用）
    path.startsWith('/webhook/shopify/') ||           // Shopify Webhook（共有シークレット）
    path.startsWith('/forms/') ||                     // FERMENT 公開フォーム（埋め込みJS・送信）
    path.startsWith('/reviews/') ||                   // FERMENT レビュー受信フォーム
    path === '/email/optin-confirm' ||                // FERMENT 二重オプトイン確認
    path === '/api/ferment/phase5/double-optin/confirm' || // FERMENT 二重オプトイン確認(直接)
    path === '/api/ferment/phase5/gdpr/request' ||   // FERMENT GDPR削除リクエスト（公開）
    path === '/webhooks/gmail'                       // CS Phase 1: Gmail Pub/Sub Push通知
  ) {
    return next();
  }

  const authHeader = c.req.header('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json({ success: false, error: 'Unauthorized' }, 401);
  }

  const token = authHeader.slice('Bearer '.length);

  // Check staff_members table first
  const staff = await getStaffByApiKey(c.env.DB, token);
  if (staff) {
    c.set('staff', { id: staff.id, name: staff.name, role: staff.role });
    return next();
  }

  // Fallback: env API_KEY acts as owner
  if (token === c.env.API_KEY) {
    c.set('staff', { id: 'env-owner', name: 'Owner', role: 'owner' as const });
    return next();
  }

  return c.json({ success: false, error: 'Unauthorized' }, 401);
}
