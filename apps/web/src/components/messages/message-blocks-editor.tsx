'use client'

/**
 * 複数メッセージ（最大5件）を縦に積んで編集するエディタ。
 * - 各ブロックは text / image / flex のいずれか
 * - ブロックの追加・削除・上下入れ替えが可能
 * - 保存時に blocksToPayload() で {messageType, messageContent} に変換（後方互換）
 *
 * LINE Messaging API 仕様で 1 配信あたり最大 5 件まで。
 */

import { useState } from 'react'
import ImageUploader from '@/components/messages/image-uploader'
import FlexTemplates from '@/components/messages/flex-templates'
import FlexEditor from '@/components/messages/flex-editor'
import ImageMapEditor, {
  DEFAULT_IMAGEMAP_VALUE,
  imageMapValueFromContent,
  imageMapValueToContent,
  type ImageMapValue,
} from '@/components/messages/imagemap-editor'
import CardMessageEditor, {
  DEFAULT_CARD,
  cardsFromFlexContent,
  cardsToFlexContent,
  type Card,
} from '@/components/messages/card-message-editor'

export type Block =
  | { id: string; type: 'text'; text: string }
  // image: linkUrl が入っていれば、送信時に裏でリッチメッセージまたはFlexに変換して画像タップで遷移できるようにする
  | { id: string; type: 'image'; originalContentUrl: string; previewImageUrl: string; linkUrl?: string }
  | { id: string; type: 'flex'; contents: string; altText?: string } // contents は JSON 文字列
  // imagemap: 公式LINE「リッチメッセージ」相当。
  // 編集中は構造化値を保持し、保存時に LINE API 形式 JSON 文字列へ変換する。
  | { id: string; type: 'imagemap'; value: ImageMapValue }

const MAX_BLOCKS = 5

let _idCounter = 0
function nextId(): string {
  _idCounter += 1
  return `b_${_idCounter}_${(_idCounter * 9301 + 49297) % 233280}`
}

/**
 * Block配列 → 保存形式に変換
 * - 1件 → 従来の {messageType, messageContent} （後方互換）
 * - 2件以上 → {messageType:'multi', messageContent: JSON.stringify([{type,content,altText?},...])}
 */
export function blocksToPayload(blocks: Block[]): {
  messageType: 'text' | 'image' | 'flex' | 'multi' | 'imagemap'
  messageContent: string
  altText?: string
} {
  if (blocks.length === 0) {
    return { messageType: 'text', messageContent: '' }
  }
  if (blocks.length === 1) {
    const b = blocks[0]
    if (b.type === 'text') return { messageType: 'text', messageContent: b.text }
    if (b.type === 'image') {
      return {
        messageType: 'image',
        // linkUrl を JSON に含める（Worker側がリンク有無でリッチ/Flex変換するかを判断）
        messageContent: JSON.stringify({
          originalContentUrl: b.originalContentUrl,
          previewImageUrl: b.previewImageUrl || b.originalContentUrl,
          ...(b.linkUrl?.trim() ? { linkUrl: b.linkUrl.trim() } : {}),
        }),
      }
    }
    if (b.type === 'imagemap') {
      return {
        messageType: 'imagemap',
        messageContent: imageMapValueToContent(b.value),
        altText: b.value.altText,
      }
    }
    return { messageType: 'flex', messageContent: b.contents, altText: b.altText }
  }
  // 複数: buildMessages() の入力形式に合わせる
  const payload = blocks.map((b) => {
    if (b.type === 'text') return { type: 'text', content: b.text }
    if (b.type === 'image') {
      return {
        type: 'image',
        content: JSON.stringify({
          originalContentUrl: b.originalContentUrl,
          previewImageUrl: b.previewImageUrl || b.originalContentUrl,
          ...(b.linkUrl?.trim() ? { linkUrl: b.linkUrl.trim() } : {}),
        }),
      }
    }
    if (b.type === 'imagemap') {
      return {
        type: 'imagemap',
        content: imageMapValueToContent(b.value),
        altText: b.value.altText,
      }
    }
    return { type: 'flex', content: b.contents, altText: b.altText }
  })
  return { messageType: 'multi', messageContent: JSON.stringify(payload) }
}

/**
 * 保存形式 → Block配列に復元（編集時の初期値用）
 */
