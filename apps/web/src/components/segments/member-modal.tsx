'use client'

import { useState, useEffect } from 'react'
import { fermentApi } from '@/lib/ferment-api'

interface MemberModalProps {
  segmentId: string
  segmentName: string
  onClose: () => void
}

export default function MemberModal({ segmentId, segmentName, onClose }: MemberModalProps) {
  const [memberIds, setMemberIds] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [page, setPage] = useState(0)
  const [total, setTotal] = useState(0)
  const PAGE_SIZE = 100

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      setError('')
      try {
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
        setMemberIds(res.data as unknown as string[])
        setTotal(res.meta?.total ?? 0)
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
        className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[85vh] flex flex-col"
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
                <div key={i} className="h-8 bg-gray-100 rounded-lg animate-pulse" />
              ))}
            </div>
          ) : memberIds.length === 0 ? (
            <div className="text-center py-8 text-gray-400 text-sm">メンバーがいません</div>
          ) : (
            <div className="space-y-1">
              {memberIds.map((id, i) => (
                <div key={id} className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-gray-50 text-sm">
                  <span className="text-xs text-gray-400 w-6 shrink-0">{page * PAGE_SIZE + i + 1}</span>
                  <code className="flex-1 text-xs text-gray-700 font-mono truncate">{id}</code>
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
