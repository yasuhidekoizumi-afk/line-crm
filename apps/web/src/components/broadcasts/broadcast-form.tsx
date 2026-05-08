'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import type { Tag } from '@line-crm/shared'
import { api, type ApiBroadcast, type FriendWithTags } from '@/lib/api'
import { fermentApi, type Segment } from '@/lib/ferment-api'
import FlexPreviewComponent from '@/components/flex-preview'
import ImageUploader from '@/components/messages/image-uploader'
import FlexTemplates from '@/components/messages/flex-templates'
import FlexEditor from '@/components/messages/flex-editor'
import { useAccount } from '@/contexts/account-context'

interface BroadcastFormProps {
  tags: Tag[]
  onSuccess: () => void
  onCancel: () => void
  initialDraft?: Partial<FormState> | null
  segments?: Segment[]
  editId?: string | null
}

const messageTypeLabels: Record<ApiBroadcast['messageType'], string> = {
  text: 'テキスト',
  image: '画像',
  flex: 'Flexメッセージ',
}

type SendMode = 'draft' | 'now' | 'scheduled'

interface FormState {
  title: string
  messageType: ApiBroadcast['messageType']
  messageContent: string
  targetType: ApiBroadcast['targetType']
  targetTagId: string
  targetSegmentId: string
  targetFriendIds: string[]
  scheduledAt: string
  sendMode: SendMode
}

