'use client'

import { useState, useCallback, useMemo } from 'react'
import FlexPreviewComponent from '@/components/flex-preview'
import ImageUploader from '@/components/messages/image-uploader'

interface FlexEditorProps {
  value: string
  onChange: (json: string) => void
}

/* ─── flatten component tree into selectable list ───────────────────── */

interface FlatEntry {
  path: string
  type: string
  label: string
  node: Record<string, unknown>
}

function flattenComponents(parsed: Record<string, unknown>): FlatEntry[] {
  const result: FlatEntry[] = []

  function walk(node: Record<string, unknown>, path: string, depth: number) {
    if (!node || typeof node !== 'object') return
    const t = String(node.type || '')

    // Generate a friendly label
    let label = t
    if (t === 'text') label = `テキスト: "${(String(node.text || '').slice(0, 30))}"`
    else if (t === 'button') label = `ボタン: ${(node.action as Record<string, unknown>)?.label || '(ラベルなし)'}`
    else if (t === 'image') label = `画像${node.url ? ' (設定済)' : ' (未設定)'}`
    else if (t === 'box') label = `ブロック (${node.layout || 'vertical'})`
    else if (t === 'separator') label = '区切り線'
    else if (t === 'spacer') label = '余白'
    else if (t === 'span') label = `span: "${(String(node.text || '').slice(0, 20))}"`
    else if (t === 'bubble') label = 'バブル'
    else if (t === 'carousel') label = 'カルーセル'

    result.push({ path, type: t, label, node })

    // Recurse into box contents
    if (t === 'box' && Array.isArray(node.contents)) {
      node.contents.forEach((child: unknown, i: number) => {
        walk(child as Record<string, unknown>, `${path}.contents.${i}`, depth + 1)
      })
    }
    // Recurse into bubble sections
    if (t === 'bubble') {
      for (const section of ['header', 'hero', 'body', 'footer'] as const) {
        if (node[section]) {
          walk(node[section] as Record<string, unknown>, `${path}.${section}`, depth + 1)
        }
      }
    }
    // Recurse into carousel children
    if (t === 'carousel' && Array.isArray(node.contents)) {
      node.contents.forEach((child: unknown, i: number) => {
        walk(child as Record<string, unknown>, `${path}.carousel.${i}`, depth + 1)
      })
    }
  }

  walk(parsed, 'root', 0)
  return result
}

/* ─── deep set helper ───────────────────────────────────────────────── */

function deepSet(obj: Record<string, unknown>, path: string, value: unknown) {
  const parts = path.replace(/^root\.?/, '').split('.')
  let current: unknown = obj
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i]
    if (part === 'contents' && Array.isArray(current)) {
      // skip array marker — next part is index
      current = current[parseInt(parts[i + 1])]
      i++ // skip index
    } else if (current && typeof current === 'object') {
      current = (current as Record<string, unknown>)[part]
    } else break
  }
  if (current && typeof current === 'object') {
    const lastKey = parts[parts.length - 1]
    ;(current as Record<string, unknown>)[lastKey] = value
  }
}

/* ─── section label map ─────────────────────────────────────────────── */

const sectionLabels: Record<string, string> = {
  body: 'メイン',
  header: 'ヘッダー',
  footer: 'フッター',
  hero: 'ヒーロー画像',
}

/* ─── Component ─────────────────────────────────────────────────────── */

