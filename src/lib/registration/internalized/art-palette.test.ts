/**
 * palette2(D2 아트 디렉션 v2, PALETTE2.md) — 대상 톤 판정·주색 고르기·대비 검사·계획 기록·스위치 범위. LLM·DB 없음.
 */

import { describe, expect, it } from 'vitest'
import { contrastRatio, parseColor } from '../editor/utils/mobileReadability'
import { onColor } from '../editor/utils/sectionConverter/designCut/tokens'
import { resolveEnabledFeatures } from '../enrichment-switch'
import { applyDesignSkeleton, resolveDesignSkeleton } from '../pdp-enrichment-stage'
import type { PdpJobRow } from '../pdp-state'
import { mergeManualStrategy } from '../pdp-strategy-contract'
import { fixtureToJob, loadEnrichmentFixture } from '../__golden__/golden-harness'
import { buildPalette2, paletteToneOf, primarySwatchOf, SWATCHES } from './art-palette'
import { lchToHex } from './designcut-palette'
import { buildDesigncutPlan } from './designcut-plan'
import { PALETTE2 as CHECK_PALETTE2 } from '../../../../scripts/render-check/checks/d2-scene.mjs'

const PARENT = { kind: 'parent_proxy', version: 1, basis: 'name_tags', terms: ['어린이집'], ageGate: false }
const analysisWith = (audience?: object) => ({ enrichment: { version: 1, features: ['designcut'], ...(audience ? { audience } : {}) } })
const ratio = (a: string, b: string) => contrastRatio(parseColor(a)!, parseColor(b)!)
const INK = '#1A1A1A'

describe('palette2 — 대상 톤', () => {
  it('학부모 대리 구매형(연령 게이트 아님)만 playful, 연령 게이트·판정 없음은 calm', () => {
    expect(paletteToneOf(analysisWith(PARENT))).toEqual({ tone: 'playful', basis: 'parent_proxy' })
    expect(paletteToneOf(analysisWith({ ...PARENT, ageGate: true }))).toEqual({ tone: 'calm', basis: 'default' })
    expect(paletteToneOf(analysisWith())).toEqual({ tone: 'calm', basis: 'default' })
    expect(buildPalette2(analysisWith(), null, '#D9622B', INK)).toEqual({ tone: 'calm', basis: 'default' })
  })

  it('상품명·대상 줄·카테고리에 아동·어린이집·답례 낱말이 있으면 playful(통합 보정 — R10 P02·P11 playful, P07 calm)', () => {
    const tone = (spec: object, analysis: object = analysisWith()) => paletteToneOf(analysis, spec)
    const PLAYFUL = { tone: 'playful', basis: 'target_terms' }
    const CALM = { tone: 'calm', basis: 'default' }
    expect(tone({ targetPersona: '아이를 어린이집에 보내는 30대 엄마' })).toEqual(PLAYFUL)
    expect(tone({ productName: '지야픽 가정의달 카네이션 답례 스티커', category: 'stationery' })).toEqual(PLAYFUL)
    expect(tone({ productName: '페어넥스 구디백 포장봉투 선물 파우치' })).toEqual(PLAYFUL)
    expect(tone({ category: '유아 식기' })).toEqual(PLAYFUL)
    // '선물'·'아이'만으로는 켜지 않는다 — 프리미엄 선물세트·눈가 화장품·반려동물의 '우리 아이'(검수 10-31)
    for (const spec of [
      { productName: '한우 선물세트 1++ 명절' },
      { productName: '시그니처 향수 선물 세트', targetPersona: '부모님 효도 선물을 찾는 30대' },
      { productName: '콜라겐 아이 크림 아이 패치' },
      { productName: '페어넥스 강아지 밥그릇 고양이 식기 2구', targetPersona: '우리 아이 간식 챙기는 반려인', category: 'pet' },
      { targetPersona: '살림 아이템·수납 아이디어를 찾는 주부', category: '아이스 트레이' },
    ])
      expect(tone(spec), JSON.stringify(spec)).toEqual(CALM)
    // 연령 게이트는 낱말이 있어도 calm — 판정 기록의 ageGate든 spec.minAgeYears(판정 기록이 없는 잡)든
    expect(tone({ targetPersona: '어린이집 답례' }, analysisWith({ ...PARENT, ageGate: true }))).toEqual(CALM)
    expect(tone({ targetPersona: '어린이 생일 파티 답례를 준비하는 부모', minAgeYears: 14 })).toEqual(CALM)
  })
})

