'use client'

/**
 * カードタイプメッセージ（Flex Carousel）エディタ。
 *
 * 公式LINE Official Account Manager の「カードタイプメッセージ」に相当する、
 * 横スクロール式に複数カードを並べる形式。
 *
 * 内部的には Flex Message の type:'carousel' contents:[bubble x N] を生成し、
 * 既存の Flex メッセージとして送信される（DB保存は message_type='flex'）。
 *
 * 各カードに以下を持たせる:
 *  - 画像URL（任意）
 *  - タイトル
 *  - 本文（任意）
 *  - ボタン群（最大3つ、ラベル+URL）
 *
 * カード上限は LINE 仕様で 12（バブル上限）だが、UX 上は 10 に抑える。
 */

import { useMemo } from 'react'
import ImageUploader from '@/components/messages/image-uploader'

export interface CardButton {
  label: string
  uri: string
}

export interface Card {
  imageUrl: string
  title: string
  body: string
  buttons: CardButton[]
}

const MAX_CARDS = 10
const MAX_BUTTONS_PER_CARD = 3

export const DEFAULT_CARD: Card = {
  imageUrl: '',
  title: '',
  body: '',
  buttons: [{ label: '詳しく見る', uri: '' }],
}

/**
 * カード配列 → Flex Carousel JSON 文字列。
 * 空欄のフィールドはコンポーネントから除外する（LINE API のバリデーション対策）。
 */
export function cardsToFlexContent(cards: Card[]): string {
  const bubbles = cards.map((c) => {
    const bubble: Record<string, unknown> = { type: 'bubble' }

    if (c.imageUrl.trim()) {
      bubble.hero = {
        type: 'image',
        url: c.imageUrl.trim(),
        size: 'full',
        aspectRatio: '1:1',
        aspectMode: 'cover',
      }
    }

    const bodyContents: Array<Record<string, unknown>> = []
    if (c.title.trim()) {
      bodyContents.push({
        type: 'text',
        text: c.title.trim(),
        weight: 'bold',
        size: 'md',
        wrap: true,
      })
    }
    if (c.body.trim()) {
      bodyContents.push({
        type: 'text',
        text: c.body.trim(),
        size: 'sm',
        color: '#666666',
        wrap: true,
        margin: 'sm',
      })
    }
    if (bodyContents.length > 0) {
      bubble.body = {
        type: 'box',
        layout: 'vertical',
        paddingAll: '12px',
        contents: bodyContents,
      }
    }

    const footerButtons = c.buttons
      .filter((b) => b.label.trim() && b.uri.trim())
      .map((b) => ({
        type: 'button',
        style: 'primary',
        color: '#06C755',
        action: { type: 'uri', label: b.label.trim(), uri: b.uri.trim() },
      }))
    if (footerButtons.length > 0) {
      bubble.footer = {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        contents: footerButtons,
      }
    }

    return bubble
  })

  return JSON.stringify({ type: 'carousel', contents: bubbles })
}

/**
 * Flex Carousel JSON → カード配列（編集時の初期値復元）。
 * カルーセルでない / 解釈不能なら、デフォルトの1枚カードを返す。
 */
export function cardsFromFlexContent(content: string): Card[] {
  try {
    const parsed = JSON.parse(content) as {
      type?: string
      contents?: Array<Record<string, unknown>>
    }
    if (parsed.type !== 'carousel' || !Array.isArray(parsed.contents)) {
      return [{ ...DEFAULT_CARD }]
    }
    return parsed.contents.map((bubble) => bubbleToCard(bubble))
  } catch {
    return [{ ...DEFAULT_CARD }]
  }
}

function bubbleToCard(bubble: Record<string, unknown>): Card {
  const hero = bubble.hero as Record<string, unknown> | undefined
  const body = bubble.body as Record<string, unknown> | undefined
  const footer = bubble.footer as Record<string, unknown> | undefined

  const imageUrl = typeof hero?.url === 'string' ? hero.url : ''

  let title = ''
  let bodyText = ''
  const bodyContents = (body?.contents as Array<Record<string, unknown>> | undefined) ?? []
  for (const c of bodyContents) {
    if (c.type !== 'text') continue
    if (!title && c.weight === 'bold') title = String(c.text ?? '')
    else if (!bodyText) bodyText = String(c.text ?? '')
  }

  const footerContents = (footer?.contents as Array<Record<string, unknown>> | undefined) ?? []
  const buttons: CardButton[] = footerContents
    .filter((c) => c.type === 'button')
    .map((c) => {
      const action = c.action as Record<string, unknown> | undefined
      return {
        label: typeof action?.label === 'string' ? action.label : '',
        uri: typeof action?.uri === 'string' ? action.uri : '',
      }
    })

  return {
    imageUrl,
    title,
    body: bodyText,
    buttons: buttons.length ? buttons : [{ label: '詳しく見る', uri: '' }],
  }
}

interface Props {
  value: Card[]
  onChange: (next: Card[]) => void
}

