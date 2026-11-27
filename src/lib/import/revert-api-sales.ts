const CHUNK = 50

export interface RevertApiSalesResult {
  deletedSales: number
  restoredStock: number
  deletedMovements: number
  productsRestored: number
}

interface ApiSaleRow {
  id: string
  product_id: string | null
  order_quantity: number | null
  total_amount: number | null
  unit_cost: number | null
}

interface ApiSaleMovementRow {
  id: string
  inventory_id: string
  product_id: string
  quantity: number | null
  unit_cost: number | null
  reference_no: string
}

function chunked<T>(list: T[], size = CHUNK): T[][] {
  const out: T[][] = []
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size))
  return out
}

/**
 * 같은 소유자·사업장·판매일의 coupang_api 판매를 재고 원복 후 제거한다.
 * scripts/coupang-openapi/swap-api-sales.mjs의 실제 적용 1~6단계와 같은 순서다.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function revertApiSalesForDate(
  supabase: any,
  args: { userId: string; businessId: string | null; orderDate: string },
): Promise<RevertApiSalesResult> {
  const { userId, businessId, orderDate } = args

  // 1) 대상 API 판매행 — 소유 필터를 모두 명시한다 (user + business + date + source)
  let salesQuery = supabase
    .from('sales_transactions')
    .select('id, product_id, order_quantity, total_amount, unit_cost')
    .eq('user_id', userId)
    .eq('order_date', orderDate)
    .eq('source', 'coupang_api')
  salesQuery = businessId
    ? salesQuery.eq('business_id', businessId)
    : salesQuery.is('business_id', null)

  const { data: salesData, error: salesError } = await salesQuery
  if (salesError) throw new Error(`API 판매행 조회 실패: ${salesError.message}`)

  const sales = (salesData ?? []) as ApiSaleRow[]
  if (sales.length === 0) {
    console.log('[import] 대상 API 판매행이 없습니다 — 스왑 불필요.')
    return { deletedSales: 0, restoredStock: 0, deletedMovements: 0, productsRestored: 0 }
  }

  // 2) 대응 재고 이동 — 트리거가 남긴 API-SALE-{행id}만 원복 근거로 삼는다.
  //    (재고 레코드가 없어 차감되지 않은 행은 이동도 없으므로 원복 대상이 아니다)
  const references = sales.map((sale) => `API-SALE-${sale.id}`)
  const movements: ApiSaleMovementRow[] = []
  for (const part of chunked(references)) {
    const { data, error } = await supabase
      .from('inventory_movements')
      .select('id, inventory_id, product_id, quantity, unit_cost, reference_no')
      .in('reference_no', part)
    if (error) throw new Error(`재고 이동 조회 실패: ${error.message}`)
    movements.push(...((data ?? []) as ApiSaleMovementRow[]))
  }
  console.log(`[import] 원복 대상 API 재고 이동: ${movements.length}건`)

  // 3) 상품별 원복량 집계 — 이동의 quantity는 음수(출고)이므로 부호를 뒤집는다
  const restoreByProduct = new Map<string, { inventoryId: string; qty: number; value: number }>()
  for (const movement of movements) {
    const qty = -Number(movement.quantity ?? 0)
    if (qty <= 0) continue
    const current = restoreByProduct.get(movement.product_id) ?? {
      inventoryId: movement.inventory_id,
      qty: 0,
      value: 0,
    }
    current.qty += qty
    current.value += qty * Number(movement.unit_cost ?? 0)
    restoreByProduct.set(movement.product_id, current)
  }
  console.log(`[import] API 재고 원복 상품: ${restoreByProduct.size}종`)

  // 4) 재고 원복 — 트리거의 차감을 이동 기록 기준으로 되돌린다
  let restoredStock = 0
  for (const [productId, restore] of restoreByProduct) {
    const { data: inventory, error: inventoryError } = await supabase
      .from('inventory')
      .select('id, current_stock')
      .eq('id', restore.inventoryId)
      .maybeSingle()
    if (inventoryError) throw new Error(`재고 조회 실패: ${inventoryError.message}`)
    if (inventory) {
      const next = Number(inventory.current_stock ?? 0) + restore.qty
      const { error } = await supabase
        .from('inventory')
        .update({ current_stock: next, updated_at: new Date().toISOString() })
        .eq('id', inventory.id)
      if (error) throw new Error(`재고 원복 실패: ${error.message}`)
      restoredStock += restore.qty
    }

    const { data: state, error: stateError } = await supabase
      .from('inventory_state')
      .select('product_id, qty, total_value')
      .eq('product_id', productId)
      .maybeSingle()
    if (stateError) throw new Error(`이동평균 조회 실패: ${stateError.message}`)
    if (state) {
      const qty = Number(state.qty ?? 0) + restore.qty
      const value = Number(state.total_value ?? 0) + restore.value
      const { error } = await supabase
        .from('inventory_state')
        .update({
          qty,
          total_value: value,
          avg_cost_krw: qty > 0 ? Math.round((value / qty) * 10000) / 10000 : 0,
          updated_at: new Date().toISOString(),
        })
        .eq('product_id', productId)
      if (error) throw new Error(`이동평균 원복 실패: ${error.message}`)
    }
  }
  console.log(`[import] API 재고 원복 완료: +${restoredStock}개`)

  // 5) 이동 기록 삭제 → 판매행 삭제 (순서 중요: 이동이 남으면 재고가 이중 원복된다)
  let deletedMovements = 0
  for (const part of chunked(movements.map((movement) => movement.id))) {
    const { count, error } = await supabase
      .from('inventory_movements')
      .delete({ count: 'exact' })
      .in('id', part)
    if (error) throw new Error(`재고 이동 삭제 실패: ${error.message}`)
    deletedMovements += count ?? 0
  }

  let deleteSalesQuery = supabase
    .from('sales_transactions')
    .delete({ count: 'exact' })
    .eq('user_id', userId)
    .eq('order_date', orderDate)
    .eq('source', 'coupang_api')
  deleteSalesQuery = businessId
    ? deleteSalesQuery.eq('business_id', businessId)
    : deleteSalesQuery.is('business_id', null)

  const { count: deletedSales, error: deleteSalesError } = await deleteSalesQuery
  if (deleteSalesError) throw new Error(`API 판매행 삭제 실패: ${deleteSalesError.message}`)
  console.log(`[import] API 삭제 완료: 판매행 ${deletedSales ?? 0}건 · 재고이동 ${deletedMovements}건`)

  // 6) 사후 검증 — 해당 소유 범위의 남은 API 행이 0이어야 한다
  let remainingQuery = supabase
    .from('sales_transactions')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('order_date', orderDate)
    .eq('source', 'coupang_api')
  remainingQuery = businessId
    ? remainingQuery.eq('business_id', businessId)
    : remainingQuery.is('business_id', null)

  const { count: remaining, error: remainingError } = await remainingQuery
  if (remainingError) throw new Error(`API 판매행 사후 검증 실패: ${remainingError.message}`)
  console.log(`[import] 검증: ${orderDate} 잔여 API 판매행 ${remaining ?? 0}건${remaining ? ' — 확인 필요' : ''}`)

  return {
    deletedSales: deletedSales ?? 0,
    restoredStock,
    deletedMovements,
    productsRestored: restoreByProduct.size,
  }
}
