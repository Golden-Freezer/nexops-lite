/**
 * Track I 개선(ENRICHMENT) 단계 판정 — pdp-pipeline의 분석·설계·카피·합성 단계가 쓰는 트랙·잡 기록 판정을 한 곳에 둔다
 * (docs/plans/pdp-enrichment/00_DESIGN.md §4.2·§4.7). 기록이 없는 잡(구 잡·대조군·판정이 꺼진 Track S)은 기존 경로를 그대로 돌려준다.
 */

import { buildSkeletonLockBlock } from '@/lib/agents/registration/prompts/pdp-internalized-prompts'
import {
  buildFeatureOwnershipBlock,
  buildPersuasionFlowBlock,
  buildSectionBridgeBlock,
  buildSectionBridgeKeepBlock,
} from '@/lib/agents/registration/prompts/pdp-internalized-prompts'
import { buildClaimGuardBlock } from '@/lib/agents/registration/prompts/pdp-claim-guard-prompts'
import { buildDesignGroundingBlock } from './corpus'
import {
  buildInternalizedCopyBlock,
  buildInternalizedMobileRulesBlock,
  buildPooledInternalizedCopyBlock,
  buildPooledInternalizedImageBlock,
  getCorpusSnapshotV2,
} from './corpus-v2'
import { getDesignVocab, getVocabHash, lookupVocabCell, type DesignVocabSnapshot } from './design-vocab'
import {
  buildEnrichmentRecord,
  hasEnrichmentFeature,
  readJobEnrichment,
  resolveEnabledFeatures,
  withNewBatchHostedDefaults,
} from './enrichment-switch'
import { detectParentProxy, readJobAudience, withAudience, type AudienceRecord } from './parent-proxy'
import { withAudiencePersona } from './parent-proxy-copy'
import { buildInternalizedTheme, type InternalizedThemeMap } from './internalized/internalized-theme'
import { assignLayouts } from './internalized/layout-assign'
import { buildSkeleton, enforceSkeleton, type SkeletonResult } from './internalized/pdp-internalized-skeleton'
import { planPersuasionSkeleton, type PersuasionRecord } from './internalized/persuasion-planner'
import { checkLayoutAdjacency } from './internalized/persuasion-rules'
import { annotationQualityReport } from './pdp-annotation-stage'
import type { EditorBuildStats } from './editor/utils/buildEditorDocument'
import { buildRoleShotBlock, shotRoleForTask } from './internalized/shot-direction'
import { buildShotPlanBlock, orderByPage, planPageShots } from './internalized/shot-plan'
import { designcut2Enabled } from './internalized/designcut-plan'
import { roleSectionMap } from './internalized/role-section-map'
import { measureSectionBridges, planSectionBridges } from './internalized/section-bridges'
import { decideLongSections, type LongRecord } from './long-sections'
import type { ReviewFaqItem, ReviewFaqStats } from './reviews/review-faq'
import {
  buildEnrichedQualityReport,
  buildQualityReport,
  buildVocabTrustStack,
  type TrustStack,
} from './internalized/trust-gate'
import {
  resolveGenerationTrack,
  type AnalysisResult,
  type DecisionProfile,
  type DesignPalette,
  type HookScore,
  type PdpJobRow,
  type PdpQualityReport,
  type ResearchResult,
  type SectionPlan,
  type StrategyContract,
} from './pdp-state'

/** 잡 기록에 persuasion이 있는 Track I 잡 — 정정 매핑(렌더 의미)을 쓴다. 기록 없는 잡은 기존 매핑. */
export function usesEnrichedMapping(job: PdpJobRow): boolean {
  return resolveGenerationTrack(job) === 'internalized' && hasEnrichmentFeature(job.analysis, 'persuasion')
}

/** 설계 단계가 실제로 설득 플래너를 쓴 잡의 설득 기록 — 아니면 null. copy·images·compose는 이 기록만 본다. */
export function persuasionOf(job: PdpJobRow): PersuasionRecord | null {
  return usesEnrichedMapping(job) ? (job.section_plan.internalized_skeleton?.persuasion ?? null) : null
}

