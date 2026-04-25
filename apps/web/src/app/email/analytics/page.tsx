'use client'

import { useState, useEffect } from 'react'
import { fetchApi } from '@/lib/api'

interface ApiResult<T> { success: boolean; data?: T; error?: string }

interface CohortRow {
  cohort_month: string
  new_customers: number
  converted: number
  avg_ltv: number
  total_ltv: number
}

interface FunnelRow {
  sent: number
  opened: number
  clicked: number
  converted: number
  total_revenue: number
}

interface CampaignAttribution {
  campaign_id: string
  name: string
  total_sent: number
  total_opened: number
  total_clicked: number
  total_attributed_orders: number
  total_attributed_revenue: number
}

export default function AnalyticsPage() {
  const [cohorts, setCohorts] = useState<CohortRow[]>([])
  const [funnel, setFunnel] = useState<FunnelRow | null>(null)
  const [campaigns, setCampaigns] = useState<CampaignAttribution[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      fetchApi<ApiResult<CohortRow[]>>('/api/ferment/analytics/cohorts'),
      fetchApi<ApiResult<FunnelRow>>('/api/ferment/analytics/funnel-overall'),
      fetchApi<ApiResult<CampaignAttribution[]>>('/api/ferment/attribution/summary').catch(() => ({ success: false } as ApiResult<CampaignAttribution[]>)),
    ]).then(([co, fu, ca]) => {
      if (co.success && co.data) setCohorts(co.data)
      if (fu.success && fu.data) setFunnel(fu.data)
      if (ca.success && ca.data) setCampaigns(ca.data)
      setLoading(false)
    })
  }, [])

  const stages = funnel ? [
    { name: '送信', count: funnel.sent, rate: 100 },
    { name: '開封', count: funnel.opened, rate: funnel.sent > 0 ? (funnel.opened / funnel.sent) * 100 : 0 },
    { name: 'クリック', count: funnel.clicked, rate: funnel.opened > 0 ? (funnel.clicked / funnel.opened) * 100 : 0 },
    { name: '購入', count: funnel.converted ?? 0, rate: funnel.clicked > 0 ? ((funnel.converted ?? 0) / funnel.clicked) * 100 : 0 },
  ] : []

  return (
    <div className="max-w-6xl mx-auto py-8 px-4">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">分析ダッシュボード</h1>
        <p className="text-sm text-gray-500 mt-1">コホート分析・ファネル分析・収益貢献</p>
      </div>

      {loading ? (
        <div className="text-center py-12 text-gray-400">読み込み中...</div>
      ) : (
        <>
          {/* ファネル分析 */}
          <div className="bg-white border border-gray-200 rounded-xl p-6 mb-6">
            <h2 className="text-base font-semibold text-gray-800 mb-4">📊 全体ファネル（過去30日）</h2>
            {funnel && funnel.sent > 0 ? (
              <div className="space-y-2">
                {stages.map((s, i) => (
                  <div key={s.name}>
                    <div className="flex justify-between text-sm mb-1">
                      <span className="font-medium text-gray-700">{s.name}</span>
                      <span className="text-gray-500">
                        {s.count.toLocaleString()}人 {i > 0 && `(${s.rate.toFixed(1)}%)`}
                      </span>
                    </div>
                    <div className="bg-gray-100 rounded-full h-6 overflow-hidden">
                      <div
                        className="bg-gradient-to-r from-green-500 to-green-600 h-full flex items-center justify-end pr-2 text-xs text-white font-medium transition-all"
                        style={{ width: `${Math.max(2, (s.count / Math.max(1, stages[0].count)) * 100)}%` }}
                      >
                        {((s.count / Math.max(1, stages[0].count)) * 100).toFixed(1)}%
                      </div>
                    </div>
                  </div>
                ))}
                {funnel.total_revenue > 0 && (
                  <div className="mt-4 pt-4 border-t border-gray-100">
                    <p className="text-sm text-gray-500">総帰属売上</p>
                    <p className="text-2xl font-bold text-green-600">¥{(funnel.total_revenue ?? 0).toLocaleString()}</p>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-sm text-gray-400 text-center py-8">配信データなし</p>
            )}
          </div>

          {/* コホート分析 */}
          <div className="bg-white border border-gray-200 rounded-xl p-6 mb-6">
            <h2 className="text-base font-semibold text-gray-800 mb-4">👥 コホート分析（月次）</h2>
            {cohorts.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      <th className="text-left px-4 py-2 font-medium text-gray-600">月</th>
                      <th className="text-right px-4 py-2 font-medium text-gray-600">新規</th>
                      <th className="text-right px-4 py-2 font-medium text-gray-600">購入</th>
                      <th className="text-right px-4 py-2 font-medium text-gray-600">CV率</th>
                      <th className="text-right px-4 py-2 font-medium text-gray-600">平均LTV</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cohorts.map((c) => (
                      <tr key={c.cohort_month} className="border-b border-gray-100">
                        <td className="px-4 py-2 font-medium">{c.cohort_month}</td>
                        <td className="px-4 py-2 text-right">{c.new_customers.toLocaleString()}</td>
                        <td className="px-4 py-2 text-right">{c.converted.toLocaleString()}</td>
                        <td className="px-4 py-2 text-right">
                          {c.new_customers > 0 ? ((c.converted / c.new_customers) * 100).toFixed(1) : '0'}%
                        </td>
                        <td className="px-4 py-2 text-right">¥{Math.floor(c.avg_ltv ?? 0).toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm text-gray-400 text-center py-8">コホートデータなし</p>
            )}
          </div>

          {/* キャンペーン別収益貢献 */}
          <div className="bg-white border border-gray-200 rounded-xl p-6">
            <h2 className="text-base font-semibold text-gray-800 mb-4">💰 キャンペーン別 収益貢献</h2>
            {campaigns.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      <th className="text-left px-4 py-2 font-medium text-gray-600">キャンペーン</th>
                      <th className="text-right px-4 py-2 font-medium text-gray-600">送信</th>
                      <th className="text-right px-4 py-2 font-medium text-gray-600">開封率</th>
                      <th className="text-right px-4 py-2 font-medium text-gray-600">CV数</th>
                      <th className="text-right px-4 py-2 font-medium text-gray-600">帰属売上</th>
                    </tr>
                  </thead>
                  <tbody>
                    {campaigns.map((c) => (
                      <tr key={c.campaign_id} className="border-b border-gray-100">
                        <td className="px-4 py-2 font-medium truncate max-w-[200px]">{c.name}</td>
                        <td className="px-4 py-2 text-right">{c.total_sent.toLocaleString()}</td>
                        <td className="px-4 py-2 text-right">
                          {c.total_sent > 0 ? ((c.total_opened / c.total_sent) * 100).toFixed(1) : '0'}%
                        </td>
                        <td className="px-4 py-2 text-right">{(c.total_attributed_orders ?? 0).toLocaleString()}</td>
                        <td className="px-4 py-2 text-right text-green-600 font-medium">
                          ¥{(c.total_attributed_revenue ?? 0).toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm text-gray-400 text-center py-8">キャンペーンデータなし</p>
            )}
          </div>

          <div className="mt-4 p-3 bg-blue-50 text-xs text-blue-800 rounded-lg">
            <p className="font-semibold mb-1">💡 Attribution の仕組み</p>
            <p>Shopify の注文 webhook（<code>/webhook/ferment-attribution/order-created</code>）で、注文者が直近24時間以内に開封したメールに自動的に売上を紐付けます。</p>
          </div>
        </>
      )}
    </div>
  )
}
