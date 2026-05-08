'use client'

import { useState } from 'react'

interface QuickReplyProps {
  onSelect: (text: string) => void
}

const TEMPLATES = [
  {
    category: '挨拶・基本',
    items: [
      { label: 'お問い合わせ感謝', text: 'お問い合わせいただきありがとうございます。\n\nご連絡いただいた内容について、確認させていただきます。' },
      { label: '少々お待ちください', text: '確認にお時間をいただいております。\n今しばらくお待ちくださいませ。' },
      { label: '返信ありがとう', text: 'ご返信ありがとうございます。\nいただいた内容を承りました。' },
    ],
  },
  {
    category: 'クレーム・トラブル',
    items: [
      { label: 'お詫び（基本）', text: 'このたびはご不便をおかけし、誠に申し訳ございません。\n状況を確認の上、改めてご連絡させていただきます。' },
      { label: 'お詫び（詳細確認中）', text: 'ご迷惑をおかけしておりますこと、深くお詫び申し上げます。\n現在、担当部門にて詳細を確認しておりますので、今しばらくお待ちください。' },
      { label: '交換・返品案内', text: '商品に不備があったとのこと、大変申し訳ございません。\n交換・返品をご希望の場合は、注文番号と不備の詳細をお知らせください。' },
    ],
  },
  {
    category: '購入・フォロー',
    items: [
      { label: 'ご購入ありがとう', text: 'このたびはご購入いただき、誠にありがとうございます！\nご不明な点がございましたら、いつでもお気軽にお問い合わせください。' },
      { label: '定期便のご案内', text: 'いつもKOJIPOPをご愛顧いただきありがとうございます。\n定期便に切り替えると、毎回お届けしてお得にご利用いただけます。' },
      { label: 'レビューお願い', text: 'ご購入いただいた商品はいかがでしたか？\nよろしければレビューのご投稿をお願いいたします。' },
    ],
  },
  {
    category: 'LINE連携',
    items: [
      { label: 'LINE連携のお願い', text: 'LINEアカウントとShopifyアカウントを連携すると、購入履歴に基づいたポイントやお得な情報をお届けできます。\nお手数ですが、マイページから連携をお願いいたします。' },
      { label: 'ポイント残高案内', text: '現在のポイント残高はマイページからご確認いただけます。\n貯まったポイントは次回のお買い物にご利用いただけます。' },
    ],
  },
  {
    category: '締め・フォローアップ',
    items: [
      { label: '解決確認', text: 'お困りの点は解消されましたでしょうか？\n引き続き何かございましたら、お気軽にご連絡ください。' },
      { label: 'クロージング', text: 'このたびはご連絡いただきありがとうございました。\nまた何かございましたら、いつでもお問い合わせくださいませ。' },
    ],
  },
]

export default function QuickReplyTemplates({ onSelect }: QuickReplyProps) {
  const [open, setOpen] = useState(false)
  const [activeCategory, setActiveCategory] = useState(0)

  if (!open) {
    return (
      <div className="mb-2">
        <button
          onClick={() => setOpen(true)}
          className="text-xs text-indigo-600 hover:text-indigo-800 flex items-center gap-1"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
          定型文テンプレート
        </button>
      </div>
    )
  }

  const cat = TEMPLATES[activeCategory]

  return (
    <div className="mb-2 border border-gray-200 rounded-lg bg-white shadow-sm">
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-100">
        <div className="flex gap-1 overflow-x-auto">
          {TEMPLATES.map((t, i) => (
            <button
              key={t.category}
              onClick={() => setActiveCategory(i)}
              className={`text-xs px-2 py-1 rounded whitespace-nowrap ${
                activeCategory === i
                  ? 'bg-indigo-100 text-indigo-700 font-medium'
                  : 'text-gray-500 hover:bg-gray-100'
              }`}
            >
              {t.category}
            </button>
          ))}
        </div>
        <button
          onClick={() => setOpen(false)}
          className="text-gray-400 hover:text-gray-600 shrink-0 ml-2"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
      <div className="p-2 flex flex-wrap gap-1.5">
        {cat.items.map((item) => (
          <button
            key={item.label}
            onClick={() => {
              onSelect(item.text)
              setOpen(false)
            }}
            className="text-xs px-2.5 py-1.5 bg-gray-50 hover:bg-indigo-50 hover:text-indigo-700 border border-gray-200 hover:border-indigo-200 rounded-md transition-colors text-left"
          >
            {item.label}
          </button>
        ))}
      </div>
    </div>
  )
}
