'use client'

/**
 * 브랜드 선택/입력 필드 — 등록된 브랜드를 칩으로 선택하거나 새 브랜드를 자유 입력한다.
 * 새 브랜드는 작명 확정 저장 시 서버가 레지스트리에 자동 등록한다(ensureBrand).
 * categoryPath가 주어지면 그 카테고리 브랜드를 우선 노출한다.
 *
 * businessId(AX-CT-07)가 주어지면 칩을 그 사업장 → 공용 → 다른 사업장(흐리게) 순으로 보이고,
 * 고른 값이 다른 사업장 브랜드면 경고 한 줄을 보인다. 값은 대신 바꾸지 않고 입력 칸은 항상 자유 입력이다.
 */

import { useCallback, useEffect, useState } from 'react'
import {
  brandBusinessWarning,
  sortBrandsForBusiness,
  type BrandScope,
} from '@/lib/sourcing/app/brand-business'

interface Brand {
  id: string
  name: string
  categoryPath: string | null
  isActive: boolean
  businessId?: string | null
}

export interface BrandPickerViewProps {
  brands: Brand[]
  value: string
  onChange: (name: string) => void
  categoryPath?: string | null
  inputClass?: string
  businessId?: string | null
  /** '+ 이 사업장에 더하기' — 지금 입력값을 이 사업장 브랜드로 등록 */
  onAddToBusiness?: (name: string) => void
  adding?: boolean
  addError?: string | null
  /** '새 브랜드는 저장 시 자동 등록' 안내 문구 — 작명 위저드(ensureBrand)에서만 맞다. 등록 드로어에서는 false. 기본 true. */
  autoRegisterHint?: boolean
}

/** 화면만 그리는 부분(훅 없음) — 입력 칸은 등록부와 무관하게 아무 글이나 onChange 로 올린다. */
export function BrandPickerView({
  brands,
  value,
  onChange,
  categoryPath,
  inputClass,
  businessId,
  onAddToBusiness,
  adding,
  addError,
  autoRegisterHint = true,
}: BrandPickerViewProps) {
  // 카테고리 매칭 브랜드 우선, 그다음 공용, 그다음 나머지 — 사업장이 있으면 사업장 묶음이 그 앞선이다.
  const byCategory = [...brands].sort((a, b) => rank(a, categoryPath) - rank(b, categoryPath))
  const sorted = sortBrandsForBusiness(byCategory, businessId)
  const warning = brandBusinessWarning(value, businessId, brands)
  const trimmed = value.trim()
  const canAdd =
    !!businessId && !!onAddToBusiness && !!trimmed && !brands.some((b) => b.name === trimmed && b.businessId === businessId)

  return (
    <div>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="예: 페어넥스 (선택 또는 새 브랜드 입력)"
        maxLength={50}
        className={inputClass}
      />
      {sorted.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-2">
          {sorted.map((b) => {
            const active = b.name === value
            const matched = !!categoryPath && b.categoryPath === categoryPath
            return (
              <button
                key={b.id}
                type="button"
                onClick={() => onChange(b.name)}
                title={chipTitle(b.scope, b.categoryPath, !!businessId)}
                data-brand-scope={b.scope}
                className={`text-xs px-2.5 py-1 rounded-full border transition ${
                  active
                    ? 'bg-brand-500 text-white border-brand-500'
                    : matched
                      ? 'bg-brand-50 text-brand-700 border-brand-300'
                      : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                } ${businessId && b.scope === 'other' ? 'opacity-50' : ''}`}
              >
                {b.name}
                {matched && <span className="ml-1 text-[9px]">◆</span>}
              </button>
            )
          })}
        </div>
      )}
      {warning && (
        <p data-brand-warning="other-business" className="text-xs text-orange-600 mt-1">
          {warning}
        </p>
      )}
      {canAdd && (
        <button
          type="button"
          disabled={adding}
          onClick={() => onAddToBusiness?.(trimmed)}
          className="text-xs text-brand-600 hover:text-brand-700 mt-1 disabled:opacity-50"
        >
          + 이 사업장에 더하기
        </button>
      )}
      {addError && <p className="text-xs text-red-600 mt-1">{addError}</p>}
      <p className="text-xs text-slate-400 mt-1">
        상품명 첫 단어로 사용됩니다{autoRegisterHint ? ' · 새 브랜드는 저장 시 자동 등록' : ''}
      </p>
    </div>
  )
}

export function BrandPicker({
  value,
  onChange,
  categoryPath,
  inputClass,
  businessId,
  autoRegisterHint = true,
}: {
  value: string
  onChange: (name: string) => void
  categoryPath?: string | null
  inputClass?: string
  /** 사업장별 칩 정렬·경고·더하기에만 쓴다. 없으면 지금과 같다. */
  businessId?: string | null
  /** 자동 등록 안내 문구 표시(기본 true). 등록 드로어는 초안 저장이 등록부를 안 건드리므로 false. */
  autoRegisterHint?: boolean
}) {
  const [brands, setBrands] = useState<Brand[]>([])
  const [adding, setAdding] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)

  const load = useCallback(() => {
    fetch('/api/sourcing/brands')
      .then((r) => (r.ok ? r.json() : { data: { brands: [] } }))
      .then((json) => setBrands((json.data?.brands ?? []).filter((b: Brand) => b.isActive)))
      .catch(() => setBrands([]))
  }, [])

  useEffect(() => {
    load()
  }, [load])

  // 입력값·사업장이 바뀌면 지난 더하기 오류 글을 지운다(검수 r2 사소 2)
  useEffect(() => {
    setAddError(null)
  }, [value, businessId])

  const addToBusiness = async (name: string) => {
    if (!businessId) return
    setAdding(true)
    setAddError(null)
    try {
      const res = await fetch('/api/sourcing/brands', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, businessId }),
      })
      const json = await res.json().catch(() => ({}))
      // 409 = 이미 다른 사업장 브랜드(서버가 보낸 경고 글을 그대로 보인다)
      if (res.status === 409) throw new Error(json.error || '이미 다른 사업장 브랜드입니다')
      if (!res.ok) throw new Error(json.error || '브랜드를 더하지 못했습니다.')
      load()
    } catch (err) {
      setAddError(err instanceof Error ? err.message : '브랜드를 더하지 못했습니다.')
    } finally {
      setAdding(false)
    }
  }

  return (
    <BrandPickerView
      brands={brands}
      value={value}
      onChange={onChange}
      categoryPath={categoryPath}
      inputClass={inputClass}
      businessId={businessId}
      onAddToBusiness={addToBusiness}
      adding={adding}
      addError={addError}
      autoRegisterHint={autoRegisterHint}
    />
  )
}

function chipTitle(scope: BrandScope, categoryPath: string | null, hasBusiness: boolean): string {
  if (categoryPath) return `카테고리: ${categoryPath}`
  if (!hasBusiness) return '공용 브랜드'
  return scope === 'own' ? '이 사업장 브랜드' : scope === 'other' ? '다른 사업장 브랜드' : '공용 브랜드'
}

/** 정렬 순위: 0=카테고리 매칭, 1=공용(카테고리 없음), 2=다른 카테고리 */
function rank(b: Brand, categoryPath?: string | null): number {
  if (categoryPath && b.categoryPath === categoryPath) return 0
  if (!b.categoryPath) return 1
  return 2
}
