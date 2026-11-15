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

// status は「対応状況」。メッセージの未読（未読タブ）とは別軸なのでラベルを分ける。
const statusConfig: Record<string, { label: string; className: string }> = { unread: { label: '未対応', className: 'bg-red-100 text-red-700' }, in_progress: { label: '要対応', className: 'bg-yellow-100 text-yellow-700' }, resolved: { label: '対応済み', className: 'bg-green-100 text-green-700' } }
const statusFilters = [{ key: 'all' as const, label: 'すべて' }, { key: 'unread' as const, label: '未読' }, { key: 'in_progress' as const, label: '要対応' }, { key: 'resolved' as const, label: '対応済み' }]
const channelFilters = [{ key: 'all' as const, label: '全チャネル' }, { key: 'line' as const, label: 'LINE' }, { key: 'email' as const, label: '✉️ メール' }]

// AIトリアージ（CS）の状態表示。ai_status は chats に保存されているが、
// これまで会話画面に出ていなかったため、一覧とヘッダで見えるようにする。
const aiStatusConfig: Record<string, { label: string; className: string }> = {
  l1_auto_replied: { label: 'AI自動返信', className: 'bg-green-100 text-green-700' },
  l2_draft_pending: { label: 'AI下書き', className: 'bg-purple-100 text-purple-700' },
  l2_approved: { label: 'AI承認済', className: 'bg-blue-100 text-blue-700' },
  l3_escalated: { label: 'AI要対応', className: 'bg-red-100 text-red-700' },
  human_handled: { label: '有人対応', className: 'bg-gray-100 text-gray-600' },
}
const aiCategoryLabels: Record<string, string> = { faq: 'FAQ', order_status: '注文状況', refund: '返金', complaint: 'クレーム', product_question: '商品質問', other: 'その他' }

