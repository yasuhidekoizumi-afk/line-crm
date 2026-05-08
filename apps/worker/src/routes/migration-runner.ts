import { Hono } from 'hono';
import type { Env } from '../index.js';

const migrationRunner = new Hono<Env>();

// POST /api/admin/run-migration — D1 マイグレーションを直接実行（管理用・確認後削除）
migrationRunner.post('/api/admin/run-migration', async (c) => {
  const results: string[] = [];
  const errors: string[] = [];

  // 1. customer_name カラム追加
  try {
    await c.env.DB.prepare(`ALTER TABLE shopify_orders ADD COLUMN customer_name TEXT`).run();
    results.push('OK: ALTER TABLE shopify_orders ADD COLUMN customer_name TEXT');
  } catch (e: any) {
    if (e.message?.includes('duplicate column')) {
      results.push('SKIP: customer_name column already exists');
    } else {
      errors.push(`FAIL: ALTER TABLE customer_name: ${e.message}`);
    }
  }

  // 2. インデックス追加
  try {
    await c.env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_shopify_orders_customer_name ON shopify_orders(customer_name)`).run();
    results.push('OK: CREATE INDEX idx_shopify_orders_customer_name');
  } catch (e: any) {
    errors.push(`FAIL: CREATE INDEX customer_name: ${e.message}`);
  }

  try {
    await c.env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_shopify_orders_friend_id_null ON shopify_orders(friend_id) WHERE friend_id IS NULL`).run();
    results.push('OK: CREATE INDEX idx_shopify_orders_friend_id_null');
  } catch (e: any) {
    errors.push(`FAIL: CREATE INDEX friend_id_null: ${e.message}`);
  }

  // 3. friends.metadata が存在するか確認
  try {
    const meta = await c.env.DB.prepare(`SELECT metadata FROM friends LIMIT 1`).first();
    results.push('OK: friends.metadata column exists');
  } catch (e: any) {
    results.push('WARN: friends.metadata column NOT found');
    try {
      await c.env.DB.prepare(`ALTER TABLE friends ADD COLUMN metadata TEXT NOT NULL DEFAULT '{}'`).run();
      results.push('OK: ALTER TABLE friends ADD COLUMN metadata');
    } catch (e2: any) {
      errors.push(`FAIL: ALTER TABLE friends metadata: ${e2.message}`);
    }
  }

  return c.json({
    success: errors.length === 0,
    results,
    errors,
  });
});

export { migrationRunner };
