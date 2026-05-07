'use client'

interface EmptyStateProps {
  title: string
  description: string
  actionLabel?: string
  actionHref?: string
  icon?: React.ReactNode
  onAction?: () => void
}

export default function EmptyState({
  title,
  description,
  actionLabel,
  actionHref,
  icon,
  onAction,
}: EmptyStateProps) {
  const IconEl =
    icon ?? (
      <svg className="w-12 h-12 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1.5}
          d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4"
        />
      </svg>
    )

  const Button = ({ children }: { children: React.ReactNode }) =>
    actionHref ? (
      <a
        href={actionHref}
        className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold text-white shadow-sm transition-colors"
        style={{ backgroundColor: '#06C755' }}
      >
        {children}
      </a>
    ) : (
      <button
        onClick={onAction}
        className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold text-white shadow-sm transition-colors"
        style={{ backgroundColor: '#06C755' }}
      >
        {children}
      </button>
    )

  return (
    <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
      <div className="mb-4">{IconEl}</div>
      <h3 className="text-lg font-bold text-gray-900 mb-2">{title}</h3>
      <p className="text-sm text-gray-500 max-w-sm mb-6 leading-relaxed">{description}</p>
      {actionLabel && <Button>{actionLabel}</Button>}
    </div>
  )
}
