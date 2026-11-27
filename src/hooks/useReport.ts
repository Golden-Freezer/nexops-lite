'use client'

import { useState, useCallback } from 'react'
import type { ProfitLossRow, SkuProfitability, PeriodFilter } from '@/types/settlement'
import { apiFetch } from '@/lib/api-client'
import { kstTodayStr, monthRange, shiftDate } from '@/lib/analytics/date-buckets'

/** 기간 프리셋 날짜 계산 */
function getPresetDates(
  type: 'week' | 'month' | 'last-month' | 'last7' | 'last30' | 'custom',
  now: Date = new Date(),
): { periodStart: string; periodEnd: string } {
  const today = kstTodayStr(now)

  if (type === 'week') {
    // 이번 주 월요일 ~ 일요일 (7일 전체)
    const dow = new Date(`${today}T00:00:00Z`).getUTCDay()
    const diffToMon = dow === 0 ? 6 : dow - 1
    const monday = shiftDate(today, -diffToMon)
    return { periodStart: monday, periodEnd: shiftDate(monday, 6) }
  }

  if (type === 'last7') {
    return { periodStart: shiftDate(today, -6), periodEnd: today }
  }

  if (type === 'last30') {
    return { periodStart: shiftDate(today, -29), periodEnd: today }
  }

  if (type === 'month') {
    // 이번 달 1일 ~ 오늘
    return { periodStart: `${today.slice(0, 7)}-01`, periodEnd: today }
  }

  // last-month / custom: 지난 달 1일 ~ 마지막 날
  const lastMonthLastDay = shiftDate(`${today.slice(0, 7)}-01`, -1)
  const previousMonth = monthRange(lastMonthLastDay.slice(0, 7))
  return {
    periodStart: previousMonth.startDate,
    periodEnd: previousMonth.endDate,
  }
}

export function getDefaultPeriod(now: Date = new Date()): PeriodFilter {
  // 기본 기간: 최근 30일(롤링). '이번 달'은 월초에 데이터가 비어 보이는 문제가 있어 대체.
  const { periodStart, periodEnd } = getPresetDates('last30', now)
  return { type: 'last30', periodStart, periodEnd }
}

export { getPresetDates }

export function useReport() {
  const [profitLoss, setProfitLoss] = useState<ProfitLossRow[]>([])
  const [ranking, setRanking] = useState<SkuProfitability[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchReport = useCallback(async (periodStart?: string, periodEnd?: string) => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      if (periodStart) params.set('periodStart', periodStart)
      if (periodEnd) params.set('periodEnd', periodEnd)

      const url = `/api/settlement/report${params.toString() ? `?${params}` : ''}`
      const res = await apiFetch(url)
      const json = await res.json()

      if (!res.ok) throw new Error(json.error)

      setProfitLoss(json.data)
    } catch (err) {
      setProfitLoss([])
      setError(err instanceof Error ? err.message : '손익 리포트 조회 실패')
    } finally {
      setLoading(false)
    }
  }, [])

  const fetchRanking = useCallback(async (periodStart?: string, periodEnd?: string) => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      if (periodStart) params.set('periodStart', periodStart)
      if (periodEnd) params.set('periodEnd', periodEnd)

      const url = `/api/settlement/ranking${params.toString() ? `?${params}` : ''}`
      const res = await apiFetch(url)
      const json = await res.json()

      if (!res.ok) throw new Error(json.error)

      setRanking(json.data)
    } catch (err) {
      setRanking([])
      setError(err instanceof Error ? err.message : 'SKU 랭킹 조회 실패')
    } finally {
      setLoading(false)
    }
  }, [])

  return {
    profitLoss,
    ranking,
    loading,
    error,
    fetchReport,
    fetchRanking,
    setError,
  }
}
