'use client'

import { useState, useEffect, useCallback, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import dynamic from 'next/dynamic'
import { fermentApi, type EmailTemplate } from '@/lib/ferment-api'
import { fetchApi } from '@/lib/api'

interface ApiResult<T> { success: boolean; data?: T; error?: string }

const MailEditor = dynamic(() => import('@/components/email/MailEditor'), { ssr: false })

function EditPageInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const id = searchParams.get('id') ?? ''

  const [template, setTemplate] = useState<EmailTemplate | null>(null)
  const [html, setHtml] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [savedAt, setSavedAt] = useState<Date | null>(null)
  const [aiSubjects, setAiSubjects] = useState<string[]>([])
  const [aiLoading, setAiLoading] = useState(false)
  const [spam, setSpam] = useState<{ score: number; warnings: string[]; suggestions: string[] } | null>(null)
  const [spamLoading, setSpamLoading] = useState(false)
  // AI 自然言語編集
  const [aiInstruction, setAiInstruction] = useState('')
  const [aiEditing, setAiEditing] = useState(false)
  const [aiEditDiff, setAiEditDiff] = useState<string | null>(null)
  // AI 画像生成
  const [imgPrompt, setImgPrompt] = useState('')
  const [imgGenerating, setImgGenerating] = useState(false)
  const [imgResult, setImgResult] = useState<{ url: string; cost: number } | null>(null)
  const [imgError, setImgError] = useState<string | null>(null)
  const [imgQuality, setImgQuality] = useState<'low' | 'medium' | 'high'>('medium')
  const [imgSize, setImgSize] = useState<'1024x1024' | '1024x1536' | '1536x1024'>('1024x1024')

  useEffect(() => {
    if (!id) {
      setError('テンプレートIDが指定されていません')
      setLoading(false)
      return
    }
    fermentApi.templates.get(id).then((res) => {
      if (res.success && res.data) {
        setTemplate(res.data)
        setHtml(res.data.body_html ?? '')
      } else {
        setError(res.error ?? 'テンプレートの取得に失敗しました')
      }
      setLoading(false)
    })
  }, [id])

  const handleSave = useCallback(
    async (latestHtml: string) => {
      if (!template) return
      setSaving(true)
      setError('')
      try {
        const res = await fermentApi.templates.update(id, { body_html: latestHtml })
        if (res.success) {
          setSavedAt(new Date())
        } else {
          setError(res.error ?? '保存に失敗しました')
        }
      } catch {
        setError('保存に失敗しました')
      } finally {
        setSaving(false)
      }
    },
    [id, template],
  )

  if (loading) {
    return <div className="p-8 text-center text-gray-400">読み込み中...</div>
  }

  if (!template) {
    return (
      <div className="p-8 text-center">
        <p className="text-red-500">{error || 'テンプレートが見つかりません'}</p>
        <button
          onClick={() => router.push('/email/templates')}
          className="mt-4 text-sm text-green-600 hover:underline"
        >
          ← 一覧に戻る
        </button>
      </div>
    )
  }

  return (
    <div className="max-w-7xl mx-auto py-6 px-4">
      <div className="flex items-center justify-between mb-4">
        <div>
          <button
            onClick={() => router.push('/email/templates')}
            className="text-sm text-gray-500 hover:text-gray-700"
          >
            ← 一覧に戻る
          </button>
          <h1 className="text-xl font-bold text-gray-900 mt-1">
            {template.name}{' '}
            <span className="text-sm text-gray-400 ml-2">ドラッグ&ドロップで編集</span>
          </h1>
        </div>
        <div className="flex items-center gap-3">
          {savedAt && (
            <span className="text-xs text-gray-400">
              保存済み {savedAt.toLocaleTimeString('ja-JP')}
            </span>
          )}
          <button
            onClick={() => handleSave(html)}
            disabled={saving}
            className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium disabled:opacity-50"
          >
            {saving ? '保存中...' : '保存する'}
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-3 p-3 bg-red-50 text-red-600 rounded-lg text-sm">{error}</div>
      )}

      {/* AI ヘルパー + スパムチェック */}
      <div className="mb-4 p-4 bg-gradient-to-r from-purple-50 to-blue-50 border border-purple-100 rounded-xl">
        <div className="flex items-center gap-3 flex-wrap">
          <button
            onClick={async () => {
              if (!template.subject_base) return
              setAiLoading(true)
              try {
                const res = await fetchApi<ApiResult<{ variants: string[] }>>('/api/ferment/ai/subject-suggestions', {
                  method: 'POST',
                  body: JSON.stringify({ base_subject: template.subject_base, body_preview: html.slice(0, 200), count: 5 }),
                })
                if (res.success && res.data) setAiSubjects(res.data.variants)
                else setError(res.error ?? 'AI生成失敗')
              } finally {
                setAiLoading(false)
              }
            }}
            disabled={aiLoading || !template.subject_base}
            className="px-3 py-1.5 text-xs bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50"
          >
            {aiLoading ? 'AI生成中...' : '✨ AI 件名提案 (Gemini)'}
          </button>
          <button
            onClick={async () => {
              setSpamLoading(true)
              try {
                const res = await fetchApi<ApiResult<{ score: number; warnings: string[]; suggestions: string[] }>>('/api/ferment/ai/spam-check', {
                  method: 'POST',
                  body: JSON.stringify({ subject: template.subject_base ?? '', html }),
                })
                if (res.success && res.data) setSpam(res.data)
              } finally {
                setSpamLoading(false)
              }
            }}
            disabled={spamLoading}
            className="px-3 py-1.5 text-xs bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {spamLoading ? 'チェック中...' : '🛡️ スパムチェック'}
          </button>
        </div>

        {/* AI 自然言語編集 */}
        <div className="mt-3 pt-3 border-t border-purple-100">
          <p className="text-xs font-semibold text-purple-800 mb-1">✨ AI に修正を依頼（自然言語）</p>
          <p className="text-xs text-purple-600 mb-2">「もう少しカジュアルに」「絵文字を増やして」「冒頭に感謝の挨拶を入れて」など、思いついた指示を投げてください</p>
          <div className="flex gap-2">
            <input
              type="text"
              value={aiInstruction}
              onChange={(e) => setAiInstruction(e.target.value)}
              placeholder="例: もう少しカジュアルな文体にして、CTA を目立たせて"
              disabled={aiEditing}
              className="flex-1 border border-purple-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400 disabled:bg-gray-100"
            />
            <button
              onClick={async () => {
                if (!template || !aiInstruction.trim()) return
                setAiEditing(true)
                setAiEditDiff(null)
                setError('')
                try {
                  const r = await fermentApi.templates.aiEdit(template.template_id, aiInstruction.trim())
                  if (r.success && r.data) {
                    setHtml(r.data.body_html)
                    setTemplate({
                      ...template,
                      subject_base: r.data.subject,
                      body_html: r.data.body_html,
                      body_text: r.data.body_text,
                    })
                    setAiEditDiff(r.data.diff_summary || '更新しました')
                    // 即時に保存（ユーザーは「保存する」を再度押す必要なし）
                    await fermentApi.templates.update(template.template_id, {
                      subject_base: r.data.subject,
                      body_html: r.data.body_html,
                      body_text: r.data.body_text,
                    })
                    setSavedAt(new Date())
                    setAiInstruction('')
                  } else {
                    setError(r.error ?? 'AI 編集に失敗しました')
                  }
                } catch (e) {
                  setError(e instanceof Error ? e.message : String(e))
                } finally {
                  setAiEditing(false)
                }
              }}
              disabled={aiEditing || !aiInstruction.trim()}
              className="px-4 py-2 text-sm bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 whitespace-nowrap"
            >
              {aiEditing ? '✨ 書き換え中...' : '✨ AI で書き換える'}
            </button>
          </div>
          {aiEditDiff && (
            <div className="mt-2 p-2 bg-white border border-purple-200 rounded text-xs text-purple-700">
              ✏️ {aiEditDiff}（保存済み）
            </div>
          )}
        </div>

        {/* AI 画像生成 */}
        <div className="mt-3 pt-3 border-t border-purple-100">
          <p className="text-xs font-semibold text-pink-800 mb-1">🎨 AI で画像を生成（GPT-Image-2）</p>
          <p className="text-xs text-pink-600 mb-2">「春の食卓に並ぶ KOJIPOP」「米麹のテクスチャ背景」など、シーンを指示すると画像が生成されてエディタに挿入されます</p>
          <div className="flex gap-2 items-start flex-wrap">
            <input
              type="text"
              value={imgPrompt}
              onChange={(e) => setImgPrompt(e.target.value)}
              placeholder="例: 木のテーブルに置かれた KOJIPOP、朝の自然光、爽やかな雰囲気"
              disabled={imgGenerating}
              className="flex-1 min-w-[200px] border border-pink-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-pink-400 disabled:bg-gray-100"
            />
            <select
              value={imgSize}
              onChange={(e) => setImgSize(e.target.value as typeof imgSize)}
              disabled={imgGenerating}
              className="border border-pink-300 rounded-lg px-2 py-2 text-sm bg-white"
              title="画像サイズ"
            >
              <option value="1024x1024">正方形</option>
              <option value="1536x1024">横長</option>
              <option value="1024x1536">縦長</option>
            </select>
            <select
              value={imgQuality}
              onChange={(e) => setImgQuality(e.target.value as typeof imgQuality)}
              disabled={imgGenerating}
              className="border border-pink-300 rounded-lg px-2 py-2 text-sm bg-white"
              title="品質（コストと速度に影響）"
            >
              <option value="low">低品質 ($0.011)</option>
              <option value="medium">標準 ($0.04)</option>
              <option value="high">高品質 ($0.17)</option>
            </select>
            <button
              onClick={async () => {
                if (!imgPrompt.trim()) return
                setImgGenerating(true)
                setImgError(null)
                setImgResult(null)
                try {
                  const r = await fermentApi.cockpit.generateImage({
                    prompt: imgPrompt.trim(),
                    size: imgSize,
                    quality: imgQuality,
                  })
                  if (r.success && r.data) {
                    setImgResult({ url: r.data.url, cost: r.data.cost_usd })
                    // 既存 HTML の最後に <img> を追加
                    const newImgTag = `<p style="text-align:center;margin:24px 0;"><img src="${r.data.url}" alt="" style="max-width:100%;height:auto;border-radius:8px;" /></p>`
                    setHtml((prev) => prev + newImgTag)
                    // テンプレも即時保存
                    if (template) {
                      await fermentApi.templates.update(template.template_id, {
                        body_html: html + newImgTag,
                      })
                      setSavedAt(new Date())
                    }
                    setImgPrompt('')
                  } else {
                    setImgError(r.error ?? '画像生成に失敗しました')
                  }
                } catch (e) {
                  setImgError(e instanceof Error ? e.message : String(e))
                } finally {
                  setImgGenerating(false)
                }
              }}
              disabled={imgGenerating || !imgPrompt.trim()}
              className="px-4 py-2 text-sm bg-pink-600 text-white rounded-lg hover:bg-pink-700 disabled:opacity-50 whitespace-nowrap"
            >
              {imgGenerating ? '🎨 生成中（10〜15秒）...' : '🎨 画像生成'}
            </button>
          </div>
          {imgError && (
            <div className="mt-2 p-2 bg-red-50 border border-red-200 rounded text-xs text-red-700">
              ⚠️ {imgError}
            </div>
          )}
          {imgResult && (
            <div className="mt-2 p-2 bg-white border border-pink-200 rounded">
              <div className="flex items-center gap-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={imgResult.url} alt="生成画像" className="w-24 h-24 object-cover rounded border" />
                <div className="text-xs text-pink-700">
                  ✅ 画像を生成してエディタの末尾に挿入しました（コスト: ${imgResult.cost.toFixed(3)}）<br />
                  位置はビジュアルエディタでドラッグ調整できます。
                </div>
              </div>
            </div>
          )}
        </div>
        {aiSubjects.length > 0 && (
          <div className="mt-3 space-y-1">
            <p className="text-xs font-semibold text-purple-700">提案された件名（クリックでクリップボードコピー）：</p>
            {aiSubjects.map((s, i) => (
              <button
                key={i}
                onClick={() => { navigator.clipboard.writeText(s); alert('コピーしました: ' + s) }}
                className="block w-full text-left text-sm bg-white border border-purple-200 rounded-lg px-3 py-2 hover:bg-purple-50"
              >
                {s}
              </button>
            ))}
          </div>
        )}
        {spam && (
          <div className="mt-3 p-3 bg-white border border-blue-200 rounded-lg">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-semibold">スパムスコア: {spam.score}/100</span>
              <span className={`text-xs px-2 py-0.5 rounded font-medium ${
                spam.score < 30 ? 'bg-green-100 text-green-700' :
                spam.score < 50 ? 'bg-yellow-100 text-yellow-700' :
                'bg-red-100 text-red-700'
              }`}>
                {spam.score < 30 ? '👍 良好' : spam.score < 50 ? '⚠️ 注意' : '🚨 危険'}
              </span>
            </div>
            {spam.warnings.length > 0 && (
              <ul className="text-xs text-red-700 list-disc list-inside space-y-0.5">
                {spam.warnings.map((w, i) => <li key={i}>{w}</li>)}
              </ul>
            )}
            {spam.suggestions.length > 0 && (
              <ul className="text-xs text-blue-700 list-disc list-inside space-y-0.5 mt-2">
                {spam.suggestions.map((s, i) => <li key={i}>💡 {s}</li>)}
              </ul>
            )}
          </div>
        )}
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <MailEditor initialHtml={html} onChange={setHtml} onSave={handleSave} />
      </div>

      <div className="mt-4 p-3 bg-blue-50 text-xs text-blue-800 rounded-lg">
        <p className="font-semibold mb-1">使えるプレースホルダー：</p>
        <code className="bg-white px-2 py-1 rounded">{'{{name}}'}</code>{' '}
        <code className="bg-white px-2 py-1 rounded">{'{{first_name}}'}</code>{' '}
        <code className="bg-white px-2 py-1 rounded">{'{{ltv_yen}}'}</code>{' '}
        <code className="bg-white px-2 py-1 rounded">{'{{unsubscribe_url}}'}</code>
        <p className="mt-2 font-semibold">条件分岐：</p>
        <code className="bg-white px-2 py-1 rounded">
          {'{{#if has_purchased}}購入実績ありの方限定{{/if}}'}
        </code>
      </div>
    </div>
  )
}

export default function EmailTemplateEditPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-gray-400">読み込み中...</div>}>
      <EditPageInner />
    </Suspense>
  )
}
