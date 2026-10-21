/**
 * messages_log（1人ごとの送信控え）への一括書き込み。
 *
 * 背景（2026-10 実測）:
 *   Cloudflare D1 は 1 回の batch に詰められるステートメント数・バインド数に上限がある。
 *   従来は受信者全件（最大500人 × 6項目 = 3,000バインド）を1回の batch で書いていたため、
 *   348名以上の一斉配信では batch 全体が失敗し、messages_log が 1 行も残らなかった
 *   （LINE送信自体は成功しており、エラーは console.warn で捨てられていた）。
 *
 * 方針:
 *   - 小さな塊（既定100件）に分割して書く。
 *   - 失敗しても throw しない（送信は既に成功しているため、配信結果を「失敗」にしない）。
 *   - 失敗は件数と最初のエラーを返して呼び出し側で可視化する（黙って捨てない）。
 */

export const MESSAGE_LOG_CHUNK_SIZE = 100;

export interface MessageLogRow {
  friendId: string;
  broadcastId: string | null;
  messageType: string;
  content: string;
  createdAt: string;
  scenarioStepId?: string | null;
}

export interface MessageLogInsertResult {
  inserted: number;
  failed: number;
  failedChunks: number;
  firstError: string | null;
}

/**
 * D1Database とテスト用の偽DBの両方を受けるための最小インターフェース。
 * `bind` の戻り値型を S として引き回すことで、D1PreparedStatement[] を要求する
 * 本物の `batch` と型が食い違わないようにしている。
 */
export interface MessageLogDb<S> {
  prepare: (sql: string) => { bind: (...args: unknown[]) => S };
  batch: (statements: S[]) => Promise<unknown>;
}

const INSERT_SQL = `INSERT INTO messages_log (id, friend_id, direction, message_type, content, broadcast_id, scenario_step_id, created_at)
   VALUES (?, ?, 'outgoing', ?, ?, ?, ?, ?)`;

export async function insertMessageLogsChunked<S>(
  db: MessageLogDb<S>,
  rows: MessageLogRow[],
  options: {
    chunkSize?: number;
    newId?: () => string;
    onChunkError?: (error: unknown, chunk: MessageLogRow[]) => void;
  } = {},
): Promise<MessageLogInsertResult> {
  const chunkSize = Math.max(1, options.chunkSize ?? MESSAGE_LOG_CHUNK_SIZE);
  const newId = options.newId ?? (() => crypto.randomUUID());
  const result: MessageLogInsertResult = {
    inserted: 0,
    failed: 0,
    failedChunks: 0,
    firstError: null,
  };

  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const statements = chunk.map((row) =>
      db
        .prepare(INSERT_SQL)
        .bind(
          newId(),
          row.friendId,
          row.messageType,
          row.content,
          row.broadcastId,
          row.scenarioStepId ?? null,
          row.createdAt,
        ),
    );

    try {
      await db.batch(statements);
      result.inserted += chunk.length;
    } catch (error) {
      result.failedChunks += 1;
      result.failed += chunk.length;
      if (!result.firstError) {
        result.firstError = error instanceof Error ? error.message : String(error);
      }
      options.onChunkError?.(error, chunk);
    }
  }

  return result;
}
