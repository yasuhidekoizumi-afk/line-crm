/**
 * messages_log 分割書き込みの回帰テスト。
 *
 * 実障害（2026-10）: 受信者全件を1回の db.batch で書いていたため、
 * 348名以上の一斉配信で messages_log が1行も残らなかった。
 * ここでは「1回の batch に詰める件数が上限以下であること」「途中で失敗しても
 * 残りが書かれ、失敗件数が返ること」を検証する。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { insertMessageLogsChunked, MESSAGE_LOG_CHUNK_SIZE } from '../src/services/message-log.ts';

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

const rows = (n) =>
  Array.from({ length: n }, (_, i) => ({
    friendId: `friend-${i}`,
    broadcastId: 'bc-1',
    messageType: 'text',
    content: 'hello',
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
