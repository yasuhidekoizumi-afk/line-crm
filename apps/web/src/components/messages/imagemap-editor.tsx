'use client'

/**
 * リッチメッセージ（imagemap）エディタ。
 *
 * 公式LINE Official Account Manager の「リッチメッセージ」に相当する、
 * 1枚の画像を分割して各エリアにタップアクションを設定する形式。
 *
 * 設計方針:
 *  - 自由分割ではなく、固定レイアウトテンプレ（1/2v/2h/4/6）から選ぶ
 *  - baseSize.width は LINE 公式仕様で 1040 固定（推奨値）
 *  - height はユーザーが選ぶアスペクト比から自動算出
 *  - 各エリアのアクションは「URL遷移」または「テキスト送信」
 *
 * 保存形式（message_content の JSON）:
 *   {
 *     baseUrl: string,
 *     altText: string,
 *     baseSize: { width: number, height: number },
 *     actions: [
 *       { type: 'uri',     linkUri: string, area: { x, y, width, height } },
 *       { type: 'message', text: string,    area: { x, y, width, height } },
 *       ...
 *     ]
 *   }
 */

import { useMemo } from 'react'
import ImageUploader from '@/components/messages/image-uploader'

// LINE imagemap の baseSize.width は 1040 推奨
const BASE_WIDTH = 1040

type Ratio = '1:1' | '4:3' | '16:9' | '20:13'

const RATIOS: Array<{ id: Ratio; label: string; h: number }> = [
  { id: '1:1', label: '1:1（正方形）', h: BASE_WIDTH },
  { id: '4:3', label: '4:3（横長）', h: Math.round((BASE_WIDTH * 3) / 4) },
  { id: '16:9', label: '16:9（ワイド）', h: Math.round((BASE_WIDTH * 9) / 16) },
  { id: '20:13', label: '20:13（バナー）', h: Math.round((BASE_WIDTH * 13) / 20) },
]

type LayoutId = '1' | '2v' | '2h' | '4' | '6'

// 各エリアは 0〜1 の相対座標で持ち、baseSize と掛け合わせて絶対座標化する
type RelArea = { x: number; y: number; w: number; h: number }

const LAYOUTS: Record<LayoutId, { label: string; areas: RelArea[] }> = {
  '1': {
    label: '1枚（全面タップ）',
    areas: [{ x: 0, y: 0, w: 1, h: 1 }],
  },
  '2v': {
    label: '2分割（上下）',
    areas: [
      { x: 0, y: 0, w: 1, h: 0.5 },
      { x: 0, y: 0.5, w: 1, h: 0.5 },
    ],
  },
  '2h': {
    label: '2分割（左右）',
    areas: [
      { x: 0, y: 0, w: 0.5, h: 1 },
      { x: 0.5, y: 0, w: 0.5, h: 1 },
    ],
  },
  '4': {
    label: '4分割（2×2）',
    areas: [
      { x: 0, y: 0, w: 0.5, h: 0.5 },
      { x: 0.5, y: 0, w: 0.5, h: 0.5 },
      { x: 0, y: 0.5, w: 0.5, h: 0.5 },
      { x: 0.5, y: 0.5, w: 0.5, h: 0.5 },
    ],
  },
  '6': {
    label: '6分割（2×3）',
    areas: [
      { x: 0, y: 0, w: 0.5, h: 1 / 3 },
      { x: 0.5, y: 0, w: 0.5, h: 1 / 3 },
      { x: 0, y: 1 / 3, w: 0.5, h: 1 / 3 },
      { x: 0.5, y: 1 / 3, w: 0.5, h: 1 / 3 },
      { x: 0, y: 2 / 3, w: 0.5, h: 1 / 3 },
      { x: 0.5, y: 2 / 3, w: 0.5, h: 1 / 3 },
    ],
  },
}

export type ImageMapActionInput =
  | { kind: 'uri'; uri: string }
  | { kind: 'message'; text: string }

export interface ImageMapValue {
  baseUrl: string
  altText: string
  ratio: Ratio
  layoutId: LayoutId
  actions: ImageMapActionInput[]
}

export const DEFAULT_IMAGEMAP_VALUE: ImageMapValue = {
  baseUrl: '',
  altText: 'リッチメッセージ',
  ratio: '1:1',
  layoutId: '1',
  actions: [{ kind: 'uri', uri: '' }],
}

/**
 * エディタの入力値 → 保存用 JSON 文字列。
 * 空エリア（URL/テキストとも空）は actions から除外する（LINE API のバリデーション対策）。
 */
