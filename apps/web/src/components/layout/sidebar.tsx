'use client'

import { useState, useEffect, useRef, useMemo } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useAccount } from '@/contexts/account-context'
import type { AccountWithStats } from '@/contexts/account-context'
import { api, type SystemStatus } from '@/lib/api'

import { type RoleMode, ROLE_LABELS, filterMenuByRole, filterMenuForGifting, menuSections } from './menu'

function AccountAvatar({ account, size = 32 }: { account: AccountWithStats; size?: number }) {
  const displayName = account.displayName || account.name
  if (account.pictureUrl) {
    return (
      <img src={account.pictureUrl} alt={displayName}
        className="rounded-full object-cover shrink-0"
        style={{ width: size, height: size }} />
    )
  }
  return (
    <div className="rounded-full flex items-center justify-center text-white font-bold shrink-0"
      style={{ width: size, height: size, backgroundColor: '#06C755', fontSize: size * 0.4 }}>
      {displayName.charAt(0)}
    </div>
  )
}

function AccountSwitcher() {
  const { accounts, selectedAccount, setSelectedAccountId, loading } = useAccount()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  if (loading || accounts.length === 0) return null

  const displayName = selectedAccount?.displayName || selectedAccount?.name || ''

  return (
    <div ref={ref} className="px-3 py-3 border-b border-gray-200">
      <button onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg hover:bg-gray-50 transition-colors">
        {selectedAccount && <AccountAvatar account={selectedAccount} size={28} />}
        <div className="flex-1 text-left min-w-0">
          <p className="text-sm font-medium text-gray-900 truncate">{displayName}</p>
        </div>
        <svg className={`w-4 h-4 text-gray-400 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div className="mt-1 bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden">
          {accounts.map((account) => {
            const isSelected = account.id === selectedAccount?.id
            const name = account.displayName || account.name
            return (
              <button key={account.id}
                onClick={() => { setSelectedAccountId(account.id); setOpen(false) }}
                className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-left transition-colors ${isSelected ? 'bg-green-50' : 'hover:bg-gray-50'}`}>
                <AccountAvatar account={account} size={24} />
                <div className="flex-1 min-w-0">
                  <p className={`text-sm truncate ${isSelected ? 'font-semibold text-green-700' : 'text-gray-700'}`}>{name}</p>
                  {account.basicId && <p className="text-xs text-gray-400 truncate">{account.basicId}</p>}
                </div>
                {isSelected && (
                  <svg className="w-4 h-4 text-green-600 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

function NavIcon({ d }: { d: string }) {
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={d} />
    </svg>
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
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div><h2 className="text-base font-bold text-gray-900">使い方ガイド</h2><p className="text-xs text-gray-400 mt-0.5">LINE Harness 管理画面</p></div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-400">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
        <div className="overflow-y-auto px-6 py-4 space-y-4">
          {helpSections.map((s) => (
            <div key={s.title} className="flex gap-3">
              <div className="flex-1 min-w-0"><p className="text-sm font-semibold text-gray-800">{s.title}</p><p className="text-xs text-gray-500 mt-0.5 leading-relaxed">{s.body}</p></div>
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
  const { selectedAccount } = useAccount()
  const [isOpen, setIsOpen] = useState(false)
  const [staffName, setStaffName] = useState<string | null>(null)
  const [staffRole, setStaffRole] = useState<string | null>(null)
  const [showHelp, setShowHelp] = useState(false)
  const [roleMode, setRoleMode] = useState<RoleMode>('admin')
  const [systemStatus, setSystemStatus] = useState<SystemStatus | null>(null)

  useEffect(() => {
    setStaffName(localStorage.getItem('lh_staff_name'))
    setStaffRole(localStorage.getItem('lh_staff_role'))
    try {
      const saved = localStorage.getItem('lh_role_mode') as RoleMode | null
      if (saved && ['cs', 'marketing', 'admin'].includes(saved)) setRoleMode(saved)
    } catch {}
  }, [])

  useEffect(() => {
    try { localStorage.setItem('lh_role_mode', roleMode) } catch {}
  }, [roleMode])

  useEffect(() => { setIsOpen(false) }, [pathname])

  useEffect(() => {
    let cancelled = false
    api.system.status()
      .then((res) => {
        if (!cancelled && res.success && res.data) setSystemStatus(res.data)
      })
      .catch(() => {
        if (!cancelled) setSystemStatus(null)
      })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    document.body.style.overflow = isOpen ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [isOpen])

  const isActive = (href: string) => href === '/' ? pathname === '/' : pathname.startsWith(href)

  const isGiftingWorkspace = /ギフティング|gifting/i.test(`${selectedAccount?.displayName || ''} ${selectedAccount?.name || ''}`)
  const displayedSections = useMemo(() => {
    return isGiftingWorkspace ? filterMenuForGifting(menuSections) : filterMenuByRole(menuSections, roleMode)
  }, [isGiftingWorkspace, roleMode])

  const sidebarContent = (
    <>
      <div className="px-6 py-5 border-b border-gray-200">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center text-white font-bold text-sm" style={{ backgroundColor: 'var(--color-brand-500)' }}>H</div>
          <div><p className="text-sm font-bold text-gray-900 leading-tight">LINE Harness</p><p className="text-xs text-gray-400">管理画面</p></div>
        </div>
      </div>

      {/* ─── ロールモード切替（ギフティング専用画面では表示しない） ─── */}
      {!isGiftingWorkspace && <div className="px-3 pt-3 pb-1 border-b border-gray-200">
        <div className="flex gap-1 bg-gray-100 rounded-lg p-0.5">
          {(['cs', 'marketing', 'admin'] as RoleMode[]).map((mode) => (
            <button key={mode} onClick={() => setRoleMode(mode)}
              className={`flex-1 text-xs py-1.5 rounded-md font-medium transition-colors ${
                roleMode === mode ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}>
              {mode === 'cs' ? '🎧 CS' : mode === 'marketing' ? '📈 マーケ' : '⚙️ 管理'}
            </button>
          ))}
        </div>
      </div>}

      <AccountSwitcher />
      <div className="px-3 pt-3">
        <button
          type="button"
          onClick={() => window.dispatchEvent(new Event('open-command-palette'))}
          className="w-full flex items-center gap-2 px-2.5 py-2 text-xs rounded-lg border border-line bg-canvas text-subtle hover:bg-surface hover:text-ink transition-colors"
          aria-label="画面を検索（⌘K）"
        >
          <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
          <span className="flex-1 text-left">画面を検索</span>
          <kbd className="text-[10px] border border-line rounded px-1 py-0.5 bg-surface">⌘K</kbd>
        </button>
        <p className="text-[10px] text-subtle mt-1 px-1">{isGiftingWorkspace ? 'ギフティング運用' : ROLE_LABELS[roleMode]}</p>
      </div>
      <nav className="flex-1 px-3 py-3 space-y-1 overflow-y-auto">
        {displayedSections.map((section, si) => (
          <div key={si}>
            {section.label && <div className="pt-4 pb-1 px-3"><p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">{section.label}</p></div>}
            {section.items.filter((item) => {
              if (item.href === '/staff' && staffRole !== 'owner' && staffRole !== 'admin') return false
              if (item.href === '/accounts' && staffRole === 'staff') return false
              return true
            }).map((item) => {
              const active = isActive(item.href)
              const isDanger = 'danger' in item && item.danger
              return (
                <Link key={item.href} href={item.href}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${active ? 'text-white' : isDanger ? 'text-red-500 hover:bg-red-50' : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'}`}
                  style={active ? { backgroundColor: isDanger ? '#EF4444' : '#06C755' } : {}}>
                  <NavIcon d={item.icon} />
                  {item.label}
                </Link>
              )
            })}
          </div>
        ))}
        {displayedSections.length === 0 && <div className="px-3 py-8 text-center"><p className="text-xs text-subtle">表示できるメニューがありません</p></div>}
      </nav>
      <div className="border-t border-gray-200">
        {staffName && (
          <div className="px-3 py-2 text-xs text-gray-500 border-t border-gray-100">
            <div className="font-medium text-gray-700">{staffName}</div>
            <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium mt-0.5 ${staffRole === 'owner' ? 'bg-yellow-100 text-yellow-800' : staffRole === 'admin' ? 'bg-blue-100 text-blue-800' : 'bg-gray-100 text-gray-600'}`}>{staffRole === 'owner' ? 'オーナー' : staffRole === 'admin' ? '管理者' : 'スタッフ'}</span>
          </div>
        )}
        <div className="px-6 py-4 space-y-3">
          <div className="text-xs text-gray-400" title={systemStatus ? `ビルド日時: ${systemStatus.buildTime}` : '稼働バージョンを確認できません'}>
            <p>LINE Harness v{systemStatus?.version ?? '確認中'}</p>
            <p className="mt-0.5 text-[10px]">
              稼働中: {systemStatus?.commit ?? '未確認'}
              {systemStatus?.buildTime ? ` / ${new Date(systemStatus.buildTime).toLocaleString('ja-JP')}` : ''}
            </p>
          </div>
          <button onClick={() => setShowHelp(true)} className="flex items-center gap-2 text-xs text-gray-500 hover:text-green-600 transition-colors">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            使い方
          </button>
          <button onClick={() => { localStorage.removeItem('lh_api_key'); localStorage.removeItem('lh_staff_name'); localStorage.removeItem('lh_staff_role'); router.push('/login') }} className="flex items-center gap-2 text-xs text-gray-400 hover:text-red-500 transition-colors">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>
            ログアウト
          </button>
        </div>
      </div>
    </>
  )

  return (
    <>
      {showHelp && <HelpModal onClose={() => setShowHelp(false)} />}
      <div className="lg:hidden fixed top-0 left-0 right-0 z-50 bg-white border-b border-gray-200 px-4 py-3 flex items-center gap-3">
        <button onClick={() => setIsOpen(!isOpen)} className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg hover:bg-gray-100 transition-colors" aria-label="メニュー">
          <svg className="w-6 h-6 text-gray-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            {isOpen ? <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /> : <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />}
          </svg>
        </button>
        <div className="flex items-center gap-2"><div className="w-7 h-7 rounded-lg flex items-center justify-center text-white font-bold text-xs" style={{ backgroundColor: 'var(--color-brand-500)' }}>H</div><p className="text-sm font-bold text-gray-900">LINE Harness</p></div>
        <button
          type="button"
          onClick={() => window.dispatchEvent(new Event('open-command-palette'))}
          className="ml-auto min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg hover:bg-gray-100 transition-colors"
          aria-label="画面を検索"
        >
          <svg className="w-5 h-5 text-gray-700" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
        </button>
      </div>
      {isOpen && <div className="lg:hidden fixed inset-0 z-40 bg-black/50" onClick={() => setIsOpen(false)} />}
      <aside className={`lg:hidden fixed top-0 left-0 z-50 w-72 bg-white flex flex-col h-screen transform transition-transform duration-300 ease-in-out ${isOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="absolute top-4 right-4">
          <button onClick={() => setIsOpen(false)} className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg hover:bg-gray-100" aria-label="閉じる">
            <svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
        {sidebarContent}
      </aside>
      <aside className="hidden lg:flex w-64 bg-white border-r border-gray-200 flex-col h-screen sticky top-0">
        {sidebarContent}
      </aside>
    </>
  )
}
