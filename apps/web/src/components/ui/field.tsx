import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react'

export const inputClass =
  'w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-subtle focus:outline-none focus:ring-2 focus:ring-brand-500'

/** ラベル付きの入力欄。プレースホルダーだけで意味を伝えない。 */
export function Field({
  label,
  htmlFor,
  hint,
  error,
  children,
  className = '',
}: {
  label: ReactNode
  htmlFor?: string
  hint?: ReactNode
  error?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <div className={className}>
      <label htmlFor={htmlFor} className="block text-xs font-medium text-subtle mb-1">
        {label}
      </label>
      {children}
      {hint && !error && <p className="mt-1 text-xs text-subtle">{hint}</p>}
      {error && <p className="mt-1 text-xs text-danger-600">{error}</p>}
    </div>
  )
}

export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  const { className = '', ...rest } = props
  return <input {...rest} className={`${inputClass} ${className}`} />
}

export function SelectInput(props: SelectHTMLAttributes<HTMLSelectElement>) {
  const { className = '', children, ...rest } = props
  return (
    <select {...rest} className={`${inputClass} ${className}`}>
      {children}
    </select>
  )
}
