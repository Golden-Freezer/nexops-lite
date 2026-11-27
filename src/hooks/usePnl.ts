'use client'

import { useState, useCallback } from 'react'
import { apiFetch } from '@/lib/api-client'

export interface PnlSummary {
  totalRevenue: number
  totalQuantity: number
  totalCancelAmount: number
  totalCoupon: number
  totalCommission: number
  totalCommissionVat: number
  totalFulfillment: number
  totalFulfillmentVat: number
  totalCost: number
  totalVat: number
  totalMargin: number
  totalAdSpend: number
  totalAdVat: number
  totalExpenses: number
  coupangDeductionExpenses: number
  netProfit: number
}

export interface PnlDaily {
  date: string
  revenue: number
  quantity: number
  cost: number
  commission: number
  commissionVat: number
  fulfillment: number
  fulfillmentVat: number
  coupon: number
  vat: number
  cancelAmount: number
  margin: number
  adSpend: number
  expenses: number
  coupangDeductionExpenses: number
  netProfit: number
}

export function usePnl() {
  const [summary, setSummary] = useState<PnlSummary | null>(null)
  const [daily, setDaily] = useState<PnlDaily[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchPnl = useCallback(async (startDate?: string, endDate?: string) => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      if (startDate) params.set('startDate', startDate)
      if (endDate) params.set('endDate', endDate)
      const url = `/api/settlement/pnl${params.toString() ? `?${params}` : ''}`
      const res = await apiFetch(url)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      setSummary(json.data.summary)
      setDaily(json.data.daily || [])
    } catch (err) {
      setSummary(null)
      setDaily([])
      setError(err instanceof Error ? err.message : 'P&L 조회 실패')
    } finally {
      setLoading(false)
    }
  }, [])

  return { summary, daily, loading, error, setError, fetchPnl }
}
