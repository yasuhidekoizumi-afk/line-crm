'use client'

import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import ConfirmDialog from '@/components/confirm-dialog'

export interface ConfirmOptions {
  title?: string
  message: string
  detail?: string
  confirmLabel?: string
  cancelLabel?: string
  variant?: 'danger' | 'primary' | 'warning'
}

type ConfirmFn = (options: ConfirmOptions | string) => Promise<boolean>

const ConfirmContext = createContext<ConfirmFn | null>(null)

/** プロバイダが登録する実装。画面外（未マウント）では window.confirm にフォールバックする。 */
let activeHandler: ConfirmFn | null = null

/**
 * 画面内ダイアログで確認を取る（フック不要）。
 * 使い方: `if (!(await confirmDialog({ message: '削除しますか？' }))) return`
 * 呼び出し側の関数は async にすること。
 */
export function confirmDialog(options: ConfirmOptions | string): Promise<boolean> {
  if (activeHandler) return activeHandler(options)
  const message = typeof options === 'string' ? options : options.message
  return Promise.resolve(typeof window !== 'undefined' ? window.confirm(message) : false)
}

export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext)
  if (!ctx) throw new Error('useConfirm must be used within ConfirmProvider')
  return ctx
}

/**
 * ブラウザ標準の confirm() を置き換えるためのプロバイダ。
 * AppShell 配下のどの画面からも confirmDialog() / useConfirm() で呼べる。
 */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<{ options: ConfirmOptions; resolve: (value: boolean) => void } | null>(null)

  const open = useCallback<ConfirmFn>((options) => {
    const normalized = typeof options === 'string' ? { message: options } : options
    return new Promise<boolean>((resolve) => {
      setPending({ options: normalized, resolve })
    })
  }, [])

  useEffect(() => {
    activeHandler = open
    return () => {
      if (activeHandler === open) activeHandler = null
    }
  }, [open])

  const settle = (result: boolean) => {
    pending?.resolve(result)
    setPending(null)
  }

  return (
    <ConfirmContext.Provider value={open}>
      {children}
      <ConfirmDialog
        open={pending !== null}
        title={pending?.options.title ?? '確認'}
        message={pending?.options.message ?? ''}
        detail={pending?.options.detail}
        confirmLabel={pending?.options.confirmLabel}
        cancelLabel={pending?.options.cancelLabel}
        variant={pending?.options.variant ?? 'danger'}
        onConfirm={() => settle(true)}
        onCancel={() => settle(false)}
      />
    </ConfirmContext.Provider>
  )
}
