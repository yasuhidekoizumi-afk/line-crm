'use client'

import { useState, useEffect, useCallback } from 'react'
import { fermentApi, type Segment } from '@/lib/ferment-api'

const CHANNEL_LABEL: Record<string, string> = {
  all: '全チャネル',
  email: 'メールのみ',
  line: 'LINEのみ',
}

const SAMPLE_RULE = JSON.stringify({
  operator: 'AND',
  conditions: [
    { field: 'subscribed_email', operator: '=', value: 1 },
    { field: 'ltv', operator: '>=', value: 5000 },
  ],
}, null, 2)

export default function SegmentsPage() {
  const [segments, setSegments] = useState<Segment[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [recomputingId, setRecomputingId] = useState<string | null>(null)
  const [form, setForm] = useState({
    name: '',
    description: '',
    channel_scope: 'all',
    rules: SAMPLE_RULE,
  })
  const [rulesError, setRulesError] = useState('')
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fermentApi.segments.list()
      if (res.success && res.data) setSegments(res.data)
    } catch {
      setError('読み込みに失敗しました')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const resetForm = () => setForm({
    name: '',
    description: '',
    channel_scope: 'all',
    rules: SAMPLE_RULE,
  })

  const validateRules = (rulesStr: string): boolean => {
    try {
      JSON.parse(rulesStr)
      setRulesError('')
      return true
    } catch {
      setRulesError('JSON が不正です')
      return false
    }
  }

  const handleSave = async () => {
    if (!form.name) return
    if (!validateRules(form.rules)) return
    setSaving(true)
    try {
      const data = {
        name: form.name,
        description: form.description || undefined,
        rules: JSON.parse(form.rules),
        channel_scope: form.channel_scope,
      }
      const res = editId
        ? await fermentApi.segments.update(editId, data)
        : await fermentApi.segments.create(data)
      if (res.success) {
        setShowCreate(false)
        setEditId(null)
        resetForm()
        await load()
      } else {
        setError(res.error ?? '保存に失敗しました')
      }
    } catch {
      setError('保存に失敗しました')
    } finally {
      setSaving(false)
    }
  }

  const handleEdit = (s: Segment) => {
    setForm({
      name: s.name,
      description: s.description ?? '',
      channel_scope: s.channel_scope,
      rules: typeof s.rules === 'string' ? s.rules : JSON.stringify(JSON.parse(s.rules), null, 2),
    })
    setEditId(s.segment_id)
    setShowCreate(true)
    setRulesError('')
  }

  const handleRecompute = async (id: string) => {
    setRecomputingId(id)
    try {
      const res = await fermentApi.segments.recompute(id)
      if (res.success) {
        await load()
      } else {
        setError(res.error ?? '再計算に失敗しました')
      }
    } finally {
      setRecomputingId(null)
    }
  }

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`「${name}」を削除しますか？`)) return
    await fermentApi.segments.delete(id)
    await load()
  }

  const fmt = (iso: string | null) => {
    if (!iso) return '未計算'
    return new Date(iso).toLocaleString('ja-JP', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
  }

  return (
    <div className="max-w-5xl mx-auto py-8 px-4">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">セグメント</h1>
          <p className="text-sm text-gray-500 mt-1">ルールベースの顧客セグメント管理</p>
        </div>
        <button
          onClick={() => { setShowCreate(true); setEditId(null); resetForm(); setRulesError('') }}
          className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700"
        >
          + 新規作成
        </button>
      </div>

      {error && <div className="mb-4 p-3 bg-red-50 text-red-600 rounded-lg text-sm">{error}</div>}

      {/* 作成・編集フォーム */}
      {showCreate && (
        <div className="mb-6 p-5 bg-white border border-gray-200 rounded-xl shadow-sm">
          <h2 className="text-base font-semibold text-gray-800 mb-4">
            {editId ? 'セグメントを編集' : '新規セグメント'}
          </h2>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2 sm:col-span-1">
                <label className="block text-sm font-medium text-gray-700 mb-1">セグメント名 *</label>
                <input
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="メールアクティブ顧客"
                />
              </div>
              <div className="col-span-2 sm:col-span-1">
                <label className="block text-sm font-medium text-gray-700 mb-1">チャネル</label>
                <select
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  value={form.channel_scope}
                  onChange={(e) => setForm({ ...form, channel_scope: e.target.value })}
                >
                  {Object.entries(CHANNEL_LABEL).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
              </div>
              <div className="col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">説明</label>
                <input
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  placeholder="メール購読中かつ LTV 5,000円以上の顧客"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                セグメントルール（JSON）
              </label>
              <textarea
                className={`w-full border rounded-lg px-3 py-2 text-sm font-mono ${rulesError ? 'border-red-400' : 'border-gray-300'}`}
                rows={12}
                value={form.rules}
                onChange={(e) => {
                  setForm({ ...form, rules: e.target.value })
                  if (rulesError) validateRules(e.target.value)
                }}
                spellCheck={false}
              />
              {rulesError && <p className="text-xs text-red-500 mt-1">{rulesError}</p>}
              <div className="mt-2 p-3 bg-gray-50 rounded-lg text-xs text-gray-500 font-mono leading-relaxed">
                <p className="font-semibold text-gray-600 mb-1">使用可能なフィールド：</p>
                <p>ltv, order_count, subscribed_email, region, language, last_order_at, created_at</p>
                <p className="font-semibold text-gray-600 mt-2 mb-1">演算子：</p>
                <p>=, !=, &gt;, &gt;=, &lt;, &lt;=, in, not_in, contains, within_days, older_than_days, is_null, is_not_null</p>
              </div>
            </div>
          </div>

          <div className="flex gap-2 mt-4">
            <button
              onClick={handleSave}
              disabled={!form.name || saving}
              className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium disabled:opacity-50"
            >
              {saving ? '保存中...' : '保存する'}
            </button>
            <button
              onClick={() => { setShowCreate(false); setEditId(null); resetForm(); setRulesError('') }}
              className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg text-sm"
            >
              キャンセル
            </button>
          </div>
        </div>
      )}

      {/* 一覧 */}
      {loading ? (
        <div className="text-center py-12 text-gray-400">読み込み中...</div>
      ) : segments.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-xl border border-dashed border-gray-300">
          <p className="text-gray-500 mb-2">まだセグメントがありません</p>
          <button onClick={() => setShowCreate(true)} className="text-sm text-green-600 hover:underline">
            最初のセグメントを作成する
          </button>
        </div>
      ) : (
        <div className="grid gap-4">
          {segments.map((s) => (
            <div key={s.segment_id} className="bg-white border border-gray-200 rounded-xl p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-semibold text-gray-900">{s.name}</h3>
                    <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded">
                      {CHANNEL_LABEL[s.channel_scope] ?? s.channel_scope}
                    </span>
                    <span className="text-xs bg-green-50 text-green-700 px-2 py-0.5 rounded font-medium">
                      {s.customer_count.toLocaleString()}人
                    </span>
                  </div>
                  {s.description && (
                    <p className="text-sm text-gray-500 mt-0.5">{s.description}</p>
                  )}
                  <p className="text-xs text-gray-400 mt-1">
                    最終計算: {fmt(s.last_computed_at)}
                  </p>
                </div>
                <div className="flex gap-2 shrink-0">
                  <button
                    onClick={() => handleRecompute(s.segment_id)}
                    disabled={recomputingId === s.segment_id}
                    className="px-3 py-1.5 text-xs text-blue-600 border border-blue-200 rounded-lg hover:bg-blue-50 disabled:opacity-50"
                  >
                    {recomputingId === s.segment_id ? '計算中...' : '再計算'}
                  </button>
                  <button
                    onClick={() => handleEdit(s)}
                    className="px-3 py-1.5 text-xs text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50"
                  >
                    編集
                  </button>
                  <button
                    onClick={() => handleDelete(s.segment_id, s.name)}
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
