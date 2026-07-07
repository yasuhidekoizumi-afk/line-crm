'use client'

import { useState, useEffect, useCallback } from 'react'
import { api } from '@/lib/api'

interface EgiftCampaign {
  id: string; name: string; status: string
  startsAt: string; endsAt: string; dailyWinnerLimit: number
  totalGiftLimit: number | null; inventoryBudget: number | null
}

interface EgiftKpi {
  applications: number; winners: number; issuedGifts: number
  openedGifts: number; lineAddedGifts: number; redeemedGifts: number
  fulfilledGifts: number; firstPurchaseRecipients: number
  friendAddRate: number; redeemRate: number; firstPurchaseRate: number
  blockedRecipients: number
}

function pct(v: number) { return (v * 100).toFixed(1) + '%' }

const GIFT_URL_BASE = 'https://oryzae-line-crm.oryzae.workers.dev/g/'

function copyToClipboard(text: string) {
  navigator.clipboard.writeText(text).then(() => {
    // brief visual feedback
  }).catch(() => {
    prompt('コピーに失敗しました。手動でコピーしてください:', text)
  })
}

const STATUS_LABELS: Record<string, string> = {
  issued: '未開封', opened: '開封済', line_added: '友だち追加済',
  redeemed: '引換済', fulfilled: '発送済', expired: '期限切れ', cancelled: '取消',
}

const STATUS_COLORS: Record<string, string> = {
  issued: 'bg-gray-100 text-gray-600', opened: 'bg-blue-100 text-blue-700',
  line_added: 'bg-green-100 text-green-700', redeemed: 'bg-purple-100 text-purple-700',
  fulfilled: 'bg-emerald-100 text-emerald-700', expired: 'bg-red-100 text-red-500',
  cancelled: 'bg-gray-100 text-gray-400',
}