describe('palette2 — playful 색', () => {
  it('주색은 제품색 색상각에 가장 가까운 견본, 무채 제품은 버터 옐로', () => {
    expect(primarySwatchOf('#D9622B')).toBe('coral')
    expect(primarySwatchOf('#E2B33C')).toBe('butter')
    expect(primarySwatchOf('#3FAF8F')).toBe('mint')
    expect(primarySwatchOf('#2B6CD9')).toBe('sky')
    expect(primarySwatchOf('#8A8A8A')).toBe('butter')
    expect(primarySwatchOf(undefined)).toBe('butter')
  })

  it('네 주색 모두 — 강조 글자 스튜디오 위 4.5:1, 짙은 색 흰 위 4.5:1, 채움 위 글자(onColor) 4.5:1, 바탕은 아주 옅은 틴트', () => {
    for (const product of ['#D9622B', '#E2B33C', '#3FAF8F', '#2B6CD9']) {
      const p = buildPalette2(analysisWith(PARENT), null, product, INK)
      const c = p.colors!
      expect(p.tone).toBe('playful')
      expect(ratio(c.accentText, c.studio), product).toBeGreaterThanOrEqual(4.5)
      expect(ratio(c.deep, '#FFFFFF'), product).toBeGreaterThanOrEqual(4.5)
      for (const fill of [c.primary, ...c.secondary]) expect(ratio(onColor(fill, INK), fill), fill).toBeGreaterThanOrEqual(4.5)
      expect(ratio(c.heading, '#FFFFFF')).toBeGreaterThanOrEqual(7)
      expect(ratio(c.studio, '#FFFFFF')).toBeLessThan(1.1)
      expect(new Set([c.primary, ...c.secondary]).size).toBe(3)
    }
  })

  it('같은 입력은 같은 색(결정론) — 주색은 견본 값 그대로', () => {
    const a = buildPalette2(analysisWith(PARENT), null, '#E2B33C', INK)
    expect(buildPalette2(analysisWith(PARENT), null, '#E2B33C', INK)).toEqual(a)
    expect(a.colors!.primary).toBe(lchToHex(SWATCHES.butter))
  })

  it('버터 주색 — 강조 글자·제목·짙은 색은 잉크(같은 색상각으로 내린 올리브·겨자색 없음, SPACING-LAYOUT.md ④)', () => {
    const c = buildPalette2(analysisWith(PARENT), null, '#E2B33C', INK).colors!
    expect([c.accentText, c.heading, c.deep]).toEqual([INK, INK, INK])
    // 다른 주색은 지금처럼 같은 색상각의 짙은 강조 글자
    for (const product of ['#D9622B', '#3FAF8F', '#2B6CD9']) {
      expect(buildPalette2(analysisWith(PARENT), null, product, INK).colors!.accentText, product).not.toBe(INK)
    }
  })

  it('render-check d2-scene의 palette2 값이 buildPalette2 결과와 같다(복사한 값이 어긋나지 않게)', () => {
    expect(CHECK_PALETTE2.playful).toEqual(buildPalette2(analysisWith(PARENT), null, '#D9622B', INK))
    expect(CHECK_PALETTE2.butter).toEqual(buildPalette2(analysisWith(PARENT), null, '#E2B33C', INK))
  })
})

describe('palette2 — 계획 기록·스위치 범위', () => {
  const ON = ['vocab', 'persuasion', 'layouts', 'shots', 'annotations', 'mobile', 'options', 'designcut', 'designcut2']
  const job = (features: string[], audience?: object, key: 'A-track-i' | 'B-track-i' = 'B-track-i'): PdpJobRow => {
    const j = fixtureToJob(loadEnrichmentFixture(key))
    j.analysis = { ...j.analysis, enrichment: { version: 1, features, ...(audience ? { audience } : {}) } } as PdpJobRow['analysis']
    const strategy = mergeManualStrategy(j.analysis.recommended_strategy_contract ?? {}, j.spec_sheet, [])
    j.section_plan = applyDesignSkeleton(j.section_plan, resolveDesignSkeleton(j, strategy))
    return j
  }

  it('palette2를 기록한 D2 잡만 아트 디렉션에 palette2 — 사진·컷 바탕(palette)은 켬/끔이 같다', () => {
    const off = buildDesigncutPlan(job(ON, PARENT))!
    const on = buildDesigncutPlan(job([...ON, 'palette2'], PARENT))!
    expect(off.artDirection!.palette2).toBeUndefined()
    expect(on.artDirection!.palette2!.tone).toBe('playful')
    expect(on.palette).toEqual(off.palette)
    expect(on.artDirection!.set).toEqual(off.artDirection!.set)
    expect(buildDesigncutPlan(job([...ON, 'palette2']))!.artDirection!.palette2).toEqual({ tone: 'calm', basis: 'default' })
    // 고정물 A(폭죽, minAgeYears 14)는 판정 기록이 있어도 연령 게이트로 calm
    expect(buildDesigncutPlan(job([...ON, 'palette2'], PARENT, 'A-track-i'))!.artDirection!.palette2).toEqual({ tone: 'calm', basis: 'default' })
  })

  it('스위치 — designcut2·designlayout과 함께 켜질 때만 기록, 기본 on(K4 운영 전환)', () => {
    const skip = (names: string) => ({ NEXOPS_PDP_ENRICHMENT_SKIP: names })
    expect(resolveEnabledFeatures({})).toContain('palette2')
    expect(resolveEnabledFeatures({ VERCEL: '1' })).toContain('palette2')
    expect(resolveEnabledFeatures(skip('designlayout'))).not.toContain('palette2')
    expect(resolveEnabledFeatures(skip('designcut2'))).not.toContain('palette2')
    expect(resolveEnabledFeatures(skip('designcut'))).not.toContain('palette2')
  })
})
