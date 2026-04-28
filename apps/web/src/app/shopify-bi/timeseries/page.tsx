'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { fetchApi } from '@/lib/api'
import Header from '@/components/layout/header'

interface SeriesPoint {
  period: string
  orders: number
  revenue: number
  line_revenue: number
  line_orders: number
  unique_customers: number
}

interface TimeseriesData {
  granularity: 'day' | 'week' | 'month'
  range: string
  from: string | null
  to: string
  series: SeriesPoint[]
  summary: { total_orders: number; total_revenue: number; line_revenue: number; unique_customers: number }
  comparison: { prev_total_revenue: number; pct_change: number | null } | null
}

const yen = (n: number) => '¥' + Math.round(n).toLocaleString('ja-JP')
const num = (n: number) => Math.round(n).toLocaleString('ja-JP')

type Preset = {
  key: string
  label: string
  granularity: 'day' | 'week' | 'month'
  range: '7d' | '30d' | '90d' | '180d' | '1y' | 'all'
}

const PRESETS: Preset[] = [
  { key: 'today', label: '今日', granularity: 'day', range: '7d' },
  { key: 'week', label: '今週', granularity: 'day', range: '7d' },
  { key: 'month', label: '今月', granularity: 'day', range: '30d' },
  { key: '3m', label: '直近90日', granularity: 'week', range: '90d' },
  { key: '1y', label: '1年', granularity: 'month', range: '1y' },
]

