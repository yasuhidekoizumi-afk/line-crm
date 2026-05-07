'use client'

interface PaginationProps {
  /** 現在のページ（0始まり） */
  page: number
  /** 1ページあたりの件数 */
  perPage: number
  /** 総件数 */
  total: number
  /** ページ変更コールバック */
  onChange: (page: number) => void
}

export default function Pagination({ page, perPage, total, onChange }: PaginationProps) {
  const totalPages = Math.max(1, Math.ceil(total / perPage))

  if (totalPages <= 1) return null

  // 表示するページ番号の範囲（最大7個）
  const range: number[] = []
  const half = 3
  let start = Math.max(0, page - half)
  let end = Math.min(totalPages - 1, page + half)
  if (end - start < 6) {
    if (start === 0) end = Math.min(totalPages - 1, start + 6)
    else start = Math.max(0, end - 6)
  }
  for (let i = start; i <= end; i++) range.push(i)

  const btnClass = (active: boolean) =>
    `min-w-[36px] h-9 flex items-center justify-center rounded-lg text-sm font-medium transition-colors ${
      active
        ? 'bg-green-600 text-white shadow-sm'
        : 'text-gray-600 hover:bg-gray-100'
    }`

  return (
    <div className="flex items-center justify-center gap-1.5 py-4">
      {/* 最初へ */}
      <button
        onClick={() => onChange(0)}
        disabled={page === 0}
        className={btnClass(false) + ' disabled:opacity-30 disabled:cursor-not-allowed'}
        aria-label="最初のページ"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
        </svg>
      </button>

      {/* 前へ */}
      <button
        onClick={() => onChange(page - 1)}
        disabled={page === 0}
        className={btnClass(false) + ' disabled:opacity-30 disabled:cursor-not-allowed'}
        aria-label="前のページ"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
      </button>

      {/* ページ番号 */}
      {start > 0 && (
        <>
          <button onClick={() => onChange(0)} className={btnClass(false)}>1</button>
          {start > 1 && <span className="text-gray-400 px-1 select-none">…</span>}
        </>
      )}
      {range.map((i) => (
        <button key={i} onClick={() => onChange(i)} className={btnClass(i === page)}>
          {i + 1}
        </button>
      ))}
      {end < totalPages - 1 && (
        <>
          {end < totalPages - 2 && <span className="text-gray-400 px-1 select-none">…</span>}
          <button onClick={() => onChange(totalPages - 1)} className={btnClass(false)}>
            {totalPages}
          </button>
        </>
      )}

      {/* 次へ */}
      <button
        onClick={() => onChange(page + 1)}
        disabled={page >= totalPages - 1}
        className={btnClass(false) + ' disabled:opacity-30 disabled:cursor-not-allowed'}
        aria-label="次のページ"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
      </button>

      {/* 最後へ */}
      <button
        onClick={() => onChange(totalPages - 1)}
        disabled={page >= totalPages - 1}
        className={btnClass(false) + ' disabled:opacity-30 disabled:cursor-not-allowed'}
        aria-label="最後のページ"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 5l7 7-7 7" />
        </svg>
      </button>

      {/* 件数表示 */}
      <span className="ml-3 text-xs text-gray-400 select-none">
        {page * perPage + 1}–{Math.min((page + 1) * perPage, total)} / {total}
      </span>
    </div>
  )
}
