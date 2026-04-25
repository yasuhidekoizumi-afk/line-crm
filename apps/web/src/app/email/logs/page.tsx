'use client'

import { useState, useEffect, useCallback } from 'react'
import { fermentApi, type EmailLog } from '@/lib/ferment-api'
import { ORYZAE_BENCHMARK, compareToBenchmark } from '@/lib/benchmarks'

const STATUS_CONFIG: Record<string, { label: string; cls: string }> = {
  queued:   { label: 'キュー待ち',  cls: 'bg-gray-100 text-gray-500' },
  sent:     { label: '送信済み',    cls: 'bg-blue-100 text-blue-700' },
  opened:   { label: '開封済み',    cls: 'bg-green-100 text-green-700' },
  clicked:  { label: 'クリック済',  cls: 'bg-purple-100 text-purple-700' },
  bounced:  { label: 'バウンス',    cls: 'bg-red-100 text-red-600' },
  failed:   { label: '失敗',        cls: 'bg-red-100 text-red-600' },
  unsubscribed: { label: '配信停止', cls: 'bg-orange-100 text-orange-700' },
}

function fmt(iso: string | null) {
  if (!iso) return '-'
  return new Date(iso).toLocaleString('ja-JP', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  })
}

export default function EmailLogsPage() {
  const [logs, setLogs] = useState<EmailLog[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [campaignId, setCampaignId] = useState('')
  const [offset, setOffset] = useState(0)
  const [total, setTotal] = useState(0)
  const [statusFilter, setStatusFilter] = useState('')

  const LIMIT = 100

  const load = useCallback(async (off = 0) => {
    setLoading(true)
    setError('')
    try {
      const res = await fermentApi.logs.list({
        campaign_id: campaignId || undefined,
        limit: LIMIT,
        offset: off,
      })
      if (res.success && res.data) {
        setLogs(res.data)
        setTotal(res.meta?.total ?? res.data.length)
      }
    } catch {
      setError('読み込みに失敗しました')
    } finally {
      setLoading(false)
    }
  }, [campaignId])

  useEffect(() => {
    setOffset(0)
    load(0)
  }, [load])

  const handlePageChange = (newOffset: number) => {
    setOffset(newOffset)
    load(newOffset)
  }

  const displayed = statusFilter
    ? logs.filter((l) => l.status === statusFilter)
    : logs

  // ステータスごとの集計
  const counts = logs.reduce<Record<string, number>>((acc, l) => {
    acc[l.status] = (acc[l.status] ?? 0) + 1
    return acc
  }, {})

  // ベンチマーク比較用の率計算（送信ベース）
  const sentTotal = (counts.sent ?? 0) + (counts.opened ?? 0) + (counts.clicked ?? 0)
  const openRate = sentTotal > 0 ? ((counts.opened ?? 0) + (counts.clicked ?? 0)) / sentTotal * 100 : 0
  const clickRate = sentTotal > 0 ? (counts.clicked ?? 0) / sentTotal * 100 : 0
  const bounceRate = sentTotal > 0 ? (counts.bounced ?? 0) / sentTotal * 100 : 0
  const openCmp = compareToBenchmark('open', openRate)
  const clickCmp = compareToBenchmark('click', clickRate)

  return (
    <div className="max-w-6xl mx-auto py-8 px-4">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">配信ログ</h1>
        <p className="text-sm text-gray-500 mt-1">メール送信履歴と開封・クリックトラッキング</p>
      </div>

      {error && <div className="mb-4 p-3 bg-red-50 text-red-600 rounded-lg text-sm">{error}</div>}

      {/* 業界ベンチマーク比較 */}
      {sentTotal > 0 && (
        <div className="mb-4 p-4 bg-white border border-gray-200 rounded-xl">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-gray-700">📊 業界ベンチマーク比較（{ORYZAE_BENCHMARK.industry}）</h3>
            <span className="text-xs text-gray-400">出典: Mailchimp / Klaviyo 公開データ</span>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <p className="text-xs text-gray-500">開封率</p>
              <p className="text-2xl font-bold text-gray-900 mt-1">{openRate.toFixed(1)}<span className="text-sm font-normal text-gray-400">%</span></p>
              <p className="text-xs text-gray-400 mt-1">業界平均 {ORYZAE_BENCHMARK.open_rate}%</p>
              <p className={`text-xs mt-1 font-medium ${openCmp.status === 'good' ? 'text-green-600' : openCmp.status === 'bad' ? 'text-red-600' : 'text-gray-500'}`}>{openCmp.label}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">クリック率</p>
              <p className="text-2xl font-bold text-gray-900 mt-1">{clickRate.toFixed(1)}<span className="text-sm font-normal text-gray-400">%</span></p>
              <p className="text-xs text-gray-400 mt-1">業界平均 {ORYZAE_BENCHMARK.click_rate}%</p>
              <p className={`text-xs mt-1 font-medium ${clickCmp.status === 'good' ? 'text-green-600' : clickCmp.status === 'bad' ? 'text-red-600' : 'text-gray-500'}`}>{clickCmp.label}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">バウンス率</p>
              <p className="text-2xl font-bold text-gray-900 mt-1">{bounceRate.toFixed(1)}<span className="text-sm font-normal text-gray-400">%</span></p>
              <p className="text-xs text-gray-400 mt-1">業界平均 {ORYZAE_BENCHMARK.bounce_rate}%</p>
            </div>
          </div>
        </div>
      )}

      {/* フィルターバー */}
      <div className="flex flex-wrap gap-3 mb-4">
        <input
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm w-64"
          placeholder="キャンペーン ID で絞り込み"
          value={campaignId}
          onChange={(e) => setCampaignId(e.target.value)}
        />
        <select
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          <option value="">ステータス：全て</option>
          {Object.entries(STATUS_CONFIG).map(([k, v]) => (
            <option key={k} value={k}>{v.label}</option>
          ))}
        </select>
        <span className="text-sm text-gray-400 self-center ml-auto">
          {total.toLocaleString()}件
        </span>
      </div>

      {/* 集計バッジ */}
      {logs.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-4">
          {Object.entries(counts).map(([status, count]) => {
            const cfg = STATUS_CONFIG[status] ?? { label: status, cls: 'bg-gray-100 text-gray-600' }
            return (
              <button
                key={status}
                onClick={() => setStatusFilter(statusFilter === status ? '' : status)}
                className={`text-xs px-2.5 py-1 rounded-full font-medium transition-opacity ${cfg.cls} ${statusFilter && statusFilter !== status ? 'opacity-40' : ''}`}
              >
                {cfg.label} {count.toLocaleString()}
              </button>
            )
          })}
        </div>
      )}

      {/* テーブル */}
      {loading ? (
        <div className="text-center py-12 text-gray-400">読み込み中...</div>
      ) : displayed.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-xl border border-dashed border-gray-300">
          <p className="text-gray-500">ログがありません</p>
        </div>
      ) : (
        <>
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">宛先</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">件名</th>
                  <th className="text-center px-4 py-3 font-medium text-gray-600">ステータス</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600 hidden sm:table-cell">キュー時刻</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600 hidden md:table-cell">送信時刻</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600 hidden lg:table-cell">開封時刻</th>
                </tr>
              </thead>
              <tbody>
                {displayed.map((log, i) => {
                  const cfg = STATUS_CONFIG[log.status] ?? { label: log.status, cls: 'bg-gray-100 text-gray-600' }
                  return (
                    <tr key={log.log_id} className={i % 2 === 0 ? '' : 'bg-gray-50'}>
                      <td className="px-4 py-2.5 text-gray-700 max-w-[180px] truncate">{log.to_email}</td>
                      <td className="px-4 py-2.5 text-gray-600 max-w-[240px] truncate">{log.subject ?? '-'}</td>
                      <td className="px-4 py-2.5 text-center">
                        <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${cfg.cls}`}>
                          {cfg.label}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-gray-400 text-xs hidden sm:table-cell">{fmt(log.queued_at)}</td>
                      <td className="px-4 py-2.5 text-gray-400 text-xs hidden md:table-cell">{fmt(log.sent_at)}</td>
                      <td className="px-4 py-2.5 text-gray-400 text-xs hidden lg:table-cell">{fmt(log.opened_at)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* ページネーション */}
          {total > LIMIT && (
            <div className="flex justify-center gap-2 mt-4">
              <button
                onClick={() => handlePageChange(Math.max(0, offset - LIMIT))}
                disabled={offset === 0}
                className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg disabled:opacity-40 hover:bg-gray-50"
              >
                ← 前へ
              </button>
              <span className="text-sm text-gray-500 self-center">
                {offset + 1}–{Math.min(offset + LIMIT, total)} / {total}
              </span>
              <button
                onClick={() => handlePageChange(offset + LIMIT)}
                disabled={offset + LIMIT >= total}
                className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg disabled:opacity-40 hover:bg-gray-50"
              >
                次へ →
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
