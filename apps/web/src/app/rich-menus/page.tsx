'use client'

import { useState, useEffect, useCallback, useRef, type DragEvent } from 'react'
import {
  api,
  type RichMenuPayload,
  type RichMenuAreaPayload,
  type RichMenuAlias,
} from '@/lib/api'
import Header from '@/components/layout/header'

// ─── Size & layout presets ────────────────────────────────────────────────────

const SIZE_LARGE = { width: 2500, height: 1686 }

type LayoutGroup = 'official-large' | 'official-compact' | 'tab' | 'extended'

interface ProportionalBounds {
  x: number
  y: number
  w: number
  h: number
}

interface LayoutTemplate {
  key: string
  label: string
  group: LayoutGroup
  bounds: ProportionalBounds[]
}

/**
 * LINE 公式アカウントマネージャーの 12 プリセット（大7・小5）に加え、
 * Messaging API が許す範囲の拡張パターンも提供する。
 * ref: https://developers.line.biz/en/docs/messaging-api/using-rich-menus/
 *      https://www.lycbiz.com/jp/manual/OfficialAccountManager/rich-menus/
 */
const LAYOUT_TEMPLATES: LayoutTemplate[] = [
  // ── LINE 公式・大サイズ（推奨 2500×1686）7種 ──────────────
  { key: 'L1', label: '1分割（全面）', group: 'official-large',
    bounds: [{ x: 0, y: 0, w: 1, h: 1 }] },
  { key: 'L2-H', label: '2分割（上下）', group: 'official-large',
    bounds: [
      { x: 0, y: 0, w: 1, h: 1 / 2 },
      { x: 0, y: 1 / 2, w: 1, h: 1 / 2 },
    ] },
  { key: 'L2-V', label: '2分割（左右）', group: 'official-large',
    bounds: [
      { x: 0, y: 0, w: 1 / 2, h: 1 },
      { x: 1 / 2, y: 0, w: 1 / 2, h: 1 },
    ] },
  { key: 'L3-T1B2', label: '3分割（上1＋下2）', group: 'official-large',
    bounds: [
      { x: 0, y: 0, w: 1, h: 1 / 2 },
      { x: 0, y: 1 / 2, w: 1 / 2, h: 1 / 2 },
      { x: 1 / 2, y: 1 / 2, w: 1 / 2, h: 1 / 2 },
    ] },
  { key: 'L4-Grid', label: '4分割（2列×2行）', group: 'official-large',
    bounds: [
      { x: 0, y: 0, w: 1 / 2, h: 1 / 2 },
      { x: 1 / 2, y: 0, w: 1 / 2, h: 1 / 2 },
      { x: 0, y: 1 / 2, w: 1 / 2, h: 1 / 2 },
      { x: 1 / 2, y: 1 / 2, w: 1 / 2, h: 1 / 2 },
    ] },
  { key: 'L4-L1R3', label: '4分割（左1＋右3）', group: 'official-large',
    bounds: [
      { x: 0, y: 0, w: 1 / 2, h: 1 },
      { x: 1 / 2, y: 0, w: 1 / 2, h: 1 / 3 },
      { x: 1 / 2, y: 1 / 3, w: 1 / 2, h: 1 / 3 },
      { x: 1 / 2, y: 2 / 3, w: 1 / 2, h: 1 / 3 },
    ] },
  { key: 'L6', label: '6分割（3列×2行）', group: 'official-large',
    bounds: [
      { x: 0, y: 0, w: 1 / 3, h: 1 / 2 },
      { x: 1 / 3, y: 0, w: 1 / 3, h: 1 / 2 },
      { x: 2 / 3, y: 0, w: 1 / 3, h: 1 / 2 },
      { x: 0, y: 1 / 2, w: 1 / 3, h: 1 / 2 },
      { x: 1 / 3, y: 1 / 2, w: 1 / 3, h: 1 / 2 },
      { x: 2 / 3, y: 1 / 2, w: 1 / 3, h: 1 / 2 },
    ] },
  // ── LINE 公式・小サイズ（推奨 2500×843）5種 ────────────────
  { key: 'C1', label: '1分割（全面）', group: 'official-compact',
    bounds: [{ x: 0, y: 0, w: 1, h: 1 }] },
  { key: 'C2', label: '2分割（左右半々）', group: 'official-compact',
    bounds: [
      { x: 0, y: 0, w: 1 / 2, h: 1 },
      { x: 1 / 2, y: 0, w: 1 / 2, h: 1 },
    ] },
  { key: 'C2-L', label: '2分割（左大2:右小1）', group: 'official-compact',
    bounds: [
      { x: 0, y: 0, w: 2 / 3, h: 1 },
      { x: 2 / 3, y: 0, w: 1 / 3, h: 1 },
    ] },
  { key: 'C2-R', label: '2分割（左小1:右大2）', group: 'official-compact',
    bounds: [
      { x: 0, y: 0, w: 1 / 3, h: 1 },
      { x: 1 / 3, y: 0, w: 2 / 3, h: 1 },
    ] },
  { key: 'C3', label: '3分割（横3列）', group: 'official-compact',
    bounds: [
      { x: 0, y: 0, w: 1 / 3, h: 1 },
      { x: 1 / 3, y: 0, w: 1 / 3, h: 1 },
      { x: 2 / 3, y: 0, w: 1 / 3, h: 1 },
    ] },
  // ── 拡張（LINE Manager UIには無いが API は許容） ────────────
  { key: 'EX-3-V', label: '3分割（横3列）', group: 'extended',
    bounds: [
      { x: 0, y: 0, w: 1 / 3, h: 1 },
      { x: 1 / 3, y: 0, w: 1 / 3, h: 1 },
      { x: 2 / 3, y: 0, w: 1 / 3, h: 1 },
    ] },
  { key: 'EX-5-V', label: '5分割（横5列）', group: 'extended',
    bounds: Array.from({ length: 5 }, (_, i) => ({
      x: i / 5, y: 0, w: 1 / 5, h: 1,
    })) },
  { key: 'EX-5-L1R4', label: '5分割（左1＋右4）', group: 'extended',
    bounds: [
      { x: 0, y: 0, w: 1 / 2, h: 1 },
      { x: 1 / 2, y: 0, w: 1 / 2, h: 1 / 4 },
      { x: 1 / 2, y: 1 / 4, w: 1 / 2, h: 1 / 4 },
      { x: 1 / 2, y: 2 / 4, w: 1 / 2, h: 1 / 4 },
      { x: 1 / 2, y: 3 / 4, w: 1 / 2, h: 1 / 4 },
    ] },
  { key: 'EX-5-T1B4', label: '5分割（上1＋下4）', group: 'extended',
    bounds: [
      { x: 0, y: 0, w: 1, h: 1 / 2 },
      { x: 0, y: 1 / 2, w: 1 / 4, h: 1 / 2 },
      { x: 1 / 4, y: 1 / 2, w: 1 / 4, h: 1 / 2 },
      { x: 2 / 4, y: 1 / 2, w: 1 / 4, h: 1 / 2 },
      { x: 3 / 4, y: 1 / 2, w: 1 / 4, h: 1 / 2 },
    ] },
  { key: 'EX-8', label: '8分割（4列×2行）', group: 'extended',
    bounds: Array.from({ length: 8 }, (_, i) => ({
      x: (i % 4) / 4,
      y: Math.floor(i / 4) / 2,
      w: 1 / 4,
      h: 1 / 2,
    })) },
  { key: 'EX-9', label: '9分割（3列×3行）', group: 'extended',
    bounds: Array.from({ length: 9 }, (_, i) => ({
      x: (i % 3) / 3,
      y: Math.floor(i / 3) / 3,
      w: 1 / 3,
      h: 1 / 3,
    })) },
  // ── タブ切替式（上部にタブ行＋下部にコンテンツ）────────────────
  // タブ部分は上から 1/6 (約17%)。タップ時は通常 richmenuswitch アクションで別メニューに切替。
  { key: 'TAB2-L1', label: '上タブ2 ＋ 1分割', group: 'tab',
    bounds: [
      { x: 0,   y: 0,     w: 1 / 2, h: 1 / 6 },
      { x: 1/2, y: 0,     w: 1 / 2, h: 1 / 6 },
      { x: 0,   y: 1 / 6, w: 1,     h: 5 / 6 },
    ] },
  { key: 'TAB2-L2-V', label: '上タブ2 ＋ 2分割（左右）', group: 'tab',
    bounds: [
      { x: 0,   y: 0,     w: 1 / 2, h: 1 / 6 },
      { x: 1/2, y: 0,     w: 1 / 2, h: 1 / 6 },
      { x: 0,   y: 1 / 6, w: 1 / 2, h: 5 / 6 },
      { x: 1/2, y: 1 / 6, w: 1 / 2, h: 5 / 6 },
    ] },
  { key: 'TAB2-L4-Grid', label: '上タブ2 ＋ 4分割（2×2）', group: 'tab',
    bounds: [
      { x: 0,   y: 0,     w: 1 / 2, h: 1 / 6 },
      { x: 1/2, y: 0,     w: 1 / 2, h: 1 / 6 },
      { x: 0,   y: 1 / 6, w: 1 / 2, h: 5 / 12 },
      { x: 1/2, y: 1 / 6, w: 1 / 2, h: 5 / 12 },
      { x: 0,   y: 7 / 12, w: 1 / 2, h: 5 / 12 },
      { x: 1/2, y: 7 / 12, w: 1 / 2, h: 5 / 12 },
    ] },
  { key: 'TAB2-L4-L1R3', label: '上タブ2 ＋ 4分割（左1+右3）', group: 'tab',
    bounds: [
      { x: 0,   y: 0,     w: 1 / 2, h: 1 / 6 },
      { x: 1/2, y: 0,     w: 1 / 2, h: 1 / 6 },
      { x: 0,   y: 1 / 6, w: 1 / 2, h: 5 / 6 },
      { x: 1/2, y: 1 / 6, w: 1 / 2, h: 5 / 18 },
      { x: 1/2, y: 1 / 6 + 5 / 18, w: 1 / 2, h: 5 / 18 },
      { x: 1/2, y: 1 / 6 + 10 / 18, w: 1 / 2, h: 5 / 18 },
    ] },
  { key: 'TAB2-L6', label: '上タブ2 ＋ 6分割（3×2）', group: 'tab',
    bounds: [
      { x: 0,   y: 0,     w: 1 / 2, h: 1 / 6 },
      { x: 1/2, y: 0,     w: 1 / 2, h: 1 / 6 },
      ...Array.from({ length: 6 }, (_, i) => ({
        x: (i % 3) / 3,
        y: 1 / 6 + Math.floor(i / 3) * (5 / 12),
        w: 1 / 3,
        h: 5 / 12,
      })),
    ] },
  { key: 'TAB3-L6', label: '上タブ3 ＋ 6分割（3×2）', group: 'tab',
    bounds: [
      { x: 0,   y: 0,     w: 1 / 3, h: 1 / 6 },
      { x: 1/3, y: 0,     w: 1 / 3, h: 1 / 6 },
      { x: 2/3, y: 0,     w: 1 / 3, h: 1 / 6 },
      ...Array.from({ length: 6 }, (_, i) => ({
        x: (i % 3) / 3,
        y: 1 / 6 + Math.floor(i / 3) * (5 / 12),
        w: 1 / 3,
        h: 5 / 12,
      })),
    ] },
]

