export interface AtomicPurchaseImportRow {
  product_id: string | null
  po_number: string | null
  order_date: string
  arrival_date: string | null
  expected_arrival_date: string | null
  lead_time_weeks: number | null
  quantity: number
  unit_price: number
  currency: 'CNY'
  exchange_rate: number
  shipping_cost: number
  payment1_product_krw: number
  payment1_vat: number
  payment1_total: number
  payment1_status: 'paid'
  payment2_vat: number
  additional_cost: number
  payment2_total: number
  payment2_status: 'paid'
  domestic_shipping: number
  customs_vat: number
  payment3_total: number
  payment3_status: 'paid'
  unit_cost_krw: number
  total_amount_krw: number
  payment_status: 'paid'
  status: 'ordered' | 'arrived'
  notes: string | null
  product_name_memo: string
}

interface RpcResult {
  data: unknown
  error: { message?: string } | null
}

interface RpcClient {
  rpc(name: string, params: Record<string, unknown>): Promise<RpcResult>
}

function isValidIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00.000Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}

function assertRows(rows: AtomicPurchaseImportRow[]): void {
  if (rows.length === 0) {
    throw new Error('등록할 유효 매입 행이 없습니다. 매입·재고 데이터는 변경되지 않았습니다.')
  }

  for (const row of rows) {
    if (!row.product_name_memo.trim() || row.product_name_memo.length > 500) {
      throw new Error('매입 상품명이 비어 있거나 너무 깁니다. 매입·재고 데이터는 변경되지 않았습니다.')
    }
    if (!isValidIsoDate(row.order_date)
      || (row.arrival_date !== null && !isValidIsoDate(row.arrival_date))
      || (row.expected_arrival_date !== null && !isValidIsoDate(row.expected_arrival_date))) {
      throw new Error('매입일·실입고일·입고예정일 중 올바르지 않은 날짜가 있습니다. 매입·재고 데이터는 변경되지 않았습니다.')
    }
    if (row.lead_time_weeks !== null && (!Number.isInteger(row.lead_time_weeks) || row.lead_time_weeks < 0)) {
      throw new Error('입고 소요 주수는 0 이상의 정수여야 합니다. 매입·재고 데이터는 변경되지 않았습니다.')
    }
    if ((row.arrival_date !== null && row.arrival_date < row.order_date)
      || (row.expected_arrival_date !== null && row.expected_arrival_date < row.order_date)) {
      throw new Error('실입고일·입고예정일은 매입일보다 빠를 수 없습니다. 매입·재고 데이터는 변경되지 않았습니다.')
    }
    if (!Number.isInteger(row.quantity) || row.quantity <= 0) {
      throw new Error('매입 수량은 1 이상의 정수여야 합니다. 매입·재고 데이터는 변경되지 않았습니다.')
    }

    const nonNegative = [
      row.unit_price,
      row.shipping_cost,
      row.payment1_product_krw,
      row.payment1_vat,
      row.payment1_total,
      row.payment2_vat,
      row.additional_cost,
      row.payment2_total,
      row.domestic_shipping,
      row.customs_vat,
      row.payment3_total,
      row.unit_cost_krw,
      row.total_amount_krw,
    ]
    if (nonNegative.some((value) => !Number.isFinite(value) || value < 0)
      || !Number.isFinite(row.exchange_rate) || row.exchange_rate <= 0) {
      throw new Error('매입 금액 또는 환율이 올바르지 않습니다. 매입·재고 데이터는 변경되지 않았습니다.')
    }

    const isArrived = row.status === 'arrived'
    if (isArrived !== (row.arrival_date !== null)) {
      throw new Error('매입 상태와 입고일이 일치하지 않습니다. 매입·재고 데이터는 변경되지 않았습니다.')
    }
    if (isArrived && !row.product_id) {
      throw new Error('입고완료 건에는 현재 사업장의 연결 상품이 필요합니다. 매입·재고 데이터는 변경되지 않았습니다.')
    }
    if (isArrived && row.unit_cost_krw <= 0) {
      throw new Error('입고완료 건에는 0보다 큰 원화 단가가 필요합니다. 매입·재고 데이터는 변경되지 않았습니다.')
    }
    const expectedTotal = Math.round((row.payment1_total + row.payment2_total + row.payment3_total) * 100) / 100
    const expectedUnitCost = Math.round((expectedTotal / row.quantity) * 100) / 100
    if (Math.abs(row.payment1_total - (row.payment1_product_krw + row.payment1_vat)) > 0.01
      || Math.abs(row.payment2_total - row.additional_cost) > 0.01
      || Math.abs(row.payment3_total - (row.domestic_shipping + row.customs_vat)) > 0.01
      || Math.abs(row.total_amount_krw - expectedTotal) > 0.01
      || Math.abs(row.unit_cost_krw - expectedUnitCost) > 0.01) {
      throw new Error('매입 단계별 금액·총액·개당원가가 일치하지 않습니다. 매입·재고 데이터는 변경되지 않았습니다.')
    }
    if (row.product_id !== null && !row.product_id.trim()) {
      throw new Error('연결 상품 ID가 올바르지 않습니다. 매입·재고 데이터는 변경되지 않았습니다.')
    }
    if (row.notes !== null && row.notes.length > 2000) {
      throw new Error('매입 메모가 너무 깁니다. 매입·재고 데이터는 변경되지 않았습니다.')
    }
  }
}

/**
 * 매입 행 전체를 구매·재고·이동평균·입출고 이력과 함께 PostgreSQL 트랜잭션 하나로 저장한다.
 * RPC 실패 시 함수 안의 모든 INSERT/UPDATE가 롤백되므로 부분 매입이나 고아 이력이 남지 않는다.
 */
export async function importPurchasesAtomically(
  db: RpcClient,
  userId: string,
  businessId: string | null,
  batchId: string,
  idempotencyKey: string,
  rows: AtomicPurchaseImportRow[],
): Promise<number> {
  if (!businessId) {
    throw new Error('매입 Import에는 현재 사업장 선택이 필요합니다. 매입·재고 데이터는 변경되지 않았습니다.')
  }
  if (!userId.trim() || !batchId.trim() || !/^[a-f0-9]{64}$/.test(idempotencyKey)) {
    throw new Error('매입 Import 사용자 또는 배치 정보가 없습니다. 매입·재고 데이터는 변경되지 않았습니다.')
  }
  assertRows(rows)

  const rpcParams = {
    p_user_id: userId,
    p_business_id: businessId,
    p_import_batch_id: batchId,
    p_idempotency_key: idempotencyKey,
    p_rows: rows,
  }

  let data: unknown = null
  let lastError = '알 수 없는 오류'

  // 첫 RPC가 서버에서 commit됐지만 응답이 유실될 수 있다. 같은 batch/payload로
  // 딱 한 번 재호출하면 DB receipt가 결과만 재생하므로 중복 매입·재고가 생기지 않는다.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const result = await db.rpc('import_purchases_atomic', rpcParams)
      if (!result.error) {
        data = result.data
        lastError = ''
        break
      }
      lastError = result.error.message || '알 수 없는 오류'
    } catch (error) {
      lastError = error instanceof Error ? error.message : '알 수 없는 오류'
    }
  }

  if (lastError) {
    throw new Error(`매입·재고 원자 저장 결과 확인 실패: ${lastError}`)
  }
  if (typeof data !== 'number' || !Number.isInteger(data) || data !== rows.length) {
    throw new Error('매입 저장 건수가 일치하지 않습니다. 저장 결과를 확인해주세요.')
  }
  return data
}
