'use client'

import { useState, useEffect, useCallback } from 'react'
import { fermentApi, type EmailCampaign, type EmailTemplate, type Segment } from '@/lib/ferment-api'

const STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  draft:     { label: '下書き',   cls: 'bg-gray-100 text-gray-600' },
  scheduled: { label: '予約済み', cls: 'bg-blue-100 text-blue-700' },
  sending:   { label: '送信中',   cls: 'bg-yellow-100 text-yellow-700' },
  sent:      { label: '送信完了', cls: 'bg-green-100 text-green-700' },
  failed:    { label: '失敗',     cls: 'bg-red-100 text-red-600' },
  canceled:  { label: 'キャンセル', cls: 'bg-gray-100 text-gray-400' },
}

function fmt(iso: string | null) {
  if (!iso) return '-'
  return new Date(iso).toLocaleString('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

export default function EmailCampaignsPage() {
  const [campaigns, setCampaigns] = useState<EmailCampaign[]>([])
  const [templates, setTemplates] = useState<EmailTemplate[]>([])
  const [segments, setSegments] = useState<Segment[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm] = useState({ name: '', template_id: '', segment_id: '' })
  const [creating, setCreating] = useState(false)
  const [sendingId, setSendingId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [c, t, s] = await Promise.all([
        fermentApi.campaigns.list(),
        fermentApi.templates.list(),
        fermentApi.segments.list(),
      ])
      if (c.success && c.data) setCampaigns(c.data)
      if (t.success && t.data) setTemplates(t.data)
      if (s.success && s.data) setSegments(s.data)
    } catch {
      setError('データの読み込みに失敗しました')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const handleCreate = async () => {
    if (!form.name) return
    setCreating(true)
    try {
      const res = await fermentApi.campaigns.create({
        name: form.name,
        template_id: form.template_id || undefined,
        segment_id: form.segment_id || undefined,
      })
      if (res.success) {
        setShowCreate(false)
        setForm({ name: '', template_id: '', segment_id: '' })
        await load()
      } else {
        setError(res.error ?? '作成に失敗しました')
      }
    } finally {
      setCreating(false)
    }
  }

  const handleSend = async (id: string) => {
    if (!confirm('このキャンペーンを今すぐ配信しますか？')) return
    setSendingId(id)
    try {
      const res = await fermentApi.campaigns.send(id)
      if (res.success) {
        alert(`配信開始しました。送信数: ${res.data?.sent ?? 0}`)
        await load()
      } else {
        setError(res.error ?? '配信に失敗しました')
      }
    } finally {
      setSendingId(null)
    }
  }

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`「${name}」を削除しますか？`)) return
    await fermentApi.campaigns.delete(id)
    await load()
  }

  return (
    <div className="max-w-6xl mx-auto py-8 px-4">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">メールキャンペーン</h1>
          <p className="text-sm text-gray-500 mt-1">一斉メール配信の管理</p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 transition-colors"
        >
          + 新規作成
        </button>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 text-red-600 rounded-lg text-sm">{error}</div>
      )}

      {/* 作成フォーム */}
      {showCreate && (
        <div className="mb-6 p-5 bg-white border border-gray-200 rounded-xl shadow-sm">
          <h2 className="text-base font-semibold text-gray-800 mb-4">新規キャンペーン</h2>
          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">キャンペーン名 *</label>
              <input
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="2026年5月 ウェルカムキャンペーン"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">テンプレート</label>
                <select
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  value={form.template_id}
                  onChange={(e) => setForm({ ...form, template_id: e.target.value })}
                >
                  <option value="">選択してください</option>
                  {templates.map((t) => (
                    <option key={t.template_id} value={t.template_id}>{t.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">セグメント</label>
                <select
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  value={form.segment_id}
                  onChange={(e) => setForm({ ...form, segment_id: e.target.value })}
                >
                  <option value="">選択してください</option>
                  {segments.map((s) => (
                    <option key={s.segment_id} value={s.segment_id}>{s.name} ({s.customer_count}人)</option>
                  ))}
                </select>
              </div>
            </div>
          </div>
          <div className="flex gap-2 mt-4">
            <button
              onClick={handleCreate}
              disabled={!form.name || creating}
              className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium disabled:opacity-50"
            >
              {creating ? '作成中...' : '作成する'}
            </button>
            <button onClick={() => setShowCreate(false)} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg text-sm">
              キャンセル
            </button>
          </div>
        </div>
      )}

      {/* 一覧 */}
      {loading ? (
        <div className="text-center py-12 text-gray-400">読み込み中...</div>
      ) : campaigns.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-xl border border-dashed border-gray-300">
          <p className="text-gray-500 mb-2">まだキャンペーンがありません</p>
          <button onClick={() => setShowCreate(true)} className="text-sm text-green-600 hover:underline">
            最初のキャンペーンを作成する
          </button>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-600">キャンペーン名</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">ステータス</th>
                <th className="text-right px-4 py-3 font-medium text-gray-600">対象</th>
                <th className="text-right px-4 py-3 font-medium text-gray-600">送信数</th>
                <th className="text-right px-4 py-3 font-medium text-gray-600">開封</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">作成日</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {campaigns.map((c, i) => {
                const statusInfo = STATUS_LABEL[c.status] ?? { label: c.status, cls: 'bg-gray-100 text-gray-600' }
                return (
                  <tr key={c.campaign_id} className={i % 2 === 0 ? '' : 'bg-gray-50'}>
                    <td className="px-4 py-3 font-medium text-gray-900">{c.name}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${statusInfo.cls}`}>
                        {statusInfo.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right text-gray-600">{c.total_targets > 0 ? c.total_targets.toLocaleString() : '-'}</td>
                    <td className="px-4 py-3 text-right text-gray-600">{c.total_sent > 0 ? c.total_sent.toLocaleString() : '-'}</td>
                    <td className="px-4 py-3 text-right text-gray-600">
                      {c.total_sent > 0 ? `${((c.total_opened / c.total_sent) * 100).toFixed(1)}%` : '-'}
                    </td>
                    <td className="px-4 py-3 text-gray-500">{fmt(c.created_at)}</td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1 justify-end">
                        {c.status === 'draft' && (
                          <button
                            onClick={() => handleSend(c.campaign_id)}
                            disabled={sendingId === c.campaign_id}
                            className="px-2 py-1 text-xs bg-green-50 text-green-700 rounded hover:bg-green-100 disabled:opacity-50"
                          >
                            {sendingId === c.campaign_id ? '配信中...' : '今すぐ配信'}
                          </button>
                        )}
                        {['draft', 'scheduled', 'canceled', 'failed'].includes(c.status) && (
                          <button
                            onClick={() => handleDelete(c.campaign_id, c.name)}
                            className="px-2 py-1 text-xs text-gray-400 hover:text-red-500 rounded hover:bg-red-50"
                          >
                            削除
                          </button>
                        )}
                      </div>
                    </td>
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