export default function CardMessageEditor({ value, onChange }: Props) {
  const cards = useMemo(() => (value.length === 0 ? [{ ...DEFAULT_CARD }] : value), [value])

  const updateCard = (idx: number, patch: Partial<Card>) => {
    onChange(cards.map((c, i) => (i === idx ? { ...c, ...patch } : c)))
  }

  const addCard = () => {
    if (cards.length >= MAX_CARDS) return
    onChange([...cards, { ...DEFAULT_CARD }])
  }

  const removeCard = (idx: number) => {
    if (cards.length <= 1) return
    onChange(cards.filter((_, i) => i !== idx))
  }

  const moveCard = (idx: number, dir: -1 | 1) => {
    const next = idx + dir
    if (next < 0 || next >= cards.length) return
    const out = [...cards]
    const [m] = out.splice(idx, 1)
    out.splice(next, 0, m)
    onChange(out)
  }

  const updateButton = (cardIdx: number, btnIdx: number, patch: Partial<CardButton>) => {
    const card = cards[cardIdx]
    const next = card.buttons.map((b, i) => (i === btnIdx ? { ...b, ...patch } : b))
    updateCard(cardIdx, { buttons: next })
  }

  const addButton = (cardIdx: number) => {
    const card = cards[cardIdx]
    if (card.buttons.length >= MAX_BUTTONS_PER_CARD) return
    updateCard(cardIdx, { buttons: [...card.buttons, { label: '', uri: '' }] })
  }

  const removeButton = (cardIdx: number, btnIdx: number) => {
    const card = cards[cardIdx]
    if (card.buttons.length <= 1) return
    updateCard(cardIdx, { buttons: card.buttons.filter((_, i) => i !== btnIdx) })
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-500">
        カードを横スクロールで複数並べます（最大{MAX_CARDS}枚）。
      </p>

      {cards.map((card, idx) => {
        const isFirst = idx === 0
        const isLast = idx === cards.length - 1
        return (
          <div key={idx} className="border border-gray-200 rounded-lg bg-white">
            <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 border-b border-gray-200">
              <span className="text-xs font-bold text-gray-600">カード {idx + 1}</span>
              <div className="flex items-center gap-1 ml-auto">
                <button
                  type="button"
                  onClick={() => moveCard(idx, -1)}
                  disabled={isFirst}
                  className="px-1.5 py-1 text-xs text-gray-500 hover:text-gray-800 disabled:opacity-30"
                  title="左へ"
                >
                  ←
                </button>
                <button
                  type="button"
                  onClick={() => moveCard(idx, 1)}
                  disabled={isLast}
                  className="px-1.5 py-1 text-xs text-gray-500 hover:text-gray-800 disabled:opacity-30"
                  title="右へ"
                >
                  →
                </button>
                <button
                  type="button"
                  onClick={() => removeCard(idx)}
                  disabled={cards.length <= 1}
                  className="px-2 py-1 text-xs text-red-500 hover:text-red-700 disabled:opacity-30"
                  title="カード削除"
                >
                  ×
                </button>
              </div>
            </div>

            <div className="p-3 space-y-3">
              {/* 画像 */}
              <div>
                <label className="block text-xs text-gray-500 mb-1">画像（任意）</label>
                <ImageUploader onUploaded={(url) => updateCard(idx, { imageUrl: url })} />
                <input
                  type="url"
                  className="w-full mt-2 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                  placeholder="https://example.com/image.png"
                  value={card.imageUrl}
                  onChange={(e) => updateCard(idx, { imageUrl: e.target.value })}
                />
              </div>

              {/* タイトル */}
              <div>
                <label className="block text-xs text-gray-500 mb-1">タイトル</label>
                <input
                  type="text"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                  placeholder="商品名・見出し"
                  value={card.title}
                  onChange={(e) => updateCard(idx, { title: e.target.value })}
                />
              </div>

              {/* 本文 */}
              <div>
                <label className="block text-xs text-gray-500 mb-1">本文（任意）</label>
                <textarea
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 resize-y"
                  rows={2}
                  placeholder="補足説明・価格など"
                  value={card.body}
                  onChange={(e) => updateCard(idx, { body: e.target.value })}
                />
              </div>

              {/* ボタン群 */}
              <div>
                <label className="block text-xs text-gray-500 mb-1">
                  ボタン（最大{MAX_BUTTONS_PER_CARD}つ）
                </label>
                <div className="space-y-2">
                  {card.buttons.map((btn, bi) => (
                    <div key={bi} className="grid grid-cols-[2fr_3fr_auto] gap-2">
                      <input
                        type="text"
                        className="border border-gray-300 rounded px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-green-500"
                        placeholder="ボタンラベル"
                        value={btn.label}
                        onChange={(e) => updateButton(idx, bi, { label: e.target.value })}
                      />
                      <input
                        type="url"
                        className="border border-gray-300 rounded px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-green-500"
                        placeholder="https://example.com/..."
                        value={btn.uri}
                        onChange={(e) => updateButton(idx, bi, { uri: e.target.value })}
                      />
                      <button
                        type="button"
                        onClick={() => removeButton(idx, bi)}
                        disabled={card.buttons.length <= 1}
                        className="px-2 text-xs text-red-500 hover:text-red-700 disabled:opacity-30"
                        title="ボタン削除"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                  {card.buttons.length < MAX_BUTTONS_PER_CARD && (
                    <button
                      type="button"
                      onClick={() => addButton(idx)}
                      className="text-xs text-gray-500 hover:text-gray-800 underline"
                    >
                      ＋ ボタンを追加
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        )
      })}

      {cards.length < MAX_CARDS && (
        <button
          type="button"
          onClick={addCard}
          className="w-full py-2 text-xs text-gray-500 border border-dashed border-gray-300 rounded-lg hover:border-green-500 hover:text-green-700"
        >
          ＋ カードを追加（{cards.length} / {MAX_CARDS}）
        </button>
      )}
    </div>
  )
}
