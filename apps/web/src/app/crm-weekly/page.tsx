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

interface ManualBroadcast {
  id: string
  source: 'line_official' | 'crm_plus' | 'other' | string
  title: string
  sentAt: string
  deliveredCount: number
  openCount: number | null
  openRate: number | null
  clickCount: number | null
  clickRate: number | null
  richViewCount: number | null
  note: string | null
  createdAt: string
  updatedAt: string
}

const SOURCE_LABELS: Record<string, string> = {
  line_official: 'LINE公式Manager',
  crm_plus: 'CRM PLUS',
  other: 'その他',
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
  const [manualBroadcasts, setManualBroadcasts] = useState<ManualBroadcast[]>([])
  const [manualBroadcastError, setManualBroadcastError] = useState<string | null>(null)

  // 手動入力フォーム表示制御
  const [showManualForm, setShowManualForm] = useState(false)
  const [editingManualId, setEditingManualId] = useState<string | null>(null)
  const [manualForm, setManualForm] = useState<{
    source: string
    title: string
    sentAt: string
    deliveredCount: string
    openCount: string
    openRate: string
    clickCount: string
    clickRate: string
    richViewCount: string
    note: string
  }>({
    source: 'line_official',
    title: '',
    sentAt: '',
    deliveredCount: '',
    openCount: '',
    openRate: '',
    clickCount: '',
    clickRate: '',
    richViewCount: '',
    note: '',
  })
  const [manualSubmitting, setManualSubmitting] = useState(false)

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
      const [sumRes, dailyRes, trendRes, brRes, emailRes, manualRes] = await Promise.allSettled([
        fetchApi<{ data: Summary }>(`/api/crm-weekly/summary?${qs}`),
        fetchApi<{ data: { rows: DailyRow[] } }>(`/api/crm-weekly/daily?${qs}`),
        fetchApi<{ data: { weeks: TrendRow[] } }>(
          `/api/crm-weekly/trend?weeks=4&endWeekStart=${s}`
        ),
        fetchApi<{ data: { broadcasts: Broadcast[] } }>(`/api/crm-weekly/broadcasts?${qs}`),
        fetchApi<{ data: { campaigns: EmailCampaign[] } }>(
          `/api/crm-weekly/email-campaigns?${qs}`
        ),
        fetchApi<{ data: { manualBroadcasts: ManualBroadcast[] } }>(
          `/api/crm-weekly/manual-broadcasts?${qs}`
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
            'SHOPIFY_ADMIN_TOKEN が未設定か、スコープ不足の可能性があります。'
        )
      }

      if (manualRes.status === 'fulfilled') {
        setManualBroadcasts(manualRes.value.data.manualBroadcasts)
        setManualBroadcastError(null)
      } else {
        setManualBroadcastError(
          '手動入力配信の取得に失敗しました。テーブル未作成の可能性があります。' +
            '「初回セットアップ」ボタンを押してテーブルを作成してください。'
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

  // 手動入力フォームを開く (新規 or 編集)
  const openManualForm = (target?: ManualBroadcast) => {
    if (target) {
      setEditingManualId(target.id)
      setManualForm({
        source: target.source,
        title: target.title,
        sentAt: target.sentAt.slice(0, 16), // datetime-local 用
        deliveredCount: String(target.deliveredCount ?? ''),
        openCount: target.openCount == null ? '' : String(target.openCount),
        openRate: target.openRate == null ? '' : String(target.openRate),
        clickCount: target.clickCount == null ? '' : String(target.clickCount),
        clickRate: target.clickRate == null ? '' : String(target.clickRate),
        richViewCount: target.richViewCount == null ? '' : String(target.richViewCount),
        note: target.note ?? '',
      })
    } else {
      setEditingManualId(null)
      // デフォルトの配信日時 = 現在の期間の途中の日 + 12:00
      const mid = appliedStart
      setManualForm({
        source: 'line_official',
        title: '',
        sentAt: `${mid}T12:00`,
        deliveredCount: '',
        openCount: '',
        openRate: '',
        clickCount: '',
        clickRate: '',
        richViewCount: '',
        note: '',
      })
    }
    setShowManualForm(true)
  }

  const closeManualForm = () => {
    setShowManualForm(false)
    setEditingManualId(null)
  }

  // 手動入力配信を保存
  const submitManualForm = async () => {
    if (!manualForm.title.trim() || !manualForm.sentAt) {
      alert('件名と配信日時は必須です')
      return
    }
    setManualSubmitting(true)
    try {
      // datetime-local 形式 (YYYY-MM-DDTHH:mm) → ISO 8601 (JST)
      const sentAtIso = manualForm.sentAt.length === 16 ? manualForm.sentAt + ':00+09:00' : manualForm.sentAt
      const payload = {
        source: manualForm.source,
        title: manualForm.title.trim(),
        sentAt: sentAtIso,
        deliveredCount: manualForm.deliveredCount ? Number(manualForm.deliveredCount) : 0,
        openCount: manualForm.openCount ? Number(manualForm.openCount) : null,
        openRate: manualForm.openRate ? Number(manualForm.openRate) : null,
        clickCount: manualForm.clickCount ? Number(manualForm.clickCount) : null,
        clickRate: manualForm.clickRate ? Number(manualForm.clickRate) : null,
        richViewCount: manualForm.richViewCount ? Number(manualForm.richViewCount) : null,
        note: manualForm.note.trim() || null,
      }
      if (editingManualId) {
        await fetchApi(`/api/crm-weekly/manual-broadcasts/${editingManualId}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        })
      } else {
        await fetchApi(`/api/crm-weekly/manual-broadcasts`, {
          method: 'POST',
          body: JSON.stringify(payload),
        })
      }
      closeManualForm()
      await fetchAll(appliedStart, appliedEnd)
    } catch (err: any) {
      alert('保存に失敗しました: ' + (err?.message || ''))
    } finally {
      setManualSubmitting(false)
    }
  }

  const deleteManual = async (id: string) => {
    if (!confirm('この配信記録を削除しますか?')) return
    try {
      await fetchApi(`/api/crm-weekly/manual-broadcasts/${id}`, { method: 'DELETE' })
      await fetchAll(appliedStart, appliedEnd)
    } catch (err: any) {
      alert('削除に失敗しました: ' + (err?.message || ''))
    }
  }

  // 初回セットアップ (テーブル作成)
  const runMigration = async () => {
    if (!confirm('crm_manual_broadcasts テーブルを作成します。よろしいですか?')) return
    try {
      await fetchApi(`/api/crm-weekly/migrate-manual-broadcasts`, { method: 'POST' })
      alert('テーブル作成完了。再読み込みします。')
      await fetchAll(appliedStart, appliedEnd)
    } catch (err: any) {
      alert('セットアップに失敗しました: ' + (err?.message || ''))
    }
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

            {/* LINE配信実績 (ハーネス経由) */}
            <section className="mb-8">
              <h2 className="text-lg font-bold text-gray-900 mb-3">
                LINE配信実績 (ハーネス経由)
              </h2>
              {broadcasts.length === 0 ? (
                <div className="bg-white rounded-lg shadow p-6 text-center text-gray-500 text-sm">
                  この期間のLINEハーネス経由配信はありません
                  <div className="text-xs mt-2 text-gray-400">
                    ※ LINE公式Manager・CRM PLUS経由の配信は下の「手動入力配信」セクションで管理します
                  </div>
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

            {/* 手動入力配信 (LINE公式Manager / CRM PLUS) */}
            <section className="mb-8">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-lg font-bold text-gray-900">
                  手動入力配信 (LINE公式Manager / CRM PLUS)
                </h2>
                <div className="flex gap-2">
                  {manualBroadcastError && (
                    <button
                      onClick={runMigration}
                      className="bg-orange-500 hover:bg-orange-600 text-white text-sm font-medium px-3 py-1.5 rounded"
                    >
                      初回セットアップ
                    </button>
                  )}
                  <button
                    onClick={() => openManualForm()}
                    className="bg-green-600 hover:bg-green-700 text-white text-sm font-medium px-3 py-1.5 rounded"
                  >
                    ＋ 配信を追加
                  </button>
                </div>
              </div>

              {manualBroadcastError ? (
                <div className="bg-orange-50 border border-orange-200 text-orange-900 p-3 rounded text-sm">
                  {manualBroadcastError}
                </div>
              ) : manualBroadcasts.length === 0 ? (
                <div className="bg-white rounded-lg shadow p-6 text-center text-gray-500 text-sm">
                  この期間の手動入力配信はまだありません。「＋ 配信を追加」から登録してください。
                </div>
              ) : (
                <div className="bg-white rounded-lg shadow overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead className="bg-gray-100">
                      <tr>
                        <Th>配信元</Th>
                        <Th>件名</Th>
                        <Th>配信日時</Th>
                        <Th right>配信数</Th>
                        <Th right>開封</Th>
                        <Th right>クリック</Th>
                        <Th right>リッチ表示</Th>
                        <Th>操作</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {manualBroadcasts.map((m) => (
                        <tr key={m.id} className="border-t border-gray-200">
                          <Td>
                            <span className="inline-block px-2 py-0.5 text-xs bg-blue-100 text-blue-800 rounded">
                              {SOURCE_LABELS[m.source] ?? m.source}
                            </span>
                          </Td>
                          <Td>{m.title}</Td>
                          <Td>{m.sentAt?.slice(0, 16).replace('T', ' ')}</Td>
                          <Td right>{num(m.deliveredCount)}</Td>
                          <Td right>
                            {m.openCount != null ? num(m.openCount) : '-'}
                            {m.openRate != null && (
                              <span className="text-xs text-gray-500 ml-1">({m.openRate}%)</span>
                            )}
                          </Td>
                          <Td right>
                            {m.clickCount != null ? num(m.clickCount) : '-'}
                            {m.clickRate != null && (
                              <span className="text-xs text-gray-500 ml-1">({m.clickRate}%)</span>
                            )}
                          </Td>
                          <Td right>{m.richViewCount != null ? num(m.richViewCount) : '-'}</Td>
                          <Td>
                            <button
                              onClick={() => openManualForm(m)}
                              className="text-blue-600 hover:underline text-xs mr-2"
                            >
                              編集
                            </button>
                            <button
                              onClick={() => deleteManual(m.id)}
                              className="text-red-600 hover:underline text-xs"
                            >
                              削除
                            </button>
                          </Td>
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

        {/* 手動入力 モーダル */}
        {showManualForm && (
          <div
            className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4"
            onClick={closeManualForm}
          >
            <div
              className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="p-6">
                <h3 className="text-lg font-bold text-gray-900 mb-4">
                  {editingManualId ? '配信記録を編集' : '配信記録を追加'}
                </h3>

                <div className="space-y-4">
                  <Field label="配信元 *">
                    <select
                      value={manualForm.source}
                      onChange={(e) => setManualForm({ ...manualForm, source: e.target.value })}
                      className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
                    >
                      <option value="line_official">LINE公式Manager</option>
                      <option value="crm_plus">CRM PLUS on LINE</option>
                      <option value="other">その他</option>
                    </select>
                  </Field>

                  <Field label="件名 *">
                    <input
                      type="text"
                      value={manualForm.title}
                      onChange={(e) => setManualForm({ ...manualForm, title: e.target.value })}
                      className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
                      placeholder="例: 米麹甘酒 夏バテ予防のご案内"
                    />
                  </Field>

                  <Field label="配信日時 *">
                    <input
                      type="datetime-local"
                      value={manualForm.sentAt}
                      onChange={(e) => setManualForm({ ...manualForm, sentAt: e.target.value })}
                      className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
                    />
                  </Field>

                  <div className="grid grid-cols-2 gap-3">
                    <Field label="配信数">
                      <input
                        type="number"
                        value={manualForm.deliveredCount}
                        onChange={(e) =>
                          setManualForm({ ...manualForm, deliveredCount: e.target.value })
                        }
                        className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
                        placeholder="15154"
                      />
                    </Field>
                    <Field label="開封ユーザー数">
                      <input
                        type="number"
                        value={manualForm.openCount}
                        onChange={(e) =>
                          setManualForm({ ...manualForm, openCount: e.target.value })
                        }
                        className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
                        placeholder="7105"
                      />
                    </Field>
                    <Field label="開封率 (%)">
                      <input
                        type="number"
                        step="0.1"
                        value={manualForm.openRate}
                        onChange={(e) =>
                          setManualForm({ ...manualForm, openRate: e.target.value })
                        }
                        className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
                        placeholder="46.8"
                      />
                    </Field>
                    <Field label="クリックユーザー数">
                      <input
                        type="number"
                        value={manualForm.clickCount}
                        onChange={(e) =>
                          setManualForm({ ...manualForm, clickCount: e.target.value })
                        }
                        className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
                        placeholder="470"
                      />
                    </Field>
                    <Field label="クリック率 (%)">
                      <input
                        type="number"
                        step="0.1"
                        value={manualForm.clickRate}
                        onChange={(e) =>
                          setManualForm({ ...manualForm, clickRate: e.target.value })
                        }
                        className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
                        placeholder="3.1"
                      />
                    </Field>
                    <Field label="リッチメッセージ表示数">
                      <input
                        type="number"
                        value={manualForm.richViewCount}
                        onChange={(e) =>
                          setManualForm({ ...manualForm, richViewCount: e.target.value })
                        }
                        className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
                        placeholder="7951"
                      />
                    </Field>
                  </div>

                  <Field label="メモ">
                    <textarea
                      value={manualForm.note}
                      onChange={(e) => setManualForm({ ...manualForm, note: e.target.value })}
                      rows={2}
                      className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
                      placeholder="例: 期間限定商品の訴求、リッチメッセージ強め"
                    />
                  </Field>
                </div>

                <div className="flex justify-end gap-2 mt-6">
                  <button
                    onClick={closeManualForm}
                    className="px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded"
                  >
                    キャンセル
                  </button>
                  <button
                    onClick={submitManualForm}
                    disabled={manualSubmitting}
                    className="bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white text-sm font-medium px-4 py-2 rounded"
                  >
                    {manualSubmitting ? '保存中...' : editingManualId ? '更新' : '追加'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}

function Field(props: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-700 mb-1">{props.label}</label>
      {props.children}
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
