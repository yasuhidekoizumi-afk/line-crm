'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { api, fetchApi } from '@/lib/api'
import CcPromptButton from '@/components/cc-prompt-button'
import { useAccount } from '@/contexts/account-context'
import { ORYZAE_BENCHMARK, compareToBenchmark } from '@/lib/benchmarks'
import AiCockpit from '@/components/dashboard/AiCockpit'
import ShopifyKpiBar from '@/components/dashboard/ShopifyKpiBar'
import TodayTasks from '@/components/dashboard/today-tasks'
import OnboardingTour from '@/components/onboarding/onboarding-tour'
import { useToast } from '@/lib/toast'
import { useInterval } from '@/lib/use-interval'

const ccPrompts = [
  { title: 'ダッシュボードのKPI分析', prompt: `LINE CRM ダッシュボードのデータを分析してください。\n1. 友だち数の推移を確認\n2. アクティブシナリオの効果を評価\n3. 配信の開封率・クリック率を分析\n改善提案を含めてレポートしてください。` },
  { title: '新しいシナリオを提案', prompt: `現在の友だちデータとタグ情報を元に、効果的なシナリオ配信を提案してください。\n1. ターゲットセグメントの特定\n2. メッセージ内容の提案\n3. 配信タイミングの最適化\n具体的なステップ配信の構成を含めてください。` },
]

interface DashboardStats { friendCount: number | null; activeScenarioCount: number | null; broadcastCount: number | null; templateCount: number | null; automationCount: number | null; scoringRuleCount: number | null }
interface FermentStats { totalCustomers: number | null; emailSubscribers: number | null; emailTemplates: number | null; emailCampaigns: number | null; totalSent30d: number | null; totalOpened30d: number | null; totalClicked30d: number | null; attributedRevenue30d: number | null; predictedClvSum: number | null; highIntent: number | null; topCampaigns: Array<{ campaign_id: string; name: string; total_sent: number; total_opened: number; total_attributed_revenue: number }> }
interface ApiResultGeneric<T> { success: boolean; data?: T; meta?: { total: number } }
interface LoyaltyStats { totalMembers: number | null; rankBreakdown: { rank: string; count: number }[] | null; thisMonthAwarded: number | null; thisMonthRedeemed: number | null; thisMonthNewMembers: number | null; lastMonthAwarded: number | null; lastMonthRedeemed: number | null; lastMonthNewMembers: number | null }

function StatCard({ title, value, loading, icon, href, accentColor = '#06C755' }: { title: string; value: number | null; loading: boolean; icon: React.ReactNode; href: string; accentColor?: string }) {
  return (
    <Link prefetch={false} href={href} className="block bg-white rounded-lg shadow-sm border border-gray-200 p-6 hover:shadow-md transition-shadow group">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm font-medium text-gray-500 mb-2">{title}</p>
          {loading ? <div className="h-8 w-20 bg-gray-100 rounded animate-pulse" /> : <p className="text-3xl font-bold text-gray-900">{value !== null ? value.toLocaleString('ja-JP') : '—'}</p>}
        </div>
        <div className="w-10 h-10 rounded-lg flex items-center justify-center text-white shrink-0" style={{ backgroundColor: accentColor }}>{icon}</div>
      </div>
      <p className="text-xs text-gray-400 mt-3 group-hover:text-green-600 transition-colors">詳細を見る →</p>
    </Link>
  )
}

