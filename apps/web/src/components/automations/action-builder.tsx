'use client'

import type { AutomationAction } from '@line-crm/shared'
import type { Tag, Scenario } from '@line-crm/shared'

/**
 * オートメーションアクションの選択式エディタ。
 * 従来のJSON直入力に代わり、タイプ選択＋各タイプに応じたフォームで構築する。
 * 値は AutomationAction[] として親へ渡す（親はそのままAPIへ送る）。
 */

const ACTION_TYPE_LABELS: Record<AutomationAction['type'], string> = {
  add_tag: 'タグを付与',
  remove_tag: 'タグを外す',
  start_scenario: 'シナリオを開始',
  send_message: 'メッセージを送信',
  send_webhook: 'Webhookを送信',
  switch_rich_menu: 'リッチメニューを切替',
}

const ACTION_TYPES = Object.keys(ACTION_TYPE_LABELS) as AutomationAction['type'][]

interface Props {
  actions: AutomationAction[]
  onChange: (actions: AutomationAction[]) => void
  tags: Tag[]
  scenarios: (Scenario & { stepCount?: number })[]
  loadingTags?: boolean
}

function defaultParamsFor(type: AutomationAction['type']): AutomationAction['params'] {
  switch (type) {
    case 'add_tag':
    case 'remove_tag':
      return { tagId: '' }
    case 'start_scenario':
      return { scenarioId: '' }
    case 'send_message':
      return { messageType: 'text', content: '' }
    case 'send_webhook':
      return { url: '' }
    case 'switch_rich_menu':
      return { richMenuId: '' }
  }
}