const LAYOUT_BY_KEY: Record<string, LayoutTemplate> = Object.fromEntries(
  LAYOUT_TEMPLATES.map((l) => [l.key, l]),
)

function buildAreas(
  layoutKey: string,
  size: { width: number; height: number },
): RichMenuAreaPayload[] {
  const layout = LAYOUT_BY_KEY[layoutKey]
  if (!layout) return []
  return layout.bounds.map((b, i) => ({
    bounds: {
      x: Math.round(b.x * size.width),
      y: Math.round(b.y * size.height),
      width: Math.round(b.w * size.width),
      height: Math.round(b.h * size.height),
    },
    action: { type: 'uri', uri: 'https://example.com', label: `エリア${i + 1}` },
  }))
}

/** Pick a sensible default layout from an uploaded image's dimensions. */
function suggestLayout(width: number, height: number): string {
  // wide+short images → compact 3-split; otherwise → large 6-split
  return width / height > 2.2 ? 'C3' : 'L6'
}

/** Validate against LINE rich menu image constraints. */
function checkImageConstraints(width: number, height: number): string | null {
  if (width < 800 || width > 2500) {
    return `画像の幅は800〜2500pxの範囲が必要です（現在 ${width}px）`
  }
  if (height < 250 || height > 1686) {
    return `画像の高さは250〜1686pxの範囲が必要です（現在 ${height}px）`
  }
  if (width / height < 1.45) {
    return `画像の縦横比は 1.45:1 以上が必要です（現在 ${(width / height).toFixed(2)}:1）`
  }
  return null
}

// ─── Components ───────────────────────────────────────────────────────────────

function RichMenuImage({ id }: { id: string }) {
  const [src, setSrc] = useState<string | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    let cancelled = false
    let url: string | null = null
    api.richMenus
      .imageObjectUrl(id)
      .then((u) => {
        if (cancelled) {
          URL.revokeObjectURL(u)
          return
        }
        url = u
        setSrc(u)
      })
      .catch(() => !cancelled && setError(true))
    return () => {
      cancelled = true
      if (url) URL.revokeObjectURL(url)
    }
  }, [id])

  if (error) {
    return (
      <div className="w-full aspect-[2500/1686] flex items-center justify-center bg-gray-100 text-xs text-gray-400 rounded">
        画像未登録
      </div>
    )
  }
  if (!src) {
    return <div className="w-full aspect-[2500/1686] bg-gray-100 animate-pulse rounded" />
  }
  return <img src={src} alt="rich menu" className="w-full rounded border border-gray-200 bg-gray-50" />
}

interface VisualAreaEditorProps {
  imageDataUrl: string
  imageContentType: 'image/png' | 'image/jpeg'
  size: { width: number; height: number }
  areas: RichMenuAreaPayload[]
  selectedIndex: number | null
  onSelect: (index: number) => void
}

/**
 * Renders the uploaded image with each area drawn as a numbered, clickable
 * rectangle overlay. Coordinates are in LINE's logical pixel space (e.g. 2500×1686);
 * we render them as percentages of the displayed image size.
 */