export function imageMapValueToContent(v: ImageMapValue): string {
  const ratioDef = RATIOS.find((r) => r.id === v.ratio) ?? RATIOS[0]
  const baseSize = { width: BASE_WIDTH, height: ratioDef.h }
  const layout = LAYOUTS[v.layoutId] ?? LAYOUTS['1']

  const actions = v.actions
    .map((a, i) => {
      const rel = layout.areas[i]
      if (!rel) return null
      const area = {
        x: Math.round(rel.x * baseSize.width),
        y: Math.round(rel.y * baseSize.height),
        width: Math.round(rel.w * baseSize.width),
        height: Math.round(rel.h * baseSize.height),
      }
      if (a.kind === 'uri') {
        const uri = a.uri.trim()
        if (!uri) return null
        return { type: 'uri', linkUri: uri, area }
      }
      const text = a.text.trim()
      if (!text) return null
      return { type: 'message', text, area }
    })
    .filter(Boolean)

  return JSON.stringify({
    baseUrl: v.baseUrl,
    altText: v.altText || 'リッチメッセージ',
    baseSize,
    actions,
  })
}

/**
 * 保存形式 → エディタの入力値（編集時の初期値復元）。
 * 既存データが他ツールで作られていてレイアウトと一致しない場合は '1' レイアウトに丸める。
 */
export function imageMapValueFromContent(content: string): ImageMapValue {
  try {
    const parsed = JSON.parse(content) as {
      baseUrl?: string
      altText?: string
      baseSize?: { width?: number; height?: number }
      actions?: Array<{
        type?: string
        linkUri?: string
        text?: string
        area?: { x: number; y: number; width: number; height: number }
      }>
    }
    const baseUrl = parsed.baseUrl ?? ''
    const altText = parsed.altText ?? 'リッチメッセージ'
    const width = parsed.baseSize?.width ?? BASE_WIDTH
    const height = parsed.baseSize?.height ?? BASE_WIDTH
    const ratio: Ratio = (RATIOS.find(
      (r) => Math.abs(r.h - Math.round((BASE_WIDTH * height) / width)) < 4,
    )?.id ?? '1:1') as Ratio
    const count = parsed.actions?.length ?? 1
    const layoutId: LayoutId =
      count === 6 ? '6' : count === 4 ? '4' : count === 2 ? '2v' : '1'
    const actions: ImageMapActionInput[] =
      parsed.actions?.map((a) =>
        a.type === 'message'
          ? { kind: 'message', text: a.text ?? '' }
          : { kind: 'uri', uri: a.linkUri ?? '' },
      ) ?? [{ kind: 'uri', uri: '' }]
    return { baseUrl, altText, ratio, layoutId, actions }
  } catch {
    return { ...DEFAULT_IMAGEMAP_VALUE }
  }
}

interface Props {
  value: ImageMapValue
  onChange: (next: ImageMapValue) => void
}

