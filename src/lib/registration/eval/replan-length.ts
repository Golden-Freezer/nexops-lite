/**
 * 저장된 잡을 지금 코드의 길이 계획으로 다시 세운다(render-check·길이 측정 전용, 메모리에서만). 저장된 잡은 계획이 기록돼 있어 그대로 그리면 새 구조가 보이지 않는다.
 * - 나누기(R) 잡: 설계 골격을 지금 플래너로 다시 낸다 — 카피는 저장된 것. 채움 섹션의 레이아웃 선택은 없어 기본 레이아웃으로 그려진다
 * - 디자인 컷(D) 잡: 컷 목적·디자인 컷 계획을 지우고 다시 세운다(이미지 단계 첫 run과 같은 순서)
 * - 새로 필요한 컷은 저장된 컷을 돌려 가며 빌린다(자리와 배치를 보는 용도 — 사진 내용은 그 컷이 아니다).
 * LLM·이미지 호출 없음, DB에 쓰지 않는다.
 */

import { buildDesigncutPlan, designcutEnabled } from '../internalized/designcut-plan'
import { planExtraShotsForLength, pointCutsOf, shotdivEnabled } from '../internalized/shot-diversity'
import { applyDesignSkeleton, resolveDesignSkeleton } from '../pdp-enrichment-stage'
import { buildImageTasks } from '../pdp-image-tasks'
import type { PdpJobRow, SectionPlan } from '../pdp-state'
import { mergeManualStrategy } from '../pdp-strategy-contract'

function replanDesigncut(job: PdpJobRow): PdpJobRow {
  const plan: SectionPlan = { ...job.section_plan }
  delete plan.designcut
  delete plan.extra_shots
  const cleared = { ...job, section_plan: plan }
  const extra_shots = shotdivEnabled(cleared) ? planExtraShotsForLength(cleared, pointCutsOf(cleared)) : null
  const measured = extra_shots ? { ...cleared, section_plan: { ...plan, extra_shots } } : cleared
  const designcut = buildDesigncutPlan(measured)
  return { ...measured, section_plan: { ...measured.section_plan, ...(designcut ? { designcut } : {}) } }
}

function replanSkeleton(job: PdpJobRow): PdpJobRow {
  const strategy = mergeManualStrategy(job.analysis.recommended_strategy_contract ?? {}, job.spec_sheet, [])
  return { ...job, section_plan: applyDesignSkeleton(job.section_plan, resolveDesignSkeleton(job, strategy)) }
}

/** 새 계획이 그리는데 저장된 사진이 없는 컷에 저장된 컷을 돌려 가며 빌려 준다. 빌린 수를 돌려준다 */
function withBorrowedCuts(job: PdpJobRow): { job: PdpJobRow; borrowed: string[] } {
  const saved = job.section_images.filter((e) => e.url)
  const have = new Set(saved.map((e) => e.section))
  const borrowed = buildImageTasks(job)
    .map((t) => t.section)
    .filter((section) => !have.has(section))
  if (saved.length === 0) return { job, borrowed: [] }
  const lent = borrowed.map((section, i) => ({ section, url: saved[i % saved.length].url, prompt: '' }))
  return { job: { ...job, section_images: [...saved, ...lent] }, borrowed }
}

export function replanJobForLength(job: PdpJobRow): { job: PdpJobRow; borrowed: string[] } {
  return withBorrowedCuts(designcutEnabled(job) ? replanDesigncut(job) : replanSkeleton(job))
}
