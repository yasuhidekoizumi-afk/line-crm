'use client'

import { useEffect, useState } from 'react'
import { fetchApi } from '@/lib/api'
import Header from '@/components/layout/header'

interface RakutenStatus {
  configured: boolean
  hasSecrets: boolean
  issuedAt?: string
  expiresAt?: string
  daysLeft?: number
  status?: string
  pausedPolling?: boolean
  lastVerifiedAt?: string | null
  lastError?: string | null
}

const STATUS_LABEL: Record<string, { label: string; color: string }> = {
  active: { label: '✅ 稼働中', color: 'bg-green-100 text-green-800' },
  expired: { label: '🚨 失効', color: 'bg-red-100 text-red-800' },
  rotating: { label: '🔄 更新中', color: 'bg-yellow-100 text-yellow-800' },
  unverified: { label: '⏳ 未検証', color: 'bg-gray-100 text-gray-700' },
}

export default function CsSettingsPage() {
  const [status, setStatus] = useState<RakutenStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [verifying, setVerifying] = useState(false)
  const [issuedAt, setIssuedAt] = useState<string>(() => new Date().toISOString().slice(0, 10))

  async function refresh() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetchApi<{ success: boolean; data: RakutenStatus }>(
        '/api/cs/rakuten/status',
      )
      setStatus(res.data)
    } catch (e) {
      setError(`読み込み失敗: ${String(e)}`)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void refresh()
  }, [])

  async function handleVerify() {
    setVerifying(true)
    setError(null)
    try {
      await fetchApi<{ success: boolean }>(`/api/cs/rakuten/verify`, {
        method: 'POST',
        body: JSON.stringify({ issuedAt: new Date(issuedAt).toISOString() }),
      })
      await refresh()
    } catch (e) {
      setError(`疎通失敗: ${String(e)}`)
    } finally {
      setVerifying(false)
    }
  }

  const daysLeft = status?.daysLeft ?? null
  const barColor =
    daysLeft === null
      ? 'bg-gray-300'
      : daysLeft <= 7
        ? 'bg-red-500'
        : daysLeft <= 14
          ? 'bg-orange-400'
          : daysLeft <= 30
            ? 'bg-yellow-400'
            : 'bg-green-500'
  const barPct = daysLeft === null ? 0 : Math.max(0, Math.min(100, (daysLeft / 90) * 100))
  const statusInfo = status?.status ? STATUS_LABEL[status.status] ?? STATUS_LABEL.unverified : null

  return (
    <div>
      <Header
        title="CS 設定"
        description="楽天 RMS WEB SERVICE 等、外部連携設定"
      />

      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          {error}
        </div>
      )}

      {loading && (
        <div className="text-center py-12 text-gray-500 text-sm">読み込み中...</div>
      )}

      {status && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-4">
          <div className="flex items-center justify-between flex-wrap gap-2 mb-4">
            <h2 className="text-lg font-bold text-gray-900">🛍️ 楽天 RMS WEB SERVICE 連携</h2>
            {statusInfo && (
              <span
                className={`px-3 py-1 text-sm rounded-full ${statusInfo.color}`}
              >
                {statusInfo.label}
              </span>
            )}
          </div>

          {!status.hasSecrets && (
            <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-md mb-4">
              <p className="text-sm text-yellow-800 font-medium mb-1">⚠️ シークレット未登録</p>
              <p className="text-xs text-yellow-700 mb-2">
                次のコマンドで <code>RAKUTEN_SERVICE_SECRET</code> と <code>RAKUTEN_LICENSE_KEY</code> を Worker に登録してください：
              </p>
              <pre className="text-xs bg-white p-2 rounded border border-yellow-200 font-mono whitespace-pre-wrap break-all">
{`cd apps/worker
npx wrangler secret put RAKUTEN_SERVICE_SECRET
npx wrangler secret put RAKUTEN_LICENSE_KEY`}
              </pre>
            </div>
          )}

          {status.configured && (
            <div className="space-y-3 mb-4">
              <KeyValue label="発行日" value={status.issuedAt?.slice(0, 10) ?? '-'} />
              <KeyValue label="失効予定日" value={status.expiresAt?.slice(0, 10) ?? '-'} />
              <KeyValue
                label="残り日数"
                value={daysLeft !== null ? `${daysLeft}日` : '-'}
                accent={
                  daysLeft !== null && daysLeft <= 7
                    ? 'red'
                    : daysLeft !== null && daysLeft <= 14
                      ? 'orange'
                      : 'default'
                }
              />
              <div>
                <p className="text-xs text-gray-500 mb-1">残期間バー</p>
                <div className="bg-gray-100 rounded-full h-3 overflow-hidden">
                  <div
                    className={`h-full ${barColor} transition-all`}
                    style={{ width: `${barPct}%` }}
                  />
                </div>
              </div>
              {status.lastVerifiedAt && (
                <KeyValue
                  label="最終疎通確認"
                  value={new Date(status.lastVerifiedAt).toLocaleString('ja-JP')}
                />
              )}
              {status.pausedPolling && (
                <p className="text-sm text-red-600 font-medium">
                  ⚠️ ポーリング一時停止中（401検知）
                </p>
              )}
              {status.lastError && (
                <details className="text-xs">
                  <summary className="cursor-pointer text-gray-500">直近エラーを表示</summary>
                  <pre className="mt-1 p-2 bg-red-50 text-red-700 rounded whitespace-pre-wrap">
                    {status.lastError}
                  </pre>
                </details>
              )}
            </div>
          )}

          {/* 新キー登録セクション */}
          <div className="mt-6 pt-4 border-t border-gray-200">
            <h3 className="text-sm font-bold text-gray-900 mb-2">🔑 新しい licenseKey を登録（疎通確認）</h3>
            <p className="text-xs text-gray-600 mb-3">
              RMS 管理画面で再発行した license key を <code>wrangler secret put RAKUTEN_LICENSE_KEY</code> で登録した後、ここをクリックして疎通確認してください。発行日を保存し、90日後を失効予定として記録します。
            </p>
            <div className="flex flex-wrap items-end gap-2">
              <label className="text-sm">
                <span className="block text-xs text-gray-500 mb-1">発行日</span>
                <input
                  type="date"
                  value={issuedAt}
                  onChange={(e) => setIssuedAt(e.target.value)}
                  className="border border-gray-300 rounded-md px-3 py-1.5 bg-white text-sm"
                />
              </label>
              <button
                onClick={handleVerify}
                disabled={verifying || !status.hasSecrets}
                className="px-4 py-2 text-sm font-medium text-white bg-purple-600 hover:bg-purple-700 rounded-md disabled:opacity-50"
              >
                {verifying ? '疎通確認中...' : '✅ 疎通確認 + 発行日登録'}
              </button>
            </div>
          </div>

          <div className="mt-6 pt-4 border-t border-gray-200 flex gap-2">
            <a
              href="https://mms.rakuten.co.jp/"
              target="_blank"
              rel="noopener noreferrer"
              className="px-3 py-1.5 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-md"
            >
              🔗 RMS 管理画面
            </a>
          </div>
        </div>
      )}
    </div>
  )
}

function KeyValue({
  label,
  value,
  accent = 'default',
}: {
  label: string
  value: string
  accent?: 'default' | 'red' | 'orange'
}) {
  const valueClass =
    accent === 'red'
      ? 'text-red-600 font-bold'
      : accent === 'orange'
        ? 'text-orange-600 font-bold'
        : 'text-gray-900'
  return (
    <div className="flex justify-between text-sm">
      <span className="text-gray-500">{label}</span>
      <span className={valueClass}>{value}</span>
    </div>
  )
}
