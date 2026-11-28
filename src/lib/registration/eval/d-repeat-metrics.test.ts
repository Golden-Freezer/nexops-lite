/**
 * D 페이지 반복 지표(적용 D3 P0) — 손으로 센 값과 맞춘다. 기록만이라 판정은 하지 않는다.
 * 부품 이름(체크·말풍선·원 틀)은 픽스처 계획 B를 실제로 조립한 문서로도 확인한다 — 템플릿 요소 이름이 바뀌면 여기서 걸린다.
 */

import { describe, expect, it } from 'vitest'
import { composeDesignCut } from '../editor/utils/sectionConverter/designCut/compose'
import { readDesignCut } from '../editor/utils/sectionConverter/designCut/contract'
import { designCutPlanForB } from '../editor/utils/sectionConverter/designCut/designCut.fixture'
import type { DesigncutPlan, DesigncutSection } from '../pdp-state'
import { dRepeatLine, dRepeatMetrics, drawnDevicesOf, openingKeyOf, skeletonOfSection, type DeviceSection } from './d-repeat-metrics'

/** 기준 값은 시험에 고정한다 — 코드 상수를 가져오면 변이를 못 잡는다 */
const ARCH = 'inset(0 round 9999px 9999px 0 0)'

const sec = (key: string, template: string, over: Partial<DesigncutSection> = {}): DesigncutSection =>
  ({
    key,
    role: 'brand_story',
    template,
    bg: 'W',
    chapter: null,
    plateKey: null,
    plateAspect: null,
    productImageKey: null,
    productAlpha: false,
    text: { eyebrow: null, headline: null, sub: null },
    modules: [],
    ...over,
  }) as DesigncutSection

const planOf = (sections: DesigncutSection[], order?: string[]): DesigncutPlan =>
  ({
    version: 1,
    palette: { accent: '#000000', accentText: '#FFFFFF', deep: '#111111', tint: '#EEEEEE', ink: '#111111', mode: 'neutral' },
    motif: { badge: 'SOFT' },
    sections,
    kept: [],
    omitted: [],
    order: order ?? sections.map((s) => s.key),
  }) as DesigncutPlan

const titled = (key: string, template: string, headline: string, over: Partial<DesigncutSection> = {}) => sec(key, template, { ...over, text: { eyebrow: null, headline, sub: null } })

describe('같은 뼈대', () => {
  it('키는 템플릿·변형이고 변형이 없으면 scene, 큰 POINT는 세지 않는다', () => {
    expect(skeletonOfSection({ template: 'T3a', layoutVariant: 'zigzag', chapter: null })).toBe('T3a:zigzag')
    expect(skeletonOfSection({ template: 'T4', chapter: null })).toBe('T4:scene')
    expect(skeletonOfSection({ template: 'T3a', layoutVariant: 'zigzag', chapter: 2 })).toBeNull()
  })

  it('최다 수·반복·이웃을 센다 — 큰 POINT와 기존 빌더 섹션은 이웃을 끊는다', () => {
    const plan = planOf(
      [
        sec('main_cut', 'T1'),
        sec('point_div:0', 'T3a', { chapter: 1, layoutVariant: 'zigzag' }),
        sec('point_div:1', 'T3a', { chapter: 2, layoutVariant: 'zigzag' }),
        sec('fill:0', 'T3a', { layoutVariant: 'zigzag' }),
        sec('fill:1', 'T3a', { layoutVariant: 'zigzag' }),
        sec('fill:2', 'T3a', { layoutVariant: 'zigzag' }),
        sec('fill:3', 'T3a', { layoutVariant: 'scene' }),
        sec('fill:4', 'T3a'),
        sec('fill:5', 'T3a', { layoutVariant: 'zigzag' }),
      ],
      ['main_cut', 'point_div:0', 'point_div:1', 'fill:0', 'fill:1', 'certification', 'fill:2', 'fill:3', 'fill:4', 'point_div:2_missing', 'fill:5'],
    )
    const m = dRepeatMetrics(plan)
    expect(m.skeleton).toEqual({ max: 4, top: 'T3a:zigzag', repeats: 3 + 1, adjacent: 2, maxOutsideTables: 4 })
    expect(m.sections).toEqual({ total: 11, planned: 9 })
  })

  it('같은 수면 페이지에서 먼저 나온 뼈대를 적고, 섹션이 없으면 0이다', () => {
    const m = dRepeatMetrics(planOf([sec('a', 'T4'), sec('b', 'T5'), sec('c', 'T5'), sec('d', 'T4')]))
    expect(m.skeleton).toEqual({ max: 2, top: 'T4:scene', repeats: 2, adjacent: 1, maxOutsideTables: 2 })
    expect(dRepeatMetrics(planOf([])).skeleton).toEqual({ max: 0, top: null, repeats: 0, adjacent: 0, maxOutsideTables: 0 })
  })

  it('사실 표(T9)는 최다에 들고 T9 뺀 최다에는 들지 않는다(D3 P1 — 횟수 상한 밖)', () => {
    const plan = planOf([sec('a', 'T9'), sec('x', 'T5'), sec('b', 'T9'), sec('c', 'T9'), sec('d', 'T4'), sec('y', 'T5')])
    expect(dRepeatMetrics(plan).skeleton).toEqual({ max: 3, top: 'T9:scene', repeats: 3, adjacent: 1, maxOutsideTables: 2 })
    expect(dRepeatMetrics(planOf([sec('a', 'T9')])).skeleton.maxOutsideTables).toBe(0)
  })
})

