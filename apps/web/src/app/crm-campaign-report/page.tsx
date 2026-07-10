'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Header from '@/components/layout/header'
import { fetchApi } from '@/lib/api'

type Report = {
  period: { start: string; end: string }
  sales: {
    d1: SalesSummary
    liveShopify: SalesSummary & {
      status: 'ok' | 'unavailable' | 'error'
      error: string | null
      fetchedOrders: number
      daily: Array<SalesSummary & { date: string }>
    }
    d1Freshness: {
      total_orders: number
      min_processed_at: string | null
      max_processed_at: string | null
      min_ingested_at: string | null
      max_ingested_at: string | null
    } | null
  }
  line: {
    broadcasts: BroadcastRow[]
    orphanSends: OrphanSendRow[]
    followDaily: FollowRow[]
  }
  traffic: {
    daily: TrafficDailyRow[]
    links: TrafficLinkRow[]
  }
  email: {
    manual_broadcasts: number
    email_campaigns: number
    email_logs: number
    latest_email_campaign_at: string | null
    latest_email_log_at: string | null
  } | null
}

type SalesSummary = {
  orders: number
  revenue: number
  discounts: number
  lineOrders: number
  lineRevenue: number
  oatsOrders: number
  oatsRevenue: number
}

type BroadcastRow = {
  id: string
  title: string
  sent_at: string
  target_type: string
  segment_name: string | null
  tag_name: string | null
  total_count: number
  success_count: number
  failed_count: number
  line_account_name: string | null
  click_count: number
  unique_click_count: number
}

type OrphanSendRow = {
  broadcast_id: string
  sent_date: string
  sends: number
  unique_users: number
  first_sent_at: string
  last_sent_at: string
  tracked_link_id: string | null
  original_url: string | null
  click_count: number | null
}

type TrafficDailyRow = {
  date: string
  clicks: number
  links: number
  identified_friends: number
}

type TrafficLinkRow = {
  id: string
  name: string
  original_url: string
  broadcast_id: string | null
  broadcast_title: string | null
  clicks: number
  unique_clicks: number
  first_clicked_at: string
  last_clicked_at: string
}

type FollowRow = {
  date: string
  follows: number
  unfollows: number
}

const yen = (n: number) => '¥' + Math.round(n || 0).toLocaleString('ja-JP')
const num = (n: number) => Math.round(n || 0).toLocaleString('ja-JP')
const pct = (part: number, total: number) => total > 0 ? `${Math.round((part / total) * 1000) / 10}%` : '-'

