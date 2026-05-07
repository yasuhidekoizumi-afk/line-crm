/**
 * 簡易バリデーションユーティリティ
 */

export type ValidationRule =
  | { type: 'required'; message: string }
  | { type: 'minLength'; min: number; message: string }
  | { type: 'maxLength'; max: number; message: string }
  | { type: 'email'; message: string }
  | { type: 'pattern'; regex: RegExp; message: string }
  | { type: 'custom'; validate: (value: string) => boolean; message: string }

export interface ValidationField {
  value: string
  rules: ValidationRule[]
  label: string
}

/** 単一フィールドをバリデーションしてエラーメッセージを返す（通れば null） */
export function validateField(value: string, rules: ValidationRule[]): string | null {
  for (const rule of rules) {
    switch (rule.type) {
      case 'required':
        if (!value.trim()) return rule.message
        break
      case 'minLength':
        if (value.trim().length < rule.min) return rule.message
        break
      case 'maxLength':
        if (value.trim().length > rule.max) return rule.message
        break
      case 'email':
        if (value.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())) return rule.message
        break
      case 'pattern':
        if (value.trim() && !rule.regex.test(value.trim())) return rule.message
        break
      case 'custom':
        if (!rule.validate(value.trim())) return rule.message
        break
    }
  }
  return null
}

/** 複数フィールドをまとめてバリデーションし、エラーを { fieldName: message } で返す */
export function validateFields(
  fields: Record<string, ValidationField>,
): Record<string, string> {
  const errors: Record<string, string> = {}
  for (const [name, field] of Object.entries(fields)) {
    const err = validateField(field.value, field.rules)
    if (err) errors[name] = err
  }
  return errors
}

/** バリデーションエラーがあるか確認 */
export function hasErrors(errors: Record<string, string>): boolean {
  return Object.keys(errors).length > 0
}
