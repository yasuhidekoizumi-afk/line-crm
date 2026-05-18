'use client'

import { useEffect, useState } from 'react'

type State =
  | { phase: 'loading' }
  | { phase: 'error'; message: string }
  | { phase: 'done'; points: number; totalPoints: number }
  | { phase: 'already_used' }

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'https://oryzae-line-crm.oryzae.workers.dev'

export default function PointGrantCallbackPage() {
  const [state, setState] = useState<State>({ phase: 'loading' })

  useEffect(() => {
    const promoCode = sessionStorage.getItem('pendingPromoCode')
    const lineUserId = sessionStorage.getItem('pendingLineUserId')

    if (!promoCode || !lineUserId) {
      setState({ phase: 'error', message: 'セッションが無効です。QRコードから開き直してください。' })
      return
    }

    sessionStorage.removeItem('pendingPromoCode')
    sessionStorage.removeItem('pendingLineUserId')

    fetch(`${API_URL}/api/liff/promo-grant`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lineUserId, promoCode }),
    })
      .then(r => r.json())
      .then(data => {
        if (data.success) {
          setState({ phase: 'done', points: data.data.pointsAwarded, totalPoints: data.data.newBalance })
          return
        }
        if (data.error === 'already_used') {
          setState({ phase: 'already_used' })
          return
        }
        setState({ phase: 'error', message: data.message ?? 'ポイント付与に失敗しました。' })
      })
      .catch(() => setState({ phase: 'error', message: '通信エラーが発生しました。再度お試しください。' }))
  }, [])

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-green-50 to-white p-6">
      <div className="w-full max-w-sm text-center">
        {state.phase === 'loading' && (
          <div>
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-green-100 flex items-center justify-center animate-pulse">
              <span className="text-3xl">🎁</span>
            </div>
            <p className="text-gray-500 text-sm">ポイント付与中...</p>
          </div>
        )}

        {state.phase === 'error' && (
          <div>
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-red-100 flex items-center justify-center">
              <span className="text-3xl">⚠️</span>
            </div>
            <h1 className="text-lg font-bold text-gray-800 mb-2">エラーが発生しました</h1>
            <p className="text-sm text-gray-500">{state.message}</p>
          </div>
        )}

        {state.phase === 'already_used' && (
          <div>
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-yellow-100 flex items-center justify-center">
              <span className="text-3xl">✅</span>
            </div>
            <h1 className="text-lg font-bold text-gray-800 mb-2">既に受け取り済みです</h1>
            <p className="text-sm text-gray-500">このカードのポイントは既に付与されています。</p>
          </div>
        )}

        {state.phase === 'done' && (
          <div>
            <div className="w-20 h-20 mx-auto mb-4 rounded-full bg-green-500 flex items-center justify-center shadow-lg">
              <span className="text-4xl">🎉</span>
            </div>
            <h1 className="text-2xl font-bold text-gray-800 mb-1">
              {state.points}pt プレゼント！
            </h1>
            <p className="text-sm text-green-600 font-medium mb-1">
              連携ボーナス＋カードボーナス合計！
            </p>
            <p className="text-sm text-gray-500 mb-6">
              現在の残高：<span className="font-bold text-gray-800">{state.totalPoints} pt</span>
            </p>
            <p className="text-xs text-gray-400">
              ポイントはお次回のお買い物でご利用いただけます。
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
