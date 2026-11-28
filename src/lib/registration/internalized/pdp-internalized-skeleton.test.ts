/**
 * 골격 결정론(buildSkeleton) 스냅샷 테스트 — I-2 게이트: 카테고리 3종 × 치수 유/무 × hook 유/무
 * 12케이스(부록 G). 순수 함수이므로 입력 동일 → 출력 동일이 계약이다 — 스냅샷이 골격 변화를 가시화한다.
 */

import { describe, it, expect } from 'vitest'
import { getCorpusSnapshotV2, type CorpusSnapshotV2 } from '../corpus-v2'
import { buildSkeleton, enforceSkeleton, SKELETON_PREVALENCE_THRESHOLD } from './pdp-internalized-skeleton'
import { ProSectionType } from '@/lib/registration/editor/types/section'
import type { PdpSpecSheet, StrategyContract } from '../pdp-state'

const CATEGORIES = ['fashion', 'digital', 'household'] as const

function fullSpec(overrides: Partial<PdpSpecSheet> = {}): PdpSpecSheet {
  return {
    productName: '테스트 상품',
    size: '가로 30cm x 세로 20cm',
    certificationInfo: 'KC 인증 취득',
    eventBannerInfo: '런칭 기념 10% 할인',
    colorOptions: ['블랙', '화이트', '네이비', '베이지'],
    ...overrides,
  }
}

function snapshotOf(category: string): CorpusSnapshotV2 {
  const s = getCorpusSnapshotV2(category)
  if (!s) throw new Error(`v2 스냅샷 없음: ${category}`)
  return s
}

/** hookDefault 축 조작 — 파생 필드만 바꾼 사본(실측 시퀀스는 그대로) */
function withHookDefault(snapshot: CorpusSnapshotV2, hookDefault: boolean): CorpusSnapshotV2 {
  return { ...snapshot, profile: { ...snapshot.profile, hookDefault } }
}

const NO_CONTRACT: StrategyContract = {}

describe('buildSkeleton — 12케이스 골격 스냅샷 (카테고리 3종 × 치수 유/무 × hook 유/무)', () => {
  for (const category of CATEGORIES) {
    for (const hasDims of [true, false]) {
      for (const hookDefault of [true, false]) {
        it(`${category} · 치수 ${hasDims ? '유' : '무'} · hookDefault ${hookDefault}`, () => {
          const result = buildSkeleton({
            snapshot: withHookDefault(snapshotOf(category), hookDefault),
            specSheet: fullSpec(hasDims ? {} : { size: undefined }),
            strategyContract: NO_CONTRACT,
          })
          expect({
            roles: result.roles.map((r) => r.role),
            order: result.sectionOrder,
            excluded: result.excluded.map((e) => e.role),
          }).toMatchSnapshot()
        })
      }
    }
  }
})

