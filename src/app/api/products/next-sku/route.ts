import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getSkuPrefix, generateSku } from '@/lib/utils/sku-generator'
import { requireAuth } from '@/lib/auth/clerk'

/** GET /api/products/next-sku?major=출산/유아 — 다음 SKU 번호 조회 */
export async function GET(request: NextRequest) {
  try {
    let userId: string
    try { userId = await requireAuth() } catch (r) { return r as NextResponse }
    const { searchParams } = new URL(request.url)
    const major = searchParams.get('major')

    if (!major) {
      return NextResponse.json(
        { error: '대분류 카테고리가 필요합니다.' },
        { status: 400 }
      )
    }

    const prefix = getSkuPrefix(major)
    const supabase = await createClient()

    // 동일 접두사의 최대 순번 조회 — user_id 범위로 한정해 POST 채번 범위와 일치시킨다 (audit §1-13)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (supabase as any)
      .from('products')
      .select('sku')
      .eq('user_id', userId)
      .like('sku', `${prefix}-%`)
      .order('sku', { ascending: false })
      .limit(1)

    let currentMax = 0
    if (data && data.length > 0) {
      const lastSku = (data[0] as Record<string, unknown>).sku as string
      const parts = lastSku.split('-')
      const num = parseInt(parts[parts.length - 1], 10)
      if (!isNaN(num)) currentMax = num
    }

    const sku = generateSku(prefix, currentMax)

    return NextResponse.json({ data: { sku, prefix } })
  } catch {
    return NextResponse.json(
      { error: 'SKU 생성 중 오류가 발생했습니다.' },
      { status: 500 }
    )
  }
}
