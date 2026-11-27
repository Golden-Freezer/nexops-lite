import { createHash } from 'node:crypto'
import { kstTodayStr } from '@/lib/analytics/date-buckets'
import { syncStockToCoupangSnapshot } from '@/lib/inventory/state-sync'
import { resolveFulfillmentFallback } from '@/lib/import/fulfillment-fallback'
import { normalizeDate, normalizeNumber } from '@/lib/import/parser'
import { importPurchasesAtomically, type AtomicPurchaseImportRow } from '@/lib/import/purchase-atomic'
import { revertApiSalesForDate } from '@/lib/import/revert-api-sales'
import { replaceAdCampaignsAtomically } from '@/lib/import/replace-ad-campaigns'
import { syncDailySettlements } from '@/lib/settlement/auto-sync'
import type { ImportType } from '@/types/import'

// 판매상태 한글 라벨 → sales_status 코드 (products-io 스킬 §4)
export const SALES_STATUS_CODE: Record<string, string> = {
  '판매중': 'active',
  '중지': 'paused',
  '품절': 'soldout',
  '준비중': 'preparing',
  '종료': 'discontinued',
}
const VALID_SALES_STATUS = new Set(Object.values(SALES_STATUS_CODE))

/** 한글 라벨/영문 코드 → sales_status 코드. 허용값 외는 null (필드 무시 + 경고 집계) */
export function toSalesStatusCode(raw: string): string | null {
  return SALES_STATUS_CODE[raw] || (VALID_SALES_STATUS.has(raw) ? raw : null)
}

export interface RunImportParams {
  userId: string
  businessId: string | null
  importType: ImportType
  fileName: string
  rows: Record<string, unknown>[]
  totalRows: number
  fileDate?: string | null
  /** 자동 Import receipt가 실행 전에 예약한 배치 UUID. 수동 Import는 생략한다. */
  batchId?: string
}

export interface RunImportResult {
  batchId: string
  totalRows: number
  successCount: number
  errorCount: number
  skippedCount: number
  skippedReasons: Record<string, number>
  mergedCount?: number
  errors: { row: number; message: string }[]
  fallbackApplied?: { unitCost: number; fulfillmentFee: number; fulfillmentFeeMissingDefault: number }
  unmatchedOptions?: number
  insertedCount?: number
  updatedCount?: number
  invalidStatusCount?: number
}

function hasImportValue(value: unknown): boolean {
  return value !== null && value !== undefined && String(value).trim() !== ''
}

