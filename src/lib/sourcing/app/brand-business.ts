/**
 * 사업장 × 브랜드 순수 함수 (AX-CT-07) — 브랜드 칩 정렬·표시 꼬리표와 '다른 사업장 브랜드' 경고.
 * 값을 대신 바꾸지 않는다: 경고만 만들고, 입력은 오너가 그대로 한다.
 */

/** 브랜드 칩에 필요한 최소 칸 (SourcingBrand 와 화면의 Brand 둘 다 맞는다). */
export interface BusinessScopedBrand {
  id: string
  name: string
  businessId?: string | null
}

export type BrandScope = 'own' | 'common' | 'other'

export type ScopedBrand<T extends BusinessScopedBrand> = T & { scope: BrandScope }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** 이미 다른 사업장 브랜드로 등록된 이름을 이 사업장에 붙이려 할 때(route 가 409 로 바꾼다). */
export class BrandBusinessConflictError extends Error {
  constructor(name: string) {
    super(`${name} 는 이미 다른 사업장 브랜드입니다`)
    this.name = 'BrandBusinessConflictError'
  }
}

export function isUuid(value: string): boolean {
  return UUID_RE.test(value)
}

/** 사업장 기준 소속: 사업장 미선택이면 사업장이 붙은 브랜드는 'other' 가 아니라 'common' 으로 본다(거를 기준이 없음). */
function scopeOf(brand: BusinessScopedBrand, businessId: string | null | undefined): BrandScope {
  const owner = brand.businessId ?? null
  if (!owner) return 'common'
  if (!businessId) return 'common'
  return owner === businessId ? 'own' : 'other'
}

const SCOPE_ORDER: Record<BrandScope, number> = { own: 0, common: 1, other: 2 }

/** 그 사업장 것 → 공용 → 다른 사업장 것 순서(각 묶음은 입력 순서 유지)로 정렬하고 scope 꼬리표를 붙인다. */
export function sortBrandsForBusiness<T extends BusinessScopedBrand>(
  brands: readonly T[],
  businessId: string | null | undefined
): ScopedBrand<T>[] {
  return brands
    .map((b, index) => ({ b: { ...b, scope: scopeOf(b, businessId) } as ScopedBrand<T>, index }))
    .sort((x, y) => SCOPE_ORDER[x.b.scope] - SCOPE_ORDER[y.b.scope] || x.index - y.index)
    .map((x) => x.b)
}

/**
 * 고른 브랜드 이름이 다른 사업장 브랜드면 경고 글, 아니면 null.
 * 공용·등록부에 없는 이름·사업장 미선택·빈 이름은 null. 같은 이름이 이 사업장 것으로도 있으면 null.
 */
export function brandBusinessWarning(
  brandName: string,
  businessId: string | null | undefined,
  brands: readonly BusinessScopedBrand[]
): string | null {
  const name = brandName.trim()
  if (!name || !businessId) return null
  const same = brands.filter((b) => b.name === name)
  if (same.length === 0) return null
  const scopes = same.map((b) => scopeOf(b, businessId))
  if (scopes.some((s) => s !== 'other')) return null
  return `${name} 는 다른 사업장 브랜드입니다`
}
