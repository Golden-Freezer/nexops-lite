/**
 * 점수표 자동 지표 측정 (T7b, docs/plans/pdp-enrichment/04_TEST_PROGRAM.md §3) — 잡 + 편집기 문서 → PageMeasurement.
 *
 * 개선판·대조군을 같은 잣대로 잰다. 다른 것은 기준의 출처뿐이다.
 * - 섹션 목록: 렌더되는 섹션(보이는 것·높이 10px 이상, render-capture와 같은 기준)에서 구분선을 뺀 순서
 * - 설득 기준(문법·목표 길이·고민별 응답 계획): 설득 기록이 있는 잡(개선판)은 그 기록, 없는 잡(대조군·구 잡)은 같은 입력으로
 *   플래너를 돌린 결과. 플래너는 결정론이라 같은 입력이면 같은 기준이다
 * - 고민 응답: 계획된 응답 섹션 → 그 대체(ANSWER_FALLBACK) → 렌더된 섹션 의미로 다시 고른 응답 섹션 중 하나가 렌더되면 응답.
 *   근거가 없어 계획부터 응답할 수 없는 고민(응답 섹션 없음 + 사유)은 두 쪽 모두 사유 기록으로 인정한다
 * - 근거(R3): spec 근거(플래너 supported와 같은 판정)
 * - 레이아웃: 프리셋이 실제로 적용된 섹션(slotAssignments 있음)만 그 프리셋 카테고리, 나머지는 minimal(적용 안 함, 설계 §4.3-1)
 * - 강조 장식: 대상 컷(features·size_comparison·howto, 설계 §4.5) URL마다, 그 이미지가 나오는 어느 섹션에서든 장식 요소가 이미지 위에 있으면 장식됨
 * - 모바일: checkMobileReadability(T3). 모바일 하한은 편집기 문서를 만들 때(buildEditorDocument의 적용 조건) 이미 반영된다 — 따로 켜지 않는다
 * 파이프라인·편집기 동작은 바꾸지 않는다(읽기만).
 */

import { loadLayoutPresets } from '@/lib/registration/editor/data/layouts'
import type { CanvasElement, CanvasSection } from '@/lib/registration/editor/types/canvas'
import type { ProEditorDocument } from '@/lib/registration/editor/types/editor'
import { ProSectionType as S } from '@/lib/registration/editor/types/section'
import { PRESET_EXEMPT_SECTIONS } from '@/lib/registration/editor/utils/buildEditorDocument'
import { ANNOTATION_NAME_PREFIX, checkMobileReadability } from '@/lib/registration/editor/utils/mobileReadability'
import { mapBackendSectionsToProTypes } from '@/lib/registration/editor/utils/sectionConverter'
import { getCorpusSnapshotV2, type Role16 } from '../corpus-v2'
import { getDesignVocab } from '../design-vocab'
import { classifyObjection } from '../internalized/objection-types'
import { planPersuasionSkeleton, type PersuasionRecord } from '../internalized/persuasion-planner'
import { checkPersuasionRules } from '../internalized/persuasion-rules'
import { ANSWER_FALLBACK, answerFor, evidenceOf } from '../internalized/persuasion-signals'
import { ROLE_TO_SECTIONS_ENRICHED } from '../internalized/role-section-map'
import { persuasionOf } from '../pdp-enrichment-stage'
import type { PdpJobRow } from '../pdp-state'
import { buildImageTaskPlan } from '../pdp-image-tasks'
import { mergeManualStrategy } from '../pdp-strategy-contract'
import { findRegulatedClaims, type TextBlock } from './claim-lexicon'
import type { MobileRuleId, ObjectionStatus, PageMeasurement } from './scorecard'
import { checkStructure } from './structure-checks'

const ANNOTATION_TARGET_RE = /^(features:\d+|size_comparison|howto:\d+)$/
const NEUTRAL_LAYOUT = 'minimal'

export interface MobileCheckResult {
  counts: Partial<Record<MobileRuleId, number>>
  phoneScreens?: number
}

export interface MeasureOptions {
  /** 모바일 검사 교체(테스트용) — 기본은 checkMobileReadability */
  mobileCheck?: (doc: ProEditorDocument) => MobileCheckResult
}

const defaultMobileCheck = (doc: ProEditorDocument): MobileCheckResult => {
  const report = checkMobileReadability(doc)
  return { counts: report.counts, phoneScreens: report.phoneScreens }
}

/** render-capture.ts와 같은 기준의 렌더 섹션(구분선 포함) */
export function renderedSections(doc: ProEditorDocument): CanvasSection[] {
  return doc.sections.filter((s) => s.isVisible && s.canvas.height >= 10).sort((a, b) => a.order - b.order)
}

