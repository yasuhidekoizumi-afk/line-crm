'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { fetchApi } from '@/lib/api'

interface KpiBarData {
  today: { revenue: number; orders: number; dod_pct: number | null }
  week: { revenue: number; orders: number; wow_pct: number | null }
  month: {
    revenue: number
    orders: number
    customers: number
    line_revenue: number
    line_share_pct: number
    mom_pct: number | null
  }
  d90: { revenue: number; orders: number }
}

const yen = (n: number) => '¥' + Math.round(n).toLocaleString('ja-JP')
const num = (n: number) => Math.round(n).toLocaleString('ja-JP')

function PctBadge({ pct }: { pct: number | null }) {
  if (pct === null || pct === undefined) return <span className="text-xs text-gray-400">—</span>
  const color = pct > 0 ? 'text-green-600' : pct < 0 ? 'text-red-600' : 'text-gray-500'
  const arrow = pct > 0 ? '↑' : pct < 0 ? '↓' : '→'
  return (
    <span className={`text-xs ${color} tabular-nums`}>
      {arrow} {Math.abs(pct).toFixed(1)}%
    </span>
  )
}

/**
 * Shopify 売上 KPI バー（メインダッシュボード上部などで使用）
 * 当日 / 今週 / 今月 / 直近90日 をワンライナーで表示。
 */
export default function ShopifyKpiBar() {
  const [data, setData] = useState<KpiBarData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await fetchApi<{ success: boolean; data: KpiBarData }>(
          `/api/shopify/orders/kpi-bar`,
        )
        if (cancelled) return
        if (res.success) setData(res.data)
      } catch {
        /* noop */
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  if (loading) {
    return (
      <div className="bg-white border border-gray-200 rounded-lg p-4 text-center text-sm text-gray-400">
        Shopify KPI 読み込み中…
      </div>
    )
  }
  if (!data) return null

  return (
    <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-100 bg-gray-50">
        <div className="font-bold text-gray-900 text-sm">📊 Shopify 売上ウォッチ</div>
        <Link
          href="/shopify-bi/timeseries"
          className="text-xs text-indigo-600 hover:text-indigo-800"
        >
          時系列詳細 →
        </Link>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 divide-x divide-y lg:divide-y-0 divide-gray-100">
        <Cell
          label="本日"
          value={yen(data.today.revenue)}
          sub={`注文 ${num(data.today.orders)}件`}
          pct={data.today.dod_pct}
          pctLabel="DoD"
          href="/shopify-bi/timeseries"
        />
        <Cell
          label="今週"
          value={yen(data.week.revenue)}
          sub={`注文 ${num(data.week.orders)}件`}
          pct={data.week.wow_pct}
          pctLabel="WoW"
          href="/shopify-bi/timeseries"
        />
        <Cell
          label="今月"
          value={yen(data.month.revenue)}
          sub={`注文 ${num(data.month.orders)}件 / 顧客 ${num(data.month.customers)}人`}
          pct={data.month.mom_pct}
          pctLabel="MoM"
          extra={`LINE経由 ${data.month.line_share_pct.toFixed(1)}%`}
          href="/shopify-bi/timeseries"
        />
        <Cell
          label="直近90日"
          value={yen(data.d90.revenue)}
          sub={`注文 ${num(data.d90.orders)}件`}
          href="/shopify-bi"
        />
      </div>
    </div>
  )
}

function Cell({
  label,
  value,
  sub,
  pct,
  pctLabel,
  extra,
  href,
}: {
  label: string
  value: string
  sub: string
  pct?: number | null
  pctLabel?: string
  extra?: string
  href: string
}) {
  return (
    <Link
      href={href}
      className="px-4 py-3 hover:bg-gray-50 transition block"
    >
      <div className="flex items-baseline justify-between">
        <div className="text-xs text-gray-500">{label}</div>
        {pct !== undefined && pctLabel && (
          <div className="flex items-center gap-1">
            <PctBadge pct={pct} />
            <span className="text-[10px] text-gray-400">{pctLabel}</span>
          </div>
        )}
      </div>
      <div className="text-lg font-bold text-gray-900 mt-0.5 tabular-nums">{value}</div>
      <div className="text-xs text-gray-500 mt-0.5">{sub}</div>
      {extra && <div className="text-xs text-indigo-600 mt-0.5">{extra}</div>}
    </Link>
  )
}
