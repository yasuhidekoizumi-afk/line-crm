import type { ReactNode } from 'react'

/** 情報のまとまり（1カード1話題）。 */
export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`bg-surface border border-line rounded-card shadow-card ${className}`}>{children}</div>
}

export function CardHeader({
  title,
  description,
  action,
}: {
  title: ReactNode
  description?: ReactNode
  action?: ReactNode
}) {
  return (
    <div className="flex items-start justify-between gap-3 px-5 pt-5">
      <div className="min-w-0">
        <h2 className="text-base font-semibold text-ink truncate">{title}</h2>
        {description && <p className="mt-0.5 text-xs text-subtle">{description}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  )
}

export function CardBody({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`px-5 py-4 ${className}`}>{children}</div>
}
