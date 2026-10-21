'use client'

import type { ButtonHTMLAttributes, ReactNode } from 'react'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'
type Size = 'sm' | 'md'

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-brand-500 text-white hover:bg-brand-600 focus-visible:ring-brand-500',
  secondary: 'bg-surface text-ink border border-line hover:bg-canvas focus-visible:ring-brand-500',
  ghost: 'bg-transparent text-subtle hover:bg-canvas hover:text-ink focus-visible:ring-brand-500',
  danger: 'bg-danger-600 text-white hover:bg-red-700 focus-visible:ring-red-500',
}

const SIZES: Record<Size, string> = {
  sm: 'h-8 px-3 text-xs gap-1.5',
  md: 'h-10 px-4 text-sm gap-2',
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  loading?: boolean
  children?: ReactNode
}

/** 画面共通のボタン。見た目のバリエーションは docs/design-system.md の Button を参照。 */
export default function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled,
  className = '',
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center rounded-lg font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 disabled:opacity-50 disabled:cursor-not-allowed ${VARIANTS[variant]} ${SIZES[size]} ${className}`}
    >
      {loading && (
        <span className="w-3.5 h-3.5 rounded-full border-2 border-current border-t-transparent animate-spin" aria-hidden />
      )}
      {children}
    </button>
  )
}
