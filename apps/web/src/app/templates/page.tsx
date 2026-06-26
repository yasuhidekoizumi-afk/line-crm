'use client'

import { useState, useEffect, useCallback } from 'react'
import { api } from '@/lib/api'
import Header from '@/components/layout/header'
import CcPromptButton from '@/components/cc-prompt-button'
import MessageBlocksEditor, {
  type Block,
  blocksToPayload,
  payloadToBlocks,
} from '@/components/messages/message-blocks-editor'
import MessageBlocksPreview from '@/components/messages/message-blocks-preview'

interface Template {
  id: string
  name: string
  category: string
  messageType: string
  messageContent: string
  createdAt: string
  updatedAt: string
}

const messageTypeLabels: Record<string, string> = {
  text: 'テキスト',
  image: '画像',
  flex: 'Flex',
  imagemap: 'リッチ',
}

interface CreateFormState {
  name: string
  category: string
  // 互換用に messageType/messageContent も保持（DBに保存する最終形）
  // 編集状態は blocks（複数メッセージ）で管理し、保存時に変換する
  messageType: string
  messageContent: string
  blocks: Block[]
}

function emptyTextBlock(): Block {
  return { id: 'b_init', type: 'text', text: '' }
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

const ccPrompts = [
  {
    title: 'テンプレート作成',
    prompt: `新しいメッセージテンプレートの作成をサポートしてください。
1. 用途別（挨拶、キャンペーン、通知、フォローアップ）のテンプレート文例を提案
2. テキスト・画像・Flexメッセージそれぞれの効果的な使い方
3. カテゴリ分類と命名規則のベストプラクティス
手順を示してください。`,
  },
  {
    title: 'テンプレート整理',
    prompt: `既存のテンプレートを整理・最適化してください。
1. カテゴリ別のテンプレート数と使用頻度を分析
2. 重複・類似テンプレートの統合提案
3. 不足しているカテゴリやテンプレートの追加推奨
結果をレポートしてください。`,
  },
]

export default function TemplatesPage() {
  const [templates, setTemplates] = useState<Template[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  // editingId が入っていれば「編集モード」、null なら「新規作成モード」
  const [editingId, setEditingId] = useState<string | null>(null)
  const [selectedCategory, setSelectedCategory] = useState<string>('all')
  const [form, setForm] = useState<CreateFormState>({
    name: '',
    category: '',
    messageType: 'text',
    messageContent: '',
    blocks: [emptyTextBlock()],
  })
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await api.templates.list(
        selectedCategory !== 'all' ? selectedCategory : undefined
      )
      if (res.success) {
        setTemplates(res.data)
      } else {
        setError(res.error)
      }
    } catch {
      setError('テンプレートの読み込みに失敗しました。もう一度お試しください。')
    } finally {
      setLoading(false)
    }
  }, [selectedCategory])

  useEffect(() => {
    load()
  }, [load])

  const categories = Array.from(
    new Set(templates.map((t) => t.category).filter(Boolean))
  )

  // 編集開始（既存テンプレートをフォームに流し込み・blocks に展開）
  const handleStartEdit = (t: Template) => {
    setEditingId(t.id)
    setShowCreate(true)
    setFormError('')
    const blocks = t.messageContent.trim()
      ? payloadToBlocks(t.messageType, t.messageContent)
      : []
    setForm({
      name: t.name,
      category: t.category,
      messageType: t.messageType,
      messageContent: t.messageContent,
      blocks: blocks.length > 0 ? blocks : [emptyTextBlock()],
    })
  }

  // フォーム閉じる（編集モード解除）
  const handleCloseForm = () => {
    setShowCreate(false)
    setEditingId(null)
    setFormError('')
    setForm({ name: '', category: '', messageType: 'text', messageContent: '', blocks: [emptyTextBlock()] })
  }

  // 保存（編集中なら更新、それ以外は新規作成）
  const handleSave = async () => {
    if (!form.name.trim()) {
      setFormError('テンプレート名を入力してください')
      return
    }
    if (!form.category.trim()) {
      setFormError('カテゴリを入力してください')
      return
    }
    if (form.blocks.length === 0) {
      setFormError('メッセージブロックを1件以上追加してください')
      return
    }
    if (form.blocks.length > 5) {
      setFormError('1テンプレートあたりのメッセージは最大5件です')
      return
    }
    for (let i = 0; i < form.blocks.length; i++) {
      const b = form.blocks[i]
      const n = `#${i + 1}`
      if (b.type === 'text' && !b.text.trim()) { setFormError(`${n} テキストを入力してください`); return }
      if (b.type === 'image' && !b.originalContentUrl.trim()) { setFormError(`${n} 画像URLを入力してください`); return }
      if (b.type === 'flex') {
        if (!b.contents.trim()) { setFormError(`${n} Flexの内容を入力してください`); return }
        try { JSON.parse(b.contents) } catch { setFormError(`${n} FlexメッセージのJSONが無効です`); return }
      }
    }
    setSaving(true)
    setFormError('')
    try {
      // blocks → 保存形式（1件なら従来形式・複数なら 'multi'）
      const msg = blocksToPayload(form.blocks)
      const payload = {
        name: form.name,
        category: form.category,
        messageType: msg.messageType,
        messageContent: msg.messageContent,
      }
      const res = editingId
        ? await api.templates.update(editingId, payload)
        : await api.templates.create(payload)
      if (res.success) {
        handleCloseForm()
        load()
      } else {
        setFormError(res.error)
      }
    } catch {
      setFormError(editingId ? '更新に失敗しました' : '作成に失敗しました')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('このテンプレートを削除してもよいですか？')) return
    try {
      await api.templates.delete(id)
      load()
    } catch {
      setError('削除に失敗しました')
    }
  }

  return (
    <div>
      <Header
        title="LINEテンプレート"
        action={
          <button
            onClick={() => { setEditingId(null); setForm({ name: '', category: '', messageType: 'text', messageContent: '', blocks: [emptyTextBlock()] }); setFormError(''); setShowCreate(true) }}
            className="px-4 py-2 text-sm font-medium text-white rounded-lg transition-opacity hover:opacity-90"
            style={{ backgroundColor: '#06C755' }}
          >
            + 新規テンプレート
          </button>
        }
      />

      {/* Error */}
      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          {error}
        </div>
      )}

      {/* Category filter */}
      {!loading && categories.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-2">
          <button
            onClick={() => setSelectedCategory('all')}
            className={`px-3 py-1.5 min-h-[44px] text-xs font-medium rounded-full transition-colors ${
              selectedCategory === 'all'
                ? 'text-white'
                : 'text-gray-600 bg-gray-100 hover:bg-gray-200'
            }`}
            style={selectedCategory === 'all' ? { backgroundColor: '#06C755' } : undefined}
          >
            全て
          </button>
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              className={`px-3 py-1.5 min-h-[44px] text-xs font-medium rounded-full transition-colors ${
                selectedCategory === cat
                  ? 'text-white'
                  : 'text-gray-600 bg-gray-100 hover:bg-gray-200'
              }`}
              style={selectedCategory === cat ? { backgroundColor: '#06C755' } : undefined}
            >
              {cat}
            </button>
          ))}
        </div>
      )}

      {/* Create form */}
      {showCreate && (
        <div className="mb-6 bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h2 className="text-sm font-semibold text-gray-800 mb-4">
            {editingId ? 'テンプレートを編集' : '新規テンプレートを作成'}
          </h2>
          <div className="space-y-4 max-w-5xl">
            <div className="max-w-lg">
              <label className="block text-xs font-medium text-gray-600 mb-1">テンプレート名 <span className="text-red-500">*</span></label>
              <input
                type="text"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                placeholder="例: ウェルカムメッセージ"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
            <div className="max-w-lg">
              <label className="block text-xs font-medium text-gray-600 mb-1">カテゴリ <span className="text-red-500">*</span></label>
              <input
                type="text"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                placeholder="例: 挨拶、キャンペーン、通知"
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
              />
            </div>
            {/* メッセージ：ブロックを縦に積む（最大5件・一斉配信と同じUI）＋右にスマホ風プレビュー */}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-2">
                メッセージ <span className="text-red-500">*</span>
                <span className="text-xs text-gray-400 ml-2">テキスト・画像・Flexを縦に追加できます（最大5件）</span>
              </label>
              <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4">
                <MessageBlocksEditor
                  value={form.blocks}
                  onChange={(blocks) => setForm({ ...form, blocks })}
                />
                <div className="lg:sticky lg:top-4 lg:self-start">
                  <MessageBlocksPreview blocks={form.blocks} />
                </div>
              </div>
            </div>

            {formError && <p className="text-xs text-red-600">{formError}</p>}

            <div className="flex gap-2">
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-4 py-2 text-sm font-medium text-white rounded-lg disabled:opacity-50 transition-opacity"
                style={{ backgroundColor: '#06C755' }}
              >
                {saving ? '保存中...' : editingId ? '保存' : '作成'}
              </button>
              <button
                onClick={handleCloseForm}
                className="px-4 py-2 text-sm font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
              >
                キャンセル
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Loading skeleton */}
      {loading ? (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="px-4 py-4 border-b border-gray-100 flex items-center gap-4 animate-pulse">
              <div className="flex-1 space-y-2">
                <div className="h-3 bg-gray-200 rounded w-48" />
                <div className="h-2 bg-gray-100 rounded w-32" />
              </div>
              <div className="h-5 bg-gray-100 rounded-full w-16" />
              <div className="h-3 bg-gray-100 rounded w-24" />
            </div>
          ))}
        </div>
      ) : templates.length === 0 && !showCreate ? (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-12 text-center">
          <p className="text-gray-500">テンプレートがありません。「新規テンプレート」から作成してください。</p>
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
          <table className="w-full min-w-[640px]">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  テンプレート名
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  カテゴリ
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  メッセージタイプ
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  作成日時
                </th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {templates.map((template) => (
                <tr
                  key={template.id}
                  onClick={() => handleStartEdit(template)}
                  className={`cursor-pointer transition-colors ${
                    editingId === template.id ? 'bg-green-50' : 'hover:bg-gray-50'
                  }`}
                >
                  {/* Name */}
                  <td className="px-4 py-3">
                    <div>
                      <p className="text-sm font-medium text-gray-900">{template.name}</p>
                      <p className="text-xs text-gray-400 mt-0.5 truncate max-w-xs">
                        {template.messageContent.slice(0, 50)}
                        {template.messageContent.length > 50 ? '...' : ''}
                      </p>
                    </div>
                  </td>

                  {/* Category */}
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700">
                      {template.category}
                    </span>
                  </td>

                  {/* Message Type */}
                  <td className="px-4 py-3 text-sm text-gray-600">
                    {messageTypeLabels[template.messageType] || template.messageType}
                  </td>

                  {/* Created At */}
                  <td className="px-4 py-3 text-sm text-gray-500">
                    {formatDate(template.createdAt)}
                  </td>

                  {/* Actions */}
                  <td className="px-4 py-3 text-right">
                    <div className="inline-flex gap-1">
                      <button
                        onClick={(e) => { e.stopPropagation(); handleStartEdit(template) }}
                        className="px-3 py-1 text-xs font-medium text-gray-600 hover:text-gray-900 bg-gray-100 hover:bg-gray-200 rounded-md transition-colors"
                      >
                        編集
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDelete(template.id) }}
                        className="px-3 py-1 text-xs font-medium text-red-500 hover:text-red-700 bg-red-50 hover:bg-red-100 rounded-md transition-colors"
                      >
                        削除
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      )}
      <CcPromptButton prompts={ccPrompts} />
    </div>
  )
}
