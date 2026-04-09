'use client'

import { useState, useEffect, useCallback } from 'react'
import Header from '@/components/layout/header'
import { fetchApi } from '@/lib/api'

type LoyaltyRank = 'レギュラー' | 'シルバー' | 'ゴールド' | 'プラチナ' | 'ダイヤモンド'

interface LoyaltyPoint {
  id: string
  friend_id: string
  balance: number
  total_spent: number
  rank: LoyaltyRank
  shopify_customer_id: string | null
  display_name: string | null
  picture_url: string | null
  updated_at: string
}

interface LoyaltyTransaction {
  id: string
  type: 'award' | 'redeem' | 'adjust' | 'expire'
  points: number
  balance_after: number
  reason: string | null
  order_id: string | null
  created_at: string
}

interface Stats {
  total: number
  byRank: Record<LoyaltyRank, number>
  totalPointsAwarded: number
  totalPointsRedeemed: number
}

const RANK_COLORS: Record<LoyaltyRank, string> = {
  'レギュラー':   'bg-gray-100 text-gray-700',
  'シルバー':     'bg-slate-100 text-slate-700',
  'ゴールド':     'bg-yellow-100 text-yellow-800',
  'プラチナ':     'bg-purple-100 text-purple-800',
  'ダイヤモンド': 'bg-blue-100 text-blue-800',
}

const TX_TYPE_LABELS: Record<string, { label: string; color: string }> = {
  award:  { label: '付与', color: 'text-green-700' },
  redeem: { label: '交換', color: 'text-red-600' },
  adjust: { label: '調整', color: 'text-blue-600' },
  expire: { label: '失効', color: 'text-gray-500' },
}

const RANKS: LoyaltyRank[] = ['レギュラー', 'シルバー', 'ゴールド', 'プラチナ', 'ダイヤモンド']

