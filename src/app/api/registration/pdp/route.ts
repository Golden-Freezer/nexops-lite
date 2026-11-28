// /api/registration/pdp — 상세페이지 6단계 생성 잡
// POST: 잡 생성(202 { jobId }) — 실행은 [jobId]/run 분할 호출이 담당
// GET: 잡 목록 (user_id 격리)
//
// 오너 전용. 설계문서 DESIGN-NEXFIT-GENERATORS-20260809 §6.2 계약.
// 응답은 Phase 1의 { data } 래핑이 아니라 언랩 형태({ jobId }/{ jobs }) — pdp-client.ts 계약.

import { NextRequest, NextResponse } from 'next/server'
import { requireOwner } from '@/lib/auth/clerk'
import { createAdminClient } from '@/lib/supabase/admin'
import { ALL_IMAGE_MODELS, isPdpImageModel, type ImageModel } from '@/lib/agents/image/types'
import { createPdpJob, listPdpJobs } from '@/lib/registration/pdp-jobs'
import {
  isPdpModelBatch,
  resolveNewBatchImageModel,
  splitModelBatchKeys,
  type PdpModelBatch,
} from '@/lib/registration/pdp-model-batch'
import { snapshotPdpRoutes } from '@/lib/registration/pdp-model-routes'
import { resolveJobModelBackend, resolveJobSubscriptionStop } from '@/lib/registration/pdp-subscription'
import { resolveJobDraftLink } from '@/lib/registration/job-draft-link'
import { normalizeSpecInputs } from '@/lib/registration/spec-inputs'
import { cleanSourcePhotoRoles } from '@/lib/registration/source-photo-roles'
import { attachCollectedReviews } from '@/lib/registration/reviews/collected-reviews'
import { attachOwnSales } from '@/lib/registration/own-sales-load'
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
  /** 'test'=시험 잡(시험 풀로 센다). 이 라우트는 오너 전용이다(requireOwner) */
  costPool?: string
  /** 모델 배치(R03) — 'now'(기본)·'new'. 새 배치는 이미지 모델도 새 배치 값(MS 2k)으로 정한다 */
  modelBatch?: string
}

