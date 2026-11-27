import type { ParsedRow, ImportError } from '@/types/import'
import { normalizeDate, normalizeNumber, normalizePercentage } from './parser'

/**
 * 상품 마스터 데이터 검증 (01.상품 시트 대응)
 */
export function validateProductRow(row: ParsedRow): ParsedRow {
  const errors: ImportError[] = [...row.errors]
  const data = { ...row.data }

  // 옵션 ID 필수
  if (!data.coupang_option_id) {
    errors.push({ row: row.rowIndex, field: 'coupang_option_id', message: '옵션 ID가 비어있습니다.' })
  }

  // 판매수수료: 10.8 → 0.108
  if (data.commission_rate != null && data.commission_rate !== '') {
    const raw = normalizeNumber(data.commission_rate, 0)
    data.commission_rate = raw > 1 ? raw / 100 : raw
  } else {
    data.commission_rate = null
  }

  // 숫자 필드 정규화 (빈값 → null: UPDATE 시 기존값 보존, 0으로 지우려면 화면에서 개별 수정)
  data.fulfillment_fee_default = normalizeNumber(data.fulfillment_fee_default, 0) || null
  data.unit_cost_default = normalizeNumber(data.unit_cost_default, 0) || null
  data.seller_discount_coupon = normalizeNumber(data.seller_discount_coupon, 0) || null
  data.condition_value = normalizeNumber(data.condition_value, 0) || null
  // 재고수량·입고소요기간은 자동계산 항목 — 임포트 대상 아님 (2026-07-05 CEO 결정)

  // 판매상태: 문자열 trim만 (한글→코드 변환은 서버에서, 허용값 외는 무시+경고)
  const rawStatus = String(data.sales_status_raw || '').trim()
  data.sales_status_raw = rawStatus || null

  return { ...row, data, errors, isValid: errors.length === 0 }
}

/**
 * 판매 거래 데이터 검증 (Statistics 파일 대응)
 */
export function validateSalesRow(row: ParsedRow): ParsedRow {
  const errors: ImportError[] = [...row.errors]
  const data = { ...row.data }

  // 날짜 정규화 (Statistics 파일은 날짜 없음 → fileDate로 채워짐)
  if (data.order_date) {
    const orderDate = normalizeDate(data.order_date)
    if (!orderDate) {
      errors.push({ row: row.rowIndex, field: 'order_date', message: '날짜 형식이 올바르지 않습니다.' })
    } else {
      data.order_date = orderDate
    }
  }

  // 숫자 정규화
  data.order_quantity = normalizeNumber(data.order_quantity, 1)
  data.total_amount = normalizeNumber(data.total_amount)
  data.selling_price = normalizeNumber(data.selling_price)
  data.cancel_quantity = normalizeNumber(data.cancel_quantity, 0)
  data.gross_amount = normalizeNumber(data.gross_amount, 0)
  data.gross_quantity = normalizeNumber(data.gross_quantity, 0)
  data.cancel_amount = normalizeNumber(data.cancel_amount, 0)
  // sheet_to_json(raw:false)가 콤마 서식 문자열("1,650")을 그대로 넘겨 Number()가 NaN→0으로
  // 유실시키던 금액 컬럼들을 정규화(audit §1-9)
  data.commission_fee = normalizeNumber(data.commission_fee, 0)
  data.commission_vat = normalizeNumber(data.commission_vat, 0)
  // 입출고비는 "빈 셀만 상품 기본값 폴백" 규칙이 있으므로 명시적 0과 빈 값을 구분한다.
  data.fulfillment_fee = data.fulfillment_fee === null || data.fulfillment_fee === undefined || data.fulfillment_fee === ''
    ? null
    : normalizeNumber(data.fulfillment_fee, 0)
  data.fulfillment_vat = data.fulfillment_vat === null || data.fulfillment_vat === undefined || data.fulfillment_vat === ''
    ? null
    : normalizeNumber(data.fulfillment_vat, 0)
  data.coupon_discount = normalizeNumber(data.coupon_discount, 0)
  data.settlement_amount = normalizeNumber(data.settlement_amount, 0)
  data.payout_amount = normalizeNumber(data.payout_amount, 0)
  data.unit_cost = normalizeNumber(data.unit_cost, 0)
  data.vat = normalizeNumber(data.vat, 0)
  data.margin = normalizeNumber(data.margin, 0)

  // 판매수수료율: "10.8"과 "10.8%"가 혼재해도 0.108로 통일 (audit §1-9)
  data.commission_rate = normalizePercentage(data.commission_rate)

  // 아이템위너 비율: "100.0%" → 1.0
  data.item_winner_rate = normalizePercentage(data.item_winner_rate)

  // 매출액·수량 모두 0인 행만 스킵 (취소 건은 음수로 허용)
  if (data.total_amount === 0 && data.order_quantity === 0 && data.gross_amount === 0) {
    return { ...row, data, errors, isValid: false, skipReason: '빈 행 (매출·수량 0)' }
  }

  return { ...row, data, errors, isValid: errors.length === 0 }
}

