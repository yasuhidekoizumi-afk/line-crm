'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import type { Tag } from '@line-crm/shared'
import { api, type ApiBroadcast, type FriendWithTags } from '@/lib/api'
import { fermentApi, type Segment } from '@/lib/ferment-api'
import MessageBlocksEditor, {
  type Block,
  blocksToPayload,
  payloadToBlocks,
} from '@/components/messages/message-blocks-editor'
import MessageBlocksPreview from '@/components/messages/message-blocks-preview'
import { useAccount } from '@/contexts/account-context'

interface BroadcastFormProps {
  tags: Tag[]
  onSuccess: () => void
  onCancel: () => void
  initialDraft?: Partial<FormState> | null
  segments?: Segment[]
  editId?: string | null
}

type SendMode = 'draft' | 'now' | 'scheduled'

interface FormState {
  title: string
  // 互換のため messageType/messageContent も保持（initialDraft 受け取り用）
  // 編集状態は blocks（複数メッセージ）に統一する
  messageType: ApiBroadcast['messageType']
  messageContent: string
  blocks: Block[]
  targetType: ApiBroadcast['targetType']
  targetTagId: string
  targetSegmentId: string
  targetFriendIds: string[]
  scheduledAt: string
  sendMode: SendMode
}

export default function BroadcastForm({ tags, onSuccess, onCancel, initialDraft, segments = [], editId }: BroadcastFormProps) {
  const { selectedAccountId } = useAccount()
  const initialBlocks: Block[] = (() => {
    // 編集開始時：既存の messageType/messageContent を blocks に展開
    const t = initialDraft?.messageType ?? 'text'
    const c = initialDraft?.messageContent ?? ''
    if (!c.trim()) return [{ id: 'b_init', type: 'text', text: '' } as Block]
    const blocks = payloadToBlocks(t, c)
    return blocks.length > 0 ? blocks : [{ id: 'b_init', type: 'text', text: '' } as Block]
  })()

  const [form, setForm] = useState<FormState>({
    title: initialDraft?.title ?? '',
    messageType: initialDraft?.messageType ?? 'text',
    messageContent: initialDraft?.messageContent ?? '',
    blocks: initialBlocks,
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
    // 複数メッセージ：1件以上＋各ブロックの中身検証
    if (form.blocks.length === 0) { setError('メッセージブロックを1件以上追加してください'); return }
    if (form.blocks.length > 5) { setError('1配信あたりのメッセージは最大5件です'); return }
    for (let i = 0; i < form.blocks.length; i++) {
      const b = form.blocks[i]
      const n = `#${i + 1}`
      if (b.type === 'text' && !b.text.trim()) { setError(`${n} テキストを入力してください`); return }
      if (b.type === 'image' && !b.originalContentUrl.trim()) { setError(`${n} 画像URLを入力してください`); return }
      if (b.type === 'flex') {
        if (!b.contents.trim()) { setError(`${n} Flexの内容を入力してください`); return }
        try { JSON.parse(b.contents) } catch { setError(`${n} FlexメッセージのJSONが無効です`); return }
      }
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
      // blocks → 保存形式（単一なら従来形式、複数なら 'multi'）
      const msg = blocksToPayload(form.blocks)
      const payload = {
        title: form.title,
        messageType: msg.messageType,
        messageContent: msg.messageContent,
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
            lineAccountId: selectedAccountId || null,
          })
      if (res.success) {
        // 「今すぐ送信」は新規・編集どちらの場合も、作成/更新後に送信APIを呼ぶ。
        // 旧実装は editId があるときだけ send していたため、新規作成＋今すぐ送信が
        // 下書き保存されるだけで実際に送信されない不具合があった。
        if (form.sendMode === 'now') {
          const sendId = editId ?? res.data?.id
          if (sendId) await api.broadcasts.send(sendId)
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

      {/* プレビュー枠を右に並べる関係で、メッセージ編集部だけは広めに。他のフィールドは max-w-lg。 */}
      <div className="space-y-4 max-w-5xl">
        {/* Title */}
        <div className="max-w-lg">
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

        {/* メッセージ（複数ブロック）＋プレビュー。広い画面では左右2カラムで並び、
            狭い画面では縦に並ぶ。 */}
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-2">
            メッセージ <span className="text-red-500">*</span>
            <span className="text-xs text-gray-400 ml-2">テキスト・画像・Flexを縦に追加できます（最大5件）</span>
          </label>
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4">
            <MessageBlocksEditor
              value={form.blocks}
              onChange={(blocks) => setForm({ ...form, blocks })}
            />
            <div className="lg:sticky lg:top-4 lg:self-start">
              <MessageBlocksPreview blocks={form.blocks} />
            </div>
          </div>
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
