import React from 'react'

interface HeaderProps {
  title: string
  description?: string
  /** @deprecated 新規は actions を使う（複数操作を並べられる） */
  action?: React.ReactNode
  actions?: React.ReactNode
}

/**
 * 画面共通の見出し。デザイン定義 v1 に合わせて PageHeader と同じ見た目にしている。
 * 新規画面は components/ui/page-header を使うこと。
 */
export default function Header({ title, description, action, actions }: HeaderProps) {
  const right = actions ?? action
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-xl sm:text-2xl font-bold text-ink tracking-tight">{title}</h1>
        {description && <p className="mt-1 text-sm text-subtle">{description}</p>}
      </div>
      {right && <div className="flex items-center gap-2 shrink-0">{right}</div>}
    </div>
  )
}
