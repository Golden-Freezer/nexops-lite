/**
 * 장점류 상한(적용 K3 T1-43, 통합 11-03 05:38·09:1x — 분석 A1 #10) — 장점을 말하는 섹션 6종(평가 plan-metrics의 장점 묶음과 같다)은
 * 페이지당 7개까지, 높이 비중 0.40까지다. 놓인 페이지가 넘으면 빠진 입력 정보 섹션(사용법·성분, 라인업을 그릴 수 있으면 옵션 모아 보기)을 넣고
 * 끝쪽 장점류 하나(큰 POINT는 빼지 않는다 — POINT 3 그대로)를 빼 순서를 다시 푼다. 합격점·섹션 하한·짙은 면 수(guard)가 나빠지지 않고 정보 섹션이 실제로 놓일 때만 쓴다.
 * 바꿀 섹션이 없거나 바꿔도 못 쓰면 그대로 둔다 — 자르기만 하면 합격점에 못 미칠 수 있다. 바꾼 것·그대로 둔 사유는 선택 경고로 쪽마다 남긴다.
 * 구성 단계가 아니라 놓인 뒤에 보는 이유: 사용법은 구성에 들어 있어도 사실 칸이 모자라면 순서 풀이가 뺀다(시험 탐침 P09).
 */

import { POINT_SECTION, type OrderInput, type OrderResult } from './selection-order'
import { PAGE_SECTIONS } from './template-meta'

export const ADVANTAGE_SECTIONS: readonly string[] = ['point_div', 'sub_div', 'hidden_page', 'key_message', 'point_list_div', 'compare']
export const ADVANTAGE_MAX = 7
export const ADVANTAGE_SHARE_MAX = 0.4

export interface AdvantageLoad {
  count: number
  /** 장점류 높이 ÷ 페이지 높이(템플릿 대표 높이), 소수 셋째 자리 */
  share: number
}

/** 놓인 섹션의 장점류 수·높이 비중 — 높이는 템플릿 대표 높이(평가 pointFamilyShare와 같은 자) */
export function advantageOf(sections: ReadonlyArray<{ section: string; templateId: string }>, heightOf: (templateId: string) => number): AdvantageLoad {
  let total = 0
  let advantage = 0
  let count = 0
  for (const { section, templateId } of sections) {
    const height = heightOf(templateId)
    total += height
    if (!ADVANTAGE_SECTIONS.includes(section)) continue
    advantage += height
    count++
  }
  return { count, share: total > 0 ? Math.round((advantage / total) * 1000) / 1000 : 0 }
}

export const overAdvantage = (load: AdvantageLoad): boolean => load.count > ADVANTAGE_MAX || load.share > ADVANTAGE_SHARE_MAX

export interface AdvantageOutcome {
  order: OrderResult
  inputs: OrderInput[]
  warning: string
}

/**
 * 넘은 페이지를 고친다 — info는 근거 있고 고를 수 있는 입력 정보 섹션(앞이 먼저), input은 그 섹션의 순서 입력을 만든다, solve는 같은 옵션으로 순서를 다시 푼다.
 * guard는 다시 푼 페이지가 다른 규칙을 나쁘게 하면 사유를 돌려준다(선택 흐름은 짙은 면 수 — K9 dark 리듬). 넘지 않았으면 null(경고 없음, 페이지 그대로)
 */
export function capAdvantages(
  order: OrderResult,
  inputs: readonly OrderInput[],
  info: readonly string[],
  input: (section: string) => OrderInput,
  solve: (inputs: readonly OrderInput[]) => OrderResult,
  heightOf: (templateId: string) => number,
  guard: (trial: OrderResult) => string | null = () => null
): AdvantageOutcome | null {
  const before = advantageOf(order.sections, heightOf)
  if (!overAdvantage(before)) return null
  const label = (load: AdvantageLoad) => `장점류 ${load.count}개·비중 ${load.share}`
  const keep = (reason: string): AdvantageOutcome => ({ order, inputs: [...inputs], warning: `${label(before)} 그대로: ${reason}` })
  const placed = new Set(order.sections.map((s) => s.section))
  const missing = info.filter((section) => !placed.has(section))
  if (missing.length === 0) return keep('바꿀 입력 정보 섹션 없음')
  // 끝쪽 장점류(큰 POINT 아님) — 놓인 순서에서 마지막 것을 입력에서 뺀다
  const from = [...order.sections].reverse().find((s) => ADVANTAGE_SECTIONS.includes(s.section) && s.section !== POINT_SECTION)?.section
  const at = from ? inputs.map((i) => i.section).lastIndexOf(from) : -1
  if (!from || at < 0) return keep('뺄 수 있는 장점류 없음(큰 POINT만)')
  const reasons: string[] = []
  for (const to of missing) {
    const next = inputs.filter((_, i) => i !== at)
    if (!next.some((i) => i.section === to)) next.push(input(to))
    const trial = solve(next)
    const after = advantageOf(trial.sections, heightOf)
    const why = !trial.sections.some((s) => s.section === to)
      ? '다시 빠짐'
      : !trial.height.meetsRequired && order.height.meetsRequired
        ? '합격점 미달'
        : trial.sections.length < PAGE_SECTIONS.min && order.sections.length >= PAGE_SECTIONS.min
          ? '섹션 하한 미달'
          : (guard(trial) ?? (after.count >= before.count && after.share >= before.share ? '줄지 않음' : null))
    if (why === null) return { order: trial, inputs: next, warning: `${label(before)} → ${after.count}개·${after.share}: ${from} 대신 ${to}` }
    reasons.push(`${to} ${why}`)
  }
  return keep(`${from} 대신 ${reasons.join(', ')}`)
}
