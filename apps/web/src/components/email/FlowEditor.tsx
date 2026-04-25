'use client'

import { useCallback, useState, useMemo } from 'react'
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  addEdge,
  applyNodeChanges,
  applyEdgeChanges,
  type Node,
  type Edge,
  type NodeChange,
  type EdgeChange,
  type Connection,
  Handle,
  Position,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'

// ─── ノード種別定義 ──────────────────────────────

interface NodeData extends Record<string, unknown> {
  label: string
  description?: string
  config?: Record<string, unknown>
}

const NODE_STYLES: Record<string, { bg: string; border: string; emoji: string; title: string }> = {
  trigger: { bg: '#FEF3C7', border: '#F59E0B', emoji: '⚡', title: 'トリガー' },
  wait: { bg: '#DBEAFE', border: '#3B82F6', emoji: '⏰', title: '待機' },
  email: { bg: '#D1FAE5', border: '#10B981', emoji: '📧', title: 'メール送信' },
  condition: { bg: '#FCE7F3', border: '#EC4899', emoji: '🔀', title: '条件分岐' },
  tag: { bg: '#E9D5FF', border: '#9333EA', emoji: '🏷️', title: 'タグ付与' },
}

function FermentNode({ data, type }: { data: NodeData; type?: string }) {
  const style = NODE_STYLES[type ?? 'trigger'] ?? NODE_STYLES.trigger
  return (
    <div
      style={{
        background: style.bg,
        border: `2px solid ${style.border}`,
        borderRadius: 8,
        padding: '10px 14px',
        minWidth: 180,
      }}
    >
      <Handle type="target" position={Position.Top} />
      <div style={{ fontSize: 11, color: '#666', fontWeight: 600 }}>
        {style.emoji} {style.title}
      </div>
      <div style={{ fontSize: 14, fontWeight: 500, marginTop: 4 }}>{data.label}</div>
      {data.description && (
        <div style={{ fontSize: 11, color: '#777', marginTop: 4 }}>{data.description}</div>
      )}
      <Handle type="source" position={Position.Bottom} />
    </div>
  )
}

const nodeTypes = {
  trigger: FermentNode,
  wait: FermentNode,
  email: FermentNode,
  condition: FermentNode,
  tag: FermentNode,
}

// ─── プロパティ ──────────────────────────────

export interface FlowEditorProps {
  initialNodes?: Node[]
  initialEdges?: Edge[]
  onChange?: (nodes: Node[], edges: Edge[]) => void
}

export default function FlowEditor({
  initialNodes = [],
  initialEdges = [],
  onChange,
}: FlowEditorProps) {
  const [nodes, setNodes] = useState<Node[]>(
    initialNodes.length > 0
      ? initialNodes
      : [
          {
            id: 'start',
            type: 'trigger',
            position: { x: 250, y: 50 },
            data: { label: '友だち追加', description: 'LINE 友だち追加をトリガー' },
          },
        ],
  )
  const [edges, setEdges] = useState<Edge[]>(initialEdges)
  const [selectedType, setSelectedType] = useState<string>('email')

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      setNodes((nds) => {
        const next = applyNodeChanges(changes, nds)
        onChange?.(next, edges)
        return next
      })
    },
    [edges, onChange],
  )

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      setEdges((eds) => {
        const next = applyEdgeChanges(changes, eds)
        onChange?.(nodes, next)
        return next
      })
    },
    [nodes, onChange],
  )

  const onConnect = useCallback(
    (connection: Connection) => {
      setEdges((eds) => {
        const next = addEdge(connection, eds)
        onChange?.(nodes, next)
        return next
      })
    },
    [nodes, onChange],
  )

  const addNode = useCallback(() => {
    const id = `node_${Date.now()}`
    const newNode: Node = {
      id,
      type: selectedType,
      position: { x: 250 + Math.random() * 100, y: 200 + nodes.length * 100 },
      data: {
        label: NODE_STYLES[selectedType]?.title ?? 'ノード',
        description: '（クリックで設定）',
      },
    }
    const next = [...nodes, newNode]
    setNodes(next)
    onChange?.(next, edges)
  }, [selectedType, nodes, edges, onChange])

  const minimap = useMemo(() => <MiniMap pannable zoomable />, [])

  return (
    <div style={{ width: '100%', height: 'calc(100vh - 240px)', minHeight: 500, position: 'relative' }}>
      {/* ノード追加ツールバー */}
      <div
        style={{
          position: 'absolute',
          top: 12,
          left: 12,
          zIndex: 10,
          background: 'white',
          padding: 8,
          borderRadius: 8,
          border: '1px solid #ddd',
          display: 'flex',
          gap: 8,
          alignItems: 'center',
        }}
      >
        <select
          value={selectedType}
          onChange={(e) => setSelectedType(e.target.value)}
          style={{
            border: '1px solid #ddd',
            borderRadius: 4,
            padding: '4px 8px',
            fontSize: 13,
          }}
        >
          {Object.entries(NODE_STYLES).map(([k, v]) => (
            <option key={k} value={k}>
              {v.emoji} {v.title}
            </option>
          ))}
        </select>
        <button
          onClick={addNode}
          style={{
            background: '#06C755',
            color: 'white',
            border: 'none',
            borderRadius: 4,
            padding: '6px 12px',
            fontSize: 13,
            cursor: 'pointer',
          }}
        >
          + ノード追加
        </button>
      </div>

      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        nodeTypes={nodeTypes}
        fitView
      >
        <Background />
        <Controls />
        {minimap}
      </ReactFlow>
    </div>
  )
}
