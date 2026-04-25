/**
 * FERMENT: メールマーケティング拡張の DB クエリヘルパー
 *
 * 呼び出し元:
 *   - apps/worker/src/ferment/routes/ 各ルート
 *   - apps/worker/src/ferment/send-engine.ts
 *   - apps/worker/src/ferment/segment-engine.ts
 *
 * 依存:
 *   - Cloudflare D1Database (packages/db/src/index.ts 経由)
 */

// ============================================================
// 型定義
// ============================================================

export interface Customer {
  customer_id: string;
  email: string | null;
  line_user_id: string | null;
  shopify_customer_id_jp: string | null;
  shopify_customer_id_us: string | null;
  display_name: string | null;
  region: string;
  language: string;
  ltv: number;
  ltv_currency: string;
  order_count: number;
  first_order_at: string | null;
  last_order_at: string | null;
  avg_order_value: number;
  preferred_products: string | null; // JSON array
  tags: string | null;               // JSON array
  subscribed_email: number;
  subscribed_line: number;
  email_bounced: number;
  email_verified_at: string | null;
  source: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface Event {
  event_id: string;
  customer_id: string | null;
  event_type: string;
  source: string | null;
  properties: string | null; // JSON
  occurred_at: string;
}

export interface EmailTemplate {
  template_id: string;
  name: string;
  category: string | null;
  language: string;
  subject_base: string | null;
  preheader_base: string | null;
  body_html: string | null;
  body_text: string | null;
  ai_system_prompt: string | null;
  ai_enabled: number;
  from_name: string;
  from_email: string | null;
  reply_to: string | null;
  created_at: string;
  updated_at: string;
}

export interface EmailCampaign {
  campaign_id: string;
  name: string;
  template_id: string | null;
  segment_id: string | null;
  status: string;
  scheduled_at: string | null;
  sent_at: string | null;
  variant_config: string | null;
  total_targets: number;
  total_sent: number;
  total_opened: number;
  total_clicked: number;
  total_bounced: number;
  total_converted: number;
  total_revenue: number;
  created_at: string;
  updated_at: string;
}

export interface EmailFlow {
  flow_id: string;
  name: string;
  description: string | null;
  trigger_type: string | null;
  trigger_config: string | null;
  is_active: number;
  created_at: string;
  updated_at: string;
}

export interface EmailFlowStep {
  step_id: string;
  flow_id: string;
  step_order: number;
  delay_hours: number;
  template_id: string | null;
  condition: string | null;
  created_at: string;
}

export interface EmailFlowEnrollment {
  enrollment_id: string;
  flow_id: string;
  customer_id: string;
  current_step: number;
  status: string;
  enrolled_at: string;
  next_send_at: string | null;
  completed_at: string | null;
}

export interface Segment {
  segment_id: string;
  name: string;
  description: string | null;
  rules: string;
  channel_scope: string;
  customer_count: number;
  last_computed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface EmailLog {
  log_id: string;
  customer_id: string | null;
  campaign_id: string | null;
  flow_id: string | null;
  step_id: string | null;
  template_id: string | null;
  to_email: string;
  subject: string | null;
  body_html: string | null;
  variant: string | null;
  resend_id: string | null;
  status: string;
  queued_at: string;
  sent_at: string | null;
  delivered_at: string | null;
  opened_at: string | null;
  first_clicked_at: string | null;
  bounced_at: string | null;
  unsubscribed_at: string | null;
  converted_at: string | null;
  revenue: number;
  error_message: string | null;
}

export interface EmailSuppression {
  email: string;
  reason: string | null;
  suppressed_at: string;
  notes: string | null;
}

// ============================================================
// ID 生成ユーティリティ
// ============================================================

/** プレフィックス付き ID を生成する（例: cu_4a3b2c1d0e9f） */
export function generateFermentId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
}

// ============================================================
// customers クエリ
// ============================================================

export async function getCustomers(
  db: D1Database,
  opts?: { limit?: number; offset?: number; region?: string; subscribed_email?: boolean },
): Promise<Customer[]> {
  const conditions: string[] = [];
  const bindings: unknown[] = [];

  if (opts?.region) {
    conditions.push('region = ?');
    bindings.push(opts.region);
  }
  if (opts?.subscribed_email !== undefined) {
    conditions.push('subscribed_email = ?');
    bindings.push(opts.subscribed_email ? 1 : 0);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = opts?.limit ?? 50;
  const offset = opts?.offset ?? 0;

  const result = await db
    .prepare(`SELECT * FROM customers ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
    .bind(...bindings, limit, offset)
    .all<Customer>();
  return result.results;
}

export async function getCustomerById(db: D1Database, customerId: string): Promise<Customer | null> {
  return db
    .prepare('SELECT * FROM customers WHERE customer_id = ?')
    .bind(customerId)
    .first<Customer>();
}

export async function getCustomerByEmail(db: D1Database, email: string): Promise<Customer | null> {
  return db
    .prepare('SELECT * FROM customers WHERE email = ?')
    .bind(email)
    .first<Customer>();
}

export async function getCustomerByLineUserId(
  db: D1Database,
  lineUserId: string,
): Promise<Customer | null> {
  return db
    .prepare('SELECT * FROM customers WHERE line_user_id = ?')
    .bind(lineUserId)
    .first<Customer>();
}

export async function upsertCustomer(
  db: D1Database,
  data: Partial<Customer> & { customer_id: string },
): Promise<void> {
  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO customers (
        customer_id, email, line_user_id, shopify_customer_id_jp, shopify_customer_id_us,
        display_name, region, language, ltv, ltv_currency, order_count,
        first_order_at, last_order_at, avg_order_value, preferred_products, tags,
        subscribed_email, subscribed_line, source, notes, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(customer_id) DO UPDATE SET
        email = COALESCE(excluded.email, email),
        line_user_id = COALESCE(excluded.line_user_id, line_user_id),
        shopify_customer_id_jp = COALESCE(excluded.shopify_customer_id_jp, shopify_customer_id_jp),
        shopify_customer_id_us = COALESCE(excluded.shopify_customer_id_us, shopify_customer_id_us),
        display_name = COALESCE(excluded.display_name, display_name),
        region = COALESCE(excluded.region, region),
        language = COALESCE(excluded.language, language),
        updated_at = excluded.updated_at`,
    )
    .bind(
      data.customer_id,
      data.email ?? null,
      data.line_user_id ?? null,
      data.shopify_customer_id_jp ?? null,
      data.shopify_customer_id_us ?? null,
      data.display_name ?? null,
      data.region ?? 'JP',
      data.language ?? 'ja',
      data.ltv ?? 0,
      data.ltv_currency ?? 'JPY',
      data.order_count ?? 0,
      data.first_order_at ?? null,
      data.last_order_at ?? null,
      data.avg_order_value ?? 0,
      data.preferred_products ?? null,
      data.tags ?? null,
      data.subscribed_email ?? 1,
      data.subscribed_line ?? 1,
      data.source ?? null,
      data.notes ?? null,
      now,
    )
    .run();
}

export async function updateCustomer(
  db: D1Database,
  customerId: string,
  data: Partial<Omit<Customer, 'customer_id' | 'created_at'>>,
): Promise<void> {
  const now = new Date().toISOString();
  const fields = Object.keys(data)
    .filter((k) => k !== 'updated_at')
    .map((k) => `${k} = ?`);
  fields.push('updated_at = ?');
  const values = Object.values(data);
  values.push(now, customerId);

  await db
    .prepare(`UPDATE customers SET ${fields.join(', ')} WHERE customer_id = ?`)
    .bind(...values)
    .run();
}

export async function countCustomers(db: D1Database): Promise<number> {
  const row = await db.prepare('SELECT COUNT(*) as cnt FROM customers').first<{ cnt: number }>();
  return row?.cnt ?? 0;
}

// ============================================================
// events クエリ
// ============================================================

export async function createEvent(
  db: D1Database,
  data: Omit<Event, 'occurred_at'> & { occurred_at?: string },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO events (event_id, customer_id, event_type, source, properties, occurred_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      data.event_id,
      data.customer_id ?? null,
      data.event_type,
      data.source ?? null,
      data.properties ?? null,
      data.occurred_at ?? new Date().toISOString(),
    )
    .run();
}

export async function getCustomerEvents(
  db: D1Database,
  customerId: string,
  limit = 50,
): Promise<Event[]> {
  const result = await db
    .prepare(
      'SELECT * FROM events WHERE customer_id = ? ORDER BY occurred_at DESC LIMIT ?',
    )
    .bind(customerId, limit)
    .all<Event>();
  return result.results;
}

// ============================================================
// email_templates クエリ
// ============================================================

export async function getEmailTemplates(db: D1Database): Promise<EmailTemplate[]> {
  const result = await db
    .prepare('SELECT * FROM email_templates ORDER BY created_at DESC')
    .all<EmailTemplate>();
  return result.results;
}

export async function getEmailTemplateById(
  db: D1Database,
  templateId: string,
): Promise<EmailTemplate | null> {
  return db
    .prepare('SELECT * FROM email_templates WHERE template_id = ?')
    .bind(templateId)
    .first<EmailTemplate>();
}

export async function createEmailTemplate(
  db: D1Database,
  data: Omit<EmailTemplate, 'created_at' | 'updated_at'>,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO email_templates (
        template_id, name, category, language, subject_base, preheader_base,
        body_html, body_text, ai_system_prompt, ai_enabled,
        from_name, from_email, reply_to
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      data.template_id,
      data.name,
      data.category ?? null,
      data.language,
      data.subject_base ?? null,
      data.preheader_base ?? null,
      data.body_html ?? null,
      data.body_text ?? null,
      data.ai_system_prompt ?? null,
      data.ai_enabled,
      data.from_name,
      data.from_email ?? null,
      data.reply_to ?? null,
    )
    .run();
}

export async function updateEmailTemplate(
  db: D1Database,
  templateId: string,
  data: Partial<Omit<EmailTemplate, 'template_id' | 'created_at' | 'updated_at'>>,
): Promise<void> {
  const now = new Date().toISOString();
  const fields = Object.keys(data).map((k) => `${k} = ?`);
  fields.push('updated_at = ?');
  const values = [...Object.values(data), now, templateId];
  await db
    .prepare(`UPDATE email_templates SET ${fields.join(', ')} WHERE template_id = ?`)
    .bind(...values)
    .run();
}

export async function deleteEmailTemplate(db: D1Database, templateId: string): Promise<void> {
  await db
    .prepare('DELETE FROM email_templates WHERE template_id = ?')
    .bind(templateId)
    .run();
}

// ============================================================
// email_campaigns クエリ
// ============================================================

export async function getEmailCampaigns(
  db: D1Database,
  opts?: { status?: string; limit?: number; offset?: number },
): Promise<EmailCampaign[]> {
  const conditions: string[] = [];
  const bindings: unknown[] = [];
  if (opts?.status) {
    conditions.push('status = ?');
    bindings.push(opts.status);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = opts?.limit ?? 50;
  const offset = opts?.offset ?? 0;
  const result = await db
    .prepare(`SELECT * FROM email_campaigns ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
    .bind(...bindings, limit, offset)
    .all<EmailCampaign>();
  return result.results;
}

export async function getEmailCampaignById(
  db: D1Database,
  campaignId: string,
): Promise<EmailCampaign | null> {
  return db
    .prepare('SELECT * FROM email_campaigns WHERE campaign_id = ?')
    .bind(campaignId)
    .first<EmailCampaign>();
}

export async function createEmailCampaign(
  db: D1Database,
  data: Omit<EmailCampaign, 'created_at' | 'updated_at'>,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO email_campaigns (
        campaign_id, name, template_id, segment_id, status,
        scheduled_at, total_targets, total_sent, total_opened,
        total_clicked, total_bounced, total_converted, total_revenue
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      data.campaign_id,
      data.name,
      data.template_id ?? null,
      data.segment_id ?? null,
      data.status,
      data.scheduled_at ?? null,
      data.total_targets,
      data.total_sent,
      data.total_opened,
      data.total_clicked,
      data.total_bounced,
      data.total_converted,
      data.total_revenue,
    )
    .run();
}

export async function updateEmailCampaign(
  db: D1Database,
  campaignId: string,
  data: Partial<Omit<EmailCampaign, 'campaign_id' | 'created_at' | 'updated_at'>>,
): Promise<void> {
  const now = new Date().toISOString();
  const fields = Object.keys(data).map((k) => `${k} = ?`);
  fields.push('updated_at = ?');
  const values = [...Object.values(data), now, campaignId];
  await db
    .prepare(`UPDATE email_campaigns SET ${fields.join(', ')} WHERE campaign_id = ?`)
    .bind(...values)
    .run();
}

export async function deleteEmailCampaign(db: D1Database, campaignId: string): Promise<void> {
  await db
    .prepare('DELETE FROM email_campaigns WHERE campaign_id = ?')
    .bind(campaignId)
    .run();
}

/** スケジュール済みで送信時刻が来たキャンペーンを取得 */
export async function getScheduledCampaignsDue(db: D1Database): Promise<EmailCampaign[]> {
  const now = new Date().toISOString();
  const result = await db
    .prepare(
      `SELECT * FROM email_campaigns
       WHERE status = 'scheduled' AND scheduled_at <= ?
       ORDER BY scheduled_at ASC LIMIT 10`,
    )
    .bind(now)
    .all<EmailCampaign>();
  return result.results;
}

// ============================================================
// email_flows クエリ
// ============================================================

export async function getEmailFlows(db: D1Database): Promise<EmailFlow[]> {
  const result = await db
    .prepare('SELECT * FROM email_flows ORDER BY created_at DESC')
    .all<EmailFlow>();
  return result.results;
}

export async function getEmailFlowById(db: D1Database, flowId: string): Promise<EmailFlow | null> {
  return db
    .prepare('SELECT * FROM email_flows WHERE flow_id = ?')
    .bind(flowId)
    .first<EmailFlow>();
}

export async function createEmailFlow(
  db: D1Database,
  data: Omit<EmailFlow, 'created_at' | 'updated_at'>,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO email_flows (flow_id, name, description, trigger_type, trigger_config, is_active)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      data.flow_id,
      data.name,
      data.description ?? null,
      data.trigger_type ?? null,
      data.trigger_config ?? null,
      data.is_active,
    )
    .run();
}

export async function updateEmailFlow(
  db: D1Database,
  flowId: string,
  data: Partial<Omit<EmailFlow, 'flow_id' | 'created_at' | 'updated_at'>>,
): Promise<void> {
  const now = new Date().toISOString();
  const fields = Object.keys(data).map((k) => `${k} = ?`);
  fields.push('updated_at = ?');
  const values = [...Object.values(data), now, flowId];
  await db
    .prepare(`UPDATE email_flows SET ${fields.join(', ')} WHERE flow_id = ?`)
    .bind(...values)
    .run();
}

export async function deleteEmailFlow(db: D1Database, flowId: string): Promise<void> {
  await db.prepare('DELETE FROM email_flows WHERE flow_id = ?').bind(flowId).run();
}

export async function getEmailFlowSteps(db: D1Database, flowId: string): Promise<EmailFlowStep[]> {
  const result = await db
    .prepare('SELECT * FROM email_flow_steps WHERE flow_id = ? ORDER BY step_order ASC')
    .bind(flowId)
    .all<EmailFlowStep>();
  return result.results;
}

export async function createEmailFlowStep(
  db: D1Database,
  data: Omit<EmailFlowStep, 'created_at'>,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO email_flow_steps (step_id, flow_id, step_order, delay_hours, template_id, condition)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      data.step_id,
      data.flow_id,
      data.step_order,
      data.delay_hours,
      data.template_id ?? null,
      data.condition ?? null,
    )
    .run();
}

export async function deleteEmailFlowStep(db: D1Database, stepId: string): Promise<void> {
  await db.prepare('DELETE FROM email_flow_steps WHERE step_id = ?').bind(stepId).run();
}

// ============================================================
// email_flow_enrollments クエリ
// ============================================================

export async function createEnrollment(
  db: D1Database,
  data: Pick<EmailFlowEnrollment, 'enrollment_id' | 'flow_id' | 'customer_id' | 'next_send_at'>,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO email_flow_enrollments (enrollment_id, flow_id, customer_id, next_send_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT DO NOTHING`,
    )
    .bind(data.enrollment_id, data.flow_id, data.customer_id, data.next_send_at ?? null)
    .run();
}

/** next_send_at が到来したアクティブな enrollment を取得 */
export async function getDueEnrollments(
  db: D1Database,
  limit = 50,
): Promise<EmailFlowEnrollment[]> {
  const now = new Date().toISOString();
  const result = await db
    .prepare(
      `SELECT * FROM email_flow_enrollments
       WHERE status = 'active' AND next_send_at <= ?
       ORDER BY next_send_at ASC LIMIT ?`,
    )
    .bind(now, limit)
    .all<EmailFlowEnrollment>();
  return result.results;
}

export async function updateEnrollment(
  db: D1Database,
  enrollmentId: string,
  data: Partial<Omit<EmailFlowEnrollment, 'enrollment_id' | 'enrolled_at'>>,
): Promise<void> {
  const fields = Object.keys(data).map((k) => `${k} = ?`);
  const values = [...Object.values(data), enrollmentId];
  await db
    .prepare(`UPDATE email_flow_enrollments SET ${fields.join(', ')} WHERE enrollment_id = ?`)
    .bind(...values)
    .run();
}

// ============================================================
// segments クエリ
// ============================================================

export async function getSegments(db: D1Database): Promise<Segment[]> {
  const result = await db
    .prepare('SELECT * FROM segments ORDER BY created_at DESC')
    .all<Segment>();
  return result.results;
}

export async function getSegmentById(db: D1Database, segmentId: string): Promise<Segment | null> {
  return db
    .prepare('SELECT * FROM segments WHERE segment_id = ?')
    .bind(segmentId)
    .first<Segment>();
}

export async function createSegment(
  db: D1Database,
  data: Omit<Segment, 'customer_count' | 'last_computed_at' | 'created_at' | 'updated_at'>,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO segments (segment_id, name, description, rules, channel_scope)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .bind(
      data.segment_id,
      data.name,
      data.description ?? null,
      data.rules,
      data.channel_scope,
    )
    .run();
}

export async function updateSegment(
  db: D1Database,
  segmentId: string,
  data: Partial<Omit<Segment, 'segment_id' | 'created_at' | 'updated_at'>>,
): Promise<void> {
  const now = new Date().toISOString();
  const fields = Object.keys(data).map((k) => `${k} = ?`);
  fields.push('updated_at = ?');
  const values = [...Object.values(data), now, segmentId];
  await db
    .prepare(`UPDATE segments SET ${fields.join(', ')} WHERE segment_id = ?`)
    .bind(...values)
    .run();
}

export async function deleteSegment(db: D1Database, segmentId: string): Promise<void> {
  await db.prepare('DELETE FROM segments WHERE segment_id = ?').bind(segmentId).run();
}

/** セグメントメンバーを洗い替え（古いメンバーを削除して新しいメンバーを挿入） */
export async function replaceSegmentMembers(
  db: D1Database,
  segmentId: string,
  customerIds: string[],
): Promise<void> {
  // 既存メンバーを削除
  await db
    .prepare('DELETE FROM segment_members WHERE segment_id = ?')
    .bind(segmentId)
    .run();

  // 新メンバーをバッチ挿入（D1 binding limit ~100 対応で40件ずつ = 80 placeholders）
  const chunkSize = 40;
  for (let i = 0; i < customerIds.length; i += chunkSize) {
    const chunk = customerIds.slice(i, i + chunkSize);
    if (chunk.length === 0) continue;
    const placeholders = chunk.map(() => '(?, ?)').join(', ');
    const bindings: string[] = [];
    for (const cid of chunk) {
      bindings.push(segmentId, cid);
    }
    await db
      .prepare(`INSERT OR IGNORE INTO segment_members (segment_id, customer_id) VALUES ${placeholders}`)
      .bind(...bindings)
      .run();
  }

  // customer_count と last_computed_at を更新
  const now = new Date().toISOString();
  await db
    .prepare(
      `UPDATE segments SET customer_count = ?, last_computed_at = ?, updated_at = ?
       WHERE segment_id = ?`,
    )
    .bind(customerIds.length, now, now, segmentId)
    .run();
}

export async function getSegmentMemberIds(
  db: D1Database,
  segmentId: string,
): Promise<string[]> {
  const result = await db
    .prepare('SELECT customer_id FROM segment_members WHERE segment_id = ?')
    .bind(segmentId)
    .all<{ customer_id: string }>();
  return result.results.map((r) => r.customer_id);
}

export async function getSegmentMembersWithEmail(
  db: D1Database,
  segmentId: string,
  limit = 500,
  offset = 0,
): Promise<Customer[]> {
  const result = await db
    .prepare(
      `SELECT c.* FROM customers c
       INNER JOIN segment_members sm ON sm.customer_id = c.customer_id
       WHERE sm.segment_id = ?
         AND c.email IS NOT NULL
         AND c.subscribed_email = 1
         AND c.email_bounced = 0
       LIMIT ? OFFSET ?`,
    )
    .bind(segmentId, limit, offset)
    .all<Customer>();
  return result.results;
}

// ============================================================
// email_logs クエリ
// ============================================================

export async function createEmailLog(
  db: D1Database,
  data: Omit<EmailLog, 'queued_at'> & { queued_at?: string },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO email_logs (
        log_id, customer_id, campaign_id, flow_id, step_id, template_id,
        to_email, subject, body_html, variant, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      data.log_id,
      data.customer_id ?? null,
      data.campaign_id ?? null,
      data.flow_id ?? null,
      data.step_id ?? null,
      data.template_id ?? null,
      data.to_email,
      data.subject ?? null,
      data.body_html ?? null,
      data.variant ?? null,
      data.status,
    )
    .run();
}

export async function updateEmailLog(
  db: D1Database,
  logId: string,
  data: Partial<Omit<EmailLog, 'log_id' | 'queued_at'>>,
): Promise<void> {
  const fields = Object.keys(data).map((k) => `${k} = ?`);
  const values = [...Object.values(data), logId];
  await db
    .prepare(`UPDATE email_logs SET ${fields.join(', ')} WHERE log_id = ?`)
    .bind(...values)
    .run();
}

export async function updateEmailLogByResendId(
  db: D1Database,
  resendId: string,
  data: Partial<Omit<EmailLog, 'log_id' | 'queued_at'>>,
): Promise<void> {
  const fields = Object.keys(data).map((k) => `${k} = ?`);
  const values = [...Object.values(data), resendId];
  await db
    .prepare(`UPDATE email_logs SET ${fields.join(', ')} WHERE resend_id = ?`)
    .bind(...values)
    .run();
}

export async function getEmailLogs(
  db: D1Database,
  opts?: { campaign_id?: string; customer_id?: string; limit?: number; offset?: number },
): Promise<EmailLog[]> {
  const conditions: string[] = [];
  const bindings: unknown[] = [];
  if (opts?.campaign_id) {
    conditions.push('campaign_id = ?');
    bindings.push(opts.campaign_id);
  }
  if (opts?.customer_id) {
    conditions.push('customer_id = ?');
    bindings.push(opts.customer_id);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = opts?.limit ?? 50;
  const offset = opts?.offset ?? 0;
  const result = await db
    .prepare(`SELECT * FROM email_logs ${where} ORDER BY queued_at DESC LIMIT ? OFFSET ?`)
    .bind(...bindings, limit, offset)
    .all<EmailLog>();
  return result.results;
}

export async function getEmailLogById(db: D1Database, logId: string): Promise<EmailLog | null> {
  return db
    .prepare('SELECT * FROM email_logs WHERE log_id = ?')
    .bind(logId)
    .first<EmailLog>();
}

export async function getCampaignStats(
  db: D1Database,
  campaignId: string,
): Promise<{ total: number; sent: number; opened: number; clicked: number; bounced: number }> {
  const row = await db
    .prepare(
      `SELECT
         COUNT(*) as total,
         SUM(CASE WHEN status IN ('sent','delivered','opened','clicked') THEN 1 ELSE 0 END) as sent,
         SUM(CASE WHEN opened_at IS NOT NULL THEN 1 ELSE 0 END) as opened,
         SUM(CASE WHEN first_clicked_at IS NOT NULL THEN 1 ELSE 0 END) as clicked,
         SUM(CASE WHEN status = 'bounced' THEN 1 ELSE 0 END) as bounced
       FROM email_logs WHERE campaign_id = ?`,
    )
    .bind(campaignId)
    .first<{ total: number; sent: number; opened: number; clicked: number; bounced: number }>();
  return row ?? { total: 0, sent: 0, opened: 0, clicked: 0, bounced: 0 };
}

// ============================================================
// email_suppressions クエリ
// ============================================================

export async function isSuppressed(db: D1Database, email: string): Promise<boolean> {
  const row = await db
    .prepare('SELECT email FROM email_suppressions WHERE email = ?')
    .bind(email.toLowerCase())
    .first<{ email: string }>();
  return row !== null;
}

export async function addSuppression(
  db: D1Database,
  email: string,
  reason: string,
  notes?: string,
): Promise<void> {
  await db
    .prepare(
      `INSERT OR REPLACE INTO email_suppressions (email, reason, notes)
       VALUES (?, ?, ?)`,
    )
    .bind(email.toLowerCase(), reason, notes ?? null)
    .run();
}

export async function removeSuppression(db: D1Database, email: string): Promise<void> {
  await db
    .prepare('DELETE FROM email_suppressions WHERE email = ?')
    .bind(email.toLowerCase())
    .run();
}

export async function getSuppressions(
  db: D1Database,
  limit = 50,
  offset = 0,
): Promise<EmailSuppression[]> {
  const result = await db
    .prepare('SELECT * FROM email_suppressions ORDER BY suppressed_at DESC LIMIT ? OFFSET ?')
    .bind(limit, offset)
    .all<EmailSuppression>();
  return result.results;
}
