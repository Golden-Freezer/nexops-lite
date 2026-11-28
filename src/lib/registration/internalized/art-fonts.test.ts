/**
 * fontpair(디자인 폰트 계획 ①) — 짝 판정·자체 보관 글꼴 범위·palette2와 같은 값·계획 기록·스위치 범위. LLM·DB 없음.
 */

import { describe, expect, it } from 'vitest'
import { FONT_OPTIONS } from '../editor/constants/fonts'
import { HOOK_TYPE } from '../editor/utils/sectionConverter/designCut/tokens'
import { resolveEnabledFeatures } from '../enrichment-switch'
import { applyDesignSkeleton, resolveDesignSkeleton } from '../pdp-enrichment-stage'
import type { PdpJobRow } from '../pdp-state'
import { mergeManualStrategy } from '../pdp-strategy-contract'
import { fixtureToJob, loadEnrichmentFixture } from '../__golden__/golden-harness'
import { buildFontPair, FONT_PAIRS } from './art-fonts'
import { FONT_PAIRS as CHECK_FONT_PAIRS } from '../../../../scripts/render-check/checks/d2-scene.mjs'
import { buildDesigncutPlan } from './designcut-plan'

const PARENT = { kind: 'parent_proxy', version: 1, basis: 'name_tags', terms: ['어린이집'], ageGate: false }
const analysisWith = (extra: object = {}) => ({ enrichment: { version: 1, features: [] }, ...extra })

describe('fontpair — 짝 판정', () => {
  it('playful(palette2와 같은 판정)은 둥근 주아 — palette2 첫 화면 제목과 같은 글꼴·굵기', () => {
    const viaAudience = buildFontPair({ enrichment: { version: 1, features: [], audience: PARENT } }, null)
    const viaTerms = buildFontPair(analysisWith(), { productName: '가정의달 카네이션 답례 스티커' })
    for (const p of [viaAudience, viaTerms]) {
      expect([p.tone, p.heading, p.weight, p.body]).toEqual(['playful', HOOK_TYPE.playful.fontFamily, HOOK_TYPE.playful.weight, 'Pretendard'])
    }
    expect([viaAudience.basis, viaTerms.basis]).toEqual(['parent_proxy', 'target_terms'])
  })

  it('premium — 뷰티 카테고리, 또는 선물세트 낱말이면 명조 함렛', () => {
    expect(buildFontPair(analysisWith({ detected_category: 'beauty' }), null)).toMatchObject({ tone: 'premium', basis: 'category', heading: 'Hahmlet' })
    expect(buildFontPair(analysisWith({ detected_category: 'food' }), { productName: '한우 선물세트 1++' })).toMatchObject({
      tone: 'premium',
      basis: 'premium_terms',
      heading: 'Hahmlet',
      weight: 700,
    })
  })

  it('everyday — 생활·기능·반려·패션 등 그 밖은 굵은 고딕 SUIT 800, 「프리미엄·고급」 수식어만으로는 명조가 아니다, 연령 게이트 잡도 playful이 아니다', () => {
    for (const [category, productName] of [
      ['pet', '프리미엄 강아지 배변패드 100매'],
      ['household', '고급 원목 수납장'],
      ['fashion', '방수 레인코트 남녀공용'],
    ])
      expect(buildFontPair(analysisWith({ detected_category: category }), { productName }).tone, productName).toBe('everyday')
    expect(buildFontPair(analysisWith({ detected_category: 'pet' }), { productName: '강아지 밥그릇 고양이 식기 2구' })).toMatchObject({
      tone: 'everyday',
      basis: 'default',
      heading: 'SUIT Variable',
      weight: 800,
    })
    expect(buildFontPair(analysisWith({ detected_category: 'household' }), { productName: '어린이 생일 답례', minAgeYears: 14 }).tone).toBe('everyday')
  })

  it('짝의 제목 글꼴은 모두 자체 보관 선택지 패밀리다(주아는 굵기까지 같고, 가변 글꼴 함렛·SUIT는 fonts.css 굵기 범위 100~900 안)', () => {
    for (const { heading, weight } of Object.values(FONT_PAIRS)) {
      const variable = heading.endsWith('Variable') || heading === 'Hahmlet'
      expect(
        FONT_OPTIONS.some((f) => f.fontFamily === heading && (variable || f.fontWeight === weight)),
        `${heading} ${weight}`
      ).toBe(true)
    }
  })
})

