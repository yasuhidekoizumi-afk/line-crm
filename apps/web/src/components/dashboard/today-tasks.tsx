'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { fetchApi } from '@/lib/api'

export default function TodayTasks() {
  const [tasks, setTasks] = useState<{
    unreadChats: number
    inProgressChats: number
    lowLinkRateMonths: number
    draftAIReady: number
  } | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const [chatsRes, cohortRes] = await Promise.all([
          fetchApi<{ success: boolean; data: unknown[] }>('/api/chats?status=unread'),
          fetchApi<{ success: boolean; data: { first_order_customers: number; line_link_rate_pct: number }[] }>('/api/customer-journey/cohort?from=2025-01&to=2026-12'),
        ])
        if (cancelled) return

        const unread = (chatsRes.success ? (chatsRes.data as unknown[]).length : 0)

        const inProgRes = await fetchApi<{ success: boolean; data: unknown[] }>('/api/chats?status=in_progress')
        const inProgress = (inProgRes.success ? (inProgRes.data as unknown[]).length : 0)

        const anomalies = cohortRes.success
          ? (cohortRes.data as { first_order_customers: number; line_link_rate_pct: number }[])
              .filter((c) => c.first_order_customers >= 200 && c.line_link_rate_pct < 15).length
          : 0

        setTasks({
          unreadChats: unread,
          inProgressChats: inProgress,
          lowLinkRateMonths: anomalies,
          draftAIReady: 0,
        })
      } catch { /* silent */ }
      setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [])

  if (loading || !tasks) return null

  const hasTasks = tasks.unreadChats > 0 || tasks.inProgressChats > 0 || tasks.lowLinkRateMonths > 0

  const items = [
    { label: '未読チャット', count: tasks.unreadChats, color: 'bg-red-500', href: '/chats', emoji: '💬' },
    { label: '対応中チャット', count: tasks.inProgressChats, color: 'bg-yellow-500', href: '/chats', emoji: '🔄' },
    { label: 'LINE連携注意月', count: tasks.lowLinkRateMonths, color: 'bg-orange-500', href: '/shopify-bi', emoji: '⚠️' },
  ].filter((i) => i.count > 0)

  if (items.length === 0) return null

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4 mb-6">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-bold text-gray-900">🎯 今日やるべきこと</h3>
        <span className="text-xs text-gray-400">{items.length}件</span>
      </div>
      <div className="space-y-2">
        {items.map((item) => (
          <Link key={item.label} href={item.href}
            className="flex items-center gap-3 p-2.5 rounded-lg border border-gray-100 hover:border-gray-200 hover:bg-gray-50 transition-colors group">
            <div className={`w-2 h-2 rounded-full ${item.color} shrink-0`} />
            <span className="flex-1 text-sm text-gray-700 group-hover:text-gray-900">
              {item.emoji} {item.label}
            </span>
            <span className="text-sm font-bold text-gray-900">{item.count}</span>
          </Link>
        ))}
      </div>
    </div>
  )
}
