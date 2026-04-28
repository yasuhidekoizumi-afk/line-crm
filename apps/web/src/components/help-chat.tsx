'use client'

import { useState, useRef, useEffect } from 'react'
import { usePathname } from 'next/navigation'

type Msg = { role: 'user' | 'assistant'; content: string }

const API_URL = process.env.NEXT_PUBLIC_API_URL

// localStorage 永続化キー（v1: 初版・スキーマ変更時はバージョンアップで自動破棄）
const STORAGE_KEY = 'oryzae_chat_history_v1'
// 永続化する直近メッセージ数の上限（容量・コンテキスト両方の対策）
const MAX_PERSISTED = 100

const INITIAL: Msg = {
  role: 'assistant',
  content:
    'やぁ、ぼくはオリゼくん！🌾\nLINE Harness の使い方ならぼくに聞いてね。\n\n例：\n・「シナリオ配信ってどう作るの？」\n・「セグメントとタグの違いは？」\n・「この画面で何ができる？」',
}

function loadHistory(): Msg[] {
  if (typeof window === 'undefined') return [INITIAL]
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return [INITIAL]
    const parsed = JSON.parse(raw) as Msg[]
    if (Array.isArray(parsed) && parsed.length > 0 && parsed[0]?.role === 'assistant') {
      return parsed
    }
  } catch {
    // パース失敗時は壊れた履歴を破棄
  }
  return [INITIAL]
}

// オリゼくん：米麹をモチーフにしたキャラクターアバター
function OryzaeAvatar({ size = 36, animated = false }: { size?: number; animated?: boolean }) {
  return (
    <div
      className={`relative inline-flex items-center justify-center rounded-full bg-gradient-to-br from-[#f5e6a8] via-[#e8d27a] to-[#c9a94f] shadow-md ${
        animated ? 'animate-oryzae-bob' : ''
      }`}
      style={{ width: size, height: size }}
      aria-label="オリゼくん"
    >
      <svg width={size * 0.7} height={size * 0.7} viewBox="0 0 32 32" fill="none">
        {/* 顔 */}
        <circle cx="16" cy="16" r="14" fill="#fff7d6" stroke="#a87c2a" strokeWidth="1" />
        {/* ほっぺ */}
        <ellipse cx="9" cy="19" rx="2.5" ry="1.5" fill="#ffb8a8" opacity="0.7" />
        <ellipse cx="23" cy="19" rx="2.5" ry="1.5" fill="#ffb8a8" opacity="0.7" />
        {/* 目 */}
        <ellipse cx="11" cy="14" rx="1.5" ry="2" fill="#225533" />
        <ellipse cx="21" cy="14" rx="1.5" ry="2" fill="#225533" />
        <circle cx="11.4" cy="13.4" r="0.5" fill="#fff" />
        <circle cx="21.4" cy="13.4" r="0.5" fill="#fff" />
        {/* 口 */}
        <path d="M13 19 Q16 22 19 19" stroke="#225533" strokeWidth="1.2" fill="none" strokeLinecap="round" />
        {/* 米粒の頭 */}
        <ellipse cx="16" cy="3.5" rx="2.2" ry="3" fill="#f5e6a8" stroke="#a87c2a" strokeWidth="0.8" />
      </svg>
    </div>
  )
}

