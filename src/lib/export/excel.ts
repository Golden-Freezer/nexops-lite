import * as XLSX from 'xlsx'

export interface ExportColumn {
  key: string
  header: string
  width?: number
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  format?: (value: any, row: any) => string | number
}

export type ExportFormat = 'xlsx' | 'csv'

export function buildExportMatrix(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any[],
  columns: ExportColumn[]
): Array<Array<string | number>> {
  const headers = columns.map((column) => column.header)
  const rows = data.map((row) =>
    columns.map((column) => {
      const value = getNestedValue(row, column.key)
      const formatted = column.format ? column.format(value, row) : (value ?? '')
      return typeof formatted === 'number' ? formatted : String(formatted)
    })
  )
  return [headers, ...rows]
}

function csvCell(value: string | number): string {
  const text = String(value)
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

/** Excel 한글 호환을 위해 UTF-8 BOM을 포함한 RFC 4180 CSV 문자열을 만든다. */
export function buildCsvContent(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any[],
  columns: ExportColumn[]
): string {
  return `\uFEFF${buildExportMatrix(data, columns)
    .map((row) => row.map(csvCell).join(','))
    .join('\r\n')}`
}

/**
 * 데이터를 Excel 파일로 다운로드
 */
export function exportToExcel(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any[],
  columns: ExportColumn[],
  filename: string,
  sheetName = 'Sheet1'
) {
  const ws = XLSX.utils.aoa_to_sheet(buildExportMatrix(data, columns))

  // 컬럼 너비 설정
  ws['!cols'] = columns.map((c) => ({ wch: c.width || 15 }))

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, sheetName)

  const today = new Date().toISOString().split('T')[0].replace(/-/g, '')
  XLSX.writeFile(wb, `${filename}_${today}.xlsx`)
}

