'use client'

import { useState, useEffect, useCallback } from 'react'
import type { Tag } from '@line-crm/shared'
import { api } from '@/lib/api'
import type { FriendWithTags, LineOfficialFriendInsightSummary } from '@/lib/api'
import Header from '@/components/layout/header'
import FriendTable from '@/components/friends/friend-table'
import CcPromptButton from '@/components/cc-prompt-button'
import { useAccount } from '@/contexts/account-context'

const ccPrompts = [
  {
    title: '友だちのセグメント分析',
    prompt: `友だち一覧のデータを分析してください。
1. タグ別の友だち数を集計
2. アクティブ率の高いセグメントを特定
3. エンゲージメントが低い層への施策を提案
レポート形式で出力してください。`,
  },
  {
    title: 'タグ一括管理',
    prompt: `友だちのタグを一括管理してください。
1. 未タグの友だちを特定
2. 行動履歴に基づいたタグ付け提案
3. 不要タグの整理
作業手順を示してください。`,
  },
]

const PAGE_SIZE = 20

export default function FriendsPage() {
  const { selectedAccountId, selectedAccount } = useAccount()
  const [friends, setFriends] = useState<FriendWithTags[]>([])
  const [allTags, setAllTags] = useState<Tag[]>([])
  const [total, setTotal] = useState(0)
  const [followingCount, setFollowingCount] = useState<number | null>(null)
  const [officialInsight, setOfficialInsight] = useState<LineOfficialFriendInsightSummary | null>(null)
  const [page, setPage] = useState(1)
  const [hasNextPage, setHasNextPage] = useState(false)
  const [selectedTagId, setSelectedTagId] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [insightLoading, setInsightLoading] = useState(false)
  const [error, setError] = useState('')
  const [insightError, setInsightError] = useState('')

  const loadTags = useCallback(async () => {
    try {
      const res = await api.tags.list()
      if (res.success) setAllTags(res.data)
    } catch {
      // Non-blocking — tags used for filter
    }
  }, [])

  const loadFriends = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    setError('')
    try {
      const params: Record<string, string> = {
        offset: String((page - 1) * PAGE_SIZE),
        limit: String(PAGE_SIZE),
      }
      if (selectedTagId) params.tagId = selectedTagId
      if (selectedAccountId) params.accountId = selectedAccountId
      if (searchQuery.trim()) params.search = searchQuery.trim()

      const res = await api.friends.list(params)
      if (res.success) {
        setFriends(res.data.items)
        setTotal(res.data.total)
        setHasNextPage(res.data.hasNextPage)
      } else {
        setError(res.error)
      }
    } catch {
      setError('友だちの読み込みに失敗しました。もう一度お試しください。')
    } finally {
      if (!silent) setLoading(false)
    }
  }, [page, selectedTagId, selectedAccountId, searchQuery])

  const loadCounts = useCallback(async () => {
    setInsightError('')
    try {
      const [countRes, insightRes] = await Promise.all([
        api.friends.count({ accountId: selectedAccountId ?? undefined }),
        api.friends.officialInsightLatest({ accountId: selectedAccountId ?? undefined }),
      ])
      if (countRes.success) setFollowingCount(countRes.data.count)
      if (insightRes.success) setOfficialInsight(insightRes.data)
    } catch {
      setInsightError('公式値の読み込みに失敗しました。')
    }
  }, [selectedAccountId])

  const refreshOfficialInsight = useCallback(async () => {
    setInsightLoading(true)
    setInsightError('')
    try {
      const fetchRes = await api.friends.fetchOfficialInsight({ accountId: selectedAccountId ?? undefined })
      if (!fetchRes.success) {
        setInsightError(fetchRes.error)
        return
      }
      await loadCounts()
    } catch {
      setInsightError('LINE公式値の取得に失敗しました。')
    } finally {
      setInsightLoading(false)
    }
  }, [loadCounts, selectedAccountId])

  useEffect(() => {
    loadTags()
  }, [loadTags])

  useEffect(() => {
    setPage(1)
  }, [selectedTagId, selectedAccountId, searchQuery])

  useEffect(() => {
    loadFriends()
  }, [loadFriends])

  useEffect(() => {
    loadCounts()
  }, [loadCounts])

  const handleTagFilter = (tagId: string) => {
    setSelectedTagId(tagId)
  }

  const formatInsightDate = (date: string | null) => {
    if (!date || date.length !== 8) return '未取得'
    return `${date.slice(0, 4)}/${date.slice(4, 6)}/${date.slice(6, 8)}`
  }

  return (
    <div>
      <Header title="友だち管理" />

      <div className="mb-4 bg-white border border-gray-200 rounded-lg p-4 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-xs font-medium text-gray-500">LINE公式値</p>
            <div className="mt-1 flex flex-wrap items-baseline gap-x-5 gap-y-2">
              <div>
                <span className="text-2xl font-semibold text-gray-900">
                  {officialInsight?.targetedReaches == null ? '-' : officialInsight.targetedReaches.toLocaleString('ja-JP')}
                </span>
                <span className="ml-1 text-sm text-gray-600">ターゲットリーチ</span>
              </div>
              <div className="text-sm text-gray-600">
                友だち追加 {officialInsight?.followers == null ? '-' : officialInsight.followers.toLocaleString('ja-JP')}
              </div>
              <div className="text-sm text-gray-600">
                ブロック {officialInsight?.blocks == null ? '-' : officialInsight.blocks.toLocaleString('ja-JP')}
              </div>
            </div>
            <p className="mt-1 text-xs text-gray-500">
              {selectedAccount?.name ?? '選択中のアカウント'} / 集計日 {formatInsightDate(officialInsight?.date ?? null)}
              {officialInsight?.fetchedAt ? ` / 取得 ${new Date(officialInsight.fetchedAt).toLocaleString('ja-JP')}` : ''}
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="text-sm text-gray-600">
              ハーネスDB: {followingCount == null ? '-' : followingCount.toLocaleString('ja-JP')} 件
            </div>
            <button
              type="button"
              onClick={refreshOfficialInsight}
              disabled={insightLoading}
              className="px-3 py-2 min-h-[44px] text-sm bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 whitespace-nowrap"
            >
              {insightLoading ? '取得中...' : 'LINE公式から取得'}
            </button>
          </div>
        </div>
        {insightError && (
          <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
            {insightError}
          </div>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3 mb-4">
        <form
          onSubmit={(e) => {
            e.preventDefault()
            setSearchQuery(searchInput)
          }}
          className="flex items-center gap-2 flex-1 sm:flex-none"
        >
          <input
            type="search"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="名前またはLINE UIDで検索"
            className="text-sm border border-gray-300 rounded-lg px-3 py-2 min-h-[44px] bg-white focus:outline-none focus:ring-2 focus:ring-green-500 w-full sm:w-64"
          />
          <button
            type="submit"
            className="px-3 py-2 min-h-[44px] text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors whitespace-nowrap"
          >
            検索
          </button>
          {searchQuery && (
            <button
              type="button"
              onClick={() => {
                setSearchInput('')
                setSearchQuery('')
              }}
              className="px-3 py-2 min-h-[44px] text-sm text-gray-600 hover:text-gray-900 whitespace-nowrap"
            >
              クリア
            </button>
          )}
        </form>
        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-600 font-medium whitespace-nowrap">タグで絞り込み:</label>
          <select
            className="text-sm border border-gray-300 rounded-lg px-3 py-2 min-h-[44px] bg-white focus:outline-none focus:ring-2 focus:ring-green-500 flex-1 sm:flex-none"
            value={selectedTagId}
            onChange={(e) => handleTagFilter(e.target.value)}
          >
            <option value="">すべて</option>
            {allTags.map((tag) => (
              <option key={tag.id} value={tag.id}>{tag.name}</option>
            ))}
          </select>
        </div>
        <span className="text-sm text-gray-500">
          {loading ? '読み込み中...' : `${total.toLocaleString('ja-JP')} 件`}
        </span>
      </div>

      {/* Error */}
      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          {error}
        </div>
      )}

      {/* Loading skeleton */}
      {loading ? (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="px-4 py-4 border-b border-gray-100 flex items-center gap-4 animate-pulse">
              <div className="w-9 h-9 rounded-full bg-gray-200" />
              <div className="flex-1 space-y-2">
                <div className="h-3 bg-gray-200 rounded w-32" />
                <div className="h-2 bg-gray-100 rounded w-20" />
              </div>
              <div className="h-5 bg-gray-100 rounded-full w-16" />
              <div className="h-5 bg-gray-100 rounded-full w-12" />
              <div className="h-3 bg-gray-100 rounded w-20" />
            </div>
          ))}
        </div>
      ) : (
        <FriendTable
          friends={friends}
          allTags={allTags}
          onRefresh={() => loadFriends(true)}
        />
      )}

      {/* Pagination */}
      {!loading && total > 0 && (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between mt-4">
          <p className="text-sm text-gray-500">
            {((page - 1) * PAGE_SIZE) + 1}〜{Math.min(page * PAGE_SIZE, total)} 件 / 全{total.toLocaleString('ja-JP')}件
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="px-3 py-2 min-h-[44px] text-sm border border-gray-300 rounded-lg bg-white hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              前へ
            </button>
            <span className="text-sm text-gray-600 px-1">{page} ページ</span>
            <button
              onClick={() => setPage((p) => p + 1)}
              disabled={!hasNextPage}
              className="px-3 py-2 min-h-[44px] text-sm border border-gray-300 rounded-lg bg-white hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              次へ
            </button>
          </div>
        </div>
      )}

      <CcPromptButton prompts={ccPrompts} />
    </div>
  )
}
