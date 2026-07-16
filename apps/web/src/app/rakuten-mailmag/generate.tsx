'use client'

import { useState } from 'react'
import { fetchApi } from '@/lib/api'

interface DashboardData {
  productRanking: {
    itemNumber: string
    itemName: string
    qty: number
    revenue: number
    avgPrice: number
  }[]
  baseline: { avgDailyRevenue: number }
}

interface RakutenEvent {
  date: string
  name: string
  type: string
}

interface GenerateResult {
  draftId: string
  subjects: string[]
  preheader: string
  bodyHtml: string
  bodyText: string
}

type Pattern = 'event_day' | 'event_eve' | 'normal' | 'stock_clear'
type Tone = 'daily' | 'gift' | 'health' | 'ferment'

function daysUntil(dateStr: string) {
  const target = new Date(dateStr + 'T00:00:00+09:00')
  const now = new Date()
  return Math.ceil((target.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
}

export default function Generate({ data, events }: { data: DashboardData; events: RakutenEvent[] }) {
  const [pattern, setPattern] = useState<Pattern>('event_day')
  const [tone, setTone] = useState<Tone>('daily')
  const [selectedProducts, setSelectedProducts] = useState<Set<number>>(new Set([0, 1]))
  const [extraNotes, setExtraNotes] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<GenerateResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copiedField, setCopiedField] = useState<string | null>(null)

  const nextEvent = events[0]
  const topProducts = data.productRanking.slice(0, 8)

  const toggleProduct = (idx: number) => {
    setSelectedProducts((prev) => {
      const next = new Set(prev)
      if (next.has(idx)) next.delete(idx)
      else next.add(idx)
      return next
    })
  }

  const handleGenerate = async () => {
    setLoading(true)
    setError(null)
    setResult(null)
    try {
      const products = [...selectedProducts].map((idx) => {
        const p = topProducts[idx]
        const totalRev = data.productRanking.reduce((s, p) => s + p.revenue, 0)
        const share = totalRev > 0 ? ((p.revenue / totalRev) * 100).toFixed(0) : '0'
        return {
          itemNumber: p.itemNumber,
          name: p.itemName.slice(0, 40),
          reason: `売上シェア${share}%・${p.qty}個・平均¥${p.avgPrice.toLocaleString()}`,
        }
      })
      const res = await fetchApi<{ success: boolean; data: GenerateResult; error?: string }>(
        '/api/rakuten-mailmag/generate',
        {
          method: 'POST',
          body: JSON.stringify({ pattern, products, tone, extraNotes }),
        },
      )
      if (!res.success) throw new Error(res.error ?? '生成に失敗')
      setResult(res.data)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  const handleCopy = async (text: string, field: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopiedField(field)
      setTimeout(() => setCopiedField(null), 2000)
    } catch {}
  }

  const patternLabels: Record<Pattern, string> = {
    event_day: '🎮 イベント当日',
    event_eve: '📢 イベント前日予告',
    normal: '📝 通常配信（平日）',
    stock_clear: '📦 在庫整理',
  }

  const toneLabels: Record<Tone, string> = {
    daily: '🏠 日常使い（朝食）',
    gift: '🎁 ギフト・帰省土産',
    health: '💪 健康志向（腸活・糖質オフ）',
    ferment: '🌾 麹のチカラ（発酵食）',
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Left: Config */}
      <div className="bg-white border border-gray-200 rounded-xl p-6">
        <h2 className="text-base font-bold text-[#6D2E46] mb-4">配信設定</h2>

        {/* Pattern */}
        <div className="mb-5">
          <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">配信パターン</label>
          <select
            value={pattern}
            onChange={(e) => setPattern(e.target.value as Pattern)}
            className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm bg-gray-50 focus:bg-white focus:border-[#6D2E46] focus:outline-none"
          >
            {nextEvent && (
              <>
                <option value="event_day">{nextEvent.name.split('（')[0]}当日（{nextEvent.date}）</option>
                <option value="event_eve">前日予告（{nextEvent.date}の前日）</option>
              </>
            )}
            <option value="normal">📝 通常配信（平日）</option>
            <option value="stock_clear">📦 在庫整理（賞味期限間近）</option>
          </select>
          {nextEvent && (
            <p className="text-xs text-gray-400 mt-1">直近イベント: {nextEvent.name}（あと{daysUntil(nextEvent.date)}日）</p>
          )}
        </div>

        {/* Product Selection */}
        <div className="mb-5">
          <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
            🤖 AI推奨訴求商品（過去30日のデータから選定）
          </label>
          <div className="space-y-2">
            {topProducts.map((p, idx) => {
              const totalRev = data.productRanking.reduce((s, p) => s + p.revenue, 0)
              const share = totalRev > 0 ? ((p.revenue / totalRev) * 100).toFixed(0) : '0'
              const isSpike = p.revenue >= data.baseline.avgDailyRevenue * 5
              const selected = selectedProducts.has(idx)
              return (
                <button
                  key={p.itemNumber || idx}
                  onClick={() => toggleProduct(idx)}
                  className={`w-full flex items-center gap-3 p-3 border rounded-lg transition-all text-left ${
                    selected
                      ? 'border-[#6D2E46] bg-[#F5EFF0]'
                      : 'border-gray-200 hover:border-[#B5862E] hover:bg-gray-50'
                  }`}
                >
                  <div className="w-10 h-10 rounded-lg bg-gray-100 flex items-center justify-center text-lg shrink-0">
                    {idx === 0 ? '🌾' : idx === 1 ? '🥢' : idx === 2 ? '🥗' : '🍫'}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-800 truncate">{p.itemName.slice(0, 35)}</p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      <span className="text-green-600 font-medium">売上{share}%</span>・{p.qty}個・平均¥{p.avgPrice.toLocaleString()}
                      {isSpike && <span className="text-[#B5862E] font-medium ml-2">イベント日突出</span>}
                    </p>
                  </div>
                  <div
                    className={`w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 ${
                      selected ? 'bg-[#6D2E46] border-[#6D2E46]' : 'border-gray-300'
                    }`}
                  >
                    {selected && (
                      <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </div>
                </button>
              )
            })}
          </div>
          <p className="text-xs text-gray-400 mt-2">※ 売上シェア・イベント時の売上倍率から自動選定。複数選択可。</p>
        </div>

        {/* Tone */}
        <div className="mb-5">
          <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">トーン・切り口</label>
          <select
            value={tone}
            onChange={(e) => setTone(e.target.value as Tone)}
            className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm bg-gray-50 focus:bg-white focus:border-[#6D2E46] focus:outline-none"
          >
            {(Object.entries(toneLabels) as [Tone, string][]).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </div>

        {/* Extra Notes */}
        <div className="mb-5">
          <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">追加要件（任意）</label>
          <textarea
            value={extraNotes}
            onChange={(e) => setExtraNotes(e.target.value)}
            rows={3}
            placeholder="例: クーポン併用、セット割引を強調、夏バテ対策アピール..."
            className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm bg-gray-50 focus:bg-white focus:border-[#6D2E46] focus:outline-none"
          />
        </div>

        <button
          onClick={handleGenerate}
          disabled={loading || selectedProducts.size === 0}
          className="w-full py-3.5 rounded-xl text-white font-bold text-sm transition-all bg-gradient-to-r from-[#6D2E46] to-[#D4788E] hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? (
            <span className="flex items-center justify-center gap-2">
              <span className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent" />
              AI生成中...
            </span>
          ) : (
            '✨ AI でメルマガドラフトを生成'
          )}
        </button>
      </div>

      {/* Right: Preview */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-bold text-[#6D2E46]">生成されたメルマガ</h2>
          {result && (
            <div className="flex gap-2">
              <button
                onClick={() => handleCopy(result.bodyHtml, 'html')}
                className="px-3 py-1.5 text-xs font-medium border border-gray-200 rounded-lg hover:bg-[#6D2E46] hover:text-white hover:border-[#6D2E46] transition-colors"
              >
                {copiedField === 'html' ? '✓ コピー済' : '📋 HTMLコピー'}
              </button>
              <button
                onClick={() => handleCopy(result.bodyText, 'text')}
                className="px-3 py-1.5 text-xs font-medium border border-gray-200 rounded-lg hover:bg-[#6D2E46] hover:text-white hover:border-[#6D2E46] transition-colors"
              >
                {copiedField === 'text' ? '✓ コピー済' : '📄 テキストコピー'}
              </button>
            </div>
          )}
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-4">
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}

        {!result && !error && !loading && (
          <div className="bg-gray-50 border border-dashed border-gray-300 rounded-xl p-12 text-center">
            <p className="text-3xl mb-3">✉️</p>
            <p className="text-sm text-gray-400">左の設定で「AI生成」を押すと、メルマガドラフトがここに表示されます</p>
          </div>
        )}

        {result && (
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            {/* Subject Candidates */}
            <div className="p-5 bg-gray-50 border-b border-gray-200">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">件名候補（A/Bテスト用 3パターン）</p>
              <div className="space-y-2">
                {result.subjects.map((subject, i) => {
                  const labels = ['A', 'B', 'C']
                  const colors = ['bg-blue-100 text-blue-700', 'bg-orange-100 text-orange-700', 'bg-purple-100 text-purple-700']
                  return (
                    <div key={i} className="flex items-center gap-2">
                      <span className={`text-xs font-bold px-2 py-0.5 rounded ${colors[i]}`}>{labels[i]}</span>
                      <span className="text-sm font-semibold text-gray-800 flex-1">{subject}</span>
                      <button
                        onClick={() => handleCopy(subject, `subject-${i}`)}
                        className="text-xs text-gray-400 hover:text-gray-700"
                      >
                        {copiedField === `subject-${i}` ? '✓' : '📋'}
                      </button>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Email Body */}
            <div className="p-5">
              {result.preheader && (
                <p className="text-xs text-gray-400 mb-2">プレテキスト: {result.preheader}</p>
              )}
              <hr className="border-gray-100 mb-4" />
              <div
                className="prose prose-sm max-w-none text-gray-700 leading-relaxed"
                dangerouslySetInnerHTML={{ __html: result.bodyHtml }}
              />
            </div>
          </div>
        )}

        {result && (
          <p className="text-xs text-gray-400 mt-3">
            ⚡ RMS管理画面のメルマガ配信画面にコピペして配信予約してください
          </p>
        )}
      </div>
    </div>
  )
}
