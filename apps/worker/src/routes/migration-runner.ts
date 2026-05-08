import { Hono } from 'hono';
import type { Env } from '../index.js';

const migrationRunner = new Hono<Env>();

migrationRunner.post('/api/admin/run-migration', async (c) => {
  const results: string[] = [];
  const errors: string[] = [];

  // 1. customer_name
  try { await c.env.DB.prepare("ALTER TABLE shopify_orders ADD COLUMN customer_name TEXT").run(); results.push('OK: customer_name'); }
  catch(e:any){ if(e.message?.includes('duplicate')) results.push('SKIP: customer_name'); else errors.push('FAIL: customer_name: '+e.message); }

  // 2. raw_payload
  try { await c.env.DB.prepare("ALTER TABLE shopify_orders ADD COLUMN raw_payload TEXT").run(); results.push('OK: raw_payload'); }
  catch(e:any){ if(e.message?.includes('duplicate')) results.push('SKIP: raw_payload'); else errors.push('FAIL: raw_payload: '+e.message); }

  // 3. indexes
  try { await c.env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_shopify_orders_customer_name ON shopify_orders(customer_name)").run(); results.push('OK: idx customer_name'); } catch(e:any){ errors.push('FAIL: idx cn: '+e.message); }
  try { await c.env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_shopify_orders_friend_id_null ON shopify_orders(friend_id) WHERE friend_id IS NULL").run(); results.push('OK: idx friend_id_null'); } catch(e:any){ errors.push('FAIL: idx fn: '+e.message); }

  // 4. friends.metadata
  try { await c.env.DB.prepare("SELECT metadata FROM friends LIMIT 1").first(); results.push('OK: friends.metadata'); }
  catch { try { await c.env.DB.prepare("ALTER TABLE friends ADD COLUMN metadata TEXT NOT NULL DEFAULT '{}'").run(); results.push('OK: friends.metadata added'); } catch(e2:any){ errors.push('FAIL: metadata: '+e2.message); } }

  // 5. extract names from raw_payload
  try {
    const { extractNamesFromPayload } = await import('../services/shopify-matching.js');
    const r = await extractNamesFromPayload(c.env.DB);
    results.push(`OK: names extracted: ${r.updated}/${r.scanned} (${r.errors} errs)`);
  } catch(e:any) { errors.push('FAIL: names: '+e.message); }

  return c.json({ success: errors.length===0, results, errors });
});

export { migrationRunner };
