/**
 * 쿠팡 실등록 준비 폼 (WS-A) — 쿠팡 상품등록 화면을 미러한 순수 타입 + 소싱 데이터 프리필 빌더.
 *
 * 이 모듈은 쿠팡·운영 테이블을 건드리지 않는다. 폼 값은 sourcing_registration_drafts.form(JSONB)에
 * 그대로 임시저장되고, 실제 쿠팡 OpenAPI 쓰기·displayCategoryCode 매핑은 WS-C에서 처리한다.
 *
 * 프리필 원천: product_names(selected_name·brand_name·search_tags), product_costs(selling_price),
 *   products(category_path·options·barcode·search_tags). 읽기는 prefill.ts가 담당(guard: 소싱 행만).
 */

import type { ListPriceRule } from './list-price'

/** 옵션 1행 — 쿠팡 옵션(색상/사이즈 등) 미러. WS-A는 자유 입력. */
export interface RegistrationOption {
  name: string // 옵션명 (예: 색상)
  value: string // 옵션값 (예: 블랙)
  salePrice: number | null
  stock: number | null
  barcode: string | null
}

/** 고시정보 — 쿠팡은 카테고리별 고시항목 세트가 다르다. WS-A는 자유 키-값(항목명→값). */
export type RegistrationNotice = Record<string, string>

/** 콘텐츠 슬롯 — WS-A는 수동 URL 입력 허용, WS-B(NEXFIT)가 채운다. */
export interface RegistrationContentSlot {
  heroImages: string[] // 대표이미지 URL — 썸네일 컷을 채택하면 [0]이 채택 컷이 된다(등록 대표이미지)
  detailImages: string[] // 상세 이미지 URL — 다음 생성의 원본 사진 입력(생성 컷은 넣지 않는다, c01)
  detailHtml: string | null // 상세페이지 HTML
  // 편집기 렌더를 구운 이미지(U1) — 생성 입력(detailImages)과 분리. 예전 드래프트에는 없으므로 읽을 때 `?? []`.
  detailPageSections?: string[] // 섹션 이미지 URL(순서)
  detailPageFull?: string[] // 상품등록용 전체 이미지 URL — 1장, 길면 이어 붙는 조각(쿠팡 IMAGE_NO_SPACE) 순서
  // 결정 카드 c01 — 서버만 쓴다(화면 저장은 저장된 값을 남긴다). 예전 드래프트에는 없다.
  generatedImages?: string[] // 마지막 PDP 잡의 섹션 컷 URL(appendDraftDetailAssets) — 원천 사진이 아니다
  sourceHeroImage?: string // 썸네일 채택 전 원본 대표 사진(setDraftHeroImage) — PDP 원천 사진 맨 앞
}

export interface RegistrationShipping {
  shippingPlaceName: string | null // 출고지
  returnPlaceName: string | null // 반품지
  outboundShippingFee: number | null // 출고 배송비
  returnDeliveryFee: number | null // 반품 배송비
}

/** 쿠팡 등록 미러 폼 전체 — sourcing_registration_drafts.form 에 그대로 저장. */
export interface RegistrationForm {
  categoryPath: string | null // 소싱 category_path (텍스트). WS-C에서 코드 매핑
  displayCategoryCode: number | null // WS-C 매핑 결과. WS-A는 null
  productName: string
  brand: string
  salePrice: number | null
  originalPrice: number | null // 정가(할인 전). 없으면 null
  searchTags: string[]
  barcode: string
  options: RegistrationOption[]
  notice: RegistrationNotice
  shipping: RegistrationShipping
  content: RegistrationContentSlot
  memo: string
  listPriceRule?: ListPriceRule // 서버만 쓴다(AX-CT-15, 화면 저장은 저장된 값을 남긴다). 예전 초안에는 없다
}

/** 프리필 원천 — prefill.ts가 소싱 product/costs/names에서 모아 전달한다. */
export interface PrefillSource {
  categoryPath: string | null
  productName: string | null // selected_name → product_name → keyword 순 폴백은 호출자가 결정
  brand: string | null
  salePrice: number | null
  originalPrice: number | null
  searchTags: string[]
  barcode: string | null
  /** products.options (JSONB) — 형태 불명이라 lenient 파싱 */
  rawOptions: unknown
}

export function emptyForm(): RegistrationForm {
  return {
    categoryPath: null,
    displayCategoryCode: null,
    productName: '',
    brand: '',
    salePrice: null,
    originalPrice: null,
    searchTags: [],
    barcode: '',
    options: [],
    notice: {},
    shipping: {
      shippingPlaceName: null,
      returnPlaceName: null,
      outboundShippingFee: null,
      returnDeliveryFee: null,
    },
    content: { heroImages: [], detailImages: [], detailHtml: null },
    memo: '',
  }
}

/** products.options(JSONB, 형태 불명)를 RegistrationOption[]로 관대하게 변환. 실패 시 빈 배열. */
function parseOptions(raw: unknown): RegistrationOption[] {
  if (!Array.isArray(raw)) return []
  const out: RegistrationOption[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const o = item as Record<string, unknown>
    const name = typeof o.name === 'string' ? o.name : typeof o.optionName === 'string' ? o.optionName : ''
    const value = typeof o.value === 'string' ? o.value : typeof o.optionValue === 'string' ? o.optionValue : ''
    if (!name && !value) continue
    const salePrice = typeof o.salePrice === 'number' ? o.salePrice : typeof o.price === 'number' ? o.price : null
    const stock = typeof o.stock === 'number' ? o.stock : typeof o.quantity === 'number' ? o.quantity : null
    const barcode = typeof o.barcode === 'string' ? o.barcode : null
    out.push({ name, value, salePrice, stock, barcode })
  }
  return out
}

/**
 * 소싱 원천으로 등록 준비 폼을 프리필한다. 값이 없는 필드는 빈 폼 기본값을 유지한다.
 * 사업자·배송지·고시정보는 소싱 단계에 원천이 없어 오너가 등록 준비에서 채운다.
 */
export function buildPrefillForm(source: PrefillSource): RegistrationForm {
  const form = emptyForm()
  form.categoryPath = source.categoryPath
  form.productName = source.productName ?? ''
  form.brand = source.brand ?? ''
  form.salePrice = source.salePrice
  form.originalPrice = source.originalPrice
  form.searchTags = source.searchTags.slice(0, 20)
  form.barcode = source.barcode ?? ''
  form.options = parseOptions(source.rawOptions)
  return form
}
