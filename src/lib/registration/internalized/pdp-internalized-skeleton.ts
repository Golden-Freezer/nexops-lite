/**
 * Track I 골격 결정론 — DESIGN-INTERNALIZED-TRACK-20260811 결정 T-3·부록 D의 순수 함수 구현(LLM 0).
 * v2 스냅샷의 실측 시퀀스가 섹션 골격(activated_sections·section_order)을 코드로 확정하고,
 * LLM 설계 콜은 골격을 고정 입력으로 받아 섹션별 세부(section_specs 등)만 채운다.
 * 산출의 excluded(제외 근거)까지 잡 JSONB에 남겨 감사 추적을 보장한다.
 */

import type { CorpusSnapshotV2, Role16, SequenceRoleStatV2 } from '../corpus-v2'
import type { PdpSpecSheet, SectionPlan, StrategyContract } from '../pdp-state'
import { ProSectionType } from '@/lib/registration/editor/types/section'
import {
  ROLE_TO_SECTIONS,
  USP_SECONDARY_PREVALENCE_THRESHOLD,
  type SkeletonCondition,
} from './role-section-map'

/** 부록 D 1단계 — 골격 후보 채택 임계(prevalence). WORK_SPEC recommended 하한과 동일한 0.35 고정. */
export const SKELETON_PREVALENCE_THRESHOLD = 0.35

/** 부록 D 6단계 — 길이 가드 배수(sectionCountMedian × 1.5 초과 시 저출현 역할부터 잘라냄). */
export const SKELETON_LENGTH_GUARD_FACTOR = 1.5

export interface SkeletonInput {
  snapshot: CorpusSnapshotV2
  specSheet: PdpSpecSheet
  strategyContract: StrategyContract
}

export interface SkeletonResult {
  /** 채택 역할 + 근거(프리밸런스/갭룰/전략계약) — positionMode 정렬 순 */
  roles: Array<{ role: Role16; reason: string }>
  /** 매핑 후 24타입 — 기존 파이프라인 계약(section_plan) 그대로 */
  activatedSections: ProSectionType[]
  sectionOrder: ProSectionType[]
  /** 제외 근거(조건 미충족·hookDefault·길이 가드) — 잡 JSONB에 기록 */
  excluded: Array<{ role: Role16; reason: string }>
}

const POSITION_RANK: Record<string, number> = { opening: 0, early: 1, middle: 2, late: 3, closing: 4 }

/** 동률 정렬용 — position_dist 기대값(구간 가중 평균, 오름차순 = 페이지 상단 성향 먼저). */
function expectedPosition(stat: SequenceRoleStatV2 | undefined): number {
  if (!stat) return POSITION_RANK.middle
  let sum = 0
  for (const [zone, share] of Object.entries(stat.positionDist)) {
    sum += (POSITION_RANK[zone] ?? 2) * share
  }
  return sum
}

/** 부록 D 3단계 조건 판정 — spec_sheet 근거 유무. 환각 치수/인증/이벤트 금지(WORK_SPEC B-1). */
function conditionSatisfied(
  condition: SkeletonCondition | undefined,
  specSheet: PdpSpecSheet,
  snapshot: CorpusSnapshotV2
): { ok: boolean; reason?: string } {
  switch (condition) {
    case undefined:
      return { ok: true }
    case 'never':
      return { ok: false, reason: '플랫폼 영역 — 생성 제외, trust gate 진단에서만 체크' }
    case 'has_dimensions':
      return specSheet.size?.trim()
        ? { ok: true }
        : { ok: false, reason: 'spec_sheet에 치수 데이터 없음 — 환각 치수 금지(WORK_SPEC B-1)' }
    case 'has_certification':
      return specSheet.certificationInfo?.trim()
        ? { ok: true }
        : { ok: false, reason: 'certificationInfo 없음 — 근거 없는 인증 섹션 금지' }
    case 'has_event':
      return specSheet.eventBannerInfo?.trim()
        ? { ok: true }
        : { ok: false, reason: 'eventBannerInfo 없음 — 근거 없는 이벤트 섹션 금지' }
    case 'has_options':
      return (specSheet.colorOptions?.length ?? 0) >= 4
        ? { ok: true }
        : { ok: false, reason: '옵션 수 < 4 — 옵션 카탈로그 성립 불가' }
    case 'hook_gate': {
      if (snapshot.profile.hookDefault) return { ok: true }
      // hookDefault=false 카테고리는 기본 제외, 사용자 명시 요구 시만 포함(우선순위: 명시 > prior, WORK_SPEC B-2).
      // 명시 신호는 spec_sheet.extra.hookMode다 — strategyContract.hook_mode는 분석 단계
      // deriveStrategyContract가 모든 경로에서 자동 대입하므로(항상 truthy) 명시 신호가 될 수 없다
      // (2026-08-11 verifier 적발 — 그 값을 쓰면 이 게이트가 사문화된다).
      const extraHookMode = specSheet.extra?.hookMode
      const explicitHook = typeof extraHookMode === 'string' && extraHookMode.trim() !== ''
      return explicitHook
        ? { ok: true }
        : { ok: false, reason: 'hookDefault=false(카테고리 실측) — 사용자 명시(extra.hookMode) 없음, problem 계열 기본 제외' }
    }
  }
}

