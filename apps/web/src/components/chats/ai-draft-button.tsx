'use client'

import { useState } from 'react'
import { fetchApi } from '@/lib/api'

interface AiDraftButtonProps {
  chatId: string
  onSelect: (text: string) => void
  messages?: { direction: string; content: string }[]
}

export default function AiDraftButton({ chatId, messages, onSelect }: AiDraftButtonProps) {
  const [loading, setLoading] = useState(false)
  const [draft, setDraft] = useState<string | null>(null)
  const [error, setError] = useState('')

  const handleGenerate = async () => {
    if (loading) return
    setLoading(true)
    setError('')
    setDraft(null)
    try {
      const res = await fetchApi<{ success: boolean; data?: { draft: string }; error?: string }>(
        '/api/ai-draft/generate',
        {
          method: 'POST',
          body: JSON.stringify({
            chatId,
            chatHistory: (messages ?? []).map((m) => ({
              direction: m.direction,
              content: m.content.slice(0, 300),
            })),
          }),
        }
      )
      if (res.success && res.data) {
        setDraft(res.data.draft)
      } else {
        setError(res.error ?? '生成に失敗しました（不明なエラー）')
      }
    } catch (err: any) {
      setError(err?.message ?? '通信エラーが発生しました')
    }
    setLoading(false)
  }

  return (
    <div className="mb-2">
      {!draft && !loading && (
        <button
          onClick={handleGenerate}
          className="text-xs text-purple-600 hover:text-purple-800 flex items-center gap-1"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
          AI下書きを生成
        </button>
      )}

      {loading && (
        <div className="flex items-center gap-2 text-xs text-purple-600">
          <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          AIが下書きを生成中...
        </div>
      )}

      {error && (
        <div className="text-xs text-red-500 bg-red-50 border border-red-100 rounded p-2 mb-1">
          {error}
        </div>
      )}

      {draft && !loading && (
        <div className="border border-purple-200 bg-purple-50 rounded-lg p-3">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs font-semibold text-purple-700">🤖 AI下書き</span>
            <div className="flex gap-1.5">
              <button
                onClick={() => { onSelect(draft); setDraft(null) }}
                className="text-xs px-2 py-0.5 bg-purple-600 text-white rounded hover:bg-purple-700"
              >
                この下書きを使う
              </button>
              <button
                onClick={() => setDraft(null)}
                className="text-xs px-2 py-0.5 text-gray-500 hover:text-gray-700 border border-gray-200 rounded"
              >
                キャンセル
              </button>
            </div>
          </div>
          <p className="text-sm text-gray-800 whitespace-pre-wrap">{draft}</p>
        </div>
      )}
    </div>
  )
}
