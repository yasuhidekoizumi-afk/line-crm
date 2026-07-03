'use client'

import { useEffect, useCallback, useState, useMemo, useRef } from 'react'
import Link from 'next/link'
import { fetchApi } from '@/lib/api'
import Header from '@/components/layout/header'

interface FunnelRow {
  segment: string
  first_order_customers: number
  repeat_customers: number
  repeat_rate_pct: number
  repeat_within_7d: number
  repeat_within_30d: number
  repeat_within_90d: number
  avg_days_to_second: number
  ltv: number
}

interface OrderStats {
  order_count: number
  total_revenue: number
  unique_customers: number
  line_linked_orders: number
}

interface CohortRow {
  cohort_month: string
  first_order_customers: number
  repeat_rate_pct: number
  line_link_rate_pct: number
  line_repeat_rate_pct: number | null
  noline_repeat_rate_pct: number | null
}

interface ChannelMatrixRow {
  line_linked: number
  email_subscribed: number
  customers: number
  orders: number
  revenue: number
  ltv: number
  aov: number
}

interface LineOverview {
  total_customers: number
  total_line_customers: number
  total_line_rate_pct: number
  period_purchasers: number
  period_orders: number
  period_line_purchasers: number
  period_line_purchaser_rate_pct: number
  first_order_customers: number
  first_order_line_customers: number
  first_order_line_rate_pct: number
  first_order_repeat_customers: number
}

interface TrafficSourceRow {
  source: string
  orders: number
  unique_customers: number
  revenue: number
  new_customer_revenue: number
  new_customer_orders: number
  line_linked_orders: number
  aov: number
  revenue_per_customer: number
}

const yen = (n: number) => '¥' + Math.round(n).toLocaleString('ja-JP')
const num = (n: number) => Math.round(n).toLocaleString('ja-JP')
const oneDecimal = (n: number) => n.toLocaleString('ja-JP', { maximumFractionDigits: 1, minimumFractionDigits: Math.abs(n % 1) > 0.05 ? 1 : 0 })

const MATURE_F2_BASELINE = {
  cohortLabel: '2025-01-01〜2026-05-04初回購入（60日以上観測）',
  lineF2RatePct: 35.9,
  noLineF2RatePct: 18.2,
  avgSecondOrderValue: 3477,
}

const PERIOD_OPTIONS = [
  { value: '7d',   label: '過去7日' },
  { value: '30d',  label: '過去30日' },
  { value: '90d',  label: '過去90日' },
  { value: '180d', label: '過去180日' },
  { value: '1y',   label: '過去1年' },
  { value: 'all',  label: '全期間' },
  { value: 'custom', label: 'カスタム' },
] as const

function todayStr() {
  const d = new Date()
  return d.getFullYear() + '-' +
    String(d.getMonth() + 1).padStart(2, '0') + '-' +
    String(d.getDate()).padStart(2, '0')
}

