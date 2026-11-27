import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAuth } from '@/lib/auth/clerk'
import { requireOwnedBusinessId } from '@/lib/auth/business'

type RpcError = { code?: string; message?: string }

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

function isValidIsoDate(value: unknown): value is string {
  if (typeof value !== 'string' || !ISO_DATE.test(value)) return false
  const parsed = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

function rpcErrorResponse(error: RpcError) {
  if (error.code === '42883' || error.code === 'PGRST202') {
    return NextResponse.json(
      {
        error: '안전한 쿠폰 일괄 적용 함수가 아직 적용되지 않았습니다. 관리자에게 마이그레이션 적용을 요청하세요.',
        code: 'PRICING_ATOMIC_MIGRATION_REQUIRED',
      },
      { status: 503 },
    )
  }

  const message = error.message ?? '쿠폰 일괄 적용 실패'
  if (message.includes('NXCUPON_NOT_FOUND') || message.includes('NXCUPON_SCOPE_MISMATCH')) {
    return NextResponse.json({ error: '현재 사업장의 상품을 찾을 수 없습니다.' }, { status: 404 })
  }
  if (message.includes('NXCUPON_INVALID')) {
    return NextResponse.json({ error: '쿠폰 적용 요청 값이 올바르지 않습니다.' }, { status: 400 })
  }
  return NextResponse.json({ error: `쿠폰 일괄 적용 실패: ${message}` }, { status: 500 })
}

/**
 * POST /api/sales/bulk-coupon - 상품×기간 판매자할인쿠폰 일괄 적용
 * body: { productId, startDate, endDate, perUnitCoupon }
 * - 해당 상품/기간의 매출 행: coupon_discount = perUnitCoupon × |수량|, 마진 재계산
 * - product_price_history에 (seller_discount_coupon, effective_date=startDate) 기록 → 향후 임포트에도 반영
 * 마진 = 매출 - 원가×수량 - 수수료 - 수수료VAT - 입출고 - 입출고VAT - 쿠폰 - 부가세 (저장 공식과 동일)
 */
export async function POST(request: NextRequest) {
  try {
    let userId: string
    try { userId = await requireAuth() } catch (r) { return r as NextResponse }
    let businessId: string
    try { businessId = await requireOwnedBusinessId(userId) } catch (r) { return r as NextResponse }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const supabase = createAdminClient() as any

    let body: Record<string, unknown>
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: '잘못된 JSON 형식입니다.' }, { status: 400 })
    }

    const productId = typeof body.productId === 'string' ? body.productId : ''
    const startDate = body.startDate
    const endDate = body.endDate
    const perUnitCoupon = Number(body.perUnitCoupon)

    if (!productId || !isValidIsoDate(startDate) || !isValidIsoDate(endDate)) {
      return NextResponse.json({ error: 'productId, startDate, endDate는 필수입니다.' }, { status: 400 })
    }
    if (startDate > endDate) {
      return NextResponse.json({ error: '시작일은 종료일보다 늦을 수 없습니다.' }, { status: 400 })
    }
    if (!Number.isFinite(perUnitCoupon) || perUnitCoupon < 0) {
      return NextResponse.json({ error: '개당 쿠폰 금액은 0 이상의 숫자여야 합니다.' }, { status: 400 })
    }

    // 매출행·가격 이력·자동 정산을 하나의 DB 트랜잭션으로 갱신한다.
    const { data, error } = await supabase.rpc('apply_owned_bulk_coupon_atomic', {
      p_actor_user_id: userId,
      p_business_id: businessId,
      p_product_id: productId,
      p_start_date: startDate,
      p_end_date: endDate,
      p_per_unit_coupon: perUnitCoupon,
    })

    if (error) return rpcErrorResponse(error)
    return NextResponse.json({ data })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '일괄 쿠폰 적용 중 오류가 발생했습니다.' },
      { status: 500 }
    )
  }
}
