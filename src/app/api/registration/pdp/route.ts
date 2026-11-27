// /api/registration/pdp — 상세페이지 6단계 생성 잡
// POST: 잡 생성(202 { jobId }) — 실행은 [jobId]/run 분할 호출이 담당
// GET: 잡 목록 (user_id 격리)
//
// 오너 전용. 설계문서 DESIGN-NEXFIT-GENERATORS-20260809 §6.2 계약.
// 응답은 Phase 1의 { data } 래핑이 아니라 언랩 형태({ jobId }/{ jobs }) — pdp-client.ts 계약.

import { NextRequest, NextResponse } from 'next/server'
import { requireOwner } from '@/lib/auth/clerk'
import { createAdminClient } from '@/lib/supabase/admin'
import { isImageModel } from '@/lib/agents/image/types'
import { createPdpJob, listPdpJobs } from '@/lib/registration/pdp-jobs'
import {
  PDP_MAX_SOURCE_IMAGES,
  isGenerationTrack,
  isValidSourceImageCount,
  stripGenerationTrackKey,
  type PdpMode,
  type PdpSpecSheet,
} from '@/lib/registration/pdp-state'

export const dynamic = 'force-dynamic'

interface CreateBody {
  draftId?: string
  businessId?: string
  specSheet?: unknown
  sourceImages?: unknown
  imageModel?: string
  imageQuality?: string
  mode?: string
  generationTrack?: string
}

export async function POST(req: NextRequest) {
  try {
    const userId = await requireOwner()
    const body = (await req.json()) as CreateBody

    const specSheet = body.specSheet as PdpSpecSheet | undefined
    if (!specSheet || typeof specSheet !== 'object' || !specSheet.productName?.trim()) {
      return NextResponse.json({ error: '상품명(specSheet.productName)은 필수입니다.' }, { status: 400 })
    }
    const sourceImages = Array.isArray(body.sourceImages)
      ? body.sourceImages.map((u) => String(u).trim()).filter(Boolean)
      : []
    if (!isValidSourceImageCount(sourceImages.length)) {
      return NextResponse.json({ error: `참조 이미지는 1~${PDP_MAX_SOURCE_IMAGES}장이어야 합니다.` }, { status: 400 })
    }
    // 서버가 fetch하는 URL이므로 http(s)만 허용 (내부 주소 등 비정상 입력 차단)
    if (sourceImages.some((u) => !/^https?:\/\//i.test(u))) {
      return NextResponse.json({ error: '참조 이미지는 http(s) URL이어야 합니다.' }, { status: 400 })
    }
    if (!isImageModel(body.imageModel)) {
      return NextResponse.json({ error: '지원하지 않는 이미지 모델입니다.' }, { status: 400 })
    }
    // 개정 4(단가 제한 해제): 품질 기본값 high
    const imageQuality = body.imageQuality === 'medium' ? 'medium' : 'high'
    const mode: PdpMode = body.mode === 'premium' ? 'premium' : 'pro'
    // 결정 T-1: 트랙 화이트리스트 — 미지정은 standard, 2값 외는 400. 저장은 generation_track 컬럼이
    // SSOT(DDL 20260811210000)이고 spec_sheet에는 키를 남기지 않는다(프롬프트 오염 방지 — T-7).
    const rawTrack = body.generationTrack ?? specSheet.generationTrack
    if (rawTrack !== undefined && !isGenerationTrack(rawTrack)) {
      return NextResponse.json({ error: 'generationTrack은 standard 또는 internalized여야 합니다.' }, { status: 400 })
    }
    const generationTrack = rawTrack ?? 'standard'
    const normalizedSpecSheet = stripGenerationTrackKey(specSheet)

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

    const job = await createPdpJob(db, userId, {
      draftId,
      businessId,
      specSheet: normalizedSpecSheet,
      sourceImages,
      imageModel: body.imageModel,
      imageQuality,
      mode,
      generationTrack,
    })
    return NextResponse.json({ jobId: job.id }, { status: 202 })
  } catch (error: unknown) {
    if (error instanceof NextResponse) return error
    const message = error instanceof Error ? error.message : '서버 오류'
    console.error('registration pdp POST error:', error)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function GET() {
  try {
    const userId = await requireOwner()
    const jobs = await listPdpJobs(createAdminClient(), userId)
    return NextResponse.json({ jobs })
  } catch (error: unknown) {
    if (error instanceof NextResponse) return error
    const message = error instanceof Error ? error.message : '서버 오류'
    console.error('registration pdp GET error:', error)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
