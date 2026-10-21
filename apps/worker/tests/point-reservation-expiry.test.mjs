/**
 * ポイント利用予約の自動失効（2時間）の回帰テスト。
 *
 * 実障害（2026-10）: 予約は割引コードを発行するだけでポイントを減らさず、
 * 注文確定か顧客の取消でしか解除されなかった。放置予約が71件・21,600pt 分あり、
 * 該当顧客は「すでに利用を選択しています」で永久にブロックされていた。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  expireStaleReservations,
  RESERVATION_TTL_MINUTES,
} from '../src/services/point-reservation-expiry.ts';

function makeDb(rows) {
  const state = rows.map((row) => ({ ...row }));
  return {
    state,
    prepare(sql) {
      return {
        bind(...args) {
          return {
            async all() {
              if (sql.includes("status = 'active' AND created_at <")) {
                const [cutoff, limit] = args;
                const out = state
                  .filter((row) => row.status === 'active' && row.created_at < cutoff)
                  .sort((a, b) => a.created_at.localeCompare(b.created_at))
                  .slice(0, limit);
                return { results: out.map((row) => ({ ...row })) };
              }
              throw new Error(`unexpected all: ${sql}`);
            },
            async run() {
              if (sql.includes("SET status = 'cancelled'")) {
                const [updatedAt, id] = args;
                const row = state.find((r) => r.id === id && ['active', 'consuming'].includes(r.status));
                if (!row) return { meta: { changes: 0 } };
                row.status = 'cancelled';
                row.updated_at = updatedAt;
                return { meta: { changes: 1 } };
              }
              if (sql.includes("SET status = 'active'")) {
                const [updatedAt, id] = args;
                const row = state.find((r) => r.id === id && r.status === 'cancelled');
                if (!row) return { meta: { changes: 0 } };
                row.status = 'active';
                row.updated_at = updatedAt;
                return { meta: { changes: 1 } };
              }
              throw new Error(`unexpected run: ${sql}`);
            },
          };
        },
      };
    },
  };
}

const minutesAgo = (min) => new Date(Date.now() - min * 60_000).toISOString();
const reservation = (id, minutes) => ({
  id,
  friend_id: `friend-${id}`,
  shopify_customer_id: '123',
  shopify_discount_code: `ORYZAE-DR-${id}`,
  points: 100,
  discount_amount: 100,
  status: 'active',
  created_at: minutesAgo(minutes),
});

function makeDeleteCode({ fail = false } = {}) {
  const deleted = [];
  return {
    deleted,
    deleteCode: async (code) => {
      if (fail) return false;
      deleted.push(code);
      return true;
    },
  };
}

test('有効期限は2時間', () => {
  assert.equal(RESERVATION_TTL_MINUTES, 120);
});

test('2時間を超えた予約を解除し、Shopifyの割引コードも削除する', async () => {
  const db = makeDb([reservation('a', 180), reservation('b', 24 * 60)]);
  const { deleteCode, deleted } = makeDeleteCode();

  const result = await expireStaleReservations(db, deleteCode);

  assert.deepEqual(result, { expired: 2, failed: 0 });
  assert.ok(db.state.every((row) => row.status === 'cancelled'));
  assert.deepEqual(deleted.sort(), ['ORYZAE-DR-a', 'ORYZAE-DR-b']);
});

test('2時間以内の予約は解除しない', async () => {
  const db = makeDb([reservation('fresh', 30)]);
  const { deleteCode, deleted } = makeDeleteCode();

  const result = await expireStaleReservations(db, deleteCode);

  assert.deepEqual(result, { expired: 0, failed: 0 });
  assert.equal(db.state[0].status, 'active');
  assert.equal(deleted.length, 0);
});

test('コード削除に失敗したら予約を戻して次回リトライする（割引だけ使える穴を作らない）', async () => {
  const db = makeDb([reservation('x', 180)]);
  const { deleteCode } = makeDeleteCode({ fail: true });

  const result = await expireStaleReservations(db, deleteCode);

  assert.deepEqual(result, { expired: 0, failed: 1 });
  assert.equal(db.state[0].status, 'active');
});

test('1回あたりの処理件数を絞れる', async () => {
  const db = makeDb([reservation('a', 300), reservation('b', 240), reservation('c', 180)]);
  const { deleteCode } = makeDeleteCode();

  const result = await expireStaleReservations(db, deleteCode, { limit: 1 });

  assert.deepEqual(result, { expired: 1, failed: 0 });
  assert.equal(db.state.filter((row) => row.status === 'cancelled').length, 1);
});
