/**
 * サイドバーと ⌘K 検索で共有するメニュー定義。
 * 画面を追加したらここに1行足す（サイドバーと検索の両方に出る）。
 */

export type RoleMode = 'cs' | 'marketing' | 'admin'

export const ROLE_LABELS: Record<RoleMode, string> = {
  cs: 'CS対応',
  marketing: 'マーケティング',
  admin: '管理（全機能）',
}

// CSモードで表示するメニューのhrefリスト
export const CS_MENU_HREFS = new Set([
  '/', '/friends', '/chats', '/cs', '/loyalty',
  '/staff', '/accounts', '/emergency',
])

// マーケティングモードで表示するメニューのhrefリスト
export const MARKETING_MENU_HREFS = new Set([
  '/', '/scenarios', '/broadcasts', '/tracked-links', '/templates', '/rich-menus', '/reminders', '/egift-pilot',
  '/shopify-bi', '/crm-weekly', '/affiliates', '/affiliate-program', '/conversions', '/scoring',
  '/crm-campaign-report',
  '/loyalty', '/automations', '/webhooks',
  '/email/campaigns', '/email/flows', '/email/templates', '/customers', '/segments',
  '/email/forms', '/email/reviews', '/email/sms', '/email/insights', '/email/analytics',
  '/email/settings', '/email/logs',
])

// ギフティング専用アカウントは、担当者が日々使う3機能だけを表示する。
// ページや既存データは削除せず、ほかのLINEアカウントを選んだ際は従来どおり利用できる。
export const GIFTING_MENU_HREFS = new Set(['/influencers', '/chats', '/broadcasts'])

export function filterMenuByRole(sections: typeof menuSections, role: RoleMode) {
  if (role === 'admin') return sections
  const allowed = role === 'cs' ? CS_MENU_HREFS : MARKETING_MENU_HREFS
  return sections
    .map((s) => ({ ...s, items: s.items.filter((i) => allowed.has(i.href)) }))
    .filter((s) => s.items.length > 0)
}

export function filterMenuForGifting(sections: typeof menuSections) {
  return sections
    .map((section) => ({ ...section, items: section.items.filter((item) => GIFTING_MENU_HREFS.has(item.href)) }))
    .filter((section) => section.items.length > 0)
}

// ─── メニュー定義 ───

export const menuSections = [
  {
    label: '今日',
    items: [
      { href: '/', label: 'ダッシュボード', icon: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6' },
      { href: '/chats', label: '個別チャット', icon: 'M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z' },
      { href: '/cs', label: 'CSダッシュボード', icon: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z' },
      { href: '/notifications', label: '通知', icon: 'M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9' },
    ],
  },
  {
    label: 'LINE配信',
    items: [
      { href: '/scenarios', label: 'LINEシナリオ', icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01' },
      { href: '/broadcasts', label: 'LINE一斉配信', icon: 'M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z' },
      { href: '/templates', label: 'LINEテンプレート', icon: 'M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z' },
      { href: '/rich-menus', label: 'リッチメニュー', icon: 'M4 6a2 2 0 012-2h12a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM4 14a2 2 0 012-2h4a2 2 0 012 2v4a2 2 0 01-2 2H6a2 2 0 01-2-2v-4zM14 14a2 2 0 012-2h2a2 2 0 012 2v4a2 2 0 01-2 2h-2a2 2 0 01-2-2v-4z' },
      { href: '/reminders', label: 'リマインダ', icon: 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z' },
      { href: '/tracked-links', label: '計測リンク', icon: 'M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1' },
      { href: '/egift-pilot', label: 'eGiftパイロット', icon: 'M12 8v13m0-13V6a2 2 0 112-2 2 2 0 01-2 2m0 0V5.5A2.5 2.5 0 109.5 8H12m7 5v6a2 2 0 01-2 2H7a2 2 0 01-2-2v-6m-2-5h18v3a1 1 0 01-1 1H4a1 1 0 01-1-1V8z' },
    ],
  },
  {
    label: '顧客',
    items: [
      { href: '/customers', label: 'LINE顧客', icon: 'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z' },
      { href: '/segments', label: 'セグメント', icon: 'M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10' },
      { href: '/tags', label: 'タグ管理', icon: 'M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z' },
      { href: '/loyalty', label: 'ポイント管理', icon: 'M12 2l3.09 6.26L22 9.27l-5 4.87L18.18 21 12 17.77 5.82 21 7 14.14l-5-4.87 6.91-1.01L12 2z' },
      { href: '/influencers', label: 'インフルエンサー管理', icon: 'M17 20h5v-2a3 3 0 00-5.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 012-2 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2' },
      { href: '/email/forms', label: 'フォーム', icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4' },
      { href: '/email/reviews', label: 'レビュー', icon: 'M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z' },
      { href: '/email/sms', label: 'SMS配信', icon: 'M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z' },
    ],
  },
  {
    label: '分析',
    items: [
      { href: '/shopify-bi', label: '売上分析', icon: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z' },
      { href: '/crm-campaign-report', label: 'CRMキャンペーン分析', icon: 'M11 3a1 1 0 011 1v12.586l3.293-3.293a1 1 0 111.414 1.414l-5 5a1 1 0 01-1.414 0l-5-5a1 1 0 111.414-1.414L10 16.586V4a1 1 0 011-1z' },
      { href: '/crm-weekly', label: 'CRM週次レポート', icon: 'M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z' },
      { href: '/affiliates', label: '流入経路', icon: 'M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1' },
      { href: '/affiliate-program', label: '自社アフィリエイト', icon: 'M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1' },
      { href: '/conversions', label: 'CV計測', icon: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z' },
      { href: '/scoring', label: 'スコアリング', icon: 'M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z' },
    ],
  },
  {
    label: '設定',
    items: [
      { href: '/automations', label: 'オートメーション', icon: 'M13 10V3L4 14h7v7l9-11h-7z' },
      { href: '/webhooks', label: 'Webhook', icon: 'M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z' },
      { href: '/staff', label: 'スタッフ管理', icon: 'M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z' },
      { href: '/accounts', label: 'LINEアカウント', icon: 'M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4' },
      { href: '/users', label: 'UUID管理', icon: 'M10 6H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V8a2 2 0 00-2-2h-5m-4 0V5a2 2 0 114 0v1m-4 0a2 2 0 104 0m-5 8a2 2 0 100-4 2 2 0 000 4zm0 0c1.306 0 2.417.835 2.83 2M9 14a3.001 3.001 0 00-2.83 2M15 11h3m-3 4h2' },
      { href: '/health', label: 'BAN検知', icon: 'M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z' },
      { href: '/emergency', label: '緊急コントロール', icon: 'M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.072 16.5c-.77.833.192 2.5 1.732 2.5z', danger: true },
    ],
  },
]

/** ⌘K 検索にだけ出すページ（サイドバーには並べない詳細・設定画面） */
export const extraCommandPages: Array<{ href: string; label: string }> = [
  { href: '/friends', label: '友だち管理（旧ページ）' },
  { href: '/form-submissions', label: 'フォーム回答' },
  { href: '/email/settings', label: 'FERMENT設定' },
  { href: '/email/logs', label: 'メール配信ログ' },
  { href: '/email/insights', label: 'メールインサイト' },
  { href: '/email/analytics', label: 'メール分析' },
  { href: '/email/campaigns', label: 'メールキャンペーン' },
  { href: '/email/flows', label: 'メールフロー' },
  { href: '/rakuten-mailmag', label: '楽天メルマガ' },
  { href: '/cs/settings', label: 'CS設定' },
]
