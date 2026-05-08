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

interface OrderItem {
  title: string
  order_count: number
  total_revenue: number
  last_ordered: string
}

interface LoyaltyData {
  balance: number
  rank: string
  total_spent: number
}

const yen = (n: number) => '¥' + Math.round(n).toLocaleString('ja-JP')

export default function CustomerInfoPanel({ friendId, friendName, friendPictureUrl, friendEmail, chatStatus, onClose }: CustomerInfoProps) {
  const [friend, setFriend] = useState<FriendDetail | null>(null)
  const [orders, setOrders] = useState<OrderItem[]>([])
  const [loyalty, setLoyalty] = useState<LoyaltyData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)

    const load = async () => {
      try {
        const [friendRes, orderRes, loyaltyRes] = await Promise.all([
          fetchApi<{ success: boolean; data: FriendDetail }>(`/api/friends/${friendId}`),
          fetchApi<{ success: boolean; data: OrderItem[] }>(`/api/shopify/orders/products-stats?limit=5`).catch(() => ({ success: false as const, data: [] })),
          fetchApi<{ success: boolean; data: LoyaltyData }>(`/api/loyalty/${friendId}`).catch(() => ({ success: false as const, data: null })),
        ])
        if (cancelled) return
        if (friendRes.success) setFriend(friendRes.data)
        if (loyaltyRes.success && loyaltyRes.data) setLoyalty(loyaltyRes.data)
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
    <div className="w-full lg:w-80 bg-white border-l border-gray-200 flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 bg-gray-50">
        <h3 className="text-sm font-semibold text-gray-900">顧客情報</h3>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="p-4 space-y-3">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-4 bg-gray-100 rounded animate-pulse" />
            ))}
          </div>
        ) : (
          <>
            {/* プロフィール */}
            <div className="px-4 py-4 border-b border-gray-100">
              <div className="flex items-center gap-3">
                {friendPictureUrl ? (
                  <img src={friendPictureUrl} alt="" className="w-12 h-12 rounded-full" />
                ) : (
                  <div className="w-12 h-12 rounded-full bg-gray-200 flex items-center justify-center">
                    <span className="text-gray-500 text-lg">{friendName.charAt(0)}</span>
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold text-gray-900 truncate">{friendName}</p>
                  <span className={`inline-block px-1.5 py-0.5 rounded text-xs font-medium mt-1 ${st.color}`}>
                    {st.label}
                  </span>
                </div>
              </div>
              {friendEmail && (
                <p className="text-xs text-gray-500 mt-2 truncate">✉️ {friendEmail}</p>
              )}
            </div>

            {/* タグ */}
            <div className="px-4 py-3 border-b border-gray-100">
              <p className="text-xs font-semibold text-gray-500 mb-2">🏷️ タグ</p>
              {friend && friend.tags.length > 0 ? (
                <div className="flex flex-wrap gap-1">
                  {friend.tags.map((tag) => (
                    <span key={tag} className="inline-block px-2 py-0.5 rounded text-xs bg-indigo-50 text-indigo-700 border border-indigo-100">
                      {tag}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-gray-400">タグなし</p>
              )}
            </div>

            {/* ポイント情報 */}
            {loyalty && (
              <div className="px-4 py-3 border-b border-gray-100">
                <p className="text-xs font-semibold text-gray-500 mb-2">💎 ポイント</p>
                <div className="grid grid-cols-3 gap-2">
                  <div className="bg-green-50 rounded p-2 text-center">
                    <p className="text-lg font-bold text-green-700">{loyalty.balance.toLocaleString()}</p>
                    <p className="text-[10px] text-gray-500">pt</p>
                  </div>
                  <div className="bg-purple-50 rounded p-2 text-center">
                    <p className="text-sm font-bold text-purple-700">{loyalty.rank}</p>
                    <p className="text-[10px] text-gray-500">ランク</p>
                  </div>
                  <div className="bg-blue-50 rounded p-2 text-center">
                    <p className="text-sm font-bold text-blue-700">{yen(loyalty.total_spent)}</p>
                    <p className="text-[10px] text-gray-500">累計</p>
                  </div>
                </div>
              </div>
            )}

            {/* 基本情報 */}
            {friend && (
              <div className="px-4 py-3 border-b border-gray-100">
                <p className="text-xs font-semibold text-gray-500 mb-2">📋 基本情報</p>
                <div className="space-y-1.5">
                  <div className="flex justify-between text-xs">
                    <span className="text-gray-400">友だちID</span>
                    <span className="text-gray-700 font-mono text-[10px]">{friend.id.slice(0, 16)}...</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-gray-400">フォロー</span>
                    <span className={friend.isFollowing ? 'text-green-600' : 'text-red-500'}>
                      {friend.isFollowing ? '✅ している' : '❌ していない'}
                    </span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-gray-400">言語</span>
                    <span className="text-gray-700">{friend.language ?? '未設定'}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-gray-400">登録日</span>
                    <span className="text-gray-700">{new Date(friend.createdAt).toLocaleDateString('ja-JP')}</span>
                  </div>
                </div>
              </div>
            )}

            {/* CSチップ */}
            <div className="px-4 py-3 bg-gradient-to-br from-yellow-50 to-orange-50">
              <p className="text-xs font-semibold text-gray-600 mb-2">💡 CS対応のヒント</p>
              <ul className="text-[11px] text-gray-600 space-y-1">
                <li>• 顧客のタグを確認して過去の対応履歴を把握</li>
                <li>• ランクが高い顧客は優先対応するとGood</li>
                <li>• 初回対応は24時間以内を目標に</li>
                <li>• くだけすぎず、かしこまりすぎない丁寧さが◎</li>
              </ul>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
