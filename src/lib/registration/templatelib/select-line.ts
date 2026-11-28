/**
 * K 라인 선택 흐름(M5, PDP-KLINE-PLAN §5) — 프로필 → (AI) 가이드라인 → (규칙) 색·글꼴 → (AI) 섹션 구성 → (규칙) 상위 5 → (AI) 템플릿 선택 → (규칙) 순서 풀이.
 * AI 단계는 인자로 받아 이 파일은 공급자를 끌어오지 않는다. 결과는 section_plan.templatelib 기록이고, 어떤 콜이 실패해도 코드가 정한 후보로 끝까지 간다.
 */

import { hasPackagePhoto } from '../source-photo-roles'
import type { ComposeInput, Guideline, SelectSlot, TemplatePick, TemplateProductBrief } from '@/lib/agents/registration/prompts/pdp-template-prompts'
import type { StepOutcome } from '@/lib/agents/registration/pdp-template-agent'
import { hasEnrichmentFeature } from '../enrichment-switch'
import { inputSlotsOf } from '../input-slots-read'
import type { PdpJobRow, PdpSpecSheet } from '../pdp-state'
import { isTextBearingJob } from '../pdp-image-tasks'
import type { ColorSet } from './color-sets'
import { conceptById, conceptForCategory, type Concept } from './concepts'
import {
  buildSelectionRecord,
  candidatesFor,
  pickPageFamily,
  compositionIssues,
  conceptCandidates,
  defaultComposition,
  INPUT_INFO_SECTIONS,
  isLineup,
  PARTS_LEAD_MIN,
  pickPalette,
  PROBLEM_SECTIONS,
  repairComposition,
  stableHash,
  type SelectionProfile,
  type SelectionSeed,
  type TemplateLibRecord,
} from './selection'
import { hasManyItems, hasSizeDiagram, lineInputsOf, namedIngredientsOf, requiredInputsFit, type LineInputs } from './input-values'
import { INFOCELLS_EVIDENCE } from './info-cells'
import { paletteCandidatesOf, type PalettePickRecord } from './palette-pick'
import { categoryFlowOf } from './category-flow'
import { judgeProductFamily, lineHeroKindOf, productFamilyOf } from './product-family'
import { HOOK_BEATS_EVIDENCE, isHookBeats } from './hook-beats'
import { evidenceOf, factBudget, factsOf } from './selection-facts'
import { DEMO_EVIDENCE, DEMO_SECTION, demoPool, withDemoSection } from './demo-shot'
import { auditUspFacts, type UspAuditRecord } from './usp-audit'
import { FACT_FREE_FILLERS, FILLER_SHORT_EXTRA, imageSlots, REQUIRED_SECTIONS, solveOrder, type OrderInput, type OrderResult, type ShotContext } from './selection-order'
import { firstSlotFits } from './shot-assign'
import { capAdvantages } from './advantage-cap'
import { pagePlanBriefOf, pagePlanOf, planComposeSteps, type PagePlanBrief } from './page-plan-read'
import { visibleSurfaces } from './surface-budget'
import { K_SECTIONS, PAGE_SECTIONS, POINT_SECTION, type TemplateMeta } from './template-meta'
import { FAQ_REVIEWS_INPUT, type Template } from './template-types'

/**
 * 가운데 POINT 머리(point-center, K4 T1-31)를 쓸 컨셉 — 가운데판 다섯 중 셋 이상이 맞는 컨셉. soft-gray는 뺐다(P10 여러 개 상품에서 group 구도 컷 자리가 사라짐, shot-assign 시험).
 * 실제로는 그 페이지 후보에 서로 다른 가운데판이 POINT 수만큼 있을 때만 가운데가 된다
 */
export const CENTER_POINT_CONCEPTS: readonly string[] = [
  'clean-trust',
  'cool-white-blue',
  'lab-white',
  'honest-kraft',
  'mono-minimal',
  'reassure-care',
  'vivid-energy',
  'cool-aqua',
  'outdoor-khaki',
  'city-pop',
  'summer-citrus',
  'gift-redgreen',
  'neon-sport',
  'retro-80s',
]
const isCenterPoint = (t: Pick<TemplateMeta, 'section' | 'headStyle'>) => t.section === POINT_SECTION && t.headStyle === 'point-center'
/** 첫 화면 섹션 — 첫 사진 칸이 첫 컷이다(shot-assign 첫 섹션 첫 슬롯) */
const HOOK_SECTION = 'hook_3step'
const FAQ_SECTION = 'faq'
/** 후기 질문 FAQ 템플릿 — 질문·답 목록이 후기 질문 입력이다 */
export const isReviewFaq = (t: Pick<TemplateMeta, 'slots'>) => Object.values(t.slots).some((slot) => slot.type === 'list' && slot.input === FAQ_REVIEWS_INPUT)

