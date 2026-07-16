'use client'

import { useEffect, useState, useCallback } from 'react'
import { fetchApi } from '@/lib/api'

interface Campaign {
  id: string
  send_date: string
  subject: string
  pattern: string
  tone: string | null
  orders_on_day: number | null
  revenue_on_day: number | null
  baseline_avg: number | null
  lift_pct: number | null
  top_product: string | null
  effect_score: string | null
  measured_at: string | null
}

function fmtYen(n: number) {
  return n >= 10000 ? `¥${Math.round(n / 10000)}万` : `¥${n.toLocaleString()}`
}

const patternLabels: Record<string, string> = {
  event_day: '🎮 イベント当日',
  event_eve: '📢 イベント前日',
  normal: '📝 通常',
  stock_clear: '📦 在庫整理',
}

export default function Analytics() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [loading, setLoading] = useState(true)
  const [measuring, setMeasuring] = useState<string | null>(null)

  const loadCampaigns = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetchApi<{ success: boolean; data: Campaign[] }>('/api/rakuten-mailmag/campaigns?limit=20')
      setCampaigns(res.data ?? [])
    } catch {
      // テーブル未作成等
      setCampaigns([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadCampaigns()
  }, [loadCampaigns])

  const handleMeasure = async (id: string) => {
    setMeasuring(id)
    try {
      await fetchApi(`/api/rakuten-mailmag/measure/${id}`, { method: 'POST' })
      await loadCampaigns()
    } catch (e) {
      console.error('Measure error:', e)
    } finally {
      setMeasuring(null)
    }
  }

  // パターン別集計
  const patternStats = campaigns.reduce((acc, c) => {
    if (c.lift_pct == null) return acc
    if (!acc[c.pattern]) acc[c.pattern] = { count: 0, totalOrders: 0, totalRevenue: 0, totalLift: 0 }
    acc[c.pattern].count++
    acc[c.pattern].totalOrders += c.orders_on_day ?? 0
    acc[c.pattern].totalRevenue += c.revenue_on_day ?? 0
    acc[c.pattern].totalLift += c.lift_pct
    return acc
  }, {} as Record<string, { count: number; totalOrders: number; totalRevenue: number; totalLift: number }>)

  const patternRows = Object.entries(patternStats).map(([pattern, s]) => ({
    pattern,
    label: patternLabels[pattern] ?? pattern,
    avgOrders: s.count > 0 ? Math.round(s.totalOrders / s.count) : 0,
    avgRevenue: s.count > 0 ? Math.round(s.totalRevenue / s.count) : 0,
    avgLift: s.count > 0 ? Math.round(s.totalLift / s.count) : 0,
    count: s.count,
  })).sort((a, b) => b.avgRevenue - a.avgRevenue)

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin rounded-full h-8 w-8 border-2 border-[#6D2E46] border-t-transparent" />
      </div>
    )
  }

  if (campaigns.length === 0) {
    return (
      <div className="bg-gray-50 border border-dashed border-gray-300 rounded-xl p-12 text-center">
        <p className="text-3xl mb-3">📈</p>
        <p className="text-sm text-gray-400 mb-2">配信履歴がまだありません</p>
        <p className="text-xs text-gray-400">メルマガ配信後、「配信記録を保存」ボタンから登録すると、効果測定が自動で行われます</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* KPI Summary */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-gray-200 rounded-xl p-5">
          <p className="text-xs font-semibold text-gray-500 mb-2">総配信数</p>
          <p className="text-2xl font-bold text-gray-900">{campaigns.length}</p>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-5">
          <p className="text-xs font-semibold text-gray-500 mb-2">測定済み</p>
          <p className="text-2xl font-bold text-gray-900">{campaigns.filter((c) => c.measured_at).length}</p>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-5">
          <p className="text-xs font-semibold text-gray-500 mb-2">平均リフト率</p>
          <p className="text-2xl font-bold text-green-600">
            {(() => {
              const measured = campaigns.filter((c) => c.lift_pct != null)
              if (measured.length === 0) return '—'
              const avg = measured.reduce((s, c) => s + (c.lift_pct ?? 0), 0) / measured.length
              return `+${Math.round(avg)}%`
            })()}
          </p>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-5">
          <p className="text-xs font-semibold text-gray-500 mb-2">最高リフト</p>
          <p className="text-2xl font-bold text-[#B5862E]">
            {(() => {
              const measured = campaigns.filter((c) => c.lift_pct != null)
              if (measured.length === 0) return '—'
              const max = Math.max(...measured.map((c) => c.lift_pct ?? 0))
              return `+${Math.round(max)}%`
            })()}
          </p>
        </div>
      </div>

      {/* Campaign History */}
      <div className="bg-white border border-gray-200 rounded-xl p-6">
        <h2 className="text-base font-bold text-[#6D2E46] mb-4">配信履歴と効果</h2>
        <div className="space-y-3">
          {campaigns.map((c) => (
            <div
              key={c.id}
              className="flex gap-4 p-4 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
            >
              {/* Date */}
              <div className="text-center pr-4 border-r border-gray-100 min-w-[60px]">
                <p className="text-2xl font-bold text-[#6D2E46]">{c.send_date.slice(8)}</p>
                <p className="text-xs text-gray-400 font-medium">{c.send_date.slice(5, 7)}月</p>
              </div>

              {/* Body */}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-gray-800 mb-1.5 truncate">{c.subject}</p>
                <div className="flex gap-1.5 mb-2">
                  <span className="text-xs font-medium px-2 py-0.5 rounded bg-gray-100 text-gray-600">
                    {patternLabels[c.pattern] ?? c.pattern}
                  </span>
                  {c.effect_score && (
                    <span className="text-xs font-medium px-2 py-0.5 rounded bg-[#FFF8E1] text-[#B5862E]">
                      {c.effect_score}
                    </span>
                  )}
                </div>
                {c.measured_at ? (
                  <div className="flex gap-5">
                    <div className="text-center">
                      <p className="text-base font-bold text-gray-800">{c.orders_on_day}</p>
                      <p className="text-xs text-gray-400">注文数</p>
                    </div>
                    <div className="text-center">
                      <p className="text-base font-bold text-gray-800">{fmtYen(c.revenue_on_day ?? 0)}</p>
                      <p className="text-xs text-gray-400">当日売上</p>
                    </div>
                    <div className="text-center">
                      <p className={`text-base font-bold ${(c.lift_pct ?? 0) >= 100 ? 'text-green-600' : 'text-gray-600'}`}>
                        +{Math.round(c.lift_pct ?? 0)}%
                      </p>
                      <p className="text-xs text-gray-400">平常日比</p>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => handleMeasure(c.id)}
                    disabled={measuring === c.id}
                    className="text-xs px-3 py-1.5 bg-[#6D2E46] text-white rounded-lg font-medium hover:bg-[#5A2538] disabled:opacity-50"
                  >
                    {measuring === c.id ? '計測中...' : '📈 効果を測定'}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Pattern Analysis */}
      {patternRows.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-xl p-6">
          <h2 className="text-base font-bold text-[#6D2E46] mb-4">パターン別効果分析</h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-gray-400 border-b border-gray-100">
                <th className="text-left py-2 font-medium">パターン</th>
                <th className="text-right py-2 font-medium">配信数</th>
                <th className="text-right py-2 font-medium">平均注文</th>
                <th className="text-right py-2 font-medium">平均売上</th>
                <th className="text-right py-2 font-medium">平均リフト</th>
              </tr>
            </thead>
            <tbody>
              {patternRows.map((row) => (
                <tr key={row.pattern} className="border-b border-gray-50">
                  <td className="py-3 font-medium text-gray-700">{row.label}</td>
                  <td className="py-3 text-right text-gray-500">{row.count}回</td>
                  <td className="py-3 text-right text-gray-700">{row.avgOrders}件</td>
                  <td className="py-3 text-right font-semibold text-gray-800">{fmtYen(row.avgRevenue)}</td>
                  <td className="py-3 text-right">
                    <span className={`font-bold ${row.avgLift >= 100 ? 'text-green-600' : 'text-gray-600'}`}>
                      +{row.avgLift}%
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