function parsePurchaseNumber(
  value: unknown,
  label: string,
  options: { required?: boolean; defaultValue?: number; integer?: boolean; min?: number } = {},
): number {
  const { required = false, defaultValue = 0, integer = false, min = 0 } = options
  if (!hasImportValue(value)) {
    if (required) throw new Error(`${label}이(가) 비어 있습니다.`)
    return defaultValue
  }
  const parsed = normalizeNumber(value, Number.NaN)
  if (!Number.isFinite(parsed) || parsed < min || (integer && !Number.isInteger(parsed))) {
    throw new Error(`${label}이(가) 올바른 ${integer ? '정수' : '숫자'}가 아닙니다.`)
  }
  return parsed
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(',')}}`
}

function purchaseImportIdempotencyKey(rows: AtomicPurchaseImportRow[]): string {
  return createHash('sha256').update(stableJson(rows)).digest('hex')
}

function assertPurchaseDerivedAmount(
  rawValue: unknown,
  label: string,
  expected: number,
  absoluteTolerance = 1,
  unit = '원',
): void {
  if (!hasImportValue(rawValue)) return
  const actual = parsePurchaseNumber(rawValue, label)
  const tolerance = absoluteTolerance
  if (Math.abs(actual - expected) > tolerance) {
    throw new Error(`${label} ${actual.toLocaleString('ko-KR')}${unit}이 계산값 ${expected.toLocaleString('ko-KR')}${unit}과 일치하지 않습니다.`)
  }
}

type AtomicBatchOutcome =
  | { state: 'completed'; successCount: number }
  | { state: 'not_completed' }
  | { state: 'unknown'; reason: string }

// RPC 응답이 유실된 경우 완료 배치를 failed로 덮어쓰지 않기 위한 읽기 전용 확인이다.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function readAtomicBatchOutcome(
  supabase: any,
  scope: { batchId: string; userId: string; businessId: string; importType: 'ad_billing' | 'purchase'; expectedCount: number },
): Promise<AtomicBatchOutcome> {
  try {
    const { data, error } = await supabase
      .from('coupang_imports')
      .select('status, success_count')
      .eq('id', scope.batchId)
      .eq('user_id', scope.userId)
      .eq('business_id', scope.businessId)
      .eq('import_type', scope.importType)
      .maybeSingle()

    if (error) return { state: 'unknown', reason: error.message || '배치 조회 실패' }
    if (!data) return { state: 'unknown', reason: '배치를 찾을 수 없습니다.' }
    if (data.status === 'completed') {
      const count = Number(data.success_count)
      if (Number.isInteger(count) && count === scope.expectedCount) {
        return { state: 'completed', successCount: count }
      }
      return { state: 'unknown', reason: '완료 배치의 저장 건수가 예상과 다릅니다.' }
    }
    return { state: 'not_completed' }
  } catch (error) {
    return { state: 'unknown', reason: error instanceof Error ? error.message : '배치 조회 실패' }
  }
}

/**
 * 임포트 배치 처리 코어 — 세션 라우트(/api/import)와 자동 라우트(/api/import/auto)가 공유한다.
 * business_id는 호출자가 결정한다: 세션 라우트는 getBusinessId(현재 사업장), 자동 라우트는
 * vendorId→businesses 매핑. 코어는 넘겨받은 businessId로만 격리하며 세션을 읽지 않는다.
 *
 * ⚠️ 이 함수의 로직은 기존 /api/import POST 본문(2026-07-15 이전)을 그대로 옮긴 것이다 —
 * 사업장 격리(business_id 한정), 재고 차감 복원/재차감, 쿠팡 재고 SSOT 동기화 불변식을 유지한다.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function runImport(supabase: any, params: RunImportParams): Promise<RunImportResult> {
  const {
    userId,
    businessId,
    importType,
    fileName,
    rows,
    totalRows,
    fileDate,
    batchId: requestedBatchId,
  } = params

  // 1. 임포트 배치 레코드 생성
  const { data: batch, error: batchError } = await supabase
    .from('coupang_imports')
    .insert({
      ...(requestedBatchId ? { id: requestedBatchId } : {}),
      user_id: userId,
      business_id: businessId,
      import_type: importType,
      file_name: fileName,
      row_count: totalRows,
      status: 'processing',
    })
    .select('id')
    .single()

  if (batchError || !batch) {
    throw new Error(`배치 생성 실패: ${batchError?.message}`)
  }

  const batchId = String(batch.id)
  if (requestedBatchId && batchId !== requestedBatchId) {
    throw new Error('예약한 Import 배치 ID와 생성된 배치 ID가 일치하지 않습니다.')
  }
  let successCount = 0
  let skippedCount = 0
  const skippedReasons: Record<string, number> = {}
  let mergedCount = 0
  const errors: { row: number; message: string }[] = []

  // Fallback 통계 (sales import 전용)
  const fallbackApplied = { unitCost: 0, fulfillmentFee: 0, fulfillmentFeeMissingDefault: 0 }
  let unmatchedOptions = 0

  // product import 전용 통계
  let insertedCount = 0
  let updatedCount = 0
  let invalidStatusCount = 0
  let atomicBatchCompleted = false
  let atomicOutcomeUnknownError: string | null = null
  let atomicExpectedCount = 0

  // 2. 타입별 중복 제거 + 데이터 삽입
  if (importType === 'sales') {
    // 2-1. option_id → products 배치 매칭
    const optionIds = [...new Set(
      rows.map((r) => r.option_id as string).filter(Boolean)
    )]

    const productMap = new Map<string, {
      id: string
      unit_cost_default: number | null
      fulfillment_fee_default: number | null
      fulfillment_fee_benefit_until: string | null
      commission_rate: number | null
      seller_discount_coupon: number | null
    }>()

    if (optionIds.length > 0) {
      // ★ 반드시 현재 사업장(business_id)으로 한정 — 미한정 시 동일 옵션ID를 가진 타 사업장
      //   상품에 판매 행이 잘못 연결되어 원가·쿠폰·재고 차감이 엉뚱한 상품에 적용됨 (audit §1-4)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let productQuery = (supabase as any)
        .from('products')
        .select('id, coupang_option_id, unit_cost_default, fulfillment_fee_default, fulfillment_fee_benefit_until, commission_rate, seller_discount_coupon')
        .eq('user_id', userId)
        .in('coupang_option_id', optionIds)
      productQuery = businessId ? productQuery.eq('business_id', businessId) : productQuery.is('business_id', null)
      const { data: products } = await productQuery

      if (products) {
        for (const p of products) {
          if (p.coupang_option_id) {
            productMap.set(p.coupang_option_id, p)
          }
        }
      }
    }

    // 라이트판: 판매 통계의 노출상품ID로 비어 있는 상품 노출ID를 채운다
    // (광고 보고서 → 주력상품 연결이 노출ID로 상품을 묶기 때문)
    const exposureByOption = new Map<string, string>()
    for (const r of rows) {
      const optionId = String(r.option_id || '').trim()
      const exposureId = String(r.coupang_product_id || '').trim()
      if (optionId && exposureId && exposureId !== 'TOTAL') exposureByOption.set(optionId, exposureId)
    }
    for (const [optionId, exposureId] of exposureByOption) {
      const matched = productMap.get(optionId)
      if (!matched) continue
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase as any)
        .from('products')
        .update({ coupang_exposure_id: exposureId })
        .eq('id', matched.id)
        .is('coupang_exposure_id', null)
    }

    // 이동평균 원가 조회 (SSOT — inventory_state.avg_cost_krw)
    const avgCostMap = new Map<string, number>()
    const productIdsMatched = [...new Set([...productMap.values()].map((p) => p.id))]
    if (productIdsMatched.length > 0) {
      const { data: stateRows } = await supabase
        .from('inventory_state')
        .select('product_id, avg_cost_krw')
        .in('product_id', productIdsMatched)
      if (stateRows) {
        for (const row of stateRows) {
          const cost = Number(row.avg_cost_krw)
          if (cost > 0) avgCostMap.set(row.product_id, cost)
        }
      }
    }

    // 쿠폰 이력 조회 (product_price_history → 해당 날짜 기준 최신값)
    const couponMap = new Map<string, number>()
    if (productIdsMatched.length > 0) {
      const orderDate = (rows[0]?.order_date as string) || fileDate || kstTodayStr()
      const { data: couponRows } = await supabase
        .from('product_price_history')
        .select('product_id, value, effective_date')
        .in('product_id', productIdsMatched)
        .eq('field_name', 'seller_discount_coupon')
        .lte('effective_date', orderDate)
        .order('effective_date', { ascending: false })
      if (couponRows) {
        for (const row of couponRows) {
          // 각 product_id별 가장 최근(=첫 번째) 값만 사용
          if (!couponMap.has(row.product_id)) {
            couponMap.set(row.product_id, Number(row.value) || 0)
          }
        }
      }
    }

    // 매칭 안 된 option_id 수 집계
    const matchedOptionIds = new Set(productMap.keys())
    unmatchedOptions = optionIds.filter((id) => !matchedOptionIds.has(id)).length

    // 2-2. 합계행 제외 (option_id 없는 행 = Statistics 일별 합계)
    const detailRows = rows.filter((r) => {
      const optId = String(r.option_id || '').trim()
      if (!optId) {
        skippedCount++
        skippedReasons['합계행 (옵션ID 없음)'] = (skippedReasons['합계행 (옵션ID 없음)'] || 0) + 1
        return false
      }
      return true
    })

    // 2-3. row 매핑 + fallback 적용
    const insertRows = detailRows.map((r) => {
      const product = productMap.get(r.option_id as string) || null

      const rawUnitCost = Number(r.unit_cost) || 0
      const totalAmount = Number(r.total_amount) || 0
      const orderQuantity = Number(r.order_quantity) || 0

      // Fallback 체인: Excel값 → 이동평균(SSOT) → products 기본값
      const avgCost = product ? (avgCostMap.get(product.id) ?? null) : null
      const unitCost = rawUnitCost || (avgCost ?? product?.unit_cost_default ?? 0)
      const orderDate = (r.order_date as string) || fileDate || kstTodayStr()
      const fulfillment = resolveFulfillmentFallback({
        sheetFee: r.fulfillment_fee,
        sheetVat: r.fulfillment_vat,
        defaultPerUnit: product?.fulfillment_fee_default,
        quantity: orderQuantity,
        orderDate,
        benefitUntil: product?.fulfillment_fee_benefit_until,
      })
      const fulfillmentFee = fulfillment.fee

      const unitCostFallbacked = rawUnitCost === 0 && unitCost > 0

      if (unitCostFallbacked) fallbackApplied.unitCost++
      if (fulfillment.usedFallback) fallbackApplied.fulfillmentFee++
      if (fulfillment.missingDefault) fallbackApplied.fulfillmentFeeMissingDefault++
      // 쿠폰: Excel값 → 이력 테이블 → products 기본값 (수수료·부가세 과세 기준이라 먼저 확정)
      const rawCoupon = Number(r.coupon_discount) || 0
      const historyCoupon = product ? (couponMap.get(product.id) ?? null) : null
      const perUnitCoupon = rawCoupon > 0 ? 0 : (historyCoupon ?? product?.seller_discount_coupon ?? 0)
      const couponDiscount = rawCoupon || (perUnitCoupon > 0 ? perUnitCoupon * Math.abs(orderQuantity) : 0)

      // 수수료·부가세 과세 기준 = 쿠폰 차감 후 최종 판매액 (2026-08-19 RG 정산 실측:
      // takeRate = (순매출-즉시할인쿠폰)×요율×1.1 — 쿠폰 미차감 기준은 과대 계상)
      const netAmount = Math.max(0, totalAmount - couponDiscount)
      const commissionRate = Number(r.commission_rate) || (product?.commission_rate ? Number(product.commission_rate) : 0)

      // 수수료: Excel값 → 쿠폰 차감 후 매출 기반 계산
      const commissionFee = Number(r.commission_fee) || (commissionRate > 0 ? Math.round(netAmount * commissionRate) : 0)
      const commissionVat = Number(r.commission_vat) || Math.round(commissionFee * 0.1)
      const fulfillmentVat = fulfillment.vat

      // 부가세: Excel값 → 쿠폰 차감 후 매출 기준 자동 계산
      const vat = Number(r.vat) || (netAmount > 0 ? Math.floor(netAmount / 11) : 0)

      // 마진: 매출 - 원가 - 수수료 - 수수료VAT - 입출고 - 입출고VAT - 쿠폰 - 부가세 (CLAUDE.md 정의)
      const margin = totalAmount - (unitCost * orderQuantity) - commissionFee - commissionVat - fulfillmentFee - fulfillmentVat - couponDiscount - vat

      return {
        user_id: userId,
        business_id: businessId,
        product_id: product?.id || null,
        order_date: orderDate,
        option_id: r.option_id as string || null,
        option_name: r.option_name as string || null,
        product_type: r.product_type as string || null,
        category: r.category as string || null,
        order_quantity: orderQuantity,
        selling_price: Number(r.selling_price) || (orderQuantity > 0 ? Math.round(totalAmount / orderQuantity) : 0),
        total_amount: totalAmount,
        gross_amount: Number(r.gross_amount) || 0,
        gross_quantity: Number(r.gross_quantity) || 0,
        cancel_amount: Number(r.cancel_amount) || 0,
        cancel_quantity: Number(r.cancel_quantity) || 0,
        coupon_discount: couponDiscount,
        commission_rate: Number(r.commission_rate) || 0,
        commission_fee: commissionFee,
        commission_vat: commissionVat,
        settlement_amount: Number(r.settlement_amount) || 0,
        fulfillment_fee: fulfillmentFee,
        fulfillment_vat: fulfillmentVat,
        payout_amount: Number(r.payout_amount) || 0,
        unit_cost: unitCost,
        vat: vat,
        margin: margin,
        item_winner_rate: Number(r.item_winner_rate) || 0,
        status: Number(r.cancel_amount) > 0 && Number(r.total_amount) === 0 ? 'cancelled' : 'confirmed',
        source: 'coupang_import',
        import_batch_id: batchId,
      }
    })

    // 오픈API 판매행은 취소 미반영 총매출이고 Excel 판매장부가 확정 자료이므로,
    // Excel 삽입 성공 후 API-SALE-* movement 재고 원복과 API 행 삭제를 자동 수행한다.
    const guardDate = (insertRows[0]?.order_date as string | undefined) || fileDate
    let apiRowCount = 0
    if (guardDate) {
      let apiRowsQuery = supabase
        .from('sales_transactions')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('order_date', guardDate)
        .eq('source', 'coupang_api')
      apiRowsQuery = businessId
        ? apiRowsQuery.eq('business_id', businessId)
        : apiRowsQuery.is('business_id', null)
      const { count: existingApiCount } = await apiRowsQuery
      apiRowCount = existingApiCount ?? 0
    }

    // 삽입을 먼저 시도(신규 batch로 격리)하고, 성공했을 때만 구 데이터를 삭제 + 재고를 차감한다.
    // 선삭제 후 삽입 실패 시 데이터가 복구 불가로 소실되고, 삽입 실패에도 재고 차감이 무조건
    // 진행되던 문제를 방지한다 (audit §1-6).
    let insertError: { message: string } | null = null
    let count: number | null = null
    const insertRes = await supabase
      .from('sales_transactions')
      .insert(insertRows)
      .select('id', { count: 'exact', head: true })
    insertError = insertRes.error
    count = insertRes.count

    if (insertError) {
      errors.push({ row: 0, message: `판매 데이터 삽입 실패: ${insertError.message}` })
    } else {
      successCount = count || insertRows.length
      const orderDate = insertRows[0]?.order_date || fileDate || kstTodayStr()

      if (apiRowCount > 0) {
        try {
          const swap = await revertApiSalesForDate(supabase, { userId, businessId, orderDate })
          console.log(`[import] sales ${orderDate} (biz:${businessId ?? 'null'}): API 판매 ${swap.deletedSales}건 스왑(재고 +${swap.restoredStock} 원복, movement ${swap.deletedMovements} 삭제)`)
        } catch (swapError) {
          const message = swapError instanceof Error ? swapError.message : String(swapError)
          errors.push({ row: 0, message: `API 스왑 실패 — 수동 정리 필요: ${message}` })
        }
      }

      // 같은 날짜의 기존 coupang_import 데이터 DELETE (이번 배치는 제외, seed 데이터는 유지)
      // ★ 반드시 현재 사업장(business_id)으로 한정 — 미한정 시 같은 날짜의 다른 사업장 데이터까지 삭제됨
      let delQuery = supabase
        .from('sales_transactions')
        .delete({ count: 'exact' })
        .eq('user_id', userId)
        .eq('order_date', orderDate)
        .eq('source', 'coupang_import')
        .neq('import_batch_id', batchId)
      delQuery = businessId ? delQuery.eq('business_id', businessId) : delQuery.is('business_id', null)
      const { count: deletedCount, error: deleteError } = await delQuery
      if (deleteError) {
        errors.push({ row: 0, message: `기존 판매 데이터 삭제 실패: ${deleteError.message}` })
      } else if (deletedCount && deletedCount > 0) {
        console.log(`[import] sales ${orderDate} (biz:${businessId ?? 'null'}): 기존 ${deletedCount}건 삭제(신규 배치 보존)`)
      }

      // Step 6: 판매 → 재고 차감 + inventory_movements (삽입 성공 시에만 — audit §1-6)
      // 재Import 안전: 기존 차감분 복원 후 재차감
      const salesDate = orderDate
      // ★ reference_no에 사업장 식별자 포함 — 미포함 시 같은 날짜를 다른 사업장이 임포트하면
      //   서로의 outbound movements를 복원·삭제해 재고가 영구적으로 부풀려짐 (audit §1-3)
      const salesRef = `SALES-${businessId ?? 'none'}-${salesDate}`

      // 6-1. 기존 outbound movements 조회 → 복원 (이번 임포트 대상 상품으로 한정)
      const { data: existingMovements } = productIdsMatched.length > 0
        ? await supabase
          .from('inventory_movements')
          .select('id, product_id, quantity, unit_cost')
          .eq('reference_no', salesRef)
          .eq('movement_type', 'outbound')
          .in('product_id', productIdsMatched)
        : { data: [] as { id: string; product_id: string; quantity: number; unit_cost: number }[] }

      if (existingMovements && existingMovements.length > 0) {
        // 기존 차감분 상품별 집계
        const restoreMap = new Map<string, { qty: number; value: number }>()
        for (const m of existingMovements) {
          const prev = restoreMap.get(m.product_id) || { qty: 0, value: 0 }
          const absQty = Math.abs(Number(m.quantity))
          restoreMap.set(m.product_id, {
            qty: prev.qty + absQty,
            value: prev.value + absQty * (Number(m.unit_cost) || 0),
          })
        }

        // inventory_state + current_stock 복원
        for (const [pid, { qty: restoreQty, value: restoreValue }] of restoreMap) {
          const { data: curState } = await supabase
            .from('inventory_state').select('qty, total_value').eq('product_id', pid).single()
          if (curState) {
            await supabase.from('inventory_state').update({
              qty: Number(curState.qty) + restoreQty,
              total_value: Math.round((Number(curState.total_value) + restoreValue) * 100) / 100,
              updated_at: new Date().toISOString(),
            }).eq('product_id', pid)
          }
          const { data: curInv } = await supabase
            .from('inventory').select('current_stock').eq('product_id', pid).single()
          if (curInv) {
            await supabase.from('inventory').update({
              current_stock: (Number(curInv.current_stock) || 0) + restoreQty,
              updated_at: new Date().toISOString(),
            }).eq('product_id', pid)
          }
        }

        // 기존 movements 삭제
        const existingIds = existingMovements.map((m: { id: string }) => m.id)
        await supabase.from('inventory_movements').delete().in('id', existingIds)
        console.log(`[import] sales ${salesDate}: 기존 재고 차감 ${existingMovements.length}건 복원 후 재차감`)
      }

      // 6-2. 새 판매 데이터로 재고 차감
      const salesByProduct = new Map<string, { qty: number; avgCost: number }>()
      for (const row of insertRows) {
        if (row.product_id && row.order_quantity !== 0 && row.unit_cost > 0) {
          const prev = salesByProduct.get(row.product_id) || { qty: 0, avgCost: row.unit_cost }
          salesByProduct.set(row.product_id, {
            qty: prev.qty + row.order_quantity,
            avgCost: row.unit_cost,
          })
        }
      }

      for (const [productId, { qty, avgCost }] of salesByProduct) {
        try {
          const cogs = Math.round(avgCost * qty * 100) / 100

          const { data: currentState } = await supabase
            .from('inventory_state')
            .select('qty, total_value, avg_cost_krw')
            .eq('product_id', productId)
            .single()

          if (currentState) {
            await supabase.from('inventory_state').update({
              qty: Math.max(0, Number(currentState.qty) - qty),
              total_value: Math.max(0, Math.round((Number(currentState.total_value) - cogs) * 100) / 100),
              updated_at: new Date().toISOString(),
            }).eq('product_id', productId)
          }

          const { data: inv } = await supabase
            .from('inventory')
            .select('id, current_stock')
            .eq('product_id', productId)
            .single()

          if (inv) {
            await supabase.from('inventory').update({
              current_stock: Math.max(0, (Number(inv.current_stock) || 0) - qty),
              updated_at: new Date().toISOString(),
            }).eq('product_id', productId)

            await supabase.from('inventory_movements').insert({
              inventory_id: inv.id,
              product_id: productId,
              movement_type: 'outbound',
              quantity: -qty,
              unit_cost: avgCost,
              reference_no: salesRef,
              notes: `판매 출고 (${salesDate}, ${qty}개)`,
              movement_date: salesDate,
            })
          }
        } catch (invErr) {
          console.error(`[import] 재고 차감 실패 (product: ${productId}):`, invErr)
        }
      }

      if (!deleteError) {
        try {
          await syncDailySettlements(supabase, {
            userId,
            businessId,
            orderDate,
            importBatchId: batchId,
          })
        } catch (settlementError) {
          const message = settlementError instanceof Error
            ? settlementError.message
            : '알 수 없는 자동 정산 오류'
          errors.push({ row: 0, message })
        }
      }
    }
  } else if (importType === 'inventory_health') {
    // 재고 건강지표 → 옵션ID 우선 매칭 → SKU 폴백 → 미매칭 시 상품 자동 등록
    let skuBackfillCount = 0
    let newProductCount = 0
    let stockSyncCount = 0
    let stockAdjustCount = 0

    for (const row of rows) {
      const sku = String(row.sku || '').trim()
      const optionId = String(row.option_id || '').trim()
      const productName = String(row.product_name || '').trim()
      const optionName = String(row.option_name || '').trim()
      const coupangProductId = String(row.coupang_product_id || '').trim()
      const healthGrade = String(row.health_grade || '').trim()

      if (!sku && !optionId) {
        skippedCount++
        skippedReasons['SKU/옵션ID 없음'] = (skippedReasons['SKU/옵션ID 없음'] || 0) + 1
        continue
      }

      // ① 옵션ID로 매칭 (primary)
      let productId: string | null = null
      let needSkuBackfill = false
      let ambiguousMatch = false

      if (optionId) {
        let q = supabase.from('products').select('id, sku').eq('user_id', userId).eq('coupang_option_id', optionId)
        if (businessId) q = q.eq('business_id', businessId)
        const { data: matchedList } = await q
        if (matchedList && matchedList.length === 1) {
          productId = matchedList[0].id
          // SKU 백필: products.sku가 비어있으면 채워주기
          if (!matchedList[0].sku && sku) needSkuBackfill = true
        } else if (matchedList && matchedList.length > 1) {
          // 다중 매칭 시 어느 상품인지 확정할 수 없으므로 자동 생성하지 않고 오류 행으로 집계 (audit §1-13)
          errors.push({ row: 0, message: `옵션ID 다중 매칭 (${optionId}): 상품 ${matchedList.length}건 — 자동등록 생략` })
          ambiguousMatch = true
        }
      }

      // ② SKU 폴백
      if (!ambiguousMatch && !productId && sku) {
        let q = supabase.from('products').select('id').eq('user_id', userId).eq('sku', sku)
        if (businessId) q = q.eq('business_id', businessId)
        const { data: matchedList } = await q
        if (matchedList && matchedList.length === 1) {
          productId = matchedList[0].id
        } else if (matchedList && matchedList.length > 1) {
          errors.push({ row: 0, message: `SKU 다중 매칭 (${sku}): 상품 ${matchedList.length}건 — 자동등록 생략` })
          ambiguousMatch = true
        }
      }

      if (ambiguousMatch) continue

      // ③ 둘 다 실패 → 신규 상품 자동 등록
      if (!productId) {
        const isRefurbished = healthGrade.includes('반품')
        const grade = isRefurbished ? healthGrade : 'NEW'

        const { data: newProduct, error: insertErr } = await supabase
          .from('products')
          .insert({
            user_id: userId,
            business_id: businessId,
            purpose: 'product',
            sku: sku || null,
            coupang_product_id: coupangProductId || null,
            coupang_option_id: optionId || null,
            product_name: productName || null,
            option_name: optionName || null,
            product_grade: grade,
            is_refurbished: isRefurbished,
          })
          .select('id')
          .single()

        if (insertErr || !newProduct) {
          errors.push({ row: 0, message: `상품 자동등록 실패 (${optionId || sku}): ${insertErr?.message}` })
          continue
        }
        productId = newProduct.id
        newProductCount++
      }

      // SKU 백필
      if (needSkuBackfill && productId && sku) {
        await supabase.from('products').update({ sku }).eq('id', productId)
        skuBackfillCount++
      }

      // inventory UPSERT
      // 빈 셀은 "0 재고"가 아니라 "값 없음" — 운영값 리셋(동기화)은 명시적 숫자일 때만 수행
      const rawCoupangStock = String(row.coupang_stock ?? '').trim()
      const hasExplicitStock = rawCoupangStock !== '' && Number.isFinite(Number(rawCoupangStock))
      const coupangStock = Number(row.coupang_stock) || 0
      const storageFee = Number(row.storage_fee_monthly) || 0
      // depletion_date: 날짜(YYYY-MM-DD) 또는 "N일 이내" 텍스트 → 날짜 변환
      let depletionDate: string | null = null
      const rawDepletion = String(row.depletion_date || '').trim()
      if (/^\d{4}-\d{2}-\d{2}$/.test(rawDepletion)) {
        depletionDate = rawDepletion
      } else {
        const daysMatch = rawDepletion.match(/(\d+)일/)
        if (daysMatch) {
          const d = new Date()
          d.setDate(d.getDate() + Number(daysMatch[1]))
          depletionDate = d.toISOString().split('T')[0]
        }
      }

      const { error: upsertError } = await supabase
        .from('inventory')
        .upsert({
          product_id: productId,
          coupang_stock: coupangStock,
          storage_fee_monthly: storageFee,
          depletion_date: depletionDate,
          health_grade: healthGrade || null,
          last_health_sync: new Date().toISOString(),
        }, { onConflict: 'product_id' })

      if (upsertError) {
        errors.push({ row: 0, message: `재고 업데이트 실패 (${sku || optionId}): ${upsertError.message}` })
      } else {
        successCount++

        // 자동 품절/복구: 수동 상태(paused, discontinued, preparing)는 보호
        const { data: currentProduct } = await supabase
          .from('products').select('sales_status').eq('id', productId).single()
        const curStatus = currentProduct?.sales_status || 'active'
        if (coupangStock === 0 && curStatus === 'active') {
          await supabase.from('products').update({ sales_status: 'soldout' }).eq('id', productId)
        } else if (coupangStock > 0 && curStatus === 'soldout') {
          await supabase.from('products').update({ sales_status: 'active' }).eq('id', productId)
        }

        // 스냅샷 이력 기록
        await supabase.from('inventory_health_history').insert({
          user_id: userId,
          business_id: businessId,
          product_id: productId,
          sku: sku || null,
          coupang_stock: coupangStock,
          storage_fee_monthly: storageFee,
          depletion_date: depletionDate,
          health_grade: healthGrade || null,
          import_batch_id: batchId || null,
        })

        // 쿠팡 스냅샷 동기화 — current_stock·이동평균 장부를 쿠팡 재고로 리셋,
        // 이력 합과의 차이는 adjustment로 기록 (재고 SSOT = 쿠팡, 오너 확정 2026-07-13)
        if (hasExplicitStock && productId) {
          try {
            const sync = await syncStockToCoupangSnapshot(supabase, productId, coupangStock, kstTodayStr())
            if (sync.stockChanged) stockSyncCount++
            if (sync.adjustQty !== 0) stockAdjustCount++
          } catch (syncErr) {
            const msg = syncErr instanceof Error ? syncErr.message : String(syncErr)
            errors.push({ row: 0, message: `쿠팡 재고 동기화 실패 (${sku || optionId}): ${msg}` })
          }
        }
      }
    }

    if (skuBackfillCount > 0) console.log(`[import] inventory_health: SKU 백필 ${skuBackfillCount}건`)
    if (newProductCount > 0) console.log(`[import] inventory_health: 신규 상품 등록 ${newProductCount}건`)
    if (stockSyncCount > 0 || stockAdjustCount > 0) console.log(`[import] inventory_health: 쿠팡 재고 동기화 ${stockSyncCount}건, 조정 이력 ${stockAdjustCount}건`)
  } else if (importType === 'product') {
    // 상품 마스터 import: coupang_option_id 기준 UPSERT (계획서 Phase 3, products-io 스킬 §3)
    // - UPDATE: 빈 셀은 payload에서 제외 → 기존값 보존
    // - INSERT: seq 자동 부여 (단건 등록 POST /api/products와 동일 규칙)
    // - 재고(inventory) 비침범: 재고 SSOT는 재고건강 임포트 (2026-07-05 CEO 결정)
    const optionIds = [...new Set(
      rows.map((r) => String(r.coupang_option_id || '')).filter(Boolean)
    )]

    // 기존 상품 매칭 조회 (현재 사업장으로 한정 — 같은 옵션ID가 타 사업장에 있어도 교차 업데이트 방지)
    const existingMap = new Map<string, string>()
    if (optionIds.length > 0) {
      let existingQuery = supabase
        .from('products')
        .select('id, coupang_option_id')
        .eq('user_id', userId)
        .in('coupang_option_id', optionIds)
      existingQuery = businessId ? existingQuery.eq('business_id', businessId) : existingQuery.is('business_id', null)
      const { data: existing } = await existingQuery

      if (existing) {
        for (const p of existing) {
          if (p.coupang_option_id) existingMap.set(p.coupang_option_id, p.id)
        }
      }
    }

    // 신규 INSERT용 seq 시작값 (사용자 범위 max+1)
    let nextSeq = 1
    {
      const { data: maxSeqRow } = await supabase
        .from('products')
        .select('seq')
        .eq('user_id', userId)
        .not('seq', 'is', null)
        .order('seq', { ascending: false })
        .limit(1)
      if (maxSeqRow && maxSeqRow.length > 0) nextSeq = Number(maxSeqRow[0].seq) + 1
    }

    for (const row of rows) {
      const optionId = String(row.coupang_option_id || '')
      if (!optionId) {
        skippedCount++
        skippedReasons['옵션ID 없음'] = (skippedReasons['옵션ID 없음'] || 0) + 1
        continue
      }

      // 판매상태: 한글 라벨/영문 코드 → 코드. 허용값 외는 필드 무시 + 경고 집계
      let salesStatus: string | null = null
      const rawStatus = String(row.sales_status_raw || '').trim()
      if (rawStatus) {
        salesStatus = toSalesStatusCode(rawStatus)
        if (!salesStatus) invalidStatusCount++
      }

      const fields: Record<string, unknown> = {
        coupang_product_id: row.coupang_product_id as string || null,
        coupang_exposure_id: row.coupang_exposure_id as string || null,
        coupang_option_id: optionId,
        barcode: row.barcode as string || null,
        sku: row.sku as string || null,
        coupang_display_name: row.coupang_display_name as string || null,
        product_name: row.product_name as string || null,
        option_name: row.option_name as string || null,
        condition_value: row.condition_value as number || null,
        commission_rate: row.commission_rate as number || null,
        fulfillment_fee_default: row.fulfillment_fee_default as number || null,
        unit_cost_default: row.unit_cost_default as number || null,
        seller_discount_coupon: row.seller_discount_coupon as number || null,
        sales_status: salesStatus,
      }

      const existingId = existingMap.get(optionId)

      if (existingId) {
        // UPDATE 기존 상품 — 부분 업데이트: 빈 값(null/'')은 제외해 기존값 보존
        const updatePayload: Record<string, unknown> = {}
        for (const [k, v] of Object.entries(fields)) {
          if (k === 'coupang_option_id') continue // 매칭 키는 갱신 불필요
          if (v !== null && v !== '') updatePayload[k] = v
        }
        if (Object.keys(updatePayload).length === 0) {
          updatedCount++
          successCount++
          continue
        }
        const { error: updateError } = await supabase
          .from('products')
          .update(updatePayload)
          .eq('id', existingId)

        if (updateError) {
          errors.push({ row: 0, message: `상품 업데이트 실패 (옵션ID: ${optionId}): ${updateError.message}` })
        } else {
          updatedCount++
          successCount++
        }
      } else {
        // INSERT 새 상품 (seq 자동 부여)
        const { error: insertError } = await supabase
          .from('products')
          .insert({
            ...fields,
            user_id: userId,
            business_id: businessId,
            purpose: 'product',
            seq: nextSeq,
          })

        if (insertError) {
          errors.push({ row: 0, message: `상품 등록 실패 (옵션ID: ${optionId}): ${insertError.message}` })
        } else {
          nextSeq++
          insertedCount++
          successCount++
        }
      }
    }
  } else if (importType === 'ad_billing') {
    // assembleImportRows가 합계/소계행을 제거한 뒤 이 코어를 호출한다. 서버 코어에서
    // campaign_id 누락을 다시 조용히 제외하면 API 직접 호출 시 잘못된 행만 빠진 채
    // 같은 날짜 원장이 부분 교체될 수 있으므로, 한 행이라도 누락되면 전체를 차단한다.
    let adPreparationFailed = false
    const validRows = rows.filter((r) => {
      const cid = String(r.campaign_id || '').trim()
      if (cid) return true
      errors.push({ row: 0, message: '광고 캠페인 ID가 비어 있습니다.' })
      adPreparationFailed = true
      return false
    })

    const aggregated = new Map<string, {
      campaign_id: string; campaign_name: string | null; ad_type: string | null; ad_date: string
      spent_amount: number; accounting_base: number; has_billable: boolean; vat_amount: number
      impressions: number; clicks: number; conversions: number
    }>()
    let preparedAdSourceRows = 0
    for (const r of validRows) {
      const key = `${r.ad_date}__${r.campaign_id}`
      const spentAmount = Number(r.spent_amount)
      const billableAmount = hasImportValue(r.billable_amount) ? Number(r.billable_amount) : null
      const explicitVat = hasImportValue(r.vat_amount) ? Number(r.vat_amount) : null
      if (!Number.isFinite(spentAmount) || spentAmount < 0
        || (billableAmount !== null && (!Number.isFinite(billableAmount) || billableAmount < 0))
        || (explicitVat !== null && (!Number.isFinite(explicitVat) || explicitVat < 0))) {
        errors.push({ row: 0, message: `광고 금액 형식 오류 (${r.campaign_id})` })
        adPreparationFailed = true
        continue
      }
      preparedAdSourceRows += 1
      const accountingBase = billableAmount ?? spentAmount
      const vatAmount = explicitVat ?? roundMoney(accountingBase * 0.1)
      const prev = aggregated.get(key)
      if (prev) {
        prev.spent_amount += spentAmount
        prev.accounting_base += accountingBase
        prev.has_billable ||= billableAmount !== null
        prev.vat_amount += vatAmount
        prev.impressions += Number(r.impressions) || 0
        prev.clicks += Number(r.clicks) || 0
        prev.conversions += Number(r.conversions) || 0
      } else {
        aggregated.set(key, {
          campaign_id: r.campaign_id as string,
          campaign_name: r.campaign_name as string || null,
          ad_type: r.ad_type as string || null,
          ad_date: r.ad_date as string,
          spent_amount: spentAmount,
          accounting_base: accountingBase,
          has_billable: billableAmount !== null,
          vat_amount: vatAmount,
          impressions: Number(r.impressions) || 0,
          clicks: Number(r.clicks) || 0,
          conversions: Number(r.conversions) || 0,
        })
      }
    }

    const mergedRows = preparedAdSourceRows - aggregated.size
    mergedCount = mergedRows
    if (mergedRows > 0) {
      skippedReasons['배송유형 합산'] = mergedRows
      console.log(`[import] ad_billing: 소계행 ${skippedCount}건 제외, 배송유형 ${mergedRows}건 합산 → ${aggregated.size}건 삽입`)
    }

    const insertRows = Array.from(aggregated.values()).map((r) => ({
      user_id: userId,
      business_id: businessId,
      campaign_id: r.campaign_id,
      campaign_name: r.campaign_name,
      ad_type: r.ad_type,
      ad_date: r.ad_date,
      spent_amount: Math.round(r.spent_amount * 100) / 100,
      // 모든 하위 행에 billable이 없을 때만 null을 보존해 spent fallback을 사용한다.
      // 혼합 행은 행별 billable/spent 기준액을 합산해 일부 금액 유실을 막는다.
      billable_amount: r.has_billable ? roundMoney(r.accounting_base) : null,
      vat_amount: roundMoney(r.vat_amount),
      impressions: r.impressions,
      clicks: r.clicks,
      conversions: r.conversions,
      source: 'coupang_import',
      import_batch_id: batchId,
    }))
    atomicExpectedCount = insertRows.length

    if (adPreparationFailed) {
      // 날짜 교체 원장에서 잘못된 행만 빼면 기존 전체 날짜 데이터를 부분 자료로 교체하게 된다.
      // 하나라도 실패하면 RPC를 호출하지 않고 기존 광고 원장을 그대로 보존한다.
    } else if (insertRows.length === 0) {
      errors.push({ row: 0, message: '교체할 유효 광고 캠페인이 없습니다. 기존 데이터는 유지됩니다.' })
    } else try {
      // 기존 데이터를 먼저 지우지 않는다. PostgreSQL 함수가 DELETE+INSERT를 한 트랜잭션으로
      // 실행하며, 어느 단계든 실패하면 전체 롤백되어 기존 광고비 원장이 유지된다.
      successCount = await replaceAdCampaignsAtomically(supabase, userId, businessId, batchId, insertRows)
      atomicBatchCompleted = true
    } catch (error) {
      const originalMessage = error instanceof Error ? error.message : '광고 데이터 원자 교체 실패'
      if (businessId) {
        const outcome = await readAtomicBatchOutcome(supabase, {
          batchId, userId, businessId, importType: 'ad_billing', expectedCount: insertRows.length,
        })
        if (outcome.state === 'completed') {
          successCount = outcome.successCount
          atomicBatchCompleted = true
        } else if (outcome.state === 'unknown') {
          atomicOutcomeUnknownError = `광고 Import 결과를 확정할 수 없습니다: ${outcome.reason}`
        } else {
          errors.push({ row: 0, message: originalMessage })
        }
      } else {
        errors.push({ row: 0, message: originalMessage })
      }
    }
  } else if (importType === 'purchase') {
    // DB_구매 시트 → purchases 테이블
    const purchaseRows: AtomicPurchaseImportRow[] = []
    let preparationFailed = false

    for (const [rowOffset, r] of rows.entries()) {
      try {
        const productName = String(r.product_name_memo || '').trim()
        if (!productName || productName === '-') throw new Error('상품명이 비어 있습니다.')

        const quantity = parsePurchaseNumber(r.quantity, '주문수량', { required: true, integer: true, min: 1 })
        const orderDateRaw = r.order_date
        const normalizedOrderDate = normalizeDate(orderDateRaw)
        if (hasImportValue(orderDateRaw) && !normalizedOrderDate) throw new Error('주문일 형식이 올바르지 않습니다.')
        const orderDate = normalizedOrderDate || fileDate || kstTodayStr()

        // 입고예정일은 스케줄만 나타내며, 명시적인 실입고일만 arrived+재고 가산을 발생시킨다.
        const arrivalRaw = r.arrival_date
        const arrivalDate = normalizeDate(arrivalRaw)
        if (hasImportValue(arrivalRaw) && !arrivalDate) throw new Error('실입고일 형식이 올바르지 않습니다.')

        const expectedArrivalRaw = r.expected_arrival_date
        let expectedArrivalDate = normalizeDate(expectedArrivalRaw)
        if (hasImportValue(expectedArrivalRaw) && !expectedArrivalDate) throw new Error('입고예정일 형식이 올바르지 않습니다.')
        const leadTimeWeeks = hasImportValue(r.lead_time_weeks)
          ? parsePurchaseNumber(r.lead_time_weeks, '입고소요주', { integer: true })
          : null
        if (!expectedArrivalDate && leadTimeWeeks !== null) {
          const expected = new Date(`${orderDate}T00:00:00.000Z`)
          expected.setUTCDate(expected.getUTCDate() + leadTimeWeeks * 7)
          expectedArrivalDate = expected.toISOString().slice(0, 10)
        }
        if (arrivalDate && arrivalDate < orderDate) throw new Error('실입고일은 주문일보다 빠를 수 없습니다.')
        if (expectedArrivalDate && expectedArrivalDate < orderDate) throw new Error('입고예정일은 주문일보다 빠를 수 없습니다.')

        // 바코드는 반드시 현재 사업장 내에서만 매칭하고 중복 매칭을 임의 선택하지 않는다.
        const barcode = String(r.barcode || '').trim()
        let productId: string | null = null
        if (barcode && businessId) {
          const { data: matches, error: matchError } = await supabase
            .from('products')
            .select('id')
            .eq('user_id', userId)
            .eq('barcode', barcode)
            .eq('business_id', businessId)
            .limit(2)
          if (matchError) throw new Error(`상품 연결 조회 실패: ${matchError.message}`)
          const matchedRows = Array.isArray(matches) ? matches : []
          if (matchedRows.length > 1) throw new Error(`바코드 ${barcode}가 현재 사업장의 여러 상품에 중복됩니다.`)
          productId = matchedRows[0]?.id || null
        }
        if (arrivalDate && !barcode) throw new Error('실입고 건에는 상품 연결용 바코드가 필요합니다.')
        if (arrivalDate && !productId) throw new Error('실입고 건의 바코드와 일치하는 현재 사업장 상품이 없습니다.')

        // 원본 숫자가 잘못되었을 때 0/환율 1로 조용히 대체하지 않는다.
        const unitPrice = parsePurchaseNumber(r.unit_price, '구매단가', { required: true })
        const exchangeRate = parsePurchaseNumber(r.exchange_rate, '환율', { required: true, min: Number.MIN_VALUE })
        const shippingCostCny = parsePurchaseNumber(r.shipping_cost_cny, '배송비')
        const purchaseVat = parsePurchaseNumber(r.purchase_vat, '구입금액 VAT')
        const domesticShipping = parsePurchaseNumber(r.domestic_shipping, '입고비')
        const domesticShippingVat = parsePurchaseNumber(r.domestic_shipping_vat, '입고비 VAT')

        const totalCny = roundMoney(unitPrice * quantity + shippingCostCny)
        const payment1ProductKrw = roundMoney(unitPrice * exchangeRate * quantity)
        const shippingCostKrw = roundMoney(shippingCostCny * exchangeRate)
        const payment1Total = roundMoney(payment1ProductKrw + purchaseVat)
        const payment2Total = shippingCostKrw
        const payment3Total = roundMoney(domesticShipping + domesticShippingVat)
        const totalAmountKrw = roundMoney(payment1Total + payment2Total + payment3Total)
        const unitCostKrw = roundMoney(totalAmountKrw / quantity)

        // 시트의 파생 합계값이 있으면 단일 공식과 교차 검증한다.
        assertPurchaseDerivedAmount(r.total_cny, '총금액', totalCny, 0.02, 'CNY')
        assertPurchaseDerivedAmount(r.purchase_amount_krw, '구입금액', roundMoney(payment1ProductKrw + shippingCostKrw))
        assertPurchaseDerivedAmount(r.total_purchase_krw, '총 구입금액', roundMoney(payment1Total + payment2Total))
        assertPurchaseDerivedAmount(r.total_domestic, '총 입고비', payment3Total)
        assertPurchaseDerivedAmount(r.total_cost, '총비용', totalAmountKrw)
        assertPurchaseDerivedAmount(r.unit_cost_krw, '개당원가', unitCostKrw)

        purchaseRows.push({
          product_id: productId,
          po_number: null,
          order_date: orderDate,
          arrival_date: arrivalDate,
          expected_arrival_date: expectedArrivalDate,
          lead_time_weeks: leadTimeWeeks,
          quantity,
          unit_price: unitPrice,
          currency: 'CNY',
          exchange_rate: exchangeRate,
          shipping_cost: shippingCostKrw,
          payment1_product_krw: payment1ProductKrw,
          payment1_vat: purchaseVat,
          payment1_total: payment1Total,
          payment1_status: 'paid',
          payment2_vat: 0,
          additional_cost: payment2Total,
          payment2_total: payment2Total,
          payment2_status: 'paid',
          domestic_shipping: domesticShipping,
          customs_vat: domesticShippingVat,
          payment3_total: payment3Total,
          payment3_status: 'paid',
          unit_cost_krw: unitCostKrw,
          total_amount_krw: totalAmountKrw,
          payment_status: 'paid',
          status: arrivalDate ? 'arrived' : 'ordered',
          notes: r.supplier_name ? `[${String(r.supplier_name).trim()}]` : null,
          product_name_memo: productName,
        })
      } catch (error) {
        preparationFailed = true
        errors.push({
          row: rowOffset + 2,
          message: `매입 행 검증 실패: ${error instanceof Error ? error.message : '알 수 없는 오류'}`,
        })
      }
    }

    if (!preparationFailed && purchaseRows.length > 0) {
      atomicExpectedCount = purchaseRows.length
      try {
        // 구매행 INSERT와 입고 재고·이동평균·감사 이력을 하나의 DB 트랜잭션으로 묶는다.
        // 하나라도 실패하면 전체가 롤백되며 JS에서 기존 테이블을 직접 보정하지 않는다.
        successCount = await importPurchasesAtomically(
          supabase,
          userId,
          businessId,
          batchId,
          purchaseImportIdempotencyKey(purchaseRows),
          purchaseRows,
        )
        atomicBatchCompleted = true
      } catch (error) {
        const originalMessage = error instanceof Error ? error.message : '매입·재고 원자 저장 실패'
        if (businessId) {
          const outcome = await readAtomicBatchOutcome(supabase, {
            batchId, userId, businessId, importType: 'purchase', expectedCount: purchaseRows.length,
          })
          if (outcome.state === 'completed') {
            successCount = outcome.successCount
            atomicBatchCompleted = true
          } else if (outcome.state === 'unknown') {
            atomicOutcomeUnknownError = `매입 Import 결과를 확정할 수 없습니다: ${outcome.reason}`
          } else {
            errors.push({ row: 0, message: originalMessage })
          }
        } else {
          errors.push({ row: 0, message: originalMessage })
        }
      }
    } else if (!preparationFailed) {
      errors.push({ row: 0, message: '등록할 유효 매입 행이 없습니다.' })
    }
  }

  if (atomicOutcomeUnknownError) {
    // 결과를 읽지 못한 상태에서 failed를 쓰면 실제 commit 성공 배치를 거짓 실패로 덮언다.
    throw new Error(`${atomicOutcomeUnknownError} 배치 ID: ${batchId}. 재업로드 전 임포트 캘린더에서 상태를 확인해 주세요.`)
  }

  // 3. 배치 상태 업데이트. 원자 RPC 성공은 데이터와 completed를 이미 같은
  // 트랜잭션에서 확정했으므로 여기서 다시 쓰지 않고 atomic marker/receipt를 보존한다.
  if (!atomicBatchCompleted) {
    const finalBatchStatus = errors.length > 0 && successCount === 0 ? 'failed' : 'completed'
    let batchStatusQuery = supabase
      .from('coupang_imports')
      .update({
        status: finalBatchStatus,
        success_count: successCount,
        error_count: errors.length,
        completed_at: new Date().toISOString(),
        summary: { errors: errors.slice(0, 20) },
      })
      .eq('id', batchId)

    if (importType === 'purchase' || importType === 'ad_billing') {
      batchStatusQuery = batchStatusQuery
        .eq('user_id', userId)
        .eq('import_type', importType)
        .eq('status', 'processing')
      batchStatusQuery = businessId
        ? batchStatusQuery.eq('business_id', businessId)
        : batchStatusQuery.is('business_id', null)
      batchStatusQuery = batchStatusQuery.select('id, status, success_count')
    }

    const { data: batchStatusData, error: batchStatusError } = await batchStatusQuery
    if (batchStatusError) {
      const originalFailure = errors[0]?.message ? ` 원래 처리 결과: ${errors[0].message}` : ''
      throw new Error(`배치 상태 업데이트 실패: ${batchStatusError.message || '알 수 없는 오류'}.${originalFailure}`)
    }
    if ((importType === 'purchase' || importType === 'ad_billing')
      && (!Array.isArray(batchStatusData) || batchStatusData.length === 0)) {
      if (!businessId) throw new Error(`${importType} Import 배치 상태를 확정할 수 없습니다.`)
      const outcome = await readAtomicBatchOutcome(supabase, {
        batchId,
        userId,
        businessId,
        importType,
        expectedCount: atomicExpectedCount,
      })
      if (outcome.state === 'completed') {
        successCount = outcome.successCount
        errors.splice(0, errors.length)
        atomicBatchCompleted = true
      } else {
        const reason = outcome.state === 'unknown' ? outcome.reason : '배치 상태가 예상과 다릅니다.'
        throw new Error(`${importType} Import 결과를 확정할 수 없습니다: ${reason} 배치 ID: ${batchId}`)
      }
    }
  }

  return {
    batchId,
    totalRows,
    successCount,
    errorCount: errors.length,
    skippedCount,
    skippedReasons,
    mergedCount: mergedCount || undefined,
    errors: errors.slice(0, 20),
    ...(importType === 'sales' ? {
      fallbackApplied,
      unmatchedOptions,
    } : {}),
    ...(importType === 'product' ? {
      insertedCount,
      updatedCount,
      invalidStatusCount,
    } : {}),
  }
}
