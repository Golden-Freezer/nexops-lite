'use client'

import { useEffect } from 'react'

/** 프로덕션에서만 서비스 워커를 등록해 개발 중 오래된 캐시 간섭을 막는다. */
export function PwaRegister() {
  useEffect(() => {
    if (
      process.env.NODE_ENV !== 'production'
      || !('serviceWorker' in navigator)
    ) {
      return
    }

    navigator.serviceWorker.register('/sw.js', {
      scope: '/',
      updateViaCache: 'none',
    }).catch(() => {
      // PWA 미지원/등록 거부 환경에서도 웹 앱 자체는 그대로 동작한다.
    })
  }, [])

  return null
}
