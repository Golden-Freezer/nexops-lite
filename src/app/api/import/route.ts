import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAuth } from '@/lib/auth/clerk'
import { requireOwnedBusinessId } from '@/lib/auth/business'
import { runImport, toSalesStatusCode } from '@/lib/import/process'
import type { ImportType } from '@/types/import'

/** POST /api/import - 엑셀 임포트 배치 처리 (세션 사용자 + 현재 사업장) */
export async function POST(request: NextRequest) {
  try {
    let userId: string
    try { userId = await requireAuth() } catch (r) { return r as NextResponse }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const supabase = createAdminClient() as any

    let body: Record<string, unknown>
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: '잘못된 JSON 형식입니다.' }, { status: 400 })
    }

    let businessId: string
    try { businessId = await requireOwnedBusinessId(userId) } catch (response) { return response as NextResponse }

    const { importType, fileName, rows, totalRows, fileDate } = body as {
      importType: ImportType
      fileName: string
      rows: Record<string, unknown>[]
      totalRows: number
      errorCount: number
      fileDate?: string // 파일명에서 추출한 날짜 (Statistics 등)
    }

    // 임포트 타입 유효성 검증
    const validTypes = ['sales', 'inventory_health', 'ad_billing', 'ledger', 'product', 'purchase']
    if (!importType || !validTypes.includes(importType)) {
      return NextResponse.json({ error: `유효하지 않은 임포트 타입: ${importType}` }, { status: 400 })
    }

    if (!rows || rows.length === 0) {
      return NextResponse.json({ error: '임포트 데이터가 비어있습니다.' }, { status: 400 })
    }

    // dryRun: 매칭 결과만 반환, DB 쓰기·배치 기록 없음 — product 타입 전용 (임포트 미리보기)
    if ((body as { dryRun?: boolean }).dryRun === true) {
      if (importType !== 'product') {
        return NextResponse.json({ error: 'dryRun은 product 타입만 지원합니다.' }, { status: 400 })
      }
      const optionIds = [...new Set(rows.map((r) => String(r.coupang_option_id || '')).filter(Boolean))]
      const existingSet = new Set<string>()
      if (optionIds.length > 0) {
        let q = supabase
          .from('products')
          .select('coupang_option_id')
          .eq('user_id', userId)
          .in('coupang_option_id', optionIds)
        q = businessId ? q.eq('business_id', businessId) : q.is('business_id', null)
        const { data: existing } = await q
        for (const p of (existing || []) as { coupang_option_id: string | null }[]) {
          if (p.coupang_option_id) existingSet.add(p.coupang_option_id)
        }
      }
      let dryInserted = 0
      let dryUpdated = 0
      let drySkipped = 0
      let dryInvalidStatus = 0
      for (const r of rows) {
        const optionId = String(r.coupang_option_id || '')
        if (!optionId) { drySkipped++; continue }
        if (existingSet.has(optionId)) dryUpdated++
        else dryInserted++
        const rawStatus = String(r.sales_status_raw || '').trim()
        if (rawStatus && !toSalesStatusCode(rawStatus)) dryInvalidStatus++
      }
      return NextResponse.json({
        data: {
          dryRun: true,
          totalRows,
          insertedCount: dryInserted,
          updatedCount: dryUpdated,
          skippedCount: drySkipped,
          invalidStatusCount: dryInvalidStatus,
          existingOptionIds: [...existingSet],
        },
      })
    }

    const result = await runImport(supabase, {
      userId,
      businessId,
      importType,
      fileName,
      rows,
      totalRows,
      fileDate,
    })

    return NextResponse.json({ data: result })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '임포트 처리 중 오류가 발생했습니다.' },
      { status: 500 }
    )
  }
}