/**
 * 부록 D 골격 결정 알고리즘 — 순수 함수. 입력 동일 → 출력 동일(결정론).
 * 후보 채택(≥0.35 + 갭룰) → 조건 필터 → positionMode 정렬 → 24타입 전개(dedupe) →
 * main_cut·cta 최소 골격 보장 → 길이 가드.
 */
export function buildSkeleton(input: SkeletonInput): SkeletonResult {
  // strategyContract는 입력 계약(부록 C)으로 받아두되 현재 조건 판정에는 쓰지 않는다 — hook 명시 신호는
  // spec_sheet.extra.hookMode(위 hook_gate 주석 참조), 그 외 조건은 전부 spec_sheet 근거 유무다.
  const { snapshot, specSheet } = input
  const statByRole = new Map<Role16, SequenceRoleStatV2>(snapshot.sequenceFull.map((s) => [s.role, s]))
  const excluded: SkeletonResult['excluded'] = []

  // 1. prevalence ≥ 임계 후보 + 2. 갭룰 activateDefault 추가(중복 무시)
  const candidateReasons = new Map<Role16, string>()
  for (const stat of snapshot.sequenceFull) {
    if (stat.prevalence >= SKELETON_PREVALENCE_THRESHOLD) {
      candidateReasons.set(stat.role, `실측 출현율 ${(stat.prevalence * 100).toFixed(0)}% ≥ ${SKELETON_PREVALENCE_THRESHOLD * 100}%`)
    }
  }
  for (const rule of snapshot.gapRules) {
    if (rule.activateDefault && !candidateReasons.has(rule.section)) {
      candidateReasons.set(rule.section, `갭룰 기본 활성(${rule.label} ${rule.evidencePct}%)`)
    }
  }

  // 3. 조건 필터
  const adopted: Array<{ role: Role16; reason: string }> = []
  for (const [role, reason] of candidateReasons) {
    const mapping = ROLE_TO_SECTIONS[role]
    if (!mapping) {
      excluded.push({ role, reason: '매핑표에 없는 역할 — 억지 매핑 금지' })
      continue
    }
    const verdict = conditionSatisfied(mapping.condition, specSheet, snapshot)
    if (!verdict.ok) {
      excluded.push({ role, reason: verdict.reason ?? '조건 미충족' })
      continue
    }
    adopted.push({ role, reason })
  }

  // 4. 정렬: positionMode 순 → 동률이면 position_dist 기대값 오름차순
  adopted.sort((a, b) => {
    const sa = statByRole.get(a.role)
    const sb = statByRole.get(b.role)
    const ra = POSITION_RANK[sa?.positionMode ?? 'middle']
    const rb = POSITION_RANK[sb?.positionMode ?? 'middle']
    if (ra !== rb) return ra - rb
    return expectedPosition(sa) - expectedPosition(sb)
  })

  // 5. 24타입 전개(dedupe — authenticity/certification_evidence 동시 활성 시 첫 항목만) + 최소 골격
  const order: ProSectionType[] = []
  const seen = new Set<ProSectionType>()
  const sectionsOfRole = new Map<Role16, ProSectionType[]>()
  for (const { role } of adopted) {
    let sections = ROLE_TO_SECTIONS[role].sections
    if (role === 'usp_feature' && (statByRole.get(role)?.prevalence ?? 0) < USP_SECONDARY_PREVALENCE_THRESHOLD) {
      sections = sections.slice(0, 1) // 출현율 미달이면 point_div 1개만(결정 T-4 비고)
    }
    const added: ProSectionType[] = []
    for (const section of sections) {
      if (seen.has(section)) continue
      seen.add(section)
      order.push(section)
      added.push(section)
    }
    sectionsOfRole.set(role, added)
  }

  // main_cut·cta는 매핑과 무관하게 항상 포함(페이지 성립 최소 골격 — 부록 D 5단계)
  if (!seen.has(ProSectionType.MAIN_CUT)) {
    const hookIdx = order.indexOf(ProSectionType.HOOK_3STEP)
    order.splice(hookIdx === -1 ? 0 : hookIdx + 1, 0, ProSectionType.MAIN_CUT)
    seen.add(ProSectionType.MAIN_CUT)
  }
  if (!seen.has(ProSectionType.CTA)) {
    order.push(ProSectionType.CTA)
    seen.add(ProSectionType.CTA)
  }

  // 원본 파이프라인 하드 가드(pdp-design-agent enforceFixedOrder)와 동일 의미론: hook이 main_cut
  // "뒤"에 놓였을 때만 앞으로 끌어온다 — hook이 이미 앞이면 실측 위치를 존중하고 건드리지 않는다
  // (강한 인접 강제는 후킹을 페이지 중간으로 끌어내리는 역효과 — 2026-08-11 verifier 적발).
  const hookIdx = order.indexOf(ProSectionType.HOOK_3STEP)
  const mainIdx = order.indexOf(ProSectionType.MAIN_CUT)
  if (hookIdx !== -1 && mainIdx !== -1 && hookIdx > mainIdx) {
    order.splice(hookIdx, 1)
    order.splice(order.indexOf(ProSectionType.MAIN_CUT), 0, ProSectionType.HOOK_3STEP)
  }

  // 6. 길이 가드 — 전개 후 섹션 수가 중앙값 × 1.5 초과 시 prevalence 낮은 역할부터 제거
  const cap = Math.floor(snapshot.profile.sectionCountMedian * SKELETON_LENGTH_GUARD_FACTOR)
  if (order.length > cap) {
    const droppable = [...adopted].sort(
      (a, b) => (statByRole.get(a.role)?.prevalence ?? 0) - (statByRole.get(b.role)?.prevalence ?? 0)
    )
    for (const { role } of droppable) {
      if (order.length <= cap) break
      const sections = (sectionsOfRole.get(role) ?? []).filter(
        (s) => s !== ProSectionType.MAIN_CUT && s !== ProSectionType.CTA
      )
      if (sections.length === 0) continue
      for (const s of sections) {
        const idx = order.indexOf(s)
        if (idx !== -1) order.splice(idx, 1)
      }
      const adoptedIdx = adopted.findIndex((a) => a.role === role)
      if (adoptedIdx !== -1) adopted.splice(adoptedIdx, 1)
      excluded.push({ role, reason: `길이 가드 — 섹션 수 상한(중앙값 ${snapshot.profile.sectionCountMedian} × ${SKELETON_LENGTH_GUARD_FACTOR}) 초과로 저출현 역할부터 제외` })
    }
  }

  return { roles: adopted, activatedSections: [...order], sectionOrder: [...order], excluded }
}

/**
 * LLM 세부 설계 응답에 골격을 강제 복원 — 응답이 activated_sections/section_order를 바꿨어도
 * 골격이 이긴다(결정 T-3 "골격 변경 금지" 계약, Pro Stage3 enforceStage3FieldIntegrity 패턴).
 * 섹션별 세부(section_specs·layout_selections·font_scheme 등)는 LLM 산출을 그대로 보존한다.
 */
export function enforceSkeleton(plan: SectionPlan, skeleton: SkeletonResult): SectionPlan {
  return {
    ...plan,
    activated_sections: skeleton.activatedSections.map(String),
    section_order: skeleton.sectionOrder.map(String),
  }
}
