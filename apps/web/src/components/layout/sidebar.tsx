'use client'

import { useState, useEffect, useRef, useMemo } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useAccount } from '@/contexts/account-context'
import type { AccountWithStats } from '@/contexts/account-context'
import { useTheme } from '@/lib/theme'

// ─── メニュー定義（全30ルート） ───

interface MenuItem {
  href: string
  label: string
  key?: string
  icon: string
  danger?: boolean
  adminOnly?: boolean  // owner/admin のみ表示
}

interface MenuSection {
  label: string | null
  items: MenuItem[]
}

const menuSections: MenuSection[] = [
  {
    label: null,
    items: [
      { href: '/', label: 'ダッシュボード', key: 'd', icon: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6' },
      { href: '/cs', label: 'CSダッシュボード', key: 'x', icon: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z' },
      { href: '/health', label: 'ヘルスチェック', icon: 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z' },
    ],
  },
  {
    label: '顧客',
    items: [
      { href: '/friends', label: '友だち管理', key: 'f', icon: 'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z' },
      { href: '/customers', label: '統合顧客', icon: 'M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197m2-9.875a4 4 0 118 0 4 4 0 01-8 0z' },
      { href: '/segments', label: 'セグメント', icon: 'M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10' },
      { href: '/scoring', label: 'スコアリング', icon: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z' },
      { href: '/loyalty', label: 'ロイヤルティ', icon: 'M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z' },
    ],
  },
  {
    label: '配信',
    items: [
      { href: '/scenarios', label: 'LINEシナリオ', key: 'n', icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01' },
      { href: '/broadcasts', label: 'LINE一斉配信', key: 'b', icon: 'M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z' },
      { href: '/reminders', label: 'リマインダー', key: 'r', icon: 'M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9' },
      { href: '/templates', label: 'テンプレート', icon: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z' },
    ],
  },
  {
    label: '自動化',
    items: [
      { href: '/automations', label: 'オートメーション', key: 'a', icon: 'M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15' },
      { href: '/webhooks', label: 'Webhook', icon: 'M8.111 16.404a5.5 5.5 0 017.778 0M12 20h.01m-7.08-7.071c3.904-3.905 10.236-3.905 14.141 0M1.394 9.393c5.857-5.858 15.355-5.858 21.213 0' },
      { href: '/notifications', label: '通知ルール', icon: 'M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9' },
      { href: '/form-submissions', label: 'フォーム送信', icon: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z' },
    ],
  },
  {
    label: '分析',
    items: [
      { href: '/conversions', label: 'コンバージョン', icon: 'M13 7h8m0 0v8m0-8l-8 8-4-4-6 6' },
      { href: '/shopify-bi', label: 'Shopify BI', icon: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z' },
      { href: '/affiliates', label: 'アフィリエイト', icon: 'M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z' },
    ],
  },
  {
    label: 'チャット',
    items: [
      { href: '/chats', label: '個別チャット', key: 'c', icon: 'M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z' },
    ],
  },
  {
    label: 'FERMENT メール',
    items: [
      { href: '/email/campaigns', label: 'メールキャンペーン', icon: 'M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z' },
      { href: '/email/flows', label: 'メールフロー', icon: 'M13 5l7 7-7 7M5 5l7 7-7 7' },
      { href: '/email/forms', label: 'フォーム', icon: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z' },
      { href: '/email/reviews', label: 'レビュー', icon: 'M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z' },
      { href: '/email/sms', label: 'SMS', icon: 'M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z' },
      { href: '/email/templates', label: 'メールテンプレート', icon: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z' },
      { href: '/email/settings', label: 'メール設定', icon: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z' },
      { href: '/email/logs', label: 'メールログ', icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2' },
      { href: '/email/insights', label: 'メールインサイト', icon: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z' },
      { href: '/email/analytics', label: 'メール分析', icon: 'M16 8v8m-4-5v5m-4-2v2m-2 4h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z' },
    ],
  },
  {
    label: 'LINE管理',
    items: [
      { href: '/accounts', label: 'アカウント管理', adminOnly: true, icon: 'M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4' },
      { href: '/rich-menus', label: 'リッチメニュー', icon: 'M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zm10 0a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zm10 0a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z' },
      { href: '/staff', label: 'スタッフ管理', adminOnly: true, icon: 'M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z' },
      { href: '/users', label: 'ユーザー管理', adminOnly: true, icon: 'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z' },
    ],
  },
  {
    label: 'システム',
    items: [
      { href: '/emergency', label: '緊急コントロール', icon: 'M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.072 16.5c-.77.833.192 2.5 1.732 2.5z', danger: true },
    ],
  },
]

const ALL_ITEMS = menuSections.flatMap((s) => s.items)

function AccountAvatar({ account, size = 32 }: { account: AccountWithStats; size?: number }) {
  const displayName = account.displayName || account.name
  if (account.pictureUrl) {
    return <img src={account.pictureUrl} alt={displayName} className="rounded-full object-cover shrink-0" style={{ width: size, height: size }} />
  }
  return (
    <div className="rounded-full flex items-center justify-center text-white font-bold shrink-0" style={{ width: size, height: size, backgroundColor: '#06C755', fontSize: size * 0.4 }}>
      {displayName.charAt(0)}
    </div>
  )
}

function AccountSwitcher() {
  const { accounts, selectedAccount, setSelectedAccountId, loading } = useAccount()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const handler = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])
  if (loading || accounts.length === 0) return null
  const displayName = selectedAccount?.displayName || selectedAccount?.name || ''
  return (
    <div ref={ref} className="px-3 py-3 border-b border-gray-200 dark:border-gray-700">
      <button onClick={() => setOpen(!open)} className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
        {selectedAccount && <AccountAvatar account={selectedAccount} size={28} />}
        <div className="flex-1 text-left min-w-0">
          <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{displayName}</p>
        </div>
        <svg className={`w-4 h-4 text-gray-400 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div className="mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg overflow-hidden">
          {accounts.map((account) => {
            const isSelected = account.id === selectedAccount?.id
            const name = account.displayName || account.name
            return (
              <button key={account.id} onClick={() => { setSelectedAccountId(account.id); setOpen(false) }}
                className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-left transition-colors ${isSelected ? 'bg-green-50 dark:bg-green-900/30' : 'hover:bg-gray-50 dark:hover:bg-gray-700/50'}`}>
                <AccountAvatar account={account} size={24} />
                <div className="flex-1 min-w-0">
                  <p className={`text-sm truncate ${isSelected ? 'font-semibold text-green-700 dark:text-green-400' : 'text-gray-700 dark:text-gray-300'}`}>{name}</p>
                  {account.basicId && <p className="text-xs text-gray-400 dark:text-gray-500 truncate">{account.basicId}</p>}
                </div>
                {isSelected && <svg className="w-4 h-4 text-green-600 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

function NavIcon({ d }: { d: string }) {
  return <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={d} /></svg>
}

// ─── ショートカットヘルプ ───
const shortcuts = [
  { keys: '?', desc: 'このヘルプを開く' },
  { keys: '/', desc: 'メニュー検索にフォーカス' },
  { keys: 'g → d', desc: 'ダッシュボード' },
  { keys: 'g → f', desc: '友だち管理' },
  { keys: 'g → c', desc: '個別チャット' },
  { keys: 'g → n', desc: 'LINEシナリオ' },
  { keys: 'g → b', desc: 'LINE一斉配信' },
  { keys: 'g → r', desc: 'リマインダー' },
  { keys: 'g → a', desc: 'オートメーション' },
  { keys: 'g → x', desc: 'CSダッシュボード' },
  { keys: 'Escape', desc: '検索クリア / モーダルを閉じる' },
]

function ShortcutHelp({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50" onClick={onClose}>
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-sm max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-700">
          <h2 className="text-base font-bold text-gray-900 dark:text-gray-100">⌨ キーボードショートカット</h2>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
        <div className="overflow-y-auto px-6 py-4 space-y-3">
          {shortcuts.map((s) => (
            <div key={s.keys} className="flex items-center justify-between">
              <span className="text-sm text-gray-600 dark:text-gray-400">{s.desc}</span>
              <kbd className="ml-4 inline-flex items-center gap-1 px-2 py-1 rounded-md bg-gray-100 dark:bg-gray-700 text-xs font-mono font-semibold text-gray-700 dark:text-gray-300 border border-gray-200 dark:border-gray-600 shadow-sm">
                {s.keys.split('→').map((part, i) => (
                  <span key={i}>
                    {i > 0 && <span className="text-gray-400 mx-0.5">→</span>}
                    <span className="bg-white dark:bg-gray-900 px-1.5 py-0.5 rounded border border-gray-200 dark:border-gray-600">{part.trim()}</span>
                  </span>
                ))}
              </kbd>
            </div>
          ))}
        </div>
        <div className="px-6 py-3 border-t border-gray-100 dark:border-gray-700">
          <p className="text-xs text-gray-400">これらのショートカットはどの画面でも使えます。</p>
        </div>
      </div>
    </div>
  )
}

// ─── 使い方ガイド ───
const helpSections = [
  { title: '📋 全体の仕組み', body: 'お客さまがLINE公式アカウントを友だち追加すると、このシステムに自動で登録されます。その後、タグ付けやメッセージ配信を自動で行うことができます。Shopifyで購入が完了した場合も、自動でタグが付いてメッセージが送られます。' },
  { title: '👥 友だち管理', body: 'LINEで友だち追加してくれたお客さまの一覧です。名前・タグ・登録日などで検索・絞り込みができます。お客さまの名前をクリックすると詳細（タグ・配信履歴・個別チャット）を確認できます。' },
  { title: '🏷️ タグ（お客さまの分類）', body: '「購入済み」「VIP」「初回クーポン使用」など、お客さまにラベルを貼る機能です。タグを使うことで「購入済みの人だけに配信する」「VIPの人に特別なメッセージを送る」といった絞り込みができます。タグは手動でも自動（オートメーション）でも付けられます。' },
  { title: '📨 シナリオ配信（ステップ配信）', body: '「友だち追加の翌日にサンキューメッセージ」「購入3日後にレビュー依頼」など、決まったタイミングでメッセージを自動送信する機能です。一度設定すれば、その後は何もしなくても全員に自動で送られます。' },
  { title: '⚡ オートメーション（自動化ルール）', body: '「〇〇が起きたら△△する」というルールを設定する機能です。例：「購入済みタグが付いたら→購入後フローのシナリオに登録する」。設定しておくと人の手が不要になります。' },
  { title: '🔗 Shopify連携', body: 'oryzae.shopで購入が完了すると、GASが自動で動き、「購入済み」タグを付けて「購入後フロー」シナリオに登録します。' },
  { title: '🔑 ログイン', body: 'ログインにはAPIキーが必要です。APIキーは右下の「CCに依頼」ボタンでClaudeに確認するか、スタッフ管理画面で発行できます。' },
]

function HelpModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50" onClick={onClose}>
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-md max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-700">
          <div><h2 className="text-base font-bold text-gray-900 dark:text-gray-100">使い方ガイド</h2><p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">LINE Harness 管理画面</p></div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
        <div className="overflow-y-auto px-6 py-4 space-y-4">
          {helpSections.map((s) => (
            <div key={s.title} className="flex gap-3">
              <div className="flex-1 min-w-0"><p className="text-sm font-semibold text-gray-800 dark:text-gray-200">{s.title}</p><p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 leading-relaxed">{s.body}</p></div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export default function Sidebar() {
  const pathname = usePathname()
  const router = useRouter()
  const { theme, toggle: toggleTheme } = useTheme()
  const [isOpen, setIsOpen] = useState(false)
  const [staffName, setStaffName] = useState<string | null>(null)
  const [staffRole, setStaffRole] = useState<string | null>(null)
  const [showHelp, setShowHelp] = useState(false)
  const [showShortcuts, setShowShortcuts] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)

  // ─── キーボードショートカット ───
  useEffect(() => {
    let gPressed = false
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tag)) return

      if (e.key === '?' && !e.shiftKey) {
        setShowShortcuts((v) => !v)
        return
      }

      if (e.key === 'g') { gPressed = true; return }
      if (gPressed) {
        gPressed = false
        const navMap: Record<string, string> = {}
        for (const item of ALL_ITEMS) {
          if (item.key) navMap[item.key] = item.href
        }
        const href = navMap[e.key]
        if (href) {
          e.preventDefault()
          router.push(href)
        }
        return
      }

      setTimeout(() => { gPressed = false }, 1000)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [router])

  useEffect(() => {
    setStaffName(localStorage.getItem('lh_staff_name'))
    setStaffRole(localStorage.getItem('lh_staff_role'))
  }, [])

  useEffect(() => { setIsOpen(false) }, [pathname])
  useEffect(() => {
    document.body.style.overflow = isOpen ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [isOpen])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === '/' && document.activeElement !== searchRef.current && document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') {
        e.preventDefault()
        searchRef.current?.focus()
      }
      if (e.key === 'Escape') { setSearchQuery(''); searchRef.current?.blur() }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  const isActive = (href: string) => href === '/' ? pathname === '/' : pathname.startsWith(href)

  const q = searchQuery.toLowerCase().trim()
  const filteredSections = useMemo(() => {
    if (!q) return menuSections
    return menuSections
      .map((s) => ({ ...s, items: s.items.filter((i) => i.label.toLowerCase().includes(q) || i.href.toLowerCase().includes(q)) }))
      .filter((s) => s.items.length > 0)
  }, [q])

  const sidebarContent = (
    <>
      <div className="px-6 py-5 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center text-white font-bold text-sm" style={{ backgroundColor: '#06C755' }}>H</div>
          <div><p className="text-sm font-bold text-gray-900 dark:text-gray-100 leading-tight">LINE Harness</p><p className="text-xs text-gray-400 dark:text-gray-500">管理画面</p></div>
        </div>
      </div>
      <AccountSwitcher />
      <div className="px-3 pt-3">
        <div className="relative">
          <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
          <input ref={searchRef} type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="メニューを検索..." className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-800 focus:bg-white dark:focus:bg-gray-700 focus:border-green-400 focus:outline-none focus:ring-2 focus:ring-green-200 dark:focus:ring-green-800 transition-colors text-gray-900 dark:text-gray-100" aria-label="メニューを検索" />
          {searchQuery && <button onClick={() => { setSearchQuery(''); searchRef.current?.focus() }} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600" aria-label="クリア"><svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg></button>}
        </div>
      </div>
      <nav className="flex-1 px-3 py-3 space-y-1 overflow-y-auto">
        {filteredSections.map((section, si) => {
          // 権限フィルタ
          const visibleItems = section.items.filter((item) => {
            if (item.adminOnly && staffRole !== 'owner' && staffRole !== 'admin') return false
            return true
          })
          if (visibleItems.length === 0) return null
          return (
            <div key={si}>
              {section.label && <div className="pt-4 pb-1 px-3"><p className="text-[11px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">{section.label}</p></div>}
              {visibleItems.map((item) => {
                const active = isActive(item.href)
                const isDanger = item.danger
                return (
                  <Link key={item.href} href={item.href}
                    className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${active ? 'text-white' : isDanger ? 'text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30' : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700/50 hover:text-gray-900 dark:hover:text-gray-100'}`}
                    style={active ? { backgroundColor: isDanger ? '#EF4444' : '#06C755' } : {}}>
                    <NavIcon d={item.icon} />
                    <span className="flex-1">{item.label}</span>
                    {item.key && <kbd className="text-[10px] text-gray-400 dark:text-gray-500 font-mono bg-gray-100 dark:bg-gray-700 rounded px-1.5 py-0.5 border border-gray-200 dark:border-gray-600">{item.key}</kbd>}
                  </Link>
                )
              })}
            </div>
          )
        })}
        {filteredSections.length === 0 && <div className="px-3 py-8 text-center"><p className="text-xs text-gray-400 dark:text-gray-500">「{searchQuery}」に一致するメニューがありません</p></div>}
      </nav>
      <div className="border-t border-gray-200 dark:border-gray-700">
        {staffName && (
          <div className="px-3 py-2 text-xs text-gray-500 dark:text-gray-400 border-t border-gray-100 dark:border-gray-700">
            <div className="font-medium text-gray-700 dark:text-gray-300">{staffName}</div>
            <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium mt-0.5 ${staffRole === 'owner' ? 'bg-yellow-100 dark:bg-yellow-900/40 text-yellow-800 dark:text-yellow-300' : staffRole === 'admin' ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-800 dark:text-blue-300' : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400'}`}>{staffRole === 'owner' ? 'オーナー' : staffRole === 'admin' ? '管理者' : 'スタッフ'}</span>
          </div>
        )}
        <div className="px-6 py-4 space-y-3">
          <p className="text-xs text-gray-400 dark:text-gray-500">LINE Harness v{process.env.APP_VERSION || '0.0.0'}</p>
          <button onClick={() => setShowShortcuts(true)} className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400 hover:text-green-600 dark:hover:text-green-400 transition-colors">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
            ショートカット
          </button>
          <button onClick={() => setShowHelp(true)} className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400 hover:text-green-600 dark:hover:text-green-400 transition-colors">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            使い方
          </button>
          <button onClick={toggleTheme} className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400 hover:text-green-600 dark:hover:text-green-400 transition-colors">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              {theme === 'dark'
                ? <><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" /></>
                : <><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" /></>
              }
            </svg>
            {theme === 'dark' ? 'ライトモード' : 'ダークモード'}
          </button>
          <button onClick={() => { localStorage.removeItem('lh_api_key'); localStorage.removeItem('lh_staff_name'); localStorage.removeItem('lh_staff_role'); router.push('/login') }} className="flex items-center gap-2 text-xs text-gray-400 dark:text-gray-500 hover:text-red-500 dark:hover:text-red-400 transition-colors">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>
            ログアウト
          </button>
        </div>
      </div>
    </>
  )

  return (
    <>
      {showShortcuts && <ShortcutHelp onClose={() => setShowShortcuts(false)} />}
      {showHelp && <HelpModal onClose={() => setShowHelp(false)} />}
      <div className="lg:hidden fixed top-0 left-0 right-0 z-50 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 px-4 py-3 flex items-center gap-3">
        <button onClick={() => setIsOpen(!isOpen)} className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors" aria-label="メニュー">
          <svg className="w-6 h-6 text-gray-700 dark:text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            {isOpen ? <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /> : <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />}
          </svg>
        </button>
        <div className="flex items-center gap-2"><div className="w-7 h-7 rounded-lg flex items-center justify-center text-white font-bold text-xs" style={{ backgroundColor: '#06C755' }}>H</div><p className="text-sm font-bold text-gray-900 dark:text-gray-100">LINE Harness</p></div>
      </div>
      {isOpen && <div className="lg:hidden fixed inset-0 z-40 bg-black/50" onClick={() => setIsOpen(false)} />}
      <aside className={`lg:hidden fixed top-0 left-0 z-50 w-72 bg-white dark:bg-gray-900 flex flex-col h-screen transform transition-transform duration-300 ease-in-out ${isOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="absolute top-4 right-4">
          <button onClick={() => setIsOpen(false)} className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700" aria-label="閉じる">
            <svg className="w-5 h-5 text-gray-500 dark:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
        {sidebarContent}
      </aside>
      <aside className="hidden lg:flex w-64 bg-white dark:bg-gray-900 border-r border-gray-200 dark:border-gray-700 flex-col h-screen sticky top-0">
        {sidebarContent}
      </aside>
    </>
  )
}
