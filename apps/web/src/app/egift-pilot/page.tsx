'use client'

import { useState, useEffect } from 'react'
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

export default function EgiftPilotPage() {
  const [campaigns, setCampaigns] = useState<EgiftCampaign[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [kpi, setKpi] = useState<EgiftKpi | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    api.egift.listCampaigns().then(r => {
      if (r.success) {
        setCampaigns(r.data)
        if (r.data.length > 0) setSelectedId(r.data[0].id)
      } else setError('キャンペーン取得失敗')
    }).catch(e => setError(String(e))).finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (!selectedId) return
    api.egift.getKpi(selectedId).then(r => {
      if (r.success) setKpi(r.data)
    }).catch(() => {})
  }, [selectedId])

  if (loading) return <div className="p-6">読み込み中…</div>
  if (error) return <div className="p-6 text-red-600">エラー: {error}</div>

  const campaign = campaigns.find(c => c.id === selectedId)

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

        <p className="font-semibold text-green-900 mb-1">実際に動くもの</p>
        <p className="mb-2">
          当選すると、こんなギフトリンクが発行されます（※URLは当選ごとに1つずつ生成）：
        </p>
        <div className="bg-white rounded border border-green-300 px-3 py-2 mb-3 font-mono text-xs break-all text-gray-800">
          https://oryzae-line-crm.oryzae.workers.dev/g/<span className="text-green-700 font-semibold">【ユニークなトークン】</span>
        </div>
        <p className="mb-2">
          このURLを LINE やメールで共有するだけで、受け取った人は次の3ステップでギフトを引き換えられます：
        </p>
        <ol className="list-decimal list-inside space-y-0.5 mb-2 text-xs">
          <li>リンクを開く → 商品画像＋「受け取る」ボタンが表示される</li>
          <li>「受け取る」→ LINE友だち追加を促す画面 → 友だち追加で本人確認</li>
          <li>氏名・住所を入力 → 100%OFFクーポンが自動発行 → Shopifyで¥0購入 → 通常配送</li>
        </ol>
        <p className="mb-2">
          Shopify側では<strong>対象商品に送料無料を設定＋100%OFFクーポン1枚を発行</strong>する2段構成。
          クーポンは1回限り・当選者限定のため、URLを知らない第三者が勝手に使う心配はありません。
        </p>
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

          {/* GO/STOP indicator */}
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
        </>
      ) : (
        <div className="text-gray-400">キャンペーンを選択してください</div>
      )}

      {/* Create campaign form (simple) */}
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
      <input className="border rounded px-3 py-2 text-sm" placeholder="キャンペーン名" value={name} onChange={e => setName(e.target.value)} />
      <input className="border rounded px-3 py-2 text-sm" type="date" value={startsAt} onChange={e => setStartsAt(e.target.value)} />
      <input className="border rounded px-3 py-2 text-sm" type="date" value={endsAt} onChange={e => setEndsAt(e.target.value)} />
      <input className="border rounded px-3 py-2 text-sm" type="number" value={dailyLimit} onChange={e => setDailyLimit(Number(e.target.value))} min={1} max={50} />
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
