'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { fetchApi } from '@/lib/api'

// AI が返す可能性のある execute_url を実在ルートにマッピング
const EXECUTE_URL_ALIASES: Record<string, string> = {
  '/line/campaigns': '/broadcasts',
  '/line/broadcasts': '/broadcasts',
  '/line': '/broadcasts',
  '/email': '/email/campaigns',
  '/sms': '/email/sms',
  '/segment': '/segments',
  '/customer': '/customers',
}

const ALLOWED_EXECUTE_PREFIXES = [
  '/broadcasts', '/scenarios', '/templates', '/automations', '/scoring',
  '/email/campaigns', '/email/templates', '/email/flows', '/email/forms',
  '/email/insights', '/email/analytics', '/email/sms', '/email/reviews',
  '/segments', '/customers', '/friends', '/chats', '/loyalty',
  '/reminders', '/notifications', '/affiliates', '/conversions',
  '/form-submissions', '/health', '/automations',
]

function normalizeExecuteUrl(raw: string): string {
  if (!raw || typeof raw !== 'string') return '/broadcasts'
  const trimmed = raw.trim()
  if (!trimmed.startsWith('/')) return '/broadcasts'
  // クエリ・ハッシュを切り離してパスだけで判定
  const [pathOnly, ...rest] = trimmed.split(/[?#]/)
  const suffix = rest.length > 0 ? trimmed.slice(pathOnly.length) : ''
  if (EXECUTE_URL_ALIASES[pathOnly]) return EXECUTE_URL_ALIASES[pathOnly] + suffix
  if (ALLOWED_EXECUTE_PREFIXES.some((p) => pathOnly === p || pathOnly.startsWith(p + '/'))) {
    return trimmed
  }
  return '/broadcasts'
}

interface ApiResult<T> { success: boolean; data?: T; error?: string }

interface Action {
  rank: number
  title: string
  segment_name: string
  template_hint: string
  expected_impact: string
  execute_url: string
  reasoning: string
}

interface StrategyResp {
  date: string
  cached?: boolean
  proposals: Action[]
  warnings: string[]
  generated_at?: string
}

interface Anomaly {
  alert_id: string
  alert_type: string
  severity: 'info' | 'warning' | 'critical'
  message: string
  detected_at: string
}

interface WeeklyReport {
  week_start: string
  week_end: string
  summary: string
}

interface KillSwitch {
  scope: string
  enabled: number
  reason: string | null
}

export default function AiCockpit() {
  const [strategy, setStrategy] = useState<StrategyResp | null>(null)
  const [anomalies, setAnomalies] = useState<Anomaly[]>([])
  const [weekly, setWeekly] = useState<WeeklyReport | null>(null)
  const [killSwitches, setKillSwitches] = useState<KillSwitch[]>([])
  const [chatOpen, setChatOpen] = useState(false)
  const [chatMessages, setChatMessages] = useState<Array<{ role: 'user' | 'ai'; text: string }>>([])
  const [chatInput, setChatInput] = useState('')
  const [chatLoading, setChatLoading] = useState(false)
  const [generating, setGenerating] = useState(false)

  const loadAll = async () => {
    const [s, a, w, k] = await Promise.allSettled([
      fetchApi<ApiResult<StrategyResp>>('/api/ferment/cockpit/strategy/today'),
      fetchApi<ApiResult<Anomaly[]>>('/api/ferment/cockpit/anomalies/active'),
      fetchApi<ApiResult<WeeklyReport>>('/api/ferment/cockpit/weekly-report/latest'),
      fetchApi<ApiResult<KillSwitch[]>>('/api/ferment/cockpit/kill-switch'),
    ])
    if (s.status === 'fulfilled' && s.value.success) setStrategy(s.value.data ?? null)
    if (a.status === 'fulfilled' && a.value.success) setAnomalies(a.value.data ?? [])
    if (w.status === 'fulfilled' && w.value.success && w.value.data) setWeekly(w.value.data)
    if (k.status === 'fulfilled' && k.value.success) setKillSwitches(k.value.data ?? [])
  }

  useEffect(() => { loadAll() }, [])

  const generateStrategy = async () => {
    setGenerating(true)
    const r = await fetchApi<ApiResult<StrategyResp>>('/api/ferment/cockpit/strategy/generate', {
      method: 'POST',
      body: JSON.stringify({}),
    })
    if (r.success) await loadAll()
    setGenerating(false)
  }

  const generateWeekly = async () => {
    setGenerating(true)
    await fetchApi<ApiResult<unknown>>('/api/ferment/cockpit/weekly-report/generate', {
      method: 'POST',
      body: JSON.stringify({}),
    })
    await loadAll()
    setGenerating(false)
  }

  const sendChat = async () => {
    if (!chatInput.trim()) return
    const msg = chatInput
    setChatMessages([...chatMessages, { role: 'user', text: msg }])
    setChatInput('')
    setChatLoading(true)
    const r = await fetchApi<ApiResult<{ response: string }>>('/api/ferment/cockpit/chat', {
      method: 'POST',
      body: JSON.stringify({ message: msg }),
    })
    if (r.success && r.data) {
      setChatMessages((m) => [...m, { role: 'ai', text: r.data!.response }])
    } else {
      setChatMessages((m) => [...m, { role: 'ai', text: '⚠️ ' + (r.error ?? '応答失敗') }])
    }
    setChatLoading(false)
  }

  const toggleKill = async (scope: string, current: number) => {
    if (current === 0 && !confirm(`${scope === 'all' ? '全 AI 機能' : scope} を停止しますか？`)) return
    await fetchApi<ApiResult<unknown>>(`/api/ferment/cockpit/kill-switch/${scope}`, {
      method: 'POST',
      body: JSON.stringify({ enabled: current === 0, reason: current === 0 ? '管理画面から停止' : null }),
    })
    await loadAll()
  }

  const allKilled = killSwitches.find((k) => k.scope === 'all')?.enabled === 1
  const criticalAnomalies = anomalies.filter((a) => a.severity === 'critical')

  return (
    <div className="mb-8">
      {/* ヘッダー */}
      <div className="bg-gradient-to-r from-purple-600 to-blue-600 rounded-xl p-5 text-white mb-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold flex items-center gap-2">🤖 AI コックピット</h2>
            <p className="text-xs opacity-90 mt-1">Gemini 3 Flash Preview があなたの代わりにマーケを設計</p>
          </div>
          <button
            onClick={() => toggleKill('all', allKilled ? 1 : 0)}
            className={`px-3 py-1.5 text-xs font-bold rounded-lg ${
              allKilled ? 'bg-white text-red-600' : 'bg-red-600/40 text-white border border-white/30 hover:bg-red-600/60'
            }`}
          >
            {allKilled ? '🟢 再開' : '🛑 全停止'}
          </button>
        </div>
        {allKilled && (
          <div className="mt-3 px-3 py-2 bg-red-700/30 rounded-lg text-sm">
            ⚠️ AI 機能は現在停止中。クリックで再開できます。
          </div>
        )}
      </div>

      {/* 異常アラート */}
      {anomalies.length > 0 && (
        <div className={`mb-4 p-4 rounded-xl border ${
          criticalAnomalies.length > 0
            ? 'bg-red-50 border-red-200'
            : 'bg-yellow-50 border-yellow-200'
        }`}>
          <h3 className={`text-sm font-semibold mb-2 ${
            criticalAnomalies.length > 0 ? 'text-red-800' : 'text-yellow-800'
          }`}>
            {criticalAnomalies.length > 0 ? '🚨 重大な異常' : '⚠️ 注意'}（{anomalies.length}件）
          </h3>
          <ul className="space-y-1 text-xs">
            {anomalies.slice(0, 3).map((a) => (
              <li key={a.alert_id} className={a.severity === 'critical' ? 'text-red-700' : 'text-yellow-700'}>
                ・{a.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* 戦略提案 TOP 3 */}
      <div className="bg-white border border-gray-200 rounded-xl p-5 mb-4">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-gray-800">🎯 今日やるべきアクション TOP 3</h3>
          <button
            onClick={generateStrategy}
            disabled={generating}
            className="text-xs px-3 py-1.5 bg-purple-100 text-purple-700 rounded-lg hover:bg-purple-200 disabled:opacity-50"
          >
            {generating ? '生成中...' : strategy ? '🔄 再生成' : '✨ 生成'}
          </button>
        </div>
        {strategy && strategy.proposals?.length > 0 ? (
          <div className="space-y-3">
            {strategy.proposals.map((a) => (
              <div key={a.rank} className="border border-gray-100 rounded-lg p-4 hover:border-purple-200 transition-colors">
                <div className="flex items-start gap-3">
                  <div className="shrink-0 w-8 h-8 rounded-full bg-purple-100 text-purple-700 font-bold flex items-center justify-center">
                    {a.rank}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h4 className="font-semibold text-gray-900">{a.title}</h4>
                    <p className="text-xs text-gray-500 mt-1">対象: {a.segment_name} / 推奨: {a.template_hint}</p>
                    <p className="text-xs text-green-700 mt-1 font-medium">期待効果: {a.expected_impact}</p>
                    <p className="text-xs text-gray-600 mt-2">{a.reasoning}</p>
                  </div>
                  <Link
                    href={normalizeExecuteUrl(a.execute_url)}
                    className="shrink-0 px-3 py-1.5 text-xs bg-green-600 text-white rounded-lg hover:bg-green-700"
                  >
                    実行 →
                  </Link>
                </div>
              </div>
            ))}
            {strategy.warnings && strategy.warnings.length > 0 && (
              <div className="mt-3 p-3 bg-yellow-50 border-l-4 border-yellow-400 rounded">
                <p className="text-xs font-semibold text-yellow-800 mb-1">⚠️ AI からの警告</p>
                <ul className="text-xs text-yellow-700 space-y-0.5">
                  {strategy.warnings.map((w, i) => <li key={i}>・{w}</li>)}
                </ul>
              </div>
            )}
            {strategy.generated_at && (
              <p className="text-xs text-gray-400 text-right mt-2">
                生成: {new Date(strategy.generated_at).toLocaleString('ja-JP')}
              </p>
            )}
          </div>
        ) : (
          <div className="text-center py-8 text-gray-400">
            <p className="text-sm">まだ提案がありません</p>
            <p className="text-xs mt-1">「✨ 生成」ボタンで AI が今日の戦略を提案します</p>
          </div>
        )}
      </div>

      {/* 週次振り返り */}
      <div className="bg-white border border-gray-200 rounded-xl p-5 mb-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-gray-800">📊 週次振り返り</h3>
          <button
            onClick={generateWeekly}
            disabled={generating}
            className="text-xs px-3 py-1.5 bg-blue-100 text-blue-700 rounded-lg hover:bg-blue-200 disabled:opacity-50"
          >
            {generating ? '生成中...' : weekly ? '🔄 再生成' : '✨ 生成'}
          </button>
        </div>
        {weekly ? (
          <div>
            <p className="text-xs text-gray-400 mb-2">{weekly.week_start} 〜 {weekly.week_end}</p>
            <pre className="text-sm text-gray-700 whitespace-pre-wrap font-sans">{weekly.summary}</pre>
          </div>
        ) : (
          <p className="text-sm text-gray-400 text-center py-4">「✨ 生成」で先週の振り返りを AI が作成</p>
        )}
      </div>

      {/* AI チャット */}
      <div className="bg-white border border-gray-200 rounded-xl p-5">
        <button
          onClick={() => setChatOpen(!chatOpen)}
          className="w-full text-left flex items-center justify-between"
        >
          <h3 className="text-sm font-semibold text-gray-800">💬 AI に相談</h3>
          <span className="text-xs text-gray-500">{chatOpen ? '▼' : '▶'} {chatOpen ? '閉じる' : '開く'}</span>
        </button>
        {chatOpen && (
          <div className="mt-4">
            <div className="space-y-2 max-h-64 overflow-y-auto mb-3 p-3 bg-gray-50 rounded-lg">
              {chatMessages.length === 0 && (
                <p className="text-xs text-gray-400 text-center py-4">
                  「今月の売上を上げるには？」などお気軽に質問してください
                </p>
              )}
              {chatMessages.map((m, i) => (
                <div key={i} className={`text-sm ${m.role === 'user' ? 'text-right' : ''}`}>
                  <span className={`inline-block px-3 py-2 rounded-lg max-w-[80%] ${
                    m.role === 'user' ? 'bg-purple-600 text-white' : 'bg-white border border-gray-200 text-gray-800'
                  }`}>
                    {m.text}
                  </span>
                </div>
              ))}
              {chatLoading && (
                <div className="text-sm">
                  <span className="inline-block px-3 py-2 rounded-lg bg-white border border-gray-200 text-gray-500">
                    考え中...
                  </span>
                </div>
              )}
            </div>
            <div className="flex gap-2">
              <input
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && sendChat()}
                placeholder="質問を入力..."
                disabled={chatLoading}
                className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm disabled:bg-gray-100"
              />
              <button
                onClick={sendChat}
                disabled={chatLoading || !chatInput.trim()}
                className="px-4 py-2 text-sm bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50"
              >
                送信
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