/**
 * 분석 단계 — Track I이고 개선 기능이 하나라도 켜졌을 때만 잡 단위 기록 + decision_profile 보존.
 * Track S는 학부모 판정이 켜진 잡만 audience 하나를 기록한다(decision_profile·다른 기능 없음 — 판정이 꺼진 잡은 그대로).
 */
export function analysisWithEnrichment(
  job: PdpJobRow,
  analysis: AnalysisResult,
  decisionProfile: DecisionProfile
): AnalysisResult {
  // 운영 새 배치 잡은 새 단계(newstages)가 기본 on(R11d, 끄는 env NEXOPS_PDP_NEWSTAGES_DEFAULT=off) — 지금 배치·로컬은 환경 기준 그대로
  const features = withNewBatchHostedDefaults(resolveEnabledFeatures(), job.model_batch)
  // 학부모 대리 구매형 — audience 기능이 켜진 잡만 판정해 켜진 판정을 기록한다(꺼진 판정·기능 off는 기록 그대로)
  const audience = features.includes('audience') ? detectParentProxy(job.spec_sheet).record : null
  if (resolveGenerationTrack(job) !== 'internalized') {
    const record = audience ? withAudience(buildEnrichmentRecord(['audience']), audience) : null
    return record ? { ...analysis, enrichment: record } : analysis
  }
  const enrichment = withAudience(buildEnrichmentRecord(features), audience)
  return enrichment ? { ...analysis, decision_profile: decisionProfile, enrichment } : analysis
}

/** 학부모 대리 구매형 기록(audience 기능 + 켜진 판정, 트랙 무관 — Track S는 판정이 켜진 잡만 기록이 있다) — 아니면 null. 이후 단계는 이 기록만 본다 */
export function audienceOf(job: PdpJobRow): AudienceRecord | null {
  return hasEnrichmentFeature(job.analysis, 'audience') ? readJobAudience(job.analysis) : null
}

/**
 * 리서치·설계·카피 단계 입력 — 기록 잡이고 targetPersona가 비었으면 기본 학부모 페르소나를 채운 잡(저장하지 않는다).
 * 페르소나는 리서치·설계 프롬프트, 전략 계약 target_persona, 플래너 대상 신호, 카피 페르소나 줄로 그대로 흐른다. 아니면 같은 잡
 */
export function withAudienceStageSpec(job: PdpJobRow): PdpJobRow {
  const spec = withAudiencePersona(job.spec_sheet, audienceOf(job))
  return spec === job.spec_sheet ? job : { ...job, spec_sheet: spec }
}

export interface DesignSkeletonDecision {
  skeleton: SkeletonResult | null
  persuasion: PersuasionRecord | null
  groundingBlock: string
  enrichment: SectionPlan['enrichment'] | null
  /** layouts 기록 + 설득 플래너 잡만 — E-2 레이아웃 배정 입력 */
  layoutContext?: {
    vocab: DesignVocabSnapshot
    category: string | null | undefined
    comparisonIntensity: StrategyContract['comparison_intensity']
  }
  /** long 기록 + 설득 플래너 잡만 — 긴 상세페이지 확장 섹션 근거 판정(section_plan.long) */
  long?: LongRecord
}

/**
 * 설계 단계 골격 결정 — persuasion+vocab 기록이면 설득 플래너(v2 없는 카테고리도 vocab pooled로 Track I 유지),
 * 아니면 buildSkeleton(v2, 기록 잡은 정정 의미) 또는 standard 폴백. 골격이 있으면 LLM에는 골격 잠금 블록을 준다.
 */