/** 가이드라인 모델에게 보여 줄 컨셉 수 — 44개 전부면 앞쪽만 고른다 */
export const CONCEPTS_SHOWN = 16
/**
 * 템플릿이 요구해도 되는 사진 수 — K의 사진은 대부분 원천 사진에서 만드는 생성 컷이라 원천 수로 거르지 않는다.
 * 원천을 그대로 쓰면 1장인 상품은 채움 후보가 모자라 18섹션을 못 채운다(K-SELECTION.md)
 */
const PHOTOS_PER_TEMPLATE = 6

export interface TemplateAgents {
  guideline: (input: { product: TemplateProductBrief; concepts: readonly Concept[] }) => Promise<StepOutcome<Guideline>>
  compose: (input: ComposeInput) => Promise<StepOutcome<string[]>>
  select: (input: { product: TemplateProductBrief; guideline: Guideline; conceptName: string; slots: readonly SelectSlot[] }) => Promise<StepOutcome<TemplatePick[]>>
  /**
   * 색 조합 비전 고르기(palettepick 잡만, J26) — 원본 사진이 있을 때만 붙는다(pdp-image-kline). 후보 번호와 이유, 실패면 value null.
   * 없으면 palettepick 잡도 규칙 색이고 기록에 까닭이 남는다
   */
  palette?: (input: { product: string; candidates: readonly ColorSet[] }) => Promise<StepOutcome<{ index: number; reason: string } | null>>
}

export interface SelectLineInput {
  /** 결정론 씨앗(selectionKeyOf) — 시험 잡은 상품명이라 같은 상품은 같은 후보 순서다. 운영 잡은 상품명에 잡 id를 섞는다 */
  key: string
  /** 씨앗 방식 — 운영 잡만 'product+job'이고 기록(templatelib.seed)에 싣는다. 없으면 key는 상품명 씨앗이다 */
  seed?: SelectionSeed
  categoryKey: string
  /** 상품 대표색(사진 측정값) */
  productHex: string | null
  spec: PdpSpecSheet
  product: TemplateProductBrief
  templates: readonly TemplateMeta[]
  /** 코드가 넣는 입력값(옵션·후기·표) — 주면 이 값으로 못 그리는 템플릿을 후보에서 뺀다 */
  inputs?: LineInputs
  /** 글자·그림이 보여야 하는 인쇄물인가(isTextBearingJob) — 첫 컷 유형에 쓴다 */
  textBearing?: boolean
  /** 기획 1장 요약(pageplan 스위치 잡이고 새 단계 기획이 끝났을 때만, c10·J28) — 구성 콜·칸 카피 콜이 읽는다. 없으면 지금 그대로다 */
  pagePlan?: PagePlanBrief
  /** 사실로 셀 장점 후보(uspfacts 스위치 잡만, K4) — 없으면 사실 목록·예산이 지금 그대로다 */
  uspFacts?: readonly string[]
  /** 장점 후보 근거 대조 수(uspaudit 스위치 잡만, J22) — uspFacts는 이미 거른 목록이다. K 계획이 templatelib.uspAudit로 남긴다 */
  uspAudit?: UspAuditRecord
  /** GIF 칸(motionband 스위치 잡만) — 켜지면 근거 motion을 세워 motion_band를 연다(lineEvidenceOf, 인쇄물은 옵션 사진이 있을 때만). 없으면 지금 그대로다 */
  motionBand?: boolean
  /** 첫 화면 안 B(hookbeats 스위치 잡만, J24) — 켜지면 근거 hook_beats를 세워 안 B 첫 화면 템플릿을 연다(hook-beats.ts). 없으면 지금 그대로다 */
  hookBeats?: boolean
  /** 사진 아닌 정보 칸(infocells 스위치 잡만) — 켜지면 근거 infocells를 세워 정보 칸 템플릿을 연다(info-cells.ts). 없으면 지금 그대로다 */
  infoCells?: boolean
  /** 경쟁 장치 템플릿(partsbands 스위치 잡만, J54) — 켜지면 구성품 입력이 3개 이상일 때 번호 구성 템플릿을 후보 앞자리에 둔다. 없으면 지금 그대로다 */
  partsBands?: boolean
  /** 색 조합 비전 고르기(palettepick 스위치 잡만, J26) — 켜지면 규칙 색 대신 비전 모델이 후보 안에서 고른다(palettePickOf). 없으면 지금 그대로다 */
  palettePick?: boolean
  /** 직접 해 보는 시연 칸(demoshot 스위치 잡만, J57) — 켜지면 근거 demo를 세워 비교 섹션을 시연 칸 하나로 연다(demo-shot.ts). 없으면 지금 그대로다 */
  demoShot?: boolean
  /** 포장 역할 사진(photoroles 스위치 잡만, J58) — 원천 사진에 포장으로 고른 사진이 있으면 포장 컷 한 장을 보장한다(forcePackage). 없으면 지금 그대로다 */
  packagePhoto?: boolean
}

