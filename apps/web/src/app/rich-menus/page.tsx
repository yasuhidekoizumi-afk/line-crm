'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  api,
  type RichMenuPayload,
  type RichMenuAreaPayload,
} from '@/lib/api'
import Header from '@/components/layout/header'

// ─── Size & layout presets ────────────────────────────────────────────────────

const SIZE_LARGE = { width: 2500, height: 1686 }
const SIZE_COMPACT = { width: 2500, height: 843 }

type LayoutKey = '3x2' | '2x2' | '2x1' | '3x1' | '1x1'

interface LayoutDef {
  label: string
  rows: number
  cols: number
  size: 'large' | 'compact'
}

const LAYOUTS: Record<LayoutKey, LayoutDef> = {
  '3x2': { label: '6分割（3列×2行）', rows: 2, cols: 3, size: 'large' },
  '2x2': { label: '4分割（2列×2行）', rows: 2, cols: 2, size: 'large' },
  '2x1': { label: '2分割（左右）', rows: 1, cols: 2, size: 'compact' },
  '3x1': { label: '3分割（横並び）', rows: 1, cols: 3, size: 'compact' },
  '1x1': { label: '1分割（全面）', rows: 1, cols: 1, size: 'compact' },
}

function buildAreas(layout: LayoutKey): RichMenuAreaPayload[] {
  const def = LAYOUTS[layout]
  const size = def.size === 'large' ? SIZE_LARGE : SIZE_COMPACT
  const cellW = Math.floor(size.width / def.cols)
  const cellH = Math.floor(size.height / def.rows)
  const areas: RichMenuAreaPayload[] = []
  for (let r = 0; r < def.rows; r++) {
    for (let c = 0; c < def.cols; c++) {
      areas.push({
        bounds: { x: c * cellW, y: r * cellH, width: cellW, height: cellH },
        action: { type: 'uri', uri: 'https://example.com', label: `エリア${areas.length + 1}` },
      })
    }
  }
  return areas
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

interface AreaFormRowProps {
  index: number
  area: RichMenuAreaPayload
  onChange: (next: RichMenuAreaPayload) => void
}

function AreaFormRow({ index, area, onChange }: AreaFormRowProps) {
  const action = area.action
  const setActionType = (type: 'uri' | 'message' | 'postback') => {
    if (type === 'uri') onChange({ ...area, action: { type: 'uri', uri: '', label: action.label } })
    else if (type === 'message') onChange({ ...area, action: { type: 'message', text: '', label: action.label } })
    else onChange({ ...area, action: { type: 'postback', data: '', displayText: '', label: action.label } })
  }

  return (
    <div className="border border-gray-200 rounded-lg p-3 bg-gray-50">
      <p className="text-xs font-semibold text-gray-700 mb-2">エリア {index + 1}</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <div>
          <label className="block text-[11px] text-gray-500 mb-0.5">ラベル</label>
          <input
            type="text"
            className="w-full border border-gray-300 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-green-500"
            value={action.label ?? ''}
            onChange={(e) => onChange({ ...area, action: { ...action, label: e.target.value } })}
          />
        </div>
        <div>
          <label className="block text-[11px] text-gray-500 mb-0.5">アクション種別</label>
          <select
            className="w-full border border-gray-300 rounded px-2 py-1.5 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-green-500"
            value={action.type === 'uri' || action.type === 'message' || action.type === 'postback' ? action.type : 'uri'}
            onChange={(e) => setActionType(e.target.value as 'uri' | 'message' | 'postback')}
          >
            <option value="uri">リンク (URL)</option>
            <option value="message">メッセージ送信</option>
            <option value="postback">ポストバック</option>
          </select>
        </div>
        {action.type === 'uri' && (
          <div className="sm:col-span-2">
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
          <div className="sm:col-span-2">
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
          <>
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
          </>
        )}
      </div>
      <p className="mt-2 text-[10px] text-gray-400">
        範囲: x={area.bounds.x}, y={area.bounds.y}, w={area.bounds.width}, h={area.bounds.height}
      </p>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

interface CreateForm {
  name: string
  chatBarText: string
  layout: LayoutKey
  selected: boolean
  areas: RichMenuAreaPayload[]
  imageBase64: string | null
  imageContentType: 'image/png' | 'image/jpeg'
}

const initialForm: CreateForm = {
  name: '',
  chatBarText: 'メニュー',
  layout: '3x2',
  selected: true,
  areas: buildAreas('3x2'),
  imageBase64: null,
  imageContentType: 'image/png',
}

export default function RichMenusPage() {
  const [menus, setMenus] = useState<RichMenuPayload[]>([])
  const [defaultId, setDefaultId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm] = useState<CreateForm>(initialForm)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [busyMenuId, setBusyMenuId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [list, def] = await Promise.all([api.richMenus.list(), api.richMenus.getDefault()])
      if (list.success) setMenus(list.data)
      else setError(list.error)
      if (def.success) setDefaultId(def.data.richMenuId ?? null)
    } catch {
      setError('リッチメニューの読み込みに失敗しました')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const updateLayout = (layout: LayoutKey) => {
    setForm((f) => ({ ...f, layout, areas: buildAreas(layout) }))
  }

  const updateArea = (index: number, next: RichMenuAreaPayload) => {
    setForm((f) => ({ ...f, areas: f.areas.map((a, i) => (i === index ? next : a)) }))
  }

  const handleImageChange = async (file: File | null) => {
    if (!file) {
      setForm((f) => ({ ...f, imageBase64: null }))
      return
    }
    if (!['image/png', 'image/jpeg'].includes(file.type)) {
      setFormError('画像はPNGまたはJPEGのみ使用できます')
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      const base64 = result.replace(/^data:image\/\w+;base64,/, '')
      setForm((f) => ({
        ...f,
        imageBase64: base64,
        imageContentType: file.type === 'image/jpeg' ? 'image/jpeg' : 'image/png',
      }))
      setFormError('')
    }
    reader.readAsDataURL(file)
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
    }
    return null
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
      const layoutDef = LAYOUTS[form.layout]
      const size = layoutDef.size === 'large' ? SIZE_LARGE : SIZE_COMPACT
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
      if (form.selected) {
        const setDef = await api.richMenus.setDefault(richMenuId)
        if (!setDef.success) {
          setFormError(`画像登録は成功しましたが既定設定に失敗: ${setDef.error}`)
          return
        }
      }
      setShowCreate(false)
      setForm(initialForm)
      await load()
    } catch (err) {
      setFormError(err instanceof Error ? err.message : '作成に失敗しました')
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

  return (
    <div>
      <Header
        title="リッチメニュー"
        description="LINE公式アカウントのリッチメニューを作成・管理します。"
        action={
          <button
            onClick={() => {
              setForm(initialForm)
              setFormError('')
              setShowCreate(true)
            }}
            className="px-4 py-2 text-sm font-medium text-white rounded-lg transition-opacity hover:opacity-90"
            style={{ backgroundColor: '#06C755' }}
          >
            + 新規作成
          </button>
        }
      />

      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          {error}
        </div>
      )}

      {/* Default state banner */}
      {!loading && (
        <div className="mb-6 px-4 py-3 bg-white border border-gray-200 rounded-lg flex items-center justify-between">
          <div className="text-sm">
            {defaultId ? (
              <span className="text-gray-700">
                現在のデフォルトリッチメニュー: <code className="text-xs bg-gray-100 px-2 py-0.5 rounded">{defaultId}</code>
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

      {/* Create form */}
      {showCreate && (
        <div className="mb-6 bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h2 className="text-sm font-semibold text-gray-800 mb-4">リッチメニュー新規作成</h2>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Left column: meta + image */}
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
                  チャットバーのテキスト（14文字以内） <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  maxLength={14}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                  value={form.chatBarText}
                  onChange={(e) => setForm({ ...form, chatBarText: e.target.value })}
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">レイアウト</label>
                <select
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-green-500"
                  value={form.layout}
                  onChange={(e) => updateLayout(e.target.value as LayoutKey)}
                >
                  {Object.entries(LAYOUTS).map(([key, def]) => (
                    <option key={key} value={key}>
                      {def.label}（{def.size === 'large' ? '2500×1686' : '2500×843'}）
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  メニュー画像 <span className="text-red-500">*</span>
                </label>
                <input
                  type="file"
                  accept="image/png,image/jpeg"
                  onChange={(e) => handleImageChange(e.target.files?.[0] ?? null)}
                  className="block w-full text-xs text-gray-700 file:mr-3 file:py-1.5 file:px-3 file:rounded file:border-0 file:bg-green-50 file:text-green-700 file:text-xs hover:file:bg-green-100"
                />
                <p className="mt-1 text-[11px] text-gray-400">
                  推奨サイズ: {LAYOUTS[form.layout].size === 'large' ? '2500×1686' : '2500×843'} px / PNG または JPEG / 1MB以下
                </p>
                {form.imageBase64 && (
                  <img
                    src={`data:${form.imageContentType};base64,${form.imageBase64}`}
                    alt="preview"
                    className="mt-2 w-full rounded border border-gray-200 bg-gray-50"
                  />
                )}
              </div>

              <label className="flex items-center gap-2 text-xs text-gray-700">
                <input
                  type="checkbox"
                  checked={form.selected}
                  onChange={(e) => setForm({ ...form, selected: e.target.checked })}
                />
                作成と同時にデフォルトに設定する
              </label>
            </div>

            {/* Right column: areas */}
            <div className="space-y-3">
              <p className="text-xs font-medium text-gray-600">エリアの動作（{form.areas.length}個）</p>
              <div className="space-y-2 max-h-[60vh] overflow-y-auto pr-1">
                {form.areas.map((area, i) => (
                  <AreaFormRow
                    key={i}
                    index={i}
                    area={area}
                    onChange={(next) => updateArea(i, next)}
                  />
                ))}
              </div>
            </div>
          </div>

          {formError && <p className="mt-4 text-xs text-red-600">{formError}</p>}

          <div className="mt-6 flex gap-2">
            <button
              onClick={handleCreate}
              disabled={saving}
              className="px-4 py-2 text-sm font-medium text-white rounded-lg disabled:opacity-50 transition-opacity"
              style={{ backgroundColor: '#06C755' }}
            >
              {saving ? '作成中...' : '作成して画像をアップロード'}
            </button>
            <button
              onClick={() => {
                setShowCreate(false)
                setFormError('')
              }}
              className="px-4 py-2 text-sm font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
            >
              キャンセル
            </button>
          </div>
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
                    <span className="truncate" title={id}>
                      ID: {id.slice(0, 12)}…
                    </span>
                  </div>
                  <div className="flex gap-2 pt-2">
                    {!isDefault && (
                      <button
                        onClick={() => handleSetDefault(id)}
                        disabled={isBusy}
                        className="flex-1 px-3 py-1.5 text-xs font-medium text-white rounded-md transition-opacity hover:opacity-90 disabled:opacity-50"
                        style={{ backgroundColor: '#06C755' }}
                      >
                        デフォルトに設定
                      </button>
                    )}
                    <button
                      onClick={() => handleDelete(id)}
                      disabled={isBusy}
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
