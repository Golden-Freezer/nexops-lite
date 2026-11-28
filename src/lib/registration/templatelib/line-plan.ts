/**
 * K 라인 계획 세우기(M5, 15_TEMPLATE_LINE §10) — 선택 흐름 → 슬롯 카피 → 디자인 컷 계획. 이미지 단계 첫 run이 부르고(templatelib 잡만) 결과를 잡에 기록한다.
 * AI 콜은 인자로 받아 이 파일은 공급자를 끌어오지 않는다. 컷 생성은 이 파일 밖이다 — 계획은 컷 키만 적는다.
 */

import type { SlotCopyOutcome } from '@/lib/agents/registration/pdp-template-copy-agent'
import { CONTEXTS, DEFAULT_CONTEXTS } from '@/lib/agents/registration/prompts/pdp-plate-prompts'
import type { SlotCopyInput } from '@/lib/agents/registration/prompts/pdp-template-copy-prompts'
import { hasEnrichmentFeature } from '../enrichment-switch'
import { generationExcludedRolesOf, generationSourceUrls } from '../source-photo-roles'
import { buildDesigncutPlan } from '../internalized/designcut-plan'
import { DEFAULT_MOTION_ENGINE } from '../motion/engine'
import { clampPicks, motionCandidatesOf, pickMaxOf, type MotionPickInput, type MotionPlanRecord } from '../motion/pick'
import { materialWords } from '../internalized/shot-words'
import { buildLineSceneSet, sceneSetInputOf } from '../scene-set'
import type { DesigncutPlan, PdpJobRow, PdpSpecSheet, SectionImage } from '../pdp-state'
import { renderTemplate } from './engine'
import { fillInputSlots, lineInputsOf, namedPartsOf, type LineInputs } from './input-values'
import { TEMPLATES, templateById } from './library'
import { slotCopyReadsOf } from './slot-copy-reads'
import { buildTemplatelibPlan, templatelibSectionKey } from './plan'
import { copyInputWithoutOrigin } from './origin-text'
import { lineHeroKindOf } from './product-family'
import { sampleContext } from './sample'
import { HERO_SHOT_KEY, keyedShots, sectionSlotValues, slotCopySections, type KeyedShot } from './section-values'
import { lineFactsOf, selectLineInputOf, selectTemplateLine, type SelectLineInput, type TemplateAgents } from './select-line'
import type { HeroKind, LostSection, TemplateLibRecord } from './selection'
import type { OrderedSection } from './selection-order'
import type { LineShot } from './shot-brief'
import { refineShotsByCopy, shotTextOf } from './shot-refine'
import { showBeatFactsOfJob, showBeatOf, type ShowBeatFact } from './show-beat'
import { assignStages } from './shot-stage'
import { assignShotVariety, shotvaryEnabled } from './shot-variety'
import { HOOK_SECTION, type CopyValues } from './slot-copy'
import { specFixedLines } from './spec-fixed'
import type { TemplateMeta } from './template-meta'
import { USAGE_STEP_TITLE_INPUT, USAGE_STEPS_INPUT, type FlowNode, type ImageOverlay } from './template-types'

export interface LinePlanAgents extends TemplateAgents {
  fillSlots: (input: SlotCopyInput & { spec: PdpSpecSheet }) => Promise<SlotCopyOutcome>
  /** 움직이는 칸 고르기(motionband 잡만) — 없으면 고른 칸 없이 기록한다 */
  pickMotion?: (input: MotionPickInput) => Promise<{ picks: unknown[]; costUsd: number; error: string | null }>
}

/**
 * 움직이는 칸 계획(움직이는 칸 자리 규칙 ①②, motionband 잡만) — 대표 칸(인쇄물 빼고)과 계획 AI가 후보 안에서 고른 칸.
 * 후보가 없거나 고를 칸이 없으면 콜을 부르지 않는다. 콜이 실패해도 대표 칸은 남기고 까닭을 적는다(계획을 막지 않는다)
 */
