import * as XLSX from 'xlsx'

export interface TaxSaleRow {
  date: string
  orderNumber: string | null
  productName: string
  quantity: number
  revenue: number
  cancelAmount: number
  commission: number
  commissionVat: number
  vat: number
  status: string | null
}

export interface TaxPurchaseRow {
  date: string
  poNumber: string | null
  supplierName: string
  productName: string
  quantity: number
  amount: number
  customsVat: number
  status: string | null
}

export interface TaxExpenseRow {
  date: string
  category: string
  description: string
  amount: number
  vat: number
  paymentMethod: string | null
}

export interface TaxWorkbookInput {
  businessName: string
  startDate: string
  endDate: string
  sales: TaxSaleRow[]
  purchases: TaxPurchaseRow[]
  expenses: TaxExpenseRow[]
}

function appendSheet(
  workbook: XLSX.WorkBook,
  name: string,
  header: string[],
  rows: Array<Array<string | number>>,
  widths: number[]
) {
  const sheet = XLSX.utils.aoa_to_sheet([header, ...rows])
  sheet['!cols'] = widths.map((wch) => ({ wch }))
  XLSX.utils.book_append_sheet(workbook, sheet, name)
}

/** 매출·매입·비용을 분리한 세무사 전달용 XLSX 버퍼. */
export function buildTaxWorkbook(input: TaxWorkbookInput): Uint8Array {
  const workbook = XLSX.utils.book_new()
  const totalSales = input.sales.reduce((sum, row) => sum + row.revenue, 0)
  const totalCancel = input.sales.reduce((sum, row) => sum + row.cancelAmount, 0)
  const totalPurchases = input.purchases.reduce((sum, row) => sum + row.amount, 0)
  const totalExpenses = input.expenses.reduce((sum, row) => sum + row.amount, 0)
  const totalExpenseVat = input.expenses.reduce((sum, row) => sum + row.vat, 0)

  appendSheet(
    workbook,
    '요약',
    ['항목', '값'],
    [
      ['사업자', input.businessName],
      ['조회기간', `${input.startDate} ~ ${input.endDate}`],
      ['매출 합계', totalSales],
      ['취소 합계', totalCancel],
      ['매입 합계', totalPurchases],
      ['비용 공급가액 합계', totalExpenses],
      ['비용 VAT 합계', totalExpenseVat],
      ['참고 손익', totalSales - totalPurchases - totalExpenses - totalExpenseVat],
      ['주의', '세무 신고 전 세무사 확인이 필요한 참고 자료입니다.'],
    ],
    [24, 42]
  )

  appendSheet(
    workbook,
    '매출',
    ['날짜', '주문번호', '상품명', '수량', '매출액', '취소액', '판매수수료', '수수료VAT', '매출VAT', '상태'],
    input.sales.map((row) => [
      row.date, row.orderNumber ?? '', row.productName, row.quantity, row.revenue,
      row.cancelAmount, row.commission, row.commissionVat, row.vat, row.status ?? '',
    ]),
    [12, 20, 36, 10, 14, 14, 14, 12, 12, 10]
  )

  appendSheet(
    workbook,
    '매입',
    ['발주일', '발주번호', '공급처', '상품명', '수량', '매입금액', '수입VAT', '상태'],
    input.purchases.map((row) => [
      row.date, row.poNumber ?? '', row.supplierName, row.productName,
      row.quantity, row.amount, row.customsVat, row.status ?? '',
    ]),
    [12, 18, 22, 36, 10, 14, 12, 12]
  )

  appendSheet(
    workbook,
    '비용',
    ['날짜', '구분', '내용', '공급가액', 'VAT', '합계', '결제수단'],
    input.expenses.map((row) => [
      row.date, row.category, row.description, row.amount, row.vat,
      row.amount + row.vat, row.paymentMethod ?? '',
    ]),
    [12, 16, 38, 14, 12, 14, 16]
  )

  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' })
}
