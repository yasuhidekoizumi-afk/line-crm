'use client'

import { useState, useEffect, useCallback } from 'react'
import { fetchApi } from '@/lib/api'

interface Review {
  review_id: string
  email: string
  product_title: string | null
  rating: number
  comment: string | null
  is_published: number
  created_at: string
}

interface ApiResult<T> {
  success: boolean
  data?: T
  error?: string
}

const WORKER_URL = 'https://oryzae-line-crm.oryzae.workers.dev'

function fmt(iso: string) {
  return new Date(iso).toLocaleString('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit' })
}

export default function ReviewsPage() {
  const [reviews, setReviews] = useState<Review[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showSnippet, setShowSnippet] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetchApi<ApiResult<Review[]>>('/api/reviews')
      if (r.success && r.data) setReviews(r.data)
    } catch {
      setError('読み込みに失敗しました')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const handlePublish = async (id: string) => {
    await fetchApi<ApiResult<null>>(`/api/reviews/${id}/publish`, { method: 'PUT' })
    await load()
  }

  const handleDelete = async (id: string) => {
    if (!confirm('このレビューを削除しますか？')) return
    await fetchApi<ApiResult<null>>(`/api/reviews/${id}`, { method: 'DELETE' })
    await load()
  }

  const snippet = `<form action="${WORKER_URL}/reviews/submit" method="POST" enctype="application/json">
  <input type="email" name="email" required placeholder="メールアドレス" />
  <input type="hidden" name="product_id" value="{{product.id}}" />
  <input type="hidden" name="product_title" value="{{product.title}}" />
  <select name="rating" required>
    <option value="5">★★★★★</option>
    <option value="4">★★★★</option>
    <option value="3">★★★</option>
    <option value="2">★★</option>
    <option value="1">★</option>
  </select>
  <textarea name="comment" placeholder="ご感想"></textarea>
  <button type="submit">投稿する</button>
</form>`

  return (
    <div className="max-w-6xl mx-auto py-8 px-4">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">レビュー管理</h1>
          <p className="text-sm text-gray-500 mt-1">お客様から寄せられたレビューの確認・公開設定</p>
        </div>
        <button
          onClick={() => setShowSnippet(!showSnippet)}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"
        >
          📝 投稿フォーム埋め込みコード
        </button>
      </div>

      {error && <div className="mb-4 p-3 bg-red-50 text-red-600 rounded-lg text-sm">{error}</div>}

      {showSnippet && (
        <div className="mb-4 p-4 bg-blue-50 border border-blue-200 rounded-xl">
          <div className="flex justify-between items-start mb-2">
            <h3 className="text-sm font-semibold text-blue-900">Shopify 商品ページに貼り付け（HTML form 例）</h3>
            <button onClick={() => setShowSnippet(false)} className="text-gray-400 hover:text-gray-600">×</button>
          </div>
          <pre className="text-xs bg-white p-3 rounded border border-blue-100 overflow-x-auto">{snippet}</pre>
          <p className="text-xs text-blue-700 mt-2">送信先 API: <code>POST {WORKER_URL}/reviews/submit</code></p>
          <p className="text-xs text-blue-700">受け取ったレビューはこの管理画面に表示され、「公開」ボタンで Shopify 等に表示できます</p>
        </div>
      )}

      {loading ? (
        <div className="text-center py-12 text-gray-400">読み込み中...</div>
      ) : reviews.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-xl border border-dashed border-gray-300">
          <p className="text-gray-500 mb-2">まだレビューがありません</p>
          <p className="text-sm text-gray-400">商品ページに投稿フォームを埋め込んで集めましょう</p>
        </div>
      ) : (
        <div className="grid gap-4">
          {reviews.map((r) => (
            <div key={r.review_id} className="bg-white border border-gray-200 rounded-xl p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-2">
                    <span className="text-yellow-500">{'★'.repeat(r.rating)}{'☆'.repeat(5 - r.rating)}</span>
                    {r.is_published === 1 ? (
                      <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded font-medium">公開中</span>
                    ) : (
                      <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded font-medium">未公開</span>
                    )}
                    <span className="text-xs text-gray-400">{fmt(r.created_at)}</span>
                  </div>
                  {r.product_title && (
                    <p className="text-sm font-medium text-gray-700 mb-1">商品: {r.product_title}</p>
                  )}
                  {r.comment && (
                    <p className="text-sm text-gray-600 mb-1 whitespace-pre-wrap">{r.comment}</p>
                  )}
                  <p className="text-xs text-gray-400">投稿者: {r.email}</p>
                </div>
                <div className="flex flex-col gap-2 shrink-0">
                  {r.is_published === 0 && (
                    <button onClick={() => handlePublish(r.review_id)}
                      className="px-3 py-1.5 text-xs bg-green-600 text-white rounded-lg hover:bg-green-700">公開</button>
                  )}
                  <button onClick={() => handleDelete(r.review_id)}
                    className="px-3 py-1.5 text-xs text-red-500 border border-red-200 rounded-lg hover:bg-red-50">削除</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
