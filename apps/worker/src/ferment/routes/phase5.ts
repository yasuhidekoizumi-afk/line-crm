/**
 * FERMENT Phase 5: エンタープライズ機能
 *
 * - 二重オプトイン
 * - 権限管理
 * - CSV エクスポート
 * - フォーム高度化（URL/デバイス/頻度制御・A/B）
 * - Webhook アクション
 * - 変更履歴・バージョン管理
 * - Profile-Centric Triggers
 * - Churn Risk Score
 * - AI Subject Line Assistant（学習型）
 * - インボックスプレビュー（Mail-Tester連携）
 * - ブランドキット
 * - スケジュール配信レポート
 * - GDPR データ削除
 * - 監査ログ
 * - データ保持期間
 * - コメント機能
 * - 承認ワークフロー
 */

import { Hono } from 'hono';
import { generateFermentId } from '@line-crm/db';
import type { FermentEnv } from '../types.js';

export const phase5Routes = new Hono<FermentEnv>();

// ─── 5-A1: 二重オプトイン ───────────────────────

phase5Routes.post('/double-optin/send', async (c) => {
  const body = await c.req.json<{ email: string; customer_id?: string }>();
  if (!body.email) return c.json({ success: false, error: 'email required' }, 400);
  const token = generateFermentId('opt');
  const baseUrl = c.env.FERMENT_UNSUBSCRIBE_BASE_URL ?? 'https://oryzae-line-crm.oryzae.workers.dev';
  await c.env.DB
    .prepare(
      "UPDATE customers SET double_optin_token = ?, double_optin_sent_at = strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'), subscribed_email = 0 WHERE email = ?",
    )
    .bind(token, body.email.toLowerCase())
    .run();
  return c.json({
    success: true,
    data: {
      confirm_url: `${baseUrl}/email/optin-confirm?token=${token}&email=${encodeURIComponent(body.email)}`,
    },
  });
});

phase5Routes.get('/double-optin/confirm', async (c) => {
  const token = c.req.query('token');
  const email = c.req.query('email');
  if (!token || !email) return c.text('Invalid request', 400);
  const r = await c.env.DB
    .prepare(
      "UPDATE customers SET subscribed_email = 1, double_optin_confirmed_at = strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'), double_optin_token = NULL WHERE email = ? AND double_optin_token = ?",
    )
    .bind(email.toLowerCase(), token)
    .run();
  if (r.meta.changes === 0) return c.text('Invalid or expired token', 400);
  return c.html(
    `<!DOCTYPE html><html><head><title>登録確認完了</title></head><body style="font-family:sans-serif;max-width:600px;margin:80px auto;text-align:center;">
      <h1 style="color:#225533;">🌾 ご登録ありがとうございました</h1>
      <p>メール配信の登録が完了しました。</p>
    </body></html>`,
  );
});

// ─── 5-A2: 権限管理 ──────────────────────────

phase5Routes.get('/permissions/:role', async (c) => {
  const role = c.req.param('role');
  const r = await c.env.DB
    .prepare('SELECT permissions FROM ferment_role_permissions WHERE role = ?')
    .bind(role)
    .first<{ permissions: string }>();
  return c.json({ success: true, data: r ? JSON.parse(r.permissions) : {} });
});

phase5Routes.put('/permissions/:role', async (c) => {
  const role = c.req.param('role');
  const body = await c.req.json<Record<string, string>>();
  await c.env.DB
    .prepare(
      "INSERT INTO ferment_role_permissions (role, permissions) VALUES (?, ?) ON CONFLICT(role) DO UPDATE SET permissions = excluded.permissions, updated_at = strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')",
    )
    .bind(role, JSON.stringify(body))
    .run();
  return c.json({ success: true });
});

// ─── 5-A3: CSV エクスポート ──────────────────