export async function planMotion(
  shots: readonly LineShot[],
  opts: { product: string; textBearing: boolean; optionPhotos: number; hasBand: boolean; effectUse?: boolean; beatFacts?: readonly ShowBeatFact[] },
  pick: LinePlanAgents['pickMotion'],
): Promise<MotionPlanRecord> {
  const hero = !opts.textBearing
  // 보여 줄 동작·설계(showbeat 잡만, J63) — 후보 줄에 이름을 단다. 꺼진 잡은 후보·프롬프트가 바이트 그대로다
  const beatFacts = opts.beatFacts
  const candidates = motionCandidatesOf(shots, opts).map((candidate) => {
    const beat = beatFacts ? showBeatOf(candidate.show, beatFacts) : null
    return beat ? { ...candidate, beat: beat.label } : candidate
  })
  const max = pickMaxOf(hero, opts.hasBand)
  const record: MotionPlanRecord = {
    engine: DEFAULT_MOTION_ENGINE,
    hero,
    ...(hero ? {} : { heroReason: '인쇄물 — 참조 GIF가 글자를 뒤집을 수 있어 정지 대표 컷' }),
    cells: [],
    candidates: candidates.length,
    max,
    rejected: 0,
  }
  if (candidates.length === 0 || max === 0 || !pick) return record
  // effectshot 잡만 효과 보이는 use 먼저(J53) — 꺼진 잡은 입력·프롬프트가 바이트 그대로다
  const out = await pick({ product: opts.product, candidates, max, ...(opts.effectUse ? { effectUse: true } : {}) })
  const { cells, rejected } = clampPicks(out.picks, candidates, max)
  return { ...record, cells, rejected, costUsd: out.costUsd, ...(out.error ? { error: out.error } : {}) }
}

/** hookhero 칸 카피 입력 — 대표 컷 유형별로 첫 화면 사진이 보여 줄 것(결정 카드 c09·J21) */
export const HERO_SHOT_WORDS: Readonly<Record<HeroKind, string>> = {
  in_use: '이 상품을 실제로 쓰는 순간의 장면',
  worn: '이 상품을 몸에 착용하거나 붙인 모습',
  studio: '이 상품 하나만 깔끔하게 놓인 사진',
}

/** hookhero 대표 컷 지시 재료 — 첫 화면(hook_3step) headline 한 줄(줄바꿈은 빈칸으로). 첫 화면 섹션·글이 없으면 null */
export function hookPromiseOf(sections: readonly OrderedSection[], copy: ReadonlyMap<number, CopyValues>): string | null {
  const index = sections.findIndex((row) => row.section === HOOK_SECTION)
  const headline = index >= 0 ? copy.get(index)?.headline : undefined
  const text = typeof headline === 'string' ? headline.replace(/\s*\n\s*/g, ' ').trim() : ''
  return text || null
}

/** 못 그리는 섹션 — 필수 칸이나 입력값이 비었다. 컷은 있다고 보고 글·입력값만 잰다(컷 키가 칸을 채운다) */
export function undrawnSections(sections: readonly OrderedSection[], copy: ReadonlyMap<number, CopyValues>, inputs: LineInputs): string[] {
  return sections.flatMap((row, index) => {
    const template = templateById(row.templateId)
    if (!template) return [`${index}:${row.section}(라이브러리에 없음)`]
    return renderTemplate(template, sectionSlotValues(sections, index, copy.get(index) ?? {}, inputs, copy), sampleContext()) ? [] : [`${index}:${row.templateId}`]
  })
}

/** 컷 지시에 넣는 글 길이(shot-diversity SHOW_MAX와 같은 값) */
const SHOW_MAX = 80

/** 컷이 놓이는 칸의 글 — 목록 칸은 그 항목의 글, 없으면 섹션의 글. 사용 순서 입력이 든 칸은 단계 제목이 앞에 온다 */
function showOf(copy: CopyValues | undefined, shot: KeyedShot, steps = ''): string {
  const { text: own } = shotTextOf(copy, shot)
  const text = steps ? `${steps} — ${own}` : own
  return text.length > SHOW_MAX ? `${text.slice(0, SHOW_MAX)}…` : text
}

