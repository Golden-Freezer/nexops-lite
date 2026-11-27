import { kstTodayStr } from '@/lib/analytics/date-buckets'
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAuth } from '@/lib/auth/clerk'
import { requireOwnedBusinessId } from '@/lib/auth/business'
import {
  inferMovementQuantityMode,
  normalizeMovementNotes,
  parseManualMovementInput,
} from '@/lib/inventory/movement-contract'

interface RpcErrorLike {
  code?: string
  message?: string
}

interface AtomicMovementRpcData {
  movement: {
    id: string
    inventory_id: string
    product_id: string
    movement_type: string
    quantity: number
    reference_no: string | null
    unit_cost: number | null
    notes: string | null
    movement_date: string
    created_at: string | null
  }
  updatedStock: number
}

function rpcFailure(error: RpcErrorLike): NextResponse {
  const message = error.message ?? ''
  if (message.includes('NXINV_SCOPE_MISMATCH')) {
    return NextResponse.json({ error: '선택 사업장에 속한 재고·상품 조합이 아닙니다.' }, { status: 403 })
  }
  const shortage = message.match(/NXINV_STOCK_SHORTAGE:(\d+):(\d+)/)
  if (shortage) {
    return NextResponse.json(
      { error: `재고 부족: 현재 ${shortage[1]}개, 출고 요청 ${shortage[2]}개` },
      { status: 400 },
    )
  }
  if (message.includes('NXINV_NO_CHANGE')) {
    return NextResponse.json({ error: '현재 재고와 같은 수량으로는 조정 이력을 만들 수 없습니다.' }, { status: 400 })
  }
  if (message.includes('NXINV_BASE_COST_REQUIRED')) {
    return NextResponse.json(
      { error: '기존 재고의 기준 원가가 없습니다. 상품 기본 원가를 먼저 설정해 주세요.' },
      { status: 409 },
    )
  }
  if (message.includes('NXINV_OPERATION_PAYLOAD_MISMATCH')) {
    return NextResponse.json(
      { error: '재시도 요청 내용이 달라졌습니다. 입력 내용을 다시 확인해 제출해 주세요.' },
      { status: 409 },
    )
  }
  if (message.includes('NXINV_INVALID_')) {
    return NextResponse.json({ error: '입출고 요청 값이 올바르지 않습니다.' }, { status: 400 })
  }
  if (error.code === 'PGRST202' || message.includes('apply_manual_inventory_movement')) {
    return NextResponse.json(
      { error: '원자적 입출고 처리 기능이 아직 준비되지 않았습니다. 관리자에게 문의해 주세요.' },
      { status: 503 },
    )
  }
  console.error('[POST /api/inventory/movements] atomic RPC failed:', error)
  return NextResponse.json({ error: '입출고를 원자적으로 처리하지 못했습니다.' }, { status: 500 })
}

function isAtomicMovementData(data: unknown): data is AtomicMovementRpcData {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false
  const record = data as Record<string, unknown>
  const movement = record.movement
  return (
    !!movement &&
    typeof movement === 'object' &&
    !Array.isArray(movement) &&
    typeof (movement as Record<string, unknown>).id === 'string' &&
    typeof record.updatedStock === 'number'
  )
}

