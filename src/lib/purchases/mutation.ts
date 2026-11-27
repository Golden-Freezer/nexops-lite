import { PURCHASE_STATUSES, type PaymentStageStatus, type PurchaseStatus } from '@/types/purchases'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

const PAYMENT_STAGE_STATUSES = new Set<PaymentStageStatus>(['unpaid', 'paid', 'none'])
const PAYMENT_STATUSES = new Set(['unpaid', 'partial', 'paid'])
const CURRENCIES = new Set(['CNY', 'USD', 'KRW'])

const PATCH_FIELDS = {
  productId: 'product_id',
  supplierId: 'supplier_id',
  poNumber: 'po_number',
  orderDate: 'order_date',
  arrivalDate: 'arrival_date',
  expectedArrivalDate: 'expected_arrival_date',
  leadTimeWeeks: 'lead_time_weeks',
  quantity: 'quantity',
  unitPrice: 'unit_price',
  currency: 'currency',
  exchangeRate: 'exchange_rate',
  shippingCost: 'shipping_cost',
  payment1Vat: 'payment1_vat',
  payment1Status: 'payment1_status',
  inspectionFee: 'inspection_fee',
  labelingFee: 'labeling_fee',
  packagingFee: 'packaging_fee',
  customsDocFee: 'customs_doc_fee',
  agencyFee: 'agency_fee',
  payment2Vat: 'payment2_vat',
  payment2Status: 'payment2_status',
  domesticShipping: 'domestic_shipping',
  customsDuty: 'customs_duty',
  customsVat: 'customs_vat',
  payment3Status: 'payment3_status',
  paymentStatus: 'payment_status',
  status: 'status',
  notes: 'notes',
  productNameMemo: 'product_name_memo',
} as const

type PatchField = keyof typeof PATCH_FIELDS
type RpcPatch = Record<string, string | number | null>

type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string }

export interface PurchaseCreateInput {
  supplierId: string | null
  productId: string | null
  poNumber: string | null
  orderDate: string
  arrivalDate: string | null
  expectedArrivalDate: string | null
  leadTimeWeeks: number | null
  quantity: number
  unitPrice: number
  currency: 'CNY' | 'USD' | 'KRW'
  exchangeRate: number
  shippingCost: number
  payment1Vat: number
  payment1Status: PaymentStageStatus
  inspectionFee: number
  labelingFee: number
  packagingFee: number
  customsDocFee: number
  agencyFee: number
  payment2Vat: number
  payment2Status: PaymentStageStatus
  domesticShipping: number
  customsDuty: number
  customsVat: number
  payment3Status: PaymentStageStatus
  paymentStatus: 'unpaid' | 'partial' | 'paid'
  status: PurchaseStatus
  notes: string | null
  productNameMemo: string | null
}

export interface PurchasePatchInput {
  purchaseId: string
  operationId: string
  expectedUpdatedAt: string
  patch: RpcPatch
}

export interface PurchaseDeleteInput {
  purchaseId: string
  operationId: string
  expectedUpdatedAt: string
}

export interface PurchaseMutationRpcData {
  purchase: Record<string, unknown> | null
  mutation: {
    operationId: string
    applied: boolean
    replayed: boolean
    action: 'patch' | 'delete'
    previousStatus: string
    status: string | null
    inventoryEffect: 'none' | 'inbound' | 'reversal'
    movementIds: string[]
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value)
}

function isDate(value: unknown): value is string {
  if (typeof value !== 'string' || !DATE_RE.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

function isTimestamp(value: unknown): value is string {
  return typeof value === 'string' && value.includes('T') && Number.isFinite(Date.parse(value))
}

function optionalText(value: unknown, maxLength: number): string | null | undefined {
  if (value === undefined) return undefined
  if (value === null) return null
  if (typeof value !== 'string') return undefined
  const normalized = value.trim()
  if (normalized.length > maxLength) return undefined
  return normalized || null
}

function numeric(value: unknown, min: number, max: number): number | undefined {
  if (typeof value !== 'number' && typeof value !== 'string') return undefined
  if (typeof value === 'string' && value.trim() === '') return undefined
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) return undefined
  return parsed
}

function integer(value: unknown, min: number, max: number): number | undefined {
  const parsed = numeric(value, min, max)
  return parsed !== undefined && Number.isInteger(parsed) ? parsed : undefined
}

function readUuid(value: unknown, nullable: boolean): string | null | undefined {
  if (nullable && (value === undefined || value === null || value === '')) return null
  return isUuid(value) ? value : undefined
}

function readDate(value: unknown, nullable: boolean): string | null | undefined {
  if (nullable && (value === undefined || value === null || value === '')) return null
  return isDate(value) ? value : undefined
}

function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key)
}

