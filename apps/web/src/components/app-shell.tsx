'use client'
import { usePathname } from 'next/navigation'
import Sidebar from './layout/sidebar'
import CommandPalette from './layout/command-palette'
import AuthGuard from './auth-guard'
import { AccountProvider } from '@/contexts/account-context'

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()

  if (pathname === '/login') {
    return <>{children}</>
  }

  return (
    <AuthGuard>
      <AccountProvider>
        <div className="flex min-h-screen">
          <Sidebar />
          <CommandPalette />
          <main className="flex-1 pt-[72px] px-4 pb-6 sm:px-6 lg:pt-0 lg:px-8 lg:pb-8 overflow-auto">
            {children}
          </main>
        </div>
      </AccountProvider>
    </AuthGuard>
  )
}
