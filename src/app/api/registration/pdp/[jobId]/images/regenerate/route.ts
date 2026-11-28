// /api/registration/pdp/[jobId]/images/regenerate — 편집기 이미지 재생성(pdp-image-regen-api, 계약 src/lib/registration/pdp-image-regen.ts)
// GET  ?section=…&style=… — 사전 조회(쓰기 없음). 비용 추정과 막힌 사유를 blocked로 돌려준다(모달이 확인 전에 보여 준다).
// POST { section, style?, note?, keep?, useCurrent? } — 그 섹션에 재생성 대기를 적고 잡을 images 단계로 되돌린다. 생성은 images 단계의 재생성 큐가
//   한다: runner 'web'이면 화면이 기존 run 라우트를 done까지 부르고, 'local'(codex-image)이면 로컬 실행기가 진행한다.
// 막히면 409 { error, code }(busy·already_pending·not_ready·other_work·budget). final_html·편집기 저장본은 건드리지 않는다.

import { NextRequest, NextResponse } from 'next/server'
import { requireOwner } from '@/lib/auth/clerk'
import { createAdminClient } from '@/lib/supabase/admin'
import { checkMonthlyBudget } from '@/lib/agents/budget'
import { usageCostPoolOf } from '@/lib/registration/pdp-cost-pool'
import { getPdpJob, updatePdpJobIfUnchanged } from '@/lib/registration/pdp-jobs'
import { planEditorRegen, regenBudgetBlock, type RegenPlan } from '@/lib/registration/pdp-image-regen-request'
import {
  isRevertible,
  markEditorRegen,
  parseRegenRequest,
  type RegenPreviewResponse,
  type RegenRequestBody,
  type RegenResponse,
} from '@/lib/registration/pdp-image-regen'
import { PDP_STEP_PROGRESS, type PdpJobRow } from '@/lib/registration/pdp-state'

export const dynamic = 'force-dynamic'

const IMAGE_AGENT = 'registration/pdp-image'

type Checked = { job: PdpJobRow; body: RegenRequestBody; plan: Extract<RegenPlan, { ok: true }> }

/** 소유 검증(user_id) → 요청 검사 → 예산. 400·404는 응답으로 돌려준다 */
async function check(userId: string, jobId: string, raw: unknown): Promise<Checked | NextResponse> {
  const parsed = parseRegenRequest(raw)
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })
  const job = await getPdpJob(createAdminClient(), userId, jobId)
  if (!job) return NextResponse.json({ error: '잡을 찾을 수 없습니다.' }, { status: 404 })
  const plan = planEditorRegen(job, parsed.value)
  if (!plan.ok) return NextResponse.json({ error: plan.error }, { status: plan.status })
  if (!plan.block) {
    const budget = await checkMonthlyBudget(IMAGE_AGENT, undefined, usageCostPoolOf(job))
    const block = regenBudgetBlock(plan.estimate, budget)
    if (block) return { job, body: parsed.value, plan: { ...plan, block } }
  }
  return { job, body: parsed.value, plan }
}

function fail(error: unknown, method: string): NextResponse {
  if (error instanceof NextResponse) return error
  const message = error instanceof Error ? error.message : '서버 오류'
  console.error(`registration pdp image regenerate ${method} error:`, error)
  return NextResponse.json({ error: message }, { status: 500 })
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ jobId: string }> }) {
  try {
    const userId = await requireOwner()
    const { jobId } = await params
    const query = req.nextUrl.searchParams
    const checked = await check(userId, jobId, {
      section: query.get('section') ?? undefined,
      style: query.get('style') ?? undefined,
    })
    if (checked instanceof NextResponse) return checked
    const { job, plan, body } = checked
    const res: RegenPreviewResponse = {
      section: body.section,
      runner: plan.runner,
      estimate: plan.estimate,
      blocked: plan.block,
      revertible: isRevertible(job.section_images.find((e) => e.section === body.section)),
    }
    return NextResponse.json(res)
  } catch (error: unknown) {
    return fail(error, 'GET')
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ jobId: string }> }) {
  try {
    const userId = await requireOwner()
    const { jobId } = await params
    const checked = await check(userId, jobId, await req.json().catch(() => null))
    if (checked instanceof NextResponse) return checked
    const { job, body, plan } = checked
    if (plan.block) {
      return NextResponse.json(
        { error: plan.block.error, code: plan.block.code, ...(plan.block.code === 'busy' ? { busy: true } : {}) },
        { status: 409 }
      )
    }
    // 읽은 뒤 바뀌지 않았을 때만 쓴다 — 그사이 run이 진행을 쥐었거나 저장했으면 busy
    const updated = await updatePdpJobIfUnchanged(createAdminClient(), userId, job, {
      sectionImages: markEditorRegen(job.section_images, body, new Date().toISOString()),
      currentStep: 'images',
      progress: PDP_STEP_PROGRESS.images,
      // 단계 실패로 멈춘 잡의 재요청 — 옛 실패 문구(재시도 횟수 포함)를 비우고 새로 센다
      ...(job.current_step === 'failed' ? { error: null } : {}),
    })
    if (!updated) {
      return NextResponse.json(
        { error: '이 잡을 다른 곳이 진행 중입니다. 잠시 뒤 다시 시도해 주세요.', code: 'busy', busy: true },
        { status: 409 }
      )
    }
    const res: RegenResponse = { job: updated, section: body.section, runner: plan.runner, estimate: plan.estimate }
    return NextResponse.json(res)
  } catch (error: unknown) {
    return fail(error, 'POST')
  }
}