export async function POST(req: NextRequest) {
  try {
    const userId = await requireOwner()
    const body = (await req.json()) as CreateBody

    // 모델 배치 예약 키는 화면이 보내도 받지 않는다 — 배치는 modelBatch 칸으로만 정한다(pdp-model-batch)
    const specSheet =
      body.specSheet && typeof body.specSheet === 'object'
        ? splitModelBatchKeys(body.specSheet as PdpSpecSheet).spec
        : undefined
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
    // 새 잡은 PDP 선택지만(Claude·GPT — Gemini 없음, pdp-model-refresh). 기존 잡은 저장된 모델 그대로 이어 돈다
    if (!isPdpImageModel(body.imageModel)) {
      return NextResponse.json({ error: '지원하지 않는 이미지 모델입니다.' }, { status: 400 })
    }
    // 개정 4(단가 제한 해제): 품질 기본값 high
    const imageQuality = body.imageQuality === 'medium' ? 'medium' : 'high'
    const mode: PdpMode = body.mode === 'premium' ? 'premium' : 'pro'
    // 결정 T-1: 트랙 화이트리스트 — 미지정은 internalized(K4 운영 전환, 오너 2026-11-06 '전환 PR 준비 승인'), 2값 외는 400. 저장은 generation_track 컬럼이
    // SSOT(DDL 20260811210000)이고 spec_sheet에는 키를 남기지 않는다(프롬프트 오염 방지 — T-7).
    const rawTrack = body.generationTrack ?? specSheet.generationTrack
    if (rawTrack !== undefined && !isGenerationTrack(rawTrack)) {
      return NextResponse.json({ error: 'generationTrack은 standard 또는 internalized여야 합니다.' }, { status: 400 })
    }
    const generationTrack = rawTrack ?? 'internalized'
    // 시험 표식 — 'test'만 받는다(그 밖의 값은 400). 없으면 운영 잡
    if (body.costPool !== undefined && body.costPool !== null && body.costPool !== 'test') {
      return NextResponse.json({ error: "costPool은 'test'만 받습니다." }, { status: 400 })
    }
    if (body.modelBatch !== undefined && body.modelBatch !== null && !isPdpModelBatch(body.modelBatch)) {
      return NextResponse.json({ error: 'modelBatch는 now 또는 new여야 합니다.' }, { status: 400 })
    }
    const modelBatch: PdpModelBatch = body.modelBatch === 'new' ? 'new' : 'now'
    // 새 배치 이미지 모델(MS 2k) — 공급자가 아직 없으면 조용히 다른 모델로 넘어가지 않고 400(R05 전)
    let imageModel: ImageModel = body.imageModel
    if (modelBatch === 'new') {
      const resolved = resolveNewBatchImageModel(ALL_IMAGE_MODELS.map((m) => m.id))
      if (!resolved.ok) return NextResponse.json({ error: resolved.error }, { status: 400 })
      imageModel = resolved.model as ImageModel
    }
    // W2a 입력 필드(무게·원산지·추가 스펙·인용 카드·초안 표시)는 계약 한도로 정리한다 — 없으면 그대로(spec-inputs.ts)
    const normalizedSpecSheet = withSourcePhotoRoles(normalizeSpecInputs(stripGenerationTrackKey(specSheet)), sourceImages)

    const db = createAdminClient()

    // draft 연결 시 소유·사업장 일치 검증, 사업장 미지정이면 초안 사업장 상속 (job-draft-link.ts)
    const link = await resolveJobDraftLink(db, userId, { draftId: body.draftId, businessId: body.businessId })
    if (!link.ok) return NextResponse.json({ error: link.error }, { status: link.status })

    // 리뷰 받을 쿠팡 상품 번호가 있으면 그때까지 받은 수집 리뷰를 읽어 경쟁사 리뷰로 스냅숏한다(읽기만 — 엑셀이 있으면 엑셀, collected-reviews.ts)
    const now = new Date()
    const withReviews = await attachCollectedReviews(db, userId, normalizedSpecSheet, now)
    // 우리 판매량(J51) — 고른 등록상품ID가 있으면 잡 사업장의 판매장부를 읽어 판매 수 × 묶음 수량을 스냅숏한다(읽기만, own-sales-load.ts)
    const specForJob = await attachOwnSales(db, userId, link.businessId, withReviews, now)

    const jobBackend = resolveJobModelBackend(modelBatch)
    const job = await createPdpJob(db, userId, {
      draftId: link.draftId,
      businessId: link.businessId,
      specSheet: specForJob,
      sourceImages,
      imageModel,
      imageQuality,
      mode,
      generationTrack,
      ...(body.costPool === 'test' ? { costPool: 'test' as const } : {}),
      // 잡마다 배치·단계 모델 스냅숏(R03) — spec_sheet 예약 키(DDL 없음, 읽을 때 꺼낸다). 구독 표지(R13)는 새 배치 + 작업자 스위치
      // (NEXOPS_PDP_SUBSCRIPTION_WORKER=on, 오너 손)일 때만 — 없으면 키를 붙이지 않는다(지금과 같은 행)
      modelBatch: {
        batch: modelBatch,
        snapshot: { ...snapshotPdpRoutes(modelBatch) },
        backend: jobBackend,
        // 구독 멈춤 표지(AX-CT-29) — 구독 표지 잡 + env NEXOPS_PDP_SUBSCRIPTION_STOP=on일 때만. 아니면 키를 붙이지 않는다(지금과 같은 행)
        ...(resolveJobSubscriptionStop(jobBackend) ? { subscriptionStop: true } : {}),
      },
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

/**
 * 원천 사진 역할(결정 카드 c12) — 보낸 sourceImages에 있는 주소·알려진 역할만 남기고, 남은 게 없으면 키를 뺀다(지금과 같은 행).
 * sourceImages 순서·검증은 그대로다(역할은 순서를 바꾸지 않는다)
 */
function withSourcePhotoRoles(spec: PdpSpecSheet, sourceImages: readonly string[]): PdpSpecSheet {
  if (!('sourcePhotoRoles' in spec)) return spec
  const { sourcePhotoRoles, ...rest } = spec
  const roles = cleanSourcePhotoRoles(sourcePhotoRoles, sourceImages)
  return roles.length > 0 ? { ...rest, sourcePhotoRoles: roles } : rest
}
