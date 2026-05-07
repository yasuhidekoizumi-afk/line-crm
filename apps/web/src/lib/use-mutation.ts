'use client'

import { useState, useCallback, useRef } from 'react'
import { useToast } from '@/lib/toast'

type MutationFn<TData, TArgs extends unknown[]> = (...args: TArgs) => Promise<TData>

interface UseMutationOptions<TData> {
  onSuccess?: (data: TData) => void
  onError?: (error: string) => void
  successMessage?: string
  errorMessage?: string
}

interface UseMutationResult<TData, TArgs extends unknown[]> {
  /** ミューテーション実行。返り値は Promise なので呼び出し元で await 可能 */
  mutate: (...args: TArgs) => Promise<TData | undefined>
  /** 実行中フラグ */
  loading: boolean
  /** エラーメッセージ */
  error: string | null
  /** エラーをクリア */
  clearError: () => void
}

/**
 * API呼び出しのローディング状態・エラー・トーストを一元管理。
 *
 * 使用例:
 *   const { mutate: save, loading } = useMutation(
 *     (id: string) => api.templates.delete(id),
 *     { successMessage: '削除しました' }
 *   )
 *   // JSX: <button onClick={() => save(template.id)} disabled={loading}>
 */
export function useMutation<TData, TArgs extends unknown[]>(
  fn: MutationFn<TData, TArgs>,
  options: UseMutationOptions<TData> = {},
): UseMutationResult<TData, TArgs> {
  const toast = useToast()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const mountedRef = useRef(true)

  const clearError = useCallback(() => setError(null), [])

  const mutate = useCallback(
    async (...args: TArgs): Promise<TData | undefined> => {
      setLoading(true)
      setError(null)
      try {
        const data = await fn(...args)
        if (options.successMessage) {
          toast.addToast(options.successMessage, 'success')
        }
        options.onSuccess?.(data)
        return data
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        setError(msg)
        toast.addToast(options.errorMessage || msg, 'error')
        options.onError?.(msg)
        return undefined
      } finally {
        if (mountedRef.current) {
          setLoading(false)
        }
      }
    },
    [fn, options, toast],
  )

  return { mutate, loading, error, clearError }
}
