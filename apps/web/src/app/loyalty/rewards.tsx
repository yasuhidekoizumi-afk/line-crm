'use client'

import { useState, useEffect, useCallback } from 'react'
import { fetchApi } from '@/lib/api'

type ItemStatus = 'active' | 'draft'
type ExchangeStatus = 'pending' | 'fulfilled' | 'cancelled'

interface RewardItem {
  id: string
  name: string
  description: string | null
  image_url: string | null
  required_points: number
  status: ItemStatus
  track_inventory: number
  stock: number | null
  requires_shipping: number
  created_at: string
  updated_at: string
}

interface RewardExchange {
  id: string
  friend_id: string
  reward_item_id: string
  reward_item_name: string
  points_spent: number
  status: ExchangeStatus
  shopify_customer_id: string | null
  notes: string | null
  display_name: string | null
  created_at: string
}

const STATUS_BADGE: Record<ExchangeStatus, { label: string; cls: string }> = {
  pending:   { label: '対応待ち', cls: 'bg-yellow-100 text-yellow-700' },
  fulfilled: { label: '発送済み', cls: 'bg-green-100 text-green-700' },
  cancelled: { label: 'キャンセル', cls: 'bg-gray-100 text-gray-500' },
}

const EMPTY_FORM = {
  name: '',
  description: '',
  image_url: '',
  required_points: 500,
  status: 'draft' as ItemStatus,
  track_inventory: false,
  stock: null as number | null,
  requires_shipping: false,
}

function ItemModal({
  initial,
  onClose,
  onSaved,
}: {
  initial?: RewardItem
  onClose: () => void
  onSaved: () => void
}) {
  const [form, setForm] = useState(initial ? {
    name: initial.name,
    description: initial.description ?? '',
    image_url: initial.image_url ?? '',
    required_points: initial.required_points,
    status: initial.status,
    track_inventory: initial.track_inventory === 1,
    stock: initial.stock,
    requires_shipping: initial.requires_shipping === 1,
  } : { ...EMPTY_FORM })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.name.trim()) { setError('アイテム名は必須です'); return }
    setSaving(true); setError('')
    try {
      const payload = {
        ...form,
        description: form.description || null,
        image_url: form.image_url || null,
        stock: form.track_inventory ? (form.stock ?? null) : null,
      }
      const url = initial ? `/api/rewards/admin/${initial.id}` : '/api/rewards/admin'
      const method = initial ? 'PUT' : 'POST'
      const res = await fetchApi<{ success: boolean; error?: string }>(url, { method, body: JSON.stringify(payload) })
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
          <h2 className="font-semibold text-gray-900">{initial ? 'アイテム編集' : '新規アイテム'}</h2>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-400">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <form onSubmit={handleSubmit} className="overflow-y-auto flex-1 px-6 py-4 space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">アイテム名 *</label>
            <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
              placeholder="例: オリジナルトートバッグ" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">説明</label>
            <input value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
              placeholder="（任意）" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">画像URL（任意）</label>
            <input value={form.image_url} onChange={(e) => setForm((f) => ({ ...f, image_url: e.target.value }))}
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
              placeholder="https://..." />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">交換に必要なポイント *</label>
              <div className="flex items-center gap-1">
                <input type="number" min="0" value={form.required_points}
                  onChange={(e) => setForm((f) => ({ ...f, required_points: parseInt(e.target.value) || 0 }))}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500" />
                <span className="text-sm text-gray-500 shrink-0">pt</span>
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">ステータス</label>
              <select value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as ItemStatus }))}
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-green-500">
                <option value="draft">下書き</option>
                <option value="active">アクティブ</option>
              </select>
            </div>
          </div>
          <div className="space-y-2">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={form.track_inventory}
                onChange={(e) => setForm((f) => ({ ...f, track_inventory: e.target.checked }))}
                className="rounded border-gray-300 text-green-600 focus:ring-green-500" />
              <span className="text-sm text-gray-700">在庫を追跡する</span>
            </label>
            {form.track_inventory && (
              <div className="ml-6">
                <label className="block text-xs font-medium text-gray-700 mb-1">在庫数（空欄=無制限）</label>
                <input type="number" min="0"
                  value={form.stock ?? ''}
                  onChange={(e) => setForm((f) => ({ ...f, stock: e.target.value ? parseInt(e.target.value) : null }))}
                  className="w-32 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
                  placeholder="例: 10" />
              </div>
            )}
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={form.requires_shipping}
                onChange={(e) => setForm((f) => ({ ...f, requires_shipping: e.target.checked }))}
                className="rounded border-gray-300 text-green-600 focus:ring-green-500" />
              <span className="text-sm text-gray-700">配送が必要なアイテム</span>
            </label>
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

