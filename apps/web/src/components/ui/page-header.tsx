import type { ReactNode } from 'react'

/** 画面共通の見出し。自前の h1 は作らない。 */
export default function PageHeader({
  title,
  description,
  actions,
}: {
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
}) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-xl sm:text-2xl font-bold text-ink tracking-tight">{title}</h1>
        {description && <p className="mt-1 text-sm text-subtle">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </div>
  )
}
