import { kstTodayStr } from '@/lib/analytics/date-buckets'
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAuth } from '@/lib/auth/clerk'
import { requireOwnedBusinessId } from '@/lib/auth/business'
import { fetchAllRows } from '@/lib/supabase/fetch-all'
import {
  isPurchaseMutationRpcData,
  parsePurchaseCreateRequest,
  parsePurchaseDeleteRequest,
  parsePurchasePatchRequest,
} from '@/lib/purchases/mutation'

interface RpcErrorLike {
  code?: string
  message?: string
}

function mutationRpcFailure(error: RpcErrorLike, action: '수정' | '삭제'): NextResponse {
  const message = error.message ?? ''
  if (message.includes('NXPUR_STALE_VERSION')) {
    return NextResponse.json(
      { error: '다른 변경이 먼저 반영되었습니다. 최신 목록을 다시 확인해 주세요.', code: 'STALE_PURCHASE' },
      { status: 409 },
    )
  }
  if (message.includes('NXPUR_IDEMPOTENCY_CONFLICT')) {
    return NextResponse.json(
      { error: '같은 operationId가 다른 요청에 사용되었습니다.', code: 'IDEMPOTENCY_CONFLICT' },
      { status: 409 },
    )
  }
  if (message.includes('NXPUR_ARRIVED_IMMUTABLE')) {
    return NextResponse.json(
      { error: '입고 완료 매입의 상품·수량·원가는 직접 수정할 수 없습니다. 먼저 입고 상태를 되돌려 주세요.', code: 'ARRIVED_PURCHASE_IMMUTABLE' },
      { status: 409 },
    )
  }
  if (
    message.includes('NXPUR_INVENTORY_SHORTAGE') ||
    message.includes('NXPUR_DUPLICATE_INVENTORY') ||
    message.includes('NXPUR_INVENTORY_STATE_MISMATCH') ||
    message.includes('NXPUR_INVENTORY_MISSING') ||
    message.includes('NXPUR_REVERSAL_INPUT_MISSING') ||
    message.includes('NXPUR_REVERSAL_HISTORY_MISMATCH') ||
    message.includes('NXPUR_REVERSAL_SNAPSHOT_MISMATCH') ||
    message.includes('NXPUR_REVERSAL_HAS_LATER_MOVEMENTS')
  ) {
    return NextResponse.json(
      { error: `재고 정합성을 확인할 수 없어 매입 ${action}을 중단했습니다.`, code: 'PURCHASE_INVENTORY_CONFLICT' },
      { status: 409 },
    )
  }
  if (
    message.includes('NXPUR_SCOPE_MISMATCH') ||
    message.includes('NXPUR_PRODUCT_SCOPE_MISMATCH') ||
    message.includes('NXPUR_SUPPLIER_SCOPE_MISMATCH')
  ) {
    return NextResponse.json({ error: '선택 사업장에 속한 매입·상품·공급처 조합이 아닙니다.' }, { status: 403 })
  }
  if (message.includes('NXPUR_NOT_FOUND')) {
    return NextResponse.json({ error: '해당 매입을 찾을 수 없습니다.' }, { status: 404 })
  }
  if (message.includes('NXPUR_INVALID_') || message.includes('NXPUR_PRODUCT_REQUIRED') || message.includes('NXPUR_ARRIVAL_INPUT_REQUIRED')) {
    return NextResponse.json({ error: '매입 요청 값이 올바르지 않습니다.' }, { status: 400 })
  }
  if (
    error.code === 'PGRST202' ||
    message.includes('patch_purchase_atomic') ||
    message.includes('delete_purchase_atomic')
  ) {
    return NextResponse.json(
      { error: '원자적 매입 처리 기능이 아직 준비되지 않았습니다. 관리자에게 문의해 주세요.' },
      { status: 503 },
    )
  }
  console.error(`[${action} /api/purchases] atomic RPC failed:`, error)
  return NextResponse.json({ error: `매입 ${action}을 원자적으로 처리하지 못했습니다.` }, { status: 500 })
}

async function ownedBusinessId(userId: string): Promise<string | NextResponse> {
  try {
    return await requireOwnedBusinessId(userId)
  } catch (response) {
    if (response instanceof NextResponse) return response
    throw response
  }
}

