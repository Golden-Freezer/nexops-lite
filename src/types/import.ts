// 엑셀 임포트 관련 타입

export type ImportType =
  | 'sales'
  | 'inventory_health'
  | 'ad_billing'
  | 'ad_report'
  | 'ledger'
  | 'product'
  | 'purchase'

export interface ImportBatch {
  id: string
  userId: string
  importType: ImportType
  fileName: string
  fileSize: number | null
  rowCount: number
  successCount: number
  errorCount: number
  status: 'pending' | 'processing' | 'completed' | 'failed'
  errorMessage: string | null
  summary: Record<string, unknown>
  createdAt: string
  completedAt: string | null
}

export interface ImportResult {
  batchId: string
  totalRows: number
  successCount: number
  errorCount: number
  skippedCount: number
  errors: ImportError[]
  skippedReasons?: Record<string, number>
  mergedCount?: number
  fallbackApplied?: {
    unitCost: number
    fulfillmentFee: number
    fulfillmentFeeMissingDefault: number
  }
  unmatchedOptions?: number
  // product 임포트 전용: 신규/업데이트 구분 + 무시 안내
  insertedCount?: number
  updatedCount?: number
  invalidStatusCount?: number // 허용값 외 판매상태 → 필드 무시
  ignoredColumns?: string[] // 파일에 있었지만 매핑되지 않아 무시된 컬럼
  focusProductCount?: number
  campaignCount?: number
  warnings?: string[]
}

export interface ImportError {
  row: number
  field?: string
  message: string
  value?: unknown
}

export interface ParsedRow {
  rowIndex: number
  data: Record<string, unknown>
  errors: ImportError[]
  isValid: boolean
  skipReason?: string
}

export interface ImportConfig {
  type: ImportType
  headerRow: number
  skipDataRows?: number // 헤더 이후 스킵할 데이터 행 수 (2행 헤더 등)
  requiredColumns: string[]
  columnMapping: Record<string, string>
  // true면 정확 매칭(+공백 제거 정확 매칭)만 사용, 부분 매칭(includes) 금지
  // product 타입: '원가(이동평균)'→'원가' 같은 오매핑 방지 (products-io 스킬 §3)
  strictMatch?: boolean
}

