/**
 * 설득 규칙 검사기 R1~R8 — docs/plans/pdp-enrichment/00_DESIGN.md §4.2. 순수 함수.
 * 계획 골격과 렌더 후 섹션 목록(편집기 문서) 모두에 같은 기준으로 적용한다. 차단하지 않고 결과만 남긴다.
 */

import { ProSectionType as S } from '@/lib/registration/editor/types/section'

export type PersuasionRuleId = 'R1' | 'R2' | 'R3' | 'R4' | 'R5' | 'R6' | 'R7' | 'R8'
export interface PersuasionRuleResult {
  id: PersuasionRuleId
  pass: boolean
  detail?: string
}

export type PersuasionGrammar = 'G1' | 'G2' | 'G3' | 'G4'

export interface PersuasionRuleContext {
  grammar: PersuasionGrammar
  lengthTarget: [number, number]
  /** 섹션이 근거·렌더 활성 조건을 갖췄는지(계획: 골격 조건, 렌더: 변환기에 실제로 나왔는지) */
  isSupported: (section: string) => boolean
  /** 상위 고민 응답 기록(planner의 objectionCoverage) — 상위 3개만 본다 */
  objectionCoverage: Array<{ answeredBy: string | null; note?: string }>
  /** 섹션 → 레이아웃 카테고리(E-2 배정 전이면 없음) */
  layouts?: Record<string, string>
  /** R6 섹션 수 — 나누기 잡(W4-S)은 특징·사용 단계를 하나씩 센 예상 수. 없으면 order 길이 */
  sectionCount?: number
}

const VALUE_SECTIONS = new Set<string>([S.POINT_DIV, S.SUB_DIV])
const PROOF_SECTIONS = new Set<string>([S.PERFORMANCE_REVIEWS, S.PERFORMANCE_RATING, S.CERTIFICATION])
const PROBLEM_SECTIONS = new Set<string>([S.PROBLEM_RAISE, S.PROBLEM_EMPATHY])
/** 레이아웃 인접 비교에서 빼는 값 — minimal(_layout_01)은 "적용 안 함"과 같다(설계 §4.3-1). */
const NEUTRAL_LAYOUTS = new Set(['minimal', '', undefined])

function firstIndex(order: string[], set: Set<string>): number {
  return order.findIndex((s) => set.has(s))
}

/** R7 판정 — E-2 배정 뒤 설계 단계가 계획 시점의 보류 기록을 이 결과로 바꾼다. */
export function checkLayoutAdjacency(order: string[], layouts: Record<string, string>): PersuasionRuleResult {
  const repeats: string[] = []
  for (let i = 1; i < order.length; i++) {
    const prev = layouts[order[i - 1]]
    const cur = layouts[order[i]]
    if (!NEUTRAL_LAYOUTS.has(cur) && cur === prev) repeats.push(`${order[i - 1]}→${order[i]}(${cur})`)
  }
  return { id: 'R7', pass: repeats.length === 0, ...(repeats.length ? { detail: `인접 중복: ${repeats.join(', ')}` } : {}) }
}

