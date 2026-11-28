/**
 * 새 단계 ① 기획(하네스 R10a) — 리서치 뒤·설계 앞에서 '기획 1장'(핵심 약속·소구점·설득 순서·후킹)을 정한다. 뒤 단계(섹션 조합·칸 카피·
 * 대표 컷 지시)가 함께 읽는 계획이다. 결과 키 research_result.page_plan(common NEW_STAGE_RESULT_KEYS). 아직 어디서도 부르지 않는다.
 * 프롬프트는 C 시제품(c-model-eval-new-prompts.ts PLAN_SYSTEM·buildPlanPrompt, 11-07 실측 T3) 그대로다.
 */

import { SECTION_PURPOSES } from '@/lib/agents/registration/prompts/pdp-template-prompts'
import { K_SECTIONS } from '../templatelib/template-meta'
import {
  formatError,
  parseStrictJsonObject,
  reqArray,
  reqEnum,
  reqNumber,
  reqObject,
  reqString,
  reqStringArray,
  runNewStageCall,
  type NewStageCallOptions,
  type NewStageDeps,
  type NewStageRecord,
} from './common'
import { promptSourcesOf, type SourceJob } from './sources'

export const PLAN_SYSTEM = 'You are a Korean e-commerce detail-page planner. Use only the given inputs and respond only with the requested JSON.'

export interface PagePlanInput {
  spec: string
  analysis: string
  research: string
  sections: ReadonlyArray<{ id: string; purpose: string }>
}

export function buildPlanPrompt(input: PagePlanInput): string {
  return `상세페이지 한 장의 기획을 '기획 1장'으로 정한다. 이 기획은 뒤 단계(섹션 템플릿 조합·칸 카피·대표 컷 지시)가 함께 읽는 단 하나의 계획이다.

## 입력
### 판매자 입력
${input.spec}

### 분석(1단계 결과)
${input.analysis}

### 리서치(2단계 결과)
${input.research}

### 쓸 수 있는 섹션(이 id만 쓴다)
${input.sections.map((s) => `- ${s.id}: ${s.purpose}`).join('\n')}

## 규칙
- 근거는 위 입력에서만 가져온다. 소구점마다 출처를 단다: spec(판매자 입력), review(후기), competitor(경쟁사 불만), inference(근거 없는 추정).
- 입력에 없는 수치·인증·소재·효능을 만들지 않는다. 질병·의학·기능성 효능, 인증·시험 사칭, 살균·무독성 같은 절대 안전 표현은 쓰지 않는다.
- 소구점은 구매 결정에 큰 순서로 3~5개, 하나에 약속 하나. 근거가 약하면 넣지 말고 dropped에 까닭과 함께 적는다.
- 설득 순서는 첫 화면부터 구매 권유까지 6~10단계. 단계마다 위 목록의 섹션 id 하나, 그 섹션이 할 말 한 줄, 기대는 소구점 번호를 단다. 첫 단계는 hook_3step, 마지막 단계는 cta다. 같은 섹션 id는 point_div만 되풀이할 수 있다.
- 후킹: 첫 화면 제목이 할 약속 하나와 대표 컷이 보여 줄 순간 하나를 정한다. 둘은 같은 이야기여야 한다.
- 한 사실은 페이지에서 2곳까지만 쓰이게 배정한다.

## 답
JSON 하나만 쓴다.
{"core_promise":"한 문장","target":"누구·어떤 상황","appeals":[{"rank":1,"appeal":"약속","evidence":"근거","source":"spec|review|competitor|inference"}],"flow":[{"step":1,"section":"hook_3step","say":"이 섹션이 할 말","appeals":[1]}],"hook":{"promise":"제목이 할 약속","hero_moment":"대표 컷이 보여 줄 순간"},"cta":"구매 권유 한 줄","dropped":[{"appeal":"뺀 소구점","why":"까닭"}],"risks":["오해·규제·과장 위험"]}`
}

export const PLAN_SOURCES = ['spec', 'review', 'competitor', 'inference'] as const
export type PlanSource = (typeof PLAN_SOURCES)[number]

export interface PagePlan {
  core_promise: string
  target: string
  appeals: Array<{ rank: number; appeal: string; evidence: string; source: PlanSource }>
  flow: Array<{ step: number; section: string; say: string; appeals: number[] }>
  hook: { promise: string; hero_moment: string }
  cta: string
  dropped: Array<{ appeal: string; why: string }>
  risks: string[]
}

