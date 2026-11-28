// /api/registration/pdp/[jobId]/copy/regenerate — 편집기 카피 재생성(pdp-copy-regen-api, 계약 src/lib/registration/pdp-copy-regen.ts)
// GET  ?sectionType=… — 사전 조회(쓰기 없음). 상한 추정과 막힌 사유를 blocked로 돌려준다(텍스트·메모는 상한을 가정).
// POST { sectionType, elementName?, currentText, tone?, note? } — 즉시 처리: 진행 잠금 → 1콜(copy/editor-regen) → 가드 → 통과 후보.
//   copy_sections·final_html·편집기 저장본은 건드리지 않는다(편집기가 고른 후보를 넣고 기존 저장 경로로 저장한다). 잡 cost_usd와
//   section_plan.editor_copy_regen 기록만 남긴다.
// 막히면 409 { error, code }(busy — busyKind images|job·not_ready·budget).

import { NextRequest, NextResponse } from 'next/server'
import { requireOwner } from '@/lib/auth/clerk'
import { createAdminClient } from '@/lib/supabase/admin'
import { checkMonthlyBudget } from '@/lib/agents/budget'
import { callCopyRegenModel, COPY_REGEN_AGENT } from '@/lib/agents/registration/pdp-copy-regen-agent'
import { costPoolContext, usageCostPoolOf } from '@/lib/registration/pdp-cost-pool'
import { claimPdpJobRun, getPdpJob, updatePdpJobIfUnchanged } from '@/lib/registration/pdp-jobs'
import { pdpRoute } from '@/lib/registration/pdp-model-routes'
import { runWithPdpBatch } from '@/lib/registration/pdp-model-batch-context'
import {
  parseCopyRegenPreview,
  parseCopyRegenRequest,
  type CopyRegenBlock,
  type CopyRegenConflictBody,
  type CopyRegenPreviewResponse,
} from '@/lib/registration/pdp-copy-regen'
import {
  buildCopyRegenContext,
  copyRegenBudgetBlock,
  planCopyRegen,
  runCopyRegenFlow,
  type CopyRegenContext,
} from '@/lib/registration/pdp-copy-regen-request'
import type { PdpJobRow } from '@/lib/registration/pdp-state'

export const dynamic = 'force-dynamic'
// 1콜 시간 제한 30초 × 시도 2회 + 저장 — run 라우트 상한(300)보다 짧다
export const maxDuration = 120

function blocked(block: CopyRegenBlock): NextResponse {
  const body: CopyRegenConflictBody = {
    error: block.error,
    code: block.code,
    ...(block.code === 'busy' ? { busy: true as const, busyKind: block.busyKind } : {}),
  }
  return NextResponse.json(body, { status: 409 })
}

/** 잡 상태(완료·잠금) → 월 예산 순서로 막힌 사유. 예산은 막히지 않았을 때만 읽는다 */
async function blockOf(job: PdpJobRow, ctx: CopyRegenContext): Promise<CopyRegenBlock | null> {
  const block = planCopyRegen(job)
  if (block) return block
  return copyRegenBudgetBlock(
    ctx.estimate,
    await checkMonthlyBudget(COPY_REGEN_AGENT, pdpRoute('copy/editor-regen').model, usageCostPoolOf(job))
  )
}

function fail(error: unknown, method: string): NextResponse {
  if (error instanceof NextResponse) return error
  const message = error instanceof Error ? error.message : '서버 오류'
  console.error(`registration pdp copy regenerate ${method} error:`, error)
  return NextResponse.json({ error: message }, { status: 500 })
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ jobId: string }> }) {
  try {
    const userId = await requireOwner()
    const { jobId } = await params
    const parsed = parseCopyRegenPreview({ sectionType: req.nextUrl.searchParams.get('sectionType') })
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })
    const job = await getPdpJob(createAdminClient(), userId, jobId)
    if (!job) return NextResponse.json({ error: '잡을 찾을 수 없습니다.' }, { status: 404 })
    const ctx = buildCopyRegenContext(job, parsed.value)
    const res: CopyRegenPreviewResponse = {
      sectionType: parsed.value.sectionType,
      estimate: ctx.estimate,
      blocked: await blockOf(job, ctx),
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
    const parsed = parseCopyRegenRequest(await req.json().catch(() => null))
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })
    const db = createAdminClient()
    const job = await getPdpJob(db, userId, jobId)
    if (!job) return NextResponse.json({ error: '잡을 찾을 수 없습니다.' }, { status: 404 })
    const ctx = buildCopyRegenContext(job, parsed.value)
    const block = await blockOf(job, ctx)
    if (block) return blocked(block)

    const runContext = {
      userId,
      ...(job.business_id ? { businessId: job.business_id } : {}),
      stage: 'editor-copy-regen',
      ...costPoolContext(job),
    }
    // 잡 모델 배치로 감싼다(R03 — copy/editor-regen은 두 배치가 같은 값이다)
    const result = await runWithPdpBatch(job.model_batch ?? 'now', () =>
      runCopyRegenFlow(job, parsed.value, ctx, {
        claim: (j) => claimPdpJobRun(db, userId, j),
        callModel: (prompts) => callCopyRegenModel(prompts, runContext),
        saveIfUnchanged: (j, patch) => updatePdpJobIfUnchanged(db, userId, j, patch),
        reload: () => getPdpJob(db, userId, jobId),
      })
    )
    if (result.kind === 'blocked') return blocked(result.block)
    return NextResponse.json(result.response)
  } catch (error: unknown) {
    return fail(error, 'POST')
  }
}
