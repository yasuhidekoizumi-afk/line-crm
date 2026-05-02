'use client'

import { useState, useEffect } from 'react'
import { fermentApi } from '@/lib/ferment-api'

interface MemberModalProps {
  segmentId: string
  segmentName: string
  onClose: () => void
}

interface CustomerInfo {
  customer_id: string
  display_name: string | null
  email: string | null
  line_user_id: string | null
  ltv: number
  order_count: number
  last_order_at: string | null
  region: string | null
}

export default function MemberModal({ segmentId, segmentName, onClose }: MemberModalProps) {
  const [customers, setCustomers] = useState<CustomerInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [page, setPage] = useState(0)
  const [total, setTotal] = useState(0)
  const PAGE_SIZE = 50

  const load = async (pageNum: number) => {
    setLoading(true)
    setError('')
    try {
      // Get member IDs
      const res = await fermentApi.segments.members(segmentId, { limit: PAGE_SIZE, offset: pageNum * PAGE_SIZE })
      if (!res.success || !res.data) {
        setError('メンバーの取得に失敗しました')
        setLoading(false)
        return
      }
      const ids = res.data as string[]
      setTotal(res.meta?.total ?? 0)

      // Fetch customer details
      const details: CustomerInfo[] = []
      for (const id of ids) {
        try {
          const custRes = await fermentApi.customers.get(id)
          if (custRes.success && custRes.data) {
            const c = custRes.data as Record<string, unknown>
            details.push({
              customer_id: id,
              display_name: (c.display_name as string) ?? null,
              email: (c.email as string) ?? null,
              line_user_id: (c.line_user_id as string) ?? null,
              ltv: (c.ltv as number) ?? 0,
              order_count: (c.order_count as number) ?? 0,
              last_order_at: (c.last_order_at as string) ?? null,
              region: (c.region as string) ?? null,
            })
          } else {
            details.push({ customer_id: id, display_name: null, email: null, line_user_id: null, ltv: 0, order_count: 0, last_order_at: null, region: null })
          }
        } catch {
          details.push({ customer_id: id, display_name: null, email: null, line_user_id: null, ltv: 0, order_count: 0, last_order_at: null, region: null })
        }
      }
      setCustomers(details)
    } catch {
      setError('読み込みに失敗しました')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load(page) }, [page])

  const totalPages = Math.ceil(total / PAGE_SIZE)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 shrink-0">
          <div>
            <h2 className="text-base font-bold text-gray-900">{segmentName}</h2>
            <p className="text-xs text-gray-400 mt-0.5">セグメントメンバー {total.toLocaleString()}人</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-400">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="overflow-y-auto flex-1 px-6 py-4">
          {error && <div className="mb-4 p-3 bg-red-50 text-red-600 rounded-lg text-sm">{error}</div>}

          {loading ? (
            <div className="space-y-3">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="h-12 bg-gray-100 rounded-lg animate-pulse" />
              ))}
            </div>
          ) : customers.length === 0 ? (
            <div className="text-center py-12 text-gray-400 text-sm">メンバーがいません</div>
          ) : (
            <div className="space-y-1">
              {/* Header row */}
              <div className="flex items-center gap-3 px-3 py-2 text-xs font-semibold text-gray-400 uppercase tracking-wider">
                <div className="w-8">#</div>
                <div className="flex-1">表示名</div>
                <div className="w-28 text-right">累計購入額</div>
                <div className="w-20 text-right">注文数</div>
                <div className="w-32 text-right">最終注文</div>
              </div>
              {customers.map((c, i) => (
                <div key={c.customer_id} className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-gray-50 text-sm">
                  <div className="w-8 text-xs text-gray-400">{page * PAGE_SIZE + i + 1}</div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-gray-900 truncate">
                      {c.display_name ?? <span className="text-gray-400">（名前なし）</span>}
                    </p>
                    <p className="text-xs text-gray-400 truncate">
                      {c.email ?? ''}{c.email && c.line_user_id ? ' / ' : ''}
                      {c.line_user_id ? 'LINE連携' : ''}
                      {c.region ? ` / ${c.region}` : ''}
                    </p>
                  </div>
                  <div className="w-28 text-right text-gray-700">
                    {c.ltv > 0 ? `¥${c.ltv.toLocaleString()}` : '-'}
                  </div>
                  <div className="w-20 text-right text-gray-700">
                    {c.order_count > 0 ? `${c.order_count}回` : '-'}
                  </div>
                  <div className="w-32 text-right text-xs text-gray-500">
                    {c.last_order_at ? new Date(c.last_order_at).toLocaleDateString('ja-JP') : '-'}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-6 py-3 border-t border-gray-100 shrink-0">
            <button
              onClick={() => setPage(Math.max(0, page - 1))}
              disabled={page === 0}
              className="px-3 py-1.5 text-xs font-medium text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-40"
            >
              ← 前へ
            </button>
            <span className="text-xs text-gray-500">{page + 1} / {totalPages} ページ</span>
            <button
              onClick={() => setPage(Math.min(totalPages - 1, page + 1))}
              disabled={page >= totalPages - 1}
              className="px-3 py-1.5 text-xs font-medium text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-40"
            >
              次へ →
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
