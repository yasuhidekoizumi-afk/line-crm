/**
 * リッチメニュー編集画面の「エリアを壊さない」ロジックの回帰テスト。
 *
 * 2026-11-23: 画像だけ差し替えたら全エリアが example.com に戻り、
 * 公開中のメニューのボタンが全部 example.com を開く事故が起きた。
 * その再発防止ロジック（planImageSwap ほか）をここで固定する。
 *
 * 実行: pnpm --filter web test
 *   = node --experimental-strip-types --test tests/rich-menu-areas.test.mjs
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  allBoundsFit,
  boundsFitInSize,
  carryOverActions,
  findPlaceholderUriIndexes,
  findUnsetAreaIndexes,
  isConfiguredAction,
  isPlaceholderUri,
  isSameAspectRatio,
  isSameSize,
  isUnsetUri,
  planImageSwap,
  scaleAreaBounds,
} from '../src/lib/rich-menu-areas.ts'

const LARGE = { width: 2500, height: 1686 }
const COMPACT = { width: 2500, height: 843 }

/** 本番で使われていた 6分割メニュー相当（1/3 × 1/2 の6枚）。 */
function sixAreas() {
  const w = Math.round(2500 / 3)
  const h = Math.round(1686 / 2)
  return Array.from({ length: 6 }, (_, i) => ({
    bounds: {
      x: (i % 3) * w,
      y: Math.floor(i / 3) * h,
      width: w,
      height: h,
    },
    action: { type: 'uri', uri: `https://oryzae.shop/menu/${i + 1}`, label: `エリア${i + 1}` },
  }))
}

test('example.com などの仮置きURLを検出する', () => {
  assert.equal(isPlaceholderUri('https://example.com'), true)
  assert.equal(isPlaceholderUri('https://example.com/path?x=1'), true)
  assert.equal(isPlaceholderUri('https://www.example.com/'), true)
  assert.equal(isPlaceholderUri('http://example.org/foo'), true)
  assert.equal(isPlaceholderUri('https://oryzae.shop/'), false)
  assert.equal(isPlaceholderUri('https://example.co.jp/'), false)
  assert.equal(isPlaceholderUri(''), false)
  assert.equal(isPlaceholderUri(undefined), false)
})

test('リンク先が空 or 仮置きなら「未設定」', () => {
  assert.equal(isUnsetUri(''), true)
  assert.equal(isUnsetUri('   '), true)
  assert.equal(isUnsetUri(undefined), true)
  assert.equal(isUnsetUri('https://example.com'), true)
  assert.equal(isUnsetUri('https://oryzae.shop/'), false)
})

test('動作の設定済み判定はタイプごとに行う', () => {
  assert.equal(isConfiguredAction({ type: 'uri', uri: 'https://oryzae.shop/' }), true)
  assert.equal(isConfiguredAction({ type: 'uri', uri: '' }), false)
  assert.equal(isConfiguredAction({ type: 'uri', uri: 'https://example.com' }), false)
  assert.equal(isConfiguredAction({ type: 'message', text: 'こんにちは' }), true)
  assert.equal(isConfiguredAction({ type: 'message', text: '  ' }), false)
  assert.equal(isConfiguredAction({ type: 'postback', data: 'tap' }), true)
  assert.equal(isConfiguredAction({ type: 'postback', data: '' }), false)
  assert.equal(
    isConfiguredAction({ type: 'richmenuswitch', richMenuAliasId: 'tab-news', data: 'x' }),
    true,
  )
  assert.equal(isConfiguredAction({ type: 'richmenuswitch', richMenuAliasId: '', data: 'x' }), false)
})

test('保存前チェックは example.com のまま残ったエリアの index を返す', () => {
  const areas = [
    { bounds: { x: 0, y: 0, width: 10, height: 10 }, action: { type: 'uri', uri: 'https://oryzae.shop/' } },
    { bounds: { x: 10, y: 0, width: 10, height: 10 }, action: { type: 'uri', uri: 'https://example.com' } },
    { bounds: { x: 20, y: 0, width: 10, height: 10 }, action: { type: 'message', text: 'こんにちは' } },
    { bounds: { x: 30, y: 0, width: 10, height: 10 }, action: { type: 'uri', uri: '' } },
  ]
  assert.deepEqual(findPlaceholderUriIndexes(areas), [1])
  // 空欄も含めた「未設定」は、タブ切替の入れ忘れなども拾う
  assert.deepEqual(findUnsetAreaIndexes(areas), [1, 3])
})

