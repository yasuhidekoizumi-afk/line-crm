'use client'

import { useState } from 'react'
import FlexPreviewComponent from '@/components/flex-preview'

interface FlexTemplate {
  id: string
  name: string
  description: string
  json: string
}

const templates: FlexTemplate[] = [
  {
    id: 'product-card',
    name: '商品カード',
    description: '画像・商品名・価格・ボタン',
    json: JSON.stringify({
      type: 'bubble',
      size: 'kilo',
      hero: {
        type: 'image',
        url: 'https://placehold.jp/300x300.png',
        size: 'full',
        aspectRatio: '1:1',
        aspectMode: 'cover',
      },
      body: {
        type: 'box',
        layout: 'vertical',
        paddingAll: '12px',
        contents: [
          { type: 'text', text: '商品名', weight: 'bold', size: 'sm', wrap: true },
          { type: 'text', text: '¥1,000', size: 'sm', color: '#06C755', weight: 'bold', margin: 'sm' },
        ],
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        contents: [
          { type: 'button', style: 'primary', action: { type: 'uri', label: '詳細を見る', uri: 'https://example.com' } },
        ],
      },
    }, null, 2),
  },
  {
    id: 'banner-cta',
    name: 'バナー + CTA',
    description: '画像＋見出し＋ボタン',
    json: JSON.stringify({
      type: 'bubble',
      size: 'kilo',
      hero: {
        type: 'image',
        url: 'https://placehold.jp/300x180.png',
        size: 'full',
        aspectRatio: '300:180',
        aspectMode: 'cover',
      },
      body: {
        type: 'box',
        layout: 'vertical',
        paddingAll: '12px',
        contents: [
          { type: 'text', text: 'キャンペーン', weight: 'bold', size: 'sm', wrap: true },
        ],
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        contents: [
          { type: 'button', style: 'primary', action: { type: 'uri', label: '詳しくはこちら', uri: 'https://example.com' } },
        ],
      },
    }, null, 2),
  },
  {
    id: 'simple-rich',
    name: 'シンプルリッチ',
    description: '3セクション構成',
    json: JSON.stringify({
      type: 'bubble',
      size: 'kilo',
      header: {
        type: 'box',
        layout: 'vertical',
        paddingAll: '10px',
        backgroundColor: '#06C755',
        contents: [
          { type: 'text', text: 'お知らせ', color: '#fff', weight: 'bold', size: 'xs' },
        ],
      },
      body: {
        type: 'box',
        layout: 'vertical',
        paddingAll: '12px',
        contents: [
          { type: 'text', text: '件名', weight: 'bold', size: 'sm', wrap: true },
          { type: 'text', text: '本文です。', margin: 'sm', size: 'xs', wrap: true },
        ],
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        contents: [
          { type: 'button', style: 'primary', action: { type: 'uri', label: '詳細を見る', uri: 'https://example.com' } },
        ],
      },
    }, null, 2),
  },
  {
    id: 'confirm',
    name: '確認ダイアログ',
    description: 'Yes/Noの2択',
    json: JSON.stringify({
      type: 'bubble',
      size: 'kilo',
      body: {
        type: 'box',
        layout: 'vertical',
        paddingAll: '14px',
        contents: [
          { type: 'text', text: '確認', weight: 'bold', size: 'xs', align: 'center' },
          { type: 'text', text: 'よろしいですか？', size: 'xs', align: 'center', margin: 'sm', wrap: true },
        ],
      },
      footer: {
        type: 'box',
        layout: 'horizontal',
        spacing: 'sm',
        contents: [
          { type: 'button', style: 'link', color: '#ccc', action: { type: 'message', label: 'いいえ', text: 'いいえ' } },
          { type: 'button', style: 'primary', action: { type: 'message', label: 'はい', text: 'はい' } },
        ],
      },
    }, null, 2),
  },
  {
    id: 'carousel-products',
    name: 'カルーセル',
    description: '複数商品を横スクロール',
    json: JSON.stringify({
      type: 'carousel',
      contents: [
        {
          type: 'bubble',
          hero: { type: 'image', url: 'https://placehold.jp/200x200.png', size: 'full', aspectRatio: '1:1', aspectMode: 'cover' },
          body: { type: 'box', layout: 'vertical', paddingAll: '10px', contents: [
            { type: 'text', text: '商品A', weight: 'bold', size: 'xs', wrap: true },
            { type: 'text', text: '¥1,000', size: 'xs', color: '#06C755', weight: 'bold' },
          ]},
          footer: { type: 'box', layout: 'vertical', contents: [
            { type: 'button', style: 'primary', action: { type: 'uri', label: '購入', uri: 'https://example.com/a' } },
          ]},
        },
        {
          type: 'bubble',
          hero: { type: 'image', url: 'https://placehold.jp/200x200.png', size: 'full', aspectRatio: '1:1', aspectMode: 'cover' },
          body: { type: 'box', layout: 'vertical', paddingAll: '10px', contents: [
            { type: 'text', text: '商品B', weight: 'bold', size: 'xs', wrap: true },
            { type: 'text', text: '¥2,000', size: 'xs', color: '#06C755', weight: 'bold' },
          ]},
          footer: { type: 'box', layout: 'vertical', contents: [
            { type: 'button', style: 'primary', action: { type: 'uri', label: '購入', uri: 'https://example.com/b' } },
          ]},
        },
      ],
    }, null, 2),
  },
  {
    id: 'simple-text',
    name: 'テキストのみ',
    description: 'シンプルなテキスト',
    json: JSON.stringify({
      type: 'bubble',
      size: 'kilo',
      body: {
        type: 'box',
        layout: 'vertical',
        paddingAll: '14px',
        contents: [
          { type: 'text', text: 'テキストメッセージ', wrap: true, size: 'sm' },
        ],
      },
    }, null, 2),
  },
]

interface FlexTemplatesProps {
  onSelect: (json: string) => void
}

export default function FlexTemplates({ onSelect }: FlexTemplatesProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const handleSelect = (tpl: FlexTemplate) => {
    setSelectedId(tpl.id)
    onSelect(tpl.json)
  }

  return (
    <div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {templates.map((tpl) => {
          const isSelected = selectedId === tpl.id
          return (
            <button
              key={tpl.id}
              type="button"
              onClick={() => handleSelect(tpl)}
              className={`text-left rounded-xl border transition-all overflow-hidden ${
                isSelected
                  ? 'border-green-500 ring-2 ring-green-200 bg-green-50'
                  : 'border-gray-200 hover:border-gray-300 bg-white hover:shadow-sm'
              }`}
            >
              {/* Visual preview */}
              <div className="bg-gray-50 p-2 flex items-center justify-center min-h-[100px]">
                <div className="scale-[0.35] origin-top-left transform-gpu" style={{ width: 240 }}>
                  <FlexPreviewComponent content={tpl.json} maxWidth={240} />
                </div>
              </div>
              {/* Label */}
              <div className="px-3 py-2 border-t border-gray-100">
                <p className="text-xs font-medium text-gray-800">{tpl.name}</p>
                <p className="text-[10px] text-gray-400 mt-0.5">{tpl.description}</p>
              </div>
            </button>
          )
        })}
      </div>
      {selectedId && (
        <p className="text-xs text-green-600 mt-3">テンプレートを適用しました。エディタで値を編集するか、そのまま保存できます。</p>
      )}
    </div>
  )
}
