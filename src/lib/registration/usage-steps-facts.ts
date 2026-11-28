// 사용 순서 사실 블록(적용 G-U1, 통합 11-03 19:12 DECISION) — 순수 함수.
//
// 판매자가 입력한 사용 순서(usageSteps, C1 입력 칸)는 프롬프트 스펙 JSON에서 빠져(SPEC_PROMPT_EXCLUDED_KEYS) 카피가 보지 못했다.
// 디자인 컷 잡이고 정리 뒤 2~5단계(inputSlotsOf — 한 단계라도 규제 표현이면 통째로 없음)일 때만, 옵션·상품 사실 블록 뒤에 같은 블록을
// 모든 카피 콜(Stage 1·premium·2·3·pointCards 보충)에 준다. 그 밖의 잡은 빈 문자열이라 프롬프트가 지금 그대로다(R 동결).
// D는 사용법 글(T5)과 howto 컷이 같은 카피 howTo를 쓰므로 둘이 함께 이 순서를 따른다. K how_to 템플릿 글은 슬롯 카피라 닿지 않는다(K 장부 na).

import type { UsageStep } from './input-slots'
import { inputSlotsOf } from './input-slots-read'
import type { PdpSpecSheet } from './pdp-state'

/** 카피에 넘길 사용 순서 — 디자인 컷 잡이 아니거나 입력이 없으면(정리·규제 표현 거르기 뒤) 빈 목록 */
export function usageStepsForCopy(spec: PdpSpecSheet | undefined, designcut: boolean): UsageStep[] {
  return designcut && spec ? inputSlotsOf(spec).usageSteps : []
}

/** 카피 프롬프트 블록 — 단계가 없으면 빈 문자열(프롬프트 불변) */
export function buildUsageStepsFactsBlock(steps: readonly UsageStep[]): string {
  if (steps.length === 0) return ''
  return [
    `## [사용 순서 — 판매자 입력 ${steps.length}단계, howTo는 이 단계 수·순서 그대로 쓴다]`,
    ...steps.map((step, i) => `${i + 1}. ${step.title}${step.description ? ` — ${step.description}` : ''}`),
    '- howTo의 i번째 항목이 위 i번째 단계다. 단계를 더하거나 빼거나 순서를 바꾸지 않는다.',
    '- step·description은 위 글의 뜻만 쓴다. 글자 수 규칙에 맞게 줄이거나 다듬어도 되지만, 위에 없는 동작·효능·수치를 지어내지 않는다.',
  ].join('\n')
}

/** 최종 howTo 단계 수가 입력과 다르면 경고 한 줄 — 고치지 않는다(사용법 글과 컷은 howTo를 그대로 쓴다) */
export function usageStepsWarning(copy: { howTo?: unknown } | null | undefined, steps: readonly UsageStep[]): string | null {
  if (steps.length === 0) return null
  const count = Array.isArray(copy?.howTo) ? copy.howTo.length : 0
  return count === steps.length ? null : `[UsageSteps] 입력 사용 순서 ${steps.length}단계인데 최종 howTo ${count}단계 — 글·컷은 howTo 그대로`
}
