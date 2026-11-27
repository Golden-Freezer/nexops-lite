'use client'

import { useState, useEffect, useCallback, createContext, useContext, useRef } from 'react'

export interface Business {
  id: string
  user_id: string
  business_name: string
  business_number: string | null
  representative: string | null
  business_type: string | null
  business_category: string | null
  address: string | null
  is_default: boolean
  created_at: string
}

export interface BusinessForm {
  businessName: string
  businessNumber?: string
  representative?: string
  businessType?: string
  businessCategory?: string
  address?: string
  isDefault?: boolean
}

interface BusinessContextValue {
  businesses: Business[]
  currentBusiness: Business | null
  loading: boolean
  error: string | null
  switchBusiness: (id: string) => void
  fetchBusinesses: () => Promise<void>
  addBusiness: (form: BusinessForm) => Promise<Business | null>
  updateBusiness: (id: string, form: Partial<BusinessForm>) => Promise<Business | null>
  deleteBusiness: (id: string) => Promise<boolean>
}

const BusinessContext = createContext<BusinessContextValue | null>(null)

export function useBusinessContext() {
  const ctx = useContext(BusinessContext)
  if (!ctx) throw new Error('useBusinessContext must be used within BusinessProvider')
  return ctx
}

export { BusinessContext }

const STORAGE_KEY = 'nexops_current_business_id'

export function useBusinessProvider(): BusinessContextValue {
  const [businesses, setBusinesses] = useState<Business[]>([])
  const [currentBusinessId, setCurrentBusinessId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const requestVersion = useRef(0)

  const currentBusiness = businesses.find((b) => b.id === currentBusinessId) || null

  const fetchBusinesses = useCallback(async () => {
    const version = ++requestVersion.current
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/businesses', { cache: 'no-store' })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || '사업자 목록 조회 실패')
      const list: Business[] = json.data || []
      if (version !== requestVersion.current) return
      setBusinesses(list)

      // 저장된 ID 복원 또는 기본 사업자 선택
      const savedId = localStorage.getItem(STORAGE_KEY)
      if (savedId && list.some((b) => b.id === savedId)) {
        setCurrentBusinessId(savedId)
      } else {
        const defaultBiz = list.find((b) => b.is_default) || list[0] || null
        if (defaultBiz) {
          setCurrentBusinessId(defaultBiz.id)
          localStorage.setItem(STORAGE_KEY, defaultBiz.id)
        } else {
          setCurrentBusinessId(null)
          localStorage.removeItem(STORAGE_KEY)
        }
      }
    } catch (loadError) {
      if (version === requestVersion.current) {
        setError(loadError instanceof Error ? loadError.message : '사업자 목록 조회 실패')
      }
    } finally {
      if (version === requestVersion.current) setLoading(false)
    }
  }, [])

  useEffect(() => { fetchBusinesses() }, [fetchBusinesses])

  const switchBusiness = useCallback((id: string) => {
    if (!businesses.some((business) => business.id === id)) {
      setError('소유한 사업자 목록에서 선택할 수 없습니다.')
      return
    }
    setError(null)
    setCurrentBusinessId(id)
    localStorage.setItem(STORAGE_KEY, id)
  }, [businesses])

  const addBusiness = useCallback(async (form: BusinessForm): Promise<Business | null> => {
    setError(null)
    try {
      const res = await fetch('/api/businesses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || '사업자 등록 실패')
      await fetchBusinesses()
      // 첫 사업자면 자동 전환
      if (businesses.length === 0 && json.data) {
        setCurrentBusinessId(json.data.id)
        localStorage.setItem(STORAGE_KEY, json.data.id)
      }
      return json.data
    } catch (mutationError) {
      const message = mutationError instanceof Error ? mutationError.message : '사업자 등록 실패'
      setError(message)
      throw new Error(message)
    }
  }, [fetchBusinesses, businesses.length])

  const updateBusiness = useCallback(async (id: string, form: Partial<BusinessForm>): Promise<Business | null> => {
    setError(null)
    try {
      const res = await fetch('/api/businesses', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, ...form }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || '사업자 수정 실패')
      await fetchBusinesses()
      return json.data
    } catch (mutationError) {
      const message = mutationError instanceof Error ? mutationError.message : '사업자 수정 실패'
      setError(message)
      throw new Error(message)
    }
  }, [fetchBusinesses])

  const deleteBusiness = useCallback(async (id: string): Promise<boolean> => {
    setError(null)
    try {
      const res = await fetch(`/api/businesses?id=${id}`, { method: 'DELETE' })
      const json = await res.json()
      if (!res.ok) {
        const dependencies = Array.isArray(json.dependencies) && json.dependencies.length > 0
          ? ` (${json.dependencies.join(', ')})`
          : ''
        throw new Error(`${json.error || '사업자 삭제 실패'}${dependencies}`)
      }
      await fetchBusinesses()
      return true
    } catch (mutationError) {
      const message = mutationError instanceof Error ? mutationError.message : '사업자 삭제 실패'
      setError(message)
      throw new Error(message)
    }
  }, [fetchBusinesses])

  return {
    businesses,
    currentBusiness,
    loading,
    error,
    switchBusiness,
    fetchBusinesses,
    addBusiness,
    updateBusiness,
    deleteBusiness,
  }
}
