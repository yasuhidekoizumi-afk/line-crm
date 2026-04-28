'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { fetchApi } from '@/lib/api'
import Header from '@/components/layout/header'

interface CohortRow {
  cohort_month: string
  first_order_customers: number
  repeat_customers: number
  repeat_rate_pct: number
  line_linked_customers: number
  line_link_rate_pct: number
  line_repeat_customers: number
  line_repeat_rate_pct: number | null
  noline_repeat_customers: number
  noline_repeat_rate_pct: number | null
}

const num = (n: number) => Math.round(n).toLocaleString('ja-JP')

export default function CohortPage() {
  const [cohort, setCohort] = useState<CohortRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [from, setFrom] = useState('2025-01')
  const [to, setTo] = useState('2026-12')

  useEffect(() => {
    let cancelled = false
    void (async () => {
      setLoading(true)
      try {
        const res = await fetchApi<{ success: boolean; data: CohortRow[] }>(
          `/api/customer-journey/cohort?from=${from}&to=${to}`,
        )
        if (cancelled) return
        if (res.success) setCohort(res.data)
      } catch (e) {
        if (!cancelled) setError(`読み込み失敗: ${String(e)}`)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [from, to])

  // メトリクス
  const totalNew = cohort.reduce((s, c) => s + c.first_order_customers, 0)
  const totalRepeat = cohort.reduce((s, c) => s + c.repeat_customers, 0)
  const totalLine = cohort.reduce((s, c) => s + c.line_linked_customers, 0)
  const overallRepeatRate = totalNew > 0 ? (totalRepeat / totalNew) * 100 : 0
  const overallLineRate = totalNew > 0 ? (totalLine / totalNew) * 100 : 0

  return (
    <div>
      <Header title="コホート分析" />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
          <div>
            <Link href="/shopify-bi" className="text-sm text-indigo-600 hover:text-indigo-800">
              ← 売上分析 TOP
            </Link>
            <h1 className="text-2xl font-bold text-gray-900 mt-1">📈 コホート分析</h1>
            <p className="text-sm text-gray-500">
              月別 × LINE連携状態 のリピート率比較
            </p>
          </div>
          <div className="flex gap-2 items-end">
            <div>
              <label className="text-xs text-gray-500 block">From</label>
              <input
                type="month"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="px-2 py-1 border border-gray-300 rounded text-sm"
              />
            </div>
            <div>
              <label className="text-xs text-gray-500 block">To</label>
              <input
                type="month"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="px-2 py-1 border border-gray-300 rounded text-sm"
              />
            </div>
          </div>
        </div>

        {error && (
          <div className="rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {loading ? (
          <div className="text-center text-gray-400 py-12">読み込み中…</div>
        ) : (
          <>
            {/* サマリ */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="bg-white border border-gray-200 rounded-lg px-4 py-3">
                <div className="text-xs text-gray-500">期間内 新規顧客</div>
                <div className="text-xl font-bold mt-1">{num(totalNew)}</div>
              </div>
              <div className="bg-white border border-gray-200 rounded-lg px-4 py-3">
                <div className="text-xs text-gray-500">期間内 リピート顧客</div>
                <div className="text-xl font-bold mt-1">{num(totalRepeat)}</div>
              </div>
              <div className="bg-white border border-gray-200 rounded-lg px-4 py-3">
                <div className="text-xs text-gray-500">平均リピート率</div>
                <div className="text-xl font-bold mt-1">{overallRepeatRate.toFixed(1)}%</div>
              </div>
              <div className="bg-white border border-gray-200 rounded-lg px-4 py-3">
                <div className="text-xs text-gray-500">平均LINE連携率</div>
                <div className="text-xl font-bold mt-1">{overallLineRate.toFixed(1)}%</div>
              </div>
            </div>

            {/* テーブル */}
            <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-xs text-gray-600">
                    <tr>
                      <th className="px-3 py-2 text-left">月</th>
                      <th className="px-3 py-2 text-right">新規</th>
                      <th className="px-3 py-2 text-right">リピート率</th>
                      <th className="px-3 py-2 text-right">LINE連携率</th>
                      <th className="px-3 py-2 text-right">連携リピート率</th>
                      <th className="px-3 py-2 text-right">非連携リピート率</th>
                      <th className="px-3 py-2 hidden md:table-cell">差分</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {cohort.map((c) => {
                      const isAnomaly =
                        c.first_order_customers >= 200 && c.line_link_rate_pct < 15
                      const diff =
                        c.line_repeat_rate_pct !== null && c.noline_repeat_rate_pct !== null
                          ? c.line_repeat_rate_pct - c.noline_repeat_rate_pct
                          : null
                      return (
                        <tr key={c.cohort_month} className={isAnomaly ? 'bg-red-50' : ''}>
                          <td className="px-3 py-2 font-medium text-gray-900">
                            {c.cohort_month}
                            {isAnomaly && <span className="ml-1">⚠️</span>}
                          </td>
                          <td className="px-3 py-2 text-right text-gray-700 tabular-nums">
                            {num(c.first_order_customers)}
                          </td>
                          <td className="px-3 py-2 text-right text-gray-700 tabular-nums">
                            {c.repeat_rate_pct}%
                          </td>
                          <td
                            className={`px-3 py-2 text-right font-medium tabular-nums ${
                              c.line_link_rate_pct >= 40
                                ? 'text-green-700'
                                : c.line_link_rate_pct >= 20
                                ? 'text-yellow-700'
                                : 'text-red-700'
                            }`}
                          >
                            {c.line_link_rate_pct}%
                          </td>
                          <td className="px-3 py-2 text-right text-indigo-700 font-medium tabular-nums">
                            {c.line_repeat_rate_pct ?? '—'}%
                          </td>
                          <td className="px-3 py-2 text-right text-gray-500 tabular-nums">
                            {c.noline_repeat_rate_pct ?? '—'}%
                          </td>
                          <td className="px-3 py-2 hidden md:table-cell">
                            {diff !== null && (
                              <span
                                className={
                                  diff > 0
                                    ? 'text-green-700 font-medium'
                                    : diff < 0
                                    ? 'text-red-700'
                                    : 'text-gray-500'
                                }
                              >
                                {diff > 0 ? '+' : ''}
                                {diff.toFixed(1)}pt
                              </span>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* LINE連携率の縦棒グラフ */}
            <div className="bg-white border border-gray-200 rounded-lg p-4 sm:p-6">
              <div className="font-bold text-gray-900 mb-1">月別 LINE連携率の推移</div>
              <p className="text-xs text-gray-500 mb-4">
                40%以上を緑、20%未満を赤で表示。新規200人以上&15%未満は異常値。
              </p>
              <div className="flex items-end gap-1 sm:gap-2 h-48 overflow-x-auto pb-2">
                {cohort.map((c) => {
                  const h = Math.max(2, Math.min(100, c.line_link_rate_pct))
                  const color =
                    c.line_link_rate_pct >= 40
                      ? 'bg-green-500'
                      : c.line_link_rate_pct >= 20
                      ? 'bg-yellow-500'
                      : 'bg-red-500'
                  return (
                    <div key={c.cohort_month} className="flex flex-col items-center gap-1 min-w-[36px]">
                      <div className="text-[10px] text-gray-700 tabular-nums">
                        {c.line_link_rate_pct}%
                      </div>
                      <div
                        className={`w-6 sm:w-8 ${color} rounded-t`}
                        style={{ height: `${h}%` }}
                        title={`${c.cohort_month}: ${c.line_link_rate_pct}% (${num(
                          c.first_order_customers,
                        )}人)`}
                      />
                      <div className="text-[10px] text-gray-500 transform -rotate-45 origin-top-left mt-2 whitespace-nowrap">
                        {c.cohort_month.slice(2)}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