/**
 * 사용 순서(적용 K7-c (나) T1-61, 통합 11-04 00:4x ①) — 단계마다 컷이 아니라 대표 동작 컷 1장이라, 그 컷이 순서를 알도록 단계 제목을 컷 글에 넣는다.
 * 값은 칸 채우기와 같은 입력 읽기(전부 아니면 비움)다. 입력이 없거나 그 칸이 아니면 빈 글이라 컷 지시가 바이트 그대로다
 */
function usageStepsShow(templateId: string, inputs: LineInputs | undefined): string {
  const template = inputs ? templateById(templateId) : undefined
  if (!template || !inputs) return ''
  const list = Object.entries(template.slots).find(([, def]) => def.type === 'list' && def.input === USAGE_STEPS_INPUT)
  if (!list || list[1].type !== 'list') return ''
  const title = Object.entries(list[1].fields).find(([, field]) => field.type === 'text' && field.input === USAGE_STEP_TITLE_INPUT)?.[0]
  const items = fillInputSlots(template, inputs)[list[0]]
  const titles = title && Array.isArray(items) ? items.flatMap((item) => (typeof item === 'object' && typeof item[title] === 'string' ? [item[title] as string] : [])) : []
  return titles.length > 0 ? `순서 ${titles.join(' → ')}` : ''
}

/** 슬롯이 받는 첫 비율 — 엔진이 실제 사진 비율에 가까운 값을 고르므로 첫 값으로 만들면 잘림이 가장 적다 */
function aspectOf(templateId: string, slot: string): string {
  const [name, field] = slot.split('.')
  const def = templateById(templateId)?.slots[name] as { aspect?: string[]; fields?: Record<string, { aspect?: string[] }> } | undefined
  return (field ? def?.fields?.[field]?.aspect?.[0] : def?.aspect?.[0]) ?? '3:4'
}

/** 이 칸 사진 위에 글이 얹히는 쪽 — 사진 위 글은 흐름 맨 위 풀폭 사진에만 있고(lint), 엔진도 풀폭일 때만 그린다 */
function overlayAnchorOf(templateId: string, slot: string): ImageOverlay['anchor'] | undefined {
  for (const node of templateById(templateId)?.flow ?? []) {
    if (node.kind === 'image' && node.slot === slot && node.bleed && node.overlay) return node.overlay.anchor
  }
  return undefined
}

/** 이 칸 사진을 깎는 틀 — 원·아치만 답한다. 목록 칸은 슬롯이 'items.photo' 모양이고 노드는 항목 칸 이름을 쓴다 */
function clipShapeOf(templateId: string, slot: string): LineShot['clipShape'] {
  const field = slot.split('.').at(-1)
  const find = (nodes: readonly FlowNode[]): LineShot['clipShape'] => {
    for (const node of nodes) {
      if (node.kind === 'image' && node.slot === field) return node.frame === 'circle' || node.frame === 'arch' ? node.frame : undefined
      const children = node.kind === 'row' ? node.columns.flatMap((column) => column.nodes) : node.kind === 'repeat' || node.kind === 'panel' ? node.nodes : []
      const found = find(children)
      if (found) return found
    }
    return undefined
  }
  return find(templateById(templateId)?.flow ?? [])
}

/** 이 칸 사진이 치수 도면 사진인가 — 목록 칸은 치수 노드가 받지 않아 맨 위 흐름과 판·가로 칸만 본다 */
function isDimensionPhoto(templateId: string, slot: string): boolean {
  const find = (nodes: readonly FlowNode[]): boolean =>
    nodes.some((node) => (node.kind === 'dimension' && node.slot === slot) || find(node.kind === 'row' ? node.columns.flatMap((column) => column.nodes) : node.kind === 'panel' ? node.nodes : []))
  return find(templateById(templateId)?.flow ?? [])
}