function RankBadge({ rank }: { rank: LoyaltyRank }) {
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${RANK_COLORS[rank]}`}>
      {rank}
    </span>
  )
}

function Avatar({ name, pictureUrl, size = 36 }: { name: string | null; pictureUrl: string | null; size?: number }) {
  if (pictureUrl) {
    return (
      <img
        src={pictureUrl}
        alt={name ?? ''}
        className="rounded-full object-cover shrink-0"
        style={{ width: size, height: size }}
      />
    )
  }
  return (
    <div
      className="rounded-full flex items-center justify-center text-white font-bold shrink-0"
      style={{ width: size, height: size, backgroundColor: '#06C755', fontSize: size * 0.4 }}
    >
      {(name ?? '?').charAt(0)}
    </div>
  )
}

// ─── 詳細モーダル ───

function DetailModal({
  point,
  onClose,
  onAdjusted,
}: {
  point: LoyaltyPoint
  onClose: () => void
  onAdjusted: () => void
}) {
  const [transactions, setTransactions] = useState<LoyaltyTransaction[]>([])
  const [txTotal, setTxTotal] = useState(0)
  const [txLoading, setTxLoading] = useState(true)

  // Adjust form
  const [adjustPoints, setAdjustPoints] = useState('')
  const [adjustReason, setAdjustReason] = useState('')
  const [adjustLoading, setAdjustLoading] = useState(false)
  const [adjustError, setAdjustError] = useState('')
  const [adjustSuccess, setAdjustSuccess] = useState('')

  useEffect(() => {
    const load = async () => {
      setTxLoading(true)
      try {
        const res = await fetchApi<{ success: boolean; data: { items: LoyaltyTransaction[]; total: number } }>(
          `/api/loyalty/${point.friend_id}/transactions?limit=20`,
        )
        if (res.success) {
          setTransactions(res.data.items)
          setTxTotal(res.data.total)
        }
      } finally {
        setTxLoading(false)
      }
    }
    load()
  }, [point.friend_id])

  const handleAdjust = async (e: React.FormEvent) => {
    e.preventDefault()
    const pts = parseInt(adjustPoints, 10)
    if (isNaN(pts) || pts === 0) {
      setAdjustError('ポイント数を入力してください（0以外）')
      return
    }
    if (!adjustReason.trim()) {
      setAdjustError('理由を入力してください')
      return
    }
    setAdjustLoading(true)
    setAdjustError('')
    setAdjustSuccess('')
    try {
      const res = await fetchApi<{ success: boolean; error?: string }>(
        `/api/loyalty/${point.friend_id}/adjust`,
        {
          method: 'POST',
          body: JSON.stringify({ points: pts, reason: adjustReason.trim() }),
        },
      )
      if (res.success) {
        setAdjustSuccess('ポイントを調整しました')
        setAdjustPoints('')
        setAdjustReason('')
        onAdjusted()
      } else {
        setAdjustError(res.error ?? '調整に失敗しました')
      }
    } catch {
      setAdjustError('調整に失敗しました')
    } finally {
      setAdjustLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ヘッダー */}
        <div className="flex items-center gap-3 px-6 py-4 border-b border-gray-100">
          <Avatar name={point.display_name} pictureUrl={point.picture_url} size={40} />
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-gray-900 truncate">{point.display_name ?? '名前なし'}</p>
            <div className="flex items-center gap-2 mt-0.5">
              <RankBadge rank={point.rank} />
              <span className="text-xs text-gray-400">累計 ¥{point.total_spent.toLocaleString('ja-JP')}</span>
            </div>
          </div>
          <div className="text-right shrink-0">
            <p className="text-2xl font-bold text-gray-900">{point.balance.toLocaleString('ja-JP')}</p>
            <p className="text-xs text-gray-400">pt</p>
          </div>
          <button
            onClick={onClose}
            className="ml-2 w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-400 shrink-0"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="overflow-y-auto flex-1 px-6 py-4 space-y-5">
          {/* 手動調整フォーム */}
          <div className="bg-gray-50 rounded-xl p-4">
            <p className="text-sm font-semibold text-gray-800 mb-3">ポイント手動調整</p>
            <form onSubmit={handleAdjust} className="space-y-3">
              <div className="flex gap-2">
                <div className="flex-1">
                  <label className="block text-xs text-gray-600 mb-1">ポイント数（マイナス可）</label>
                  <input
                    type="number"
                    value={adjustPoints}
                    onChange={(e) => setAdjustPoints(e.target.value)}
                    placeholder="例: 100 または -50"
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs text-gray-600 mb-1">理由 *</label>
                <input
                  type="text"
                  value={adjustReason}
                  onChange={(e) => setAdjustReason(e.target.value)}
                  placeholder="例: キャンペーン特典、返品対応"
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
                />
              </div>
              {adjustError && <p className="text-xs text-red-600">{adjustError}</p>}
              {adjustSuccess && <p className="text-xs text-green-700">{adjustSuccess}</p>}
              <button
                type="submit"
                disabled={adjustLoading}
                className="px-4 py-2 text-sm font-medium text-white rounded-lg disabled:opacity-50 transition-opacity hover:opacity-90"
                style={{ backgroundColor: '#06C755' }}
              >
                {adjustLoading ? '調整中...' : '調整する'}
              </button>
            </form>
          </div>

          {/* 取引履歴 */}
          <div>
            <p className="text-sm font-semibold text-gray-800 mb-2">
              取引履歴{txTotal > 0 && <span className="text-gray-400 font-normal ml-1">（全{txTotal}件）</span>}
            </p>
            {txLoading ? (
              <div className="space-y-2">
                {[...Array(3)].map((_, i) => (
                  <div key={i} className="h-10 bg-gray-100 rounded animate-pulse" />
                ))}
              </div>
            ) : transactions.length === 0 ? (
              <p className="text-sm text-gray-400 py-4 text-center">取引履歴がありません</p>
            ) : (
              <div className="divide-y divide-gray-100">
                {transactions.map((tx) => {
                  const meta = TX_TYPE_LABELS[tx.type]
                  const isPositive = tx.points > 0
                  return (
                    <div key={tx.id} className="py-2.5 flex items-start gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-gray-700 truncate">{tx.reason ?? '—'}</p>
                        <p className="text-xs text-gray-400">{tx.created_at.replace('T', ' ').slice(0, 16)}</p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className={`text-sm font-semibold ${isPositive ? 'text-green-700' : 'text-red-600'}`}>
                          {isPositive ? '+' : ''}{tx.points.toLocaleString('ja-JP')} pt
                        </p>
                        <p className={`text-xs ${meta.color}`}>{meta.label}</p>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── メインページ ───

const PAGE_SIZE = 20

export default function LoyaltyPage() {
  const [stats, setStats] = useState<Stats | null>(null)
  const [items, setItems] = useState<LoyaltyPoint[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [hasNext, setHasNext] = useState(false)
  const [rankFilter, setRankFilter] = useState('')
  const [search, setSearch] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState<LoyaltyPoint | null>(null)

  const loadStats = useCallback(async () => {
    try {
      const res = await fetchApi<{ success: boolean; data: Stats }>('/api/loyalty/stats')
      if (res.success) setStats(res.data)
    } catch { /* non-blocking */ }
  }, [])

  const loadItems = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String((page - 1) * PAGE_SIZE),
      })
      if (rankFilter) params.set('rank', rankFilter)
      if (search) params.set('search', search)

      const res = await fetchApi<{ success: boolean; data: { items: LoyaltyPoint[]; total: number }; error?: string }>(
        `/api/loyalty?${params.toString()}`,
      )
      if (res.success) {
        setItems(res.data.items)
        setTotal(res.data.total)
        setHasNext(res.data.items.length === PAGE_SIZE && page * PAGE_SIZE < res.data.total)
      } else {
        setError(res.error ?? '読み込みに失敗しました')
      }
    } catch {
      setError('読み込みに失敗しました')
    } finally {
      setLoading(false)
    }
  }, [page, rankFilter, search])

  useEffect(() => { loadStats() }, [loadStats])
  useEffect(() => { setPage(1) }, [rankFilter, search])
  useEffect(() => { loadItems() }, [loadItems])

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    setSearch(searchInput)
  }

  const handleAdjusted = () => {
    loadStats()
    loadItems()
    // モーダルを開いたまま、残高を最新に反映するため再取得後にselectedを更新
    if (selected) {
      fetchApi<{ success: boolean; data: LoyaltyPoint }>(`/api/loyalty/${selected.friend_id}`)
        .then((res) => { if (res.success) setSelected(res.data) })
        .catch(() => {})
    }
  }

  return (
    <div>
      <Header title="ロイヤルティ" />

      {/* サマリーカード */}
      {stats && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 mb-6">
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-xs text-gray-500 mb-1">会員数</p>
            <p className="text-2xl font-bold text-gray-900">{stats.total.toLocaleString('ja-JP')}</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-xs text-gray-500 mb-1">付与累計</p>
            <p className="text-2xl font-bold text-green-700">{stats.totalPointsAwarded.toLocaleString('ja-JP')} pt</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-xs text-gray-500 mb-1">交換累計</p>
            <p className="text-2xl font-bold text-red-600">{stats.totalPointsRedeemed.toLocaleString('ja-JP')} pt</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-xs text-gray-500 mb-2">ランク内訳</p>
            <div className="space-y-1">
              {RANKS.slice().reverse().map((rank) => (
                <div key={rank} className="flex items-center justify-between">
                  <span className={`text-xs px-1.5 py-0.5 rounded ${RANK_COLORS[rank]}`}>{rank}</span>
                  <span className="text-xs font-medium text-gray-700">{(stats.byRank[rank] ?? 0).toLocaleString('ja-JP')}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* フィルター */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3 mb-4">
        <form onSubmit={handleSearch} className="flex gap-2 flex-1">
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="名前で検索..."
            className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
          />
          <button
            type="submit"
            className="px-3 py-2 text-sm font-medium text-white rounded-lg hover:opacity-90"
            style={{ backgroundColor: '#06C755' }}
          >
            検索
          </button>
          {search && (
            <button
              type="button"
              onClick={() => { setSearch(''); setSearchInput('') }}
              className="px-3 py-2 text-sm text-gray-500 border border-gray-300 rounded-lg hover:bg-gray-50"
            >
              クリア
            </button>
          )}
        </form>
        <select
          value={rankFilter}
          onChange={(e) => setRankFilter(e.target.value)}
          className="text-sm border border-gray-300 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-green-500"
        >
          <option value="">全ランク</option>
          {RANKS.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        <span className="text-sm text-gray-500 whitespace-nowrap">
          {loading ? '読み込み中...' : `${total.toLocaleString('ja-JP')} 件`}
        </span>
      </div>

      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{error}</div>
      )}

      {/* テーブル */}
      {loading ? (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="px-4 py-4 border-b border-gray-100 flex items-center gap-4 animate-pulse">
              <div className="w-9 h-9 rounded-full bg-gray-200 shrink-0" />
              <div className="flex-1 space-y-2">
                <div className="h-3 bg-gray-200 rounded w-28" />
                <div className="h-2 bg-gray-100 rounded w-16" />
              </div>
              <div className="h-5 bg-gray-100 rounded-full w-16" />
              <div className="h-4 bg-gray-100 rounded w-20" />
              <div className="h-4 bg-gray-100 rounded w-16" />
            </div>
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-12 text-center">
          <p className="text-gray-400 text-sm">該当する会員がいません</p>
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">会員</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">ランク</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">残高</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider hidden sm:table-cell">累計購入額</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider hidden md:table-cell">更新日</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {items.map((item) => (
                <tr
                  key={item.id}
                  className="hover:bg-gray-50 transition-colors cursor-pointer"
                  onClick={() => setSelected(item)}
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <Avatar name={item.display_name} pictureUrl={item.picture_url} size={32} />
                      <span className="font-medium text-gray-900 truncate max-w-[120px]">
                        {item.display_name ?? '名前なし'}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <RankBadge rank={item.rank} />
                  </td>
                  <td className="px-4 py-3 text-right font-semibold text-gray-900">
                    {item.balance.toLocaleString('ja-JP')} pt
                  </td>
                  <td className="px-4 py-3 text-right text-gray-500 hidden sm:table-cell">
                    ¥{item.total_spent.toLocaleString('ja-JP')}
                  </td>
                  <td className="px-4 py-3 text-gray-400 text-xs hidden md:table-cell">
                    {item.updated_at.slice(0, 10)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={(e) => { e.stopPropagation(); setSelected(item) }}
                      className="px-2.5 py-1 text-xs font-medium text-gray-600 bg-white border border-gray-300 rounded hover:bg-gray-50 transition-colors"
                    >
                      詳細
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ページネーション */}
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
              disabled={!hasNext}
              className="px-3 py-2 min-h-[44px] text-sm border border-gray-300 rounded-lg bg-white hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              次へ
            </button>
          </div>
        </div>
      )}

      {/* 詳細モーダル */}
      {selected && (
        <DetailModal
          point={selected}
          onClose={() => setSelected(null)}
          onAdjusted={handleAdjusted}
        />
      )}
    </div>
  )
}
