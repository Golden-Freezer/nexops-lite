/**
 * K 라인 슬롯 카피 에이전트(M5, H5) — 칸을 채우는 1콜 + 문제 있는 섹션만 고치는 1콜 + 지우면 섹션이 빠지는 곳만 한 번 더(K14). 그래도 남은 문제의 글은 지운다(필수 칸이 비면 엔진이 그 템플릿을 그리지 않는다).
 * 사실 칸 수에 맞춰 줄이고, 페이지 전체에서 한 사실이 2곳을 넘으면 고칠 곳으로 돌린다.
 */

import { billedCostOf } from '../billed-usage'
import { repeatExclusionTerms } from '@/lib/registration/copy-repeats'
import type { PdpSpecSheet } from '@/lib/registration/pdp-state'
import { pdpRoute } from '@/lib/registration/pdp-model-routes'
import { factOveruse } from '@/lib/registration/templatelib/selection-facts'
import {
  ACCENT_KEY,
  asksFix,
  checkCopyValues,
  dropProblemValues,
  dropsText,
  fitToFactSlots,
  readCopyValues,
  sectionAccent,
  requiredCopyFilled,
  sectionText,
  type CopyValues,
  type SlotProblem,
} from '@/lib/registration/templatelib/slot-copy'
import type { SlotTextGuard } from '@/lib/registration/templatelib/slot-guard'
import { pageCopyNotes, pageEchoProblems, pointTitleChars } from '@/lib/registration/templatelib/slot-notes'
import { pageSpacingProblems } from '@/lib/registration/templatelib/slot-spacing'
import { callLlm } from '../llm'
import type { LlmRoute } from '../llm/types'
import type { RunContext } from '../types'
import { SLOT_COPY_SYSTEM, buildSlotCopyPrompt, parseSlotCopy, type SlotCopyInput, type SlotCopySection } from './prompts/pdp-template-copy-prompts'

/** 22섹션 전체를 쓰는 콜이라 고르기 콜보다 길다 */
const TIMEOUT_MS = 120_000

export interface SlotCopyOutcome {
  /** 섹션 번호 → 채운 칸 */
  values: Map<number, CopyValues>
  /** 고친 뒤에도 남아 글을 지운 문제와 채우지 못한 필수 칸 — 글을 지워서 비게 된 필수 칸도 든다 */
  problems: Array<SlotProblem & { index: number }>
  /** 실제로 글을 지운 칸 — 필수 칸이면 엔진이 그 템플릿을 그리지 않는다 */
  dropped: Array<{ index: number; slot: string; kind: SlotProblem['kind'] }>
  /** 첫 답의 문제 — 프롬프트 규칙이 먹는지 재는 값이다. 고쳐서 사라진 문제도 남는다 */
  firstProblems: Array<SlotProblem & { index: number }>
  /** 고치기 콜 수 — 최대 2(두 번째는 글을 지우면 섹션이 빠지는 곳만) */
  fixCalls: number
  /** 최종 글의 POINT 제목 글자 수 — 제목만 훑어도 효익이 보이는지 재는 기록 */
  pointTitle: { count: number; medianChars: number | null }
  /** 섹션 번호 → 모델이 고른 강조 구절(T1-17, 최종 글로 검사함). 없는 섹션은 엔진이 지금 규칙으로 고른다 */
  accents: Map<number, string>
  /** 모델이 구절을 줬지만 검사(제목의 부분 문자열·공백 뺀 2~8자·제목 전체 아님)를 못 넘은 섹션 수 */
  accentMisses: number
  error: string | null
  costUsd: number
}

/**
 * 섹션별 문제 — 칸 검사와 페이지 단위 사실 반복·같은 말 반복·띄어쓰기 빠짐·기록. 사실 반복은 세 번째 곳부터, 같은 첫머리 제목은 세 번째부터, 앞 POINT 제목과 같은 말을 쓴 POINT는
 * 고칠 곳으로 돌리고(글은 지우지 않는다), 같은 끝말·느낌표·짝 없는 고민은 기록만 한다
 */