export default function TimeseriesPage() {
  const [preset, setPreset] = useState<Preset>(PRESETS[2]) // 今月（デフォルト）
  const [data, setData] = useState<TimeseriesData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      setLoading(true)
      try {
        const res = await fetchApi<{ success: boolean; data: TimeseriesData }>(
          `/api/shopify/orders/timeseries?granularity=${preset.granularity}&range=${preset.range}`,
        )
        if (cancelled) return
        if (res.success) setData(res.data)
      } catch (e) {
        if (!cancelled) setError(`読み込み失敗: ${String(e)}`)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [preset])

  // グラフ最大値
  const maxRevenue = data ? Math.max(...data.series.map((s) => s.revenue), 1) : 1

  // 直近期間（preset によって表示切替）
  const filteredSeries = data?.series ?? []
  const recent = preset.key === 'today' ? filteredSeries.slice(-1) : filteredSeries.slice(-30)

  // LINE経由比率
  const lineSharePct =
    data && data.summary.total_revenue > 0
      ? (data.summary.line_revenue / data.summary.total_revenue) * 100
      : 0

  return (
    <div>
      <Header title="時系列分析" />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        <div>
          <Link href="/shopify-bi" className="text-sm text-indigo-600 hover:text-indigo-800">
            ← 売上分析 TOP
          </Link>
          <h1 className="text-2xl font-bold text-gray-900 mt-1">📅 時系列分析</h1>
          <p className="text-sm text-gray-500">
            日次 / 週次 / 月次 の売上推移と前期間比較
          </p>
        </div>

        {/* プリセット切替 */}
        <div className="flex flex-wrap gap-2">
          {PRESETS.map((p) => (
            <button
              key={p.key}
              onClick={() => setPreset(p)}
              className={`px-3 py-1.5 text-sm rounded-md border ${
                preset.key === p.key
                  ? 'bg-indigo-600 text-white border-indigo-600'
                  : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>

        {error && (
          <div className="rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {loading || !data ? (
          <div className="text-center text-gray-400 py-12">読み込み中…</div>
        ) : (
          <>
            {/* サマリ KPI */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="bg-white border border-gray-200 rounded-lg px-4 py-3">
                <div className="text-xs text-gray-500">期間内 売上</div>
                <div className="text-xl font-bold mt-1 tabular-nums">
                  {yen(data.summary.total_revenue)}
                </div>
                {data.comparison?.pct_change !== null && data.comparison?.pct_change !== undefined && (
                  <div
                    className={`text-xs mt-0.5 ${
                      data.comparison.pct_change > 0
                        ? 'text-green-700'
                        : data.comparison.pct_change < 0
                        ? 'text-red-700'
                        : 'text-gray-500'
                    }`}
                  >
                    {data.comparison.pct_change > 0 ? '↑' : data.comparison.pct_change < 0 ? '↓' : '→'}{' '}
                    {Math.abs(data.comparison.pct_change)}% vs 前期
                  </div>
                )}
              </div>
              <div className="bg-white border border-gray-200 rounded-lg px-4 py-3">
                <div className="text-xs text-gray-500">注文数</div>
                <div className="text-xl font-bold mt-1 tabular-nums">{num(data.summary.total_orders)}</div>
              </div>
              <div className="bg-white border border-gray-200 rounded-lg px-4 py-3">
                <div className="text-xs text-gray-500">ユニーク顧客</div>
                <div className="text-xl font-bold mt-1 tabular-nums">{num(data.summary.unique_customers)}</div>
              </div>
              <div className="bg-white border border-gray-200 rounded-lg px-4 py-3">
                <div className="text-xs text-gray-500">LINE経由比率</div>
                <div className="text-xl font-bold mt-1 tabular-nums">{lineSharePct.toFixed(1)}%</div>
                <div className="text-xs text-gray-500 mt-0.5">{yen(data.summary.line_revenue)}</div>
              </div>
            </div>

            {/* 縦棒グラフ（pixel高さで描画） */}
            <div className="bg-white border border-gray-200 rounded-lg p-4 sm:p-6">
              <div className="font-bold text-gray-900 mb-1">
                売上推移（{data.granularity === 'day' ? '日次' : data.granularity === 'week' ? '週次' : '月次'}）
              </div>
              <p className="text-xs text-gray-500 mb-4">
                青：全体売上 / 緑：LINE経由（最大値 {yen(maxRevenue)}）
              </p>
              <div className="overflow-x-auto pb-2">
                <div className="flex items-end gap-1" style={{ height: '180px' }}>
                  {filteredSeries.map((s) => {
                    const BAR_AREA_PX = 180
                    const barH = Math.max(2, (s.revenue / maxRevenue) * BAR_AREA_PX)
                    const lineRatio = s.revenue > 0 ? (s.line_revenue / s.revenue) * 100 : 0
                    return (
                      <div
                        key={s.period}
                        className="relative w-4 sm:w-5 bg-blue-300 rounded-t-sm flex-shrink-0"
                        style={{ height: `${barH}px` }}
                        title={`${s.period}: ${yen(s.revenue)} (LINE ${yen(s.line_revenue)} / ${lineRatio.toFixed(1)}%)`}
                      >
                        <div
                          className="absolute bottom-0 left-0 w-full bg-green-500 rounded-t-sm"
                          style={{ height: `${lineRatio}%` }}
                        />
                      </div>
                    )
                  })}
                </div>
                <div className="flex gap-1 mt-1">
                  {filteredSeries.map((s) => (
                    <div
                      key={s.period}
                      className="w-4 sm:w-5 text-[9px] text-gray-500 text-center flex-shrink-0 transform -rotate-45 origin-top-left whitespace-nowrap"
                    >
                      {data.granularity === 'month' ? s.period.slice(2) : s.period.slice(5)}
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* 詳細テーブル */}
            <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
              <div className="px-4 sm:px-5 py-3 border-b border-gray-200 bg-gray-50">
                <h2 className="font-bold text-gray-900">期間別 詳細</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-xs text-gray-600">
                    <tr>
                      <th className="px-3 py-2 text-left">期間</th>
                      <th className="px-3 py-2 text-right">注文</th>
                      <th className="px-3 py-2 text-right">売上</th>
                      <th className="px-3 py-2 text-right">LINE経由</th>
                      <th className="px-3 py-2 text-right">LINE比率</th>
                      <th className="px-3 py-2 text-right hidden md:table-cell">顧客数</th>
                      <th className="px-3 py-2 text-right hidden md:table-cell">客単価</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {[...filteredSeries].reverse().map((s) => {
                      const lineShare = s.revenue > 0 ? (s.line_revenue / s.revenue) * 100 : 0
                      const aov = s.orders > 0 ? Math.round(s.revenue / s.orders) : 0
                      return (
                        <tr key={s.period}>
                          <td className="px-3 py-2 font-medium text-gray-900 tabular-nums">{s.period}</td>
                          <td className="px-3 py-2 text-right text-gray-700 tabular-nums">{num(s.orders)}</td>
                          <td className="px-3 py-2 text-right font-medium text-gray-900 tabular-nums">
                            {yen(s.revenue)}
                          </td>
                          <td className="px-3 py-2 text-right text-indigo-700 tabular-nums">
                            {yen(s.line_revenue)}
                          </td>
                          <td
                            className={`px-3 py-2 text-right font-medium tabular-nums ${
                              lineShare >= 50 ? 'text-green-700' : lineShare >= 30 ? 'text-yellow-700' : 'text-red-700'
                            }`}
                          >
                            {lineShare.toFixed(1)}%
                          </td>
                          <td className="px-3 py-2 text-right text-gray-700 tabular-nums hidden md:table-cell">
                            {num(s.unique_customers)}
                          </td>
                          <td className="px-3 py-2 text-right text-gray-700 tabular-nums hidden md:table-cell">
                            {yen(aov)}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