export function exportToCsv(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any[],
  columns: ExportColumn[],
  filename: string
) {
  const blob = new Blob([buildCsvContent(data, columns)], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `${filename}_${new Date().toISOString().slice(0, 10).replace(/-/g, '')}.csv`
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

export function exportData(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any[],
  columns: ExportColumn[],
  filename: string,
  sheetName: string,
  format: ExportFormat
) {
  if (format === 'csv') exportToCsv(data, columns, filename)
  else exportToExcel(data, columns, filename, sheetName)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getNestedValue(obj: any, path: string): any {
  return path.split('.').reduce((o, k) => o?.[k], obj)
}

// ── 페이지별 export 설정 ──

// 상품관리 판매상태 코드 ↔ 한글 라벨 (products-io 스킬 §4와 동일)
export const PRODUCT_SALES_STATUS_LABELS: Record<string, string> = {
  active: '판매중',
  paused: '중지',
  soldout: '품절',
  preparing: '준비중',
  discontinued: '종료',
}

/**
 * 상품관리 리포트 다운로드 — 화면 테이블과 동일한 컬럼·순서
 * 자동계산 컬럼을 포함한 리포트 전용이며 재임포트 소스가 아님 (등록/수정은 exportProductTemplate 사용)
 */
export const PRODUCT_EXPORT_COLUMNS: ExportColumn[] = [
  { key: 'seq', header: 'SEQ', width: 6 },
  { key: 'barcode', header: '바코드', width: 15 },
  { key: 'coupangProductId', header: '등록ID', width: 15 },
  { key: 'coupangExposureId', header: '노출ID', width: 15 },
  { key: 'coupangOptionId', header: '옵션ID', width: 15 },
  { key: 'coupangDisplayName', header: '상품명', width: 40 },
  { key: 'optionName', header: '옵션명', width: 25 },
  { key: 'productGrade', header: '등급', width: 8, format: (v) => v && String(v).includes('반품') ? String(v) : 'NEW' },
  { key: 'salesStatus', header: '판매상태', width: 10, format: (v) => PRODUCT_SALES_STATUS_LABELS[v as string] || '판매중' },
  { key: 'conditionValue', header: '판매가', width: 12, format: (v) => v != null ? Number(v) : '' },
  { key: 'sellerDiscountCoupon', header: '쿠폰', width: 10 },
  { key: 'commissionRate', header: '수수료%', width: 10, format: (v) => v != null ? `${(v * 100).toFixed(1)}%` : '' },
  { key: 'fulfillmentFeeDefault', header: '입출고비', width: 10 },
  { key: 'avgCostKrw', header: '원가(이동평균)', width: 14, format: (v, row) => v ?? row.unitCostDefault ?? '' },
  { key: 'estimatedMargin', header: '마진', width: 12 },
  { key: 'estimatedMarginRate', header: '마진율', width: 10, format: (v) => v != null ? `${(v * 100).toFixed(1)}%` : '' },
  { key: 'minRoas', header: '최소ROAS', width: 10, format: (v) => v != null ? `${(v * 100).toFixed(0)}%` : '' },
  { key: 'inventoryStatus', header: '재고상태', width: 10, format: (v) => v === '재고부족' ? '발주필요' : v === '재고과잉' ? '과잉' : '정상' },
  { key: 'stockQuantity', header: '재고', width: 8 },
  { key: 'weeklyAvgSales', header: '주평균판매', width: 10 },
  { key: 'inventoryWeeks', header: '재고주차', width: 10 },
  { key: 'leadTimeWeeks', header: '리드타임(주)', width: 10 },
  { key: 'purchaseRequired', header: '구매필요', width: 10 },
  { key: 'purchaseCount', header: '매입횟수', width: 10 },
]

/**
 * 상품 등록/수정 템플릿 컬럼 — 사용자 입력 필드 14개만
 * ★ 라운드트립 불변식: header는 IMPORT_CONFIGS.product.columnMapping의 키와 문자 단위로 정확 일치해야 한다
 *   (products-io 스킬 §2·§3, 검증: src/lib/import/product-roundtrip.test.ts)
 */
export const PRODUCT_TEMPLATE_COLUMNS: ExportColumn[] = [
  { key: 'coupangOptionId', header: '옵션 ID', width: 16 },
  { key: 'barcode', header: '바코드', width: 15 },
  { key: 'coupangProductId', header: '업체상품 ID', width: 15 },
  { key: 'coupangExposureId', header: '노출 ID', width: 15 },
  { key: 'sku', header: '업체상품코드(SKU)', width: 15 },
  { key: 'coupangDisplayName', header: '쿠팡 노출 상품명', width: 40 },
  { key: 'productName', header: '업체 등록 상품명', width: 30 },
  { key: 'optionName', header: '등록 옵션명', width: 25 },
  { key: 'conditionValue', header: '판매가격', width: 12, format: (v) => v != null ? Number(v) : '' },
  { key: 'commissionRate', header: '판매수수료(%)', width: 12, format: (v) => v != null ? Math.round(Number(v) * 1000) / 10 : '' },
  { key: 'fulfillmentFeeDefault', header: '입출고배송비', width: 12 },
  { key: 'unitCostDefault', header: '원가(기본)', width: 12 },
  { key: 'sellerDiscountCoupon', header: '판매자할인쿠폰', width: 14 },
  { key: 'salesStatus', header: '판매상태', width: 10, format: (v) => PRODUCT_SALES_STATUS_LABELS[v as string] || '' },
]

/**
 * 상품 등록/수정 템플릿 다운로드
 * @param products null = 빈 템플릿 (초기 대량 등록), 배열 = 현재값 채움 (일괄 수정)
 */
export function exportProductTemplate(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  products: any[] | null
) {
  const headers = PRODUCT_TEMPLATE_COLUMNS.map((c) => c.header)
  const rows = (products || []).map((row) =>
    PRODUCT_TEMPLATE_COLUMNS.map((col) => {
      const value = row[col.key]
      return col.format ? col.format(value, row) : (value ?? '')
    })
  )

  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows])
  ws['!cols'] = PRODUCT_TEMPLATE_COLUMNS.map((c) => ({ wch: c.width || 15 }))

  // 시트2: 작성가이드
  const guide: (string | number)[][] = [
    ['NexOps 상품 등록/수정 템플릿 작성 가이드'],
    [],
    ['1. "상품등록" 시트에 한 행 = 한 옵션(상품)으로 입력한 뒤, 상품관리 > 임포트에서 이 파일을 업로드하세요.'],
    ['2. 옵션 ID는 필수이며 상품 매칭 키입니다. 같은 옵션 ID가 이미 있으면 수정, 없으면 신규 등록됩니다.'],
    ['3. 수정 시 빈 칸은 "기존값 유지"로 처리됩니다. 값을 지우고 싶으면 상품관리 화면에서 개별 수정하세요.'],
    ['4. 아래 자동계산 항목은 입력할 필요가 없으며, 파일에 있어도 무시됩니다:'],
    ['   재고수량(→ 재고건강 임포트), 입고소요기간/리드타임(→ 매입 이력 자동계산), 원가(이동평균), 마진, 마진율, 재고주차, 구매필요수량 등'],
    [],
    ['컬럼', '필수', '형식/허용값', '예시'],
    ['옵션 ID', '필수', '쿠팡 옵션 ID (숫자)', '88571233591'],
    ['바코드', '선택', '텍스트', 'R012345678901'],
    ['업체상품 ID', '선택', '쿠팡 등록상품 ID', '7912345678'],
    ['노출 ID', '선택', '쿠팡 노출상품 ID', '8123456789'],
    ['업체상품코드(SKU)', '선택', '내부 관리 코드', 'HB-001'],
    ['쿠팡 노출 상품명', '선택', '텍스트', '페어넥스 접이식 양산 우산 겸용'],
    ['업체 등록 상품명', '선택', '텍스트', '접이식 양산'],
    ['등록 옵션명', '선택', '텍스트', '블랙 1개'],
    ['판매가격', '선택', '숫자 (원)', 15900],
    ['판매수수료(%)', '선택', '10.8 또는 0.108 모두 허용', 10.8],
    ['입출고배송비', '선택', '숫자 (원)', 1650],
    ['원가(기본)', '선택', '숫자 (원) — 이동평균 원가는 매입 데이터로 자동 계산', 4500],
    ['판매자할인쿠폰', '선택', '숫자 (원, 개당)', 1000],
    ['판매상태', '선택', '판매중 / 중지 / 품절 / 준비중 / 종료', '판매중'],
  ]
  const guideWs = XLSX.utils.aoa_to_sheet(guide)
  guideWs['!cols'] = [{ wch: 22 }, { wch: 6 }, { wch: 48 }, { wch: 30 }]

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, '상품등록')
  XLSX.utils.book_append_sheet(wb, guideWs, '작성가이드')

  const today = new Date().toISOString().split('T')[0].replace(/-/g, '')
  const mode = products && products.length > 0 ? '수정용' : '등록용'
  XLSX.writeFile(wb, `NexOps_상품템플릿_${mode}_${today}.xlsx`)
}