function ExchangesPanel() {
  const [exchanges, setExchanges] = useState<RewardExchange[]>([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState<ExchangeStatus | 'all'>('pending')
  const [updating, setUpdating] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetchApi<{ success: boolean; data: RewardExchange[] }>(
        `/api/rewards/exchanges?status=${statusFilter}`
      )
      if (res.success) setExchanges(res.data)
    } finally { setLoading(false) }
  }, [statusFilter])

  useEffect(() => { load() }, [load])

  const handleStatus = async (id: string, status: ExchangeStatus) => {
    setUpdating(id)
    try {
      await fetchApi(`/api/rewards/exchanges/${id}/status`, { method: 'PUT', body: JSON.stringify({ status }) })
      load()
    } finally { setUpdating(null) }
  }

  return (
    <div className="mt-6">
      <div className="flex items-center gap-2 mb-3">
        <h3 className="text-sm font-semibold text-gray-900">交換申請履歴</h3>
        {(['all', 'pending', 'fulfilled', 'cancelled'] as const).map((s) => (
          <button key={s} onClick={() => setStatusFilter(s)}
            className={`text-xs px-2.5 py-1 rounded-full font-medium ${
              statusFilter === s ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
            }`}>
            {s === 'all' ? '全て' : STATUS_BADGE[s].label}
          </button>
        ))}
      </div>
      {loading ? (
        <div className="space-y-2">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="bg-white rounded-xl border border-gray-200 p-3 animate-pulse h-12" />
          ))}
        </div>
      ) : exchanges.length === 0 ? (
        <p className="text-sm text-gray-400 py-4 text-center">申請がありません</p>
      ) : (
        <div className="space-y-2">
          {exchanges.map((ex) => (
            <div key={ex.id} className="bg-white rounded-xl border border-gray-200 p-3 flex items-center gap-3">
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium shrink-0 ${STATUS_BADGE[ex.status].cls}`}>
                {STATUS_BADGE[ex.status].label}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 truncate">{ex.reward_item_name}</p>
                <p className="text-xs text-gray-500">
                  {ex.display_name ?? ex.friend_id.slice(0, 8)} · {ex.points_spent}pt · {ex.created_at.slice(0, 10)}
                </p>
              </div>
              {ex.status === 'pending' && (
                <div className="flex gap-2 shrink-0">
                  <button onClick={() => handleStatus(ex.id, 'fulfilled')} disabled={updating === ex.id}
                    className="text-xs text-green-700 font-medium hover:underline disabled:opacity-40">
                    発送済みに
                  </button>
                  <button onClick={() => handleStatus(ex.id, 'cancelled')} disabled={updating === ex.id}
                    className="text-xs text-red-500 hover:underline disabled:opacity-40">
                    キャンセル
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default function RewardsTab() {
  const [items, setItems] = useState<RewardItem[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState<RewardItem | undefined>()
  const [deleting, setDeleting] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetchApi<{ success: boolean; data: RewardItem[] }>('/api/rewards/admin')
      if (res.success) setItems(res.data)
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  const handleDelete = async (id: string) => {
    if (!confirm('このアイテムを削除しますか？')) return
    setDeleting(id)
    try {
      await fetchApi(`/api/rewards/admin/${id}`, { method: 'DELETE' })
      load()
    } finally { setDeleting(null) }
  }

  const handleToggle = async (item: RewardItem) => {
    const next = item.status === 'active' ? 'draft' : 'active'
    await fetchApi(`/api/rewards/admin/${item.id}`, { method: 'PUT', body: JSON.stringify({ status: next }) })
    load()
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-gray-500">ポイントで交換できるアイテムを管理します。</p>
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
      ) : items.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <p className="text-gray-400 text-sm mb-3">アイテムがありません</p>
          <button onClick={() => { setEditing(undefined); setShowModal(true) }}
            className="text-sm text-green-700 font-medium hover:underline">
            最初のアイテムを作成する
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((item) => (
            <div key={item.id} className="bg-white rounded-xl border border-gray-200 p-4 flex items-start gap-3">
              {item.image_url && (
                <img src={item.image_url} alt={item.name}
                  className="w-14 h-14 rounded-lg object-cover shrink-0 bg-gray-100" />
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                    item.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                  }`}>
                    {item.status === 'active' ? 'アクティブ' : '下書き'}
                  </span>
                  <span className="font-medium text-gray-900 text-sm truncate">{item.name}</span>
                </div>
                {item.description && <p className="text-xs text-gray-500 mb-1">{item.description}</p>}
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
                  <span>必要ポイント: <strong className="text-gray-700">{item.required_points.toLocaleString()} pt</strong></span>
                  {item.track_inventory === 1 && (
                    <span>在庫: <strong className={item.stock === 0 ? 'text-red-600' : 'text-gray-700'}>
                      {item.stock === null ? '無制限' : `${item.stock} 点`}
                    </strong></span>
                  )}
                  {item.requires_shipping === 1 && <span>要配送</span>}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button onClick={() => handleToggle(item)}
                  className="text-xs text-blue-600 hover:underline">
                  {item.status === 'active' ? '下書きに戻す' : '有効化'}
                </button>
                <button onClick={() => { setEditing(item); setShowModal(true) }}
                  className="text-xs text-gray-600 hover:underline">編集</button>
                <button onClick={() => handleDelete(item.id)} disabled={deleting === item.id}
                  className="text-xs text-red-500 hover:underline disabled:opacity-40">削除</button>
              </div>
            </div>
          ))}
        </div>
      )}

      <ExchangesPanel />

      {showModal && (
        <ItemModal
          initial={editing}
          onClose={() => setShowModal(false)}
          onSaved={load}
        />
      )}
    </div>
  )
}
