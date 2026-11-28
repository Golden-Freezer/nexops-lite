/**
 * K가 읽는 기획 1장(결정 카드 c10, 하네스 J28 — 오너 11-07 승인 카드 '리서치 → K 앞 기획 1장', 통합 11-10 decide 2). pageplan 스위치 잡만
 * 새 단계 기획(research_result.page_plan, 새 배치 + newstages 잡에서만 생긴다)이 끝난(done) 기록을 K 섹션 구성 콜과 칸 카피 콜이 읽는다.
 * - 구성 콜: 설득 순서(섹션 id·할 말)를 '먼저 고를 섹션'으로 보인다(순서는 지금처럼 코드가 맞춘다).
 * - 칸 카피 콜: 핵심 약속·고객·첫 화면 약속 블록과, 놓인 섹션마다 기획의 '할 말' 한 줄(같은 섹션 id는 나온 차례대로 짝짓는다).
 * 기획이 없거나 실패·건너뜀이면 아무것도 싣지 않아 지금과 같다. 스위치가 꺼진 잡은 이 파일을 거치지 않는다(프롬프트 바이트 그대로). 순수.
 * 기획 글은 모델이 쓴 계획이라 사실 근거가 아니다 — 사실은 칸 카피의 '실을 수 있는 사실' 목록에서만 쓴다(프롬프트 블록이 그렇게 적는다)
 */

import type { ResearchResult } from '../pdp-state'

type PagePlanRecord = NonNullable<ResearchResult['page_plan']>
export type PagePlanDone = Extract<PagePlanRecord, { status: 'done' }>['result']

/** 칸 카피·구성 콜에 싣는 기획 요약 — 글은 앞 단계 기획 그대로이고 길이만 자른다 */
export interface PagePlanBrief {
  promise: string
  target: string
  hookPromise: string
  /** 설득 순서 — 섹션 id와 그 섹션이 할 말(차례대로) */
  steps: ReadonlyArray<{ section: string; say: string }>
}

/** 한 줄 길이 상한 — 기획 글이 길어도 콜 입력이 크게 늘지 않게 한다 */
export const PLAN_LINE_MAX = 120
/** 설득 순서 단계 상한(기획 프롬프트는 6~10단계) */
export const PLAN_STEPS_MAX = 12

const clip = (value: unknown): string => {
  const text = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : ''
  return text.length > PLAN_LINE_MAX ? `${text.slice(0, PLAN_LINE_MAX - 1)}…` : text
}

/** 끝난 기획만 — 없음·실패·건너뜀·형식 틀림은 null */
export function pagePlanOf(research: Pick<ResearchResult, 'page_plan'> | null | undefined): PagePlanDone | null {
  const record = research?.page_plan
  if (!record || typeof record !== 'object' || record.status !== 'done') return null
  const result = record.result
  return result && typeof result === 'object' ? result : null
}

/** 기획 → 요약. 약속도 순서도 비면 null(실을 것이 없다) */
export function pagePlanBriefOf(plan: PagePlanDone | null): PagePlanBrief | null {
  if (!plan) return null
  const steps = (Array.isArray(plan.flow) ? plan.flow : [])
    .map((step) => ({ section: clip(step?.section), say: clip(step?.say) }))
    .filter((step) => step.section !== '' && step.say !== '')
    .slice(0, PLAN_STEPS_MAX)
  const brief: PagePlanBrief = { promise: clip(plan.core_promise), target: clip(plan.target), hookPromise: clip(plan.hook?.promise), steps }
  return brief.promise === '' && brief.steps.length === 0 ? null : brief
}

/** 구성 콜에 보일 설득 순서 — 고를 수 있는 섹션(open)에 있는 단계만 */
export function planComposeSteps(brief: PagePlanBrief, open: readonly string[]): Array<{ section: string; say: string }> {
  const allowed = new Set(open)
  return brief.steps.filter((step) => allowed.has(step.section))
}

/**
 * 놓인 섹션마다 기획의 할 말 — 같은 섹션 id는 나온 차례대로 짝짓는다(두 번째 point_div ↔ 기획의 두 번째 point_div 단계).
 * 짝이 없는 섹션은 싣지 않는다. 키는 순서 풀이 결과의 섹션 번호(칸 카피 콜의 [index])다
 */
export function planSaysOf(brief: PagePlanBrief, sections: ReadonlyArray<{ section: string }>): Record<number, string> {
  const queues = new Map<string, string[]>()
  for (const step of brief.steps) queues.set(step.section, [...(queues.get(step.section) ?? []), step.say])
  const says: Record<number, string> = {}
  sections.forEach((row, index) => {
    const say = queues.get(row.section)?.shift()
    if (say) says[index] = say
  })
  return says
}
