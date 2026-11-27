import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAuth } from '@/lib/auth/clerk'
import { requireOwnedBusinessId } from '@/lib/auth/business'
import { getSkuPrefix, generateSku } from '@/lib/utils/sku-generator'
import { kstTodayStr } from '@/lib/analytics/date-buckets'
import { fetchAllRows } from '@/lib/supabase/fetch-all'

type RpcError = { code?: string; message?: string }

function atomicPriceMutationError(error: RpcError) {
  if (error.code === '42883' || error.code === 'PGRST202') {
    return NextResponse.json(
      {
        error: '안전한 상품 가격 수정 함수가 아직 적용되지 않았습니다. 관리자에게 마이그레이션 적용을 요청하세요.',
        code: 'PRICING_ATOMIC_MIGRATION_REQUIRED',
      },
      { status: 503 },
    )
  }

  const message = error.message ?? '상품 수정 실패'
  if (message.includes('NXPRICE_NOT_FOUND') || message.includes('NXPRICE_SCOPE_MISMATCH')) {
    return NextResponse.json({ error: '현재 사업장의 상품을 찾을 수 없습니다.' }, { status: 404 })
  }
  if (message.includes('NXPRICE_INVALID')) {
    return NextResponse.json({ error: '상품 수정 값이 올바르지 않습니다.' }, { status: 400 })
  }
  return NextResponse.json({ error: `수정 실패: ${message}` }, { status: 500 })
}

function nullableNumber(value: unknown, fieldLabel: string, options?: { max?: number }) {
  if (value === null || value === '') return null
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0 || (options?.max !== undefined && parsed > options.max)) {
    throw new TypeError(`${fieldLabel} 값이 올바르지 않습니다.`)
  }
  return parsed
}

/** GET /api/products/[id] - 상품 상세 조회 (계산 필드 포함) */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    let userId: string
    try { userId = await requireAuth() } catch (r) { return r as NextResponse }
    const { id } = await params
    const supabase = createAdminClient()

    const { data, error } = await supabase
      .from('products')
      .select('*')
      .eq('id', id)
      .eq('user_id', userId)
      .maybeSingle()

    if (error) {
      return NextResponse.json({ error: `상품 조회 실패: ${error.message}` }, { status: 500 })
    }
    if (!data) {
      return NextResponse.json(
        { error: '상품을 찾을 수 없습니다.' },
        { status: 404 }
      )
    }

    let businessId: string | null = null
    if (data.purpose === 'product') {
      try { businessId = await requireOwnedBusinessId(userId) } catch (r) { return r as NextResponse }
      if (data.business_id !== businessId) {
        return NextResponse.json({ error: '현재 사업장의 상품이 아닙니다.' }, { status: 404 })
      }
    }

    // 계산 필드 산출
    const p = data as Record<string, unknown>
    const { data: invRow, error: inventoryError } = await supabase
      .from('inventory')
      .select('coupang_stock')
      .eq('product_id', id)
      .maybeSingle()
    if (inventoryError) {
      return NextResponse.json({ error: `상품 재고 조회 실패: ${inventoryError.message}` }, { status: 500 })
    }

    const stockQuantity = invRow ? Number(invRow.coupang_stock) || 0 : null

    const thirteenDaysAgo = new Date()
    thirteenDaysAgo.setDate(thirteenDaysAgo.getDate() - 13)
    const { data: salesRows, error: salesError } = await fetchAllRows(() => {
      let query = supabase
        .from('sales_transactions')
        .select('id, order_quantity, order_date')
        .eq('user_id', userId)
        .eq('product_id', id)
        .eq('status', 'confirmed')
        .gte('order_date', thirteenDaysAgo.toISOString().split('T')[0])
        .order('order_date', { ascending: true })
        .order('id', { ascending: true })
      if (businessId) query = query.eq('business_id', businessId)
      return query
    })
    if (salesError) {
      return NextResponse.json({ error: `상품 판매 집계 조회 실패: ${salesError.message}` }, { status: 500 })
    }

    const totalQty13d = (salesRows || []).reduce(
      (sum: number, r: Record<string, unknown>) => sum + (Number(r.order_quantity) || 0), 0
    )
    const weeklyAvgSales = totalQty13d > 0 ? Math.round((totalQty13d / (13 / 7)) * 10) / 10 : null
    const inventoryWeeks = (stockQuantity != null && weeklyAvgSales && weeklyAvgSales > 0)
      ? Math.round((stockQuantity / weeklyAvgSales) * 10) / 10
      : null
    const leadTimeWeeks = Number(p.lead_time_weeks) || 2
    let purchaseRequired: number | null = null
    if (weeklyAvgSales != null && weeklyAvgSales < 1) {
      purchaseRequired = 0
    } else if (weeklyAvgSales != null && inventoryWeeks != null && inventoryWeeks < leadTimeWeeks) {
      purchaseRequired = Math.ceil(weeklyAvgSales * Math.max(leadTimeWeeks, 4) - (stockQuantity || 0))
    } else {
      purchaseRequired = 0
    }
    const inventoryStatus =
      (purchaseRequired != null && purchaseRequired > 0) ? '재고부족'
        : (inventoryWeeks != null && inventoryWeeks > 8.5) ? '재고과잉'
          : '-'

    return NextResponse.json({
      data: {
        ...data,
        // 계산 필드
        stockQuantity,
        weeklyAvgSales,
        inventoryWeeks,
        purchaseRequired,
        inventoryStatus,
      },
    })
  } catch (error) {
    return NextResponse.json(
      { error: '상품 조회 중 오류가 발생했습니다.' },
      { status: 500 }
    )
  }
}