test('同じサイズの画像に差し替えてもエリアを作り直さない', () => {
  const areas = sixAreas()
  assert.deepEqual(planImageSwap(LARGE, { width: 2500, height: 1686 }, areas), { kind: 'keep' })
})

test('縦横比が同じでサイズだけ違う場合は座標の比例変換（アクション保持）', () => {
  const areas = sixAreas()
  assert.deepEqual(planImageSwap(LARGE, { width: 1250, height: 843 }, areas), { kind: 'scale' })
  const scaled = scaleAreaBounds(areas, LARGE, { width: 1250, height: 843 })
  assert.equal(scaled.length, 6)
  scaled.forEach((area, i) => {
    assert.equal(area.action.uri, areas[i].action.uri, `エリア${i + 1} のリンク先が保持されること`)
    assert.ok(boundsFitInSize(area.bounds, { width: 1250, height: 843 }), '座標が画像内に収まること')
  })
  // 1行目は 843/2 を四捨五入した 422、2行目は残り 421（合計が画像高さを超えない）
  assert.deepEqual(scaled[0].bounds, { x: 0, y: 0, width: 417, height: 422 })
  assert.deepEqual(scaled[3].bounds, { x: 0, y: 422, width: 417, height: 421 })
})

test('サイズは違うが既存の範囲が収まる場合はそのまま使う', () => {
  const areas = sixAreas()
  assert.equal(allBoundsFit(areas, { width: 2500, height: 1800 }), true)
  assert.deepEqual(planImageSwap(LARGE, { width: 2500, height: 1800 }, areas), {
    kind: 'keep-as-is',
  })
})

test('既存の範囲が収まらない場合だけ作り直しの確認対象になる', () => {
  const areas = sixAreas()
  // 小サイズ（2500×843）は高さが足りず、6分割の下半分が入らない
  assert.equal(allBoundsFit(areas, COMPACT), false)
  assert.deepEqual(planImageSwap(LARGE, COMPACT, areas), { kind: 'rebuild' })
})

test('初回アップロードはレイアウト提案に回す', () => {
  assert.deepEqual(planImageSwap(null, LARGE, sixAreas()), { kind: 'initial' })
  assert.deepEqual(planImageSwap(LARGE, LARGE, []), { kind: 'initial' })
})

test('作り直すときもアクションは同じ順番で引き継ぐ', () => {
  const previous = sixAreas()
  const next = [
    { bounds: { x: 0, y: 0, width: 100, height: 100 }, action: { type: 'uri', uri: 'https://example.com', label: 'エリア1' } },
    { bounds: { x: 100, y: 0, width: 100, height: 100 }, action: { type: 'uri', uri: 'https://example.com', label: 'エリア2' } },
  ]
  const merged = carryOverActions(next, previous)
  assert.equal(merged.length, 2)
  assert.equal(merged[0].action.uri, 'https://oryzae.shop/menu/1')
  assert.equal(merged[1].action.uri, 'https://oryzae.shop/menu/2')
  // 枠（bounds）は新しいレイアウトのものを使う
  assert.deepEqual(merged[1].bounds, { x: 100, y: 0, width: 100, height: 100 })
})

test('エリアが増えたとき、引き継げない分は未設定のまま残る', () => {
  const previous = [
    { bounds: { x: 0, y: 0, width: 10, height: 10 }, action: { type: 'uri', uri: 'https://oryzae.shop/a' } },
  ]
  const next = [
    { bounds: { x: 0, y: 0, width: 10, height: 10 }, action: { type: 'uri', uri: 'https://example.com' } },
    { bounds: { x: 10, y: 0, width: 10, height: 10 }, action: { type: 'uri', uri: 'https://example.com' } },
  ]
  const merged = carryOverActions(next, previous)
  assert.equal(merged[0].action.uri, 'https://oryzae.shop/a')
  assert.equal(merged[1].action.uri, 'https://example.com')
})

test('サイズ・縦横比の比較は 1% の誤差を許容する', () => {
  assert.equal(isSameSize(LARGE, { width: 2500, height: 1686 }), true)
  assert.equal(isSameSize(LARGE, { width: 2500, height: 1685 }), false)
  assert.equal(isSameAspectRatio(LARGE, { width: 2400, height: 1618 }), true)
  assert.equal(isSameAspectRatio(LARGE, COMPACT), false)
})
