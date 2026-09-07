/**
 * Webhook Inbox — 受信イベントの永続化と再処理。
 *
 * 役割:
 *   - webhook.ts が署名検証後に受信イベントをINSERT（消失防止）
 *   - 処理成功で status='processed'、失敗で attempt_count++ / last_error記録
 *   - 未処理（received）滞留は reprocessPendingWebhookEvents() が1分Cronから再処理
 *
 * ponytail: dead-letter / 指数バックオフは未実装。滞留が実測で問題になったら追加。
 */

export interface WebhookInboxRow {
  id: string;
  line_account_id: string | null;
  event_type: string;
  webhook_event_id: string | null;
  payload: string;
  status: 'received' | 'processed' | 'failed';
  attempt_count: number;
  last_error: string | null;
  received_at: string;
  processed_at: string | null;
}

export async function insertWebhookInbox(
  db: D1Database,
  input: {
    lineAccountId: string | null;
    eventType: string;
    webhookEventId: string | null;
    payload: string;
  },
): Promise<string | null> {
  const id = crypto.randomUUID();
  try {
    await db
      .prepare(
        `INSERT INTO webhook_inbox (id, line_account_id, event_type, webhook_event_id, payload)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .bind(id, input.lineAccountId, input.eventType, input.webhookEventId, input.payload)
      .run();
    return id;
  } catch (err) {
    // UNIQUE(event_id)違反 = LINEの再送。二重処理しないので無視して null を返す。
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('UNIQUE') || msg.includes('constraint')) return null;
    console.error('[webhook-inbox] insert failed:', err);
    return null;
  }
}

export async function markWebhookProcessed(db: D1Database, id: string): Promise<void> {
  await db
    .prepare(
      `UPDATE webhook_inbox
       SET status = 'processed', processed_at = strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')
       WHERE id = ?`,
    )
    .bind(id)
    .run();
}

export async function markWebhookFailed(db: D1Database, id: string, error: unknown): Promise<void> {
  const msg = (error instanceof Error ? error.message : String(error)).slice(0, 500);
  await db
    .prepare(
      `UPDATE webhook_inbox
       SET status = CASE WHEN attempt_count >= 3 THEN 'failed' ELSE 'received' END,
           attempt_count = attempt_count + 1,
           last_error = ?
       WHERE id = ?`,
    )
    .bind(msg, id)
    .run();
}

/** 期限到来の未処理イベントを取得（Cron再処理用） */
export async function getPendingWebhookEvents(
  db: D1Database,
  limit = 50,
): Promise<WebhookInboxRow[]> {
  const result = await db
    .prepare(
      `SELECT * FROM webhook_inbox
       WHERE status = 'received' AND attempt_count < 3
         AND received_at <= strftime('%Y-%m-%dT%H:%M:%f', 'now', '-2 minutes', '+9 hours')
       ORDER BY received_at ASC
       LIMIT ?`,
    )
    .bind(limit)
    .all<WebhookInboxRow>();
  return result.results ?? [];
}