/** PATCH /api/products/[id] - 상품 수정 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    let userId: string
    try { userId = await requireAuth() } catch (r) { return r as NextResponse }
    let businessId: string
    try { businessId = await requireOwnedBusinessId(userId) } catch (r) { return r as NextResponse }
    const { id } = await params
    let body: Record<string, unknown>
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: '잘못된 JSON 형식입니다.' }, { status: 400 })
    }
    const supabase = createAdminClient()

    // purpose가 'product'로 변경될 때 SKU 자동 생성
    let sku: string | undefined = undefined
    if (body.purpose === 'product') {
      // 현재 상품 조회하여 SKU 존재 여부 확인
      const { data: current } = await supabase
        .from('products')
        .select('sku, category_path')
        .eq('id', id)
        .eq('user_id', userId)
        .eq('business_id', businessId)
        .maybeSingle()

      if (current && !current.sku) {
        const categoryPath = typeof body.categoryPath === 'string'
          ? body.categoryPath
          : current.category_path
        if (categoryPath) {
          const major = categoryPath.split(' > ')[0]?.trim()
          if (major) {
            const prefix = getSkuPrefix(major)
            const { data: existing } = await supabase
              .from('products')
              .select('sku')
              .eq('user_id', userId)
              .like('sku', `${prefix}-%`)
              .order('sku', { ascending: false })
              .limit(1)

            let currentMax = 0
            if (existing && existing.length > 0) {
              const lastSku = (existing[0] as Record<string, unknown>).sku as string
              const parts = lastSku.split('-')
              const num = parseInt(parts[parts.length - 1], 10)
              if (!isNaN(num)) currentMax = num
            }
            sku = generateSku(prefix, currentMax)
          }
        }
      }
    }

    // skuOptions를 options JSON에 저장
    const optionsData = body.skuOptions
      ? { skuOptions: body.skuOptions }
      : undefined

    const updatePayload: Record<string, unknown> = {
      ...(body.keyword !== undefined ? { keyword: body.keyword } : {}),
      ...(body.productName !== undefined ? { product_name: body.productName } : {}),
      ...(body.categoryPath !== undefined ? { category_path: body.categoryPath } : {}),
      ...(body.commissionRate !== undefined
        ? { commission_rate: nullableNumber(body.commissionRate, '판매수수료율', { max: 1 }) }
        : {}),
      ...(body.saleType !== undefined ? { sale_type: body.saleType } : {}),
      ...(body.status !== undefined ? { status: body.status } : {}),
      ...(body.searchTags !== undefined ? { search_tags: body.searchTags } : {}),
      ...(body.coupangProductUrl !== undefined ? { coupang_product_url: body.coupangProductUrl } : {}),
      ...(body.notes !== undefined ? { notes: body.notes } : {}),
      ...(body.purpose !== undefined ? { purpose: body.purpose } : {}),
      ...(body.sku !== undefined ? { sku: body.sku || null } : {}),
      ...(sku ? { sku } : {}),
      ...(optionsData ? { options: optionsData } : {}),
      // Excel '01.상품' 신규 필드 (migration 후 database.ts 재생성 전까지 타입 우회)
      ...(body.barcode !== undefined ? { barcode: body.barcode || null } : {}),
      ...(body.coupangProductId !== undefined ? { coupang_product_id: body.coupangProductId || null } : {}),
      ...(body.coupangDisplayName !== undefined ? { coupang_display_name: body.coupangDisplayName || null } : {}),
      ...(body.vendorProductId !== undefined ? { vendor_product_id: body.vendorProductId || null } : {}),
      ...(body.coupangOptionId !== undefined ? { coupang_option_id: body.coupangOptionId || null } : {}),
      ...(body.optionName !== undefined ? { option_name: body.optionName || null } : {}),
      ...(body.conditionValue !== undefined
        ? { condition_value: nullableNumber(body.conditionValue, '판매가')?.toString() ?? null }
        : {}),
      ...(body.returnResaleInfo !== undefined ? { return_resale_info: body.returnResaleInfo || null } : {}),
      ...(body.coupangExposureId !== undefined ? { coupang_exposure_id: body.coupangExposureId || null } : {}),
      ...(body.fulfillmentFeeDefault !== undefined
        ? { fulfillment_fee_default: nullableNumber(body.fulfillmentFeeDefault, '입출고배송비') }
        : {}),
      ...(body.unitCostDefault !== undefined
        ? { unit_cost_default: nullableNumber(body.unitCostDefault, '기본 원가') }
        : {}),
      ...(body.sellerDiscountCoupon !== undefined
        ? { seller_discount_coupon: nullableNumber(body.sellerDiscountCoupon, '판매자할인쿠폰') }
        : {}),
      ...(body.leadTimeWeeks !== undefined
        ? { lead_time_weeks: nullableNumber(body.leadTimeWeeks, '리드타임') }
        : {}),
      ...(body.salesStatus !== undefined ? { sales_status: body.salesStatus } : {}),
    }

    if (Object.keys(updatePayload).length === 0) {
      return NextResponse.json({ error: '수정할 값이 없습니다.' }, { status: 400 })
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any).rpc(
      'patch_owned_product_with_price_history_atomic',
      {
        p_actor_user_id: userId,
        p_business_id: businessId,
        p_product_id: id,
        p_patch: updatePayload,
        p_effective_date: kstTodayStr(),
      },
    )

    if (error) {
      return atomicPriceMutationError(error)
    }

    return NextResponse.json({ data })
  } catch (error) {
    if (error instanceof TypeError) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }
    return NextResponse.json(
      { error: '상품 수정 중 오류가 발생했습니다.' },
      { status: 500 }
    )
  }
}

/** DELETE /api/products/[id] - 원장 안전을 위해 상품 삭제 금지 */
export async function DELETE(
  _request: NextRequest,
  _context: { params: Promise<{ id: string }> }
) {
  try { await requireAuth() } catch (r) { return r as NextResponse }

  // 상품은 판매·매입·재고 원장의 기준 정보다. 원장 보존 정책과 대체/종료 절차가
  // 마련되기 전에는 service-role 클라이언트조차 만들지 않고 실패 폐쇄한다.
  return NextResponse.json(
    {
      error: '판매·매입·재고 원장 보존을 위해 상품 삭제가 잠겨 있습니다.',
      code: 'PRODUCT_DELETE_BLOCKED_LEDGER_SAFETY',
    },
    { status: 409 }
  )
}
