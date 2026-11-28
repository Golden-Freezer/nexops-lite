/**
 * 설득 구조 플래너 `planPersuasionSkeleton` — docs/plans/pdp-enrichment/00_DESIGN.md §4.2(E-1). 순수 함수·결정론(LLM 0, 난수 0).
 * Track I에서 ENRICHMENT persuasion이 기록된 잡의 골격 결정자다. 상품 차이는 입력(고민·근거·전략)에서만 나온다.
 *
 * 흐름: 문법 변형 → 근거 기반 포함 결정 → 고민 → 응답 → 설득 단계 순서(단계 안은 실측 위치 기대값, 불안 해소는 고민 우선순위)
 *       → 주장-증거 인접 → G3 불안 해소 제한 → 길이 상한(brand_story 먼저 제외) → R1 보정(첫 가치 5번째 이내)
 *       → 빠진 응답 섹션 재계산 → R1~R8 검사.
 * 역할 → 섹션 전개는 정정 매핑(role-section-map ROLE_TO_SECTIONS_ENRICHED)과 같다(테스트로 대조).
 */

import { ProSectionType as S } from '@/lib/registration/editor/types/section'
import type { Role16 } from '../corpus-v2'
import { lookupVocabCell } from '../design-vocab'
import { isHostedPdpEnv } from '../enrichment-switch'
import type { AnalysisResult } from '../pdp-state'
import { classifyObjection, type ObjectionType } from './objection-types'
import { checkPersuasionRules, type PersuasionGrammar, type PersuasionRuleResult } from './persuasion-rules'
import {
  ANSWER_FALLBACK,
  answerFor,
  certificationClaimIndex,
  evidenceOf,
  OPTION_SPEC_CATALOG_REASON,
  hasUsageFeature,
  hookGate,
  priorFor,
  selectGrammar,
  type PersuasionInput,
} from './persuasion-signals'

export { selectGrammar, type PersuasionInput } from './persuasion-signals'

export type PersuasionStage = 'ATTENTION' | 'RELEVANCE' | 'VALUE' | 'PROOF' | 'ASSURANCE' | 'ACTION'

export interface PersuasionRecord {
  grammar: PersuasionGrammar
  lengthTarget: [number, number]
  stages: Array<{ section: string; role: string; stage: PersuasionStage; reason: string }>
  objectionCoverage: Array<{ objection: string; type: ObjectionType; answeredBy: string | null; note?: string }>
  /** E-2(T3)가 채운다 */
  layouts: Array<{
    section: string
    category: string
    source: 'llm' | 'vocab' | 'conflict' | 'default'
    reason: string
    /** LLM이 처음 고른 카테고리(있을 때) — 품질 보고서 LLM 교체 수(T4b) */
    llm?: string
  }>
  rules: PersuasionRuleResult[]
  priorSource: string
  vocabHash: string
  /** 학부모 대리 구매형 잡만(parent_proxy 2단계) — 설계 단계가 잡 기록(analysis.enrichment.audience)을 옮겨 적는다 */
  audience?: 'parent_proxy'
}

export interface PersuasionPlan {
  roles: Array<{ role: Role16; reason: string }>
  activatedSections: S[]
  sectionOrder: S[]
  excluded: Array<{ role: Role16; reason: string }>
  persuasion: PersuasionRecord
}

interface Item {
  section: S
  role: Role16 | 'cta'
  stage: PersuasionStage
  /** 정렬 칸 — 기본은 단계 순번. 주장-증거 인접·R1 보정이 증거 섹션을 가치 단계 칸으로 옮길 때만 바뀐다 */
  slot: number
  key: number
  reason: string
}

const STAGE_ORDER: Record<PersuasionGrammar, PersuasionStage[]> = {
  G1: ['ATTENTION', 'RELEVANCE', 'VALUE', 'PROOF', 'ASSURANCE', 'ACTION'],
  G2: ['ATTENTION', 'RELEVANCE', 'PROOF', 'VALUE', 'ASSURANCE', 'ACTION'],
  G3: ['ATTENTION', 'RELEVANCE', 'VALUE', 'PROOF', 'ASSURANCE', 'ACTION'],
  G4: ['ATTENTION', 'RELEVANCE', 'VALUE', 'PROOF', 'ASSURANCE', 'ACTION'],
}
const LENGTH_TARGETS: Record<string, [number, number]> = { quick: [7, 10], standard: [10, 14], persuasive: [14, 18] }
/**
 * W4-S 섹션 나누기(ENRICHMENT 'split' 기록 잡) — 길이 목표 [20,24], 상한 24(중앙값×1.5 대신, 오너 지시 2026-11-01 — 860 폭 30,000px 내외, 실측 섹션당
 * 1,433~1,519px). 사실 없는 상품은 채움까지 써도 17~18개라 R6이 미달로 남는다 — 실제 미달을 알리는 신호다(하한을 낮추면 채움도 일찍 멈춘다).
 * 편집기 변환기가 특징·사용 단계를 하나씩 섹션으로 펼치므로 그 섹션들은 예상 개수(카피 전이라 예상치 — 특징 3+3, 사용 단계 3)로 센다
 */
