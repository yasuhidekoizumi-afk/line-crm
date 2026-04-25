'use client'

import { useState, useEffect } from 'react'
import { fetchApi } from '@/lib/api'

interface ApiResult<T> {
  success: boolean
  data?: T
  error?: string
}

interface InsightSummary {
  total: number
  with_clv: number
  avg_clv: number
  total_clv: number
  high_intent: number
}

export default function InsightsPage() {
  const [summary, setSummary] = useState<InsightSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    fetchApi<ApiResult<InsightSummary>>('/api/ferment/insights/summary')
      .then((r) => {
        if (r.success && r.data) setSummary(r.data)
        else setError(r.error ?? '取得失敗')
      })
      .catch(() => setError('取得失敗'))
      .finally(() => setLoading(false))
  }, [])

  return (
    <div className="max-w-6xl mx-auto py-8 px-4">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">顧客インサイト</h1>
        <p className="text-sm text-gray-500 mt-1">予測 CLV・購入確率・最適配信時刻（毎日0時に自動再計算）</p>
      </div>

      {error && <div className="mb-4 p-3 bg-red-50 text-red-600 rounded-lg text-sm">{error}</div>}

      {loading ? (
        <div className="text-center py-12 text-gray-400">読み込み中...</div>
      ) : summary ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <div className="bg-white border border-gray-200 rounded-xl p-5">
            <p className="text-xs text-gray-500">分析対象顧客</p>
            <p className="text-3xl font-bold text-gray-900 mt-2">{summary.total.toLocaleString()}</p>
            <p className="text-xs text-gray-400 mt-2">メール購読中の全顧客</p>
          </div>
          <div className="bg-white border border-gray-200 rounded-xl p-5">
            <p className="text-xs text-gray-500">CLV 算出済み</p>
            <p className="text-3xl font-bold text-gray-900 mt-2">{summary.with_clv.toLocaleString()}</p>
            <p className="text-xs text-gray-400 mt-2">購入実績のある顧客</p>
          </div>
          <div className="bg-white border border-gray-200 rounded-xl p-5">
            <p className="text-xs text-gray-500">平均 予測 CLV</p>
            <p className="text-3xl font-bold text-green-600 mt-2">¥{Math.floor(summary.avg_clv ?? 0).toLocaleString()}</p>
            <p className="text-xs text-gray-400 mt-2">顧客1人あたりの将来購入予測</p>
          </div>
          <div className="bg-white border border-gray-200 rounded-xl p-5">
            <p className="text-xs text-gray-500">高購入意欲（30日内）</p>
            <p className="text-3xl font-bold text-purple-600 mt-2">{summary.high_intent.toLocaleString()}</p>
            <p className="text-xs text-gray-400 mt-2">今すぐアプローチ推奨</p>
          </div>
        </div>
      ) : null}

      <div className="bg-white border border-gray-200 rounded-xl p-6">
        <h2 className="text-base font-semibold text-gray-800 mb-4">📊 計算ロジック</h2>
        <dl className="grid grid-cols-1 md:grid-cols-2 gap-6 text-sm">
          <div>
            <dt className="font-semibold text-gray-700 mb-1">予測 CLV</dt>
            <dd className="text-gray-600">
              平均購入額 × 推定残存購入回数<br />
              （顧客寿命 36ヶ月想定、現在の購入頻度から推計）
            </dd>
          </div>
          <div>
            <dt className="font-semibold text-gray-700 mb-1">30日購入確率</dt>
            <dd className="text-gray-600">
              平均購入間隔と最終購入からの経過日数を元に計算<br />
              （指数減衰モデル）
            </dd>
          </div>
          <div>
            <dt className="font-semibold text-gray-700 mb-1">最適送信時刻</dt>
            <dd className="text-gray-600">
              過去のメール開封ログから、その顧客が最もよく開封する時刻を抽出<br />
              （配信時に使用予定）
            </dd>
          </div>
          <div>
            <dt className="font-semibold text-gray-700 mb-1">購入確率セグメント例</dt>
            <dd className="text-gray-600 font-mono text-xs">
              {`{ "field": "purchase_probability_30d", "operator": ">=", "value": 0.5 }`}
            </dd>
          </div>
        </dl>
      </div>
    </div>
  )
}
