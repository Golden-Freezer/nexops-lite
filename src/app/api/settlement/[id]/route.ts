import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { calculateSettlementTotals } from '@/lib/settlement/profit'
import { requireAuth } from '@/lib/auth/clerk'
import { requireOwnedBusinessId } from '@/lib/auth/business'
import type { SettlementFormData } from '@/types/settlement'

const RECALCULATE_TRIGGER_FIELDS = [
  'productId', 'salesQuantity', 'sellingPrice', 'unitCost', 'fulfillmentFee',
  'commissionRate', 'returnRate', 'returnPickupFee', 'returnRestockFee',
] as const

const COMPLETE_SOURCE_FIELDS = [
  'productId', 'periodStart', 'periodEnd', 'salesQuantity', 'sellingPrice',
  'unitCost', 'fulfillmentFee', 'commissionRate', 'returnRate',
  'returnPickupFee', 'returnRestockFee', 'adCost',
] as const

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

function hasOwn(body: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(body, key)
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function validateCompleteSource(body: Record<string, unknown>): string | null {
  const missing = COMPLETE_SOURCE_FIELDS.filter((field) => !hasOwn(body, field))
  if (missing.length > 0) {
    return `집계 재계산에는 전체 원본 입력이 필요합니다: ${missing.join(', ')}`
  }
  if (typeof body.productId !== 'string' || !body.productId) return '상품은 필수입니다.'
  if (
    typeof body.periodStart !== 'string' || !DATE_PATTERN.test(body.periodStart)
    || typeof body.periodEnd !== 'string' || !DATE_PATTERN.test(body.periodEnd)
    || body.periodStart > body.periodEnd
  ) return '올바른 정산 시작일과 종료일이 필요합니다.'

  const nonNegativeFields = [
    'sellingPrice', 'unitCost', 'fulfillmentFee', 'commissionRate', 'returnRate',
    'returnPickupFee', 'returnRestockFee', 'adCost',
  ] as const
  if (!Number.isInteger(body.salesQuantity) || Number(body.salesQuantity) <= 0) {
    return '판매수량은 1 이상의 정수여야 합니다.'
  }
  for (const field of nonNegativeFields) {
    if (!isFiniteNumber(body[field]) || body[field] < 0) return `${field}는 0 이상의 숫자여야 합니다.`
  }
  if (Number(body.sellingPrice) <= 0) return '판매가는 0보다 커야 합니다.'
  if (Number(body.commissionRate) > 1 || Number(body.returnRate) > 1) {
    return '수수료율과 반품율은 0~1 사이여야 합니다.'
  }
  return null
}

/** PATCH /api/settlement/[id] - 정산 수정 / 검증 토글 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    let userId: string
    try { userId = await requireAuth() } catch (response) { return response as NextResponse }
    const { id } = await params
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const supabase = createAdminClient() as any

    let body: Record<string, unknown>
    try {
      const parsed = await request.json()
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid body')
      body = parsed as Record<string, unknown>
    } catch {
      return NextResponse.json({ error: '잘못된 JSON 형식입니다.' }, { status: 400 })
    }

    let businessId: string
    try { businessId = await requireOwnedBusinessId(userId) } catch (response) { return response as NextResponse }

    const needsRecalculate = RECALCULATE_TRIGGER_FIELDS.some((field) => hasOwn(body, field))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let updateData: Record<string, any> = {}

    if (needsRecalculate) {
      const validationError = validateCompleteSource(body)
      if (validationError) return NextResponse.json({ error: validationError }, { status: 400 })

      const { data: product, error: productError } = await supabase
        .from('products')
        .select('id')
        .eq('id', body.productId)
        .eq('user_id', userId)
        .eq('business_id', businessId)
        .maybeSingle()
      if (productError) {
        return NextResponse.json({ error: `상품 확인 실패: ${productError.message}` }, { status: 500 })
      }
      if (!product) {
        return NextResponse.json({ error: '선택한 사업장의 상품을 찾을 수 없습니다.' }, { status: 404 })
      }

      const formData = body as unknown as SettlementFormData
      const calculated = calculateSettlementTotals(formData)
      const { net_profit: generatedNetProfit, ...calculatedFields } = calculated
      void generatedNetProfit
      updateData = {
        product_id: formData.productId,
        period_start: formData.periodStart,
        period_end: formData.periodEnd,
        sales_quantity: formData.salesQuantity,
        ...calculatedFields,
      }
      if (hasOwn(body, 'verified')) {
        if (typeof body.verified !== 'boolean') {
          return NextResponse.json({ error: 'verified는 boolean이어야 합니다.' }, { status: 400 })
        }
        updateData.verified = body.verified
      }
    } else {
      const changesStart = hasOwn(body, 'periodStart')
      const changesEnd = hasOwn(body, 'periodEnd')
      if (changesStart !== changesEnd) {
        return NextResponse.json(
          { error: '정산 기간을 수정할 때는 periodStart와 periodEnd를 함께 보내야 합니다.' },
          { status: 400 }
        )
      }
      if (hasOwn(body, 'verified')) {
        if (typeof body.verified !== 'boolean') {
          return NextResponse.json({ error: 'verified는 boolean이어야 합니다.' }, { status: 400 })
        }
        updateData.verified = body.verified
      }
      if (hasOwn(body, 'periodStart')) {
        if (typeof body.periodStart !== 'string' || !DATE_PATTERN.test(body.periodStart)) {
          return NextResponse.json({ error: 'periodStart 형식이 올바르지 않습니다.' }, { status: 400 })
        }
        updateData.period_start = body.periodStart
      }
      if (hasOwn(body, 'periodEnd')) {
        if (typeof body.periodEnd !== 'string' || !DATE_PATTERN.test(body.periodEnd)) {
          return NextResponse.json({ error: 'periodEnd 형식이 올바르지 않습니다.' }, { status: 400 })
        }
        updateData.period_end = body.periodEnd
      }
      if (
        typeof updateData.period_start === 'string'
        && typeof updateData.period_end === 'string'
        && updateData.period_start > updateData.period_end
      ) {
        return NextResponse.json({ error: '시작일은 종료일보다 늦을 수 없습니다.' }, { status: 400 })
      }
      if (hasOwn(body, 'adCost')) {
        if (!isFiniteNumber(body.adCost) || body.adCost < 0) {
          return NextResponse.json({ error: 'adCost는 0 이상의 숫자여야 합니다.' }, { status: 400 })
        }
        const { data: current, error: currentError } = await supabase
          .from('settlements')
          .select('total_margin')
          .eq('id', id)
          .eq('user_id', userId)
          .eq('business_id', businessId)
          .maybeSingle()
        if (currentError) {
          return NextResponse.json({ error: `정산 조회 실패: ${currentError.message}` }, { status: 500 })
        }
        if (!current) {
          return NextResponse.json({ error: '정산 내역을 찾을 수 없습니다.' }, { status: 404 })
        }
        const totalMargin = Number(current.total_margin)
        if (!Number.isFinite(totalMargin)) {
          return NextResponse.json({ error: '정산 마진 값이 올바르지 않습니다.' }, { status: 500 })
        }
        updateData.ad_cost = body.adCost
        updateData.net_profit = totalMargin - body.adCost
      }
      if (Object.keys(updateData).length === 0) {
        return NextResponse.json({ error: '수정할 필드가 없습니다.' }, { status: 400 })
      }
    }

    const { data, error } = await supabase
      .from('settlements')
      .update(updateData)
      .eq('id', id)
      .eq('user_id', userId)
      .eq('business_id', businessId)
      .select()
      .maybeSingle()

    if (error) {
      return NextResponse.json({ error: `정산 수정 실패: ${error.message}` }, { status: 500 })
    }
    if (!data) {
      return NextResponse.json({ error: '정산 내역을 찾을 수 없습니다.' }, { status: 404 })
    }

    return NextResponse.json({ data })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '정산 수정 중 오류가 발생했습니다.' },
      { status: 500 }
    )
  }
}
