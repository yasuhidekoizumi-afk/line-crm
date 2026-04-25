'use client'

import { useState, useRef, useEffect } from 'react'
import { usePathname } from 'next/navigation'

type Msg = { role: 'user' | 'assistant'; content: string }

const API_URL = process.env.NEXT_PUBLIC_API_URL

const INITIAL: Msg = {
  role: 'assistant',
  content: 'こんにちは！LINE Harness の使い方をご案内します。\n例：「シナリオ配信ってどう作るの？」「セグメントとタグの違いは？」',
}

export default function HelpChat() {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<Msg[]>([INITIAL])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

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
          messages: next.filter((m) => m !== INITIAL).map(({ role, content }) => ({ role, content })),
          current_page: pathname,
        }),
      })
      const json = (await res.json()) as { success: boolean; data?: { answer: string }; error?: string }
      const answer = json.success && json.data ? json.data.answer : `エラー: ${json.error ?? '応答取得に失敗しました'}`
      setMessages((m) => [...m, { role: 'assistant', content: answer }])
    } catch (e) {
      setMessages((m) => [
        ...m,
        { role: 'assistant', content: `通信エラー: ${e instanceof Error ? e.message : String(e)}` },
      ])
    } finally {
      setLoading(false)
    }
  }

  function reset() {
    setMessages([INITIAL])
  }

  return (
    <>
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed bottom-6 right-6 z-50 flex items-center gap-2 rounded-full bg-[#225533] px-5 py-3 text-white shadow-lg hover:bg-[#1a4329] transition"
          aria-label="使い方を聞く"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
          </svg>
          <span className="text-sm font-medium">使い方を聞く</span>
        </button>
      )}

      {open && (
        <div className="fixed bottom-6 right-6 z-50 flex h-[560px] w-[380px] max-w-[calc(100vw-2rem)] flex-col rounded-xl border border-gray-200 bg-white shadow-2xl">
          <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
            <div className="flex items-center gap-2">
              <div className="h-2 w-2 rounded-full bg-green-500" />
              <h3 className="text-sm font-semibold text-gray-900">使い方アシスタント</h3>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={reset}
                className="text-xs text-gray-500 hover:text-gray-900"
                aria-label="リセット"
              >
                リセット
              </button>
              <button
                onClick={() => setOpen(false)}
                className="text-gray-500 hover:text-gray-900"
                aria-label="閉じる"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>

          <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
            {messages.map((m, i) => (
              <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-[85%] whitespace-pre-wrap rounded-lg px-3 py-2 text-sm ${
                    m.role === 'user'
                      ? 'bg-[#225533] text-white'
                      : 'bg-gray-100 text-gray-900'
                  }`}
                >
                  {m.content}
                </div>
              </div>
            ))}
            {loading && (
              <div className="flex justify-start">
                <div className="rounded-lg bg-gray-100 px-3 py-2 text-sm text-gray-500">考え中…</div>
              </div>
            )}
          </div>

          <div className="border-t border-gray-200 p-3">
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
                placeholder="質問を入力（Enter で送信）"
                disabled={loading}
                className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-[#225533] focus:outline-none disabled:bg-gray-50"
              />
              <button
                onClick={send}
                disabled={loading || !input.trim()}
                className="rounded-md bg-[#225533] px-4 py-2 text-sm font-medium text-white hover:bg-[#1a4329] disabled:bg-gray-300"
              >
                送信
              </button>
            </div>
            <p className="mt-2 text-[10px] text-gray-400">
              現在のページ: {pathname} ／ Gemini 3 Flash Preview
            </p>
          </div>
        </div>
      )}
    </>
  )
}
