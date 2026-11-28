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
import { resolveJobDraftLink } from '@/lib/registration/job-draft-link'
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

    // draft 연결 시 소유·사업장 일치 검증, 사업장 미지정이면 초안 사업장 상속 (job-draft-link.ts)
    const link = await resolveJobDraftLink(db, userId, { draftId: body.draftId, businessId: body.businessId })
    if (!link.ok) return NextResponse.json({ error: link.error }, { status: link.status })

    const job = await createThumbnailJob(db, userId, {
      draftId: link.draftId,
      businessId: link.businessId,
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
