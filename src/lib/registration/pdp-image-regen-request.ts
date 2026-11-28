/**
 * 편집기 재생성 요청 검사(pdp-image-regen-api) — 라우트의 GET(사전 조회)·POST(요청)가 같이 쓴다. 쓰기·LLM 없음.
 * 막히는 사유(RegenBlock)는 다섯 가지다: 진행 잠금(busy)·이미 대기(already_pending)·완료 전 잡(not_ready)·
 * 요청 밖 일(other_work)·월 예산(budget). 태스크를 셀 수 없는 요청(모르는 섹션·이미지 없음)은 400이다.
 * 생성 단계 판정(resolveStepToRun)이 pdp-pipeline에 있어 이 파일을 나눴다 — pdp-image-stage가 가져가는 pdp-image-regen은
 * 파이프라인을 import하지 않는다(순환 방지).
 */

import type { BudgetStatus } from '@/lib/agents/budget'
import { designcutEnabled } from './internalized/designcut-plan'
import { optionSpecOf } from './internalized/persuasion-signals'
import { optionPhotoCoverage, optionPhotoUrls } from './options/option-photo-guard'
import { buildImageTasks, buildKnownImageTasks, type ImageTask } from './pdp-image-tasks'
import { isPdpJobLeased } from './pdp-jobs'
import { resolveStepToRun } from './pdp-pipeline'
import {
  estimateEditorRegen,
  isEditorRegenPending,
  regenRunnerOf,
  type RegenBlock,
  type RegenEstimate,
  type RegenRequestBody,
  type RegenRunner,
} from './pdp-image-regen'
import type { PdpJobRow } from './pdp-state'

export type RegenPlan =
  | { ok: false; status: 400; error: string }
  | { ok: true; task: ImageTask; estimate: RegenEstimate; runner: RegenRunner; block: RegenBlock | null }

/**
 * 되돌렸을 때 이 요청(과 이미 받은 편집기 요청) 말고 다른 이미지 일·기록이 도는가 — 완료 뒤 코드가 바뀌어 새 컷 키·장식 대상·
 * 디자인 컷 계획이 생긴 옛 잡, 게이트 재생성 대기가 남은 잡, 식별 카드가 없는 잡(images가 유료 판독을 다시 한다).
 * 되돌리면 요청 밖 생성·기록까지 돌기 때문에 거절한다. 편집기 요청의 몫(대기 중인 재생성, 바뀐 컷의 장식 다시 고르기)은 뺀다.
 */
export function otherImageWorkReason(job: PdpJobRow): string | null {
  const probe: PdpJobRow = {
    ...job,
    section_images: job.section_images.map((e) => {
      if (isEditorRegenPending(e)) return { ...e, pendingRegen: false }
      if (e.editorRegen?.status === 'done' && !e.annotationStatus) return { ...e, annotationStatus: 'skipped' as const }
      return e
    }),
  }
  if (!probe.section_plan.designcut && designcutEnabled(probe)) {
    return '디자인 컷 계획이 기록되지 않은 잡이라 지금 다시 만들면 계획을 새로 써 편집기 문서가 바뀝니다.'
  }
  // images 단계와 같은 참조 규칙 — 원천 사진, 옵션 사진 가드가 걸린 잡은 실물 옵션 사진(loadGenerationRefs)
  const spec = optionSpecOf(probe.spec_sheet, probe.analysis)
  const hasRefs =
    probe.source_images.length > 0 || (optionPhotoCoverage(spec) !== null && optionPhotoUrls(spec).length > 0)
  if (probe.design_prompts.identity_card === undefined && hasRefs) {
    return '식별 카드가 없는 잡이라 지금 다시 만들면 유료 식별 판독도 함께 돕니다.'
  }
  if (resolveStepToRun(probe) !== 'done') {
    return '이 잡에 끝나지 않은 다른 이미지 작업이 있어 지금 다시 만들면 요청하지 않은 생성까지 돕니다.'
  }
  return null
}

export function hasOtherImageWork(job: PdpJobRow): boolean {
  return otherImageWorkReason(job) !== null
}

/**
 * 진행 잠금 중인가 — 잡 모듈의 판정(기한이 여유 30초보다 더 남음)보다 엄격하게, 기한이 미래이기만 해도 막는다. 여유 구간에
 * 들어온 요청을 아직 살아 있는 run의 마지막 저장(잠금 조건 없음)이 덮어쓰지 않게. 방금 끝난 run의 시계 차이로 잠깐 busy가
 * 나와도 화면이 다시 부르면 된다.
 */