export const PURCHASE_EXPORT_COLUMNS: ExportColumn[] = [
  { key: 'order_date', header: '발주일', width: 12 },
  { key: 'products.product_name', header: '상품명', width: 30 },
  { key: 'products.option_name', header: '옵션명', width: 20 },
  { key: 'quantity', header: '수량', width: 8 },
  { key: 'unit_price', header: '위안단가', width: 12 },
  { key: 'exchange_rate', header: '환율', width: 8 },
  { key: 'unit_cost_krw', header: '원화실원가', width: 12 },
  { key: 'shipping_cost', header: '국제배송비', width: 12 },
  { key: 'additional_cost', header: '부대비용', width: 12 },
  { key: 'domestic_shipping', header: '국내배송비', width: 12 },
  { key: 'total_amount_krw', header: '총액(원)', width: 14 },
  { key: 'status', header: '상태', width: 10, format: (v) => ({ ordered: '발주', paid_1688: '구매결제', collecting: '집하중', processing: '검수/작업', shipped: '국제배송', customs: '통관중', domestic: '국내배송', arrived: '입고완료', cancelled: '취소' }[v as string] || v) },
  { key: 'payment_status', header: '결제', width: 10, format: (v) => ({ unpaid: '미결제', partial: '부분결제', paid: '결제완료' }[v as string] || v) },
  { key: 'po_number', header: '발주번호', width: 15 },
  { key: 'arrival_date', header: '입고일', width: 12 },
  { key: 'notes', header: '메모', width: 20 },
]

export const EXPENSE_EXPORT_COLUMNS: ExportColumn[] = [
  { key: 'expense_date', header: '지출일', width: 12 },
  { key: 'category', header: '카테고리', width: 12 },
  { key: 'description', header: '내용', width: 30 },
  { key: 'amount', header: '공급가액', width: 12 },
  { key: 'vat_amount', header: 'VAT', width: 10 },
  { key: 'payment_method', header: '결제수단', width: 14, format: (v) => ({ card: '카드', transfer: '계좌이체', cash: '현금', coupang_deduction: '쿠팡 정산 차감' }[v as string] || v) },
  { key: 'notes', header: '비고', width: 20 },
]

export const SALES_EXPORT_COLUMNS: ExportColumn[] = [
  { key: 'order_date', header: '날짜', width: 12 },
  { key: 'option_id', header: '옵션ID', width: 15 },
  { key: 'option_name', header: '옵션명', width: 35 },
  { key: 'order_quantity', header: '판매수량', width: 10 },
  { key: 'total_amount', header: '순매출액', width: 14 },
  { key: 'unit_cost', header: '원가', width: 10 },
  { key: 'commission_fee', header: '수수료', width: 10 },
  { key: 'fulfillment_fee', header: '입출고비', width: 10 },
  { key: 'margin', header: '마진', width: 12 },
  { key: 'gross_amount', header: '전체거래액', width: 14 },
  { key: 'cancel_amount', header: '취소액', width: 12 },
  { key: 'cancel_quantity', header: '취소수량', width: 10 },
  { key: 'status', header: '상태', width: 8 },
]

export const AD_EXPORT_COLUMNS: ExportColumn[] = [
  { key: 'ad_date', header: '날짜', width: 12 },
  { key: 'campaign_name', header: '캠페인명', width: 30 },
  { key: 'ad_type', header: '광고유형', width: 12 },
  { key: 'spent_amount', header: '소진금액', width: 12 },
  { key: 'billable_amount', header: '청구금액', width: 12 },
  { key: 'vat_amount', header: 'VAT', width: 10 },
  { key: 'impressions', header: '노출수', width: 10 },
  { key: 'clicks', header: '클릭수', width: 10 },
  { key: 'conversions', header: '전환수', width: 10 },
  { key: 'campaign_id', header: '캠페인ID', width: 15 },
]