describe('부품(그린 문서)', () => {
  const drawn = (names: string[], over: Partial<DeviceSection> = {}): DeviceSection => ({ canvas: { height: 800 }, elements: names.map((name) => ({ name })), ...over })
  const photo = (frameId: string, clipPath = 'none', imageType?: string): DeviceSection => ({ canvas: { height: 800 }, elements: [{ name: 'p', framedImageProps: { frameId, clipPath, imageType } }] })

  it('체크·말풍선·원·아치 틀이 든 섹션 수를 센다 — 한 섹션의 여러 표식은 한 곳이다', () => {
    const sections = [
      drawn(['designcut-check-0', 'designcut-check-1', 'designcut-check-icon-0']),
      drawn(['designcut-bubble-0', 'designcut-bubble-text-0', 'designcut-bubble-1']),
      drawn(['designcut-check-0']),
      photo('circle'),
      photo('designcut', ARCH),
      photo('roundedRect', 'inset(0 round 16px)'),
      drawn(['designcut-headline']),
    ]
    expect(drawnDevicesOf(sections)).toEqual({ check: 2, bubble: 1, frame: 2, zoom: 0 })
  })

  it('원형 확대 장식은 원 틀이어도 틀에 넣지 않고 확대 원으로 따로 센다(K devicesOf처럼 템플릿 틀만 틀)', () => {
    const zoomOnPoint: DeviceSection = { canvas: { height: 800 }, elements: [{ name: 'designcut-scene' }, { name: 'annotation-zoom', framedImageProps: { frameId: 'circle', clipPath: 'circle(50% at 50% 50%)', imageType: 'annotation-zoom' } }] }
    expect(drawnDevicesOf([zoomOnPoint, zoomOnPoint, photo('circle')])).toEqual({ check: 0, bubble: 0, frame: 1, zoom: 2 })
  })

  it('안 보이는 섹션과 높이 10 미만 조각은 세지 않는다', () => {
    expect(drawnDevicesOf([drawn(['designcut-check-0'], { isVisible: false }), drawn(['designcut-bubble-0'], { canvas: { height: 9 } }), photo('circle')])).toEqual({ check: 0, bubble: 0, frame: 1, zoom: 0 })
  })

  it('문서가 없으면 부품은 null이다', () => {
    expect(dRepeatMetrics(planOf([sec('a', 'T2')])).devices).toBeNull()
  })

  it('픽스처 계획 B를 조립한 문서 — 말풍선(T2) 1·체크(T4) 1·틀 0, 원 3칸 자세히 보기를 더하면 틀 1', () => {
    const plan = designCutPlanForB() as ReturnType<typeof designCutPlanForB> & Record<string, unknown>
    plan.layout = 2
    const images = { hero: 'https://img.test/hero.png', features: Array.from({ length: 6 }, (_, i) => `https://img.test/f${i}.png`) }
    const compose = () => composeDesignCut([], readDesignCut({ designcut: plan })!, { images, sectionOrder: [], imageAspects: null })
    expect(drawnDevicesOf(compose())).toEqual({ check: 1, bubble: 1, frame: 0, zoom: 0 })
    const base = plan.sections.find((s) => s.key.startsWith('point_div:'))!
    const items = [
      { title: '넉넉한 20매', description: null, imageKey: 'features:2' },
      { title: '반투명 소재', description: null, imageKey: 'features:4' },
      { title: '조임끈 마감', description: null, imageKey: 'features:5' },
    ]
    plan.sections.push({
      ...base,
      key: 'detail:more',
      role: 'usp_feature',
      template: 'T11',
      chapter: null,
      productImageKey: null,
      text: { eyebrow: 'DETAIL', headline: '자세히 보기', sub: null },
      modules: [{ type: 'M11', data: { items } }],
      layoutVariant: 'list',
    } as unknown as (typeof plan.sections)[number])
    plan.order.splice(plan.order.indexOf('point_div:2') + 1, 0, 'detail:more')
    expect(drawnDevicesOf(compose())).toEqual({ check: 1, bubble: 1, frame: 1, zoom: 0 })
  })
})

