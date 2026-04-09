'use client'

import { useState, useEffect, useCallback } from 'react'
import { fetchApi } from '@/lib/api'

type CampaignStatus = 'active' | 'draft'
type ActionType = 'rate_multiply' | 'rate_add' | 'fixed_points'

type Condition =
  | { type: 'customer_tag';     value: string }
  | { type: 'product_tag';      value: string }
  | { type: 'product_id';       value: string }
  | { type: 'product_type';     value: string }
  | { type: 'collection_id';    value: string }
  | { type: 'min_order_amount'; value: number }
  | { type: 'order_count_gte';  value: number }
  | { type: 'total_spent_gte';  value: number }

interface Campaign {
  id: string
  name: string
  description: string | null
  status: CampaignStatus
  starts_at: string | null
  ends_at: string | null
  conditions: Condition[]
  action_type: ActionType
  action_value: number
  created_at: string
  updated_at: string
}

const ACTION_LABELS: Record<ActionType, string> = {
  rate_multiply: 'ポイント倍率（例: 10 = 10倍）',
  rate_add:      '還元率の追加（例: 5 = +5%）',
  fixed_points:  '定額ポイント付与（pt）',
}

const ACTION_FORMAT: Record<ActionType, (v: number) => string> = {
  rate_multiply: (v) => `${v}倍`,
  rate_add:      (v) => `+${v}%`,
  fixed_points:  (v) => `${v} pt`,
}

const COND_TYPE_LABELS: Record<string, string> = {
  customer_tag:     '顧客タグ',
  product_tag:      '商品タグ',
  product_id:       '商品ID',
  product_type:     '商品タイプ',
  collection_id:    'コレクションID',
  min_order_amount: '購入時の金額（以上）',
  order_count_gte:  '累計購入回数（以上）',
  total_spent_gte:  '累計購入金額（以上）',
}

const EMPTY_FORM = {
  name: '',
  description: '',
  status: 'draft' as CampaignStatus,
  starts_at: '',
  ends_at: '',
  conditions: [] as Condition[],
  action_type: 'rate_multiply' as ActionType,
  action_value: 2,
}

function ConditionRow({
  cond, index, onChange, onRemove
}: {
  cond: Condition
  index: number
  onChange: (i: number, c: Condition) => void
  onRemove: (i: number) => void
}) {
  const isNumeric = cond.type === 'min_order_amount' || cond.type === 'order_count_gte' || cond.type === 'total_spent_gte'
  return (
    <div className="flex items-center gap-2 bg-gray-50 rounded-lg p-2">
      <select
        value={cond.type}
        onChange={(e) => onChange(index, { type: e.target.value as Condition['type'], value: '' as never })}
        className="text-xs border border-gray-300 rounded px-2 py-1 bg-white"
      >
        {Object.entries(COND_TYPE_LABELS).map(([k, v]) => (
          <option key={k} value={k}>{v}</option>
        ))}
      </select>
      <input
        type={isNumeric ? 'number' : 'text'}
        value={String(cond.value)}
        onChange={(e) => onChange(index, { ...cond, value: isNumeric ? Number(e.target.value) : e.target.value } as Condition)}
        placeholder={isNumeric ? '例: 3000' : '例: ゴールド'}
        className="flex-1 text-xs border border-gray-300 rounded px-2 py-1"
      />
      <button onClick={() => onRemove(index)} className="text-gray-400 hover:text-red-500 text-sm px-1">×</button>
    </div>
  )
}

