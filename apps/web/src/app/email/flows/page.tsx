'use client'

import { useState, useEffect, useCallback } from 'react'
import { fermentApi, type EmailFlow, type EmailTemplate } from '@/lib/ferment-api'

const TRIGGER_LABEL: Record<string, string> = {
  event: 'イベントトリガー',
  segment_enter: 'セグメント参入',
  manual: '手動',
}

export default function EmailFlowsPage() {
  const [flows, setFlows] = useState<EmailFlow[]>([])
  const [templates, setTemplates] = useState<EmailTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm] = useState({ name: '', description: '', trigger_type: 'event', event_type: '' })
  const [creating, setCreating] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [f, t] = await Promise.all([fermentApi.flows.list(), fermentApi.templates.list()])
      if (f.success && f.data) setFlows(f.data)
      if (t.success && t.data) setTemplates(t.data)
    } catch {
      setError('読み込みに失敗しました')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const handleCreate = async () => {
    if (!form.name) return
    setCreating(true)
    try {
      const res = await fermentApi.flows.create({
        name: form.name,
        description: form.description || undefined,
        trigger_type: form.trigger_type,
        trigger_config: form.event_type ? { event_type: form.event_type } : undefined,
      })
      if (res.success) {
        setShowCreate(false)
        setForm({ name: '', description: '', trigger_type: 'event', event_type: '' })
        await load()
      } else {
        setError(res.error ?? '作成に失敗しました')
      }
    } finally {
      setCreating(false)
    }
  }

  const handleToggle = async (flow: EmailFlow) => {
    await fermentApi.flows.update(flow.flow_id, { is_active: flow.is_active === 1 ? 0 : 1 })
    await load()
  }

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`「${name}」を削除しますか？`)) return
    await fermentApi.flows.delete(id)
    await load()
  }

  const COMMON_EVENTS = [
    { value: 'order_placed', label: '注文完了' },
    { value: 'cart_abandoned', label: 'カゴ落ち（1時間後）' },
    { value: 'customer_created', label: '新規顧客登録' },
  ]

  return (
    <div className="max-w-5xl mx-auto py-8 px-4">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">メールフロー</h1>
          <p className="text-sm text-gray-500 mt-1">ステップ配信・自動化フロー</p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700"
        >
          + 新規フロー
        </button>
      </div>

      {error && <div className="mb-4 p-3 bg-red-50 text-red-600 rounded-lg text-sm">{error}</div>}

      {showCreate && (
        <div className="mb-6 p-5 bg-white border border-gray-200 rounded-xl shadow-sm">
          <h2 className="text-base font-semibold text-gray-800 mb-4">新規フロー</h2>
          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">フロー名 *</label>
              <input
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="カゴ落ちリマインドフロー"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">トリガー</label>
              <select
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                value={form.trigger_type}
                onChange={(e) => setForm({ ...form, trigger_type: e.target.value })}
              >
                <option value="event">イベントトリガー</option>
                <option value="manual">手動</option>
              </select>
            </div>
            {form.trigger_type === 'event' && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">イベント種別</label>
                <select
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  value={form.event_type}
                  onChange={(e) => setForm({ ...form, event_type: e.target.value })}
                >
                  <option value="">選択してください</option>
                  {COMMON_EVENTS.map((e) => (
                    <option key={e.value} value={e.value}>{e.label}</option>
                  ))}
                </select>
              </div>
            )}
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

      {loading ? (
        <div className="text-center py-12 text-gray-400">読み込み中...</div>
      ) : flows.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-xl border border-dashed border-gray-300">
          <p className="text-gray-500 mb-2">まだフローがありません</p>
          <button onClick={() => setShowCreate(true)} className="text-sm text-green-600 hover:underline">
            最初のフローを作成する
          </button>
        </div>
      ) : (
        <div className="grid gap-4">
          {flows.map((flow) => (
            <div key={flow.flow_id} className="bg-white border border-gray-200 rounded-xl p-4">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-semibold text-gray-900">{flow.name}</h3>
                    {flow.trigger_type && (
                      <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded">
                        {TRIGGER_LABEL[flow.trigger_type] ?? flow.trigger_type}
                      </span>
                    )}
                    <span className={`text-xs px-2 py-0.5 rounded font-medium ${flow.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                      {flow.is_active ? '稼働中' : '停止中'}
                    </span>
                  </div>
                  {flow.description && <p className="text-sm text-gray-500 mt-1">{flow.description}</p>}
                  {flow.steps && flow.steps.length > 0 && (
                    <p className="text-xs text-gray-400 mt-1">{flow.steps.length} ステップ</p>
                  )}
                </div>
                <div className="flex gap-2 shrink-0 ml-4">
                  <a
                    href={`/email/flows/edit?id=${flow.flow_id}`}
                    className="px-3 py-1.5 text-xs text-purple-600 border border-purple-200 rounded-lg hover:bg-purple-50"
                  >
                    ✨ ビジュアル編集
                  </a>
                  <button
                    onClick={() => handleToggle(flow)}
                    className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${
                      flow.is_active
                        ? 'text-yellow-600 border-yellow-200 hover:bg-yellow-50'
                        : 'text-green-600 border-green-200 hover:bg-green-50'
                    }`}
                  >
                    {flow.is_active ? '停止' : '有効化'}
                  </button>
                  <button
                    onClick={() => handleDelete(flow.flow_id, flow.name)}
                    className="px-3 py-1.5 text-xs text-red-500 border border-red-200 rounded-lg hover:bg-red-50"
                  >
                    削除
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