/**
 * 재고 건강지표 데이터 검증 (inventory_health_sku_info 대응)
 */
export function validateInventoryHealthRow(row: ParsedRow): ParsedRow {
  const errors: ImportError[] = [...row.errors]
  const data = { ...row.data }

  if (!data.sku) {
    errors.push({ row: row.rowIndex, field: 'sku', message: 'SKU가 비어있습니다.' })
  }

  data.coupang_stock = normalizeNumber(data.coupang_stock, 0)
  data.storage_fee_monthly = normalizeNumber(data.storage_fee_monthly, 0)

  // 재고예상 소진일: "25일 이내" 같은 텍스트 → 그대로 저장
  // 날짜 형식이면 정규화, 아니면 텍스트로 유지
  if (data.depletion_date) {
    const normalized = normalizeDate(data.depletion_date)
    if (normalized) {
      data.depletion_date = normalized
    }
    // "25일 이내" 등 텍스트는 그대로 유지
  }

  return { ...row, data, errors, isValid: errors.length === 0 }
}

/**
 * 광고 정산 데이터 검증 (dailySettlement 대응)
 */
export function validateAdBillingRow(row: ParsedRow): ParsedRow {
  const errors: ImportError[] = [...row.errors]
  const data = { ...row.data }

  // "전체" 합계행 필터링
  const adDateRaw = String(data.ad_date || '').trim()
  if (adDateRaw === '전체' || adDateRaw === '') {
    return { ...row, data, errors, isValid: false, skipReason: '합계/소계행' }
  }

  // 일별 소계행: 날짜·금액은 있으나 캠페인 ID가 없다. 금액이 캠페인 상세행 합계의 중복이라
  // 원장에 넣으면 이중 집계되므로 자동수집(adapt-settlement)과 동일하게 스킵한다.
  // 이 행의 날짜는 assemble의 상세행 날짜 상속에 이미 사용됐다.
  if (String(data.campaign_id ?? '').trim() === '') {
    return { ...row, data, errors, isValid: false, skipReason: '일별 소계행(캠페인 ID 없음)' }
  }

  // 날짜 정규화 ("2026년 04월 15일" → "2026-04-15")
  const adDate = normalizeDate(data.ad_date)
  if (!adDate) {
    errors.push({ row: row.rowIndex, field: 'ad_date', message: '날짜 형식이 올바르지 않습니다.' })
  } else {
    data.ad_date = adDate
  }

  const parseOptionalAdAmount = (value: unknown, field: string): number | null => {
    if (value === null || value === undefined || value === '') return null
    const parsed = normalizeNumber(value, Number.NaN)
    if (!Number.isFinite(parsed) || parsed < 0) {
      errors.push({ row: row.rowIndex, field, message: `${field} 금액이 올바르지 않습니다.` })
      return null
    }
    return parsed
  }

  const spentAmount = parseOptionalAdAmount(data.spent_amount, 'spent_amount') ?? 0
  let billableAmount = parseOptionalAdAmount(data.billable_amount, 'billable_amount')
  let vatAmount = parseOptionalAdAmount(data.vat_amount, 'vat_amount')
  const billableWithVat = parseOptionalAdAmount(data.billable_amount_with_vat, 'billable_amount_with_vat')

  if (billableAmount === null && billableWithVat !== null) {
    if (vatAmount !== null) billableAmount = Math.round((billableWithVat - vatAmount) * 100) / 100
    else {
      billableAmount = Math.round((billableWithVat / 1.1) * 100) / 100
      vatAmount = Math.round((billableWithVat - billableAmount) * 100) / 100
    }
  }
  if (vatAmount === null) {
    vatAmount = Math.round(((billableAmount ?? spentAmount) * 0.1) * 100) / 100
  }
  if (billableAmount !== null && billableAmount < 0) {
    errors.push({ row: row.rowIndex, field: 'billable_amount', message: '청구 가능 광고비가 음수입니다.' })
  }
  if (billableWithVat !== null && billableAmount !== null
    && Math.abs(billableWithVat - (billableAmount + vatAmount)) > 1) {
    errors.push({ row: row.rowIndex, field: 'billable_amount_with_vat', message: '청구 가능액·VAT·VAT 포함 총액이 일치하지 않습니다.' })
  }

  data.spent_amount = spentAmount
  data.billable_amount = billableAmount
  data.vat_amount = vatAmount
  data.billable_amount_with_vat = billableWithVat
  data.adjusted_spent_amount = normalizeNumber(data.adjusted_spent_amount, 0)
  data.impressions = normalizeNumber(data.impressions, 0)
  data.clicks = normalizeNumber(data.clicks, 0)
  data.conversions = normalizeNumber(data.conversions, 0)

  // 검증 오류를 "0원 스킵"으로 바꾸어 숨기지 않는다. 또한 소진액 0이어도
  // 청구 조정액/VAT가 있는 행은 정산 원장에 반드시 남겨야 한다.
  if (errors.length === 0 && data.spent_amount === 0
    && (data.billable_amount ?? 0) === 0 && (data.vat_amount ?? 0) === 0) {
    return { ...row, data, errors, isValid: false, skipReason: '소진금액 0원' }
  }

  return { ...row, data, errors, isValid: errors.length === 0 }
}