const SPLIT_LENGTH: [number, number] = [20, 24]
/**
 * 디자인 컷 D2 길이 목표 [18,22](오너 지시 2026-11-01 — 섹션 20개 내외). 상한은 후기·추천이 빠지지 않게 하는 값이고, 하한은 플래너가 아니라
 * 이미지 쪽 추가 컷이 채운다(사실 없이 쓸 수 있는 사용 장면·앵글 — shot-diversity planExtraShotsForLength)
 */
const D2_LENGTH: [number, number] = [18, 22]
/**
 * 나누기 잡 길이 채움 — 사실 입력이 필요 없고 카피·컷이 이미 있는 섹션만 목표 하한까지 더한다. 근거 게이트가 있는 섹션은 넣지 않는다.
 * Pro 잡은 이 컷(key_benefit_visual·direction_hint·concept_mood)을 이미 만들어 왔다. 추천 대상은 카피 recommendedTargets다.
 * convert_div는 넣지 않는다 — 편집기에서 마무리와 같은 글(closingCta)·같은 컷(cta)을 그려 같은 말이 된다(render-check 41258416813)
 */
const SPLIT_FILL: ReadonlyArray<{ section: S; role: Role16 }> = [
  { section: S.KEY_MESSAGE, role: 'usp_feature' },
  { section: S.DIRECTION_SUGGEST, role: 'usp_feature' },
  { section: S.CONCEPT_DESC, role: 'brand_story' },
  { section: S.POINT_LIST_DIV, role: 'target_recommendation' },
]
const SPLIT_FILL_REASON = '길이 채움 — 사실 요구 없음'
// 역할 표(role-section-map)에는 넣지 않는다 — 그 표는 역할 → 섹션 전개라, 넣으면 채움이 아닌 잡의 골격까지 늘어난다

/**
 * 나누기 잡 길이 목표 — 로컬 NEXOPS_PDP_SECTION_TARGET='최소,최대'(1~40, 최소 ≤ 최대)로 조정한다(W1 결과에 맞춰 코드 배포 없이,
 * 통합 확정 계약). 형식이 틀리거나 Vercel이면 기본값. 쓴 값은 설득 기록 lengthTarget에 남아 측정 R6와 같다
 */
export function splitLengthTarget(env: Record<string, string | undefined> = process.env): [number, number] {
  const raw = env.NEXOPS_PDP_SECTION_TARGET?.trim()
  if (!raw || isHostedPdpEnv(env)) return SPLIT_LENGTH
  const m = raw.match(/^(\d{1,2})\s*,\s*(\d{1,2})$/)
  const [min, max] = m ? [Number(m[1]), Number(m[2])] : [0, 0]
  return min >= 1 && max <= 40 && min <= max ? [min, max] : SPLIT_LENGTH
}
const SPLIT_WEIGHT: Partial<Record<string, number>> = { [S.POINT_DIV]: 3, [S.SUB_DIV]: 3, [S.HIDDEN_PAGE]: 3 }
/** 결정론 동률 정렬용 고정 순서 */
const ROLE_RANK: Role16[] = [
  'hook',
  'product_intro',
  'problem',
  'brand_story',
  'target_recommendation',
  'usp_feature',
  'social_proof',
  'certification_evidence',
  'authenticity',
  'how_to_guide',
  'size_spec',
  'option_catalog',
  'faq',
  'promotion_offer',
  'shipping_cs',
  'legal_notice',
]
const PROOF_SECTIONS = new Set<string>([S.PERFORMANCE_REVIEWS, S.PERFORMANCE_RATING, S.CERTIFICATION])
/** 일부 섹션만 빠지는 단위(역할은 남는다) — 점수 절반으로 먼저 빠진다 */
const PARTIAL_SECTIONS = new Set<string>([S.PROBLEM_EMPATHY, S.SUB_DIV, S.PRODUCT_EXPOSURE, S.PERFORMANCE_RATING])