// 顧客の最終メッセージの意図（AI判定）。LINE公式アカウント管理画面からの返信は
// ハーネスに記録されないため、「未読」ではなくこの判定で要確認候補を出す。
const aiIntentConfig: Record<string, { label: string; className: string }> = {
  needs_reply: { label: '要返信(AI)', className: 'bg-red-100 text-red-700' },
  unclear: { label: '要確認(AI)', className: 'bg-yellow-100 text-yellow-800' },
  closing: { label: '応答不要(AI)', className: 'bg-gray-100 text-gray-500' },
}
const PAGE_SIZE = 100
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
  const draftRef = useRef<any>(null)
  const chatsRef = useRef<any[]>([])
  const olderLoadedRef = useRef(false)
  const [hasMoreOlder, setHasMoreOlder] = useState(false)
  const [loadingOlder, setLoadingOlder] = useState(false)
  // 検索はサーバー側。入力は即時、リクエストは300msデバウンス。
  const [searchInput, setSearchInput] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [sortMode, setSortMode] = useState<'recent' | 'unread' | 'stale'>('recent')
  const [mineOnly, setMineOnly] = useState(false)
  // AIが判定した「顧客がまだ何かを求めているか」で絞る（返信記録はハーネスに残らないため未読とは別物）
  const [intentFilter, setIntentFilter] = useState<'all' | 'needs_reply' | 'unchecked'>('all')
  const [classifying, setClassifying] = useState(false)
  const [classifyProgress, setClassifyProgress] = useState('')
  const [total, setTotal] = useState(0)
  const [hasMoreChats, setHasMoreChats] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [bulkReading, setBulkReading] = useState(false)
  // AI下書き（承認待ち）とテンプレート送信
  const [draft, setDraft] = useState<any>(null)
  const [draftText, setDraftText] = useState('')
  const [draftBusy, setDraftBusy] = useState(false)
  const [rejecting, setRejecting] = useState(false)
  const [rejectReason, setRejectReason] = useState('')
  const [templates, setTemplates] = useState<any[] | null>(null)
  // 送信失敗を握りつぶさず、同じ内容で再送できるようにする
  const [lastFailed, setLastFailed] = useState<{ chatId: string; messageType?: string; content: string } | null>(null)

  const loadChats = useCallback(async (opts?: { silent?: boolean; append?: boolean }) => {
    if (!opts?.silent) { if (opts?.append) setLoadingMore(true); else setLoading(true); setError('') }
    try {
      const params: {
        status?: string; accountId?: string; channel?: string; q?: string
        limit: number; offset: number; sort: 'recent' | 'unread' | 'stale'; assignedStaffId?: string; attention?: boolean
        intent?: 'needs_reply' | 'closing' | 'unclear' | 'unchecked'
      } = {
        limit: opts?.silent ? Math.max(PAGE_SIZE, chatsRef.current.length) : PAGE_SIZE,
        offset: opts?.append ? chatsRef.current.length : 0,
        sort: sortMode,
      }
      if (statusFilter !== 'all') params.status = statusFilter
      if (selectedAccountId) params.accountId = selectedAccountId
      if (channelFilter !== 'all') params.channel = channelFilter
      if (searchQuery) params.q = searchQuery
      if (mineOnly) params.assignedStaffId = 'me'
      if (intentFilter !== 'all') params.intent = intentFilter
      const chatRes = await api.chats.list(params)
      if (chatRes.success) {
        const list = chatRes.data as any[]
        setChats((prev) => (opts?.append ? [...prev, ...list] : list))
        setTotal(chatRes.meta?.total ?? list.length)
        setHasMoreChats(Boolean(chatRes.meta?.hasMore))
        return list
      }
    } catch { if (!opts?.silent) setError('チャットの読み込みに失敗しました') } finally { if (!opts?.silent) { setLoading(false); setLoadingMore(false) } }
    return null
  }, [statusFilter, channelFilter, selectedAccountId, searchQuery, sortMode, mineOnly, intentFilter])

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

  // 会話を開いたら既読にする（未読バッジだけを消し、対応状況は変えない）
  const markChatRead = useCallback(async (chatId: string) => {
    try {
      await api.chats.read(chatId)
      setChats((prev) => prev.map((ch: any) => (ch.id === chatId ? { ...ch, unreadCount: 0 } : ch)))
    } catch { /* 既読は失敗しても致命的ではない */ }
  }, [])

  useEffect(() => { loadChats() }, [loadChats])
  useEffect(() => { chatsRef.current = chats }, [chats])
  useEffect(() => { if (selectedAccountId && channelFilter === 'email') setChannelFilter('all') }, [selectedAccountId, channelFilter])
  // 検索入力のデバウンス
  useEffect(() => {
    const timer = setTimeout(() => setSearchQuery(searchInput.trim()), 300)
    return () => clearTimeout(timer)
  }, [searchInput])
  useEffect(() => {
    if (selectedChatId) { olderLoadedRef.current = false; loadChatDetail(selectedChatId) }
    else { setChatDetail(null); setShowCustomerInfo(false) }
  }, [selectedChatId, loadChatDetail])
  // 自動更新の比較用に、最新の詳細をrefへ保持する
  useEffect(() => { chatDetailRef.current = chatDetail }, [chatDetail])
  useEffect(() => { draftRef.current = draft }, [draft])
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
      // AI下書きが新しく作られた場合も拾う（承認待ちの取りこぼし防止）
      if (row?.aiStatus === 'l2_draft_pending' && !draftRef.current) {
        try {
          const res = await api.cs.draft(selectedChatId)
          const data = res.success ? (res.data as any) : null
          if (data) { setDraft(data); setDraftText(data.draftText ?? '') }
        } catch { /* 次回のポーリングで再試行する */ }
      }
    }, 30_000)
    return () => clearInterval(timer)
  }, [loadChats, loadChatDetail, selectedChatId])

  // 会話に紐づく承認待ちのAI下書きを取得する
  const loadDraft = useCallback(async (chatId: string) => {
    try {
      const res = await api.cs.draft(chatId)
      const data = res.success ? (res.data as any) : null
      setDraft(data)
      setDraftText(data?.draftText ?? '')
      setRejecting(false)
      setRejectReason('')
    } catch {
      setDraft(null)
      setDraftText('')
    }
  }, [])

  const handleSelectChat = (chatId: string) => {
    setSelectedChatId(chatId)
    setMessageContent('')
    setTemplates(null)
    const row = chatsRef.current.find((ch: any) => ch.id === chatId)
    if (row && Number(row.unreadCount ?? 0) > 0) void markChatRead(chatId)
    void loadDraft(chatId)
  }
  const handleSendMessage = async () => {
    if (!selectedChatId || !messageContent.trim()) return
    const payload = { messageType: 'text', content: messageContent.trim() }
    setSending(true)
    try {
      await api.chats.send(selectedChatId, payload)
      setLastFailed(null)
      setMessageContent('')
      loadChatDetail(selectedChatId)
      loadChats()
      if (textareaRef.current) textareaRef.current.style.height = 'auto'
    } catch {
      // 送れたか分からないまま消さない。同じ内容を再送できるように保持する
      setLastFailed({ chatId: selectedChatId, ...payload })
      setError('メッセージの送信に失敗しました（再送できます）')
    } finally { setSending(false) }
  }
  const handleRetrySend = async () => {
    if (!lastFailed) return
    setSending(true)
    try {
      await api.chats.send(lastFailed.chatId, { messageType: lastFailed.messageType, content: lastFailed.content })
      setLastFailed(null)
      setError('')
      loadChatDetail(lastFailed.chatId)
      loadChats()
    } catch { setError('再送に失敗しました。LINE側の状態を確認してください') } finally { setSending(false) }
  }
  // テンプレート（Flexカード・定型文）から送る。カードは即送信、テキストは入力欄へ。
  const toggleTemplates = async () => {
    if (templates) { setTemplates(null); return }
    try {
      const res = await api.templates.list()
      if (res.success) setTemplates((res.data as any[]).filter((t: any) => t.messageType === 'flex' || t.messageType === 'text'))
    } catch { setError('テンプレートの読み込みに失敗しました') }
  }
  const handleSendTemplate = async (tpl: any) => {
    setTemplates(null)
    if (!selectedChatId) return
    if (tpl.messageType === 'text') { setMessageContent(tpl.messageContent); return }
    setSending(true)
    try {
      await api.chats.send(selectedChatId, { messageType: tpl.messageType, content: tpl.messageContent })
      setLastFailed(null)
      loadChatDetail(selectedChatId)
      loadChats()
    } catch {
      setLastFailed({ chatId: selectedChatId, messageType: tpl.messageType, content: tpl.messageContent })
      setError('テンプレートの送信に失敗しました（再送できます）')
    } finally { setSending(false) }
  }
  // AI下書きの承認（そのまま送信）と、編集して送信
  const handleApproveDraft = async (edited: boolean) => {
    if (!draft || !selectedChatId) return
    setDraftBusy(true)
    try {
      await api.cs.approveDraft(draft.id, edited ? draftText : undefined)
      setDraft(null)
      setDraftText('')
      loadChatDetail(selectedChatId)
      loadChats()
    } catch { setError('AI下書きの送信に失敗しました（下書きは残っています）') } finally { setDraftBusy(false) }
  }
  const handleRejectDraft = async () => {
    if (!draft || !selectedChatId) return
    if (!rejectReason.trim()) { setError('却下理由を入力してください（AIの精度改善に使います）'); return }
    setDraftBusy(true)
    try {
      await api.cs.rejectDraft(draft.id, rejectReason.trim())
      setDraft(null)
      setRejecting(false)
      setRejectReason('')
      loadChats()
    } catch { setError('却下に失敗しました') } finally { setDraftBusy(false) }
  }
  const handleStatusUpdate = async (newStatus: NonNullable<Parameters<typeof api.chats.update>[1]['status']>) => { if (!selectedChatId) return; try { await api.chats.update(selectedChatId, { status: newStatus }); loadChatDetail(selectedChatId); loadChats() } catch { setError('ステータスの更新に失敗') } }
  const handleSaveNotes = async () => { if (!selectedChatId) return; setSavingNotes(true); try { await api.chats.update(selectedChatId, { notes }); loadChatDetail(selectedChatId) } catch { setError('メモの保存に失敗') } finally { setSavingNotes(false) } }
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendMessage() } }
  const handleDraftSelect = (text: string) => { setMessageContent(text) }
  // 担当を取る（他者が対応中なら409。表示を最新化して知らせる）
  const handleClaim = async () => {
    if (!selectedChatId) return
    try {
      const res = await api.chats.claim(selectedChatId)
      if (res.success) {
        setChatDetail((prev: any) => (prev ? { ...prev, assignedStaffId: res.data.assignedStaffId, assignedStaffName: res.data.assignedStaffName } : prev))
        void loadChats({ silent: true })
      }
    } catch {
      setError('担当を設定できませんでした（他のスタッフが対応中の可能性があります）')
      void loadChatDetail(selectedChatId, { silent: true })
    }
  }
  // 表示中の会話をまとめて既読にする
  const handleReadAll = async () => {
    const ids = chatsRef.current.filter((ch: any) => Number(ch.unreadCount ?? 0) > 0).map((ch: any) => ch.id)
    if (ids.length === 0) return
    setBulkReading(true)
    try {
      await api.chats.readAll(ids)
      setChats((prev) => prev.map((ch: any) => ({ ...ch, unreadCount: 0 })))
      void loadChats({ silent: true })
    } catch { setError('一括既読に失敗しました') } finally { setBulkReading(false) }
  }
  // 未判定の会話をAIで判定する（残件が0になるまで10件ずつ）
  const handleClassifyIntents = async () => {
    if (classifying) return
    setClassifying(true)
    setError('')
    let total = 0
    let needs = 0
    try {
      for (let i = 0; i < 40; i += 1) {
        const res = await api.chats.classifyIntents(10)
        if (!res.success) break
        const d = res.data as any
        total += Number(d.processed ?? 0)
        needs += Number(d.needs_reply ?? 0)
        setClassifyProgress(`${total}件を判定・要返信 ${needs}件・残り ${d.remaining ?? 0}件`)
        if (!d.remaining || !d.processed) break
      }
      await loadChats()
    } catch { setError('AI判定に失敗しました（時間をおいて再実行してください）') }
    finally { setClassifying(false); setTimeout(() => setClassifyProgress(''), 5000) }
  }
  // 画像はアップロードしてからLINEに送る（R2の公開URLを使用）
  const handleImageSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || !selectedChatId) return
    setSending(true)
    try {
      const uploaded = await api.images.upload(file)
      await api.chats.send(selectedChatId, {
        messageType: 'image',
        content: JSON.stringify({ originalContentUrl: uploaded.url, previewImageUrl: uploaded.url }),
      })
      loadChatDetail(selectedChatId)
      loadChats()
    } catch {
      setError('画像の送信に失敗しました')
    } finally {
      setSending(false)
    }
  }
  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => { setMessageContent(e.target.value); const el = e.target; el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 160) + 'px' }

  const unreadChatCount = useMemo(() => chats.filter((ch: any) => Number(ch.unreadCount ?? 0) > 0).length, [chats])

  const visibleChannelFilters = selectedAccountId ? channelFilters.filter((filter) => filter.key !== 'email') : channelFilters
  return (<div>
    {error && <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm flex items-start justify-between gap-3"><span>{error}</span><div className="flex items-center gap-2 shrink-0">{lastFailed && <button onClick={handleRetrySend} disabled={sending} className="px-2 py-1 rounded bg-red-600 text-white text-xs font-medium hover:bg-red-700 disabled:opacity-50">再送</button>}<button onClick={() => setError('')} className="text-red-500 hover:text-red-700 text-xs">閉じる</button></div></div>}
    <div className="flex gap-0 h-[calc(100vh-120px)] lg:h-[calc(100vh-180px)]">
      <div className={`w-full lg:w-96 lg:flex-shrink-0 bg-surface rounded-card shadow-card border border-line flex-col overflow-hidden ${selectedChatId ? 'hidden lg:flex' : 'flex'}`}>
        {/* 検索・並び替え（LINE公式アカウントの一覧に近づける） */}
        <div className="px-3 py-2 border-b border-gray-200 bg-white flex items-center gap-2">
          <TextInput type="search" value={searchInput} onChange={(e) => setSearchInput(e.target.value)} placeholder="名前・タグ・メールで検索" aria-label="チャットを検索" className="flex-1 min-w-0 text-xs py-1.5" />
          <select value={sortMode} onChange={(e) => setSortMode(e.target.value as 'recent' | 'unread' | 'stale')} className="text-xs border border-gray-300 rounded-md px-1.5 py-1.5 bg-white text-gray-600" title="並び替え">
            <option value="recent">最新順</option>
            <option value="unread">未読優先</option>
            <option value="stale">古い順</option>
          </select>
        </div>
        <div className="flex border-b border-gray-200 bg-gray-50">{visibleChannelFilters.map((f) => (<button key={f.key} onClick={() => { setChannelFilter(f.key); setSelectedChatId(null) }} className={`flex-1 px-3 py-2 min-h-[40px] text-xs font-medium transition-colors ${channelFilter === f.key ? 'bg-white text-gray-900 border-b-2 border-purple-600' : 'text-gray-500 hover:bg-white'}`}>{f.label}</button>))}</div>
        <div className="flex border-b border-gray-200">{statusFilters.map((f) => (<button key={f.key} onClick={() => { setStatusFilter(f.key); setSelectedChatId(null) }} className={`flex-1 px-3 py-2.5 min-h-[44px] text-xs font-medium transition-colors ${statusFilter === f.key ? 'text-white' : 'text-gray-600 hover:bg-gray-50'}`} style={statusFilter === f.key ? { backgroundColor: '#06C755' } : undefined}>{f.label}</button>))}</div>
        {/* 件数と一括既読（未読の定義はサーバー側で一元化） */}
        <div className="px-3 py-1.5 border-b border-gray-100 bg-white flex items-center justify-between gap-2">
          <span className="text-[11px] text-gray-500">全{total}件{unreadChatCount > 0 ? `・未読${unreadChatCount}件` : ''}</span>
          <div className="flex items-center gap-2">
            <button onClick={() => setIntentFilter(intentFilter === 'needs_reply' ? 'all' : 'needs_reply')} className={`px-1.5 py-0.5 text-[11px] rounded ${intentFilter === 'needs_reply' ? 'bg-red-100 text-red-700' : 'text-gray-400 hover:text-gray-600'}`} title="AIが「顧客はまだ何かを求めている」と判定した会話だけ表示">要返信(AI)</button>
            <button onClick={() => setIntentFilter(intentFilter === 'unchecked' ? 'all' : 'unchecked')} className={`px-1.5 py-0.5 text-[11px] rounded ${intentFilter === 'unchecked' ? 'bg-gray-200 text-gray-700' : 'text-gray-400 hover:text-gray-600'}`} title="まだAI判定していない会話">未判定</button>
            <button onClick={handleClassifyIntents} disabled={classifying} className="px-1.5 py-0.5 text-[11px] rounded text-purple-600 hover:bg-purple-50 disabled:opacity-50" title="未判定の会話をAIで判定します">{classifying ? '判定中...' : 'AI判定'}</button>
            <button onClick={() => setMineOnly((v) => !v)} className={`px-1.5 py-0.5 text-[11px] rounded ${mineOnly ? 'bg-green-100 text-green-700' : 'text-gray-400 hover:text-gray-600'}`}>自分の担当</button>
            <button onClick={handleReadAll} disabled={bulkReading || unreadChatCount === 0} className="px-1.5 py-0.5 text-[11px] rounded text-gray-500 hover:text-gray-700 disabled:opacity-40">一括既読</button>
          </div>
        </div>
        {classifyProgress && (<div className="px-3 py-1 text-[11px] text-purple-700 bg-purple-50 border-b border-purple-100">{classifyProgress}</div>)}
        <div className="flex-1 overflow-y-auto">
          {loading ? (<div>{[...Array(5)].map((_, i) => (<div key={i} className="px-4 py-3 border-b border-gray-100 animate-pulse"><div className="h-3 bg-gray-200 rounded w-32" /><div className="h-2 bg-gray-100 rounded w-20 mt-2" /></div>))}</div>)
          : chats.length === 0 ? (<div className="py-10 text-center text-xs text-gray-400">該当するチャットがありません</div>)
          : (<>{chats.map((chat: any) => {
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
                      <div className="flex items-center gap-1 mt-1 flex-wrap">
                        {aiIntentConfig[chat.aiIntent] && (<span className={`px-1.5 py-0.5 text-[10px] rounded ${aiIntentConfig[chat.aiIntent].className}`} title={chat.aiIntentReason ?? ''}>{aiIntentConfig[chat.aiIntent].label}</span>)}
                        {aiStatusConfig[chat.aiStatus] && (<span className={`px-1.5 py-0.5 text-[10px] rounded ${aiStatusConfig[chat.aiStatus].className}`}>{aiStatusConfig[chat.aiStatus].label}</span>)}
                        {chat.aiMoneyFlag && <span className="px-1.5 py-0.5 text-[10px] rounded bg-orange-100 text-orange-700">💰 金銭</span>}
                        {chat.assignedStaffName && (<span className="px-1.5 py-0.5 text-[10px] rounded bg-indigo-50 text-indigo-600">👤 {chat.assignedStaffName}</span>)}
                        {(chat.tags ?? []).slice(0, 3).map((tag: string) => (<span key={tag} className="px-1.5 py-0.5 text-[10px] rounded bg-gray-100 text-gray-600">{tag}</span>))}
                      </div>
                    </div>
                    {unread > 0
                      ? <span className="ml-1 min-w-[20px] h-5 px-1.5 rounded-full bg-danger-600 text-white text-[11px] font-bold flex items-center justify-center flex-shrink-0">{unread > 99 ? '99+' : unread}</span>
                      : <Badge tone={statusTone[chat.status] ?? 'neutral'} className="ml-1">{st.label}</Badge>}
                  </div>
                </button>
              )
            })}
            {hasMoreChats && (
              <div className="py-3 text-center">
                <button onClick={() => loadChats({ append: true })} disabled={loadingMore} className="px-3 py-1.5 text-xs font-medium rounded-md bg-gray-100 text-gray-600 hover:bg-gray-200 disabled:opacity-50">{loadingMore ? '読み込み中...' : 'もっと見る'}</button>
              </div>
            )}</>)}
        </div></div>

      <div className={`flex-1 flex overflow-hidden ${selectedChatId ? 'flex' : 'hidden lg:flex'}`}>
        <div className="flex-1 bg-surface rounded-card shadow-card border border-line flex-col overflow-hidden flex">
          {!selectedChatId ? (<div className="flex-1 flex items-center justify-center"><EmptyState title="チャットを選択してください" description="左の一覧から会話を選ぶと、やりとりが表示されます。" /></div>)
          : detailLoading ? (<div className="flex-1 flex items-center justify-center"><p className="text-gray-400 text-sm">読み込み中...</p></div>)
          : chatDetail ? (<>
            <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between gap-2 shrink-0">
              <div className="flex items-center gap-2 min-w-0">
                <button onClick={() => setSelectedChatId(null)} className="lg:hidden flex-shrink-0 p-1 -ml-1 text-gray-500 hover:text-gray-700"><svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg></button>
                {chatDetail.friendPictureUrl && <img src={chatDetail.friendPictureUrl} alt="" className="w-8 h-8 rounded-full flex-shrink-0" />}
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">{chatDetail.friendName}</p>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <Badge tone={statusTone[chatDetail.status] ?? 'neutral'}>{(statusConfig[chatDetail.status] || {}).label || chatDetail.status}</Badge>
                    {aiStatusConfig[chatDetail.aiStatus] && (<span className={`px-1.5 py-0.5 text-[10px] rounded ${aiStatusConfig[chatDetail.aiStatus].className}`}>{aiStatusConfig[chatDetail.aiStatus].label}</span>)}
                    {aiIntentConfig[chatDetail.aiIntent] && (<span className={`px-1.5 py-0.5 text-[10px] rounded ${aiIntentConfig[chatDetail.aiIntent].className}`} title={chatDetail.aiIntentReason ?? ''}>{aiIntentConfig[chatDetail.aiIntent].label}</span>)}
                    {chatDetail.aiCategory && (<span className="text-[10px] text-gray-500">{aiCategoryLabels[chatDetail.aiCategory] ?? chatDetail.aiCategory}</span>)}
                    {chatDetail.aiMoneyFlag && <span className="px-1.5 py-0.5 text-[10px] rounded bg-orange-100 text-orange-700">💰 金銭</span>}
                    {chatDetail.assignedStaffName
                      ? <span className="text-[10px] text-indigo-600">担当: {chatDetail.assignedStaffName}</span>
                      : <button onClick={handleClaim} className="text-[10px] text-gray-500 hover:text-indigo-600 underline">自分が担当</button>}
                  </div>
                </div>
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
              : (chatDetail.messages ?? []).map((msg: any) => { const isOut = msg.direction === 'outgoing'; let content: React.ReactNode = <span>{msg.content}</span>; if (msg.messageType === 'image') { try { const img = JSON.parse(msg.content) as { originalContentUrl?: string }; content = img.originalContentUrl ? <img src={img.originalContentUrl} alt="送信画像" className="max-w-full rounded-lg" /> : <span>[画像]</span> } catch { content = <span>[画像]</span> } } if (msg.messageType === 'sticker') { try { const s = JSON.parse(msg.content) as { stickerId?: string }; content = s.stickerId ? <img src={`https://stickershop.line-scdn.net/stickershop/v1/sticker/${s.stickerId}/iPhone/sticker.png`} alt="スタンプ" className="w-24 h-24" /> : <span>[スタンプ]</span> } catch { content = <span>[スタンプ]</span> } } if (msg.messageType === 'file') { try { const f = JSON.parse(msg.content) as { fileName?: string }; content = <span>📎 {f.fileName || 'ファイル'}</span> } catch { content = <span>📎 ファイル</span> } } if (msg.messageType === 'location') { try { const l = JSON.parse(msg.content) as { address?: string }; content = <span>📍 {l.address || '位置情報'}</span> } catch { content = <span>📍 位置情報</span> } } if (msg.messageType === 'video') content = <span>🎬 動画</span>; if (msg.messageType === 'audio') content = <span>🎤 音声</span>; if (msg.messageType === 'email') content = <div>{msg.meta?.subject && <div className="text-xs font-bold mb-1 opacity-80">✉️ {msg.meta.subject}</div>}<div className="whitespace-pre-wrap text-sm">{msg.content}</div></div>; return (<div key={msg.id} className={`flex items-end gap-2 ${isOut ? 'justify-end' : 'justify-start'}`}><div className={`max-w-[75%] px-3 py-2 text-sm break-words whitespace-pre-wrap ${isOut ? 'rounded-tl-2xl rounded-tr-md rounded-bl-2xl rounded-br-2xl text-white' : 'rounded-tl-md rounded-tr-2xl rounded-bl-2xl rounded-br-2xl bg-white text-gray-900'}`} style={isOut ? { backgroundColor: '#06C755' } : undefined}>{content}</div></div>)})}
              <div ref={messagesEndRef} />
            </div>
            {/* AI下書き（承認待ち）: 会話を読みながらその場で承認・編集・却下する */}
            {draft && (
              <div className="border-t border-purple-200 bg-purple-50 px-3 py-2 shrink-0">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-medium text-purple-800">
                    🤖 AI下書き（承認待ち）
                    {draft.metadata?.category ? `・${aiCategoryLabels[String(draft.metadata.category)] ?? String(draft.metadata.category)}` : ''}
                    {draft.metadata?.confidence != null ? `・確信度 ${Math.round(Number(draft.metadata.confidence) * 100)}%` : ''}
                    {draft.metadata?.money_flag ? '・💰金銭' : ''}
                  </span>
                  <button onClick={() => setDraft(null)} className="text-[11px] text-purple-500 hover:text-purple-700" title="この下書きを閉じる（却下はしません）">閉じる</button>
                </div>
                <textarea
                  value={draftText}
                  onChange={(e) => setDraftText(e.target.value)}
                  rows={3}
                  className="mt-1 w-full text-xs border border-purple-200 rounded-md px-2 py-1.5 bg-white focus:outline-none focus:ring-1 focus:ring-purple-500 resize-none"
                />
                {rejecting ? (
                  <div className="mt-1 flex items-center gap-2">
                    <input value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} placeholder="却下理由（例: 事実と違う / 定型文で足りる）" className="flex-1 text-xs border border-purple-200 rounded-md px-2 py-1 bg-white focus:outline-none" />
                    <button onClick={handleRejectDraft} disabled={draftBusy} className="px-2 py-1 text-[11px] rounded bg-red-600 text-white disabled:opacity-50">却下する</button>
                    <button onClick={() => { setRejecting(false); setRejectReason('') }} className="text-[11px] text-purple-600">戻る</button>
                  </div>
                ) : (
                  <div className="mt-1 flex items-center gap-2">
                    <button onClick={() => handleApproveDraft(false)} disabled={draftBusy || !draftText.trim()} className="px-2.5 py-1 text-[11px] font-medium rounded bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-50">{draftBusy ? '送信中...' : 'この内容で送信'}</button>
                    <button onClick={() => handleApproveDraft(true)} disabled={draftBusy || !draftText.trim() || draftText === draft.draftText} className="px-2.5 py-1 text-[11px] font-medium rounded bg-white text-purple-700 border border-purple-300 disabled:opacity-40">編集して送信</button>
                    <button onClick={() => setRejecting(true)} disabled={draftBusy} className="text-[11px] text-red-600 hover:text-red-700 disabled:opacity-50">却下</button>
                  </div>
                )}
              </div>
            )}
            {String(chatDetail.channel ?? 'line').startsWith('email_') ? (
              <div className="border-t border-line bg-white shrink-0">
                <div className="px-3 py-1.5 border-b border-line text-[11px] text-subtle">✉️ メールとして返信します（{chatDetail.customerEmail ?? '送信先未設定'}）</div>
                <div className="px-3 py-2 flex items-end gap-2">
                  <textarea ref={textareaRef} value={messageContent} onChange={handleTextareaChange} onKeyDown={handleKeyDown} placeholder="メールの返信を入力... (Shift+Enterで改行)" rows={3} className="flex-1 text-sm border border-line rounded-lg px-3 py-2 bg-canvas focus:outline-none focus:ring-2 focus:ring-brand-500 resize-none min-h-[72px] max-h-[200px] leading-relaxed" />
                  <button onClick={handleSendMessage} disabled={sending || !messageContent.trim()} className="w-10 h-10 rounded-full flex items-center justify-center text-white shrink-0 disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90 transition-opacity mb-0.5" style={{ backgroundColor: 'var(--color-brand-500)' }} aria-label="メールを送信">
                    <svg className="w-4.5 h-4.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h14M12 5l7 7-7 7" /></svg>
                  </button>
                </div>
              </div>
            ) : (
            <div className="border-t border-gray-200 bg-white shrink-0">
              <div className="px-3 py-1.5 border-b border-gray-100 flex items-center gap-1 flex-wrap">
                {chatDetail && <AiDraftButton chatId={selectedChatId!} messages={(chatDetail.messages ?? []).map((m: any) => ({ direction: m.direction, messageType: m.messageType, content: m.content, meta: m.meta }))} onSelect={handleDraftSelect} />}
                <button onClick={toggleTemplates} className={`px-2 py-1 text-[11px] rounded ${templates ? 'bg-gray-200 text-gray-700' : 'text-gray-500 hover:bg-gray-100'}`}>📋 カード</button>
              </div>
              {templates && (
                <div className="border-b border-gray-100 bg-gray-50 max-h-40 overflow-y-auto">
                  {templates.length === 0 ? (<p className="px-3 py-2 text-[11px] text-gray-400">テンプレートがありません（テンプレート画面で作成）</p>)
                  : templates.map((t: any) => (
                    <button key={t.id} onClick={() => handleSendTemplate(t)} className="w-full text-left px-3 py-1.5 text-[11px] hover:bg-white border-b border-gray-100">
                      <span className="font-medium text-gray-700">{t.name}</span>
                      <span className="ml-1 text-gray-400">{t.messageType === 'flex' ? 'カード' : '定型文'}{t.category ? `・${t.category}` : ''}</span>
                    </button>
                  ))}
                </div>
              )}
              <div className="border-b border-gray-100">
                <QuickReplyTemplates onSelect={(text: string) => setMessageContent(text)} />
              </div>
              <div className="px-3 py-2 flex items-end gap-2">
                <label className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 mb-0.5 text-subtle ${sending ? 'opacity-40' : 'hover:bg-canvas cursor-pointer'}`} aria-label="画像を送信">
                  <input type="file" accept="image/png,image/jpeg,image/gif,image/webp" className="hidden" onChange={handleImageSelect} disabled={sending} />
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                </label>
                <textarea ref={textareaRef} value={messageContent} onChange={handleTextareaChange} onKeyDown={handleKeyDown} placeholder="メッセージを入力... (Shift+Enterで改行)" rows={1} className="flex-1 text-sm border border-gray-300 rounded-2xl px-4 py-2.5 bg-gray-50 focus:outline-none focus:ring-2 focus:ring-green-500 focus:bg-white resize-none min-h-[42px] max-h-[160px] leading-relaxed" />
                <button onClick={handleSendMessage} disabled={sending || !messageContent.trim()} className="w-10 h-10 rounded-full flex items-center justify-center text-white shrink-0 disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90 transition-opacity mb-0.5" style={{ backgroundColor: 'var(--color-brand-500)' }}>
                  <svg className="w-4.5 h-4.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h14M12 5l7 7-7 7" /></svg>
                </button>
              </div>
            </div>
            )}
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
