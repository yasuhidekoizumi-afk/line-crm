'use client'

import { useState, useEffect, useCallback, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import type { Tag } from '@line-crm/shared'
import { api, type ApiBroadcast } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import Header from '@/components/layout/header'
import BroadcastForm from '@/components/broadcasts/broadcast-form'
import CcPromptButton from '@/components/cc-prompt-button'

interface BroadcastDraft {
  title?: string
  messageType?: ApiBroadcast['messageType']
  messageContent?: string
  targetType?: ApiBroadcast['targetType']
  targetTagId?: string
  scheduledAt?: string
  sendNow?: boolean
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
    const json = decodeURIComponent(escape(atob(token)))
    return JSON.parse(json) as T
  } catch {
    return null
  }
}

const ccPrompts = [
  {
    title: '配信メッセージを作成',
    prompt: `一斉配信用のメッセージを作成してください。
1. 配信目的: [目的を指定]
2. ターゲット: 全員 / タグ指定
3. メッセージタイプ: テキスト / 画像 / Flex
効果的なメッセージ文面を提案してください。`,
  },
  {
    title: '配信スケジュール最適化',
    prompt: `配信スケジュールを最適化してください。
1. 過去の配信実績から最適な時間帯を分析
2. 曜日別の開封率を確認
3. 推奨スケジュールを提案
データに基づいた根拠も示してください。`,
  },
]

const statusConfig: Record<
  ApiBroadcast['status'],
  { label: string; className: string }
> = {
  draft: { label: '下書き', className: 'bg-gray-100 text-gray-600' },
  scheduled: { label: '予約済み', className: 'bg-blue-100 text-blue-700' },
  sending: { label: '送信中', className: 'bg-yellow-100 text-yellow-700' },
  sent: { label: '送信完了', className: 'bg-green-100 text-green-700' },
}