const roleIndex = (role: string) => (role === 'cta' ? 99 : ROLE_RANK.indexOf(role as Role16))
const sortItems = (list: Item[]) =>
  list.sort((a, b) => a.slot - b.slot || a.key - b.key || roleIndex(a.role) - roleIndex(b.role))

/** 포함 결정 — 근거 없는 섹션 금지, 렌더 활성 조건과 일치(설계 §4.2 "포함 결정"). */
function decideRoles(input: PersuasionInput, grammar: PersuasionGrammar, objectionTypes: Set<ObjectionType>) {
  const { specSheet: spec, analysis, strategyContract: sc } = input
  const ev = evidenceOf(spec, analysis)
  const dp = (analysis as AnalysisResult & { decision_profile?: { explanation_depth?: string; giftability?: string } })
    .decision_profile
  const urgencies = (analysis.pain_clusters ?? []).map((p) => p.urgency)
  const included = new Map<Role16, string>()
  const excluded: PersuasionPlan['excluded'] = []
  const decide = (role: Role16, ok: boolean, yes: string, no: string) =>
    ok ? included.set(role, yes) : excluded.push({ role, reason: no })

  const hook = hookGate(input)
  decide('hook', hook.ok, hook.reason, hook.reason)
  included.set('product_intro', '필수(main_cut)')
  const painSignal =
    urgencies.some((u) => u === 'medium' || u === 'high') ||
    sc.persuasion_axis === 'emotion' ||
    sc.persuasion_axis === 'balanced' ||
    sc.hook_mode === 'empathy' ||
    sc.hook_mode === 'shock'
  const painOk = grammar === 'G3' ? urgencies.includes('high') : painSignal
  const problemNo = hook.ok ? '공감 신호 부족' : `hook_gate 미통과 — ${hook.reason}`
  decide('problem', hook.ok && painOk, '공감 신호(고통 긴급도·축·후킹 방식) + hook_gate', problemNo)
  included.set('usp_feature', '필수(첫 가치)')
  const brandSignal =
    sc.persuasion_axis === 'emotion' || Boolean(spec.brandVoiceGuide?.trim()) || dp?.giftability === 'high'
  decide('brand_story', brandSignal, '감성 축·브랜드 보이스·선물성', '감성·브랜드 신호 없음')
  decide('social_proof', ev.reviews, '리뷰 근거 있음', '리뷰 데이터 없음 — 근거 없는 후기 섹션 금지')
  decide(
    'certification_evidence',
    ev.cert,
    'certificationInfo 있음',
    'certificationInfo 없음 — 근거 없는 인증 섹션 금지'
  )
  decide('promotion_offer', ev.event, 'eventBannerInfo 있음', 'eventBannerInfo 없음 — 근거 없는 이벤트 섹션 금지')
  decide('size_spec', ev.dims, '치수 있음', 'spec_sheet에 치수 없음 — 환각 치수 금지')
  decide('option_catalog', ev.options, ev.optionSpec ? OPTION_SPEC_CATALOG_REASON : '옵션 ≥ 4', '옵션 수 < 4 — 옵션 카탈로그 성립 불가')
  const usageSignal =
    objectionTypes.has('usage_care') ||
    (dp?.explanation_depth !== undefined && dp.explanation_depth !== 'quick') ||
    hasUsageFeature(spec)
  const usageNo = usageSignal ? '사용 순서 근거 없음' : '사용법 신호 없음'
  decide('how_to_guide', usageSignal && ev.usageBasis, '사용법 고민·설명 깊이·사용 서술 + 근거', usageNo)
  const targetSignal =
    sc.purchase_context === 'gift' ||
    sc.purchase_context === 'family' ||
    Boolean(spec.targetPersona?.trim()) ||
    objectionTypes.has('environment_versatility')
  decide('target_recommendation', targetSignal, '선물·가족·대상·활용도 고민', '대상·활용 신호 없음')
  excluded.push(
    { role: 'faq', reason: 'FAQ 렌더러 없음 — 고민은 미응답 기록' },
    { role: 'shipping_cs', reason: '플랫폼 영역 — 생성 제외' },
    { role: 'legal_notice', reason: '플랫폼 영역 — 생성 제외' },
    {
      role: 'authenticity',
      reason: ev.cert
        ? '정품 근거는 certification 한 섹션으로 통합'
        : 'certificationInfo 없음 — 근거 없는 정품 보장 금지',
    }
  )
  return { included, excluded, ev }
}

