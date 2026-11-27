'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertCircle, ChevronLeft, ChevronRight, Loader2, RefreshCw } from 'lucide-react'
import { Header } from '@/components/layout/Header'
import { FocusAdAnalysis } from '@/components/features/focus/FocusAdAnalysis'
import { FocusMonthTable } from '@/components/features/focus/FocusMonthTable'
import { FocusProductSelector } from '@/components/features/focus/FocusProductSelector'
import { FocusRankPanel } from '@/components/features/focus/FocusRankPanel'
import { FocusRegisterModal } from '@/components/features/focus/FocusRegisterModal'
import { FocusSettingHistory } from '@/components/features/focus/FocusSettingHistory'
import { useBusinessContext } from '@/hooks/useBusiness'
import { apiFetch } from '@/lib/api-client'
import { kstTodayStr } from '@/lib/analytics/date-buckets'
import type { DailyResponse, FocusProduct } from '@/types/focus'

interface MonthState {
  year: number
  month: number
}

function previousKstDate(): string {
  const date = new Date(`${kstTodayStr()}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() - 1)
  return date.toISOString().slice(0, 10)
}

function initialMonth(): MonthState {
  const yesterday = previousKstDate()
  return { year: Number(yesterday.slice(0, 4)), month: Number(yesterday.slice(5, 7)) }
}

function moveMonth(current: MonthState, offset: number): MonthState {
  const moved = new Date(Date.UTC(current.year, current.month - 1 + offset, 1))
  return { year: moved.getUTCFullYear(), month: moved.getUTCMonth() + 1 }
}

async function parseJson(response: Response): Promise<Record<string, unknown>> {
  try {
    return await response.json() as Record<string, unknown>
  } catch {
    return {}
  }
}

export default function FocusProductsPage() {
  const { currentBusiness, loading: businessLoading } = useBusinessContext()
  const [month, setMonth] = useState<MonthState>(initialMonth)
  const [products, setProducts] = useState<FocusProduct[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [daily, setDaily] = useState<DailyResponse | null>(null)
  const [productsLoading, setProductsLoading] = useState(false)
  const [dailyLoading, setDailyLoading] = useState(false)
  const [productsError, setProductsError] = useState<string | null>(null)
  const [dailyError, setDailyError] = useState<string | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [dailyReloadKey, setDailyReloadKey] = useState(0)
  const listRequest = useRef(0)
  const today = kstTodayStr()
  const yesterday = previousKstDate()

  const loadProducts = useCallback(async (preferredId?: string) => {
    if (!currentBusiness) return
    const requestId = ++listRequest.current
    setProductsLoading(true)
    setProductsError(null)
    try {
      const response = await apiFetch('/api/focus/products?includeInactive=0')
      const json = await parseJson(response)
      if (!response.ok) throw new Error(String(json.error || '주력상품 목록 조회에 실패했습니다.'))
      if (requestId !== listRequest.current) return
      const nextProducts = (json.data as FocusProduct[] | undefined) ?? []
      setProducts(nextProducts)
      setSelectedId((current) => {
        if (preferredId && nextProducts.some((product) => product.id === preferredId)) return preferredId
        if (nextProducts.some((product) => product.id === current)) return current
        return nextProducts[0]?.id ?? ''
      })
    } catch (reason) {
      if (requestId !== listRequest.current) return
      setProducts([])
      setSelectedId('')
      setProductsError(reason instanceof Error ? reason.message : '주력상품 목록 조회에 실패했습니다.')
    } finally {
      if (requestId === listRequest.current) setProductsLoading(false)
    }
  }, [currentBusiness])

  useEffect(() => {
    listRequest.current += 1
    setProducts([])
    setSelectedId('')
    setDaily(null)
    setProductsError(null)
    setDailyError(null)
    setModalOpen(false)
    if (!businessLoading && currentBusiness) void loadProducts()
  }, [businessLoading, currentBusiness, loadProducts])

  useEffect(() => {
    if (!currentBusiness || !selectedId) {
      setDaily(null)
      setDailyLoading(false)
      return
    }

    const controller = new AbortController()
    setDailyLoading(true)
    setDailyError(null)
    setDaily(null)
    const params = new URLSearchParams({
      focusProductId: selectedId,
      year: String(month.year),
      month: String(month.month),
    })

    apiFetch(`/api/focus/daily?${params.toString()}`, { signal: controller.signal })
      .then(async (response) => {
        const json = await parseJson(response)
        if (!response.ok) throw new Error(String(json.error || '월간 운영 데이터 조회에 실패했습니다.'))
        if (!controller.signal.aborted) setDaily(json.data as DailyResponse)
      })
      .catch((reason) => {
        if (reason instanceof DOMException && reason.name === 'AbortError') return
        if (!controller.signal.aborted) {
          setDailyError(reason instanceof Error ? reason.message : '월간 운영 데이터 조회에 실패했습니다.')
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setDailyLoading(false)
      })

    return () => controller.abort()
  }, [currentBusiness, selectedId, month, dailyReloadKey])

  const currentSettings = useMemo(() => {
    const todayRow = daily?.rows.find((row) => row.date === today)
    const yesterdayRow = daily?.rows.find((row) => row.date === yesterday)
    return {
      budget: todayRow?.budget ?? yesterdayRow?.budget ?? null,
      targetRoas: todayRow?.target_roas ?? yesterdayRow?.target_roas ?? null,
    }
  }, [daily, today, yesterday])

  const handleRegistered = async (product: FocusProduct) => {
    await loadProducts(product.id)
  }

  return (
    <>
      <Header title="주력상품 관리" />
      <main className="mx-auto max-w-[1600px] space-y-4 px-4 py-5 lg:px-6">
        {businessLoading ? (
          <div className="flex min-h-[50vh] items-center justify-center">
            <Loader2 className="h-7 w-7 animate-spin text-emerald-500" />
          </div>
        ) : !currentBusiness ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-5 py-8 text-center text-sm text-amber-700">
            사업장을 선택하세요.
          </div>
        ) : (
          <>
            <FocusProductSelector
              products={products}
              selectedId={selectedId}
              loading={productsLoading}
              budget={currentSettings.budget}
              targetRoas={currentSettings.targetRoas}
              freshness={daily?.freshness.adDailyLastObservedAt ?? null}
              onSelect={setSelectedId}
              onRegister={() => setModalOpen(true)}
            />

            {productsError && (
              <div className="flex items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                <span className="inline-flex items-center gap-2"><AlertCircle className="h-4 w-4" />{productsError}</span>
                <button type="button" onClick={() => void loadProducts()} className="inline-flex items-center gap-1 font-medium hover:text-red-800">
                  <RefreshCw className="h-3.5 w-3.5" /> 다시 시도
                </button>
              </div>
            )}

            {products.length > 0 && (
              <>
                <div className="flex items-center justify-center gap-3">
                  <button type="button" onClick={() => setMonth((value) => moveMonth(value, -1))} aria-label="이전 달" className="rounded-lg border border-slate-200 bg-white p-2 text-slate-500 hover:bg-slate-50">
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <h2 className="min-w-32 text-center text-base font-semibold text-slate-700">{month.year}년 {month.month}월</h2>
                  <button type="button" onClick={() => setMonth((value) => moveMonth(value, 1))} aria-label="다음 달" className="rounded-lg border border-slate-200 bg-white p-2 text-slate-500 hover:bg-slate-50">
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>

                {dailyError && (
                  <div className="flex items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                    <span className="inline-flex items-center gap-2"><AlertCircle className="h-4 w-4" />{dailyError}</span>
                    <button type="button" onClick={() => setDailyReloadKey((value) => value + 1)} className="inline-flex items-center gap-1 font-medium hover:text-red-800">
                      <RefreshCw className="h-3.5 w-3.5" /> 다시 시도
                    </button>
                  </div>
                )}

                {dailyLoading ? (
                  <div className="flex min-h-[320px] items-center justify-center rounded-xl border border-slate-200 bg-white">
                    <Loader2 className="h-6 w-6 animate-spin text-emerald-500" />
                  </div>
                ) : daily ? (
                  <>
                    <FocusMonthTable rows={daily.rows} totals={daily.totals} yesterday={yesterday} />
                    <FocusAdAnalysis focusProductId={selectedId} />
                    <FocusSettingHistory rows={daily.rows} />
                  </>
                ) : !dailyError ? (
                  <div className="rounded-xl border border-slate-200 bg-white px-5 py-12 text-center text-sm text-slate-400">표시할 월간 데이터가 없습니다.</div>
                ) : null}

                {selectedId && (
                  <FocusRankPanel
                    focusProductId={selectedId}
                    year={month.year}
                    month={month.month}
                  />
                )}
              </>
            )}
          </>
        )}
      </main>

      <FocusRegisterModal open={modalOpen} onClose={() => setModalOpen(false)} onRegistered={handleRegistered} />
    </>
  )
}
