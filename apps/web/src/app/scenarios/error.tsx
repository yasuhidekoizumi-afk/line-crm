'use client'

import GlobalErrorFallback from '../error'

export default function ScenariosError({ error, reset }: { error: Error; reset: () => void }) {
  return <GlobalErrorFallback error={error} reset={reset} />
}