'use client'

import { useState, useCallback } from 'react'

// ─── 型定義（segment-engine.ts に合わせる） ───

type SegmentOperator =
  | '=' | '!=' | '>' | '>=' | '<' | '<=' | 'in' | 'not_in'
  | 'contains' | 'starts_with' | 'within_days' | 'older_than_days'
  | 'is_null' | 'is_not_null'

interface LeafCondition {
  field: string
  operator: SegmentOperator
  value?: string | number | string[]
}

interface GroupCondition {
  operator: 'AND' | 'OR'
  conditions: Array<LeafCondition | GroupCondition>
}

type Condition = LeafCondition | GroupCondition

// ─── フィールド定義 ───

interface FieldDef {
  value: string
  label: string
  type: 'number' | 'string' | 'boolean' | 'date'
  unit?: string
}

const FIELDS: FieldDef[] = [
  { value: 'ltv',              label: '累計購入金額',     type: 'number', unit: '円' },
  { value: 'order_count',      label: '注文回数',         type: 'number', unit: '回' },
  { value: 'avg_order_value',  label: '平均購入単価',     type: 'number', unit: '円' },
  { value: 'days_since_last_order', label: '最終注文からの経過日数', type: 'number', unit: '日' },
  { value: 'days_since_created',    label: '登録からの経過日数',    type: 'number', unit: '日' },
  { value: 'subscribed_email', label: 'メール購読',       type: 'boolean' },
  { value: 'subscribed_line',  label: 'LINE受信同意',     type: 'boolean' },
  { value: 'email_bounced',    label: 'メールバウンス',   type: 'boolean' },
  { value: 'region',           label: '地域',             type: 'string' },
  { value: 'language',         label: '言語',             type: 'string' },
  { value: 'email',            label: 'メールアドレス',   type: 'string' },
  { value: 'tags',             label: '顧客タグ',         type: 'string' },
  { value: 'friend_tag',       label: 'LINE友だちタグ',   type: 'string' },
  { value: 'last_order_at',    label: '最終注文日',       type: 'date' },
  { value: 'created_at',       label: '登録日',           type: 'date' },
  { value: 'first_order_at',   label: '初回注文日',       type: 'date' },
  { value: 'source',           label: '流入元',           type: 'string' },
  { value: 'display_name',     label: '表示名',           type: 'string' },
]

const FIELD_MAP = Object.fromEntries(FIELDS.map((f) => [f.value, f]))

// ─── 演算子 ───

interface OpDef {
  value: SegmentOperator
  label: string
  applicable: Array<'number' | 'string' | 'boolean' | 'date'>
  needsValue: boolean
  valueType?: 'text' | 'number' | 'select'
}

const OPERATORS: OpDef[] = [
  { value: '=',              label: '等しい',             applicable: ['number', 'string', 'boolean'], needsValue: true },
  { value: '!=',             label: '等しくない',         applicable: ['number', 'string', 'boolean'], needsValue: true },
  { value: '>',              label: 'より大きい',         applicable: ['number'], needsValue: true, valueType: 'number' },
  { value: '>=',             label: '以上',               applicable: ['number'], needsValue: true, valueType: 'number' },
  { value: '<',              label: 'より小さい',         applicable: ['number'], needsValue: true, valueType: 'number' },
  { value: '<=',             label: '以下',               applicable: ['number'], needsValue: true, valueType: 'number' },
  { value: 'in',             label: '含まれる（複数）',   applicable: ['number', 'string'], needsValue: true, valueType: 'text' },
  { value: 'not_in',         label: '含まれない（複数）', applicable: ['number', 'string'], needsValue: true, valueType: 'text' },
  { value: 'contains',       label: '部分一致',           applicable: ['string'], needsValue: true, valueType: 'text' },
  { value: 'starts_with',    label: 'で始まる',           applicable: ['string'], needsValue: true, valueType: 'text' },
  { value: 'within_days',    label: '過去◯日以内',        applicable: ['date'], needsValue: true, valueType: 'number' },
  { value: 'older_than_days', label: '◯日より前',         applicable: ['date'], needsValue: true, valueType: 'number' },
  { value: 'is_null',        label: '設定なし',           applicable: ['number', 'string', 'boolean', 'date'], needsValue: false },
  { value: 'is_not_null',    label: '設定あり',           applicable: ['number', 'string', 'boolean', 'date'], needsValue: false },
]

// ─── ヘルパー ───

function getFieldType(field: string): 'number' | 'string' | 'boolean' | 'date' {
  return FIELD_MAP[field]?.type ?? 'string'
}

function getApplicableOps(field: string): OpDef[] {
  const type = getFieldType(field)
  return OPERATORS.filter((op) => op.applicable.includes(type))
}

function createEmptyCondition(): LeafCondition {
  return { field: 'ltv', operator: '>=', value: '' }
}

function createEmptyGroup(): GroupCondition {
  return { operator: 'AND', conditions: [createEmptyCondition()] }
}

function isGroup(c: Condition): c is GroupCondition {
  return 'conditions' in c
}

