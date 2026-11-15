/**
 * 配信の送信前チェック（broadcast-preflight）の回帰テスト。
 * 薬機法・景表法の表現検出と、本文からのURL抽出を固定する。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  detectClaimWarnings,
  extractTextForValidation,
  extractUrls,
  findTooLongText,
} from '../src/utils/broadcast-preflight.ts';

test('医薬品的な効能表現を検出する', () => {
  assert.deepEqual(detectClaimWarnings('腸内環境を整えて便秘解消', 'drug'), ['便秘解消']);
  assert.deepEqual(detectClaimWarnings('生活習慣病の予防に効果', 'drug'), ['予防効果', '生活習慣病']);
  assert.deepEqual(detectClaimWarnings('ぐっすり眠れる', 'drug'), []);
});

test('景表法上の優良誤認になりうる表現を検出する', () => {
  assert.deepEqual(detectClaimWarnings('日本一のグラノーラ', 'ad'), ['日本一']);
  assert.deepEqual(detectClaimWarnings('No.1 売上', 'ad'), ['No.1']);
  // 通常の褒め言葉は拾わない（誤検知でオペレーションを止めない）
  assert.deepEqual(detectClaimWarnings('最高の朝ごはん', 'ad'), []);
  assert.deepEqual(detectClaimWarnings('毎日の主食にどうぞ', 'ad'), []);
});

test('multi形式からテキストだけを取り出す', () => {
  const content = JSON.stringify([
    { type: 'text', content: '1通目' },
    { type: 'image', content: '{"originalContentUrl":"https://example.com/a.png"}' },
    { type: 'text', content: '2通目' },
  ]);
  assert.equal(extractTextForValidation('multi', content), '1通目\n2通目');
  // 壊れたJSONはそのまま返す（検出を落とさない）
  assert.equal(extractTextForValidation('multi', '{"broken"'), '{"broken"');
  assert.equal(extractTextForValidation('text', 'そのまま'), 'そのまま');
});

test('URLを重複なく最大5件まで抽出する', () => {
  const text = 'A https://a.example.com/1 B https://a.example.com/1 C https://b.example.com/2）D http://c.example.com/3';
  assert.deepEqual(extractUrls(text), [
    'https://a.example.com/1',
    'https://b.example.com/2',
    'http://c.example.com/3',
  ]);
  const many = Array.from({ length: 8 }, (_, i) => `https://x.example.com/${i}`).join(' ');
  assert.equal(extractUrls(many).length, 5);
});

test('LINEの文字数上限を超えた本文を特定する', () => {
  assert.deepEqual(findTooLongText(['短い', 'a'.repeat(5001)]), [{ index: 1, length: 5001 }]);
  assert.deepEqual(findTooLongText(['a'.repeat(5000)]), []);
});
