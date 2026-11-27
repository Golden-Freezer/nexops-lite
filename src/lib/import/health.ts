// 임포트 건강 진단 — 오너 사업장별 최근 N일 판매·광고 임포트 결손을 집계한다.
// /api/import/auto/missing과 동일한 진실 소스(sales_transactions.order_date / ad_campaigns.ad_date,
// business 격리)를 쓰되, 오너 UI 알림용이라 판매를 'import'(엑셀)·'api_only'(오픈API만)·'missing'으로
// 세분한다 — 오너가 "판매가 API로만 채워졌고 엑셀 임포트는 안 됨"을 구분해서 볼 수 있어야 한다.
// 광고는 엑셀(coupang_import) 경로만 존재하므로 'import' | 'missing' 2분기.
//
// api_only 판매는 확장 백필 대상에서는 제외되지만(이중집계 방지, missing 라우트 참조), 엑셀 임포트가
// 들어오면 revert/swap(import_excel_authoritative)이 API 행을 대체하므로 "지금 수집" 대상으로는 안전하다.

import type { SupabaseClient } from '@supabase/supabase-js'

async function listOwnedBusinesses(db: SupabaseClient, userId: string) {
  const { data, error } = await db
    .from('businesses')
    .select('id, business_name')
    .eq('user_id', userId)
  if (error) throw new Error(`사업장 조회 실패: ${error.message}`)
  return ((data ?? []) as { id: string; business_name: string | null }[]).map((row) => ({
    id: row.id,
    name: row.business_name ?? '내 사업장',
  }))
}

const KST_OFFSET_MS = 9 * 3_600_000

export type SalesStatus = 'import' | 'api_only' | 'missing'
export type AdsStatus = 'import' | 'missing'

export interface DayStatus {
  date: string
  sales: SalesStatus
  ads: AdsStatus
}

export interface BusinessImportHealth {
  businessId: string
  name: string
  vendorId: string | null
  windowFrom: string
  windowTo: string
  days: DayStatus[]
  /** 엑셀 판매 임포트가 완전히 비어 있는 날짜 (API도 없음) */
  missingSales: string[]
  /** API로만 채워져 엑셀 임포트가 필요한 날짜 */
  apiOnlySales: string[]
  /** 광고 정산이 비어 있는 날짜 */
  missingAds: string[]
}

export interface ImportHealthReport {
  generatedAt: string
  /** 벤더코드가 있어 임포트 대상인 사업장만 */
  businesses: BusinessImportHealth[]
  /** 알림이 필요한가 — 어느 사업장이든 결손이 있으면 true */
  hasIssues: boolean
}

function kstDateStr(offsetDays: number): string {
  const d = new Date(Date.now() + KST_OFFSET_MS - offsetDays * 86_400_000)
  return d.toISOString().slice(0, 10)
}

/**
 * 오너 본인 사업장(벤더코드 보유)별 임포트 결손을 집계한다. 읽기 전용.
 * @param days 어제부터 거슬러 검사할 일 수 (오늘은 정오 확정 전이라 제외)
 */
export async function computeImportHealth(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: SupabaseClient,
  userId: string,
  days = 5,
): Promise<ImportHealthReport> {
  const windowDates: string[] = []
  for (let i = 1; i <= days; i++) windowDates.push(kstDateStr(i))
  windowDates.sort()
  const from = windowDates[0]
  const to = windowDates[windowDates.length - 1]

  const owned = await listOwnedBusinesses(db, userId)
  const targets = owned

  const businesses: BusinessImportHealth[] = []
  for (const b of targets) {
    const salesQ = await db
      .from('sales_transactions')
      .select('order_date, source')
      .eq('user_id', userId)
      .eq('business_id', b.id)
      .in('source', ['coupang_import', 'coupang_api'])
      .gte('order_date', from)
      .lte('order_date', to)
      .limit(20000)
    if (salesQ.error) {
      throw new Error(
        `[${b.name}] 판매 임포트 상태 조회 실패: ${salesQ.error.message}`,
      )
    }
    const adsQ = await db
      .from('ad_campaigns')
      .select('ad_date')
      .eq('user_id', userId)
      .eq('business_id', b.id)
      .eq('source', 'coupang_import')
      .gte('ad_date', from)
      .lte('ad_date', to)
      .limit(20000)
    if (adsQ.error) {
      throw new Error(
        `[${b.name}] 광고 임포트 상태 조회 실패: ${adsQ.error.message}`,
      )
    }

    const salesSources = new Map<string, Set<string>>()
    for (const r of (salesQ.data ?? []) as { order_date: string; source: string }[]) {
      if (!salesSources.has(r.order_date)) salesSources.set(r.order_date, new Set())
      salesSources.get(r.order_date)!.add(r.source)
    }
    const adsHave = new Set((adsQ.data ?? []).map((r: { ad_date: string }) => r.ad_date))

    const dayStatuses: DayStatus[] = windowDates.map((date) => {
      const src = salesSources.get(date)
      const sales: SalesStatus = !src
        ? 'missing'
        : src.has('coupang_import')
          ? 'import'
          : 'api_only'
      const ads: AdsStatus = adsHave.has(date) ? 'import' : 'missing'
      return { date, sales, ads }
    })

    businesses.push({
      businessId: b.id,
      name: b.name,
      vendorId: null,
      windowFrom: from,
      windowTo: to,
      days: dayStatuses,
      missingSales: dayStatuses.filter((d) => d.sales === 'missing').map((d) => d.date),
      apiOnlySales: dayStatuses.filter((d) => d.sales === 'api_only').map((d) => d.date),
      missingAds: dayStatuses.filter((d) => d.ads === 'missing').map((d) => d.date),
    })
  }

  const hasIssues = businesses.some(
    (b) => b.missingSales.length || b.apiOnlySales.length || b.missingAds.length,
  )

  return {
    generatedAt: new Date(Date.now() + KST_OFFSET_MS).toISOString(),
    businesses,
    hasIssues,
  }
}