/** GET /api/purchases - 선택 사업장 소유권 검증 후 매입 목록 조회 */
export async function GET(request: NextRequest) {
  try {
    let userId: string
    try { userId = await requireAuth() } catch (response) { return response as NextResponse }
    const businessScope = await ownedBusinessId(userId)
    if (businessScope instanceof NextResponse) return businessScope
    const businessId = businessScope

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const supabase = createAdminClient() as any
    const { searchParams } = request.nextUrl
    const status = searchParams.get('status')
    const productId = searchParams.get('productId')
    const startDate = searchParams.get('startDate')
    const endDate = searchParams.get('endDate')

    const buildQuery = () => {
      let query = supabase
        .from('purchases')
        .select('*, products ( product_name, option_name, coupang_option_id, sku ), suppliers ( name )')
        .eq('user_id', userId)
        .eq('business_id', businessId)
      if (status) query = query.eq('status', status)
      if (productId) query = query.eq('product_id', productId)
      if (startDate) query = query.gte('order_date', startDate)
      if (endDate) query = query.lte('order_date', endDate)
      return query.order('order_date', { ascending: false })
    }

    const { data, error } = await fetchAllRows(buildQuery)
    if (error) {
      console.error('[GET /api/purchases] query failed:', error)
      return NextResponse.json({ error: '매입 목록을 조회하지 못했습니다.' }, { status: 500 })
    }
    return NextResponse.json({ data: data ?? [] })
  } catch (error) {
    if (error instanceof NextResponse) return error
    console.error('[GET /api/purchases] unexpected error:', error)
    return NextResponse.json({ error: '매입 조회 중 오류가 발생했습니다.' }, { status: 500 })
  }
}

/** POST /api/purchases - 신규 매입 등록. arrived 즉시 생성은 원자 입고 경로가 없으므로 실패 폐쇄한다. */
export async function POST(request: NextRequest) {
  try {
    let userId: string
    try { userId = await requireAuth() } catch (response) { return response as NextResponse }
    const businessScope = await ownedBusinessId(userId)
    if (businessScope instanceof NextResponse) return businessScope
    const businessId = businessScope

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: '잘못된 JSON 형식입니다.' }, { status: 400 })
    }
    const parsed = parsePurchaseCreateRequest(body)
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })
    const input = parsed.value

    if (input.status === 'arrived') {
      return NextResponse.json(
        { error: '신규 매입은 발주 상태로 등록한 뒤 원자적 상태 변경으로 입고 처리해 주세요.', code: 'ARRIVED_CREATE_BLOCKED' },
        { status: 409 },
      )
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const supabase = createAdminClient() as any
    const referenceChecks: Promise<{ data: unknown; error: RpcErrorLike | null }>[] = []
    if (input.productId) {
      referenceChecks.push(
        supabase.from('products').select('id')
          .eq('id', input.productId).eq('user_id', userId).eq('business_id', businessId).maybeSingle(),
      )
    }
    if (input.supplierId) {
      referenceChecks.push(
        supabase.from('suppliers').select('id')
          .eq('id', input.supplierId).eq('user_id', userId).maybeSingle(),
      )
    }
    const referenceResults = await Promise.all(referenceChecks)
    const referenceError = referenceResults.find(result => result.error)?.error
    if (referenceError) {
      console.error('[POST /api/purchases] reference validation failed:', referenceError)
      return NextResponse.json({ error: '상품·공급처 소유권을 확인하지 못했습니다.' }, { status: 500 })
    }
    if (referenceResults.some(result => !result.data)) {
      return NextResponse.json({ error: '선택 사업장에 속한 상품·공급처가 아닙니다.' }, { status: 403 })
    }

    const agencyFeeKrw = Math.round(input.agencyFee * input.exchangeRate * 100) / 100
    const payment1ProductKrw = Math.round(
      (input.unitPrice * input.exchangeRate * input.quantity + agencyFeeKrw) * 100,
    ) / 100
    const payment1Total = Math.round((payment1ProductKrw + input.payment1Vat) * 100) / 100
    const payment2Total = Math.round((
      input.shippingCost + input.inspectionFee + input.labelingFee + input.packagingFee
      + input.customsDocFee + input.payment2Vat
    ) * 100) / 100
    const payment3Total = Math.round((input.domesticShipping + input.customsDuty + input.customsVat) * 100) / 100
    const totalAmountKrw = Math.round((payment1Total + payment2Total + payment3Total) * 100) / 100
    const unitCostKrw = Math.round((
      input.unitPrice * input.exchangeRate
      + (agencyFeeKrw + input.payment1Vat + payment2Total + payment3Total) / input.quantity
    ) * 100) / 100

    let expectedArrivalDate = input.expectedArrivalDate
    if (!expectedArrivalDate && input.leadTimeWeeks !== null) {
      const expected = new Date(`${input.orderDate}T00:00:00.000Z`)
      expected.setUTCDate(expected.getUTCDate() + input.leadTimeWeeks * 7)
      expectedArrivalDate = expected.toISOString().slice(0, 10)
    }

    const { data, error } = await supabase
      .from('purchases')
      .insert({
        user_id: userId,
        business_id: businessId,
        supplier_id: input.supplierId,
        product_id: input.productId,
        po_number: input.poNumber,
        order_date: input.orderDate,
        arrival_date: input.arrivalDate,
        expected_arrival_date: expectedArrivalDate,
        lead_time_weeks: input.leadTimeWeeks,
        quantity: input.quantity,
        unit_price: input.unitPrice,
        currency: input.currency,
        exchange_rate: input.exchangeRate,
        shipping_cost: input.shippingCost,
        payment1_product_krw: payment1ProductKrw,
        payment1_vat: input.payment1Vat,
        payment1_total: payment1Total,
        payment1_status: input.payment1Status,
        inspection_fee: input.inspectionFee,
        labeling_fee: input.labelingFee,
        packaging_fee: input.packagingFee,
        customs_doc_fee: input.customsDocFee,
        agency_fee: input.agencyFee,
        payment2_vat: input.payment2Vat,
        additional_cost: payment2Total,
        payment2_total: payment2Total,
        payment2_status: input.payment2Status,
        domestic_shipping: input.domesticShipping,
        customs_duty: input.customsDuty,
        customs_vat: input.customsVat,
        payment3_total: payment3Total,
        payment3_status: input.payment3Status,
        unit_cost_krw: unitCostKrw,
        total_amount_krw: totalAmountKrw,
        payment_status: input.paymentStatus,
        status: input.status,
        notes: input.notes,
        product_name_memo: input.productNameMemo,
      })
      .select('*, products ( product_name, option_name )')
      .single()

    if (error) {
      console.error('[POST /api/purchases] insert failed:', error)
      return NextResponse.json({ error: '매입을 등록하지 못했습니다.' }, { status: 500 })
    }
    return NextResponse.json({ data }, { status: 201 })
  } catch (error) {
    if (error instanceof NextResponse) return error
    console.error('[POST /api/purchases] unexpected error:', error)
    return NextResponse.json({ error: '매입 등록 중 오류가 발생했습니다.' }, { status: 500 })
  }
}