function CampaignModal({
  initial,
  onClose,
  onSaved,
}: {
  initial?: Campaign
  onClose: () => void
  onSaved: () => void
}) {
  const [form, setForm] = useState(initial ? {
    name: initial.name,
    description: initial.description ?? '',
    status: initial.status,
    starts_at: initial.starts_at?.slice(0, 16) ?? '',
    ends_at:   initial.ends_at?.slice(0, 16) ?? '',
    conditions: initial.conditions,
    action_type: initial.action_type,
    action_value: initial.action_value,
  } : { ...EMPTY_FORM })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const handleCondChange = (i: number, c: Condition) => {
    const next = [...form.conditions]; next[i] = c; setForm((f) => ({ ...f, conditions: next }))
  }
  const handleCondRemove = (i: number) => {
    setForm((f) => ({ ...f, conditions: f.conditions.filter((_, idx) => idx !== i) }))
  }
  const addCond = () => {
    setForm((f) => ({ ...f, conditions: [...f.conditions, { type: 'customer_tag', value: '' }] }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.name.trim()) { setError('キャンペーン名は必須です'); return }
    setSaving(true); setError('')
    try {
      const payload = {
        ...form,
        starts_at: form.starts_at ? new Date(form.starts_at).toISOString() : null,
        ends_at:   form.ends_at   ? new Date(form.ends_at).toISOString()   : null,
        description: form.description || null,
      }
      const res = initial
        ? await fetchApi<{ success: boolean; error?: string }>(`/api/loyalty/campaigns/${initial.id}`, { method: 'PUT', body: JSON.stringify(payload) })
        : await fetchApi<{ success: boolean; error?: string }>('/api/loyalty/campaigns', { method: 'POST', body: JSON.stringify(payload) })
      if (res.success) { onSaved(); onClose() }
      else setError(res.error ?? '保存に失敗しました')
    } catch { setError('保存に失敗しました') }
    finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="font-semibold text-gray-900">{initial ? 'キャンペーン編集' : '新規キャンペーン'}</h2>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-400">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="overflow-y-auto flex-1 px-6 py-4 space-y-4">
          {/* 基本情報 */}
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">キャンペーン名 *</label>
            <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
              placeholder="例: 【早割P10倍】バレンタイングラノーラ" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">備考</label>
            <input value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
              placeholder="（任意）" />
          </div>

          {/* ステータス・期間 */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">ステータス</label>
              <select value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as CampaignStatus }))}
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-green-500">
                <option value="draft">下書き</option>
                <option value="active">アクティブ</option>
              </select>
            </div>
            <div>{/* spacer */}</div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">開始日時（任意）</label>
              <input type="datetime-local" value={form.starts_at}
                onChange={(e) => setForm((f) => ({ ...f, starts_at: e.target.value }))}
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">終了日時（任意）</label>
              <input type="datetime-local" value={form.ends_at}
                onChange={(e) => setForm((f) => ({ ...f, ends_at: e.target.value }))}
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500" />
            </div>
          </div>

          {/* 条件 */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-medium text-gray-700">条件（すべて一致で適用）</label>
              <button type="button" onClick={addCond}
                className="text-xs text-green-700 font-medium hover:underline">+ 条件を追加</button>
            </div>
            {form.conditions.length === 0 ? (
              <p className="text-xs text-gray-400 py-2">条件なし（全注文に適用）</p>
            ) : (
              <div className="space-y-2">
                {form.conditions.map((c, i) => (
                  <ConditionRow key={i} cond={c} index={i} onChange={handleCondChange} onRemove={handleCondRemove} />
                ))}
              </div>
            )}
          </div>

          {/* アクション */}
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">ポイントアクション</label>
            <select value={form.action_type} onChange={(e) => setForm((f) => ({ ...f, action_type: e.target.value as ActionType }))}
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-green-500 mb-2">
              {(Object.entries(ACTION_LABELS) as [ActionType, string][]).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
            <div className="flex items-center gap-2">
              <input type="number" step="any" min="0" value={form.action_value}
                onChange={(e) => setForm((f) => ({ ...f, action_value: parseFloat(e.target.value) || 0 }))}
                className="w-32 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500" />
              <span className="text-sm text-gray-500">
                → {ACTION_FORMAT[form.action_type](form.action_value)}
              </span>
            </div>
          </div>

          {error && <p className="text-xs text-red-600">{error}</p>}

          <div className="flex gap-2 pt-2">
            <button type="submit" disabled={saving}
              className="flex-1 py-2.5 text-sm font-medium text-white rounded-lg disabled:opacity-50"
              style={{ backgroundColor: '#06C755' }}>
              {saving ? '保存中...' : '保存する'}
            </button>
            <button type="button" onClick={onClose}
              className="px-4 py-2.5 text-sm text-gray-500 border border-gray-300 rounded-lg hover:bg-gray-50">
              キャンセル
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default function CampaignsTab() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState<Campaign | undefined>()
  const [deleting, setDeleting] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetchApi<{ success: boolean; data: Campaign[] }>('/api/loyalty/campaigns')
      if (res.success) setCampaigns(res.data)
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  const handleDelete = async (id: string) => {
    if (!confirm('このキャンペーンを削除しますか？')) return
    setDeleting(id)
    try {
      await fetchApi(`/api/loyalty/campaigns/${id}`, { method: 'DELETE' })
      load()
    } finally { setDeleting(null) }
  }

  const handleToggleStatus = async (c: Campaign) => {
    const next = c.status === 'active' ? 'draft' : 'active'
    await fetchApi(`/api/loyalty/campaigns/${c.id}`, {
      method: 'PUT',
      body: JSON.stringify({ status: next }),
    })
    load()
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-gray-500">条件に合わせてポイントを追加付与します。複数一致した場合は順番に全て適用されます。</p>
        <button onClick={() => { setEditing(undefined); setShowModal(true) }}
          className="px-4 py-2 text-sm font-medium text-white rounded-lg whitespace-nowrap"
          style={{ backgroundColor: '#06C755' }}>
          新規作成
        </button>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="bg-white rounded-xl border border-gray-200 p-4 animate-pulse">
              <div className="h-4 bg-gray-200 rounded w-48 mb-2" />
              <div className="h-3 bg-gray-100 rounded w-32" />
            </div>
          ))}
        </div>
      ) : campaigns.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <p className="text-gray-400 text-sm mb-3">キャンペーンがありません</p>
          <button onClick={() => { setEditing(undefined); setShowModal(true) }}
            className="text-sm text-green-700 font-medium hover:underline">
            最初のキャンペーンを作成する
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          {campaigns.map((c) => (
            <div key={c.id} className="bg-white rounded-xl border border-gray-200 p-4">
              <div className="flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                      c.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                    }`}>
                      {c.status === 'active' ? 'アクティブ' : '下書き'}
                    </span>
                    <span className="font-medium text-gray-900 text-sm truncate">{c.name}</span>
                  </div>
                  {c.description && <p className="text-xs text-gray-500 mb-1">{c.description}</p>}
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
                    <span>アクション: <strong className="text-gray-700">{ACTION_FORMAT[c.action_type](c.action_value)}</strong></span>
                    {c.conditions.length > 0 && (
                      <span>条件: {c.conditions.map((cd) => `${COND_TYPE_LABELS[cd.type]}="${cd.value}"`).join(' & ')}</span>
                    )}
                    {(c.starts_at || c.ends_at) && (
                      <span>期間: {c.starts_at?.slice(0, 10) ?? '∞'} 〜 {c.ends_at?.slice(0, 10) ?? '∞'}</span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button onClick={() => handleToggleStatus(c)}
                    className="text-xs text-blue-600 hover:underline">
                    {c.status === 'active' ? '下書きに戻す' : '有効化'}
                  </button>
                  <button onClick={() => { setEditing(c); setShowModal(true) }}
                    className="text-xs text-gray-600 hover:underline">編集</button>
                  <button onClick={() => handleDelete(c.id)} disabled={deleting === c.id}
                    className="text-xs text-red-500 hover:underline disabled:opacity-40">削除</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {showModal && (
        <CampaignModal
          initial={editing}
          onClose={() => setShowModal(false)}
          onSaved={load}
        />
      )}
    </div>
  )
}
