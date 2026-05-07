'use client'

import { createContext, useContext, useState, useCallback, useRef, useEffect, type ReactNode } from 'react'

// ───── Types ─────

export type ToastType = 'success' | 'error' | 'info' | 'busy'

export interface Toast {
  id: string
  message: string
  type: ToastType
  duration?: number // ms, 0 = 自動消滅なし（busy用）
}

interface ToastContextValue {
  toasts: Toast[]
  addToast: (message: string, type?: ToastType, duration?: number) => string
  removeToast: (id: string) => void
  dismissBusy: (id: string) => void
}

// ───── Context ─────

const ToastContext = createContext<ToastContextValue | null>(null)

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within ToastProvider')
  return ctx
}

// ───── Provider ─────

let toastCounter = 0

const DEFAULT_DURATION = 4000
const BUSY_DURATION = 0 // 自動消滅なし

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
    const timer = timers.current.get(id)
    if (timer) {
      clearTimeout(timer)
      timers.current.delete(id)
    }
  }, [])

  const addToast = useCallback(
    (message: string, type: ToastType = 'info', duration: number = type === 'busy' ? BUSY_DURATION : DEFAULT_DURATION): string => {
      const id = `toast_${++toastCounter}`
      const toast: Toast = { id, message, type, duration }
      setToasts((prev) => [...prev, toast])

      if (duration > 0) {
        const timer = setTimeout(() => removeToast(id), duration)
        timers.current.set(id, timer)
      }

      return id
    },
    [removeToast],
  )

  const dismissBusy = useCallback((id: string) => {
    removeToast(id)
  }, [removeToast])

  // クリーンアップ
  useEffect(() => {
    return () => {
      for (const timer of timers.current.values()) clearTimeout(timer)
      timers.current.clear()
    }
  }, [])

  return (
    <ToastContext.Provider value={{ toasts, addToast, removeToast, dismissBusy }}>
      {children}
      <Toaster toasts={toasts} removeToast={removeToast} />
    </ToastContext.Provider>
  )
}

// ───── UI ─────

const TYPE_STYLES: Record<ToastType, { bg: string; icon: string; border: string }> = {
  success: {
    bg: 'bg-green-50',
    icon: '✅',
    border: 'border-green-300',
  },
  error: {
    bg: 'bg-red-50',
    icon: '❌',
    border: 'border-red-300',
  },
  info: {
    bg: 'bg-blue-50',
    icon: 'ℹ️',
    border: 'border-blue-300',
  },
  busy: {
    bg: 'bg-yellow-50',
    icon: '⏳',
    border: 'border-yellow-300',
  },
}

function Toaster({ toasts, removeToast }: { toasts: Toast[]; removeToast: (id: string) => void }) {
  if (toasts.length === 0) return null

  return (
    <div className="fixed bottom-20 right-4 z-[200] flex flex-col gap-2 max-w-sm w-full pointer-events-none">
      {toasts.map((t) => {
        const style = TYPE_STYLES[t.type]
        return (
          <div
            key={t.id}
            className={`pointer-events-auto flex items-start gap-3 rounded-xl border px-4 py-3 shadow-lg ${style.bg} ${style.border}`}
            style={{ animation: 'toast-in 0.25s ease-out' }}
          >
            <span className="text-lg shrink-0 mt-0.5">{style.icon}</span>
            <p className="text-sm text-gray-800 flex-1 leading-relaxed">{t.message}</p>
            {t.type !== 'busy' && (
              <button
                onClick={() => removeToast(t.id)}
                className="shrink-0 text-gray-400 hover:text-gray-600 transition-colors"
                aria-label="閉じる"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
            {t.type === 'busy' && (
              <div className="shrink-0 w-4 h-4 rounded-full border-2 border-yellow-400 border-t-transparent animate-spin" />
            )}
          </div>
        )
      })}
      <style jsx global>{`
        @keyframes toast-in {
          from { opacity: 0; transform: translateX(24px); }
          to   { opacity: 1; transform: translateX(0); }
        }
      `}</style>
    </div>
  )
}
