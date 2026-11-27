'use client'

import { useEffect, useState } from 'react'

export const LOCAL_CODEX_NOTICE =
  '배포 주소(Vercel)에서는 히스토리·에디터 보기/고치기만 되고, 만들기는 PC에서 `npm run dev`를 켠 http://localhost:3000 주소에서 해주세요.'

export function isLocalCodexHostname(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1'
}

export function useLocalCodexAvailable(): boolean {
  const [available, setAvailable] = useState(false)
  useEffect(() => setAvailable(isLocalCodexHostname(window.location.hostname)), [])
  return available
}

export function LocalCodexNotice() {
  const available = useLocalCodexAvailable()
  return (
    <div
      className={`mb-4 rounded-lg border px-3 py-2 text-xs ${
        available
          ? 'border-brand-200 bg-brand-50 text-brand-700'
          : 'border-warning-500/30 bg-warning-50 text-warning-700'
      }`}
    >
      {LOCAL_CODEX_NOTICE}
    </div>
  )
}
