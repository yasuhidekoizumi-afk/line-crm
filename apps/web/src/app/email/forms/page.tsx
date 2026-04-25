'use client'

import { useState, useEffect, useCallback } from 'react'
import { fetchApi } from '@/lib/api'

interface FermentForm {
  form_id: string
  name: string
  description: string | null
  form_type: string
  display_config: string
  view_count: number
  submit_count: number
  is_active: number
  created_at: string
}

interface ApiResult<T> {
  success: boolean
  data?: T
  error?: string
}

const WORKER_URL = 'https://oryzae-line-crm.oryzae.workers.dev'

const TYPE_LABEL: Record<string, string> = {
  popup: 'ポップアップ',
  embed: '埋め込み',
  inline: 'インライン',
}

export default function FormsPage() {
  const [forms, setForms] = useState<FermentForm[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [snippet, setSnippet] = useState<string | null>(null)
  const [form, setForm] = useState({
    name: '',
    description: '',
    form_type: 'popup',
    title: 'ニュースレター登録',
    desc: '米麹発酵の最新情報をお届けします 🌾',
    button: '登録する',
    placeholder: 'メールアドレス',
    success: 'ご登録ありがとうございます！',
    accent: '#225533',
    bg: '#ffffff',
  })

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetchApi<ApiResult<FermentForm[]>>('/api/forms')
      if (res.success && res.data) setForms(res.data)
    } catch {
      setError('読み込みに失敗しました')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const resetForm = () => setForm({
    name: '', description: '', form_type: 'popup',
    title: 'ニュースレター登録', desc: '米麹発酵の最新情報をお届けします 🌾',
    button: '登録する', placeholder: 'メールアドレス',
    success: 'ご登録ありがとうございます！', accent: '#225533', bg: '#ffffff',
  })

  const handleSave = async () => {
    if (!form.name) return
    const display_config = JSON.stringify({
      title: form.title, description: form.desc,
      button: form.button, placeholder: form.placeholder,
      success: form.success, accent: form.accent, bg: form.bg,
    })
    const data = {
      name: form.name,
      description: form.description || null,
      form_type: form.form_type,
      display_config,
    }
    const res = editId
      ? await fetchApi<ApiResult<FermentForm>>(`/api/forms/${editId}`, { method: 'PUT', body: JSON.stringify(data) })
      : await fetchApi<ApiResult<FermentForm>>('/api/forms', { method: 'POST', body: JSON.stringify(data) })
    if (res.success) {
      setShowCreate(false); setEditId(null); resetForm(); await load()
    } else {
      setError(res.error ?? '保存に失敗しました')
    }
  }

  const handleEdit = (f: FermentForm) => {
    let cfg: Record<string, string> = {}
    try { cfg = JSON.parse(f.display_config) } catch { /* noop */ }
    setForm({
      name: f.name, description: f.description ?? '', form_type: f.form_type,
      title: cfg.title ?? 'ニュースレター登録',
      desc: cfg.description ?? '',
      button: cfg.button ?? '登録する',
      placeholder: cfg.placeholder ?? 'メールアドレス',
      success: cfg.success ?? 'ご登録ありがとうございます！',
      accent: cfg.accent ?? '#225533',
      bg: cfg.bg ?? '#ffffff',
    })
    setEditId(f.form_id); setShowCreate(true)
  }

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`「${name}」を削除しますか？`)) return
    await fetchApi<ApiResult<null>>(`/api/forms/${id}`, { method: 'DELETE' })
    await load()
  }

  const handleToggle = async (f: FermentForm) => {
    await fetchApi<ApiResult<FermentForm>>(`/api/forms/${f.form_id}`, {
      method: 'PUT', body: JSON.stringify({ is_active: f.is_active === 1 ? 0 : 1 }),
    })
    await load()
  }

  const showSnippet = (formId: string) => {
    setSnippet(`<script async src="${WORKER_URL}/forms/embed/${formId}.js"></script>`)
  }

  return (
    <div className="max-w-5xl mx-auto py-8 px-4">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">フォーム</h1>
          <p className="text-sm text-gray-500 mt-1">サイト訪問者をメールリストに取り込むポップアップ・埋め込みフォーム</p>
        </div>
        <button
          onClick={() => { setShowCreate(true); setEditId(null); resetForm() }}
          className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700"
        >+ 新規作成</button>
      </div>

      {error && <div className="mb-4 p-3 bg-red-50 text-red-600 rounded-lg text-sm">{error}</div>}

      {snippet && (
        <div className="mb-4 p-4 bg-blue-50 border border-blue-200 rounded-xl">
          <div className="flex justify-between items-start mb-2">
            <h3 className="text-sm font-semibold text-blue-900">埋め込みコード（Shopify テーマ等の &lt;head&gt; or &lt;body&gt; 末尾に貼り付け）</h3>
            <button onClick={() => setSnippet(null)} className="text-gray-400 hover:text-gray-600">×</button>
          </div>
          <pre className="text-xs bg-white p-3 rounded border border-blue-100 overflow-x-auto">{snippet}</pre>
          <button
            onClick={() => navigator.clipboard.writeText(snippet)}
            className="mt-2 text-xs text-blue-700 hover:underline"
          >コピー</button>
        </div>
      )}

      {showCreate && (
        <div className="mb-6 p-5 bg-white border border-gray-200 rounded-xl shadow-sm space-y-4">
          <h2 className="text-base font-semibold text-gray-800">{editId ? '編集' : '新規フォーム'}</h2>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">フォーム名（社内管理用）*</label>
            <input className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="トップページ ニュースレター登録" />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">タイプ</label>
              <select className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                value={form.form_type} onChange={(e) => setForm({ ...form, form_type: e.target.value })}>
                {Object.entries(TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">アクセントカラー</label>
              <input type="color" value={form.accent}
                onChange={(e) => setForm({ ...form, accent: e.target.value })}
                className="w-full h-9 border border-gray-300 rounded-lg" />
            </div>
          </div>

          <div className="border-t border-gray-100 pt-4">
            <h3 className="text-sm font-semibold text-gray-700 mb-3">表示内容</h3>
            <div className="space-y-3">
              <input className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                placeholder="タイトル" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
              <input className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                placeholder="説明文" value={form.desc} onChange={(e) => setForm({ ...form, desc: e.target.value })} />
              <div className="grid grid-cols-2 gap-3">
                <input className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  placeholder="ボタン文言" value={form.button} onChange={(e) => setForm({ ...form, button: e.target.value })} />
                <input className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  placeholder="入力欄プレースホルダ" value={form.placeholder} onChange={(e) => setForm({ ...form, placeholder: e.target.value })} />
              </div>
              <input className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                placeholder="成功時メッセージ" value={form.success} onChange={(e) => setForm({ ...form, success: e.target.value })} />
            </div>
          </div>

          <div className="flex gap-2 pt-2">
            <button onClick={handleSave} disabled={!form.name}
              className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium disabled:opacity-50">保存</button>
            <button onClick={() => { setShowCreate(false); setEditId(null); resetForm() }}
              className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg text-sm">キャンセル</button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="text-center py-12 text-gray-400">読み込み中...</div>
      ) : forms.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-xl border border-dashed border-gray-300">
          <p className="text-gray-500 mb-2">まだフォームがありません</p>
        </div>
      ) : (
        <div className="grid gap-4">
          {forms.map((f) => (
            <div key={f.form_id} className="bg-white border border-gray-200 rounded-xl p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-semibold text-gray-900">{f.name}</h3>
                    <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded">{TYPE_LABEL[f.form_type] ?? f.form_type}</span>
                    <span className={`text-xs px-2 py-0.5 rounded font-medium ${f.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                      {f.is_active ? '稼働中' : '停止中'}
                    </span>
                  </div>
                  <div className="text-xs text-gray-400 mt-1">表示: {f.view_count.toLocaleString()} / 登録: {f.submit_count.toLocaleString()} （CVR: {f.view_count > 0 ? ((f.submit_count / f.view_count) * 100).toFixed(1) : '0'}%）</div>
                </div>
                <div className="flex gap-2 shrink-0">
                  <button onClick={() => showSnippet(f.form_id)}
                    className="px-3 py-1.5 text-xs text-blue-600 border border-blue-200 rounded-lg hover:bg-blue-50">埋め込みコード</button>
                  <button onClick={() => handleToggle(f)}
                    className={`px-3 py-1.5 text-xs rounded-lg border ${f.is_active ? 'text-yellow-600 border-yellow-200 hover:bg-yellow-50' : 'text-green-600 border-green-200 hover:bg-green-50'}`}>{f.is_active ? '停止' : '有効化'}</button>
                  <button onClick={() => handleEdit(f)}
                    className="px-3 py-1.5 text-xs text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50">編集</button>
                  <button onClick={() => handleDelete(f.form_id, f.name)}
                    className="px-3 py-1.5 text-xs text-red-500 border border-red-200 rounded-lg hover:bg-red-50">削除</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