/** 이 잡이 싣는 사실 — 선택(사실 예산)과 슬롯 카피(실을 수 있는 사실)가 같은 목록을 쓴다 */
export const lineFactsOf = (input: Pick<SelectLineInput, 'spec' | 'uspFacts'>) => factsOf(input.spec, input.uspFacts ?? [])

/** 옵션 색 띠 근거(J54) — partsbands 잡에만 선다(option_gallery.named-bands needs.evidence) */
export const OPTION_BANDS_EVIDENCE = 'option_bands'

/** GIF 칸 옵션 밀기에 드는 실물 옵션 사진 수(B DESIGN 1절 — 옵션 사진 2장 이상) */
export const MOTION_OPTION_PHOTOS_MIN = 2

/**
 * 이 잡의 근거 — 스펙 근거(evidenceOf)에 GIF 칸 근거 motion을 더한다. motion은 motionband 스위치 잡에만 선다(세션 B ③ P5, 통합 11-06 지시 —
 * 오너 22:45 'GIF 칸을 만들어 넣는다'): 켠 잡은 늘 세우고(사용법·옵션 사진이 없으면 2.6 참조 GIF만, motion/task.ts),
 * GIF를 쓰지 않는 인쇄물(textBearing — 참조 GIF가 글자를 뒤집는다)만 실물 옵션 사진이 2장 이상(옵션 밀기)일 때다.
 * 정보 칸 근거 infocells는 infocells 스위치 잡에만 늘 선다(칸마다 입력 근거는 템플릿 입력 칸이 따로 잠근다).
 * 첫 화면 안 B 근거 hook_beats도 hookbeats 스위치 잡에만 늘 선다(J24 — 표지 템플릿은 정원 한 종이고 제품군 잠금은 템플릿 fit이 한다).
 * 스위치가 꺼진 잡은 evidenceOf와 같아 고름이 바이트까지 그대로다
 */
export function lineEvidenceOf(input: Pick<SelectLineInput, 'spec' | 'motionBand' | 'infoCells' | 'inputs' | 'textBearing' | 'hookBeats' | 'partsBands'>): Set<string> {
  const evidence = evidenceOf(input.spec)
  // 옵션 색 띠(partsbands 잡만, J54) — 켠 잡에만 근거를 세운다. 그릴 수 있는지(옵션 사진 색)는 입력 칸이 따로 잠근다
  if (input.partsBands) evidence.add(OPTION_BANDS_EVIDENCE)
  if (input.infoCells) evidence.add(INFOCELLS_EVIDENCE)
  if (input.hookBeats) evidence.add(HOOK_BEATS_EVIDENCE)
  if (!input.motionBand) return evidence
  const optionPhotos = input.inputs?.options.filter((option) => option.image).length ?? 0
  if (!input.textBearing || optionPhotos >= MOTION_OPTION_PHOTOS_MIN) evidence.add('motion')
  return evidence
}

export interface SelectLineResult {
  record: TemplateLibRecord
  order: OrderResult
  concept: Concept
  palette: ColorSet
  guideline: Guideline
  /** 컷 배정에 쓴 값 — 카피 뒤 컷을 고칠 때(shot-refine) 같은 값을 쓴다 */
  shotContext: ShotContext
  costUsd: number
  /** 콜 실패·규칙 위반 사유 — 잡을 멈추지 않고 기록한다 */
  warnings: string[]
}

/**
 * K 선택 씨앗(R09c, 오너 11-08 22:4x) — 운영 잡(cost_pool 없음·null)은 상품명에 잡 id를 섞어, 같은 상품을 새로 만들 때마다 AI가 받는 후보·순서와 색이 바뀐다.
 * 같은 잡 id는 늘 같은 씨앗이다(다시 돌려도 같은 선택). 시험 잡(cost_pool 'test')은 지금처럼 상품명만 써(없으면 잡 id) 배치 비교의 두 잡이 같은 후보를 받는다
 */
