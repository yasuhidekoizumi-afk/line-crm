'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { fetchApi } from '@/lib/api'
import Header from '@/components/layout/header'

interface SegmentRow {
  rank: string
  first_order_customers: number
  repeat_customers: number
  repeat_rate_pct: number
  within_7d: number
  within_30d: number
  within_90d: number
  over_90d: number
  avg_days_to_second: number | null
  ltv: number
  avg_total_orders: number
}

const yen = (n: number) => '¥' + Math.round(n).toLocaleString('ja-JP')
const num = (n: number) => Math.round(n).toLocaleString('ja-JP')

const RANK_ORDER = ['ダイヤモンド', 'プラチナ', 'ゴールド', 'シルバー', 'レギュラー', '未連携']
const RANK_COLOR: Record<string, string> = {
  ダイヤモンド: 'bg-cyan-100 text-cyan-900 border-cyan-300',
  プラチナ: 'bg-slate-100 text-slate-900 border-slate-300',
  ゴールド: 'bg-amber-100 text-amber-900 border-amber-300',
  シルバー: 'bg-gray-100 text-gray-900 border-gray-300',
  レギュラー: 'bg-orange-50 text-orange-900 border-orange-200',
  未連携: 'bg-red-50 text-red-900 border-red-200',
}

export default function SegmentPage() {
  const [segments, setSegments] = useState<SegmentRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      setLoading(true)
      try {
        const res = await fetchApi<{ success: boolean; data: SegmentRow[] }>(
          `/api/customer-journey/segment`,
        )
        if (cancelled) return
        if (res.success) {
          const sorted = [...res.data].sort(
            (a, b) => RANK_ORDER.indexOf(a.rank) - RANK_ORDER.indexOf(b.rank),
          )
          setSegments(sorted)
        }
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

  const regular = segments.find((s) => s.rank === 'レギュラー')
  const stuckCount = regular ? regular.first_order_customers - regular.repeat_customers : 0

  return (
    <div>
      <Header title="ロイヤルティランク分析" />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        <div>
          <Link href="/shopify-bi" className="text-sm text-indigo-600 hover:text-indigo-800">
            ← 売上分析 TOP
          </Link>
          <h1 className="text-2xl font-bold text-gray-900 mt-1">🎯 ロイヤルティランク分析</h1>
          <p className="text-sm text-gray-500">
            ランク別 LTV / リピート率 / 昇格速度。「レギュラー → シルバー」の壁が真のKPI。
          </p>
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
            {/* レギュラー警告 */}
            {regular && stuckCount > 100 && (
              <div className="rounded-lg border-2 border-orange-300 bg-orange-50 p-4 sm:p-5">
                <div className="flex items-start gap-3">
                  <div className="text-2xl">🟠</div>
                  <div className="flex-1">
                    <div className="font-bold text-orange-900">
                      レギュラー死蔵層: {num(stuckCount)}人
                    </div>
                    <div className="text-sm text-orange-700 mt-1">
                      LINE連携してるのに2回目購入していない。シルバー以上に育てればLTVが
                      <span className="font-bold mx-1">3-10倍</span>
                      に跳ね上がる対象。
                    </div>
                    <div className="mt-2 text-xs text-orange-700">
                      レギュラー LTV ¥{num(regular.ltv)} → シルバー LTV ¥{num(segments.find((s) => s.rank === 'シルバー')?.ltv ?? 0)}
                      （4倍）
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* ランクカード */}
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {segments.map((s) => (
                <div
                  key={s.rank}
                  className={`border-2 rounded-lg p-4 ${RANK_COLOR[s.rank] ?? 'bg-white border-gray-200'}`}
                >
                  <div className="flex items-baseline justify-between">
                    <div className="font-bold text-lg">{s.rank}</div>
                    <div className="text-xs opacity-70">{num(s.first_order_customers)}人</div>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                    <div>
                      <div className="text-xs opacity-70">LTV</div>
                      <div className="font-bold tabular-nums">{yen(s.ltv)}</div>
                    </div>
                    <div>
                      <div className="text-xs opacity-70">リピート率</div>
                      <div className="font-bold tabular-nums">{s.repeat_rate_pct}%</div>
                    </div>
                    <div>
                      <div className="text-xs opacity-70">平均総注文数</div>
                      <div className="font-medium tabular-nums">{s.avg_total_orders}</div>
                    </div>
                    <div>
                      <div className="text-xs opacity-70">2回目までの平均</div>
                      <div className="font-medium tabular-nums">
                        {s.avg_days_to_second ?? '—'}日
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* 経過日数バケット */}
            <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
              <div className="px-4 sm:px-5 py-3 border-b border-gray-200 bg-gray-50">
                <h2 className="font-bold text-gray-900">2回目購入までの経過日数（リピートした顧客のみ）</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-xs text-gray-600">
                    <tr>
                      <th className="px-3 py-2 text-left">ランク</th>
                      <th className="px-3 py-2 text-right">7日以内</th>
                      <th className="px-3 py-2 text-right">8-30日</th>
                      <th className="px-3 py-2 text-right">31-90日</th>
                      <th className="px-3 py-2 text-right">91日以上</th>
                      <th className="px-3 py-2 hidden md:table-cell">分布</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {segments.map((s) => {
                      const total =
                        s.within_7d + s.within_30d + s.within_90d + s.over_90d
                      return (
                        <tr key={s.rank}>
                          <td className="px-3 py-2 font-medium text-gray-900">{s.rank}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{num(s.within_7d)}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{num(s.within_30d)}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{num(s.within_90d)}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{num(s.over_90d)}</td>
                          <td className="px-3 py-2 hidden md:table-cell">
                            {total > 0 && (
                              <div className="flex h-3 rounded overflow-hidden min-w-[120px]">
                                <div
                                  className="bg-green-500"
                                  style={{ width: `${(s.within_7d / total) * 100}%` }}
                                  title={`7日以内: ${s.within_7d}`}
                                />
                                <div
                                  className="bg-blue-400"
                                  style={{ width: `${(s.within_30d / total) * 100}%` }}
                                  title={`8-30日: ${s.within_30d}`}
                                />
                                <div
                                  className="bg-yellow-400"
                                  style={{ width: `${(s.within_90d / total) * 100}%` }}
                                  title={`31-90日: ${s.within_90d}`}
                                />
                                <div
                                  className="bg-red-400"
                                  style={{ width: `${(s.over_90d / total) * 100}%` }}
                                  title={`91日以上: ${s.over_90d}`}
                                />
                              </div>
                            )}
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
