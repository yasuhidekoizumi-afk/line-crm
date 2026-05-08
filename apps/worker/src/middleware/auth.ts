import type { Context, Next } from 'hono';
import { getStaffByApiKey } from '@line-crm/db';
import type { Env } from '../index.js';

export async function authMiddleware(c: Context<Env>, next: Next): Promise<Response | void> {
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
    path.match(/^\/api\/forms\/[^/]+$/) ||
    path.match(/^\/api\/loyalty\/shopify\/[^/]+$/) ||
    path.match(/^\/api\/loyalty\/shopify\/[^/]+\/redeem$/) ||
    path.match(/^\/api\/loyalty\/shopify\/[^/]+\/cancel-code$/) ||
    path.match(/^\/api\/loyalty\/shopify\/[^/]+\/history$/) ||
    path === '/api/admin/run-migration' ||
    path === '/api/shopify/orders/backfill' ||
    path === '/api/shopify/auto-match/stats' ||
    path === '/api/shopify/auto-match/run' ||
    path === '/api/rewards' ||
    path.match(/^\/api\/rewards\/[^/]+\/exchange$/) ||
    path.startsWith('/email/unsubscribe') ||
    path.startsWith('/email/view/') ||
    path === '/webhook/resend' ||
    path.startsWith('/webhook/shopify/') ||
    path.startsWith('/forms/') ||
    path.startsWith('/reviews/') ||
    path === '/email/optin-confirm' ||
    path === '/api/ferment/phase5/double-optin/confirm' ||
    path === '/api/ferment/phase5/gdpr/request' ||
    path === '/webhooks/gmail'
  ) {
    return next();
  }

  const authHeader = c.req.header('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) return c.json({ success: false, error: 'Unauthorized' }, 401);

  const token = authHeader.slice('Bearer '.length);
  const staff = await getStaffByApiKey(c.env.DB, token);
  if (staff) { c.set('staff', { id: staff.id, name: staff.name, role: staff.role }); return next(); }
  if (token === c.env.API_KEY) { c.set('staff', { id: 'env-owner', name: 'Owner', role: 'owner' }); return next(); }

  return c.json({ success: false, error: 'Unauthorized' }, 401);
}