export default function ShopifyBiTopPage() {
  const [period, setPeriod] = useState('90d')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [stats, setStats] = useState<OrderStats | null>(null)
  const [lineOverview, setLineOverview] = useState<LineOverview | null>(null)
  const [funnel, setFunnel] = useState<FunnelRow[]>([])
  const [cohort, setCohort] = useState<CohortRow[]>([])
  const [channelMatrix, setChannelMatrix] = useState<ChannelMatrixRow[]>([])
  const [trafficSource, setTrafficSource] = useState<TrafficSourceRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [recomputing, setRecomputing] = useState(false)
  const [dataKey, setDataKey] = useState(0)
  const fetchingRef = useRef(false)

  // ── 初回LINE連携率シミュレーター（フル可変） ──
  const [simTargetRate, setSimTargetRate] = useState(30)
  const [simLineF2, setSimLineF2] = useState(MATURE_F2_BASELINE.lineF2RatePct)
  const [simNoLineF2, setSimNoLineF2] = useState(MATURE_F2_BASELINE.noLineF2RatePct)
  const [simSecondValue, setSimSecondValue] = useState(MATURE_F2_BASELINE.avgSecondOrderValue)
  const [simFirstBuyersInput, setSimFirstBuyersInput] = useState<number | null>(null)
  const [simConservativeFactor, setSimConservativeFactor] = useState(50)

  const calcRange = useCallback(() => {
    const now = new Date()
    const today = todayStr()
    if (period === 'all') return { from: undefined as string | undefined, to: undefined, fromMonth: undefined, toMonth: undefined }
    if (period === 'custom') {
      if (!customFrom || !customTo) return null
      return {
        from: customFrom,
        to: customTo,
        fromMonth: customFrom.slice(0, 7),
        toMonth: customTo.slice(0, 7),
      }
    }
    const days: Record<string, number> = { '7d': 7, '30d': 30, '90d': 90, '180d': 180, '1y': 365 }
    const d = days[period] ?? 30
    const from = new Date(now)
    from.setDate(from.getDate() - d)
    const fromStr = from.toISOString().slice(0, 10)
    return {
      from: fromStr,
      to: today,
      fromMonth: fromStr.slice(0, 7),
      toMonth: today.slice(0, 7),
    }
  }, [period, customFrom, customTo])

  // range を useMemo で安定化（毎レンダリングで新規オブジェクト生成を防止）
  const range = useMemo(() => calcRange(), [period, customFrom, customTo])

  const fetchAll = useCallback(async () => {
    if (!range) return
    if (fetchingRef.current) return
    fetchingRef.current = true
    setLoading(true)
    setError(null)
    try {
      const ps = new URLSearchParams()
      if (range.from && range.to) { ps.set('from', range.from); ps.set('to', range.to) }
      const cohortPs = new URLSearchParams()
      if (range.fromMonth && range.toMonth) { cohortPs.set('from', range.fromMonth); cohortPs.set('to', range.toMonth) }

      const results = await Promise.allSettled([
        fetchApi<{ success: boolean; data: OrderStats }>(`/api/shopify/orders/stats?${ps}`),
        fetchApi<{ success: boolean; data: LineOverview }>(`/api/customer-journey/line-overview?${ps}`),
        fetchApi<{ success: boolean; data: FunnelRow[] }>(`/api/customer-journey/funnel?${ps}`),
        fetchApi<{ success: boolean; data: CohortRow[] }>(`/api/customer-journey/cohort?${cohortPs}`),
        fetchApi<{ success: boolean; data: ChannelMatrixRow[] }>(`/api/customer-journey/channel-matrix?${ps}`),
        fetchApi<{ success: boolean; data: TrafficSourceRow[] }>(`/api/customer-journey/traffic-source?${ps}`),
      ])
      // 各APIの結果を個別に処理（1つが失敗しても他は表示）
      if (results[0].status === 'fulfilled' && results[0].value.success) setStats(results[0].value.data)
      else console.warn('[shopify-bi] stats API failed:', results[0])
      if (results[1].status === 'fulfilled' && results[1].value.success) setLineOverview(results[1].value.data)
      else console.warn('[shopify-bi] line-overview API failed:', results[1])
      if (results[2].status === 'fulfilled' && results[2].value.success) setFunnel(results[2].value.data)
      else console.warn('[shopify-bi] funnel API failed:', results[2])
      if (results[3].status === 'fulfilled' && results[3].value.success) setCohort(results[3].value.data)
      else console.warn('[shopify-bi] cohort API failed:', results[3])
      if (results[4].status === 'fulfilled' && results[4].value.success) setChannelMatrix(results[4].value.data)
      else console.warn('[shopify-bi] channel-matrix API failed:', results[4])
      if (results[5].status === 'fulfilled' && results[5].value.success) setTrafficSource(results[5].value.data)
      else console.warn('[shopify-bi] traffic-source API failed:', results[5])
    } catch (e) {
      setError(`読み込み失敗: ${String(e)}`)
    } finally {
      fetchingRef.current = false
      setLoading(false)
    }
  }, [dataKey, range])

  useEffect(() => { if (range) fetchAll() }, [fetchAll, range])

  const handlePeriodClick = (val: string) => {
    setPeriod(val)
    if (val !== 'custom') setDataKey((k) => k + 1)
  }

  const handleCustomApply = () => {
    if (customFrom && customTo) {
      setPeriod('custom')
      setDataKey((k) => k + 1)
    }
  }

  const handleRecompute = async () => {
    if (!range) return
    setRecomputing(true)
    try {
      await fetchApi<{ success: boolean }>(`/api/customer-journey/recompute`, { method: 'POST' })
      const cohortPs = new URLSearchParams()
      if (range.fromMonth && range.toMonth) { cohortPs.set('from', range.fromMonth); cohortPs.set('to', range.toMonth) }
      const ps = new URLSearchParams()
      if (range.from && range.to) { ps.set('from', range.from); ps.set('to', range.to) }
      const [overviewRes, funnelRes, cohortRes] = await Promise.allSettled([
        fetchApi<{ success: boolean; data: LineOverview }>(`/api/customer-journey/line-overview?${ps}`),
        fetchApi<{ success: boolean; data: FunnelRow[] }>(`/api/customer-journey/funnel?${ps}`),
        fetchApi<{ success: boolean; data: CohortRow[] }>(`/api/customer-journey/cohort?${cohortPs}`),
      ])
      if (overviewRes.status === 'fulfilled' && overviewRes.value.success) setLineOverview(overviewRes.value.data)
      if (funnelRes.status === 'fulfilled' && funnelRes.value.success) setFunnel(funnelRes.value.data)
      if (cohortRes.status === 'fulfilled' && cohortRes.value.success) setCohort(cohortRes.value.data)
    } catch (e) {
      setError(`再計算失敗: ${String(e)}`)
    } finally {
      setRecomputing(false)
    }
  }

  const anomalies = cohort
    .filter((c) => c.first_order_customers >= 200 && c.line_link_rate_pct < 15)
    .sort((a, b) => b.first_order_customers - a.first_order_customers)

  const lineSeg = funnel.find((f) => f.segment === 'LINE連携あり')
  const noLineSeg = funnel.find((f) => f.segment === 'LINE連携なし')
  const totalFirstCustomers = funnel.reduce((s, f) => s + f.first_order_customers, 0)
  const totalRepeatCustomers = funnel.reduce((s, f) => s + f.repeat_customers, 0)
  const totalUnconvertedCustomers = Math.max(0, totalFirstCustomers - totalRepeatCustomers)
  const totalRepeatRate = totalFirstCustomers > 0 ? (totalRepeatCustomers / totalFirstCustomers) * 100 : 0
  const totalRepeatWithin30 = funnel.reduce((s, f) => s + f.repeat_within_30d, 0)
  const repeatWithin30Rate = totalFirstCustomers > 0 ? (totalRepeatWithin30 / totalFirstCustomers) * 100 : 0

  const ltvDelta = lineSeg && noLineSeg ? Math.max(0, lineSeg.ltv - noLineSeg.ltv) : 0
  const repeatRateLift = lineSeg && noLineSeg ? lineSeg.repeat_rate_pct - noLineSeg.repeat_rate_pct : 0
  const lineUnconvertedCustomers = lineSeg ? Math.max(0, lineSeg.first_order_customers - lineSeg.repeat_customers) : 0
  const noLineUnconvertedCustomers = noLineSeg ? Math.max(0, noLineSeg.first_order_customers - noLineSeg.repeat_customers) : 0
  const incrementalLineRepeats = lineSeg && noLineSeg
    ? Math.max(0, Math.round(lineSeg.repeat_customers - lineSeg.first_order_customers * (noLineSeg.repeat_rate_pct / 100)))
    : 0
  const ltvRows = funnel
    .map((f) => ({
      ...f,
      unconverted: Math.max(0, f.first_order_customers - f.repeat_customers),
      repeatShare: totalRepeatCustomers > 0 ? (f.repeat_customers / totalRepeatCustomers) * 100 : 0,
      ltvIndex: noLineSeg && noLineSeg.ltv > 0 ? (f.ltv / noLineSeg.ltv) * 100 : 100,
      repeatRevenueProxy: f.repeat_customers * f.ltv,
    }))
    .sort((a, b) => b.ltv - a.ltv)
  const ltvOpportunity = ltvDelta > 0 && noLineSeg
    ? noLineUnconvertedCustomers * ltvDelta
    : 0
  const additionalF2IfNoLineMatchesLine = lineSeg && noLineSeg && repeatRateLift > 0
    ? Math.round(noLineSeg.first_order_customers * (repeatRateLift / 100))
    : 0
  const additionalLtvIfNoLineMatchesLine = additionalF2IfNoLineMatchesLine * (noLineSeg?.ltv ?? 0)
  const prioritySegmentLabel = noLineUnconvertedCustomers >= lineUnconvertedCustomers
    ? 'LINE未連携の初回購入者'
    : 'LINE連携済みのF2未到達者'
  const lostCustomersInAnomalies = anomalies.reduce((s, c) => s + Math.round(c.first_order_customers * (0.5 - c.line_link_rate_pct / 100)), 0)
  const lostValue = ltvDelta * lostCustomersInAnomalies

  const initialLineCustomers = lineOverview?.first_order_line_customers ?? (lineSeg?.first_order_customers ?? 0)
  const currentInitialLineRate = totalFirstCustomers > 0 ? (initialLineCustomers / totalFirstCustomers) * 100 : 0
  const simFirstBuyers = Math.max(0, Math.round(simFirstBuyersInput ?? totalFirstCustomers))
  const simCurrentLineCustomers = Math.round(simFirstBuyers * currentInitialLineRate / 100)
  const simCurrentNoLineCustomers = Math.max(0, simFirstBuyers - simCurrentLineCustomers)
  const simTargetLineCustomers = Math.round(simFirstBuyers * simTargetRate / 100)
  const simAdditionalLinked = Math.max(0, simTargetLineCustomers - simCurrentLineCustomers)
  const simF2LiftPct = simLineF2 - simNoLineF2
  const simBaselineExpectedF2 = (simCurrentLineCustomers * simLineF2 + simCurrentNoLineCustomers * simNoLineF2) / 100
  const simTargetExpectedF2 = (simTargetLineCustomers * simLineF2 + Math.max(0, simFirstBuyers - simTargetLineCustomers) * simNoLineF2) / 100
  const simAdditionalF2Max = Math.max(0, simTargetExpectedF2 - simBaselineExpectedF2)
  const simAdditionalF2Adjusted = simAdditionalF2Max * (simConservativeFactor / 100)
  const simAdditionalSalesMax = simAdditionalF2Max * simSecondValue
  const simAdditionalSalesAdjusted = simAdditionalF2Adjusted * simSecondValue
  const resetSimulator = () => {
    setSimTargetRate(30)
    setSimLineF2(MATURE_F2_BASELINE.lineF2RatePct)
    setSimNoLineF2(MATURE_F2_BASELINE.noLineF2RatePct)
    setSimSecondValue(MATURE_F2_BASELINE.avgSecondOrderValue)
    setSimFirstBuyersInput(null)
    setSimConservativeFactor(50)
  }

  const periodLabelObj = PERIOD_OPTIONS.find(p => p.value === period)
  const periodLabel = period === 'custom' && range
    ? `${range.from} 〜 ${range.to}`
    : (periodLabelObj?.label ?? '')

  return (
    <div>
      <Header title="売上分析" />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">📊 売上分析（Shopify BI）</h1>
            <p className="text-sm text-gray-500 mt-1">CRM活動 × Shopify購入 のアトリビューション。月次の経営判断起点。</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={handleRecompute} disabled={recomputing || !range}
              className="px-3 py-1.5 text-sm rounded-md border border-gray-300 bg-white hover:bg-gray-50 disabled:opacity-50">
              {recomputing ? '再計算中…' : '🔄 再計算'}
            </button>
            <Link href="/shopify-bi/cohort" className="px-3 py-1.5 text-sm rounded-md bg-indigo-600 text-white hover:bg-indigo-700">コホート分析 →</Link>
          </div>
        </div>

        {error && <div className="rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{error}</div>}

        {/* ─── 期間フィルター ─── */}
        <div className="flex flex-wrap items-center gap-2">
          {PERIOD_OPTIONS.map((opt) => (
            <button key={opt.value} onClick={() => handlePeriodClick(opt.value)}
              className={`px-3 py-1.5 text-sm rounded-md border transition-colors ${period === opt.value ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'}`}>
              {opt.label}
            </button>
          ))}
          {period === 'custom' && (
            <div className="flex items-center gap-1 ml-1">
              <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)}
                className="px-2 py-1.5 text-sm border border-gray-300 rounded-md" />
              <span className="text-gray-400">〜</span>
              <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)}
                className="px-2 py-1.5 text-sm border border-gray-300 rounded-md" />
              <button onClick={handleCustomApply}
                className="px-3 py-1.5 text-sm rounded-md bg-indigo-600 text-white hover:bg-indigo-700">適用</button>
            </div>
          )}
          {range && range.from && (
            <span className="text-xs text-gray-400 ml-1">{range.from} 〜 {range.to}</span>
          )}
          {period === 'custom' && !range && (
            <span className="text-xs text-orange-500 ml-1">FROM/TO を入力して「適用」を押してください</span>
          )}
        </div>

        {loading ? (
          <div className="text-center text-gray-400 py-12">読み込み中…</div>
        ) : (
          <>
            {stats && (
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <KpiCard label={`${periodLabel} 注文数`} value={num(stats.order_count)} unit="件" color="blue" />
                <KpiCard label={`${periodLabel} 売上`} value={yen(stats.total_revenue)} color="green" />
                <KpiCard label={`${periodLabel} 顧客数`} value={num(stats.unique_customers)} unit="人" color="purple" />
                <KpiCard label={`${periodLabel} LINE連携比率`} value={stats.order_count > 0 ? `${((stats.line_linked_orders / stats.order_count) * 100).toFixed(1)}%` : '—'} color="pink" />
              </div>
            )}



            {lineOverview && (
              <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
                <div className="px-4 sm:px-5 py-3 border-b border-gray-200 bg-gray-50">
                  <h2 className="font-bold text-gray-900">🟢 LINE連携の母集団サマリー</h2>
                  <p className="text-xs text-gray-500 mt-0.5">
                    「LINE連携あり」は集計する母集団で人数が大きく変わる。誤読を防ぐため3つの母集団を並べて表示。
                  </p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-px bg-gray-200">
                  <div className="bg-white px-4 py-4">
                    <div className="text-xs text-gray-500">① 全体のLINE連携顧客</div>
                    <div className="mt-1 text-2xl font-bold text-green-700 tabular-nums">{num(lineOverview.total_line_customers)}<span className="text-sm font-normal text-gray-500 ml-1">人</span></div>
                    <div className="text-xs text-gray-500 mt-1">
                      全顧客 {num(lineOverview.total_customers)}人中 {lineOverview.total_line_rate_pct}%（/customers 画面と一致・期間非依存）
                    </div>
                  </div>
                  <div className="bg-white px-4 py-4">
                    <div className="text-xs text-gray-500">② {periodLabel} 購入者のうちLINE連携あり</div>
                    <div className="mt-1 text-2xl font-bold text-indigo-700 tabular-nums">{num(lineOverview.period_line_purchasers)}<span className="text-sm font-normal text-gray-500 ml-1">人</span></div>
                    <div className="text-xs text-gray-500 mt-1">
                      期間内購入者 {num(lineOverview.period_purchasers)}人中 {lineOverview.period_line_purchaser_rate_pct}%（既存リピーター含む）
                    </div>
                  </div>
                  <div className="bg-white px-4 py-4">
                    <div className="text-xs text-gray-500">③ {periodLabel} 初回購入者のうちLINE連携あり</div>
                    <div className="mt-1 text-2xl font-bold text-amber-700 tabular-nums">{num(lineOverview.first_order_line_customers)}<span className="text-sm font-normal text-gray-500 ml-1">人</span></div>
                    <div className="text-xs text-gray-500 mt-1">
                      期間内初回購入者 {num(lineOverview.first_order_customers)}人中 {lineOverview.first_order_line_rate_pct}%（下のF2ファネルの母集団）
                    </div>
                  </div>
                </div>
                <div className="px-4 sm:px-5 py-3 bg-indigo-50 border-t border-indigo-100 text-xs text-indigo-800 leading-relaxed">
                  💡 下の「F2転換ファネル」は<span className="font-bold">③の初回購入者だけ</span>が母集団。全体（①{num(lineOverview.total_line_customers)}人）と比べて少なく見えるのは正常です。
                  新規初回購入時点ではLINE連携率が低く（{lineOverview.first_order_line_rate_pct}%）、リピート回数が増えるほど連携率が上がるため、
                  購入者全体（②）で見ると<span className="font-bold">{lineOverview.period_line_purchaser_rate_pct}%</span>がLINE連携ありです。
                </div>
              </div>
            )}

            {funnel.length > 0 && totalFirstCustomers > 0 && (
              <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
                <div className="px-4 sm:px-5 py-3 border-b border-gray-200 bg-gray-50">
                  <h2 className="font-bold text-gray-900">🔁 F2転換ファネル（初回 → 2回目購入）</h2>
                  <p className="text-xs text-gray-500 mt-0.5">{periodLabel} に初回購入した顧客の2回目購入到達状況。F2はLTVの最大レバー。</p>
                  <p className="text-[11px] text-amber-700 mt-1">
                    ⚠️ 母集団は「{periodLabel}の初回購入者」のみ。全体のLINE連携顧客数（上のサマリー①）とは母集団が異なります。
                  </p>
                </div>
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-px bg-gray-200">
                  <FunnelStat label="初回購入顧客" value={num(totalFirstCustomers)} unit="人" tone="neutral" />
                  <FunnelStat label="F2到達" value={num(totalRepeatCustomers)} unit="人" sub={`${totalRepeatRate.toFixed(1)}%`} tone="good" />
                  <FunnelStat label="30日内F2" value={`${repeatWithin30Rate.toFixed(1)}%`} sub={`${num(totalRepeatWithin30)}人`} tone="neutral" />
                  <FunnelStat label="F2未到達" value={num(totalUnconvertedCustomers)} unit="人" sub="フォロー対象" tone="warn" />
                </div>
                <div className="px-4 sm:px-5 py-3 border-t border-gray-200">
                  <div className="flex h-3 w-full overflow-hidden rounded-full bg-gray-100">
                    <div className="bg-indigo-500 h-3" style={{ width: `${Math.min(100, totalRepeatRate)}%` }} title={`F2到達 ${totalRepeatRate.toFixed(1)}%`} />
                  </div>
                  <div className="flex justify-between text-xs text-gray-500 mt-1">
                    <span>F2到達 {totalRepeatRate.toFixed(1)}%</span>
                    <span>未到達 {(100 - totalRepeatRate).toFixed(1)}%</span>
                  </div>
                </div>
                {lineSeg && noLineSeg && (
                  <div className="overflow-x-auto border-t border-gray-200">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50 text-xs text-gray-600">
                        <tr>
                          <th className="px-3 py-2 text-left">セグメント</th>
                          <th className="px-3 py-2 text-right">初回</th>
                          <th className="px-3 py-2 text-right">F2率</th>
                          <th className="px-3 py-2 text-right hidden sm:table-cell">7日内</th>
                          <th className="px-3 py-2 text-right hidden sm:table-cell">30日内</th>
                          <th className="px-3 py-2 text-right hidden md:table-cell">平均日数</th>
                          <th className="px-3 py-2 text-right">未到達</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {[lineSeg, noLineSeg].map((s) => {
                          const within7 = s.first_order_customers > 0 ? (s.repeat_within_7d / s.first_order_customers) * 100 : 0
                          const within30 = s.first_order_customers > 0 ? (s.repeat_within_30d / s.first_order_customers) * 100 : 0
                          const unconv = Math.max(0, s.first_order_customers - s.repeat_customers)
                          const isLine = s.segment === 'LINE連携あり'
                          return (
                            <tr key={s.segment} className={isLine ? 'bg-green-50/40' : ''}>
                              <td className="px-3 py-2 font-medium text-gray-900">{isLine ? '🟢' : '⚪'} {s.segment}</td>
                              <td className="px-3 py-2 text-right tabular-nums">{num(s.first_order_customers)}</td>
                              <td className={`px-3 py-2 text-right font-bold tabular-nums ${s.repeat_rate_pct >= 30 ? 'text-green-700' : s.repeat_rate_pct >= 15 ? 'text-yellow-700' : 'text-red-700'}`}>{s.repeat_rate_pct}%</td>
                              <td className="px-3 py-2 text-right text-gray-700 tabular-nums hidden sm:table-cell">{within7.toFixed(1)}%</td>
                              <td className="px-3 py-2 text-right text-gray-700 tabular-nums hidden sm:table-cell">{within30.toFixed(1)}%</td>
                              <td className="px-3 py-2 text-right text-gray-700 tabular-nums hidden md:table-cell">{s.avg_days_to_second}日</td>
                              <td className="px-3 py-2 text-right font-medium text-amber-700 tabular-nums">{num(unconv)}人</td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
                {repeatRateLift > 0 && (
                  <div className="px-4 sm:px-5 py-3 bg-indigo-50 border-t border-indigo-100 text-sm space-y-1">
                    <div>
                      <span className="font-bold text-indigo-900">LINE連携でF2率 +{repeatRateLift.toFixed(1)}pt</span>
                      <span className="text-indigo-700 ml-2">（{lineSeg!.repeat_rate_pct}% vs {noLineSeg!.repeat_rate_pct}%）</span>
                    </div>
                    {incrementalLineRepeats > 0 && (
                      <div className="text-indigo-700 text-xs">
                        ↑ LINE連携の押し上げで約 <span className="font-bold">{num(incrementalLineRepeats)}人</span> が追加でF2到達（非連携並みの転換率だった場合との差）。
                        未連携の初回購入 {num(noLineUnconvertedCustomers)}人 をLINE連携に誘導できれば、ここがF2の伸びしろ。
                      </div>
                    )}
                  </div>
                )}
                {lineSeg && noLineSeg && (
                  <div className="px-4 sm:px-5 py-4 bg-slate-50 border-t border-slate-200">
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                      <div>
                        <h3 className="font-bold text-gray-900">経営判断メモ</h3>
                        <p className="text-xs text-gray-500 mt-0.5">次のCRM投資をどこに寄せるべきか</p>
                      </div>
                      <span className="px-2 py-1 rounded-full bg-amber-100 text-amber-800 text-xs font-medium">
                        優先: {prioritySegmentLabel}
                      </span>
                    </div>
                    <div className="grid md:grid-cols-3 gap-3 mt-3 text-sm">
                      <div className="rounded-md bg-white border border-gray-200 p-3">
                        <div className="text-xs text-gray-500">最優先施策</div>
                        <div className="font-bold text-gray-900 mt-1">未連携F2未到達 {num(noLineUnconvertedCustomers)}人へのLINE連携導線</div>
                        <p className="text-xs text-gray-600 mt-1">母数が大きく、F2率もLINE連携ありの方が高い。購入後メール・同梱物・マイページで友だち追加を回収。</p>
                      </div>
                      <div className="rounded-md bg-white border border-gray-200 p-3">
                        <div className="text-xs text-gray-500">伸びしろ</div>
                        <div className="font-bold text-gray-900 mt-1">F2到達 +{num(additionalF2IfNoLineMatchesLine)}人 相当</div>
                        <p className="text-xs text-gray-600 mt-1">未連携のF2率がLINE連携あり水準まで上がった場合の概算。売上機会は約 {yen(additionalLtvIfNoLineMatchesLine)}。</p>
                      </div>
                      <div className="rounded-md bg-white border border-gray-200 p-3">
                        <div className="text-xs text-gray-500">次の意思決定</div>
                        <div className="font-bold text-gray-900 mt-1">自動フォローは30日以内F2を主KPIにする</div>
                        <p className="text-xs text-gray-600 mt-1">単発売上より、初回購入後7/21/45日で接触してF2未到達を減らす設計が優先。</p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {funnel.length > 0 && totalFirstCustomers > 0 && (
              <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
                <div className="px-4 sm:px-5 py-3 border-b border-gray-200 bg-gray-50 flex items-start justify-between gap-3">
                  <div>
                    <h2 className="font-bold text-gray-900">🎯 初回LINE連携率 改善シミュレーター</h2>
                    <p className="text-xs text-gray-500 mt-0.5">
                      目標連携率・F2率・単価・母数を自由に変更して、F2到達と2回目売上の感度を見る。単発売上ではなく今後のCRM施策の母数づくりが本質。
                    </p>
                    <p className="text-[11px] text-amber-700 mt-1">
                      初期値: 成熟コホート実測（連携あり {MATURE_F2_BASELINE.lineF2RatePct}% / なし {MATURE_F2_BASELINE.noLineF2RatePct}%、{MATURE_F2_BASELINE.cohortLabel}）。ランダム実験ではないため、交絡調整で割り引いて見る。
                    </p>
                  </div>
                  <button onClick={resetSimulator} className="shrink-0 px-2 py-1 rounded border border-gray-300 bg-white text-xs text-gray-700 hover:bg-gray-50">初期値に戻す</button>
                </div>

                <div className="grid grid-cols-2 lg:grid-cols-4 gap-px bg-gray-200">
                  <FunnelStat label="初回購入者数" value={num(simFirstBuyers)} unit="人" sub={`${periodLabel}実績: ${num(totalFirstCustomers)}人`} tone="neutral" />
                  <FunnelStat label="現状の初回LINE連携率" value={`${oneDecimal(currentInitialLineRate)}%`} sub={`${num(simCurrentLineCustomers)}人換算`} tone="warn" />
                  <FunnelStat label="設定F2率差" value={`${simF2LiftPct >= 0 ? '+' : ''}${oneDecimal(simF2LiftPct)}pt`} sub={`連携あり ${oneDecimal(simLineF2)}% / なし ${oneDecimal(simNoLineF2)}%`} tone={simF2LiftPct >= 0 ? 'good' : 'warn'} />
                  <FunnelStat label="2回目平均単価" value={yen(simSecondValue)} sub="手入力で変更可" tone="neutral" />
                </div>

                <div className="grid lg:grid-cols-2 gap-4 p-4 sm:p-5 border-t border-gray-200">
                  <div className="space-y-4">
                    <div className="rounded-lg border border-gray-200 p-3">
                      <div className="flex items-center justify-between gap-3">
                        <label className="text-sm font-bold text-gray-900">目標 初回LINE連携率</label>
                        <div className="flex items-center gap-2">
                          <input type="number" min="0" max="100" step="1" value={simTargetRate} onChange={(e) => setSimTargetRate(Math.max(0, Math.min(100, Number(e.target.value) || 0)))} className="w-20 rounded border border-gray-300 px-2 py-1 text-right tabular-nums" />
                          <span className="text-sm text-gray-500">%</span>
                        </div>
                      </div>
                      <input type="range" min="0" max="80" step="1" value={simTargetRate} onChange={(e) => setSimTargetRate(Number(e.target.value))} className="mt-3 w-full" />
                      <div className="mt-1 flex justify-between text-[11px] text-gray-400"><span>0%</span><span>40%</span><span>80%</span></div>
                    </div>

                    <div className="grid sm:grid-cols-2 gap-3">
                      <label className="block rounded-lg border border-gray-200 p-3">
                        <div className="text-xs font-medium text-gray-600">初回購入者数</div>
                        <input type="number" min="0" value={simFirstBuyersInput ?? totalFirstCustomers} onChange={(e) => setSimFirstBuyersInput(Math.max(0, Number(e.target.value) || 0))} className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-right tabular-nums" />
                        <div className="mt-1 text-[11px] text-gray-400">期間実績を初期値に使用</div>
                      </label>
                      <label className="block rounded-lg border border-gray-200 p-3">
                        <div className="text-xs font-medium text-gray-600">2回目平均単価</div>
                        <div className="mt-1 flex items-center gap-1">
                          <span className="text-gray-400">¥</span>
                          <input type="number" min="0" step="100" value={simSecondValue} onChange={(e) => setSimSecondValue(Math.max(0, Number(e.target.value) || 0))} className="w-full rounded border border-gray-300 px-2 py-1 text-right tabular-nums" />
                        </div>
                        <div className="mt-1 text-[11px] text-gray-400">初期値 {yen(MATURE_F2_BASELINE.avgSecondOrderValue)}</div>
                      </label>
                    </div>

                    <div className="grid sm:grid-cols-3 gap-3">
                      <label className="block rounded-lg border border-gray-200 p-3">
                        <div className="text-xs font-medium text-gray-600">F2率: LINE連携あり</div>
                        <div className="mt-1 flex items-center gap-1"><input type="number" min="0" max="100" step="0.1" value={simLineF2} onChange={(e) => setSimLineF2(Math.max(0, Math.min(100, Number(e.target.value) || 0)))} className="w-full rounded border border-gray-300 px-2 py-1 text-right tabular-nums" /><span className="text-gray-500">%</span></div>
                      </label>
                      <label className="block rounded-lg border border-gray-200 p-3">
                        <div className="text-xs font-medium text-gray-600">F2率: LINE連携なし</div>
                        <div className="mt-1 flex items-center gap-1"><input type="number" min="0" max="100" step="0.1" value={simNoLineF2} onChange={(e) => setSimNoLineF2(Math.max(0, Math.min(100, Number(e.target.value) || 0)))} className="w-full rounded border border-gray-300 px-2 py-1 text-right tabular-nums" /><span className="text-gray-500">%</span></div>
                      </label>
                      <label className="block rounded-lg border border-gray-200 p-3">
                        <div className="text-xs font-medium text-gray-600">交絡調整</div>
                        <div className="mt-1 flex items-center gap-1"><input type="number" min="0" max="100" step="5" value={simConservativeFactor} onChange={(e) => setSimConservativeFactor(Math.max(0, Math.min(100, Number(e.target.value) || 0)))} className="w-full rounded border border-gray-300 px-2 py-1 text-right tabular-nums" /><span className="text-gray-500">%</span></div>
                        <div className="mt-1 text-[11px] text-gray-400">最大期待値を何%採用するか</div>
                      </label>
                    </div>
                  </div>

                  <div className="rounded-lg border-2 border-indigo-200 bg-indigo-50/60 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="text-xs font-medium text-indigo-700">シミュレーション結果</div>
                        <div className="mt-1 text-lg font-bold text-indigo-950">現状 {oneDecimal(currentInitialLineRate)}% → 目標 {oneDecimal(simTargetRate)}%</div>
                      </div>
                      {simTargetRate < currentInitialLineRate && <span className="rounded-full bg-amber-100 px-2 py-1 text-xs font-medium text-amber-800">現状以下</span>}
                    </div>

                    <div className="mt-4 grid grid-cols-2 gap-3">
                      <div className="rounded-md bg-white p-3 border border-indigo-100">
                        <div className="text-xs text-gray-500">目標連携人数</div>
                        <div className="mt-1 text-2xl font-bold tabular-nums text-gray-900">{num(simTargetLineCustomers)}人</div>
                        <div className="text-xs text-gray-500 mt-0.5">追加連携 +{num(simAdditionalLinked)}人</div>
                      </div>
                      <div className="rounded-md bg-white p-3 border border-indigo-100">
                        <div className="text-xs text-gray-500">想定F2到達</div>
                        <div className="mt-1 text-2xl font-bold tabular-nums text-gray-900">{oneDecimal(simTargetExpectedF2)}人</div>
                        <div className="text-xs text-gray-500 mt-0.5">現状期待値 {oneDecimal(simBaselineExpectedF2)}人</div>
                      </div>
                      <div className="rounded-md bg-white p-3 border border-indigo-100">
                        <div className="text-xs text-gray-500">追加F2（調整後）</div>
                        <div className="mt-1 text-2xl font-bold tabular-nums text-green-700">+{oneDecimal(simAdditionalF2Adjusted)}人</div>
                        <div className="text-xs text-gray-500 mt-0.5">最大期待値 +{oneDecimal(simAdditionalF2Max)}人</div>
                      </div>
                      <div className="rounded-md bg-white p-3 border border-indigo-100">
                        <div className="text-xs text-gray-500">追加2回目売上</div>
                        <div className="mt-1 text-2xl font-bold tabular-nums text-amber-700">{yen(simAdditionalSalesAdjusted)}</div>
                        <div className="text-xs text-gray-500 mt-0.5">最大 {yen(simAdditionalSalesMax)}</div>
                      </div>
                    </div>

                    <div className="mt-4 rounded-md bg-white border border-indigo-100 p-3 text-sm text-gray-700">
                      <span className="font-bold text-gray-900">読み方：</span>
                      連携率を {oneDecimal(simTargetRate)}% まで上げるには追加で約 {num(simAdditionalLinked)}人 のLINE連携が必要。F2率差 {oneDecimal(simF2LiftPct)}pt のうち {simConservativeFactor}% を実効効果として採用すると、追加F2は約 {oneDecimal(simAdditionalF2Adjusted)}人、2回目売上は約 {yen(simAdditionalSalesAdjusted)}。
                    </div>
                  </div>
                </div>

                <div className="px-4 sm:px-5 py-4 bg-slate-50 border-t border-slate-200">
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div>
                      <h3 className="font-bold text-gray-900">経営判断メモ</h3>
                      <p className="text-xs text-gray-500 mt-0.5">入力値を動かして、投資上限とテスト規模を決める</p>
                    </div>
                    <span className="px-2 py-1 rounded-full bg-amber-100 text-amber-800 text-xs font-medium">推奨: まず 30% 前後を軽量テスト</span>
                  </div>
                  <div className="grid md:grid-cols-3 gap-3 mt-3 text-sm">
                    <div className="rounded-md bg-white border border-gray-200 p-3">
                      <div className="text-xs text-gray-500">売上インパクト単体</div>
                      <div className="font-bold text-gray-900 mt-1">数字を動かすと上限が見える</div>
                      <p className="text-xs text-gray-600 mt-1">初回購入者数・単価・実効効果を変えても回収額が小さいなら、重い開発ではなく既存導線の改善から始める。</p>
                    </div>
                    <div className="rounded-md bg-white border border-gray-200 p-3">
                      <div className="text-xs text-gray-500">本質的な価値</div>
                      <div className="font-bold text-gray-900 mt-1">CRM施策の母数づくり</div>
                      <p className="text-xs text-gray-600 mt-1">F2フォロー・クロスセル・休眠復活・ポイント・Pay Forward・新商品先行案内は全てLINE連携が到達条件。ここが今後の打ち手の入口。</p>
                    </div>
                    <div className="rounded-md bg-white border border-gray-200 p-3">
                      <div className="text-xs text-gray-500">次の意思決定</div>
                      <div className="font-bold text-gray-900 mt-1">導線1〜2本だけ改善→計測</div>
                      <p className="text-xs text-gray-600 mt-1">サンクスページ／Shopifyメール／同梱物のどこで友だち追加を促すか棚卸し。30日後に初回連携率、60日後F2率で検証。</p>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {ltvRows.length > 0 && lineSeg && noLineSeg && (
              <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
                <div className="px-4 sm:px-5 py-3 border-b border-gray-200 bg-gray-50">
                  <h2 className="font-bold text-gray-900">💰 LTV分解（LINE連携 × F2転換）</h2>
                  <p className="text-xs text-gray-500 mt-0.5">LTVを「F2転換率」「30日内転換速度」「顧客あたり売上」に分解。どのレバーを伸ばすべきかを見る。</p>
                </div>
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-px bg-gray-200">
                  <div className="bg-white px-4 py-3">
                    <div className="text-xs text-gray-500">LTV差分</div>
                    <div className="mt-1 text-xl font-bold text-indigo-700 tabular-nums">{yen(ltvDelta)}</div>
                    <div className="text-xs text-gray-500 mt-0.5">LINE連携あり − なし</div>
                  </div>
                  <div className="bg-white px-4 py-3">
                    <div className="text-xs text-gray-500">F2率差分</div>
                    <div className="mt-1 text-xl font-bold text-green-700 tabular-nums">+{repeatRateLift.toFixed(1)}pt</div>
                    <div className="text-xs text-gray-500 mt-0.5">初回後の継続率レバー</div>
                  </div>
                  <div className="bg-white px-4 py-3">
                    <div className="text-xs text-gray-500">LTV機会額</div>
                    <div className="mt-1 text-xl font-bold text-amber-700 tabular-nums">{yen(ltvOpportunity)}</div>
                    <div className="text-xs text-gray-500 mt-0.5">未連携F2未到達 × LTV差分</div>
                  </div>
                </div>
                <div className="overflow-x-auto border-t border-gray-200">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 text-xs text-gray-600">
                      <tr>
                        <th className="px-3 py-2 text-left">セグメント</th>
                        <th className="px-3 py-2 text-right">LTV</th>
                        <th className="px-3 py-2 text-right">LTV指数</th>
                        <th className="px-3 py-2 text-right">F2率</th>
                        <th className="px-3 py-2 text-right hidden sm:table-cell">30日内F2</th>
                        <th className="px-3 py-2 text-right hidden md:table-cell">F2到達の内訳</th>
                        <th className="px-3 py-2 text-right">次アクション</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {ltvRows.map((row) => {
                        const within30 = row.first_order_customers > 0 ? (row.repeat_within_30d / row.first_order_customers) * 100 : 0
                        const isLine = row.segment === 'LINE連携あり'
                        return (
                          <tr key={row.segment}>
                            <td className="px-3 py-2 font-medium text-gray-900">{isLine ? '🟢' : '⚪'} {row.segment}</td>
                            <td className="px-3 py-2 text-right font-bold tabular-nums">{yen(row.ltv)}</td>
                            <td className={`px-3 py-2 text-right tabular-nums ${row.ltvIndex >= 120 ? 'text-green-700 font-bold' : 'text-gray-700'}`}>{row.ltvIndex.toFixed(0)}</td>
                            <td className="px-3 py-2 text-right text-gray-700 tabular-nums">{row.repeat_rate_pct}%</td>
                            <td className="px-3 py-2 text-right text-gray-700 tabular-nums hidden sm:table-cell">{within30.toFixed(1)}%</td>
                            <td className="px-3 py-2 text-right text-gray-700 tabular-nums hidden md:table-cell">{num(row.repeat_customers)}人 <span className="text-gray-400">({row.repeatShare.toFixed(0)}%)</span></td>
                            <td className="px-3 py-2 text-right text-xs text-gray-600">{isLine ? '配信頻度/商品提案を最適化' : 'LINE連携・友だち追加を最優先'}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="px-4 sm:px-5 py-3 bg-amber-50 border-t border-amber-100 text-xs text-amber-800">
                  注: 現APIで取れる範囲の簡易分解。次段階では `total_orders` をAPIへ出し、購入頻度 = 総注文数/顧客数、AOV = 総売上/総注文数まで厳密化する。
                </div>
              </div>
            )}

            {anomalies.length > 0 && (
              <div className="rounded-lg border-2 border-red-300 bg-red-50 p-4 sm:p-5">
                <div className="flex items-start gap-3">
                  <div className="text-2xl">🚨</div>
                  <div className="flex-1 min-w-0">
                    <div className="font-bold text-red-900">LINE連携率が著しく低いコホートを {anomalies.length} 件検出</div>
                    <div className="text-sm text-red-700 mt-1">新規顧客 200人以上の月で LINE連携率 15% 未満。</div>
                    <div className="mt-3 grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
                      {anomalies.slice(0, 6).map((a) => (
                        <div key={a.cohort_month} className="bg-white rounded-md border border-red-200 px-3 py-2 text-sm">
                          <div className="font-medium text-red-900">{a.cohort_month}</div>
                          <div className="text-xs text-red-700 mt-0.5">{num(a.first_order_customers)}人 / 連携率 {a.line_link_rate_pct}%</div>
                        </div>
                      ))}
                    </div>
                    {ltvDelta > 0 && (
                      <div className="mt-3 text-sm bg-white rounded-md border border-red-200 px-3 py-2">
                        <span className="text-red-900 font-medium">推定機会損失：{yen(lostValue)}</span>
                        <span className="text-red-700 ml-2">（LINE連携率 50% を達成していたら）</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {lineSeg && noLineSeg && (
              <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
                <div className="px-4 sm:px-5 py-3 border-b border-gray-200 bg-gray-50">
                  <h2 className="font-bold text-gray-900">LINE連携の経済価値</h2>
                  <p className="text-xs text-gray-500 mt-0.5">{periodLabel} の初回購入顧客 {num(lineSeg.first_order_customers + noLineSeg.first_order_customers)}人 の比較</p>
                </div>
                <div className="grid sm:grid-cols-2 divide-y sm:divide-y-0 sm:divide-x divide-gray-200">
                  <SegmentBlock seg={lineSeg} variant="primary" />
                  <SegmentBlock seg={noLineSeg} variant="secondary" />
                </div>
                <div className="px-4 sm:px-5 py-3 bg-indigo-50 border-t border-indigo-100 text-sm">
                  <span className="font-bold text-indigo-900">LINE連携1人 = 追加 {yen(ltvDelta)} のLTV</span>
                  <span className="text-indigo-700 ml-2">（リピート率 {lineSeg.repeat_rate_pct}% vs {noLineSeg.repeat_rate_pct}%）</span>
                </div>
              </div>
            )}

            {trafficSource.length > 0 && (
              <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
                <div className="px-4 sm:px-5 py-3 border-b border-gray-200 bg-gray-50">
                  <h2 className="font-bold text-gray-900">流入チャネル別 売上（{periodLabel}）</h2>
                  <p className="text-xs text-gray-500 mt-0.5">Shopify注文の landing_site UTM パラメータから判定</p>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 text-xs text-gray-600">
                      <tr>
                        <th className="px-3 py-2 text-left">チャネル</th>
                        <th className="px-3 py-2 text-right">注文</th>
                        <th className="px-3 py-2 text-right">売上</th>
                        <th className="px-3 py-2 text-right">客単価</th>
                        <th className="px-3 py-2 text-right hidden sm:table-cell">顧客あたり</th>
                        <th className="px-3 py-2 text-right hidden md:table-cell">新規率</th>
                        <th className="px-3 py-2 text-right hidden md:table-cell">LINE連携率</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {trafficSource.map((s) => {
                        const sourceMeta: Record<string, { label: string; emoji: string; color: string }> = {
                          email: { label: 'Email (Shopify Flow等)', emoji: '✉️', color: 'text-purple-700' },
                          gmail: { label: 'Gmail (referrer経由)', emoji: '📧', color: 'text-purple-600' },
                          line: { label: 'LINE (UTM)', emoji: '🟢', color: 'text-green-700' },
                          line_organic: { label: 'LINEアプリ内ブラウザ', emoji: '🟢', color: 'text-green-600' },
                          tiktok: { label: 'TikTok広告 (UTM)', emoji: '🎵', color: 'text-pink-700' },
                          tiktok_shop: { label: 'TikTok Shop', emoji: '🎵', color: 'text-pink-700' },
                          meta: { label: 'Meta広告 (IG/FB)', emoji: '📘', color: 'text-blue-700' },
                          meta_organic: { label: 'Meta オーガニック', emoji: '📘', color: 'text-blue-600' },
                          google: { label: 'Google広告', emoji: '🔍', color: 'text-red-700' },
                          google_organic: { label: 'Google検索 (オーガニック)', emoji: '🔎', color: 'text-red-600' },
                          search_organic: { label: 'Yahoo/Bing検索', emoji: '🔎', color: 'text-red-500' },
                          subscription: { label: '定期便（継続）', emoji: '🔄', color: 'text-cyan-700' },
                          shop_pay: { label: 'Shop Pay', emoji: '💳', color: 'text-indigo-600' },
                          yotpo: { label: 'Yotpo (レビュー)', emoji: '⭐', color: 'text-yellow-700' },
                          offline: { label: 'オフライン (チラシ等)', emoji: '📄', color: 'text-amber-700' },
                          direct_self: { label: '直接 (oryzae.shop)', emoji: '🔗', color: 'text-gray-700' },
                          direct: { label: '直接 (ブックマーク等)', emoji: '🔗', color: 'text-gray-600' },
                          other_utm: { label: 'その他UTM', emoji: '🏷️', color: 'text-gray-700' },
                          unknown: { label: '不明', emoji: '❓', color: 'text-orange-700' },
                        }
                        const meta = sourceMeta[s.source] ?? { label: s.source, emoji: '', color: 'text-gray-700' }
                        const newRate = s.orders > 0 ? (s.new_customer_orders / s.orders) * 100 : 0
                        const lineRate = s.orders > 0 ? (s.line_linked_orders / s.orders) * 100 : 0
                        return (
                          <tr key={s.source}>
                            <td className={`px-3 py-2 font-medium ${meta.color}`}>{meta.emoji} {meta.label}</td>
                            <td className="px-3 py-2 text-right tabular-nums">{num(s.orders)}</td>
                            <td className="px-3 py-2 text-right font-medium tabular-nums">{yen(s.revenue)}</td>
                            <td className="px-3 py-2 text-right text-gray-700 tabular-nums">{yen(s.aov)}</td>
                            <td className="px-3 py-2 text-right text-gray-700 tabular-nums hidden sm:table-cell">{yen(s.revenue_per_customer)}</td>
                            <td className="px-3 py-2 text-right text-gray-700 tabular-nums hidden md:table-cell">{newRate.toFixed(1)}%</td>
                            <td className="px-3 py-2 text-right text-gray-700 tabular-nums hidden md:table-cell">{lineRate.toFixed(1)}%</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="px-4 py-2 text-xs text-gray-500 bg-gray-50 border-t border-gray-100">💡 「不明」は landing_site が空の注文。「直接」は landing_site あるが UTM 無し。</div>
              </div>
            )}

            {channelMatrix.length > 0 && (
              <details className="bg-white border border-gray-200 rounded-lg">
                <summary className="px-4 sm:px-5 py-3 cursor-pointer font-bold text-gray-900 hover:bg-gray-50">📋 LINE連携 × メール購読登録 4象限（{periodLabel}）</summary>
                <div className="p-4 sm:p-5 border-t border-gray-100">
                  <p className="text-xs text-gray-500 mb-3">customers.subscribed_email = 1 の登録ベース。</p>
                  <div className="grid grid-cols-2 gap-3">
                    {[
                      { line: 1, email: 1, label: 'LINE有 × メール有', color: 'bg-purple-50 border-purple-300' },
                      { line: 1, email: 0, label: 'LINE有 × メール無', color: 'bg-green-50 border-green-300' },
                      { line: 0, email: 1, label: 'LINE無 × メール有', color: 'bg-blue-50 border-blue-300' },
                      { line: 0, email: 0, label: 'LINE無 × メール無', color: 'bg-gray-50 border-gray-300' },
                    ].map((q) => {
                      const row = channelMatrix.find((r) => r.line_linked === q.line && r.email_subscribed === q.email)
                      return (
                        <div key={q.label} className={`border-2 rounded-lg p-3 ${q.color}`}>
                          <div className="text-xs font-bold text-gray-700">{q.label}</div>
                          {row ? (
                            <><div className="text-lg font-bold text-gray-900 mt-1 tabular-nums">LTV {yen(row.ltv)}</div><div className="text-xs text-gray-600 mt-1 tabular-nums">{num(row.customers)}人 / {num(row.orders)}件</div></>
                          ) : <div className="text-xs text-gray-400 mt-2">該当なし</div>}
                        </div>
                      )
                    })}
                  </div>
                </div>
              </details>
            )}

            {cohort.length > 0 && (
              <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
                <div className="px-4 sm:px-5 py-3 border-b border-gray-200 bg-gray-50 flex items-center justify-between">
                  <div>
                    <h2 className="font-bold text-gray-900">月別 LINE連携率（コホート）</h2>
                    <p className="text-xs text-gray-500 mt-0.5">初回購入月別。LINE連携率の推移と異常検知。</p>
                  </div>
                  <Link href="/shopify-bi/cohort" className="text-sm text-indigo-600 hover:text-indigo-800">詳細 →</Link>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 text-xs text-gray-600">
                      <tr>
                        <th className="px-3 py-2 text-left">月</th>
                        <th className="px-3 py-2 text-right">新規顧客</th>
                        <th className="px-3 py-2 text-right">LINE連携率</th>
                        <th className="px-3 py-2 hidden sm:table-cell">推移</th>
                        <th className="px-3 py-2 text-right hidden md:table-cell">連携リピート率</th>
                        <th className="px-3 py-2 text-right hidden md:table-cell">非連携リピート率</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {cohort.slice(-12).map((c) => {
                        const isAnomaly = c.first_order_customers >= 200 && c.line_link_rate_pct < 15
                        return (
                          <tr key={c.cohort_month} className={isAnomaly ? 'bg-red-50' : ''}>
                            <td className="px-3 py-2 font-medium text-gray-900">{c.cohort_month} {isAnomaly && '⚠️'}</td>
                            <td className="px-3 py-2 text-right text-gray-700">{num(c.first_order_customers)}</td>
                            <td className={`px-3 py-2 text-right font-medium ${c.line_link_rate_pct >= 40 ? 'text-green-700' : c.line_link_rate_pct >= 20 ? 'text-yellow-700' : 'text-red-700'}`}>{c.line_link_rate_pct}%</td>
                            <td className="px-3 py-2 hidden sm:table-cell">
                              <div className="w-full bg-gray-200 rounded-full h-2 max-w-[200px]">
                                <div className={`h-2 rounded-full ${c.line_link_rate_pct >= 40 ? 'bg-green-500' : c.line_link_rate_pct >= 20 ? 'bg-yellow-500' : 'bg-red-500'}`} style={{ width: `${Math.min(100, c.line_link_rate_pct)}%` }} />
                              </div>
                            </td>
                            <td className="px-3 py-2 text-right text-gray-700 hidden md:table-cell">{c.line_repeat_rate_pct ?? '—'}%</td>
                            <td className="px-3 py-2 text-right text-gray-700 hidden md:table-cell">{c.noline_repeat_rate_pct ?? '—'}%</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <NavCard href="/shopify-bi/timeseries" emoji="📅" title="時系列分析" desc="日次・週次・月次 売上推移と前期比較" />
              <NavCard href="/shopify-bi/cohort" emoji="📈" title="コホート分析" desc="月別 × LINE連携 のリピート率比較" />
              <NavCard href="/shopify-bi/segment" emoji="🎯" title="ロイヤルティランク" desc="ランク別 LTV / 昇格速度" />
              <NavCard href="/shopify-bi/products" emoji="🛒" title="商品分析" desc="商品別売上 × LINE経由比率" />
            </div>

            <div className="text-sm text-gray-500 text-center pt-2">
              メールマーケ・AI施策の意思決定は <Link href="/email/cockpit" className="text-indigo-600 hover:text-indigo-800 underline">FERMENT Cockpit</Link> を参照。
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function KpiCard({ label, value, unit, color }: { label: string; value: string; unit?: string; color: 'blue' | 'green' | 'purple' | 'pink' }) {
  const colorMap = { blue: 'bg-blue-50 border-blue-200 text-blue-900', green: 'bg-green-50 border-green-200 text-green-900', purple: 'bg-purple-50 border-purple-200 text-purple-900', pink: 'bg-pink-50 border-pink-200 text-pink-900' }
  return (<div className={`rounded-lg border-2 px-4 py-3 ${colorMap[color]}`}><div className="text-xs font-medium opacity-70">{label}</div><div className="mt-1 text-xl sm:text-2xl font-bold tabular-nums">{value}{unit && <span className="text-sm font-normal opacity-70 ml-1">{unit}</span>}</div></div>)
}

function SegmentBlock({ seg, variant }: { seg: FunnelRow; variant: 'primary' | 'secondary' }) {
  const accent = variant === 'primary' ? 'text-indigo-700' : 'text-gray-600'
  return (
    <div className="px-4 sm:px-5 py-4">
      <div className={`text-sm font-bold ${accent}`}>{seg.segment}</div>
      <div className="text-xs text-gray-500 mt-0.5">初回購入 {num(seg.first_order_customers)}人</div>
      <div className="grid grid-cols-2 gap-3 mt-3">
        <div><div className="text-xs text-gray-500">LTV</div><div className="text-lg font-bold text-gray-900 tabular-nums">{yen(seg.ltv)}</div></div>
        <div><div className="text-xs text-gray-500">リピート率</div><div className="text-lg font-bold text-gray-900 tabular-nums">{seg.repeat_rate_pct}%</div></div>
        <div><div className="text-xs text-gray-500">30日内リピート</div><div className="text-base font-medium text-gray-700 tabular-nums">{seg.first_order_customers > 0 ? ((seg.repeat_within_30d / seg.first_order_customers) * 100).toFixed(1) : '—'}%</div></div>
        <div><div className="text-xs text-gray-500">平均日数</div><div className="text-base font-medium text-gray-700 tabular-nums">{seg.avg_days_to_second}日</div></div>
      </div>
    </div>
  )
}

function NavCard({ href, emoji, title, desc }: { href: string; emoji: string; title: string; desc: string }) {
  return (<Link href={href} className="block bg-white border border-gray-200 rounded-lg p-4 hover:border-indigo-300 hover:shadow-sm transition"><div className="text-2xl">{emoji}</div><div className="mt-2 font-bold text-gray-900">{title}</div><div className="text-xs text-gray-500 mt-0.5">{desc}</div></Link>)
}

function FunnelStat({ label, value, unit, sub, tone }: { label: string; value: string; unit?: string; sub?: string; tone: 'neutral' | 'good' | 'warn' }) {
  const toneMap = {
    neutral: 'text-gray-900',
    good: 'text-green-700',
    warn: 'text-amber-700',
  }
  return (
    <div className="bg-white px-4 py-3">
      <div className="text-xs text-gray-500">{label}</div>
      <div className={`mt-1 text-xl font-bold tabular-nums ${toneMap[tone]}`}>{value}{unit && <span className="text-sm font-normal text-gray-500 ml-1">{unit}</span>}</div>
      {sub && <div className="text-xs text-gray-500 mt-0.5">{sub}</div>}
    </div>
  )
}