export function payloadToBlocks(messageType: string, messageContent: string): Block[] {
  if (messageType === 'multi') {
    try {
      const arr = JSON.parse(messageContent) as Array<{ type: string; content: string; altText?: string }>
      if (!Array.isArray(arr)) return []
      return arr.map((m) => contentToBlock(m.type, m.content, m.altText)).filter(Boolean) as Block[]
    } catch {
      return []
    }
  }
  const b = contentToBlock(messageType, messageContent)
  return b ? [b] : []
}

function contentToBlock(type: string, content: string, altText?: string): Block | null {
  if (type === 'text') return { id: nextId(), type: 'text', text: content }
  if (type === 'image') {
    try {
      const parsed = JSON.parse(content) as { originalContentUrl?: string; previewImageUrl?: string; linkUrl?: string }
      return {
        id: nextId(),
        type: 'image',
        originalContentUrl: parsed.originalContentUrl ?? '',
        previewImageUrl: parsed.previewImageUrl ?? parsed.originalContentUrl ?? '',
        ...(parsed.linkUrl ? { linkUrl: parsed.linkUrl } : {}),
      }
    } catch {
      return { id: nextId(), type: 'image', originalContentUrl: '', previewImageUrl: '' }
    }
  }
  if (type === 'imagemap') {
    return { id: nextId(), type: 'imagemap', value: imageMapValueFromContent(content) }
  }
  if (type === 'flex') return { id: nextId(), type: 'flex', contents: content, altText }
  return null
}

function emptyBlock(type: 'text' | 'image' | 'flex' | 'imagemap'): Block {
  if (type === 'text') return { id: nextId(), type: 'text', text: '' }
  if (type === 'image') return { id: nextId(), type: 'image', originalContentUrl: '', previewImageUrl: '' }
  if (type === 'imagemap') return { id: nextId(), type: 'imagemap', value: { ...DEFAULT_IMAGEMAP_VALUE } }
  return { id: nextId(), type: 'flex', contents: '' }
}

interface Props {
  value: Block[]
  onChange: (next: Block[]) => void
}

