'use client'

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { api } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import QuickReplyTemplates from '@/components/chats/quick-reply'
import CustomerInfoPanel from '@/components/chats/customer-info'
import AiDraftButton from '@/components/chats/ai-draft-button'
import Badge from '@/components/ui/badge'
import Button from '@/components/ui/button'
import EmptyState from '@/components/empty-state'
import { TextInput } from '@/components/ui/field'

const statusTone: Record<string, 'danger' | 'warn' | 'success'> = { unread: 'danger', in_progress: 'warn', resolved: 'success' }

const statusConfig: Record<string, { label: string; className: string }> = { unread: { label: '未読', className: 'bg-red-100 text-red-700' }, in_progress: { label: '要対応', className: 'bg-yellow-100 text-yellow-700' }, resolved: { label: '対応済み', className: 'bg-green-100 text-green-700' } }
const statusFilters = [{ key: 'all' as const, label: 'すべて' }, { key: 'unread' as const, label: '未読' }, { key: 'in_progress' as const, label: '要対応' }, { key: 'resolved' as const, label: '対応済み' }]
const channelFilters = [{ key: 'all' as const, label: '全チャネル' }, { key: 'line' as const, label: 'LINE' }, { key: 'email' as const, label: '✉️ メール' }]
function formatDatetime(iso: string | null): string { if (!iso) return '-'; return new Date(iso).toLocaleString('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) }
function formatListTime(iso: string | null): string { if (!iso) return ''; return new Date(iso).toLocaleString('ja-JP', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) }

export default function ChatsPage() {
  const { selectedAccountId } = useAccount()
  const [chats, setChats] = useState<any[]>([]); const [selectedChatId, setSelectedChatId] = useState<string | null>(null)
  const [chatDetail, setChatDetail] = useState<any>(null); const [statusFilter, setStatusFilter] = useState('all'); const [channelFilter, setChannelFilter] = useState('all')
  const [loading, setLoading] = useState(true); const [detailLoading, setDetailLoading] = useState(false); const [error, setError] = useState(''); const [messageContent, setMessageContent] = useState(''); const [sending, setSending] = useState(false)
  const [notes, setNotes] = useState(''); const [savingNotes, setSavingNotes] = useState(false); const [showCustomerInfo, setShowCustomerInfo] = useState(false); const [showNotes, setShowNotes] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const messageScrollRef = useRef<HTMLDivElement>(null)
  const chatDetailRef = useRef<any>(null)
  const olderLoadedRef = useRef(false)
  const [hasMoreOlder, setHasMoreOlder] = useState(false)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [sortMode, setSortMode] = useState<'recent' | 'unread'>('recent')

  const loadChats = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) { setLoading(true); setError('') }
    try {
      const params: any = {}
      if (statusFilter !== 'all') params.status = statusFilter
      if (selectedAccountId) params.accountId = selectedAccountId
      if (channelFilter !== 'all') params.channel = channelFilter
      const chatRes = await api.chats.list(params)
      if (chatRes.success) { const list = chatRes.data as any[]; setChats(list); return list }
    } catch { if (!opts?.silent) setError('チャットの読み込みに失敗しました') } finally { if (!opts?.silent) setLoading(false) }
    return null
  }, [statusFilter, channelFilter, selectedAccountId])

  const loadChatDetail = useCallback(async (chatId: string, opts?: { silent?: boolean }) => {
    if (!opts?.silent) setDetailLoading(true)
    try {
      const res = await api.chats.get(chatId)
      if (res.success) {
        const data = res.data as any
        // 過去分を追加読み込み済みのときは、読んでいる位置を保ったまま
        // 「新しく増えた分」だけを末尾に足す（差し替えると遡った履歴が消える）。
        const keepLoadedHistory = Boolean(opts?.silent) && olderLoadedRef.current && chatDetailRef.current?.id === data.id
        setChatDetail((prev: any) => {
          if (!keepLoadedHistory || !prev) return data
          const known = new Set((prev.messages ?? []).map((m: any) => m.id))
          const added = (data.messages ?? []).filter((m: any) => !known.has(m.id))
          return { ...data, messages: added.length > 0 ? [...(prev.messages ?? []), ...added] : prev.messages }
        })
        if (!keepLoadedHistory) setHasMoreOlder(Boolean(data.hasMore))
        if (!opts?.silent) { setNotes(data.notes || ''); olderLoadedRef.current = false }
      }
    } catch { if (!opts?.silent) setError('チャット詳細の読み込みに失敗') } finally { if (!opts?.silent) setDetailLoading(false) }
  }, [])

  // 「過去のメッセージを見る」— 表示中の最古より前を30件取得して先頭に足す
  const loadOlderMessages = useCallback(async () => {
    if (!selectedChatId || loadingOlder) return
    const current = chatDetailRef.current
    const oldest = current?.messages?.[0]?.createdAt
    if (!oldest) return
    setLoadingOlder(true)
    const el = messageScrollRef.current
    const previousHeight = el?.scrollHeight ?? 0
    try {
      const res = await api.chats.get(selectedChatId, { before: oldest, limit: 30 })
      if (res.success) {
        const data = res.data as any
        const older = data.messages ?? []
        setChatDetail((prev: any) => (prev ? { ...prev, messages: [...older, ...(prev.messages ?? [])] } : prev))
        setHasMoreOlder(Boolean(data.hasMore))
        olderLoadedRef.current = true
        // 追加分の高さだけスクロールを戻し、読んでいた位置を維持する
        requestAnimationFrame(() => { if (el) el.scrollTop = el.scrollHeight - previousHeight })
      }
    } catch { setError('過去のメッセージの読み込みに失敗しました') } finally { setLoadingOlder(false) }
  }, [selectedChatId, loadingOlder])

  useEffect(() => { loadChats() }, [loadChats])
  useEffect(() => { if (selectedAccountId && channelFilter === 'email') setChannelFilter('all') }, [selectedAccountId, channelFilter])
  useEffect(() => {
    if (selectedChatId) { olderLoadedRef.current = false; loadChatDetail(selectedChatId) }
    else { setChatDetail(null); setShowCustomerInfo(false) }
  }, [selectedChatId, loadChatDetail])
  // 自動更新の比較用に、最新の詳細をrefへ保持する
  useEffect(() => { chatDetailRef.current = chatDetail }, [chatDetail])
  // 新しいメッセージが増えたときだけ最下部へスクロール（過去分の追加読み込みでは動かさない）
  const lastMessageId = chatDetail?.messages?.length ? chatDetail.messages[chatDetail.messages.length - 1].id : null
  const prevLastMessageIdRef = useRef<string | null>(null)
  useEffect(() => {
    if (!selectedChatId || !lastMessageId || prevLastMessageIdRef.current === lastMessageId) return
    prevLastMessageIdRef.current = lastMessageId
    messagesEndRef.current?.scrollIntoView({ block: 'end' })
  }, [selectedChatId, lastMessageId])
  // 30秒ごとに新着を確認する（画面を開いたままでも返信に気づける）
  useEffect(() => {
    const timer = setInterval(async () => {
      const list = await loadChats({ silent: true })
      if (!list || !selectedChatId) return
      const row = list.find((ch: any) => ch.id === selectedChatId)
      if (row && row.lastMessageAt !== chatDetailRef.current?.lastMessageAt) {
        void loadChatDetail(selectedChatId, { silent: true })
      }
    }, 30_000)
    return () => clearInterval(timer)
  }, [loadChats, loadChatDetail, selectedChatId])

  const handleSelectChat = (chatId: string) => { setSelectedChatId(chatId); setMessageContent('') }
  const handleSendMessage = async () => { if (!selectedChatId || !messageContent.trim()) return; setSending(true); try { await api.chats.send(selectedChatId, { content: messageContent.trim() }); setMessageContent(''); loadChatDetail(selectedChatId); loadChats(); if (textareaRef.current) textareaRef.current.style.height = 'auto' } catch { setError('メッセージの送信に失敗') } finally { setSending(false) } }
  const handleStatusUpdate = async (newStatus: NonNullable<Parameters<typeof api.chats.update>[1]['status']>) => { if (!selectedChatId) return; try { await api.chats.update(selectedChatId, { status: newStatus }); loadChatDetail(selectedChatId); loadChats() } catch { setError('ステータスの更新に失敗') } }
  const handleSaveNotes = async () => { if (!selectedChatId) return; setSavingNotes(true); try { await api.chats.update(selectedChatId, { notes }); loadChatDetail(selectedChatId) } catch { setError('メモの保存に失敗') } finally { setSavingNotes(false) } }
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendMessage() } }
  const handleDraftSelect = (text: string) => { setMessageContent(text) }
  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => { setMessageContent(e.target.value); const el = e.target; el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 160) + 'px' }

  // 検索・並び替えは読み込み済みの一覧に対して行う（毎回APIを叩かない）
  const visibleChats = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    const filtered = query
      ? chats.filter((ch: any) => `${ch.friendName ?? ''} ${ch.customerEmail ?? ''} ${(ch.tags ?? []).join(' ')}`.toLowerCase().includes(query))
      : chats
    if (sortMode === 'unread') {
      return [...filtered].sort((a: any, b: any) => (b.unreadCount ?? 0) - (a.unreadCount ?? 0) || String(b.lastMessageAt ?? '').localeCompare(String(a.lastMessageAt ?? '')))
    }
    return filtered
  }, [chats, searchQuery, sortMode])

  const visibleChannelFilters = selectedAccountId ? channelFilters.filter((filter) => filter.key !== 'email') : channelFilters
  return (<div>
    {error && <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{error}</div>}
    <div className="flex gap-0 h-[calc(100vh-120px)] lg:h-[calc(100vh-180px)]">
      <div className={`w-full lg:w-96 lg:flex-shrink-0 bg-white rounded-lg shadow-sm border border-gray-200 flex-col overflow-hidden ${selectedChatId ? 'hidden lg:flex' : 'flex'}`}>
        {/* 検索・並び替え（LINE公式アカウントの一覧に近づける） */}
        <div className="px-3 py-2 border-b border-gray-200 bg-white flex items-center gap-2">
          <TextInput type="search" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="名前・タグ・メールで検索" aria-label="チャットを検索" className="flex-1 min-w-0 text-xs py-1.5" />
          <select value={sortMode} onChange={(e) => setSortMode(e.target.value as 'recent' | 'unread')} className="text-xs border border-gray-300 rounded-md px-1.5 py-1.5 bg-white text-gray-600" title="並び替え">
            <option value="recent">最新順</option>
            <option value="unread">未読優先</option>
          </select>
        </div>
        <div className="flex border-b border-gray-200 bg-gray-50">{visibleChannelFilters.map((f) => (<button key={f.key} onClick={() => { setChannelFilter(f.key); setSelectedChatId(null) }} className={`flex-1 px-3 py-2 min-h-[40px] text-xs font-medium transition-colors ${channelFilter === f.key ? 'bg-white text-gray-900 border-b-2 border-purple-600' : 'text-gray-500 hover:bg-white'}`}>{f.label}</button>))}</div>
        <div className="flex border-b border-gray-200">{statusFilters.map((f) => (<button key={f.key} onClick={() => { setStatusFilter(f.key); setSelectedChatId(null) }} className={`flex-1 px-3 py-2.5 min-h-[44px] text-xs font-medium transition-colors ${statusFilter === f.key ? 'text-white' : 'text-gray-600 hover:bg-gray-50'}`} style={statusFilter === f.key ? { backgroundColor: '#06C755' } : undefined}>{f.label}</button>))}</div>
        <div className="flex-1 overflow-y-auto">
          {loading ? (<div>{[...Array(5)].map((_, i) => (<div key={i} className="px-4 py-3 border-b border-gray-100 animate-pulse"><div className="h-3 bg-gray-200 rounded w-32" /><div className="h-2 bg-gray-100 rounded w-20 mt-2" /></div>))}</div>)
          : visibleChats.length === 0 ? (<div className="py-10 text-center text-xs text-gray-400">該当するチャットがありません</div>)
          : (<>{visibleChats.map((chat: any) => {
              const st = statusConfig[chat.status] || { label: chat.status, className: 'bg-gray-100 text-gray-600' }
              const isSelected = selectedChatId === chat.id
              const unread = Number(chat.unreadCount ?? 0)
              return (
                <button key={chat.id} onClick={() => handleSelectChat(chat.id)} className={`w-full text-left px-4 py-3 border-b border-gray-100 transition-colors ${isSelected ? 'bg-green-50' : 'hover:bg-gray-50'}`}>
                  <div className="flex items-start gap-3">
                    {chat.friendPictureUrl ? <img src={chat.friendPictureUrl} alt="" className="w-10 h-10 rounded-full flex-shrink-0" /> : <div className="w-10 h-10 rounded-full bg-gray-200 flex items-center justify-center flex-shrink-0"><span className="text-gray-500 text-sm">{(chat.friendName || '?').charAt(0)}</span></div>}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-medium text-gray-900 truncate">{chat.friendName}</p>
                        <span className="text-[10px] text-gray-400 flex-shrink-0">{formatListTime(chat.lastMessageAt)}</span>
                      </div>
                      <p className="text-xs text-gray-500 truncate mt-0.5">{chat.preview || 'メッセージはありません'}</p>
                      {(chat.tags ?? []).length > 0 && (
                        <div className="flex items-center gap-1 mt-1 flex-wrap">
                          {(chat.tags ?? []).slice(0, 3).map((tag: string) => (<span key={tag} className="px-1.5 py-0.5 text-[10px] rounded bg-gray-100 text-gray-600">{tag}</span>))}
                        </div>
                      )}
                    </div>
                    {unread > 0
                      ? <span className="ml-1 min-w-[20px] h-5 px-1.5 rounded-full bg-danger-600 text-white text-[11px] font-bold flex items-center justify-center flex-shrink-0">{unread > 99 ? '99+' : unread}</span>
                      : <Badge tone={statusTone[chat.status] ?? 'neutral'} className="ml-1">{st.label}</Badge>}
                  </div>
                </button>
              )
            })}</>)}
        </div></div>

      <div className={`flex-1 flex overflow-hidden ${selectedChatId ? 'flex' : 'hidden lg:flex'}`}>
        <div className="flex-1 bg-white rounded-lg shadow-sm border border-gray-200 flex-col overflow-hidden flex">
          {!selectedChatId ? (<div className="flex-1 flex items-center justify-center"><EmptyState title="チャットを選択してください" description="左の一覧から会話を選ぶと、やりとりが表示されます。" /></div>)
          : detailLoading ? (<div className="flex-1 flex items-center justify-center"><p className="text-gray-400 text-sm">読み込み中...</p></div>)
          : chatDetail ? (<>
            <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between gap-2 shrink-0">
              <div className="flex items-center gap-2 min-w-0">
                <button onClick={() => setSelectedChatId(null)} className="lg:hidden flex-shrink-0 p-1 -ml-1 text-gray-500 hover:text-gray-700"><svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg></button>
                {chatDetail.friendPictureUrl && <img src={chatDetail.friendPictureUrl} alt="" className="w-8 h-8 rounded-full flex-shrink-0" />}
                <div className="min-w-0"><p className="text-sm font-medium text-gray-900 truncate">{chatDetail.friendName}</p><Badge tone={statusTone[chatDetail.status] ?? 'neutral'} className="mt-0.5">{(statusConfig[chatDetail.status] || {}).label || chatDetail.status}</Badge></div>
              </div>
              <div className="flex items-center gap-1.5">
                <button onClick={() => setShowNotes(!showNotes)} className={`px-2.5 py-1.5 text-xs font-medium rounded-md ${showNotes ? 'bg-gray-200 text-gray-700' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}>📝 メモ</button>
                <button onClick={() => setShowCustomerInfo(!showCustomerInfo)} className={`px-2.5 py-1.5 text-xs font-medium rounded-md ${showCustomerInfo ? 'bg-indigo-100 text-indigo-700' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}>📋 顧客情報</button>
                {chatDetail.status !== 'in_progress' && <Button size="sm" variant="secondary" onClick={() => handleStatusUpdate('in_progress')}>要対応</Button>}
                {chatDetail.status !== 'resolved' && <Button size="sm" variant="secondary" onClick={() => handleStatusUpdate('resolved')}>対応済み</Button>}
              </div>
            </div>
            {showNotes && (
              <div className="px-4 py-2 border-b border-gray-200 bg-yellow-50/50 shrink-0">
                <div className="flex items-center gap-2"><input type="text" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="メモを入力..." className="flex-1 text-xs border border-yellow-200 rounded-md px-2 py-1.5 bg-white focus:outline-none focus:ring-1 focus:ring-green-500" /><button onClick={handleSaveNotes} disabled={savingNotes} className="px-2.5 py-1.5 text-xs font-medium text-yellow-800 bg-yellow-100 hover:bg-yellow-200 rounded-md">{savingNotes ? '...' : '保存'}</button></div>
              </div>
            )}
            <div ref={messageScrollRef} className="flex-1 overflow-y-auto p-4 space-y-2" style={{ backgroundColor: '#7494C0' }}>
              {hasMoreOlder && (
                <div className="flex justify-center pb-2">
                  <button onClick={loadOlderMessages} disabled={loadingOlder} className="px-3 py-1.5 text-xs font-medium rounded-full bg-white/90 text-gray-600 shadow-sm hover:bg-white disabled:opacity-60">{loadingOlder ? '読み込み中...' : '過去のメッセージを見る'}</button>
                </div>
              )}
              {(!chatDetail.messages || chatDetail.messages.length === 0) ? (<p className="text-center text-white/60 text-sm py-8">メッセージはまだありません。</p>)
              : (chatDetail.messages ?? []).map((msg: any) => { const isOut = msg.direction === 'outgoing'; let content: React.ReactNode = <span>{msg.content}</span>; if (msg.messageType === 'email') content = <div>{msg.meta?.subject && <div className="text-xs font-bold mb-1 opacity-80">✉️ {msg.meta.subject}</div>}<div className="whitespace-pre-wrap text-sm">{msg.content}</div></div>; return (<div key={msg.id} className={`flex items-end gap-2 ${isOut ? 'justify-end' : 'justify-start'}`}><div className={`max-w-[75%] px-3 py-2 text-sm break-words whitespace-pre-wrap ${isOut ? 'rounded-tl-2xl rounded-tr-md rounded-bl-2xl rounded-br-2xl text-white' : 'rounded-tl-md rounded-tr-2xl rounded-bl-2xl rounded-br-2xl bg-white text-gray-900'}`} style={isOut ? { backgroundColor: '#06C755' } : undefined}>{content}</div></div>)})}
              <div ref={messagesEndRef} />
            </div>
            <div className="border-t border-gray-200 bg-white shrink-0">
              <div className="px-3 py-1.5 border-b border-gray-100 flex items-center gap-1">
                {chatDetail && <AiDraftButton chatId={selectedChatId!} messages={(chatDetail.messages ?? []).map((m: any) => ({ direction: m.direction, messageType: m.messageType, content: m.content, meta: m.meta }))} onSelect={handleDraftSelect} />}
              </div>
              <div className="border-b border-gray-100">
                <QuickReplyTemplates onSelect={(text: string) => setMessageContent(text)} />
              </div>
              <div className="px-3 py-2 flex items-end gap-2">
                <textarea ref={textareaRef} value={messageContent} onChange={handleTextareaChange} onKeyDown={handleKeyDown} placeholder="メッセージを入力... (Shift+Enterで改行)" rows={1} className="flex-1 text-sm border border-gray-300 rounded-2xl px-4 py-2.5 bg-gray-50 focus:outline-none focus:ring-2 focus:ring-green-500 focus:bg-white resize-none min-h-[42px] max-h-[160px] leading-relaxed" />
                <button onClick={handleSendMessage} disabled={sending || !messageContent.trim()} className="w-10 h-10 rounded-full flex items-center justify-center text-white shrink-0 disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90 transition-opacity mb-0.5" style={{ backgroundColor: '#06C755' }}>
                  <svg className="w-4.5 h-4.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h14M12 5l7 7-7 7" /></svg>
                </button>
              </div>
            </div>
          </>) : null}
        </div>
      </div>
    </div>

    {/* 顧客情報オーバーレイ — fixedで画面全体に対して重ねる */}
    {selectedChatId && chatDetail && showCustomerInfo && (
      <div className="fixed inset-0 z-50 flex justify-end">
        <div className="w-full lg:w-80 bg-white border-l border-gray-200 flex flex-col h-full shadow-2xl animate-in slide-in-from-right duration-200">
          <CustomerInfoPanel friendId={chatDetail.friendId} friendName={chatDetail.friendName} friendPictureUrl={chatDetail.friendPictureUrl} friendEmail={chatDetail.customerEmail} chatStatus={chatDetail.status} onClose={() => setShowCustomerInfo(false)} />
        </div>
        {/* 背面領域 — クリックで閉じる */}
        <div className="hidden lg:block flex-1 bg-black/20" onClick={() => setShowCustomerInfo(false)} />
      </div>
    )}
  </div>)
}