export function resolveDesignSkeleton(job: PdpJobRow, strategyContract: StrategyContract): DesignSkeletonDecision {
  const internalized = resolveGenerationTrack(job) === 'internalized'
  const category = job.analysis.detected_category
  const snapshotV2 = internalized ? getCorpusSnapshotV2(category) : null
  const record = internalized ? readJobEnrichment(job.analysis) : null
  const planner = record?.features.includes('persuasion') && record.features.includes('vocab')
  const vocab = planner ? getDesignVocab() : null
  const enrichment = record
    ? { version: 1 as const, features: record.features, vocabHash: getVocabHash(vocab ?? getDesignVocab()) }
    : null
  const locked = (s: SkeletonResult) =>
    `${buildSkeletonLockBlock(s.activatedSections, s.sectionOrder)}\n\n${buildInternalizedMobileRulesBlock()}`

  if (vocab) {
    const plan = planPersuasionSkeleton({
      specSheet: job.spec_sheet,
      analysis: job.analysis,
      strategyContract,
      research: job.research_result,
      category,
      snapshotV2,
      vocab,
      ...(record?.features.includes('split') ? { split: true } : {}),
      // 디자인 컷 D2 잡은 길이 목표 [18,22] — 후기·추천 단위가 길이 상한에서 빠지지 않게 한다(enrichment-switch는 designcut 없이 designcut2를 기록하지 않는다)
      ...(record?.features.includes('designcut') && record.features.includes('designcut2') ? { designcut2: true } : {}),
    })
    const { persuasion, ...skeleton } = plan
    const layoutContext = record?.features.includes('layouts')
      ? { vocab, category, comparisonIntensity: strategyContract.comparison_intensity }
      : undefined
    // 학부모 대리 구매형 잡은 설득 기록에 대상을 남긴다(카피·이미지가 같은 기록을 본다 — 측정·추적용)
    const audience = audienceOf(job)
    const marked = audience ? { ...persuasion, audience: audience.kind } : persuasion
    // 긴 상세페이지 — 확장 섹션의 근거(입력 값·고객 고민)를 여기서 판정해 기록한다. 편집기는 분석·리서치를 받지 않는다.
    // 디자인 컷 긴 페이지(designlong)도 같은 판정을 기록하고, 디자인 컷 계획이 그 기록으로 긴 막을 짓는다(designcut-long.ts)
    const longOn = record?.features.includes('long') || record?.features.includes('designlong')
    const long = longOn ? decideLongSections(job.spec_sheet, marked.objectionCoverage) : null
    return {
      skeleton,
      persuasion: marked,
      groundingBlock: locked(skeleton),
      enrichment,
      ...(layoutContext ? { layoutContext } : {}),
      ...(long ? { long } : {}),
    }
  }
  if (snapshotV2) {
    const enriched = record?.features.includes('persuasion') === true
    const skeleton = buildSkeleton({ snapshot: snapshotV2, specSheet: job.spec_sheet, strategyContract, enriched })
    return { skeleton, persuasion: null, groundingBlock: locked(skeleton), enrichment }
  }
  if (internalized) {
    console.warn(
      `[pdp-pipeline] internalized 잡 ${job.id} — v2 스냅샷 없는 카테고리(${category ?? '미감지'}) → standard 설계 경로 폴백`
    )
  }
  return { skeleton: null, persuasion: null, groundingBlock: buildDesignGroundingBlock(category), enrichment }
}

/** 후기 질문 콜 결과를 긴 페이지 판정에 다시 넣는다 — 콜이 없었으면(스위치 끔·글 후기 적음) 결정 그대로 */
export function withReviewFaq(
  job: PdpJobRow,
  decision: DesignSkeletonDecision,
  reviewFaq: { items: ReviewFaqItem[]; stats: ReviewFaqStats } | null
): DesignSkeletonDecision {
  if (!reviewFaq || !decision.long || !decision.persuasion) return decision
  return {
    ...decision,
    long: decideLongSections(job.spec_sheet, decision.persuasion.objectionCoverage, reviewFaq.items, reviewFaq.stats),
  }
}

/**
 * LLM 설계 결과에 골격·감사 기록을 얹는다(골격이 이긴다 — enforceSkeleton).
 * layouts 기록 잡은 골격 뒤 E-2 배정이 layout_selections를 정하고, 근거와 R7 판정을 설득 기록에 남긴다.
 */
