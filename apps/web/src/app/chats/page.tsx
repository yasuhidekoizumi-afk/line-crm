'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { api, fetchApi } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import QuickReplyTemplates from '@/components/chats/quick-reply'
import CustomerInfoPanel from '@/components/chats/customer-info'
import AiDraftButton from '@/components/chats/ai-draft-button'

const statusConfig: Record<string, { label: string; className: string }> = { unread: { label: '未読', className: 'bg-red-100 text-red-700' }, in_progress: { label: '対応中', className: 'bg-yellow-100 text-yellow-700' }, resolved: { label: '解決済', className: 'bg-green-100 text-green-700' } }
const statusFilters = [{ key: 'all' as const, label: '全て' }, { key: 'unread' as const, label: '未読' }, { key: 'in_progress' as const, label: '対応中' }, { key: 'resolved' as const, label: '解決済' }]
const channelFilters = [{ key: 'all' as const, label: '全チャネル' }, { key: 'line' as const, label: 'LINE' }, { key: 'email' as const, label: '✉️ メール' }]
function formatDatetime(iso: string | null): string { if (!iso) return '-'; return new Date(iso).toLocaleString('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) }

export default function ChatsPage() {
  const { selectedAccountId } = useAccount()
  const [chats, setChats] = useState<any[]>([]); const [selectedChatId, setSelectedChatId] = useState<string | null>(null)
  const [chatDetail, setChatDetail] = useState<any>(null); const [statusFilter, setStatusFilter] = useState('all'); const [channelFilter, setChannelFilter] = useState('all')
  const [loading, setLoading] = useState(true); const [detailLoading, setDetailLoading] = useState(false); const [error, setError] = useState(''); const [messageContent, setMessageContent] = useState(''); const [sending, setSending] = useState(false)
  const [notes, setNotes] = useState(''); const [savingNotes, setSavingNotes] = useState(false); const [showCustomerInfo, setShowCustomerInfo] = useState(false); const [showNotes, setShowNotes] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const loadChats = useCallback(async () => {
    setLoading(true); setError('')
    try { const params: any = {}; if (statusFilter !== 'all') params.status = statusFilter; if (selectedAccountId) params.accountId = selectedAccountId; if (channelFilter !== 'all') params.channel = channelFilter
      const chatRes = await api.chats.list(params)
      if (chatRes.success) setChats(chatRes.data as any[])
    } catch { setError('チャットの読み込みに失敗しました') } finally { setLoading(false) }
  }, [statusFilter, channelFilter, selectedAccountId])

  const loadChatDetail = useCallback(async (chatId: string) => { setDetailLoading(true); try { const res = await api.chats.get(chatId); if (res.success) { setChatDetail(res.data); setNotes(res.data.notes || '') } } catch { setError('チャット詳細の読み込みに失敗') } finally { setDetailLoading(false) } }, [])

  useEffect(() => { loadChats() }, [loadChats])
  useEffect(() => { if (selectedChatId) { loadChatDetail(selectedChatId) } else { setChatDetail(null); setShowCustomerInfo(false) } }, [selectedChatId, loadChatDetail])

  const handleSelectChat = (chatId: string) => { setSelectedChatId(chatId); setMessageContent('') }
  const handleSendMessage = async () => { if (!selectedChatId || !messageContent.trim()) return; setSending(true); try { await api.chats.send(selectedChatId, { content: messageContent.trim() }); setMessageContent(''); loadChatDetail(selectedChatId); loadChats(); if (textareaRef.current) { textareaRef.current.style.height = 'auto' } } catch { setError('メッセージの送信に失敗') } finally { setSending(false) } }
  const handleStatusUpdate = async (newStatus: string) => { if (!selectedChatId) return; try { await api.chats.update(selectedChatId, { status: newStatus }); loadChatDetail(selectedChatId); loadChats() } catch { setError('ステータスの更新に失敗') } }
  const handleSaveNotes = async () => { if (!selectedChatId) return; setSavingNotes(true); try { await api.chats.update(selectedChatId, { notes }); loadChatDetail(selectedChatId) } catch { setError('メモの保存に失敗') } finally { setSavingNotes(false) } }
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendMessage() } }
  const handleDraftSelect = (text: string) => { setMessageContent(text) }

  // Auto-resize textarea
  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setMessageContent(e.target.value)
    const el = e.target
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 160) + 'px'
  }

  return (<div>
    {error && <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{error}</div>}
    <div className="flex gap-0 h-[calc(100vh-120px)] lg:h-[calc(100vh-180px)]">
      <div className={`w-full lg:w-96 lg:flex-shrink-0 bg-white rounded-lg shadow-sm border border-gray-200 flex-col overflow-hidden ${selectedChatId ? 'hidden lg:flex' : 'flex'}`}>
        <div className="flex border-b border-gray-200 bg-gray-50">{channelFilters.map((f) => (<button key={f.key} onClick={() => { setChannelFilter(f.key); setSelectedChatId(null) }} className={`flex-1 px-3 py-2 min-h-[40px] text-xs font-medium transition-colors ${channelFilter === f.key ? 'bg-white text-gray-900 border-b-2 border-purple-600' : 'text-gray-500 hover:bg-white'}`}>{f.label}</button>))}</div>
        <div className="flex border-b border-gray-200">{statusFilters.map((f) => (<button key={f.key} onClick={() => { setStatusFilter(f.key); setSelectedChatId(null) }} className={`flex-1 px-3 py-2.5 min-h-[44px] text-xs font-medium transition-colors ${statusFilter === f.key ? 'text-white' : 'text-gray-600 hover:bg-gray-50'}`} style={statusFilter === f.key ? { backgroundColor: '#06C755' } : undefined}>{f.label}</button>))}</div>
        <div className="flex-1 overflow-y-auto">{loading ? (<div>{[...Array(5)].map((_, i) => (<div key={i} className="px-4 py-3 border-b border-gray-100 animate-pulse"><div className="h-3 bg-gray-200 rounded w-32" /><div className="h-2 bg-gray-100 rounded w-20 mt-2" /></div>))}</div>) : (<>{chats.map((chat: any) => { const st = statusConfig[chat.status] || { label: chat.status, className: 'bg-gray-100 text-gray-600' }; const isSelected = selectedChatId === chat.id; return (<button key={chat.id} onClick={() => handleSelectChat(chat.id)} className={`w-full text-left px-4 py-3 border-b border-gray-100 transition-colors ${isSelected ? 'bg-green-50' : 'hover:bg-gray-50'}`}><div className="flex items-center gap-3">{chat.friendPictureUrl ? <img src={chat.friendPictureUrl} alt="" className="w-10 h-10 rounded-full flex-shrink-0" /> : <div className="w-10 h-10 rounded-full bg-gray-200 flex items-center justify-center flex-shrink-0"><span className="text-gray-500 text-sm">{(chat.friendName || '?').charAt(0)}</span></div>}<div className="min-w-0 flex-1"><p className="text-sm font-medium text-gray-900 truncate">{chat.friendName}</p><p className="text-xs text-gray-400 mt-0.5">{formatDatetime(chat.lastMessageAt)}</p></div><span className={`ml-2 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium flex-shrink-0 ${st.className}`}>{st.label}</span></div></button>)})}</>)}</div></div>
      <div className={`flex-1 flex overflow-hidden ${selectedChatId ? 'flex' : 'hidden lg:flex'}`}>
        <div className="flex-1 bg-white rounded-lg shadow-sm border border-gray-200 flex-col overflow-hidden flex">
          {!selectedChatId ? (<div className="flex-1 flex items-center justify-center"><p className="text-gray-400 text-sm">チャットを選択してください</p></div>)
          : detailLoading ? (<div className="flex-1 flex items-center justify-center"><p className="text-gray-400 text-sm">読み込み中...</p></div>)
          : chatDetail ? (<>
            <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between gap-2 shrink-0">
              <div className="flex items-center gap-2 min-w-0">
                <button onClick={() => setSelectedChatId(null)} className="lg:hidden flex-shrink-0 p-1 -ml-1 text-gray-500 hover:text-gray-700"><svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg></button>
                {chatDetail.friendPictureUrl && <img src={chatDetail.friendPictureUrl} alt="" className="w-8 h-8 rounded-full flex-shrink-0" />}
                <div className="min-w-0"><p className="text-sm font-medium text-gray-900 truncate">{chatDetail.friendName}</p><span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium mt-0.5 ${(statusConfig[chatDetail.status] || {}).className}`}>{(statusConfig[chatDetail.status] || {}).label || chatDetail.status}</span></div>
              </div>
              <div className="flex items-center gap-1.5">
                <button onClick={() => setShowNotes(!showNotes)} className={`px-2.5 py-1.5 text-xs font-medium rounded-md ${showNotes ? 'bg-gray-200 text-gray-700' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}>📝 メモ</button>
                <button onClick={() => setShowCustomerInfo(!showCustomerInfo)} className={`px-2.5 py-1.5 text-xs font-medium rounded-md ${showCustomerInfo ? 'bg-indigo-100 text-indigo-700' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}>📋 顧客情報</button>
                {chatDetail.status !== 'in_progress' && <button onClick={() => handleStatusUpdate('in_progress')} className="px-2.5 py-1.5 text-xs font-medium text-yellow-700 bg-yellow-50 hover:bg-yellow-100 rounded-md">対応中</button>}
                {chatDetail.status !== 'resolved' && <button onClick={() => handleStatusUpdate('resolved')} className="px-2.5 py-1.5 text-xs font-medium text-green-700 bg-green-50 hover:bg-green-100 rounded-md">解決済</button>}
              </div>
            </div>
            {showNotes && (
              <div className="px-4 py-2 border-b border-gray-200 bg-yellow-50/50 shrink-0">
                <div className="flex items-center gap-2"><input type="text" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="メモを入力..." className="flex-1 text-xs border border-yellow-200 rounded-md px-2 py-1.5 bg-white focus:outline-none focus:ring-1 focus:ring-green-500" /><button onClick={handleSaveNotes} disabled={savingNotes} className="px-2.5 py-1.5 text-xs font-medium text-yellow-800 bg-yellow-100 hover:bg-yellow-200 rounded-md">{savingNotes ? '...' : '保存'}</button></div>
              </div>
            )}
            <div className="flex-1 overflow-y-auto p-4 space-y-2" style={{ backgroundColor: '#7494C0' }}>
              {(!chatDetail.messages || chatDetail.messages.length === 0) ? (<p className="text-center text-white/60 text-sm py-8">メッセージはまだありません。</p>)
              : (chatDetail.messages ?? []).map((msg: any) => { const isOut = msg.direction === 'outgoing'; let content: React.ReactNode = <span>{msg.content}</span>; if (msg.messageType === 'email') content = <div>{msg.meta?.subject && <div className="text-xs font-bold mb-1 opacity-80">✉️ {msg.meta.subject}</div>}<div className="whitespace-pre-wrap text-sm">{msg.content}</div></div>; return (<div key={msg.id} className={`flex items-end gap-2 ${isOut ? 'justify-end' : 'justify-start'}`}><div className={`max-w-[75%] px-3 py-2 text-sm break-words whitespace-pre-wrap ${isOut ? 'rounded-tl-2xl rounded-tr-md rounded-bl-2xl rounded-br-2xl text-white' : 'rounded-tl-md rounded-tr-2xl rounded-bl-2xl rounded-br-2xl bg-white text-gray-900'}`} style={isOut ? { backgroundColor: '#06C755' } : undefined}>{content}</div></div>)})}
            </div>
            <div className="border-t border-gray-200 bg-white shrink-0">
              <div className="px-3 py-1.5 border-b border-gray-100 flex items-center gap-1">
                {chatDetail && <AiDraftButton chatId={selectedChatId!} messages={(chatDetail.messages ?? []).map((m: any) => ({ direction: m.direction, messageType: m.messageType, content: m.content, meta: m.meta }))} onSelect={handleDraftSelect} />}
              </div>
              <div className="border-b border-gray-100">
                <QuickReplyTemplates onSelect={(text: string) => setMessageContent(text)} />
              </div>
              {/* Message Input — textarea + send button side by side */}
              <div className="px-3 py-2 flex items-end gap-2">
                <textarea
                  ref={textareaRef}
                  value={messageContent}
                  onChange={handleTextareaChange}
                  onKeyDown={handleKeyDown}
                  placeholder="メッセージを入力... (Shift+Enterで改行)"
                  rows={1}
                  className="flex-1 text-sm border border-gray-300 rounded-2xl px-4 py-2.5 bg-gray-50 focus:outline-none focus:ring-2 focus:ring-green-500 focus:bg-white resize-none min-h-[42px] max-h-[160px] leading-relaxed"
                />
                <button onClick={handleSendMessage} disabled={sending || !messageContent.trim()} className="w-10 h-10 rounded-full flex items-center justify-center text-white shrink-0 disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90 transition-opacity mb-0.5" style={{ backgroundColor: '#06C755' }}>
                  <svg className="w-4.5 h-4.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h14M12 5l7 7-7 7" /></svg>
                </button>
              </div>
            </div>
          </>) : null}
          {selectedChatId && chatDetail && showCustomerInfo && (<div className="hidden lg:flex"><CustomerInfoPanel friendId={chatDetail.friendId} friendName={chatDetail.friendName} friendPictureUrl={chatDetail.friendPictureUrl} friendEmail={chatDetail.customerEmail} chatStatus={chatDetail.status} onClose={() => setShowCustomerInfo(false)} /></div>)}
        </div>
      </div>
    </div>
  </div>)
}