function textBlocks(sections: readonly CanvasSection[]): TextBlock[] {
  const blocks: TextBlock[] = []
  for (const section of sections) {
    for (const el of section.elements) {
      if (!el.isVisible) continue
      const texts = [el.textProps?.content, ...(el.cardGroupProps?.cards ?? []).flatMap((c) => [c.title, c.description, c.badgeText])]
      for (const text of texts) {
        const plain = text?.replace(/<[^>]*>/g, ' ').trim()
        if (plain) blocks.push({ section: String(section.sectionType), text: plain })
      }
    }
  }
  return blocks
}

const isAnnotation = (el: CanvasElement) => el.name?.startsWith(ANNOTATION_NAME_PREFIX) ?? false

function imageSrc(el: CanvasElement): string | undefined {
  if (!el.isVisible || isAnnotation(el)) return undefined
  if (el.type === 'image') return el.imageProps?.src
  if (el.type === 'framed-image') return el.framedImageProps?.src
  return undefined
}

/**
 * 이미지 사용률(W5) — 만든 컷(성공 URL, 중복 없이) 가운데 렌더 섹션에 나온 컷. 만든 컷이 없으면 1.
 * tasks를 주면 그 이미지 태스크 키의 컷만 센다 — 재합성(rerun)이 이전 잡에서 복사한 태스크 밖 컷은 이 잡이 만든 컷이 아니다.
 * 보고용 정의: 게이트 재생성을 다 써 오류가 붙은 컷·라이브러리에서 고른 아이콘도 생성 컷 기록 그대로 따른다
 */
export function measureImageUse(
  job: Pick<PdpJobRow, 'section_images'>,
  sections: readonly CanvasSection[],
  tasks?: ReadonlySet<string>
): { generated: number; used: number; rate: number } {
  const generated = new Set(
    (job.section_images ?? [])
      .filter((e) => e.url && !e.error && (!tasks || tasks.has(e.section)))
      .map((e) => e.url as string)
  )
  const shown = new Set(sections.flatMap((s) => s.elements.map(imageSrc)).filter((u): u is string => Boolean(u)))
  const used = [...generated].filter((u) => shown.has(u)).length
  return { generated: generated.size, used, rate: generated.size ? Math.round((used / generated.size) * 1000) / 1000 : 1 }
}

function centerInside(el: CanvasElement, box: CanvasElement['transform']): boolean {
  const cx = el.transform.x + el.transform.width / 2
  const cy = el.transform.y + el.transform.height / 2
  return cx >= box.x && cx <= box.x + box.width && cy >= box.y && cy <= box.y + box.height
}

/**
 * 대상 컷 URL별로 렌더 여부와 장식 여부를 센다. 같은 URL이 여러 섹션에 나와도 1개이고,
 * 장식은 렌더러가 고른 섹션(설계 §4.5 — 역할 소유 섹션의 첫 출현)이 어디든 그 이미지 위에 있으면 인정한다.
 */
export function measureAnnotations(job: PdpJobRow, sections: readonly CanvasSection[]): PageMeasurement['annotations'] {
  const targetUrls = new Set(
    (job.section_images ?? []).filter((e) => ANNOTATION_TARGET_RE.test(e.section) && e.url && !e.error).map((e) => e.url)
  )
  const rendered = new Set<string>()
  const decorated = new Set<string>()
  for (const section of sections) {
    const marks = section.elements.filter((el) => el.isVisible && isAnnotation(el))
    for (const el of section.elements) {
      const src = imageSrc(el)
      if (!src || !targetUrls.has(src)) continue
      rendered.add(src)
      if (marks.some((mark) => centerInside(mark, el.transform))) decorated.add(src)
    }
  }
  return { targetCuts: targetUrls.size, targets: rendered.size, decorated: decorated.size }
}

/**
 * 렌더된 레이아웃 카테고리 — 프리셋이 실제로 적용된 섹션만 그 카테고리.
 * S2 보고: layout_selections의 배정(minimal·PRESET_EXEMPT 제외) 중 렌더 카테고리가 다른 섹션 = 가드 탈락(또는 프리셋 없음).
 */