/** 대표 컷을 쓰는 첫 칸의 글 쪽 — 대표 컷은 컷 목록 밖이라 기록에 따로 적는다. 못 그리는 섹션은 글이 얹히지 않아 비우지 않는다 */
export function heroOverlayAnchorOf(sections: readonly OrderedSection[], undrawn: readonly string[]): ImageOverlay['anchor'] | undefined {
  for (const [index, row] of sections.entries()) {
    const hero = keyedShots(index, row).find((shot) => shot.key === HERO_SHOT_KEY)
    if (hero) return undrawn.some((entry) => entry.startsWith(`${index}:`)) ? undefined : overlayAnchorOf(row.templateId, hero.slot)
  }
  return undefined
}

/** 컷마다 놓이는 섹션의 바탕 — 무대가 짙은 면(D) 섹션의 쇼룸 컷 바탕을 어둡게 한다(적용 K6 ②). 컷 기록에는 남기지 않는다 */
export function withSectionBg<T extends { key: string }>(sections: readonly OrderedSection[], shots: readonly T[]): Array<T & { bg?: OrderedSection['bg'] }> {
  const bgOf = new Map(sections.flatMap((row, index) => keyedShots(index, row).map((shot) => [shot.key, row.bg] as const)))
  return shots.map((shot) => ({ ...shot, bg: bgOf.get(shot.key) }))
}

/** 만들 컷 목록 — 대표 컷은 잡의 첫 컷으로 따로 만든다. 못 그리는 섹션의 컷은 만들지 않는다. inputs는 사용 순서 단계 제목에만 쓴다 */
export function lineShotsOf(sections: readonly OrderedSection[], copy: ReadonlyMap<number, CopyValues>, undrawn: readonly string[], inputs?: LineInputs): LineShot[] {
  return sections.flatMap((row, index) =>
    undrawn.some((entry) => entry.startsWith(`${index}:`))
      ? []
      : keyedShots(index, row)
          .filter((shot) => shot.key !== HERO_SHOT_KEY)
          .map((shot) => {
            const overlayAnchor = overlayAnchorOf(row.templateId, shot.slot)
            const clipShape = clipShapeOf(row.templateId, shot.slot)
            return {
              key: shot.key,
              section: row.section,
              purpose: shot.purpose,
              composition: shot.composition,
              aspect: aspectOf(row.templateId, shot.slot),
              show: showOf(copy.get(index), shot, usageStepsShow(row.templateId, inputs)),
              ...(overlayAnchor ? { overlayAnchor } : {}),
              ...(clipShape ? { clipShape } : {}),
              ...(isDimensionPhoto(row.templateId, shot.slot) ? { sizeCut: true as const } : {}),
            }
          })
  )
}

/**
 * 컷이 빠져 못 그리는 섹션 — 재시도(다음 run 1회)까지 실패한 컷이 있으면 그 섹션은 페이지에서 빠진다. 대신 그릴 글·사진이 없어 기록만 남긴다.
 * 컷이 다 있어도 못 그리는 섹션은 글 탓이라(copy.undrawn) 세지 않는다. 필수가 아닌 칸의 컷이 빠져도 그려지면 세지 않는다(cuts_failed에는 남는다).
 * 쓰는 법 미달로 뺀 컷(droppedForUse, usegate 잡 J44)은 편집기처럼 목록 항목째 덜어 보므로, 항목이 최소보다 적어져 빠지는 섹션도 센다
 */