export function applyDesignSkeleton(plan: SectionPlan, decision: DesignSkeletonDecision): SectionPlan {
  let sectionPlan = plan
  if (decision.skeleton) {
    sectionPlan = enforceSkeleton(sectionPlan, decision.skeleton)
    let persuasion = decision.persuasion
    if (persuasion && decision.layoutContext) {
      const order = sectionPlan.section_order ?? decision.skeleton.sectionOrder.map(String)
      const { selections, records } = assignLayouts({
        sectionOrder: order,
        stages: persuasion.stages,
        category: decision.layoutContext.category,
        vocab: decision.layoutContext.vocab,
        llmSelections: plan.layout_selections,
        comparisonIntensity: decision.layoutContext.comparisonIntensity,
      })
      sectionPlan.layout_selections = selections
      persuasion = {
        ...persuasion,
        layouts: records,
        rules: persuasion.rules.map((r) => (r.id === 'R7' ? checkLayoutAdjacency(order, selections) : r)),
      }
    }
    sectionPlan.internalized_skeleton = {
      roles: decision.skeleton.roles,
      excluded: decision.skeleton.excluded,
      ...(persuasion ? { persuasion } : {}),
    }
  }
  if (decision.enrichment) sectionPlan.enrichment = decision.enrichment
  if (decision.long) sectionPlan.long = decision.long
  return sectionPlan
}

/**
 * 이미지 단계 컷별 그라운딩(E-4) — shots 기록 + 설득 플래너 잡만. 연출 블록이 있는 컷은
 * [공통 규칙(유사도 방어·모바일 판독) + 역할 연출 + 연령 블록]으로 공통 타이포 수치 블록을 대신한다.
 * 그래픽·부록 D 밖 컷은 null(호출부가 기존 공통 블록을 쓴다). 그 밖의 잡은 null(Track S·구 잡 무변경).
 * 제품이 나오지 않는 컷(effectOnly)은 장면 연출만 받는다.
 * R3 촬영 계획(shotplan 기록 잡, sections = 잡의 전체 컷): 연출 블록 뒤에 역할 의도·금지와 페이지 거리·앵글 계획을 붙이고, 앵글은
 * 계획이 정한다(연출 블록의 역할 실측 앵글을 뺀다). D2 상품 컷(hero·features·cta)은 D2 장면 블록이 거리를 주므로 앵글만.
 */
export function resolveShotGrounding(
  job: PdpJobRow,
  strategyContract: StrategyContract,
  ageImageBlock: string | null,
  sections: readonly string[] = []
): ((task: { section: string; effectOnly: boolean }) => string | null) | null {
  const persuasion = persuasionOf(job)
  const vocab = persuasion && hasEnrichmentFeature(job.analysis, 'shots') ? getDesignVocab() : null
  if (!persuasion || !vocab) return null
  const ctx = {
    category: job.analysis.detected_category,
    vocab,
    grammar: persuasion.grammar,
    stylePack: strategyContract.visual_style_pack,
    proofTypes: job.research_result.proof_plan?.required_proof_types,
  }
  const plan = hasEnrichmentFeature(job.analysis, 'shotplan')
    ? planPageShots(orderByPage(sections, job.section_plan.section_order ?? []))
    : null
  const d2 = designcut2Enabled(job)
  return (task) => {
    const planned = plan?.get(task.section)
    const shot = buildRoleShotBlock(task.section, ctx, { effectOnly: task.effectOnly, planAngle: Boolean(planned) })
    if (!shot) return null
    const d2ProductCut = d2 && ['hero', 'features', 'cta'].includes(task.section.split(':')[0])
    const planBlock = plan
      ? buildShotPlanBlock(shotRoleForTask(task.section, ctx.grammar), planned, {
          omitDistance: d2ProductCut,
          effectOnly: task.effectOnly,
        })
      : null
    return [buildPooledInternalizedImageBlock(), shot, planBlock, ageImageBlock].filter(Boolean).join('\n\n')
  }
}

/**
 * 카피 단계 Track I 블록 — 플래너 잡은 Track I 블록(v2 없으면 pooled) + 설득 흐름 요약 + 특징 배정(R2) + 섹션 잇기(R4, 잇기가
 * 있을 때), 그 밖은 기존 판정.
 */
const bridgeOptions = (job: PdpJobRow) => ({ hookShort: hasEnrichmentFeature(job.analysis, 'hookshort') })

