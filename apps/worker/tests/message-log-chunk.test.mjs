/**
 * messages_log 分割書き込みの回帰テスト。
 *
 * 実障害（2026-10）: 受信者全件を1回の db.batch で書いていたため、
 * 348名以上の一斉配信で messages_log が1行も残らなかった。
 * 原因は行数ではなく「1回あたりのデータ量」（本文を1人分ずつ複製していた）。
 * ここでは (1) 行数 (2) 文字数の両方で分割されること、(3) 途中失敗しても
 * 残りが書かれ失敗件数が返ること、(4) 本文が空でも表示時に配信本体から補完できることを検証する。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import {
  insertMessageLogsChunked,
  MESSAGE_LOG_CHUNK_SIZE,
  MESSAGE_LOG_MAX_BATCH_CHARS,
} from '../src/services/message-log.ts';

function makeDb({ failOnCall = [] } = {}) {
  const batches = [];
  let call = 0;
  return {
    batches,
    db: {
      prepare(sql) {
        return {
          bind(...args) {
            return { sql, args };
          },
        };
      },
      async batch(statements) {
        call += 1;
        if (failOnCall.includes(call)) {
          throw new Error(`D1_ERROR: simulated failure on batch ${call}`);
        }
        batches.push(statements);
        return statements.map(() => ({ success: true }));
      },
    },
  };
}

const rows = (n, content = 'hello') =>
  Array.from({ length: n }, (_, i) => ({
    friendId: `friend-${i}`,
    broadcastId: 'bc-1',
    messageType: 'multi',
    content,
    createdAt: '2026-10-21T12:00:00.000+09:00',
  }));

test('250件を100件ずつに分割して書き込む', async () => {
  const { db, batches } = makeDb();
  const result = await insertMessageLogsChunked(db, rows(250));

  assert.equal(result.inserted, 250);
  assert.equal(result.failed, 0);
  assert.equal(batches.length, 3);
  assert.deepEqual(batches.map((b) => b.length), [100, 100, 50]);
  for (const batch of batches) {
    assert.ok(batch.length <= MESSAGE_LOG_CHUNK_SIZE, '1回のbatchが上限を超えている');
  }
});

test('500件でも1回のbatchは100件以下（旧実装は500件を1回で書いていた）', async () => {
  const { db, batches } = makeDb();
  const result = await insertMessageLogsChunked(db, rows(500));

  assert.equal(result.inserted, 500);
  assert.equal(batches.length, 5);
  assert.ok(batches.every((b) => b.length <= 100));
});

test('本文が長い場合は文字数上限でも分割する（1回のデータ量を抑える）', async () => {
  const { db, batches } = makeDb();
  const longContent = 'あ'.repeat(8000);
  const result = await insertMessageLogsChunked(db, rows(50, longContent));

  assert.equal(result.inserted, 50);
  for (const batch of batches) {
    const chars = batch.reduce((sum, s) => sum + String(s.args[3]).length, 0);
    assert.ok(
      chars <= MESSAGE_LOG_MAX_BATCH_CHARS,
      `1回のbatchの本文が上限を超えている: ${chars}`,
    );
  }
  assert.ok(batches.length > 5, '長文では100件ずつではなく文字数で分割されるはず');
});

test('途中のbatchが失敗しても残りは書き、失敗件数を返す（throwしない）', async () => {
  const { db, batches } = makeDb({ failOnCall: [2] });
  const result = await insertMessageLogsChunked(db, rows(250));

  assert.equal(result.inserted, 150);
  assert.equal(result.failed, 100);
  assert.equal(result.failedChunks, 1);
  assert.match(result.firstError ?? '', /simulated failure/);
  assert.deepEqual(batches.map((b) => b.length), [100, 50]);
});

test('chunkSize を指定できる', async () => {
  const { db, batches } = makeDb();
  const result = await insertMessageLogsChunked(db, rows(30), { chunkSize: 10 });

  assert.equal(result.inserted, 30);
  assert.deepEqual(batches.map((b) => b.length), [10, 10, 10]);
});

test('0件なら何もしない', async () => {
  const { db, batches } = makeDb();
  const result = await insertMessageLogsChunked(db, []);

  assert.equal(result.inserted, 0);
  assert.equal(batches.length, 0);
});

test('本文が空の控えは、表示時に配信本体から補完される', () => {
  const sql = new DatabaseSync(':memory:');
  try {
    sql.exec(`
      CREATE TABLE broadcasts (id TEXT PRIMARY KEY, message_content TEXT NOT NULL);
      CREATE TABLE messages_log (
        id TEXT PRIMARY KEY, friend_id TEXT NOT NULL, direction TEXT NOT NULL,
        message_type TEXT NOT NULL, content TEXT NOT NULL,
        broadcast_id TEXT, created_at TEXT NOT NULL
      );
      INSERT INTO broadcasts VALUES ('bc-1', '配信の本文です');
      INSERT INTO messages_log VALUES
        ('l1', 'f1', 'outgoing', 'multi', '', 'bc-1', '2026-10-21T12:00:00+09:00'),
        ('l2', 'f1', 'outgoing', 'text', '個別返信です', NULL, '2026-10-21T12:05:00+09:00');
    `);
    const query = `SELECT ml.id, ml.direction, ml.message_type,
        COALESCE(NULLIF(ml.content, ''), b.message_content, '') AS content, ml.created_at
      FROM messages_log ml LEFT JOIN broadcasts b ON b.id = ml.broadcast_id
      WHERE ml.friend_id = ? ORDER BY ml.created_at ASC LIMIT 30`;
    const result = sql.prepare(query).all('f1');

    assert.equal(result.length, 2);
    assert.equal(result[0].content, '配信の本文です', '配信の控えは本体の本文で表示される');
    assert.equal(result[1].content, '個別返信です', '個別送信の本文はそのまま残る');
  } finally {
    sql.close();
  }
});
