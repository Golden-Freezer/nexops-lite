export type ManualMovementType = 'inbound' | 'outbound' | 'adjustment'
export type MovementQuantityMode = 'delta' | 'absolute'

/** 신규 수동 조정의 quantity가 목표 수량이 아니라 증감량임을 기존 테이블 안에서 식별한다. */
export const MANUAL_ADJUSTMENT_DELTA_NOTE_PREFIX = '[NEXOPS:DELTA]\n'

export interface ManualMovementInput {
  operationId: string
  inventoryId: string
  productId: string
  movementType: ManualMovementType
  quantity: number
  unitCost: number | null
  referenceNo: string | null
  notes: string | null
  movementDate: string
}

export type MovementInputResult =
  | { ok: true; value: ManualMovementInput }
  | { ok: false; error: string }

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const MOVEMENT_TYPES = new Set<ManualMovementType>(['inbound', 'outbound', 'adjustment'])

function optionalText(value: unknown, maxLength: number): string | null | undefined {
  if (value == null || value === '') return null
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (!trimmed) return null
  return trimmed.length <= maxLength ? trimmed : undefined
}

function isRealDate(value: string): boolean {
  if (!DATE_PATTERN.test(value)) return false
  const parsed = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

export function parseManualMovementInput(body: unknown, defaultDate: string): MovementInputResult {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, error: 'JSON 객체가 필요합니다.' }
  }
  const input = body as Record<string, unknown>
  const inventoryId = input.inventoryId
  const operationId = input.operationId
  const productId = input.productId
  const movementType = input.movementType
  const quantity = input.quantity

  if (typeof operationId !== 'string' || !UUID_PATTERN.test(operationId)) {
    return { ok: false, error: '유효한 작업ID가 필요합니다.' }
  }
  if (typeof inventoryId !== 'string' || !UUID_PATTERN.test(inventoryId)) {
    return { ok: false, error: '유효한 재고ID가 필요합니다.' }
  }
  if (typeof productId !== 'string' || !UUID_PATTERN.test(productId)) {
    return { ok: false, error: '유효한 상품ID가 필요합니다.' }
  }
  if (typeof movementType !== 'string' || !MOVEMENT_TYPES.has(movementType as ManualMovementType)) {
    return { ok: false, error: '이동유형은 inbound, outbound, adjustment 중 하나여야 합니다.' }
  }
  if (
    !Number.isInteger(quantity) ||
    !Number.isFinite(quantity) ||
    Number(quantity) < 0 ||
    Number(quantity) > 2_147_483_647
  ) {
    return { ok: false, error: '수량은 0 이상 2,147,483,647 이하의 정수여야 합니다.' }
  }
  if (movementType !== 'adjustment' && quantity === 0) {
    return { ok: false, error: '입고·출고 수량은 1개 이상이어야 합니다.' }
  }

  const rawUnitCost = input.unitCost
  const unitCost = rawUnitCost == null || rawUnitCost === '' ? null : rawUnitCost
  if (
    unitCost !== null &&
    (typeof unitCost !== 'number' || !Number.isFinite(unitCost) || unitCost < 0 || unitCost > 9_999_999_999.99)
  ) {
    return { ok: false, error: '단가는 0 이상 9,999,999,999.99 이하의 숫자여야 합니다.' }
  }

  const referenceNo = optionalText(input.referenceNo, 100)
  if (referenceNo === undefined) return { ok: false, error: '참조번호는 100자 이하의 문자열이어야 합니다.' }
  const notes = optionalText(input.notes, 2_000)
  if (notes === undefined) return { ok: false, error: '메모는 2,000자 이하의 문자열이어야 합니다.' }

  const movementDate = input.movementDate == null || input.movementDate === '' ? defaultDate : input.movementDate
  if (typeof movementDate !== 'string' || !isRealDate(movementDate)) {
    return { ok: false, error: '이동일자는 YYYY-MM-DD 형식의 유효한 날짜여야 합니다.' }
  }

  return {
    ok: true,
    value: {
      operationId,
      inventoryId,
      productId,
      movementType: movementType as ManualMovementType,
      quantity: Number(quantity),
      unitCost: unitCost as number | null,
      referenceNo,
      notes,
      movementDate,
    },
  }
}

/** 레거시 수동 출고 양수 이력도 화면에서는 실제 증감 방향으로 표시한다. */
export function movementDisplayQuantity(movementType: string, quantity: number): number {
  if (movementType === 'outbound') return -Math.abs(quantity)
  if (movementType === 'inbound') return Math.abs(quantity)
  return quantity
}

export function inferMovementQuantityMode(
  movementType: string,
  referenceNo: string | null | undefined,
  notes: string | null | undefined,
): MovementQuantityMode {
  if (movementType !== 'adjustment') return 'delta'
  if (notes?.startsWith(MANUAL_ADJUSTMENT_DELTA_NOTE_PREFIX)) return 'delta'
  if (referenceNo?.startsWith('HEALTH-SYNC-')) return 'delta'
  if (/^PURCHASE-[0-9a-f-]{36}-[0-9a-f-]{36}-REV$/i.test(referenceNo ?? '')) return 'delta'
  if (
    notes?.startsWith('매입 상태 역전환') ||
    notes?.startsWith('매입 삭제') ||
    notes?.startsWith('매입 입고 역전환')
  ) return 'delta'
  // 구 route의 수동 adjustment는 목표 절대 수량을 저장했다.
  return 'absolute'
}

export function normalizeMovementNotes(
  movementType: string,
  notes: string | null | undefined,
): string | null {
  if (movementType !== 'adjustment' || !notes?.startsWith(MANUAL_ADJUSTMENT_DELTA_NOTE_PREFIX)) {
    return notes ?? null
  }
  const userNotes = notes.slice(MANUAL_ADJUSTMENT_DELTA_NOTE_PREFIX.length)
  return userNotes || null
}