function findProblems(
  sections: readonly SlotCopySection[],
  values: ReadonlyMap<number, CopyValues>,
  facts: readonly string[],
  spec: PdpSpecSheet,
  guard?: SlotTextGuard
): Map<number, SlotProblem[]> {
  const out = new Map<number, SlotProblem[]>()
  const add = (index: number, list: readonly SlotProblem[]) => {
    if (list.length > 0) out.set(index, [...(out.get(index) ?? []), ...list])
  }
  for (const section of sections) add(section.index, checkCopyValues(section.slots, values.get(section.index) ?? {}, spec, guard))
  const texts = sections.map((section) => sectionText(section.slots, values.get(section.index) ?? {}))
  for (const { fact } of factOveruse(facts, texts)) {
    const key = fact.replace(/\s+/g, '').toLowerCase()
    const places = sections.filter((_, i) => texts[i].replace(/\s+/g, '').toLowerCase().includes(key))
    for (const section of places.slice(2)) add(section.index, [{ slot: '섹션 전체', kind: 'repeat', detail: `'${fact}'이 3곳 이상 — 이 섹션에서 뺀다` }])
  }
  for (const [index, echoes] of pageEchoProblems(sections, values, repeatExclusionTerms(spec))) add(index, echoes)
  // 공백을 지워 붙인 줄이 몰린 페이지(J64) — 고칠 곳으로 돌리고 글은 지우지 않는다
  for (const [index, spacing] of pageSpacingProblems(sections, values)) add(index, spacing)
  for (const [index, notes] of pageCopyNotes(sections, values)) add(index, notes)
  return out
}

/** 두 번째 고치기에 덧붙이는 말 — 모델이 이 칸을 다른 칸과 같게 다루지 않도록 까닭을 알린다 */
const VITAL_NOTE = '필수 칸이다. 못 고치면 이 섹션이 페이지에서 빠진다'

/** 고치지 못하면 섹션이 빠지는 곳 — 글을 지우면 필수 칸이 비는 섹션만 고르고, 지워지는 칸과 빠진 칸에 까닭을 덧붙인다 */
function vitalFixes(sections: readonly SlotCopySection[], values: ReadonlyMap<number, CopyValues>, problems: ReadonlyMap<number, readonly SlotProblem[]>): Map<number, SlotProblem[]> {
  const out = new Map<number, SlotProblem[]>()
  for (const [index, list] of problems) {
    const section = sections.find((row) => row.index === index)
    if (!section || requiredCopyFilled(section.slots, dropProblemValues(values.get(index) ?? {}, list))) continue
    out.set(index, list.map((problem) => (dropsText(problem.kind) || problem.kind === 'missing' ? { ...problem, detail: `${problem.detail} — ${VITAL_NOTE}` } : problem)))
  }
  return out
}

/** 콜 하나의 흔적 — 단계 재현이 후보마다 남긴다(토큰은 마지막 시도 값, 끝난 까닭은 실패한 콜에서 공급자가 준 값만) */
export interface SlotCopyCallTrace {
  success: boolean
  inputTokens: number
  outputTokens: number
  costUsd: number
  stopReason?: string
  error?: string
}

/**
 * 단계 재현만 쓰는 선택(첫 화면 글 3사 후보, 하네스 J30 hook-models-repro) — route는 같은 칸을 다른 모델로 쓸 때, onCall은 콜마다 흔적을 받을 때.
 * 둘 다 없으면 단계 표(copy/template-slots) 그대로이고 지금과 같다
 */
export interface SlotCopyCallOptions {
  route?: LlmRoute
  onCall?: (trace: SlotCopyCallTrace) => void
}