export function checkPersuasionRules(order: string[], ctx: PersuasionRuleContext): PersuasionRuleResult[] {
  const results: PersuasionRuleResult[] = []

  // R1 — main_cut 2번째 이내, 첫 가치(usp) 섹션 5번째 이내
  const main = order.indexOf(S.MAIN_CUT)
  const value = firstIndex(order, VALUE_SECTIONS)
  const r1Problems: string[] = []
  if (main === -1 || main > 1) r1Problems.push(`main_cut 위치 ${main === -1 ? '없음' : main + 1}`)
  if (value === -1 || value > 4) r1Problems.push(`첫 가치 섹션 위치 ${value === -1 ? '없음' : value + 1}`)
  results.push({
    id: 'R1',
    pass: r1Problems.length === 0,
    ...(r1Problems.length ? { detail: r1Problems.join(', ') } : {}),
  })

  // R2 — 증거 섹션은 받치는 주장(첫 가치 섹션) 뒤. G2(증거 선행형)는 예외
  if (ctx.grammar === 'G2') {
    results.push({ id: 'R2', pass: true, detail: 'G2 증거 선행형 — 예외' })
  } else {
    const early = order.filter((s, i) => PROOF_SECTIONS.has(s) && (value === -1 || i < value))
    results.push({
      id: 'R2',
      pass: early.length === 0,
      ...(early.length ? { detail: `주장 앞 증거: ${early.join(', ')}` } : {}),
    })
  }

  // R3 — 근거·렌더 활성 조건 없는 섹션 0개
  const unsupported = order.filter((s) => !ctx.isSupported(s))
  results.push({
    id: 'R3',
    pass: unsupported.length === 0,
    ...(unsupported.length ? { detail: `근거 없음: ${unsupported.join(', ')}` } : {}),
  })

  // R4 — 상위 3개 고민은 응답 섹션이 실제 목록에 있거나(응답), 응답 섹션 없이 미응답 사유가 기록돼야 한다
  const top = ctx.objectionCoverage.slice(0, 3)
  const silent = top.filter((o) => (o.answeredBy ? !order.includes(o.answeredBy) : !o.note?.trim())).length
  results.push({
    id: 'R4',
    pass: silent === 0,
    ...(silent ? { detail: `응답 섹션이 없거나 사유 없는 상위 고민 ${silent}건` } : {}),
  })

  // R5 — cta는 마지막·1개, promotion(event_banner)은 cta 바로 앞
  const ctaCount = order.filter((s) => s === S.CTA).length
  const r5Problems: string[] = []
  if (ctaCount !== 1) r5Problems.push(`cta ${ctaCount}개`)
  else if (order[order.length - 1] !== S.CTA) r5Problems.push('cta가 마지막이 아님')
  const event = order.indexOf(S.EVENT_BANNER)
  if (event !== -1 && order[event + 1] !== S.CTA) r5Problems.push('event_banner가 cta 바로 앞이 아님')
  results.push({
    id: 'R5',
    pass: r5Problems.length === 0,
    ...(r5Problems.length ? { detail: r5Problems.join(', ') } : {}),
  })

  // R6 — 섹션 수가 목표 범위 안. 하한 미달은 근거가 부족한 상품에서 생긴다 — 섹션을 지어내지 않고 경고만 남긴다.
  const [min, max] = ctx.lengthTarget
  const count = ctx.sectionCount ?? order.length
  const inRange = count >= min && count <= max
  const shortNote = count < min ? ' — 목표 분량 미달(근거 없는 섹션은 만들지 않음 · 제외 사유는 excluded 참조)' : ''
  results.push({
    id: 'R6',
    pass: inRange,
    ...(inRange ? {} : { detail: `섹션 ${count}개, 목표 ${min}~${max}${shortNote}` }),
  })

  // R7 — 인접 섹션 레이아웃 카테고리 중복 없음(배정 전이면 판정 보류 = 통과로 기록하고 사유를 남긴다)
  results.push(
    ctx.layouts
      ? checkLayoutAdjacency(order, ctx.layouts)
      : { id: 'R7', pass: true, detail: '레이아웃 미배정(E-2 이전) — 판정 보류' }
  )

  // R8 — hook이 있으면 main_cut 앞, 공감(problem)이 있으면 solution_guide가 바로 뒤
  const r8Problems: string[] = []
  const hook = order.indexOf(S.HOOK_3STEP)
  if (hook !== -1 && main !== -1 && hook > main) r8Problems.push('hook이 main_cut 뒤')
  let lastProblem = -1
  order.forEach((s, i) => {
    if (PROBLEM_SECTIONS.has(s)) lastProblem = i
  })
  if (lastProblem !== -1 && order[lastProblem + 1] !== S.SOLUTION_GUIDE) r8Problems.push('공감 뒤 solution_guide 없음')
  results.push({
    id: 'R8',
    pass: r8Problems.length === 0,
    ...(r8Problems.length ? { detail: r8Problems.join(', ') } : {}),
  })

  return results
}
