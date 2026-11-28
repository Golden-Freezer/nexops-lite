/**
 * K 칸 카피 콜이 읽는 앞 단계 글(하네스 J28) — 기획 1장(pageplan, 결정 카드 c10)과 D 원문 카피(copystory, J36). line-plan planTemplateLine이
 * fillSlots 입력에 펼쳐 넣고, 재현 진입점(B J37 칸 글 3사 후보)도 같은 함수로 같은 입력을 만든다. 스위치가 꺼진 잡·글이 없는 잡은 빈 객체라
 * 칸 카피 입력·프롬프트가 지금과 같다. 순수
 */

import type { SlotCopyInput } from '@/lib/agents/registration/prompts/pdp-template-copy-prompts'
import { hasEnrichmentFeature } from '../enrichment-switch'
import type { PdpJobRow, PdpSpecSheet } from '../pdp-state'
import { copyStoryOf } from './copy-story'
import { planSaysOf, type PagePlanBrief } from './page-plan-read'

/**
 * 칸 카피 입력에 더할 칸 — pagePlan은 선택 입력에 기획 요약이 있을 때만(selectLineInputOf가 pageplan 잡만 싣는다), copyStory는 copystory 잡이고
 * 원문 줄이 하나라도 있을 때만. sections는 순서 풀이 결과(칸 카피 콜의 섹션 번호와 같은 차례)다
 */
export function slotCopyReadsOf(
  job: Pick<PdpJobRow, 'analysis' | 'copy_sections'>,
  input: { pagePlan?: PagePlanBrief; spec: Pick<PdpSpecSheet, 'origin'> },
  sections: ReadonlyArray<{ section: string }>
): Pick<SlotCopyInput, 'pagePlan' | 'copyStory'> {
  const out: Pick<SlotCopyInput, 'pagePlan' | 'copyStory'> = {}
  if (input.pagePlan) {
    const { promise, target, hookPromise } = input.pagePlan
    out.pagePlan = { promise, target, hookPromise, says: planSaysOf(input.pagePlan, sections) }
  }
  if (hasEnrichmentFeature(job.analysis, 'copystory')) {
    const story = copyStoryOf(job.copy_sections?.final, sections, input.spec.origin)
    if (Object.keys(story).length > 0) out.copyStory = story
  }
  return out
}
