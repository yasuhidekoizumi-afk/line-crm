'use client'

import { useState, useEffect, useCallback, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import type { Tag } from '@line-crm/shared'
import { api, type ApiBroadcast, type ApiBroadcastDetail } from '@/lib/api'
import { fermentApi, type Segment } from '@/lib/ferment-api'
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
  targetSegmentId?: string
  targetFriendIds?: string[]
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
    // URL-safe base64 を標準 base64 に戻す
    let b64 = token.replace(/-/g, '+').replace(/_/g, '/')
    // パディング復元
    while (b64.length % 4) b64 += '='
    const json = decodeURIComponent(escape(atob(b64)))
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

function formatPercent(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return '未計測'
  return `${value.toFixed(1)}%`
}

function formatMessageType(type: ApiBroadcast['messageType']): string {
  if (type === 'text') return 'テキスト'
  if (type === 'image') return '画像'
  if (type === 'flex') return 'Flex'
  if (type === 'multi') return '複数メッセージ'
  if (type === 'imagemap') return 'リッチメッセージ'
  return type
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function asContents(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return []
  return value.filter(isRecord)
}

function renderFlexNode(node: unknown, key?: string | number) {
  if (!isRecord(node)) return null
  const type = asString(node.type)

  if (type === 'text') {
    const text = asString(node.text) ?? ''
    const weight = node.weight === 'bold' ? 'font-semibold' : 'font-normal'
    const size = node.size === 'sm' || node.size === 'xs' ? 'text-xs' : node.size === 'lg' ? 'text-base' : 'text-sm'
    const color = asString(node.color) ?? '#1f2937'
    return (
      <div key={key} className={`${weight} ${size} leading-5`} style={{ color }}>
        {text}
      </div>
    )
  }

  if (type === 'image') {
    const url = asString(node.url)
    if (!url) return null
    const aspectRatio = asString(node.aspectRatio)?.replace(':', ' / ') ?? '1 / 1'
    return (
      <div key={key} className="overflow-hidden bg-gray-100" style={{ aspectRatio }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt="" className="h-full w-full object-cover" />
      </div>
    )
  }

  if (type === 'button') {
    const action = isRecord(node.action) ? node.action : {}
    const label = asString(action.label) ?? asString(action.text) ?? 'ボタン'
    const uri = asString(action.uri)
    const isPrimary = node.style === 'primary'
    return (
      <div key={key} className="pt-1">
        <div
          className={`flex min-h-10 items-center justify-center rounded-md px-3 py-2 text-sm font-semibold ${
            isPrimary ? 'text-white' : 'border border-gray-200 bg-white text-gray-700'
          }`}
          style={isPrimary ? { backgroundColor: asString(node.color) ?? '#06C755' } : undefined}
          title={uri ?? undefined}
        >
          {label}
        </div>
      </div>
    )
  }

  if (type === 'separator') {
    return <div key={key} className="my-2 border-t border-gray-100" />
  }

  if (type === 'spacer') {
    return <div key={key} className="h-2" />
  }

  if (type === 'box') {
    const layout = node.layout === 'horizontal' ? 'flex-row' : 'flex-col'
    const spacing = node.spacing === 'md' ? 'gap-3' : node.spacing === 'lg' ? 'gap-4' : 'gap-2'
    return (
      <div key={key} className={`flex ${layout} ${spacing}`}>
        {asContents(node.contents).map((child, index) => renderFlexNode(child, index))}
      </div>
    )
  }

  return null
}

function renderFlexBubble(bubble: Record<string, unknown>, key?: string | number) {
  const hero = isRecord(bubble.hero) ? bubble.hero : null
  const body = isRecord(bubble.body) ? bubble.body : null
  const footer = isRecord(bubble.footer) ? bubble.footer : null

  return (
    <div key={key} className="w-full max-w-[340px] overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
      {hero && renderFlexNode(hero)}
      {body && <div className="space-y-2 p-4">{renderFlexNode(body)}</div>}
      {footer && <div className="space-y-2 border-t border-gray-100 p-3">{renderFlexNode(footer)}</div>}
    </div>
  )
}

function renderFlexPreview(content: unknown) {
  if (!isRecord(content)) return null
  const type = asString(content.type)

  if (type === 'carousel') {
    const bubbles = asContents(content.contents).filter((item) => item.type === 'bubble')
    return (
      <div className="overflow-x-auto rounded-md bg-gray-50 p-4">
        <div className="flex gap-4">
          {bubbles.map((bubble, index) => renderFlexBubble(bubble, index))}
        </div>
      </div>
    )
  }

  if (type === 'bubble') {
    return (
      <div className="rounded-md bg-gray-50 p-4">
        {renderFlexBubble(content)}
      </div>
    )
  }

  return null
}

function renderFlexContent(content: string) {
  try {
    const parsed = JSON.parse(content)
    const preview = renderFlexPreview(parsed)
    if (preview) return preview
    return (
      <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-md bg-gray-50 p-4 text-xs leading-5 text-gray-800">
        {JSON.stringify(parsed, null, 2)}
      </pre>
    )
  } catch {
    return (
      <pre className="whitespace-pre-wrap break-words rounded-md bg-gray-50 p-4 text-sm leading-6 text-gray-800">
        {content}
      </pre>
    )
  }
}

function renderFlexBlockContent(content: unknown) {
  if (typeof content === 'string') {
    return renderFlexContent(content)
  }

  const preview = renderFlexPreview(content)
  if (preview) return preview

  return (
    <pre className="whitespace-pre-wrap break-words text-sm leading-6 text-gray-800">
      {JSON.stringify(content, null, 2)}
    </pre>
  )
}

function renderMessageContent(broadcast: ApiBroadcast | ApiBroadcastDetail) {
  if (broadcast.messageType === 'text') {
    return (
      <pre className="whitespace-pre-wrap break-words rounded-md bg-gray-50 p-4 text-sm leading-6 text-gray-800">
        {broadcast.messageContent}
      </pre>
    )
  }

  try {
    const parsed = JSON.parse(broadcast.messageContent)
    if (broadcast.messageType === 'multi' && Array.isArray(parsed)) {
      return (
        <div className="space-y-3">
          {parsed.map((block, index) => (
            <div key={index} className="rounded-md border border-gray-200 bg-gray-50 p-3">
              <div className="mb-2 text-xs font-medium text-gray-500">
                {index + 1}件目: {formatMessageType(block.type)}
              </div>
              {block.type === 'flex'
                ? renderFlexBlockContent(block.content)
                : (
                  <pre className="whitespace-pre-wrap break-words text-sm leading-6 text-gray-800">
                    {typeof block.content === 'string' ? block.content : JSON.stringify(block.content, null, 2)}
                  </pre>
                )}
            </div>
          ))}
        </div>
      )
    }

    if (broadcast.messageType === 'image') {
      return (
        <div className="space-y-2 rounded-md bg-gray-50 p-4 text-sm text-gray-700">
          {parsed.previewImageUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={parsed.previewImageUrl} alt="" className="max-h-64 rounded border border-gray-200 object-contain" />
          )}
          <div>画像URL: {parsed.originalContentUrl ?? '-'}</div>
          {parsed.linkUrl && <div>リンク先: {parsed.linkUrl}</div>}
        </div>
      )
    }

    if (broadcast.messageType === 'flex') {
      return renderFlexContent(broadcast.messageContent)
    }

    return (
      <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-md bg-gray-50 p-4 text-xs leading-5 text-gray-800">
        {JSON.stringify(parsed, null, 2)}
      </pre>
    )
  } catch {
    return (
      <pre className="whitespace-pre-wrap break-words rounded-md bg-gray-50 p-4 text-sm leading-6 text-gray-800">
        {broadcast.messageContent}
      </pre>
    )
  }
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
  const [segments, setSegments] = useState<Segment[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  // 即座にスケルトンプレフィル → Gemini 結果が来たら上書き
  const [initialDraft, setInitialDraft] = useState<BroadcastDraft | null>(
    () => decodeBase64Json<BroadcastDraft>(draftToken)
      ?? (aiAction ? skeletonDraftFromAction(aiAction) : null),
  )
  const [draftRevision, setDraftRevision] = useState(0)
  const [showCreate, setShowCreate] = useState(!!initialDraft || !!aiAction)
  const [editingBroadcast, setEditingBroadcast] = useState<ApiBroadcast | null>(null)
  const [selectedDetail, setSelectedDetail] = useState<ApiBroadcastDetail | null>(null)
  const [detailLoadingId, setDetailLoadingId] = useState<string | null>(null)
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
      const [broadcastsRes, tagsRes, segmentsRes] = await Promise.all([
        api.broadcasts.list({ accountId: selectedAccountId || undefined }),
        api.tags.list(),
        fermentApi.segments.list(),
      ])
      if (broadcastsRes.success) setBroadcasts(broadcastsRes.data)
      else setError(broadcastsRes.error)
      if (tagsRes.success) setTags(tagsRes.data)
      if (segmentsRes.success && segmentsRes.data) setSegments(segmentsRes.data)
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

  const handleReset = async (id: string) => {
    if (!confirm('「送信中」で固まっている配信をドラフトに戻しますか？\n（再送信や削除ができるようになります）')) return
    try {
      await api.broadcasts.reset(id)
      load()
    } catch {
      setError('リセットに失敗しました')
    }
  }

  const handleNewBroadcast = () => {
    setInitialDraft(null)
    setDraftRevision((revision) => revision + 1)
    setEditingBroadcast(null)
    setShowCreate(true)
  }

  const handleDuplicate = (broadcast: ApiBroadcast) => {
    setInitialDraft({
      title: `${broadcast.title}（コピー）`,
      messageType: broadcast.messageType,
      messageContent: broadcast.messageContent,
      targetType: broadcast.targetType,
      targetTagId: broadcast.targetTagId ?? '',
      targetSegmentId: broadcast.targetSegmentId ?? '',
      targetFriendIds: broadcast.targetFriendIds ?? [],
      scheduledAt: '',
    })
    setDraftRevision((revision) => revision + 1)
    setEditingBroadcast(null)
    setSelectedDetail(null)
    setShowCreate(true)
  }

  const handleOpenDetail = async (id: string) => {
    setDetailLoadingId(id)
    setError('')
    try {
      const res = await api.broadcasts.detail(id)
      if (res.success) setSelectedDetail(res.data)
      else setError(res.error)
    } catch {
      setError('配信詳細の読み込みに失敗しました。')
    } finally {
      setDetailLoadingId(null)
    }
  }

  const getTagName = (tagId: string | null) => {
    if (!tagId) return null
    return tags.find((t) => t.id === tagId)?.name ?? null
  }

  const getSegmentName = (segmentId: string | null) => {
    if (!segmentId) return null
    return segments.find((s) => s.segment_id === segmentId)?.name ?? null
  }

  const getTargetLabel = (b: ApiBroadcast) => {
    if (b.targetType === 'all') return '全員'
    if (b.targetType === 'tag') {
      const name = getTagName(b.targetTagId)
      return name ? `タグ: ${name}` : 'タグ指定'
    }
    if (b.targetType === 'segment') {
      const name = getSegmentName(b.targetSegmentId)
      return name ? `🎯 ${name}` : 'セグメント指定'
    }
    return '-'
  }

  return (
    <div>
      <Header
        title="LINE一斉配信"
        action={
          <button
            onClick={handleNewBroadcast}
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

      {/* Edit form */}
      {editingBroadcast && (
        <BroadcastForm
          key={editingBroadcast.id}
          tags={tags}
          segments={segments}
          editId={editingBroadcast.id}
          initialDraft={{
            title: editingBroadcast.title,
            messageType: editingBroadcast.messageType,
            messageContent: editingBroadcast.messageContent,
            targetType: editingBroadcast.targetType,
            targetTagId: editingBroadcast.targetTagId ?? '',
            targetSegmentId: editingBroadcast.targetSegmentId ?? '',
            scheduledAt: editingBroadcast.scheduledAt ?? '',
          }}
          onSuccess={() => { setEditingBroadcast(null); load() }}
          onCancel={() => setEditingBroadcast(null)}
        />
      )}

      {/* Create form */}
      {showCreate && !editingBroadcast && (
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
            key={`create-${draftRevision}`}
            tags={tags}
            segments={segments}
            initialDraft={initialDraft}
            onSuccess={() => { setShowCreate(false); setInitialDraft(null); load() }}
            onCancel={() => { setShowCreate(false); setInitialDraft(null) }}
          />
        </>
      )}

      {selectedDetail && (
        <div className="mb-6 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
          <div className="flex flex-col gap-3 border-b border-gray-100 px-5 py-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${statusConfig[selectedDetail.status].className}`}>
                  {statusConfig[selectedDetail.status].label}
                </span>
                <span className="text-xs text-gray-500">{formatMessageType(selectedDetail.messageType)}</span>
              </div>
              <h2 className="text-lg font-semibold text-gray-900">{selectedDetail.title}</h2>
              <p className="mt-1 text-sm text-gray-500">
                配信対象: {getTargetLabel(selectedDetail)} / 送信完了: {formatDatetime(selectedDetail.sentAt)}
              </p>
            </div>
            <div className="flex items-center gap-2 self-start">
              <button
                onClick={() => handleDuplicate(selectedDetail)}
                className="rounded-md border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50"
              >
                複製
              </button>
              <button
                onClick={() => setSelectedDetail(null)}
                className="rounded-md border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-600 hover:bg-gray-50"
              >
                閉じる
              </button>
            </div>
          </div>

          <div className="grid gap-3 border-b border-gray-100 p-5 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-md bg-gray-50 p-4">
              <div className="text-xs text-gray-500">配信成功</div>
              <div className="mt-1 text-2xl font-semibold text-gray-900">
                {selectedDetail.metrics.deliveredCount.toLocaleString('ja-JP')}
              </div>
              <div className="mt-1 text-xs text-gray-500">
                対象 {selectedDetail.totalCount.toLocaleString('ja-JP')} / 失敗 {selectedDetail.metrics.failedCount.toLocaleString('ja-JP')}
              </div>
            </div>
            <div className="rounded-md bg-gray-50 p-4">
              <div className="text-xs text-gray-500">開封率</div>
              <div className="mt-1 text-2xl font-semibold text-gray-900">
                {formatPercent(selectedDetail.metrics.openRate)}
              </div>
              <div className="mt-1 text-xs text-gray-500">
                開封数 {selectedDetail.metrics.openCount == null ? '未計測' : selectedDetail.metrics.openCount.toLocaleString('ja-JP')}
              </div>
            </div>
            <div className="rounded-md bg-gray-50 p-4">
              <div className="text-xs text-gray-500">リンククリック率</div>
              <div className="mt-1 text-2xl font-semibold text-gray-900">
                {formatPercent(selectedDetail.metrics.clickRate)}
              </div>
              <div className="mt-1 text-xs text-gray-500">
                クリック人数 {selectedDetail.metrics.uniqueClickCount.toLocaleString('ja-JP')} / イベント {selectedDetail.metrics.clickEvents.toLocaleString('ja-JP')}
              </div>
            </div>
            <div className="rounded-md bg-gray-50 p-4">
              <div className="text-xs text-gray-500">配信ログ</div>
              <div className="mt-1 text-2xl font-semibold text-gray-900">
                {selectedDetail.metrics.sentLogCount.toLocaleString('ja-JP')}
              </div>
              <div className="mt-1 text-xs text-gray-500">
                計測リンク {selectedDetail.metrics.trackedLinkCount.toLocaleString('ja-JP')} 件
              </div>
            </div>
          </div>

          {selectedDetail.errorSummary && (
            <div className="border-b border-red-100 bg-red-50 px-5 py-3 text-sm text-red-700">
              失敗理由: {selectedDetail.errorSummary}
            </div>
          )}

          <div className="grid gap-5 p-5 lg:grid-cols-[1.3fr_1fr]">
            <section>
              <h3 className="mb-3 text-sm font-semibold text-gray-900">送信内容</h3>
              {renderMessageContent(selectedDetail)}
            </section>

            <section>
              <h3 className="mb-3 text-sm font-semibold text-gray-900">リンク別クリック</h3>
              {selectedDetail.trackedLinks.length === 0 ? (
                <div className="rounded-md border border-gray-200 bg-gray-50 p-4 text-sm text-gray-500">
                  計測リンクはありません。
                </div>
              ) : (
                <div className="overflow-hidden rounded-md border border-gray-200">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 text-xs text-gray-500">
                      <tr>
                        <th className="px-3 py-2 text-left font-semibold">リンク先</th>
                        <th className="px-3 py-2 text-right font-semibold">人数</th>
                        <th className="px-3 py-2 text-right font-semibold">回数</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {selectedDetail.trackedLinks.map((link) => (
                        <tr key={link.id}>
                          <td className="max-w-[260px] px-3 py-2">
                            <div className="truncate font-medium text-gray-800">{link.name}</div>
                            <div className="truncate text-xs text-gray-500">{link.originalUrl}</div>
                          </td>
                          <td className="px-3 py-2 text-right text-gray-700">
                            {link.uniqueClickCount.toLocaleString('ja-JP')}
                          </td>
                          <td className="px-3 py-2 text-right text-gray-700">
                            {link.clickCount.toLocaleString('ja-JP')}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>
        </div>
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
                const isSending = sendingId === broadcast.id

                return (
                  <tr key={broadcast.id} className="hover:bg-gray-50 transition-colors">
                    {/* Title */}
                    <td className="px-4 py-3">
                      <div>
                        <p className="text-sm font-medium text-gray-900">{broadcast.title}</p>
                        <p className="text-xs text-gray-400 mt-0.5">
                          {formatMessageType(broadcast.messageType)}
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
                      {getTargetLabel(broadcast)}
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
                        <div className="space-y-0.5">
                          <span>
                            成功 {broadcast.successCount.toLocaleString('ja-JP')} / {broadcast.totalCount.toLocaleString('ja-JP')} 件
                          </span>
                          {(broadcast.failedCount ?? 0) > 0 && (
                            <span
                              className="block text-xs font-medium text-red-600 cursor-help"
                              title={broadcast.errorSummary ?? '理由は記録されていません'}
                            >
                              ⚠ 失敗 {broadcast.failedCount.toLocaleString('ja-JP')} 件
                              {broadcast.errorSummary ? '（ホバーで理由表示）' : ''}
                            </span>
                          )}
                        </div>
                      ) : (
                        '-'
                      )}
                    </td>

                    {/* Actions */}
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => handleDuplicate(broadcast)}
                          className="px-3 py-1 min-h-[44px] text-xs font-medium text-gray-700 bg-white border border-gray-200 hover:bg-gray-50 rounded-md transition-colors"
                        >
                          複製
                        </button>
                        {broadcast.status === 'draft' && (
                          <button
                            onClick={() => { setEditingBroadcast(broadcast); setShowCreate(false) }}
                            className="px-3 py-1 min-h-[44px] text-xs font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-md transition-colors"
                          >
                            編集
                          </button>
                        )}
                        <button
                          onClick={() => handleOpenDetail(broadcast.id)}
                          disabled={detailLoadingId === broadcast.id}
                          className="px-3 py-1 min-h-[44px] text-xs font-medium text-gray-700 bg-white border border-gray-200 hover:bg-gray-50 rounded-md disabled:opacity-50 transition-colors"
                        >
                          {detailLoadingId === broadcast.id ? '読込中...' : '詳細'}
                        </button>
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
                        {broadcast.status === 'sending' && (
                          <button
                            onClick={() => handleReset(broadcast.id)}
                            className="px-3 py-1 min-h-[44px] text-xs font-medium text-orange-600 hover:text-orange-800 bg-orange-50 hover:bg-orange-100 rounded-md transition-colors"
                          >
                            ドラフトに戻す
                          </button>
                        )}
                        {(broadcast.status === 'draft' || broadcast.status === 'scheduled' || broadcast.status === 'sending') && (
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