// ─── JSON に変換（空文字列の value は除去、数値変換） ───

function sanitizeValue(v: unknown, field: string): string | number | string[] | undefined {
  const type = getFieldType(field)
  if (v === '' || v === null || v === undefined) return undefined
  if (type === 'number') {
    const n = Number(v)
    return isNaN(n) ? undefined : n
  }
  if (typeof v === 'string' && (v.includes(',') || v.includes('、'))) {
    return v.split(/[、,]/).map((s) => s.trim()).filter(Boolean)
  }
  return String(v)
}

function conditionToJSON(c: Condition): Record<string, unknown> {
  if (isGroup(c)) {
    return {
      operator: c.operator,
      conditions: c.conditions.map(conditionToJSON),
    }
  }
  const obj: Record<string, unknown> = { field: c.field, operator: c.operator }
  const val = sanitizeValue(c.value, c.field)
  if (val !== undefined) obj.value = val
  return obj
}

// ─── JSON から Condition に戻す ───

function jsonToCondition(json: Record<string, unknown>): Condition {
  if ('conditions' in json) {
    return {
      operator: json.operator as 'AND' | 'OR',
      conditions: (json.conditions as Record<string, unknown>[]).map(jsonToCondition),
    }
  }
  return {
    field: String(json.field ?? 'ltv'),
    operator: (json.operator as SegmentOperator) ?? '=',
    value: json.value ?? '',
  }
}

// ─── ルールの日本語表示 ───

function describeCondition(c: Condition): string {
  if (isGroup(c)) {
    const parts = c.conditions.map(describeCondition)
    if (parts.length === 0) return '（条件なし）'
    return parts.join(` ${c.operator === 'AND' ? 'かつ' : 'または'} `)
  }
  const field = FIELD_MAP[c.field]
  const fieldLabel = field?.label ?? c.field
  const op = OPERATORS.find((o) => o.value === c.operator)
  if (!op) return `${fieldLabel}`
  if (!op.needsValue) return `${fieldLabel}が${op.label}`
  const val = c.value ?? ''
  if (op.valueType === 'number') return `${fieldLabel}が${val}${field?.unit ?? ''}${op.label}`
  if (c.operator === 'in' || c.operator === 'not_in') {
    const items = String(val).split(/[、,]/).join('、')
    return `${fieldLabel}が「${items}」のいずれか${c.operator === 'in' ? 'に含まれる' : 'に含まれない'}`
  }
  return `${fieldLabel}が「${val}」に${op.label}`
}

// ─── コンポーネント ───

interface RuleBuilderProps {
  value: string  // JSON string
  onChange: (json: string) => void
}

