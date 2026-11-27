/**
 * inventory_state(이동평균) 동기화 유틸 — 매입 arrived 전환(api/purchases PATCH)이 갖고 있던
 * 가중평균 upsert/롤백 로직을 수동 입출고(api/inventory/movements)와 arrived 매입 삭제
 * 경로에서도 재사용한다(audit §1-11 — 수동 경로가 inventory.current_stock만 갱신하고
 * inventory_state는 불변이던 공백을 메운다).
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AdminClient = any

interface InventoryStateSnapshot {
  qty: number
  totalValue: number
  avgCostKrw: number
}

async function readState(supabase: AdminClient, productId: string): Promise<InventoryStateSnapshot> {
  const { data } = await supabase
    .from('inventory_state')
    .select('qty, total_value, avg_cost_krw')
    .eq('product_id', productId)
    .single()

  return {
    qty: Number(data?.qty) || 0,
    totalValue: Number(data?.total_value) || 0,
    avgCostKrw: Number(data?.avg_cost_krw) || 0,
  }
}

async function writeState(supabase: AdminClient, productId: string, next: InventoryStateSnapshot): Promise<void> {
  await supabase
    .from('inventory_state')
    .upsert(
      {
        product_id: productId,
        qty: next.qty,
        total_value: Math.round(next.totalValue * 100) / 100,
        avg_cost_krw: next.avgCostKrw,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'product_id' }
    )
}

/**
 * 입고 반영 — unitCost가 있으면 가중평균을 재계산하고, 없으면 기존 평균단가를 그대로 적용해
 * qty/총액만 늘린다(매입 arrived 전환 로직과 동일 공식).
 */
export async function applyInboundToInventoryState(
  supabase: AdminClient,
  productId: string,
  quantity: number,
  unitCostKrw: number | null | undefined
): Promise<void> {
  if (quantity <= 0) return
  const cur = await readState(supabase, productId)
  const cost = unitCostKrw != null && unitCostKrw > 0 ? unitCostKrw : cur.avgCostKrw
  const newQty = cur.qty + quantity
  const newTotalValue = cur.totalValue + quantity * cost
  const newAvg = newQty > 0 ? Math.round((newTotalValue / newQty) * 10000) / 10000 : 0

  await writeState(supabase, productId, { qty: newQty, totalValue: newTotalValue, avgCostKrw: newAvg })
}

/**
 * 출고(또는 입고 취소) 반영 — 지정한 단가(없으면 현재 평균단가)로 qty/총액을 차감한다.
 * 현재 평균단가로 차감하면 평균단가 자체는 불변(가중평균 성질), 특정 매입 건의 원가로
 * 차감하면(예: arrived 매입 삭제) 남은 재고의 평균단가가 그만큼 재계산된다.
 */
export async function removeFromInventoryState(
  supabase: AdminClient,
  productId: string,
  quantity: number,
  unitCostKrw?: number | null
): Promise<void> {
  if (quantity <= 0) return
  const cur = await readState(supabase, productId)
  const cost = unitCostKrw != null && unitCostKrw > 0 ? unitCostKrw : cur.avgCostKrw
  const newQty = Math.max(cur.qty - quantity, 0)
  const newTotalValue = Math.max(cur.totalValue - quantity * cost, 0)
  const newAvg = newQty > 0 ? Math.round((newTotalValue / newQty) * 10000) / 10000 : 0

  await writeState(supabase, productId, { qty: newQty, totalValue: newTotalValue, avgCostKrw: newAvg })
}

/**
 * 조정(adjustment) 반영 — quantity는 델타가 아닌 절대값. 평균단가는 유지한 채
 * qty·총액만 절대값 기준으로 재설정한다.
 */
export async function setInventoryStateQty(
  supabase: AdminClient,
  productId: string,
  absoluteQty: number
): Promise<void> {
  const cur = await readState(supabase, productId)
  const newQty = Math.max(absoluteQty, 0)
  const newTotalValue = newQty * cur.avgCostKrw

  await writeState(supabase, productId, { qty: newQty, totalValue: newTotalValue, avgCostKrw: cur.avgCostKrw })
}

export interface CoupangSnapshotSyncResult {
  stockChanged: boolean
  adjustQty: number
}

/**
 * 쿠팡 스냅샷 동기화 — 재고 SSOT는 재고건강 임포트의 쿠팡 재고라는 정책(2026-07-05,
 * 오너 재확인 2026-07-13)의 구조적 구현. current_stock과 이동평균 장부(qty·총액)를
 * 스냅샷 값으로 정렬하고, 이력(movements) 합과의 차이는 adjustment 행으로 기록해
 * 세 값(current_stock = state.qty = movements 합)의 정합을 유지한다. 평균단가는 불변.
 */
export async function syncStockToCoupangSnapshot(
  supabase: AdminClient,
  productId: string,
  coupangStock: number,
  movementDate: string
): Promise<CoupangSnapshotSyncResult> {
  const target = Math.max(Math.round(coupangStock), 0)

  const { data: inv } = await supabase
    .from('inventory')
    .select('id, current_stock')
    .eq('product_id', productId)
    .single()
  if (!inv?.id) return { stockChanged: false, adjustQty: 0 }

  const stockChanged = Number(inv.current_stock) !== target
  if (stockChanged) {
    await supabase
      .from('inventory')
      .update({ current_stock: target, updated_at: new Date().toISOString() })
      .eq('id', inv.id)
  }

  const cur = await readState(supabase, productId)
  if (cur.qty !== target) {
    await writeState(supabase, productId, {
      qty: target,
      totalValue: target * cur.avgCostKrw,
      avgCostKrw: cur.avgCostKrw,
    })
  }

  const { data: moves } = await supabase
    .from('inventory_movements')
    .select('quantity')
    .eq('product_id', productId)
  const movesSum = (moves ?? []).reduce(
    (acc: number, m: { quantity: number | null }) => acc + (Number(m.quantity) || 0),
    0
  )
  const adjustQty = target - movesSum
  if (adjustQty !== 0) {
    const { error: mErr } = await supabase.from('inventory_movements').insert({
      inventory_id: inv.id,
      product_id: productId,
      movement_type: 'adjustment',
      quantity: adjustQty,
      unit_cost: cur.avgCostKrw,
      reference_no: `HEALTH-SYNC-${movementDate}`,
      notes: '재고건강 임포트 — 쿠팡 재고 스냅샷 기준 자동 정렬',
      movement_date: movementDate,
    })
    if (mErr) throw new Error(`쿠팡 동기화 조정 이력 기록 실패: ${mErr.message}`)
  }

  return { stockChanged, adjustQty }
}