function VisualAreaEditor({ imageDataUrl, imageContentType, size, areas, selectedIndex, onSelect }: VisualAreaEditorProps) {
  return (
    <div className="relative w-full select-none" style={{ aspectRatio: `${size.width} / ${size.height}` }}>
      <img
        src={`data:${imageContentType};base64,${imageDataUrl}`}
        alt="rich menu"
        className="absolute inset-0 w-full h-full object-cover rounded border border-gray-200"
      />
      {areas.map((area, i) => {
        const left = (area.bounds.x / size.width) * 100
        const top = (area.bounds.y / size.height) * 100
        const w = (area.bounds.width / size.width) * 100
        const h = (area.bounds.height / size.height) * 100
        const selected = i === selectedIndex
        return (
          <button
            key={i}
            type="button"
            onClick={() => onSelect(i)}
            className={`absolute flex items-center justify-center text-white font-bold transition-all ${
              selected ? 'ring-2 ring-white' : 'hover:bg-black/10'
            }`}
            style={{
              left: `${left}%`,
              top: `${top}%`,
              width: `${w}%`,
              height: `${h}%`,
              backgroundColor: selected ? 'rgba(6, 199, 85, 0.45)' : 'rgba(6, 199, 85, 0.18)',
              border: '2px solid rgba(6, 199, 85, 0.95)',
              boxShadow: selected ? '0 0 0 2px rgba(255,255,255,0.6) inset' : 'none',
            }}
            aria-label={`エリア${i + 1}を編集`}
          >
            <span
              className="px-2 py-0.5 rounded-full text-xs"
              style={{
                backgroundColor: selected ? '#06C755' : 'rgba(255,255,255,0.85)',
                color: selected ? '#FFFFFF' : '#06C755',
              }}
            >
              {i + 1}
            </span>
          </button>
        )
      })}
    </div>
  )
}

interface AreaActionPanelProps {
  index: number
  area: RichMenuAreaPayload
  aliases: RichMenuAlias[]
  onChange: (next: RichMenuAreaPayload) => void
  onClose: () => void
}

function AreaActionPanel({ index, area, aliases, onChange, onClose }: AreaActionPanelProps) {
  const action = area.action
  const setActionType = (type: 'uri' | 'message' | 'postback' | 'richmenuswitch') => {
    if (type === 'uri')
      onChange({ ...area, action: { type: 'uri', uri: '', label: action.label } })
    else if (type === 'message')
      onChange({ ...area, action: { type: 'message', text: '', label: action.label } })
    else if (type === 'postback')
      onChange({ ...area, action: { type: 'postback', data: '', displayText: '', label: action.label } })
    else
      onChange({
        ...area,
        action: {
          type: 'richmenuswitch',
          richMenuAliasId: '',
          data: 'switch',
          label: action.label,
        },
      })
  }

  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-4 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-gray-800">エリア {index + 1} の動作</p>
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-gray-600 transition-colors"
          aria-label="閉じる"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div>
        <label className="block text-[11px] text-gray-500 mb-0.5">ラベル（管理用）</label>
        <input
          type="text"
          className="w-full border border-gray-300 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-green-500"
          value={action.label ?? ''}
          onChange={(e) => onChange({ ...area, action: { ...action, label: e.target.value } })}
        />
      </div>

      <div>
        <label className="block text-[11px] text-gray-500 mb-1">タップ時の動作</label>
        <div className="grid grid-cols-2 gap-1">
          {([
            { value: 'uri', label: 'リンクを開く' },
            { value: 'message', label: 'メッセージ送信' },
            { value: 'postback', label: 'ポストバック' },
            { value: 'richmenuswitch', label: 'メニュー切替（タブ）' },
          ] as const).map((opt) => {
            const active =
              action.type === opt.value ||
              (opt.value === 'uri' && !['uri', 'message', 'postback', 'richmenuswitch'].includes(action.type))
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => setActionType(opt.value)}
                className={`px-2 py-1.5 text-[11px] rounded border transition-colors ${
                  active
                    ? 'text-white border-green-600'
                    : 'text-gray-700 bg-white border-gray-200 hover:bg-gray-50'
                }`}
                style={active ? { backgroundColor: '#06C755' } : {}}
              >
                {opt.label}
              </button>
            )
          })}
        </div>
      </div>

      {action.type === 'uri' && (
        <div>
          <label className="block text-[11px] text-gray-500 mb-0.5">URL</label>
          <input
            type="url"
            placeholder="https://example.com"
            className="w-full border border-gray-300 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-green-500"
            value={action.uri}
            onChange={(e) => onChange({ ...area, action: { ...action, uri: e.target.value } })}
          />
        </div>
      )}
      {action.type === 'message' && (
        <div>
          <label className="block text-[11px] text-gray-500 mb-0.5">送信メッセージ</label>
          <input
            type="text"
            className="w-full border border-gray-300 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-green-500"
            value={action.text}
            onChange={(e) => onChange({ ...area, action: { ...action, text: e.target.value } })}
          />
        </div>
      )}
      {action.type === 'postback' && (
        <div className="space-y-2">
          <div>
            <label className="block text-[11px] text-gray-500 mb-0.5">data</label>
            <input
              type="text"
              className="w-full border border-gray-300 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-green-500"
              value={action.data}
              onChange={(e) => onChange({ ...area, action: { ...action, data: e.target.value } })}
            />
          </div>
          <div>
            <label className="block text-[11px] text-gray-500 mb-0.5">表示テキスト</label>
            <input
              type="text"
              className="w-full border border-gray-300 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-green-500"
              value={action.displayText ?? ''}
              onChange={(e) => onChange({ ...area, action: { ...action, displayText: e.target.value } })}
            />
          </div>
        </div>
      )}
      {action.type === 'richmenuswitch' && (
        <div className="space-y-2">
          <div>
            <label className="block text-[11px] text-gray-500 mb-0.5">タップ時に切り替わるメニュー</label>
            {aliases.length > 0 ? (
              <select
                className="w-full border border-gray-300 rounded px-2 py-1.5 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-green-500"
                value={action.richMenuAliasId}
                onChange={(e) =>
                  onChange({ ...area, action: { ...action, richMenuAliasId: e.target.value } })
                }
              >
                <option value="">— 切替先を選択 —</option>
                {aliases.map((a) => (
                  <option key={a.richMenuAliasId} value={a.richMenuAliasId}>
                    {a.richMenuAliasId}
                  </option>
                ))}
              </select>
            ) : (
              <>
                <input
                  type="text"
                  placeholder="例: news-tab"
                  className="w-full border border-gray-300 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-green-500"
                  value={action.richMenuAliasId}
                  onChange={(e) =>
                    onChange({ ...area, action: { ...action, richMenuAliasId: e.target.value } })
                  }
                />
                <p className="mt-0.5 text-[10px] text-amber-600">
                  ⚠ 切替先がまだ登録されていません。ページ下の「タブ切替先の登録」から先に作成してください。
                </p>
              </>
            )}
          </div>
          <div>
            <label className="block text-[11px] text-gray-500 mb-0.5">data（任意）</label>
            <input
              type="text"
              className="w-full border border-gray-300 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-green-500"
              value={action.data}
              onChange={(e) => onChange({ ...area, action: { ...action, data: e.target.value } })}
            />
          </div>
        </div>
      )}
    </div>
  )
}

interface DropZoneProps {
  onFile: (file: File) => void
}

