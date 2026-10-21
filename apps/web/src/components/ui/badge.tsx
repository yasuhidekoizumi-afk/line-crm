import type { ReactNode } from 'react'

type Tone = 'success' | 'warn' | 'danger' | 'info' | 'neutral' | 'brand'

const TONES: Record<Tone, string> = {
  success: 'bg-green-50 text-green-700',
  warn: 'bg-amber-50 text-amber-700',
  danger: 'bg-red-50 text-red-700',
  info: 'bg-blue-50 text-blue-700',
  neutral: 'bg-gray-100 text-gray-600',
  brand: 'bg-brand-50 text-brand-600',
}

/** 状態を表す小さなラベル。色の意味は docs/design-system.md の Badge を参照。 */
export default function Badge({
  tone = 'neutral',
  children,
  className = '',
}: {
  tone?: Tone
  children: ReactNode
  className?: string
}) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${TONES[tone]} ${className}`}>
      {children}
    </span>
  )
}
