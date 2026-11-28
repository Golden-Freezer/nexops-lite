/**
 * Trust gate — 산출 후 신뢰요소 검수(결정 T-6, WORK_SPEC B-3 이식). 순수 함수, LLM 0.
 * 최종 activated_sections를 v2 trustStack(required/recommended — 실측 출현율 임계 0.50/0.35 고정)과
 * 대조해 누락을 보고한다. 생성 차단은 하지 않는다 — 경고 배지·행동 힌트만(compose 후처리에서 실행,
 * 결과는 copy_sections.quality_report로 저장).
 */

import type { CorpusSnapshotV2, Role16 } from '../corpus-v2'
import type { VocabCell } from '../design-vocab'
import type { CopySectionsPayload, PdpQualityReport, SectionPlan } from '../pdp-state'
import { ROLE_TO_SECTIONS, ROLE_TO_SECTIONS_ENRICHED, type RoleSectionMapping } from './role-section-map'

export interface TrustStack {
  required: Role16[]
  recommended: Role16[]
}

/** v2와 같은 임계 — required ≥ 0.50, recommended 0.35 이상 0.50 미만(WORK_SPEC B-3). */
const TRUST_REQUIRED_MIN = 0.5
const TRUST_RECOMMENDED_MIN = 0.35

export interface TrustGateResult {
  pass: boolean
  missingRequired: Role16[]
  missingRecommended: Role16[]
  userActionHints: string[]
}

/** 플랫폼 영역 역할 — 상세페이지 생성 대상이 아니라 쿠팡 설정 소관. 누락 보고는 하되 힌트로 구분한다. */
const PLATFORM_ROLES: readonly Role16[] = ['shipping_cs', 'legal_notice']

/** 역할별 사용자 행동 힌트 — 입력을 보강하면 다음 생성에서 섹션이 살아난다는 안내(결정 T-6). */
const USER_ACTION_HINTS: Partial<Record<Role16, string>> = {
  size_spec: '치수표(사이즈 정보)를 입력하면 실측 스펙 섹션이 생성됩니다.',
  certification_evidence: '시험성적서·인증 정보를 입력하면 인증 섹션이 생성됩니다.',
  promotion_offer: '이벤트·프로모션 정보를 입력하면 이벤트 배너 섹션이 생성됩니다.',
  option_catalog: '옵션을 4개 이상 등록하면 옵션 카탈로그 섹션이 생성됩니다.',
  social_proof: '리뷰 데이터를 입력하면 리뷰·평점 섹션이 생성됩니다.',
  authenticity: '정품·인증 근거(certificationInfo)를 입력하면 정품 보장 블록이 생성됩니다.',
  shipping_cs: '배송·교환/반품 안내는 플랫폼 영역입니다 — 쿠팡 상품 설정에서 관리하세요.',
  legal_notice: '법정 표시 정보는 플랫폼 영역입니다 — 쿠팡 상품고시 정보에서 관리하세요.',
}

/** 역할 충족 판정 — 매핑된 섹션 중 하나라도 활성화돼 있으면 충족(certification 변형 dedupe 호환). */
function roleSatisfied(role: Role16, activatedSet: Set<string>, mapping: Record<Role16, RoleSectionMapping>): boolean {
  const sections = mapping[role]?.sections ?? []
  return sections.some((s) => activatedSet.has(String(s)))
}

export function runTrustGate(activatedSections: string[], snapshot: CorpusSnapshotV2): TrustGateResult {
  return evaluateTrustStack(activatedSections, snapshot.profile.trustStack, ROLE_TO_SECTIONS)
}

/** trustStack 대조 — 매핑을 받아 구 잡(기존 매핑)과 ENRICHMENT 잡(정정 매핑)이 같은 판정 로직을 쓴다. */
export function evaluateTrustStack(
  activatedSections: string[],
  trustStack: TrustStack,
  mapping: Record<Role16, RoleSectionMapping>
): TrustGateResult {
  const activatedSet = new Set(activatedSections)
  const missingRequired: Role16[] = []
  const missingRecommended: Role16[] = []

  for (const role of trustStack.required) {
    if (!roleSatisfied(role, activatedSet, mapping)) missingRequired.push(role)
  }
  for (const role of trustStack.recommended) {
    if (!roleSatisfied(role, activatedSet, mapping)) missingRecommended.push(role)
  }

  // 플랫폼 영역 역할과 매핑 섹션이 없는 역할(정정 매핑의 faq — 렌더러 부재)은 생성으로 채울 수 없다 —
  // pass 판정에서는 제외하되 힌트로는 안내한다. 기존 매핑은 플랫폼 역할 외 모든 역할에 섹션이 있어 판정이 그대로다.
  const generatableMissing = missingRequired.filter(
    (r) => !PLATFORM_ROLES.includes(r) && (mapping[r]?.sections.length ?? 0) > 0
  )
  const hints = [...missingRequired, ...missingRecommended]
    .map((role) => USER_ACTION_HINTS[role])
    .filter((h): h is string => Boolean(h))

  return {
    pass: generatableMissing.length === 0,
    missingRequired,
    missingRecommended,
    userActionHints: [...new Set(hints)],
  }
}

