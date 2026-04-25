'use client'

import { useState, useEffect } from 'react'
import { fetchApi } from '@/lib/api'

interface ApiResult<T> { success: boolean; data?: T; error?: string }

interface BrandKit {
  brand_id: string
  name: string
  primary_color: string
  accent_color: string
  text_color: string
  bg_color: string
  font_family: string
  logo_url: string | null
  is_default: number
}

interface RetentionPolicy {
  email_logs_retention_days: number
  inactive_customer_purge_days: number
  audit_log_retention_days: number
}

const WORKER_URL = 'https://oryzae-line-crm.oryzae.workers.dev'

export default function SettingsPage() {
  const [brand, setBrand] = useState<BrandKit | null>(null)
  const [retention, setRetention] = useState<RetentionPolicy | null>(null)
  const [loading, setLoading] = useState(true)
  const [savedAt, setSavedAt] = useState<string | null>(null)

  useEffect(() => {
    Promise.all([
      fetchApi<ApiResult<BrandKit[]>>('/api/ferment/phase5/brand-kit'),
      fetchApi<ApiResult<RetentionPolicy>>('/api/ferment/phase5/retention'),
    ]).then(([b, r]) => {
      if (b.success && b.data && b.data.length > 0) setBrand(b.data[0])
      if (r.success && r.data) setRetention(r.data)
      setLoading(false)
    })
  }, [])

  const saveBrand = async () => {
    if (!brand) return
    const r = await fetchApi<ApiResult<unknown>>(`/api/ferment/phase5/brand-kit/${brand.brand_id}`, {
      method: 'PUT',
      body: JSON.stringify(brand),
    })
    if (r.success) setSavedAt(new Date().toLocaleTimeString('ja-JP'))
  }

  const saveRetention = async () => {
    if (!retention) return
    const r = await fetchApi<ApiResult<unknown>>('/api/ferment/phase5/retention', {
      method: 'PUT',
      body: JSON.stringify(retention),
    })
    if (r.success) setSavedAt(new Date().toLocaleTimeString('ja-JP'))
  }

  const apiKey = (typeof window !== 'undefined' && localStorage.getItem('lh_api_key')) || ''

  const downloadCsv = (path: string) => {
    const url = `${WORKER_URL}${path}`
    fetch(url, { headers: { Authorization: 'Bearer ' + apiKey } })
      .then((r) => r.blob())
      .then((blob) => {
        const a = document.createElement('a')
        a.href = URL.createObjectURL(blob)
        a.download = `${path.split('/').pop() ?? 'export'}.csv`
        a.click()
      })
  }

  return (
    <div className="max-w-5xl mx-auto py-8 px-4">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">FERMENT 設定</h1>
        <p className="text-sm text-gray-500 mt-1">ブランドキット・データ保持期間・エクスポート</p>
      </div>

      {savedAt && <div className="mb-4 p-3 bg-green-50 text-green-700 rounded-lg text-sm">保存しました ({savedAt})</div>}

      {loading ? (
        <div className="text-center py-12 text-gray-400">読み込み中...</div>
      ) : (
        <div className="space-y-6">
          {/* ブランドキット */}
          {brand && (
            <div className="bg-white border border-gray-200 rounded-xl p-6">
              <h2 className="text-base font-semibold text-gray-800 mb-4">🎨 ブランドキット</h2>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">ブランド名</label>
                  <input className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                    value={brand.name} onChange={(e) => setBrand({ ...brand, name: e.target.value })} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">ロゴ URL</label>
                  <input className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                    value={brand.logo_url ?? ''} onChange={(e) => setBrand({ ...brand, logo_url: e.target.value })} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">メインカラー</label>
                  <input type="color" className="w-full h-10 border border-gray-300 rounded-lg"
                    value={brand.primary_color} onChange={(e) => setBrand({ ...brand, primary_color: e.target.value })} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">アクセントカラー</label>
                  <input type="color" className="w-full h-10 border border-gray-300 rounded-lg"
                    value={brand.accent_color} onChange={(e) => setBrand({ ...brand, accent_color: e.target.value })} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">背景色</label>
                  <input type="color" className="w-full h-10 border border-gray-300 rounded-lg"
                    value={brand.bg_color} onChange={(e) => setBrand({ ...brand, bg_color: e.target.value })} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">テキスト色</label>
                  <input type="color" className="w-full h-10 border border-gray-300 rounded-lg"
                    value={brand.text_color} onChange={(e) => setBrand({ ...brand, text_color: e.target.value })} />
                </div>
              </div>
              <button onClick={saveBrand} className="mt-4 px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium">保存</button>
            </div>
          )}

          {/* データ保持期間 */}
          {retention && (
            <div className="bg-white border border-gray-200 rounded-xl p-6">
              <h2 className="text-base font-semibold text-gray-800 mb-4">📅 データ保持期間（GDPR・コンプライアンス）</h2>
              <div className="space-y-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">配信ログの保持日数</label>
                  <input type="number" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                    value={retention.email_logs_retention_days}
                    onChange={(e) => setRetention({ ...retention, email_logs_retention_days: parseInt(e.target.value) || 0 })} />
                  <p className="text-xs text-gray-400 mt-1">この日数を超えた配信ログは日次cronで自動削除（推奨: 730日 = 2年）</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">監査ログの保持日数</label>
                  <input type="number" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                    value={retention.audit_log_retention_days}
                    onChange={(e) => setRetention({ ...retention, audit_log_retention_days: parseInt(e.target.value) || 0 })} />
                  <p className="text-xs text-gray-400 mt-1">推奨: 365日</p>
                </div>
              </div>
              <button onClick={saveRetention} className="mt-4 px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium">保存</button>
            </div>
          )}

          {/* エクスポート */}
          <div className="bg-white border border-gray-200 rounded-xl p-6">
            <h2 className="text-base font-semibold text-gray-800 mb-4">📥 データエクスポート（CSV）</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <button onClick={() => downloadCsv('/api/ferment/phase5/export/customers')}
                className="p-4 border border-gray-200 rounded-lg hover:bg-gray-50 text-left">
                <p className="font-medium text-gray-900">統合顧客</p>
                <p className="text-xs text-gray-500 mt-1">customers.csv（最大50,000件）</p>
              </button>
              <button onClick={() => downloadCsv('/api/ferment/phase5/export/email-logs')}
                className="p-4 border border-gray-200 rounded-lg hover:bg-gray-50 text-left">
                <p className="font-medium text-gray-900">配信ログ</p>
                <p className="text-xs text-gray-500 mt-1">email-logs.csv（最大50,000件）</p>
              </button>
              <button onClick={() => downloadCsv('/api/ferment/phase5/export/campaigns')}
                className="p-4 border border-gray-200 rounded-lg hover:bg-gray-50 text-left">
                <p className="font-medium text-gray-900">キャンペーン実績</p>
                <p className="text-xs text-gray-500 mt-1">campaigns.csv（最大1,000件）</p>
              </button>
            </div>
          </div>

          {/* GDPR */}
          <div className="bg-white border border-gray-200 rounded-xl p-6">
            <h2 className="text-base font-semibold text-gray-800 mb-2">🛡️ GDPR データ削除</h2>
            <p className="text-sm text-gray-500 mb-4">顧客から削除リクエストがあった場合の処理</p>
            <p className="text-xs text-gray-600 mb-2">削除リクエスト一覧 API: <code>GET /api/ferment/phase5/gdpr/requests</code></p>
            <p className="text-xs text-gray-600">削除実行 API: <code>POST /api/ferment/phase5/gdpr/process/:id</code></p>
          </div>

          {/* 監査ログ */}
          <div className="bg-white border border-gray-200 rounded-xl p-6">
            <h2 className="text-base font-semibold text-gray-800 mb-2">📋 監査ログ</h2>
            <p className="text-sm text-gray-500 mb-2">全ての操作履歴（誰が・いつ・何を）</p>
            <p className="text-xs text-gray-600">参照 API: <code>GET /api/ferment/phase5/audit?limit=100</code></p>
          </div>
        </div>
      )}
    </div>
  )
}