export default function CrmCampaignReportPage() {
  const [start, setStart] = useState('2026-07-01')
  const [end, setEnd] = useState('2026-07-09')
  const [report, setReport] = useState<Report | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const query = new URLSearchParams({ start, end })
      const response = await fetchApi<{ success: boolean; data: Report }>(`/api/crm-campaign-report?${query}`)
      setReport(response.data)
    } catch (err) {
      setError(err instanceof Error ? err.message : '取得に失敗しました')
    } finally {
      setLoading(false)
    }
  }, [start, end])

  useEffect(() => {
    load()
  }, [load])

  const lineSummary = useMemo(() => {
    const broadcasts = report?.line.broadcasts ?? []
    const orphan = report?.line.orphanSends ?? []
    const broadcastSuccess = broadcasts.reduce((sum, row) => sum + Number(row.success_count ?? 0), 0)
    const broadcastTargets = broadcasts.reduce((sum, row) => sum + Number(row.total_count ?? 0), 0)
    const broadcastFailed = broadcasts.reduce((sum, row) => sum + Number(row.failed_count ?? 0), 0)
    const orphanSends = orphan.reduce((sum, row) => sum + Number(row.sends ?? 0), 0)
    const clicks = (report?.traffic.links ?? []).reduce((sum, row) => sum + Number(row.clicks ?? 0), 0)
    const nonBroadcastClicks = (report?.traffic.links ?? [])
      .filter((row) => !row.broadcast_id)
      .reduce((sum, row) => sum + Number(row.clicks ?? 0), 0)
    return { broadcastTargets, broadcastSuccess, broadcastFailed, orphanSends, clicks, nonBroadcastClicks }
  }, [report])

  const follows = useMemo(() => {
    const rows = report?.line.followDaily ?? []
    return {
      follows: rows.reduce((sum, row) => sum + Number(row.follows ?? 0), 0),
      unfollows: rows.reduce((sum, row) => sum + Number(row.unfollows ?? 0), 0),
    }
  }, [report])

  return (
    <div className="min-h-screen bg-gray-50">
      <Header title="CRMキャンペーン分析" description="LINE・メルマガ・リッチメニュー候補流入・売上を期間で確認" />
      <main className="max-w-7xl mx-auto px-4 py-6">
        <div className="bg-white rounded-lg shadow p-4 mb-6">
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-sm font-medium text-gray-700">
              開始日
              <input type="date" value={start} onChange={(e) => setStart(e.target.value)} className="block mt-1 border border-gray-300 rounded px-2 py-1 text-sm" />
            </label>
            <label className="text-sm font-medium text-gray-700">
              終了日
              <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} className="block mt-1 border border-gray-300 rounded px-2 py-1 text-sm" />
            </label>
            <button onClick={load} className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded">
              更新
            </button>
          </div>
        </div>

        {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded p-3 mb-4 text-sm">{error}</div>}
        {loading && !report ? (
          <div className="text-center text-gray-500 py-16">読み込み中...</div>
        ) : report ? (
          <>
            <section className="mb-6">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-lg font-bold text-gray-900">売上</h2>
                <span className="text-xs text-gray-500">Shopify live: {report.sales.liveShopify.status}</span>
              </div>
              {report.sales.liveShopify.status !== 'ok' && (
                <div className="bg-yellow-50 border border-yellow-200 text-yellow-800 rounded p-3 mb-3 text-sm">
                  Shopify live売上の取得に失敗しました: {report.sales.liveShopify.error ?? '設定未完了'}
                </div>
              )}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <Metric label="売上合計" value={yen(report.sales.liveShopify.revenue)} />
                <Metric label="注文数" value={`${num(report.sales.liveShopify.orders)}件`} />
                <Metric label="AOV" value={yen(report.sales.liveShopify.orders > 0 ? report.sales.liveShopify.revenue / report.sales.liveShopify.orders : 0)} />
                <Metric label="取得注文" value={`${num(report.sales.liveShopify.fetchedOrders)}件`} />
                <Metric label="LINEらしき注文" value={`${num(report.sales.liveShopify.lineOrders)}件`} sub={yen(report.sales.liveShopify.lineRevenue)} />
                <Metric label="LINE売上比率" value={pct(report.sales.liveShopify.lineRevenue, report.sales.liveShopify.revenue)} />
                <Metric label="オートミールクランチ注文" value={`${num(report.sales.liveShopify.oatsOrders)}件`} sub={yen(report.sales.liveShopify.oatsRevenue)} />
                <Metric label="D1上の7月売上" value={yen(report.sales.d1.revenue)} sub={`最終注文: ${report.sales.d1Freshness?.max_processed_at ?? '-'}`} tone={report.sales.d1.revenue === 0 ? 'warn' : 'normal'} />
              </div>
              <p className="text-xs text-gray-500 mt-3">
                D1注文同期: {report.sales.d1Freshness?.min_processed_at ?? '-'} 〜 {report.sales.d1Freshness?.max_processed_at ?? '-'}。
                D1が古い場合も、この画面上段はShopifyから期間売上を直接読み取ります。
              </p>
            </section>

            <section className="mb-8 grid grid-cols-2 md:grid-cols-4 gap-4">
              <Metric label="LINE配信成功" value={`${num(lineSummary.broadcastSuccess)}件`} sub={`対象 ${num(lineSummary.broadcastTargets)} / 失敗 ${num(lineSummary.broadcastFailed)}`} />
              <Metric label="欠落配信ログ" value={`${num(lineSummary.orphanSends)}件`} tone={lineSummary.orphanSends > 0 ? 'warn' : 'normal'} />
              <Metric label="クリック合計" value={`${num(lineSummary.clicks)}件`} sub={`配信IDなし ${num(lineSummary.nonBroadcastClicks)}件`} />
              <Metric label="友だち増減" value={`${num(follows.follows - follows.unfollows)}人`} sub={`追加 ${num(follows.follows)} / ブロック ${num(follows.unfollows)}`} tone={follows.unfollows > follows.follows ? 'warn' : 'normal'} />
            </section>

            <DataSection title="日別売上">
              <Table>
                <thead><tr><Th>日付</Th><Th right>売上</Th><Th right>注文</Th><Th right>LINE売上</Th><Th right>クランチ売上</Th></tr></thead>
                <tbody>
                  {report.sales.liveShopify.daily.map((row) => (
                    <tr key={row.date} className="border-t">
                      <Td>{row.date}</Td>
                      <Td right>{yen(row.revenue)}</Td>
                      <Td right>{num(row.orders)}</Td>
                      <Td right>{yen(row.lineRevenue)}</Td>
                      <Td right>{yen(row.oatsRevenue)}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </DataSection>

            <DataSection title="LINE配信">
              <Table>
                <thead><tr><Th>配信</Th><Th>対象</Th><Th right>成功</Th><Th right>失敗</Th><Th right>クリック</Th></tr></thead>
                <tbody>
                  {report.line.broadcasts.map((row) => (
                    <tr key={row.id} className="border-t">
                      <Td>
                        <div className="font-medium text-gray-900">{row.title}</div>
                        <div className="text-xs text-gray-500">{row.sent_at?.slice(0, 16).replace('T', ' ')} / {row.segment_name ?? row.tag_name ?? row.target_type}</div>
                      </Td>
                      <Td>{row.line_account_name ?? '-'}</Td>
                      <Td right>{num(row.success_count)}</Td>
                      <Td right>{num(row.failed_count)}</Td>
                      <Td right>{num(row.click_count)}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </DataSection>

            {report.line.orphanSends.length > 0 && (
              <DataSection title="配信本体が欠落している送信ログ">
                <Table>
                  <thead><tr><Th>日時</Th><Th>broadcast_id</Th><Th right>送信</Th><Th>候補リンク</Th><Th right>リンククリック</Th></tr></thead>
                  <tbody>
                    {report.line.orphanSends.map((row, idx) => (
                      <tr key={`${row.broadcast_id}-${idx}`} className="border-t">
                        <Td>{row.first_sent_at?.slice(0, 16).replace('T', ' ')}</Td>
                        <Td><span className="font-mono text-xs">{row.broadcast_id}</span></Td>
                        <Td right>{num(row.sends)}</Td>
                        <Td className="max-w-md truncate">{row.original_url ?? '-'}</Td>
                        <Td right>{num(row.click_count ?? 0)}</Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </DataSection>
            )}

            <DataSection title="流入リンク">
              <Table>
                <thead><tr><Th>URL</Th><Th>紐づき</Th><Th right>クリック</Th><Th>初回</Th><Th>最終</Th></tr></thead>
                <tbody>
                  {report.traffic.links.map((row) => (
                    <tr key={row.id} className="border-t">
                      <Td className="max-w-lg truncate">{row.original_url}</Td>
                      <Td>{row.broadcast_title ?? '配信IDなし'}</Td>
                      <Td right>{num(row.clicks)}</Td>
                      <Td>{row.first_clicked_at?.slice(0, 16).replace('T', ' ')}</Td>
                      <Td>{row.last_clicked_at?.slice(0, 16).replace('T', ' ')}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </DataSection>

            <div className="grid md:grid-cols-2 gap-6">
              <DataSection title="日別クリック">
                <Table>
                  <thead><tr><Th>日付</Th><Th right>クリック</Th><Th right>リンク数</Th><Th right>識別友だち</Th></tr></thead>
                  <tbody>
                    {report.traffic.daily.map((row) => (
                      <tr key={row.date} className="border-t"><Td>{row.date}</Td><Td right>{num(row.clicks)}</Td><Td right>{num(row.links)}</Td><Td right>{num(row.identified_friends)}</Td></tr>
                    ))}
                  </tbody>
                </Table>
              </DataSection>

              <DataSection title="友だち増減">
                <Table>
                  <thead><tr><Th>日付</Th><Th right>追加</Th><Th right>ブロック</Th><Th right>差分</Th></tr></thead>
                  <tbody>
                    {report.line.followDaily.map((row) => (
                      <tr key={row.date} className="border-t"><Td>{row.date}</Td><Td right>{num(row.follows)}</Td><Td right>{num(row.unfollows)}</Td><Td right>{num(row.follows - row.unfollows)}</Td></tr>
                    ))}
                  </tbody>
                </Table>
              </DataSection>
            </div>

            <section className="mt-8 bg-white rounded-lg shadow p-4">
              <h2 className="text-lg font-bold text-gray-900 mb-3">メルマガ/手動配信ログ</h2>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <Metric label="手動配信記録" value={`${num(report.email?.manual_broadcasts ?? 0)}件`} />
                <Metric label="メルマガキャンペーン" value={`${num(report.email?.email_campaigns ?? 0)}件`} />
                <Metric label="メルマガログ" value={`${num(report.email?.email_logs ?? 0)}件`} />
                <Metric label="最終メルマガログ" value={(report.email?.latest_email_log_at ?? '-').slice(0, 10)} />
              </div>
            </section>
          </>
        ) : null}
      </main>
    </div>
  )
}

function Metric({ label, value, sub, tone = 'normal' }: { label: string; value: string; sub?: string; tone?: 'normal' | 'warn' }) {
  return (
    <div className={`bg-white rounded-lg shadow p-4 border ${tone === 'warn' ? 'border-yellow-200' : 'border-transparent'}`}>
      <div className="text-xs font-medium text-gray-500">{label}</div>
      <div className={`mt-1 text-2xl font-bold ${tone === 'warn' ? 'text-yellow-700' : 'text-gray-900'}`}>{value}</div>
      {sub && <div className="mt-1 text-xs text-gray-500">{sub}</div>}
    </div>
  )
}

function DataSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-8">
      <h2 className="text-lg font-bold text-gray-900 mb-3">{title}</h2>
      <div className="bg-white rounded-lg shadow overflow-x-auto">{children}</div>
    </section>
  )
}

function Table({ children }: { children: React.ReactNode }) {
  return <table className="min-w-full text-sm">{children}</table>
}

function Th({ children, right = false }: { children: React.ReactNode; right?: boolean }) {
  return <th className={`bg-gray-100 px-4 py-2 text-xs font-semibold text-gray-600 ${right ? 'text-right' : 'text-left'}`}>{children}</th>
}

function Td({ children, right = false, className = '' }: { children: React.ReactNode; right?: boolean; className?: string }) {
  return <td className={`px-4 py-2 align-top ${right ? 'text-right tabular-nums' : 'text-left'} ${className}`}>{children}</td>
}
