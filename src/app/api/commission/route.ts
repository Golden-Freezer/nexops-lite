import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getCommissionRate, getCategoryTree } from '@/lib/calc'
import { requireAuth } from '@/lib/auth/clerk'

/** GET /api/commission?major=...&mid=...&sub=... - 수수료 조회 */
export async function GET(request: NextRequest) {
  try {
    try { await requireAuth() } catch (r) { return r as NextResponse }
    const { searchParams } = new URL(request.url)
    const major = searchParams.get('major')

    if (!major) {
      return NextResponse.json(
        { error: '대분류(major)는 필수입니다.' },
        { status: 400 }
      )
    }

    const supabase = await createClient()
    const mid = searchParams.get('mid')
    const sub = searchParams.get('sub')

    const rate = await getCommissionRate(supabase, major, mid, sub)
    return NextResponse.json({ data: { rate } })
  } catch (error) {
    return NextResponse.json(
      { error: '수수료 조회 중 오류가 발생했습니다.' },
      { status: 500 }
    )
  }
}

/** POST /api/commission — 카테고리 트리 조회 (공용 참조 데이터, 인증 불필요) */
export async function POST() {
  try {
    const supabase = await createClient()
    const tree = await getCategoryTree(supabase)
    return NextResponse.json({ data: tree })
  } catch (error) {
    return NextResponse.json(
      { error: '카테고리 트리 조회 중 오류가 발생했습니다.' },
      { status: 500 }
    )
  }
}
