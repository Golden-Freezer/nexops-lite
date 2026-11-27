'use client'

import { useState, useEffect } from 'react'
import { Loader2 } from 'lucide-react'
import { apiFetch } from '@/lib/api-client'
import { KpiStatCard } from '@/components/charts/KpiStatCard'
import { fmtNum } from '@/lib/analytics/format'

interface ProductsSummary {
  total: number
  active: number
  paused: number
  outOfStock: number
  negativeMargin: number
  negativeMarginAvailable: boolean
}

/** 상품관리 KPI 카드 — 자기완결 섹션. 필터와 연동하지 않음 (전체 기준 고정) */
export function ProductsKpiSection() {
  const [data, setData] = useState<ProductsSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    apiFetch('/api/products/summary')
      .then((r) => r.json())
      .then((json) => {
        if (cancelled) return
        if (json.error) setError(json.error)
        else setData(json.data)
      })
      .catch(() => { if (!cancelled) setError('조회 실패') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  if (loading) {
    return (
      <div className="max-w-full px-4 lg:px-6 pt-4">
        <div className="bg-white rounded-xl border border-slate-200 shadow-card p-4 flex items-center justify-center min-h-[72px]">
          <Loader2 className="w-4 h-4 animate-spin text-slate-300" />
        </div>
      </div>
    )
  }
  if (error || !data || data.total === 0) return null

  const showNegativeMargin = data.negativeMarginAvailable
  const gridCols = showNegativeMargin ? 'lg:grid-cols-5' : 'lg:grid-cols-4'

  return (
    <div className="max-w-full px-4 lg:px-6 pt-4">
      <div className={`grid grid-cols-2 ${gridCols} gap-3`}>
        <KpiStatCard label="등록 상품" value={fmtNum(data.total)} unit="개" />
        <KpiStatCard label="판매중" value={fmtNum(data.active)} unit="개" />
        <KpiStatCard label="판매중지" value={fmtNum(data.paused)} unit="개" />
        <KpiStatCard
          label="품절/재고 소진"
          value={fmtNum(data.outOfStock)}
          unit="개"
          tone={data.outOfStock > 0 ? 'warning' : 'default'}
        />
        {showNegativeMargin && (
          <KpiStatCard
            label="역마진"
            value={fmtNum(data.negativeMargin)}
            unit="개"
            tone={data.negativeMargin > 0 ? 'loss' : 'default'}
          />
        )}
      </div>
    </div>
  )
}
