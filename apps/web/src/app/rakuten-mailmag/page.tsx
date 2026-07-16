'use client'

import { useEffect, useState, useCallback } from 'react'
import { fetchApi } from '@/lib/api'
import Header from '@/components/layout/header'
import Dashboard from './dashboard'
import Generate from './generate'
import Analytics from './analytics'

type Tab = 'dashboard' | 'generate' | 'analytics'

interface DashboardData {
  kpi: {
    totalRevenue: number
    totalOrders: number
    avgOrderValue: number
    period: { start: string; end: string }
  }
  baseline: { avgDailyRevenue: number; avgDailyOrders: number }
  dailySales: {
    date: string
    orders: number
    revenue: number
    tax: number
    shopCoupon: number
    delivery: number
  }[]
  productRanking: {
    itemNumber: string
    itemName: string
    qty: number
    revenue: number
    gross: number
    avgPrice: number
  }[]
}

interface RakutenEvent {
  date: string
  name: string
  type: string
}

export default function RakutenMailmagPage() {
  const [tab, setTab] = useState<Tab>('dashboard')
  const [dashboard, setDashboard] = useState<DashboardData | null>(null)
  const [events, setEvents] = useState<RakutenEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [dashRes, eventRes] = await Promise.all([
        fetchApi<{ success: boolean; data: DashboardData; error?: string }>(
          '/api/rakuten-mailmag/dashboard?days=30',
        ),
        fetchApi<{ success: boolean; data: RakutenEvent[] }>('/api/rakuten-mailmag/events'),
      ])
      if (!dashRes.success) throw new Error(dashRes.error ?? 'データ取得に失敗')
      setDashboard(dashRes.data)
      setEvents(eventRes.data ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadData()
  }, [loadData])

  const tabs: { id: Tab; label: string; icon: string }[] = [
    { id: 'dashboard', label: 'ダッシュボード', icon: '📊' },
    { id: 'generate', label: 'メルマガ作成', icon: '✉️' },
    { id: 'analytics', label: '効果測定', icon: '📈' },
  ]

  return (
    <>
      <Header
        title="楽天メルマガHarness"
        description="売上データ連動のメルマガ作成・効果測定"
        action={
          <button
            onClick={loadData}
            className="px-3 py-1.5 text-sm font-medium text-gray-600 hover:text-gray-900 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
          >
            ⟳ 更新
          </button>
        }
      />

      {/* タブ */}
      <div className="flex gap-1 mb-6 border-b border-gray-200">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              tab === t.id
                ? 'border-[#6D2E46] text-[#6D2E46]'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {loading && (
        <div className="flex items-center justify-center py-20">
          <div className="animate-spin rounded-full h-8 w-8 border-2 border-[#6D2E46] border-t-transparent" />
          <span className="ml-3 text-gray-500 text-sm">RMS データ取得中...</span>
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
          <p className="text-sm text-red-700 font-medium">エラー: {error}</p>
          <p className="text-xs text-red-500 mt-1">
            RMS認証情報（RAKUTEN_SERVICE_SECRET / RAKUTEN_LICENSE_KEY）がWorkerのSecretに設定されているか確認してください。
          </p>
        </div>
      )}

      {!loading && !error && dashboard && (
        <>
          {tab === 'dashboard' && <Dashboard data={dashboard} events={events} />}
          {tab === 'generate' && <Generate data={dashboard} events={events} />}
          {tab === 'analytics' && <Analytics />}
        </>
      )}
    </>
  )
}