export function parsePurchaseCreateRequest(body: unknown): ParseResult<PurchaseCreateInput> {
  if (!isRecord(body)) return { ok: false, error: '요청 본문은 객체여야 합니다.' }

  const productId = readUuid(body.productId, true)
  const supplierId = readUuid(body.supplierId, true)
  const productNameMemo = body.productNameMemo === undefined ? null : optionalText(body.productNameMemo, 500)
  const poNumber = body.poNumber === undefined ? null : optionalText(body.poNumber, 100)
  const notes = body.notes === undefined ? null : optionalText(body.notes, 2000)
  const orderDate = readDate(body.orderDate, false)
  const arrivalDate = readDate(body.arrivalDate, true)
  const expectedArrivalDate = readDate(body.expectedArrivalDate, true)
  const leadTimeWeeks = body.leadTimeWeeks === undefined || body.leadTimeWeeks === null || body.leadTimeWeeks === ''
    ? null
    : integer(body.leadTimeWeeks, 0, 520)
  const quantity = integer(body.quantity, 1, 2147483647)
  const unitPrice = numeric(body.unitPrice ?? 0, 0, 9999999999.99)
  const exchangeRate = numeric(body.exchangeRate ?? 1, 0.0001, 999999.9999)
  const currency = typeof body.currency === 'string' ? body.currency : 'CNY'
  const status = typeof body.status === 'string' ? body.status : 'ordered'
  const payment1Status = typeof body.payment1Status === 'string' ? body.payment1Status : 'unpaid'
  const payment2Status = typeof body.payment2Status === 'string' ? body.payment2Status : 'unpaid'
  const payment3Status = typeof body.payment3Status === 'string' ? body.payment3Status : 'unpaid'
  const paymentStatus = typeof body.paymentStatus === 'string' ? body.paymentStatus : 'unpaid'

  if (productId === undefined || supplierId === undefined) return { ok: false, error: '상품 또는 공급처 ID가 올바르지 않습니다.' }
  if (!productId && !productNameMemo) return { ok: false, error: '상품을 선택하거나 상품명 메모를 입력해 주세요.' }
  if (productNameMemo === undefined || poNumber === undefined || notes === undefined) return { ok: false, error: '텍스트 입력값이 올바르지 않습니다.' }
  if (!orderDate || arrivalDate === undefined || expectedArrivalDate === undefined) return { ok: false, error: '날짜 입력값이 올바르지 않습니다.' }
  if (leadTimeWeeks === undefined || quantity === undefined || unitPrice === undefined || exchangeRate === undefined) {
    return { ok: false, error: '수량·단가·환율 입력값이 올바르지 않습니다.' }
  }
  if (!CURRENCIES.has(currency)) return { ok: false, error: '지원하지 않는 통화입니다.' }
  if (!(status in PURCHASE_STATUSES)) return { ok: false, error: '매입 상태가 올바르지 않습니다.' }
  if (!PAYMENT_STAGE_STATUSES.has(payment1Status as PaymentStageStatus)
      || !PAYMENT_STAGE_STATUSES.has(payment2Status as PaymentStageStatus)
      || !PAYMENT_STAGE_STATUSES.has(payment3Status as PaymentStageStatus)
      || !PAYMENT_STATUSES.has(paymentStatus)) {
    return { ok: false, error: '결제 상태가 올바르지 않습니다.' }
  }

  const costKeys = [
    'shippingCost', 'payment1Vat', 'inspectionFee', 'labelingFee', 'packagingFee',
    'customsDocFee', 'agencyFee', 'payment2Vat', 'domesticShipping', 'customsDuty', 'customsVat',
  ] as const
  const costs: Record<(typeof costKeys)[number], number> = {} as Record<(typeof costKeys)[number], number>
  for (const key of costKeys) {
    const parsed = numeric(body[key] ?? 0, 0, 9999999999.99)
    if (parsed === undefined) return { ok: false, error: '비용 입력값은 0 이상의 숫자여야 합니다.' }
    costs[key] = parsed
  }

  return {
    ok: true,
    value: {
      productId,
      supplierId,
      productNameMemo,
      poNumber,
      notes,
      orderDate,
      arrivalDate,
      expectedArrivalDate,
      leadTimeWeeks,
      quantity,
      unitPrice,
      exchangeRate,
      currency: currency as PurchaseCreateInput['currency'],
      status: status as PurchaseStatus,
      payment1Status: payment1Status as PaymentStageStatus,
      payment2Status: payment2Status as PaymentStageStatus,
      payment3Status: payment3Status as PaymentStageStatus,
      paymentStatus: paymentStatus as PurchaseCreateInput['paymentStatus'],
      ...costs,
    },
  }
}

