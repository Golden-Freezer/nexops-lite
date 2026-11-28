'use client'

/**
 * 우리 쿠팡 상품 고르기(J51) — 같은 사업장의 판매 상품(등록상품ID)을 5개까지 고르고, 옵션마다 1묶음 수량을 확인·고친다.
 * 판매 수는 여기서 세지 않는다. 잡 생성 POST가 판매장부를 읽어 판매 수 × 묶음 수량을 서버에서 센다(own-sales-load.ts).
 * 판매가 있는 옵션 중 하나라도 수량을 모르거나 단위가 섞이면 상세페이지에 판매 칸이 나오지 않는다.
 */

import { useContext, useState } from 'react'
import { Loader2, Search, X } from 'lucide-react'
import { BusinessContext } from '@/hooks/useBusiness'
import { pdpApi } from '@/lib/registration/pdp-client'
import { OWN_SALES_MAX_PRODUCTS, OWN_SALES_UNITS, type BundleQty } from '@/lib/registration/own-sales'
import type { OwnListing } from '@/lib/registration/own-sales-load'
import { SectionTitle } from './PdpFormFields'

export interface OwnSalesValue {
  listings: OwnListing[]
  bundleQty: Record<string, BundleQty>
}

export const EMPTY_OWN_SALES: OwnSalesValue = { listings: [], bundleQty: {} }

/** 잡 생성 본문 spec 칸 — 고른 것이 없으면 빈 객체(지금과 같은 본문) */
export function ownSalesSpecFields(value: OwnSalesValue): { ownSalesProductIds?: string[]; ownSalesBundleQty?: Record<string, BundleQty> } {
  if (value.listings.length === 0) return {}
  const rowIds = new Set(value.listings.flatMap((l) => l.options.map((o) => o.rowId)))
  const manual = Object.fromEntries(Object.entries(value.bundleQty).filter(([rowId]) => rowIds.has(rowId)))
  return { ownSalesProductIds: value.listings.map((l) => l.productId), ...(Object.keys(manual).length > 0 ? { ownSalesBundleQty: manual } : {}) }
}

/** 화면 사업장 — 초안 사업장이 이기고, 없으면 상단에서 고른 사업장(Provider 밖이면 없음) */
export function useOwnSalesBusinessId(draftBusinessId: string | null): string | null {
  const ctx = useContext(BusinessContext)
  return draftBusinessId ?? ctx?.currentBusiness?.id ?? null
}