export function selectionKeyOf(job: Pick<PdpJobRow, 'id' | 'cost_pool' | 'spec_sheet'>): Pick<SelectLineInput, 'key' | 'seed'> {
  const name = job.spec_sheet.productName?.trim() ?? ''
  if (job.cost_pool === 'test') return { key: name || job.id }
  return { key: `${name}#${job.id}`, seed: 'product+job' }
}

/** 기획 1장 요약 — pageplan 스위치 잡이고 새 단계 기획이 끝났을 때만 싣는다(c10·J28). 꺼진 잡·기획 없는 잡은 빈 객체라 입력이 지금과 같다 */
function pagePlanInputOf(job: Pick<PdpJobRow, 'analysis' | 'research_result'>): Pick<SelectLineInput, 'pagePlan'> {
  if (!hasEnrichmentFeature(job.analysis, 'pageplan')) return {}
  const brief = pagePlanBriefOf(pagePlanOf(job.research_result))
  return brief ? { pagePlan: brief } : {}
}

/** 저장 잡 → 선택 흐름 입력. 고객 줄은 대상 판정이 채운 spec을 먼저 본다(H3·H5와 같게 withAudienceStageSpec 뒤에 부른다) */
export function selectLineInputOf(job: PdpJobRow, templates: readonly TemplateMeta[]): SelectLineInput {
  const { spec_sheet: spec, analysis } = job
  const photo = job.section_plan.designcut_photo
  const categoryKey = analysis.detected_category?.trim() || spec.category?.trim() || ''
  const usps = (analysis.usp_candidates ?? []).filter((usp): usp is string => typeof usp === 'string')
  // 근거 대조(uspaudit, 기본 off)는 uspfacts 잡에서만 기록된다 — 카피 뒤 사실 감사가 근거 없음으로 본 주장과 겹치는 후보를 사실 목록에서 뺀다
  const audited = hasEnrichmentFeature(analysis, 'uspaudit') ? auditUspFacts(usps, job.copy_sections?.fact_audit) : null
  return {
    ...selectionKeyOf(job),
    categoryKey,
    productHex: photo && !('failed' in photo) ? photo.product : null,
    spec,
    templates,
    inputs: lineInputsOf(job),
    ...pagePlanInputOf(job),
    textBearing: isTextBearingJob(job),
    ...(hasEnrichmentFeature(analysis, 'motionband') ? { motionBand: true } : {}),
    ...(hasEnrichmentFeature(analysis, 'hookbeats') ? { hookBeats: true } : {}),
    ...(hasEnrichmentFeature(analysis, 'infocells') ? { infoCells: true } : {}),
    ...(hasEnrichmentFeature(analysis, 'partsbands') ? { partsBands: true } : {}),
    ...(hasEnrichmentFeature(analysis, 'photoroles') && hasPackagePhoto(job.source_images, spec.sourcePhotoRoles) ? { packagePhoto: true } : {}),
    ...(hasEnrichmentFeature(analysis, 'uspfacts') ? { uspFacts: audited?.usps ?? usps } : {}),
    ...(audited ? { uspAudit: audited.record } : {}),
    product: {
      category: categoryKey,
      persona: spec.targetPersona?.trim() || analysis.recommended_strategy_contract?.target_persona?.trim() || null,
      summary: analysis.raw_summary ?? '',
      keywords: analysis.keywords ?? [],
      usps: analysis.usp_candidates ?? [],
      pains: (analysis.pain_clusters ?? []).map((p) => p.pain),
    },
    ...(hasEnrichmentFeature(analysis, 'palettepick') ? { palettePick: true } : {}),
    ...(hasEnrichmentFeature(analysis, 'demoshot') ? { demoShot: true } : {}),
  }
}

/**
 * 고른 컨셉에서 색을 못 고르면 다음 컨셉으로 — 컨셉 값 오류는 시험이 막으므로 정상이면 일어나지 않는다.
 * source는 색을 고른 컨셉 그대로(카테고리 글꼴을 입히기 전) — 비전 고르기 후보가 같은 컨셉의 조합에서 나온다
 */
function conceptWithPalette(first: Concept, others: readonly Concept[], profile: SelectionProfile): { concept: Concept; palette: ColorSet; source: Concept } {
  for (const concept of [first, ...others]) {
    const palette = pickPalette(concept, profile)
    if (palette) return { concept: conceptForCategory(concept, profile.categoryKey), palette, source: concept }
  }
  throw new Error('색 조합을 고를 수 있는 컨셉이 없습니다')
}

