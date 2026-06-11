'use client'

import { useState, useEffect, useCallback } from 'react'
import { fermentApi, type Customer } from '@/lib/ferment-api'
import { api } from '@/lib/api'

type TagItem = { id: string; name: string; color: string }

function fmt(iso: string | null) {
  if (!iso) return '-'
  return new Date(iso).toLocaleString('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit' })
}

// 一覧でタグ列表示・タグフィルタ用に Customer に friend_tags を含む形を使う。
type CustomerWithTags = Customer & { friend_tags?: TagItem[] }

export default function CustomersPage() {
  const [customers, setCustomers] = useState<CustomerWithTags[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [regionFilter, setRegionFilter] = useState('')
  const [emailFilter, setEmailFilter] = useState<'' | 'subscribed' | 'unsubscribed'>('')
  const [tagFilter, setTagFilter] = useState('')  // タグID。空文字は「全て」
  const [offset, setOffset] = useState(0)
  const [total, setTotal] = useState(0)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<Customer | null>(null)
  const [profile, setProfile] = useState<{
    friend: { id: string; is_following: number } | null
    points: { balance: number; rank: string } | null
    friendTags: TagItem[]
    shopifyTags: string[]
    orders: { shopify_order_number: string | null; total_price: number; processed_at: string }[]
    birthday: string | null
  } | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  // タグ管理用
  const [allTags, setAllTags] = useState<TagItem[]>([])
  const [tagToAdd, setTagToAdd] = useState('')
  const [newTagName, setNewTagName] = useState('')
  const [tagBusy, setTagBusy] = useState(false)

  const LIMIT = 50

  const load = useCallback(async (off = 0) => {
    setLoading(true)
    setError('')
    try {
      const params: Parameters<typeof fermentApi.customers.list>[0] = {
        limit: LIMIT,
        offset: off,
      }
      if (regionFilter) params.region = regionFilter
      if (emailFilter === 'subscribed') params.subscribed_email = true
      if (emailFilter === 'unsubscribed') params.subscribed_email = false
      if (debouncedSearch.trim()) params.search = debouncedSearch.trim()
      if (tagFilter) params.tag_id = tagFilter
      const res = await fermentApi.customers.list(params)
      if (res.success && res.data) {
        setCustomers(res.data)
        setTotal(res.meta?.total ?? res.data.length)
      }
    } catch {
      setError('読み込みに失敗しました')
    } finally {
      setLoading(false)
    }
  }, [regionFilter, emailFilter, debouncedSearch, tagFilter])

  // 入力を300msデバウンスしてからサーバー検索（全件対象）
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300)
    return () => clearTimeout(t)
  }, [search])

  useEffect(() => {
    setOffset(0)
    load(0)
  }, [load])

  const handlePageChange = (newOffset: number) => {
    setOffset(newOffset)
    load(newOffset)
  }

  // 全タグ一覧（タグ追加プルダウン用）を初回に取得
  useEffect(() => {
    api.tags.list().then((res) => {
      if (res.success && res.data) setAllTags(res.data as TagItem[])
    }).catch(() => {})
  }, [])

  const loadProfile = useCallback(async (customerId: string) => {
    const res = await fermentApi.customers.profile(customerId)
    if (res.success && res.data) setProfile(res.data)
  }, [])

  const handleSelectCustomer = async (customer: CustomerWithTags) => {
    setSelectedId(customer.customer_id)
    setDetail(customer)
    setProfile(null)
    setTagToAdd('')
    setNewTagName('')
    setDetailLoading(true)
    try {
      await loadProfile(customer.customer_id)
    } finally {
      setDetailLoading(false)
    }
  }

  // タグを友だちに付与（既存タグ）
  const handleAddTag = async () => {
    if (!profile?.friend || !tagToAdd || !detail) return
    setTagBusy(true)
    try {
      await api.friends.addTag(profile.friend.id, tagToAdd)
      setTagToAdd('')
      await loadProfile(detail.customer_id)
    } catch {
      setError('タグの追加に失敗しました')
    } finally {
      setTagBusy(false)
    }
  }

  // 新規タグを作成して付与
  const handleCreateAndAddTag = async () => {
    if (!profile?.friend || !newTagName.trim() || !detail) return
    setTagBusy(true)
    try {
      const created = await api.tags.create({ name: newTagName.trim(), color: '#06C755' })
      if (created.success && created.data) {
        setAllTags((prev) => [...prev, created.data as TagItem])
        await api.friends.addTag(profile.friend.id, created.data.id)
        setNewTagName('')
        await loadProfile(detail.customer_id)
      }
    } catch {
      setError('タグの作成に失敗しました')
    } finally {
      setTagBusy(false)
    }
  }

  // タグを友だちから外す
  const handleRemoveTag = async (tagId: string) => {
    if (!profile?.friend || !detail) return
    setTagBusy(true)
    try {
      await api.friends.removeTag(profile.friend.id, tagId)
      await loadProfile(detail.customer_id)
    } catch {
      setError('タグの削除に失敗しました')
    } finally {
      setTagBusy(false)
    }
  }

  // サーバー側で検索・絞り込み済みなので、そのまま表示する
  const displayed = customers

  return (
    <div className="max-w-7xl mx-auto py-8 px-4">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">LINE顧客</h1>
        <p className="text-sm text-gray-500 mt-1">LINE公式アカウント登録者の顧客プロファイル</p>
      </div>

      {error && <div className="mb-4 p-3 bg-red-50 text-red-600 rounded-lg text-sm">{error}</div>}

      {/* フィルター */}
      <div className="flex flex-wrap gap-3 mb-4">
        <input
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm w-56"
          placeholder="名前・メール・LINE IDで検索（全件）"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm"
          value={regionFilter}
          onChange={(e) => setRegionFilter(e.target.value)}
        >
          <option value="">地域：全て</option>
          <option value="JP">JP</option>
          <option value="US">US</option>
        </select>
        <select
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm"
          value={emailFilter}
          onChange={(e) => setEmailFilter(e.target.value as typeof emailFilter)}
        >
          <option value="">メール：全て</option>
          <option value="subscribed">購読中</option>
          <option value="unsubscribed">未購読</option>
        </select>
        <select
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm"
          value={tagFilter}
          onChange={(e) => setTagFilter(e.target.value)}
          aria-label="タグで絞り込み"
        >
          <option value="">タグ：全て</option>
          {allTags.map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>
        <span className="text-sm text-gray-400 self-center ml-auto">
          {total.toLocaleString()}件
        </span>
      </div>

      <div className="flex gap-4">
        {/* 一覧 */}
        <div className="flex-1 min-w-0">
          {loading ? (
            <div className="text-center py-12 text-gray-400">読み込み中...</div>
          ) : displayed.length === 0 ? (
            <div className="text-center py-12 text-gray-400">顧客が見つかりません</div>
          ) : (
            <>
              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      <th className="text-left px-4 py-3 font-medium text-gray-600">顧客</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-600 hidden sm:table-cell">地域</th>
                      <th className="text-right px-4 py-3 font-medium text-gray-600">LTV</th>
                      <th className="text-right px-4 py-3 font-medium text-gray-600 hidden md:table-cell">注文数</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-600 hidden lg:table-cell">最終注文</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-600 hidden lg:table-cell">タグ</th>
                      <th className="text-center px-4 py-3 font-medium text-gray-600">メール</th>
                    </tr>
                  </thead>
                  <tbody>
                    {displayed.map((c, i) => (
                      <tr
                        key={c.customer_id}
                        onClick={() => handleSelectCustomer(c)}
                        className={`cursor-pointer transition-colors ${
                          selectedId === c.customer_id
                            ? 'bg-green-50'
                            : i % 2 === 0 ? 'hover:bg-gray-50' : 'bg-gray-50 hover:bg-gray-100'
                        }`}
                      >
                        <td className="px-4 py-2.5">
                          <div className="font-medium text-gray-900 truncate max-w-[180px]">
                            {c.display_name ?? '(名前なし)'}
                          </div>
                          <div className="text-xs text-gray-400 truncate">{c.email ?? '-'}</div>
                        </td>
                        <td className="px-4 py-2.5 hidden sm:table-cell">
                          <span className="text-xs bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">{c.region}</span>
                        </td>
                        <td className="px-4 py-2.5 text-right text-gray-700 font-medium">
                          ¥{c.ltv.toLocaleString()}
                        </td>
                        <td className="px-4 py-2.5 text-right text-gray-500 hidden md:table-cell">
                          {c.order_count}
                        </td>
                        <td className="px-4 py-2.5 text-gray-500 hidden lg:table-cell text-sm">
                          {fmt(c.last_order_at)}
                        </td>
                        <td className="px-4 py-2.5 hidden lg:table-cell">
                          {c.friend_tags && c.friend_tags.length > 0 ? (
                            <div className="flex flex-wrap gap-1 max-w-[220px]">
                              {c.friend_tags.slice(0, 3).map((t) => (
                                <span
                                  key={t.id}
                                  className="inline-block px-1.5 py-0.5 rounded-full text-[10px] font-medium text-white whitespace-nowrap"
                                  style={{ backgroundColor: t.color }}
                                  title={t.name}
                                >
                                  {t.name}
                                </span>
                              ))}
                              {c.friend_tags.length > 3 && (
                                <span className="text-[10px] text-gray-500 self-center">+{c.friend_tags.length - 3}</span>
                              )}
                            </div>
                          ) : (
                            <span className="text-xs text-gray-300">-</span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-center">
                          <span className={`inline-block w-2 h-2 rounded-full ${c.subscribed_email ? 'bg-green-400' : 'bg-gray-300'}`} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* ページネーション */}
              {total > LIMIT && (
                <div className="flex justify-center gap-2 mt-4">
                  <button
                    onClick={() => handlePageChange(Math.max(0, offset - LIMIT))}
                    disabled={offset === 0}
                    className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg disabled:opacity-40 hover:bg-gray-50"
                  >
                    ← 前へ
                  </button>
                  <span className="text-sm text-gray-500 self-center">
                    {offset + 1}–{Math.min(offset + LIMIT, total)} / {total}
                  </span>
                  <button
                    onClick={() => handlePageChange(offset + LIMIT)}
                    disabled={offset + LIMIT >= total}
                    className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg disabled:opacity-40 hover:bg-gray-50"
                  >
                    次へ →
                  </button>
                </div>
              )}
            </>
          )}
        </div>

        {/* 顧客詳細パネル */}
        {detail && (
          <div className="w-80 shrink-0 bg-white border border-gray-200 rounded-xl p-4 self-start sticky top-4">
            <div className="flex justify-between items-start mb-3">
              <h3 className="font-semibold text-gray-900">{detail.display_name ?? '(名前なし)'}</h3>
              <button onClick={() => { setDetail(null); setSelectedId(null) }} className="text-gray-400 hover:text-gray-600 text-lg leading-none">×</button>
            </div>

            <div className="space-y-1.5 text-sm mb-4">
              <div className="flex justify-between">
                <span className="text-gray-500">LINE ID</span>
                <span className="text-gray-800 truncate ml-2 max-w-[170px] text-xs" title={detail.line_user_id ?? ''}>{detail.line_user_id ?? '-'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">フォロー状態</span>
                <span className={profile?.friend?.is_following ? 'text-green-600' : 'text-gray-400'}>
                  {profile?.friend ? (profile.friend.is_following ? '友だち' : 'ブロック/解除') : '-'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">誕生日</span>
                <span className="text-gray-800">{profile?.birthday ?? '-'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">ポイント</span>
                <span className="text-gray-800">{profile?.points ? `${profile.points.balance.toLocaleString()}pt（${profile.points.rank}）` : '-'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">地域</span>
                <span className="text-gray-800">{detail.region}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">累計購入額(LTV)</span>
                <span className="text-gray-800 font-medium">¥{detail.ltv.toLocaleString()}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">注文数</span>
                <span className="text-gray-800">{detail.order_count}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">メール</span>
                <span className="text-gray-800 truncate ml-2 max-w-[160px]">{detail.email ?? '-'}</span>
              </div>
            </div>

            {/* タグ管理（LINE友だちタグ） */}
            <div className="border-t border-gray-100 pt-3 mb-3">
              <h4 className="text-xs font-semibold text-gray-600 mb-2 uppercase tracking-wide">タグ管理</h4>
              {!profile ? (
                <p className="text-xs text-gray-400">読み込み中...</p>
              ) : !profile.friend ? (
                <p className="text-xs text-gray-400">LINE連携がないためタグを付けられません</p>
              ) : (
                <>
                  {/* 付与済みタグ（×で削除） */}
                  {profile.friendTags.length === 0 ? (
                    <p className="text-xs text-gray-400 mb-2">タグなし</p>
                  ) : (
                    <div className="flex flex-wrap gap-1 mb-2">
                      {profile.friendTags.map((t) => (
                        <span
                          key={t.id}
                          className="inline-flex items-center gap-1 text-[11px] text-white px-1.5 py-0.5 rounded"
                          style={{ backgroundColor: t.color || '#06C755' }}
                        >
                          {t.name}
                          <button
                            onClick={() => handleRemoveTag(t.id)}
                            disabled={tagBusy}
                            className="leading-none hover:opacity-70 disabled:opacity-40"
                            title="タグを外す"
                          >
                            ×
                          </button>
                        </span>
                      ))}
                    </div>
                  )}

                  {/* 既存タグを追加 */}
                  <div className="flex gap-1 mb-1.5">
                    <select
                      value={tagToAdd}
                      onChange={(e) => setTagToAdd(e.target.value)}
                      disabled={tagBusy}
                      className="flex-1 min-w-0 border border-gray-300 rounded px-1.5 py-1 text-xs"
                    >
                      <option value="">タグを選んで追加…</option>
                      {allTags
                        .filter((t) => !profile.friendTags.some((ft) => ft.id === t.id))
                        .map((t) => (
                          <option key={t.id} value={t.id}>{t.name}</option>
                        ))}
                    </select>
                    <button
                      onClick={handleAddTag}
                      disabled={tagBusy || !tagToAdd}
                      className="text-xs bg-green-600 text-white px-2 py-1 rounded disabled:opacity-40 hover:bg-green-700 shrink-0"
                    >
                      追加
                    </button>
                  </div>

                  {/* 新規タグを作成して追加 */}
                  <div className="flex gap-1">
                    <input
                      value={newTagName}
                      onChange={(e) => setNewTagName(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') handleCreateAndAddTag() }}
                      disabled={tagBusy}
                      placeholder="新しいタグ名を作成"
                      className="flex-1 min-w-0 border border-gray-300 rounded px-1.5 py-1 text-xs"
                    />
                    <button
                      onClick={handleCreateAndAddTag}
                      disabled={tagBusy || !newTagName.trim()}
                      className="text-xs border border-green-600 text-green-700 px-2 py-1 rounded disabled:opacity-40 hover:bg-green-50 shrink-0"
                    >
                      作成
                    </button>
                  </div>
                </>
              )}

              {/* Shopifyタグ（読み取り専用） */}
              {profile && profile.shopifyTags.length > 0 && (
                <div className="mt-3">
                  <p className="text-[10px] text-gray-400 mb-1">Shopifyタグ（自動・編集不可）</p>
                  <div className="flex flex-wrap gap-1">
                    {profile.shopifyTags.map((t) => (
                      <span key={t} className="text-[11px] bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">{t}</span>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* 購入履歴 */}
            <div className="border-t border-gray-100 pt-3">
              <h4 className="text-xs font-semibold text-gray-600 mb-2 uppercase tracking-wide">購入履歴</h4>
              {detailLoading ? (
                <p className="text-xs text-gray-400 py-2">読み込み中...</p>
              ) : !profile || profile.orders.length === 0 ? (
                <p className="text-xs text-gray-400 py-2">購入履歴なし</p>
              ) : (
                <div className="space-y-1.5 max-h-64 overflow-y-auto">
                  {profile.orders.map((o, i) => (
                    <div key={(o.shopify_order_number ?? '') + i} className="text-xs flex justify-between items-center gap-2">
                      <span className="text-gray-700">{o.shopify_order_number ? `#${o.shopify_order_number}` : '注文'}</span>
                      <span className="text-gray-800 font-medium">¥{Math.round(o.total_price).toLocaleString()}</span>
                      <span className="text-gray-400 shrink-0">{fmt(o.processed_at)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
