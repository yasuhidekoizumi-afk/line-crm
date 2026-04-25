'use client'

import { useState, useEffect, useCallback } from 'react'
import { fermentApi, type Customer } from '@/lib/ferment-api'

function fmt(iso: string | null) {
  if (!iso) return '-'
  return new Date(iso).toLocaleString('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit' })
}

export default function CustomersPage() {
  const [customers, setCustomers] = useState<Customer[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [regionFilter, setRegionFilter] = useState('')
  const [emailFilter, setEmailFilter] = useState<'' | 'subscribed' | 'unsubscribed'>('')
  const [offset, setOffset] = useState(0)
  const [total, setTotal] = useState(0)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<Customer | null>(null)
  const [detailEmails, setDetailEmails] = useState<unknown[]>([])
  const [detailLoading, setDetailLoading] = useState(false)

  const LIMIT = 50

  const load = useCallback(async (off = 0) => {
    setLoading(true)
    setError('')
    try {
      const params: Parameters<typeof fermentApi.customers.list>[0] = {
        limit: LIMIT,
        offset: off,
      }
      if (regionFilter) params.region = regionFilter
      if (emailFilter === 'subscribed') params.subscribed_email = true
      if (emailFilter === 'unsubscribed') params.subscribed_email = false
      const res = await fermentApi.customers.list(params)
      if (res.success && res.data) {
        setCustomers(res.data)
        setTotal(res.meta?.total ?? res.data.length)
      }
    } catch {
      setError('読み込みに失敗しました')
    } finally {
      setLoading(false)
    }
  }, [regionFilter, emailFilter])

  useEffect(() => {
    setOffset(0)
    load(0)
  }, [load])

  const handlePageChange = (newOffset: number) => {
    setOffset(newOffset)
    load(newOffset)
  }

  const handleSelectCustomer = async (customer: Customer) => {
    setSelectedId(customer.customer_id)
    setDetail(customer)
    setDetailLoading(true)
    try {
      const res = await fermentApi.customers.emails(customer.customer_id, 20)
      if (res.success && res.data) setDetailEmails(res.data)
    } finally {
      setDetailLoading(false)
    }
  }

  const displayed = search
    ? customers.filter((c) =>
        (c.display_name ?? '').toLowerCase().includes(search.toLowerCase()) ||
        (c.email ?? '').toLowerCase().includes(search.toLowerCase())
      )
    : customers

  return (
    <div className="max-w-7xl mx-auto py-8 px-4">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">統合顧客</h1>
        <p className="text-sm text-gray-500 mt-1">メール × LINE 統合顧客プロファイル</p>
      </div>

      {error && <div className="mb-4 p-3 bg-red-50 text-red-600 rounded-lg text-sm">{error}</div>}

      {/* フィルター */}
      <div className="flex flex-wrap gap-3 mb-4">
        <input
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm w-56"
          placeholder="名前・メールで絞り込み"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm"
          value={regionFilter}
          onChange={(e) => setRegionFilter(e.target.value)}
        >
          <option value="">地域：全て</option>
          <option value="JP">JP</option>
          <option value="US">US</option>
        </select>
        <select
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm"
          value={emailFilter}
          onChange={(e) => setEmailFilter(e.target.value as typeof emailFilter)}
        >
          <option value="">メール：全て</option>
          <option value="subscribed">購読中</option>
          <option value="unsubscribed">未購読</option>
        </select>
        <span className="text-sm text-gray-400 self-center ml-auto">
          {total.toLocaleString()}件
        </span>
      </div>

      <div className="flex gap-4">
        {/* 一覧 */}
        <div className="flex-1 min-w-0">
          {loading ? (
            <div className="text-center py-12 text-gray-400">読み込み中...</div>
          ) : displayed.length === 0 ? (
            <div className="text-center py-12 text-gray-400">顧客が見つかりません</div>
          ) : (
            <>
              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      <th className="text-left px-4 py-3 font-medium text-gray-600">顧客</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-600 hidden sm:table-cell">地域</th>
                      <th className="text-right px-4 py-3 font-medium text-gray-600">LTV</th>
                      <th className="text-right px-4 py-3 font-medium text-gray-600 hidden md:table-cell">注文数</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-600 hidden lg:table-cell">最終注文</th>
                      <th className="text-center px-4 py-3 font-medium text-gray-600">メール</th>
                    </tr>
                  </thead>
                  <tbody>
                    {displayed.map((c, i) => (
                      <tr
                        key={c.customer_id}
                        onClick={() => handleSelectCustomer(c)}
                        className={`cursor-pointer transition-colors ${
                          selectedId === c.customer_id
                            ? 'bg-green-50'
                            : i % 2 === 0 ? 'hover:bg-gray-50' : 'bg-gray-50 hover:bg-gray-100'
                        }`}
                      >
                        <td className="px-4 py-2.5">
                          <div className="font-medium text-gray-900 truncate max-w-[180px]">
                            {c.display_name ?? '(名前なし)'}
                          </div>
                          <div className="text-xs text-gray-400 truncate">{c.email ?? '-'}</div>
                        </td>
                        <td className="px-4 py-2.5 hidden sm:table-cell">
                          <span className="text-xs bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">{c.region}</span>
                        </td>
                        <td className="px-4 py-2.5 text-right text-gray-700 font-medium">
                          ¥{c.ltv.toLocaleString()}
                        </td>
                        <td className="px-4 py-2.5 text-right text-gray-500 hidden md:table-cell">
                          {c.order_count}
                        </td>
                        <td className="px-4 py-2.5 text-gray-500 hidden lg:table-cell text-sm">
                          {fmt(c.last_order_at)}
                        </td>
                        <td className="px-4 py-2.5 text-center">
                          <span className={`inline-block w-2 h-2 rounded-full ${c.subscribed_email ? 'bg-green-400' : 'bg-gray-300'}`} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* ページネーション */}
              {total > LIMIT && (
                <div className="flex justify-center gap-2 mt-4">
                  <button
                    onClick={() => handlePageChange(Math.max(0, offset - LIMIT))}
                    disabled={offset === 0}
                    className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg disabled:opacity-40 hover:bg-gray-50"
                  >
                    ← 前へ
                  </button>
                  <span className="text-sm text-gray-500 self-center">
                    {offset + 1}–{Math.min(offset + LIMIT, total)} / {total}
                  </span>
                  <button
                    onClick={() => handlePageChange(offset + LIMIT)}
                    disabled={offset + LIMIT >= total}
                    className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg disabled:opacity-40 hover:bg-gray-50"
                  >
                    次へ →
                  </button>
                </div>
              )}
            </>
          )}
        </div>

        {/* 顧客詳細パネル */}
        {detail && (
          <div className="w-80 shrink-0 bg-white border border-gray-200 rounded-xl p-4 self-start sticky top-4">
            <div className="flex justify-between items-start mb-3">
              <h3 className="font-semibold text-gray-900">{detail.display_name ?? '(名前なし)'}</h3>
              <button onClick={() => { setDetail(null); setSelectedId(null) }} className="text-gray-400 hover:text-gray-600 text-lg leading-none">×</button>
            </div>

            <div className="space-y-1.5 text-sm mb-4">
              <div className="flex justify-between">
                <span className="text-gray-500">メール</span>
                <span className="text-gray-800 truncate ml-2 max-w-[160px]">{detail.email ?? '-'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">地域</span>
                <span className="text-gray-800">{detail.region}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">LTV</span>
                <span className="text-gray-800 font-medium">¥{detail.ltv.toLocaleString()}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">注文数</span>
                <span className="text-gray-800">{detail.order_count}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">最終注文</span>
                <span className="text-gray-800">{fmt(detail.last_order_at)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">メール購読</span>
                <span className={detail.subscribed_email ? 'text-green-600' : 'text-gray-400'}>
                  {detail.subscribed_email ? '購読中' : '未購読'}
                </span>
              </div>
              {detail.tags && (
                <div className="flex justify-between">
                  <span className="text-gray-500">タグ</span>
                  <span className="text-gray-800 text-xs">{detail.tags}</span>
                </div>
              )}
            </div>

            <div className="border-t border-gray-100 pt-3">
              <h4 className="text-xs font-semibold text-gray-600 mb-2 uppercase tracking-wide">メール履歴</h4>
              {detailLoading ? (
                <p className="text-xs text-gray-400 py-2">読み込み中...</p>
              ) : detailEmails.length === 0 ? (
                <p className="text-xs text-gray-400 py-2">メール履歴なし</p>
              ) : (
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {(detailEmails as Array<{
                    log_id: string
                    subject: string | null
                    status: string
                    queued_at: string
                    opened_at: string | null
                  }>).map((log) => (
                    <div key={log.log_id} className="text-xs">
                      <div className="flex justify-between items-start gap-1">
                        <span className="text-gray-700 truncate flex-1">{log.subject ?? '(件名なし)'}</span>
                        <span className={`shrink-0 px-1 py-0.5 rounded text-[10px] font-medium ${
                          log.status === 'opened' ? 'bg-green-100 text-green-700' :
                          log.status === 'sent' ? 'bg-blue-100 text-blue-700' :
                          log.status === 'failed' ? 'bg-red-100 text-red-600' :
                          'bg-gray-100 text-gray-500'
                        }`}>
                          {log.status === 'opened' ? '開封' :
                           log.status === 'sent' ? '送信済' :
                           log.status === 'failed' ? '失敗' :
                           log.status}
                        </span>
                      </div>
                      <div className="text-gray-400 mt-0.5">{fmt(log.queued_at)}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