export function lostSectionsOf(job: Pick<PdpJobRow, 'section_plan'>, images: readonly Pick<SectionImage, 'section' | 'url' | 'droppedForUse'>[]): LostSection[] {
  const urls = new Map(images.flatMap((entry) => (entry.url ? [[entry.section, entry.url] as const] : [])))
  const rows = job.section_plan.templatelib?.sections ?? []
  const image = (key: string | null) => (key ? (urls.get(key) ?? null) : null)
  const droppedKeys = images.flatMap((entry) => (entry.droppedForUse ? [entry.section] : []))
  const real = sampleContext({ image, ...(droppedKeys.length > 0 ? { dropped: new Set(droppedKeys) } : {}) })
  return (job.section_plan.designcut?.sections ?? []).flatMap((section) => {
    const ref = section.templateRef
    const template = ref ? templateById(ref.id) : undefined
    if (!ref || !template) return []
    if (!renderTemplate(template, ref.slots, sampleContext()) || renderTemplate(template, ref.slots, real)) return []
    const index = rows.findIndex((row, at) => templatelibSectionKey(at, row.section) === section.key)
    const cuts = index < 0 ? [] : keyedShots(index, rows[index]).flatMap((shot) => (urls.has(shot.key) ? [] : [shot.key]))
    return [{ key: section.key, templateId: ref.id, cuts }]
  })
}

/** 세트 밖 장소 수 상한 */
const PLACE_MAX = 3