function ActionTypeBadge({ type }: { type: AutomationAction['type'] }) {
  const color: Record<string, string> = {
    add_tag: 'bg-green-100 text-green-700',
    remove_tag: 'bg-orange-100 text-orange-700',
    start_scenario: 'bg-blue-100 text-blue-700',
    send_message: 'bg-purple-100 text-purple-700',
    send_webhook: 'bg-gray-100 text-gray-700',
    switch_rich_menu: 'bg-cyan-100 text-cyan-700',
  }
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${color[type]}`}>
      {ACTION_TYPE_LABELS[type]}
    </span>
  )
}

const inputCls =
  'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 bg-white'

export default function ActionBuilder({ actions, onChange, tags, scenarios }: Props) {
  const updateAction = (index: number, next: AutomationAction) => {
    const copy = [...actions]
    copy[index] = next
    onChange(copy)
  }

  const changeType = (index: number, type: AutomationAction['type']) => {
    updateAction(index, { type, params: defaultParamsFor(type) })
  }

  const setParam = (index: number, key: string, value: unknown) => {
    const copy = [...actions]
    copy[index] = { ...copy[index], params: { ...copy[index].params, [key]: value } }
    onChange(copy)
  }

  const removeAction = (index: number) => {
    onChange(actions.filter((_, i) => i !== index))
  }

  const addAction = () => {
    onChange([...actions, { type: 'add_tag', params: defaultParamsFor('add_tag') }])
  }

  const move = (index: number, dir: -1 | 1) => {
    const target = index + dir
    if (target < 0 || target >= actions.length) return
    const copy = [...actions]
    ;[copy[index], copy[target]] = [copy[target], copy[index]]
    onChange(copy)
  }

  if (actions.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-gray-300 p-4 text-center">
        <p className="text-xs text-gray-400 mb-3">アクションが未設定です。「アクションを追加」から開始してください。</p>
        <button type="button" onClick={addAction} className="px-3 py-1.5 text-xs font-medium text-green-700 border border-green-300 rounded-lg hover:bg-green-50">
          + アクションを追加
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {actions.map((action, i) => (
        <div key={i} className="rounded-lg border border-gray-200 bg-gray-50/50 p-3 space-y-2">
          <div className="flex items-center gap-2">
            <div className="flex-1 min-w-0">
              <select
                className={`${inputCls} text-xs py-1.5`}
                value={action.type}
                onChange={(e) => changeType(i, e.target.value as AutomationAction['type'])}
              >
                {ACTION_TYPES.map((t) => (
                  <option key={t} value={t}>{ACTION_TYPE_LABELS[t]}</option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <button type="button" onClick={() => move(i, -1)} disabled={i === 0} className="w-7 h-7 flex items-center justify-center text-gray-400 hover:text-gray-600 disabled:opacity-30 text-sm">↑</button>
              <button type="button" onClick={() => move(i, 1)} disabled={i === actions.length - 1} className="w-7 h-7 flex items-center justify-center text-gray-400 hover:text-gray-600 disabled:opacity-30 text-sm">↓</button>
              <button type="button" onClick={() => removeAction(i)} className="w-7 h-7 flex items-center justify-center text-red-400 hover:text-red-600 text-sm" aria-label="このアクションを削除">✕</button>
            </div>
          </div>

          {/* params: タイプ別フォーム */}
          {(action.type === 'add_tag' || action.type === 'remove_tag') && (
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">対象タグ</label>
              <select
                className={inputCls}
                value={String(action.params.tagId ?? '')}
                onChange={(e) => setParam(i, 'tagId', e.target.value)}
              >
                <option value="">タグを選択...</option>
                {tags.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </div>
          )}

          {action.type === 'start_scenario' && (
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">対象シナリオ</label>
              <select
                className={inputCls}
                value={String(action.params.scenarioId ?? '')}
                onChange={(e) => setParam(i, 'scenarioId', e.target.value)}
              >
                <option value="">シナリオを選択...</option>
                {scenarios.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}{s.stepCount ? `（${s.stepCount}ステップ）` : ''}</option>
                ))}
              </select>
            </div>
          )}

          {action.type === 'send_message' && (
            <div className="space-y-2">
              <div className="flex gap-2">
                <select
                  className={`${inputCls} w-32`}
                  value={String(action.params.messageType ?? 'text')}
                  onChange={(e) => setParam(i, 'messageType', e.target.value)}
                >
                  <option value="text">テキスト</option>
                  <option value="flex">Flex</option>
                </select>
              </div>
              {action.params.messageType === 'flex' ? (
                <div className="space-y-1">
                  <label className="block text-xs font-medium text-gray-600">Flex JSON</label>
                  <textarea
                    className={`${inputCls} font-mono resize-y`}
                    rows={4}
                    placeholder='{"type":"bubble","body":{...}}'
                    value={String(action.params.content ?? '')}
                    onChange={(e) => setParam(i, 'content', e.target.value)}
                  />
                  <label className="block text-xs font-medium text-gray-600">altText（通知文・必須）</label>
                  <input
                    className={inputCls}
                    value={String(action.params.altText ?? '')}
                    onChange={(e) => setParam(i, 'altText', e.target.value)}
                    placeholder="例: 新着情報をお知らせします"
                  />
                </div>
              ) : (
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">メッセージ本文</label>
                  <textarea
                    className={`${inputCls} resize-y`}
                    rows={3}
                    value={String(action.params.content ?? '')}
                    onChange={(e) => setParam(i, 'content', e.target.value)}
                    placeholder="送信するテキスト"
                  />
                </div>
              )}
            </div>
          )}

          {action.type === 'send_webhook' && (
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">送信先URL</label>
              <input
                className={`${inputCls} font-mono`}
                value={String(action.params.url ?? '')}
                onChange={(e) => setParam(i, 'url', e.target.value)}
                placeholder="https://example.com/hooks/..."
              />
            </div>
          )}

          {action.type === 'switch_rich_menu' && (
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">リッチメニューID</label>
              <input
                className={`${inputCls} font-mono`}
                value={String(action.params.richMenuId ?? '')}
                onChange={(e) => setParam(i, 'richMenuId', e.target.value)}
                placeholder="richmenu-..."
              />
            </div>
          )}
        </div>
      ))}

      <button type="button" onClick={addAction} className="px-3 py-1.5 text-xs font-medium text-green-700 border border-green-300 rounded-lg hover:bg-green-50">
        + アクションを追加
      </button>

      {/* 動作プレビュー */}
      <div className="rounded-lg bg-white border border-gray-200 p-3">
        <p className="text-[11px] text-gray-400 mb-1.5">実行される内容（プレビュー）</p>
        <ul className="space-y-1">
          {actions.map((a, i) => (
            <li key={i} className="flex items-start gap-1.5 text-xs text-gray-600">
              <span className="text-gray-300 mt-0.5">{i + 1}.</span>
              <ActionTypeBadge type={a.type} />
              <span className="flex-1 min-w-0 break-all">
                {a.type === 'add_tag' && tags.find((t) => t.id === a.params.tagId)?.name}
                {a.type === 'remove_tag' && tags.find((t) => t.id === a.params.tagId)?.name}
                {a.type === 'start_scenario' && scenarios.find((s) => s.id === a.params.scenarioId)?.name}
                {a.type === 'send_message' && `「${String(a.params.content ?? '').slice(0, 30)}${String(a.params.content ?? '').length > 30 ? '…' : ''}」`}
                {a.type === 'send_webhook' && String(a.params.url ?? '')}
                {a.type === 'switch_rich_menu' && String(a.params.richMenuId ?? '')}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