describe('buildSkeleton — 불변식', () => {
  it('main_cut·cta는 항상 포함되고 cta는 마지막이다(페이지 성립 최소 골격)', () => {
    for (const category of CATEGORIES) {
      const { sectionOrder } = buildSkeleton({
        snapshot: snapshotOf(category),
        specSheet: fullSpec(),
        strategyContract: NO_CONTRACT,
      })
      expect(sectionOrder).toContain(ProSectionType.MAIN_CUT)
      expect(sectionOrder[sectionOrder.length - 1]).toBe(ProSectionType.CTA)
    }
  })

  it('hook_3step이 있으면 main_cut보다 앞이다 — 단 실측 위치를 존중해 인접 강제는 하지 않는다(Track S enforceFixedOrder 동일 의미론)', () => {
    for (const category of CATEGORIES) {
      const { sectionOrder } = buildSkeleton({
        snapshot: snapshotOf(category),
        specSheet: fullSpec(),
        strategyContract: NO_CONTRACT,
      })
      const hookIdx = sectionOrder.indexOf(ProSectionType.HOOK_3STEP)
      const mainIdx = sectionOrder.indexOf(ProSectionType.MAIN_CUT)
      if (hookIdx !== -1) {
        expect(hookIdx).toBeLessThan(mainIdx)
      }
    }
  })

  it('shipping_cs·legal_notice는 출현율과 무관하게 생성 제외되고 근거가 기록된다(플랫폼 영역)', () => {
    // fashion naver 실측: shipping_cs 0.78·legal_notice 0.43 — 둘 다 임계 이상이지만 제외돼야 한다
    const result = buildSkeleton({ snapshot: snapshotOf('fashion'), specSheet: fullSpec(), strategyContract: NO_CONTRACT })
    const excludedRoles = result.excluded.map((e) => e.role)
    expect(excludedRoles).toContain('shipping_cs')
    expect(excludedRoles).toContain('legal_notice')
    expect(result.roles.map((r) => r.role)).not.toContain('shipping_cs')
  })

  it('치수 없는 잡은 spec_table이 빠지고 "환각 치수 금지" 근거가 남는다(WORK_SPEC B-1)', () => {
    const result = buildSkeleton({
      snapshot: snapshotOf('fashion'),
      specSheet: fullSpec({ size: undefined }),
      strategyContract: NO_CONTRACT,
    })
    expect(result.sectionOrder).not.toContain(ProSectionType.SPEC_TABLE)
    const sizeExcluded = result.excluded.find((e) => e.role === 'size_spec')
    expect(sizeExcluded?.reason).toContain('환각 치수 금지')
  })

  it('인증·이벤트 근거가 없으면 certification·event_banner가 빠진다', () => {
    const result = buildSkeleton({
      snapshot: snapshotOf('digital'),
      specSheet: fullSpec({ certificationInfo: undefined, eventBannerInfo: undefined }),
      strategyContract: NO_CONTRACT,
    })
    expect(result.sectionOrder).not.toContain(ProSectionType.EVENT_BANNER)
    expect(result.sectionOrder).not.toContain(ProSectionType.CERTIFICATION)
    expect(result.excluded.find((e) => e.role === 'certification_evidence')?.reason).toContain('certificationInfo 없음')
    expect(result.excluded.find((e) => e.role === 'promotion_offer')?.reason).toContain('eventBannerInfo 없음')
  })

  it('옵션 4개 미만이면 option_catalog(point_list_div)가 빠진다', () => {
    const result = buildSkeleton({
      snapshot: snapshotOf('fashion'),
      specSheet: fullSpec({ colorOptions: ['블랙', '화이트'] }),
      strategyContract: NO_CONTRACT,
    })
    expect(result.excluded.find((e) => e.role === 'option_catalog')?.reason).toContain('옵션 수 < 4')
  })

  it('hookDefault=false면 problem 계열이 빠지고, 사용자 명시(extra.hookMode)가 있을 때만 포함된다(명시 > prior)', () => {
    const doctored = withHookDefault(snapshotOf('household'), false)
    const withoutExplicit = buildSkeleton({ snapshot: doctored, specSheet: fullSpec(), strategyContract: NO_CONTRACT })
    expect(withoutExplicit.sectionOrder).not.toContain(ProSectionType.PROBLEM_RAISE)
    expect(withoutExplicit.excluded.some((e) => e.role === 'problem' && e.reason.includes('hookDefault=false'))).toBe(true)

    const withExplicit = buildSkeleton({
      snapshot: doctored,
      specSheet: fullSpec({ extra: { hookMode: 'empathy' } }),
      strategyContract: NO_CONTRACT,
    })
    // household naver 실측 problem 출현율 0.64 ≥ 0.35 — 명시가 있으면 prior대로 포함된다
    expect(withExplicit.sectionOrder).toContain(ProSectionType.PROBLEM_RAISE)
  })

  it('strategyContract.hook_mode는 명시 신호가 아니다 — 분석이 항상 자동 채움하므로 게이트를 뚫지 못한다(verifier 회귀)', () => {
    // 실 파이프라인의 resolveStrategyContract는 hook_mode를 모든 경로에서 대입한다(deriveStrategyContract).
    // 그 값이 게이트를 통과시키면 hookDefault=false가 사문화된다 — 자동 채움 계약으로는 제외가 유지돼야 한다.
    const doctored = withHookDefault(snapshotOf('household'), false)
    const result = buildSkeleton({
      snapshot: doctored,
      specSheet: fullSpec(),
      strategyContract: { hook_mode: 'empathy' },
    })
    expect(result.sectionOrder).not.toContain(ProSectionType.PROBLEM_RAISE)
    expect(result.sectionOrder).not.toContain(ProSectionType.HOOK_3STEP)
  })

  it('인증 근거가 없으면 authenticity도 빠진다 — 컴포저가 렌더하지 못하는 유령 섹션 금지(verifier 회귀)', () => {
    // digital은 authenticity 0.929로 후보에 들지만, certification 섹션은 certificationInfo 있을 때만
    // 렌더되므로(pdp-composer-sections) 근거 없이 계획에 남으면 trust gate가 거짓 pass를 낸다.
    const result = buildSkeleton({
      snapshot: snapshotOf('digital'),
      specSheet: fullSpec({ certificationInfo: undefined }),
      strategyContract: NO_CONTRACT,
    })
    expect(result.sectionOrder).not.toContain(ProSectionType.CERTIFICATION)
    expect(result.excluded.some((e) => e.role === 'authenticity')).toBe(true)
  })

  it('길이 가드 — 섹션 수가 중앙값×1.5를 넘으면 저출현 역할부터 잘리고 근거가 남는다', () => {
    const snapshot = snapshotOf('digital')
    const shortened: CorpusSnapshotV2 = {
      ...snapshot,
      profile: { ...snapshot.profile, sectionCountMedian: 4 }, // cap = 6으로 강제
    }
    const result = buildSkeleton({ snapshot: shortened, specSheet: fullSpec(), strategyContract: NO_CONTRACT })
    expect(result.sectionOrder.length).toBeLessThanOrEqual(6)
    expect(result.sectionOrder).toContain(ProSectionType.MAIN_CUT) // 최소 골격은 가드에서 보호
    expect(result.sectionOrder).toContain(ProSectionType.CTA)
    expect(result.excluded.some((e) => e.reason.includes('길이 가드'))).toBe(true)
  })

  it('채택 역할 전부가 실측 임계 이상 또는 갭룰 근거를 갖는다(감사 추적)', () => {
    const result = buildSkeleton({ snapshot: snapshotOf('fashion'), specSheet: fullSpec(), strategyContract: NO_CONTRACT })
    for (const { reason } of result.roles) {
      expect(reason).toMatch(new RegExp(`실측 출현율|갭룰`))
    }
    const prevalenceByRole = new Map(snapshotOf('fashion').sequenceFull.map((s) => [s.role, s.prevalence]))
    for (const { role, reason } of result.roles) {
      if (reason.startsWith('실측 출현율')) {
        expect(prevalenceByRole.get(role) ?? 0).toBeGreaterThanOrEqual(SKELETON_PREVALENCE_THRESHOLD)
      }
    }
  })

  it('결정론 — 같은 입력이면 같은 출력이다', () => {
    const input = { snapshot: snapshotOf('fashion'), specSheet: fullSpec(), strategyContract: NO_CONTRACT }
    expect(buildSkeleton(input)).toEqual(buildSkeleton(input))
  })
})

