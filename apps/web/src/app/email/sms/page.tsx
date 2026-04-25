'use client'

import { useState, useEffect, useCallback } from 'react'
import { fetchApi } from '@/lib/api'
import { fermentApi, type Segment } from '@/lib/ferment-api'

interface ApiResult<T> { success: boolean; data?: T; error?: string }

interface SMSLog {
  log_id: string
  to_phone: string
  body: string
  status: string
  twilio_sid: string | null
  error_message: string | null
  queued_at: string
  sent_at: string | null
}

const STATUS_CONFIG: Record<string, { label: string; cls: string }> = {
  queued:    { label: '送信待ち', cls: 'bg-gray-100 text-gray-600' },
  sent:      { label: '送信済み', cls: 'bg-green-100 text-green-700' },
  failed:    { label: '失敗',     cls: 'bg-red-100 text-red-600' },
  simulated: { label: 'シミュレーション', cls: 'bg-yellow-100 text-yellow-700' },
}

function fmt(iso: string | null) {
  if (!iso) return '-'
  return new Date(iso).toLocaleString('ja-JP', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

export default function SMSPage() {
  const [logs, setLogs] = useState<SMSLog[]>([])
  const [segments, setSegments] = useState<Segment[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showCompose, setShowCompose] = useState(false)
  const [form, setForm] = useState({ segment_id: '', message: '' })
  const [sending, setSending] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [logsRes, segsRes] = await Promise.all([
        fetchApi<ApiResult<SMSLog[]>>('/api/sms/campaign/logs'),
        fermentApi.segments.list(),
      ])
      if (logsRes.success && logsRes.data) setLogs(logsRes.data)
      if (segsRes.success && segsRes.data) setSegments(segsRes.data)
    } catch {
      setError('読み込みに失敗しました')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const handleSend = async () => {
    if (!form.segment_id || !form.message) return
    setSending(true)
    setError('')
    try {
      const res = await fetchApi<ApiResult<{ queued: number }>>('/api/sms/campaign/send-to-segment', {
        method: 'POST',
        body: JSON.stringify({ segment_id: form.segment_id, message: form.message }),
      })
      if (res.success) {
        alert(`${res.data?.queued ?? 0}件 キューに追加しました`)
        setShowCompose(false)
        setForm({ segment_id: '', message: '' })
        await load()
      } else {
        setError(res.error ?? '送信失敗')
      }
    } catch {
      setError('送信失敗')
    } finally {
      setSending(false)
    }
  }

  const counts = logs.reduce<Record<string, number>>((a, l) => { a[l.status] = (a[l.status] ?? 0) + 1; return a }, {})

  return (
    <div className="max-w-5xl mx-auto py-8 px-4">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">SMS 配信</h1>
          <p className="text-sm text-gray-500 mt-1">セグメントへの一斉SMS送信（Twilio経由、約¥10/通）</p>
        </div>
        <button
          onClick={() => setShowCompose(!showCompose)}
          className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700"
        >
          + 新規SMS配信
        </button>
      </div>

      {error && <div className="mb-4 p-3 bg-red-50 text-red-600 rounded-lg text-sm">{error}</div>}

      {showCompose && (
        <div className="mb-6 p-5 bg-white border border-gray-200 rounded-xl shadow-sm">
          <h2 className="text-base font-semibold text-gray-800 mb-4">SMS 配信作成</h2>
          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">送信先セグメント *</label>
              <select className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                value={form.segment_id} onChange={(e) => setForm({ ...form, segment_id: e.target.value })}>
                <option value="">選択してください</option>
                {segments.map((s) => (
                  <option key={s.segment_id} value={s.segment_id}>
                    {s.name} ({s.customer_count.toLocaleString()}人)
                  </option>
                ))}
              </select>
              <p className="text-xs text-gray-400 mt-1">※ 電話番号登録 + SMS購読中の顧客にのみ送信されます</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                メッセージ * <span className="text-xs text-gray-400 ml-2">{form.message.length}/70 文字（70文字超は分割課金）</span>
              </label>
              <textarea className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" rows={4}
                placeholder="【オリゼ】新商品入荷しました🌾 https://oryzae.shop"
                value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} />
            </div>
          </div>
          <div className="flex gap-2 mt-4">
            <button onClick={handleSend} disabled={!form.segment_id || !form.message || sending}
              className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium disabled:opacity-50">
              {sending ? '送信中...' : 'キューに追加'}
            </button>
            <button onClick={() => setShowCompose(false)}
              className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg text-sm">キャンセル</button>
          </div>
        </div>
      )}

      {/* ステータス集計 */}
      {logs.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-4">
          {Object.entries(counts).map(([status, count]) => {
            const cfg = STATUS_CONFIG[status] ?? { label: status, cls: 'bg-gray-100 text-gray-600' }
            return (
              <span key={status} className={`text-xs px-2.5 py-1 rounded-full font-medium ${cfg.cls}`}>
                {cfg.label} {count}
              </span>
            )
          })}
        </div>
      )}

      {loading ? (
        <div className="text-center py-12 text-gray-400">読み込み中...</div>
      ) : logs.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-xl border border-dashed border-gray-300">
          <p className="text-gray-500 mb-2">まだSMS配信がありません</p>
          <p className="text-xs text-gray-400">Twilio環境変数（TWILIO_ACCOUNT_SID/AUTH_TOKEN/FROM）未設定の場合は simulated として記録のみ</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-600">宛先</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">メッセージ</th>
                <th className="text-center px-4 py-3 font-medium text-gray-600">ステータス</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">時刻</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((l) => {
                const cfg = STATUS_CONFIG[l.status] ?? { label: l.status, cls: 'bg-gray-100 text-gray-600' }
                return (
                  <tr key={l.log_id} className="border-b border-gray-100">
                    <td className="px-4 py-2 text-gray-700">{l.to_phone}</td>
                    <td className="px-4 py-2 text-gray-600 truncate max-w-[300px]">{l.body}</td>
                    <td className="px-4 py-2 text-center">
                      <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${cfg.cls}`}>
                        {cfg.label}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-gray-400 text-xs">{fmt(l.sent_at ?? l.queued_at)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