/** 세트 밖 장소 — 카피의 사용 장면 태그를 먼저 쓰고, 모자라면 카테고리 장소에서 세트에 쓴 곳을 뺀 값으로 채운다 */
export function placesOf(job: Pick<PdpJobRow, 'copy_sections' | 'analysis' | 'spec_sheet'>, setFloor: string | undefined): string[] {
  // 태그는 '#생일파티'처럼 온다 — 프롬프트에는 낱말만 넣는다
  const tags = (job.copy_sections.final?.usageSceneTags ?? []).filter((tag): tag is string => typeof tag === 'string').map((tag) => tag.trim().replace(/^#+/, '').trim())
  const category = job.analysis.detected_category || job.spec_sheet.category || ''
  const contexts = (CONTEXTS[category] ?? DEFAULT_CONTEXTS).filter((place) => !setFloor?.includes(place))
  return [...new Set([...tags, ...contexts])].filter(Boolean).slice(0, PLACE_MAX)
}

export interface LinePlanResult {
  designcut: DesigncutPlan
  templatelib: TemplateLibRecord
  costUsd: number
  warnings: string[]
}

/**
 * K 칸 카피 콜 입력 — planTemplateLine과 단계 재현(J37 칸 글 3사 후보, __e2e__/model-compare-repro)이 같은 함수로 만든다. sections는 순서 풀이 결과
 * (재현은 저장 K 계획 record.sections — 같은 차례), guideline은 가이드라인 콜 결과(재현은 저장 기록의 고객·말투). 화면 글 가드(slotCopyGuardOf)는
 * 부르는 쪽(pdp-image-kline)이 얹는다
 */
export function slotCopyInputOf(
  job: PdpJobRow,
  input: SelectLineInput,
  guideline: SlotCopyInput['guideline'],
  sections: readonly OrderedSection[]
): SlotCopyInput & { spec: PdpSpecSheet } {
  // spec 정본 고정(specfixed 잡만, J23 — 기본 off) — 크기·소재·옵션 수(K 옵션 칩과 같은 이름 목록)를 칸 카피에 판매자 입력 그대로 쓰라는 줄. 꺼진 잡은 입력이 이 칸 전과 같다
  const fixedValues = hasEnrichmentFeature(job.analysis, 'specfixed') ? specFixedLines(input.spec, (input.inputs?.options ?? []).map((option) => option.label)) : []
  // 원산지는 상품 정보 표에만(R09b) — 카피 콜의 사실 목록·장점 후보에서 원산지 값과 원산지를 말하는 글을 뺀다. 사실 예산·섹션 구성은 그대로 센다.
  // 그래도 칸에 쓰면 칸 검사(checkCopyValues 'origin')가 고치기를 청하고, 남으면 그 글을 지운다
  const copyInput = copyInputWithoutOrigin({ facts: lineFactsOf(input).map((fact) => fact.text), usps: input.product.usps }, input.spec.origin)
  // 대표 컷 유형 말(hookhero 잡만, c09·J21 — 기본 off) — planTemplateLine이 대표 컷에 쓰는 것과 같은 유형(lineHeroKindOf, 순수). 꺼진 잡은 입력이 이 칸 전과 같다
  const heroKind = hasEnrichmentFeature(job.analysis, 'hookhero') ? lineHeroKindOf(input.spec, input.categoryKey || 'household', input.textBearing ?? false).kind : null
  return {
    product: { ...input.product, usps: copyInput.usps },
    guideline,
    ...slotCopyReadsOf(job, input, sections),
    facts: copyInput.facts,
    ...(fixedValues.length > 0 ? { fixedValues } : {}),
    sections: slotCopySections(sections),
    spec: input.spec,
    ...(heroKind ? { heroShot: HERO_SHOT_WORDS[heroKind] } : {}),
  }
}

/** 잡 → K 계획. 카피를 한 칸도 받지 못하면 던진다 — 빈 페이지에 컷 비용을 쓰지 않고, 계획이 기록되지 않아 다음 run이 다시 부른다 */
export async function planTemplateLine(job: PdpJobRow, agents: LinePlanAgents): Promise<LinePlanResult> {
  const base = buildDesigncutPlan(job)
  if (!base) throw new Error('K 계획은 디자인 컷 잡만 세운다 — 기준 계획이 없다')
  const input = selectLineInputOf(job, TEMPLATES as unknown as TemplateMeta[])
  const line = await selectTemplateLine(input, agents)
  const { sections } = line.order
  // 대표 컷 유형은 카피와 상관없이 정해진다 — hookhero 잡(기본 off, c09·J21)은 칸 카피 입력(slotCopyInputOf)에 같은 유형 말이 실린다. 꺼진 잡은 입력이 이 칸 전과 같다
  const { kind, reason } = lineHeroKindOf(input.spec, input.categoryKey || 'household', input.textBearing ?? false)
  const hookHero = hasEnrichmentFeature(job.analysis, 'hookhero')
  const copy = await agents.fillSlots(slotCopyInputOf(job, input, line.guideline, sections))
  const costUsd = line.costUsd + copy.costUsd
  if (copy.values.size === 0) throw new Error(`K 슬롯 카피를 받지 못했다: ${copy.error ?? '빈 답'}`)

  const inputs = lineInputsOf(job)
  const planned = buildTemplatelibPlan(base, { sections, palette: line.palette, fontPair: line.concept.fontPair, copy: copy.values, inputs, accents: copy.accents, shape: line.concept.shape })
  // K 세트 어휘 — 헌장 세트 줄이 이 값을 읽는다. 기준 계획(D2)은 그대로 두고 K 계획만 바꾼다
  const designcut = planned.artDirection
    ? { ...planned, artDirection: { ...planned.artDirection, set: buildLineSceneSet(planned.artDirection.set, sceneSetInputOf(job), namedPartsOf(input.spec)) } }
    : planned
  const undrawn = undrawnSections(sections, copy.values, inputs)
  const warnings = [...line.warnings, ...(copy.error ? [`슬롯 카피: ${copy.error}`] : []), ...(undrawn.length > 0 ? [`못 그리는 섹션: ${undrawn.join(', ')}`] : [])]
  // 문제 기록에는 글을 남기지 않는다 — 칸과 종류만 남겨 프롬프트 규칙이 먹는지 잰다. 글자 수 문제는 몇 자인지만 더 남긴다(글이 없어 지운 까닭을 못 잰 V2 K2의 빈칸, K14)
  const kinds = (list: ReadonlyArray<{ index: number; slot: string; kind: string; detail?: string }>) =>
    list.map(({ index, slot, kind, detail }) => ({ index, slot, kind, ...(detail && (kind === 'length' || kind === 'over') ? { detail } : {}) }))
  // hookhero 잡 — 첫 화면 headline을 대표 컷 지시가 읽게 남긴다(pdp-image-tasks, 글로 그리지 않는 참고)
  const hook = hookHero ? hookPromiseOf(sections, copy.values) : null
  const overlayAnchor = heroOverlayAnchorOf(sections, undrawn)
  // 컷 목적 확정 — 선택 때 나눠 준 값은 초안이다. 글이 나온 뒤 글에 맞게 고치고, 무대는 고친 목적으로 정한다
  const refined = refineShotsByCopy(sections, copy.values, undrawn, { ...line.shotContext, materials: materialWords(input.spec.material ?? '') })
  const shots = lineShotsOf(refined.sections, copy.values, undrawn, inputs)
  const stages = assignStages(withSectionBg(refined.sections, shots), { family: line.concept.family, colors: line.palette.colors, places: placesOf(job, base.artDirection?.set.floor) })
  // 컷별 거리·높이·사람 박자(shotvary 잡만) — 무대를 정한 뒤 정한다. 꺼진 잡은 기록이 바이트 그대로다.
  // 사람 대표 컷(쓰는 장면·착용)은 계획 0번으로 세어 웃는 얼굴 상한에 넣고, 마무리 사진은 얼굴 없는 몸 범위만 받는다(K6 P07)
  const motion = hasEnrichmentFeature(job.analysis, 'motionband')
    ? await planMotion(
        shots,
        {
          product: [input.spec.productName, input.product.summary].filter(Boolean).join(' — '),
          textBearing: input.textBearing ?? false,
          optionPhotos: inputs.options.filter((option) => option.image).length,
          hasBand: refined.sections.some((row) => row.section === 'motion_band'),
          effectUse: hasEnrichmentFeature(job.analysis, 'effectshot'),
          ...(hasEnrichmentFeature(job.analysis, 'showbeat') ? { beatFacts: showBeatFactsOfJob(job) } : {}),
        },
        agents.pickMotion
      )
    : null
  const variety = shotvaryEnabled(job)
    ? assignShotVariety(shots.map((shot, at) => ({ ...shot, stage: stages[at] })), { pet: input.categoryKey === 'pet', seed: job.id, heroKind: kind, sourcePhotos: lineSourcePhotoCount(job) })
    : null
  return {
    designcut,
    templatelib: {
      ...line.record,
      sections: line.record.sections.map((row, at) => ({ ...row, shots: refined.sections[at].shots })),
      shotRefine: refined.record,
      hero: { kind, reason, ...(overlayAnchor ? { overlayAnchor } : {}), ...(hook ? { hook } : {}) },
      shots: shots.map((shot, at) => ({ ...shot, stage: stages[at], ...(variety?.[at] ?? {}) })),
      ...(motion ? { motion } : {}),
      // 장점 후보 근거 대조(uspaudit 잡만, J22) — 수만. 꺼진 잡은 칸이 없어 계획이 바이트 그대로다
      ...(input.uspAudit ? { uspAudit: input.uspAudit } : {}),
      copy: { firstProblems: kinds(copy.firstProblems), problems: kinds(copy.problems), dropped: kinds(copy.dropped), fixCalls: copy.fixCalls, pointTitle: copy.pointTitle, accents: copy.accents.size, accentMisses: copy.accentMisses, undrawn, error: copy.error },
    },
    costUsd: costUsd + (motion?.costUsd ?? 0),
    warnings: [...warnings, ...(motion?.error ? [`움직이는 칸 고르기: ${motion.error}`] : [])],
  }
}

/**
 * 각도 돌리기(shotvary)가 보는 원천 사진 수 — photoroles 잡은 설명 그림·시험 사진을, demoshot만 켠 잡은 시험 사진을 뺀 생성 원천 수
 * (이미지 단계 generationSourceOf와 같은 규칙), 둘 다 꺼진 잡은 source_images 수 그대로
 */
function lineSourcePhotoCount(job: Pick<PdpJobRow, 'source_images' | 'spec_sheet' | 'analysis'>): number {
  const urls = job.source_images ?? []
  const excludedRoles = generationExcludedRolesOf({ photoRoles: hasEnrichmentFeature(job.analysis, 'photoroles'), demoShot: hasEnrichmentFeature(job.analysis, 'demoshot') })
  return excludedRoles.length > 0 ? generationSourceUrls(urls, job.spec_sheet.sourcePhotoRoles, excludedRoles).urls.length : urls.length
}
