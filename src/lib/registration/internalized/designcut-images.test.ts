/**
 * 디자인 컷 이미지 키(2026-10-28) — 같은 컷은 한 섹션만, 생성은 계획이 쓰는 키 + 대체·kept 기존 섹션의 키만.
 */

import { describe, expect, it } from 'vitest'
import { assignImageKeys, designcutTaskFilter } from './designcut-images'
import type { DesigncutPlan, DesigncutSection, DesigncutTemplate } from '../pdp-state'

type Piece = Pick<DesigncutSection, 'template' | 'productImageKey'>
const piece = (template: DesigncutTemplate, productImageKey: string | null): Piece => ({ template, productImageKey })
const keys = (pieces: Piece[]) => pieces.map((p) => p.productImageKey)

describe('assignImageKeys — 같은 컷 한 번', () => {
  it('자기 컷(hero·features·howto)은 그대로, 대표 컷을 빌리던 자리(T3a 컷 없는 장·T6·T8)는 후보에서, T7은 비운다', () => {
    const out = assignImageKeys(
      [
        piece('T1', 'hero'),
        piece('T3a', 'features:0'),
        piece('T3b', 'features:1'),
        piece('T3a', 'hero'),
        piece('T5', 'howto:0'),
        piece('T6', 'hero'),
        piece('T7', 'hero'),
        piece('T8', 'hero'),
      ],
      true
    )
    expect(keys(out)).toEqual([
      'hero',
      'features:0',
      'features:1',
      'product_exposure',
      'howto:0',
      'premium_hero',
      null,
      'cta',
    ])
    const used = keys(out).filter((k): k is string => k !== null)
    expect(new Set(used).size).toBe(used.length)
  })

  it('Premium 모드(Pro 컷 없음): Pro 전용 후보를 건너뛰고, 다 쓰였으면 제품이 필요한 자리만 hero를 다시 쓴다', () => {
    const out = assignImageKeys(
      [piece('T1', 'hero'), piece('T3a', 'hero'), piece('T3a', 'hero'), piece('T6', 'hero'), piece('T8', 'hero')],
      false
    )
    expect(keys(out)).toEqual(['hero', 'solution', 'usage', 'hero', 'cta'])
  })

  it('제품 컷이 없는 템플릿(T2·T4)은 그대로 null', () => {
    expect(keys(assignImageKeys([piece('T2', null), piece('T4', null)], true))).toEqual([null, null])
  })
})

const section = (
  key: string,
  template: DesigncutTemplate,
  productImageKey: string | null,
  extra: Partial<DesigncutSection> = {}
): DesigncutSection => ({
  key,
  role: 'x',
  template,
  bg: 'W',
  chapter: null,
  plateKey: null,
  plateAspect: null,
  productImageKey,
  productAlpha: false,
  text: { eyebrow: null, headline: null, sub: null },
  modules: [],
  ...extra,
})
const plan = (sections: DesigncutSection[], kept: string[] = []): DesigncutPlan => ({
  version: 1,
  palette: {
    accent: '#000000',
    accentText: '#000000',
    deep: '#000000',
    tint: '#FFFFFF',
    ink: '#000000',
    mode: 'neutral',
  },
  motif: { badge: 'SOFT' },
  sections,
  kept,
  omitted: [],
  order: [...sections.map((s) => s.key), ...kept],
})

describe('designcutTaskFilter — 생성할 태스크', () => {
  const ALL = [
    'hero',
    'problem',
    'solution',
    'usage',
    'cta',
    'features:0',
    'features:1',
    'features:2',
    'howto:0',
    'howto:1',
    'usp_icons:0',
    'size_comparison',
    'option_bundle',
    'premium_hero',
    'product_exposure',
    'empathy_scene',
    'certification_badge',
    'rating_bg',
    'plate:hook_3step',
    'plate:point_div:0',
  ]

  // 2026-10-31 통합 점검: 사진 없는 글 템플릿(T2 고민·T4 체크리스트)은 계획이 그릴 내용을 확인해 대체되지 않으므로 대체 키(problem 등)를
  // 미리 만들지 않는다(R5-D 구디백 c7afd0b3 — problem·solution 컷을 어느 템플릿도 쓰지 않았다)
  it('계획 키·플레이트·장식 대상 + 대체 기존 섹션 키(hook→hero, cta→cta — T2 problem_raise는 대체 키 없음) + hero', () => {
    const needed = designcutTaskFilter(
      plan([
        section('hook_3step', 'T1', 'hero', { plateKey: 'plate:hook_3step' }),
        section('problem_raise', 'T2', null),
        section('point_div:0', 'T3a', 'features:0', {
          plateKey: 'plate:point_div:0',
          modules: [{ type: 'M2b', data: { imageKey: 'features:0' } }],
        }),
        section('point_div:1', 'T3b', 'features:1'),
        section('cta', 'T8', 'cta'),
      ])
    )!
    expect(ALL.filter(needed)).toEqual([
      'hero',
      'cta',
      'features:0',
      'features:1',
      'plate:hook_3step',
      'plate:point_div:0',
    ])
  })

  it('사용법(hidden_page)은 대체 섹션이 단계별 컷을 다 쓰고, main_cut은 premium_hero·hero·usp 아이콘, 옵션(petit_div)은 묶음 컷·hero', () => {
    const needed = designcutTaskFilter(
      plan([
        section('main_cut', 'T1', 'hero'),
        section('hidden_page', 'T5', 'howto:0'),
        section('petit_div', 'T7', null),
      ])
    )!
    expect(ALL.filter(needed)).toEqual(['hero', 'howto:0', 'howto:1', 'usp_icons:0', 'option_bundle', 'premium_hero'])
  })

  it('전환 섹션(convert_div)의 대체 키 conversion_cta는 생성 키 cta의 별칭이다', () => {
    const needed = designcutTaskFilter(plan([section('hook_3step', 'T1', 'hero')], ['convert_div']))!
    expect(needed('cta')).toBe(true)
    expect(needed('conversion_cta')).toBe(false)
  })

  it('kept 섹션의 키도 만든다(인증 배지·평점 바탕), 기존 키를 모르는 섹션이 있으면 거르지 않는다(null)', () => {
    const needed = designcutTaskFilter(plan([section('hook_3step', 'T1', 'hero')], ['certification', 'perf_rating']))!
    expect(ALL.filter(needed)).toEqual(['hero', 'certification_badge', 'rating_bg'])
    expect(designcutTaskFilter(plan([section('hook_3step', 'T1', 'hero')], ['shipping_unknown']))).toBeNull()
  })
})