describe('fontpair — render-check 짝 표', () => {
  it('d2-scene ⑥의 짝 표가 FONT_PAIRS와 같다(복사한 값이 어긋나지 않게)', () => {
    for (const [tone, pair] of Object.entries(FONT_PAIRS))
      expect([CHECK_FONT_PAIRS[tone as keyof typeof CHECK_FONT_PAIRS].heading, CHECK_FONT_PAIRS[tone as keyof typeof CHECK_FONT_PAIRS].weight]).toEqual([pair.heading, pair.weight])
  })
})

describe('fontpair — 계획 기록·스위치 범위', () => {
  const ON = ['vocab', 'persuasion', 'layouts', 'shots', 'annotations', 'mobile', 'options', 'designcut', 'designcut2']
  const job = (features: string[]): PdpJobRow => {
    const j = fixtureToJob(loadEnrichmentFixture('B-track-i'))
    j.analysis = { ...j.analysis, enrichment: { version: 1, features } } as PdpJobRow['analysis']
    const strategy = mergeManualStrategy(j.analysis.recommended_strategy_contract ?? {}, j.spec_sheet, [])
    j.section_plan = applyDesignSkeleton(j.section_plan, resolveDesignSkeleton(j, strategy))
    return j
  }

  it('fontpair를 기록한 D2 잡만 아트 디렉션에 fontPair — 팔레트·세트는 켬/끔이 같다', () => {
    const off = buildDesigncutPlan(job(ON))!
    const on = buildDesigncutPlan(job([...ON, 'fontpair']))!
    expect(off.artDirection!.fontPair).toBeUndefined()
    expect(on.artDirection!.fontPair!.body).toBe('Pretendard')
    expect(on.palette).toEqual(off.palette)
    expect(on.artDirection!.set).toEqual(off.artDirection!.set)
    expect(on.artDirection!.background).toEqual(off.artDirection!.background)
  })

  it('스위치 — designcut2·designlayout과 함께 켜질 때만 기록, 기본 on(K4 운영 전환)', () => {
    const skip = (names: string) => ({ NEXOPS_PDP_ENRICHMENT_SKIP: names })
    expect(resolveEnabledFeatures({})).toContain('fontpair')
    expect(resolveEnabledFeatures({ VERCEL: '1' })).toContain('fontpair')
    expect(resolveEnabledFeatures(skip('designlayout'))).not.toContain('fontpair')
    expect(resolveEnabledFeatures(skip('designcut2'))).not.toContain('fontpair')
    expect(resolveEnabledFeatures(skip('designcut'))).not.toContain('fontpair')
  })
})

describe('fontpair — 식품 손글씨(적용 T1-81)', () => {
  it('식품이고 손맛 낱말이 있을 때만 손글씨다', () => {
    for (const productName of ['수제 쿠키 12개입', '엄마 손맛 김치', '직접 빚은 만두', '핸드메이드 잼'])
      expect(buildFontPair(analysisWith({ detected_category: 'food' }), { productName }), productName).toMatchObject({ tone: 'handwritten', basis: 'hand_terms', heading: 'Gaegu', weight: 400, body: 'Pretendard' })
    expect(buildFontPair(analysisWith(), { productName: '수제 쿠키', category: '식품' }).tone).toBe('handwritten')
  })

  it('낱말이 없는 식품과 다른 카테고리의 손맛 낱말은 지금 그대로다', () => {
    expect(buildFontPair(analysisWith({ detected_category: 'food' }), { productName: '국산 사과 3kg' }).tone).toBe('everyday')
    expect(buildFontPair(analysisWith({ detected_category: 'household' }), { productName: '수제 원목 수납장' }).tone).toBe('everyday')
    expect(buildFontPair(analysisWith({ detected_category: 'beauty' }), { productName: '수제 비누' }).tone).toBe('premium')
  })

  it('선물세트 낱말이 먼저다 — 지금 판정을 바꾸지 않는다', () => {
    expect(buildFontPair(analysisWith({ detected_category: 'food' }), { productName: '수제 쿠키 선물세트' }).tone).toBe('premium')
  })
})
