/**
 * 計測リンクのUTM付与（tracked-link-utm）の回帰テスト。
 * 配信IDが注文の landing_site に残ることを保証する。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTrackedDestination, broadcastUtmCampaign } from '../src/utils/tracked-link-utm.ts';

const BC = 'd99195b3-3f9f-461a-b526-f4a3c81262d8';
const LK = 'aaaa1111-2222-3333-4444-555566667777';

test('配信リンクには配信IDのUTMを付ける', () => {
  const out = new URL(buildTrackedDestination('https://oryzae.shop/products/granola', {
    linkId: LK, broadcastId: BC, isAppLink: false,
  }));
  assert.equal(out.searchParams.get('utm_source'), 'line');
  assert.equal(out.searchParams.get('utm_medium'), 'broadcast');
  assert.equal(out.searchParams.get('utm_campaign'), broadcastUtmCampaign(BC));
  assert.equal(out.searchParams.get('utm_campaign'), 'linebc_d99195b3');
  assert.equal(out.searchParams.get('utm_content'), 'lk_aaaa1111');
  assert.equal(out.origin + out.pathname, 'https://oryzae.shop/products/granola');
});

test('既存のutmは上書きしない', () => {
  const out = new URL(buildTrackedDestination('https://oryzae.shop/?utm_campaign=spring&utm_source=mail', {
    linkId: LK, broadcastId: BC, isAppLink: false,
  }));
  assert.equal(out.searchParams.get('utm_campaign'), 'spring');
  assert.equal(out.searchParams.get('utm_source'), 'mail');
  assert.equal(out.searchParams.get('utm_medium'), 'broadcast');
});

test('appリンク・配信外リンク・壊れたURLはそのまま返す', () => {
  const original = 'https://x.com/oryzae/status/1';
  assert.equal(buildTrackedDestination(original, { linkId: LK, broadcastId: BC, isAppLink: true }), original);
  assert.equal(buildTrackedDestination(original, { linkId: LK, broadcastId: null, isAppLink: false }), original);
  assert.equal(buildTrackedDestination('not a url', { linkId: LK, broadcastId: BC, isAppLink: false }), 'not a url');
});

test('campaign値は配信IDごとに決定的', () => {
  assert.equal(broadcastUtmCampaign(BC), broadcastUtmCampaign(BC));
  assert.notEqual(broadcastUtmCampaign(BC), broadcastUtmCampaign('11111111-2222-3333-4444-555566667777'));
});
