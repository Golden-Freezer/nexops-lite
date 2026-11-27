'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import type { OverviewData } from '@/lib/analytics/types'

/**
 * /api/overview 조회 훅 — useAnalyticsPnl과 동일 패턴.
 * X-Business-Id가 불필요한(무시되는) 전사 엔드포인트이므로
 * apiFetch가 아닌 일반 fetch로 의도를 코드에 명시한다.
 */
export function useOverview() {
  const [data, setData] = useState<OverviewData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const mountedRef = useRef(true)
  const requestSequenceRef = useRef(0)
  const activeRequestRef = useRef<{
    id: number
    controller: AbortController
  } | null>(null)

  useEffect(() => {
    mountedRef.current = true

    return () => {
      mountedRef.current = false
      requestSequenceRef.current += 1
      activeRequestRef.current?.controller.abort()
      activeRequestRef.current = null
    }
  }, [])

  const fetchOverview = useCallback(
    async (startDate: string, endDate: string) => {
      if (!mountedRef.current) return

      const requestId = ++requestSequenceRef.current
      activeRequestRef.current?.controller.abort()

      const controller = new AbortController()
      activeRequestRef.current = { id: requestId, controller }

      // 기간 라벨은 호출 측에서 먼저 바뀌므로 이전 기간 수치를 즉시 제거한다.
      setData(null)
      setLoading(true)
      setError(null)

      const isCurrentRequest = () =>
        mountedRef.current &&
        activeRequestRef.current?.id === requestId &&
        !controller.signal.aborted

      try {
        const params = new URLSearchParams({ startDate, endDate })
        const res = await fetch(`/api/overview?${params}`, {
          signal: controller.signal,
        })
        const json = await res.json()
        if (!isCurrentRequest()) return
        if (!res.ok) throw new Error(json.error)
        setData(json.data)
      } catch (err) {
        if (!isCurrentRequest()) return
        setError(err instanceof Error ? err.message : '전체 현황 조회 실패')
      } finally {
        if (!isCurrentRequest()) return
        activeRequestRef.current = null
        setLoading(false)
      }
    },
    [],
  )

  return { data, loading, error, fetchOverview }
}
