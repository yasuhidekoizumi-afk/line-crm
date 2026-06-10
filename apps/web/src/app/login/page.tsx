'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function LoginPage() {
  const [apiKey, setApiKey] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  // 401で強制ログアウトされて来た場合は、理由を表示する（黙って飛ばすと混乱の元）
  useEffect(() => {
    try {
      if (sessionStorage.getItem('lh_logout_reason') === 'session_expired') {
        setNotice('セッションが切れたため、ログアウトしました。お手数ですがもう一度APIキーを入力してください。（APIキーを再生成した場合は、新しいキーが必要です）')
        sessionStorage.removeItem('lh_logout_reason')
      }
    } catch { /* private mode 等は無視 */ }
  }, [])

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')

    try {
      // Validate by calling a simple endpoint
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8787'
      const res = await fetch(`${apiUrl}/api/friends/count`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      })

      if (res.ok) {
        localStorage.setItem('lh_api_key', apiKey)
        // Fetch staff profile for name/role display
        try {
          const profileRes = await fetch(`${apiUrl}/api/staff/me`, {
            headers: { Authorization: `Bearer ${apiKey}` },
          })
          if (profileRes.ok) {
            const profileData = await profileRes.json()
            if (profileData.success && profileData.data) {
              localStorage.setItem('lh_staff_name', profileData.data.name)
              localStorage.setItem('lh_staff_role', profileData.data.role)
            }
          }
        } catch {
          // Profile fetch is best-effort
        }
        router.push('/')
      } else if (res.status === 401) {
        setError('APIキーが正しくありません。キーが削除・再生成された場合は、管理者に新しいキーを発行してもらってください。')
      } else {
        setError(`サーバーエラーが発生しました（${res.status}）。少し待ってからもう一度お試しください。`)
      }
    } catch {
      setError('接続に失敗しました')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#06C755' }}>
      <div className="bg-white rounded-2xl shadow-xl p-8 w-full max-w-sm">
        <div className="text-center mb-6">
          <div className="w-12 h-12 rounded-xl flex items-center justify-center text-white font-bold text-lg mx-auto mb-3" style={{ backgroundColor: '#06C755' }}>
            H
          </div>
          <h1 className="text-xl font-bold text-gray-900">LINE Harness</h1>
          <p className="text-sm text-gray-500 mt-1">管理画面にログイン</p>
        </div>

        {notice && (
          <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800 leading-relaxed">
            {notice}
          </div>
        )}

        <form onSubmit={handleLogin}>
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-1">API Key</label>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="APIキーを入力"
              className="w-full px-4 py-3 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
              autoFocus
            />
          </div>

          {error && (
            <p className="text-sm text-red-600 mb-4">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading || !apiKey}
            className="w-full py-3 text-white font-medium rounded-lg transition-opacity hover:opacity-90 disabled:opacity-50"
            style={{ backgroundColor: '#06C755' }}
          >
            {loading ? 'ログイン中...' : 'ログイン'}
          </button>
        </form>
      </div>
    </div>
  )
}
