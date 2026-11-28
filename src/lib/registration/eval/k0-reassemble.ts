/**
 * K0 저장 재료 재조립(PDP-KLINE-PLAN §0, 렌더·슬롯 검증 전용) — 저장된 잡의 카피와 컷으로 K 페이지를 메모리에서 조립한다.
 * LLM·이미지 호출 없음, DB에 쓰지 않는다. 선택 콜은 부르지 않고 기본 구성·후보 첫째 경로로 간다.
 *
 * 저장 카피는 K 칸 상한에 맞춰 쓴 글이 아니다. 칸 검사에 걸린 글은 자르지 않고 지운다(실제 슬롯 카피와 같은 규칙).
 * 그래서 빠진 칸과 못 그린 섹션은 stats로 남기고, 이 값이 K1에 슬롯 카피 콜이 왜 필요한지 보여 준다.
 * 사진은 자리와 배치를 보는 용도다 — 컷 목적에 가까운 저장 컷을 빌려 쓰며, 내용까지 맞는다는 뜻이 아니다.
 */

import type { StepOutcome } from '@/lib/agents/registration/pdp-template-agent'
import { buildDesigncutPlan } from '../internalized/designcut-plan'
import type { CopywritingResult, PdpJobRow, SectionImage } from '../pdp-state'
import { lineInputsOf } from '../templatelib/input-values'
import { undrawnSections } from '../templatelib/line-plan'
import { TEMPLATES, templateById } from '../templatelib/library'
import { buildTemplatelibPlan } from '../templatelib/plan'
import { keyedShots } from '../templatelib/section-values'
import { selectLineInputOf, selectTemplateLine, type TemplateAgents } from '../templatelib/select-line'
import type { OrderedSection } from '../templatelib/selection-order'
import { checkCopyValues, copySlotsOf, dropProblemValues, type CopyValues, type SlotProblem } from '../templatelib/slot-copy'
import type { TemplateMeta } from '../templatelib/template-meta'

const free = <T,>(value: T): StepOutcome<T> => ({ value, usedFallback: false, error: null, costUsd: 0 })

/** 콜을 부르지 않는 선택 — 컨셉 첫째, 기본 구성, 후보 첫째 */
const NO_CALL_AGENTS: TemplateAgents = {
  guideline: async ({ concepts }) => free({ persona: '', tone: '', concept: { id: concepts[0].id, reason: '' }, alternatives: [] }),
  compose: async () => free([]),
  select: async ({ slots }) => free(slots.map((slot) => ({ index: slot.index, templateId: slot.candidates[0].id, reason: '' }))),
}

/** 한 섹션에 줄 수 있는 저장 글 — first는 제목 자리, second는 설명 자리, rows는 목록 자리다 */
interface SavedText {
  first?: string
  second?: string
  rows?: ReadonlyArray<readonly [string | undefined, string | undefined]>
}

const FIRST_SLOTS = new Set(['headline', 'title', 'titleA', 'line', 'question'])
const SECOND_SLOTS = new Set(['sub', 'desc', 'descA', 'story', 'note', 'answer'])
const pair = (copy?: { headline?: string; subCopy?: string }): SavedText => ({ first: copy?.headline, second: copy?.subCopy })
const single = (values: readonly string[] | undefined) => (values ?? []).map((value): readonly [string, undefined] => [value, undefined])

