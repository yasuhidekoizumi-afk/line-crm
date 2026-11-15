'use client'

import { useState, useEffect, useCallback } from 'react'
import { api, type BulkTagResult } from '@/lib/api'
import Header from '@/components/layout/header'
import { confirmDialog } from '@/components/ui/confirm-provider'

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

// UUID形式の行だけを拾う（CSVヘッダー・余計な列が混ざっても壊れないように）
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** 貼り付けテキスト / CSV から friend id を抽出（line_crm_friend_id 列でも、IDだけの列でも可） */
function parseFriendIds(text: string): string[] {
  const ids = new Set<string>()
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line) continue
    const cells = line.split(/[,\t;]/).map((c) => c.trim().replace(/^"|"$/g, ''))
    const hit = cells.find((c) => UUID_RE.test(c))
    if (hit) ids.add(hit)
    else if (UUID_RE.test(line)) ids.add(line)
  }
  return [...ids]
}

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
  // 一括付与
  const [bulkTag, setBulkTag] = useState<TagRow | null>(null)
  const [bulkInput, setBulkInput] = useState('')
  const [bulkResult, setBulkResult] = useState<BulkTagResult | null>(null)
  const [bulkError, setBulkError] = useState('')
  const [bulkLoading, setBulkLoading] = useState(false)

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
    if (!(await confirmDialog({ message: msg, variant: 'danger', confirmLabel: '削除する' }))) return
    try {
      const res = await api.tags.delete(t.id)
      if (res.success) load()
      else setError(`削除に失敗: ${res.error}`)
    } catch {
      setError('削除に失敗しました')
    }
  }

  const openBulk = (t: TagRow) => {
    setShowForm(false)
    setBulkTag(t)
    setBulkInput('')
    setBulkResult(null)
    setBulkError('')
  }

  const closeBulk = () => {
    setBulkTag(null)
    setBulkInput('')
    setBulkResult(null)
    setBulkError('')
  }

  const handleCsvFile = async (file: File | null) => {
    if (!file) return
    try {
      const text = await file.text()
      setBulkInput((prev) => (prev.trim() ? `${prev}\n${text}` : text))
      setBulkResult(null)
      setBulkError('')
    } catch {
      setBulkError('CSVの読み込みに失敗しました')
    }
  }

  const runBulk = async (dryRun: boolean) => {
    if (!bulkTag) return
    const ids = parseFriendIds(bulkInput)
    if (ids.length === 0) {
      setBulkError('friend id（UUID形式）が見つかりませんでした。CSVの列に line_crm_friend_id が含まれているか確認してください。')
      return
    }
    if (ids.length > 5000) {
      setBulkError(`1回に付与できるのは5,000件までです（現在 ${ids.length.toLocaleString()}件）。ファイルを分割してください。`)
      return
    }
    if (!dryRun) {
      const ok = await confirmDialog({
        message: `タグ「${bulkTag.name}」を ${ids.length.toLocaleString()}人に一括付与します。\nシナリオ・Webhook・自動化は発火しません。よろしいですか？`,
        confirmLabel: '付与する',
      })
      if (!ok) return
    }
    setBulkLoading(true)
    setBulkError('')
    try {
      const res = await api.tags.addFriends(bulkTag.id, ids, dryRun)
      if (res.success) {
        setBulkResult(res.data)
        if (!dryRun) load()
      } else {
        setBulkError(res.error || '一括付与に失敗しました')
      }
    } catch {
      setBulkError('一括付与に失敗しました')
    } finally {
      setBulkLoading(false)
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
            style={{ backgroundColor: 'var(--color-brand-500)' }}
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
        <div className="mb-6 bg-surface rounded-card shadow-card border border-line p-6">
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
                style={{ backgroundColor: 'var(--color-brand-500)' }}
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

      {/* 一括付与 */}
      {bulkTag && (
        <div className="mb-6 bg-surface rounded-card shadow-card border border-line p-6">
          <div className="flex items-start justify-between mb-3">
            <div>
              <h2 className="text-sm font-semibold text-gray-800">
                タグ「{bulkTag.name}」に一括付与
              </h2>
              <p className="mt-1 text-xs text-gray-500">
                CSV（<span className="font-mono">line_crm_friend_id</span> 列があればOK）を取り込むか、friend id を貼り付けてください。
                1回5,000件まで。<span className="font-medium">シナリオ・Webhook・自動化は発火しません</span>（大量付与で意図しない配信が始まらないようにするため）。
              </p>
            </div>
            <button
              type="button"
              onClick={closeBulk}
              className="text-xs text-gray-500 hover:text-gray-700"
            >
              閉じる
            </button>
          </div>

          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">CSVファイル</label>
              <input
                type="file"
                accept=".csv,text/csv,text/plain"
                onChange={(e) => handleCsvFile(e.target.files?.[0] ?? null)}
                className="block w-full text-xs text-gray-600 file:mr-3 file:px-3 file:py-1.5 file:rounded-md file:border-0 file:text-xs file:font-medium file:bg-gray-100 file:text-gray-700 hover:file:bg-gray-200"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                friend id（1行1件・カンマ区切りCSV可）
              </label>
              <textarea
                value={bulkInput}
                onChange={(e) => { setBulkInput(e.target.value); setBulkResult(null) }}
                rows={6}
                placeholder={'8f3c1d2e-...（UUID）\n4b7a9c10-...'}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-green-500"
              />
              <p className="mt-1 text-[11px] text-gray-500">
                認識したID: {parseFriendIds(bulkInput).length.toLocaleString()}件
              </p>
            </div>

            {bulkError && <p className="text-xs text-red-600">{bulkError}</p>}

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => runBulk(true)}
                disabled={bulkLoading}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg disabled:opacity-50 transition-colors"
              >
                {bulkLoading ? '確認中...' : '事前チェック（付与しない）'}
              </button>
              <button
                type="button"
                onClick={() => runBulk(false)}
                disabled={bulkLoading}
                className="px-4 py-2 text-sm font-medium text-white rounded-lg disabled:opacity-50 transition-opacity"
                style={{ backgroundColor: 'var(--color-brand-500)' }}
              >
                {bulkLoading ? '処理中...' : '一括付与する'}
              </button>
            </div>

            {bulkResult && (
              <div className={`rounded-lg border p-4 text-xs ${bulkResult.dryRun ? 'bg-blue-50 border-blue-200' : 'bg-green-50 border-green-200'}`}>
                <p className="font-medium text-gray-800 mb-2">
                  {bulkResult.dryRun ? '事前チェック結果（まだ付与していません）' : '一括付与の結果'}
                </p>
                <ul className="space-y-1 text-gray-700">
                  <li>指定: {bulkResult.requested.toLocaleString()}件（重複除去後 {bulkResult.unique.toLocaleString()}件）</li>
                  <li>見つかった友だち: {bulkResult.found.toLocaleString()}人</li>
                  {!bulkResult.dryRun && (
                    <>
                      <li className="font-medium">付与した: {bulkResult.added.toLocaleString()}人</li>
                      <li>既に付いていた: {bulkResult.alreadyTagged.toLocaleString()}人</li>
                    </>
                  )}
                  <li className={bulkResult.notFoundCount > 0 ? 'text-red-700 font-medium' : ''}>
                    見つからなかったID: {bulkResult.notFoundCount.toLocaleString()}件
                  </li>
                  {bulkResult.failedChunks > 0 && (
                    <li className="text-red-700 font-medium">失敗したチャンク: {bulkResult.failedChunks}件</li>
                  )}
                </ul>
                {bulkResult.notFound.length > 0 && (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-gray-600">
                      見つからなかったIDを表示（先頭{bulkResult.notFound.length}件）
                    </summary>
                    <pre className="mt-2 max-h-40 overflow-auto rounded bg-white/70 p-2 text-[10px] leading-relaxed">
{bulkResult.notFound.join('\n')}
                    </pre>
                  </details>
                )}
                {bulkResult.errors.length > 0 && (
                  <ul className="mt-2 list-disc pl-4 text-red-700">
                    {bulkResult.errors.map((e) => <li key={e}>{e}</li>)}
                  </ul>
                )}
                {!bulkResult.dryRun && bulkResult.added > 0 && (
                  <p className="mt-2 text-gray-600">
                    このタグは配信のターゲット（対象=タグ）にそのまま使えます。
                  </p>
                )}
              </div>
            )}
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
        <div className="bg-surface rounded-card shadow-card border border-line overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-canvas border-b border-line">
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
                      onClick={() => openBulk(t)}
                      className="px-3 py-1.5 text-xs font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-md transition-colors mr-2"
                    >
                      一括付与
                    </button>
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