/** DB_구매 행을 서버 전송 전에 검증한다. 서버·DB도 동일 불변식을 다시 강제한다. */
export function validatePurchaseRow(row: ParsedRow): ParsedRow {
  const errors: ImportError[] = [...row.errors]
  const data = { ...row.data }

  const parseNumber = (
    field: string,
    options: { required?: boolean; integer?: boolean; min?: number } = {},
  ): number | null => {
    const value = data[field]
    const empty = value === null || value === undefined || value === ''
    if (empty) {
      if (options.required) errors.push({ row: row.rowIndex, field, message: `${field} 값이 비어있습니다.` })
      return null
    }
    const parsed = normalizeNumber(value, Number.NaN)
    const min = options.min ?? 0
    if (!Number.isFinite(parsed) || parsed < min || (options.integer && !Number.isInteger(parsed))) {
      errors.push({ row: row.rowIndex, field, message: `${field} 값이 올바르지 않습니다.` })
      return null
    }
    data[field] = parsed
    return parsed
  }

  parseNumber('quantity', { required: true, integer: true, min: 1 })
  parseNumber('unit_price', { required: true })
  parseNumber('exchange_rate', { required: true, min: Number.MIN_VALUE })
  for (const field of [
    'shipping_cost_cny', 'total_cny', 'purchase_amount_krw', 'purchase_vat',
    'total_purchase_krw', 'domestic_shipping', 'domestic_shipping_vat',
    'total_domestic', 'total_cost', 'unit_cost_krw',
  ]) parseNumber(field)
  parseNumber('lead_time_weeks', { integer: true })

  for (const field of ['order_date', 'expected_arrival_date', 'arrival_date']) {
    if (data[field] === null || data[field] === undefined || data[field] === '') continue
    const normalized = normalizeDate(data[field])
    if (!normalized) errors.push({ row: row.rowIndex, field, message: `${field} 날짜 형식이 올바르지 않습니다.` })
    else data[field] = normalized
  }
  if (data.arrival_date && !String(data.barcode || '').trim()) {
    errors.push({ row: row.rowIndex, field: 'barcode', message: '실입고 건에는 상품 연결용 바코드가 필요합니다.' })
  }

  return { ...row, data, errors, isValid: errors.length === 0 }
}
