'use client'

import { useState, useEffect, useCallback, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { fermentApi, type EmailCampaign, type EmailTemplate, type Segment } from '@/lib/ferment-api'

interface CampaignDraft {
  name?: string
  template_id?: string | null
  segment_id?: string | null
  template_auto_created?: boolean
}

interface AiAction {
  title: string
  segment_name?: string
  template_hint?: string
  expected_impact?: string
  reasoning?: string
  execute_url?: string
}

function decodeBase64Json<T>(token: string | null): T | null {
  if (!token) return null
  try {
    // URL-safe base64 を標準 base64 に戻す
    let b64 = token.replace(/-/g, '+').replace(/_/g, '/')
    while (b64.length % 4) b64 += '='
    const json = decodeURIComponent(escape(atob(b64)))
    return JSON.parse(json) as T
  } catch {
    return null
  }
}

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

function EmailCampaignsPageInner() {
  const searchParams = useSearchParams()
  const draftToken = searchParams.get('draft')
  const aiActionToken = searchParams.get('ai_action')
  const aiAction = decodeBase64Json<AiAction>(aiActionToken)
  const passedDraft = decodeBase64Json<CampaignDraft>(draftToken)
  const [campaigns, setCampaigns] = useState<EmailCampaign[]>([])
  const [templates, setTemplates] = useState<EmailTemplate[]>([])
  const [segments, setSegments] = useState<Segment[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showCreate, setShowCreate] = useState(!!passedDraft || !!aiAction)
  // 即座にスケルトンプレフィル（タイトルだけでも）
  const [form, setForm] = useState({
    name: passedDraft?.name ?? aiAction?.title ?? '',
    template_id: passedDraft?.template_id ?? '',
    segment_id: passedDraft?.segment_id ?? '',
  })
  const [creating, setCreating] = useState(false)
  const [sendingId, setSendingId] = useState<string | null>(null)
  const [aiDrafting, setAiDrafting] = useState(false)
  const [aiDraftError, setAiDraftError] = useState<string | null>(null)
  const [aiDraftElapsed, setAiDraftElapsed] = useState(0)
  const [aiDraftDone, setAiDraftDone] = useState(!!passedDraft)
  const [templateAutoCreated, setTemplateAutoCreated] = useState(false)
  // テンプレ プレビュー モーダル用 state
  const [previewing, setPreviewing] = useState(false)
  const [previewData, setPreviewData] = useState<{
    subject: string
    html: string
    campaignName: string
    templateId: string
  } | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  // AI 編集 用 state
  const [aiInstruction, setAiInstruction] = useState('')
  const [aiEditing, setAiEditing] = useState(false)
  const [aiEditResult, setAiEditResult] = useState<{
    subject: string
    body_html: string
    body_text: string
    diff_summary: string
  } | null>(null)
  const [aiEditError, setAiEditError] = useState<string | null>(null)
  const [aiSaving, setAiSaving] = useState(false)

  const handlePreviewCampaign = async (c: EmailCampaign) => {
    if (!c.template_id) {
      setPreviewError('このキャンペーンにはテンプレートが設定されていません')
      return
    }
    setPreviewing(true)
    setPreviewError(null)
    setAiEditResult(null)
    setAiEditError(null)
    setAiInstruction('')
    try {
      const r = await fermentApi.templates.preview(c.template_id)
      if (r.success && r.data) {
        setPreviewData({
          subject: r.data.subject,
          html: r.data.html,
          campaignName: c.name,
          templateId: c.template_id,
        })
      } else {
        setPreviewError(r.error ?? 'プレビュー生成に失敗しました')
      }
    } catch (e) {
      setPreviewError(e instanceof Error ? e.message : String(e))
    } finally {
      setPreviewing(false)
    }
  }

  // AI 編集: 自然言語の指示でテンプレを書き換え（保存はせずプレビューだけ更新）
  const handleAiEdit = async () => {
    if (!previewData || !aiInstruction.trim()) return
    setAiEditing(true)
    setAiEditError(null)
    try {
      const r = await fermentApi.templates.aiEdit(previewData.templateId, aiInstruction.trim())
      if (r.success && r.data) {
        setAiEditResult(r.data)
        // プレビューも更新（簡易: HTML を直接差し替え。プレースホルダ未解決だが大筋確認用）
        setPreviewData({ ...previewData, subject: r.data.subject, html: r.data.body_html })
      } else {
        setAiEditError(r.error ?? 'AI 編集に失敗しました')
      }
    } catch (e) {
      setAiEditError(e instanceof Error ? e.message : String(e))
    } finally {
      setAiEditing(false)
    }
  }

  // AI 編集結果を実際に保存
  const handleAiSave = async () => {
    if (!previewData || !aiEditResult) return
    setAiSaving(true)
    try {
      const r = await fermentApi.templates.update(previewData.templateId, {
        subject_base: aiEditResult.subject,
        body_html: aiEditResult.body_html,
        body_text: aiEditResult.body_text,
      })
      if (r.success) {
        // 保存後、プレビューを再取得して最新の placeholder 解決済み HTML を表示
        const p = await fermentApi.templates.preview(previewData.templateId)
        if (p.success && p.data) {
          setPreviewData({ ...previewData, subject: p.data.subject, html: p.data.html })
        }
        setAiEditResult(null)
        setAiInstruction('')
      } else {
        setAiEditError(r.error ?? '保存に失敗しました')
      }
    } catch (e) {
      setAiEditError(e instanceof Error ? e.message : String(e))
    } finally {
      setAiSaving(false)
    }
  }

  const handleAiRevert = async () => {
    if (!previewData) return
    setAiEditResult(null)
    setAiInstruction('')
    setAiEditError(null)
    // プレビュー再取得
    const p = await fermentApi.templates.preview(previewData.templateId)
    if (p.success && p.data) {
      setPreviewData({ ...previewData, subject: p.data.subject, html: p.data.html })
    }
  }

  // ai_action パラメータ付きで来た時、AI ドラフトを取りに行く
  useEffect(() => {
    if (!aiAction || aiDraftDone) return
    let cancelled = false
    const startedAt = Date.now()
    const timer = setInterval(() => {
      if (!cancelled) setAiDraftElapsed(Math.floor((Date.now() - startedAt) / 1000))
    }, 1000)
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 30000)
    setAiDrafting(true)
    setAiDraftError(null)
    setAiDraftElapsed(0)
    const apiKey = typeof window !== 'undefined' ? localStorage.getItem('lh_api_key') ?? '' : ''
    const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? ''
    const fullUrl = `${apiUrl}/api/ferment/cockpit/draft-from-action`
    console.log('[email/campaigns] ai_action draft request:', { url: fullUrl, action: aiAction })
    ;(async () => {
      try {
        const res = await fetch(fullUrl, {
          method: 'POST',
          signal: controller.signal,
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
          },
          body: JSON.stringify({ action: { ...aiAction, execute_url: '/email/campaigns' } }),
        })
        const elapsed = Math.floor((Date.now() - startedAt) / 1000)
        const text = await res.text()
        console.log('[email/campaigns] ai_action draft response:', { status: res.status, elapsed, body: text.slice(0, 200) })
        let json: { success: boolean; data?: { draft: CampaignDraft }; error?: string } | null = null
        try { json = JSON.parse(text) } catch { json = null }
        if (cancelled) return
        if (res.ok && json?.success && json.data?.draft) {
          const d = json.data.draft
          setForm({
            name: d.name ?? aiAction.title,
            template_id: d.template_id ?? '',
            segment_id: d.segment_id ?? '',
          })
          setTemplateAutoCreated(!!d.template_auto_created)
          setAiDraftDone(true)
          setAiDrafting(false)
          // 新規テンプレが作成された場合は templates を再取得して select に反映
          if (d.template_auto_created) {
            fermentApi.templates.list().then((r) => {
              if (r.success && r.data) setTemplates(r.data)
            }).catch(() => {/* noop */})
          }
        } else {
          setAiDraftError(
            json?.error
              ?? (res.status === 401 ? 'ログインセッション切れ。再ログインしてください。' : `HTTP ${res.status}`),
          )
          setAiDrafting(false)
        }
      } catch (e) {
        if (cancelled) return
        const errName = e instanceof Error ? e.name : ''
        console.error('[email/campaigns] ai_action draft error:', e)
        setAiDraftError(
          errName === 'AbortError'
            ? '30 秒以内に応答がありませんでした。'
            : `AI ドラフト生成に失敗しました: ${e instanceof Error ? e.message : String(e)}`,
        )
        setAiDrafting(false)
      }
    })()
    return () => {
      cancelled = true
      clearInterval(timer)
      clearTimeout(timeoutId)
      controller.abort()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aiActionToken])

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
          {aiDrafting && (
            <div className="mb-3 p-4 bg-purple-50 border border-purple-200 rounded-lg text-sm text-purple-800 flex items-center gap-3">
              <div className="animate-spin h-4 w-4 border-2 border-purple-600 border-t-transparent rounded-full" />
              <div>
                ✨ AI がキャンペーンドラフトを生成しています...
                {aiDraftElapsed > 0 && <span className="ml-2 text-purple-600">{aiDraftElapsed}秒</span>}
              </div>
            </div>
          )}
          {aiDraftError && (
            <div className="mb-3 p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">
              ⚠️ {aiDraftError}<br />
              <span className="text-gray-600">下のフォームで手動作成できます。</span>
            </div>
          )}
          {aiDraftDone && !aiDrafting && (
            <div className="mb-3 p-3 bg-purple-50 border border-purple-200 rounded-lg text-xs text-purple-800">
              ✨ AI コックピットの提案からドラフトを生成しました。
              {templateAutoCreated && (
                <span className="block mt-1 text-purple-700">
                  📝 既存テンプレに合致するものが無かったため、AI が新規テンプレ「AI 提案: {form.name}」を自動作成・選択しました。配信前に「テンプレート」メニューから内容をご確認ください。
                </span>
              )}
            </div>
          )}
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
                      <div className="flex gap-1 justify-end items-center">
                        {c.template_id && (
                          <button
                            onClick={() => handlePreviewCampaign(c)}
                            disabled={previewing}
                            className="px-2 py-1 text-xs bg-blue-50 text-blue-700 rounded hover:bg-blue-100 disabled:opacity-50"
                          >
                            👁 プレビュー
                          </button>
                        )}
                        {c.template_id && ['draft', 'scheduled'].includes(c.status) && (
                          <Link
                            href={`/email/templates/edit?id=${c.template_id}`}
                            prefetch={false}
                            className="px-2 py-1 text-xs bg-purple-50 text-purple-700 rounded hover:bg-purple-100"
                          >
                            ✏️ 編集
                          </Link>
                        )}
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

      {/* プレビュー モーダル */}
      {previewError && (
        <div className="fixed top-4 right-4 z-50 max-w-sm p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700 shadow-lg">
          ⚠️ {previewError}
          <button onClick={() => setPreviewError(null)} className="ml-2 text-red-400 hover:text-red-600">✕</button>
        </div>
      )}
      {previewData && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setPreviewData(null)}
        >
          <div
            className="bg-white rounded-xl max-w-4xl w-full max-h-[92vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-start px-5 py-3 border-b">
              <div className="min-w-0 flex-1">
                <p className="text-xs text-gray-500">キャンペーン: {previewData.campaignName}</p>
                <h3 className="font-semibold text-gray-900 truncate">件名: {previewData.subject || '(件名なし)'}</h3>
              </div>
              <button
                onClick={() => setPreviewData(null)}
                className="text-gray-400 hover:text-gray-600 px-2 shrink-0"
                aria-label="閉じる"
              >
                ✕
              </button>
            </div>

            {/* AI 編集パネル */}
            <div className="px-5 py-3 border-b bg-purple-50">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-sm font-semibold text-purple-800">✨ AI に修正を依頼</span>
                <span className="text-xs text-purple-600">自然言語で「もう少しカジュアルに」「絵文字を増やして」など</span>
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={aiInstruction}
                  onChange={(e) => setAiInstruction(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && aiInstruction.trim() && !aiEditing) handleAiEdit() }}
                  placeholder="例: もう少しカジュアルな文体にして、CTA ボタンを目立たせて"
                  disabled={aiEditing || aiSaving}
                  className="flex-1 border border-purple-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400 disabled:bg-gray-100"
                />
                <button
                  onClick={handleAiEdit}
                  disabled={aiEditing || aiSaving || !aiInstruction.trim()}
                  className="px-4 py-2 text-sm bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 whitespace-nowrap"
                >
                  {aiEditing ? '✨ 書き換え中...' : '✨ AI で書き換え'}
                </button>
              </div>
              {aiEditError && (
                <div className="mt-2 p-2 bg-red-50 border border-red-200 rounded text-xs text-red-700">
                  ⚠️ {aiEditError}
                </div>
              )}
              {aiEditResult && (
                <div className="mt-3 p-3 bg-white border border-purple-200 rounded-lg">
                  <p className="text-xs text-purple-700 mb-2">
                    ✏️ {aiEditResult.diff_summary || '本文を更新しました'}
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={handleAiSave}
                      disabled={aiSaving}
                      className="px-3 py-1.5 text-xs bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
                    >
                      {aiSaving ? '保存中...' : '✓ この内容で保存'}
                    </button>
                    <button
                      onClick={handleAiRevert}
                      disabled={aiSaving}
                      className="px-3 py-1.5 text-xs bg-white border border-gray-300 text-gray-700 rounded hover:bg-gray-50 disabled:opacity-50"
                    >
                      ↩️ 元に戻す
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div className="flex-1 overflow-auto p-4 bg-gray-50">
              <iframe
                srcDoc={previewData.html}
                className="w-full bg-white border rounded-lg"
                style={{ minHeight: '500px', height: '60vh' }}
                sandbox="allow-same-origin"
                title="メールプレビュー"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default function EmailCampaignsPage() {
  return (
    <Suspense fallback={<div className="p-8 text-gray-400 text-sm">読み込み中...</div>}>
      <EmailCampaignsPageInner />
    </Suspense>
  )
}
