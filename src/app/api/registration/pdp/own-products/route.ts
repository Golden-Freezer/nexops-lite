// /api/registration/pdp/own-products — 상세페이지 생성 화면 '우리 쿠팡 상품' 고르기 목록(J51). 오너 전용, 읽기만.
// GET ?businessId=&q= → 200 { listings: [{ productId, name, options: [{ rowId, name, bundle }] }] }
//   같은 user_id·business_id의 판매 상품(products purpose=product, 등록상품ID 있음)을 등록상품ID로 묶는다. bundle은 옵션명에서 읽은 1묶음 수량(모르면 null).
//   판매 수는 주지 않는다 — 잡 생성 POST가 서버에서 다시 센다(own-sales-load.ts attachOwnSales).
// 막히면: 400 사업장 없음, 403 남의 사업장.

import { NextRequest, NextResponse } from 'next/server'
import { requireOwner } from '@/lib/auth/clerk'
import { createAdminClient } from '@/lib/supabase/admin'
import { listOwnListings } from '@/lib/registration/own-sales-load'

export const dynamic = 'force-dynamic'

const Q_MAX = 60

export async function GET(req: NextRequest) {
  try {
    const userId = await requireOwner()
    const businessId = req.nextUrl.searchParams.get('businessId')?.trim() ?? ''
    const q = (req.nextUrl.searchParams.get('q') ?? '').trim().slice(0, Q_MAX)
    if (!businessId) return NextResponse.json({ error: '사업장(businessId)이 필요합니다.' }, { status: 400 })
    const db = createAdminClient()
    const { data, error } = await db.from('businesses').select('id').eq('id', businessId).eq('user_id', userId).limit(1)
    if (error) throw new Error(`사업장 소유 확인 실패: ${error.message}`)
    if (!data || data.length === 0) return NextResponse.json({ error: '해당 사업장에 대한 접근 권한이 없습니다.' }, { status: 403 })
    const listings = await listOwnListings(db, userId, businessId, q)
    return NextResponse.json({ listings })
  } catch (error: unknown) {
    if (error instanceof NextResponse) return error
    const message = error instanceof Error ? error.message : '서버 오류'
    console.error('registration pdp own-products GET error:', error)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
