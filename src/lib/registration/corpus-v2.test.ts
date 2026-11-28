import { describe, it, expect } from 'vitest'
import { getCorpusSnapshotV2, getCorpusVersion, ROLE16 } from './corpus-v2'
import { formatCorpusVersion, getCorpusSnapshot } from './corpus'

const V2_CATEGORIES = ['fashion', 'beauty', 'food', 'digital', 'household'] as const

// §E-2 하한 클램프 — designTokens.MOBILE_SCALE_FACTOR(0.436) 기준. 본문은 편안 기준 16px(오너
// 피드백 2026-08-12) → ceil(16/0.436)=37, 헤드라인 20px → ceil(20/0.436)=46. 이 미만이 수록되면
// 모바일 가독 미달(H-2 위반)이므로 테스트로 고정한다.
const MIN_BODY_PX = 37
const MIN_HEADLINE_PX = 46

describe('getCorpusSnapshotV2 — 조회 계약(v1과 동일 어휘)', () => {
  it('v2 스냅샷이 있는 5카테고리는 데이터를 반환한다', () => {
    for (const key of V2_CATEGORIES) {
      const snapshot = getCorpusSnapshotV2(key)
      expect(snapshot).not.toBeNull()
      expect(snapshot?.category).toBe(key)
      expect(snapshot?.schemaVersion).toBe(2)
    }
  })

  it('미보유 카테고리(packaging·stationery·pet)·미상 키·빈 값은 예외 없이 null', () => {
    expect(getCorpusSnapshotV2('packaging')).toBeNull()
    expect(getCorpusSnapshotV2('stationery')).toBeNull()
    expect(getCorpusSnapshotV2('pet')).toBeNull()
    expect(getCorpusSnapshotV2('존재하지않는카테고리')).toBeNull()
    expect(getCorpusSnapshotV2(undefined)).toBeNull()
    expect(getCorpusSnapshotV2(null)).toBeNull()
  })

  it('대소문자·공백에 관대하다', () => {
    expect(getCorpusSnapshotV2(' Fashion ')).not.toBeNull()
  })

  it('실 스냅샷 버전은 generatedAt과 12자리 지문 또는 legacy 형식이다', () => {
    const snapshot = getCorpusSnapshotV2('fashion')!
    const escapedGeneratedAt = snapshot.generatedAt.replaceAll('.', '\.')
    expect(getCorpusVersion('fashion')).toMatch(
      new RegExp('^2:' + escapedGeneratedAt + ':(?:[0-9a-f]{12}|legacy)$')
    )
    expect(getCorpusVersion('packaging')).toBeNull()
  })

  it('contentHash 없는 픽스처는 2:generatedAt:legacy로 조립한다', () => {
    expect(formatCorpusVersion({ generatedAt: '2026-08-20T00:00:00.000Z', schemaVersion: 2 })).toBe(
      '2:2026-08-20T00:00:00.000Z:legacy'
    )
  })
})

describe('v2 스냅샷 스키마 불변식 — 부록 B', () => {
  it('designRecipes는 16역할 전부를 수록하고 §E-2 하한 클램프를 지킨다', () => {
    for (const key of V2_CATEGORIES) {
      const snapshot = getCorpusSnapshotV2(key)!
      for (const role of ROLE16) {
        const recipe = snapshot.designRecipes[role]
        expect(recipe, `${key}.designRecipes.${role}`).toBeDefined()
        expect(recipe.headlinePx).toBeGreaterThanOrEqual(MIN_HEADLINE_PX)
        expect(recipe.bodyPx).toBeGreaterThanOrEqual(MIN_BODY_PX)
        expect(recipe.paddingPx).toBeGreaterThan(0)
        expect(recipe.sourcePlatform).toBe('naver')
        for (const hex of recipe.topHexes) {
          expect(hex).toMatch(/^#[0-9A-F]{6}$/)
        }
      }
    }
  })

  it('sequenceFull은 전 역할 수록(top10 절단 폐지)이고 prevalence·positionDist가 유효하다', () => {
    for (const key of V2_CATEGORIES) {
      const snapshot = getCorpusSnapshotV2(key)!
      expect(snapshot.sequenceFull.length).toBeGreaterThan(10)
      for (const entry of snapshot.sequenceFull) {
        expect(ROLE16).toContain(entry.role)
        expect(entry.prevalence).toBeGreaterThan(0)
        expect(entry.prevalence).toBeLessThanOrEqual(1)
        const distSum = Object.values(entry.positionDist).reduce((a, b) => a + b, 0)
        expect(distSum).toBeGreaterThan(0.95)
        expect(distSum).toBeLessThan(1.05)
      }
    }
  })

  it('profile은 trustStack·copyTone·hookDefault·전 역할 patternPrevalence를 갖는다', () => {
    for (const key of V2_CATEGORIES) {
      const { profile } = getCorpusSnapshotV2(key)!
      expect(profile.sectionCountMedian).toBeGreaterThan(0)
      expect(profile.trustStack.required.length).toBeGreaterThan(0)
      expect(['factual_catalog', 'spec_proof', 'evidence_certification', 'hooking_problem', 'balanced']).toContain(
        profile.copyTone
      )
      expect(typeof profile.hookDefault).toBe('boolean')
      for (const role of ROLE16) {
        expect(profile.patternPrevalence[role], `${key}.patternPrevalence.${role}`).toBeGreaterThanOrEqual(0)
      }
    }
  })

  it('source는 플랫폼 분리 수록이고 소표본(≤10건) coupang 축은 smallSample 표기된다', () => {
    const household = getCorpusSnapshotV2('household')!
    expect(household.source.coupang?.smallSample).toBe(true)
    const fashion = getCorpusSnapshotV2('fashion')!
    expect(fashion.source.naver?.samplePages).toBeGreaterThanOrEqual(90)
    expect(fashion.source.coupang?.smallSample).toBeUndefined()
    const digital = getCorpusSnapshotV2('digital')!
    expect(digital.source.naver?.categoryDir).toBe('04_디지털가전') // v1 결손이던 디자인 축 충전(결정 T-2)
  })

  it('copyPatterns는 원문 없이 패턴 추상화만 수록한다(H-1) — v1의 6개 절단 폐지', () => {
    for (const key of V2_CATEGORIES) {
      const { copyPatterns } = getCorpusSnapshotV2(key)!
      expect(copyPatterns.prevalentPatterns.length).toBeGreaterThan(0)
      for (const p of copyPatterns.prevalentPatterns) {
        expect(p.occurrencePer100).toBeGreaterThan(0)
        // 패턴 설명(intro)은 구조 기술이다 — 따옴표로 감싼 원문 카피가 섞이면 H-1 위반
        expect(p.intro).not.toMatch(/"[^"]{15,}"/)
      }
    }
  })
})

describe('v1 무접촉 확인 — Track S 회귀 안전(결정 T-7)', () => {
  it('v1 로더는 v2 도입 후에도 기존 계층 구조를 그대로 반환한다', () => {
    const v1 = getCorpusSnapshot('fashion')
    expect(v1).not.toBeNull()
    expect(v1?.sectionDesign.sequence.length).toBeGreaterThan(0)
    expect(v1?.imageDirection).toBeDefined()
    // v2 전용 필드가 v1에 새지 않았는지
    const v1Fields = v1 as unknown as Record<string, unknown>
    expect(v1Fields.schemaVersion).toBeUndefined()
    expect(v1Fields.designRecipes).toBeUndefined()
  })
})
