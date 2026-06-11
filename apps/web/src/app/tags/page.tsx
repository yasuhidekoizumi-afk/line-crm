'use client'

import { useState, useEffect, useCallback } from 'react'
import { api } from '@/lib/api'
import Header from '@/components/layout/header'

interface TagRow {
  id: string
  name: string
  color: string
  createdAt: string
  friendCount: number
}

// 既定のカラーパレット（よく使う12色）
const COLOR_PRESETS = [
  '#EF4444', '#F97316', '#F59E0B', '#EAB308',
  '#84CC16', '#22C55E', '#10B981', '#14B8A6',
  '#06B6D4', '#3B82F6', '#8B5CF6', '#EC4899',
]

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('ja-JP', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  })
}

interface FormState {
  name: string
  color: string
}

const EMPTY_FORM: FormState = { name: '', color: '#3B82F6' }

export default function TagsPage() {
  const [tags, setTags] = useState<TagRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showForm, setShowForm] = useState(false)
  // editingId が入っていれば「編集モード」、null なら「新規作成モード」
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await api.tags.listWithCount()
      if (res.success) setTags(res.data)
      else setError(res.error)
    } catch {
      setError('タグの取得に失敗しました')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const openCreate = () => {
    setEditingId(null)
    setForm(EMPTY_FORM)
    setFormError('')
    setShowForm(true)
  }

  const openEdit = (t: TagRow) => {
    setEditingId(t.id)
    setForm({ name: t.name, color: t.color })
    setFormError('')
    setShowForm(true)
  }

  const closeForm = () => {
    setShowForm(false)
    setEditingId(null)
    setForm(EMPTY_FORM)
    setFormError('')
  }

  const handleSave = async () => {
    if (!form.name.trim()) {
      setFormError('タグ名を入力してください')
      return
    }
    setSaving(true)
    setFormError('')
    try {
      const res = editingId
        ? await api.tags.update(editingId, { name: form.name.trim(), color: form.color })
        : await api.tags.create({ name: form.name.trim(), color: form.color })
      if (res.success) {
        closeForm()
        load()
      } else {
        setFormError(res.error)
      }
    } catch {
      setFormError(editingId ? '更新に失敗しました' : '作成に失敗しました')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (t: TagRow) => {
    const msg = t.friendCount > 0
      ? `タグ「${t.name}」を削除します。\n${t.friendCount}人の友だちからこのタグが外れます。よろしいですか？`
      : `タグ「${t.name}」を削除しますか？`
    if (!confirm(msg)) return
    try {
      const res = await api.tags.delete(t.id)
      if (res.success) load()
      else setError(`削除に失敗: ${res.error}`)
    } catch {
      setError('削除に失敗しました')
    }
  }

  return (
    <div>
      <Header
        title="タグ管理"
        action={
          <button
            onClick={openCreate}
            className="px-4 py-2 text-sm font-medium text-white rounded-lg transition-opacity hover:opacity-90"
            style={{ backgroundColor: '#06C755' }}
          >
            + 新規タグ
          </button>
        }
      />

      <p className="mb-4 text-sm text-gray-600">
        LINE顧客に付けるタグの一覧です。タグ名・色を編集したり、不要なタグを削除できます。
        削除すると、そのタグが付いていた友だちからは自動的に外れます。
      </p>

      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          {error}
        </div>
      )}

      {/* 作成・編集フォーム */}
      {showForm && (
        <div className="mb-6 bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h2 className="text-sm font-semibold text-gray-800 mb-4">
            {editingId ? 'タグを編集' : '新規タグを作成'}
          </h2>
          <div className="space-y-4 max-w-md">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">タグ名 <span className="text-red-500">*</span></label>
              <input
                type="text"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                placeholder="例: VIP、リピーター、メルマガ会員"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                autoFocus
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">色</label>
              <div className="flex flex-wrap gap-2 mb-2">
                {COLOR_PRESETS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setForm({ ...form, color: c })}
                    className="w-8 h-8 rounded-full border-2 transition-transform hover:scale-110"
                    style={{
                      backgroundColor: c,
                      borderColor: form.color === c ? '#1f2937' : 'transparent',
                    }}
                    aria-label={`色 ${c}`}
                  />
                ))}
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={form.color}
                  onChange={(e) => setForm({ ...form, color: e.target.value })}
                  className="w-10 h-8 border border-gray-300 rounded cursor-pointer"
                />
                <input
                  type="text"
                  value={form.color}
                  onChange={(e) => setForm({ ...form, color: e.target.value })}
                  className="w-28 border border-gray-300 rounded-lg px-3 py-1.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-green-500"
                  placeholder="#3B82F6"
                />
              </div>
            </div>
            {/* プレビュー */}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">プレビュー</label>
              <span
                className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium text-white"
                style={{ backgroundColor: form.color }}
              >
                {form.name || 'タグ名'}
              </span>
            </div>

            {formError && <p className="text-xs text-red-600">{formError}</p>}

            <div className="flex gap-2 pt-2">
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex-1 px-4 py-2 text-sm font-medium text-white rounded-lg disabled:opacity-50 transition-opacity"
                style={{ backgroundColor: '#06C755' }}
              >
                {saving
                  ? (editingId ? '更新中...' : '作成中...')
                  : (editingId ? '保存' : '作成')}
              </button>
              <button
                onClick={closeForm}
                className="px-4 py-2 text-sm font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
              >
                キャンセル
              </button>
            </div>
          </div>
        </div>
      )}

      {/* タグ一覧 */}
      {loading ? (
        <div className="text-center py-8 text-sm text-gray-500">読み込み中...</div>
      ) : tags.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-lg border border-gray-200 text-sm text-gray-500">
          まだタグがありません。「＋ 新規タグ」から作成してください。
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-600">タグ</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-600">使用人数</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-600">作成日</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-600">操作</th>
              </tr>
            </thead>
            <tbody>
              {tags.map((t) => (
                <tr key={t.id} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3">
                    <span
                      className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium text-white"
                      style={{ backgroundColor: t.color }}
                    >
                      {t.name}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right text-gray-700 font-medium">
                    {t.friendCount.toLocaleString()}人
                  </td>
                  <td className="px-4 py-3 text-gray-500 text-xs">{formatDate(t.createdAt)}</td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => openEdit(t)}
                      className="px-3 py-1.5 text-xs font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-md transition-colors mr-2"
                    >
                      編集
                    </button>
                    <button
                      onClick={() => handleDelete(t)}
                      className="px-3 py-1.5 text-xs font-medium text-red-500 hover:text-red-700 bg-red-50 hover:bg-red-100 rounded-md transition-colors"
                    >
                      削除
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