/** 비전 고르기에 보일 후보 최소 수 — 하나뿐이면 고를 것이 없다 */
const PALETTE_PICK_MIN = 2

/**
 * 색 조합 비전 고르기(palettepick 잡만, 결정 카드 c28·하네스 J26 — 가정 B5) — 규칙이 색을 고른 컨셉의 조합을 사진 색 순서로 세운 앞 3개를
 * 원본 사진과 함께 모델에 보여 하나를 고른다. 스위치가 꺼진 잡은 부르지 않고 기록도 없다(규칙 색·기록이 바이트까지 같다).
 * 콜이 없거나(원본 사진 없음)·후보가 2개 미만이거나·콜이 실패하면 규칙 색이고 기록(by 'rule')과 경고에 까닭이 남는다
 */
async function palettePickOf(
  input: Pick<SelectLineInput, 'palettePick' | 'productHex' | 'spec' | 'product'>,
  source: Concept,
  rule: ColorSet,
  pick: TemplateAgents['palette'],
  take: <T>(step: string, outcome: StepOutcome<T>) => T,
  warnings: string[],
): Promise<{ palette: ColorSet; record?: PalettePickRecord }> {
  if (!input.palettePick) return { palette: rule }
  const candidates = paletteCandidatesOf(source, input.productHex)
  const ids = candidates.map((set) => set.id)
  const ruleOf = (error: string) => {
    warnings.push(`색 고르기: ${error} — 규칙 색`)
    return { palette: rule, record: { by: 'rule' as const, candidates: ids, error } }
  }
  if (!pick) return ruleOf('원본 사진 없음')
  if (candidates.length < PALETTE_PICK_MIN) return ruleOf(`후보 ${candidates.length}개`)
  const outcome = await pick({ product: [input.spec.productName, input.product.summary].filter(Boolean).join(' — '), candidates })
  // 콜 실패 까닭은 take가 경고에 넣는다(비용도 여기서 센다)
  const picked = take('색 고르기', outcome)
  const chosen = picked ? candidates[picked.index] : undefined
  if (picked && chosen) return { palette: chosen, record: { by: 'vision', candidates: ids, ...(picked.reason ? { reason: picked.reason } : {}) } }
  if (outcome.error) return { palette: rule, record: { by: 'rule', candidates: ids, error: outcome.error } }
  return ruleOf(picked ? `후보 밖 번호 ${picked.index}` : '빈 답')
}

