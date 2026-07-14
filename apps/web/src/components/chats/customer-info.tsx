'use client'
import { useCallback, useEffect, useState } from 'react'
import { fetchApi } from '@/lib/api'

interface CustomerInfoProps { friendId: string; friendName: string; friendPictureUrl: string | null; friendEmail?: string | null; chatStatus: string; onClose: () => void }
interface FriendDetail { id: string; displayName: string | null; pictureUrl: string | null; tags: string[]; language: string | null; isFollowing: boolean; createdAt: string; updatedAt: string }
interface LoyaltyData { balance: number; limited_balance: number; limited_expires_at: string | null; rank: string; total_spent: number }
interface OrderSummary { total_orders: number; total_spent: number; first_order_at: string | null; last_order_at: string | null; completed_orders: number }
interface RecentItem { title: string; quantity: number; price: number; processed_at: string }
interface ShopifyCandidate { shopify_customer_id: string; email: string | null; order_count: number; total_spent: number; last_order_at: string | null }
const yen=(n:number)=>'¥'+Math.round(n).toLocaleString('ja-JP')
const daysAgo=(iso:string|null):string=>{if(!iso)return'—';const d=Math.floor((Date.now()-new Date(iso).getTime())/86400000);if(d===0)return'今日';if(d===1)return'昨日';return`${d}日前`}
const totalPoints=(p:LoyaltyData)=>p.balance+p.limited_balance

