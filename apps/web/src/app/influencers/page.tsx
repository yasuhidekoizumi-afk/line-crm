'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import * as XLSX from 'xlsx'
import { useAccount } from '@/contexts/account-context'
import { fetchApi } from '@/lib/api'

type Address = {
  recipientName: string | null
  postalCode: string | null
  prefecture: string | null
  addressLine1: string | null
  addressLine2: string | null
  phone: string | null
  confirmedAt: string | null
}
type Influencer = {
  friendId: string
  displayName: string | null
  instagramHandle: string | null
  categories: string[]
  followerBand: string | null
  contactEmail: string | null
  contactPhone: string | null
  ageGroup: string | null
  gender: string | null
  giftingInterests: string[]
  dietaryNotes: string | null
  hasShopifyPurchase: boolean
  isFollowing: boolean
  profileCompletedAt: string | null
  address: Address | null
  registrationSource: 'line' | 'manual'
  contactMethod: 'line' | 'instagram_dm'
}
type GiftingLog = {
  id: string
  friendId: string
  creatorName: string | null
  instagramHandle: string | null
  productName: string
  campaignName: string | null
  shipmentStatus: string
  productPageUrl: string | null
  status: string
  requestedAt: string | null
  shippedAt: string | null
  postPublishedAt: string | null
  postType: string | null
  postUrl: string | null
  reach: number | null
  impressions: number | null
  likes: number | null
  comments: number | null
  saves: number | null
  effectNotes: string | null
}

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <dt className="text-xs font-medium tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-1 break-words text-sm font-medium text-slate-900">{value || '—'}</dd>
    </div>
  )
}

function downloadInfluencers(items: Influencer[]) {
  const rows = items.map((item) => ({
    表示名: item.displayName || '',
    Instagramアカウント: item.instagramHandle || '',
    連絡手段: item.contactMethod === 'instagram_dm' ? 'Instagram DM' : 'LINE',
    発信ジャンル: item.categories.join('・'),
    フォロワー数: item.followerBand || '',
    メールアドレス: item.contactEmail || '',
    連絡先電話番号: item.contactPhone || '',
    年代: item.ageGroup || '',
    性別: item.gender || '',
    公式ショップ購入経験: item.hasShopifyPurchase ? 'あり' : 'なし',
    興味のあるギフティング: item.giftingInterests.join('・'),
    'アレルギー・避けたい食材': item.dietaryNotes || '',
    配送先お名前: item.address?.recipientName || '',
    郵便番号: item.address?.postalCode || '',
    都道府県: item.address?.prefecture || '',
    '市区町村・町名・番地': item.address?.addressLine1 || '',
    '建物名・部屋番号': item.address?.addressLine2 || '',
    配送先電話番号: item.address?.phone || '',
    プロフィール登録日時: item.profileCompletedAt || '',
  }))
  const sheet = XLSX.utils.json_to_sheet(rows)
  sheet['!cols'] = [14, 24, 24, 16, 30, 18, 10, 10, 18, 26, 32, 18, 12, 12, 32, 24, 18, 24].map((wch) => ({ wch }))
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, sheet, 'インフルエンサー一覧')
  XLSX.writeFile(workbook, `インフルエンサー登録情報_${new Date().toISOString().slice(0, 10)}.xlsx`)
}

const statusLabels: Record<string, string> = {
  requested: '依頼済み',
  accepted: '承諾',
  shipped: '発送済み',
  posted: '投稿済み',
  declined: '辞退',
  cancelled: '中止',
}
const blankLog = {
  friendId: '',
  productName: '',
  campaignName: '',
  shipmentStatus: 'pending',
  productPageUrl: '',
  status: 'requested',
  requestedAt: '',
  shippedAt: '',
  postPublishedAt: '',
  postType: 'Instagram',
  postUrl: '',
  reach: '',
  impressions: '',
  likes: '',
  comments: '',
  saves: '',
  effectNotes: '',
}

