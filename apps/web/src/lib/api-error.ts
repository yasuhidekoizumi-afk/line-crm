/**
 * グローバルAPIエラーハンドラの型
 */
export type ApiErrorHandler = (status: number, message: string) => void

/** 設定されたエラーハンドラ（なければ undefined） */
let _errorHandler: ApiErrorHandler | undefined

/** 外部からエラーハンドラを登録（AppShell / layout で useToast と接続） */
export function setApiErrorHandler(handler: ApiErrorHandler | undefined) {
  _errorHandler = handler
}

/**
 * APIエラー発生時に登録済みハンドラを呼ぶ。
 * fetchApi 内部から利用される。
 */
export function notifyApiError(status: number, message: string) {
  _errorHandler?.(status, message)
}