/** 섹션 → 저장 카피 필드. occurrence는 같은 섹션의 몇 번째인가다. 저장 글이 없는 섹션은 빈 값이고 필수 칸이 비면 그려지지 않는다 */
function savedTextOf(section: string, occurrence: number, copy: CopywritingResult): SavedText {
  const howTo = (copy.howTo ?? []).map((step): readonly [string | undefined, string | undefined] => [step.step, step.description])
  switch (section) {
    case 'hook_3step':
      return { first: copy.mainIntro?.hook || copy.mainIntro?.benefitHeadline, second: copy.mainIntro?.subBenefit }
    case 'main_cut':
      return pair(copy.mainCutCopy)
    case 'problem_raise':
      return { first: copy.problem?.question, second: copy.problem?.empathy, rows: single(copy.problem?.empathyLines) }
    case 'problem_empathy':
      return { first: copy.problem?.question, second: copy.problem?.empathy, rows: single(copy.problem?.empathyDeepLines ?? copy.problem?.empathyLines) }
    case 'solution_guide':
      return { first: copy.solution?.declaration, second: copy.solution?.summary, rows: howTo }
    case 'key_message':
      return pair(copy.keyMessageCopy)
    case 'point_div': {
      const card = copy.pointCards?.[occurrence]
      return { first: card?.title, second: card?.description }
    }
    case 'sub_div': {
      const point = copy.detailPoints?.[occurrence]
      return { first: point?.claim, second: point?.benefit || point?.proof }
    }
    case 'hidden_page':
      return { first: howTo[0]?.[0], second: howTo[0]?.[1], rows: howTo }
    case 'concept_desc':
      return pair(copy.conceptCopy)
    case 'direction_suggest':
      return pair(copy.directionHint)
    case 'convert_div':
      return pair(copy.convertDivCopy)
    case 'point_list_div':
      // R 비교 빌더(sections.ts)의 고정 제목과 같다 — 저장 카피에 이 섹션 제목 칸이 없다
      return { first: '이런 분께 추천드려요', rows: single(copy.recommendedTargets) }
    case 'petit_div':
      return { first: copy.soldOutBanner?.headline }
    case 'option_gallery':
      return { first: copy.colorOptions?.title }
    case 'compare':
      return { first: copy.compareSummary }
    case 'faq':
      return { rows: (copy.objection_handlers ?? []).map((row) => [row.objection, row.answer] as const) }
    case 'event_offer':
      return pair(copy.eventBundleCopy)
    case 'cta':
      return { first: copy.closingCta?.headline, second: copy.closingCta?.subtext }
    default:
      return {}
  }
}

/** 저장 글을 이 템플릿의 칸 이름에 맞춘다. 칸에 없는 글은 버리고, 글자를 자르거나 새로 쓰지 않는다 */
function slotValuesFrom(template: TemplateMeta, saved: SavedText): CopyValues {
  const out: CopyValues = {}
  for (const slot of copySlotsOf(template)) {
    if (slot.list) {
      const fields = slot.list.fields.map((field) => field.name)
      const rows = (saved.rows ?? []).slice(0, slot.list.max).map((row) => Object.fromEntries(fields.flatMap((field, i) => (row[i] ? [[field, row[i]]] : []))))
      const filled = rows.filter((row) => Object.keys(row).length > 0)
      if (filled.length > 0) out[slot.name] = filled
      continue
    }
    if (slot.tags) continue
    const value = FIRST_SLOTS.has(slot.name) ? saved.first : SECOND_SLOTS.has(slot.name) ? saved.second : undefined
    if (value?.trim()) out[slot.name] = value
  }
  return out
}

/** 컷 목적 → 먼저 볼 저장 컷 키의 접두어. 없으면 아직 안 쓴 컷, 그다음 쓴 컷을 다시 쓴다 */
const CUTS_BY_PURPOSE: Readonly<Record<string, readonly string[]>> = {
  hero: ['hero', 'premium_hero'],
  problem: ['problem', 'empathy_scene'],
  scene: ['usage', 'solution', 'direction_hint', 'concept_mood', 'cta'],
  action: ['howto', 'usage', 'solution'],
  feature_proof: ['features', 'key_benefit_visual'],
  texture: ['features', 'product_exposure'],
  underside: ['features', 'product_exposure'],
  scale: ['product_exposure', 'features'],
  group: ['product_exposure', 'features'],
  color: ['product_exposure', 'features'],
  quantity: ['product_exposure', 'features'],
  state: ['usage', 'product_exposure'],
  package: ['product_exposure', 'features'],
  ingredient: ['features', 'product_exposure'],
}
/** 사진이 아니라 바탕·아이콘 재료인 키 */
const NOT_A_CUT = /^(plate:|usp_icons|rating_bg)/

