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

// 配信結果の可視化用カラム追加（失敗件数・失敗理由）。ADD COLUMN は非破壊・冪等。
migrationRunner.post('/api/admin/run-migration-broadcast-stats', async (c) => {
  const results: string[] = [];
  const errors: string[] = [];

  try { await c.env.DB.prepare("ALTER TABLE broadcasts ADD COLUMN failed_count INTEGER NOT NULL DEFAULT 0").run(); results.push('OK: failed_count'); }
  catch(e:any){ if(e.message?.includes('duplicate')) results.push('SKIP: failed_count'); else errors.push('FAIL: failed_count: '+e.message); }

  try { await c.env.DB.prepare("ALTER TABLE broadcasts ADD COLUMN error_summary TEXT").run(); results.push('OK: error_summary'); }
  catch(e:any){ if(e.message?.includes('duplicate')) results.push('SKIP: error_summary'); else errors.push('FAIL: error_summary: '+e.message); }

  return c.json({ success: errors.length===0, results, errors });
});

// 複数メッセージ配信のための broadcasts.message_type CHECK 拡張（migration 040）。
// SQLite は CHECK の ALTER 不可のためテーブル再作成。冪等：既に 'multi' があれば SKIP。
migrationRunner.post('/api/admin/run-migration-multi-message', async (c) => {
  const results: string[] = [];
  const errors: string[] = [];

  // Step 0: failed_count / error_summary を安全に追加（既にあれば SKIP）
  try { await c.env.DB.prepare("ALTER TABLE broadcasts ADD COLUMN failed_count INTEGER NOT NULL DEFAULT 0").run(); results.push('OK: failed_count added'); }
  catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes('duplicate')) results.push('SKIP: failed_count'); else errors.push('FAIL: failed_count: ' + msg);
  }
  try { await c.env.DB.prepare("ALTER TABLE broadcasts ADD COLUMN error_summary TEXT").run(); results.push('OK: error_summary added'); }
  catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes('duplicate')) results.push('SKIP: error_summary'); else errors.push('FAIL: error_summary: ' + msg);
  }

  // Step 1: CHECK 制約に 'multi' があるか確認
  let alreadyApplied = false;
  try {
    const row = await c.env.DB.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='broadcasts'").first<{ sql: string }>();
    if (row?.sql?.includes("'multi'")) {
      alreadyApplied = true;
      results.push('SKIP: already applied (CHECK contains multi)');
    }
  } catch (e: unknown) {
    errors.push('FAIL: schema check: ' + (e instanceof Error ? e.message : String(e)));
  }

  if (!alreadyApplied && errors.length === 0) {
    try {
      // Step 2: テーブル再作成
      await c.env.DB.prepare("ALTER TABLE broadcasts RENAME TO broadcasts_old").run();
      results.push('OK: renamed to broadcasts_old');

      await c.env.DB.prepare(`CREATE TABLE broadcasts (
        id              TEXT PRIMARY KEY,
        title           TEXT NOT NULL,
        message_type    TEXT NOT NULL CHECK (message_type IN ('text', 'image', 'flex', 'multi')),
        message_content TEXT NOT NULL,
        target_type     TEXT NOT NULL CHECK (target_type IN ('all', 'tag', 'segment', 'individual')) DEFAULT 'all',
        target_tag_id   TEXT REFERENCES tags (id) ON DELETE SET NULL,
        target_segment_id TEXT REFERENCES segments(segment_id) ON DELETE SET NULL,
        target_friend_ids TEXT,
        status          TEXT NOT NULL CHECK (status IN ('draft', 'scheduled', 'sending', 'sent')) DEFAULT 'draft',
        scheduled_at    TEXT,
        sent_at         TEXT,
        total_count     INTEGER NOT NULL DEFAULT 0,
        success_count   INTEGER NOT NULL DEFAULT 0,
        failed_count    INTEGER NOT NULL DEFAULT 0,
        error_summary   TEXT,
        line_account_id TEXT,
        alt_text        TEXT,
        created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
      )`).run();
      results.push('OK: new broadcasts created');

      // 既存データ移行（Step 0 で failed_count/error_summary は確保済み）
      await c.env.DB.prepare(`INSERT INTO broadcasts (
        id, title, message_type, message_content, target_type, target_tag_id,
        target_segment_id, target_friend_ids, status, scheduled_at, sent_at,
        total_count, success_count, line_account_id, alt_text, created_at
      )
      SELECT
        id, title, message_type, message_content, target_type, target_tag_id,
        target_segment_id, target_friend_ids, status, scheduled_at, sent_at,
        total_count, success_count, line_account_id, alt_text, created_at
      FROM broadcasts_old`).run();
      results.push('OK: data migrated');

      await c.env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_broadcasts_status ON broadcasts (status)").run();
      results.push('OK: index recreated');

      await c.env.DB.prepare("DROP TABLE broadcasts_old").run();
      results.push('OK: broadcasts_old dropped');
    } catch (e: unknown) {
      errors.push('FAIL: recreation: ' + (e instanceof Error ? e.message : String(e)));
    }
  }

  return c.json({ success: errors.length === 0, results, errors });
});

// LINEテンプレートの複数メッセージ対応（migration 041）。
// templates.message_type CHECK に 'multi' を追加。冪等：既に 'multi' があれば SKIP。
migrationRunner.post('/api/admin/run-migration-template-multi', async (c) => {
  const results: string[] = [];
  const errors: string[] = [];

  // 現在の CHECK 制約に 'multi' があるか確認
  let alreadyApplied = false;
  try {
    const row = await c.env.DB.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='templates'").first<{ sql: string }>();
    if (row?.sql?.includes("'multi'")) {
      alreadyApplied = true;
      results.push('SKIP: already applied (CHECK contains multi)');
    }
  } catch (e: unknown) {
    errors.push('FAIL: schema check: ' + (e instanceof Error ? e.message : String(e)));
  }

  if (!alreadyApplied && errors.length === 0) {
    try {
      await c.env.DB.prepare("ALTER TABLE templates RENAME TO templates_old").run();
      results.push('OK: renamed to templates_old');

      await c.env.DB.prepare(`CREATE TABLE templates (
        id              TEXT PRIMARY KEY,
        name            TEXT NOT NULL,
        category        TEXT NOT NULL DEFAULT 'general',
        message_type    TEXT NOT NULL CHECK (message_type IN ('text', 'image', 'flex', 'carousel', 'multi')),
        message_content TEXT NOT NULL,
        created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
        updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
      )`).run();
      results.push('OK: new templates created');

      await c.env.DB.prepare(`INSERT INTO templates (id, name, category, message_type, message_content, created_at, updated_at)
        SELECT id, name, category, message_type, message_content, created_at, updated_at FROM templates_old`).run();
      results.push('OK: data migrated');

      await c.env.DB.prepare("DROP TABLE templates_old").run();
      results.push('OK: templates_old dropped');
    } catch (e: unknown) {
      errors.push('FAIL: recreation: ' + (e instanceof Error ? e.message : String(e)));
    }
  }

  return c.json({ success: errors.length === 0, results, errors });
});

export { migrationRunner };