describe('장점류', () => {
  it('역할 usp_feature·fill_message 섹션 수 — 기존 빌더 섹션과 다른 역할은 세지 않는다', () => {
    const plan = planOf(
      [sec('p0', 'T3a', { role: 'usp_feature', chapter: 1 }), sec('d', 'T11', { role: 'usp_feature' }), sec('m0', 'T3a', { role: 'fill_message' }), sec('m1', 'T3a', { role: 'fill_message' }), sec('r', 'T12', { role: 'social_proof' })],
      ['p0', 'd', 'kept_usp', 'm0', 'm1', 'r'],
    )
    expect(dRepeatMetrics(plan).advantages).toBe(4)
  })
})

describe('POINT 같은 말(R-K20)', () => {
  it('앞 POINT 제목과 같은 어절 짝(끝 조사 뗌)을 쓴 POINT 제목 수 — POINT 밖 제목은 세지 않는다', () => {
    const plan = planOf([
      titled('p0', 'T3a', '부드러운 소재로 편안하게', { chapter: 1 }),
      // POINT 밖 메시지 제목은 앞 POINT와 짝이 같아도 세지 않는다
      titled('m0', 'T3a', '부드러운 소재 그대로'),
      titled('p1', 'T3a', '부드러운 소재와 넉넉한 크기', { chapter: 2 }),
      titled('p2', 'T3a', '넉넉한 크기 하나로', { chapter: 3 }),
    ])
    expect(dRepeatMetrics(plan).pointEchoes).toBe(2)
  })

  it('숫자만인 어절과 빼는 낱말(옵션 값·브랜드)이 든 짝은 세지 않는다', () => {
    const plan = planOf([titled('p0', 'T3a', '포근 담요 20 매 구성', { chapter: 1 }), titled('p1', 'T3a', '포근 담요 20 매 그대로', { chapter: 2 })])
    expect(dRepeatMetrics(plan).pointEchoes).toBe(1)
    expect(dRepeatMetrics(plan, { excludeTerms: ['포근'] }).pointEchoes).toBe(0)
  })

  it('제목이 없는 POINT는 건너뛴다', () => {
    const plan = planOf([titled('p0', 'T3a', '가벼운 무게', { chapter: 1 }), sec('p1', 'T3a', { chapter: 2 }), titled('p2', 'T3a', '가벼운 무게감', { chapter: 3 })])
    expect(dRepeatMetrics(plan).pointEchoes).toBe(0)
  })
})

