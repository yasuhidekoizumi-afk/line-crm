'use client'

import { useEffect, useState } from 'react'
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

export default function ShopifyBiTopPage() {
  const [stats, setStats] = useState<OrderStats | null>(null)
  const [funnel, setFunnel] = useState<FunnelRow[]>([])
  const [cohort, setCohort] = useState<CohortRow[]>([])
  const [channelMatrix, setChannelMatrix] = useState<ChannelMatrixRow[]>([])
  const [trafficSource, setTrafficSource] = useState<TrafficSourceRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [recomputing, setRecomputing] = useState(false)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      setLoading(true)
      setError(null)
      try {
        const [statsRes, funnelRes, cohortRes, matrixRes, trafficRes] = await Promise.all([
          fetchApi<{ success: boolean; data: OrderStats }>(`/api/shopify/orders/stats`),
          fetchApi<{ success: boolean; data: FunnelRow[] }>(`/api/customer-journey/funnel`),
          fetchApi<{ success: boolean; data: CohortRow[] }>(
            `/api/customer-journey/cohort?from=2025-01&to=2026-12`,
          ),
          fetchApi<{ success: boolean; data: ChannelMatrixRow[] }>(
            `/api/customer-journey/channel-matrix`,
          ),
          fetchApi<{ success: boolean; data: TrafficSourceRow[] }>(
            `/api/customer-journey/traffic-source?from=2025-01-01`,
          ),
        ])
        if (cancelled) return
        if (statsRes.success) setStats(statsRes.data)
        if (funnelRes.success) setFunnel(funnelRes.data)
        if (matrixRes.success) setChannelMatrix(matrixRes.data)
        if (trafficRes.success) setTrafficSource(trafficRes.data)
        if (cohortRes.success) setCohort(cohortRes.data)
      } catch (e) {
        if (!cancelled) setError(`読み込み失敗: ${String(e)}`)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const handleRecompute = async () => {
    setRecomputing(true)
    try {
      await fetchApi<{ success: boolean }>(`/api/customer-journey/recompute`, { method: 'POST' })
      const [funnelRes, cohortRes] = await Promise.all([
        fetchApi<{ success: boolean; data: FunnelRow[] }>(`/api/customer-journey/funnel`),
        fetchApi<{ success: boolean; data: CohortRow[] }>(
          `/api/customer-journey/cohort?from=2025-01&to=2026-12`,
        ),
      ])
      if (funnelRes.success) setFunnel(funnelRes.data)
      if (cohortRes.success) setCohort(cohortRes.data)
    } catch (e) {
      setError(`再計算失敗: ${String(e)}`)
    } finally {
      setRecomputing(false)
    }
  }

  // 異常検知: コホート別 LINE連携率 < 15% の月を抽出
  const anomalies = cohort
    .filter((c) => c.first_order_customers >= 200 && c.line_link_rate_pct < 15)
    .sort((a, b) => b.first_order_customers - a.first_order_customers)

  const lineSeg = funnel.find((f) => f.segment === 'LINE連携あり')
  const noLineSeg = funnel.find((f) => f.segment === 'LINE連携なし')

  // 経済価値の試算
  const ltvDelta =
    lineSeg && noLineSeg ? Math.max(0, lineSeg.ltv - noLineSeg.ltv) : 0
  const lostCustomersInAnomalies = anomalies.reduce(
    (s, c) => s + Math.round(c.first_order_customers * (0.5 - c.line_link_rate_pct / 100)),
    0,
  )
  const lostValue = ltvDelta * lostCustomersInAnomalies

  return (
    <div>
      <Header title="売上分析" />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        {/* ─── ヘッダー ─── */}
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">📊 売上分析（Shopify BI）</h1>
            <p className="text-sm text-gray-500 mt-1">
              CRM活動 × Shopify購入 のアトリビューション。月次の経営判断起点。
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleRecompute}
              disabled={recomputing}
              className="px-3 py-1.5 text-sm rounded-md border border-gray-300 bg-white hover:bg-gray-50 disabled:opacity-50"
            >
              {recomputing ? '再計算中…' : '🔄 再計算'}
            </button>
            <Link
              href="/shopify-bi/cohort"
              className="px-3 py-1.5 text-sm rounded-md bg-indigo-600 text-white hover:bg-indigo-700"
            >
              コホート分析 →
            </Link>
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
            {/* ─── 全期間サマリ KPIカード ─── */}
            {stats && (
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <KpiCard label="総注文数" value={num(stats.order_count)} unit="件" color="blue" />
                <KpiCard label="総売上" value={yen(stats.total_revenue)} color="green" />
                <KpiCard
                  label="ユニーク顧客"
                  value={num(stats.unique_customers)}
                  unit="人"
                  color="purple"
                />
                <KpiCard
                  label="LINE連携注文比率"
                  value={
                    stats.order_count > 0
                      ? `${((stats.line_linked_orders / stats.order_count) * 100).toFixed(1)}%`
                      : '—'
                  }
                  color="pink"
                />
              </div>
            )}

            {/* ─── 異常検知アラート ─── */}
            {anomalies.length > 0 && (
              <div className="rounded-lg border-2 border-red-300 bg-red-50 p-4 sm:p-5">
                <div className="flex items-start gap-3">
                  <div className="text-2xl">🚨</div>
                  <div className="flex-1 min-w-0">
                    <div className="font-bold text-red-900">
                      LINE連携率が著しく低いコホートを {anomalies.length} 件検出
                    </div>
                    <div className="text-sm text-red-700 mt-1">
                      新規顧客 200人以上の月で LINE連携率 15% 未満。獲得チャネルが LINE 連携導線を
                      持っていない可能性。
                    </div>
                    <div className="mt-3 grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
                      {anomalies.slice(0, 6).map((a) => (
                        <div
                          key={a.cohort_month}
                          className="bg-white rounded-md border border-red-200 px-3 py-2 text-sm"
                        >
                          <div className="font-medium text-red-900">{a.cohort_month}</div>
                          <div className="text-xs text-red-700 mt-0.5">
                            {num(a.first_order_customers)}人 / 連携率 {a.line_link_rate_pct}%
                          </div>
                        </div>
                      ))}
                    </div>
                    {ltvDelta > 0 && (
                      <div className="mt-3 text-sm bg-white rounded-md border border-red-200 px-3 py-2">
                        <span className="text-red-900 font-medium">
                          推定機会損失：{yen(lostValue)}
                        </span>
                        <span className="text-red-700 ml-2">
                          （LINE連携率 50% を達成していたら）
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* ─── LINE連携の経済価値 ─── */}
            {lineSeg && noLineSeg && (
              <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
                <div className="px-4 sm:px-5 py-3 border-b border-gray-200 bg-gray-50">
                  <h2 className="font-bold text-gray-900">LINE連携の経済価値</h2>
                  <p className="text-xs text-gray-500 mt-0.5">
                    全期間の初回購入顧客 {num(lineSeg.first_order_customers + noLineSeg.first_order_customers)}人
                    の比較
                  </p>
                </div>
                <div className="grid sm:grid-cols-2 divide-y sm:divide-y-0 sm:divide-x divide-gray-200">
                  <SegmentBlock seg={lineSeg} variant="primary" />
                  <SegmentBlock seg={noLineSeg} variant="secondary" />
                </div>
                <div className="px-4 sm:px-5 py-3 bg-indigo-50 border-t border-indigo-100 text-sm">
                  <span className="font-bold text-indigo-900">
                    LINE連携1人 = 追加 {yen(ltvDelta)} のLTV
                  </span>
                  <span className="text-indigo-700 ml-2">
                    （リピート率 {lineSeg.repeat_rate_pct}% vs {noLineSeg.repeat_rate_pct}%）
                  </span>
                </div>
              </div>
            )}

            {/* ─── 流入チャネル別 売上（landing_site UTM ベース）─── */}
            {trafficSource.length > 0 && (
              <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
                <div className="px-4 sm:px-5 py-3 border-b border-gray-200 bg-gray-50">
                  <h2 className="font-bold text-gray-900">流入チャネル別 売上（2025年〜）</h2>
                  <p className="text-xs text-gray-500 mt-0.5">
                    Shopify注文の landing_site UTM パラメータ から判定（Shopify Flow メール / LINE / TikTok / 広告 etc）
                  </p>
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
                          line: { label: 'LINE', emoji: '🟢', color: 'text-green-700' },
                          tiktok: { label: 'TikTok広告', emoji: '🎵', color: 'text-pink-700' },
                          meta: { label: 'Meta (FB/IG)', emoji: '📘', color: 'text-blue-700' },
                          google: { label: 'Google広告', emoji: '🔍', color: 'text-red-700' },
                          other_utm: { label: 'その他UTM', emoji: '🏷️', color: 'text-gray-700' },
                          direct: { label: '直接 (UTMなし)', emoji: '🔗', color: 'text-gray-600' },
                          none: { label: '不明 (TikTok Shop等)', emoji: '❓', color: 'text-orange-700' },
                        }
                        const meta = sourceMeta[s.source] ?? { label: s.source, emoji: '', color: 'text-gray-700' }
                        const newRate = s.orders > 0 ? (s.new_customer_orders / s.orders) * 100 : 0
                        const lineRate = s.orders > 0 ? (s.line_linked_orders / s.orders) * 100 : 0
                        return (
                          <tr key={s.source}>
                            <td className={`px-3 py-2 font-medium ${meta.color}`}>
                              {meta.emoji} {meta.label}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums">{num(s.orders)}</td>
                            <td className="px-3 py-2 text-right font-medium tabular-nums">{yen(s.revenue)}</td>
                            <td className="px-3 py-2 text-right text-gray-700 tabular-nums">{yen(s.aov)}</td>
                            <td className="px-3 py-2 text-right text-gray-700 tabular-nums hidden sm:table-cell">
                              {yen(s.revenue_per_customer)}
                            </td>
                            <td className="px-3 py-2 text-right text-gray-700 tabular-nums hidden md:table-cell">
                              {newRate.toFixed(1)}%
                            </td>
                            <td className="px-3 py-2 text-right text-gray-700 tabular-nums hidden md:table-cell">
                              {lineRate.toFixed(1)}%
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="px-4 py-2 text-xs text-gray-500 bg-gray-50 border-t border-gray-100">
                  💡 「不明」は landing_site が空の注文（TikTok Shop の checkout 経由など）。「直接」は landing_site あるが UTM 無し。
                </div>
              </div>
            )}

            {/* ─── サブセクション：LINE × Email 購読登録 4象限 ─── */}
            {channelMatrix.length > 0 && (
              <details className="bg-white border border-gray-200 rounded-lg">
                <summary className="px-4 sm:px-5 py-3 cursor-pointer font-bold text-gray-900 hover:bg-gray-50">
                  📋 LINE連携 × メール購読登録 4象限（参考）
                </summary>
                <div className="p-4 sm:p-5 border-t border-gray-100">
                  <p className="text-xs text-gray-500 mb-3">
                    customers.subscribed_email = 1 の登録ベース。実購入経路（UTM）とは別軸。
                  </p>
                  <div className="grid grid-cols-2 gap-3">
                    {[
                      { line: 1, email: 1, label: 'LINE有 × メール有', color: 'bg-purple-50 border-purple-300' },
                      { line: 1, email: 0, label: 'LINE有 × メール無', color: 'bg-green-50 border-green-300' },
                      { line: 0, email: 1, label: 'LINE無 × メール有', color: 'bg-blue-50 border-blue-300' },
                      { line: 0, email: 0, label: 'LINE無 × メール無', color: 'bg-gray-50 border-gray-300' },
                    ].map((q) => {
                      const row = channelMatrix.find(
                        (r) => r.line_linked === q.line && r.email_subscribed === q.email,
                      )
                      return (
                        <div key={q.label} className={`border-2 rounded-lg p-3 ${q.color}`}>
                          <div className="text-xs font-bold text-gray-700">{q.label}</div>
                          {row ? (
                            <>
                              <div className="text-lg font-bold text-gray-900 mt-1 tabular-nums">
                                LTV {yen(row.ltv)}
                              </div>
                              <div className="text-xs text-gray-600 mt-1 tabular-nums">
                                {num(row.customers)}人 / {num(row.orders)}件
                              </div>
                            </>
                          ) : (
                            <div className="text-xs text-gray-400 mt-2">該当なし</div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              </details>
            )}

            {/* ─── 直近 12ヶ月のコホート連携率推移 ─── */}
            {cohort.length > 0 && (
              <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
                <div className="px-4 sm:px-5 py-3 border-b border-gray-200 bg-gray-50 flex items-center justify-between">
                  <div>
                    <h2 className="font-bold text-gray-900">月別 LINE連携率（コホート）</h2>
                    <p className="text-xs text-gray-500 mt-0.5">
                      初回購入月別。LINE連携率の推移と異常検知。
                    </p>
                  </div>
                  <Link
                    href="/shopify-bi/cohort"
                    className="text-sm text-indigo-600 hover:text-indigo-800"
                  >
                    詳細 →
                  </Link>
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
                            <td className="px-3 py-2 font-medium text-gray-900">
                              {c.cohort_month} {isAnomaly && '⚠️'}
                            </td>
                            <td className="px-3 py-2 text-right text-gray-700">
                              {num(c.first_order_customers)}
                            </td>
                            <td
                              className={`px-3 py-2 text-right font-medium ${
                                c.line_link_rate_pct >= 40
                                  ? 'text-green-700'
                                  : c.line_link_rate_pct >= 20
                                  ? 'text-yellow-700'
                                  : 'text-red-700'
                              }`}
                            >
                              {c.line_link_rate_pct}%
                            </td>
                            <td className="px-3 py-2 hidden sm:table-cell">
                              <div className="w-full bg-gray-200 rounded-full h-2 max-w-[200px]">
                                <div
                                  className={`h-2 rounded-full ${
                                    c.line_link_rate_pct >= 40
                                      ? 'bg-green-500'
                                      : c.line_link_rate_pct >= 20
                                      ? 'bg-yellow-500'
                                      : 'bg-red-500'
                                  }`}
                                  style={{ width: `${Math.min(100, c.line_link_rate_pct)}%` }}
                                />
                              </div>
                            </td>
                            <td className="px-3 py-2 text-right text-gray-700 hidden md:table-cell">
                              {c.line_repeat_rate_pct ?? '—'}%
                            </td>
                            <td className="px-3 py-2 text-right text-gray-700 hidden md:table-cell">
                              {c.noline_repeat_rate_pct ?? '—'}%
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* ─── 関連ページへの導線 ─── */}
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <NavCard
                href="/shopify-bi/timeseries"
                emoji="📅"
                title="時系列分析"
                desc="日次・週次・月次 売上推移と前期比較"
              />
              <NavCard
                href="/shopify-bi/cohort"
                emoji="📈"
                title="コホート分析"
                desc="月別 × LINE連携 のリピート率比較"
              />
              <NavCard
                href="/shopify-bi/segment"
                emoji="🎯"
                title="ロイヤルティランク"
                desc="ランク別 LTV / 昇格速度"
              />
              <NavCard
                href="/shopify-bi/products"
                emoji="🛒"
                title="商品分析"
                desc="商品別売上 × LINE経由比率"
              />
            </div>

            {/* ─── FERMENT cockpit へのリンク ─── */}
            <div className="text-sm text-gray-500 text-center pt-2">
              メールマーケ・AI施策の意思決定は{' '}
              <Link
                href="/email/cockpit"
                className="text-indigo-600 hover:text-indigo-800 underline"
              >
                FERMENT Cockpit
              </Link>
              {' '}を参照。
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function KpiCard({
  label,
  value,
  unit,
  color,
}: {
  label: string
  value: string
  unit?: string
  color: 'blue' | 'green' | 'purple' | 'pink'
}) {
  const colorMap = {
    blue: 'bg-blue-50 border-blue-200 text-blue-900',
    green: 'bg-green-50 border-green-200 text-green-900',
    purple: 'bg-purple-50 border-purple-200 text-purple-900',
    pink: 'bg-pink-50 border-pink-200 text-pink-900',
  }
  return (
    <div className={`rounded-lg border-2 px-4 py-3 ${colorMap[color]}`}>
      <div className="text-xs font-medium opacity-70">{label}</div>
      <div className="mt-1 text-xl sm:text-2xl font-bold tabular-nums">
        {value}
        {unit && <span className="text-sm font-normal opacity-70 ml-1">{unit}</span>}
      </div>
    </div>
  )
}

function SegmentBlock({
  seg,
  variant,
}: {
  seg: FunnelRow
  variant: 'primary' | 'secondary'
}) {
  const accent = variant === 'primary' ? 'text-indigo-700' : 'text-gray-600'
  return (
    <div className="px-4 sm:px-5 py-4">
      <div className={`text-sm font-bold ${accent}`}>{seg.segment}</div>
      <div className="text-xs text-gray-500 mt-0.5">
        初回購入 {num(seg.first_order_customers)}人
      </div>
      <div className="grid grid-cols-2 gap-3 mt-3">
        <div>
          <div className="text-xs text-gray-500">LTV</div>
          <div className="text-lg font-bold text-gray-900 tabular-nums">{yen(seg.ltv)}</div>
        </div>
        <div>
          <div className="text-xs text-gray-500">リピート率</div>
          <div className="text-lg font-bold text-gray-900 tabular-nums">{seg.repeat_rate_pct}%</div>
        </div>
        <div>
          <div className="text-xs text-gray-500">30日内リピート</div>
          <div className="text-base font-medium text-gray-700 tabular-nums">
            {seg.first_order_customers > 0
              ? ((seg.repeat_within_30d / seg.first_order_customers) * 100).toFixed(1)
              : '—'}
            %
          </div>
        </div>
        <div>
          <div className="text-xs text-gray-500">平均日数</div>
          <div className="text-base font-medium text-gray-700 tabular-nums">
            {seg.avg_days_to_second}日
          </div>
        </div>
      </div>
    </div>
  )
}

function NavCard({
  href,
  emoji,
  title,
  desc,
}: {
  href: string
  emoji: string
  title: string
  desc: string
}) {
  return (
    <Link
      href={href}
      className="block bg-white border border-gray-200 rounded-lg p-4 hover:border-indigo-300 hover:shadow-sm transition"
    >
      <div className="text-2xl">{emoji}</div>
      <div className="mt-2 font-bold text-gray-900">{title}</div>
      <div className="text-xs text-gray-500 mt-0.5">{desc}</div>
    </Link>
  )
}
