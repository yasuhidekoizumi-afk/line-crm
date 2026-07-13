'use client'

import { useEffect, useMemo, useState } from 'react'
import { useAccount } from '@/contexts/account-context'
import { fetchApi } from '@/lib/api'

type Influencer = { friendId: string; displayName: string | null; instagramHandle: string | null; categories: string[]; followerBand: string | null; contactEmail: string | null; contactPhone: string | null; profileCompletedAt: string | null; address: { prefecture: string | null } | null }

export default function InfluencersPage() {
  const { selectedAccountId, selectedAccount, loading: accountsLoading } = useAccount()
  const [items, setItems] = useState<Influencer[]>([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    if (!selectedAccountId) return
    setLoading(true); setError('')
    const q = new URLSearchParams({ lineAccountId: selectedAccountId }); if (query) q.set('q', query)
    fetchApi<{ success: boolean; data: Influencer[] }>(`/api/influencers?${q}`).then((res) => setItems(res.data || [])).catch(() => setError('一覧を取得できませんでした。権限または接続を確認してください。')).finally(() => setLoading(false))
  }, [selectedAccountId, query])
  const complete = useMemo(() => items.filter((item) => item.profileCompletedAt).length, [items])
  if (accountsLoading) return <div className="p-8">読み込み中…</div>
  if (!selectedAccountId) return <div className="p-8">利用できるLINEアカウントがありません。</div>
  return <main className="p-6 max-w-6xl mx-auto">
    <div className="flex flex-wrap items-end justify-between gap-4 mb-7"><div><p className="text-xs font-semibold tracking-widest text-emerald-700">CREATOR GIFTING</p><h1 className="text-2xl font-bold mt-1">インフルエンサー管理</h1><p className="text-sm text-gray-500 mt-1">{selectedAccount?.displayName || selectedAccount?.name} のプロフィール登録・進行管理</p></div><div className="rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-900">登録済み <b className="text-lg">{complete}</b> / {items.length} 名</div></div>
    <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="名前・Instagramアカウントで検索" className="w-full max-w-md border rounded-lg px-3 py-2 mb-5" />
    {error && <p className="text-red-600 mb-4">{error}</p>}
    <div className="overflow-x-auto bg-white border rounded-xl"><table className="w-full text-sm"><thead className="bg-gray-50 text-left text-gray-500"><tr><th className="p-3">クリエイター</th><th className="p-3">ジャンル</th><th className="p-3">フォロワー数</th><th className="p-3">連絡先</th><th className="p-3">発送先</th><th className="p-3">状態</th></tr></thead><tbody>{items.map((item) => <tr key={item.friendId} className="border-t"><td className="p-3 font-medium">{item.displayName || '名称未登録'}<div className="text-xs font-normal text-gray-500">{item.instagramHandle || 'Instagram未登録'}</div></td><td className="p-3">{item.categories.join('・') || '—'}</td><td className="p-3">{item.followerBand || '—'}</td><td className="p-3">{item.contactEmail || item.contactPhone || '—'}</td><td className="p-3">{item.address?.prefecture || '未登録'}</td><td className="p-3"><span className={`rounded-full px-2 py-1 text-xs ${item.profileCompletedAt ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>{item.profileCompletedAt ? '登録済み' : '未登録'}</span></td></tr>)}</tbody></table>{!loading && !items.length && <p className="p-8 text-center text-gray-500">まだプロフィール登録者はいません。</p>}</div>
  </main>
}
