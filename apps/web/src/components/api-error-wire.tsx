'use client'

import { useEffect } from 'react'
import { setApiErrorHandler } from '@/lib/api-error'
import { useToast } from '@/lib/toast'

/**
 * Toast 経由で API エラーを自動通知するためのワイヤリングコンポーネント。
 * layout.tsx の <ToastProvider> 直下に配置する。
 */
export default function ApiErrorWire() {
  const toast = useToast()

  useEffect(() => {
    setApiErrorHandler((status, message) => {
      const label =
        status >= 500 ? 'サーバーエラー' :
        status === 401 ? '認証エラー' :
        status === 403 ? 'アクセス拒否' :
        status === 429 ? 'レート制限' :
        'APIエラー'
      toast.addToast(`${label}: ${message}`, 'error')
    })
    return () => setApiErrorHandler(undefined)
  }, [toast])

  return null
}
