export interface FulfillmentFallbackInput {
  sheetFee: unknown
  sheetVat?: unknown
  defaultPerUnit: unknown
  quantity: unknown
  orderDate: string
  benefitUntil?: string | null
}

export interface FulfillmentFallbackResult {
  fee: number
  vat: number
  usedFallback: boolean
  missingDefault: boolean
  inBenefitPeriod: boolean
}

function hasSheetValue(value: unknown): boolean {
  return value !== null && value !== undefined && String(value).trim() !== ''
}

function toNumber(value: unknown): number {
  if (!hasSheetValue(value)) return 0
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  const parsed = Number(String(value).replace(/[,\s원₩]/g, ''))
  return Number.isFinite(parsed) ? parsed : 0
}

/**
 * 판매 임포트 입출고비 결정 규칙.
 * - 시트 값(명시적 0 포함)이 있으면 그대로 사용한다.
 * - 빈 셀만 상품 기본요금 × 양수 수량으로 보완한다.
 * - 혜택 종료일 전 주문과 반품행은 입출고비를 재부과하지 않는다.
 */
export function resolveFulfillmentFallback(
  input: FulfillmentFallbackInput
): FulfillmentFallbackResult {
  const hasSheetFee = hasSheetValue(input.sheetFee)
  const hasSheetVat = hasSheetValue(input.sheetVat)
  const quantity = toNumber(input.quantity)
  const defaultPerUnit = toNumber(input.defaultPerUnit)
  const inBenefitPeriod = Boolean(
    input.benefitUntil && input.orderDate < input.benefitUntil
  )

  if (hasSheetFee) {
    const fee = toNumber(input.sheetFee)
    return {
      fee,
      vat: hasSheetVat ? toNumber(input.sheetVat) : Math.round(fee * 0.1),
      usedFallback: false,
      missingDefault: false,
      inBenefitPeriod,
    }
  }

  const canApplyDefault = quantity > 0 && !inBenefitPeriod && defaultPerUnit > 0
  const fee = canApplyDefault ? defaultPerUnit * quantity : 0

  return {
    fee,
    vat: fee > 0 ? Math.round(fee * 0.1) : 0,
    usedFallback: fee > 0,
    missingDefault: quantity > 0 && !inBenefitPeriod && defaultPerUnit <= 0,
    inBenefitPeriod,
  }
}
