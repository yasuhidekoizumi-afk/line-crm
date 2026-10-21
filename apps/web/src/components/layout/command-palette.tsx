'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAccount } from '@/contexts/account-context'
import { filterMenuByRole, filterMenuForGifting, menuSections, extraCommandPages, type RoleMode } from './menu'

interface Entry {
  href: string
  label: string
  section: string
}

const SYNONYMS: Record<string, string> = {
  '/': 'ホーム トップ ダッシュボード kpi',
  '/chats': 'チャット 返信 会話 cs 問い合わせ',
  '/cs': 'cs カスタマーサポート 対応',
  '/notifications': '通知 お知らせ アラート',
  '/scenarios': 'シナリオ ステップ配信 自動',
  '/broadcasts': '配信 一斉 ブロードキャスト 予約',
  '/templates': 'テンプレート 定型 文面',
  '/rich-menus': 'リッチメニュー メニュー',
  '/reminders': 'リマインダ 予約 リマインド',
  '/tracked-links': '計測 リンク クリック cta',
  '/egift-pilot': 'ギフト egift 当選 抽選',
  '/customers': '顧客 友だち 顧客一覧',
  '/segments': 'セグメント 抽出 条件',
  '/tags': 'タグ 分類',
  '/loyalty': 'ポイント 残高 特典 交換',
  '/influencers': 'インフルエンサー ギフティング 案件',
  '/email/forms': 'フォーム 登録 回答',
  '/email/reviews': 'レビュー 口コミ',
  '/email/sms': 'sms ショートメッセージ',
  '/shopify-bi': '売上 分析 bi 注文',
  '/crm-campaign-report': 'キャンペーン 分析 効果',
  '/crm-weekly': '週次 レポート 週報',
  '/affiliates': '流入 経路 参照元',
  '/affiliate-program': 'アフィリエイト 紹介 報酬',
  '/conversions': 'cv コンバージョン 計測',
  '/scoring': 'スコア ランク 判定',
  '/automations': '自動化 オートメーション トリガー',
  '/webhooks': 'webhook 連携 外部',
  '/staff': 'スタッフ 権限 メンバー',
  '/accounts': 'lineアカウント 公式 チャネル',
  '/users': 'uuid ユーザー 識別',
  '/health': 'ban ブロック 健全性 アカウント',
  '/emergency': '緊急 停止 配信停止',
}

/**
 * ⌘K / Ctrl+K で開く全画面検索。
 * サイドバーのメニューに加えて、直リンクの詳細・設定画面も検索できる。
 */
export default function CommandPalette() {
  const router = useRouter()
  const { selectedAccount } = useAccount()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const entries = useMemo<Entry[]>(() => {
    let role: RoleMode = 'admin'
    try {
      const saved = localStorage.getItem('lh_role_mode') as RoleMode | null
      if (saved && ['cs', 'marketing', 'admin'].includes(saved)) role = saved
    } catch { /* 未設定なら全表示 */ }

    const isGifting = /ギフティング|gifting/i.test(`${selectedAccount?.displayName || ''} ${selectedAccount?.name || ''}`)
    const sections = isGifting ? filterMenuForGifting(menuSections) : filterMenuByRole(menuSections, role)
    const fromMenu = sections.flatMap((section) =>
      section.items.map((item) => ({ href: item.href, label: item.label, section: section.label ?? 'メニュー' })),
    )
    const fromExtras = extraCommandPages.map((page) => ({ href: page.href, label: page.label, section: 'その他' }))
    return [...fromMenu, ...fromExtras]
  }, [selectedAccount])

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return entries
    return entries.filter((entry) => {
      const haystack = `${entry.label} ${entry.section} ${entry.href} ${SYNONYMS[entry.href] ?? ''}`.toLowerCase()
      return haystack.includes(q)
    })
  }, [entries, query])

  const close = useCallback(() => { setOpen(false); setQuery(''); setActiveIndex(0) }, [])
  const go = useCallback((href: string) => { close(); router.push(href) }, [close, router])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const isPaletteKey = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k'
      if (isPaletteKey) {
        e.preventDefault()
        setOpen((prev) => !prev)
        return
      }
      if (!open) return
      if (e.key === 'Escape') { e.preventDefault(); close() }
      if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIndex((i) => Math.min(i + 1, results.length - 1)) }
      if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIndex((i) => Math.max(i - 1, 0)) }
      if (e.key === 'Enter') {
        const target = results[activeIndex]
        if (target) { e.preventDefault(); go(target.href) }
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [activeIndex, close, go, open, results])

  useEffect(() => {
    const openHandler = () => setOpen(true)
    window.addEventListener('open-command-palette', openHandler)
    return () => window.removeEventListener('open-command-palette', openHandler)
  }, [])

  useEffect(() => {
    if (open) {
      setActiveIndex(0)
      window.setTimeout(() => inputRef.current?.focus(), 0)
    }
  }, [open])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[150] flex items-start justify-center bg-black/40 px-4 pt-[12vh]" onClick={close}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="画面を検索"
        className="w-full max-w-xl bg-surface rounded-card shadow-card border border-line overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-line px-4 py-3">
          <svg className="w-4 h-4 text-subtle shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => { setQuery(e.target.value); setActiveIndex(0) }}
            placeholder="画面を検索（例: 配信、ポイント、請求）"
            aria-label="画面を検索"
            className="flex-1 bg-transparent text-sm text-ink placeholder:text-subtle focus:outline-none"
          />
          <kbd className="text-[10px] text-subtle border border-line rounded px-1.5 py-0.5">esc</kbd>
        </div>
        <div className="max-h-[60vh] overflow-y-auto py-1">
          {results.length === 0 ? (
            <p className="px-4 py-8 text-center text-xs text-subtle">「{query}」に一致する画面がありません</p>
          ) : (
            results.map((entry, index) => {
              const active = index === activeIndex
              return (
                <button
                  key={`${entry.href}-${entry.label}`}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => go(entry.href)}
                  className={`w-full text-left px-4 py-2.5 flex items-center justify-between gap-3 ${active ? 'bg-brand-50' : 'hover:bg-canvas'}`}
                >
                  <span className="min-w-0">
                    <span className="block text-sm text-ink truncate">{entry.label}</span>
                    <span className="block text-[10px] text-subtle">{entry.section}</span>
                  </span>
                  <span className="text-[10px] text-subtle shrink-0">{entry.href}</span>
                </button>
              )
            })
          )}
        </div>
        <div className="border-t border-line px-4 py-2 flex items-center gap-3 text-[10px] text-subtle">
          <span>↑↓ 移動</span><span>Enter 開く</span><span>esc 閉じる</span>
        </div>
      </div>
    </div>
  )
}
