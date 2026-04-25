'use client'

import { useState, useEffect, useCallback, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import dynamic from 'next/dynamic'
import { fermentApi, type EmailFlow } from '@/lib/ferment-api'
import type { Node, Edge } from '@xyflow/react'

const FlowEditor = dynamic(() => import('@/components/email/FlowEditor'), { ssr: false })

interface FlowGraph {
  nodes: Node[]
  edges: Edge[]
}

function parseGraph(jsonStr: string | null | undefined): FlowGraph {
  if (!jsonStr) return { nodes: [], edges: [] }
  try {
    const parsed = JSON.parse(jsonStr)
    if (parsed && Array.isArray(parsed.nodes) && Array.isArray(parsed.edges)) {
      return parsed as FlowGraph
    }
  } catch {
    // ignore
  }
  return { nodes: [], edges: [] }
}

function FlowEditPageInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const id = searchParams.get('id') ?? ''

  const [flow, setFlow] = useState<EmailFlow | null>(null)
  const [graph, setGraph] = useState<FlowGraph>({ nodes: [], edges: [] })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [savedAt, setSavedAt] = useState<Date | null>(null)

  useEffect(() => {
    if (!id) {
      setError('フローIDが指定されていません')
      setLoading(false)
      return
    }
    fermentApi.flows.get(id).then((res) => {
      if (res.success && res.data) {
        setFlow(res.data)
        // trigger_config の中に nodes/edges を保存している想定
        setGraph(parseGraph(res.data.trigger_config))
      } else {
        setError(res.error ?? 'フローの取得に失敗しました')
      }
      setLoading(false)
    })
  }, [id])

  const handleGraphChange = useCallback((nodes: Node[], edges: Edge[]) => {
    setGraph({ nodes, edges })
  }, [])

  const handleSave = useCallback(async () => {
    if (!flow) return
    setSaving(true)
    setError('')
    try {
      const res = await fermentApi.flows.update(id, {
        trigger_config: JSON.stringify(graph),
      } as Partial<EmailFlow>)
      if (res.success) {
        setSavedAt(new Date())
      } else {
        setError(res.error ?? '保存に失敗しました')
      }
    } catch {
      setError('保存に失敗しました')
    } finally {
      setSaving(false)
    }
  }, [id, flow, graph])

  if (loading) return <div className="p-8 text-center text-gray-400">読み込み中...</div>
  if (!flow) {
    return (
      <div className="p-8 text-center">
        <p className="text-red-500">{error || 'フローが見つかりません'}</p>
        <button
          onClick={() => router.push('/email/flows')}
          className="mt-4 text-sm text-green-600 hover:underline"
        >
          ← 一覧に戻る
        </button>
      </div>
    )
  }

  return (
    <div className="max-w-7xl mx-auto py-6 px-4">
      <div className="flex items-center justify-between mb-4">
        <div>
          <button
            onClick={() => router.push('/email/flows')}
            className="text-sm text-gray-500 hover:text-gray-700"
          >
            ← 一覧に戻る
          </button>
          <h1 className="text-xl font-bold text-gray-900 mt-1">
            {flow.name}{' '}
            <span className="text-sm text-gray-400 ml-2">ビジュアルフロー編集</span>
          </h1>
        </div>
        <div className="flex items-center gap-3">
          {savedAt && (
            <span className="text-xs text-gray-400">
              保存済み {savedAt.toLocaleTimeString('ja-JP')}
            </span>
          )}
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium disabled:opacity-50"
          >
            {saving ? '保存中...' : '保存する'}
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-3 p-3 bg-red-50 text-red-600 rounded-lg text-sm">{error}</div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <FlowEditor
          initialNodes={graph.nodes}
          initialEdges={graph.edges}
          onChange={handleGraphChange}
        />
      </div>

      <div className="mt-4 p-3 bg-blue-50 text-xs text-blue-800 rounded-lg">
        <p className="font-semibold mb-1">使い方:</p>
        <ul className="list-disc list-inside space-y-1 ml-2">
          <li>左上のメニューからノード種類を選んで「+ ノード追加」</li>
          <li>ノードをドラッグして配置、底の点から線を引いて次のノードに繋ぐ</li>
          <li>トリガー → 待機 → メール送信 のように繋げてフローを作成</li>
          <li>「保存する」で確定</li>
        </ul>
      </div>
    </div>
  )
}

export default function FlowEditPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-gray-400">読み込み中...</div>}>
      <FlowEditPageInner />
    </Suspense>
  )
}