export async function selectTemplateLine(input: SelectLineInput, agents: TemplateAgents): Promise<SelectLineResult> {
  const { key, seed, categoryKey, productHex, spec, product, templates, inputs: lineInputs } = input
  const evidence = lineEvidenceOf(input)
  // 시연 칸(demoshot 잡만, J57) — 켠 잡에만 근거를 세운다. 꺼진 잡은 근거가 그대로라 고름이 바이트까지 같다
  if (input.demoShot) evidence.add(DEMO_EVIDENCE)
  const productFamily = judgeProductFamily(categoryKey, spec)
  const profile: SelectionProfile = {
    key,
    categoryKey,
    ...(productFamily ? { productFamily } : {}),
    productHex,
    photoCount: PHOTOS_PER_TEMPLATE,
    evidence,
    ...(lineInputs ? { drawable: (template: TemplateMeta) => requiredInputsFit(template as unknown as Pick<Template, 'slots'>, lineInputs), sizeDiagram: hasSizeDiagram(lineInputs) } : {}),
    ...(input.partsBands && inputSlotsOf(spec).parts.length >= PARTS_LEAD_MIN ? { partsLead: true } : {}),
  }
  const warnings: string[] = spec.productFamily?.trim() && !productFamilyOf(categoryKey, spec.productFamily) ? [`제품군 값 무시: ${spec.productFamily.trim()}(${categoryKey || '카테고리 없음'})`] : []
  let costUsd = 0
  const take = <T,>(step: string, outcome: StepOutcome<T>): T => {
    costUsd += outcome.costUsd
    if (outcome.error) warnings.push(`${step}: ${outcome.error}`)
    return outcome.value
  }

  const ranked = conceptCandidates(profile)
  const guideline = take('가이드라인', await agents.guideline({ product, concepts: ranked.slice(0, CONCEPTS_SHOWN) }))
  const chosen = conceptWithPalette(conceptById(guideline.concept.id) ?? ranked[0], ranked, profile)
  const { concept } = chosen
  const { palette, record: palettePick } = await palettePickOf(input, chosen.source, chosen.palette, agents.palette, take, warnings)

  // 페이지 POINT 머리(K4 T1-31, 통합 대안 C) — 모델을 부르기 전에 코드가 머리를 하나 정하고 point_div 후보를 그 머리로 거른다.
  // 구성까지는 기본 머리 목록으로 하고, 구성 뒤 가운데 머리 컨셉이면서 서로 다른 가운데판이 POINT 수만큼 있을 때만 가운데로 바꾼다.
  // 기본 머리 쪽은 템플릿 목록이 가운데판 이전과 같아 고름이 흔들리지 않는다
  const standardPool = templates.filter((t) => !isCenterPoint(t))
  let pool = standardPool
  const pageFamily = pickPageFamily(standardPool, profile, concept) ?? undefined
  const pageProfile: SelectionProfile = pageFamily ? { ...profile, pageFamily } : profile
  const shots: ShotContext = {
    heroKind: lineHeroKindOf(spec, categoryKey || 'household', input.textBearing ?? false).kind,
    multiple: hasManyItems(lineInputs ?? { spec }),
    hasSize: evidence.has('size'),
    namedIngredient: namedIngredientsOf(spec).length > 0,
    ...(input.packagePhoto ? { packagePhoto: true } : {}),
  }
  // 첫 화면 '붙인 컷' 템플릿(적용 K6 R-K15, 통합 11-03 12:55 (나)) — 첫 사진 칸이 첫 화면 유형과 안 맞으면(firstSlotFits) 후보에서 뺀다.
  // 대표 컷·첫 화면 유형은 그대로다. 빼서 후보가 비면 지금 후보 그대로 둔다
  const hookFits = (t: TemplateMeta) => t.section !== HOOK_SECTION || firstSlotFits(imageSlots(t)[0]?.def, shots)
  // 첫 화면 안 B 고정(J41, J24 후속 — 통합 11-10 decide 6) — hookbeats 켠 잡에서 안 B가 이 잡의 첫 화면 후보가 되면(정원 제품군·근거·사진 칸 fit,
  // 컨셉 점수·후보 수 자르기와 상관없이) 템플릿 선택 콜에 첫 화면 후보를 안 B 하나만 보인다. 후보로만 열면 콜이 다른 첫 화면을 골라
  // 확인 판(J32 P08 953503fa)이 c19를 잴 수 없었다. 꺼진 잡은 근거 잠금으로, fit 밖 켠 잡은 usable·hookFits로 이 목록이 비어 아래 길이 그대로다
  const beatsHook =
    input.hookBeats === true ? candidatesFor(HOOK_SECTION, pool.filter((t) => isHookBeats(t) && hookFits(t)), pageProfile, concept, Number.POSITIVE_INFINITY) : []
  const openCandidates = (section: string, limit?: number) => {
    // 시연 칸(demoshot 잡만, J57) — 근거 demo가 서면 비교 섹션 후보는 시연 칸 하나다(시험 사진이 있으면 그 사진 칸, 없으면 AI 시연 컷 칸)
    if (section === DEMO_SECTION && evidence.has(DEMO_EVIDENCE)) {
      const demo = candidatesFor(section, demoPool(pool, (lineInputs?.demoPhotos?.length ?? 0) > 0), pageProfile, concept, limit)
      if (demo.length > 0) return demo
    }
    // 후기 질문 FAQ(K4 ②) — 그릴 수 있으면(검사 통과 후기 질문 2개 이상) FAQ는 그것만 후보다. 답을 사실 칸으로 쓰는 FAQ보다 지어낼 몫이 없다
    if (section === FAQ_SECTION) {
      const fromReviews = candidatesFor(section, pool.filter(isReviewFaq), pageProfile, concept, limit)
      if (fromReviews.length > 0) return fromReviews
    }
    const all = candidatesFor(section, pool, pageProfile, concept, limit)
    if (section !== HOOK_SECTION || all.every(hookFits)) return all
    const fit = candidatesFor(section, pool.filter(hookFits), pageProfile, concept, limit)
    return fit.length > 0 ? fit : all
  }
  const candidates = (section: string, limit?: number) => (section === HOOK_SECTION && beatsHook.length > 0 ? beatsHook : openCandidates(section, limit))
  // 제품군 구성 줄(적용 K5 ①-b T1-42) — 뺄 섹션은 필수가 아니면 고를 수 있는 목록에서 빼(구성 콜·기본 구성·고민 예외 모두 안 씀) 더할 섹션은 구성 고치기가 필수처럼 더한다
  const flow = categoryFlowOf(categoryKey || undefined, productFamily)
  const dropped = (section: string) => (flow.drop ?? []).includes(section) && !(REQUIRED_SECTIONS as readonly string[]).includes(section)
  const open = K_SECTIONS.filter((section) => !dropped(section) && candidates(section, 1).length > 0)
  const facts = lineFactsOf(input)
  const composed = take(
    '섹션 구성',
    await agents.compose({
      product,
      guideline,
      open,
      facts: { count: facts.length, places: factBudget(facts).places },
      range: PAGE_SECTIONS,
      ...(input.pagePlan ? { plan: planComposeSteps(input.pagePlan, open) } : {}),
    })
  )
  const repaired = repairComposition(composed.length > 0 ? composed : defaultComposition(open), evidence, open, withDemoSection(flow.add ?? [], evidence.has(DEMO_EVIDENCE)))
  if (repaired.removed.length > 0 || repaired.added.length > 0) warnings.push(`구성 고침: 뺌 ${repaired.removed.join(',') || '-'} / 더함 ${repaired.added.join(',') || '-'}`)

  const points = repaired.sections.filter((section) => section === POINT_SECTION).length
  if (points > 0 && CENTER_POINT_CONCEPTS.includes(concept.id)) {
    const centerPool = templates.filter((t) => t.section !== POINT_SECTION || isCenterPoint(t))
    if (candidatesFor(POINT_SECTION, centerPool, pageProfile, concept, Number.POSITIVE_INFINITY).length >= points) pool = centerPool
  }
  const slots: SelectSlot[] = repaired.sections.map((section, index) => ({ index, section, candidates: candidates(section) }))
  const picks = take('템플릿 선택', await agents.select({ product, guideline, conceptName: concept.name, slots }))
  const inputsOf = (withBelow: boolean) =>
    slots.map((slot) => {
      const pick = picks.find((p) => p.index === slot.index)
      const chosen = slot.candidates.filter((t) => t.id === pick?.templateId)
      const below = withBelow && slot.section === HOOK_SECTION && beatsHook.length > 0 ? openCandidates(slot.section).filter((t) => !isHookBeats(t)) : []
      return { section: slot.section, candidates: [...chosen, ...slot.candidates.filter((t) => t.id !== pick?.templateId), ...below] }
    })
  let inputs = inputsOf(false)
  const fillers = FACT_FREE_FILLERS.map((section) => ({ section, candidates: candidates(section, Number.POSITIVE_INFINITY) }))
  // 채움 돌리기(개선 #5) — 상품·컨셉마다 다른 채움이 뽑히게 한다. 같은 상품·컨셉은 늘 같은 값이다
  const fillerTurn = (template: Pick<TemplateMeta, 'id'>) => stableHash(`${key}:${concept.id}:${template.id}`)
  const category = categoryKey || undefined
  const solve = (next: readonly OrderInput[], fillerExtra?: number) => solveOrder(next, concept, { facts, fillers, shots, fillerTurn, category, fillerExtra })
  let order = solve(inputs)
  // 안 B 고정 첫 화면(J41) — 후보가 안 B 하나라 뒤 섹션 사실 몫을 남기지 못해도 사실 칸이 남으면 안 B가 놓인다(뒤 섹션이 그만큼 적은 칸 후보로 간다).
  // 사실 칸·컷 상한이 모자라 첫 화면이 아예 빠질 때만 고정 전 후보를 뒤에 붙여 다시 푼다 — 그때 기록 fallbackFrom에 안 B가 남는다
  if (beatsHook.length > 0 && !order.sections.some((s) => s.section === HOOK_SECTION)) {
    inputs = inputsOf(true)
    order = solve(inputs)
  }
  let orderInputs: OrderInput[] = inputs
  // 고민 상한의 예외 — 사실이 적어 합격점에 못 미치는 페이지는 나머지 고민 섹션으로 길이를 받친다(통합 11-01, 길이 장부). 후보 첫째를 쓰고 모델을 다시 부르지 않는다.
  // 섹션이 하한(18개)에 못 미치는 페이지도 같다(통합 11-02 K12 #5) — 채움 돌리기로 길이는 합격점에 닿아도 채움 상한에 걸려 섹션이 17개로 남았다(P11)
  const chosenProblems = PROBLEM_SECTIONS.filter((section) => repaired.sections.includes(section))
  const otherProblem = PROBLEM_SECTIONS.find((section) => !repaired.sections.includes(section) && open.includes(section))
  const short = !order.height.meetsRequired
  const few = order.sections.length < PAGE_SECTIONS.min
  if ((short || few) && chosenProblems.length === 1 && otherProblem) {
    const longerInputs = [...inputs, { section: otherProblem, candidates: candidates(otherProblem) }]
    const longer = solve(longerInputs)
    // 섹션 수로만 걸렸으면 섹션이 실제로 늘 때만 쓴다
    if (longer.height.estimated > order.height.estimated && (short || longer.sections.length > order.sections.length)) {
      const count = few ? `, 섹션 ${order.sections.length} → ${longer.sections.length}` : ''
      warnings.push(`고민 상한 예외: ${otherProblem}로 길이 ${order.height.estimated} → ${longer.height.estimated}${count}`)
      order = longer
      orderInputs = longerInputs
    }
  }
  // 장점류 상한(적용 K3 T1-43, advantage-cap.ts) — 놓인 페이지가 7개·비중 0.40을 넘으면 빠진 입력 정보 섹션으로 끝쪽 장점류 하나를 바꿔 다시 푼다.
  // POINT 입력은 그대로 두므로 위에서 정한 페이지 POINT 머리(K4 T1-31)는 바뀌지 않는다
  const lineupFirst = candidates('option_gallery', 1)[0]
  const info = [
    ...INPUT_INFO_SECTIONS.filter(({ section, evidence: key }) => evidence.has(key) && (open as readonly string[]).includes(section)).map(({ section }) => section),
    ...(lineupFirst && isLineup(lineupFirst) && evidence.has('option') ? ['option_gallery'] : []),
  ]
  const byId = new Map(templates.map((t) => [t.id, t]))
  // 짙은 면 수가 줄면 쓰지 않는다(K9 dark 리듬 짙은 면 — 바꾼 장점류가 짙은 띠였던 쪽)
  const darkOf = (o: OrderResult) => visibleSurfaces(o.sections.map((s) => byId.get(s.templateId)!), o.sections.map((s) => s.bg)).filter((c) => c === 'D').length
  const darkBefore = darkOf(order)
  const capped = capAdvantages(
    order,
    orderInputs,
    info,
    (section) => ({ section, candidates: candidates(section) }),
    solve,
    (id) => byId.get(id)?.height ?? 0,
    (trial) => (darkOf(trial) < darkBefore ? '짙은 면 줄어듦' : null)
  )
  if (capped) {
    order = capped.order
    orderInputs = capped.inputs
    warnings.push(capped.warning)
  }
  // 계획 높이(적용 K14, 오너 11-04 13:4x 'K라인 길이가 짧은 것도 확인') — 위 예외를 다 보고도 합격점 아래인 페이지만 채움 하나를 더 받아 본다.
  // 늘어나고, 채움 아닌 섹션이 그대로이고, 짙은 면이 줄지 않을 때만 쓴다. 합격점 위 페이지는 여기를 지나지 않아 구성이 그대로다
  if (!order.height.meetsRequired) {
    const bodyOf = (o: OrderResult) => o.sections.flatMap((s) => ((FACT_FREE_FILLERS as readonly string[]).includes(s.section) ? [] : [s.section])).sort().join()
    const longer = solve(orderInputs, FILLER_SHORT_EXTRA)
    if (longer.height.estimated > order.height.estimated && bodyOf(longer) === bodyOf(order) && darkOf(longer) >= darkOf(order)) {
      warnings.push(`합격점 아래 채움 더함: 길이 ${order.height.estimated} → ${longer.height.estimated}`)
      order = longer
    }
  }
  const placedIssues = compositionIssues(
    order.sections.map((s) => s.section),
    evidence
  )
  order.issues.push(...placedIssues.filter((issue) => !order.issues.includes(issue)))
  warnings.push(...order.issues)

  const reasons = Object.fromEntries(picks.map((p) => [p.templateId, p.reason]))
  const record = buildSelectionRecord({
    concept,
    alternatives: guideline.alternatives,
    conceptReason: guideline.concept.reason,
    palette,
    ...(palettePick ? { palettePick } : {}),
    order,
    reasons,
    guideline: { persona: guideline.persona, tone: guideline.tone },
    productFamily,
    pageFamily,
    seed,
  })
  return { record, order, concept, palette, guideline, shotContext: shots, costUsd, warnings }
}
