'use client'

import { useEffect, useState } from 'react'
import { fetchApi } from '@/lib/api'
import Header from '@/components/layout/header'

interface DashboardData {
  days: number
  byLevel: Array<{ level: string; cnt: number; avg_conf: number; cost: number }>
  byOutcome: Array<{ outcome: string; cnt: number }>
  byCategory: Array<{ category: string; cnt: number }>
}

interface PendingDraft {
  id: string
  chatId: string
  draftText: string
  metadata: {
    category?: string
    confidence?: number
    money_flag?: boolean
  } | null
  createdAt: string
}

const LEVEL_LABEL: Record<string, { label: string; color: string }> = {
  L1: { label: 'L1 自動返信', color: 'bg-green-100 text-green-800' },
  L2: { label: 'L2 下書き承認待ち', color: 'bg-purple-100 text-purple-800' },
  L3: { label: 'L3 人間エスカレ', color: 'bg-red-100 text-red-800' },
}

const OUTCOME_LABEL: Record<string, { label: string; color: string }> = {
  auto_sent: { label: '自動送信', color: 'bg-green-100 text-green-800' },
  approved: { label: '承認', color: 'bg-blue-100 text-blue-800' },
  edited: { label: '編集承認', color: 'bg-cyan-100 text-cyan-800' },
  rejected: { label: '却下', color: 'bg-red-100 text-red-800' },
  escalated: { label: 'エスカレ', color: 'bg-orange-100 text-orange-800' },
}

