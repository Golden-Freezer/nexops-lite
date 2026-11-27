export interface AtomicAdCampaignRow {
  campaign_id: string
  campaign_name: string | null
  ad_type: string | null
  ad_date: string
  spent_amount: number
  billable_amount: number | null
  vat_amount: number | null
  impressions: number | null
  clicks: number | null
  conversions: number | null
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
  const year = Number(value.slice(0, 4))
  const date = new Date(`${value}T00:00:00.000Z`)
  return year > 0 && Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}

function assertRows(rows: AtomicAdCampaignRow[]): void {
  if (rows.length === 0) {
    throw new Error('교체할 유효 광고 캠페인이 없습니다. 기존 데이터는 유지됩니다.')
  }

  for (const row of rows) {
    if (!row.campaign_id.trim() || !isValidIsoDate(row.ad_date)) {
      throw new Error('광고 캠페인 ID 또는 광고 날짜가 올바르지 않습니다. 기존 데이터는 유지됩니다.')
    }
    const nullableNumbers = [
      row.billable_amount,
      row.vat_amount,
      row.impressions,
      row.clicks,
      row.conversions,
    ]
    if (!Number.isFinite(row.spent_amount) || nullableNumbers.some((value) => value !== null && !Number.isFinite(value))) {
      throw new Error('광고 금액에 올바르지 않은 값이 있습니다. 기존 데이터는 유지됩니다.')
    }
    if (row.spent_amount < 0 || row.billable_amount !== null && row.billable_amount < 0
      || row.vat_amount !== null && row.vat_amount < 0) {
      throw new Error('광고 금액은 음수일 수 없습니다. 기존 데이터는 유지됩니다.')
    }
    const nullableCounts = [row.impressions, row.clicks, row.conversions]
    if (nullableCounts.some((value) => value !== null && (!Number.isInteger(value) || value < 0))) {
      throw new Error('광고 노출·클릭·전환 수가 올바르지 않습니다. 기존 데이터는 유지됩니다.')
    }
  }
}

/**
 * 같은 사업장·날짜의 쿠팡 광고 Import 데이터를 PostgreSQL 함수 한 번으로 교체한다.
 * 함수 호출 자체가 하나의 DB 트랜잭션이므로 DELETE 또는 INSERT 중 하나라도 실패하면
 * 전체 호출이 롤백되어 기존 광고비 원장이 보존된다.
 */
export async function replaceAdCampaignsAtomically(
  db: RpcClient,
  userId: string,
  businessId: string | null,
  batchId: string,
  rows: AtomicAdCampaignRow[],
): Promise<number> {
  if (!businessId) {
    throw new Error('광고 Import에는 현재 사업장 선택이 필요합니다. 기존 데이터는 유지됩니다.')
  }
  if (!userId.trim() || !batchId.trim()) {
    throw new Error('광고 Import 사용자 또는 배치 정보가 없습니다. 기존 데이터는 유지됩니다.')
  }
  assertRows(rows)

  const { data, error } = await db.rpc('replace_coupang_import_ad_campaigns', {
    p_user_id: userId,
    p_business_id: businessId,
    p_import_batch_id: batchId,
    p_rows: rows,
  })

  if (error) {
    throw new Error(`광고 데이터 원자 교체 실패: ${error.message || '알 수 없는 오류'}`)
  }

  if (typeof data !== 'number' || !Number.isInteger(data) || data !== rows.length) {
    throw new Error('광고 데이터 교체 건수가 일치하지 않습니다. 저장 결과를 확인해주세요.')
  }
  return data
}
