'use client'

import { useState, useCallback } from 'react'
import type { SettlementItem, SettlementFormData } from '@/types/settlement'
import { apiFetch } from '@/lib/api-client'

export function useSettlement() {
  const [settlements, setSettlements] = useState<SettlementItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchSettlements = useCallback(async (periodStart?: string, periodEnd?: string) => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      if (periodStart) params.set('periodStart', periodStart)
      if (periodEnd) params.set('periodEnd', periodEnd)

      const url = `/api/settlement${params.toString() ? `?${params}` : ''}`
      const res = await apiFetch(url)
      const json = await res.json()

      if (!res.ok) throw new Error(json.error)

      setSettlements(json.data)
    } catch (err) {
      setSettlements([])
      setError(err instanceof Error ? err.message : '정산 내역 조회 실패')
    } finally {
      setLoading(false)
    }
  }, [])

  const submitSettlement = useCallback(async (data: SettlementFormData) => {
    setLoading(true)
    setError(null)
    try {
      const res = await apiFetch('/api/settlement', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      const json = await res.json()

      if (!res.ok) throw new Error(json.error)

      // 등록 후 목록 갱신
      await fetchSettlements()
      return json.data
    } catch (err) {
      setError(err instanceof Error ? err.message : '정산 등록 실패')
      return null
    } finally {
      setLoading(false)
    }
  }, [fetchSettlements])

  const toggleVerified = useCallback(async (id: string, currentValue: boolean) => {
    try {
      const res = await apiFetch(`/api/settlement/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ verified: !currentValue }),
      })
      const json = await res.json()

      if (!res.ok) throw new Error(json.error)

      // 로컬 상태 업데이트 (리페치 없이 빠른 반영)
      setSettlements((prev) =>
        prev.map((item) =>
          item.id === id ? { ...item, verified: !currentValue } : item
        )
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : '검증 상태 변경 실패')
    }
  }, [])

  return {
    settlements,
    loading,
    error,
    fetchSettlements,
    submitSettlement,
    toggleVerified,
    setError,
  }
}
