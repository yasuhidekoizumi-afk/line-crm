'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { TEMPLATE_LIBRARY, type TemplateLibraryItem } from '@/lib/template-library'
import { fermentApi } from '@/lib/ferment-api'

const CATEGORIES = [
  { id: '', label: 'すべて' },
  { id: 'welcome', label: 'ウェルカム' },
  { id: 'newsletter', label: 'ニュースレター' },
  { id: 'launch', label: '新商品' },
  { id: 'winback', label: '休眠復帰' },
  { id: 'vip', label: 'VIP' },
  { id: 'cart', label: 'カゴ落ち' },
  { id: 'review', label: 'レビュー依頼' },
  { id: 'event', label: 'イベント' },
  { id: 'thanks', label: '感謝' },
  { id: 'advanced', label: '動的コンテンツ' },
]

export default function TemplateLibraryPage() {
  const router = useRouter()
  const [filter, setFilter] = useState('')
  const [previewItem, setPreviewItem] = useState<TemplateLibraryItem | null>(null)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')

  const items = filter ? TEMPLATE_LIBRARY.filter((t) => t.category === filter) : TEMPLATE_LIBRARY

  const handleCreate = async (item: TemplateLibraryItem) => {
    setCreating(true)
    setError('')
    try {
      const res = await fermentApi.templates.create({
        name: item.name,
        category: item.category,
        language: 'ja',
        subject_base: item.subject,
        body_html: item.body_html,
        from_name: 'オリゼ',
      })
      if (res.success && res.data) {
        router.push(`/email/templates/edit?id=${res.data.template_id}`)
      } else {
        setError(res.error ?? '作成に失敗しました')
      }
    } catch {
      setError('作成に失敗しました')
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="max-w-6xl mx-auto py-8 px-4">
      <div className="flex items-center justify-between mb-4">
        <div>
          <button onClick={() => router.push('/email/templates')} className="text-sm text-gray-500 hover:text-gray-700">
            ← テンプレ一覧に戻る
          </button>
          <h1 className="text-2xl font-bold text-gray-900 mt-1">テンプレートライブラリ</h1>
          <p className="text-sm text-gray-500 mt-1">用意済みのテンプレから選んで、すぐに編集開始</p>
        </div>
      </div>

      {error && <div className="mb-4 p-3 bg-red-50 text-red-600 rounded-lg text-sm">{error}</div>}

      {/* カテゴリフィルター */}
      <div className="flex flex-wrap gap-2 mb-6">
        {CATEGORIES.map((c) => (
          <button
            key={c.id}
            onClick={() => setFilter(c.id)}
            className={`px-3 py-1.5 text-sm rounded-full border transition-colors ${
              filter === c.id
                ? 'bg-green-600 text-white border-green-600'
                : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'
            }`}
          >
            {c.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {items.map((item) => (
          <div key={item.id} className="bg-white border border-gray-200 rounded-xl overflow-hidden hover:border-green-300 transition-colors">
            <div className="p-6 text-center bg-gradient-to-br from-gray-50 to-white border-b border-gray-100">
              <div className="text-5xl mb-2">{item.thumbnail}</div>
              <h3 className="font-semibold text-gray-900">{item.name}</h3>
            </div>
            <div className="p-4">
              <p className="text-xs text-gray-500 mb-3">{item.description}</p>
              <div className="flex gap-2">
                <button
                  onClick={() => setPreviewItem(item)}
                  className="flex-1 px-3 py-1.5 text-xs text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50"
                >
                  プレビュー
                </button>
                <button
                  onClick={() => handleCreate(item)}
                  disabled={creating}
                  className="flex-1 px-3 py-1.5 text-xs bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
                >
                  {creating ? '作成中...' : 'これを使う'}
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* プレビューモーダル */}
      {previewItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setPreviewItem(null)}>
          <div className="bg-white rounded-xl max-w-2xl w-full max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-center px-4 py-3 border-b">
              <div>
                <h3 className="font-semibold text-gray-800">{previewItem.name}</h3>
                <p className="text-xs text-gray-500 mt-0.5">件名: {previewItem.subject}</p>
              </div>
              <button onClick={() => setPreviewItem(null)} className="text-gray-400 hover:text-gray-600">✕</button>
            </div>
            <div className="flex-1 overflow-auto p-4 bg-gray-100">
              <iframe srcDoc={previewItem.body_html} className="w-full bg-white border rounded-lg" style={{ minHeight: '500px' }} sandbox="allow-same-origin" />
            </div>
            <div className="px-4 py-3 border-t flex gap-2 justify-end">
              <button onClick={() => setPreviewItem(null)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">閉じる</button>
              <button onClick={() => handleCreate(previewItem)} disabled={creating} className="px-4 py-2 text-sm bg-green-600 text-white rounded-lg disabled:opacity-50">
                {creating ? '作成中...' : 'これを使って編集開始'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
