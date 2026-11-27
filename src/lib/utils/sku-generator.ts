/**
 * SKU 자동 생성 유틸
 *
 * 규칙: NX-{3자리 카테고리코드}-{3자리 순번}
 * 예: NX-BDG-001, NX-TOY-012
 */

/** 대분류 → 3자리 코드 매핑 */
const CATEGORY_CODES: Record<string, string> = {
  '출산/유아': 'BBY',
  '식품': 'FOD',
  '뷰티': 'BTY',
  '패션의류': 'CLT',
  '패션잡화': 'ACC',
  '가전디지털': 'ELC',
  '가구/인테리어': 'FUR',
  '생활/건강': 'LIF',
  '스포츠/레저': 'SPT',
  '자동차/공구': 'AUT',
  '도서/음반': 'BOK',
  '완구/취미': 'TOY',
  '반려동물': 'PET',
  '문구/오피스': 'OFC',
  '주방용품': 'KIT',
  '헬스/건강식품': 'HLT',
  '여행/티켓': 'TRV',
}

/** 대분류명에서 3자리 카테고리 코드를 반환한다 */
export function getCategoryCode(majorCategory: string): string {
  return CATEGORY_CODES[majorCategory] ?? 'ETC'
}

/**
 * 다음 SKU를 생성한다.
 * @param prefix - SKU 접두사 (예: "NX-BBY")
 * @param currentMax - 현재 동일 접두사의 최대 순번 (없으면 0)
 */
export function generateSku(prefix: string, currentMax: number): string {
  const next = currentMax + 1
  return `${prefix}-${String(next).padStart(3, '0')}`
}

/**
 * 대분류명으로 SKU 접두사를 생성한다.
 * @returns "NX-{CODE}" 형태 (예: "NX-BBY")
 */
export function getSkuPrefix(majorCategory: string): string {
  return `NX-${getCategoryCode(majorCategory)}`
}
