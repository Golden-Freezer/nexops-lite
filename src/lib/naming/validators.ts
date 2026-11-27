/**
 * 상품명 SEO 검증 유틸
 *
 * 쿠팡 SEO 권장 기준:
 * - 초록(적정): 20~45자
 * - 노랑(주의): 15~20자 또는 45~55자
 * - 빨강(위험): 15자 미만 또는 55자 초과
 */

export type NameLengthStatus = 'good' | 'warning' | 'danger'

export interface NameValidation {
  length: number
  status: NameLengthStatus
  maxRecommended: number
}

/** 상품명 길이 검증 */
export function validateNameLength(name: string): NameValidation {
  const length = name.length
  const maxRecommended = 45

  let status: NameLengthStatus
  if (length >= 20 && length <= 45) {
    status = 'good'
  } else if ((length >= 15 && length < 20) || (length > 45 && length <= 55)) {
    status = 'warning'
  } else {
    status = 'danger'
  }

  return { length, status, maxRecommended }
}

/** 상태별 CSS 색상 클래스 반환 */
export function getStatusColor(status: NameLengthStatus): string {
  switch (status) {
    case 'good':
      return 'text-green-600'
    case 'warning':
      return 'text-yellow-600'
    case 'danger':
      return 'text-red-600'
  }
}
