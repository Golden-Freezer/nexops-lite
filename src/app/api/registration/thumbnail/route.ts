// /api/registration/thumbnail — 대표이미지 3컷 생성 잡
// POST: 잡 생성(202 { jobId }) — 실행은 [jobId]/run 분할 호출이 담당
// GET: 잡 목록 (user_id 격리)
//
// 오너 전용. 설계문서 DESIGN-NEXFIT-GENERATORS-20260809 §6.2 계약.

import { NextRequest, NextResponse } from 'next/server'
import { requireOwner } from '@/lib/auth/clerk'
import { createAdminClient } from '@/lib/supabase/admin'
import { isImageModel } from '@/lib/agents/image/types'
import { createThumbnailJob, listThumbnailJobs } from '@/lib/registration/jobs'
import { THUMBNAIL_CATEGORIES, type ThumbnailCategory } from '@/lib/registration/thumbnail-types'

export const dynamic = 'force-dynamic'

interface CreateBody {
  draftId?: string
  businessId?: string
  sourceImages?: unknown
  productName?: string
  categoryHint?: string
  imageModel?: string
  imageQuality?: string
}

export async function POST(req: NextRequest) {
  try {
    const userId = await requireOwner()
    const body = (await req.json()) as CreateBody

    const sourceImages = Array.isArray(body.sourceImages)
      ? body.sourceImages.map((u) => String(u).trim()).filter(Boolean)
      : []
    if (sourceImages.length < 1 || sourceImages.length > 3) {
      return NextResponse.json({ error: '참조 이미지는 1~3장이어야 합니다.' }, { status: 400 })
    }
    // 서버가 fetch하는 URL이므로 http(s)만 허용 (내부 주소 등 비정상 입력 차단)
    if (sourceImages.some((u) => !/^https?:\/\//i.test(u))) {
      return NextResponse.json({ error: '참조 이미지는 http(s) URL이어야 합니다.' }, { status: 400 })
    }
    if (!isImageModel(body.imageModel)) {
      return NextResponse.json({ error: '지원하지 않는 이미지 모델입니다.' }, { status: 400 })
    }
    const imageQuality = body.imageQuality === 'high' ? 'high' : 'medium'
    const categoryHint = body.categoryHint?.trim() || null
    if (categoryHint && !THUMBNAIL_CATEGORIES.includes(categoryHint as ThumbnailCategory)) {
      return NextResponse.json({ error: `지원하지 않는 카테고리: ${categoryHint}` }, { status: 400 })
    }
    const productName = body.productName?.trim().slice(0, 200) || null

    const db = createAdminClient()

    // draft 연결 시 소유·사업장 일치 검증 (business_id 불일치 = 사업장 격리 구멍 — 400)
    let draftId: string | null = null
    let businessId: string | null = body.businessId?.trim() || null
    if (body.draftId?.trim()) {
      const { data: drafts, error } = await db
        .from('sourcing_registration_drafts')
        .select('id, business_id')
        .eq('user_id', userId)
        .eq('id', body.draftId.trim())
        .limit(1)
      if (error) throw new Error(`드래프트 조회 실패: ${error.message}`)
      const draft = drafts?.[0] as { id: string; business_id: string | null } | undefined
      if (!draft) {
        return NextResponse.json({ error: '연결할 드래프트를 찾을 수 없습니다.' }, { status: 404 })
      }
      if (businessId && draft.business_id && businessId !== draft.business_id) {
        return NextResponse.json(
          { error: '요청 business_id가 드래프트의 사업장과 일치하지 않습니다.' },
          { status: 400 }
        )
      }
      draftId = draft.id
      businessId = businessId ?? draft.business_id
    }

    const job = await createThumbnailJob(db, userId, {
      draftId,
      businessId,
      sourceImages,
      productName,
      categoryHint: categoryHint as ThumbnailCategory | null,
      imageModel: body.imageModel,
      imageQuality,
    })
    return NextResponse.json({ data: { jobId: job.id } }, { status: 202 })
  } catch (error: unknown) {
    if (error instanceof NextResponse) return error
    const message = error instanceof Error ? error.message : '서버 오류'
    console.error('registration thumbnail POST error:', error)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function GET() {
  try {
    const userId = await requireOwner()
    const jobs = await listThumbnailJobs(createAdminClient(), userId)
    return NextResponse.json({ data: jobs })
  } catch (error: unknown) {
    if (error instanceof NextResponse) return error
    const message = error instanceof Error ? error.message : '서버 오류'
    console.error('registration thumbnail GET error:', error)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