export default function HelpChat() {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  // SSR 互換: 初期は INITIAL のみ。マウント後に localStorage から復元
  const [messages, setMessages] = useState<Msg[]>([INITIAL])
  const [hydrated, setHydrated] = useState(false)
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  // マウント時に履歴を復元（hydration エラーを避けるため effect で実行）
  useEffect(() => {
    setMessages(loadHistory())
    setHydrated(true)
  }, [])

  // 履歴を localStorage に永続化（直近 MAX_PERSISTED 件まで）
  useEffect(() => {
    if (!hydrated || typeof window === 'undefined') return
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(messages.slice(-MAX_PERSISTED)))
    } catch {
      // 容量超過などは無視（次回起動時に破棄される）
    }
  }, [messages, hydrated])

  useEffect(() => {
    if (open && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages, open])

  async function send() {
    const text = input.trim()
    if (!text || loading) return
    const next: Msg[] = [...messages, { role: 'user', content: text }]
    setMessages(next)
    setInput('')
    setLoading(true)

    try {
      const apiKey = typeof window !== 'undefined' ? localStorage.getItem('lh_api_key') || '' : ''
      const res = await fetch(`${API_URL}/api/help/ask`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          // 先頭の初期挨拶（INITIAL）は API には送らず、ユーザー発話以降のみを送信
          messages: next.slice(1).map(({ role, content }) => ({ role, content })),
          current_page: pathname,
        }),
      })
      const json = (await res.json()) as { success: boolean; data?: { answer: string }; error?: string }
      const answer =
        json.success && json.data
          ? json.data.answer
          : `うっ、ちょっとうまく繋がらなかったみたい…🌾\n${json.error ?? '応答取得に失敗しました'}`
      setMessages((m) => [...m, { role: 'assistant', content: answer }])
    } catch (e) {
      setMessages((m) => [
        ...m,
        {
          role: 'assistant',
          content: `通信できなかったよ… ネットワークを確認してね。\n${e instanceof Error ? e.message : String(e)}`,
        },
      ])
    } finally {
      setLoading(false)
    }
  }

  function reset() {
    setMessages([INITIAL])
    if (typeof window !== 'undefined') {
      try {
        localStorage.removeItem(STORAGE_KEY)
      } catch {
        // ignore
      }
    }
  }

  return (
    <>
      {/* キャラクター用の軽いアニメーション定義 */}
      <style jsx global>{`
        @keyframes oryzae-bob {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-3px); }
        }
        .animate-oryzae-bob { animation: oryzae-bob 2.4s ease-in-out infinite; }

        @keyframes oryzae-glow {
          0%, 100% { box-shadow: 0 0 0 0 rgba(34, 85, 51, 0.4), 0 8px 24px rgba(34, 85, 51, 0.25); }
          50%      { box-shadow: 0 0 0 12px rgba(34, 85, 51, 0), 0 8px 28px rgba(34, 85, 51, 0.35); }
        }
        .animate-oryzae-glow { animation: oryzae-glow 2.6s ease-out infinite; }

        @keyframes oryzae-sparkle {
          0%, 100% { opacity: 0.2; transform: scale(0.8) rotate(0deg); }
          50%      { opacity: 1;   transform: scale(1.2) rotate(20deg); }
        }
        .animate-oryzae-sparkle { animation: oryzae-sparkle 2s ease-in-out infinite; }

        @keyframes oryzae-typing {
          0%, 80%, 100% { transform: scale(0.6); opacity: 0.4; }
          40%           { transform: scale(1);   opacity: 1; }
        }
        .oryzae-dot { animation: oryzae-typing 1.2s ease-in-out infinite; }
      `}</style>

      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed bottom-6 right-6 z-50 flex items-center gap-3 rounded-full bg-gradient-to-r from-[#225533] via-[#2d6e44] to-[#3a8856] px-4 py-3 pr-5 text-white shadow-xl hover:scale-105 transition animate-oryzae-glow"
          aria-label="オリゼくんに使い方を聞く"
        >
          <OryzaeAvatar size={40} animated />
          <div className="flex flex-col items-start leading-tight">
            <span className="flex items-center gap-1 text-[10px] font-semibold tracking-wide text-yellow-200">
              <span className="animate-oryzae-sparkle">✨</span>
              AI アシスタント
            </span>
            <span className="text-sm font-bold">オリゼくんに聞く</span>
          </div>
        </button>
      )}

      {open && (
        <div className="fixed bottom-6 right-6 z-50 flex h-[600px] w-[400px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl">
          {/* ヘッダー */}
          <div className="relative flex items-center gap-3 bg-gradient-to-r from-[#225533] via-[#2d6e44] to-[#3a8856] px-4 py-3 text-white">
            <OryzaeAvatar size={42} animated />
            <div className="flex-1 leading-tight">
              <div className="flex items-center gap-1.5">
                <h3 className="text-sm font-bold">オリゼくん</h3>
                <span className="rounded-full bg-yellow-300/30 px-1.5 py-0.5 text-[9px] font-semibold tracking-wide">
                  ✨ AI
                </span>
              </div>
              <div className="flex items-center gap-1 text-[11px] text-green-100">
                <span className="h-1.5 w-1.5 rounded-full bg-green-300 animate-pulse" />
                オンライン・使い方ならお任せ！
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={reset}
                className="rounded px-2 py-0.5 text-[11px] text-white/80 hover:bg-white/10"
                aria-label="会話をリセット"
              >
                リセット
              </button>
              <button
                onClick={() => setOpen(false)}
                className="rounded p-1 text-white/80 hover:bg-white/10"
                aria-label="閉じる"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>

          {/* メッセージエリア */}
          <div
            ref={scrollRef}
            className="flex-1 space-y-4 overflow-y-auto bg-gradient-to-b from-[#fafaf5] to-white px-4 py-4"
          >
            {messages.map((m, i) => (
              <div key={i} className={`flex gap-2 ${m.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
                {m.role === 'assistant' && <OryzaeAvatar size={32} />}
                <div
                  className={`max-w-[78%] whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed shadow-sm ${
                    m.role === 'user'
                      ? 'rounded-tr-sm bg-[#225533] text-white'
                      : 'rounded-tl-sm border border-[#e8d27a]/40 bg-white text-gray-900'
                  }`}
                >
                  {m.content}
                </div>
              </div>
            ))}
            {loading && (
              <div className="flex gap-2">
                <OryzaeAvatar size={32} animated />
                <div className="rounded-2xl rounded-tl-sm border border-[#e8d27a]/40 bg-white px-4 py-3 shadow-sm">
                  <div className="flex items-center gap-1.5">
                    <span className="oryzae-dot inline-block h-2 w-2 rounded-full bg-[#225533]" style={{ animationDelay: '0s' }} />
                    <span className="oryzae-dot inline-block h-2 w-2 rounded-full bg-[#225533]" style={{ animationDelay: '0.2s' }} />
                    <span className="oryzae-dot inline-block h-2 w-2 rounded-full bg-[#225533]" style={{ animationDelay: '0.4s' }} />
                    <span className="ml-1 text-[11px] text-gray-500">考えてるよ…</span>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* 入力エリア */}
          <div className="border-t border-gray-200 bg-white p-3">
            <div className="flex gap-2">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    send()
                  }
                }}
                placeholder="オリゼくんに質問する…"
                disabled={loading}
                className="flex-1 rounded-full border border-gray-300 bg-gray-50 px-4 py-2 text-sm focus:border-[#225533] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#225533]/20 disabled:bg-gray-100"
              />
              <button
                onClick={send}
                disabled={loading || !input.trim()}
                className="flex items-center justify-center rounded-full bg-gradient-to-br from-[#225533] to-[#3a8856] px-4 py-2 text-white shadow-md hover:scale-105 transition disabled:bg-gray-300 disabled:from-gray-300 disabled:to-gray-300 disabled:scale-100"
                aria-label="送信"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 12h14M13 6l6 6-6 6" />
                </svg>
              </button>
            </div>
            <p className="mt-2 text-center text-[10px] text-gray-400">
              ✨ Powered by Gemini 3 Flash · 現在のページ: <span className="font-mono">{pathname}</span>
            </p>
          </div>
        </div>
      )}
    </>
  )
}