function CollapsibleSection({ title, subtitle, defaultOpen = false, detailHref, detailLabel, children }: { title: React.ReactNode; subtitle?: string; defaultOpen?: boolean; detailHref?: string; detailLabel?: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="mb-8">
      <button onClick={() => setOpen(!open)} className="w-full flex items-center justify-between mb-4 group">
        <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">{title}{subtitle && <span className="text-xs font-normal text-gray-400">{subtitle}</span>}</h2>
        <div className="flex items-center gap-3">
          {detailHref && detailLabel && open && <Link prefetch={false} href={detailHref} className="text-xs text-green-600 hover:underline" onClick={(e) => e.stopPropagation()}>{detailLabel} →</Link>}
          <svg className={`w-5 h-5 text-gray-400 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
        </div>
      </button>
      {open && <div className="animate-in fade-in slide-in-from-top-2 duration-200">{children}</div>}
    </div>
  )
}

export default function DashboardPage() {
  const toast = useToast()
  const { selectedAccountId, selectedAccount } = useAccount()
  const [stats, setStats] = useState<DashboardStats>({ friendCount: null, activeScenarioCount: null, broadcastCount: null, templateCount: null, automationCount: null, scoringRuleCount: null })
  const [loyalty, setLoyalty] = useState<LoyaltyStats>({ totalMembers: null, rankBreakdown: null, thisMonthAwarded: null, thisMonthRedeemed: null, thisMonthNewMembers: null, lastMonthAwarded: null, lastMonthRedeemed: null, lastMonthNewMembers: null })
  const [ferment, setFerment] = useState<FermentStats>({ totalCustomers: null, emailSubscribers: null, emailTemplates: null, emailCampaigns: null, totalSent30d: null, totalOpened30d: null, totalClicked30d: null, attributedRevenue30d: null, predictedClvSum: null, highIntent: null, topCampaigns: [] })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [autoRefresh, setAutoRefresh] = useState(true)

  const loadStats = useCallback(async () => {
    try {
      const [friendCountRes, scenariosRes, broadcastsRes, templatesRes, automationsRes, scoringRes] = await Promise.allSettled([
        api.friends.count({ accountId: selectedAccountId ?? undefined }),
        api.scenarios.list(), api.broadcasts.list(), api.templates.list(), api.automations.list(), api.scoring.rules(),
      ])
      setStats({
        friendCount: friendCountRes.status === 'fulfilled' && friendCountRes.value.success ? friendCountRes.value.data.count : null,
        activeScenarioCount: scenariosRes.status === 'fulfilled' && scenariosRes.value.success ? scenariosRes.value.data.filter((s) => s.isActive).length : null,
        broadcastCount: broadcastsRes.status === 'fulfilled' && broadcastsRes.value.success ? broadcastsRes.value.data.length : null,
        templateCount: templatesRes.status === 'fulfilled' && templatesRes.value.success ? templatesRes.value.data.length : null,
        automationCount: automationsRes.status === 'fulfilled' && automationsRes.value.success ? automationsRes.value.data.filter((a) => a.isActive).length : null,
        scoringRuleCount: scoringRes.status === 'fulfilled' && scoringRes.value.success ? scoringRes.value.data.length : null,
      })
    } catch { setError('データの読み込みに失敗しました'); toast.addToast('データの読み込みに失敗しました', 'error') }
    finally { setLoading(false) }
  }, [selectedAccountId, toast])

  const loadFerment = useCallback(async () => {
    try {
      const [customersRes, subscribersRes, templatesRes, campaignsRes, insightsRes, funnelRes, attributionRes] = await Promise.allSettled([
        fetchApi<ApiResultGeneric<unknown[]>>('/api/customers?limit=1'),
        fetchApi<ApiResultGeneric<unknown[]>>('/api/customers?limit=1&subscribed_email=true'),
        fetchApi<ApiResultGeneric<unknown[]>>('/api/email/templates'),
        fetchApi<ApiResultGeneric<unknown[]>>('/api/email/campaigns'),
        fetchApi<ApiResultGeneric<{ total: number; with_clv: number; total_clv: number; high_intent: number }>>('/api/ferment/insights/summary'),
        fetchApi<ApiResultGeneric<{ sent: number; opened: number; clicked: number; total_revenue: number }>>('/api/ferment/analytics/funnel-overall'),
        (fetchApi as any)('/api/ferment/attribution/summary').catch(() => ({ success: false })),
      ])
      const getMeta = (res: PromiseSettledResult<ApiResultGeneric<unknown[]>>): number | null => res.status === 'fulfilled' && res.value.success ? (res.value.meta?.total ?? res.value.data?.length ?? 0) : null
      const insights = insightsRes.status === 'fulfilled' && (insightsRes as any).value?.success ? (insightsRes as any).value.data : null
      const funnel = funnelRes.status === 'fulfilled' && (funnelRes as any).value?.success ? (funnelRes as any).value.data : null
      const attribution = (attributionRes as any)?.success ? ((attributionRes as any).data ?? []) : []
      setFerment({
        totalCustomers: getMeta(customersRes), emailSubscribers: getMeta(subscribersRes), emailTemplates: getMeta(templatesRes), emailCampaigns: getMeta(campaignsRes),
        totalSent30d: funnel?.sent ?? 0, totalOpened30d: funnel?.opened ?? 0, totalClicked30d: funnel?.clicked ?? 0, attributedRevenue30d: funnel?.total_revenue ?? 0,
        predictedClvSum: insights?.total_clv ?? 0, highIntent: insights?.high_intent ?? 0, topCampaigns: attribution.slice(0, 5),
      })
    } catch { /* ignore */ }
  }, [])

  const loadLoyalty = useCallback(async () => {
    try {
      const [statsRes, periodRes] = await Promise.allSettled([
        fetchApi<ApiResultGeneric<{ ranks: { rank: string; count: number }[]; total: number }>>('/api/loyalty/stats'),
        fetchApi<ApiResultGeneric<{ this_month: { awarded: number; redeemed: number; new_members: number }; last_month: { awarded: number; redeemed: number; new_members: number } }>>('/api/loyalty/period-stats'),
      ])
      const s = statsRes.status === 'fulfilled' && statsRes.value.success ? statsRes.value.data : null
      const p = periodRes.status === 'fulfilled' && periodRes.value.success ? periodRes.value.data : null
      setLoyalty({ totalMembers: s?.total ?? null, rankBreakdown: s?.ranks ?? null, thisMonthAwarded: p?.this_month?.awarded ?? null, thisMonthRedeemed: p?.this_month?.redeemed ?? null, thisMonthNewMembers: p?.this_month?.new_members ?? null, lastMonthAwarded: p?.last_month?.awarded ?? null, lastMonthRedeemed: p?.last_month?.redeemed ?? null, lastMonthNewMembers: p?.last_month?.new_members ?? null })
    } catch { /* ignore */ }
  }, [])

  useEffect(() => { setLoading(true); setError(''); Promise.allSettled([loadStats(), loadFerment(), loadLoyalty()]) }, [loadStats, loadFerment, loadLoyalty])
  useInterval(() => { loadStats() }, autoRefresh ? 60_000 : null)

  return (
    <div>
      <OnboardingTour />
      <div className="mb-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-gray-900">ダッシュボード</h1>
            <p className="text-sm text-gray-500 mt-1">{selectedAccount ? `${selectedAccount.displayName || selectedAccount.name} の管理画面` : 'LINE公式アカウント CRM 管理画面'}</p>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={loadStats} className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-green-600 transition-colors" aria-label="手動更新">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
              更新
            </button>
            <label className="flex items-center gap-1.5 text-xs text-gray-400 cursor-pointer select-none">
              <input type="checkbox" checked={autoRefresh} onChange={() => setAutoRefresh(!autoRefresh)} className="w-3 h-3 rounded border-gray-300 text-green-600 focus:ring-green-500" />
              自動更新
            </label>
          </div>
        </div>
      </div>

      {error && <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{error}</div>}

      <TodayTasks />
      <div className="mb-6"><ShopifyKpiBar /></div>

      <a href="https://line-crm-worker.line-crm-api.workers.dev/auth/line?ref=dashboard" target="_blank" rel="noopener noreferrer"
        className="block mb-6 p-4 rounded-xl border border-green-200 bg-gradient-to-r from-green-50 to-emerald-50 hover:from-green-100 hover:to-emerald-100 transition-colors">
        <div className="flex items-center justify-between">
          <div><p className="text-sm font-bold text-gray-900">LINE で体験する</p><p className="text-xs text-gray-500 mt-0.5">友だち追加でステップ配信・フォーム・自動返信を体験</p></div>
          <span className="text-xs px-3 py-1.5 rounded-full text-white font-medium" style={{ backgroundColor: '#06C755' }}>友だち追加</span>
        </div>
      </a>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4 mb-8">
        <StatCard title="友だち数" value={stats.friendCount} loading={loading} href="/friends" icon={<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" /></svg>} />
        <StatCard title="アクティブシナリオ数" value={stats.activeScenarioCount} loading={loading} href="/scenarios" accentColor="#3B82F6" icon={<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" /></svg>} />
        <StatCard title="配信数 (合計)" value={stats.broadcastCount} loading={loading} href="/broadcasts" accentColor="#8B5CF6" icon={<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z" /></svg>} />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4 mb-8">
        <StatCard title="テンプレート数" value={stats.templateCount} loading={loading} href="/templates" accentColor="#F59E0B" icon={<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6z" /></svg>} />
        <StatCard title="アクティブルール数" value={stats.automationCount} loading={loading} href="/automations" accentColor="#EF4444" icon={<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>} />
        <StatCard title="スコアリングルール数" value={stats.scoringRuleCount} loading={loading} href="/scoring" accentColor="#10B981" icon={<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" /></svg>} />
      </div>

      <CollapsibleSection title={<><span>💎</span><span>ロイヤルティ会員</span></>} subtitle="今月実績" detailHref="/loyalty" detailLabel="詳細管理">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          <div className="bg-white rounded-lg border border-gray-200 p-4"><p className="text-xs text-gray-500">総会員数</p><p className="text-2xl font-bold text-gray-900 mt-1">{loyalty.totalMembers?.toLocaleString() ?? '—'}</p><p className="text-xs text-gray-400 mt-1">名</p></div>
          <div className="bg-white rounded-lg border border-gray-200 p-4"><p className="text-xs text-gray-500">付与ポイント (今月)</p><p className="text-2xl font-bold text-green-600 mt-1">{loyalty.thisMonthAwarded?.toLocaleString() ?? '—'}<span className="text-sm font-normal text-gray-400 ml-1">pt</span></p><p className="text-xs text-gray-400 mt-1">先月: {loyalty.lastMonthAwarded?.toLocaleString() ?? '—'} pt</p></div>
          <div className="bg-white rounded-lg border border-gray-200 p-4"><p className="text-xs text-gray-500">利用ポイント (今月)</p><p className="text-2xl font-bold text-red-600 mt-1">{loyalty.thisMonthRedeemed?.toLocaleString() ?? '—'}<span className="text-sm font-normal text-gray-400 ml-1">pt</span></p><p className="text-xs text-gray-400 mt-1">先月: {loyalty.lastMonthRedeemed?.toLocaleString() ?? '—'} pt</p></div>
          <div className="bg-white rounded-lg border border-gray-200 p-4"><p className="text-xs text-gray-500">新規会員 (今月)</p><p className="text-2xl font-bold text-blue-600 mt-1">{loyalty.thisMonthNewMembers?.toLocaleString() ?? '—'}<span className="text-sm font-normal text-gray-400 ml-1">名</span></p><p className="text-xs text-gray-400 mt-1">先月: {loyalty.lastMonthNewMembers?.toLocaleString() ?? '—'} 名</p></div>
        </div>
        {loyalty.rankBreakdown && loyalty.rankBreakdown.length > 0 && (
          <div className="bg-white border border-gray-200 rounded-lg p-4 mb-4"><p className="text-xs font-semibold text-gray-700 mb-3">📊 会員ランク内訳</p>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">{loyalty.rankBreakdown.map((r) => {
              const colors: Record<string, string> = { 'ダイヤモンド': 'bg-cyan-50 text-cyan-700 border-cyan-200', 'プラチナ': 'bg-purple-50 text-purple-700 border-purple-200', 'ゴールド': 'bg-yellow-50 text-yellow-700 border-yellow-200', 'シルバー': 'bg-gray-100 text-gray-700 border-gray-300', 'レギュラー': 'bg-green-50 text-green-700 border-green-200' }
              return (<div key={r.rank} className={`p-3 rounded-lg border ${colors[r.rank] ?? 'bg-gray-50 text-gray-600 border-gray-200'}`}><p className="text-xs font-medium">{r.rank}</p><p className="text-lg font-bold mt-1">{r.count.toLocaleString()}</p><p className="text-xs opacity-70">名</p></div>)
            })}</div>
          </div>
        )}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          <Link prefetch={false} href="/loyalty" className="text-xs text-center py-2 px-3 bg-white border border-gray-200 rounded-lg hover:bg-yellow-50 hover:border-yellow-300">💎 会員一覧</Link>
          <Link prefetch={false} href="/loyalty?tab=campaigns" className="text-xs text-center py-2 px-3 bg-white border border-gray-200 rounded-lg hover:bg-purple-50 hover:border-purple-300">🎉 キャンペーン</Link>
          <Link prefetch={false} href="/loyalty?tab=transactions" className="text-xs text-center py-2 px-3 bg-white border border-gray-200 rounded-lg hover:bg-blue-50 hover:border-blue-300">📊 取引履歴</Link>
        </div>
      </CollapsibleSection>

      <CollapsibleSection title={<><span>🌾</span><span>FERMENT メール</span></>} subtitle="過去30日" detailHref="/email/analytics" detailLabel="分析詳細">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          <div className="bg-white rounded-lg border border-gray-200 p-4"><p className="text-xs text-gray-500">統合顧客数</p><p className="text-2xl font-bold text-gray-900 mt-1">{ferment.totalCustomers?.toLocaleString() ?? '—'}</p><p className="text-xs text-gray-400 mt-1">メール購読: {ferment.emailSubscribers?.toLocaleString() ?? '—'}人</p></div>
          <div className="bg-white rounded-lg border border-gray-200 p-4"><p className="text-xs text-gray-500">送信数 (30日)</p><p className="text-2xl font-bold text-gray-900 mt-1">{ferment.totalSent30d?.toLocaleString() ?? '—'}</p><p className="text-xs text-gray-400 mt-1">開封率: {ferment.totalSent30d && ferment.totalSent30d > 0 ? ((ferment.totalOpened30d ?? 0) / ferment.totalSent30d * 100).toFixed(1) + '%' : '—'}</p></div>
          <div className="bg-white rounded-lg border border-gray-200 p-4"><p className="text-xs text-gray-500">帰属売上 (30日)</p><p className="text-2xl font-bold text-green-600 mt-1">¥{(ferment.attributedRevenue30d ?? 0).toLocaleString()}</p><p className="text-xs text-gray-400 mt-1">メール経由</p></div>
          <div className="bg-white rounded-lg border border-gray-200 p-4"><p className="text-xs text-gray-500">高購入意欲</p><p className="text-2xl font-bold text-purple-600 mt-1">{ferment.highIntent?.toLocaleString() ?? '—'}</p><p className="text-xs text-gray-400 mt-1">30日内 50%以上</p></div>
        </div>
        {ferment.totalSent30d != null && ferment.totalSent30d > 0 && (() => { const openRate = (ferment.totalOpened30d ?? 0) / ferment.totalSent30d * 100; const clickRate = (ferment.totalClicked30d ?? 0) / ferment.totalSent30d * 100; const openCmp = compareToBenchmark('open', openRate); const clickCmp = compareToBenchmark('click', clickRate); return (
          <div className="bg-gradient-to-r from-blue-50 to-purple-50 border border-blue-100 rounded-lg p-4 mb-4">
            <p className="text-xs font-semibold text-gray-700 mb-2">📊 業界ベンチマーク（{ORYZAE_BENCHMARK.industry}）との比較</p>
            <div className="grid grid-cols-2 gap-4 text-xs">
              <div><span className="text-gray-500">開封率</span><span className={`ml-2 font-semibold ${openCmp.status === 'good' ? 'text-green-600' : openCmp.status === 'bad' ? 'text-red-600' : 'text-gray-700'}`}>{openRate.toFixed(1)}% {openCmp.label}</span><span className="text-gray-400 ml-1">(平均 {ORYZAE_BENCHMARK.open_rate}%)</span></div>
              <div><span className="text-gray-500">クリック率</span><span className={`ml-2 font-semibold ${clickCmp.status === 'good' ? 'text-green-600' : clickCmp.status === 'bad' ? 'text-red-600' : 'text-gray-700'}`}>{clickRate.toFixed(1)}% {clickCmp.label}</span><span className="text-gray-400 ml-1">(平均 {ORYZAE_BENCHMARK.click_rate}%)</span></div>
            </div>
          </div>
        )})()}
        {ferment.topCampaigns.length > 0 && (
          <div className="bg-white rounded-lg border border-gray-200 p-4"><p className="text-xs font-semibold text-gray-700 mb-3">💰 売上貢献 Top 5 キャンペーン</p>
            <div className="space-y-2">{ferment.topCampaigns.map((c) => { const openRate = c.total_sent > 0 ? (c.total_opened / c.total_sent) * 100 : 0; return (
              <div key={c.campaign_id} className="flex items-center justify-between text-sm border-b border-gray-50 pb-2 last:border-0">
                <span className="truncate flex-1 text-gray-700">{c.name}</span>
                <div className="flex gap-4 text-xs text-gray-500 shrink-0 ml-2"><span>{c.total_sent.toLocaleString()}通</span><span>開封{openRate.toFixed(0)}%</span><span className="text-green-600 font-semibold">¥{(c.total_attributed_revenue ?? 0).toLocaleString()}</span></div>
              </div>
            )})}</div>
          </div>
        )}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-4">
          <Link prefetch={false} href="/email/campaigns" className="text-xs text-center py-2 px-3 bg-white border border-gray-200 rounded-lg hover:bg-green-50 hover:border-green-300">✉️ 新規キャンペーン</Link>
          <Link prefetch={false} href="/email/templates" className="text-xs text-center py-2 px-3 bg-white border border-gray-200 rounded-lg hover:bg-purple-50 hover:border-purple-300">📝 テンプレ編集</Link>
          <Link prefetch={false} href="/email/insights" className="text-xs text-center py-2 px-3 bg-white border border-gray-200 rounded-lg hover:bg-blue-50 hover:border-blue-300">🎯 顧客インサイト</Link>
          <Link prefetch={false} href="/email/forms" className="text-xs text-center py-2 px-3 bg-white border border-gray-200 rounded-lg hover:bg-yellow-50 hover:border-yellow-300">📋 フォーム管理</Link>
        </div>
      </CollapsibleSection>

      <AiCockpit />

      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <h2 className="text-sm font-semibold text-gray-800 mb-4">クイックアクション</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {[{ href: '/friends', label: '友だち管理', desc: '友だちの一覧・タグ管理', color: '#06C755' }, { href: '/scenarios', label: 'シナリオ配信', desc: '自動配信シナリオの作成・編集', color: '#3B82F6' }, { href: '/broadcasts', label: '一斉配信', desc: 'メッセージの一斉送信・予約', color: '#8B5CF6' }, { href: '/chats', label: 'チャット', desc: 'オペレーターチャット管理', color: '#06C755' }, { href: '/health', label: 'BAN検知', desc: 'アカウント健康度ダッシュボード', color: '#EF4444' }].map((item) => (
            <Link key={item.href} prefetch={false} href={item.href} className="flex items-center gap-3 p-3 rounded-lg border border-gray-200 hover:border-green-300 hover:bg-green-50 transition-colors group">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center text-white shrink-0" style={{ backgroundColor: item.color }}>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
              </div>
              <div><p className="text-sm font-medium text-gray-900 group-hover:text-green-700 transition-colors">{item.label}</p><p className="text-xs text-gray-400">{item.desc}</p></div>
            </Link>
          ))}
        </div>
      </div>
      <CcPromptButton prompts={ccPrompts} />
    </div>
  )
}
