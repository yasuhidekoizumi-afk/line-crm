'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { fetchApi } from '@/lib/api'
import Header from '@/components/layout/header'

interface ProductRow {
  title: string
  product_type: string | null
  order_count: number
  units_sold: number
  gross_revenue: number
  line_revenue: number
  line_share_pct: number | null
}

const yen = (n: number) => '¥' + Math.round(n).toLocaleString('ja-JP')
const num = (n: number) => Math.round(n).toLocaleString('ja-JP')

export default function ProductsPage() {
  const [products, setProducts] = useState<ProductRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [period, setPeriod] = useState<'all' | '90d' | '30d'>('all')

  useEffect(() => {
    let cancelled = false
    void (async () => {
      setLoading(true)
      try {
        const params = new URLSearchParams({ limit: '30' })
        if (period === '30d') {
          const d = new Date()
          d.setDate(d.getDate() - 30)
          params.set('from', d.toISOString().slice(0, 10))
        } else if (period === '90d') {
          const d = new Date()
          d.setDate(d.getDate() - 90)
          params.set('from', d.toISOString().slice(0, 10))
        }
        const res = await fetchApi<{ success: boolean; data: ProductRow[] }>(
          `/api/shopify/orders/products-stats?${params.toString()}`,
        )
        if (cancelled) return
        if (res.success) setProducts(res.data)
      } catch (e) {
        if (!cancelled) setError(`読み込み失敗: ${String(e)}`)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [period])

  const totalRevenue = products.reduce((s, p) => s + p.gross_revenue, 0)
  const totalLineRevenue = products.reduce((s, p) => s + p.line_revenue, 0)
  const overallLineShare = totalRevenue > 0 ? (totalLineRevenue / totalRevenue) * 100 : 0

  return (
    <div>
      <Header title="商品分析" />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
          <div>
            <Link href="/shopify-bi" className="text-sm text-indigo-600 hover:text-indigo-800">
              ← 売上分析 TOP
            </Link>
            <h1 className="text-2xl font-bold text-gray-900 mt-1">🛒 商品分析</h1>
            <p className="text-sm text-gray-500">
              商品別売上トップ × LINE経由比率（リピート商品 vs 新規流入商品の構造を見る）
            </p>
          </div>
          <div className="inline-flex rounded-md shadow-sm" role="group">
            {(['all', '90d', '30d'] as const).map((p) => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={`px-3 py-1.5 text-sm border first:rounded-l-md last:rounded-r-md ${
                  period === p
                    ? 'bg-indigo-600 text-white border-indigo-600'
                    : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                }`}
              >
                {p === 'all' ? '全期間' : p === '90d' ? '直近90日' : '直近30日'}
              </button>
            ))}
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
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <div className="bg-white border border-gray-200 rounded-lg px-4 py-3">
                <div className="text-xs text-gray-500">表示商品数</div>
                <div className="text-xl font-bold mt-1">{products.length}</div>
              </div>
              <div className="bg-white border border-gray-200 rounded-lg px-4 py-3">
                <div className="text-xs text-gray-500">合計売上（表示分）</div>
                <div className="text-xl font-bold mt-1">{yen(totalRevenue)}</div>
              </div>
              <div className="bg-white border border-gray-200 rounded-lg px-4 py-3 col-span-2 sm:col-span-1">
                <div className="text-xs text-gray-500">平均 LINE経由比率</div>
                <div className="text-xl font-bold mt-1">{overallLineShare.toFixed(1)}%</div>
              </div>
            </div>

            {/* 商品テーブル */}
            <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-xs text-gray-600 sticky top-0">
                    <tr>
                      <th className="px-3 py-2 text-left">商品</th>
                      <th className="px-3 py-2 text-right hidden sm:table-cell">注文数</th>
                      <th className="px-3 py-2 text-right">売上</th>
                      <th className="px-3 py-2 text-right">LINE経由</th>
                      <th className="px-3 py-2 hidden md:table-cell">バー</th>
                      <th className="px-3 py-2 text-left hidden lg:table-cell">タイプ</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {products.map((p, i) => {
                      const share = p.line_share_pct ?? 0
                      const tag =
                        share >= 70
                          ? { label: 'リピート', color: 'bg-indigo-100 text-indigo-800' }
                          : share >= 40
                          ? { label: '中間', color: 'bg-yellow-100 text-yellow-800' }
                          : share > 0
                          ? { label: '新規流入', color: 'bg-orange-100 text-orange-800' }
                          : { label: 'LINE未経由', color: 'bg-red-100 text-red-800' }
                      return (
                        <tr key={i}>
                          <td className="px-3 py-2 max-w-xs">
                            <div className="text-gray-900 line-clamp-2">{p.title}</div>
                            <span
                              className={`inline-block mt-1 text-[10px] px-1.5 py-0.5 rounded ${tag.color}`}
                            >
                              {tag.label}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-right text-gray-700 tabular-nums hidden sm:table-cell">
                            {num(p.order_count)}
                          </td>
                          <td className="px-3 py-2 text-right font-medium text-gray-900 tabular-nums">
                            {yen(p.gross_revenue)}
                          </td>
                          <td className="px-3 py-2 text-right text-indigo-700 font-medium tabular-nums">
                            {share.toFixed(1)}%
                          </td>
                          <td className="px-3 py-2 hidden md:table-cell">
                            <div className="flex h-2 rounded overflow-hidden min-w-[100px] bg-gray-200">
                              <div
                                className="bg-indigo-500"
                                style={{ width: `${Math.min(100, share)}%` }}
                                title={`LINE: ${yen(p.line_revenue)}`}
                              />
                            </div>
                          </td>
                          <td className="px-3 py-2 text-xs text-gray-500 hidden lg:table-cell">
                            {p.product_type ?? '—'}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* 凡例 */}
            <div className="text-xs text-gray-500 bg-gray-50 border border-gray-200 rounded p-3">
              <div className="font-medium text-gray-700 mb-1">タグの意味</div>
              <div className="grid sm:grid-cols-4 gap-1">
                <div>
                  <span className="inline-block px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-800">
                    リピート
                  </span>{' '}
                  : LINE経由 ≥70%（既存顧客向け）
                </div>
                <div>
                  <span className="inline-block px-1.5 py-0.5 rounded bg-yellow-100 text-yellow-800">
                    中間
                  </span>{' '}
                  : 40-69%
                </div>
                <div>
                  <span className="inline-block px-1.5 py-0.5 rounded bg-orange-100 text-orange-800">
                    新規流入
                  </span>{' '}
                  : 1-39%（広告・初回向け）
                </div>
                <div>
                  <span className="inline-block px-1.5 py-0.5 rounded bg-red-100 text-red-800">
                    LINE未経由
                  </span>{' '}
                  : 0%（連携機会喪失）
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