export function lendCuts(sections: readonly OrderedSection[], saved: readonly SectionImage[]): { images: SectionImage[]; needed: number; reused: number } {
  const cuts = saved.filter((entry) => entry.url && !NOT_A_CUT.test(entry.section))
  const uses = new Map<string, number>()
  const images: SectionImage[] = []
  let needed = 0
  let reused = 0
  sections.forEach((section, index) => {
    for (const shot of keyedShots(index, section)) {
      needed += 1
      const prefixes = CUTS_BY_PURPOSE[shot.purpose] ?? []
      const rank = (section: string) => {
        const at = prefixes.findIndex((prefix) => section === prefix || section.startsWith(`${prefix}:`))
        return at === -1 ? prefixes.length : at
      }
      const pick = [...cuts].sort((a, b) => (uses.get(a.section) ?? 0) - (uses.get(b.section) ?? 0) || rank(a.section) - rank(b.section))[0]
      if (!pick) continue
      const count = uses.get(pick.section) ?? 0
      if (count > 0) reused += 1
      uses.set(pick.section, count + 1)
      images.push({ section: shot.key, url: pick.url, prompt: '' })
    }
  })
  return { images, needed, reused }
}

export interface K0Stats {
  concept: string
  palette: string
  fontPair: string
  /** 순서 풀이가 놓은 섹션 수와 실제로 그려지는 섹션 수 */
  planned: number
  drawn: number
  /** 못 그린 섹션 — 필수 칸이나 입력값이 비었다 */
  undrawn: string[]
  /** 저장 글을 넣은 칸 수와 칸 검사로 지운 칸 수(종류별) */
  slotsFilled: number
  dropped: Partial<Record<SlotProblem['kind'], number>>
  cuts: { needed: number; lent: number; reused: number }
  estimatedHeight: number
  warnings: string[]
}

/** 섹션마다 저장 글을 칸에 맞추고 칸 검사에 걸린 글을 지운다 */
function savedCopyValues(sections: readonly OrderedSection[], job: PdpJobRow): { copy: Map<number, CopyValues>; slotsFilled: number; dropped: K0Stats['dropped'] } {
  const saved = (job.copy_sections.final ?? {}) as CopywritingResult
  const seen = new Map<string, number>()
  const copy = new Map<number, CopyValues>()
  const dropped: K0Stats['dropped'] = {}
  let slotsFilled = 0
  sections.forEach((row, index) => {
    const template = templateById(row.templateId) as unknown as TemplateMeta | undefined
    const occurrence = seen.get(row.section) ?? 0
    seen.set(row.section, occurrence + 1)
    if (!template) return
    const values = slotValuesFrom(template, savedTextOf(row.section, occurrence, saved))
    const problems = checkCopyValues(copySlotsOf(template), values, job.spec_sheet).filter((problem) => problem.kind !== 'missing')
    for (const { kind } of problems) dropped[kind] = (dropped[kind] ?? 0) + 1
    const kept = dropProblemValues(values, problems)
    slotsFilled += Object.keys(kept).length
    copy.set(index, kept)
  })
  return { copy, slotsFilled, dropped }
}

export async function reassembleK0(job: PdpJobRow): Promise<{ job: PdpJobRow; stats: K0Stats; sections: readonly OrderedSection[] }> {
  const base = job.section_plan.designcut ?? buildDesigncutPlan(job)
  if (!base) throw new Error('K0는 디자인 컷 잡만 조립한다 — 기준 계획이 없다')
  const templates = TEMPLATES as unknown as TemplateMeta[]
  const line = await selectTemplateLine(selectLineInputOf(job, templates), NO_CALL_AGENTS)
  const { sections } = line.order
  const inputs = lineInputsOf(job)
  const { copy, slotsFilled, dropped } = savedCopyValues(sections, job)
  const { images, needed, reused } = lendCuts(sections, job.section_images)
  const designcut = buildTemplatelibPlan(base, { sections, palette: line.palette, fontPair: line.concept.fontPair, copy, inputs, shape: line.concept.shape })
  const undrawn = undrawnSections(sections, copy, inputs)
  const estimatedHeight = sections.reduce((sum, row, index) => (undrawn.some((entry) => entry.startsWith(`${index}:`)) ? sum : sum + (templateById(row.templateId)?.height ?? 0)), 0)
  return {
    job: {
      ...job,
      section_plan: { ...job.section_plan, designcut },
      section_images: [...job.section_images, ...images],
    },
    sections,
    stats: {
      concept: line.concept.id,
      palette: line.palette.id,
      fontPair: line.concept.fontPair,
      planned: sections.length,
      drawn: sections.length - undrawn.length,
      undrawn,
      slotsFilled,
      dropped,
      cuts: { needed, lent: images.length, reused },
      estimatedHeight,
      warnings: line.warnings,
    },
  }
}
