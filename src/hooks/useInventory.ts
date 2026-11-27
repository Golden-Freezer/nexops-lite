'use client'

import { useState, useCallback, useEffect } from 'react'
import { apiFetch } from '@/lib/api-client'
import type {
  InventoryItem,
  StockAlert,
  InventoryMovement,
  InboundFormData,
} from '@/types/inventory'

export function useInventory() {
  const [items, setItems] = useState<InventoryItem[]>([])
  const [alerts, setAlerts] = useState<StockAlert[]>([])
  const [movements, setMovements] = useState<InventoryMovement[]>([])
  const [loading, setLoading] = useState(false)
  const [movementsLoading, setMovementsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchInventory = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await apiFetch('/api/inventory')
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      setItems(json.data)
    } catch (err) {
      setError(err instanceof Error ? err.message : '재고 조회 실패')
    } finally {
      setLoading(false)
    }
  }, [])

  const fetchAlerts = useCallback(async () => {
    try {
      const res = await apiFetch('/api/inventory/alerts')
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      setAlerts(json.data)
    } catch (err) {
      console.error('알림 조회 실패:', err)
    }
  }, [])

  const fetchMovements = useCallback(async (productId?: string) => {
    setMovementsLoading(true)
    try {
      const params = new URLSearchParams()
      if (productId) params.set('productId', productId)
      const res = await apiFetch(`/api/inventory/movements?${params.toString()}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      setMovements(json.data)
    } catch (err) {
      console.error('이력 조회 실패:', err)
      setMovements([])
    } finally {
      setMovementsLoading(false)
    }
  }, [])

  const submitInbound = useCallback(
    async (data: InboundFormData) => {
      setError(null)
      try {
        const res = await apiFetch('/api/inventory/movements', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...data, movementType: 'inbound' }),
        })
        const json = await res.json()
        if (!res.ok) throw new Error(json.error)
        await Promise.all([fetchInventory(), fetchAlerts()])
        if (data.productId) await fetchMovements(data.productId)
      } catch (err) {
        const msg = err instanceof Error ? err.message : '입고 등록 실패'
        setError(msg)
        throw err
      }
    },
    [fetchInventory, fetchAlerts, fetchMovements]
  )

  const submitOutbound = useCallback(
    async (data: InboundFormData & { reason?: string }) => {
      setError(null)
      try {
        const res = await apiFetch('/api/inventory/movements', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...data, movementType: 'outbound' }),
        })
        const json = await res.json()
        if (!res.ok) throw new Error(json.error)
        await Promise.all([fetchInventory(), fetchAlerts()])
        if (data.productId) await fetchMovements(data.productId)
      } catch (err) {
        const msg = err instanceof Error ? err.message : '출고 등록 실패'
        setError(msg)
        throw err
      }
    },
    [fetchInventory, fetchAlerts, fetchMovements]
  )

  const submitAdjustment = useCallback(
    async (data: InboundFormData & { reason?: string }) => {
      setError(null)
      try {
        const res = await apiFetch('/api/inventory/movements', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...data, movementType: 'adjustment' }),
        })
        const json = await res.json()
        if (!res.ok) throw new Error(json.error)
        await Promise.all([fetchInventory(), fetchAlerts()])
        if (data.productId) await fetchMovements(data.productId)
      } catch (err) {
        const msg = err instanceof Error ? err.message : '조정 등록 실패'
        setError(msg)
        throw err
      }
    },
    [fetchInventory, fetchAlerts, fetchMovements]
  )

  useEffect(() => {
    fetchInventory()
    fetchAlerts()
    fetchMovements() // 최근 이력 (재고현황 탭용)
  }, [fetchInventory, fetchAlerts, fetchMovements])

  return {
    items, alerts, movements, loading, movementsLoading, error,
    fetchInventory, fetchAlerts, fetchMovements,
    submitInbound, submitOutbound, submitAdjustment, setError,
  }
}
