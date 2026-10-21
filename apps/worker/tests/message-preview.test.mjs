/**
 * チャット表示用の本文変換（message-preview）の回帰テスト。
 * 内部保存形式（multi の [{type,content}] など）が生JSONのまま画面に出ないことを検証する。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toDisplayContent } from '../src/utils/message-preview.ts';

const flex = JSON.stringify({
  type: 'bubble',
  body: { type: 'box', layout: 'vertical', contents: [{ type: 'text', text: 'フレックスの見出し' }] },
});

test('text はそのまま返す', () => {
  assert.equal(toDisplayContent('text', 'こんにちは'), 'こんにちは');
});

test('空文字は空のまま', () => {
  assert.equal(toDisplayContent('multi', ''), '');
});

test('multi はテキストを取り出し、画像はラベルにする', () => {
  const content = JSON.stringify([
    { type: 'text', content: '1通目の本文' },
    { type: 'image', content: JSON.stringify({ originalContentUrl: 'https://example.com/a.png' }) },
    { type: 'text', content: '2通目の本文' },
  ]);
  assert.equal(toDisplayContent('multi', content), '1通目の本文\n\n[画像]\n\n2通目の本文');
});

test('multi の flex は altText → 先頭テキストの順で要約する', () => {
  const withAlt = JSON.stringify([{ type: 'flex', content: flex, altText: 'カードの説明' }]);
  assert.equal(toDisplayContent('multi', withAlt), 'カードの説明');

  const withoutAlt = JSON.stringify([{ type: 'flex', content: flex }]);
  assert.equal(toDisplayContent('multi', withoutAlt), 'フレックスの見出し');
});

test('imagemap は altText を使う', () => {
  const content = JSON.stringify({ baseUrl: 'https://example.com/x', altText: 'リッチメニューの説明' });
  assert.equal(toDisplayContent('imagemap', content), 'リッチメニューの説明');
});

test('flex 単体もJSONを出さない', () => {
  assert.equal(toDisplayContent('flex', flex), 'フレックスの見出し');
});

test('壊れたJSONは先頭200文字に切り詰める（生JSONを大量に出さない）', () => {
  const broken = '[' + 'あ'.repeat(500);
  const out = toDisplayContent('multi', broken);
  assert.equal(out.length, 200);
});

test('image はラベル', () => {
  assert.equal(toDisplayContent('image', JSON.stringify({ originalContentUrl: 'https://example.com/a.png' })), '[画像]');
});