export const IMPORT_CONFIGS: Record<ImportType, ImportConfig> = {
  sales: {
    type: 'sales',
    headerRow: 0,
    requiredColumns: [], // Statistics 파일은 날짜 컬럼 없음 → 파일명에서 추출
    columnMapping: {
      // ── 쿠팡윙 Statistics 파일 실제 컬럼명 ──
      '노출상품ID': 'coupang_product_id',
      '옵션ID': 'option_id',
      '옵션명': 'option_name',
      '상품타입': 'product_type',
      '카테고리': 'category',
      '아이템위너 비율(%)': 'item_winner_rate',
      '순 판매 금액(전체 거래 금액 - 취소 금액)': 'total_amount',
      '순 판매 상품 수(전체 거래 상품 수 - 취소 상품 수)': 'order_quantity',
      '전체 거래 금액': 'gross_amount',
      '전체 거래 상품 수': 'gross_quantity',
      '총 취소 금액': 'cancel_amount',
      '총 취소 상품 수': 'cancel_quantity',
      '즉시 취소 상품 수': 'instant_cancel_quantity',
      // ── 장부 파일 호환 (fallback) ──
      '날짜': 'order_date',
      '순 판매 금액': 'total_amount',
      '순 판매 상품 수': 'order_quantity',
      '즉시할인쿠폰': 'coupon_discount',
      '판매수수료 %': 'commission_rate',
      '판매수수료': 'commission_fee',
      '판매수수료VAT': 'commission_vat',
      '정산대상액': 'settlement_amount',
      '입출고배송 요금': 'fulfillment_fee',
      '입출고배송 요금VAT': 'fulfillment_vat',
      '지급액': 'payout_amount',
      '원가': 'unit_cost',
      '부가세': 'vat',
      '마진액': 'margin',
      '순매출액': 'total_amount',
      '판매단가': 'selling_price',
      '주문수량': 'order_quantity',
    },
  },
  inventory_health: {
    type: 'inventory_health',
    headerRow: 0,
    skipDataRows: 1, // 2행 헤더: 행1=카테고리, 행2=세부 (지난 7일/30일 등)
    requiredColumns: ['SKU ID'],
    columnMapping: {
      // ── 쿠팡윙 inventory_health_sku_info 실제 컬럼명 ──
      'SKU ID': 'sku',
      '등록상품 ID': 'coupang_product_id',
      '옵션 ID': 'option_id',
      '등록상품명': 'product_name',
      '옵션명': 'option_name',
      '상품등급': 'health_grade',
      '판매가능재고 (실시간 기준)': 'coupang_stock',
      '이번달 누적보관료(전일자 기준)': 'storage_fee_monthly',
      '재고예상\n소진일': 'depletion_date',
      '추가입고\n추천수량': 'reorder_quantity',
      '아이템위너': 'item_winner',
    },
  },
  ad_billing: {
    type: 'ad_billing',
    headerRow: 0,
    requiredColumns: ['날짜'],
    columnMapping: {
      // ── 쿠팡윙 dailySettlement 실제 컬럼명 ──
      '날짜': 'ad_date',
      '배송유형': 'delivery_type',
      '광고 유형': 'ad_type',
      '광고 목표': 'ad_goal',
      '캠페인 ID': 'campaign_id',
      '캠페인명': 'campaign_name',
      '소진 광고비': 'spent_amount',
      '청구 가능 광고비': 'billable_amount',
      '부가가치세': 'vat_amount',
      '청구금액(+부가가치세)': 'billable_amount_with_vat',
      '조정 후 소진 광고비': 'adjusted_spent_amount',
      // ── 장부 파일 호환 (fallback) ──
      '정산일': 'ad_date',
      '캠페인ID': 'campaign_id',
      '광고유형': 'ad_type',
      '소진금액(VAT별도)': 'spent_amount',
      '청구금액(VAT포함)': 'billable_amount_with_vat',
      'VAT': 'vat_amount',
      '노출수': 'impressions',
      '클릭수': 'clicks',
      '전환수': 'conversions',
    },
  },
  ad_report: {
    type: 'ad_report',
    headerRow: 0,
    requiredColumns: ['캠페인 ID', '광고집행 옵션ID'],
    columnMapping: {
      '캠페인 ID': 'campaign_id',
      '캠페인명': 'campaign_name',
      '광고집행 상품명': 'advertised_product_name',
      '광고집행 옵션ID': 'advertised_option_id',
      '날짜': 'metric_date',
      '일자': 'metric_date',
      '노출수': 'impressions',
      '클릭수': 'clicks',
      '광고비': 'delivered_ad_cost',
      '총 주문수(1일)': 'ad_attributed_orders',
      '총 판매수량(1일)': 'ad_attributed_units',
      '총 전환매출액(1일)': 'ad_attributed_sales',
      '캠페인 시작일': 'campaign_start_date',
      '캠페인 종료일': 'campaign_end_date',
    },
  },
  purchase: {
    type: 'purchase',
    headerRow: 0,
    requiredColumns: ['상품명'],
    columnMapping: {
      '주문일': 'order_date',
      '구입처': 'supplier_name',
      '바코드': 'barcode',
      '상품명': 'product_name_memo',
      '주문수량': 'quantity',
      '구매단가': 'unit_price',
      '배송비': 'shipping_cost_cny',
      '총금액': 'total_cny',
      '환율': 'exchange_rate',
      '구입금액': 'purchase_amount_krw',
      '구입금액VAT': 'purchase_vat',
      '총 구입금액': 'total_purchase_krw',
      '입고비': 'domestic_shipping',
      '입고비VAT': 'domestic_shipping_vat',
      '총 입고비': 'total_domestic',
      '총비용': 'total_cost',
      '개당원가': 'unit_cost_krw',
      // 예정일은 실제 입고가 아니므로 재고를 가산하는 arrival_date와 분리한다.
      '입고예정일': 'expected_arrival_date',
      '실입고일': 'arrival_date',
      '실제입고일': 'arrival_date',
      '입고소요주': 'lead_time_weeks',
    },
  },
  ledger: {
    type: 'ledger',
    headerRow: 0,
    requiredColumns: [],
    columnMapping: {},
  },
  product: {
    type: 'product',
    headerRow: 0,
    strictMatch: true,
    requiredColumns: ['옵션 ID'],
    columnMapping: {
      // ── NexOps 등록 템플릿 (라운드트립 SSOT — excel.ts PRODUCT_TEMPLATE_COLUMNS 헤더와 1:1 일치) ──
      '옵션 ID': 'coupang_option_id',
      '바코드': 'barcode',
      '업체상품 ID': 'coupang_product_id',
      '노출 ID': 'coupang_exposure_id',
      '업체상품코드(SKU)': 'sku',
      '쿠팡 노출 상품명': 'coupang_display_name',
      '업체 등록 상품명': 'product_name',
      '등록 옵션명': 'option_name',
      // 판매가격(숫자) → condition_value: 상품관리의 '판매가'는 condition_value를 숫자로 사용한다
      '판매가격': 'condition_value',
      '판매수수료(%)': 'commission_rate',
      '입출고배송비': 'fulfillment_fee_default',
      '원가(기본)': 'unit_cost_default',
      '판매자할인쿠폰': 'seller_discount_coupon',
      '판매상태': 'sales_status_raw',
      // ── 그로스 판매장부 01.상품 시트 하위 호환 ──
      'Product ID(노출ID)': 'coupang_exposure_id',
      '업체상품코드': 'sku',
      '판매수수료': 'commission_rate',
      '원가': 'unit_cost_default',
      // '조건값'(노출상품명+옵션 중복 텍스트)은 미사용 → 임포트 제외 (condition_value 덮어쓰기 방지)
      // 자동계산 항목(재고수량·입고소요기간주·평균원가·주평균판매수량·재고주차·구매필요수량·상품상태)은
      // 매핑하지 않고 무시한다 — 재고 SSOT는 재고건강 임포트, 리드타임은 매입 이력 자동계산 (2026-07-05 CEO 결정)
    },
  },
}

// product 임포트에서 의도적으로 무시하는 자동계산 컬럼 (결과 안내 메시지 구분용)
export const PRODUCT_AUTO_CALC_COLUMNS = [
  '재고수량', '재고', '입고소요기간주', '입고소요기간(주)', '리드타임(주)',
  '평균원가', '원가(이동평균)', '주평균판매수량', '주평균판매', '재고주차', '구매필요수량', '구매필요',
  '상품상태', '마진', '예상마진', '마진율', '최소ROAS', '매입횟수', '등급', '재고상태', 'SEQ',
]