describe('enforceSkeleton — 골격 이탈 복원(결정 T-3 이중 방어)', () => {
  it('LLM이 골격을 바꿔도 activated_sections·section_order는 골격으로 복원되고 세부 산출은 보존된다', () => {
    const skeleton = buildSkeleton({ snapshot: snapshotOf('fashion'), specSheet: fullSpec(), strategyContract: NO_CONTRACT })
    const deviated = {
      activated_sections: ['hook_3step', 'main_cut'], // LLM이 임의 축소
      section_order: ['main_cut', 'hook_3step'], // 순서까지 어김
      section_specs: { main_cut: { purpose: '히어로' } },
      font_scheme: { heading: { family: 'GmarketSansBold' } },
    }
    const restored = enforceSkeleton(deviated, skeleton)
    expect(restored.activated_sections).toEqual(skeleton.activatedSections.map(String))
    expect(restored.section_order).toEqual(skeleton.sectionOrder.map(String))
    expect(restored.section_specs).toEqual(deviated.section_specs)
    expect(restored.font_scheme).toEqual(deviated.font_scheme)
  })
})

describe('buildSkeleton — ENRICHMENT 폴백(enriched: 정정 매핑·has_reviews·실평점)', () => {
  it('기록 잡 폴백은 리뷰 근거가 없으면 social_proof를 만들지 않는다(기존 동작은 그대로 포함)', () => {
    const snapshot = snapshotOf('household') // social_proof 실측 출현율 0.57 — 골격 후보
    const spec = fullSpec()
    const legacy = buildSkeleton({ snapshot, specSheet: spec, strategyContract: NO_CONTRACT })
    const enriched = buildSkeleton({ snapshot, specSheet: spec, strategyContract: NO_CONTRACT, enriched: true })
    expect(enriched.activatedSections).not.toContain(ProSectionType.PERFORMANCE_REVIEWS)
    expect(enriched.excluded.find((e) => e.role === 'social_proof')?.reason).toContain('리뷰')
    expect(legacy.activatedSections).toContain(ProSectionType.PERFORMANCE_REVIEWS) // 기존 동작(유령 섹션 위험)은 그대로
  })

  it('리뷰는 있고 실평점이 없으면 perf_reviews만, 정정 매핑으로 전개한다', () => {
    const snapshot = snapshotOf('household')
    const plan = buildSkeleton({ snapshot, specSheet: fullSpec({ reviewsText: '좋아요' }), strategyContract: NO_CONTRACT, enriched: true })
    expect(plan.roles.some((r) => r.role === 'social_proof')).toBe(true)
    expect(plan.activatedSections).toContain(ProSectionType.PERFORMANCE_REVIEWS)
    expect(plan.activatedSections).not.toContain(ProSectionType.PERFORMANCE_RATING)
    const withRating = buildSkeleton({ snapshot, specSheet: fullSpec({ reviewsText: '좋아요', rating: 4.8 }), strategyContract: NO_CONTRACT, enriched: true })
    expect(withRating.activatedSections).toContain(ProSectionType.PERFORMANCE_RATING)
    // 정정 매핑: option_catalog → petit_div, how_to_guide → hidden_page(기존 매핑의 point_list_div·solution_guide 아님)
    if (plan.roles.some((r) => r.role === 'option_catalog')) expect(plan.activatedSections).toContain(ProSectionType.PETIT_DIV)
    if (plan.roles.some((r) => r.role === 'how_to_guide')) expect(plan.activatedSections).toContain(ProSectionType.HIDDEN_PAGE)
  })
})