/** quality_report 조립(부록 F-2) — trust gate 결과 + 골격 제외 근거. 순수 함수(compose 후처리가 호출). */
export function buildQualityReport(sectionPlan: SectionPlan, snapshot: CorpusSnapshotV2): PdpQualityReport {
  const gate = runTrustGate(sectionPlan.activated_sections ?? [], snapshot)
  return {
    trust_gate: {
      pass: gate.pass,
      missing_required: gate.missingRequired,
      missing_recommended: gate.missingRecommended,
      user_action_hints: gate.userActionHints,
    },
    skeleton_excluded: sectionPlan.internalized_skeleton?.excluded ?? [],
  }
}

/** ENRICHMENT 잡 전용 힌트 — 정정 매핑에서 섹션이 없는 역할(기존 잡 보고서에는 붙이지 않는다). */
const ENRICHED_HINTS: Partial<Record<Role16, string>> = {
  faq: 'FAQ 렌더러가 아직 없어 자주 묻는 질문은 고민 미응답 기록으로만 남깁니다(생성 대상 아님).',
}

/** v2가 없는 카테고리(stationery·packaging·pet 등) — vocab 셀 출현율로 같은 임계의 trustStack을 만든다. */
export function buildVocabTrustStack(cell: VocabCell): TrustStack {
  const required: Role16[] = []
  const recommended: Role16[] = []
  for (const [role, stat] of Object.entries(cell.roles) as Array<[Role16, { prevalence: number }]>) {
    if (stat.prevalence >= TRUST_REQUIRED_MIN) required.push(role)
    else if (stat.prevalence >= TRUST_RECOMMENDED_MIN) recommended.push(role)
  }
  return { required: required.sort(), recommended: recommended.sort() }
}

/**
 * ENRICHMENT 잡의 quality_report(설계 §4.6) — 정정 매핑으로 trust gate를 판정하고, 설득 플래너 근거(문법·R1~R8·미응답 고민)와
 * 근거 수준을 덧붙인다. 차단하지 않는다. 기존 trust_gate·skeleton_excluded 형태는 그대로 둔다(화면 호환).
 */
export function buildEnrichedQualityReport(input: {
  sectionPlan: SectionPlan
  trustStack: TrustStack
  evidenceLevel: NonNullable<PdpQualityReport['evidenceLevel']>
  annotations?: PdpQualityReport['annotations'] | null
  layouts?: PdpQualityReport['layouts'] | null
}): PdpQualityReport {
  const gate = evaluateTrustStack(input.sectionPlan.activated_sections ?? [], input.trustStack, ROLE_TO_SECTIONS_ENRICHED)
  const missing = [...gate.missingRequired, ...gate.missingRecommended]
  const enrichedHints = missing.filter((r) => ENRICHED_HINTS[r]).map((r) => ENRICHED_HINTS[r]!)
  const persuasion = input.sectionPlan.internalized_skeleton?.persuasion
  return {
    trust_gate: {
      pass: gate.pass,
      missing_required: gate.missingRequired,
      missing_recommended: gate.missingRecommended,
      user_action_hints: [...new Set([...gate.userActionHints, ...enrichedHints])],
    },
    skeleton_excluded: input.sectionPlan.internalized_skeleton?.excluded ?? [],
    ...(persuasion
      ? {
          persuasion: {
            grammar: persuasion.grammar,
            rules: persuasion.rules,
            unanswered: persuasion.objectionCoverage
              .filter((o) => !o.answeredBy)
              .map((o) => ({ objection: o.objection, type: o.type, ...(o.note ? { note: o.note } : {}) })),
          },
        }
      : {}),
    evidenceLevel: input.evidenceLevel,
    ...(input.annotations ? { annotations: input.annotations } : {}),
    ...(input.layouts ? { layouts: input.layouts } : {}),
  }
}

/** copy_sections에 quality_report를 부착 — 기존 필드(final·stage1·stage2·similarity_warnings) 보존 계약. */
export function attachQualityReport(
  copySections: Partial<CopySectionsPayload>,
  report: PdpQualityReport
): Partial<CopySectionsPayload> {
  return { ...copySections, quality_report: report }
}
