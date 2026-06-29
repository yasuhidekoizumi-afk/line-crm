'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Header from '@/components/layout/header'
import { fetchApi } from '@/lib/api'

interface AffiliateProgramPartner {
  id: string
  name: string
  code: string
  email: string | null
  partnerType: 'standard' | 'special' | 'fixed'
  commissionType: 'percentage' | 'fixed'
  commissionRate: number
  fixedAmount: number | null
  cookieDays: number
  status: 'active' | 'paused' | 'archived'
  notes: string | null
  createdAt: string
  updatedAt: string
}

interface AffiliateProgramReportRow {
  partnerId: string
  name: string
  code: string
  partnerType: 'standard' | 'special' | 'fixed'
  commissionType: 'percentage' | 'fixed'
  commissionRate: number
  fixedAmount: number | null
  status: 'active' | 'paused' | 'archived'
  orderCount: number
  approvedOrderCount: number
  revenue: number
  commissionPending: number
  commissionApproved: number
  commissionPaid: number
  lastOrderedAt: string | null
}

interface AffiliateProgramOrder {
  id: string
  partnerId: string
  partnerName: string | null
  affiliateCode: string
  shopifyOrderId: string
  shopifyOrderNumber: string | null
  customerEmail: string | null
  totalPrice: number
  subtotalPrice: number
  currency: string
  financialStatus: string | null
  orderedAt: string
  attributionSource: string
  commissionAmount: number | null
  commissionStatus: string | null
}

interface ApiResult<T> { success: boolean; data: T; error?: string }

const fmtYen = (v: number | null | undefined) => `¥${Math.round(v ?? 0).toLocaleString('ja-JP')}`
const fmtRate = (v: number) => `${Math.round(v * 1000) / 10}%`
const fmtDate = (iso: string | null | undefined) => iso ? new Date(iso).toLocaleDateString('ja-JP') : '—'

const statusLabel: Record<AffiliateProgramPartner['status'], string> = {
  active: '有効',
  paused: '停止',
  archived: 'アーカイブ',
}