export function PdpOwnSales({
  businessId,
  value,
  onChange,
  disabled,
}: {
  businessId: string | null
  value: OwnSalesValue
  onChange: (next: OwnSalesValue) => void
  disabled?: boolean
}) {
  const [q, setQ] = useState('')
  const [results, setResults] = useState<OwnListing[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const picked = new Set(value.listings.map((l) => l.productId))
  const full = value.listings.length >= OWN_SALES_MAX_PRODUCTS

  async function search() {
    if (!businessId) return
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ businessId, q: q.trim() })
      const { listings } = await pdpApi<{ listings: OwnListing[] }>(`/api/registration/pdp/own-products?${params}`)
      setResults(listings)
    } catch (e) {
      setError(e instanceof Error ? e.message : '상품 목록을 읽지 못했습니다.')
    } finally {
      setLoading(false)
    }
  }

  const add = (listing: OwnListing) => {
    if (picked.has(listing.productId) || full) return
    onChange({ ...value, listings: [...value.listings, listing] })
  }
  const remove = (productId: string) => onChange({ ...value, listings: value.listings.filter((l) => l.productId !== productId) })
  const setQty = (rowId: string, patch: Partial<BundleQty> | null, fallback: BundleQty | null) => {
    const next = { ...value.bundleQty }
    const base = next[rowId] ?? fallback ?? { qty: 0, unit: OWN_SALES_UNITS[0] }
    if (patch === null) delete next[rowId]
    else next[rowId] = { ...base, ...patch }
    onChange({ ...value, bundleQty: next })
  }

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 space-y-3">
      <SectionTitle>우리 쿠팡 판매량 (선택)</SectionTitle>
      <p className="text-[11px] text-slate-400">
        쿠팡에서 실제로 파는 우리 상품을 고르면, 판매장부의 판매 수 × 1묶음 수량을 누적 판매로 상세페이지에 씁니다(기간 함께 표기). 판매 기록이 없거나
        묶음 수량을 모르는 옵션이 있으면 쓰지 않습니다.
      </p>
      {!businessId ? (
        <p className="text-xs text-slate-500">사업장을 먼저 고르세요.</p>
      ) : (
        <>
          <div className="flex items-center gap-2">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), void search())}
              placeholder="상품명 또는 등록상품ID"
              disabled={disabled || loading}
              className="flex-1 min-w-0 border border-slate-200 rounded px-2 py-1.5 text-sm text-slate-700 focus:outline-none focus:border-brand-400 disabled:opacity-50"
            />
            <button
              onClick={() => void search()}
              disabled={disabled || loading}
              className="inline-flex items-center gap-1 text-xs px-3 py-1.5 rounded-full border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-50"
            >
              {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
              찾기
            </button>
          </div>
          {error && <p className="text-xs text-danger-700">{error}</p>}
          {results && (
            <ul className="max-h-48 overflow-y-auto divide-y divide-slate-100 rounded border border-slate-100">
              {results.length === 0 && <li className="px-2 py-1.5 text-xs text-slate-400">맞는 판매 상품이 없습니다.</li>}
              {results.map((l) => (
                <li key={l.productId} className="flex items-center justify-between gap-2 px-2 py-1.5 text-xs">
                  <span className="min-w-0 truncate text-slate-700">
                    {l.name || '(이름 없음)'} <span className="text-slate-400">· {l.productId} · 옵션 {l.options.length}</span>
                  </span>
                  <button
                    onClick={() => add(l)}
                    disabled={disabled || picked.has(l.productId) || full}
                    className="shrink-0 rounded-full border border-slate-200 px-2 py-0.5 text-slate-600 hover:bg-slate-50 disabled:opacity-40"
                  >
                    {picked.has(l.productId) ? '고름' : '고르기'}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      {value.listings.map((l) => (
        <div key={l.productId} className="rounded border border-slate-200 p-2 space-y-1.5">
          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="min-w-0 truncate font-medium text-slate-700">
              {l.name || '(이름 없음)'} <span className="font-normal text-slate-400">· {l.productId}</span>
            </span>
            <button onClick={() => remove(l.productId)} disabled={disabled} aria-label="고른 상품 빼기" className="text-slate-400 hover:text-slate-600 disabled:opacity-40">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          {l.options.map((o) => {
            const manual = value.bundleQty[o.rowId]
            const shown = manual ?? o.bundle
            return (
              <div key={o.rowId} className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                <span className="min-w-0 flex-1 truncate">{o.name || '(옵션명 없음)'}</span>
                <span>1묶음</span>
                <input
                  type="number"
                  min={1}
                  value={shown?.qty ?? ''}
                  placeholder="모름"
                  onChange={(e) => {
                    const qty = Number(e.target.value)
                    if (!e.target.value) setQty(o.rowId, null, o.bundle)
                    else if (Number.isInteger(qty) && qty >= 1) setQty(o.rowId, { qty }, o.bundle)
                  }}
                  disabled={disabled}
                  className="w-16 border border-slate-200 rounded px-1.5 py-0.5 text-xs text-slate-700 disabled:opacity-50"
                />
                <select
                  value={shown?.unit ?? OWN_SALES_UNITS[0]}
                  onChange={(e) => setQty(o.rowId, { unit: e.target.value }, o.bundle)}
                  disabled={disabled || !shown}
                  className="border border-slate-200 rounded px-1 py-0.5 text-xs text-slate-700 disabled:opacity-50"
                >
                  {[...new Set([...(o.bundle ? [o.bundle.unit] : []), ...OWN_SALES_UNITS])].map((u) => (
                    <option key={u} value={u}>
                      {u}
                    </option>
                  ))}
                </select>
                <span className="w-10 text-right">{manual ? '수정' : o.bundle ? '옵션명' : ''}</span>
              </div>
            )
          })}
        </div>
      ))}
    </section>
  )
}
