'use client'

import { useState, useEffect, useCallback } from 'react'
import { fermentApi, type EmailTemplate } from '@/lib/ferment-api'

const CATEGORY_LABEL: Record<string, string> = {
  welcome: 'ウェルカム',
  cart: 'カゴ落ち',
  winback: '休眠復帰',
  newsletter: 'ニュースレター',
  transactional: 'トランザクション',
}

export default function EmailTemplatesPage() {
  const [templates, setTemplates] = useState<EmailTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [previewHtml, setPreviewHtml] = useState<string | null>(null)
  const [form, setForm] = useState({
    name: '', category: '', language: 'ja', subject_base: '',
    body_html: '', body_text: '', from_name: 'オリゼ', from_email: '',
    ai_enabled: false, ai_system_prompt: '',
  })

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fermentApi.templates.list()
      if (res.success && res.data) setTemplates(res.data)
    } catch {
      setError('読み込みに失敗しました')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const resetForm = () => setForm({
    name: '', category: '', language: 'ja', subject_base: '',
    body_html: '', body_text: '', from_name: 'オリゼ', from_email: '',
    ai_enabled: false, ai_system_prompt: '',
  })

  const handleSave = async () => {
    if (!form.name) return
    try {
      const data = {
        ...form,
        ai_enabled: form.ai_enabled ? 1 : 0,
        category: form.category || null,
        from_email: form.from_email || null,
        ai_system_prompt: form.ai_system_prompt || null,
      }
      const res = editId
        ? await fermentApi.templates.update(editId, data)
        : await fermentApi.templates.create(data)
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
    }
  }

  const handleEdit = (t: EmailTemplate) => {
    setForm({
      name: t.name,
      category: t.category ?? '',
      language: t.language,
      subject_base: t.subject_base ?? '',
      body_html: t.body_html ?? '',
      body_text: t.body_text ?? '',
      from_name: t.from_name,
      from_email: t.from_email ?? '',
      ai_enabled: t.ai_enabled === 1,
      ai_system_prompt: t.ai_system_prompt ?? '',
    })
    setEditId(t.template_id)
    setShowCreate(true)
  }

  const handlePreview = async (id: string) => {
    try {
      const res = await fermentApi.templates.preview(id)
      if (res.success && res.data) setPreviewHtml(res.data.html)
    } catch {
      setError('プレビュー生成に失敗しました')
    }
  }

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`「${name}」を削除しますか？`)) return
    await fermentApi.templates.delete(id)
    await load()
  }

  const isEditing = editId !== null

  return (
    <div className="max-w-6xl mx-auto py-8 px-4">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">メールテンプレート</h1>
          <p className="text-sm text-gray-500 mt-1">AI パーソナライズ対応のメールテンプレート管理</p>
        </div>
        <button
          onClick={() => { setShowCreate(true); setEditId(null); resetForm() }}
          className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700"
        >
          + 新規作成
        </button>
      </div>

      {error && <div className="mb-4 p-3 bg-red-50 text-red-600 rounded-lg text-sm">{error}</div>}

      {/* プレビューモーダル */}
      {previewHtml && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setPreviewHtml(null)}>
          <div className="bg-white rounded-xl max-w-2xl w-full max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-center px-4 py-3 border-b">
              <h3 className="font-semibold text-gray-800">プレビュー</h3>
              <button onClick={() => setPreviewHtml(null)} className="text-gray-400 hover:text-gray-600">✕</button>
            </div>
            <div className="flex-1 overflow-auto p-4">
              <iframe
                srcDoc={previewHtml}
                className="w-full border rounded-lg"
                style={{ minHeight: '500px' }}
                sandbox="allow-same-origin"
              />
            </div>
          </div>
        </div>
      )}

      {/* 作成・編集フォーム */}
      {showCreate && (
        <div className="mb-6 p-5 bg-white border border-gray-200 rounded-xl shadow-sm">
          <h2 className="text-base font-semibold text-gray-800 mb-4">
            {isEditing ? 'テンプレートを編集' : '新規テンプレート'}
          </h2>
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">テンプレート名 *</label>
              <input
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="ウェルカムメール JP"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">カテゴリ</label>
              <select
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
              >
                <option value="">選択してください</option>
                {Object.entries(CATEGORY_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">言語</label>
              <select
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                value={form.language}
                onChange={(e) => setForm({ ...form, language: e.target.value })}
              >
                <option value="ja">日本語</option>
                <option value="en">英語</option>
              </select>
            </div>
            <div className="col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">件名</label>
              <input
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                value={form.subject_base}
                onChange={(e) => setForm({ ...form, subject_base: e.target.value })}
                placeholder="{{name}}さん、オリゼへようこそ 🌾"
              />
            </div>
            <div className="col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">HTML 本文</label>
              <textarea
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono"
                rows={10}
                value={form.body_html}
                onChange={(e) => setForm({ ...form, body_html: e.target.value })}
                placeholder="<p>{{name}} さん、こんにちは。</p>..."
              />
              <p className="text-xs text-gray-400 mt-1">
                使用可能なプレースホルダー: {'{{name}}'}, {'{{first_name}}'}, {'{{region}}'}, {'{{unsubscribe_url}}'}
              </p>
            </div>
            <div className="col-span-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.ai_enabled}
                  onChange={(e) => setForm({ ...form, ai_enabled: e.target.checked })}
                  className="rounded border-gray-300"
                />
                <span className="text-sm font-medium text-gray-700">AI パーソナライズを有効にする（Claude）</span>
              </label>
            </div>
          </div>
          <div className="flex gap-2 mt-4">
            <button
              onClick={handleSave}
              disabled={!form.name}
              className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium disabled:opacity-50"
            >
              保存する
            </button>
            <button
              onClick={() => { setShowCreate(false); setEditId(null); resetForm() }}
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
      ) : templates.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-xl border border-dashed border-gray-300">
          <p className="text-gray-500 mb-2">まだテンプレートがありません</p>
          <button onClick={() => setShowCreate(true)} className="text-sm text-green-600 hover:underline">
            最初のテンプレートを作成する
          </button>
        </div>
      ) : (
        <div className="grid gap-4">
          {templates.map((t) => (
            <div key={t.template_id} className="bg-white border border-gray-200 rounded-xl p-4 flex items-center gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="font-semibold text-gray-900">{t.name}</h3>
                  {t.category && (
                    <span className="text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded">
                      {CATEGORY_LABEL[t.category] ?? t.category}
                    </span>
                  )}
                  {t.ai_enabled === 1 && (
                    <span className="text-xs bg-purple-50 text-purple-700 px-2 py-0.5 rounded">AI</span>
                  )}
                </div>
                <p className="text-sm text-gray-500 mt-0.5">{t.subject_base ?? '(件名なし)'}</p>
              </div>
              <div className="flex gap-2 shrink-0">
                <button
                  onClick={() => handlePreview(t.template_id)}
                  className="px-3 py-1.5 text-xs text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50"
                >
                  プレビュー
                </button>
                <a
                  href={`/email/templates/edit?id=${t.template_id}`}
                  className="px-3 py-1.5 text-xs text-purple-600 border border-purple-200 rounded-lg hover:bg-purple-50"
                  title="ドラッグ&ドロップで編集"
                >
                  ✨ ビジュアル編集
                </a>
                <button
                  onClick={() => handleEdit(t)}
                  className="px-3 py-1.5 text-xs text-blue-600 border border-blue-200 rounded-lg hover:bg-blue-50"
                >
                  HTML編集
                </button>
                <button
                  onClick={() => handleDelete(t.template_id, t.name)}
                  className="px-3 py-1.5 text-xs text-red-500 border border-red-200 rounded-lg hover:bg-red-50"
                >
                  削除
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