/** PATCH /api/purchases - 매입/재고/이력을 service_role 전용 RPC 한 번으로 수정 */
export async function PATCH(request: NextRequest) {
  try {
    let userId: string
    try { userId = await requireAuth() } catch (response) { return response as NextResponse }
    const businessScope = await ownedBusinessId(userId)
    if (businessScope instanceof NextResponse) return businessScope
    const businessId = businessScope

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: '잘못된 JSON 형식입니다.' }, { status: 400 })
    }
    const parsed = parsePurchasePatchRequest(body)
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })
    const input = parsed.value

    // 생성 타입 반영 전의 신규 RPC라 admin client만 국소적으로 확장한다.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const supabase = createAdminClient() as any
    const { data, error } = await supabase.rpc('patch_purchase_atomic', {
      p_actor_user_id: userId,
      p_business_id: businessId,
      p_purchase_id: input.purchaseId,
      p_expected_updated_at: input.expectedUpdatedAt,
      p_operation_id: input.operationId,
      p_patch: input.patch,
      p_effective_date: kstTodayStr(),
    })

    if (error) return mutationRpcFailure(error, '수정')
    if (!isPurchaseMutationRpcData(data) || data.mutation.action !== 'patch' || data.purchase === null) {
      console.error('[PATCH /api/purchases] invalid atomic RPC response:', data)
      return NextResponse.json({ error: '매입 수정 결과를 확인하지 못했습니다.' }, { status: 500 })
    }
    return NextResponse.json({ data: data.purchase, mutation: data.mutation })
  } catch (error) {
    if (error instanceof NextResponse) return error
    console.error('[PATCH /api/purchases] unexpected error:', error)
    return NextResponse.json({ error: '매입 수정 중 오류가 발생했습니다.' }, { status: 500 })
  }
}

/** DELETE /api/purchases - arrived 역연산과 삭제를 service_role 전용 RPC 한 번으로 처리 */
export async function DELETE(request: NextRequest) {
  try {
    let userId: string
    try { userId = await requireAuth() } catch (response) { return response as NextResponse }
    const businessScope = await ownedBusinessId(userId)
    if (businessScope instanceof NextResponse) return businessScope
    const businessId = businessScope

    const parsed = parsePurchaseDeleteRequest(request.nextUrl.searchParams)
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })
    const input = parsed.value

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const supabase = createAdminClient() as any
    const { data, error } = await supabase.rpc('delete_purchase_atomic', {
      p_actor_user_id: userId,
      p_business_id: businessId,
      p_purchase_id: input.purchaseId,
      p_expected_updated_at: input.expectedUpdatedAt,
      p_operation_id: input.operationId,
      p_effective_date: kstTodayStr(),
    })

    if (error) return mutationRpcFailure(error, '삭제')
    if (!isPurchaseMutationRpcData(data) || data.mutation.action !== 'delete' || data.purchase !== null) {
      console.error('[DELETE /api/purchases] invalid atomic RPC response:', data)
      return NextResponse.json({ error: '매입 삭제 결과를 확인하지 못했습니다.' }, { status: 500 })
    }
    return NextResponse.json({ success: true, mutation: data.mutation })
  } catch (error) {
    if (error instanceof NextResponse) return error
    console.error('[DELETE /api/purchases] unexpected error:', error)
    return NextResponse.json({ error: '매입 삭제 중 오류가 발생했습니다.' }, { status: 500 })
  }
}
