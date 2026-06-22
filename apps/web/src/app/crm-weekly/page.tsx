'use client'

/**
 * CRM 週次レポート
 *
 * 役割: 河原さんが手作業で作っていた週次 Word レポートの「数字部分」を
 *       管理画面で自動表示する。
 *
 * 表示するもの:
 *   1. 週次サマリー (販売合計・注文・AOV・割引比率・前年比)
 *   2. 4週推移
 *   3. 日別動向 (7日)
 *   4. LINE配信実績 (broadcasts)
 *   5. Shopify Emailキャンペーン (Admin API経由)
 */

import { useEffect, useCallback, useState } from 'react'
import { fetchApi } from '@/lib/api'
import Header from '@/components/layout/header'

// ===== 型 =====
interface Summary {
  period: { start: string; end: string }
  orderCount: number
  grossSales: number
  netSales: number
  totalDiscounts: number
  discountRatio: number
  aov: number
  uniqueCustomers: number
}

interface DailyRow {
  date: string
  orderCount: number
  grossSales: number
  totalDiscounts: number
  aov: number
}

interface TrendRow {
  weekStart: string
  weekEnd: string
  orderCount: number
  grossSales: number
  netSales: number
  totalDiscounts: number
  discountRatio: number
  aov: number
}

interface Broadcast {
  id: string
  title: string
  messageType: string
  sentAt: string
  totalCount: number
  successCount: number
  failedCount: number
  successRate: number
}

interface EmailCampaign {
  id: string
  title: string
  status: string
  channel: string
  utmCampaign: string | null
  sourceAndMedium: string | null
  url: string | null
  createdAt: string
  updatedAt: string
  budget: string | null
}

// ===== ユーティリティ =====
const yen = (n: number) => '¥' + Math.round(n).toLocaleString('ja-JP')
const num = (n: number) => Math.round(n).toLocaleString('ja-JP')

const WEEKDAY = ['日', '月', '火', '水', '木', '金', '土']

/** 当日の YYYY-MM-DD */
function todayStr() {
  const d = new Date()
  return d.getFullYear() + '-' +
    String(d.getMonth() + 1).padStart(2, '0') + '-' +
    String(d.getDate()).padStart(2, '0')
}

/** YYYY-MM-DD に日数を加算 */
function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/** 直近の指定曜日 (0=日, 3=水) から始まる「先週」の開始日を返す */
function lastWeekStart(weekday: number = 3): string {
  const today = new Date()
  today.setUTCHours(0, 0, 0, 0)
  const dow = today.getUTCDay()
  // 直近の weekday (水曜) を求める。今日が水曜なら今日。
  let diff = (dow - weekday + 7) % 7
  const thisWeekStart = new Date(today)
  thisWeekStart.setUTCDate(today.getUTCDate() - diff)
  // 「先週」 = 1週間前
  thisWeekStart.setUTCDate(thisWeekStart.getUTCDate() - 7)
  return thisWeekStart.toISOString().slice(0, 10)
}