describe('제목 첫머리(R-K21)', () => {
  it('첫 두 어절(끝 조사 뗌)이 키이고 어절이 둘 안 되면 null이다', () => {
    expect(openingKeyOf('하루 종일의 편안함')).toBe('하루 종일')
    expect(openingKeyOf('하루종일')).toBeNull()
    expect(openingKeyOf('')).toBeNull()
  })

  it('최다 수와 상한 2를 넘긴 수를 센다 — POINT도 기존 빌더 섹션 밖 모든 계획 제목이다', () => {
    const plan = planOf([
      titled('a', 'T1', '하루 종일 편안하게'),
      titled('b', 'T3a', '하루 종일의 가벼움', { chapter: 1 }),
      titled('c', 'T4', '하루 종일에 맞춘 구성'),
      titled('d', 'T5', '하루 종일 쓰는 법'),
      titled('e', 'T6', '이렇게 써요'),
      titled('f', 'T7', '이렇게 써요 둘'),
      titled('g', 'T8', '이렇게 써요 셋'),
    ])
    expect(dRepeatMetrics(plan).opening).toEqual({ max: 4, top: '하루 종일', over: 2 + 1 })
  })
})

describe('사진', () => {
  it('첫 화면 밖에서 대표 컷을 쓴 섹션과 같은 컷을 쓴 이웃을 센다 — 모듈 컷도 읽고 기존 빌더 섹션은 이웃을 끊는다', () => {
    const plan = planOf(
      [
        sec('main_cut', 'T1', { productImageKey: 'hero' }),
        sec('point_div:0', 'T3a', { chapter: 1, productImageKey: 'features:0' }),
        sec('detail', 'T11', { modules: [{ type: 'M11', data: { items: [{ title: 'a', description: null, imageKey: 'features:0' }] } }] }),
        sec('spec', 'T6', { productImageKey: 'hero' }),
        sec('cta', 'T8', { productImageKey: 'hero' }),
        sec('how', 'T5', { productImageKey: 'howto:0' }),
        sec('long:scenes', 'T10', { modules: [{ type: 'M10', data: { scenes: [{ imageKey: 'howto:0', caption: '' }] } }] }),
      ],
      ['main_cut', 'point_div:0', 'detail', 'spec', 'cta', 'how', 'review_kept', 'long:scenes'],
    )
    expect(dRepeatMetrics(plan).shots).toEqual({ heroBorrowed: 2, sameNeighbors: 2 })
  })

  it('픽스처 계획 B — 크기·옵션·마무리가 대표 컷을 빌려 이웃 둘이 같은 컷이다', () => {
    const m = dRepeatMetrics(designCutPlanForB() as unknown as DesigncutPlan)
    expect(m.shots).toEqual({ heroBorrowed: 3, sameNeighbors: 2 })
    expect(m.skeleton).toEqual({ max: 1, top: 'T1:scene', repeats: 0, adjacent: 0, maxOutsideTables: 1 })
    expect(m.advantages).toBe(3)
  })
})

describe('한 줄', () => {
  it('문서가 없으면 부품 칸은 -다', () => {
    const line = dRepeatLine('abcd1234', dRepeatMetrics(planOf([sec('a', 'T4'), sec('b', 'T4')])))
    expect(line).toBe('  abcd1234 섹션 2/2 | 뼈대 최다 2(T4:scene) T9 뺀 최다 2 반복 1 이웃 1 | 부품 체크 - 말풍선 - 틀 - 확대 원 - | 장점류 0 | POINT 같은 말 0 | 첫머리 최다 0(-) 넘침 0 | 대표 컷 빌림 0 같은 컷 이웃 0')
  })
})
