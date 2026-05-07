'use client'

import { useState } from 'react'
import { copyToClipboard } from '@/lib/clipboard'
import { useToast } from '@/lib/toast'

interface CopyButtonProps {
  /** コピー対象の文字列 */
  text: string
  /** ボタン表示ラベル (デフォルト: 「コピー」) */
  label?: string
  /** 追加クラス */
  className?: string
}

/**
 * クリップボードコピーボタン。
 * コピー成功時は green に変化、失敗時はエラートースト。
 */
export default function CopyButton({ text, label = 'コピー', className = '' }: CopyButtonProps) {
  const toast = useToast()
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    const ok = await copyToClipboard(text)
    if (ok) {
      setCopied(true)
      toast.addToast('コピーしました', 'success')
      setTimeout(() => setCopied(false), 2000)
    } else {
      toast.addToast('コピーに失敗しました', 'error')
    }
  }

  return (
    <button
      onClick={handleCopy}
      className={`inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-md transition-colors ${
        copied
          ? 'bg-green-100 text-green-700'
          : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
      } ${className}`}
    >
      {copied ? '✓ コピー完了' : label}
    </button>
  )
}