/** guard — K 칸 글 가드(결정 카드 c03, kline-copy-guard.ts). 없으면 지금과 같다 */
export async function fillTemplateSlots(input: SlotCopyInput & { spec: PdpSpecSheet; guard?: SlotTextGuard }, runContext?: RunContext, options: SlotCopyCallOptions = {}): Promise<SlotCopyOutcome> {
  const { sections, facts, spec, guard } = input
  let costUsd = 0
  let error: string | null = null
  const values = new Map<number, CopyValues>()
  /** 섹션 번호 → 마지막 답의 _accent 원본(고치기 콜이 다시 쓴 섹션은 그 답) */
  const accentRaw = new Map<number, unknown>()

  /** 콜이 성공했는가를 돌려준다 */
  const call = async (targets: readonly SlotCopySection[], fixes: ReadonlyMap<number, readonly SlotProblem[]>): Promise<boolean> => {
    const result = await callLlm(
      options.route ?? pdpRoute('copy/template-slots'),
      {
        system: SLOT_COPY_SYSTEM,
        messages: [{ role: 'user', content: buildSlotCopyPrompt({ ...input, sections: targets }, fixes) }],
        timeoutMs: TIMEOUT_MS,
        agentName: 'registration/pdp-template-copy',
        runContext,
      },
      (text) => parseSlotCopy(text, targets)
    )
    costUsd += billedCostOf(result)
    options.onCall?.({
      success: result.success,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      costUsd: billedCostOf(result),
      ...(!result.success && result.error.stopReason ? { stopReason: result.error.stopReason } : {}),
      ...(!result.success ? { error: result.error.message } : {}),
    })
    if (!result.success) {
      console.warn('[registration/pdp-template-copy] 슬롯 카피 실패:', result.error.message)
      error = result.error.message
      return false
    }
    for (const section of targets) {
      if (!result.data.has(section.index)) continue
      const raw = result.data.get(section.index)
      values.set(section.index, fitToFactSlots(section.slots, readCopyValues(section.slots, raw), section.factSlots))
      accentRaw.set(section.index, raw && typeof raw === 'object' ? (raw as Record<string, unknown>)[ACCENT_KEY] : undefined)
    }
    return true
  }

  await call(sections, new Map())
  let problems = findProblems(sections, values, facts, spec, guard)
  const firstProblems = [...problems].flatMap(([index, list]) => list.map((problem) => ({ ...problem, index })))
  let fixCalls = 0
  // 외톨이 줄만 있는 섹션은 고치기 콜을 부르지 않는다. 다른 문제로 다시 쓰는 섹션에는 함께 알린다
  const fixes = new Map([...problems].filter(([, list]) => list.some((problem) => asksFix(problem.kind))))
  if (fixes.size > 0 && values.size > 0) {
    fixCalls = 1
    const fixed = await call(
      sections.filter((section) => fixes.has(section.index)),
      fixes
    )
    problems = findProblems(sections, values, facts, spec, guard)
    // 고친 뒤에도 글을 지우면 필수 칸이 비는 섹션만 한 번 더 — 섹션이 통째로 빠지는 일을 막는다(K14). 앞 콜이 실패했으면 다시 부르지 않는다
    const vital = fixed ? vitalFixes(sections, values, problems) : new Map<number, SlotProblem[]>()
    if (vital.size > 0) {
      fixCalls = 2
      await call(
        sections.filter((section) => vital.has(section.index)),
        vital
      )
      problems = findProblems(sections, values, facts, spec, guard)
    }
  }

  const remaining: SlotCopyOutcome['problems'] = []
  const dropped: SlotCopyOutcome['dropped'] = []
  for (const [index, list] of problems) {
    remaining.push(...list.map((problem) => ({ ...problem, index })))
    dropped.push(...list.filter((p) => dropsText(p.kind)).map((p) => ({ index, slot: p.slot, kind: p.kind })))
    const kept = dropProblemValues(values.get(index) ?? {}, list)
    values.set(index, kept)
    // 지운 뒤에 비게 된 필수 칸 — 지우기 전 검사에는 나오지 않는다
    const section = sections.find((s) => s.index === index)
    const emptied = section ? checkCopyValues(section.slots, kept, spec).filter((p) => p.kind === 'missing' && !list.some((q) => q.kind === 'missing' && q.slot === p.slot)) : []
    remaining.push(...emptied.map((problem) => ({ ...problem, index })))
  }
  // 강조 구절은 고치기·지우기가 끝난 최종 글로 검사한다 — 글이 바뀌어 구절이 없으면 지금 규칙
  const accents = new Map<number, string>()
  let accentMisses = 0
  for (const section of sections) {
    const phrase = sectionAccent(section.slots, values.get(section.index) ?? {}, accentRaw.get(section.index))
    if (phrase) accents.set(section.index, phrase)
    else if (accentRaw.get(section.index) !== undefined) accentMisses += 1
  }
  return { values, problems: remaining, dropped, firstProblems, fixCalls, pointTitle: pointTitleChars(sections, values), accents, accentMisses, error, costUsd }
}
