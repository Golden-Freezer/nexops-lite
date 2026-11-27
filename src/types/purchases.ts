// 매입/발주 + 지출 타입

// 매입 상태 8단계
export const PURCHASE_STATUSES = {
  ordered: '발주',
  paid_1688: '구매결제',
  collecting: '집하중',
  processing: '검수/작업',
  shipped: '국제배송',
  customs: '통관중',
  domestic: '국내배송',
  arrived: '입고완료',
  cancelled: '취소',
} as const

export type PurchaseStatus = keyof typeof PURCHASE_STATUSES

export const PURCHASE_STATUS_COLORS: Record<PurchaseStatus, string> = {
  ordered: 'bg-slate-100 text-slate-700',
  paid_1688: 'bg-blue-100 text-blue-700',
  collecting: 'bg-cyan-100 text-cyan-700',
  processing: 'bg-teal-100 text-teal-700',
  shipped: 'bg-indigo-100 text-indigo-700',
  customs: 'bg-purple-100 text-purple-700',
  domestic: 'bg-amber-100 text-amber-700',
  arrived: 'bg-green-100 text-green-700',
  cancelled: 'bg-red-100 text-red-700',
}

// 결제 단계
export type PaymentStageStatus = 'unpaid' | 'paid' | 'none'

export const PAYMENT_STAGE_LABELS = {
  unpaid: '미결제',
  paid: '결제완료',
  none: '해당없음',
} as const

export interface Purchase {
  id: string
  userId: string
  businessId: string | null
  supplierId: string | null
  supplierName?: string
  productId: string | null
  productName?: string
  productOptionName?: string
  poNumber: string | null
  orderDate: string
  arrivalDate: string | null
  expectedArrivalDate: string | null
  leadTimeWeeks: number | null
  quantity: number
  unitPrice: number
  currency: string
  exchangeRate: number
  // 1차 결제 (1688 구매대행)
  shippingCost: number
  payment1ProductKrw: number
  payment1Vat: number
  payment1Total: number
  payment1Date: string | null
  payment1Status: PaymentStageStatus
  // 2차 결제 (작업비용+통관서류)
  inspectionFee: number
  labelingFee: number
  packagingFee: number
  customsDocFee: number
  agencyFee: number
  payment2Total: number
  payment2Date: string | null
  payment2Status: PaymentStageStatus
  // 3차 결제 (관부가세+입고)
  domesticShipping: number
  customsDuty: number
  customsVat: number
  payment3Total: number
  payment3Date: string | null
  payment3Status: PaymentStageStatus
  // 집계
  additionalCost: number
  unitCostKrw: number | null
  totalAmountKrw: number
  // 레거시 (호환)
  paymentStatus: 'unpaid' | 'partial' | 'paid'
  paymentDate: string | null
  status: PurchaseStatus
  notes: string | null
  productNameMemo: string | null
  createdAt: string
  updatedAt: string
}

export interface PurchaseMutationMeta {
  operationId: string
  applied: boolean
  replayed: boolean
  action: 'patch' | 'delete'
  previousStatus: PurchaseStatus
  status: PurchaseStatus | null
  inventoryEffect: 'none' | 'inbound' | 'reversal'
  movementIds: string[]
}

export interface PurchaseMutationResult {
  data: Record<string, unknown> | null
  mutation: PurchaseMutationMeta | null
  recovered?: boolean
}

export interface PurchaseMutationOptions {
  expectedUpdatedAt: string
  operationId?: string
}

export interface PurchaseForm {
  supplierId?: string
  productId?: string
  poNumber?: string
  orderDate: string
  arrivalDate?: string
  expectedArrivalDate?: string
  leadTimeWeeks?: number
  quantity: number
  unitPrice: number
  currency?: string
  exchangeRate?: number
  // 1차
  shippingCost?: number
  payment1Vat?: number
  payment1Status?: string
  // 2차
  inspectionFee?: number
  labelingFee?: number
  packagingFee?: number
  customsDocFee?: number
  agencyFee?: number
  payment2Vat?: number
  payment2Status?: string
  // 3차
  domesticShipping?: number
  customsDuty?: number
  customsVat?: number
  payment3Status?: string
  // 기타
  status?: string
  notes?: string
  productNameMemo?: string
}

/** unit_cost_krw 자동 계산: 전체 비용 합산 / 수량 */
export function calcUnitCostKrw(form: {
  unitPrice: number
  exchangeRate: number
  shippingCost: number
  payment1Vat?: number
  // 2차
  inspectionFee?: number
  labelingFee?: number
  packagingFee?: number
  customsDocFee?: number
  payment2Vat?: number
  agencyFee?: number
  // 3차
  domesticShipping: number
  customsDuty?: number
  customsVat?: number
  // 레거시 호환
  additionalCost?: number
  quantity: number
}): number {
  if (form.quantity <= 0) return 0
  // 구매대행수수료는 CNY 건당 고정비 → 환율 적용 후 수량으로 배분
  const agencyFeeKrw = (form.agencyFee || 0) * form.exchangeRate
  const productCostPerUnit = form.unitPrice * form.exchangeRate
  const stage1Extra = (form.payment1Vat || 0)
  const stage2 = (form.shippingCost || 0) + (form.inspectionFee || 0) + (form.labelingFee || 0) +
    (form.packagingFee || 0) + (form.customsDocFee || 0) + (form.payment2Vat || 0) +
    (form.additionalCost || 0)
  const stage3 = form.domesticShipping + (form.customsDuty || 0) + (form.customsVat || 0)
  const sharedCostPerUnit = (agencyFeeKrw + stage1Extra + stage2 + stage3) / form.quantity
  return Math.round((productCostPerUnit + sharedCostPerUnit) * 100) / 100
}

export interface Expense {
  id: string
  userId: string
  expenseDate: string
  category: string
  description: string | null
  amount: number
  vatAmount: number
  paymentMethod: string
  vendorId: string | null
  receiptUrl: string | null
  notes: string | null
  createdAt: string
}

export interface ExpenseForm {
  expenseDate: string
  category: string
  description?: string
  /** 공급가액. 손익 차감은 VAT를 제외한 이 값만 사용한다. */
  amount: number
  vatAmount?: number
  paymentMethod?: string
  vendorId?: string | null
  notes?: string
}

export interface ExpenseVendor {
  id: string
  user_id: string
  business_id: string | null
  name: string
  business_number: string | null
  contact: string | null
  default_category: string | null
  default_payment_method: string | null
  is_active: boolean
  notes: string | null
  created_at: string
  updated_at: string
}

export interface ExpenseVendorForm {
  name: string
  businessNumber?: string
  contact?: string
  defaultCategory?: string
  defaultPaymentMethod?: string
  notes?: string
  isActive?: boolean
}

export const EXPENSE_CATEGORIES = [
  '포장재',
  '물류비',
  '사무용품',
  '외주용역비',
  '통신비',
  '임차료',
  '샘플비',
  '마케팅',
  '기타',
] as const

export const EXPENSE_PAYMENT_METHODS = [
  { value: 'card', label: '카드' },
  { value: 'transfer', label: '계좌이체' },
  { value: 'cash', label: '현금' },
  { value: 'coupang_deduction', label: '쿠팡 정산 차감' },
] as const

export const EXPENSE_PAYMENT_METHOD_LABELS: Record<string, string> =
  Object.fromEntries(EXPENSE_PAYMENT_METHODS.map((method) => [method.value, method.label]))
