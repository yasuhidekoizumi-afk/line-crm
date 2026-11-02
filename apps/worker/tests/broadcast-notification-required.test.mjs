import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import assert from 'node:assert/strict';
import test from 'node:test';

const source = readFileSync(new URL('../src/routes/broadcasts.ts', import.meta.url), 'utf8');
const start = source.indexOf('export function hasUneditedNotificationText');
const end = source.indexOf('\nconst NOTIFICATION_TEXT_ERROR', start);
assert.ok(start >= 0 && end > start);
const { hasUneditedNotificationText: invalid } = await import(
  'data:text/javascript,' + encodeURIComponent(stripTypeScriptTypes(source.slice(start, end)))
);

test('notification copy must be explicit for images and cards', () => {
  for (const value of [undefined, '', '  ', 'カードタイプメッセージ', '画像メッセージ', 'Flexメッセージ']) {
    assert.equal(invalid('image', JSON.stringify({ originalContentUrl: 'https://example.com/a.png', altText: value })), true);
    assert.equal(invalid('flex', '{"type":"carousel","contents":[]}', value), true);
  }
  assert.equal(invalid('image', '{"altText":"新商品のお知らせ"}'), false);
  assert.equal(invalid('flex', '{"type":"carousel","contents":[]}', '新商品のお知らせ'), false);
  assert.equal(invalid('text', '本文'), false);
});

test('all blocks must have edited notification copy, including legacy image and rich formats', () => {
  const blocks = [{ type: 'text', content: '本文' }, { type: 'flex', content: '{"type":"bubble"}', altText: 'カードタイプメッセージ' }];
  assert.equal(invalid('multi', JSON.stringify(blocks)), true);
  blocks[1].altText = '新商品のお知らせ';
  assert.equal(invalid('multi', JSON.stringify(blocks)), false);
  assert.equal(invalid('image', '{}', '画像のお知らせ'), false);
  assert.equal(invalid('imagemap', '{"altText":"リッチメッセージ"}'), true);
  assert.equal(invalid('imagemap', '{"altText":"今月のおすすめ"}'), false);
  assert.equal(invalid('flex', 'broken'), true);
});