export default function CustomerInfoPanel({friendId,friendName,friendPictureUrl,friendEmail,chatStatus,onClose}:CustomerInfoProps){
  const [friend,setFriend]=useState<FriendDetail|null>(null)
  const [loyalty,setLoyalty]=useState<LoyaltyData|null>(null)
  const [orders,setOrders]=useState<OrderSummary|null>(null)
  const [recentItems,setRecentItems]=useState<RecentItem[]>([])
  const [debugData,setDebugData]=useState<any>(null)
  const [loading,setLoading]=useState(true)
  const [showDebug,setShowDebug]=useState(false)
  const [linkedShopifyCustomerId,setLinkedShopifyCustomerId]=useState<string|null>(null)
  const [shopifySearch,setShopifySearch]=useState('')
  const [shopifyCandidates,setShopifyCandidates]=useState<ShopifyCandidate[]>([])
  const [shopifyLinkMessage,setShopifyLinkMessage]=useState<string|null>(null)
  const [isSearching,setIsSearching]=useState(false)
  const [isLinking,setIsLinking]=useState<string|null>(null)

  const loadData=useCallback(async()=>{
    setLoading(true)
    try{
      const[fR,lR,oR]=await Promise.all([
        fetchApi<{success:boolean;data:FriendDetail}>(`/api/friends/${friendId}`),
        fetchApi<{success:boolean;data:LoyaltyData}>(`/api/loyalty/${friendId}`).catch(()=>({success:false as const,data:null})),
        fetchApi<{success:boolean;data:{summary:OrderSummary;recent_items:RecentItem[];linked_shopify_customer_id?:string|null;_debug?:any}}>(`/api/shopify/orders/customer-summary/${friendId}`).catch(()=>({success:false as const,data:null})),
      ])
      if(fR.success)setFriend(fR.data)
      if(lR.success&&lR.data)setLoyalty(lR.data)
      if(oR.success&&oR.data){setOrders(oR.data.summary);setRecentItems(oR.data.recent_items??[]);setLinkedShopifyCustomerId(oR.data.linked_shopify_customer_id??null);if(oR.data._debug)setDebugData(oR.data._debug)}
    }catch{}finally{setLoading(false)}
  },[friendId])
  useEffect(()=>{ void loadData() },[loadData])

  const searchShopify=async()=>{
    if(shopifySearch.trim().length<2){setShopifyLinkMessage('メールアドレスまたはShopify顧客IDを2文字以上入力してください');return}
    setIsSearching(true);setShopifyLinkMessage(null)
    try{const r=await fetchApi<{success:boolean;data:ShopifyCandidate[];error?:string}>(`/api/shopify/orders/customer-search?query=${encodeURIComponent(shopifySearch.trim())}`);if(r.success){setShopifyCandidates(r.data??[]);if((r.data??[]).length===0)setShopifyLinkMessage('該当するShopify顧客が見つかりません')}else setShopifyLinkMessage(r.error??'検索に失敗しました')}catch{setShopifyLinkMessage('検索に失敗しました')}finally{setIsSearching(false)}
  }
  const linkShopify=async(shopifyCustomerId:string)=>{
    setIsLinking(shopifyCustomerId);setShopifyLinkMessage(null)
    try{const r=await fetchApi<{success:boolean;error?:string}>(`/api/shopify/orders/customer-summary/${friendId}/link`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({shopifyCustomerId})});if(!r.success){setShopifyLinkMessage(r.error??'紐付けに失敗しました');return}setShopifyCandidates([]);setShopifySearch('');setShopifyLinkMessage('Shopify購入データを紐付けました');await loadData()}catch{setShopifyLinkMessage('紐付けに失敗しました')}finally{setIsLinking(null)}
  }

  const st=({unread:{label:'未読',color:'bg-red-100 text-red-700'},in_progress:{label:'対応中',color:'bg-yellow-100 text-yellow-700'},resolved:{label:'解決済',color:'bg-green-100 text-green-700'}}as any)[chatStatus]??{label:chatStatus,color:'bg-gray-100 text-gray-600'}

  return(<div className="w-full lg:w-80 bg-white border-l border-gray-300 flex flex-col h-full">
    <div className="flex items-center justify-between px-4 py-3 border-b border-gray-300 bg-gray-100">
      <h3 className="text-sm font-bold text-gray-900">📋 顧客情報</h3>
      <div className="flex items-center gap-1">
        <button onClick={()=>setShowDebug(!showDebug)} className="text-[10px] text-gray-400 hover:text-gray-600 px-1.5 py-0.5 rounded border border-gray-200" title="注文検索デバッグ">🔍</button>
        <button onClick={onClose} className="text-gray-500 hover:text-gray-800"><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/></svg></button>
      </div>
    </div>
    <div className="flex-1 overflow-y-auto">
      {loading?(<div className="p-4 space-y-3">{[...Array(6)].map((_,i)=>(<div key={i} className="h-4 bg-gray-200 rounded animate-pulse"/>))}</div>):(<>
        <div className="px-4 py-4 border-b border-gray-200 bg-white">
          <div className="flex items-center gap-3">{friendPictureUrl?<img src={friendPictureUrl} alt="" className="w-12 h-12 rounded-full border-2 border-gray-200"/>:<div className="w-12 h-12 rounded-full bg-gray-300 flex items-center justify-center border-2 border-gray-200"><span className="text-gray-600 text-lg font-bold">{friendName.charAt(0)}</span></div>}
            <div className="min-w-0 flex-1"><p className="text-base font-bold text-gray-900 truncate">{friendName}</p><span className={`inline-block px-2 py-0.5 rounded text-xs font-semibold mt-1 ${st.color}`}>{st.label}</span></div></div>
          {friendEmail&&<p className="text-xs text-gray-600 mt-2 truncate">✉️ {friendEmail}</p>}
          {friend&&<p className="text-xs text-gray-500 mt-1">登録 {daysAgo(friend.createdAt)}</p>}
        </div>
        <div className="px-4 py-3 border-b border-gray-200">
          <p className="text-xs font-bold text-gray-700 mb-2">🏷️ タグ</p>
          {friend&&friend.tags.length>0?(<div className="flex flex-wrap gap-1">{friend.tags.map(tag=>(<span key={tag} className="inline-block px-2 py-0.5 rounded text-xs font-medium bg-indigo-100 text-indigo-800 border border-indigo-200">{tag}</span>))}</div>):(<p className="text-xs text-gray-500">タグなし</p>)}
        </div>
        <div className="px-4 py-3 border-b border-gray-200">
          <p className="text-xs font-bold text-gray-700 mb-2">🛒 購入履歴</p>
          {orders&&orders.total_orders>0?(<div className="space-y-2">
            <div className="grid grid-cols-2 gap-2"><div className="bg-blue-100 border border-blue-200 rounded p-2 text-center"><p className="text-lg font-extrabold text-blue-800">{orders.total_orders}</p><p className="text-[10px] text-blue-700 font-medium">注文数</p></div><div className="bg-green-100 border border-green-200 rounded p-2 text-center"><p className="text-lg font-extrabold text-green-800">{yen(orders.total_spent)}</p><p className="text-[10px] text-green-700 font-medium">合計金額</p></div></div>
            <div className="flex justify-between text-xs"><span className="text-gray-500">初回注文</span><span className="text-gray-800 font-medium">{orders.first_order_at?daysAgo(orders.first_order_at):'—'}</span></div>
            <div className="flex justify-between text-xs"><span className="text-gray-500">最終注文</span><span className="text-gray-800 font-medium">{orders.last_order_at?daysAgo(orders.last_order_at):'—'}</span></div>
          </div>):(<p className="text-xs text-gray-500">Shopifyの購入データはまだありません</p>)}
          <div className="mt-3 pt-3 border-t border-dashed border-gray-200">
            <p className="text-[11px] font-semibold text-gray-600 mb-1">Shopify購入データを手動で紐付け</p>
            {linkedShopifyCustomerId&&<p className="text-[10px] text-green-700 mb-1">紐付け済み</p>}
            <div className="flex gap-1"><input value={shopifySearch} onChange={e=>setShopifySearch(e.target.value)} onKeyDown={e=>{if(e.key==='Enter')void searchShopify()}} placeholder="メールアドレス / 顧客ID" className="min-w-0 flex-1 rounded border border-gray-300 px-2 py-1 text-xs"/><button onClick={()=>void searchShopify()} disabled={isSearching} className="rounded bg-gray-700 px-2 py-1 text-xs font-semibold text-white disabled:opacity-50">{isSearching?'検索中':'検索'}</button></div>
            {shopifyLinkMessage&&<p className="mt-1 text-[10px] text-gray-600">{shopifyLinkMessage}</p>}
            {shopifyCandidates.length>0&&<div className="mt-2 space-y-1">{shopifyCandidates.map(candidate=><div key={candidate.shopify_customer_id} className="rounded border border-gray-200 p-2 text-[10px]"><p className="truncate text-gray-700">{candidate.email??'メールアドレスなし'}</p><p className="text-gray-500">{candidate.order_count}件 / {yen(candidate.total_spent)}</p><button onClick={()=>void linkShopify(candidate.shopify_customer_id)} disabled={isLinking!==null} className="mt-1 rounded bg-emerald-700 px-2 py-1 text-[10px] font-semibold text-white disabled:opacity-50">{isLinking===candidate.shopify_customer_id?'紐付け中':'この顧客を紐付ける'}</button></div>)}</div>}
          </div>
        </div>
        {recentItems.length>0&&(<div className="px-4 py-3 border-b border-gray-200"><p className="text-xs font-bold text-gray-700 mb-2">📦 最近買ったもの</p><div className="space-y-1.5">{recentItems.map((item,i)=>(<div key={i} className="flex items-center justify-between text-xs"><span className="text-gray-800 truncate flex-1">{item.title}</span><span className="text-gray-500 ml-2 shrink-0">{daysAgo(item.processed_at)}</span></div>))}</div></div>)}
        {loyalty&&(<div className="px-4 py-3 border-b border-gray-200"><p className="text-xs font-bold text-gray-700 mb-2">💎 ポイント</p><div className="grid grid-cols-3 gap-2"><div className="bg-green-100 border border-green-200 rounded p-2 text-center"><p className="text-lg font-extrabold text-green-800">{totalPoints(loyalty).toLocaleString()}</p><p className="text-[10px] text-green-700 font-medium">合計pt</p></div><div className="bg-purple-100 border border-purple-200 rounded p-2 text-center"><p className="text-sm font-extrabold text-purple-800">{loyalty.rank}</p><p className="text-[10px] text-purple-700 font-medium">ランク</p></div><div className="bg-blue-100 border border-blue-200 rounded p-2 text-center"><p className="text-sm font-extrabold text-blue-800">{yen(loyalty.total_spent)}</p><p className="text-[10px] text-blue-700 font-medium">累計</p></div></div>{loyalty.limited_balance>0&&(<p className="text-[11px] text-gray-500 mt-2">通常 {loyalty.balance.toLocaleString()} pt / 期間限定 {loyalty.limited_balance.toLocaleString()} pt</p>)}</div>)}
        {showDebug&&debugData&&(<div className="px-4 py-3 border-b border-gray-200 bg-gray-100"><p className="text-xs font-bold text-gray-600 mb-1">🔍 検索デバッグ</p><div className="text-[10px] text-gray-600 space-y-0.5 font-mono"><div>email: {debugData.email??'NULL'}</div><div>scId: {debugData.scId??'NULL'}</div><div>where: {debugData.where}</div></div></div>)}
        <div className="px-4 py-3 bg-gradient-to-br from-yellow-100 to-orange-100 border-b border-yellow-200"><p className="text-xs font-bold text-yellow-800 mb-2">💡 CS対応のヒント</p><ul className="text-xs text-yellow-900 space-y-1"><li>• タグを確認して過去対応履歴を把握</li><li>• 高ランク/高額顧客は優先対応</li><li>• 最終注文からの日数でフォローアップ判断</li><li>• 親しみやすく丁寧な対応が◎</li></ul></div>
      </>)}
    </div>
  </div>)
}