export async function measureLayouts(
  sections: readonly CanvasSection[],
  layoutSelections: Record<string, string> = {},
  opts: { split?: boolean } = {}
): Promise<PageMeasurement['layouts'] & { sequence: string[] }> {
  const sequence: string[] = []
  let applied = 0
  for (const section of sections) {
    let category = NEUTRAL_LAYOUT
    if (section.slotAssignments) {
      const preset = (await loadLayoutPresets(section.sectionType)).find((p) => p.id === section.layoutId)
      if (preset) {
        category = preset.category
        applied += 1
      }
    }
    sequence.push(category)
  }
  const types = sections.map((s) => String(s.sectionType))
  const repeats: string[] = []
  for (let i = 1; i < sequence.length; i++) {
    // 나누기 잡(W4-S)의 같은 유형 인스턴스(특징·사용 단계 하나씩)는 한 섹션을 펼친 것이라 인접 중복으로 세지 않는다
    if (opts.split && types[i] === types[i - 1]) continue
    if (sequence[i] !== NEUTRAL_LAYOUT && sequence[i] === sequence[i - 1]) {
      repeats.push(`${types[i - 1]}→${types[i]}(${sequence[i]})`)
    }
  }
  const assignedByType = new Map<string, string>()
  for (const [backendKey, category] of Object.entries(layoutSelections)) {
    const [type] = mapBackendSectionsToProTypes([backendKey])
    if (type && category && category !== NEUTRAL_LAYOUT && !PRESET_EXEMPT_SECTIONS.has(type)) assignedByType.set(type, category)
  }
  // 나누기 잡은 같은 유형 인스턴스를 한 번만 센다(배정은 유형 키 하나)
  const assigned = types.filter((t, i) => assignedByType.has(t) && (!opts.split || types.indexOf(t) === i))
  const guardDropped = assigned
    .filter((t) => sequence[types.indexOf(t)] !== assignedByType.get(t))
    .map((t) => `${t}(${assignedByType.get(t)}→${sequence[types.indexOf(t)]})`)
  return {
    categories: Object.fromEntries(types.map((t, i) => [t, sequence[i]])),
    applied,
    repeats,
    assigned: assigned.length,
    guardDropped,
    sequence,
  }
}

/** 개선판은 설득 기록, 대조군은 같은 입력의 플래너 결과 — 문법·목표 길이·고민별 응답 계획 */
function persuasionBasis(job: PdpJobRow): { source: 'record' | 'derived'; basis: Pick<PersuasionRecord, 'grammar' | 'lengthTarget' | 'objectionCoverage'> } {
  const record = persuasionOf(job)
  if (record) return { source: 'record', basis: record }
  const vocab = getDesignVocab()
  if (!vocab) throw new Error('디자인 어휘 스냅샷(design-vocab)을 불러오지 못해 대조군 기준을 만들 수 없습니다')
  const category = job.analysis.detected_category
  const plan = planPersuasionSkeleton({
    specSheet: job.spec_sheet,
    analysis: job.analysis,
    strategyContract: mergeManualStrategy(job.analysis.recommended_strategy_contract ?? {}, job.spec_sheet, []),
    research: job.research_result,
    category,
    snapshotV2: getCorpusSnapshotV2(category),
    vocab,
  })
  return { source: 'derived', basis: plan.persuasion }
}

