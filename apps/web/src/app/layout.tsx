import type { Metadata } from 'next'
import './globals.css'
import AppShell from '@/components/app-shell'
import { ToastProvider } from '@/lib/toast'
import { ThemeProvider } from '@/lib/theme'
import ApiErrorWire from '@/components/api-error-wire'

export const metadata: Metadata = {
  title: 'LINE CRM 管理画面',
  description: 'LINE公式アカウント CRM 管理画面',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="ja" suppressHydrationWarning>
      <head>
        {/*
          ダークモードのフラッシュ防止用インラインスクリプト。
          hydration 前に <html> に dark クラスを適用する。
        */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              try {
                var t = localStorage.getItem('lh_theme');
                if (t === 'dark' || (!t && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
                  document.documentElement.classList.add('dark');
                }
              } catch(e) {}
            `,
          }}
        />
      </head>
      <body className="antialiased" style={{ fontFamily: "'Noto Sans JP', 'Hiragino Sans', 'Yu Gothic', system-ui, sans-serif" }}>
        <ThemeProvider>
          <ToastProvider>
            <ApiErrorWire />
            <AppShell>
              {children}
            </AppShell>
          </ToastProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