export function resolveInternalizedCopyBlock(job: PdpJobRow, category: string): string | null {
  const persuasion = persuasionOf(job)
  if (persuasion) {
    const base = buildInternalizedCopyBlock(category) ?? buildPooledInternalizedCopyBlock()
    const sections = persuasion.stages.map((s) => s.section)
    const bridgeBlock = buildSectionBridgeBlock(planSectionBridges(persuasion.stages, bridgeOptions(job)))
    return [base, buildPersuasionFlowBlock(persuasion), buildFeatureOwnershipBlock(sections), bridgeBlock]
      .filter(Boolean)
      .join('\n\n')
  }
  return resolveGenerationTrack(job) === 'internalized' ? buildInternalizedCopyBlock(category) : null
}

/**
 * 카피 기록 잡 입력(R4 pdp-r4-copy-flow) — 설득 플래너 기록 잡만. 그 밖의 잡은 null(프롬프트 그대로).
 * - 전략 지시: 분석의 구매 결정 성향(decision_profile)과 리서치 기획 뼈대의 후킹 진단(planning_skeleton.hook_score — 리서치
 *   원본 값)을 Stage 1 전략 블록으로 넘긴다(NEXFIT copywriting_agent.py:1082-1087). 가격 환산·입력 밖 수치 지시는 사실형으로.
 * - Stage 3 특징 배정: Stage 1과 같은 배정(검수용 — Stage 3에 없는 지시는 들먹이지 않는다) — 검수가 번호 짝을 되돌리지 않게
 *   (applyFeatureOwnershipToStage3).
 * - Stage 2·3 섹션 잇기 보존(R4 copy-bridge): 다듬거나 검수할 때 이어받은 낱말을 지우지 않게. 잇기가 없으면 넘기지 않는다.
 */
export function recordedCopyInputs(job: PdpJobRow): {
  decisionProfile?: DecisionProfile
  hookScore?: Partial<HookScore>
  factOnlyStrategy: true
  stage3OwnershipBlock: string
  stageBridgeBlock?: string
} | null {
  const persuasion = persuasionOf(job)
  if (!persuasion) return null
  const decisionProfile = job.analysis.decision_profile
  const hookScore = hookScoreOf(job.research_result)
  const bridgeKeep = buildSectionBridgeKeepBlock(planSectionBridges(persuasion.stages, bridgeOptions(job)))
  return {
    ...(decisionProfile ? { decisionProfile } : {}),
    ...(hookScore ? { hookScore } : {}),
    factOnlyStrategy: true,
    stage3OwnershipBlock: buildFeatureOwnershipBlock(
      persuasion.stages.map((s) => s.section),
      { review: true }
    ),
    ...(bridgeKeep ? { stageBridgeBlock: bridgeKeep } : {}),
  }
}

/**
 * 후킹 진단 — 0~1 사이 숫자(숫자 문자열 포함, NEXFIT float())인 항목만. 없는 항목에 기본값(리서치 파서의 0.5)을 붙이면 미달로
 * 읽혀 보강 지시가 모두 켜지고, 범위 밖 값(음수·백분율 척도)은 지시를 잘못 켜거나 끈다 — 둘 다 넘기지 않는다.
 */
function hookScoreOf(research: ResearchResult): Partial<HookScore> | undefined {
  const raw = research.planning_skeleton?.hook_score
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const entries = Object.entries(raw)
    .map(([key, value]) => [key, typeof value === 'string' && value.trim() ? Number(value) : value] as const)
    .filter((entry): entry is readonly [string, number] => {
      const value = entry[1]
      return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1
    })
  return entries.length > 0 ? (Object.fromEntries(entries) as Partial<HookScore>) : undefined
}

/**
 * 주장 범위(R2 — R1 P03 효능 감점) — 설득 플래너 기록 잡만. 해결 칸은 기능·구성, 비교는 보이는 구조 차이만,
 * 신체 접촉 상품(분석 카테고리 beauty 또는 상품명의 신체 부위·마사지 낱말 — 물건용·기기용 제외, R3)은 결과 주장 금지까지.
 * 그 밖은 null(기존 그대로).
 */
export function resolveClaimGuardBlock(job: PdpJobRow): string | null {
  if (!persuasionOf(job)) return null
  return buildClaimGuardBlock({
    productName: job.spec_sheet.productName,
    category: job.analysis.detected_category ?? job.spec_sheet.category,
    keywords: job.analysis.keywords,
  })
}