export function parsePagePlan(text: string): PagePlan {
  const o = parseStrictJsonObject(text)
  const appeals = reqArray(o, 'appeals', '$').map((v, i) => {
    const a = reqObject(v, `$.appeals[${i}]`)
    const at = `$.appeals[${i}]`
    return {
      rank: reqNumber(a, 'rank', at),
      appeal: reqString(a, 'appeal', at, { nonEmpty: true }),
      evidence: reqString(a, 'evidence', at),
      source: reqEnum(a, 'source', PLAN_SOURCES, at),
    }
  })
  const flow = reqArray(o, 'flow', '$').map((v, i) => {
    const f = reqObject(v, `$.flow[${i}]`)
    const at = `$.flow[${i}]`
    const refs = reqArray(f, 'appeals', at).map((n, j) => {
      if (typeof n !== 'number' || !Number.isFinite(n)) throw formatError(`${at}.appeals[${j}]`, '숫자')
      return n
    })
    return { step: reqNumber(f, 'step', at), section: reqString(f, 'section', at, { nonEmpty: true }), say: reqString(f, 'say', at), appeals: refs }
  })
  if (appeals.length === 0) throw formatError('$.appeals', '소구점이 하나 이상인 배열')
  if (flow.length === 0) throw formatError('$.flow', '설득 단계가 하나 이상인 배열')
  const hook = reqObject(o.hook, '$.hook')
  return {
    core_promise: reqString(o, 'core_promise', '$', { nonEmpty: true }),
    target: reqString(o, 'target', '$'),
    appeals,
    flow,
    hook: { promise: reqString(hook, 'promise', '$.hook', { nonEmpty: true }), hero_moment: reqString(hook, 'hero_moment', '$.hook', { nonEmpty: true }) },
    cta: reqString(o, 'cta', '$'),
    dropped: reqArray(o, 'dropped', '$').map((v, i) => {
      const d = reqObject(v, `$.dropped[${i}]`)
      return { appeal: reqString(d, 'appeal', `$.dropped[${i}]`), why: reqString(d, 'why', `$.dropped[${i}]`) }
    }),
    risks: reqStringArray(o, 'risks', '$'),
  }
}

/** 형식은 맞지만 규칙에 어긋난 곳 — 경고로 기록만 한다(뒤 단계가 읽을지 R10이 정한다) */
export function checkPagePlan(plan: PagePlan, sectionIds: readonly string[]): string[] {
  const warnings: string[] = []
  const allowed = new Set(sectionIds)
  if (plan.appeals.length < 3 || plan.appeals.length > 5) warnings.push(`소구점 ${plan.appeals.length}개 — 규칙 3~5개`)
  if (plan.flow.length < 6 || plan.flow.length > 10) warnings.push(`설득 단계 ${plan.flow.length}개 — 규칙 6~10단계`)
  if (plan.flow[0]?.section !== 'hook_3step') warnings.push(`첫 단계가 hook_3step이 아님(${plan.flow[0]?.section ?? '없음'})`)
  if (plan.flow[plan.flow.length - 1]?.section !== 'cta') warnings.push(`마지막 단계가 cta가 아님(${plan.flow[plan.flow.length - 1]?.section ?? '없음'})`)
  const unknown = [...new Set(plan.flow.map((f) => f.section).filter((id) => !allowed.has(id)))]
  if (unknown.length > 0) warnings.push(`쓸 수 없는 섹션 id: ${unknown.join(', ')}`)
  const seen = new Set<string>()
  const repeated = new Set<string>()
  for (const f of plan.flow) {
    if (seen.has(f.section) && f.section !== 'point_div') repeated.add(f.section)
    seen.add(f.section)
  }
  if (repeated.size > 0) warnings.push(`point_div 말고 되풀이한 섹션: ${[...repeated].join(', ')}`)
  const ranks = new Set(plan.appeals.map((a) => a.rank))
  const missing = [...new Set(plan.flow.flatMap((f) => f.appeals).filter((n) => !ranks.has(n)))]
  if (missing.length > 0) warnings.push(`설득 단계가 없는 소구점 번호를 가리킴: ${missing.join(', ')}`)
  const inferred = plan.appeals.filter((a) => a.source === 'inference').length
  if (inferred > 0) warnings.push(`근거 없는 추정(inference) 소구점 ${inferred}개`)
  return warnings
}

/** K 라인 섹션 목록과 하는 일 — C 시제품 실측(K_SECTIONS × SECTION_PURPOSES)과 같다 */
export function kLinePlanSections(): Array<{ id: string; purpose: string }> {
  return K_SECTIONS.map((id) => ({ id, purpose: SECTION_PURPOSES[id] ?? id }))
}

/** 잡에서 기획 입력 — 근거 글은 sources(리서치에서 앞 기획 page_plan을 뺀다), 섹션은 기본 K 라인 목록 */
export function pagePlanInputOf(job: SourceJob, sections: ReadonlyArray<{ id: string; purpose: string }> = kLinePlanSections()): PagePlanInput {
  return { ...promptSourcesOf(job), sections }
}

export function runPagePlan(input: PagePlanInput, deps: NewStageDeps, options: NewStageCallOptions): Promise<NewStageRecord<PagePlan>> {
  const ids = input.sections.map((s) => s.id)
  return runNewStageCall(
    { stage: 'plan', system: PLAN_SYSTEM, content: buildPlanPrompt(input), parse: parsePagePlan, check: (plan) => checkPagePlan(plan, ids) },
    deps,
    options,
  )
}
