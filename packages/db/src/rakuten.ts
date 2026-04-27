/**
 * 楽天 RMS WEB SERVICE 統合 用 DB CRUD
 * 設計書: docs/CS_RAKUTEN_RMS_DESIGN.md
 */
import { jstNow } from './utils.js';

// ===== Types =====

export type RakutenCredentialStatus = 'active' | 'expired' | 'rotating' | 'unverified';
export type RakutenInquiryStatus = 'unread' | 'in_progress' | 'replied' | 'completed';

export interface RakutenCredentialRow {
  id: string;
  issued_at: string;
  expires_at: string;
  last_verified_at: string | null;
  status: RakutenCredentialStatus;
  notification_log: string | null;
  pause_polling: number;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface RakutenInquiryRow {
  id: string;
  rakuten_inquiry_id: string;
  chat_id: string;
  customer_email: string | null;
  customer_name: string | null;
  order_number: string | null;
  inquiry_type: string | null;
  rakuten_status: string;
  is_read: number;
  is_completed: number;
  raw_metadata: string | null;
  fetched_at: string;
  last_synced_at: string | null;
  created_at: string;
}

// ===== rakuten_rms_credentials =====

export async function getRakutenCredential(db: D1Database): Promise<RakutenCredentialRow | null> {
  return db
    .prepare(`SELECT * FROM rakuten_rms_credentials WHERE id = 'default'`)
    .first<RakutenCredentialRow>();
}

export async function upsertRakutenCredential(
  db: D1Database,
  input: {
    issued_at: string;
    expires_at: string;
    status?: RakutenCredentialStatus;
  },
): Promise<void> {
  const now = jstNow();
  await db
    .prepare(
      `INSERT INTO rakuten_rms_credentials (id, issued_at, expires_at, status, notification_log, pause_polling, last_error, created_at, updated_at)
       VALUES ('default', ?, ?, ?, '{}', 0, NULL, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         issued_at = excluded.issued_at,
         expires_at = excluded.expires_at,
         status = excluded.status,
         notification_log = '{}',
         pause_polling = 0,
         last_error = NULL,
         updated_at = excluded.updated_at`,
    )
    .bind(input.issued_at, input.expires_at, input.status ?? 'active', now, now)
    .run();
}

export async function markRakutenVerified(db: D1Database): Promise<void> {
  const now = jstNow();
  await db
    .prepare(
      `UPDATE rakuten_rms_credentials SET last_verified_at = ?, status = 'active', last_error = NULL, pause_polling = 0, updated_at = ? WHERE id = 'default'`,
    )
    .bind(now, now)
    .run();
}

export async function markRakutenExpired(db: D1Database, errorMsg: string): Promise<void> {
  const now = jstNow();
  await db
    .prepare(
      `UPDATE rakuten_rms_credentials SET status = 'expired', pause_polling = 1, last_error = ?, updated_at = ? WHERE id = 'default'`,
    )
    .bind(errorMsg.slice(0, 500), now)
    .run();
}

export async function updateRakutenNotificationLog(
  db: D1Database,
  log: Record<string, string>,
): Promise<void> {
  const now = jstNow();
  await db
    .prepare(
      `UPDATE rakuten_rms_credentials SET notification_log = ?, updated_at = ? WHERE id = 'default'`,
    )
    .bind(JSON.stringify(log), now)
    .run();
}

// ===== rakuten_inquiries =====

export async function findRakutenInquiryByExternalId(
  db: D1Database,
  rakutenInquiryId: string,
): Promise<RakutenInquiryRow | null> {
  return db
    .prepare(`SELECT * FROM rakuten_inquiries WHERE rakuten_inquiry_id = ? LIMIT 1`)
    .bind(rakutenInquiryId)
    .first<RakutenInquiryRow>();
}

export async function insertRakutenInquiry(
  db: D1Database,
  input: Omit<RakutenInquiryRow, 'id' | 'created_at'>,
): Promise<RakutenInquiryRow> {
  const id = crypto.randomUUID();
  const now = jstNow();
  await db
    .prepare(
      `INSERT INTO rakuten_inquiries (id, rakuten_inquiry_id, chat_id, customer_email, customer_name, order_number, inquiry_type, rakuten_status, is_read, is_completed, raw_metadata, fetched_at, last_synced_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      input.rakuten_inquiry_id,
      input.chat_id,
      input.customer_email,
      input.customer_name,
      input.order_number,
      input.inquiry_type,
      input.rakuten_status,
      input.is_read,
      input.is_completed,
      input.raw_metadata,
      input.fetched_at,
      input.last_synced_at,
      now,
    )
    .run();
  return { ...input, id, created_at: now };
}

export async function updateRakutenInquiryStatus(
  db: D1Database,
  rakutenInquiryId: string,
  updates: {
    is_read?: boolean;
    is_completed?: boolean;
    rakuten_status?: string;
  },
): Promise<void> {
  const sets: string[] = [];
  const values: unknown[] = [];
  if (updates.is_read !== undefined) {
    sets.push('is_read = ?');
    values.push(updates.is_read ? 1 : 0);
  }
  if (updates.is_completed !== undefined) {
    sets.push('is_completed = ?');
    values.push(updates.is_completed ? 1 : 0);
  }
  if (updates.rakuten_status !== undefined) {
    sets.push('rakuten_status = ?');
    values.push(updates.rakuten_status);
  }
  if (sets.length === 0) return;
  sets.push('last_synced_at = ?');
  values.push(jstNow());
  values.push(rakutenInquiryId);
  await db
    .prepare(`UPDATE rakuten_inquiries SET ${sets.join(', ')} WHERE rakuten_inquiry_id = ?`)
    .bind(...values)
    .run();
}

// ===== rakuten_api_call_log =====

export async function logRakutenApiCall(
  db: D1Database,
  input: {
    endpoint: string;
    status: number | null;
    request_summary?: string;
    error_message?: string;
    duration_ms: number;
  },
): Promise<void> {
  const id = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO rakuten_api_call_log (id, endpoint, status, request_summary, error_message, duration_ms, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      input.endpoint,
      input.status,
      input.request_summary ?? null,
      input.error_message ?? null,
      input.duration_ms,
      jstNow(),
    )
    .run();
}
