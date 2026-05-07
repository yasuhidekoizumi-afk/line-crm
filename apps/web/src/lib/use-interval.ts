import { useEffect, useRef } from 'react'

/**
 * 一定間隔でコールバックを実行するカスタムフック。
 * コンポーネントがマウントされている間のみ動く。
 */
export function useInterval(callback: () => void, delayMs: number | null) {
  const savedCallback = useRef(callback)

  useEffect(() => {
    savedCallback.current = callback
  }, [callback])

  useEffect(() => {
    if (delayMs === null) return
    const id = setInterval(() => savedCallback.current(), delayMs)
    return () => clearInterval(id)
  }, [delayMs])
}
