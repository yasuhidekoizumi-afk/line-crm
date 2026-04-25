'use client'

import { useState, useEffect, useCallback, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import dynamic from 'next/dynamic'
import { fermentApi, type EmailTemplate } from '@/lib/ferment-api'

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