function DropZone({ onFile }: DropZoneProps) {
  const [hover, setHover] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setHover(false)
    const file = e.dataTransfer.files?.[0]
    if (file) onFile(file)
  }

  return (
    <div
      onClick={() => inputRef.current?.click()}
      onDragOver={(e) => {
        e.preventDefault()
        setHover(true)
      }}
      onDragLeave={() => setHover(false)}
      onDrop={handleDrop}
      className={`border-2 border-dashed rounded-lg p-12 text-center cursor-pointer transition-colors ${
        hover ? 'border-green-500 bg-green-50' : 'border-gray-300 hover:border-gray-400 bg-gray-50'
      }`}
    >
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) onFile(f)
        }}
      />
      <svg className="w-10 h-10 mx-auto text-gray-400 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
      </svg>
      <p className="text-sm font-medium text-gray-700">画像をここにドロップ</p>
      <p className="text-xs text-gray-400 mt-1">またはクリックしてファイルを選択（PNG / JPEG）</p>
      <p className="text-[11px] text-gray-400 mt-3">
        推奨: 2500×1686（大）または 2500×843（小）<br />
        必須: 幅 800〜2500 / 高さ 250〜1686 / 縦横比 1.45:1 以上
      </p>
    </div>
  )
}

/** Tiny mock of LINE's chat bar so users can preview the chatBarText live. */
function ChatBarPreview({ text }: { text: string }) {
  return (
    <div className="mt-1.5 rounded-md border border-gray-200 bg-white overflow-hidden">
      <div className="px-3 py-1.5 bg-gradient-to-b from-gray-50 to-gray-100 flex items-center justify-center gap-1.5 text-xs text-gray-700">
        <span className="truncate max-w-[140px]">{text || ' '}</span>
        <svg className="w-3 h-3 text-gray-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 15l7-7 7 7" />
        </svg>
      </div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

interface CreateForm {
  name: string
  chatBarText: string
  layout: string
  selected: boolean
  areas: RichMenuAreaPayload[]
  imageBase64: string | null
  imageContentType: 'image/png' | 'image/jpeg'
  imageWidth: number | null
  imageHeight: number | null
  imageWarning: string | null
}

const initialForm: CreateForm = {
  name: '',
  chatBarText: 'メニュー',
  layout: 'L6',
  selected: true,
  areas: buildAreas('L6', SIZE_LARGE),
  imageBase64: null,
  imageContentType: 'image/png',
  imageWidth: null,
  imageHeight: null,
  imageWarning: null,
}

export default function RichMenusPage() {
  const [menus, setMenus] = useState<RichMenuPayload[]>([])
  const [defaultId, setDefaultId] = useState<string | null>(null)
  const [aliases, setAliases] = useState<RichMenuAlias[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm] = useState<CreateForm>(initialForm)
  const [selectedAreaIndex, setSelectedAreaIndex] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [busyMenuId, setBusyMenuId] = useState<string | null>(null)
  const [duplicating, setDuplicating] = useState<string | null>(null)
  // editingId が入っていれば「編集モード」（保存時に旧メニューを置き換え）。null なら新規。
  const [editingId, setEditingId] = useState<string | null>(null)
  // 編集モード時、旧メニューを指していた alias を新メニューに自動で引き継ぐかどうか。
  // 通常のタブ切替式メニュー編集（画像差し替え等）では true が正しい挙動。
  // 「タブ切替先の登録」セクションで河原さんが alias の中身を意図的に別メニューへ
  // 付け替えた直後にこのメニューを編集して保存すると、引き継ぎが付け替え結果を
  // 上書きしてしまう（巻き戻り）。それを防ぐためにチェックを外せるようにしている。
  const [inheritAliases, setInheritAliases] = useState(true)

  const [showAliasForm, setShowAliasForm] = useState(false)
  const [aliasForm, setAliasForm] = useState<{ richMenuAliasId: string; richMenuId: string }>({
    richMenuAliasId: '',
    richMenuId: '',
  })
  const [aliasError, setAliasError] = useState('')
  const [aliasSaving, setAliasSaving] = useState(false)
  const [pendingAliases, setPendingAliases] = useState<Record<string, string>>({})
  const [savingAliasIds, setSavingAliasIds] = useState<Set<string>>(new Set())
  const [aliasRowErrors, setAliasRowErrors] = useState<Record<string, string>>({})

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [list, def, aliasList] = await Promise.all([
        api.richMenus.list(),
        api.richMenus.getDefault(),
        api.richMenuAliases.list(),
      ])
      if (list.success) setMenus(list.data)
      else setError(list.error)
      if (def.success) setDefaultId(def.data.richMenuId ?? null)
      if (aliasList.success) setAliases(aliasList.data)
    } catch {
      setError('リッチメニューの読み込みに失敗しました')
    } finally {
      setLoading(false)
    }
  }, [])

  const handleCreateAlias = async () => {
    if (!aliasForm.richMenuAliasId.trim()) return setAliasError('呼び名を入力してください')
    if (!/^[A-Za-z0-9_-]+$/.test(aliasForm.richMenuAliasId)) {
      return setAliasError('呼び名は半角英数字・ハイフン・アンダースコアのみ使用できます')
    }
    if (!aliasForm.richMenuId) return setAliasError('飛び先のメニューを選択してください')
    setAliasSaving(true)
    setAliasError('')
    try {
      const res = await api.richMenuAliases.create(aliasForm)
      if (!res.success) {
        setAliasError(res.error)
        return
      }
      setShowAliasForm(false)
      setAliasForm({ richMenuAliasId: '', richMenuId: '' })
      await load()
    } catch (err) {
      setAliasError(err instanceof Error ? err.message : '作成に失敗しました')
    } finally {
      setAliasSaving(false)
    }
  }

  const handleAliasDraftChange = (aliasId: string, richMenuId: string, currentSaved: string) => {
    setAliasRowErrors((prev) => {
      if (!prev[aliasId]) return prev
      const next = { ...prev }
      delete next[aliasId]
      return next
    })
    setPendingAliases((prev) => {
      const next = { ...prev }
      if (richMenuId === currentSaved) delete next[aliasId]
      else next[aliasId] = richMenuId
      return next
    })
  }

  const handleSaveAlias = async (aliasId: string) => {
    const richMenuId = pendingAliases[aliasId]
    if (!richMenuId) return
    setSavingAliasIds((prev) => {
      const next = new Set(prev)
      next.add(aliasId)
      return next
    })
    setAliasRowErrors((prev) => {
      if (!prev[aliasId]) return prev
      const next = { ...prev }
      delete next[aliasId]
      return next
    })
    try {
      const res = await api.richMenuAliases.update(aliasId, richMenuId)
      if (!res.success) {
        setAliasRowErrors((prev) => ({ ...prev, [aliasId]: res.error || '保存に失敗しました' }))
        return
      }
      setPendingAliases((prev) => {
        const next = { ...prev }
        delete next[aliasId]
        return next
      })
      await load()
    } catch {
      setAliasRowErrors((prev) => ({ ...prev, [aliasId]: '切替先の更新に失敗しました' }))
    } finally {
      setSavingAliasIds((prev) => {
        const next = new Set(prev)
        next.delete(aliasId)
        return next
      })
    }
  }

  const handleResetAliasDraft = (aliasId: string) => {
    setPendingAliases((prev) => {
      if (!(aliasId in prev)) return prev
      const next = { ...prev }
      delete next[aliasId]
      return next
    })
    setAliasRowErrors((prev) => {
      if (!prev[aliasId]) return prev
      const next = { ...prev }
      delete next[aliasId]
      return next
    })
  }

  const handleDeleteAlias = async (aliasId: string) => {
    if (!confirm(
      `切替先「${aliasId}」を本当に削除しますか？\n\n` +
      `⚠️ 多くの場合これは不要です。\n` +
      `「飛び先を変えたいだけ」なら、削除せずプルダウンから別メニューを選んで「保存」を押してください。\n\n` +
      `削除して別IDで作り直すと、メニュー側に仕込まれた呼び名（aliasId）とズレてタブ切替が動かなくなります。\n\n` +
      `それでも削除しますか？`
    )) return
    try {
      const res = await api.richMenuAliases.delete(aliasId)
      if (!res.success) setError(res.error)
      else await load()
    } catch {
      setError('切替先の削除に失敗しました')
    }
  }

  useEffect(() => {
    load()
  }, [load])

  const updateLayout = (layout: string) => {
    setForm((f) => {
      const size =
        f.imageWidth && f.imageHeight
          ? { width: f.imageWidth, height: f.imageHeight }
          : SIZE_LARGE
      return { ...f, layout, areas: buildAreas(layout, size) }
    })
    setSelectedAreaIndex(null)
  }

  const updateArea = (index: number, next: RichMenuAreaPayload) => {
    setForm((f) => ({ ...f, areas: f.areas.map((a, i) => (i === index ? next : a)) }))
  }

  const handleImageFile = (file: File) => {
    if (!['image/png', 'image/jpeg'].includes(file.type)) {
      setFormError('画像はPNGまたはJPEGのみ使用できます')
      return
    }
    setFormError('')
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      const base64 = result.replace(/^data:image\/\w+;base64,/, '')
      const img = new Image()
      img.onload = () => {
        const constraintError = checkImageConstraints(img.width, img.height)
        if (constraintError) {
          setFormError(constraintError)
          return
        }
        const layout = suggestLayout(img.width, img.height)
        const size = { width: img.width, height: img.height }
        setForm((f) => ({
          ...f,
          imageBase64: base64,
          imageContentType: file.type === 'image/jpeg' ? 'image/jpeg' : 'image/png',
          imageWidth: img.width,
          imageHeight: img.height,
          imageWarning: null,
          layout,
          areas: buildAreas(layout, size),
        }))
        setSelectedAreaIndex(null)
      }
      img.src = result
    }
    reader.readAsDataURL(file)
  }

  const removeImage = () => {
    setForm((f) => ({
      ...f,
      imageBase64: null,
      imageWidth: null,
      imageHeight: null,
      imageWarning: null,
    }))
    setSelectedAreaIndex(null)
  }

  const validateAreas = (areas: RichMenuAreaPayload[]): string | null => {
    for (let i = 0; i < areas.length; i++) {
      const a = areas[i].action
      if (a.type === 'uri' && !/^https?:\/\//.test(a.uri)) {
        return `エリア${i + 1}: URLは http:// または https:// で始まる必要があります`
      }
      if (a.type === 'message' && !a.text.trim()) {
        return `エリア${i + 1}: 送信メッセージを入力してください`
      }
      if (a.type === 'postback' && !a.data.trim()) {
        return `エリア${i + 1}: postback data を入力してください`
      }
      if (a.type === 'richmenuswitch' && !a.richMenuAliasId.trim()) {
        return `エリア${i + 1}: タップ時に切り替わるメニューを選択してください`
      }
    }
    return null
  }

  const openCreate = () => {
    setForm(initialForm)
    setSelectedAreaIndex(null)
    setFormError('')
    setEditingId(null)
    setInheritAliases(true)
    setShowCreate(true)
  }

  // 既存リッチメニューを「そのまま編集」する。
  // LINE仕様上は richMenu は不変なので、保存時に内部で「新規作成→紐付け切替→旧削除」を行う。
  const handleEdit = async (menu: RichMenuPayload) => {
    const id = menu.richMenuId
    if (!id) return
    setDuplicating(id) // 同じローディング表示を再利用
    setError('')
    try {
      const { base64, contentType } = await api.richMenus.imageBase64(id)
      const layoutKey = inferLayoutFromAreas(menu)
      setForm({
        name: menu.name,
        chatBarText: menu.chatBarText,
        layout: layoutKey,
        selected: defaultId === id, // 元がデフォルトなら維持
        areas: menu.areas.map((a) => ({ ...a, action: { ...a.action } })),
        imageBase64: base64,
        imageContentType: contentType,
        imageWidth: menu.size.width,
        imageHeight: menu.size.height,
        imageWarning: null,
      })
      setSelectedAreaIndex(null)
      setFormError('')
      setEditingId(id) // ← 編集モード
      setInheritAliases(true) // 既定ON（普通のタブ付きメニュー編集はこれが正しい）
      setShowCreate(true)
    } catch (err) {
      setError(`編集の読み込みに失敗しました: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setDuplicating(null)
    }
  }

  const handleDuplicate = async (menu: RichMenuPayload) => {
    const id = menu.richMenuId
    if (!id) return
    setDuplicating(id)
    setError('')
    try {
      const { base64, contentType } = await api.richMenus.imageBase64(id)
      const layoutKey = inferLayoutFromAreas(menu)
      setForm({
        name: `${menu.name} のコピー`,
        chatBarText: menu.chatBarText,
        layout: layoutKey,
        selected: false,
        areas: menu.areas.map((a) => ({ ...a, action: { ...a.action } })),
        imageBase64: base64,
        imageContentType: contentType,
        imageWidth: menu.size.width,
        imageHeight: menu.size.height,
        imageWarning: null,
      })
      setSelectedAreaIndex(null)
      setFormError('')
      setEditingId(null) // ← 複製は新規扱い
      setInheritAliases(true)
      setShowCreate(true)
    } catch (err) {
      setError(`複製に失敗しました: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setDuplicating(null)
    }
  }

  const handleCreate = async () => {
    if (!form.name.trim()) return setFormError('名前を入力してください')
    if (!form.chatBarText.trim()) return setFormError('チャットバーのテキストを入力してください')
    if (form.chatBarText.length > 14) return setFormError('チャットバーのテキストは14文字以内です')
    if (!form.imageBase64) return setFormError('画像をアップロードしてください')
    const areaError = validateAreas(form.areas)
    if (areaError) return setFormError(areaError)

    setSaving(true)
    setFormError('')
    try {
      const size =
        form.imageWidth && form.imageHeight
          ? { width: form.imageWidth, height: form.imageHeight }
          : SIZE_LARGE
      const payload: RichMenuPayload = {
        size,
        selected: form.selected,
        name: form.name,
        chatBarText: form.chatBarText,
        areas: form.areas,
      }
      const created = await api.richMenus.create(payload)
      if (!created.success) {
        setFormError(created.error)
        return
      }
      const richMenuId = created.data.richMenuId
      const upload = await api.richMenus.uploadImage(richMenuId, form.imageBase64, form.imageContentType)
      if (!upload.success) {
        setFormError(`作成は成功しましたが画像アップロードに失敗: ${upload.error}`)
        return
      }
      // 編集モード時: 旧メニューに紐付いていた alias を新IDへ付け替え + デフォルトの引継ぎ + 旧削除
      if (editingId) {
        // 1. alias の付け替え（旧IDを指していたエイリアスを全部新IDに更新）
        //    安全策2点：
        //    (A) 画面のローカル aliases ではなく、保存直前にLINE側の最新を取り直してから判定。
        //        別タブで「タブ切替先の登録」を変更されていても、その変更を上書きしない。
        //    (C) inheritAliases=false なら付け替え自体をスキップ（ユーザーが明示的にOFFにした場合）。
        if (inheritAliases) {
          const latestAliasList = await api.richMenuAliases.list()
          if (!latestAliasList.success) {
            setFormError(`タブ切替先の最新状態を取得できませんでした: ${latestAliasList.error}`)
            return
          }
          const targetAliases = latestAliasList.data.filter((a) => a.richMenuId === editingId)
          for (const a of targetAliases) {
            const upd = await api.richMenuAliases.update(a.richMenuAliasId, richMenuId)
            if (!upd.success) {
              setFormError(`タブ切替先「${a.richMenuAliasId}」の付け替えに失敗: ${upd.error}`)
              return
            }
          }
        }
        // 2. デフォルト切替（元がデフォルトで、フォームでもselected=true なら新IDをデフォルトに）
        const wasDefault = defaultId === editingId
        if (form.selected || wasDefault) {
          const setDef = await api.richMenus.setDefault(richMenuId)
          if (!setDef.success) {
            setFormError(`画像登録は成功しましたが既定設定に失敗: ${setDef.error}`)
            return
          }
        }
        // 3. 旧メニュー削除（失敗してもUIは進める：エラーは表示のみ）
        try {
          await api.richMenus.delete(editingId)
        } catch (e) {
          setError(`旧メニューの削除に失敗（手動で削除してください）: ${e instanceof Error ? e.message : String(e)}`)
        }
      } else if (form.selected) {
        // 新規モードかつ selected=true
        const setDef = await api.richMenus.setDefault(richMenuId)
        if (!setDef.success) {
          setFormError(`画像登録は成功しましたが既定設定に失敗: ${setDef.error}`)
          return
        }
      }
      setShowCreate(false)
      setForm(initialForm)
      setEditingId(null)
      await load()
    } catch (err) {
      setFormError(err instanceof Error ? err.message : (editingId ? '更新に失敗しました' : '作成に失敗しました'))
    } finally {
      setSaving(false)
    }
  }

  const handleSetDefault = async (id: string) => {
    setBusyMenuId(id)
    try {
      const res = await api.richMenus.setDefault(id)
      if (!res.success) setError(res.error)
      else await load()
    } catch {
      setError('既定設定に失敗しました')
    } finally {
      setBusyMenuId(null)
    }
  }

  const handleClearDefault = async () => {
    if (!confirm('デフォルトのリッチメニューを解除しますか？')) return
    setBusyMenuId('__clear__')
    try {
      const res = await api.richMenus.clearDefault()
      if (!res.success) setError(res.error)
      else await load()
    } catch {
      setError('既定解除に失敗しました')
    } finally {
      setBusyMenuId(null)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('このリッチメニューを削除しますか？\n（LINE側からも削除されます）')) return
    setBusyMenuId(id)
    try {
      const res = await api.richMenus.delete(id)
      if (!res.success) setError(res.error)
      else await load()
    } catch {
      setError('削除に失敗しました')
    } finally {
      setBusyMenuId(null)
    }
  }

  const previewSize =
    form.imageWidth && form.imageHeight
      ? { width: form.imageWidth, height: form.imageHeight }
      : SIZE_LARGE
  const layoutGroups: Array<{ label: string; group: LayoutGroup }> = [
    { label: 'LINE公式・大サイズ（最大6エリア）', group: 'official-large' },
    { label: 'LINE公式・小サイズ（最大3エリア）', group: 'official-compact' },
    { label: 'タブ切替式（上部タブ＋コンテンツ）', group: 'tab' },
    { label: '拡張（API互換・5分割など）', group: 'extended' },
  ]

  return (
    <div>
      <Header
        title="リッチメニュー"
        description="LINE公式アカウントのリッチメニューを作成・管理します。"
        action={
          <button
            onClick={openCreate}
            className="px-4 py-2 text-sm font-medium text-white rounded-lg transition-opacity hover:opacity-90"
            style={{ backgroundColor: '#06C755' }}
          >
            + 新規作成
          </button>
        }
      />

      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{error}</div>
      )}

      {/* Default state banner */}
      {!loading && (
        <div className="mb-6 px-4 py-3 bg-white border border-gray-200 rounded-lg flex items-center justify-between">
          <div className="text-sm">
            {defaultId ? (
              <span className="text-gray-700">
                現在のデフォルト: <code className="text-xs bg-gray-100 px-2 py-0.5 rounded">{defaultId}</code>
              </span>
            ) : (
              <span className="text-gray-500">デフォルトのリッチメニューは設定されていません。</span>
            )}
          </div>
          {defaultId && (
            <button
              onClick={handleClearDefault}
              disabled={busyMenuId === '__clear__'}
              className="px-3 py-1.5 text-xs font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-md transition-colors disabled:opacity-50"
            >
              デフォルト解除
            </button>
          )}
        </div>
      )}

      {/* Rich menu aliases */}
      {!loading && (
        <div className="mb-6 bg-white border border-gray-200 rounded-lg p-4">
          <div className="flex items-start justify-between gap-2 mb-3">
            <div>
              <h2 className="text-sm font-semibold text-gray-800">タブ切替先の登録</h2>
              <p className="text-[11px] text-gray-500 mt-0.5">
                タブをタップしたときの飛び先メニューに「呼び名」を付けて登録します。<br />
                呼び名はそのままで中身（実際のメニュー）を後から差し替えられるので、デザインを変えても他の設定を直す必要がありません。
              </p>
            </div>
            <button
              onClick={() => {
                // 飛び先は意図的に空にする。menus[0] をデフォルトにすると、呼び名だけ入力して
                // 飛び先を選び忘れた人が「メニュー一覧の先頭」を勝手に紐付けてしまい、
                // 「気付かないうちに別メニューに飛ぶ alias を作っていた」事故が起きる。
                setAliasForm({ richMenuAliasId: '', richMenuId: '' })
                setAliasError('')
                setShowAliasForm(true)
              }}
              className="shrink-0 px-3 py-1.5 text-xs font-medium text-white rounded-md transition-opacity hover:opacity-90"
              style={{ backgroundColor: '#06C755' }}
            >
              + 切替先を追加
            </button>
          </div>

          {showAliasForm && (
            <div className="mb-3 p-3 bg-gray-50 border border-gray-200 rounded-md space-y-2">
              <div className="p-2 bg-amber-50 border border-amber-200 rounded text-[11px] text-amber-900 leading-relaxed">
                <strong>⚠ 既存の切替先を変えたいだけなら、ここで新規作成しないでください。</strong><br />
                下のリストでプルダウンを変えて「保存」を押せば中身だけ差し替えられます。新規作成→旧削除をすると、メニュー側に仕込んだ「呼び名（aliasId）」とズレてタブ切替が動かなくなります。
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div>
                  <label className="block text-[11px] text-gray-600 mb-0.5">呼び名（半角英数字）</label>
                  <input
                    type="text"
                    placeholder="例: tab-news"
                    className="w-full border border-gray-300 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-green-500"
                    value={aliasForm.richMenuAliasId}
                    onChange={(e) =>
                      setAliasForm((f) => ({ ...f, richMenuAliasId: e.target.value }))
                    }
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-gray-600 mb-0.5">飛び先のメニュー</label>
                  <select
                    className="w-full border border-gray-300 rounded px-2 py-1.5 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-green-500"
                    value={aliasForm.richMenuId}
                    onChange={(e) => setAliasForm((f) => ({ ...f, richMenuId: e.target.value }))}
                  >
                    <option value="">— メニューを選択 —</option>
                    {menus.map((m) => (
                      <option key={m.richMenuId} value={m.richMenuId}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              {aliasError && <p className="text-[11px] text-red-600">{aliasError}</p>}
              <div className="flex gap-2">
                <button
                  onClick={handleCreateAlias}
                  disabled={aliasSaving}
                  className="px-3 py-1.5 text-xs font-medium text-white rounded-md disabled:opacity-50"
                  style={{ backgroundColor: '#06C755' }}
                >
                  {aliasSaving ? '作成中...' : '作成'}
                </button>
                <button
                  onClick={() => {
                    setShowAliasForm(false)
                    setAliasError('')
                  }}
                  className="px-3 py-1.5 text-xs font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-md"
                >
                  キャンセル
                </button>
              </div>
            </div>
          )}

          {aliases.length === 0 ? (
            <p className="text-xs text-gray-400 py-2">
              切替先はまだ登録されていません。
              {menus.length > 0
                ? 'タブ切替式メニューを使う場合は、タブで切り替えたいメニューを作成してから、上の「+ 切替先を追加」で呼び名（例: tab-news）を付けてください。'
                : ''}
            </p>
          ) : (
            <div className="space-y-1">
              {aliases.map((a) => {
                const draft = pendingAliases[a.richMenuAliasId]
                const currentValue = draft ?? a.richMenuId
                const isDirty = draft !== undefined && draft !== a.richMenuId
                const isSaving = savingAliasIds.has(a.richMenuAliasId)
                const rowError = aliasRowErrors[a.richMenuAliasId]
                const linkedMenu = menus.find((m) => m.richMenuId === currentValue)
                return (
                  <div key={a.richMenuAliasId} className="space-y-1">
                    <div
                      className={`flex items-center gap-3 px-3 py-2 rounded text-xs ${
                        isDirty ? 'bg-amber-50 ring-1 ring-amber-200' : 'bg-gray-50'
                      }`}
                    >
                      <code className="font-mono font-medium text-gray-800 shrink-0">
                        {a.richMenuAliasId}
                      </code>
                      <span className="text-gray-400 shrink-0">→</span>
                      <select
                        className="flex-1 min-w-0 border border-gray-200 rounded px-2 py-1 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-green-500 disabled:bg-gray-100"
                        value={currentValue}
                        disabled={isSaving}
                        onChange={(e) =>
                          handleAliasDraftChange(a.richMenuAliasId, e.target.value, a.richMenuId)
                        }
                      >
                        {!linkedMenu && (
                          <option value={currentValue}>
                            (現在: {currentValue.slice(0, 16)}…・該当メニュー削除済?)
                          </option>
                        )}
                        {menus.map((m) => (
                          <option key={m.richMenuId} value={m.richMenuId}>
                            {m.name}
                          </option>
                        ))}
                      </select>
                      {isDirty && (
                        <>
                          <button
                            onClick={() => handleSaveAlias(a.richMenuAliasId)}
                            disabled={isSaving}
                            className="shrink-0 px-3 py-1 text-[11px] font-medium text-white bg-green-600 hover:bg-green-700 disabled:bg-gray-300 rounded"
                          >
                            {isSaving ? '保存中…' : '保存'}
                          </button>
                          <button
                            onClick={() => handleResetAliasDraft(a.richMenuAliasId)}
                            disabled={isSaving}
                            className="shrink-0 px-2 py-1 text-[11px] text-gray-500 hover:text-gray-700 bg-white border border-gray-200 rounded disabled:opacity-50"
                          >
                            戻す
                          </button>
                        </>
                      )}
                      <button
                        onClick={() => handleDeleteAlias(a.richMenuAliasId)}
                        disabled={isSaving}
                        className="shrink-0 px-2 py-1 text-[11px] text-red-500 hover:text-red-700 bg-red-50 hover:bg-red-100 rounded disabled:opacity-50"
                      >
                        削除
                      </button>
                    </div>
                    {rowError && (
                      <p className="text-[11px] text-red-600 px-3">{rowError}</p>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* Create form */}
      {showCreate && (
        <div className="mb-6 bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-gray-800">リッチメニュー新規作成</h2>
            <button
              onClick={() => {
                setShowCreate(false)
                setFormError('')
              }}
              className="text-gray-400 hover:text-gray-600"
              aria-label="閉じる"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Step 1: image upload */}
          {!form.imageBase64 ? (
            <div className="space-y-3">
              <p className="text-xs text-gray-500">
                まずメニュー画像をアップロードしてください。画像のサイズに合わせて自動でレイアウトを提案します。
              </p>
              <DropZone onFile={handleImageFile} />
              {formError && <p className="text-xs text-red-600">{formError}</p>}
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px] gap-6">
              {/* Visual canvas + meta */}
              <div className="space-y-4">
                <VisualAreaEditor
                  imageDataUrl={form.imageBase64}
                  imageContentType={form.imageContentType}
                  size={previewSize}
                  areas={form.areas}
                  selectedIndex={selectedAreaIndex}
                  onSelect={setSelectedAreaIndex}
                />
                {form.imageWarning && (
                  <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1.5">
                    ⚠ {form.imageWarning}
                  </p>
                )}
                <p className="text-[11px] text-gray-400">
                  画像のエリアをクリックすると右側でアクションを編集できます。
                </p>
                <button
                  onClick={removeImage}
                  className="text-xs text-gray-500 hover:text-red-500 transition-colors"
                >
                  画像を選び直す
                </button>
              </div>

              {/* Right panel: meta + selected area */}
              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    名前（管理用） <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                    placeholder="例: 春キャンペーン用"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    チャットバーのテキスト <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    maxLength={14}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                    value={form.chatBarText}
                    onChange={(e) => setForm({ ...form, chatBarText: e.target.value })}
                  />
                  <ChatBarPreview text={form.chatBarText} />
                  <p className="mt-1 text-[11px] text-gray-400">
                    14文字以内・LINEトーク下部に表示（{form.chatBarText.length}/14）
                  </p>
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">レイアウト</label>
                  <select
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-green-500"
                    value={form.layout}
                    onChange={(e) => updateLayout(e.target.value)}
                  >
                    {layoutGroups.map((g) => (
                      <optgroup key={g.group} label={g.label}>
                        {LAYOUT_TEMPLATES.filter((l) => l.group === g.group).map((l) => (
                          <option key={l.key} value={l.key}>
                            {l.label}（{l.bounds.length}エリア）
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </div>

                <label className="flex items-center gap-2 text-xs text-gray-700">
                  <input
                    type="checkbox"
                    checked={form.selected}
                    onChange={(e) => setForm({ ...form, selected: e.target.checked })}
                  />
                  作成と同時にデフォルトに設定する
                </label>

                {selectedAreaIndex !== null ? (
                  <AreaActionPanel
                    index={selectedAreaIndex}
                    area={form.areas[selectedAreaIndex]}
                    aliases={aliases}
                    onChange={(next) => updateArea(selectedAreaIndex, next)}
                    onClose={() => setSelectedAreaIndex(null)}
                  />
                ) : (
                  <div className="bg-gray-50 border border-dashed border-gray-200 rounded-lg p-4 text-center text-xs text-gray-500">
                    画像のエリアをクリックして
                    <br />
                    アクションを設定してください
                  </div>
                )}

                {editingId && (() => {
                  const linkedAliases = aliases.filter((a) => a.richMenuId === editingId)
                  if (linkedAliases.length === 0) return null
                  return (
                    <div className={`rounded-lg border p-3 space-y-2 ${inheritAliases ? 'bg-blue-50 border-blue-200' : 'bg-amber-50 border-amber-300'}`}>
                      <p className="text-xs font-semibold text-gray-800">タブ切替先の引き継ぎ</p>
                      <p className="text-[11px] text-gray-700 leading-relaxed">
                        現在このメニューを指している切替先：
                      </p>
                      <ul className="text-[11px] font-mono text-gray-800 pl-3 space-y-0.5">
                        {linkedAliases.map((a) => (
                          <li key={a.richMenuAliasId}>・{a.richMenuAliasId}</li>
                        ))}
                      </ul>
                      <label className="flex items-start gap-2 text-[11px] text-gray-800 pt-1 cursor-pointer">
                        <input
                          type="checkbox"
                          className="mt-0.5"
                          checked={inheritAliases}
                          onChange={(e) => setInheritAliases(e.target.checked)}
                        />
                        <span>
                          <span className="font-semibold">保存時にこれらの切替先を新しいメニューに自動で引き継ぐ</span>
                          <span className="text-gray-500">（推奨・通常はONのまま）</span>
                        </span>
                      </label>
                      {inheritAliases ? (
                        <p className="text-[11px] text-blue-800 leading-relaxed">
                          ✓ 保存時に上記の切替先IDが新メニューに付け替わります。タブ切替式メニューの画像差し替え等はこれでOK。
                        </p>
                      ) : (
                        <p className="text-[11px] text-amber-800 leading-relaxed">
                          ⚠ OFFのまま保存すると、上記の切替先は古いメニュー（保存と同時に削除されます）を指したまま残るため、<strong>タブ切替が動かなくなります</strong>。<br />
                          「タブ切替先の登録」セクションで切替先を別メニューに付け替えた直後など、<strong>意図的に引き継ぎを止めたい場合のみ</strong>OFFにしてください。
                        </p>
                      )}
                    </div>
                  )
                })()}

                {formError && <p className="text-xs text-red-600">{formError}</p>}

                <div className="flex gap-2 pt-2">
                  <button
                    onClick={handleCreate}
                    disabled={saving}
                    className="flex-1 px-4 py-2 text-sm font-medium text-white rounded-lg disabled:opacity-50 transition-opacity"
                    style={{ backgroundColor: '#06C755' }}
                  >
                    {saving
                      ? (editingId ? '保存中...' : '作成中...')
                      : (editingId ? '保存して反映' : '作成して反映')}
                  </button>
                  <button
                    onClick={() => {
                      setShowCreate(false)
                      setFormError('')
                      setEditingId(null)
                    }}
                    className="px-4 py-2 text-sm font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
                  >
                    キャンセル
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* List */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[...Array(2)].map((_, i) => (
            <div key={i} className="bg-white rounded-lg border border-gray-200 p-4 animate-pulse">
              <div className="aspect-[2500/1686] bg-gray-100 rounded mb-3" />
              <div className="h-3 bg-gray-100 rounded w-32 mb-2" />
              <div className="h-2 bg-gray-100 rounded w-24" />
            </div>
          ))}
        </div>
      ) : menus.length === 0 ? (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-12 text-center">
          <p className="text-gray-500">リッチメニューがまだありません。「新規作成」から追加してください。</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {menus.map((menu) => {
            const id = menu.richMenuId ?? ''
            const isDefault = id === defaultId
            const isBusy = busyMenuId === id
            const isDuplicating = duplicating === id
            return (
              <div key={id} className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
                <div className="p-3">
                  <RichMenuImage id={id} />
                </div>
                <div className="px-4 pb-4 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-gray-900 truncate">{menu.name}</p>
                      <p className="text-xs text-gray-500 truncate">バー: {menu.chatBarText}</p>
                    </div>
                    {isDefault && (
                      <span className="shrink-0 inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-green-100 text-green-800">
                        デフォルト
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-gray-400 flex flex-wrap gap-x-3 gap-y-0.5">
                    <span>サイズ: {menu.size.width}×{menu.size.height}</span>
                    <span>エリア: {menu.areas.length}</span>
                    <span className="truncate" title={id}>ID: {id.slice(0, 12)}…</span>
                  </div>
                  <div className="flex flex-wrap gap-2 pt-2">
                    {!isDefault && (
                      <button
                        onClick={() => handleSetDefault(id)}
                        disabled={isBusy || isDuplicating}
                        className="flex-1 min-w-[120px] px-3 py-1.5 text-xs font-medium text-white rounded-md transition-opacity hover:opacity-90 disabled:opacity-50"
                        style={{ backgroundColor: '#06C755' }}
                      >
                        デフォルトに設定
                      </button>
                    )}
                    <button
                      onClick={() => handleEdit(menu)}
                      disabled={isBusy || isDuplicating}
                      className="px-3 py-1.5 text-xs font-medium text-white rounded-md transition-opacity hover:opacity-90 disabled:opacity-50"
                      style={{ backgroundColor: '#06C755' }}
                    >
                      {isDuplicating ? '読み込み中...' : '編集'}
                    </button>
                    <button
                      onClick={() => handleDuplicate(menu)}
                      disabled={isBusy || isDuplicating}
                      className="px-3 py-1.5 text-xs font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-md transition-colors disabled:opacity-50"
                    >
                      複製
                    </button>
                    <button
                      onClick={() => handleDelete(id)}
                      disabled={isBusy || isDuplicating}
                      className="px-3 py-1.5 text-xs font-medium text-red-500 hover:text-red-700 bg-red-50 hover:bg-red-100 rounded-md transition-colors disabled:opacity-50"
                    >
                      削除
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

/**
 * Try to infer which layout preset best matches an existing rich menu's areas.
 * Used by the duplicate flow to pre-select the right layout dropdown value.
 */
function inferLayoutFromAreas(menu: RichMenuPayload): string {
  const isCompact = menu.size.width / menu.size.height > 2.2
  const count = menu.areas.length
  if (isCompact) {
    if (count === 1) return 'C1'
    if (count === 3) return 'C3'
    return 'C2'
  }
  if (count === 1) return 'L1'
  if (count === 2) return 'L2-H'
  if (count === 3) return 'L3-T1B2'
  if (count === 4) return 'L4-Grid'
  if (count === 6) return 'L6'
  if (count === 5) return 'EX-5-V'
  if (count === 8) return 'EX-8'
  if (count === 9) return 'EX-9'
  return 'L6'
}