export async function measurePage(job: PdpJobRow, doc: ProEditorDocument, options: MeasureOptions = {}): Promise<PageMeasurement> {
  const sections = renderedSections(doc).filter((s) => s.sectionType !== S.DIVIDER)
  // 긴 상세페이지 확장 섹션(스펙 표 빌더로 지은 표, long-sections.ts)은 설득 규칙 판정(근거·위치·인접·레이아웃)에서 빼고 섹션 수(R6)에만
  // 센다 — 근거는 설계 단계가 판정했고 골격 밖 섹션이다. 문구·이미지 측정은 모든 섹션을 본다
  // 골격에 없는데 CTA 앞에 든 상품 정보 표(오너 지시 11-01, placePurchaseCheck)도 같다 — 근거는 입력 행이고 골격 밖 섹션이다
  const planned = job.section_plan?.section_order ?? job.section_plan?.activated_sections ?? []
  const ruleSections = sections.filter((s) => !s.expansion && (s.sectionType !== S.SPEC_TABLE || planned.includes(S.SPEC_TABLE)))
  const expansionCount = sections.length - ruleSections.length
  const order = ruleSections.map((s) => String(s.sectionType))
  const spec = job.spec_sheet
  const ev = evidenceOf(spec)
  // 플래너의 근거 판정(supported)과 같은 기준
  const isSupported = (section: string) => {
    if (section === S.PERFORMANCE_REVIEWS) return ev.reviews
    if (section === S.PERFORMANCE_RATING) return ev.rating
    if (section === S.SPEC_TABLE) return ev.dims
    if (section === S.CERTIFICATION) return ev.cert
    if (section === S.EVENT_BANNER) return ev.event
    if (section === S.PETIT_DIV) return (spec.colorOptions?.length ?? 0) >= 2
    if (section === S.HIDDEN_PAGE) return ev.usageBasis
    return true
  }

  const { source, basis } = persuasionBasis(job)
  const renderedRoles = new Set(
    (Object.keys(ROLE_TO_SECTIONS_ENRICHED) as Role16[]).filter((role) =>
      ROLE_TO_SECTIONS_ENRICHED[role].sections.some((s) => order.includes(s))
    )
  )
  const objections: ObjectionStatus[] = basis.objectionCoverage.slice(0, 3).map((o) => {
    if (!o.answeredBy) {
      return { objection: o.objection, answeredBy: null, ...(o.note ? { note: o.note } : {}), status: o.note?.trim() ? 'noted' : 'silent' }
    }
    const candidates = [
      o.answeredBy,
      ANSWER_FALLBACK[o.answeredBy]?.section,
      answerFor(classifyObjection(o.objection), renderedRoles, ev).answeredBy,
    ]
    const shown = candidates.find((c): c is string => Boolean(c) && order.includes(c as string))
    return { objection: o.objection, answeredBy: shown ?? o.answeredBy, ...(o.note ? { note: o.note } : {}), status: shown ? 'answered' : 'silent' }
  })

  // 나누기 잡(W4-S)은 같은 유형 인스턴스를 규칙 판정에서 한 섹션으로 묶고(R1·R7 위치·인접), R6 섹션 수는 펼친 수로 센다
  const split = job.section_plan?.enrichment?.features?.includes('split') === true
  const layouts = await measureLayouts(ruleSections, job.section_plan?.layout_selections ?? {}, { split })
  // 사이즈·상품 정보를 맨 끝에 두는 계획(오너 지시 2026-11-01, factsLast)은 마무리 뒤 표를 규칙 순서에서 뺀다 — R5(마무리 마지막)와 어긋나지 않게. 섹션 수(R6)에는 센다
  const factsLast = job.section_plan?.designcut?.factsLast === true && order.includes(S.CTA)
  const ruleOrder = split
    ? order.filter((t, i) => i === 0 || t !== order[i - 1])
    : factsLast
      ? order.slice(0, order.lastIndexOf(S.CTA) + 1)
      : order
  // 긴 상세페이지 확장 섹션은 그려진 수만큼 상한을 넓힌다 — 골격이 같은 페이지는 확장 섹션이 R6를 실패시키지 않고(하한은 채울 수
  // 있다), 확장 섹션이 없는 잡은 예전 목표 그대로다
  const lengthTarget: [number, number] =
    expansionCount > 0 ? [basis.lengthTarget[0], basis.lengthTarget[1] + expansionCount] : basis.lengthTarget
  const rules = checkPersuasionRules(ruleOrder, {
    grammar: basis.grammar,
    lengthTarget,
    isSupported,
    // R4도 위 응답 판정(대체·재선택 포함)과 같은 결과를 쓴다
    objectionCoverage: objections.map((o) => ({ answeredBy: o.answeredBy, note: o.status === 'noted' ? o.note : undefined })),
    layouts: layouts.categories,
    ...(split || factsLast || expansionCount > 0 ? { sectionCount: order.length + expansionCount } : {}),
  })

  return {
    order,
    pageHeight: renderedSections(doc).reduce((sum, s) => sum + s.canvas.height, 0),
    persuasion: { source, grammar: basis.grammar, lengthTarget, rules },
    ...(expansionCount > 0 ? { expansions: sections.flatMap((s) => (s.expansion ? [s.expansion] : [])) } : {}),
    objections,
    layouts: {
      categories: layouts.categories,
      applied: layouts.applied,
      repeats: layouts.repeats,
      assigned: layouts.assigned,
      guardDropped: layouts.guardDropped,
    },
    annotations: measureAnnotations(job, sections),
    mobile: (options.mobileCheck ?? defaultMobileCheck)(doc),
    claims: findRegulatedClaims(textBlocks(sections)),
    claimEvidence: spec.certificationInfo?.trim() ?? '',
    images: imagesOf(job, sections),
    structure: checkStructure(job, sections),
  }
}

/** 이미지 사용률 + 지금 코드의 컷 집계(cutPlan — 설계·카피 출처 수, 렌더가 그리지 않아 안 만드는 컷) */
function imagesOf(job: PdpJobRow, sections: readonly CanvasSection[]): NonNullable<PageMeasurement['images']> {
  const { tasks, report } = buildImageTaskPlan(job)
  return { ...measureImageUse(job, sections, new Set(tasks.map((t) => t.section))), cutPlan: report }
}
