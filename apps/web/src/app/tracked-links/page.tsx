'use client'

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import Header from '@/components/layout/header'
import { api, type ApiClickedNonBuyer, type ApiTrackedLink } from '@/lib/api'
import type { Tag } from '@line-crm/shared'

interface ProductMatcherForm {
  productId: string
  variantId: string
  sku: string
  windowDays: number
}

interface CreateLinkForm {
  name: string
  originalUrl: string
}

interface ClickSummaryRow {
  key: string
  friendId: string | null
  friendDisplayName: string | null
  clickCount: number
  firstClickedAt: string
  lastClickedAt: string
}

function formatDatetime(iso: string | null | undefined): string {
  if (!iso) return '-'
  return new Date(iso).toLocaleString('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function encodeDraft(draft: unknown): string {
  const json = JSON.stringify(draft)
  const b64 = btoa(unescape(encodeURIComponent(json)))
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function buildBroadcastDraft(tagId: string | null, sourceLink: ApiTrackedLink, nonBuyerCount: number) {
  return {
    title: `${sourceLink.name} クリック後未購入フォロー`,
    messageType: 'text',
    messageContent: `先日は詳細をご覧いただきありがとうございました。\n\n気になっていた方向けに、もう一度ご案内です。\n${sourceLink.originalUrl}`,
    targetType: tagId ? 'tag' : 'all',
    targetTagId: tagId ?? undefined,
    sendNow: false,
    note: `抽出元リンク: ${sourceLink.name} / 未購入者 ${nonBuyerCount}人`,
  }
}

function TrackedLinksPageInner() {
  const searchParams = useSearchParams()
  const queryLinkId = searchParams.get('linkId')
  const [links, setLinks] = useState<ApiTrackedLink[]>([])
  const [tags, setTags] = useState<Tag[]>([])
  const [selectedLinkId, setSelectedLinkId] = useState<string | null>(null)
  const [selectedLink, setSelectedLink] = useState<ApiTrackedLink | null>(null)
  const [nonBuyers, setNonBuyers] = useState<ApiClickedNonBuyer[]>([])
  const [selectedTagId, setSelectedTagId] = useState('')
  const [taggedTagId, setTaggedTagId] = useState<string | null>(null)
  const [matcher, setMatcher] = useState<ProductMatcherForm>({ productId: '', variantId: '', sku: '', windowDays: 3 })
  const [createForm, setCreateForm] = useState<CreateLinkForm>({ name: '', originalUrl: '' })
  const [showCreate, setShowCreate] = useState(false)
  const [loading, setLoading] = useState(true)
  const [detailLoading, setDetailLoading] = useState(false)
  const [nonBuyerLoading, setNonBuyerLoading] = useState(false)
  const [creating, setCreating] = useState(false)
  const [tagging, setTagging] = useState(false)
  const [error, setError] = useState('')
  const [detailError, setDetailError] = useState('')
  const [createError, setCreateError] = useState('')
  const [tagResult, setTagResult] = useState<string | null>(null)

  const selectedTagName = useMemo(
    () => tags.find((tag) => tag.id === selectedTagId)?.name ?? '',
    [selectedTagId, tags],
  )

  const taggedTagName = useMemo(
    () => tags.find((tag) => tag.id === taggedTagId)?.name ?? '',
    [taggedTagId, tags],
  )

  const broadcastHref = useMemo(() => {
    if (!selectedLink || !taggedTagId) return '/broadcasts'
    return `/broadcasts?draft=${encodeDraft(buildBroadcastDraft(taggedTagId, selectedLink, nonBuyers.length))}`
  }, [selectedLink, taggedTagId, nonBuyers.length])

  const clickRows = useMemo<ClickSummaryRow[]>(() => {
    const rows = new Map<string, ClickSummaryRow>()
    for (const [index, click] of (selectedLink?.clicks ?? []).entries()) {
      const key = click.friendId ? `friend:${click.friendId}` : `unknown:${click.id || index}`
      const existing = rows.get(key)
      if (existing) {
        existing.clickCount += 1
        if (new Date(click.clickedAt).getTime() < new Date(existing.firstClickedAt).getTime()) existing.firstClickedAt = click.clickedAt
        if (new Date(click.clickedAt).getTime() > new Date(existing.lastClickedAt).getTime()) existing.lastClickedAt = click.clickedAt
      } else {
        rows.set(key, {
          key,
          friendId: click.friendId,
          friendDisplayName: click.friendDisplayName,
          clickCount: 1,
          firstClickedAt: click.clickedAt,
          lastClickedAt: click.clickedAt,
        })
      }
    }
    return Array.from(rows.values()).sort((a, b) => new Date(b.lastClickedAt).getTime() - new Date(a.lastClickedAt).getTime())
  }, [selectedLink?.clicks])

  const identifiedClickCount = useMemo(
    () => (selectedLink?.clicks ?? []).filter((click) => click.friendId).length,
    [selectedLink?.clicks],
  )

  const unidentifiedClickCount = Math.max((selectedLink?.clickCount ?? 0) - identifiedClickCount, 0)
  const identifiedFriendCount = clickRows.filter((row) => row.friendId).length

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [linksRes, tagsRes] = await Promise.all([api.trackedLinks.list(), api.tags.list()])
      if (linksRes.success) setLinks(linksRes.data)
      else setError(linksRes.error)
      if (tagsRes.success) {
        setTags(tagsRes.data)
        if (!selectedTagId && tagsRes.data.length > 0) setSelectedTagId(tagsRes.data[0].id)
      }
    } catch {
      setError('リンク一覧の読み込みに失敗しました。')
    } finally {
      setLoading(false)
    }
  }, [selectedTagId])

  useEffect(() => { load() }, [load])

  const loadDetail = useCallback(async (linkId: string) => {
    setSelectedLinkId(linkId)
    setDetailLoading(true)
    setDetailError('')
    setTagResult(null)
    setTaggedTagId(null)
    try {
      const res = await api.trackedLinks.get(linkId)
      if (res.success) setSelectedLink(res.data)
      else setDetailError(res.error)
    } catch {
      setDetailError('リンク詳細の読み込みに失敗しました。')
    } finally {
      setDetailLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!queryLinkId || selectedLinkId === queryLinkId) return
    void loadDetail(queryLinkId)
  }, [loadDetail, queryLinkId, selectedLinkId])

  const handleCreate = async () => {
    if (!createForm.name.trim()) {
      setCreateError('リンク名を入力してください')
      return
    }
    if (!createForm.originalUrl.trim()) {
      setCreateError('遷移先URLを入力してください')
      return
    }
    setCreating(true)
    setCreateError('')
    try {
      const res = await api.trackedLinks.create({
        name: createForm.name.trim(),
        originalUrl: createForm.originalUrl.trim(),
      })
      if (res.success) {
        setShowCreate(false)
        setCreateForm({ name: '', originalUrl: '' })
        await load()
        await loadDetail(res.data.id)
      } else {
        setCreateError(res.error)
      }
    } catch {
      setCreateError('リンク作成に失敗しました')
    } finally {
      setCreating(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('この計測リンクを削除してもよいですか？クリック履歴も削除されます。')) return
    try {
      await api.trackedLinks.delete(id)
      if (selectedLinkId === id) {
        setSelectedLinkId(null)
        setSelectedLink(null)
        setNonBuyers([])
      }
      await load()
    } catch {
      setError('削除に失敗しました')
    }
  }

  const queryParams = () => ({
    productId: matcher.productId.trim() || undefined,
    variantId: matcher.variantId.trim() || undefined,
    sku: matcher.sku.trim() || undefined,
    windowDays: matcher.windowDays,
    limit: 500,
  })

  const handleExtractNonBuyers = async () => {
    if (!selectedLink) return
    if (!matcher.productId.trim() && !matcher.variantId.trim() && !matcher.sku.trim()) {
      setDetailError('商品ID・バリアントID・SKUのいずれかを入力してください。商品名の曖昧一致は誤判定を避けるため使いません。')
      return
    }
    setNonBuyerLoading(true)
    setDetailError('')
    setTagResult(null)
    setTaggedTagId(null)
    try {
      const res = await api.trackedLinks.nonBuyers(selectedLink.id, queryParams())
      if (res.success) setNonBuyers(res.data)
      else setDetailError(res.error)
    } catch {
      setDetailError('クリック後未購入者の抽出に失敗しました。')
    } finally {
      setNonBuyerLoading(false)
    }
  }

  const handleTagNonBuyers = async () => {
    if (!selectedLink) return
    if (!selectedTagId) {
      setDetailError('付与するタグを選択してください。')
      return
    }
    if (nonBuyers.length === 0) {
      setDetailError('先に未購入者を抽出してください。')
      return
    }
    if (!confirm(`${nonBuyers.length.toLocaleString('ja-JP')}人に「${selectedTagName}」タグを付与します。よいですか？`)) return
    setTagging(true)
    setDetailError('')
    try {
      const res = await api.trackedLinks.tagNonBuyers(selectedLink.id, { ...queryParams(), tagId: selectedTagId })
      if (res.success) {
        setTaggedTagId(selectedTagId)
        setTagResult(`${res.data.taggedCount.toLocaleString('ja-JP')}人に「${selectedTagName}」タグを付与しました。`)
      } else {
        setDetailError(res.error)
      }
    } catch {
      setDetailError('タグ付けに失敗しました。')
    } finally {
      setTagging(false)
    }
  }

  return (
    <div>
      <Header
        title="計測リンク"
        description="LINE配信リンクのクリックを記録し、クリック後未購入者をタグ化して再配信できます。"
        action={
          <button
            type="button"
            onClick={() => setShowCreate(true)}
            className="px-4 py-2 text-sm font-medium text-white rounded-lg transition-opacity hover:opacity-90"
            style={{ backgroundColor: '#06C755' }}
          >
            + 新規リンク
          </button>
        }
      />

      {error && <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{error}</div>}

      <div className="mb-4 p-4 bg-blue-50 border border-blue-100 rounded-xl text-sm text-blue-900">
        <p className="font-semibold">使い方</p>
        <p className="mt-1 text-blue-800">
          LINE配信のURLをこの計測リンクに差し替えると、送信時に友だちID付きURLへ自動展開されます。購入判定は Shopify の商品ID・バリアントID・SKU の安定キーで行います。
        </p>
      </div>

      {showCreate && (
        <div className="mb-6 bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h2 className="text-sm font-semibold text-gray-800 mb-4">新規計測リンク</h2>
          {createError && <div className="mb-3 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{createError}</div>}
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">リンク名 <span className="text-red-500">*</span></label>
              <input
                value={createForm.name}
                onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })}
                placeholder="例: KOJIPOP先行案内"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">遷移先URL <span className="text-red-500">*</span></label>
              <input
                value={createForm.originalUrl}
                onChange={(e) => setCreateForm({ ...createForm, originalUrl: e.target.value })}
                placeholder="https://oryzae.shop/products/..."
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              />
            </div>
          </div>
          <div className="mt-4 flex gap-2">
            <button
              type="button"
              onClick={handleCreate}
              disabled={creating}
              className="px-4 py-2 text-sm font-medium text-white rounded-lg disabled:opacity-50"
              style={{ backgroundColor: '#06C755' }}
            >
              {creating ? '作成中...' : '作成'}
            </button>
            <button
              type="button"
              onClick={() => { setShowCreate(false); setCreateError('') }}
              className="px-4 py-2 text-sm font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg"
            >
              キャンセル
            </button>
          </div>
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_460px]">
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
          {loading ? (
            <div className="p-8 text-sm text-gray-500">読み込み中...</div>
          ) : links.length === 0 ? (
            <div className="p-12 text-center text-gray-500 text-sm">計測リンクがありません。「新規リンク」から作成してください。</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px]">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200">
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">リンク</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">クリック</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">作成日</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {links.map((link) => (
                    <tr
                      key={link.id}
                      role="button"
                      tabIndex={0}
                      aria-label={`${link.name}の詳細を表示`}
                      onClick={() => { void loadDetail(link.id) }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          void loadDetail(link.id)
                        }
                      }}
                      className={`cursor-pointer hover:bg-gray-50 focus:outline-none focus-visible:bg-green-50 ${selectedLinkId === link.id ? 'bg-green-50/40' : ''}`}
                    >
                      <td className="px-4 py-3">
                        <p className="text-sm font-medium text-gray-900">{link.name}</p>
                        <p className="text-xs text-gray-400 truncate max-w-md">{link.originalUrl}</p>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-700">{link.clickCount.toLocaleString('ja-JP')}</td>
                      <td className="px-4 py-3 text-sm text-gray-500">{formatDatetime(link.createdAt)}</td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation()
                              void loadDetail(link.id)
                            }}
                            className="px-3 py-1 min-h-[44px] text-xs font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-md"
                          >
                            詳細
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation()
                              void handleDelete(link.id)
                            }}
                            className="px-3 py-1 min-h-[44px] text-xs font-medium text-red-500 bg-red-50 hover:bg-red-100 rounded-md"
                          >
                            削除
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-5 h-fit">
          {!selectedLink && !detailLoading ? (
            <div className="text-sm text-gray-500">左の一覧からリンクを選択してください。</div>
          ) : detailLoading ? (
            <div className="text-sm text-gray-500">詳細を読み込み中...</div>
          ) : selectedLink ? (
            <div className="space-y-5">
              <div>
                <h2 className="text-base font-semibold text-gray-900">{selectedLink.name}</h2>
                <p className="mt-1 text-xs text-gray-400 break-all">{selectedLink.originalUrl}</p>
              </div>

              <div className="p-3 bg-gray-50 rounded-lg">
                <label className="block text-xs font-medium text-gray-500 mb-1">配信用URL</label>
                <div className="flex gap-2">
                  <input readOnly value={selectedLink.trackingUrl} className="flex-1 border border-gray-200 rounded-md px-2 py-1.5 text-xs bg-white" />
                  <button
                    type="button"
                    onClick={() => navigator.clipboard.writeText(selectedLink.trackingUrl)}
                    className="px-3 py-1.5 text-xs font-medium text-gray-600 bg-white border border-gray-200 rounded-md hover:bg-gray-100"
                  >
                    コピー
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="p-3 rounded-lg border border-gray-100">
                  <p className="text-xs text-gray-400">クリック数</p>
                  <p className="mt-1 text-xl font-bold text-gray-900">{selectedLink.clickCount.toLocaleString('ja-JP')}</p>
                </div>
                <div className="p-3 rounded-lg border border-gray-100">
                  <p className="text-xs text-gray-400">識別済みクリック</p>
                  <p className="mt-1 text-xl font-bold text-gray-900">{identifiedClickCount.toLocaleString('ja-JP')}</p>
                </div>
              </div>

              <div className="border-t border-gray-100 pt-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-gray-800">クリックした人一覧</h3>
                    <p className="mt-1 text-xs text-gray-500">
                      friend_id が取れているクリックは個人別に集約して表示します。friend_id なしの過去クリックは個人特定できません。
                    </p>
                  </div>
                  <div className="text-right text-xs text-gray-500 shrink-0">
                    <p>識別済み {identifiedFriendCount.toLocaleString('ja-JP')}人</p>
                    {unidentifiedClickCount > 0 && <p>未識別 {unidentifiedClickCount.toLocaleString('ja-JP')}件</p>}
                  </div>
                </div>

                {clickRows.length === 0 ? (
                  <div className="mt-3 p-4 bg-gray-50 border border-gray-100 rounded-lg text-sm text-gray-500">
                    まだクリック履歴がありません。
                  </div>
                ) : (
                  <div className="mt-3 max-h-80 overflow-y-auto border border-gray-100 rounded-lg divide-y divide-gray-100">
                    {clickRows.slice(0, 100).map((row) => (
                      <div key={row.key} className="px-3 py-2 flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-gray-900 truncate">
                            {row.friendDisplayName || (row.friendId ? `友だちID: ${row.friendId}` : '未識別クリック')}
                          </p>
                          <p className="text-xs text-gray-400 truncate">
                            {row.friendId ? `friend_id: ${row.friendId}` : 'friend_id なし'} / 初回 {formatDatetime(row.firstClickedAt)}
                          </p>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-sm font-semibold text-gray-900">{row.clickCount.toLocaleString('ja-JP')}回</p>
                          <p className="text-xs text-gray-400">最終 {formatDatetime(row.lastClickedAt)}</p>
                        </div>
                      </div>
                    ))}
                    {clickRows.length > 100 && <div className="px-3 py-2 text-xs text-gray-400">他 {clickRows.length - 100}件</div>}
                  </div>
                )}
              </div>

              <div className="border-t border-gray-100 pt-5">
                <h3 className="text-sm font-semibold text-gray-800">クリック後未購入者を抽出</h3>
                <p className="mt-1 text-xs text-gray-500">商品名ではなく、商品ID・バリアントID・SKUのいずれかで突合します。</p>
                <div className="mt-3 grid gap-3">
                  <input value={matcher.productId} onChange={(e) => setMatcher({ ...matcher, productId: e.target.value })} placeholder="Shopify商品ID（例: 1234567890）" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
                  <input value={matcher.variantId} onChange={(e) => setMatcher({ ...matcher, variantId: e.target.value })} placeholder="バリアントID（任意）" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
                  <input value={matcher.sku} onChange={(e) => setMatcher({ ...matcher, sku: e.target.value })} placeholder="SKU（任意）" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">購入判定ウィンドウ（日）</label>
                    <input type="number" min={1} max={90} value={matcher.windowDays} onChange={(e) => setMatcher({ ...matcher, windowDays: Number(e.target.value) })} className="w-32 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
                  </div>
                  <button
                    type="button"
                    onClick={handleExtractNonBuyers}
                    disabled={nonBuyerLoading}
                    className="w-full px-4 py-2 text-sm font-medium text-white rounded-lg disabled:opacity-50"
                    style={{ backgroundColor: '#06C755' }}
                  >
                    {nonBuyerLoading ? '抽出中...' : '未購入者を抽出'}
                  </button>
                </div>
              </div>

              {detailError && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{detailError}</div>}
              {tagResult && <div className="p-3 bg-green-50 border border-green-200 rounded-lg text-green-700 text-sm">{tagResult}</div>}

              {nonBuyers.length > 0 && (
                <div className="border-t border-gray-100 pt-5 space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-gray-800">抽出結果</h3>
                    <span className="text-sm font-bold text-gray-900">{nonBuyers.length.toLocaleString('ja-JP')}人</span>
                  </div>

                  <div className="flex gap-2">
                    <select value={selectedTagId} onChange={(e) => setSelectedTagId(e.target.value)} className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500">
                      {tags.map((tag) => <option key={tag.id} value={tag.id}>{tag.name}</option>)}
                    </select>
                    <button
                      type="button"
                      onClick={handleTagNonBuyers}
                      disabled={tagging || !selectedTagId}
                      className="px-4 py-2 text-sm font-medium text-white rounded-lg disabled:opacity-50"
                      style={{ backgroundColor: '#06C755' }}
                    >
                      {tagging ? 'タグ付け中...' : 'タグ付け'}
                    </button>
                  </div>

                  {taggedTagId && (
                    <Link href={broadcastHref} className="block w-full px-4 py-2 text-center text-sm font-medium text-white rounded-lg" style={{ backgroundColor: '#06C755' }}>
                      「{taggedTagName}」宛の再配信を作成
                    </Link>
                  )}

                  <div className="max-h-80 overflow-y-auto border border-gray-100 rounded-lg divide-y divide-gray-100">
                    {nonBuyers.slice(0, 100).map((friend) => (
                      <div key={friend.friendId} className="px-3 py-2 flex items-center gap-3">
                        {friend.pictureUrl ? <img src={friend.pictureUrl} alt="" className="w-8 h-8 rounded-full object-cover" /> : <div className="w-8 h-8 rounded-full bg-gray-100" />}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-900 truncate">{friend.displayName ?? friend.lineUserId}</p>
                          <p className="text-xs text-gray-400">クリック {friend.clickCount}回 / 最終 {formatDatetime(friend.lastClickedAt)}</p>
                        </div>
                      </div>
                    ))}
                    {nonBuyers.length > 100 && <div className="px-3 py-2 text-xs text-gray-400">他 {nonBuyers.length - 100}人</div>}
                  </div>
                </div>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}

export default function TrackedLinksPage() {
  return (
    <Suspense fallback={<div className="p-8 text-gray-400 text-sm">読み込み中...</div>}>
      <TrackedLinksPageInner />
    </Suspense>
  )
}