function isBusy(job: PdpJobRow, now: number): boolean {
  if (isPdpJobLeased(job, now)) return true
  const at = Date.parse(job.updated_at)
  return Number.isFinite(at) && at > now
}

export function planEditorRegen(job: PdpJobRow, body: RegenRequestBody, now = Date.now()): RegenPlan {
  const completed = Boolean(job.copy_sections.final && job.final_html)
  // 지금 태스크에 없으면 아는 섹션 키(lean 전 전체)에서 찾는다 — 골격 밖 섹션의 사진을 편집기에서 새로 만든다(W5b).
  // 이미지가 없거나 생성이 실패한 섹션도 받는다(새로 만든다). 모르는 키만 400
  const task = completed
    ? (buildImageTasks(job).find((t) => t.section === body.section) ??
      buildKnownImageTasks(job).find((t) => t.section === body.section))
    : undefined
  if (completed && !task) return { ok: false, status: 400, error: `이 잡에 없는 이미지 섹션입니다: ${body.section}` }
  const entry = job.section_images.find((e) => e.section === body.section)

  const fallbackTask: ImageTask = task ?? {
    section: body.section,
    prompt: '',
    aspectRatio: '1:1',
    effectOnly: false,
    skipGate: false,
  }
  const base = {
    ok: true as const,
    task: fallbackTask,
    estimate: estimateEditorRegen(job, fallbackTask),
    runner: regenRunnerOf(job),
  }
  const block = (code: RegenBlock['code'], error: string) => ({ ...base, block: { code, error } })

  if (!completed) return block('not_ready', '생성이 한 번 끝난 잡만 이미지를 다시 만들 수 있습니다.')
  if (isBusy(job, now)) return block('busy', '이 잡을 다른 곳이 진행 중입니다. 잠시 뒤 다시 시도해 주세요.')
  // 실패로 멈춘 잡(단계 실패 3회)의 대기는 처리되지 않으므로 다시 요청할 수 있게 둔다(요청이 기록을 새로 쓰고 images로 되돌린다)
  if (isEditorRegenPending(entry) && job.current_step !== 'failed') {
    return block('already_pending', '이 이미지는 이미 다시 만드는 중입니다.')
  }
  const otherWork = otherImageWorkReason(job)
  if (otherWork) return block('other_work', otherWork)
  return { ...base, block: null }
}

/**
 * 월 예산 — 지출을 읽지 못했거나(degraded — 게이트·장식 비전 콜이 호출마다 막힌다) 한도가 이미 찼으면 막고, 과금 모델은 남은
 * 한도(전역·에이전트 중 작은 쪽)가 게이트 재생성까지 포함한 추정보다 작으면 막는다. 대기 중인 다른 요청의 비용은 더하지 않는다 —
 * 실제 초과는 run 안 지출 예약이 막는다(막힌 편집기 요청은 failed로 끝난다).
 */
export function regenBudgetBlock(estimate: RegenEstimate, budget: BudgetStatus): RegenBlock | null {
  if (budget.degraded) {
    return {
      code: 'budget',
      error: '월 AI 예산 지출을 읽지 못해 지금은 다시 만들 수 없습니다. 잠시 뒤 다시 시도해 주세요.',
    }
  }
  if (!budget.allowed) {
    return {
      code: 'budget',
      error: `월 AI 예산 한도 — 당월 지출 $${budget.spentUsd.toFixed(2)} / $${budget.budgetUsd}`,
    }
  }
  if (!estimate.billed) return null
  const agentLeft =
    budget.agentBudgetUsd != null && budget.agentSpentUsd != null
      ? budget.agentBudgetUsd - budget.agentSpentUsd
      : Number.POSITIVE_INFINITY
  const headroom = Math.min(budget.budgetUsd - budget.spentUsd, agentLeft)
  if (estimate.maxImageUsd <= headroom) return null
  return {
    code: 'budget',
    error: `월 AI 예산 남은 한도($${Math.max(0, headroom).toFixed(2)})가 이 재생성 최대 비용($${estimate.maxImageUsd.toFixed(2)})보다 작습니다.`,
  }
}
