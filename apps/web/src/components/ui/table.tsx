import type { ReactNode } from 'react'

/**
 * 表の共通ラッパー。横スクロールと罫線・角丸を統一する。
 * 使用例:
 *   <TableShell><table className={tableClass}>...</table></TableShell>
 */
export function TableShell({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`bg-surface border border-line rounded-card overflow-hidden ${className}`}>
      <div className="overflow-x-auto">{children}</div>
    </div>
  )
}

export const tableClass = 'w-full text-sm'
export const theadClass = 'bg-canvas text-left text-xs text-subtle'
export const thClass = 'px-4 py-3 font-medium whitespace-nowrap'
export const tdClass = 'px-4 py-3 border-t border-line align-middle'
export const tdNumClass = 'px-4 py-3 border-t border-line align-middle text-right tabular-nums'