/**
 * 품질 보고서 layouts(설계 §4.6, T4b) — 배정·LLM 교체·충돌 해소는 E-2 배정 기록, 적용·가드 탈락은 편집기 최초 빌드 측정.
 * 배정 기록이 없는 잡(layouts 미기록)은 null. LLM 교체는 기록에 llm이 남은 잡(T4b 이후)만 센다.
 */
export function layoutQualityReport(
  job: PdpJobRow,
  render?: EditorBuildStats['layouts'] | null
): NonNullable<PdpQualityReport['layouts']> | null {
  const records = job.section_plan.internalized_skeleton?.persuasion?.layouts ?? []
  if (records.length === 0) return null
  return {
    sections: records.length,
    assigned: records.filter((r) => r.category !== 'minimal').length,
    llmKept: records.filter((r) => r.source === 'llm').length,
    llmReplaced: records.filter((r) => r.llm && r.llm !== r.category).length,
    conflictResolved: records.filter((r) => r.source === 'conflict').length,
    ...(render ? { ...render } : {}),
  }
}

/**
 * 합성 단계 Track I 후처리 — 테마(v2 있을 때, 기록 잡은 정정 매핑)와 quality_report.
 * 기록 잡은 trustStack을 v2 또는 vocab 셀(pooled) 출현율로 만들어 항상 보고서를 남긴다. 구 잡은 기존 그대로.
 */
export function resolveComposeTrackI(
  job: PdpJobRow,
  palette: DesignPalette | null,
  render?: EditorBuildStats | null
): { themeStyles?: InternalizedThemeMap; qualityReport?: PdpQualityReport } {
  if (resolveGenerationTrack(job) !== 'internalized') return {}
  const category = job.analysis.detected_category
  const snapshotV2 = getCorpusSnapshotV2(category)
  const enriched = usesEnrichedMapping(job)
  const themeStyles = snapshotV2 ? buildInternalizedTheme(snapshotV2, palette, roleSectionMap(enriched)) : undefined
  if (!enriched) {
    return { themeStyles, ...(snapshotV2 ? { qualityReport: buildQualityReport(job.section_plan, snapshotV2) } : {}) }
  }
  // 기록 잡 확장 필드(T4b) — 장식·배정 결과(편집기 최초 빌드 측정이 있으면 그 수치까지)
  const measured = {
    annotations: annotationQualityReport(job, render?.annotations),
    layouts: layoutQualityReport(job, render?.layouts),
  }
  if (snapshotV2) {
    const qualityReport = buildEnrichedQualityReport({
      sectionPlan: job.section_plan,
      trustStack: snapshotV2.profile.trustStack,
      evidenceLevel: { level: 'v2', priorSource: `v2:${category ?? ''}`, note: '카테고리 실측 레시피(v2) 기준' },
      ...measured,
    })
    return { themeStyles, qualityReport: withBridgeReport(qualityReport, job) }
  }
  const lookup = lookupVocabCell(category)
  const trustStack: TrustStack = lookup ? buildVocabTrustStack(lookup.cell) : { required: [], recommended: [] }
  const pooled = !lookup || lookup.priorSource.endsWith(':pooled')
  const qualityReport = buildEnrichedQualityReport({
    sectionPlan: job.section_plan,
    trustStack,
    evidenceLevel: {
      level: pooled ? 'pooled' : 'category',
      priorSource: lookup?.priorSource ?? 'none',
      note: pooled ? '범용 근거 — 카테고리 실측 레시피 없음(쿠팡·네이버 전체 분포)' : '디자인 어휘 카테고리 셀 기준',
    },
    ...measured,
  })
  return { themeStyles, qualityReport: withBridgeReport(qualityReport, job) }
}

/** 품질 보고서 bridges(R4 섹션 잇기) — 설득 기록·최종 카피가 있는 잡만. 카피 기준 측정(measureSectionBridges) */
function withBridgeReport(report: PdpQualityReport, job: PdpJobRow): PdpQualityReport {
  const persuasion = persuasionOf(job)
  const copy = job.copy_sections.final
  if (!persuasion || !copy) return report
  return { ...report, bridges: measureSectionBridges(planSectionBridges(persuasion.stages, bridgeOptions(job)), copy) }
}
