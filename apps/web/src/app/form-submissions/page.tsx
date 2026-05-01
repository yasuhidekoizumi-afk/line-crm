'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

/**
 * @deprecated FERMENT フォームに統合済み
 *
 * このページは apps/web/src/app/email/forms/page.tsx に統合されました。
 * 「回答一覧」タブから同機能を利用できます。
 *
 * 削除時期: migration 030 適用後
 */
export default function FormSubmissionsPage() {
  const router = useRouter()

  useEffect(() => {
    router.replace('/email/forms')
  }, [router])

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="animate-spin w-8 h-8 border-[3px] border-gray-200 border-t-green-500 rounded-full" />
    </div>
  )
}