export default function MessageBlocksEditor({ value, onChange }: Props) {
  // 編集中のブロックID（折りたたみ表示）。初期は最後に追加されたブロックを開く。
  const [openId, setOpenId] = useState<string | null>(value[0]?.id ?? null)

  const addBlock = (type: 'text' | 'image' | 'flex' | 'imagemap') => {
    if (value.length >= MAX_BLOCKS) return
    const b = emptyBlock(type)
    onChange([...value, b])
    setOpenId(b.id)
  }

  // カードタイプメッセージ（Flex Carousel）を新規ブロックとして追加。
  // 内部的には Flex ブロックとして保存される。
  const addCardBlock = () => {
    if (value.length >= MAX_BLOCKS) return
    const initialContents = cardsToFlexContent([{ ...DEFAULT_CARD }])
    const b: Block = { id: nextId(), type: 'flex', contents: initialContents, altText: 'カードタイプメッセージ' }
    onChange([...value, b])
    setOpenId(b.id)
  }

  const updateBlock = (id: string, patch: Partial<Block>) => {
    onChange(value.map((b) => (b.id === id ? ({ ...b, ...patch } as Block) : b)))
  }

  const removeBlock = (id: string) => {
    onChange(value.filter((b) => b.id !== id))
  }

  const moveBlock = (id: string, dir: -1 | 1) => {
    const idx = value.findIndex((b) => b.id === id)
    if (idx < 0) return
    const newIdx = idx + dir
    if (newIdx < 0 || newIdx >= value.length) return
    const next = [...value]
    const [moved] = next.splice(idx, 1)
    next.splice(newIdx, 0, moved)
    onChange(next)
  }

  return (
    <div className="space-y-2">
      {/* ブロック一覧 */}
      {value.map((b, idx) => {
        const isOpen = openId === b.id
        const isFirst = idx === 0
        const isLast = idx === value.length - 1
        return (
          <div key={b.id} className="border border-gray-200 rounded-lg bg-white">
            {/* ヘッダー（クリックで開閉） */}
            <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 border-b border-gray-200">
              <span className="text-xs font-mono text-gray-400 w-6">#{idx + 1}</span>
              <button
                type="button"
                onClick={() => setOpenId(isOpen ? null : b.id)}
                className="flex-1 text-left text-sm font-medium text-gray-700 hover:text-gray-900"
              >
                <span className="inline-block w-20 text-xs text-gray-500">
                  {b.type === 'text'
                    ? 'テキスト'
                    : b.type === 'image'
                      ? '画像'
                      : b.type === 'imagemap'
                        ? 'リッチ'
                        : 'Flex'}
                </span>
                <span className="ml-2 text-xs text-gray-500 truncate inline-block max-w-[300px] align-middle">
                  {summarize(b)}
                </span>
              </button>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => moveBlock(b.id, -1)}
                  disabled={isFirst}
                  className="px-1.5 py-1 text-xs text-gray-500 hover:text-gray-800 disabled:opacity-30"
                  title="上へ"
                >
                  ↑
                </button>
                <button
                  type="button"
                  onClick={() => moveBlock(b.id, 1)}
                  disabled={isLast}
                  className="px-1.5 py-1 text-xs text-gray-500 hover:text-gray-800 disabled:opacity-30"
                  title="下へ"
                >
                  ↓
                </button>
                <button
                  type="button"
                  onClick={() => removeBlock(b.id)}
                  className="px-2 py-1 text-xs text-red-500 hover:text-red-700"
                  title="削除"
                >
                  ×
                </button>
              </div>
            </div>

            {/* 中身 */}
            {isOpen && (
              <div className="p-3">
                {b.type === 'text' && (
                  <textarea
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 resize-y"
                    rows={4}
                    placeholder="配信するメッセージを入力..."
                    value={b.text}
                    onChange={(e) => updateBlock(b.id, { text: e.target.value })}
                  />
                )}
                {b.type === 'image' && (
                  <div className="space-y-3">
                    <ImageUploader
                      onUploaded={(url) =>
                        updateBlock(b.id, { originalContentUrl: url, previewImageUrl: url })
                      }
                    />
                    <div className="space-y-2">
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">画像URL <span className="text-gray-400">(必須)</span></label>
                        <input
                          type="url"
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                          placeholder="https://example.com/image.png"
                          value={b.originalContentUrl}
                          onChange={(e) => updateBlock(b.id, { originalContentUrl: e.target.value })}
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">
                          🔗 タップ時のリンクURL <span className="text-gray-400">(任意)</span>
                        </label>
                        <input
                          type="url"
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                          placeholder="https://oryzae.jp/products/... (空欄ならリンクなし)"
                          value={b.linkUrl ?? ''}
                          onChange={(e) => updateBlock(b.id, { linkUrl: e.target.value || undefined })}
                        />
                        {b.linkUrl?.trim() && (
                          <p className="text-[11px] text-gray-400 mt-1">
                            ※ アップロード画像は大きく表示されるリッチメッセージとして送信されます。外部URLの場合のみFlexに変換されます。
                          </p>
                        )}
                      </div>
                      <details className="text-xs">
                        <summary className="cursor-pointer text-gray-400 hover:text-gray-600">詳細設定</summary>
                        <div className="mt-2">
                          <label className="block text-xs text-gray-500 mb-1">プレビュー画像URL <span className="text-gray-400">(任意・空欄で元画像と同じ)</span></label>
                          <input
                            type="url"
                            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                            placeholder="https://example.com/preview.png"
                            value={b.previewImageUrl}
                            onChange={(e) => updateBlock(b.id, { previewImageUrl: e.target.value })}
                          />
                        </div>
                      </details>
                    </div>
                  </div>
                )}
                {b.type === 'flex' && (
                  <div className="space-y-3">
                    {!b.contents.trim() && (
                      <div className="space-y-3">
                        <p className="text-xs text-gray-500">テンプレートを選択するか、JSONを直接編集してください</p>
                        <FlexTemplates onSelect={(json) => updateBlock(b.id, { contents: json })} />
                        <div className="border-t border-gray-200 pt-3">
                          <p className="text-xs text-gray-500 mb-2">
                            または、専用エディタで作成：
                          </p>
                          <button
                            type="button"
                            onClick={() =>
                              updateBlock(b.id, {
                                contents: cardsToFlexContent([{ ...DEFAULT_CARD }]),
                                altText: 'カードタイプメッセージ',
                              })
                            }
                            className="px-3 py-1.5 text-xs font-medium border border-gray-300 text-gray-700 bg-white rounded-md hover:border-green-500 hover:text-green-700"
                          >
                            🎴 カードタイプメッセージを作る
                          </button>
                        </div>
                      </div>
                    )}
                    {b.contents.trim() && isCarouselJson(b.contents) && (
                      <CardMessageEditor
                        value={cardsFromFlexContent(b.contents)}
                        onChange={(cards) => updateBlock(b.id, { contents: cardsToFlexContent(cards) })}
                      />
                    )}
                    {b.contents.trim() && !isCarouselJson(b.contents) && (
                      <FlexEditor value={b.contents} onChange={(json) => updateBlock(b.id, { contents: json })} />
                    )}
                    {b.contents.trim() && (
                      <button
                        type="button"
                        onClick={() => updateBlock(b.id, { contents: '' })}
                        className="text-xs text-gray-400 hover:text-gray-600 underline"
                      >
                        テンプレートを選び直す
                      </button>
                    )}
                  </div>
                )}
                {b.type === 'imagemap' && (
                  <ImageMapEditor
                    value={b.value}
                    onChange={(next) => updateBlock(b.id, { value: next })}
                  />
                )}
              </div>
            )}
          </div>
        )
      })}

      {/* 追加ボタン群 */}
      {value.length < MAX_BLOCKS ? (
        <div className="flex flex-wrap gap-2 pt-1">
          <span className="text-xs text-gray-500 self-center mr-1">＋ ブロックを追加：</span>
          <button
            type="button"
            onClick={() => addBlock('text')}
            className="px-3 py-1.5 text-xs font-medium border border-gray-300 text-gray-700 bg-white rounded-md hover:border-green-500 hover:text-green-700"
          >
            T テキスト
          </button>
          <button
            type="button"
            onClick={() => addBlock('image')}
            className="px-3 py-1.5 text-xs font-medium border border-gray-300 text-gray-700 bg-white rounded-md hover:border-green-500 hover:text-green-700"
          >
            🖼 画像
          </button>
          <button
            type="button"
            onClick={() => addBlock('flex')}
            className="px-3 py-1.5 text-xs font-medium border border-gray-300 text-gray-700 bg-white rounded-md hover:border-green-500 hover:text-green-700"
          >
            ▢ Flex
          </button>
          <button
            type="button"
            onClick={() => addBlock('imagemap')}
            className="px-3 py-1.5 text-xs font-medium border border-gray-300 text-gray-700 bg-white rounded-md hover:border-green-500 hover:text-green-700"
          >
            📐 リッチメッセージ
          </button>
          <button
            type="button"
            onClick={addCardBlock}
            className="px-3 py-1.5 text-xs font-medium border border-gray-300 text-gray-700 bg-white rounded-md hover:border-green-500 hover:text-green-700"
          >
            🎴 カードタイプ
          </button>
          <span className="text-xs text-gray-400 self-center ml-2">
            {value.length} / {MAX_BLOCKS}
          </span>
        </div>
      ) : (
        <p className="text-xs text-gray-500 pt-1">
          ※ LINEの仕様で1配信あたり最大{MAX_BLOCKS}件までです。
        </p>
      )}
    </div>
  )
}

function summarize(b: Block): string {
  if (b.type === 'text') return b.text.slice(0, 30) || '（未入力）'
  if (b.type === 'image') return b.originalContentUrl || '（画像未設定）'
  if (b.type === 'imagemap') return b.value.baseUrl ? b.value.altText : '（画像未設定）'
  // flex
  if (!b.contents.trim()) return '（テンプレ未選択）'
  if (isCarouselJson(b.contents)) {
    const n = countCarouselBubbles(b.contents)
    return `カードタイプメッセージ（${n}枚）`
  }
  try {
    const j = JSON.parse(b.contents) as { altText?: string; type?: string }
    return j.altText || j.type || 'Flexメッセージ'
  } catch {
    return 'Flexメッセージ'
  }
}

function isCarouselJson(content: string): boolean {
  try {
    const parsed = JSON.parse(content) as { type?: string }
    return parsed.type === 'carousel'
  } catch {
    return false
  }
}

function countCarouselBubbles(content: string): number {
  try {
    const parsed = JSON.parse(content) as { contents?: unknown[] }
    return Array.isArray(parsed.contents) ? parsed.contents.length : 0
  } catch {
    return 0
  }
}
