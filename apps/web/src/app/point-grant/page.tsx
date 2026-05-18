'use client'

import { useEffect, useState } from 'react'

type State =
  | { phase: 'loading' }
  | { phase: 'error'; message: string }
  | { phase: 'not_linked'; promoCode: string; lineUserId: string }
  | { phase: 'linking' }
  | { phase: 'done'; points: number; totalPoints: number; wasLinked: boolean }
  | { phase: 'already_used' }

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'https://oryzae-line-crm.oryzae.workers.dev'

declare global {
  interface Window {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    liff: any
  }
}

export default function PointGrantPage() {
  const [state, setState] = useState<State>({ phase: 'loading' })

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const code = (params.get('code') ?? 'CARD88').toUpperCase()
    const liffId = params.get('liffId') ?? process.env.NEXT_PUBLIC_LIFF_ID ?? ''

    if (!liffId) {
      setState({ phase: 'error', message: 'LIFF IDが設定されていません。QRコードから開き直してください。' })
      return
    }

    // LIFF SDK をCDNから動的ロード
    const script = document.createElement('script')
    script.src = 'https://static.line-scdn.net/liff/edge/2/sdk.js'
    script.onload = async () => {
      try {
        await window.liff.init({ liffId })
        if (!window.liff.isLoggedIn()) {
          window.liff.login({ redirectUri: window.location.href })
          return
        }
        const profile = await window.liff.getProfile()
        const lineUserId = profile.userId
        await handleFlow(lineUserId, code)
      } catch (e) {
        console.error(e)
        setState({ phase: 'error', message: 'LINE認証に失敗しました。再度お試しください。' })
      }
    }
    script.onerror = () => setState({ phase: 'error', message: 'SDKの読み込みに失敗しました。' })
    document.head.appendChild(script)

    async function handleFlow(lineUserId: string, promoCode: string) {
      // 紐付け済みか確認
      const profileRes = await fetch(`${API_URL}/api/liff/profile`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lineUserId }),
      })
      const profileData = await profileRes.json()
      if (!profileData.success) {
        setState({ phase: 'error', message: 'LINEアカウントが見つかりません。公式アカウントを友だち追加してください。' })
        return
      }

      // promo-grant を試みる（紐付け済みなら88ptのみ付与）
      const grantRes = await fetch(`${API_URL}/api/liff/promo-grant`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lineUserId, promoCode }),
      })
      const grantData = await grantRes.json()

      if (grantData.success) {
        setState({ phase: 'done', points: grantData.data.pointsAwarded, totalPoints: grantData.data.newBalance, wasLinked: true })
        return
      }

      if (grantData.error === 'already_used') {
        setState({ phase: 'already_used' })
        return
      }

      // 未紐付け → 連携フローへ
      if (grantData.error === 'not_linked') {
        setState({ phase: 'not_linked', promoCode, lineUserId })
        return
      }

      setState({ phase: 'error', message: grantData.message ?? 'エラーが発生しました。' })
    }
  }, [])

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-green-50 to-white p-6">
      <div className="w-full max-w-sm text-center">
        {state.phase === 'loading' && (
          <div>
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-green-100 flex items-center justify-center animate-pulse">
              <span className="text-3xl">🎁</span>
            </div>
            <p className="text-gray-500 text-sm">読み込み中...</p>
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

        {state.phase === 'not_linked' && (
          <NotLinkedView promoCode={state.promoCode} lineUserId={state.lineUserId} onDone={(pts, total) =>
            setState({ phase: 'done', points: pts, totalPoints: total, wasLinked: false })
          } />
        )}

        {state.phase === 'linking' && (
          <div>
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-green-100 flex items-center justify-center animate-pulse">
              <span className="text-3xl">🔗</span>
            </div>
            <p className="text-gray-500 text-sm">連携処理中...</p>
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
            {!state.wasLinked && (
              <p className="text-sm text-green-600 font-medium mb-1">
                連携ボーナス＋カードボーナス合計！
              </p>
            )}
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

function NotLinkedView({
  promoCode,
  lineUserId,
  onDone,
}: {
  promoCode: string
  lineUserId: string
  onDone: (points: number, total: number) => void
}) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleLink = async () => {
    setLoading(true)
    setError('')
    try {
      // Shopify連携のためWorkerの /auth/line へリダイレクト
      // promoCodeをsessionStorageに保存してcallback後に使用
      sessionStorage.setItem('pendingPromoCode', promoCode)
      sessionStorage.setItem('pendingLineUserId', lineUserId)
      window.location.href = `${API_URL}/auth/line?redirect=/point-grant-callback`
    } catch {
      setError('エラーが発生しました。再度お試しください。')
      setLoading(false)
    }
  }

  return (
    <div>
      <div className="w-20 h-20 mx-auto mb-4 rounded-full bg-green-500 flex items-center justify-center shadow-lg">
        <span className="text-4xl">🎁</span>
      </div>
      <h1 className="text-xl font-bold text-gray-800 mb-2">
        388pt プレゼント！
      </h1>
      <p className="text-sm text-gray-600 mb-1">
        Shopifyアカウントと連携すると
      </p>
      <div className="bg-green-50 rounded-xl p-4 mb-6 text-left">
        <div className="flex justify-between text-sm mb-1">
          <span className="text-gray-600">連携ボーナス</span>
          <span className="font-bold text-green-600">300 pt</span>
        </div>
        <div className="flex justify-between text-sm mb-2">
          <span className="text-gray-600">カードボーナス</span>
          <span className="font-bold text-green-600">88 pt</span>
        </div>
        <div className="border-t border-green-200 pt-2 flex justify-between text-base font-bold">
          <span className="text-gray-800">合計</span>
          <span className="text-green-600">388 pt</span>
        </div>
      </div>
      {error && <p className="text-sm text-red-500 mb-3">{error}</p>}
      <button
        onClick={handleLink}
        disabled={loading}
        className="w-full py-4 bg-green-500 text-white font-bold rounded-xl text-base disabled:opacity-50 shadow-md hover:bg-green-600 transition-colors"
      >
        {loading ? '処理中...' : 'Shopifyアカウントと連携して\n388ptもらう'}
      </button>
      <p className="text-xs text-gray-400 mt-3">
        Shopifyでご購入履歴があるメールアドレスが必要です
      </p>
    </div>
  )
}