export default function AffiliateProgramPage() {
  const [partners, setPartners] = useState<AffiliateProgramPartner[]>([])
  const [report, setReport] = useState<AffiliateProgramReportRow[]>([])
  const [orders, setOrders] = useState<AffiliateProgramOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState({
    name: '',
    code: '',
    email: '',
    partnerType: 'standard' as AffiliateProgramPartner['partnerType'],
    commissionType: 'percentage' as AffiliateProgramPartner['commissionType'],
    commissionRate: '10',
    fixedAmount: '500',
    notes: '',
  })

  const loadAll = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [partnersRes, reportRes, ordersRes] = await Promise.all([
        fetchApi<ApiResult<AffiliateProgramPartner[]>>('/api/affiliate-program/partners'),
        fetchApi<ApiResult<AffiliateProgramReportRow[]>>('/api/affiliate-program/report'),
        fetchApi<ApiResult<AffiliateProgramOrder[]>>('/api/affiliate-program/orders?limit=50'),
      ])
      setPartners(partnersRes.data ?? [])
      setReport(reportRes.data ?? [])
      setOrders(ordersRes.data ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : '読み込みに失敗しました')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadAll() }, [loadAll])

  const totals = useMemo(() => report.reduce((acc, r) => ({
    orderCount: acc.orderCount + r.orderCount,
    revenue: acc.revenue + r.revenue,
    pending: acc.pending + r.commissionPending,
    approved: acc.approved + r.commissionApproved,
    paid: acc.paid + r.commissionPaid,
  }), { orderCount: 0, revenue: 0, pending: 0, approved: 0, paid: 0 }), [report])

  const createPartner = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.name.trim() || !form.code.trim()) return
    setCreating(true)
    setError(null)
    try {
      const commissionRate = Math.max(0, Math.min(100, Number(form.commissionRate || '0'))) / 100
      await fetchApi<ApiResult<AffiliateProgramPartner>>('/api/affiliate-program/partners', {
        method: 'POST',
        body: JSON.stringify({
          name: form.name,
          code: form.code,
          email: form.email || null,
          partnerType: form.partnerType,
          commissionType: form.commissionType,
          commissionRate,
          fixedAmount: form.commissionType === 'fixed' ? Number(form.fixedAmount || '0') : null,
          notes: form.notes || null,
        }),
      })
      setForm({ name: '', code: '', email: '', partnerType: 'standard', commissionType: 'percentage', commissionRate: '10', fixedAmount: '500', notes: '' })
      await loadAll()
    } catch (e) {
      setError(e instanceof Error ? e.message : '登録に失敗しました')
    } finally {
      setCreating(false)
    }
  }

  return (
    <div>
      <Header
        title="自社アフィリエイト"
        description="Shopify 注文成果に紐づく現金報酬制度。Pay Forward（?ref/ポイント）とは分離して管理します。"
      />

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-8">
        <div className="bg-white rounded-xl p-5 border border-gray-100">
          <p className="text-sm text-gray-500">パートナー</p>
          <p className="text-3xl font-bold text-gray-900 mt-1">{partners.length}</p>
        </div>
        <div className="bg-white rounded-xl p-5 border border-gray-100">
          <p className="text-sm text-gray-500">成果注文</p>
          <p className="text-3xl font-bold text-blue-600 mt-1">{totals.orderCount}</p>
        </div>
        <div className="bg-white rounded-xl p-5 border border-gray-100">
          <p className="text-sm text-gray-500">売上</p>
          <p className="text-2xl font-bold text-gray-900 mt-2">{fmtYen(totals.revenue)}</p>
        </div>
        <div className="bg-white rounded-xl p-5 border border-gray-100">
          <p className="text-sm text-gray-500">未承認報酬</p>
          <p className="text-2xl font-bold text-amber-600 mt-2">{fmtYen(totals.pending)}</p>
        </div>
        <div className="bg-white rounded-xl p-5 border border-gray-100">
          <p className="text-sm text-gray-500">支払済</p>
          <p className="text-2xl font-bold text-green-600 mt-2">{fmtYen(totals.paid)}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[360px_1fr] gap-6 mb-8">
        <form onSubmit={createPartner} className="bg-white rounded-xl border border-gray-200 p-5 space-y-4 h-fit">
          <div>
            <h2 className="text-base font-bold text-gray-900">パートナー登録</h2>
            <p className="text-xs text-gray-500 mt-1">例: KOJI10 / INFLUENCER_A。URLは後段のテーマJS実装後に `?aff=` で利用します。</p>
          </div>
          <label className="block">
            <span className="text-xs font-medium text-gray-600">名前</span>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm" placeholder="パートナー名" />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-gray-600">コード</span>
            <input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-mono" placeholder="KOJI10" />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-gray-600">メール</span>
            <input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm" placeholder="partner@example.com" />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs font-medium text-gray-600">区分</span>
              <select value={form.partnerType} onChange={(e) => setForm({ ...form, partnerType: e.target.value as AffiliateProgramPartner['partnerType'] })} className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm">
                <option value="standard">標準</option>
                <option value="special">特別</option>
                <option value="fixed">固定</option>
              </select>
            </label>
            <label className="block">
              <span className="text-xs font-medium text-gray-600">報酬方式</span>
              <select value={form.commissionType} onChange={(e) => setForm({ ...form, commissionType: e.target.value as AffiliateProgramPartner['commissionType'] })} className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm">
                <option value="percentage">%</option>
                <option value="fixed">固定円</option>
              </select>
            </label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs font-medium text-gray-600">料率(%)</span>
              <input type="number" value={form.commissionRate} onChange={(e) => setForm({ ...form, commissionRate: e.target.value })} className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm" />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-gray-600">固定額(円)</span>
              <input type="number" value={form.fixedAmount} onChange={(e) => setForm({ ...form, fixedAmount: e.target.value })} className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm" />
            </label>
          </div>
          <label className="block">
            <span className="text-xs font-medium text-gray-600">メモ</span>
            <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm" rows={3} />
          </label>
          <button type="submit" disabled={creating || !form.name.trim() || !form.code.trim()} className="w-full rounded-lg bg-green-600 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50">
            {creating ? '登録中...' : '登録する'}
          </button>
        </form>

        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
            <h2 className="text-base font-bold text-gray-900">成果レポート</h2>
            <button type="button" onClick={loadAll} className="text-xs text-blue-600 hover:text-blue-800">更新</button>
          </div>
          {loading ? (
            <div className="p-8 text-center text-gray-400">読み込み中...</div>
          ) : report.length === 0 ? (
            <div className="p-8 text-center text-gray-400">パートナーがまだ登録されていません</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px]">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">パートナー</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">コード</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500">注文</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500">売上</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500">未承認</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500">承認済</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500">支払済</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">状態</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">最新注文</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {report.map((r) => (
                    <tr key={r.partnerId} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-sm font-medium text-gray-900">{r.name}<div className="text-xs text-gray-400">{r.commissionType === 'fixed' ? fmtYen(r.fixedAmount) : fmtRate(r.commissionRate)}</div></td>
                      <td className="px-4 py-3 text-sm font-mono text-blue-600">{r.code}</td>
                      <td className="px-4 py-3 text-sm text-right font-semibold">{r.orderCount}</td>
                      <td className="px-4 py-3 text-sm text-right">{fmtYen(r.revenue)}</td>
                      <td className="px-4 py-3 text-sm text-right text-amber-600">{fmtYen(r.commissionPending)}</td>
                      <td className="px-4 py-3 text-sm text-right text-blue-600">{fmtYen(r.commissionApproved)}</td>
                      <td className="px-4 py-3 text-sm text-right text-green-600">{fmtYen(r.commissionPaid)}</td>
                      <td className="px-4 py-3 text-sm"><span className="rounded-full bg-gray-100 px-2 py-1 text-xs text-gray-700">{statusLabel[r.status]}</span></td>
                      <td className="px-4 py-3 text-sm text-gray-500">{fmtDate(r.lastOrderedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100">
          <h2 className="text-base font-bold text-gray-900">直近の成果注文</h2>
        </div>
        {orders.length === 0 ? (
          <div className="p-8 text-center text-gray-400">成果注文はまだありません</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px]">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">注文</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">パートナー</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">顧客</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500">売上</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500">報酬</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">状態</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">注文日</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {orders.map((o) => (
                  <tr key={o.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-sm font-mono text-blue-600">{o.shopifyOrderNumber ?? o.shopifyOrderId}</td>
                    <td className="px-4 py-3 text-sm text-gray-900">{o.partnerName ?? o.affiliateCode}<div className="text-xs font-mono text-gray-400">{o.affiliateCode}</div></td>
                    <td className="px-4 py-3 text-sm text-gray-500">{o.customerEmail ?? '—'}</td>
                    <td className="px-4 py-3 text-sm text-right">{fmtYen(o.totalPrice)}</td>
                    <td className="px-4 py-3 text-sm text-right font-semibold text-amber-600">{fmtYen(o.commissionAmount)}</td>
                    <td className="px-4 py-3 text-sm text-gray-500">{o.commissionStatus ?? '—'}</td>
                    <td className="px-4 py-3 text-sm text-gray-500">{fmtDate(o.orderedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