export default function ImageMapEditor({ value, onChange }: Props) {
  const ratioDef = RATIOS.find((r) => r.id === value.ratio) ?? RATIOS[0]
  const layout = LAYOUTS[value.layoutId] ?? LAYOUTS['1']

  // 既存 actions の長さがレイアウトのエリア数と一致しない場合の調整値
  const adjustedActions = useMemo<ImageMapActionInput[]>(() => {
    const out: ImageMapActionInput[] = []
    for (let i = 0; i < layout.areas.length; i++) {
      out.push(value.actions[i] ?? { kind: 'uri', uri: '' })
    }
    return out
  }, [value.actions, layout])

  const setLayout = (id: LayoutId) => {
    const next = LAYOUTS[id].areas.map(
      (_, i) => value.actions[i] ?? ({ kind: 'uri', uri: '' } as ImageMapActionInput),
    )
    onChange({ ...value, layoutId: id, actions: next })
  }

  const setAction = (i: number, patch: Partial<ImageMapActionInput> & { kind?: ImageMapActionInput['kind'] }) => {
    const next = [...adjustedActions]
    const cur = next[i]
    if (patch.kind && patch.kind !== cur.kind) {
      next[i] = patch.kind === 'uri' ? { kind: 'uri', uri: '' } : { kind: 'message', text: '' }
    } else if (cur.kind === 'uri' && 'uri' in patch) {
      next[i] = { kind: 'uri', uri: patch.uri ?? '' }
    } else if (cur.kind === 'message' && 'text' in patch) {
      next[i] = { kind: 'message', text: patch.text ?? '' }
    }
    onChange({ ...value, actions: next })
  }

  // プレビュー表示用のサイズ（管理画面側で 280px 幅に縮小して見せる）
  const PREVIEW_W = 280
  const previewH = Math.round((PREVIEW_W * ratioDef.h) / BASE_WIDTH)

  return (
    <div className="space-y-4">
      {/* 画像アップロード */}
      <div>
        <label className="block text-xs text-gray-500 mb-1">
          画像 <span className="text-gray-400">(必須・推奨幅 1040px)</span>
        </label>
        <ImageUploader onUploaded={(url) => onChange({ ...value, baseUrl: url })} />
        <input
          type="url"
          className="w-full mt-2 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
          placeholder="https://example.com/image.png"
          value={value.baseUrl}
          onChange={(e) => onChange({ ...value, baseUrl: e.target.value })}
        />
      </div>

      {/* アスペクト比 */}
      <div>
        <label className="block text-xs text-gray-500 mb-1">アスペクト比</label>
        <div className="flex flex-wrap gap-2">
          {RATIOS.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => onChange({ ...value, ratio: r.id })}
              className={`px-3 py-1.5 text-xs rounded-md border ${
                value.ratio === r.id
                  ? 'border-green-500 bg-green-50 text-green-700'
                  : 'border-gray-300 text-gray-700 bg-white hover:border-green-500'
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {/* レイアウトテンプレ */}
      <div>
        <label className="block text-xs text-gray-500 mb-1">レイアウト</label>
        <div className="flex flex-wrap gap-2">
          {(Object.keys(LAYOUTS) as LayoutId[]).map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => setLayout(id)}
              className={`px-3 py-1.5 text-xs rounded-md border ${
                value.layoutId === id
                  ? 'border-green-500 bg-green-50 text-green-700'
                  : 'border-gray-300 text-gray-700 bg-white hover:border-green-500'
              }`}
            >
              {LAYOUTS[id].label}
            </button>
          ))}
        </div>
      </div>

      {/* プレビュー + アクション入力 */}
      <div className="grid grid-cols-[280px_1fr] gap-4">
        {/* プレビュー: 画像の上にエリア境界をオーバーレイ */}
        <div className="relative" style={{ width: PREVIEW_W, height: previewH }}>
          <div
            className="absolute inset-0 bg-gray-100 border border-gray-200 rounded-md overflow-hidden"
            style={{
              backgroundImage: value.baseUrl ? `url(${value.baseUrl})` : undefined,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
            }}
          >
            {!value.baseUrl && (
              <div className="absolute inset-0 flex items-center justify-center text-xs text-gray-400">
                画像が未設定
              </div>
            )}
            {layout.areas.map((rel, i) => (
              <div
                key={i}
                className="absolute border-2 border-green-500/70 bg-green-500/10 flex items-center justify-center text-[10px] font-bold text-green-900"
                style={{
                  left: `${rel.x * 100}%`,
                  top: `${rel.y * 100}%`,
                  width: `${rel.w * 100}%`,
                  height: `${rel.h * 100}%`,
                }}
              >
                {i + 1}
              </div>
            ))}
          </div>
        </div>

        {/* 各エリアのアクション入力 */}
        <div className="space-y-2">
          {adjustedActions.map((a, i) => (
            <div key={i} className="border border-gray-200 rounded-lg p-2 bg-white">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs font-bold text-green-700">エリア {i + 1}</span>
                <div className="flex gap-1 ml-auto">
                  <button
                    type="button"
                    onClick={() => setAction(i, { kind: 'uri' })}
                    className={`px-2 py-0.5 text-[11px] rounded ${
                      a.kind === 'uri'
                        ? 'bg-green-100 text-green-700'
                        : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                    }`}
                  >
                    🔗 URL遷移
                  </button>
                  <button
                    type="button"
                    onClick={() => setAction(i, { kind: 'message' })}
                    className={`px-2 py-0.5 text-[11px] rounded ${
                      a.kind === 'message'
                        ? 'bg-green-100 text-green-700'
                        : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                    }`}
                  >
                    💬 テキスト送信
                  </button>
                </div>
              </div>
              {a.kind === 'uri' ? (
                <input
                  type="url"
                  className="w-full border border-gray-300 rounded px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-green-500"
                  placeholder="https://example.com/..."
                  value={a.uri}
                  onChange={(e) => setAction(i, { kind: 'uri', uri: e.target.value })}
                />
              ) : (
                <input
                  type="text"
                  className="w-full border border-gray-300 rounded px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-green-500"
                  placeholder="ユーザーが送信するテキスト"
                  value={a.text}
                  onChange={(e) => setAction(i, { kind: 'message', text: e.target.value })}
                />
              )}
            </div>
          ))}
        </div>
      </div>

      {/* alt text（通知欄表示用） */}
      <div>
        <label className="block text-xs text-gray-500 mb-1">
          通知文 <span className="text-gray-400">(LINE通知欄に表示)</span>
        </label>
        <input
          type="text"
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
          placeholder="リッチメッセージ"
          value={value.altText}
          onChange={(e) => onChange({ ...value, altText: e.target.value })}
        />
      </div>

      <p className="text-[11px] text-gray-400">
        ※ 画像URLは LINE 側から <code>{`{baseUrl}/{1040|700|460|300|240}`}</code> の形で取得されるため、
        正常表示するには複数サイズに対応した画像CDNが必要です。表示が崩れる場合は1枚画像（全面タップ）でご利用ください。
      </p>
    </div>
  )
}
