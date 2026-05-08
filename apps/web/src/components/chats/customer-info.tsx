'use client'

import { useEffect, useState } from 'react'
import { fetchApi } from '@/lib/api'

interface CustomerInfoProps {
  friendId: string
  friendName: string
  friendPictureUrl: string | null
  friendEmail?: string | null
  chatStatus: string
  onClose: () => void
}

interface FriendDetail {
  id: string
  displayName: string | null
  pictureUrl: string | null
  tags: string[]
  language: string | null
  isFollowing: boolean
  createdAt: string
  updatedAt: string
}

interface LoyaltyData {
  balance: number
  rank: string
  total_spent: number
}

interface OrderSummary {
  total_orders: number
  total_spent: number
  first_order_at: string | null
  last_order_at: string | null
  completed_orders: number
}

interface RecentItem {
  title: string
  quantity: number
  price: number
  processed_at: string
}

const yen = (n: number) => '¥' + Math.round(n).toLocaleString('ja-JP')
const daysAgo = (iso: string | null): string => {
  if (!iso) return '—'
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)
  if (days === 0) return '今日'
  if (days === 1) return '昨日'
  return `${days}日前`
}

export default function CustomerInfoPanel({ friendId, friendName, friendPictureUrl, friendEmail, chatStatus, onClose }: CustomerInfoProps) {
  const [friend, setFriend] = useState<FriendDetail | null>(null)
  const [loyalty, setLoyalty] = useState<LoyaltyData | null>(null)
  const [orders, setOrders] = useState<OrderSummary | null>(null)
  const [recentItems, setRecentItems] = useState<RecentItem[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    const load = async () => {
      try {
        const [friendRes, loyaltyRes, orderRes] = await Promise.all([
          fetchApi<{ success: boolean; data: FriendDetail }>(`/api/friends/${friendId}`),
          fetchApi<{ success: boolean; data: LoyaltyData }>(`/api/loyalty/${friendId}`).catch(() => ({ success: false as const, data: null })),
          fetchApi<{ success: boolean; data: { summary: OrderSummary; recent_items: RecentItem[] } }>(`/api/shopify/orders/customer-summary/${friendId}`).catch(() => ({ success: false as const, data: null })),
        ])
        if (cancelled) return
        if (friendRes.success) setFriend(friendRes.data)
        if (loyaltyRes.success && loyaltyRes.data) setLoyalty(loyaltyRes.data)
        if (orderRes.success && orderRes.data) { setOrders(orderRes.data.summary); setRecentItems(orderRes.data.recent_items) }
      } catch { /* silent */ }
      setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [friendId])

  const statusLabel: Record<string, { label: string; color: string }> = {
    unread: { label: '未読', color: 'bg-red-100 text-red-700' },
    in_progress: { label: '対応中', color: 'bg-yellow-100 text-yellow-700' },
    resolved: { label: '解決済', color: 'bg-green-100 text-green-700' },
  }
  const st = statusLabel[chatStatus] ?? { label: chatStatus, color: 'bg-gray-100 text-gray-600' }

  return (
    <div className="w-full lg:w-80 bg-white border-l border-gray-300 flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-300 bg-gray-100">
        <h3 className="text-sm font-bold text-gray-900">📋 顧客情報</h3>
        <button onClick={onClose} className="text-gray-500 hover:text-gray-800">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="p-4 space-y-3">{[...Array(6)].map((_, i) => (<div key={i} className="h-4 bg-gray-200 rounded animate-pulse" />))}</div>
        ) : (
          <>
            {/* プロフィール */}
            <div className="px-4 py-4 border-b border-gray-200 bg-white">
              <div className="flex items-center gap-3">
                {friendPictureUrl ? (
                  <img src={friendPictureUrl} alt="" className="w-12 h-12 rounded-full border-2 border-gray-200" />
                ) : (
                  <div className="w-12 h-12 rounded-full bg-gray-300 flex items-center justify-center border-2 border-gray-200">
                    <span className="text-gray-600 text-lg font-bold">{friendName.charAt(0)}</span>
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-base font-bold text-gray-900 truncate">{friendName}</p>
                  <span className={`inline-block px-2 py-0.5 rounded text-xs font-semibold mt-1 ${st.color}`}>{st.label}</span>
                </div>
              </div>
              {friendEmail && <p className="text-xs text-gray-600 mt-2 truncate">✉️ {friendEmail}</p>}
              {friend && <p className="text-xs text-gray-500 mt-1">登録 {daysAgo(friend.createdAt)}</p>}
            </div>

            {/* タグ */}
            <div className="px-4 py-3 border-b border-gray-200">
              <p className="text-xs font-bold text-gray-700 mb-2">🏷️ タグ</p>
              {friend && friend.tags.length > 0 ? (
                <div className="flex flex-wrap gap-1">
                  {friend.tags.map((tag) => (
                    <span key={tag} className="inline-block px-2 py-0.5 rounded text-xs font-medium bg-indigo-100 text-indigo-800 border border-indigo-200">{tag}</span>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-gray-500">タグなし</p>
              )}
            </div>

            {/* Shopify購入サマリー */}
            <div className="px-4 py-3 border-b border-gray-200">
              <p className="text-xs font-bold text-gray-700 mb-2">🛒 購入履歴</p>
              {orders && orders.total_orders > 0 ? (
                <div className="space-y-2">
                  <div className="grid grid-cols-2 gap-2">
                    <div className="bg-blue-100 border border-blue-200 rounded p-2 text-center">
                      <p className="text-lg font-extrabold text-blue-800">{orders.total_orders}</p>
                      <p className="text-[10px] text-blue-700 font-medium">注文数</p>
                    </div>
                    <div className="bg-green-100 border border-green-200 rounded p-2 text-center">
                      <p className="text-lg font-extrabold text-green-800">{yen(orders.total_spent)}</p>
                      <p className="text-[10px] text-green-700 font-medium">合計金額</p>
                    </div>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-gray-500">初回注文</span>
                    <span className="text-gray-800 font-medium">{orders.first_order_at ? daysAgo(orders.first_order_at) : '—'}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-gray-500">最終注文</span>
                    <span className="text-gray-800 font-medium">{orders.last_order_at ? daysAgo(orders.last_order_at) : '—'}</span>
                  </div>
                </div>
              ) : (
                <p className="text-xs text-gray-500">Shopifyの購入データはまだありません</p>
              )}
            </div>

            {/* 直近の購入商品 */}
            {recentItems.length > 0 && (
              <div className="px-4 py-3 border-b border-gray-200">
                <p className="text-xs font-bold text-gray-700 mb-2">📦 最近買ったもの</p>
                <div className="space-y-1.5">
                  {recentItems.map((item, i) => (
                    <div key={i} className="flex items-center justify-between text-xs">
                      <span className="text-gray-800 truncate flex-1">{item.title}</span>
                      <span className="text-gray-500 ml-2 shrink-0">{daysAgo(item.processed_at)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ポイント */}
            {loyalty && (
              <div className="px-4 py-3 border-b border-gray-200">
                <p className="text-xs font-bold text-gray-700 mb-2">💎 ポイント</p>
                <div className="grid grid-cols-3 gap-2">
                  <div className="bg-green-100 border border-green-200 rounded p-2 text-center">
                    <p className="text-lg font-extrabold text-green-800">{loyalty.balance.toLocaleString()}</p>
                    <p className="text-[10px] text-green-700 font-medium">pt</p>
                  </div>
                  <div className="bg-purple-100 border border-purple-200 rounded p-2 text-center">
                    <p className="text-sm font-extrabold text-purple-800">{loyalty.rank}</p>
                    <p className="text-[10px] text-purple-700 font-medium">ランク</p>
                  </div>
                  <div className="bg-blue-100 border border-blue-200 rounded p-2 text-center">
                    <p className="text-sm font-extrabold text-blue-800">{yen(loyalty.total_spent)}</p>
                    <p className="text-[10px] text-blue-700 font-medium">累計</p>
                  </div>
                </div>
              </div>
            )}

            {/* CSヒント */}
            <div className="px-4 py-3 bg-gradient-to-br from-yellow-100 to-orange-100 border-b border-yellow-200">
              <p className="text-xs font-bold text-yellow-800 mb-2">💡 CS対応のヒント</p>
              <ul className="text-xs text-yellow-900 space-y-1">
                <li>• タグを確認して過去対応履歴を把握</li>
                <li>• 高ランク/高額顧客は優先対応</li>
                <li>• 最終注文からの日数でフォローアップ判断</li>
                <li>• 親しみやすく丁寧な対応が◎</li>
              </ul>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
