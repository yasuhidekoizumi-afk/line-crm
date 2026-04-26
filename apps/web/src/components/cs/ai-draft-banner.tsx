'use client'

import { useEffect, useState } from 'react'
import { fetchApi } from '@/lib/api'

interface AiDraftMetadata {
  category?: string
  confidence?: number
  matched_faq_id?: string | null
  money_flag?: boolean
  reasoning?: string
}

interface AiDraft {
  id: string
  draftText: string
  metadata: AiDraftMetadata | null
  createdAt: string
}

interface Props {
  chatId: string
  /** 承認・却下後の親側リフレッシュ用 */
  onChange?: () => void
}

export function AiDraftBanner({ chatId, onChange }: Props) {
  const [draft, setDraft] = useState<AiDraft | null>(null)
  const [editing, setEditing] = useState(false)
  const [editedText, setEditedText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await fetchApi<{ success: boolean; data: AiDraft | null }>(
          `/api/cs/chats/${chatId}/draft`,
        )
        if (cancelled) return
        const data = res?.data ?? null
        setDraft(data)
        setEditedText(data?.draftText ?? '')
      } catch {
        if (!cancelled) setDraft(null)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [chatId])

  if (!draft) return null

  const meta = draft.metadata
  const moneyTag = meta?.money_flag ? '💰金銭' : null
  const confidencePct = typeof meta?.confidence === 'number' ? Math.round(meta.confidence * 100) : null

  async function handleApprove() {
    setBusy(true)
    setError(null)
    try {
      const finalText = editing ? editedText : (draft as AiDraft).draftText
      const res = await fetchApi<{ success: boolean; error?: string }>(
        `/api/cs/drafts/${(draft as AiDraft).id}/approve`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            finalText,
            approvedBy: 'web-ui',
          }),
        },
      )
      if (!res?.success) throw new Error(res?.error ?? 'unknown')
      setDraft(null)
      onChange?.()
    } catch (e) {
      setError(`送信失敗: ${String(e)}`)
    } finally {
      setBusy(false)
    }
  }

  async function handleReject() {
    const reason = window.prompt('却下理由（任意）', '')
    if (reason === null) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetchApi<{ success: boolean; error?: string }>(
        `/api/cs/drafts/${(draft as AiDraft).id}/reject`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            reason: reason || '理由なし',
            rejectedBy: 'web-ui',
          }),
        },
      )
      if (!res?.success) throw new Error(res?.error ?? 'unknown')
      setDraft(null)
      onChange?.()
    } catch (e) {
      setError(`却下失敗: ${String(e)}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-4 my-3 rounded-lg border-2 border-purple-300 bg-purple-50 overflow-hidden">
      <div className="px-4 py-2 bg-purple-100 border-b border-purple-200 flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-bold text-purple-900">🤖 AI下書き 承認待ち</span>
          {meta?.category && (
            <span className="px-2 py-0.5 text-xs bg-purple-200 text-purple-900 rounded-full">
              {meta.category}
            </span>
          )}
          {confidencePct !== null && (
            <span className="px-2 py-0.5 text-xs bg-white text-purple-700 rounded-full border border-purple-300">
              信頼度 {confidencePct}%
            </span>
          )}
          {moneyTag && (
            <span className="px-2 py-0.5 text-xs bg-yellow-100 text-yellow-800 rounded-full border border-yellow-300">
              {moneyTag}
            </span>
          )}
        </div>
        <span className="text-xs text-purple-700">
          {new Date(draft.createdAt).toLocaleString('ja-JP', {
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
          })}
        </span>
      </div>

      <div className="p-4">
        {editing ? (
          <textarea
            value={editedText}
            onChange={(e) => setEditedText(e.target.value)}
            rows={Math.min(20, Math.max(6, editedText.split('\n').length + 1))}
            className="w-full text-sm border border-purple-300 rounded-md p-2 bg-white focus:outline-none focus:ring-2 focus:ring-purple-500 font-mono"
          />
        ) : (
          <pre className="text-sm text-gray-800 whitespace-pre-wrap font-sans">
            {draft.draftText}
          </pre>
        )}

        {meta?.reasoning && (
          <p className="mt-2 text-xs text-purple-700 italic">
            判定理由: {meta.reasoning}
          </p>
        )}

        {error && (
          <p className="mt-2 text-xs text-red-600">{error}</p>
        )}

        <div className="mt-3 flex flex-wrap gap-2">
          {!editing ? (
            <>
              <button
                onClick={handleApprove}
                disabled={busy}
                className="px-3 py-1.5 text-sm font-medium text-white bg-purple-600 hover:bg-purple-700 rounded-md disabled:opacity-50"
              >
                {busy ? '送信中...' : '✅ そのまま承認 → 送信'}
              </button>
              <button
                onClick={() => setEditing(true)}
                disabled={busy}
                className="px-3 py-1.5 text-sm font-medium text-purple-700 bg-white border border-purple-300 hover:bg-purple-50 rounded-md disabled:opacity-50"
              >
                ✏️ 編集
              </button>
              <button
                onClick={handleReject}
                disabled={busy}
                className="px-3 py-1.5 text-sm font-medium text-red-700 bg-white border border-red-300 hover:bg-red-50 rounded-md disabled:opacity-50"
              >
                ❌ 却下（自分で書く）
              </button>
            </>
          ) : (
            <>
              <button
                onClick={handleApprove}
                disabled={busy}
                className="px-3 py-1.5 text-sm font-medium text-white bg-purple-600 hover:bg-purple-700 rounded-md disabled:opacity-50"
              >
                {busy ? '送信中...' : '✅ 編集した内容で送信'}
              </button>
              <button
                onClick={() => {
                  setEditing(false)
                  setEditedText(draft.draftText)
                }}
                disabled={busy}
                className="px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 hover:bg-gray-50 rounded-md disabled:opacity-50"
              >
                編集キャンセル
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