function GiftingHistory({ lineAccountId }: { lineAccountId: string }) {
  const [creators, setCreators] = useState<Influencer[]>([])
  const [search, setSearch] = useState('')
  const [campaign, setCampaign] = useState('')
  const [shipment, setShipment] = useState('')
  const [updatingId, setUpdatingId] = useState<string | null>(null)
  const [loadingLogs, setLoadingLogs] = useState(true)
  const [logs, setLogs] = useState<GiftingLog[]>([])
  const [form, setForm] = useState<any>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const load = async () => {
    setLoadingLogs(true)
    setError('')
    try {
      const res = await fetchApi<{ success: boolean; data: GiftingLog[] }>(`/api/influencer-gifting?lineAccountId=${encodeURIComponent(lineAccountId)}`)
      if (!res.success) throw new Error()
      setLogs(res.data || [])
    } catch { setError('履歴を取得できませんでした。再読み込みしてください。') }
    finally { setLoadingLogs(false) }
  }
  useEffect(() => {
    load()
    fetchApi<{ success: boolean; data: Influencer[] }>(`/api/influencers?lineAccountId=${encodeURIComponent(lineAccountId)}`)
      .then((res) => setCreators(res.data || []))
      .catch(() => setError('クリエイター一覧を取得できませんでした。'))
  }, [lineAccountId])
  const campaigns = [...new Set(logs.map((log) => log.campaignName).filter((name): name is string => Boolean(name)))].sort()
  const visibleLogs = logs.filter((log) => {
    const matchesCampaign = !campaign || (campaign === '__unassigned' ? !log.campaignName : log.campaignName === campaign)
    const matchesShipment = !shipment || (shipment === 'action' ? ['pending', 'unknown'].includes(log.shipmentStatus) && !['declined', 'cancelled'].includes(log.status) : log.shipmentStatus === shipment)
    return matchesCampaign && matchesShipment && [log.creatorName, log.instagramHandle, log.productName, log.campaignName].some((value) => value?.toLowerCase().includes(search.trim().toLowerCase()))
  })
  const updateShipment = async (log: GiftingLog, shipmentStatus: string) => {
    setUpdatingId(log.id); setError('')
    try {
      const res = await fetchApi<{ success: boolean; data: GiftingLog }>(`/api/influencer-gifting/${log.id}/shipment`, { method: 'PATCH', body: JSON.stringify({ shipmentStatus }) })
      if (!res.success) throw new Error()
      setLogs((current) => current.map((item) => item.id === log.id ? res.data : item))
    } catch { setError('送付状況を保存できませんでした。チェックは変更していません。') }
    finally { setUpdatingId(null) }
  }
  const save = async () => {
    if (!form.friendId || !form.productName.trim() || !form.campaignName.trim()) {
      setError('クリエイター・募集案件名・商品名を入力してください。')
      return
    }
    setSaving(true)
    setError('')
    try {
      const numeric = ['reach', 'impressions', 'likes', 'comments', 'saves']
      const body: any = { ...form, lineAccountId }
      numeric.forEach((key) => {
        body[key] = form[key] === '' ? null : Number(form[key])
      })
      ;['requestedAt', 'shippedAt', 'postPublishedAt'].forEach((key) => {
        if (!body[key]) body[key] = null
      })
      const res = await fetchApi<{ success: boolean }>(form.id ? `/api/influencer-gifting/${form.id}` : '/api/influencer-gifting', { method: form.id ? 'PATCH' : 'POST', body: JSON.stringify(body) })
      if (!res.success) throw new Error()
      setForm(null)
      load()
    } catch {
      setError('保存できませんでした。入力内容を確認してください。')
    } finally {
      setSaving(false)
    }
  }
  return (
    <section className="mt-5 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-100 bg-emerald-50 px-5 py-4">
        <div>
          <p className="text-xs font-semibold tracking-widest text-emerald-700">GIFTING LEDGER</p>
          <h2 className="mt-1 text-lg font-bold">募集案件・送付管理</h2>
          <p className="mt-1 text-sm text-slate-600">過去に募集した案件も登録できます。案件とクリエイターごとに、商品送付・投稿を記録します。</p>
        </div>
        <button disabled={updatingId !== null || saving} onClick={() => setForm({ ...blankLog })} className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-800">
          案件への参加を記録
        </button>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {form && (
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="font-bold">{form.id ? 'ギフティング記録を更新' : '新しい案件への参加を記録'}</h3>
            <button disabled={saving} onClick={() => setForm(null)} className="text-sm text-slate-500">
              閉じる
            </button>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <label className="text-sm font-medium">
              クリエイター
              <select disabled={Boolean(form.id)} value={form.friendId} onChange={(e) => setForm({ ...form, friendId: e.target.value })} className="mt-1 w-full rounded-lg border p-2">
                <option value="">選択してください</option>
                {creators.map((creator) => (
                  <option key={creator.friendId} value={creator.friendId}>
                    {creator.displayName || '名称未登録'} {creator.instagramHandle ? `(${creator.instagramHandle})` : ''}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm font-medium">
              募集案件名（必須）
              <input list="gifting-campaigns" maxLength={160} value={form.campaignName} onChange={(e) => setForm({ ...form, campaignName: e.target.value })} placeholder="例：2026年9月 秋のグラノーラ募集" className="mt-1 w-full rounded-lg border p-2" />
              <datalist id="gifting-campaigns">{campaigns.map((name) => <option key={name} value={name} />)}</datalist>
            </label>
            <label className="text-sm font-medium">
              送付状況
              <select value={form.shipmentStatus} onChange={(e) => setForm({ ...form, shipmentStatus: e.target.value, shippedAt: e.target.value === 'shipped' ? form.shippedAt : '', status: e.target.value !== 'shipped' && form.status === 'shipped' ? 'accepted' : form.status })} className="mt-1 w-full rounded-lg border p-2">
                <option value="unknown">要確認</option><option value="pending">未送付</option><option value="shipped">送付済み</option>
              </select>
            </label>
            <label className="text-sm font-medium">
              商品名
              <input value={form.productName} onChange={(e) => setForm({ ...form, productName: e.target.value })} className="mt-1 w-full rounded-lg border p-2" />
            </label>
            <label className="text-sm font-medium">
              商品ページURL
              <input value={form.productPageUrl} onChange={(e) => setForm({ ...form, productPageUrl: e.target.value })} className="mt-1 w-full rounded-lg border p-2" />
            </label>
            <label className="text-sm font-medium">
              進行状況
              <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value, shipmentStatus: e.target.value === 'shipped' ? 'shipped' : form.shipmentStatus })} className="mt-1 w-full rounded-lg border p-2">
                {Object.entries(statusLabels).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm font-medium">
              依頼日
              <input type="date" value={form.requestedAt} onChange={(e) => setForm({ ...form, requestedAt: e.target.value })} className="mt-1 w-full rounded-lg border p-2" />
            </label>
            <label className="text-sm font-medium">
              発送日（実際の日付が分かる場合）
              <input type="date" value={form.shippedAt} onChange={(e) => setForm({ ...form, shippedAt: e.target.value, shipmentStatus: e.target.value ? 'shipped' : form.shipmentStatus })} className="mt-1 w-full rounded-lg border p-2" />
            </label>
            <label className="text-sm font-medium">
              投稿日
              <input type="date" value={form.postPublishedAt} onChange={(e) => setForm({ ...form, postPublishedAt: e.target.value })} className="mt-1 w-full rounded-lg border p-2" />
            </label>
            <label className="text-sm font-medium">
              投稿URL
              <input value={form.postUrl} onChange={(e) => setForm({ ...form, postUrl: e.target.value })} className="mt-1 w-full rounded-lg border p-2" />
            </label>
            <label className="text-sm font-medium">
              リーチ
              <input type="number" min="0" value={form.reach} onChange={(e) => setForm({ ...form, reach: e.target.value })} className="mt-1 w-full rounded-lg border p-2" />
            </label>
            <label className="text-sm font-medium">
              いいね数
              <input type="number" min="0" value={form.likes} onChange={(e) => setForm({ ...form, likes: e.target.value })} className="mt-1 w-full rounded-lg border p-2" />
            </label>
            <label className="text-sm font-medium md:col-span-2">
              効果メモ
              <textarea value={form.effectNotes} onChange={(e) => setForm({ ...form, effectNotes: e.target.value })} className="mt-1 w-full rounded-lg border p-2" rows={2} placeholder="反応、クーポン利用、次回依頼の判断など" />
            </label>
          </div>
          <button onClick={save} disabled={saving} className="mt-5 rounded-lg bg-emerald-700 px-5 py-2.5 text-sm font-bold text-white disabled:opacity-50">
            {saving ? '保存中…' : '記録を保存'}
          </button>
        </div>
      )}
      <div className="space-y-3 rounded-xl border bg-white p-4">
        <div className="flex flex-wrap gap-3">
          <input aria-label="案件・クリエイター検索" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="名前・Instagram・案件・商品で検索" className="min-w-64 flex-1 rounded-lg border px-3 py-2 text-sm" />
          <select aria-label="募集案件で絞り込み" value={campaign} onChange={(e) => setCampaign(e.target.value)} className="max-w-full rounded-lg border px-3 py-2 text-sm"><option value="">すべての募集案件</option><option value="__unassigned">案件名未登録</option>{campaigns.map((name) => <option key={name} value={name}>{name}</option>)}</select>
          <select aria-label="送付状況で絞り込み" value={shipment} onChange={(e) => setShipment(e.target.value)} className="rounded-lg border px-3 py-2 text-sm"><option value="">すべての送付状況</option><option value="action">未送付・要確認（辞退・中止を除く）</option><option value="pending">未送付</option><option value="unknown">要確認</option><option value="shipped">送付済み</option></select>
        </div>
        <p className="text-xs text-slate-500">{visibleLogs.length} / {logs.length} 件。送付の記録がない過去案件は「要確認」です。送付済みにチェックし、実際の発送日は「編集」から記録してください。</p>
        <button onClick={load} disabled={loadingLogs || updatingId !== null || saving} className="text-sm text-emerald-700">{loadingLogs ? '読み込み中…' : '履歴を再読み込み'}</button>
      </div>
      <div className="overflow-x-auto rounded-xl border bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-slate-500">
            <tr>
              <th className="p-3">クリエイター</th>
              <th className="p-3">募集案件・商品</th>
              <th className="p-3">送付チェック・発送日</th>
              <th className="p-3">進行状況</th>
              <th className="p-3">投稿日</th>
              <th className="p-3">投稿・効果</th>
              <th className="p-3"></th>
            </tr>
          </thead>
          <tbody>
            {visibleLogs.map((log) => (
              <tr key={log.id} className="border-t">
                <td className="p-3 font-medium">
                  {log.creatorName || '名称未登録'}
                  <div className="text-xs text-slate-500">{log.instagramHandle || ''}</div>
                </td>
                <td className="p-3">
                  <div className="mb-1 font-semibold">{log.campaignName || '案件名未登録'}</div>
                  <div className="mb-1 text-xs text-slate-500">依頼日：{log.requestedAt || '未登録'}</div>
                  {log.productPageUrl ? (
                    <a href={log.productPageUrl} target="_blank" rel="noreferrer" className="text-emerald-700 underline">
                      {log.productName}
                    </a>
                  ) : (
                    log.productName
                  )}
                </td>
                <td className="p-3">
                  <label className="flex items-center gap-2 whitespace-nowrap">
                    <input type="checkbox" checked={log.shipmentStatus === 'shipped'} disabled={updatingId !== null || Boolean(form) || loadingLogs} onChange={(e) => updateShipment(log, e.target.checked ? 'shipped' : 'pending')} aria-label={`${log.creatorName || '名称未登録'}・${log.campaignName || log.productName}の送付済み`} className="h-4 w-4 accent-emerald-700" />
                    {log.shipmentStatus === 'shipped' ? '送付済み' : log.shipmentStatus === 'pending' ? '未送付' : '要確認'}
                  </label>
                  <div className="mt-1 text-xs text-slate-500">{log.shippedAt || (log.shipmentStatus === 'shipped' ? '発送日未登録' : '—')}</div>
                  {log.shipmentStatus === 'unknown' && <button disabled={updatingId !== null || Boolean(form) || loadingLogs} onClick={() => updateShipment(log, 'pending')} className="mt-1 text-xs text-amber-800 underline disabled:opacity-50">未送付と確認</button>}
                </td>
                <td className="p-3">{statusLabels[log.status] || log.status}</td>
                <td className="p-3">{log.postPublishedAt || '—'}</td>
                <td className="p-3">
                  {log.postUrl ? (
                    <a href={log.postUrl} target="_blank" rel="noreferrer" className="text-emerald-700 underline">
                      投稿を見る
                    </a>
                  ) : (
                    '—'
                  )}
                  {log.reach !== null && <div className="mt-1 text-xs text-slate-500">リーチ {log.reach.toLocaleString()}</div>}
                </td>
                <td className="p-3">
                  <button
                    disabled={updatingId !== null || saving || loadingLogs}
                    onClick={() =>
                      setForm({
                        ...blankLog,
                        ...log,
                        campaignName: log.campaignName || '',
                        productPageUrl: log.productPageUrl || '',
                        requestedAt: log.requestedAt || '',
                        shippedAt: log.shippedAt || '',
                        postPublishedAt: log.postPublishedAt || '',
                        postType: log.postType || '',
                        postUrl: log.postUrl || '',
                        reach: log.reach ?? '',
                        impressions: log.impressions ?? '',
                        likes: log.likes ?? '',
                        comments: log.comments ?? '',
                        saves: log.saves ?? '',
                        effectNotes: log.effectNotes || '',
                      })
                    }
                    className="text-sm text-emerald-700"
                  >
                    編集
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!loadingLogs && logs.length > 0 && !visibleLogs.length && <p className="p-8 text-center text-slate-500">条件に一致する案件はありません。</p>}
        {!loadingLogs && !error && !logs.length && <p className="p-8 text-center text-slate-500">まだギフティング履歴はありません。「案件への参加を記録」から追加してください。</p>}
      </div>
    </section>
  )
}

export default function InfluencersPage() {
  const { selectedAccountId, selectedAccount, loading: accountsLoading } = useAccount()
  const [items, setItems] = useState<Influencer[]>([])
  const [query, setQuery] = useState('')
  const [contactMethod, setContactMethod] = useState<'all' | 'line' | 'instagram_dm'>('all')
  const [manualForm, setManualForm] = useState<any>(null)
  const [savingManual, setSavingManual] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState<Influencer | null>(null)
  const detailRef = useRef<HTMLElement>(null)
  const showDetails = (item: Influencer) => {
    setSelected(item)
    // 詳細の描画後に移動し、一覧の下部から選んだ場合もすぐ確認できるようにする。
    requestAnimationFrame(() => detailRef.current?.scrollIntoView({
      block: 'start',
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
    }))
  }
  const [tab, setTab] = useState<'profiles' | 'history'>('profiles')
  useEffect(() => {
    if (!selectedAccountId) return
    setLoading(true)
    setError('')
    const q = new URLSearchParams({ lineAccountId: selectedAccountId })
    if (query) q.set('q', query)
    if (contactMethod !== 'all') q.set('contactMethod', contactMethod)
    fetchApi<{ success: boolean; data: Influencer[] }>(`/api/influencers?${q}`)
      .then((res) => {
        const next = res.data || []
        setItems(next)
        setSelected((current) => (current ? next.find((item) => item.friendId === current.friendId) || null : null))
      })
      .catch(() => setError('一覧を取得できませんでした。権限または接続を確認してください。'))
      .finally(() => setLoading(false))
  }, [selectedAccountId, query, contactMethod])
  const saveManual = async () => {
    if (!manualForm?.displayName?.trim() || !manualForm?.instagramHandle?.trim() || !manualForm?.categories?.trim() || !manualForm?.followerBand || !manualForm?.contactEmail?.trim() || !manualForm?.recipientName?.trim() || !/^\d{3}-\d{4}$/.test(manualForm?.postalCode || '') || !manualForm?.prefecture?.trim() || !manualForm?.addressLine1?.trim() || !manualForm?.addressPhone?.trim() || !manualForm?.privacyConsent) {
      setError('必須項目と本人同意を確認してください。郵便番号は123-4567形式で入力してください。')
      return
    }
    setSavingManual(true)
    setError('')
    try {
      const categories = manualForm.categories
        .split(/[、,]/)
        .map((value: string) => value.trim())
        .filter(Boolean)
      const res = await fetchApi<{ success: boolean; data: Influencer }>('/api/influencers/manual', {
        method: 'POST',
        body: JSON.stringify({
          lineAccountId: selectedAccountId,
          profile: {
            displayName: manualForm.displayName,
            instagramHandle: manualForm.instagramHandle,
            categories,
            followerBand: manualForm.followerBand,
            contactEmail: manualForm.contactEmail,
            contactPhone: manualForm.contactPhone,
            ageGroup: manualForm.ageGroup,
            gender: manualForm.gender,
            giftingInterests: manualForm.giftingInterests,
            dietaryNotes: manualForm.dietaryNotes,
            hasShopifyPurchase: manualForm.hasShopifyPurchase,
            privacyConsent: manualForm.privacyConsent,
          },
          address: {
            recipientName: manualForm.recipientName,
            postalCode: manualForm.postalCode,
            prefecture: manualForm.prefecture,
            addressLine1: manualForm.addressLine1,
            addressLine2: manualForm.addressLine2,
            phone: manualForm.addressPhone,
          },
        }),
      })
      setItems((current) => [res.data, ...current.filter((item) => item.friendId !== res.data.friendId)])
      setManualForm(null)
      setContactMethod('instagram_dm')
      setQuery('')
    } catch {
      setError('手動登録できませんでした。入力内容と権限を確認してください。')
    } finally {
      setSavingManual(false)
    }
  }
  const complete = useMemo(() => items.filter((item) => item.profileCompletedAt).length, [items])
  if (accountsLoading) return <div className="p-8">読み込み中…</div>
  if (!selectedAccountId) return <div className="p-8">利用できるLINEアカウントがありません。</div>
  return (
    <main className="p-6 max-w-6xl mx-auto">
      <div className="flex flex-wrap items-end justify-between gap-4 mb-7">
        <div>
          <p className="text-xs font-semibold tracking-widest text-emerald-700">CREATOR GIFTING</p>
          <h1 className="text-2xl font-bold mt-1">インフルエンサー管理</h1>
          <p className="text-sm text-gray-500 mt-1">{selectedAccount?.displayName || selectedAccount?.name} のプロフィール登録・進行管理</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() =>
              setManualForm({
                displayName: '',
                instagramHandle: '',
                categories: '',
                followerBand: '',
                contactEmail: '',
                contactPhone: '',
                ageGroup: '',
                gender: '',
                giftingInterests: [],
                dietaryNotes: '',
                hasShopifyPurchase: false,
                recipientName: '',
                postalCode: '',
                prefecture: '',
                addressLine1: '',
                addressLine2: '',
                addressPhone: '',
                privacyConsent: false,
              })
            }
            className="rounded-xl bg-emerald-700 px-4 py-3 text-sm font-bold text-white hover:bg-emerald-800"
          >
            手動で登録
          </button>
          <button type="button" onClick={() => downloadInfluencers(items)} disabled={!items.length} className="rounded-xl border border-emerald-300 bg-white px-4 py-3 text-sm font-medium text-emerald-800 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-50">
            Excelをダウンロード
          </button>
          <div className="rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
            登録済み <b className="text-lg">{complete}</b> / {items.length} 名
          </div>
        </div>
      </div>
      <div className="mb-5 flex gap-2 border-b">
        <button onClick={() => setTab('profiles')} className={`border-b-2 px-4 py-2 text-sm font-bold ${tab === 'profiles' ? 'border-emerald-600 text-emerald-700' : 'border-transparent text-slate-500'}`}>
          クリエイター一覧
        </button>
        <button onClick={() => setTab('history')} className={`border-b-2 px-4 py-2 text-sm font-bold ${tab === 'history' ? 'border-emerald-600 text-emerald-700' : 'border-transparent text-slate-500'}`}>
          募集案件・送付管理
        </button>
      </div>
      {tab === 'history' ? (
        <GiftingHistory key={selectedAccountId} lineAccountId={selectedAccountId} />
      ) : (
        <>
          <div className="mb-5 flex flex-wrap gap-3">
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="名前・Instagramアカウントで検索" className="w-full max-w-md border rounded-lg px-3 py-2" />
            <select value={contactMethod} onChange={(e) => setContactMethod(e.target.value as typeof contactMethod)} className="rounded-lg border bg-white px-3 py-2">
              <option value="all">連絡手段：すべて</option>
              <option value="instagram_dm">Instagram DM</option>
              <option value="line">LINE</option>
            </select>
          </div>
          {error && <p className="text-red-600 mb-4">{error}</p>}
          {selected && (
            <section ref={detailRef} className="mb-6 scroll-mt-6 overflow-hidden rounded-xl border border-emerald-200 bg-white shadow-sm">
              <div className="flex items-start justify-between gap-4 border-b border-emerald-100 bg-emerald-50 px-5 py-4">
                <div>
                  <p className="text-xs font-semibold tracking-widest text-emerald-700">CREATOR RECORD</p>
                  <h2 className="mt-1 text-xl font-bold">
                    {selected.displayName || '名称未登録'} <span className="font-normal text-slate-500">{selected.instagramHandle || ''}</span>
                  </h2>
                </div>
                <button onClick={() => setSelected(null)} className="rounded-lg border border-emerald-200 bg-white px-3 py-1.5 text-sm text-emerald-800 hover:bg-emerald-100">
                  閉じる
                </button>
              </div>
              <div className="grid gap-6 p-5 lg:grid-cols-2">
                <div>
                  <h3 className="mb-4 border-l-4 border-emerald-500 pl-2 text-sm font-bold">プロフィール・連絡先</h3>
                  <dl className="grid grid-cols-2 gap-x-6 gap-y-4">
                    <Field label="Instagramアカウント" value={selected.instagramHandle} />
                    <Field label="フォロワー数" value={selected.followerBand} />
                    <Field label="発信ジャンル" value={selected.categories.join('・')} />
                    <Field label="公式ショップ購入経験" value={selected.hasShopifyPurchase ? 'あり' : 'なし'} />
                    <Field label="連絡手段" value={selected.contactMethod === 'instagram_dm' ? 'Instagram DM' : 'LINE'} />
                    <Field label="LINEの状態" value={selected.registrationSource === 'manual' ? 'LINE未使用' : selected.isFollowing ? '登録中' : 'ブロック中'} />
                    <Field label="メールアドレス" value={selected.contactEmail} />
                    <Field label="連絡先電話番号" value={selected.contactPhone} />
                    <Field label="年代" value={selected.ageGroup} />
                    <Field label="性別" value={selected.gender} />
                    <Field label="興味のあるギフティング" value={selected.giftingInterests.join('・')} />
                    <Field label="アレルギー・避けたい食材" value={selected.dietaryNotes} />
                  </dl>
                </div>
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
                  <h3 className="mb-4 border-l-4 border-amber-500 pl-2 text-sm font-bold text-amber-950">配送先情報</h3>
                  {selected.address ? (
                    <dl className="grid grid-cols-2 gap-x-6 gap-y-4">
                      <Field label="お名前" value={selected.address.recipientName} />
                      <Field label="配送先電話番号" value={selected.address.phone} />
                      <Field label="郵便番号" value={selected.address.postalCode} />
                      <Field label="都道府県" value={selected.address.prefecture} />
                      <div className="col-span-2">
                        <Field label="市区町村・町名・番地" value={selected.address.addressLine1} />
                      </div>
                      <div className="col-span-2">
                        <Field label="建物名・部屋番号" value={selected.address.addressLine2} />
                      </div>
                    </dl>
                  ) : (
                    <p className="text-sm text-amber-900">配送先はまだ登録されていません。</p>
                  )}
                </div>
              </div>
            </section>
          )}
          <div className="overflow-x-auto bg-white border rounded-xl">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-gray-500">
                <tr>
                  <th className="p-3">クリエイター</th>
                  <th className="p-3">ジャンル</th>
                  <th className="p-3">フォロワー数</th>
                  <th className="p-3">連絡手段</th>
                  <th className="p-3">連絡先</th>
                  <th className="p-3">発送先</th>
                  <th className="p-3">状態</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.friendId} onClick={() => showDetails(item)} className={`cursor-pointer border-t transition hover:bg-emerald-50 ${selected?.friendId === item.friendId ? 'bg-emerald-50' : ''}`}>
                    <td className="p-3 font-medium">
                      {item.displayName || '名称未登録'}
                      <div className="text-xs font-normal text-gray-500">{item.instagramHandle || 'Instagram未登録'}</div>
                    </td>
                    <td className="p-3">{item.categories.join('・') || '—'}</td>
                    <td className="p-3">{item.followerBand || '—'}</td>
                    <td className="p-3">
                      <span className={`whitespace-nowrap rounded-full px-2 py-1 text-xs font-bold ${item.contactMethod === 'instagram_dm' ? 'bg-fuchsia-100 text-fuchsia-800' : 'bg-green-100 text-green-800'}`}>{item.contactMethod === 'instagram_dm' ? 'Instagram DM' : 'LINE'}</span>
                    </td>
                    <td className="p-3">{item.contactEmail || item.contactPhone || '—'}</td>
                    <td className="p-3">{item.address?.prefecture || '未登録'}</td>
                    <td className="p-3">
                      <span className={`rounded-full px-2 py-1 text-xs ${item.profileCompletedAt ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>{item.profileCompletedAt ? '登録済み' : '未登録'}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!loading && !items.length && <p className="p-8 text-center text-gray-500">該当するプロフィール登録者はいません。</p>}
          </div>

        </>
      )}
      {manualForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4">
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-6 shadow-xl">
            <div className="mb-5 flex items-center justify-between">
              <div>
                <h2 className="text-xl font-bold">インフルエンサーを手動登録</h2>
                <p className="mt-1 text-sm text-slate-500">LINEを使わない方をInstagram DM運用として登録します。</p>
              </div>
              <button onClick={() => setManualForm(null)} className="text-sm text-slate-500">
                閉じる
              </button>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <label className="text-sm font-medium">
                名前 *
                <input
                  value={manualForm.displayName}
                  onChange={(e) =>
                    setManualForm({
                      ...manualForm,
                      displayName: e.target.value,
                    })
                  }
                  className="mt-1 w-full rounded-lg border p-2"
                />
              </label>
              <label className="text-sm font-medium">
                Instagramアカウント *
                <input
                  value={manualForm.instagramHandle}
                  onChange={(e) =>
                    setManualForm({
                      ...manualForm,
                      instagramHandle: e.target.value,
                    })
                  }
                  placeholder="@account"
                  className="mt-1 w-full rounded-lg border p-2"
                />
              </label>
              <label className="text-sm font-medium md:col-span-2">
                ジャンル（カンマ区切り）*
                <input value={manualForm.categories} onChange={(e) => setManualForm({ ...manualForm, categories: e.target.value })} className="mt-1 w-full rounded-lg border p-2" />
              </label>
              <label className="text-sm font-medium">
                フォロワー数 *
                <select
                  value={manualForm.followerBand}
                  onChange={(e) =>
                    setManualForm({
                      ...manualForm,
                      followerBand: e.target.value,
                    })
                  }
                  className="mt-1 w-full rounded-lg border p-2"
                >
                  <option value="">選択してください</option>
                  {['〜1,000人', '1,001〜5,000人', '5,001〜10,000人', '10,001〜30,000人', '30,001〜100,000人', '100,001人〜'].map((value) => (
                    <option key={value}>{value}</option>
                  ))}
                </select>
              </label>
              <label className="text-sm font-medium">
                メールアドレス *
                <input
                  type="email"
                  value={manualForm.contactEmail}
                  onChange={(e) =>
                    setManualForm({
                      ...manualForm,
                      contactEmail: e.target.value,
                    })
                  }
                  className="mt-1 w-full rounded-lg border p-2"
                />
              </label>
              <label className="text-sm font-medium">
                電話番号
                <input
                  value={manualForm.contactPhone}
                  onChange={(e) =>
                    setManualForm({
                      ...manualForm,
                      contactPhone: e.target.value,
                    })
                  }
                  className="mt-1 w-full rounded-lg border p-2"
                />
              </label>
              <label className="text-sm font-medium">
                年代
                <select value={manualForm.ageGroup} onChange={(e) => setManualForm({ ...manualForm, ageGroup: e.target.value })} className="mt-1 w-full rounded-lg border p-2">
                  <option value="">回答しない</option>
                  {['10代', '20代', '30代', '40代', '50代', '60代以上'].map((value) => (
                    <option key={value}>{value}</option>
                  ))}
                </select>
              </label>
              <label className="text-sm font-medium">
                性別
                <select value={manualForm.gender} onChange={(e) => setManualForm({ ...manualForm, gender: e.target.value })} className="mt-1 w-full rounded-lg border p-2">
                  <option value="">回答しない</option>
                  {['女性', '男性', 'ノンバイナリー', '回答しない'].map((value) => (
                    <option key={value}>{value}</option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-2 text-sm font-medium md:col-span-2">
                <input
                  type="checkbox"
                  checked={manualForm.hasShopifyPurchase}
                  onChange={(e) =>
                    setManualForm({
                      ...manualForm,
                      hasShopifyPurchase: e.target.checked,
                    })
                  }
                  className="h-4 w-4"
                />
                オリゼ公式ショップで購入したことがある
              </label>
              <fieldset className="md:col-span-2">
                <legend className="text-sm font-medium">興味のあるギフティング</legend>
                <div className="mt-2 flex flex-wrap gap-2">
                  {['甘酒', 'グラノーラ', '米麹調味料', '新商品・限定品'].map((value) => (
                    <label key={value} className="flex items-center gap-2 rounded-full border px-3 py-2 text-sm">
                      <input
                        type="checkbox"
                        checked={manualForm.giftingInterests.includes(value)}
                        onChange={(e) =>
                          setManualForm({
                            ...manualForm,
                            giftingInterests: e.target.checked ? [...manualForm.giftingInterests, value] : manualForm.giftingInterests.filter((item: string) => item !== value),
                          })
                        }
                      />
                      {value}
                    </label>
                  ))}
                </div>
              </fieldset>
              <label className="text-sm font-medium md:col-span-2">
                アレルギー・避けたい食材
                <textarea
                  value={manualForm.dietaryNotes}
                  onChange={(e) =>
                    setManualForm({
                      ...manualForm,
                      dietaryNotes: e.target.value,
                    })
                  }
                  className="mt-1 w-full rounded-lg border p-2"
                  rows={2}
                />
              </label>
              <div className="border-t pt-5 md:col-span-2">
                <h3 className="font-bold">配送先情報</h3>
                <p className="mt-1 text-xs text-slate-500">ギフティング商品の発送に使用します。</p>
              </div>
              <label className="text-sm font-medium">
                配送先のお名前 *
                <input
                  value={manualForm.recipientName}
                  onChange={(e) =>
                    setManualForm({
                      ...manualForm,
                      recipientName: e.target.value,
                    })
                  }
                  className="mt-1 w-full rounded-lg border p-2"
                />
              </label>
              <label className="text-sm font-medium">
                郵便番号 *
                <input
                  value={manualForm.postalCode}
                  onChange={(e) => {
                    const digits = e.target.value.replace(/\D/g, '').slice(0, 7)
                    setManualForm({
                      ...manualForm,
                      postalCode: digits.length > 3 ? `${digits.slice(0, 3)}-${digits.slice(3)}` : digits,
                    })
                  }}
                  placeholder="123-4567"
                  className="mt-1 w-full rounded-lg border p-2"
                />
              </label>
              <label className="text-sm font-medium">
                都道府県 *
                <input value={manualForm.prefecture} onChange={(e) => setManualForm({ ...manualForm, prefecture: e.target.value })} className="mt-1 w-full rounded-lg border p-2" />
              </label>
              <label className="text-sm font-medium">
                配送先電話番号 *
                <input
                  value={manualForm.addressPhone}
                  onChange={(e) =>
                    setManualForm({
                      ...manualForm,
                      addressPhone: e.target.value,
                    })
                  }
                  className="mt-1 w-full rounded-lg border p-2"
                />
              </label>
              <label className="text-sm font-medium md:col-span-2">
                市区町村・町名・番地 *
                <input
                  value={manualForm.addressLine1}
                  onChange={(e) =>
                    setManualForm({
                      ...manualForm,
                      addressLine1: e.target.value,
                    })
                  }
                  className="mt-1 w-full rounded-lg border p-2"
                />
              </label>
              <label className="text-sm font-medium md:col-span-2">
                建物名・部屋番号（任意）
                <input
                  value={manualForm.addressLine2}
                  onChange={(e) =>
                    setManualForm({
                      ...manualForm,
                      addressLine2: e.target.value,
                    })
                  }
                  className="mt-1 w-full rounded-lg border p-2"
                />
              </label>
              <label className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm md:col-span-2">
                <input
                  type="checkbox"
                  checked={manualForm.privacyConsent}
                  onChange={(e) =>
                    setManualForm({
                      ...manualForm,
                      privacyConsent: e.target.checked,
                    })
                  }
                  className="mt-0.5 h-4 w-4"
                />
                本人から、登録情報をギフティングの選考・発送・連絡に利用する許可を得ています。*
              </label>
            </div>
            <div className="mt-5 rounded-lg bg-fuchsia-50 px-4 py-3 text-sm text-fuchsia-900">
              <b>連絡手段：Instagram DM</b>
              <br />
              一覧の絞り込みから担当者が確認できます。
            </div>
            <button onClick={saveManual} disabled={savingManual} className="mt-5 w-full rounded-lg bg-emerald-700 px-5 py-3 text-sm font-bold text-white disabled:opacity-50">
              {savingManual ? '登録中…' : '手動登録する'}
            </button>
          </div>
        </div>
      )}
    </main>
  )
}
