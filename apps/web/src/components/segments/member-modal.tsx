'use client'

import { useState, useEffect } from 'react'
import { fermentApi } from '@/lib/ferment-api'

interface MemberModalProps {
  segmentId: string
  segmentName: string
  onClose: () => void
}

interface MemberInfo {
  customer_id: string
  display_name: string
  email: string
}

export default function MemberModal({ segmentId, segmentName, onClose }: MemberModalProps) {
  const [members, setMembers] = useState<MemberInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [page, setPage] = useState(0)
  const [total, setTotal] = useState(0)
  const PAGE_SIZE = 50

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      setError('')
      try {
        // Step 1: Get member IDs
        const res = await fermentApi.segments.members(segmentId, {
          limit: PAGE_SIZE,
          offset: page * PAGE_SIZE,
        })
        if (cancelled) return
        if (!res.success || !res.data) {
          setError(res.error ?? 'メンバーの取得に失敗しました')
          setLoading(false)
          return
        }
        const ids = res.data as unknown as string[]
        setTotal(res.meta?.total ?? 0)

        // Step 2: Fetch customer details in parallel
        const customerPromises = ids.map((id) =>
          fermentApi.customers.get(id).catch(() => null)
        )
        const results = await Promise.all(customerPromises)
        if (cancelled) return

        const info: MemberInfo[] = []
        for (let i = 0; i < ids.length; i++) {
          const c = results[i]?.data as Record<string, unknown> | undefined
          info.push({
            customer_id: ids[i],
            display_name: c ? String(c.display_name ?? c.email ?? '') : '',
            email: c ? String(c.email ?? '') : '',
          })
        }
        setMembers(info)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : '読み込みに失敗しました')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [segmentId, page])

  const totalPages = Math.ceil(total / PAGE_SIZE)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-xl max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 shrink-0">
          <div>
            <h2 className="text-base font-bold text-gray-900">{segmentName}</h2>
            <p className="text-xs text-gray-400 mt-0.5">メンバー {total.toLocaleString()}人</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-400">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="overflow-y-auto flex-1 px-6 py-4">
          {error && (
            <div className="p-3 bg-red-50 text-red-600 rounded-lg text-sm">{error}</div>
          )}
          {loading ? (
            <div className="space-y-2">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="h-10 bg-gray-100 rounded-lg animate-pulse" />
              ))}
            </div>
          ) : members.length === 0 ? (
            <div className="text-center py-8 text-gray-400 text-sm">メンバーがいません</div>
          ) : (
            <div className="space-y-1">
              {/* Header */}
              <div className="flex items-center gap-3 px-3 py-2 text-xs font-semibold text-gray-400 uppercase tracking-wider">
                <div className="w-6 shrink-0">#</div>
                <div className="flex-1">表示名</div>
                <div className="w-48">メールアドレス</div>
              </div>
              {members.map((m, i) => (
                <div key={m.customer_id} className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-gray-50 text-sm">
                  <div className="w-6 shrink-0 text-xs text-gray-400">{page * PAGE_SIZE + i + 1}</div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-gray-900 truncate">
                      {m.display_name || <span className="text-gray-400">（名前なし）</span>}
                    </p>
                  </div>
                  <div className="w-48 text-xs text-gray-500 truncate">
                    {m.email || '-'}
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
            >← 前へ</button>
            <span className="text-xs text-gray-500">{page + 1} / {totalPages}</span>
            <button
              onClick={() => setPage(Math.min(totalPages - 1, page + 1))}
              disabled={page >= totalPages - 1}
              className="px-3 py-1.5 text-xs font-medium text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-40"
            >次へ →</button>
          </div>
        )}
      </div>
    </div>
  )
}
