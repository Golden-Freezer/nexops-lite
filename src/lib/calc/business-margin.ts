/**
 * 사업장별 마진 — 같은 상품(판매가·원가)이라도 사업장마다 달라지는 값(기본 수수료율·입출고배송비 기본값·
 * 입출고비 면제)을 사업장 설정(business_settings)에서 채워 calculateMargin에 넘긴다. 공식은 calculateMargin
 * 하나다(이 파일은 입력 결정만 한다). 원가·마진 화면이 사업장별 마진을 나란히 보일 때 가져다 쓴다.
 *
 * 입력 결정 규칙
 * - 수수료율: 호출자가 준 값(카테고리 수수료 등, 0 초과) → 사업장 기본 수수료율
 * - 입출고배송비: 기준일(KST)이 사업장 면제 종료일 전이면 0(면제) → 호출자가 준 값(상품별, 0 이상)
 *   → 사업장 기본값 → 없으면 0으로 계산하고 출처 'missing'(화면이 "입출고비 미설정"을 알린다)
 *   면제 비교는 임포트 입출고비 규칙(resolveFulfillmentFallback: orderDate < benefitUntil)과 같다.
 */

import { calculateMargin } from './margin'
import type { MarginResult } from '@/types/calc'
import type { BusinessSettings } from '@/types/settings'

export type BusinessMarginSettings = Pick<
  BusinessSettings,
  'businessId' | 'defaultCommissionRate' | 'defaultReturnRate' | 'defaultFulfillmentFee' | 'fulfillmentFeeWaivedUntil'
>

export interface BusinessMarginInput {
  sellingPrice: number
  unitCost: number
  couponDiscount?: number
  /** 카테고리·상품 수수료율. 없거나 0 이하면 사업장 기본 수수료율 */
  commissionRate?: number | null
  /** 상품별 입출고배송비(원/개, VAT 별도). null·undefined면 사업장 기본값 */
  fulfillmentFee?: number | null
}

export type CommissionSource = 'input' | 'business_default'
export type FulfillmentSource = 'input' | 'business_default' | 'waived' | 'missing'

export interface BusinessMarginApplied {
  commissionRate: number
  commissionSource: CommissionSource
  fulfillmentFee: number
  fulfillmentSource: FulfillmentSource
  /** 반품 포함 총합(simulateTotal)에 넘길 사업장 기본 반품율 */
  returnRate: number
}

export interface BusinessMarginOutput extends MarginResult {
  businessId: string
  applied: BusinessMarginApplied
}

function nonNegative(value: number | null | undefined): number | null {
  return value != null && Number.isFinite(value) && value >= 0 ? value : null
}

/** 사업장 설정으로 수수료율·입출고비를 정한다(계산 없음). asOfKstDate = 'YYYY-MM-DD'(KST) */
export function resolveBusinessMarginInputs(
  input: Pick<BusinessMarginInput, 'commissionRate' | 'fulfillmentFee'>,
  settings: BusinessMarginSettings,
  asOfKstDate: string
): BusinessMarginApplied {
  const inputRate = input.commissionRate
  const useInputRate = inputRate != null && Number.isFinite(inputRate) && inputRate > 0
  const commissionRate = useInputRate ? inputRate : settings.defaultCommissionRate

  const waived = Boolean(settings.fulfillmentFeeWaivedUntil && asOfKstDate < settings.fulfillmentFeeWaivedUntil)
  const inputFee = nonNegative(input.fulfillmentFee)
  const businessFee = nonNegative(settings.defaultFulfillmentFee)
  let fulfillmentFee = 0
  let fulfillmentSource: FulfillmentSource = 'missing'
  if (waived) {
    fulfillmentSource = 'waived'
  } else if (inputFee != null) {
    fulfillmentFee = inputFee
    fulfillmentSource = 'input'
  } else if (businessFee != null) {
    fulfillmentFee = businessFee
    fulfillmentSource = 'business_default'
  }

  return {
    commissionRate,
    commissionSource: useInputRate ? 'input' : 'business_default',
    fulfillmentFee,
    fulfillmentSource,
    returnRate: settings.defaultReturnRate,
  }
}

/** 한 사업장 기준 단품 마진 */
export function calculateBusinessMargin(
  input: BusinessMarginInput,
  settings: BusinessMarginSettings,
  asOfKstDate: string
): BusinessMarginOutput {
  const applied = resolveBusinessMarginInputs(input, settings, asOfKstDate)
  const result = calculateMargin({
    sellingPrice: Math.max(0, input.sellingPrice),
    unitCost: Math.max(0, input.unitCost),
    fulfillmentFee: applied.fulfillmentFee,
    commissionRate: applied.commissionRate,
    couponDiscount: Math.max(0, input.couponDiscount ?? 0),
  })
  return { ...result, businessId: settings.businessId, applied }
}

/** 같은 상품을 여러 사업장 기준으로 — 사업장 순서는 settingsList 순서를 따른다 */
export function calculateMarginsByBusiness(
  input: BusinessMarginInput,
  settingsList: readonly BusinessMarginSettings[],
  asOfKstDate: string
): BusinessMarginOutput[] {
  return settingsList.map((settings) => calculateBusinessMargin(input, settings, asOfKstDate))
}
