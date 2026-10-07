import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { getPendingLoyaltyCode } from '../src/services/loyalty-pending-code.ts';

async function lookup(rows) {
  const sql = new DatabaseSync(':memory:');
  sql.exec(`CREATE TABLE loyalty_transactions (
    friend_id TEXT, type TEXT, points INTEGER, reason TEXT,
    order_id TEXT, created_at TEXT
  )`);
  for (const row of rows) sql.prepare('INSERT INTO loyalty_transactions VALUES (?, ?, ?, ?, ?, ?)').run(...row);
  const db = { prepare(query) { return { bind(...args) { return {
    async first() { return sql.prepare(query).get(...args) ?? null; },
  }; } }; } };
  try { return await getPendingLoyaltyCode(db, 'customer-a'); }
  finally { sql.close(); }
}
const row = (reason, order = null, date = '2026-08-05', friend = 'customer-a', points = -700) =>
  [friend, 'redeem', points, reason, order, date];

test('注文確定済み700ptを保留に含めず、残高120ptを820ptに戻さない', async () => {
  const pending = await lookup([row('ポイント利用（¥700割引 / 注文確定）', 'order-a')]);
  assert.equal(pending, null);
  assert.equal(120 + (pending?.points ?? 0), 120);
});
test('未使用の旧割引コードは引き続き表示する', async () => {
  assert.deepEqual(await lookup([row('ポイント利用（¥1,200割引 / コード: ORYZAE-TEST）', null, '2026-07-28', 'customer-a', -1200)]),
    { code: 'ORYZAE-TEST', discount: 1200, points: 1200 });
});
for (const [name, reason, order] of [
  ['使用済み', '[利用済み]ポイント利用（¥700割引 / コード: ORYZAE-USED）', null],
  ['取り消し済み', '[取り消し済み]ポイント利用（¥700割引 / コード: ORYZAE-CANCELLED）', null],
  ['注文紐付け済み', 'ポイント利用（¥700割引 / コード: ORYZAE-ORDER）', 'order-a'],
  ['注文確定表記', 'ポイント利用（¥700割引 / 注文確定 / コード: ORYZAE-ORDER）', null],
  ['コードなし', 'ポイント利用（¥700割引）', null],
]) test(`${name}は保留にしない`, async () => assert.equal(await lookup([row(reason, order)]), null));
test('最新の注文確定履歴や別顧客のコードで未使用コードを隠さない', async () => {
  assert.deepEqual(await lookup([
    row('ポイント利用（¥700割引 / コード: ORYZAE-PENDING）', null, '2026-07-27'),
    row('ポイント利用（¥700割引 / 注文確定）', 'order-a'),
    row('ポイント利用（¥700割引 / コード: ORYZAE-OTHER）', null, '2026-08-06', 'customer-b'),
  ]), { code: 'ORYZAE-PENDING', discount: 700, points: 700 });
});