export function planPersuasionSkeleton(input: PersuasionInput): PersuasionPlan {
  const { specSheet: spec, analysis, strategyContract: sc } = input
  const { grammar } = selectGrammar(sc, spec, analysis)
  const stageIndex = (stage: PersuasionStage) => STAGE_ORDER[grammar].indexOf(stage)
  const objections = (analysis.objection_priority ?? []).map((text) => ({ text, type: classifyObjection(text) }))
  const { included, excluded, ev } = decideRoles(input, grammar, new Set(objections.map((o) => o.type)))
  const roleSet = new Set(included.keys())
  let coverage = objections.map((o) => ({ objection: o.text, type: o.type, ...answerFor(o.type, roleSet, ev) }))
  const answerRank = (section: string) => coverage.findIndex((o) => o.answeredBy === section)
  const expectedOf = (role: Role16) => priorFor(role, input).expected

  // ── 섹션 전개 + 단계 배정 ──
  const items: Item[] = []
  const push = (section: S, role: Role16 | 'cta', stage: PersuasionStage, reason: string, key: number) =>
    items.push({ section, role, stage, slot: stageIndex(stage), key, reason })
  if (included.has('hook')) push(S.HOOK_3STEP, 'hook', 'ATTENTION', included.get('hook')!, -1)
  push(S.MAIN_CUT, 'product_intro', 'ATTENTION', '필수 — 첫 화면 상품', 0)
  push(S.PRODUCT_EXPOSURE, 'product_intro', 'VALUE', '상품 노출(생성 예정 컷)', expectedOf('product_intro'))
  if (included.has('problem')) {
    const k = expectedOf('problem')
    push(S.PROBLEM_RAISE, 'problem', 'RELEVANCE', included.get('problem')!, k)
    if (grammar !== 'G2') push(S.PROBLEM_EMPATHY, 'problem', 'RELEVANCE', '공감 확장', k + 0.001)
    push(S.SOLUTION_GUIDE, 'problem', 'RELEVANCE', '문제-해결 짝(PAS)', k + 0.002)
  }
  if (included.has('brand_story')) {
    const stage = grammar === 'G4' ? 'RELEVANCE' : 'VALUE'
    push(S.CONCEPT_DESC, 'brand_story', stage, included.get('brand_story')!, expectedOf('brand_story'))
  }
  if (included.has('target_recommendation')) {
    const answers = answerRank(S.POINT_LIST_DIV) !== -1
    const stage = grammar === 'G4' && !answers ? 'RELEVANCE' : 'ASSURANCE'
    const reason = answers ? '활용도 고민 응답' : included.get('target_recommendation')!
    push(S.POINT_LIST_DIV, 'target_recommendation', stage, reason, expectedOf('target_recommendation'))
  }
  push(S.POINT_DIV, 'usp_feature', 'VALUE', '첫 가치 — 가치 단계를 연다', -1)
  const benefitCount = (analysis.benefit_clusters ?? []).filter((b) => b.weight >= 0.2).length
  if (input.split || benefitCount >= 3 || answerRank(S.SUB_DIV) !== -1) {
    const reason =
      benefitCount >= 3 ? '가치 군집 3개 이상' : answerRank(S.SUB_DIV) !== -1 ? '품질 고민 클로즈업 증거' : '나누기 — 특징 4~6'
    push(S.SUB_DIV, 'usp_feature', 'VALUE', reason, expectedOf('usp_feature') + 0.001)
  }
  if (included.has('social_proof')) {
    const pos = sc.review_position_strategy
    const k = pos === 'front' ? -1 : pos === 'back' ? 99 : expectedOf('social_proof')
    push(S.PERFORMANCE_REVIEWS, 'social_proof', 'PROOF', included.get('social_proof')!, k)
    if (ev.rating) push(S.PERFORMANCE_RATING, 'social_proof', 'PROOF', '실평점 있음', k + 0.001)
  }
  if (included.has('certification_evidence')) {
    const reason = included.get('certification_evidence')!
    push(S.CERTIFICATION, 'certification_evidence', 'PROOF', reason, expectedOf('certification_evidence'))
  }
  for (const [role, section] of [
    ['how_to_guide', S.HIDDEN_PAGE],
    ['size_spec', S.SPEC_TABLE],
    ['option_catalog', S.PETIT_DIV],
  ] as const) {
    if (!included.has(role)) continue
    // 등록 옵션 구조의 옵션 카탈로그는 불안 해소 단계의 마지막(cta 바로 앞) — 05_OPTIONS.md §4
    const key = role === 'option_catalog' && ev.optionSpec ? 90 : expectedOf(role)
    push(section, role, 'ASSURANCE', included.get(role)!, key)
  }
  if (included.has('promotion_offer')) {
    push(S.EVENT_BANNER, 'promotion_offer', 'ACTION', included.get('promotion_offer')!, 98)
  }
  push(S.CTA, 'cta', 'ACTION', '필수 — 마지막 행동', 99)

  // 불안 해소 단계는 고민 우선순위 순(응답 섹션 먼저). 등록 옵션 카탈로그는 응답이어도 단계 마지막에 둔다
  for (const item of items) {
    const rank = answerRank(item.section)
    if (item.role === 'option_catalog' && ev.optionSpec) continue
    if (item.stage === 'ASSURANCE' && rank !== -1) item.key = -10 + rank
  }
  // 주장-증거 인접 — 인증 정보가 특정 가치 군집을 뒷받침하면 certification을 그 usp 섹션 바로 뒤에 둔다
  const claim = certificationClaimIndex(spec, analysis)
  const cert = items.find((i) => i.section === S.CERTIFICATION)
  if (cert && claim !== -1) {
    const hasSub = items.some((i) => i.section === S.SUB_DIV)
    const target = items.find((i) => i.section === (claim > 0 && hasSub ? S.SUB_DIV : S.POINT_DIV))!
    cert.slot = target.slot
    cert.key = target.key + 0.0005
    cert.reason = `${cert.reason} · 주장(가치 군집 ${claim + 1}) 바로 뒤 증거`
  }
  sortItems(items)

  const dropped = new Set<S>()
  const drop = (sections: S[], role: Role16, reason: string) => {
    const live = sections.filter((s) => items.some((i) => i.section === s) && !dropped.has(s))
    if (live.length === 0) return
    live.forEach((s) => dropped.add(s))
    const partial = items.some((i) => i.role === role && !dropped.has(i.section))
    excluded.push({ role, reason: `${partial ? '[일부 섹션 — 역할 유지] ' : ''}${reason}(${live.join('·')})` })
  }
  // G3 즉시 가치형 — 불안 해소는 상위 고민(3개) 응답만
  if (grammar === 'G3') {
    for (const item of items) {
      const rank = answerRank(item.section)
      // 등록 옵션 안내(optionSpec)는 고민 응답이 아니어도 남긴다 — 무엇을 고르는지는 구매 결정 정보다
      if (item.role === 'option_catalog' && ev.optionSpec) continue
      if (item.stage === 'ASSURANCE' && (rank === -1 || rank > 2)) {
        drop([item.section], item.role as Role16, 'G3 즉시 가치형 — 불안 해소는 상위 고민 응답만')
      }
    }
  }

  // ── 길이 상한(brand_story는 길이가 부족하면 먼저 제외 — 설계 §4.2) ──
  const range = input.split
    ? splitLengthTarget()
    : input.designcut2
      ? D2_LENGTH
      : (LENGTH_TARGETS[sc.page_length_target ?? 'standard'] ?? LENGTH_TARGETS.standard)
  const cellMedian = lookupVocabCell(input.category, input.vocab)?.cell.sectionCountMedian
  const median = input.snapshotV2?.profile.sectionCountMedian ?? cellMedian ?? range[1]
  const cap = input.split || input.designcut2 ? range[1] : Math.max(1, Math.min(range[1], Math.floor(median * 1.5)))
  // 나누기 잡만 펼쳐질 섹션을 예상 개수로 센다 — 그 밖의 잡은 섹션 하나 = 1(지금 그대로)
  const weightOf = (section: string) => (input.split ? (SPLIT_WEIGHT[section] ?? 1) : 1)
  const liveCount = () => items.reduce((n, i) => n + (dropped.has(i.section) ? 0 : weightOf(i.section)), 0)
  const lengthTarget: [number, number] = [Math.min(range[0], cap), cap]
  const topAnswer = coverage[0]?.answeredBy
  const protectedSections = new Set<string>([
    S.MAIN_CUT,
    S.CTA,
    S.POINT_DIV,
    ...(topAnswer ? [topAnswer] : []),
    // 등록 옵션 안내(optionSpec)는 길이 상한에서 빼지 않는다(같은 이유)
    ...(ev.optionSpec ? [S.PETIT_DIV] : []),
  ])
  const proofText = (input.research?.proof_plan?.required_proof_types ?? []).join(' ')
  const signal = (role: Role16) => {
    let score = 1
    if (items.some((i) => i.role === role && answerRank(i.section) !== -1)) score += 2
    if (role === 'social_proof' && /후기|리뷰/.test(proofText)) score += 1
    if ((role === 'how_to_guide' || role === 'target_recommendation') && /사용|활용/.test(proofText)) score += 1
    if (role === 'size_spec' && /스펙|치수|사이즈/.test(proofText)) score += 1
    if (role === 'target_recommendation' && sc.purchase_context === 'gift') score += 1
    return score
  }
  const units: Array<{ sections: S[]; role: Role16; score: number }> = []
  for (const item of items) {
    if (item.role === 'cta' || protectedSections.has(item.section) || dropped.has(item.section)) continue
    if (item.section === S.SOLUTION_GUIDE) continue // problem_raise 단위와 함께 빠진다
    const role = item.role as Role16
    const sections =
      item.section === S.PROBLEM_RAISE ? [S.PROBLEM_RAISE, S.PROBLEM_EMPATHY, S.SOLUTION_GUIDE] : [item.section]
    const weight = PARTIAL_SECTIONS.has(item.section) ? 0.5 : 1
    const score = role === 'brand_story' ? -1 : priorFor(role, input).prevalence * signal(role) * weight
    units.push({ sections, role, score })
  }
  units.sort((a, b) => a.score - b.score || roleIndex(b.role) - roleIndex(a.role))
  const capReason = input.split
    ? `길이 상한 ${cap}(나누기 — 목표 ${range.join('~')}) — 출현율×신호 점수 하위`
    : input.designcut2
      ? `길이 상한 ${cap}(디자인 컷 D2 — 목표 ${range.join('~')}) — 출현율×신호 점수 하위`
      : `길이 상한 ${cap}(목표 ${range.join('~')}, 중앙값 ${median}×1.5) — 출현율×신호 점수 하위`
  for (const unit of units) {
    if ((input.split ? liveCount() : items.length - dropped.size) <= cap) break
    drop(unit.sections, unit.role, capReason)
  }
  // 나누기 잡 길이 채움 — 뺀 섹션은 되살리지 않는다. 가치 단계 끝(증거·불안 해소 앞)에 놓여 첫 가치 위치(R1)를 밀지 않는다
  if (input.split) {
    SPLIT_FILL.forEach(({ section, role }, i) => {
      if (liveCount() >= lengthTarget[0] || items.some((item) => item.section === section)) return
      push(section, role, 'VALUE', SPLIT_FILL_REASON, 50 + i)
      if (!included.has(role)) included.set(role, SPLIT_FILL_REASON)
      const refused = excluded.findIndex((e) => e.role === role)
      if (refused !== -1) excluded.splice(refused, 1)
    })
    sortItems(items)
  }
  const kept = items.filter((i) => !dropped.has(i.section))

  // ── R1 보정 — 첫 가치(point_div)가 5번째 이내가 되도록 부록 A가 허용하는 이동·생략을 차례로 적용 ──
  const keptDrop = (section: S, reason: string) => {
    const at = kept.findIndex((i) => i.section === section)
    if (at === -1) return false
    drop([section], kept[at].role as Role16, reason)
    kept.splice(at, 1)
    return true
  }
  const r1Note = 'R1(첫 가치 5번째 이내) 유지'
  const dropProblemPair = () => {
    const had = kept.some((i) => i.section === S.PROBLEM_RAISE)
    if (!had) return false
    for (const section of [S.PROBLEM_RAISE, S.SOLUTION_GUIDE])
      keptDrop(section, `${r1Note} — G2 증거 선행 유지로 공감 짝 생략`)
    return true
  }
  for (let guard = 0; guard < 8; guard++) {
    const valueAt = kept.findIndex((i) => i.section === S.POINT_DIV)
    if (valueAt <= 4) break
    const before = kept.slice(0, valueAt)
    const movable = before.find(
      (i) => i.stage === 'RELEVANCE' && (i.section === S.POINT_LIST_DIV || i.section === S.CONCEPT_DESC)
    )
    const proof = [...before].reverse().find((i) => PROOF_SECTIONS.has(i.section))
    if (movable) {
      // 공감 단계의 이동 가능한 섹션: target_recommendation → 불안 해소, brand_story → 가치
      movable.stage = movable.section === S.POINT_LIST_DIV ? 'ASSURANCE' : 'VALUE'
      movable.slot = stageIndex(movable.stage)
      movable.reason = `${movable.reason} · ${r1Note}로 단계 이동`
    } else if (keptDrop(S.PROBLEM_EMPATHY, `${r1Note} — 공감 확장 생략`)) {
      // 공감 확장은 문제-해결 짝 없이도 빠질 수 있다
    } else if (grammar === 'G2' && proof && dropProblemPair()) {
      // G2 증거 선행형은 증거가 가치보다 앞서야 한다 — 증거를 옮기기 전에 공감 짝을 먼저 뺀다
    } else if (grammar === 'G2' && proof && keptDrop(S.HOOK_3STEP, `${r1Note} — G2 증거 선행 유지로 후킹 생략`)) {
      // 같은 이유로 후킹도 증거보다 먼저 뺀다
    } else if (proof) {
      // 그래도 넘치는 증거는 가치 단계 뒤로(G2 표지는 유지하되 사유를 남긴다)
      proof.slot = stageIndex('VALUE') + 0.5
      proof.reason = `${proof.reason} · ${r1Note}로 가치 단계 뒤로`
    } else if (!keptDrop(S.HOOK_3STEP, `${r1Note} — 후킹 생략`)) {
      break
    }
    sortItems(kept)
  }
  const order = kept.map((i) => i.section)
  // 나중에 역할 전체가 빠졌으면 앞서 단 "[일부 섹션 — 역할 유지]" 표지를 걷어낸다
  const keptRoleSet = new Set(kept.map((i) => i.role))
  for (const entry of excluded) {
    if (!keptRoleSet.has(entry.role)) entry.reason = entry.reason.replace('[일부 섹션 — 역할 유지] ', '')
  }

  // 응답 섹션이 골격에서 빠졌으면 설계 표의 대체(usp 컷)로 바꾸거나 미응답으로 기록한다
  coverage = coverage.map((o) => {
    if (!o.answeredBy || order.includes(o.answeredBy as S)) return o
    const fallback = ANSWER_FALLBACK[o.answeredBy]
    if (fallback && order.includes(fallback.section as S)) {
      return { ...o, answeredBy: fallback.section, note: fallback.note }
    }
    return { ...o, answeredBy: null, note: `응답 섹션(${o.answeredBy})이 골격에서 제외 — 미응답` }
  })

  const supported = (section: string) => {
    if (section === S.PERFORMANCE_REVIEWS) return ev.reviews
    if (section === S.PERFORMANCE_RATING) return ev.rating
    if (section === S.SPEC_TABLE) return ev.dims
    if (section === S.CERTIFICATION) return ev.cert
    if (section === S.EVENT_BANNER) return ev.event
    if (section === S.PETIT_DIV) return ev.optionSpec || (spec.colorOptions?.length ?? 0) >= 2
    if (section === S.HIDDEN_PAGE) return ev.usageBasis
    return true
  }
  const rules = checkPersuasionRules(order, {
    grammar,
    lengthTarget,
    isSupported: supported,
    objectionCoverage: coverage,
    ...(input.split ? { sectionCount: order.reduce((n, s) => n + weightOf(s), 0) } : {}),
  })
  const keptRoles = [...new Set(kept.map((i) => i.role).filter((r): r is Role16 => r !== 'cta'))]
  const priorSource = input.snapshotV2
    ? `v2:${input.category ?? ''}`
    : (lookupVocabCell(input.category, input.vocab)?.priorSource ?? 'none')

  return {
    roles: keptRoles.map((role) => ({ role, reason: included.get(role) ?? '' })),
    activatedSections: [...order],
    sectionOrder: [...order],
    excluded,
    persuasion: {
      grammar,
      lengthTarget,
      stages: kept.map((i) => ({ section: i.section, role: i.role, stage: i.stage, reason: i.reason })),
      objectionCoverage: coverage,
      layouts: [],
      rules,
      priorSource,
      vocabHash: input.vocab.contentHash,
    },
  }
}
