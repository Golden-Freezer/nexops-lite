// /api/registration/pdp/auto-fill — 상세페이지 생성 화면 자동 작성(PDP-W2W3 계약 v1 §2-2). 오너 전용, 잡 없음·DB 쓰기 없음
// (ai_usage_log 기록은 공용 callAgent가 한다 — agent·stage registration/pdp-auto-fill).
// POST { productName, category?, brandName?, specSheet?, reviewsText?, imageUrls? } → 200 { suggestions, model, costUsd, warnings? }
//   제안만 돌려준다. 빈 칸만 채울지·바꿀지는 화면이 정한다(계약 §4).
// 막히면: 400 입력 오류, 409 { error, code: 'budget' } 월 예산(지출을 읽지 못한 degraded·호출 직전 공용 예산 차단 포함),
//   502 모델 호출·파싱 실패(costUsd는 callAgent가 준 값 — 끝내 실패하면 0, 시도별 비용은 ai_usage_log).

import { NextRequest, NextResponse } from 'next/server'
import { requireOwner } from '@/lib/auth/clerk'
import { checkMonthlyBudget } from '@/lib/agents/budget'
import { callAutoFillModel, fetchAutoFillImage } from '@/lib/agents/registration/pdp-auto-fill-agent'
import type { VisionImage } from '@/lib/agents/registration/thumbnail-vision-agent'
import { pdpRoute } from '@/lib/registration/pdp-model-routes'
import {
  AUTO_FILL_AGENT,
  normalizeAutoFillSuggestions,
  parseAutoFillRequest,
  type AutoFillResponse,
} from '@/lib/registration/pdp-auto-fill'

export const dynamic = 'force-dynamic'
// 사진 내려받기(병렬, 장당 10초) + 1콜 시간 제한 30초 × 시도 2회
export const maxDuration = 90

/** 화면 요청이라 참조 이미지 기본 상한(25초)보다 짧게 — 못 읽은 사진은 빼고 쓴다 */
const IMAGE_FETCH_TIMEOUT_MS = 10_000

export async function POST(req: NextRequest) {
  try {
    const userId = await requireOwner()
    const parsed = parseAutoFillRequest(await req.json().catch(() => null))
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })
    const request = parsed.value

    const route = pdpRoute('copy/auto-fill')
    const budget = await checkMonthlyBudget(AUTO_FILL_AGENT, route.model)
    if (budget.degraded) {
      return NextResponse.json(
        {
          error: '월 AI 예산 지출을 읽지 못해 지금은 자동 작성을 할 수 없습니다. 잠시 뒤 다시 시도해 주세요.',
          code: 'budget',
        },
        { status: 409 }
      )
    }
    if (!budget.allowed) {
      return NextResponse.json(
        { error: `월 AI 예산 한도 — 당월 지출 $${budget.spentUsd.toFixed(2)} / $${budget.budgetUsd}`, code: 'budget' },
        { status: 409 }
      )
    }

    const fetched = await Promise.all(request.imageUrls.map((url) => fetchAutoFillImage(url, IMAGE_FETCH_TIMEOUT_MS)))
    const images = fetched.filter((image): image is VisionImage => image !== null)
    const runContext = { userId, stage: AUTO_FILL_AGENT }
    const result = await callAutoFillModel(request, images, runContext)
    // 라우트 확인 뒤 공용 callAgent가 예산으로 막았다(동시 요청·지출 조회 실패) — 같은 409로 돌려준다
    if (!result.ok && result.stage === 'budget') {
      return NextResponse.json({ error: result.error, code: 'budget' }, { status: 409 })
    }
    if (!result.ok) {
      return NextResponse.json(
        { error: `자동 작성에 실패했습니다: ${result.error}`, costUsd: result.costUsd },
        { status: 502 }
      )
    }

    const { suggestions, warnings } = normalizeAutoFillSuggestions(result.raw)
    const missed = request.imageUrls.length - images.length
    if (missed > 0) warnings.push(`사진 ${missed}장을 읽지 못해 빼고 작성했습니다.`)
    const body: AutoFillResponse = {
      suggestions,
      model: route.model,
      costUsd: result.costUsd,
      ...(warnings.length ? { warnings } : {}),
    }
    return NextResponse.json(body)
  } catch (error: unknown) {
    if (error instanceof NextResponse) return error
    const message = error instanceof Error ? error.message : '서버 오류'
    console.error('registration pdp auto-fill POST error:', error)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
