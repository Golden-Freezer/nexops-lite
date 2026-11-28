/**
 * K 칸 카피 화면 글 가드 재료(결정 카드 c03, 하네스 harness-cards J02) — 잡에서 D 카피와 같은 가드를 만든다.
 * - guardBlock: 학부모 대리 구매(buildParentProxyCopyBlock)·후기 사용 범위(reviewClaimBlockFor)·연령 제한(buildAgeComplianceCopyBlock, 칸용)
 *   블록을 D 1단 그라운딩과 같은 차례로(연령 블록이 마지막 — 우선) 이어 붙인다. K 칸 카피 프롬프트 규칙 뒤에 붙는다.
 * - guard: 칸 글 검사 재료(slot-guard.ts) — 연령 제한 최소 연령·학부모 시점 검사·경쟁사 리뷰 재현 조각.
 * 해당하는 것이 없는 잡은 빈 객체라 K 프롬프트·검사가 지금과 바이트까지 같다.
 */

import { buildAgeComplianceCopyBlock, isAgeRestricted } from './compliance-gate'
import { buildParentProxyCopyBlock } from './parent-proxy-copy'
import { audienceOf } from './pdp-enrichment-stage'
import { competitorEchoGuard } from './pdp-review-stage'
import type { PdpJobRow } from './pdp-state'
import { reviewClaimBlockFor } from './reviews/review-claims'
import type { SlotTextGuard } from './templatelib/slot-guard'

export interface SlotCopyGuardInput {
  guardBlock?: string
  guard?: SlotTextGuard
}

export function slotCopyGuardOf(job: PdpJobRow): SlotCopyGuardInput {
  const spec = job.spec_sheet
  const audience = audienceOf(job)
  const guard: SlotTextGuard = {
    minAge: isAgeRestricted(spec) ? spec.minAgeYears! : null,
    parentView: Boolean(audience && !audience.ageGate),
    echo: competitorEchoGuard(job),
  }
  const block = [buildParentProxyCopyBlock(audience), reviewClaimBlockFor(spec), buildAgeComplianceCopyBlock(spec, { slots: true })].filter(Boolean).join('\n\n')
  const checks = guard.minAge !== null || guard.parentView || guard.echo !== null
  return { ...(block ? { guardBlock: block } : {}), ...(checks ? { guard } : {}) }
}
