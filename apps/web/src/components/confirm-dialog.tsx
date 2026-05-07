'use client'

import { useState, useEffect, useCallback } from 'react'

interface ConfirmDialogProps {
  /** ダイアログを開くか */
  open: boolean
  /** ダイアログタイトル */
  title: string
  /** 説明文 */
  message: string
  /** 確定ボタンのラベル（デフォルト: 「実行」） */
  confirmLabel?: string
  /** キャンセルボタンのラベル */
  cancelLabel?: string
  /** 確定ボタンのスタイル（デフォルト: red） */
  variant?: 'danger' | 'primary' | 'warning'
  /** 確定時のコールバック */
  onConfirm: () => void
  /** 閉じるときのコールバック */
  onCancel: () => void
  /** 追加で表示する詳細情報 */
  detail?: string
}

const VARIANT_STYLES = {
  danger: {
    button: 'bg-red-600 hover:bg-red-700 focus:ring-red-500',
    icon: 'bg-red-100 text-red-600',
    iconPath: 'M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z',
  },
  primary: {
    button: 'bg-green-600 hover:bg-green-700 focus:ring-green-500',
    icon: 'bg-green-100 text-green-600',
    iconPath: 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z',
  },
  warning: {
    button: 'bg-yellow-500 hover:bg-yellow-600 focus:ring-yellow-500',
    icon: 'bg-yellow-100 text-yellow-600',
    iconPath: 'M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
  },
}

export default function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = '実行',
  cancelLabel = 'キャンセル',
  variant = 'danger',
  onConfirm,
  onCancel,
  detail,
}: ConfirmDialogProps) {
  // Escape キーで閉じる
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onCancel])

  // 背景スクロール防止
  useEffect(() => {
    if (!open) return
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [open])

  if (!open) return null

  const styles = VARIANT_STYLES[variant]

  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center p-4">
      {/* Overlay */}
      <div className="absolute inset-0 bg-black/50" onClick={onCancel} />

      {/* Dialog */}
      <div
        className="relative bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 animate-in fade-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex flex-col items-center text-center">
          {/* Icon */}
          <div className={`w-12 h-12 rounded-full flex items-center justify-center mb-4 ${styles.icon}`}>
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={styles.iconPath} />
            </svg>
          </div>

          {/* Title */}
          <h3 className="text-lg font-bold text-gray-900 mb-2">{title}</h3>

          {/* Message */}
          <p className="text-sm text-gray-600 leading-relaxed mb-2">{message}</p>

          {/* Detail */}
          {detail && (
            <p className="text-xs text-gray-400 bg-gray-50 rounded-lg p-3 w-full text-left mb-4 leading-relaxed">
              {detail}
            </p>
          )}
        </div>

        {/* Buttons */}
        <div className="flex gap-3 mt-4">
          <button
            onClick={onCancel}
            className="flex-1 px-4 py-2.5 rounded-xl text-sm font-semibold text-gray-700 bg-gray-100 hover:bg-gray-200 transition-colors"
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            className={`flex-1 px-4 py-2.5 rounded-xl text-sm font-semibold text-white transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 ${styles.button}`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