export default function CsDashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null)
  const [drafts, setDrafts] = useState<PendingDraft[]>([])
  const [days, setDays] = useState(7)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      setLoading(true)
      setError(null)
      try {
        const [dashRes, draftsRes] = await Promise.all([
          fetchApi<{ success: boolean; data: DashboardData }>(`/api/cs/dashboard?since=${days}`),
          fetchApi<{ success: boolean; data: PendingDraft[] }>(`/api/cs/drafts?limit=20`),
        ])
        if (cancelled) return
        if (dashRes.success) setData(dashRes.data)
        if (draftsRes.success) setDrafts(draftsRes.data)
      } catch (e) {
        if (!cancelled) setError(`読み込み失敗: ${String(e)}`)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [days])

  const totalLevel = (data?.byLevel ?? []).reduce((s, x) => s + x.cnt, 0)
  const totalCost = (data?.byLevel ?? []).reduce((s, x) => s + (x.cost ?? 0), 0)
  const totalOutcomes = (data?.byOutcome ?? []).reduce((s, x) => s + x.cnt, 0)
  const approvalCount =
    (data?.byOutcome.find((o) => o.outcome === 'approved')?.cnt ?? 0) +
    (data?.byOutcome.find((o) => o.outcome === 'edited')?.cnt ?? 0)
  const approvalRate = totalOutcomes > 0 ? Math.round((approvalCount / totalOutcomes) * 100) : null

  return (
    <div>
      <Header
        title="CSダッシュボード"
        description="LINE/メール統合受信箱のAIトリアージ運用状況"
        action={
          <div className="flex items-center gap-2">
            <select
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
              className="border border-gray-300 rounded-md px-3 py-1.5 text-sm bg-white"
            >
              <option value={1}>過去24時間</option>
              <option value={7}>過去7日間</option>
              <option value={30}>過去30日間</option>
              <option value={90}>過去90日間</option>
            </select>
            <a
              href="/cs/settings"
              className="px-3 py-1.5 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-md"
            >
              ⚙️ 設定
            </a>
          </div>
        }
      />

      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{error}</div>
      )}

      {loading && (
        <div className="text-center py-12 text-gray-500 text-sm">読み込み中...</div>
      )}

      {data && (
        <>
          {/* KPI cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <KpiCard label="総処理件数" value={totalLevel.toLocaleString()} suffix="件" />
            <KpiCard
              label="承認待ち下書き"
              value={drafts.length.toLocaleString()}
              suffix="件"
              accent={drafts.length > 0 ? 'purple' : 'default'}
            />
            <KpiCard label="承認率" value={approvalRate !== null ? `${approvalRate}%` : '-'} />
            <KpiCard label="AIコスト合計" value={`¥${totalCost.toFixed(2)}`} />
          </div>

          {/* By Level */}
          <Section title="レベル別件数">
            {data.byLevel.length === 0 ? (
              <Empty />
            ) : (
              <div className="space-y-2">
                {data.byLevel.map((row) => {
                  const lc = LEVEL_LABEL[row.level] ?? { label: row.level, color: 'bg-gray-100 text-gray-700' }
                  const pct = totalLevel > 0 ? (row.cnt / totalLevel) * 100 : 0
                  return (
                    <div key={row.level} className="flex items-center gap-3">
                      <span className={`text-xs font-medium px-2 py-0.5 rounded ${lc.color} w-32 text-center`}>
                        {lc.label}
                      </span>
                      <div className="flex-1 bg-gray-100 rounded-full h-6 overflow-hidden relative">
                        <div
                          className="h-full bg-gradient-to-r from-purple-400 to-purple-600 transition-all"
                          style={{ width: `${pct}%` }}
                        />
                        <span className="absolute inset-0 flex items-center px-3 text-xs font-medium text-gray-900">
                          {row.cnt}件 ({pct.toFixed(1)}%) / 信頼度平均 {(row.avg_conf * 100).toFixed(0)}%
                        </span>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </Section>

          {/* By Outcome */}
          <Section title="対応結果">
            {data.byOutcome.length === 0 ? (
              <Empty />
            ) : (
              <div className="flex flex-wrap gap-2">
                {data.byOutcome.map((row) => {
                  const oc = OUTCOME_LABEL[row.outcome] ?? { label: row.outcome, color: 'bg-gray-100 text-gray-700' }
                  return (
                    <span
                      key={row.outcome}
                      className={`px-3 py-1.5 rounded-full text-sm ${oc.color}`}
                    >
                      {oc.label}: <span className="font-bold">{row.cnt}</span>件
                    </span>
                  )
                })}
              </div>
            )}
          </Section>

          {/* By Category */}
          <Section title="カテゴリ別件数（多い順）">
            {data.byCategory.length === 0 ? (
              <Empty />
            ) : (
              <div className="space-y-1">
                {data.byCategory.map((row) => {
                  const max = Math.max(...data.byCategory.map((x) => x.cnt), 1)
                  const pct = (row.cnt / max) * 100
                  return (
                    <div key={row.category} className="flex items-center gap-3 text-sm">
                      <span className="w-32 text-gray-700">{row.category}</span>
                      <div className="flex-1 bg-gray-100 rounded h-5 overflow-hidden">
                        <div className="h-full bg-purple-300" style={{ width: `${pct}%` }} />
                      </div>
                      <span className="w-12 text-right font-medium">{row.cnt}</span>
                    </div>
                  )
                })}
              </div>
            )}
          </Section>

          {/* Pending Drafts */}
          <Section title="承認待ち下書き">
            {drafts.length === 0 ? (
              <p className="text-sm text-gray-500">承認待ちの下書きはありません ✨</p>
            ) : (
              <div className="space-y-3">
                {drafts.map((d) => (
                  <a
                    key={d.id}
                    href={`/chats?id=${d.chatId}`}
                    className="block p-3 border border-purple-200 bg-purple-50 hover:bg-purple-100 rounded-lg transition-colors"
                  >
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      {d.metadata?.category && (
                        <span className="text-xs px-2 py-0.5 bg-purple-200 text-purple-900 rounded-full">
                          {d.metadata.category}
                        </span>
                      )}
                      {typeof d.metadata?.confidence === 'number' && (
                        <span className="text-xs px-2 py-0.5 bg-white border border-purple-300 text-purple-700 rounded-full">
                          信頼度 {Math.round(d.metadata.confidence * 100)}%
                        </span>
                      )}
                      {d.metadata?.money_flag && (
                        <span className="text-xs px-2 py-0.5 bg-yellow-100 text-yellow-800 rounded-full">
                          💰 金銭
                        </span>
                      )}
                      <span className="text-xs text-gray-500 ml-auto">
                        {new Date(d.createdAt).toLocaleString('ja-JP', {
                          month: '2-digit',
                          day: '2-digit',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                    </div>
                    <p className="text-sm text-gray-700 line-clamp-2">{d.draftText.slice(0, 200)}</p>
                  </a>
                ))}
              </div>
            )}
          </Section>
        </>
      )}
    </div>
  )
}

function KpiCard({
  label,
  value,
  suffix,
  accent = 'default',
}: {
  label: string
  value: string
  suffix?: string
  accent?: 'default' | 'purple'
}) {
  const accentClass =
    accent === 'purple' ? 'border-purple-300 bg-purple-50' : 'border-gray-200 bg-white'
  return (
    <div className={`p-4 rounded-lg border ${accentClass}`}>
      <p className="text-xs text-gray-500 mb-1">{label}</p>
      <p className="text-2xl font-bold text-gray-900">
        {value}
        {suffix && <span className="text-sm font-normal text-gray-500 ml-1">{suffix}</span>}
      </p>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-5 mb-4">
      <h2 className="text-base font-bold text-gray-900 mb-3">{title}</h2>
      {children}
    </div>
  )
}

function Empty() {
  return <p className="text-sm text-gray-500">データがありません</p>
}