function parsePatchField(key: PatchField, value: unknown): string | number | null | undefined {
  if (key === 'productId' || key === 'supplierId') return readUuid(value, true)
  if (key === 'orderDate') return readDate(value, false)
  if (key === 'arrivalDate' || key === 'expectedArrivalDate') return readDate(value, true)
  if (key === 'poNumber') return optionalText(value, 100)
  if (key === 'notes') return optionalText(value, 2000)
  if (key === 'productNameMemo') return optionalText(value, 500)
  if (key === 'quantity') return integer(value, 1, 2147483647)
  if (key === 'leadTimeWeeks') {
    if (value === null || value === '') return null
    return integer(value, 0, 520)
  }
  if (key === 'exchangeRate') return numeric(value, 0.0001, 999999.9999)
  if (key === 'unitPrice' || [
    'shippingCost', 'payment1Vat', 'inspectionFee', 'labelingFee', 'packagingFee',
    'customsDocFee', 'agencyFee', 'payment2Vat', 'domesticShipping', 'customsDuty', 'customsVat',
  ].includes(key)) return numeric(value, 0, 9999999999.99)
  if (key === 'currency') return typeof value === 'string' && CURRENCIES.has(value) ? value : undefined
  if (key === 'status') return typeof value === 'string' && value in PURCHASE_STATUSES ? value : undefined
  if (key === 'payment1Status' || key === 'payment2Status' || key === 'payment3Status') {
    return typeof value === 'string' && PAYMENT_STAGE_STATUSES.has(value as PaymentStageStatus) ? value : undefined
  }
  if (key === 'paymentStatus') return typeof value === 'string' && PAYMENT_STATUSES.has(value) ? value : undefined
  return undefined
}

export function parsePurchasePatchRequest(body: unknown): ParseResult<PurchasePatchInput> {
  if (!isRecord(body)) return { ok: false, error: '요청 본문은 객체여야 합니다.' }
  if (!isUuid(body.id)) return { ok: false, error: '올바른 매입 ID가 필요합니다.' }
  if (!isUuid(body.operationId)) return { ok: false, error: '올바른 operationId가 필요합니다.' }
  if (!isTimestamp(body.expectedUpdatedAt)) return { ok: false, error: 'expectedUpdatedAt 버전이 필요합니다.' }

  const allowedKeys = new Set(['id', 'operationId', 'expectedUpdatedAt', ...Object.keys(PATCH_FIELDS)])
  const unknownKey = Object.keys(body).find(key => !allowedKeys.has(key))
  if (unknownKey) return { ok: false, error: `수정할 수 없는 필드입니다: ${unknownKey}` }

  const patch: RpcPatch = {}
  for (const [clientKey, rpcKey] of Object.entries(PATCH_FIELDS) as [PatchField, string][]) {
    if (!hasOwn(body, clientKey)) continue
    const value = parsePatchField(clientKey, body[clientKey])
    if (value === undefined) return { ok: false, error: `${clientKey} 값이 올바르지 않습니다.` }
    patch[rpcKey] = value
  }
  if (Object.keys(patch).length === 0) return { ok: false, error: '수정할 필드가 없습니다.' }

  return {
    ok: true,
    value: {
      purchaseId: body.id,
      operationId: body.operationId,
      expectedUpdatedAt: body.expectedUpdatedAt,
      patch,
    },
  }
}

export function parsePurchaseDeleteRequest(searchParams: URLSearchParams): ParseResult<PurchaseDeleteInput> {
  const purchaseId = searchParams.get('id')
  const operationId = searchParams.get('operationId')
  const expectedUpdatedAt = searchParams.get('expectedUpdatedAt')
  if (!isUuid(purchaseId)) return { ok: false, error: '올바른 매입 ID가 필요합니다.' }
  if (!isUuid(operationId)) return { ok: false, error: '올바른 operationId가 필요합니다.' }
  if (!isTimestamp(expectedUpdatedAt)) return { ok: false, error: 'expectedUpdatedAt 버전이 필요합니다.' }
  return { ok: true, value: { purchaseId, operationId, expectedUpdatedAt } }
}

export function isPurchaseMutationRpcData(data: unknown): data is PurchaseMutationRpcData {
  if (!isRecord(data) || !isRecord(data.mutation)) return false
  const mutation = data.mutation
  return (
    isUuid(mutation.operationId) &&
    typeof mutation.applied === 'boolean' &&
    typeof mutation.replayed === 'boolean' &&
    (mutation.action === 'patch' || mutation.action === 'delete') &&
    typeof mutation.previousStatus === 'string' &&
    (typeof mutation.status === 'string' || mutation.status === null) &&
    (mutation.inventoryEffect === 'none' || mutation.inventoryEffect === 'inbound' || mutation.inventoryEffect === 'reversal') &&
    Array.isArray(mutation.movementIds) && mutation.movementIds.every(isUuid) &&
    (isRecord(data.purchase) || data.purchase === null)
  )
}
