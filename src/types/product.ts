// 상품 관련 타입 정의

/** 상품 리스트 아이템 (Excel '01.상품' 시트 전체 매핑) */
export interface ProductListItem {
  id: string
  seq: number | null
  keyword: string
  productName: string | null
  sku: string | null
  status: string
  // 쿠팡 식별자 (사용자 입력)
  barcode: string | null
  coupangProductId: string | null
  coupangDisplayName: string | null
  vendorProductId: string | null
  coupangOptionId: string | null
  optionName: string | null
  conditionValue: string | null
  returnResaleInfo: string | null
  coupangExposureId: string | null
  // 비용 (사용자 입력)
  commissionRate: number | null
  fulfillmentFeeDefault: number | null
  unitCostDefault: number | null
  sellerDiscountCoupon: number | null
  leadTimeWeeks: number | null
  // 계산 필드 (서버 산출)
  commissionAmount: number | null
  stockQuantity: number | null
  weeklyAvgSales: number | null
  inventoryWeeks: number | null
  purchaseRequired: number | null
  inventoryStatus: '재고부족' | '재고과잉' | '-'
  // 이동평균 원가 (inventory_state SSOT)
  avgCostKrw: number | null
  // 매입 이력 요약
  purchaseCount: number
  totalPurchaseQty: number
  // 예상마진 (공급가액 기준, VAT 제외)
  estimatedMargin: number | null
  estimatedMarginRate: number | null
}

/** 소싱 리스트 아이템 (products + product_costs + suppliers JOIN) */
export interface SourcingListItem {
  id: string
  seq: number | null
  sku: string | null
  keyword: string
  productName: string | null
  categoryPath: string | null
  purpose: 'sourcing' | 'product'
  unitCost: number
  sellingPrice: number
  marginRate: number
  margin: number
  minRoas: number | null
  supplierName: string | null
  supplierUrl: string | null
  negotiatedPrice: number | null
  shippingFee: number | null
  fulfillmentFee: number | null
  commissionRate: number | null
  sourceType: '1688' | '국내' | '기타' | null
  status: 'active' | 'inactive' | 'draft' | 'archived'
  updatedAt: string
  /** 크롬 확장이 수집한 keyword_rankings 데이터가 있는지 여부 */
  hasRankingData: boolean
}

/** 소싱 리스트 필터 */
export interface SourcingFilter {
  marginRateMin?: number
  marginRateMax?: number
  sourceType?: '1688' | '국내' | '기타' | null
  status?: string
  search?: string
}

/** 상품 폼 입력 */
/** SKU 옵션 항목 (컬러/사이즈 등 옵션별 SKU) */
export interface SkuOption {
  sku: string
  label: string // 예: "블랙 M", "화이트 L"
}

export interface ProductFormData {
  keyword: string
  productName: string
  categoryPath: string
  commissionRate: number
  saleType: '로켓그로스' | '판매자배송'
  status: 'active' | 'inactive' | 'draft' | 'archived'
  searchTags: string[]
  coupangProductUrl: string
  notes: string
  sku?: string
  skuOptions?: SkuOption[]
  purpose?: 'sourcing' | 'product'
  // Excel '01.상품' 시트 신규 필드
  barcode?: string
  coupangProductId?: string
  coupangDisplayName?: string
  vendorProductId?: string
  coupangOptionId?: string
  optionName?: string
  conditionValue?: string
  returnResaleInfo?: string
  coupangExposureId?: string
  fulfillmentFeeDefault?: number | null
  unitCostDefault?: number | null
  sellerDiscountCoupon?: number | null
  leadTimeWeeks?: number | null
}

/** 원가 히스토리 항목 */
export interface CostHistoryItem {
  id: string
  supplierId: string | null
  supplierName: string | null
  unitCost: number
  sellingPrice: number
  fulfillmentFee: number
  commissionRate: number
  margin: number
  marginRate: number
  minRoas: number
  returnRate: number
  createdAt: string
}