export default function EgiftPilotPage() {
  const [campaigns, setCampaigns] = useState<EgiftCampaign[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [kpi, setKpi] = useState<EgiftKpi | null>(null)
  const [applications, setApplications] = useState<any[]>([])
  const [gifts, setGifts] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [dryRunResult, setDryRunResult] = useState<any>(null)
  const [lotteryLoading, setLotteryLoading] = useState(false)
  const [copiedToken, setCopiedToken] = useState<string | null>(null)

  const refreshData = useCallback((id: string) => {
    api.egift.getKpi(id).then(r => { if (r.success) setKpi(r.data) }).catch(() => {})
    api.egift.listApplications(id).then(r => { if (r.success) setApplications(r.data) }).catch(() => {})
    api.egift.listGifts(id).then(r => { if (r.success) setGifts(r.data) }).catch(() => {})
  }, [])

  useEffect(() => {
    api.egift.listCampaigns().then(r => {
      if (r.success) {
        setCampaigns(r.data)
        if (r.data.length > 0) {
          setSelectedId(r.data[0].id)
          refreshData(r.data[0].id)
        }
      } else setError('キャンペーン取得失敗')
    }).catch(e => setError(String(e))).finally(() => setLoading(false))
  }, [refreshData])

  useEffect(() => {
    if (!selectedId) return
    refreshData(selectedId)
    setDryRunResult(null)
  }, [selectedId, refreshData])

  if (loading) return <div className="p-6">読み込み中…</div>
  if (error) return <div className="p-6 text-red-600">エラー: {error}</div>

  const campaign = campaigns.find(c => c.id === selectedId)
  const todayApplications = applications.filter((a: any) => a.status === 'applied')

  return (
    <div className="p-6 max-w-4xl">
      <h1 className="text-2xl font-bold mb-2">🎁 eGift パイロット</h1>

      {/* 機能説明 */}
      <div className="mb-6 bg-green-50 border border-green-200 rounded-lg p-4 text-sm leading-relaxed text-gray-700">
        <p className="font-semibold text-green-900 mb-1">この機能でできること</p>
        <p className="mb-3">
          既存のお客さま（LINE友だち・購入者）を<strong>贈り主</strong>として抽選で選び、
          友人・家族に ORYZAE のギフト（米麹ミニグラノーラ3種セット）を無料で贈ってもらいます。
          受贈者は LINE友だち追加 → 100%OFFクーポンで引換 → 初回購入へ、という流れです。
        </p>

        <p className="font-semibold text-green-900 mb-1">使い方</p>
        <ol className="list-decimal list-inside space-y-0.5 mb-3 text-xs">
          <li>キャンペーンを作成 → ステータスを「active」に変更</li>
          <li>LINEで贈り主を募集 → 応募が集まる（下の「応募者一覧」で確認）</li>
          <li>「抽選」セクションで dry-run → 確定したら「抽選を実行」</li>
          <li>「発行済ギフト一覧」から URL をコピー → 贈り主に LINE で送信</li>
          <li>贈り主が友人にリンクを共有 → 受け取った人が LINE 友だち追加 → 引換</li>
        </ol>
        <p className="text-xs text-gray-500">
          🎯 KGI：受贈者の初回購入転換　／　必須KPI：受贈者のLINE友だち化　／　期間：2026-07-21〜08-17（4週間）
        </p>
      </div>

      {/* Campaign selector */}
      <div className="mb-6 flex gap-2 items-center">
        <select
          value={selectedId ?? ''}
          onChange={e => setSelectedId(e.target.value)}
          className="border rounded px-3 py-2 text-sm bg-white"
        >
          {campaigns.map(c => (
            <option key={c.id} value={c.id}>{c.name} ({c.status})</option>
          ))}
        </select>
        {campaign && (
          <span className="text-xs text-gray-500">
            {campaign.startsAt.slice(0, 10)} 〜 {campaign.endsAt.slice(0, 10)}
            &nbsp;|&nbsp; 1日{campaign.dailyWinnerLimit}名
          </span>
        )}
      </div>

      {/* KPI */}
      {kpi ? (
        <>
          <div className="grid grid-cols-3 gap-4 mb-8">
            <KpiCard label="応募数" value={kpi.applications} />
            <KpiCard label="当選数" value={kpi.winners} />
            <KpiCard label="発行済ギフト" value={kpi.issuedGifts} />
          </div>

          <h2 className="text-lg font-semibold mb-3">ファネル</h2>
          <div className="grid grid-cols-4 gap-3 mb-8">
            <KpiCard label="開封" value={kpi.openedGifts} />
            <KpiCard label="LINE友だち化" value={kpi.lineAddedGifts} sub={`${pct(kpi.friendAddRate)}`} highlight />
            <KpiCard label="引換完了" value={kpi.redeemedGifts} sub={`${pct(kpi.redeemRate)}`} />
            <KpiCard label="発送完了" value={kpi.fulfilledGifts} />
          </div>

          <h2 className="text-lg font-semibold mb-3">🎯 KGI: 初回購入</h2>
          <div className="grid grid-cols-2 gap-4 mb-8">
            <KpiCard
              label="初回購入者"
              value={kpi.firstPurchaseRecipients}
              sub={`初回購入率 ${pct(kpi.firstPurchaseRate)}`}
              highlight
            />
            <KpiCard label="ブロック" value={kpi.blockedRecipients} warn />
          </div>

          {/* GO/STOP */}
          <div className="bg-gray-50 rounded-lg p-4 mb-6">
            <h3 className="font-semibold mb-2">経営判断メモ</h3>
            <table className="text-sm w-full">
              <tbody>
                <tr><td className="py-1 text-gray-500 w-40">友だち化率</td>
                  <td className={kpi.friendAddRate >= 0.6 ? 'text-green-700 font-semibold' : 'text-red-600'}>
                    {pct(kpi.friendAddRate)} {kpi.friendAddRate >= 0.6 ? '✅' : '❌'}（目標60%）
                  </td>
                </tr>
                <tr><td className="py-1 text-gray-500">初回購入率</td>
                  <td className={kpi.firstPurchaseRate >= 0.15 ? 'text-green-700 font-semibold' : 'text-red-600'}>
                    {pct(kpi.firstPurchaseRate)} {kpi.firstPurchaseRate >= 0.15 ? '✅' : '❌'}（目標15%）
                  </td>
                </tr>
                <tr><td className="py-1 text-gray-500">ブロック率</td>
                  <td className={kpi.blockedRecipients === 0 ? 'text-green-700' : 'text-yellow-600'}>
                    {kpi.blockedRecipients}人
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* =========================================================== */}
          {/* 応募者一覧 */}
          {/* =========================================================== */}
          <h2 className="text-lg font-semibold mb-3">📋 応募者一覧
            <span className="text-sm font-normal text-gray-500 ml-2">
              ({todayApplications.length}名が抽選待ち / 全{applications.length}名)
            </span>
          </h2>
          {applications.length > 0 ? (
            <div className="mb-8 max-h-64 overflow-y-auto border rounded">
              <table className="text-sm w-full">
                <thead className="bg-gray-50 sticky top-0">
                  <tr>
                    <th className="text-left px-3 py-2 border-b">贈り主</th>
                    <th className="text-left px-3 py-2 border-b">状態</th>
                    <th className="text-left px-3 py-2 border-b">応募日</th>
                    <th className="text-left px-3 py-2 border-b">メッセージ</th>
                  </tr>
                </thead>
                <tbody>
                  {applications.map((a: any) => (
                    <tr key={a.id} className="border-b">
                      <td className="px-3 py-2">{a.giver_display_name || '(未設定)'}</td>
                      <td className="px-3 py-2">
                        <span className={`text-xs px-2 py-0.5 rounded ${
                          a.status === 'applied' ? 'bg-blue-100 text-blue-700' :
                          a.status === 'won' ? 'bg-green-100 text-green-700' :
                          a.status === 'lost' ? 'bg-gray-100 text-gray-500' :
                          'bg-yellow-100 text-yellow-700'
                        }`}>
                          {a.status === 'applied' ? '抽選待ち' :
                           a.status === 'won' ? '当選' :
                           a.status === 'lost' ? '落選' : a.status}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-xs text-gray-500">{a.applied_at?.slice(0, 10)}</td>
                      <td className="px-3 py-2 text-xs text-gray-500 max-w-xs truncate">{a.message || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-gray-400 mb-8">まだ応募がありません</p>
          )}

          {/* =========================================================== */}
          {/* 抽選 */}
          {/* =========================================================== */}
          <h2 className="text-lg font-semibold mb-3">🎰 抽選</h2>
          <div className="mb-8 border rounded-lg p-4">
            <p className="text-sm text-gray-600 mb-3">
              今日の応募者から {campaign?.dailyWinnerLimit ?? 10} 名を抽選します。
              ランクが高いほど当選確率が上がります（重み付き抽選）。
            </p>
            <div className="flex gap-2">
              <button
                className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
                disabled={lotteryLoading}
                onClick={async () => {
                  if (!selectedId) return
                  setLotteryLoading(true)
                  setDryRunResult(null)
                  try {
                    const r = await api.egift.lotteryDryRun(selectedId)
                    if (r.success) setDryRunResult(r.data)
                    else alert('プレビュー失敗: ' + r.error)
                  } finally { setLotteryLoading(false) }
                }}
              >プレビュー</button>
              <button
                className="px-4 py-2 text-sm bg-green-700 text-white rounded hover:bg-green-800 disabled:opacity-50"
                disabled={lotteryLoading}
                onClick={async () => {
                  if (!selectedId) return
                  if (!confirm('抽選を実行します。この操作は取り消せません。よろしいですか？')) return
                  setLotteryLoading(true)
                  try {
                    const r = await api.egift.lotteryCommit(selectedId)
                    if (r.success) {
                      alert(`${r.data.winnersCount}名に当選ギフトを発行しました。ギフト一覧からURLを確認できます。`)
                      refreshData(selectedId)
                      setDryRunResult(null)
                    } else alert('抽選失敗: ' + r.error)
                  } finally { setLotteryLoading(false) }
                }}
              >
                {lotteryLoading ? '処理中…' : '抽選を実行'}
              </button>
            </div>

            {dryRunResult && (
              <div className="mt-4 bg-blue-50 rounded p-3 text-sm">
                <p className="font-semibold text-blue-900 mb-2">
                  プレビュー: {dryRunResult.eligibleApplications}名の応募者から {dryRunResult.previewWinners.length}名が当選候補
                </p>
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-gray-500">
                      <th className="py-1">名前</th>
                      <th className="py-1">ランク</th>
                      <th className="py-1">重み</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dryRunResult.previewWinners.map((w: any, i: number) => (
                      <tr key={i} className="border-t">
                        <td className="py-1">{w.giverDisplayName || '(未設定)'}</td>
                        <td className="py-1">{w.rank}</td>
                        <td className="py-1">{w.lotteryWeight}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="text-xs text-gray-400 mt-2">※ プレビュー結果は実際の抽選結果と異なる場合があります</p>
              </div>
            )}
          </div>

          {/* =========================================================== */}
          {/* 発行済ギフト一覧 */}
          {/* =========================================================== */}
          <h2 className="text-lg font-semibold mb-3">🎁 発行済ギフト一覧 ({gifts.length}件)</h2>
          {gifts.length > 0 ? (
            <div className="mb-8 max-h-96 overflow-y-auto border rounded">
              <table className="text-sm w-full">
                <thead className="bg-gray-50 sticky top-0">
                  <tr>
                    <th className="text-left px-3 py-2 border-b">贈り主</th>
                    <th className="text-left px-3 py-2 border-b">状態</th>
                    <th className="text-left px-3 py-2 border-b">URL</th>
                    <th className="text-left px-3 py-2 border-b">発行日</th>
                  </tr>
                </thead>
                <tbody>
                  {gifts.map((g: any) => (
                    <tr key={g.id} className="border-b hover:bg-gray-50">
                      <td className="px-3 py-2">{g.giver_display_name || '(未設定)'}</td>
                      <td className="px-3 py-2">
                        <span className={`text-xs px-2 py-0.5 rounded ${STATUS_COLORS[g.status] || ''}`}>
                          {STATUS_LABELS[g.status] || g.status}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        {g.giftUrl ? (
                          <div className="flex items-center gap-1">
                            <span className="font-mono text-xs text-gray-600 truncate max-w-[280px]" title={g.giftUrl}>
                              {GIFT_URL_BASE + (g.gift_token || '').slice(0, 8)}...
                            </span>
                            <button
                              className="text-xs px-2 py-0.5 bg-gray-100 hover:bg-gray-200 rounded text-gray-600 whitespace-nowrap"
                              onClick={() => {
                                copyToClipboard(g.giftUrl)
                                setCopiedToken(g.gift_token)
                                setTimeout(() => setCopiedToken(null), 1500)
                              }}
                            >
                              {copiedToken === g.gift_token ? '✅' : '📋'}
                            </button>
                          </div>
                        ) : (
                          <span className="text-xs text-gray-400">（旧データのためURL再発行不可）</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-xs text-gray-500">{g.issued_at?.slice(0, 10)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-gray-400 mb-8">まだギフトは発行されていません。抽選を実行するとここに表示されます。</p>
          )}
        </>
      ) : (
        <div className="text-gray-400">キャンペーンを選択してください</div>
      )}

      {/* キャンペーン一覧 */}
      {campaigns.length > 0 && (
        <div className="mt-8">
          <h2 className="text-lg font-semibold mb-3">キャンペーン一覧</h2>
          <table className="text-sm w-full border">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left px-3 py-2 border-b">名前</th>
                <th className="text-left px-3 py-2 border-b">状態</th>
                <th className="text-left px-3 py-2 border-b">期間</th>
                <th className="text-right px-3 py-2 border-b w-16"></th>
              </tr>
            </thead>
            <tbody>
              {campaigns.map(c => (
                <tr key={c.id} className="border-b hover:bg-gray-50">
                  <td className="px-3 py-2">{c.name}</td>
                  <td className="px-3 py-2">
                    <span className={`text-xs px-2 py-0.5 rounded ${
                      c.status === 'active' ? 'bg-green-100 text-green-800' :
                      c.status === 'draft' ? 'bg-gray-100 text-gray-600' :
                      'bg-yellow-100 text-yellow-800'
                    }`}>{c.status}</span>
                  </td>
                  <td className="px-3 py-2 text-xs text-gray-500">{c.startsAt.slice(0, 10)} 〜 {c.endsAt.slice(0, 10)}</td>
                  <td className="px-3 py-2 text-right">
                    <button
                      className="text-xs text-red-500 hover:text-red-700 hover:underline disabled:text-gray-300 disabled:no-underline"
                      disabled={c.status === 'active'}
                      title={c.status === 'active' ? '実行中は削除不可' : '削除'}
                      onClick={async () => {
                        if (!confirm(`${c.name} を削除します。この操作は取り消せません。`)) return;
                        const r = await api.egift.deleteCampaign(c.id);
                        if (r.success) {
                          setCampaigns(prev => prev.filter(x => x.id !== c.id));
                          if (selectedId === c.id) { setSelectedId(null); setKpi(null); }
                        } else {
                          alert('削除失敗: ' + (r.error || '不明なエラー'));
                        }
                      }}
                    >
                      {c.status === 'active' ? '—' : '削除'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Create campaign form */}
      <details className="mt-8 border rounded-lg p-4">
        <summary className="cursor-pointer font-semibold text-sm text-gray-600">＋ キャンペーンを新規作成</summary>
        <CreateCampaignForm onCreated={(c) => {
          setCampaigns(prev => [...prev, c])
          setSelectedId(c.id)
        }} />
      </details>
    </div>
  )
}

function KpiCard({ label, value, sub, highlight, warn }: {
  label: string; value: number; sub?: string; highlight?: boolean; warn?: boolean
}) {
  return (
    <div className={`rounded-lg border p-4 ${highlight ? 'border-green-300 bg-green-50' : warn ? 'border-yellow-300 bg-yellow-50' : 'bg-white'}`}>
      <div className="text-xs text-gray-500 mb-1">{label}</div>
      <div className={`text-2xl font-bold ${warn ? 'text-yellow-700' : highlight ? 'text-green-800' : 'text-gray-800'}`}>
        {value.toLocaleString()}
      </div>
      {sub && <div className="text-xs text-gray-500 mt-1">{sub}</div>}
    </div>
  )
}

function CreateCampaignForm({ onCreated }: { onCreated: (c: EgiftCampaign) => void }) {
  const [name, setName] = useState('')
  const [startsAt, setStartsAt] = useState('')
  const [endsAt, setEndsAt] = useState('')
  const [dailyLimit, setDailyLimit] = useState(10)
  const [saving, setSaving] = useState(false)

  const handleCreate = async () => {
    if (!name || !startsAt || !endsAt) return alert('必須項目を入力してください')
    setSaving(true)
    try {
      const r = await api.egift.createCampaign({
        name,
        startsAt: startsAt + 'T00:00:00+09:00',
        endsAt: endsAt + 'T23:59:59+09:00',
        dailyWinnerLimit: dailyLimit,
      })
      if (r.success) onCreated(r.data)
      else alert('作成失敗: ' + r.error)
    } finally { setSaving(false) }
  }

  return (
    <div className="grid grid-cols-2 gap-3 mt-4">
      <div>
        <label className="text-xs text-gray-500 mb-1 block">キャンペーン名</label>
        <input className="border rounded px-3 py-2 text-sm w-full" placeholder="例: eGiftパイロット 2026夏" value={name} onChange={e => setName(e.target.value)} />
      </div>
      <div>
        <label className="text-xs text-gray-500 mb-1 block">1日あたり当選数</label>
        <input className="border rounded px-3 py-2 text-sm w-full" type="number" value={dailyLimit} onChange={e => setDailyLimit(Number(e.target.value))} min={1} max={50} />
      </div>
      <div>
        <label className="text-xs text-gray-500 mb-1 block">キャンペーン開始日</label>
        <input className="border rounded px-3 py-2 text-sm w-full" type="date" value={startsAt} onChange={e => setStartsAt(e.target.value)} />
        <p className="text-xs text-gray-400 mt-0.5">応募受付・抽選の開始日</p>
      </div>
      <div>
        <label className="text-xs text-gray-500 mb-1 block">キャンペーン終了日</label>
        <input className="border rounded px-3 py-2 text-sm w-full" type="date" value={endsAt} onChange={e => setEndsAt(e.target.value)} />
        <p className="text-xs text-gray-400 mt-0.5">最終抽選日（この日を含む）</p>
      </div>
      {startsAt && endsAt && (
        <div className="col-span-2 bg-blue-50 border border-blue-200 rounded p-3 text-sm">
          <p className="text-blue-900">
            📅 <strong>{(() => {
              const s = new Date(startsAt + 'T00:00:00+09:00');
              const e = new Date(endsAt + 'T23:59:59+09:00');
              const days = Math.max(1, Math.floor((e.getTime() - s.getTime()) / 86400000) + 1);
              return `${days}日間`;
            })()}</strong>のキャンペーンです。
            期間中、毎日 <strong>{dailyLimit}名</strong> を抽選します。
          </p>
          <p className="text-blue-700 text-xs mt-1">
            💡 このフォームは1回だけ作成すればOK。あとは毎日「抽選を実行」ボタンを押すだけです。
          </p>
        </div>
      )}
      <button
        className="col-span-2 bg-green-700 text-white rounded px-4 py-2 text-sm font-semibold disabled:opacity-50"
        disabled={saving}
        onClick={handleCreate}
      >
        {saving ? '作成中…' : 'キャンペーンを作成'}
      </button>
    </div>
  )
}
