'use client'

import { useState, useCallback } from 'react'
import { apiFetch } from '@/lib/api-client'
import type { Granularity, PnlBucket, PnlSummaryData } from '@/lib/analytics/types'

/** /api/analytics/pnl 조회 훅 — usePnl.ts와 동일 패턴 */
export function useAnalyticsPnl() {
  const [summary, setSummary] = useState<PnlSummaryData | null>(null)
  const [buckets, setBuckets] = useState<PnlBucket[]>([])
  const [granularity, setGranularity] = useState<Granularity>('daily')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchPnl = useCallback(async (startDate: string, endDate: string, g: Granularity = 'daily') => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ startDate, endDate, granularity: g })
      const res = await apiFetch(`/api/analytics/pnl?${params}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      setSummary(json.data.summary)
      setBuckets(json.data.buckets || [])
      setGranularity(json.data.granularity || g)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'P&L 조회 실패')
    } finally {
      setLoading(false)
    }
  }, [])

  return { summary, buckets, granularity, loading, error, fetchPnl }
}