/** GET /api/inventory/movements - 입출고 이력 조회 (필터 지원) */
export async function GET(request: NextRequest) {
  try {
    let userId: string
    try { userId = await requireAuth() } catch (r) { return r as NextResponse }
    let businessId: string
    try { businessId = await requireOwnedBusinessId(userId) } catch (r) { return r as NextResponse }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const supabase = createAdminClient() as any
    const { searchParams } = request.nextUrl
    const productId = searchParams.get('productId')
    const from = searchParams.get('from')
    const to = searchParams.get('to')
    const movementType = searchParams.get('type')
    const requestedLimit = Number(searchParams.get('limit') ?? 200)
    const limit = Number.isInteger(requestedLimit) ? Math.min(200, Math.max(1, requestedLimit)) : 200

    let query = supabase
      .from('inventory_movements')
      .select('*, products!inner(product_name, user_id, business_id)')
      .eq('products.user_id', userId)
      .order('movement_date', { ascending: false })
      .limit(limit)

    query = query.eq('products.business_id', businessId)
    if (productId) query = query.eq('product_id', productId)
    if (from) query = query.gte('movement_date', from)
    if (to) query = query.lte('movement_date', to)
    if (movementType) query = query.eq('movement_type', movementType)

    const { data, error } = await query
    if (error) {
      console.error('[GET /api/inventory/movements] query failed:', error)
      return NextResponse.json({ error: '입출고 이력을 조회하지 못했습니다.' }, { status: 500 })
    }

    const movements = (data ?? []).map((row: Record<string, unknown> & { products?: { product_name?: string } }) => {
      const movementType = String(row.movement_type ?? '')
      const referenceNo = typeof row.reference_no === 'string' ? row.reference_no : null
      const notes = typeof row.notes === 'string' ? row.notes : null
      return {
        id: row.id,
        inventoryId: row.inventory_id,
        productId: row.product_id,
        productName: row.products?.product_name ?? '',
        movementType,
        quantity: row.quantity,
        quantityMode: inferMovementQuantityMode(movementType, referenceNo, notes),
        referenceNo,
        unitCost: row.unit_cost == null ? null : Number(row.unit_cost),
        notes: normalizeMovementNotes(movementType, notes),
        movementDate: row.movement_date,
        createdAt: row.created_at,
      }
    })

    return NextResponse.json({ data: movements })
  } catch (error) {
    console.error('[GET /api/inventory/movements] unexpected error:', error)
    return NextResponse.json({ error: '입출고 이력 조회 중 오류가 발생했습니다.' }, { status: 500 })
  }
}

/** POST /api/inventory/movements - 소유권·재고·이동평균·이력을 단일 RPC로 원자 처리 */
export async function POST(request: NextRequest) {
  try {
    let userId: string
    try { userId = await requireAuth() } catch (r) { return r as NextResponse }

    let businessId: string
    try { businessId = await requireOwnedBusinessId(userId) } catch (r) { return r as NextResponse }

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: '잘못된 JSON 형식입니다.' }, { status: 400 })
    }
    const parsed = parseManualMovementInput(body, kstTodayStr())
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })

    // 생성 타입 반영 전의 신규 RPC라 admin client만 국소적으로 확장한다.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const supabase = createAdminClient() as any
    const input = parsed.value
    const { data, error } = await supabase.rpc('apply_manual_inventory_movement', {
      p_operation_id: input.operationId,
      p_user_id: userId,
      p_business_id: businessId,
      p_inventory_id: input.inventoryId,
      p_product_id: input.productId,
      p_movement_type: input.movementType,
      p_quantity: input.quantity,
      p_unit_cost: input.unitCost,
      p_reference_no: input.referenceNo,
      p_notes: input.notes,
      p_movement_date: input.movementDate,
    })

    if (error) return rpcFailure(error)
    if (!isAtomicMovementData(data)) {
      console.error('[POST /api/inventory/movements] invalid atomic RPC response:', data)
      return NextResponse.json({ error: '입출고 처리 결과를 확인하지 못했습니다.' }, { status: 500 })
    }

    const movement = data.movement
    const quantityMode = inferMovementQuantityMode(
      movement.movement_type,
      movement.reference_no,
      movement.notes,
    )
    return NextResponse.json({
      data: {
        id: movement.id,
        inventoryId: movement.inventory_id,
        productId: movement.product_id,
        movementType: movement.movement_type,
        quantity: movement.quantity,
        quantityMode,
        referenceNo: movement.reference_no,
        unitCost: movement.unit_cost == null ? null : Number(movement.unit_cost),
        notes: normalizeMovementNotes(movement.movement_type, movement.notes),
        movementDate: movement.movement_date,
        createdAt: movement.created_at,
      },
      updatedStock: data.updatedStock,
    })
  } catch (error) {
    if (error instanceof NextResponse) return error
    console.error('[POST /api/inventory/movements] unexpected error:', error)
    return NextResponse.json({ error: '입출고 등록 중 오류가 발생했습니다.' }, { status: 500 })
  }
}

/**
 * 이력은 감사 로그다. adjustment는 이전 절대 수량이 없고, 과거 입출고도 후속 이동평균을
 * 재생하지 않으면 정확히 되돌릴 수 없으므로 삭제·추정 롤백을 모두 금지한다.
 */
export async function DELETE(request: NextRequest) {
  let userId: string
  try { userId = await requireAuth() } catch (r) { return r as NextResponse }
  void userId

  const id = request.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id 필수' }, { status: 400 })
  return NextResponse.json(
    { error: '입출고 이력은 감사 기록이므로 삭제할 수 없습니다. 오류는 새 조정 이력으로 정정해 주세요.' },
    { status: 405, headers: { Allow: 'GET, POST' } },
  )
}
