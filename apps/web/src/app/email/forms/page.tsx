'use client'

import { useState, useEffect, useCallback } from 'react'
import { fetchApi } from '@/lib/api'

interface FermentForm {
  form_id: string
  name: string
  description: string | null
  form_type: string
  display_config: string
  fields: string
  on_submit_tag: string | null
  on_submit_flow_id: string | null
  on_submit_scenario_id: string | null
  save_to_metadata: number
  view_count: number
  submit_count: number
  is_active: number
  created_at: string
  updated_at: string
}

interface Submission {
  submission_id: string
  form_id: string
  email: string
  display_name: string | null
  customer_id: string | null
  data: string
  friend_id: string | null
  friend_name?: string | null
  source_url: string | null
  user_agent: string | null
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

const PAGE_SIZE = 20

export default function FormsPage() {
  const [tab, setTab] = useState<'manage' | 'submissions'>('manage')
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
    trigger_type: 'time_delay',
    trigger_value: 3000,
    title: 'ニュースレター登録',
    desc: '米麹発酵の最新情報をお届けします 🌾',
    button: '登録する',
    placeholder: 'メールアドレス',
    success: 'ご登録ありがとうございます！',
    accent: '#225533',
    bg: '#ffffff',
    fields: '',
    on_submit_tag: '',
    on_submit_scenario_id: '',
    save_to_metadata: false,
  })

  // ── 回答一覧用の状態 ──
  const [selectedFormId, setSelectedFormId] = useState<string | null>(null)
  const [submissions, setSubmissions] = useState<Submission[]>([])
  const [subLoading, setSubLoading] = useState(false)
  const [subPage, setSubPage] = useState(1)
  const [fieldLabels, setFieldLabels] = useState<Record<string, string>>({})

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
    trigger_type: 'time_delay', trigger_value: 3000,
    title: 'ニュースレター登録', desc: '米麹発酵の最新情報をお届けします 🌾',
    button: '登録する', placeholder: 'メールアドレス',
    success: 'ご登録ありがとうございます！', accent: '#225533', bg: '#ffffff',
    fields: '', on_submit_tag: '', on_submit_scenario_id: '', save_to_metadata: false,
  })

  const handleSave = async () => {
    if (!form.name) return
    const display_config = JSON.stringify({
      title: form.title, description: form.desc,
      button: form.button, placeholder: form.placeholder,
      success: form.success, accent: form.accent, bg: form.bg,
    })
    const data: Record<string, unknown> = {
      name: form.name,
      description: form.description || null,
      form_type: form.form_type,
      trigger_type: form.trigger_type,
      trigger_value: form.trigger_value,
      display_config,
      fields: form.fields || '[]',
      on_submit_tag: form.on_submit_tag || null,
      on_submit_scenario_id: form.on_submit_scenario_id || null,
      save_to_metadata: form.save_to_metadata ? 1 : 0,
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
      trigger_type: (f as unknown as { trigger_type?: string }).trigger_type ?? 'time_delay',
      trigger_value: (f as unknown as { trigger_value?: number }).trigger_value ?? 3000,
      title: cfg.title ?? 'ニュースレター登録',
      desc: cfg.description ?? '',
      button: cfg.button ?? '登録する',
      placeholder: cfg.placeholder ?? 'メールアドレス',
      success: cfg.success ?? 'ご登録ありがとうございます！',
      accent: cfg.accent ?? '#225533',
      bg: cfg.bg ?? '#ffffff',
      fields: f.fields ?? '[]',
      on_submit_tag: f.on_submit_tag ?? '',
      on_submit_scenario_id: f.on_submit_scenario_id ?? '',
      save_to_metadata: f.save_to_metadata === 1,
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

  // ── 回答一覧 ──
  const loadSubmissions = useCallback(async (formId: string) => {
    setSubLoading(true)
    setSubPage(1)
    try {
      const formRes = await fetchApi<{ success: boolean; data: FermentForm }>(`/api/forms/${formId}`)
      const res = await fetchApi<ApiResult<Submission[]>>(`/api/forms/${formId}/submissions`)

      setSelectedFormId((current) => {
        if (current !== formId) return current
        // Parse field labels
        if (formRes.success && formRes.data) {
          const raw = formRes.data.fields
          let flds: Array<{ name: string; label: string }> = []
          try { flds = typeof raw === 'string' ? JSON.parse(raw) : raw } catch { /* noop */ }
          const labels: Record<string, string> = {}
          for (const f of flds) labels[f.name] = f.label
          setFieldLabels(labels)
        }
        if (res.success && res.data) {
          setSubmissions(res.data.map((s) => ({
            ...s,
            data: typeof s.data === 'string' ? s.data : JSON.stringify(s.data),
          })))
        }
        return current
      })
    } catch { /* silent */ }
    setSelectedFormId((current) => {
      if (current === formId) setSubLoading(false)
      return current
    })
  }, [])

  const handleSelectForm = (formId: string) => {
    setSelectedFormId(formId)
    loadSubmissions(formId)
  }

  const totalPages = Math.ceil(submissions.length / PAGE_SIZE)
  const paged = submissions.slice((subPage - 1) * PAGE_SIZE, subPage * PAGE_SIZE)

  const allFieldKeys = submissions.length > 0
    ? [...new Set(submissions.flatMap(s => {
        try { return Object.keys(JSON.parse(s.data)) } catch { return [] }
      }))]
    : []

  return (
    <div className="max-w-5xl mx-auto py-8 px-4">
      {/* Tabs */}
      <div className="flex items-center gap-4 mb-6 border-b border-gray-200 pb-3">
        <button
          onClick={() => setTab('manage')}
          className={`text-sm font-medium pb-1 border-b-2 transition-colors ${
            tab === 'manage' ? 'border-green-600 text-green-700' : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >フォーム管理</button>
        <button
          onClick={() => setTab('submissions')}
          className={`text-sm font-medium pb-1 border-b-2 transition-colors ${
            tab === 'submissions' ? 'border-green-600 text-green-700' : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >回答一覧</button>
      </div>

      {error && <div className="mb-4 p-3 bg-red-50 text-red-600 rounded-lg text-sm">{error}</div>}

      {tab === 'manage' && (
        <>
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
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">表示トリガー</label>
                  <select className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                    value={form.trigger_type}
                    onChange={(e) => setForm({ ...form, trigger_type: e.target.value })}>
                    <option value="time_delay">時間経過</option>
                    <option value="exit_intent">離脱インテント（マウスが画面外へ）</option>
                    <option value="scroll_depth">スクロール深度</option>
                    <option value="manual">手動（JS から呼ぶ）</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    トリガー値 {form.trigger_type === 'time_delay' && '(ms)'}
                    {form.trigger_type === 'scroll_depth' && '(%)'}
                  </label>
                  <input type="number" value={form.trigger_value}
                    onChange={(e) => setForm({ ...form, trigger_value: parseInt(e.target.value) || 0 })}
                    disabled={form.trigger_type === 'exit_intent' || form.trigger_type === 'manual'}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm disabled:bg-gray-100" />
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

              {/* LINE CRM forms 互換フィールド */}
              <div className="border-t border-gray-100 pt-4">
                <h3 className="text-sm font-semibold text-gray-700 mb-3">LINE CRM 連携設定</h3>
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">フィールド定義（JSON）</label>
                    <textarea
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono"
                      rows={3}
                      value={form.fields}
                      onChange={(e) => setForm({ ...form, fields: e.target.value })}
                      placeholder='[{"name":"age","label":"年齢","type":"number","required":true}]'
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">送信時タグ</label>
                      <input className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                        value={form.on_submit_tag} onChange={(e) => setForm({ ...form, on_submit_tag: e.target.value })}
                        placeholder="tag_id" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">送信時シナリオ</label>
                      <input className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                        value={form.on_submit_scenario_id} onChange={(e) => setForm({ ...form, on_submit_scenario_id: e.target.value })}
                        placeholder="scenario_id" />
                    </div>
                  </div>
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={form.save_to_metadata}
                      onChange={(e) => setForm({ ...form, save_to_metadata: e.target.checked })}
                      className="rounded border-gray-300" />
                    <span className="text-sm text-gray-700">友だちメタデータに保存</span>
                  </label>
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
        </>
      )}

      {tab === 'submissions' && (
        <>
          <div className="mb-6">
            <h1 className="text-2xl font-bold text-gray-900">回答一覧</h1>
            <p className="text-sm text-gray-500 mt-1">LINE CRM フォームの回答データ</p>
          </div>

          {/* フォーム選択 */}
          <div className="mb-6 flex flex-wrap gap-2">
            {forms.map((f) => (
              <button
                key={f.form_id}
                onClick={() => handleSelectForm(f.form_id)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  selectedFormId === f.form_id
                    ? 'text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
                style={selectedFormId === f.form_id ? { backgroundColor: '#06C755' } : {}}
              >
                {f.name}
              </button>
            ))}
          </div>

          {selectedFormId && subLoading && (
            <div className="text-center py-12 text-gray-400">読み込み中...</div>
          )}

          {selectedFormId && !subLoading && submissions.length === 0 && (
            <div className="text-center py-16 bg-white rounded-xl border border-dashed border-gray-300">
              <p className="text-gray-500">回答がありません</p>
            </div>
          )}

          {selectedFormId && !subLoading && submissions.length > 0 && (
            <>
              <div className="mb-4 text-sm text-gray-500">
                全 <span className="font-bold text-gray-900">{submissions.length}</span> 件の回答
              </div>
              <div className="bg-white rounded-lg border border-gray-200 overflow-x-auto">
                <table className="w-full min-w-[800px]">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase whitespace-nowrap">名前</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase whitespace-nowrap">メール</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase whitespace-nowrap">日時</th>
                      {allFieldKeys.map((key) => (
                        <th key={key} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase whitespace-nowrap">
                          {fieldLabels[key] || key}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {paged.map((sub) => {
                      let parsedData: Record<string, unknown> = {}
                      try { parsedData = JSON.parse(sub.data) } catch { /* noop */ }
                      return (
                        <tr key={sub.submission_id} className="hover:bg-gray-50">
                          <td className="px-4 py-3 text-sm font-medium text-gray-900 whitespace-nowrap">
                            {sub.friend_name || sub.display_name || '-'}
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-500 whitespace-nowrap">{sub.email}</td>
                          <td className="px-4 py-3 text-xs text-gray-400 whitespace-nowrap">
                            {new Date(sub.created_at).toLocaleString('ja-JP', {
                              month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
                            })}
                          </td>
                          {allFieldKeys.map((key) => {
                            const val = parsedData[key]
                            return (
                              <td key={key} className="px-4 py-3 text-sm text-gray-700 max-w-[200px] truncate">
                                {Array.isArray(val)
                                  ? val.join(', ')
                                  : (val !== null && val !== undefined && val !== '') ? String(val) : '-'}
                              </td>
                            )
                          })}
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              {totalPages > 1 && (
                <div className="flex items-center justify-between mt-4">
                  <p className="text-xs text-gray-400">
                    {(subPage - 1) * PAGE_SIZE + 1}〜{Math.min(subPage * PAGE_SIZE, submissions.length)} 件 / 全{submissions.length}件
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setSubPage(p => Math.max(1, p - 1))}
                      disabled={subPage === 1}
                      className="px-3 py-1.5 text-sm rounded-lg border border-gray-200 disabled:opacity-30 hover:bg-gray-50"
                    >前へ</button>
                    <span className="px-3 py-1.5 text-sm text-gray-500">{subPage} / {totalPages}</span>
                    <button
                      onClick={() => setSubPage(p => Math.min(totalPages, p + 1))}
                      disabled={subPage === totalPages}
                      className="px-3 py-1.5 text-sm rounded-lg border border-gray-200 disabled:opacity-30 hover:bg-gray-50"
                    >次へ</button>
                  </div>
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  )
}
