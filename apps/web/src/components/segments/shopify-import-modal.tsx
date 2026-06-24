'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { fermentApi, type ShopifySegmentItem } from '@/lib/ferment-api'

/**
 * Shopify の顧客セグメントを一覧表示し、ON/OFF トグルでハーネスに取り込む（ミラー）モーダル。
 * 取り込んだセグメントは配信フォームの宛先にそのまま表示される。
 */
export default function ShopifyImportModal({
  onClose,
  onChanged,
}: {
  onClose: () => void
  onChanged: () => void
}) {
  const [items, setItems] = useState<ShopifySegmentItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [busyGid, setBusyGid] = useState<string | null>(null)
  const [notice, setNotice] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fermentApi.shopifySegments.list()
      if (res.success && res.data) setItems(res.data)
      else setError(res.error ?? '取得に失敗しました')
    } catch {
      setError('取得に失敗しました（Shopify接続を確認してください）')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  // ミラー済みを上に、その後は元の並び
  const sorted = useMemo(() => {
    const kw = search.trim().toLowerCase()
    const filtered = kw
      ? items.filter((s) => s.name.toLowerCase().includes(kw) || s.query.toLowerCase().includes(kw))
      : items
    return [...filtered].sort((a, b) => Number(b.mirrored) - Number(a.mirrored))
  }, [items, search])

  const mirroredCount = items.filter((s) => s.mirrored).length

  const handleOn = async (s: ShopifySegmentItem) => {
    setBusyGid(s.gid)
    setError('')
    setNotice('')
    try {
      const res = await fermentApi.shopifySegments.mirror(s.gid, s.name, s.query)
      if (res.success && res.data) {
        const sync = res.data.sync
        if (!sync.done) {
          setNotice(`「${s.name}」は人数が多いため、続きは自動で取り込みます（現在 ${sync.totalMembers.toLocaleString()}人）。`)
        } else {
          setNotice(`「${s.name}」を取り込みました（LINE連携済み ${sync.totalMembers.toLocaleString()}人）。`)
        }
        await load()
        onChanged()
      } else {
        setError(res.error ?? '取り込みに失敗しました')
      }
    } catch {
      setError('取り込みに失敗しました')
    } finally {
      setBusyGid(null)
    }
  }

  const handleOff = async (s: ShopifySegmentItem) => {
    if (!s.segment_id) return
    if (!confirm(`「${s.name}」の取り込みを解除しますか？\n（配信先の一覧からも外れます）`)) return
    setBusyGid(s.gid)
    setError('')
    setNotice('')
    try {
      const res = await fermentApi.shopifySegments.unmirror(s.segment_id)
      if (res.success) {
        await load()
        onChanged()
      } else {
        setError(res.error ?? '解除に失敗しました')
      }
    } catch {
      setError('解除に失敗しました')
    } finally {
      setBusyGid(null)
    }
  }

  const handleResume = async (s: ShopifySegmentItem) => {
    if (!s.segment_id) return
    setBusyGid(s.gid)
    setError('')
    try {
      const res = await fermentApi.shopifySegments.sync(s.segment_id)
      if (res.success && res.data) {
        setNotice(
          res.data.done
            ? `「${s.name}」の取り込みが完了しました（${res.data.totalMembers.toLocaleString()}人）。`
            : `続きを取り込みました（現在 ${res.data.totalMembers.toLocaleString()}人）。まだ続きがあります。`,
        )
        await load()
        onChanged()
      } else {
        setError(res.error ?? '同期に失敗しました')
      }
    } finally {
      setBusyGid(null)
    }
  }

  const fmt = (iso: string | null) =>
    iso ? new Date(iso).toLocaleString('ja-JP', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ヘッダー */}
        <div className="px-5 py-4 border-b border-gray-200 flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Shopifyセグメントの取り込み</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              使いたいセグメントを「取り込む」にすると、LINE連携済みの人が配信先になります（取り込み済み {mirroredCount} 件）
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>

        {/* 検索 */}
        <div className="px-5 pt-3">
          <input
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
            placeholder="セグメント名・条件で検索（例: 複数回購入 / number_of_orders）"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {notice && <div className="mt-2 p-2 bg-green-50 text-green-700 rounded-lg text-xs">{notice}</div>}
          {error && <div className="mt-2 p-2 bg-red-50 text-red-600 rounded-lg text-xs">{error}</div>}
        </div>

        {/* 一覧 */}
        <div className="flex-1 overflow-y-auto px-5 py-3 space-y-2">
          {loading ? (
            <div className="text-center py-12 text-gray-400 text-sm">読み込み中...</div>
          ) : sorted.length === 0 ? (
            <div className="text-center py-12 text-gray-400 text-sm">該当するセグメントがありません</div>
          ) : (
            sorted.map((s) => {
              const busy = busyGid === s.gid
              const syncing = s.sync_status === 'syncing'
              return (
                <div
                  key={s.gid}
                  className={`border rounded-xl p-3 flex items-start justify-between gap-3 ${
                    s.mirrored ? 'border-green-200 bg-green-50/40' : 'border-gray-200'
                  }`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-gray-900 text-sm">{s.name}</span>
                      {s.mirrored && (
                        <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded font-medium">
                          {syncing ? '同期中…' : `${(s.member_count ?? 0).toLocaleString()}人`}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-500 mt-0.5 font-mono break-all">{s.query}</p>
                    {s.mirrored && (
                      <p className="text-[11px] text-gray-400 mt-0.5">最終同期: {fmt(s.last_synced_at)}</p>
                    )}
                    {s.mirrored && syncing && (
                      <button
                        onClick={() => handleResume(s)}
                        disabled={busy}
                        className="mt-1 text-xs text-amber-700 underline disabled:opacity-50"
                      >
                        続けて取り込む
                      </button>
                    )}
                  </div>
                  <button
                    onClick={() => (s.mirrored ? handleOff(s) : handleOn(s))}
                    disabled={busy}
                    className={`shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium disabled:opacity-50 ${
                      s.mirrored
                        ? 'text-gray-600 border border-gray-300 hover:bg-gray-100'
                        : 'bg-green-600 text-white hover:bg-green-700'
                    }`}
                  >
                    {busy ? '処理中…' : s.mirrored ? '解除' : '取り込む'}
                  </button>
                </div>
              )
            })
          )}
        </div>

        <div className="px-5 py-3 border-t border-gray-200 text-right">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">
            閉じる
          </button>
        </div>
      </div>
    </div>
  )
}
