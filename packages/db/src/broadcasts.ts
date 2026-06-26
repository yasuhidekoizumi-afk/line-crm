import { jstNow } from './utils.js';
export type BroadcastTargetType = 'all' | 'tag' | 'segment' | 'individual';
export type BroadcastStatus = 'draft' | 'scheduled' | 'sending' | 'sent';
// 'multi' は複数メッセージ統合タイプ（message_content は [{type,content,altText?}, ...] の JSON 配列）
// 'imagemap' は LINE の imagemap message（公式LINEでいう「リッチメッセージ」）。
//   message_content は { baseUrl, altText, baseSize:{width,height}, actions:[...] } の JSON 文字列。
export type BroadcastMessageType = 'text' | 'image' | 'flex' | 'multi' | 'imagemap';

export interface Broadcast {
  id: string;
  title: string;
  message_type: BroadcastMessageType;
  message_content: string;
  target_type: BroadcastTargetType;
  target_tag_id: string | null;
  target_segment_id: string | null;
  target_friend_ids: string | null;
  status: BroadcastStatus;
  scheduled_at: string | null;
  sent_at: string | null;
  total_count: number;
  success_count: number;
  /** 配信失敗人数（バッチ送信で弾かれた件数） */
  failed_count: number;
  /** 失敗理由の要約（LINE APIエラー本文など。成功時は null） */
  error_summary: string | null;
  line_account_id: string | null;
  alt_text: string | null;
  created_at: string;
}

export async function getBroadcasts(db: D1Database): Promise<Broadcast[]> {
  const result = await db
    .prepare(`SELECT * FROM broadcasts ORDER BY created_at DESC`)
    .all<Broadcast>();
  return result.results;
}

export async function getBroadcastById(
  db: D1Database,
  id: string,
): Promise<Broadcast | null> {
  return db
    .prepare(`SELECT * FROM broadcasts WHERE id = ?`)
    .bind(id)
    .first<Broadcast>();
}

export interface CreateBroadcastInput {
  title: string;
  messageType: BroadcastMessageType;
  messageContent: string;
  targetType: BroadcastTargetType;
  targetTagId?: string | null;
  targetSegmentId?: string | null;
  targetFriendIds?: string[] | null;
  scheduledAt?: string | null;
}

export async function createBroadcast(
  db: D1Database,
  input: CreateBroadcastInput,
): Promise<Broadcast> {
  const id = crypto.randomUUID();
  const now = jstNow();

  const initialStatus: BroadcastStatus = input.scheduledAt ? 'scheduled' : 'draft';

  await db
    .prepare(
      `INSERT INTO broadcasts
         (id, title, message_type, message_content, target_type, target_tag_id, target_segment_id, target_friend_ids, status, scheduled_at, sent_at, total_count, success_count, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 0, 0, ?)`,
    )
    .bind(
      id,
      input.title,
      input.messageType,
      input.messageContent,
      input.targetType,
      input.targetTagId ?? null,
      input.targetSegmentId ?? null,
      input.targetFriendIds ? JSON.stringify(input.targetFriendIds) : null,
      initialStatus,
      input.scheduledAt ?? null,
      now,
    )
    .run();

  return (await getBroadcastById(db, id))!;
}

export type UpdateBroadcastInput = Partial<
  Pick<
    Broadcast,
    | 'title'
    | 'message_type'
    | 'message_content'
    | 'target_type'
    | 'target_tag_id'
    | 'target_segment_id'
    | 'target_friend_ids'
    | 'status'
    | 'scheduled_at'
    | 'alt_text'
  >
>;

export async function updateBroadcast(
  db: D1Database,
  id: string,
  updates: UpdateBroadcastInput,
): Promise<Broadcast | null> {
  const fields: string[] = [];
  const values: unknown[] = [];

  if (updates.title !== undefined) {
    fields.push('title = ?');
    values.push(updates.title);
  }
  if (updates.message_type !== undefined) {
    fields.push('message_type = ?');
    values.push(updates.message_type);
  }
  if (updates.message_content !== undefined) {
    fields.push('message_content = ?');
    values.push(updates.message_content);
  }
  if (updates.target_type !== undefined) {
    fields.push('target_type = ?');
    values.push(updates.target_type);
  }
  if (updates.target_tag_id !== undefined) {
    fields.push('target_tag_id = ?');
    values.push(updates.target_tag_id);
  }
  if (updates.target_segment_id !== undefined) {
    fields.push('target_segment_id = ?');
    values.push(updates.target_segment_id);
  }
  if (updates.target_friend_ids !== undefined) {
    fields.push('target_friend_ids = ?');
    values.push(updates.target_friend_ids);
  }
  if (updates.status !== undefined) {
    fields.push('status = ?');
    values.push(updates.status);
  }
  if (updates.scheduled_at !== undefined) {
    fields.push('scheduled_at = ?');
    values.push(updates.scheduled_at);
  }
  if (updates.alt_text !== undefined) {
    fields.push('alt_text = ?');
    values.push(updates.alt_text);
  }

  if (fields.length > 0) {
    values.push(id);
    await db
      .prepare(`UPDATE broadcasts SET ${fields.join(', ')} WHERE id = ?`)
      .bind(...values)
      .run();
  }

  return getBroadcastById(db, id);
}

export async function deleteBroadcast(db: D1Database, id: string): Promise<void> {
  await db.prepare(`DELETE FROM broadcasts WHERE id = ?`).bind(id).run();
}

export interface BroadcastStatusCounts {
  totalCount?: number;
  successCount?: number;
  failedCount?: number;
  errorSummary?: string | null;
}

export async function updateBroadcastStatus(
  db: D1Database,
  id: string,
  status: BroadcastStatus,
  counts?: BroadcastStatusCounts,
): Promise<void> {
  const fields: string[] = ['status = ?'];
  const values: unknown[] = [status];

  if (status === 'sent') {
    fields.push('sent_at = ?');
    values.push(jstNow());
  }
  if (counts?.totalCount !== undefined) {
    fields.push('total_count = ?');
    values.push(counts.totalCount);
  }
  if (counts?.successCount !== undefined) {
    fields.push('success_count = ?');
    values.push(counts.successCount);
  }
  values.push(id);
  await db
    .prepare(`UPDATE broadcasts SET ${fields.join(', ')} WHERE id = ?`)
    .bind(...values)
    .run();

  // failed_count / error_summary はマイグレーション未適用環境では列が存在しないため、
  // 本体の status 更新とは分離して best-effort で更新する（列が無くても配信処理を壊さない）。
  if (counts?.failedCount !== undefined || counts?.errorSummary !== undefined) {
    const extraFields: string[] = [];
    const extraValues: unknown[] = [];
    if (counts?.failedCount !== undefined) {
      extraFields.push('failed_count = ?');
      extraValues.push(counts.failedCount);
    }
    if (counts?.errorSummary !== undefined) {
      extraFields.push('error_summary = ?');
      extraValues.push(counts.errorSummary);
    }
    extraValues.push(id);
    try {
      await db
        .prepare(`UPDATE broadcasts SET ${extraFields.join(', ')} WHERE id = ?`)
        .bind(...extraValues)
        .run();
    } catch (e) {
      console.error('failed_count/error_summary 更新をスキップ（列未追加の可能性）:', e);
    }
  }
}