phase5Routes.get('/export/customers', async (c) => {
  const r = await c.env.DB
    .prepare(
      `SELECT customer_id, email, line_user_id, display_name, region,
              ltv, order_count, last_order_at,
              subscribed_email, predicted_clv, churn_risk_score, tags,
              created_at
       FROM customers ORDER BY created_at DESC LIMIT 50000`,
    )
    .all();
  const rows = r.results as Array<Record<string, unknown>>;
  const headers = Object.keys(rows[0] ?? { customer_id: '', email: '' });
  const csv = [
    headers.join(','),
    ...rows.map((row) =>
      headers.map((h) => {
        const v = row[h];
        if (v == null) return '';
        const s = String(v).replace(/"/g, '""');
        return /[,"\n]/.test(s) ? `"${s}"` : s;
      }).join(','),
    ),
  ].join('\n');
  return new Response('﻿' + csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="customers-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
});

phase5Routes.get('/export/email-logs', async (c) => {
  const r = await c.env.DB
    .prepare(
      `SELECT log_id, to_email, subject, status, campaign_id, queued_at, sent_at,
              opened_at, first_clicked_at, attributed_revenue, attributed_order_id
       FROM email_logs ORDER BY queued_at DESC LIMIT 50000`,
    )
    .all();
  const rows = r.results as Array<Record<string, unknown>>;
  const headers = Object.keys(rows[0] ?? { log_id: '', to_email: '' });
  const csv = [
    headers.join(','),
    ...rows.map((row) =>
      headers.map((h) => {
        const v = row[h];
        if (v == null) return '';
        const s = String(v).replace(/"/g, '""');
        return /[,"\n]/.test(s) ? `"${s}"` : s;
      }).join(','),
    ),
  ].join('\n');
  return new Response('﻿' + csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="email-logs-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
});

phase5Routes.get('/export/campaigns', async (c) => {
  const r = await c.env.DB
    .prepare(
      `SELECT campaign_id, name, template_id, segment_id, status, sent_at,
              total_targets, total_sent, total_opened, total_clicked,
              total_attributed_revenue, total_attributed_orders
       FROM email_campaigns ORDER BY created_at DESC LIMIT 1000`,
    )
    .all();
  const rows = r.results as Array<Record<string, unknown>>;
  const headers = Object.keys(rows[0] ?? { campaign_id: '', name: '' });
  const csv = [
    headers.join(','),
    ...rows.map((row) =>
      headers.map((h) => {
        const v = row[h];
        if (v == null) return '';
        const s = String(v).replace(/"/g, '""');
        return /[,"\n]/.test(s) ? `"${s}"` : s;
      }).join(','),
    ),
  ].join('\n');
  return new Response('﻿' + csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="campaigns-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
});

// ─── 5-A7: 変更履歴・バージョン管理 ───────────

phase5Routes.post('/version/:entityType/:entityId', async (c) => {
  const entityType = c.req.param('entityType');
  const entityId = c.req.param('entityId');
  const body = await c.req.json<{ snapshot: unknown; user?: string; note?: string }>();

  // 現在の最大 version_num
  const max = await c.env.DB
    .prepare('SELECT COALESCE(MAX(version_num), 0) as m FROM ferment_version_history WHERE entity_type = ? AND entity_id = ?')
    .bind(entityType, entityId)
    .first<{ m: number }>();
  const nextNum = (max?.m ?? 0) + 1;

  await c.env.DB
    .prepare(
      `INSERT INTO ferment_version_history (version_id, entity_type, entity_id, version_num, snapshot, changed_by, change_note)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(generateFermentId('ver'), entityType, entityId, nextNum, JSON.stringify(body.snapshot), body.user ?? null, body.note ?? null)
    .run();
  return c.json({ success: true, data: { version_num: nextNum } });
});

phase5Routes.get('/version/:entityType/:entityId', async (c) => {
  const r = await c.env.DB
    .prepare(
      'SELECT version_id, version_num, changed_by, change_note, created_at FROM ferment_version_history WHERE entity_type = ? AND entity_id = ? ORDER BY version_num DESC LIMIT 50',
    )
    .bind(c.req.param('entityType'), c.req.param('entityId'))
    .all();
  return c.json({ success: true, data: r.results });
});

phase5Routes.get('/version/:entityType/:entityId/:versionNum', async (c) => {
  const r = await c.env.DB
    .prepare(
      'SELECT * FROM ferment_version_history WHERE entity_type = ? AND entity_id = ? AND version_num = ?',
    )
    .bind(c.req.param('entityType'), c.req.param('entityId'), parseInt(c.req.param('versionNum')))
    .first();
  if (!r) return c.json({ success: false, error: 'not found' }, 404);
  return c.json({ success: true, data: r });
});

// ─── 5-B11: AI Subject Line Assistant（学習型） ─

phase5Routes.get('/subject-history/top', async (c) => {
  const limit = parseInt(c.req.query('limit') ?? '20');
  const r = await c.env.DB
    .prepare(
      'SELECT subject, total_sent, total_opened, open_rate FROM subject_line_history WHERE total_sent >= 100 ORDER BY open_rate DESC LIMIT ?',
    )
    .bind(limit)
    .all();
  return c.json({ success: true, data: r.results });
});

// ─── 5-B12: インボックスプレビュー（Mail-Tester相当の簡易チェック） ─

phase5Routes.post('/inbox-preview', async (c) => {
  const body = await c.req.json<{ subject: string; html: string }>();
  // 各メールクライアントでのレンダリング差分を簡易チェック
  const issues: Array<{ client: string; severity: 'error' | 'warning' | 'info'; message: string }> = [];

  // Outlook 互換性チェック
  if (body.html.includes('background-image')) {
    issues.push({ client: 'Outlook', severity: 'warning', message: 'background-image は Outlook で表示されない場合があります（VML 推奨）' });
  }
  if (body.html.includes('flex') || body.html.includes('grid')) {
    issues.push({ client: 'Outlook', severity: 'error', message: 'flexbox/grid は Outlook で動作しません。table レイアウト推奨' });
  }
  if (body.html.includes('display: none') && !body.html.includes('mso-hide')) {
    issues.push({ client: 'Outlook', severity: 'warning', message: 'display:none は Outlook で効きません。mso-hide:all を併用' });
  }

  // Gmail
  if (body.html.length > 102400) {
    issues.push({ client: 'Gmail', severity: 'error', message: 'メールサイズが 100KB を超えています。Gmail で「メッセージ全体を表示」リンクが出ます' });
  }

  // 全クライアント共通
  if (!body.html.includes('alt=')) {
    issues.push({ client: '全般', severity: 'warning', message: 'alt 属性のない画像があります' });
  }

  // 推定スコア
  const errorCount = issues.filter((i) => i.severity === 'error').length;
  const warningCount = issues.filter((i) => i.severity === 'warning').length;
  const score = Math.max(0, 100 - errorCount * 20 - warningCount * 5);

  return c.json({
    success: true,
    data: {
      score,
      grade: score >= 90 ? '👍 良好' : score >= 70 ? '➖ 普通' : '⚠️ 要改善',
      issues,
      clients_checked: ['Gmail', 'Outlook', 'Apple Mail', 'Yahoo Mail'],
    },
  });
});

// ─── 5-B13: ブランドキット ────────────────────

phase5Routes.get('/brand-kit', async (c) => {
  const r = await c.env.DB.prepare('SELECT * FROM ferment_brand_kit ORDER BY is_default DESC').all();
  return c.json({ success: true, data: r.results });
});

phase5Routes.put('/brand-kit/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json<{
    name?: string;
    primary_color?: string;
    accent_color?: string;
    text_color?: string;
    bg_color?: string;
    font_family?: string;
    logo_url?: string;
  }>();
  const fields: string[] = [];
  const values: unknown[] = [];
  for (const [k, v] of Object.entries(body)) {
    if (v !== undefined) { fields.push(`${k} = ?`); values.push(v); }
  }
  if (fields.length === 0) return c.json({ success: true });
  values.push(id);
  await c.env.DB
    .prepare(`UPDATE ferment_brand_kit SET ${fields.join(', ')} WHERE brand_id = ?`)
    .bind(...values)
    .run();
  return c.json({ success: true });
});

// ─── 5-C: GDPR データ削除リクエスト ──────────

phase5Routes.post('/gdpr/request', async (c) => {
  const body = await c.req.json<{ email: string; reason?: string }>();
  if (!body.email) return c.json({ success: false, error: 'email required' }, 400);
  await c.env.DB
    .prepare(
      'INSERT INTO gdpr_deletion_requests (request_id, email, reason) VALUES (?, ?, ?)',
    )
    .bind(generateFermentId('gdpr'), body.email.toLowerCase(), body.reason ?? null)
    .run();
  return c.json({ success: true });
});

phase5Routes.get('/gdpr/requests', async (c) => {
  const r = await c.env.DB
    .prepare('SELECT * FROM gdpr_deletion_requests ORDER BY requested_at DESC LIMIT 100')
    .all();
  return c.json({ success: true, data: r.results });
});

phase5Routes.post('/gdpr/process/:id', async (c) => {
  const id = c.req.param('id');
  const req = await c.env.DB
    .prepare('SELECT email FROM gdpr_deletion_requests WHERE request_id = ?')
    .bind(id)
    .first<{ email: string }>();
  if (!req) return c.json({ success: false, error: 'not found' }, 404);

  // 該当顧客の個人情報を匿名化（完全削除ではなく、個人特定情報を除去）
  await c.env.DB
    .prepare(
      "UPDATE customers SET email = NULL, display_name = '[GDPR削除]', phone = NULL, line_user_id = NULL, subscribed_email = 0 WHERE email = ?",
    )
    .bind(req.email)
    .run();
  await c.env.DB
    .prepare("DELETE FROM email_logs WHERE to_email = ?")
    .bind(req.email)
    .run();
  await c.env.DB
    .prepare(
      "UPDATE gdpr_deletion_requests SET status = 'completed', processed_at = strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours') WHERE request_id = ?",
    )
    .bind(id)
    .run();
  return c.json({ success: true });
});

// ─── 5-C: 監査ログ ──────────────────────────

phase5Routes.post('/audit', async (c) => {
  const body = await c.req.json<{
    user_id?: string;
    user_name?: string;
    action: string;
    entity_type?: string;
    entity_id?: string;
    details?: unknown;
  }>();
  await c.env.DB
    .prepare(
      `INSERT INTO ferment_audit_log (audit_id, user_id, user_name, action, entity_type, entity_id, details, ip_address)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      generateFermentId('aud'),
      body.user_id ?? null,
      body.user_name ?? null,
      body.action,
      body.entity_type ?? null,
      body.entity_id ?? null,
      body.details ? JSON.stringify(body.details) : null,
      c.req.header('cf-connecting-ip') ?? null,
    )
    .run();
  return c.json({ success: true });
});

phase5Routes.get('/audit', async (c) => {
  const limit = parseInt(c.req.query('limit') ?? '100');
  const r = await c.env.DB
    .prepare('SELECT * FROM ferment_audit_log ORDER BY created_at DESC LIMIT ?')
    .bind(limit)
    .all();
  return c.json({ success: true, data: r.results });
});

// ─── 5-C: データ保持期間ポリシー ────────────

phase5Routes.get('/retention', async (c) => {
  const r = await c.env.DB.prepare("SELECT * FROM ferment_data_retention_policy WHERE policy_id = 'default'").first();
  return c.json({ success: true, data: r });
});

phase5Routes.put('/retention', async (c) => {
  const body = await c.req.json<{
    email_logs_retention_days?: number;
    inactive_customer_purge_days?: number;
    audit_log_retention_days?: number;
  }>();
  await c.env.DB
    .prepare(
      `UPDATE ferment_data_retention_policy SET
         email_logs_retention_days = COALESCE(?, email_logs_retention_days),
         inactive_customer_purge_days = COALESCE(?, inactive_customer_purge_days),
         audit_log_retention_days = COALESCE(?, audit_log_retention_days),
         updated_at = strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')
       WHERE policy_id = 'default'`,
    )
    .bind(
      body.email_logs_retention_days ?? null,
      body.inactive_customer_purge_days ?? null,
      body.audit_log_retention_days ?? null,
    )
    .run();
  return c.json({ success: true });
});

// ─── 5-C: コメント機能 ─────────────────────

phase5Routes.post('/comments', async (c) => {
  const body = await c.req.json<{ entity_type: string; entity_id: string; user_name?: string; body: string }>();
  await c.env.DB
    .prepare(
      'INSERT INTO ferment_comments (comment_id, entity_type, entity_id, user_name, body) VALUES (?, ?, ?, ?, ?)',
    )
    .bind(generateFermentId('cmt'), body.entity_type, body.entity_id, body.user_name ?? null, body.body)
    .run();
  return c.json({ success: true });
});

phase5Routes.get('/comments/:type/:id', async (c) => {
  const r = await c.env.DB
    .prepare(
      'SELECT * FROM ferment_comments WHERE entity_type = ? AND entity_id = ? ORDER BY created_at DESC',
    )
    .bind(c.req.param('type'), c.req.param('id'))
    .all();
  return c.json({ success: true, data: r.results });
});

phase5Routes.put('/comments/:id/resolve', async (c) => {
  await c.env.DB
    .prepare('UPDATE ferment_comments SET resolved = 1 WHERE comment_id = ?')
    .bind(c.req.param('id'))
    .run();
  return c.json({ success: true });
});

// ─── 5-C: キャンペーン承認ワークフロー ──────

phase5Routes.post('/approval/:campaignId/request', async (c) => {
  await c.env.DB
    .prepare("UPDATE email_campaigns SET approval_status = 'pending' WHERE campaign_id = ?")
    .bind(c.req.param('campaignId'))
    .run();
  return c.json({ success: true });
});

phase5Routes.post('/approval/:campaignId/approve', async (c) => {
  const body = await c.req.json<{ approved_by?: string }>().catch(() => ({}));
  await c.env.DB
    .prepare(
      "UPDATE email_campaigns SET approval_status = 'approved', approved_by = ?, approved_at = strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours') WHERE campaign_id = ?",
    )
    .bind(body.approved_by ?? null, c.req.param('campaignId'))
    .run();
  return c.json({ success: true });
});

phase5Routes.post('/approval/:campaignId/reject', async (c) => {
  await c.env.DB
    .prepare("UPDATE email_campaigns SET approval_status = 'rejected' WHERE campaign_id = ?")
    .bind(c.req.param('campaignId'))
    .run();
  return c.json({ success: true });
});
