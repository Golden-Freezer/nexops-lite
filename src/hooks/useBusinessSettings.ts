'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { apiFetch } from '@/lib/api-client'
import { useBusinessContext } from '@/hooks/useBusiness'
import type { BusinessSettings, BusinessSettingsUpdate } from '@/types/settings'

export function useBusinessSettings() {
  const { currentBusiness } = useBusinessContext()
  const businessId = currentBusiness?.id ?? null
  const [settings, setSettings] = useState<BusinessSettings | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const requestVersion = useRef(0)

  const load = useCallback(async () => {
    const version = ++requestVersion.current
    if (!businessId) {
      setSettings(null)
      setError(null)
      setLoading(false)
      return null
    }

    setSettings((current) => current?.businessId === businessId ? current : null)
    setLoading(true)
    setError(null)
    try {
      const response = await apiFetch('/api/settings', { cache: 'no-store' })
      const json = await response.json()
      if (!response.ok) throw new Error(json.error || '설정 조회 실패')
      if (json.data?.businessId !== businessId) {
        throw new Error('선택한 사업장과 다른 설정 응답을 받았습니다.')
      }
      if (version !== requestVersion.current) return null
      setSettings(json.data)
      return json.data as BusinessSettings
    } catch (loadError) {
      if (version !== requestVersion.current) return null
      const message = loadError instanceof Error ? loadError.message : '설정 조회 실패'
      setError(message)
      setSettings((current) => current?.businessId === businessId ? current : null)
      return null
    } finally {
      if (version === requestVersion.current) setLoading(false)
    }
  }, [businessId])

  useEffect(() => {
    void load()
  }, [load])

  const save = useCallback(async (update: BusinessSettingsUpdate) => {
    if (!businessId) throw new Error('사업자를 먼저 선택하세요.')
    const version = requestVersion.current
    const response = await apiFetch('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(update),
    })
    const json = await response.json()
    if (!response.ok) throw new Error(json.error || '설정 저장 실패')
    if (json.data?.businessId !== businessId) {
      throw new Error('선택한 사업장과 다른 설정 저장 응답을 받았습니다.')
    }
    if (version === requestVersion.current) {
      setSettings(json.data)
      setError(null)
    }
    return json.data as BusinessSettings
  }, [businessId])

  const currentSettings = settings?.businessId === businessId ? settings : null
  return { businessId, settings: currentSettings, loading, error, reload: load, save }
}
