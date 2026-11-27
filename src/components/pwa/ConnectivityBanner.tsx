'use client'

import { useEffect, useState } from 'react'
import { WifiOff } from 'lucide-react'

export function ConnectivityBanner() {
  const [online, setOnline] = useState(true)

  useEffect(() => {
    const update = () => setOnline(navigator.onLine)
    update()
    window.addEventListener('online', update)
    window.addEventListener('offline', update)
    return () => {
      window.removeEventListener('online', update)
      window.removeEventListener('offline', update)
    }
  }, [])

  if (online) return null

  return (
    <div
      role="status"
      className="flex items-center justify-center gap-2 border-b border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800"
    >
      <WifiOff className="h-3.5 w-3.5" />
      오프라인 상태입니다. 조회와 저장은 연결 복구 후 다시 시도해주세요.
    </div>
  )
}