export default function SegmentRuleBuilder({ value, onChange }: RuleBuilderProps) {
  let root: GroupCondition
  try {
    root = jsonToCondition(JSON.parse(value)) as GroupCondition
    if (!root.conditions) root = createEmptyGroup()
  } catch {
    root = createEmptyGroup()
  }

  const [localRoot, setLocalRoot] = useState<GroupCondition>(root)

  const emitChange = useCallback((newRoot: GroupCondition) => {
    setLocalRoot(newRoot)
    onChange(JSON.stringify(conditionToJSON(newRoot), null, 2))
  }, [onChange])

  const updateGroupOperator = (group: GroupCondition, op: 'AND' | 'OR') => {
    emitChange({ ...group, operator: op })
  }

  const updateCondition = (group: GroupCondition, idx: number, patch: Partial<LeafCondition>) => {
    const cond = group.conditions[idx]
    if (isGroup(cond)) return
    const updated = [...group.conditions]
    updated[idx] = { ...cond, ...patch }
    emitChange({ ...group, conditions: updated })
  }

  const removeCondition = (group: GroupCondition, idx: number) => {
    const updated = group.conditions.filter((_, i) => i !== idx)
    emitChange({ ...group, conditions: updated.length > 0 ? updated : [createEmptyCondition()] })
  }

  const addCondition = (group: GroupCondition) => {
    emitChange({ ...group, conditions: [...group.conditions, createEmptyCondition()] })
  }

  const moveCondition = (group: GroupCondition, fromIdx: number, toIdx: number) => {
    const updated = [...group.conditions]
    const [moved] = updated.splice(fromIdx, 1)
    updated.splice(toIdx, 0, moved)
    emitChange({ ...group, conditions: updated })
  }

  const handleFieldChange = (group: GroupCondition, idx: number, newField: string) => {
    const ops = getApplicableOps(newField)
    const currentOp = !isGroup(group.conditions[idx]) ? (group.conditions[idx] as LeafCondition).operator : '='
    const validOp = ops.find((o) => o.value === currentOp) ? currentOp : ops[0]?.value ?? '='
    updateCondition(group, idx, { field: newField, operator: validOp, value: '' })
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-sm text-gray-500">条件の組み合わせ:</span>
        <button
          type="button"
          onClick={() => updateGroupOperator(localRoot, 'AND')}
          className={`px-3 py-1 text-xs font-medium rounded-md border transition-colors ${
            localRoot.operator === 'AND'
              ? 'border-green-500 text-green-700 bg-green-50'
              : 'border-gray-300 text-gray-600 hover:border-gray-400'
          }`}
        >
          すべて満たす（AND）
        </button>
        <button
          type="button"
          onClick={() => updateGroupOperator(localRoot, 'OR')}
          className={`px-3 py-1 text-xs font-medium rounded-md border transition-colors ${
            localRoot.operator === 'OR'
              ? 'border-green-500 text-green-700 bg-green-50'
              : 'border-gray-300 text-gray-600 hover:border-gray-400'
          }`}
        >
          いずれかを満たす（OR）
        </button>
      </div>

      <div className="space-y-2">
        {localRoot.conditions.map((cond, idx) => {
          const isLast = idx === localRoot.conditions.length - 1
          const isFirst = idx === 0
          if (isGroup(cond)) return null // ネストグループは今回スキップ（シンプルに）

          const fieldDef = FIELD_MAP[cond.field]
          const ops = getApplicableOps(cond.field)
          const opDef = ops.find((o) => o.value === cond.operator) ?? ops[0]

          return (
            <div key={idx} className="flex items-start gap-2 p-3 bg-gray-50 rounded-lg border border-gray-200">
              {/* フィールド */}
              <div className="flex-1 min-w-0">
                <select
                  className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm bg-white"
                  value={cond.field}
                  onChange={(e) => handleFieldChange(localRoot, idx, e.target.value)}
                >
                  {FIELDS.map((f) => (
                    <option key={f.value} value={f.value}>{f.label}</option>
                  ))}
                </select>
              </div>

              {/* 演算子 */}
              <div className="w-44 shrink-0">
                <select
                  className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm bg-white"
                  value={cond.operator}
                  onChange={(e) => updateCondition(localRoot, idx, { operator: e.target.value as SegmentOperator })}
                >
                  {ops.map((op) => (
                    <option key={op.value} value={op.value}>{op.label}</option>
                  ))}
                </select>
              </div>

              {/* 値 */}
              {opDef.needsValue && (
                <div className="w-40 shrink-0">
                  {fieldDef?.type === 'boolean' ? (
                    <select
                      className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm bg-white"
                      value={String(cond.value ?? '1')}
                      onChange={(e) => updateCondition(localRoot, idx, { value: e.target.value })}
                    >
                      <option value="1">はい</option>
                      <option value="0">いいえ</option>
                    </select>
                  ) : opDef.valueType === 'number' ? (
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        className="flex-1 border border-gray-300 rounded-lg px-2 py-1.5 text-sm w-20"
                        value={cond.value ?? ''}
                        onChange={(e) => updateCondition(localRoot, idx, { value: e.target.value })}
                        placeholder="値"
                      />
                      {fieldDef?.unit && <span className="text-xs text-gray-400 shrink-0">{fieldDef.unit}</span>}
                    </div>
                  ) : (
                    <input
                      type="text"
                      className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm"
                      value={cond.value ?? ''}
                      onChange={(e) => updateCondition(localRoot, idx, { value: e.target.value })}
                      placeholder={cond.field === 'friend_tag' ? 'タグ名（例: VIP）' : '値'}
                    />
                  )}
                </div>
              )}

              {/* 移動 */}
              <div className="flex gap-0.5 shrink-0">
                <button
                  type="button"
                  disabled={isFirst}
                  onClick={() => moveCondition(localRoot, idx, idx - 1)}
                  className="w-7 h-7 flex items-center justify-center text-xs text-gray-400 hover:text-gray-600 hover:bg-gray-200 rounded disabled:opacity-30 disabled:cursor-not-allowed"
                  title="上に移動"
                >▲</button>
                <button
                  type="button"
                  disabled={isLast}
                  onClick={() => moveCondition(localRoot, idx, idx + 1)}
                  className="w-7 h-7 flex items-center justify-center text-xs text-gray-400 hover:text-gray-600 hover:bg-gray-200 rounded disabled:opacity-30 disabled:cursor-not-allowed"
                  title="下に移動"
                >▼</button>
              </div>

              {/* 削除 */}
              <button
                type="button"
                onClick={() => removeCondition(localRoot, idx)}
                className="w-7 h-7 flex items-center justify-center text-xs text-red-400 hover:text-red-600 hover:bg-red-50 rounded shrink-0"
                title="この条件を削除"
              >✕</button>
            </div>
          )
        })}
      </div>

      {/* 追加ボタン */}
      <button
        type="button"
        onClick={() => addCondition(localRoot)}
        className="w-full py-2 text-sm text-green-600 border-2 border-dashed border-green-300 rounded-lg hover:bg-green-50 transition-colors"
      >
        + 条件を追加
      </button>

      {/* ルールの日本語プレビュー */}
      <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
        <p className="text-xs text-blue-700 font-medium mb-1">📖 ルールの内容</p>
        <p className="text-sm text-blue-900">{describeCondition(localRoot)}</p>
      </div>
    </div>
  )
}