export default function CrmWeeklyPage() {
  // 期間入力 (デフォルト = 先週・水曜起算で 7日間)
  const [start, setStart] = useState<string>(() => lastWeekStart(3))
  const [end, setEnd] = useState<string>(() => addDays(lastWeekStart(3), 6))

  // 入力された start/end を「確定済み」値として保持（取得トリガー用）
  const [appliedStart, setAppliedStart] = useState<string>(start)
  const [appliedEnd, setAppliedEnd] = useState<string>(end)

  // データ
  const [summary, setSummary] = useState<Summary | null>(null)
  const [daily, setDaily] = useState<DailyRow[]>([])
  const [trend, setTrend] = useState<TrendRow[]>([])
  const [broadcasts, setBroadcasts] = useState<Broadcast[]>([])
  const [emailCampaigns, setEmailCampaigns] = useState<EmailCampaign[]>([])
  const [emailError, setEmailError] = useState<string | null>(null)

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // データ取得
  const fetchAll = useCallback(async (s: string, e: string) => {
    setLoading(true)
    setError(null)
    setEmailError(null)
    try {
      const qs = `start=${s}&end=${e}`

      // 並列取得 (Promise.allSettled で 1つ失敗しても他を表示)
      const [sumRes, dailyRes, trendRes, brRes, emailRes] = await Promise.allSettled([
        fetchApi<{ data: Summary }>(`/api/crm-weekly/summary?${qs}`),
        fetchApi<{ data: { rows: DailyRow[] } }>(`/api/crm-weekly/daily?${qs}`),
        fetchApi<{ data: { weeks: TrendRow[] } }>(
          `/api/crm-weekly/trend?weeks=4&endWeekStart=${s}`
        ),
        fetchApi<{ data: { broadcasts: Broadcast[] } }>(`/api/crm-weekly/broadcasts?${qs}`),
        fetchApi<{ data: { campaigns: EmailCampaign[] } }>(
          `/api/crm-weekly/email-campaigns?${qs}`
        ),
      ])

      if (sumRes.status === 'fulfilled') setSummary(sumRes.value.data)
      if (dailyRes.status === 'fulfilled') setDaily(dailyRes.value.data.rows)
      if (trendRes.status === 'fulfilled') setTrend(trendRes.value.data.weeks)
      if (brRes.status === 'fulfilled') setBroadcasts(brRes.value.data.broadcasts)

      if (emailRes.status === 'fulfilled') {
        setEmailCampaigns(emailRes.value.data.campaigns)
      } else {
        // Email API 失敗時はメッセージだけ表示（他は出す）
        setEmailError(
          'Shopify Email キャンペーン情報の取得に失敗しました。' +
            'SHOPIFY_ADMIN_TOKEN_CRM (CRM週次レポート専用Shopifyトークン) ' +
            'が未設定の可能性があります。Cloudflare Workers の Secret に追加してください。'
        )
      }
    } catch (err: any) {
      console.error('CRM weekly fetch error:', err)
      setError(err?.message || 'データ取得に失敗しました')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchAll(appliedStart, appliedEnd)
  }, [appliedStart, appliedEnd, fetchAll])

  // クイック切替
  const setQuickRange = (kind: 'thisWeek' | 'lastWeek' | 'last2weeks') => {
    if (kind === 'lastWeek') {
      const s = lastWeekStart(3)
      const e = addDays(s, 6)
      setStart(s); setEnd(e)
      setAppliedStart(s); setAppliedEnd(e)
    } else if (kind === 'thisWeek') {
      const lastStart = lastWeekStart(3)
      const s = addDays(lastStart, 7)
      const e = addDays(s, 6)
      setStart(s); setEnd(e)
      setAppliedStart(s); setAppliedEnd(e)
    } else if (kind === 'last2weeks') {
      const s = addDays(lastWeekStart(3), -7)
      const e = addDays(lastWeekStart(3), -1)
      setStart(s); setEnd(e)
      setAppliedStart(s); setAppliedEnd(e)
    }
  }

  const handleApply = () => {
    setAppliedStart(start)
    setAppliedEnd(end)
  }

  // 表示用日付ラベル (例: 6/10(水))
  const formatDateLabel = (dateStr: string) => {
    const d = new Date(dateStr + 'T00:00:00Z')
    return `${d.getUTCMonth() + 1}/${d.getUTCDate()}(${WEEKDAY[d.getUTCDay()]})`
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Header
        title="📊 CRM週次レポート"
        description="週次の販売実績・配信実績を自動集計します"
      />
      <main className="max-w-7xl mx-auto px-4 py-6">

        {/* 期間選択 */}
        <div className="bg-white rounded-lg shadow p-4 mb-6">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <label className="text-sm font-medium text-gray-700">期間:</label>
              <input
                type="date"
                value={start}
                onChange={(e) => setStart(e.target.value)}
                className="border border-gray-300 rounded px-2 py-1 text-sm"
              />
              <span className="text-gray-500">〜</span>
              <input
                type="date"
                value={end}
                onChange={(e) => setEnd(e.target.value)}
                className="border border-gray-300 rounded px-2 py-1 text-sm"
              />
              <button
                onClick={handleApply}
                className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-3 py-1 rounded"
              >
                適用
              </button>
            </div>
            <div className="border-l border-gray-300 h-6 mx-2" />
            <div className="flex items-center gap-2">
              <button
                onClick={() => setQuickRange('thisWeek')}
                className="text-sm text-blue-600 hover:underline"
              >
                今週
              </button>
              <button
                onClick={() => setQuickRange('lastWeek')}
                className="text-sm text-blue-600 hover:underline"
              >
                先週
              </button>
              <button
                onClick={() => setQuickRange('last2weeks')}
                className="text-sm text-blue-600 hover:underline"
              >
                先々週
              </button>
            </div>
          </div>
          <p className="text-xs text-gray-500 mt-2">
            ※ 週は水曜起算（水〜火の7日間）。表示対象: {appliedStart} 〜 {appliedEnd}
          </p>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-800 p-3 rounded mb-4 text-sm">
            {error}
          </div>
        )}

        {loading && !summary ? (
          <div className="text-center text-gray-500 py-12">読み込み中...</div>
        ) : (
          <>
            {/* サマリーカード */}
            {summary && (
              <section className="mb-8">
                <h2 className="text-lg font-bold text-gray-900 mb-3">週次サマリー</h2>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <Card label="販売合計" value={yen(summary.grossSales)} />
                  <Card label="純売上" value={yen(summary.netSales)} />
                  <Card label="注文数" value={num(summary.orderCount) + '件'} />
                  <Card label="平均客単価 (AOV)" value={yen(summary.aov)} />
                  <Card label="ユニーク顧客" value={num(summary.uniqueCustomers) + '人'} />
                  <Card label="割引総額" value={yen(summary.totalDiscounts)} />
                  <Card
                    label="割引比率"
                    value={summary.discountRatio + '%'}
                    valueColor={
                      summary.discountRatio > 10
                        ? 'text-red-600'
                        : summary.discountRatio > 7
                        ? 'text-yellow-600'
                        : 'text-green-600'
                    }
                  />
                </div>
              </section>
            )}

            {/* 4週推移 */}
            {trend.length > 0 && (
              <section className="mb-8">
                <h2 className="text-lg font-bold text-gray-900 mb-3">4週推移</h2>
                <div className="bg-white rounded-lg shadow overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead className="bg-gray-100">
                      <tr>
                        <Th>期間</Th>
                        <Th right>販売合計</Th>
                        <Th right>注文数</Th>
                        <Th right>AOV</Th>
                        <Th right>割引比率</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {trend.map((w, idx) => {
                        const prev = idx > 0 ? trend[idx - 1] : null
                        const salesDelta =
                          prev && prev.grossSales > 0
                            ? ((w.grossSales / prev.grossSales - 1) * 100).toFixed(1)
                            : null
                        return (
                          <tr key={w.weekStart} className="border-t border-gray-200">
                            <Td>{w.weekStart} 〜 {w.weekEnd}</Td>
                            <Td right>
                              {yen(w.grossSales)}
                              {salesDelta !== null && (
                                <span
                                  className={`ml-2 text-xs ${
                                    Number(salesDelta) >= 0 ? 'text-green-600' : 'text-red-600'
                                  }`}
                                >
                                  ({Number(salesDelta) >= 0 ? '+' : ''}{salesDelta}%)
                                </span>
                              )}
                            </Td>
                            <Td right>{num(w.orderCount)}</Td>
                            <Td right>{yen(w.aov)}</Td>
                            <Td right>{w.discountRatio}%</Td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            {/* 日別動向 */}
            {daily.length > 0 && (
              <section className="mb-8">
                <h2 className="text-lg font-bold text-gray-900 mb-3">日別動向</h2>
                <div className="bg-white rounded-lg shadow overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead className="bg-gray-100">
                      <tr>
                        <Th>日付</Th>
                        <Th right>注文数</Th>
                        <Th right>販売合計</Th>
                        <Th right>AOV</Th>
                        <Th right>割引</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {daily.map((d) => (
                        <tr key={d.date} className="border-t border-gray-200">
                          <Td>{formatDateLabel(d.date)}</Td>
                          <Td right>{num(d.orderCount)}</Td>
                          <Td right>{yen(d.grossSales)}</Td>
                          <Td right>{yen(d.aov)}</Td>
                          <Td right>{yen(d.totalDiscounts)}</Td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            {/* LINE配信実績 */}
            <section className="mb-8">
              <h2 className="text-lg font-bold text-gray-900 mb-3">LINE配信実績</h2>
              {broadcasts.length === 0 ? (
                <div className="bg-white rounded-lg shadow p-6 text-center text-gray-500 text-sm">
                  この期間のLINE配信はありません
                </div>
              ) : (
                <div className="bg-white rounded-lg shadow overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead className="bg-gray-100">
                      <tr>
                        <Th>件名</Th>
                        <Th>配信日時</Th>
                        <Th right>配信数</Th>
                        <Th right>成功</Th>
                        <Th right>失敗</Th>
                        <Th right>成功率</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {broadcasts.map((b) => (
                        <tr key={b.id} className="border-t border-gray-200">
                          <Td>{b.title}</Td>
                          <Td>{b.sentAt?.slice(0, 16).replace('T', ' ')}</Td>
                          <Td right>{num(b.totalCount)}</Td>
                          <Td right className="text-green-700">{num(b.successCount)}</Td>
                          <Td right className={b.failedCount > 0 ? 'text-red-600' : ''}>
                            {num(b.failedCount)}
                          </Td>
                          <Td right>{b.successRate}%</Td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            {/* Shopify Email キャンペーン */}
            <section className="mb-8">
              <h2 className="text-lg font-bold text-gray-900 mb-3">Shopify Email キャンペーン</h2>
              {emailError ? (
                <div className="bg-yellow-50 border border-yellow-200 text-yellow-900 p-3 rounded text-sm">
                  {emailError}
                </div>
              ) : emailCampaigns.length === 0 ? (
                <div className="bg-white rounded-lg shadow p-6 text-center text-gray-500 text-sm">
                  この期間のEmailキャンペーンはありません
                </div>
              ) : (
                <div className="bg-white rounded-lg shadow overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead className="bg-gray-100">
                      <tr>
                        <Th>件名</Th>
                        <Th>ステータス</Th>
                        <Th>UTMキャンペーン</Th>
                        <Th>更新日</Th>
                        <Th>リンク</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {emailCampaigns.map((c) => (
                        <tr key={c.id} className="border-t border-gray-200">
                          <Td>{c.title}</Td>
                          <Td>{c.status}</Td>
                          <Td>{c.utmCampaign || '-'}</Td>
                          <Td>{c.updatedAt?.slice(0, 10)}</Td>
                          <Td>
                            {c.url && (
                              <a
                                href={c.url}
                                target="_blank"
                                rel="noreferrer"
                                className="text-blue-600 hover:underline"
                              >
                                開く
                              </a>
                            )}
                          </Td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <p className="text-xs text-gray-500 mt-2">
                ※ 開封率・CTR・売上等の詳細メトリクスは Shopify Admin API の制約上ここでは表示できません。
                各キャンペーンの「開く」リンクから Shopify 管理画面で確認してください。
              </p>
            </section>
          </>
        )}
      </main>
    </div>
  )
}

// ===== サブコンポーネント =====
function Card(props: { label: string; value: string; valueColor?: string }) {
  return (
    <div className="bg-white rounded-lg shadow p-4">
      <div className="text-xs text-gray-500 mb-1">{props.label}</div>
      <div className={`text-2xl font-bold ${props.valueColor ?? 'text-gray-900'}`}>
        {props.value}
      </div>
    </div>
  )
}

function Th(props: { children: React.ReactNode; right?: boolean }) {
  return (
    <th
      className={`px-3 py-2 text-xs font-semibold text-gray-600 ${
        props.right ? 'text-right' : 'text-left'
      }`}
    >
      {props.children}
    </th>
  )
}

function Td(props: { children: React.ReactNode; right?: boolean; className?: string }) {
  return (
    <td
      className={`px-3 py-2 ${props.right ? 'text-right' : 'text-left'} ${props.className ?? ''}`}
    >
      {props.children}
    </td>
  )
}