export default function BroadcastForm({ tags, onSuccess, onCancel, initialDraft, segments = [], editId }: BroadcastFormProps) {
  const { selectedAccountId } = useAccount()
  const [form, setForm] = useState<FormState>({
    title: initialDraft?.title ?? '',
    messageType: initialDraft?.messageType ?? 'text',
    messageContent: initialDraft?.messageContent ?? '',
    targetType: initialDraft?.targetType ?? 'all',
    targetTagId: initialDraft?.targetTagId ?? '',
    targetSegmentId: initialDraft?.targetSegmentId ?? '',
    targetFriendIds: (initialDraft as FormState | undefined)?.targetFriendIds ?? [],
    scheduledAt: initialDraft?.scheduledAt ?? '',
    sendMode: 'draft',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // 個別指定: 友だち検索
  const [friendSearchTag, setFriendSearchTag] = useState('')
  const [friendSearchInput, setFriendSearchInput] = useState('')
  const [friendSearchQuery, setFriendSearchQuery] = useState('')
  const [friendCandidates, setFriendCandidates] = useState<FriendWithTags[]>([])
  const [friendLoading, setFriendLoading] = useState(false)
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const loadFriendCandidates = useCallback(async () => {
    setFriendLoading(true)
    try {
      const params: Record<string, string> = { offset: '0', limit: '50' }
      if (friendSearchTag) params.tagId = friendSearchTag
      if (selectedAccountId) params.accountId = selectedAccountId
      if (friendSearchQuery.trim()) params.search = friendSearchQuery.trim()
      const res = await api.friends.list(params)
      if (res.success) setFriendCandidates(res.data.items)
    } catch { /* ignore */ } finally {
      setFriendLoading(false)
    }
  }, [friendSearchTag, friendSearchQuery, selectedAccountId])

  useEffect(() => {
    if (form.targetType !== 'individual') return
    loadFriendCandidates()
  }, [form.targetType, loadFriendCandidates])

  const handleSave = async () => {
    if (!form.title.trim()) { setError('配信タイトルを入力してください'); return }
    if (!form.messageContent.trim()) { setError('メッセージ内容を入力してください'); return }
    if (form.messageType === 'flex') {
      try { JSON.parse(form.messageContent) } catch { setError('FlexメッセージのJSONが無効です'); return }
    }
    if (form.targetType === 'individual' && form.targetFriendIds.length === 0) {
      setError('送信先の友だちを1人以上選択してください')
      return
    }
    if (form.sendMode === 'scheduled' && !form.scheduledAt) {
      setError('予約配信の場合は配信日時を指定してください')
      return
    }

    setSaving(true)
    setError('')
    try {
      const payload = {
        title: form.title,
        messageType: form.messageType,
        messageContent: form.messageContent,
        targetType: form.targetType,
        targetTagId: form.targetType === 'tag' ? form.targetTagId || null : null,
        targetSegmentId: form.targetType === 'segment' ? form.targetSegmentId || null : null,
        targetFriendIds: form.targetType === 'individual' ? form.targetFriendIds : null,
        scheduledAt: form.sendMode === 'scheduled' && form.scheduledAt
          ? form.scheduledAt + ':00.000+09:00'
          : null,
      }
      const res = editId
        ? await api.broadcasts.update(editId, payload)
        : await api.broadcasts.create({
            ...payload,
            status: form.sendMode === 'now' ? 'sending' : 'draft',
            lineAccountId: selectedAccountId || null,
          })
      if (res.success) {
        if (form.sendMode === 'now' && editId) {
          await api.broadcasts.send(editId)
        }
        onSuccess()
      } else {
        setError(res.error)
      }
    } catch {
      setError(editId ? '更新に失敗しました' : '作成に失敗しました')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-6">
      <h2 className="text-sm font-semibold text-gray-800 mb-5">{editId ? '配信を編集' : '新規配信を作成'}</h2>

      <div className={`space-y-4 ${form.messageType === 'flex' ? 'max-w-3xl' : 'max-w-lg'}`}>
        {/* Title */}
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">
            配信タイトル <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
            placeholder="例: 3月のキャンペーン告知"
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
          />
        </div>

        {/* Message type */}
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-2">メッセージ種別</label>
          <div className="flex gap-2">
            {(Object.keys(messageTypeLabels) as ApiBroadcast['messageType'][]).map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => setForm({ ...form, messageType: type })}
                className={`px-3 py-1.5 min-h-[44px] text-xs font-medium rounded-md border transition-colors ${
                  form.messageType === type
                    ? 'border-green-500 text-green-700 bg-green-50'
                    : 'border-gray-300 text-gray-600 bg-white hover:border-gray-400'
                }`}
              >
                {messageTypeLabels[type]}
              </button>
            ))}
          </div>
        </div>

        {/* Message content */}
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">
            メッセージ内容 <span className="text-red-500">*</span>
          </label>

          {/* ── Text type ───────────────────────────────────────────── */}
          {form.messageType === 'text' && (
            <textarea
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 resize-y"
              rows={4}
              placeholder="配信するメッセージを入力..."
              value={form.messageContent}
              onChange={(e) => setForm({ ...form, messageContent: e.target.value })}
            />
          )}

          {/* ── Image type: uploader + URL inputs ───────────────────── */}
          {form.messageType === 'image' && (() => {
            let parsed: { originalContentUrl?: string; previewImageUrl?: string } = {}
            try { parsed = JSON.parse(form.messageContent) } catch { /* not yet valid */ }

            const setImageUrl = (url: string) => {
              setForm({ ...form, messageContent: JSON.stringify({ originalContentUrl: url, previewImageUrl: url }) })
            }

            return (
              <div className="space-y-3 mb-3">
                <ImageUploader onUploaded={setImageUrl} />
                <div className="space-y-2">
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">元画像URL (originalContentUrl)</label>
                    <input
                      type="url"
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                      placeholder="https://example.com/image.png"
                      value={parsed.originalContentUrl ?? ''}
                      onChange={(e) => {
                        const orig = e.target.value
                        const prev = parsed.previewImageUrl ?? orig
                        setForm({ ...form, messageContent: JSON.stringify({ originalContentUrl: orig, previewImageUrl: prev }) })
                      }}
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">プレビュー画像URL (previewImageUrl)</label>
                    <input
                      type="url"
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                      placeholder="https://example.com/preview.png (空欄で元画像と同じ)"
                      value={parsed.previewImageUrl ?? ''}
                      onChange={(e) => {
                        const prev = e.target.value
                        setForm({ ...form, messageContent: JSON.stringify({ originalContentUrl: parsed.originalContentUrl ?? '', previewImageUrl: prev }) })
                      }}
                    />
                  </div>
                </div>
              </div>
            )
          })()}

          {/* ── Flex type: template selector + visual editor ────────── */}
          {form.messageType === 'flex' && (
            <div className="space-y-3 mb-3">
              {!form.messageContent.trim() && (
                <div>
                  <p className="text-xs text-gray-500 mb-2">テンプレートを選択するか、JSONを直接編集してください</p>
                  <FlexTemplates onSelect={(json) => setForm({ ...form, messageContent: json })} />
                </div>
              )}
              {form.messageContent.trim() && (
                <FlexEditor value={form.messageContent} onChange={(json) => setForm({ ...form, messageContent: json })} />
              )}
              {form.messageContent.trim() && (
                <button
                  type="button"
                  onClick={() => setForm({ ...form, messageContent: '' })}
                  className="text-xs text-gray-400 hover:text-gray-600 underline"
                >
                  テンプレートを選び直す
                </button>
              )}
            </div>
          )}

          {/* ── Image advanced: collapsible JSON editor ─────────────── */}
          {form.messageType === 'image' && form.messageContent && (
            <details className="border border-gray-200 rounded-lg">
              <summary className="text-xs text-gray-400 px-3 py-2 cursor-pointer hover:bg-gray-50">JSONを直接編集</summary>
              <textarea
                className="w-full border-t border-gray-200 px-3 py-2 text-xs font-mono focus:outline-none resize-y"
                rows={3}
                value={form.messageContent}
                onChange={(e) => setForm({ ...form, messageContent: e.target.value })}
              />
            </details>
          )}

          {/* ── Flex / Image fallback preview ───────────────────────── */}
          {form.messageType === 'flex' && form.messageContent && (() => {
            try { JSON.parse(form.messageContent); return true } catch { return false }
          })() && (
            <div className="mt-3">
              <p className="text-xs font-medium text-gray-500 mb-2">プレビュー (簡易)</p>
              <FlexPreviewComponent content={form.messageContent} maxWidth={300} />
            </div>
          )}
        </div>

        {/* Target */}
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-2">配信対象</label>
          <div className="flex flex-wrap gap-2 mb-2">
            <button
              type="button"
              onClick={() => setForm({ ...form, targetType: 'all', targetTagId: '' })}
              className={`px-3 py-1.5 min-h-[44px] text-xs font-medium rounded-md border transition-colors ${
                form.targetType === 'all'
                  ? 'border-green-500 text-green-700 bg-green-50'
                  : 'border-gray-300 text-gray-600 bg-white hover:border-gray-400'
              }`}
            >
              全員
            </button>
            <button
              type="button"
              onClick={() => setForm({ ...form, targetType: 'tag' })}
              className={`px-3 py-1.5 min-h-[44px] text-xs font-medium rounded-md border transition-colors ${
                form.targetType === 'tag'
                  ? 'border-green-500 text-green-700 bg-green-50'
                  : 'border-gray-300 text-gray-600 bg-white hover:border-gray-400'
              }`}
            >
              タグで絞り込み
            </button>
            <button
              type="button"
              onClick={() => setForm({ ...form, targetType: 'segment', targetSegmentId: '' })}
              className={`px-3 py-1.5 min-h-[44px] text-xs font-medium rounded-md border transition-colors ${
                form.targetType === 'segment'
                  ? 'border-purple-500 text-purple-700 bg-purple-50'
                  : 'border-gray-300 text-gray-600 bg-white hover:border-gray-400'
              }`}
            >
              🎯 セグメントで絞り込み
            </button>
            <button
              type="button"
              onClick={() => setForm({ ...form, targetType: 'individual', targetTagId: '', targetFriendIds: [] })}
              className={`px-3 py-1.5 min-h-[44px] text-xs font-medium rounded-md border transition-colors ${
                form.targetType === 'individual'
                  ? 'border-blue-500 text-blue-700 bg-blue-50'
                  : 'border-gray-300 text-gray-600 bg-white hover:border-gray-400'
              }`}
            >
              個別指定
            </button>
          </div>
          {form.targetType === 'tag' && (
            <select
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 bg-white"
              value={form.targetTagId}
              onChange={(e) => setForm({ ...form, targetTagId: e.target.value })}
            >
              <option value="">タグを選択...</option>
              {tags.map((tag) => (
                <option key={tag.id} value={tag.id}>{tag.name}</option>
              ))}
            </select>
          )}
          {form.targetType === 'segment' && (
            <select
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 bg-white"
              value={form.targetSegmentId}
              onChange={(e) => setForm({ ...form, targetSegmentId: e.target.value })}
            >
              <option value="">セグメントを選択...</option>
              {segments.map((seg) => (
                <option key={seg.segment_id} value={seg.segment_id}>
                  {seg.name}（{seg.customer_count.toLocaleString()}人）
                </option>
              ))}
            </select>
          )}
          {form.targetType === 'individual' && (
            <div className="space-y-2">
              {/* 選択済み表示 */}
              {form.targetFriendIds.length > 0 && (
                <p className="text-xs text-blue-700 font-medium">
                  {form.targetFriendIds.length} 人を選択中
                </p>
              )}
              {/* タグフィルター + 検索 */}
              <div className="flex gap-2">
                <select
                  className="text-xs border border-gray-300 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 flex-1"
                  value={friendSearchTag}
                  onChange={(e) => setFriendSearchTag(e.target.value)}
                >
                  <option value="">タグで絞り込み（任意）</option>
                  {tags.map((tag) => (
                    <option key={tag.id} value={tag.id}>{tag.name}</option>
                  ))}
                </select>
                <input
                  type="search"
                  placeholder="名前で検索"
                  value={friendSearchInput}
                  onChange={(e) => {
                    setFriendSearchInput(e.target.value)
                    if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
                    searchTimerRef.current = setTimeout(() => setFriendSearchQuery(e.target.value), 400)
                  }}
                  className="text-xs border border-gray-300 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 flex-1"
                />
              </div>
              {/* 候補リスト */}
              <div className="border border-gray-200 rounded-lg overflow-y-auto max-h-48 bg-white">
                {friendLoading ? (
                  <p className="text-xs text-gray-400 p-3">読み込み中...</p>
                ) : friendCandidates.length === 0 ? (
                  <p className="text-xs text-gray-400 p-3">該当する友だちがいません</p>
                ) : (
                  friendCandidates.map((f) => {
                    const checked = form.targetFriendIds.includes(f.id)
                    return (
                      <label
                        key={f.id}
                        className={`flex items-center gap-2 px-3 py-2 text-xs cursor-pointer hover:bg-gray-50 border-b border-gray-100 last:border-0 ${checked ? 'bg-blue-50' : ''}`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => {
                            const ids = checked
                              ? form.targetFriendIds.filter((id) => id !== f.id)
                              : [...form.targetFriendIds, f.id]
                            setForm({ ...form, targetFriendIds: ids })
                          }}
                          className="accent-blue-500"
                        />
                        <span className="font-medium text-gray-800">{f.displayName || f.lineUserId}</span>
                        {!f.isFollowing && <span className="text-gray-400 text-[10px]">（ブロック済）</span>}
                      </label>
                    )
                  })
                )}
              </div>
              {friendCandidates.length >= 50 && (
                <p className="text-[11px] text-gray-400">表示は最大50件。絞り込みで対象を絞ってください。</p>
              )}
            </div>
          )}
        </div>

        {/* Schedule */}
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-2">配信タイミング</label>
          <div className="flex flex-wrap gap-2 mb-2">
            {([
              { mode: 'draft', label: '下書き保存' },
              { mode: 'now',   label: '今すぐ送信' },
              { mode: 'scheduled', label: '予約配信' },
            ] as { mode: SendMode; label: string }[]).map(({ mode, label }) => (
              <button
                key={mode}
                type="button"
                onClick={() => setForm({ ...form, sendMode: mode, scheduledAt: mode !== 'scheduled' ? '' : form.scheduledAt })}
                className={`px-3 py-1.5 min-h-[44px] text-xs font-medium rounded-md border transition-colors ${
                  form.sendMode === mode
                    ? 'border-green-500 text-green-700 bg-green-50'
                    : 'border-gray-300 text-gray-600 bg-white hover:border-gray-400'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          {form.sendMode === 'scheduled' && (
            <input
              type="datetime-local"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              value={form.scheduledAt}
              onChange={(e) => setForm({ ...form, scheduledAt: e.target.value })}
            />
          )}
        </div>

        {/* Error */}
        {error && <p className="text-xs text-red-600">{error}</p>}

        {/* Actions */}
        <div className="flex gap-2 pt-1">
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 min-h-[44px] text-sm font-medium text-white rounded-lg disabled:opacity-50 transition-opacity"
            style={{ backgroundColor: '#06C755' }}
          >
            {saving ? '処理中...' : editId
            ? (form.sendMode === 'now' ? '送信する' : '変更を保存')
            : (form.sendMode === 'draft' ? '下書き保存' : form.sendMode === 'now' ? '今すぐ送信' : '予約配信')
          }
          </button>
          <button
            onClick={onCancel}
            disabled={saving}
            className="px-4 py-2 min-h-[44px] text-sm font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
          >
            キャンセル
          </button>
        </div>
      </div>
    </div>
  )
}
