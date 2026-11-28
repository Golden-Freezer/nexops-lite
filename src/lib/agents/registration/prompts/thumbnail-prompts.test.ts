import { describe, it, expect } from 'vitest'
import {
  buildThumbnailPrompts,
  mapImpactBackground,
  defaultImpactConcept,
  getUsageSceneSummary,
  FOOD_BULK_HARVEST_SCENE,
  KOREAN_MODEL_INSTRUCTION,
  PRODUCT_CONSISTENCY_RULES,
} from './thumbnail-prompts'
import type { ThumbnailAnalysis } from '@/lib/registration/thumbnail-types'

function analysis(overrides: Partial<ThumbnailAnalysis> = {}): ThumbnailAnalysis {
  return {
    category: 'household',
    product_summary: 'a stainless tumbler',
    primary_colors: ['#FF6600'],
    has_label_or_logo: false,
    is_wearable: false,
    product_form: 'single_item',
    package_role: 'none',
    reference_index: 0,
    confidence: 0.9,
    ...overrides,
  }
}

describe('buildThumbnailPrompts (profiles.py:352-425 이식)', () => {
  it('3컷 모두 반환하고 조립 순서 골격을 지킨다', () => {
    const prompts = buildThumbnailPrompts(analysis(), 'household')
    expect(Object.keys(prompts).sort()).toEqual(['cutout', 'studio', 'usage'])
    // cutout: NEW PHOTOGRAPH → VIEWPOINT(pose match) → IDENTITY → TARGET(순백) → SOURCE REJECTION → COMMON
    expect(prompts.cutout).toContain('TASK — NEW PHOTOGRAPH')
    expect(prompts.cutout).toContain('Match the reference product orientation.')
    expect(prompts.cutout).toContain('pure white (#FFFFFF)')
    expect(prompts.cutout).toContain('DISCARD SOURCE-PHOTO ATTRIBUTES')
    expect(prompts.cutout).toContain('120px')
    // studio(임팩트): viewpoint는 반드시 DYNAMIC으로 덮어써야 한다(원본 아쿠아슈즈 실증)
    expect(prompts.studio).toContain('VIEWPOINT — DYNAMIC')
    expect(prompts.studio).not.toContain('Match the reference product orientation.')
    expect(prompts.studio).toContain('CREATIVE DIRECTION')
    expect(prompts.studio).toContain(KOREAN_MODEL_INSTRUCTION)
    // usage: identity 블록 대신 PRODUCT_CONSISTENCY_RULES(절대 규칙)를 붙인다
    expect(prompts.usage).toContain('Natural usage scene of a stainless tumbler')
    expect(prompts.usage).toContain(PRODUCT_CONSISTENCY_RULES.trim())
    expect(prompts.cutout).not.toContain('PRODUCT CONSISTENCY RULES (ABSOLUTE)')
    expect(prompts.studio).not.toContain('PRODUCT CONSISTENCY RULES (ABSOLUTE)')
  })

  it('지원하지 않는 카테고리는 throw', () => {
    expect(() => buildThumbnailPrompts(analysis(), 'unknown-cat')).toThrow(
      'Unsupported thumbnail category'
    )
  })

  it('form/role/label 분기: multi_item_set + sellable_unit + 라벨 있음', () => {
    const prompts = buildThumbnailPrompts(
      analysis({
        product_form: 'multi_item_set',
        package_role: 'sellable_unit',
        has_label_or_logo: true,
      }),
      'household'
    )
    expect(prompts.cutout).toContain('Preserve the exact number and composition of items')
    expect(prompts.cutout).toContain('Preserve the sellable package shape')
    expect(prompts.cutout).toContain('Keep label and logo content, position and proportion faithful')
  })

  it('bulk_goods는 BULK viewpoint를 쓴다', () => {
    const prompts = buildThumbnailPrompts(analysis({ product_form: 'bulk_goods' }), 'household')
    expect(prompts.cutout).toContain('Keep only the same camera elevation')
  })

  it('food × bulk_goods는 실사용 씬을 수확 씬으로 교체하고 한국인 모델 지시를 강제한다', () => {
    const prompts = buildThumbnailPrompts(
      analysis({ category: 'food', product_form: 'bulk_goods' }),
      'food'
    )
    expect(prompts.usage).toContain('freshly harvested product')
    expect(prompts.usage).toContain(KOREAN_MODEL_INSTRUCTION)
  })

  it('uses_person=false 카테고리(pet)의 usage에는 모델 지시가 없다', () => {
    const prompts = buildThumbnailPrompts(analysis(), 'pet')
    expect(prompts.usage).not.toContain(KOREAN_MODEL_INSTRUCTION)
    // 임팩트컷에는 카테고리 무관 항상 붙는다(profiles.py:413)
    expect(prompts.studio).toContain(KOREAN_MODEL_INSTRUCTION)
  })

  it('임팩트 컨셉이 있으면 그대로, 없으면 결정론 폴백을 쓴다', () => {
    const withConcept = buildThumbnailPrompts(analysis(), 'household', 'Splash of water frozen mid-air.')
    expect(withConcept.studio).toContain('Splash of water frozen mid-air.')
    const fallback = buildThumbnailPrompts(analysis({ primary_colors: [] }), 'household', '  ')
    expect(fallback.studio).toContain(defaultImpactConcept('a deep navy blue (#173A5E)'))
  })

  it('studio_override가 있는 카테고리(fashion)는 TARGET 뒤에 붙는다', () => {
    const prompts = buildThumbnailPrompts(analysis(), 'fashion')
    expect(prompts.studio).toContain('Emphasize natural fabric drape')
  })
})

describe('mapImpactBackground (profiles.py:305-323 HSV 3분기)', () => {
  it('무채색(saturation<0.12) → deep navy', () => {
    expect(mapImpactBackground(['#EEEEEE'])).toContain('deep navy')
  })
  it('빨강 계열(hue≤90 또는 ≥330) → teal green', () => {
    expect(mapImpactBackground(['#FF0000'])).toContain('teal green')
    expect(mapImpactBackground(['#FF6600'])).toContain('teal green') // hue 24
  })
  it('파랑·보라 계열(150≤hue≤300) → terracotta orange', () => {
    expect(mapImpactBackground(['#0000FF'])).toContain('terracotta') // hue 240
  })
  it('초록 계열(90<hue<150) → 기본 navy', () => {
    expect(mapImpactBackground(['#00FF00'])).toContain('deep navy') // hue 120
  })
  it('유효 hex 없음 → 기본 navy, 비배열 입력도 안전', () => {
    expect(mapImpactBackground(['not-a-color'])).toContain('deep navy')
    expect(mapImpactBackground(undefined)).toContain('deep navy')
  })
  it('첫 유효 hex만 본다 (무효값 건너뜀)', () => {
    expect(mapImpactBackground(['xx', '#0000FF'])).toContain('terracotta')
  })
})

describe('getUsageSceneSummary (profiles.py:343-349)', () => {
  it('food × bulk_goods → 수확 씬', () => {
    expect(getUsageSceneSummary({ product_form: 'bulk_goods' }, 'food')).toBe(FOOD_BULK_HARVEST_SCENE)
  })
  it('일반 카테고리 → 프로필 씬', () => {
    expect(getUsageSceneSummary({ product_form: 'single_item' }, 'pet')).toContain('A dog or cat')
  })
  it('미지 카테고리 → 빈 문자열', () => {
    expect(getUsageSceneSummary({ product_form: 'single_item' }, 'nope')).toBe('')
  })
})
