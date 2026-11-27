'use client'

import { useState, useCallback } from 'react'
import type { SalesTransaction, SalesTransactionForm } from '@/types/sales'
import { apiFetch } from '@/lib/api-client'

export function useSalesTransactions() {
  const [transactions, setTransactions] = useState<SalesTransaction[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchTransactions = useCallback(async (startDate?: string, endDate?: string) => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      if (startDate) params.set('startDate', startDate)
      if (endDate) params.set('endDate', endDate)
      const url = `/api/sales${params.toString() ? `?${params}` : ''}`
      const res = await apiFetch(url)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      setTransactions(json.data || [])
    } catch (err) {
      setTransactions([])
      setError(err instanceof Error ? err.message : '매출 조회 실패')
    } finally {
      setLoading(false)
    }
  }, [])

  /** 판매자할인쿠폰 직접 수정 → 서버에서 마진 재계산, 로컬 상태 즉시 반영 */
  const updateCoupon = useCallback(async (id: string, couponDiscount: number) => {
    try {
      const res = await apiFetch('/api/sales', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, couponDiscount }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      const updated = json.data
      setTransactions((prev) =>
        prev.map((tx) => (tx.id === id ? { ...tx, coupon_discount: updated.coupon_discount, margin: updated.margin } : tx))
      )
      return updated
    } catch (err) {
      setError(err instanceof Error ? err.message : '쿠폰 수정 실패')
      return null
    }
  }, [])

  const addTransaction = useCallback(async (form: SalesTransactionForm) => {
    setLoading(true)
    setError(null)
    try {
      const res = await apiFetch('/api/sales', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      await fetchTransactions()
      return json.data
    } catch (err) {
      setError(err instanceof Error ? err.message : '매출 등록 실패')
      return null
    } finally {
      setLoading(false)
    }
  }, [fetchTransactions])

  return { transactions, loading, error, setError, fetchTransactions, addTransaction, updateCoupon }
}
