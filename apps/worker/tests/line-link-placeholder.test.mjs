import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';

const core = readFileSync(new URL('../src/services/liff-link-core.ts', import.meta.url), 'utf8');
const routes = readFileSync(new URL('../src/routes/loyalty.ts', import.meta.url), 'utf8');

function handler(method, path, deps) {
  const marker = `loyalty.${method}('${path}', `;
  const start = routes.indexOf(marker) + marker.length;
  assert.ok(start >= marker.length);
  const end = routes.indexOf('\n});', start);
  const code = stripTypeScriptTypes(routes.slice(start, end) + '\n}');
  return new Function(...Object.keys(deps), 'return (' + code + ')')(...Object.values(deps));
}
function context(body = {}) {
  return {
    env: { DB: {} },
    req: { param: () => '123', json: async () => body },
    json: (data, status = 200) => ({ data, status }),
  };
}
const point = { friend_id: 'placeholder', balance: 100, limited_balance: 1000,
  limited_expires_at: '2027-01-01T00:00:00Z', rank: 'レギュラー', total_spent: 0 };

for (const linked of [false, true]) {
  test(`mypage reflects real LINE state (${linked}) while retaining points`, async () => {
    const fn = handler('get', '/api/loyalty/shopify/:shopifyCustomerId', {
      checkCustomerSig: async () => null,
      getLoyaltyPointByShopifyCustomerId: async () => point,
      getPendingLoyaltyCode: async () => null,
      getActiveDirectPointReservation: async () => null,
      getExpiringSoonPoints: async () => null,
      EMPTY_BENEFIT_STATUS: { line_linked: false, birthday_registered: false },
      getLoyaltyBenefitStatus: async () => ({ line_linked: linked, birthday_registered: true }),
      RANK_THRESHOLDS: [], RANK_MULTIPLIERS: {},
    });
    const result = await fn(context());
    assert.equal(result.status, 200);
    assert.equal(result.data.data.linked, linked);
    assert.equal(result.data.data.friend_id, linked ? 'placeholder' : null);
    assert.equal(result.data.data.balance + result.data.data.limited_balance, 1100);
    assert.equal(!!(result.data.data.linked || result.data.data.friend_id ||
      result.data.data.benefits.line_linked), linked, 'existing storefront OR expression must be accurate');
  });
}
for (const row of [null, point]) {
  test(`birthday refuses unlinked account ${row ? 'with points' : 'without points'} before Shopify write`, async () => {
    let tokenCalls = 0;
    const fn = handler('post', '/api/loyalty/shopify/:shopifyCustomerId/profile-birthday', {
      checkCustomerSig: async () => null,
      getLoyaltyPointByShopifyCustomerId: async () => row,
      getLoyaltyBenefitStatus: async () => ({ line_linked: false }),
      EMPTY_BENEFIT_STATUS: { line_linked: false },
      getShopifyAdminToken: async () => { tokenCalls++; return null; },
    });
    const result = await fn(context({ birthday: '1980-01-01' }));
    assert.equal(result.status, 400);
    assert.equal(result.data.code, 'not_linked');
    assert.equal(tokenCalls, 0);
  });
}
test('birthday permits a real LINE account through the linkage gate', async () => {
  let tokenCalls = 0;
  const fn = handler('post', '/api/loyalty/shopify/:shopifyCustomerId/profile-birthday', {
    checkCustomerSig: async () => null,
    getLoyaltyPointByShopifyCustomerId: async () => point,
    getLoyaltyBenefitStatus: async () => ({ line_linked: true }),
    EMPTY_BENEFIT_STATUS: { line_linked: false },
    getShopifyAdminToken: async () => { tokenCalls++; return null; },
  });
  await fn(context({ birthday: '1980-01-01' }));
  assert.equal(tokenCalls, 1);
});

function linkHarness(oldId, oldLineId) {
  const rows = new Map([[oldId, { ...point, friend_id: oldId, shopify_customer_id: '123', birthday: '1980-01-01' }]]);
  const txs = [{ friend_id: oldId, points: 1000 }, { friend_id: oldId, points: 100 }];
  const db = {
    prepare(sql) {
      let args;
      return {
        bind(...values) { args = values; return this; },
        async first() {
          assert.match(sql, /SELECT line_user_id FROM friends/);
          return { line_user_id: oldLineId };
        },
        async run() {
          if (sql.startsWith('UPDATE loyalty_transactions')) {
            for (const tx of txs) if (tx.friend_id === args[1]) tx.friend_id = args[0];
          } else if (sql.startsWith('UPDATE loyalty_points')) {
            const p = rows.get(args[1]); rows.delete(args[1]);
            rows.set(args[0], { ...p, friend_id: args[0] });
          } else assert.match(sql, /DELETE FROM friends/);
        },
      };
    },
  };
  const deps = {
    async getLoyaltyPoint(_db, id) { return rows.get(id) ?? null; },
    async getLoyaltyPointByShopifyCustomerId() { return rows.get(oldId); },
    async getLoyaltySetting(_db, key) { return key === 'link_bonus_enabled' ? '0' : null; },
    async upsertLoyaltyPoint(_db, id, updates) {
      rows.set(id, { ...rows.get(id), balance: updates.balance, total_spent: updates.totalSpent,
        rank: updates.rank, shopify_customer_id: updates.shopifyCustomerId });
    },
  };
  const loader = async (name) => name === '@line-crm/db' ? deps :
    name === './loyalty-backfill.js' ? { backfillPendingOrders: async () => ({ processed: 0, totalPointsAwarded: 0 }) } :
    assert.fail('unexpected module ' + name);
  const js = stripTypeScriptTypes(core).replace(/^import .*?;\n/m, '')
    .replace('export async function linkShopifyAndReward', 'async function linkShopifyAndReward')
    .replaceAll('await import(', 'await loader(');
  const fn = new Function('loader', js + '\nreturn linkShopifyAndReward;')(loader);
  return { rows, txs, run: () => fn({ DB: db }, { id: 'real-friend' }, '123', { lineUserId: null }) };
}
test('UUID Shopify placeholder merges without losing birthday or 1100 points', async () => {
  const h = linkHarness('uuid-placeholder', 'shopify:123');
  assert.equal((await h.run()).ok, true);
  const p = h.rows.get('real-friend');
  assert.equal(p.balance, 100);
  assert.equal(p.limited_balance, 1000);
  assert.equal(p.limited_expires_at, point.limited_expires_at);
  assert.equal(p.birthday, '1980-01-01');
  assert.ok(h.txs.every(t => t.friend_id === 'real-friend'));
});
test('legacy placeholder still merges', async () => {
  const h = linkHarness('sp_123', 'shopify:123');
  assert.equal((await h.run()).ok, true);
});
for (const [id, line] of [['uuid-placeholder', 'shopify:999'], ['another-friend', 'U' + 'a'.repeat(32)], ['sp_123', 'U' + 'b'.repeat(32)]]) {
  test(`does not merge unrelated or real account ${id} ${line.slice(0, 10)}`, async () => {
    const h = linkHarness(id, line);
    assert.equal((await h.run()).status, 409);
    assert.equal(h.rows.has('real-friend'), false);
    assert.ok(h.txs.every(t => t.friend_id === id));
  });
}