function formatDatetime(iso: string | null): string {
  if (!iso) return '-'
  return new Date(iso).toLocaleString('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

// ai_action から即座に組み立てる「最低限のスケルトンドラフト」
// Gemini が遅い・失敗してもこれが既に入っていればユーザーは作業継続できる。
function skeletonDraftFromAction(action: AiAction): BroadcastDraft {
  const lines: string[] = [action.title]
  if (action.template_hint) lines.push('', action.template_hint)
  if (action.reasoning) lines.push('', action.reasoning)
  return {
    title: action.title,
    messageType: 'text',
    messageContent: lines.join('\n'),
    targetType: 'all',
    sendNow: true,
  }
}

function BroadcastsPageInner() {
  const { selectedAccountId } = useAccount()
  const searchParams = useSearchParams()
  const draftToken = searchParams.get('draft')
  const aiActionToken = searchParams.get('ai_action')
  const aiAction = decodeBase64Json<AiAction>(aiActionToken)
  const [broadcasts, setBroadcasts] = useState<ApiBroadcast[]>([])
  const [tags, setTags] = useState<Tag[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  // 即座にスケルトンプレフィル → Gemini 結果が来たら上書き
  const [initialDraft, setInitialDraft] = useState<BroadcastDraft | null>(
    () => decodeBase64Json<BroadcastDraft>(draftToken)
      ?? (aiAction ? skeletonDraftFromAction(aiAction) : null),
  )
  const [showCreate, setShowCreate] = useState(!!initialDraft || !!aiAction)
  const [sendingId, setSendingId] = useState<string | null>(null)
  const [aiDrafting, setAiDrafting] = useState(false)
  const [aiDraftError, setAiDraftError] = useState<string | null>(null)
  const [aiDraftElapsed, setAiDraftElapsed] = useState(0)
  const [aiDraftDone, setAiDraftDone] = useState(false)

  // ai_action パラメータが付いていれば AI ドラフトを取得してフォームを上書き（バックグラウンド）
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
    console.log('[broadcasts] ai_action draft request:', { url: fullUrl, action: aiAction })
    ;(async () => {
      try {
        const res = await fetch(fullUrl, {
          method: 'POST',
          signal: controller.signal,
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
          },
          body: JSON.stringify({ action: { ...aiAction, execute_url: '/broadcasts' } }),
        })
        const elapsed = Math.floor((Date.now() - startedAt) / 1000)
        const text = await res.text()
        console.log('[broadcasts] ai_action draft response:', { status: res.status, elapsed, body: text.slice(0, 200) })
        let json: { success: boolean; data?: { draft: BroadcastDraft }; error?: string } | null = null
        try { json = JSON.parse(text) } catch { json = null }
        if (cancelled) return
        if (res.ok && json?.success && json.data?.draft) {
          setInitialDraft(json.data.draft)
          setAiDrafting(false)
          setAiDraftDone(true)
        } else {
          setAiDraftError(
            json?.error
              ?? (res.status === 401 ? 'ログインセッション切れ。再ログインしてください。' : `HTTP ${res.status}`),
          )
          setAiDrafting(false)
          setAiDraftDone(true)
        }
      } catch (e) {
        if (cancelled) return
        const errName = e instanceof Error ? e.name : ''
        console.error('[broadcasts] ai_action draft error:', e)
        setAiDraftError(
          errName === 'AbortError'
            ? '30 秒以内に応答がありませんでした。Worker か Gemini が遅延している可能性があります。'
            : `AI ドラフト生成に失敗しました: ${e instanceof Error ? e.message : String(e)}`,
        )
        setAiDrafting(false)
        setAiDraftDone(true)
      }
    })()
    return () => {
      cancelled = true
      clearInterval(timer)
      clearTimeout(timeoutId)
      controller.abort()
    }
    // aiActionToken のみを依存に。aiAction は毎レンダで生成され参照変化するため注意。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aiActionToken])

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [broadcastsRes, tagsRes] = await Promise.all([
        api.broadcasts.list({ accountId: selectedAccountId || undefined }),
        api.tags.list(),
      ])
      if (broadcastsRes.success) setBroadcasts(broadcastsRes.data)
      else setError(broadcastsRes.error)
      if (tagsRes.success) setTags(tagsRes.data)
    } catch {
      setError('データの読み込みに失敗しました。もう一度お試しください。')
    } finally {
      setLoading(false)
    }
  }, [selectedAccountId])

  useEffect(() => { load() }, [load])

  const handleSend = async (id: string) => {
    if (!confirm('この配信を今すぐ送信してもよいですか？')) return
    setSendingId(id)
    try {
      await api.broadcasts.send(id)
      load()
    } catch {
      setError('送信に失敗しました')
    } finally {
      setSendingId(null)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('この配信を削除してもよいですか？')) return
    try {
      await api.broadcasts.delete(id)
      load()
    } catch {
      setError('削除に失敗しました')
    }
  }

  const getTagName = (tagId: string | null) => {
    if (!tagId) return null
    return tags.find((t) => t.id === tagId)?.name ?? null
  }

  return (
    <div>
      <Header
        title="一斉配信"
        action={
          <button
            onClick={() => setShowCreate(true)}
            className="px-4 py-2 text-sm font-medium text-white rounded-lg transition-opacity hover:opacity-90"
            style={{ backgroundColor: '#06C755' }}
          >
            + 新規配信
          </button>
        }
      />

      {/* Error */}
      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          {error}
        </div>
      )}

      {/* Create form */}
      {showCreate && (
        <>
          {aiDrafting && (
            <div className="mb-3 p-4 bg-purple-50 border border-purple-200 rounded-lg text-sm text-purple-800 flex items-center gap-3">
              <div className="animate-spin h-4 w-4 border-2 border-purple-600 border-t-transparent rounded-full shrink-0" />
              <div>
                ✨ AI がより質の高い配信内容を生成中です{aiDraftElapsed > 0 ? ` (${aiDraftElapsed}秒)` : ''}...
                <br /><span className="text-xs text-purple-600">下にスケルトンを既に入れているので、待たずに編集を始めても OK</span>
              </div>
            </div>
          )}
          {aiDraftError && (
            <div className="mb-3 p-3 bg-yellow-50 border border-yellow-200 rounded-lg text-xs text-yellow-800">
              ⚠️ AI ドラフトの上書き生成に失敗しました（提案内容のスケルトンは入力済み）: {aiDraftError}
            </div>
          )}
          {aiAction && aiDraftDone && !aiDraftError && (
            <div className="mb-3 p-3 bg-purple-50 border border-purple-200 rounded-lg text-xs text-purple-800">
              ✨ AI コックピットの提案から配信内容を生成しました。内容を確認し、必要に応じて編集してから送信してください。
            </div>
          )}
          <BroadcastForm
            key={initialDraft?.messageContent ?? 'empty'}
            tags={tags}
            initialDraft={initialDraft}
            onSuccess={() => { setShowCreate(false); load() }}
            onCancel={() => setShowCreate(false)}
          />
        </>
      )}

      {/* Loading */}
      {loading ? (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="px-4 py-4 border-b border-gray-100 flex items-center gap-4 animate-pulse">
              <div className="flex-1 space-y-2">
                <div className="h-3 bg-gray-200 rounded w-48" />
                <div className="h-2 bg-gray-100 rounded w-32" />
              </div>
              <div className="h-5 bg-gray-100 rounded-full w-16" />
              <div className="h-3 bg-gray-100 rounded w-24" />
            </div>
          ))}
        </div>
      ) : broadcasts.length === 0 && !showCreate ? (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-12 text-center">
          <p className="text-gray-500">配信がありません。「新規配信」から作成してください。</p>
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
          <table className="w-full min-w-[640px]">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  配信タイトル
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  ステータス
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  配信対象
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  予約日時
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  送信完了日時
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  実績
                </th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {broadcasts.map((broadcast) => {
                const statusInfo = statusConfig[broadcast.status]
                const tagName = getTagName(broadcast.targetTagId)
                const isSending = sendingId === broadcast.id

                return (
                  <tr key={broadcast.id} className="hover:bg-gray-50 transition-colors">
                    {/* Title */}
                    <td className="px-4 py-3">
                      <div>
                        <p className="text-sm font-medium text-gray-900">{broadcast.title}</p>
                        <p className="text-xs text-gray-400 mt-0.5">
                          {broadcast.messageType === 'text' ? 'テキスト' : broadcast.messageType === 'image' ? '画像' : 'Flex'}
                        </p>
                      </div>
                    </td>

                    {/* Status */}
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${statusInfo.className}`}>
                        {statusInfo.label}
                      </span>
                    </td>

                    {/* Target */}
                    <td className="px-4 py-3 text-sm text-gray-600">
                      {broadcast.targetType === 'all' ? (
                        '全員'
                      ) : tagName ? (
                        <span>タグ: {tagName}</span>
                      ) : (
                        'タグ指定'
                      )}
                    </td>

                    {/* Scheduled */}
                    <td className="px-4 py-3 text-sm text-gray-500">
                      {formatDatetime(broadcast.scheduledAt)}
                    </td>

                    {/* Sent */}
                    <td className="px-4 py-3 text-sm text-gray-500">
                      {formatDatetime(broadcast.sentAt)}
                    </td>

                    {/* Stats */}
                    <td className="px-4 py-3 text-sm text-gray-500">
                      {broadcast.status === 'sent' ? (
                        <span>
                          {broadcast.successCount.toLocaleString('ja-JP')} / {broadcast.totalCount.toLocaleString('ja-JP')} 件
                        </span>
                      ) : (
                        '-'
                      )}
                    </td>

                    {/* Actions */}
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        {broadcast.status === 'draft' && (
                          <button
                            onClick={() => handleSend(broadcast.id)}
                            disabled={isSending}
                            className="px-3 py-1 min-h-[44px] text-xs font-medium text-white rounded-md disabled:opacity-50 transition-opacity"
                            style={{ backgroundColor: '#06C755' }}
                          >
                            {isSending ? '送信中...' : '今すぐ送信'}
                          </button>
                        )}
                        {(broadcast.status === 'draft' || broadcast.status === 'scheduled') && (
                          <button
                            onClick={() => handleDelete(broadcast.id)}
                            className="px-3 py-1 min-h-[44px] text-xs font-medium text-red-500 hover:text-red-700 bg-red-50 hover:bg-red-100 rounded-md transition-colors"
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
        </div>
      )}

      <CcPromptButton prompts={ccPrompts} />
    </div>
  )
}

export default function BroadcastsPage() {
  return (
    <Suspense fallback={<div className="p-8 text-gray-400 text-sm">読み込み中...</div>}>
      <BroadcastsPageInner />
    </Suspense>
  )
}