export default function FlexEditor({ value, onChange }: FlexEditorProps) {
  const [selectedPath, setSelectedPath] = useState<string>('')
  const [jsonTab, setJsonTab] = useState(false)

  // Parse
  const parsed = useMemo(() => {
    try { return JSON.parse(value) as Record<string, unknown> } catch { return null }
  }, [value])
  const isCarousel = parsed?.type === 'carousel'
  const isValid = parsed !== null

  // Flattened components
  const components = useMemo(() => {
    if (!parsed) return []
    const flat = flattenComponents(parsed)
    // Filter out structural nodes (bubble, carousel) — keep editable leaves
    return flat.filter(e => !['bubble', 'carousel'].includes(e.type))
  }, [parsed])

  // Selected node
  const selectedEntry = useMemo(() => {
    return components.find(e => e.path === selectedPath) || null
  }, [components, selectedPath])
  const selectedNode = selectedEntry?.node ?? null

  // Update a single property on the selected node
  const updateProperty = useCallback((key: string, strVal: string) => {
    if (!selectedNode || !selectedEntry || !parsed) return
    const updated = JSON.parse(JSON.stringify(parsed))

    // Walk to the selected node in the deep-cloned tree
    const pathParts = selectedEntry.path.replace(/^root\.?/, '').split('.')
    let target: unknown = updated
    for (const part of pathParts) {
      if (target && typeof target === 'object') {
        target = (target as Record<string, unknown>)[part as string]
      }
    }

    if (!target || typeof target !== 'object') return
    const targetObj = target as Record<string, unknown>

    // Handle nested keys (action.label, action.uri, etc.)
    if (key.startsWith('action.')) {
      const subKey = key.split('.')[1]
      if (!targetObj.action) targetObj.action = {}
      const action = targetObj.action as Record<string, unknown>
      if (strVal) action[subKey] = strVal
      else delete action[subKey]
    } else if (key === 'wrap') {
      if (strVal === 'true') targetObj.wrap = true
      else delete targetObj.wrap
    } else {
      if (strVal) targetObj[key] = strVal
      else delete targetObj[key]
    }

    onChange(JSON.stringify(updated, null, 2))
  }, [selectedNode, selectedEntry, parsed, onChange])

  // Update action type
  const updateActionType = useCallback((type: string) => {
    if (!selectedNode || !selectedEntry || !parsed) return
    const updated = JSON.parse(JSON.stringify(parsed))
    const pathParts = selectedEntry.path.replace(/^root\.?/, '').split('.')
    let target: unknown = updated
    for (const part of pathParts) {
      if (target && typeof target === 'object') {
        target = (target as Record<string, unknown>)[part as string]
      }
    }
    if (!target || typeof target !== 'object') return
    const targetObj = target as Record<string, unknown>
    const base = { type } as Record<string, string>
    if (type === 'uri') base.uri = 'https://'
    else if (type === 'message') base.text = ''
    else if (type === 'postback') base.data = ''
    targetObj.action = { ...base, label: (targetObj.action as Record<string, unknown>)?.label || 'ボタン' }
    onChange(JSON.stringify(updated, null, 2))
  }, [selectedNode, selectedEntry, parsed, onChange])

  // Add component to body
  const addComponent = useCallback((compType: string) => {
    if (!parsed) return
    const defaults: Record<string, Record<string, unknown>> = {
      text: { type: 'text', text: '新しいテキスト', wrap: true },
      button: { type: 'button', style: 'primary', action: { type: 'uri', label: 'ボタン', uri: 'https://example.com' } },
      image: { type: 'image', url: 'https://placehold.jp/500x500.png', size: 'full', aspectRatio: '1:1', aspectMode: 'cover' },
      separator: { type: 'separator', color: '#e0e0e0' },
      spacer: { type: 'spacer', size: 'md' },
    }
    const def = defaults[compType]
    if (!def) return

    const updated = JSON.parse(JSON.stringify(parsed))
    // Find the body section
    const body = updated.body || updated.hero || updated.footer
    if (body && Array.isArray(body.contents)) {
      body.contents.push({ ...def })
      onChange(JSON.stringify(updated, null, 2))
    }
  }, [parsed, onChange])

  // Carousel controls
  const addBubble = useCallback(() => {
    if (!parsed || parsed.type !== 'carousel') return
    const contents = (parsed.contents as Record<string, unknown>[]) || []
    const newBubble = { type: 'bubble', body: { type: 'box', layout: 'vertical', paddingAll: '12px', contents: [{ type: 'text', text: `商品 ${contents.length + 1}`, weight: 'bold', size: 'sm', wrap: true }, { type: 'text', text: '¥1,000', size: 'sm', color: '#06C755', weight: 'bold' }] }, footer: { type: 'box', layout: 'vertical', contents: [{ type: 'button', style: 'primary', action: { type: 'uri', label: '購入', uri: 'https://example.com' } }] } }
    onChange(JSON.stringify({ ...parsed, contents: [...contents, newBubble] }, null, 2))
  }, [parsed, onChange])
  const removeBubble = useCallback(() => {
    if (!parsed || parsed.type !== 'carousel') return
    const contents = (parsed.contents as Record<string, unknown>[]) || []
    if (contents.length <= 1) return
    onChange(JSON.stringify({ ...parsed, contents: contents.slice(0, -1) }, null, 2))
  }, [parsed, onChange])

  // Remove a component by path
  const removeByPath = useCallback((path: string) => {
    if (!parsed) return
    const parts = path.replace(/^root\.?/, '').split('.')
    const idx = parseInt(parts[parts.length - 1])
    if (isNaN(idx)) return
    const updated = JSON.parse(JSON.stringify(parsed))
    let target: unknown = updated
    for (let i = 0; i < parts.length - 2; i++) {
      const part = parts[i]
      if (target && typeof target === 'object') {
        target = (target as Record<string, unknown>)[part]
      }
    }
    const parentKey = parts[parts.length - 2]
    if (!target || typeof target !== 'object' || parentKey !== 'contents') return
    const parentArr = (target as Record<string, unknown>)[parentKey]
    if (!Array.isArray(parentArr)) return
    parentArr.splice(idx, 1)
    setSelectedPath('')
    onChange(JSON.stringify(updated, null, 2))
  }, [parsed, onChange])

  const removeComponent = useCallback(() => {
    if (!selectedEntry) return
    removeByPath(selectedEntry.path)
  }, [selectedEntry, removeByPath])

  // Is editing disabled because of carousel?
  const editingDisabled = selectedPath.startsWith('root.carousel')

  /* ─── property field renderers ──────────────────────────────────── */

  const propValue = (key: string): string => {
    if (!selectedNode) return ''
    if (key.startsWith('action.')) {
      const sub = key.split('.')[1]
      return String((selectedNode.action as Record<string, unknown>)?.[sub] ?? '')
    }
    return String(selectedNode[key] ?? '')
  }

  const editField = (label: string, key: string, opts?: { type?: string; placeholder?: string; options?: { value: string; label: string }[] }) => {
    const val = propValue(key)
    const inputType = opts?.type || 'text'

    return (
      <div key={key} className="flex items-center gap-2">
        <label className="text-xs text-gray-500 w-24 shrink-0">{label}</label>
        {opts?.options ? (
          <select
            className="flex-1 border border-gray-200 rounded-md px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-green-500 bg-white"
            value={val}
            onChange={e => updateProperty(key, e.target.value)}
          >
            {opts.options.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        ) : inputType === 'color' ? (
          <div className="flex items-center gap-1 flex-1">
            <input type="color" className="w-8 h-8 p-0.5 border border-gray-200 rounded cursor-pointer" value={/^#[0-9a-fA-F]{6}$/.test(val) ? val : '#000000'} onChange={e => updateProperty(key, e.target.value)} />
            <input type="text" className="flex-1 border border-gray-200 rounded-md px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-green-500 font-mono" value={val} onChange={e => updateProperty(key, e.target.value)} placeholder="#000000" />
          </div>
        ) : (
          <input
            type={inputType}
            className="flex-1 border border-gray-200 rounded-md px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-green-500"
            value={val}
            onChange={e => updateProperty(key, e.target.value)}
            placeholder={opts?.placeholder || ''}
          />
        )}
      </div>
    )
  }

  /* ─── render ────────────────────────────────────────────────────── */

  return (
    <div className="space-y-4">
      {/* ── Carousel toolstrip ───────────────────────────────────── */}
      {isCarousel && (
        <div className="flex items-center gap-2 p-2 bg-blue-50 border border-blue-200 rounded-lg">
          <span className="text-xs font-medium text-blue-700">カルーセル</span>
          <button type="button" onClick={addBubble} className="px-2.5 py-1 text-xs font-medium text-blue-700 bg-white border border-blue-300 rounded-md hover:bg-blue-100">+ バブル追加</button>
          <button type="button" onClick={removeBubble} className="px-2.5 py-1 text-xs font-medium text-red-600 bg-white border border-red-200 rounded-md hover:bg-red-100">最後のバブル削除</button>
        </div>
      )}

      {!isValid && <p className="text-xs text-red-500">JSON パースエラー</p>}

      {/* ── Main layout: preview + editor side by side ──────────── */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        {/* Preview — phone frame */}
        <div className="md:col-span-2 flex flex-col items-center">
          <div className="text-xs font-medium text-gray-500 mb-2 self-start">プレビュー</div>
          <div className="bg-white border-2 border-gray-200 rounded-[24px] shadow-sm p-2 w-[260px]">
            <div className="bg-gray-50 rounded-[18px] min-h-[200px] flex items-center justify-center overflow-hidden">
              {isValid ? (
                <FlexPreviewComponent content={value} maxWidth={240} />
              ) : (
                <p className="text-xs text-gray-300">プレビューできません</p>
              )}
            </div>
          </div>
        </div>

        {/* Right: editor panel */}
        <div className="md:col-span-3 space-y-3">
          {/* ── Add component bar ─────────────────────────────── */}
          {!isCarousel && (
            <div>
              <p className="text-xs font-medium text-gray-500 mb-1.5">要素を追加</p>
              <div className="flex flex-wrap gap-1">
                {[
                  { type: 'text', label: 'テキスト', icon: 'T' },
                  { type: 'button', label: 'ボタン', icon: '▣' },
                  { type: 'image', label: '画像', icon: '🖼' },
                  { type: 'separator', label: '区切り線', icon: '―' },
                  { type: 'spacer', label: '余白', icon: '⇕' },
                ].map(comp => (
                  <button
                    key={comp.type}
                    type="button"
                    onClick={() => addComponent(comp.type)}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-gray-600 bg-white border border-gray-200 rounded-md hover:border-green-400 hover:text-green-700 transition-colors"
                  >
                    <span className="text-xs">{comp.icon}</span>
                    {comp.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* ── Component selector ────────────────────────────── */}
          <div>
            <p className="text-xs font-medium text-gray-500 mb-1.5">編集する要素をクリック</p>
            {components.length > 0 ? (
              <div className="border border-gray-200 rounded-lg max-h-40 overflow-y-auto bg-white">
                {components.map(entry => {
                  const isSelected = entry.path === selectedPath
                  // Determine section badge
                  const sectionMatch = entry.path.match(/\.(body|header|footer|hero)/)
                  const sectionLabel = sectionMatch ? sectionLabels[sectionMatch[1]] || sectionMatch[1] : ''

                  const isDeletable = !isNaN(parseInt(entry.path.split('.').at(-1) ?? ''))

                  return (
                    <div
                      key={entry.path}
                      className={`flex items-center border-b border-gray-100 last:border-b-0 ${isSelected ? 'bg-green-50' : 'hover:bg-gray-50'}`}
                    >
                      <button
                        type="button"
                        onClick={() => setSelectedPath(isSelected ? '' : entry.path)}
                        className={`flex-1 text-left px-3 py-1.5 text-xs transition-colors flex items-center gap-2 ${
                          isSelected ? 'text-green-800 font-medium' : 'text-gray-700'
                        }`}
                      >
                        {sectionLabel && (
                          <span className="text-[10px] text-gray-400 bg-gray-100 rounded px-1 py-0.5 shrink-0">{sectionLabel}</span>
                        )}
                        <span className="truncate">{entry.label}</span>
                      </button>
                      {isDeletable && (
                        <button
                          type="button"
                          onClick={e => { e.stopPropagation(); removeByPath(entry.path) }}
                          className="p-1.5 mr-1 text-gray-300 hover:text-red-500 transition-colors rounded shrink-0"
                          title="削除"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="3 6 5 6 21 6" />
                            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                            <path d="M10 11v6M14 11v6" />
                            <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                          </svg>
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>
            ) : (
              <p className="text-xs text-gray-400 italic">編集可能な要素がありません</p>
            )}
          </div>

          {/* ── Property editor for selected component ────────── */}
          {selectedEntry && (
            <div className="border border-gray-200 rounded-lg p-3 bg-white space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium text-green-700">
                  {selectedEntry.label}
                </p>
                {!isNaN(parseInt(selectedEntry.path.split('.').at(-1) ?? '')) && (
                  <button
                    type="button"
                    onClick={removeComponent}
                    className="p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                    title="この要素を削除"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="3 6 5 6 21 6" />
                      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                      <path d="M10 11v6M14 11v6" />
                      <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                    </svg>
                  </button>
                )}
              </div>

              {selectedEntry.type === 'text' && (
                <div className="space-y-1.5">
                  <div className="flex items-start gap-2">
                    <label className="text-xs text-gray-500 w-24 shrink-0 mt-1.5">テキスト</label>
                    <textarea
                      className="flex-1 border border-gray-200 rounded-md px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-green-500 resize-y"
                      rows={3}
                      value={propValue('text')}
                      onChange={e => updateProperty('text', e.target.value)}
                      placeholder="表示するテキスト（Enterで改行）"
                    />
                  </div>
                  {editField('サイズ', 'size', { options: [
                    { value: 'xxs', label: 'XXS (10px)' },
                    { value: 'xs', label: 'XS (12px)' },
                    { value: 'sm', label: 'SM (13px)' },
                    { value: 'md', label: 'MD (14px)' },
                    { value: 'lg', label: 'LG (16px)' },
                    { value: 'xl', label: 'XL (18px)' },
                    { value: 'xxl', label: 'XXL (22px)' },
                    { value: '3xl', label: '3XL (26px)' },
                    { value: '4xl', label: '4XL (30px)' },
                    { value: '5xl', label: '5XL (36px)' },
                  ]})}
                  {editField('太字', 'weight', { options: [
                    { value: '', label: '標準' },
                    { value: 'bold', label: '太字' },
                  ]})}
                  {editField('色', 'color')}
                  {editField('揃え', 'align', { options: [
                    { value: '', label: '左' },
                    { value: 'center', label: '中央' },
                    { value: 'end', label: '右' },
                  ]})}
                  {editField('折り返し', 'wrap', { options: [
                    { value: '', label: '折り返す' },
                    { value: 'false', label: '1行' },
                  ]})}
                  {editField('マージン', 'margin', { options: [
                    { value: '', label: 'なし' },
                    { value: 'xs', label: 'XS (2px)' },
                    { value: 'sm', label: 'SM (4px)' },
                    { value: 'md', label: 'MD (8px)' },
                    { value: 'lg', label: 'LG (12px)' },
                    { value: 'xl', label: 'XL (16px)' },
                    { value: 'xxl', label: 'XXL (20px)' },
                  ]})}
                </div>
              )}

              {selectedEntry.type === 'button' && (
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2">
                    <label className="text-xs text-gray-500 w-24 shrink-0">アクション種別</label>
                    <select
                      className="flex-1 border border-gray-200 rounded-md px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-green-500 bg-white"
                      value={String((selectedNode?.action as Record<string, unknown>)?.type || 'uri')}
                      onChange={e => updateActionType(e.target.value)}
                    >
                      <option value="uri">URLを開く</option>
                      <option value="message">メッセージを送信</option>
                      <option value="postback">ポストバック</option>
                    </select>
                  </div>
                  {editField('ラベル', 'action.label', { placeholder: 'ボタンに表示するテキスト' })}
                  {(selectedNode?.action as Record<string, unknown>)?.type === 'uri' && editField('URL', 'action.uri', { placeholder: 'https://...', type: 'url' })}
                  {(selectedNode?.action as Record<string, unknown>)?.type === 'message' && editField('送信テキスト', 'action.text', { placeholder: '送信されるメッセージ' })}
                  {(selectedNode?.action as Record<string, unknown>)?.type === 'postback' && editField('データ', 'action.data', { placeholder: 'postback data' })}
                  {editField('スタイル', 'style', { options: [
                    { value: 'primary', label: '塗りつぶし' },
                    { value: 'link', label: 'リンク' },
                    { value: 'secondary', label: '枠線' },
                  ]})}
                </div>
              )}

              {selectedEntry.type === 'image' && (
                <div className="space-y-1.5">
                  <ImageUploader onUploaded={(url) => updateProperty('url', url)} />
                  {editField('画像URL', 'url', { placeholder: 'https://...', type: 'url' })}
                  {editField('アスペクト比', 'aspectRatio', { placeholder: '例: 1:1, 1040:600' })}
                  {editField('表示モード', 'aspectMode', { options: [
                    { value: 'cover', label: '切り抜き' },
                    { value: 'fit', label: '全体表示' },
                  ]})}
                  {editField('サイズ', 'size', { options: [
                    { value: 'full', label: 'フル幅' },
                    { value: 'xxl', label: 'XXL' },
                    { value: 'xl', label: 'XL' },
                    { value: 'lg', label: 'LG' },
                    { value: 'md', label: 'MD' },
                    { value: 'sm', label: 'SM' },
                  ]})}
                </div>
              )}

              {selectedEntry.type === 'box' && (
                <div className="space-y-1.5">
                  {editField('レイアウト', 'layout', { options: [
                    { value: 'vertical', label: '縦並び' },
                    { value: 'horizontal', label: '横並び' },
                    { value: 'baseline', label: 'ベースライン' },
                  ]})}
                  {editField('背景色', 'backgroundColor', { type: 'color' })}
                  {editField('間隔', 'spacing', { options: [
                    { value: '', label: 'なし' },
                    { value: 'xs', label: 'XS' },
                    { value: 'sm', label: 'SM' },
                    { value: 'md', label: 'MD' },
                    { value: 'lg', label: 'LG' },
                    { value: 'xl', label: 'XL' },
                    { value: 'xxl', label: 'XXL' },
                  ]})}
                  {editField('余白', 'paddingAll', { placeholder: '例: 16px' })}
                  {editField('角丸', 'cornerRadius', { placeholder: '例: 8px' })}
                </div>
              )}

              {selectedEntry.type === 'separator' && (
                <div className="space-y-1.5">
                  {editField('色', 'color', { type: 'color' })}
                  {editField('マージン', 'margin', { options: [
                    { value: '', label: 'なし' },
                    { value: 'xs', label: 'XS' },
                    { value: 'sm', label: 'SM' },
                    { value: 'md', label: 'MD' },
                    { value: 'lg', label: 'LG' },
                    { value: 'xl', label: 'XL' },
                    { value: 'xxl', label: 'XXL' },
                  ]})}
                </div>
              )}

              {(selectedEntry.type === 'spacer') && (
                <div className="space-y-1.5">
                  {editField('サイズ', 'size', { options: [
                    { value: 'xs', label: 'XS (4px)' },
                    { value: 'sm', label: 'SM (8px)' },
                    { value: 'md', label: 'MD (16px)' },
                    { value: 'lg', label: 'LG (24px)' },
                    { value: 'xl', label: 'XL (32px)' },
                  ]})}
                </div>
              )}
            </div>
          )}

          {!selectedEntry && isValid && (
            <div className="border border-dashed border-gray-200 rounded-lg p-4 text-center">
              <p className="text-xs text-gray-400">上のリストから編集する要素をクリックしてください</p>
            </div>
          )}
        </div>
      </div>

      {/* ── Raw JSON (collapsible) ──────────────────────────────── */}
      <details className="border border-gray-200 rounded-lg">
        <summary className="text-xs font-medium text-gray-500 px-3 py-2 cursor-pointer hover:bg-gray-50">
          JSON 詳細編集
        </summary>
        <textarea
          className="w-full border-t border-gray-200 px-3 py-2 text-xs font-mono focus:outline-none resize-y"
          rows={6}
          value={value}
          onChange={e => onChange(e.target.value)}
        />
      </details>
    </div>
  )
}
