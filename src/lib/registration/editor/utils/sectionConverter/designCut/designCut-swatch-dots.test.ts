/**
 * 적용 C5 ③ — 옵션 칸 색 점(T1-99 D): 계획 표지(입력 견본을 옵션 칩 이름과 짝지은 값 — 모든 옵션이 짝일 때만, 옵션 칸이 없으면 없음, 칩의 이름 색은 안 씀),
 * 계약(T7의 형식 맞는 짝만), 조립(장면 모드만 — 짝 맞는 옵션 이름 앞 입력 색 점, 이름·칸 높이 그대로, 없으면 바이트 같음). LLM·DB 없음
 */

import { describe, expect, it } from 'vitest'
import type { CanvasSection } from '@/lib/registration/editor/types/canvas'
import { markSwatches } from '@/lib/registration/internalized/designcut-structure'
import type { DesigncutSection, PdpSpecSheet } from '@/lib/registration/pdp-state'
import { composeDesignCut } from './compose'
import { readDesignCut } from './contract'
import { designCutPlanForB } from './designCut.fixture'
import { swatchDotsFitAll } from './swatchDots'
import { TYPE } from './tokens'

const ART = {
  set: { floor: 'light oak floor', wall: 'warm white plaster wall', window: 'soft daylight from the left window', season: 'spring', props: ['linen cloth'] },
  background: { base: '#FFFFFF', studio: '#F5F2EF', accent: '#2B6CD9' },
  corners: 'soft',
}
const IMAGES = { hero: 'https://img.test/hero.png', features: Array.from({ length: 6 }, (_, i) => `https://img.test/f${i}.png`) }
/** 고정물 T7 칩: 카네이션(칩 이름 색 #E8A0A8)·크라프트(#C8A27A)·감사 문구·하트 — 점은 입력 색만 써야 한다 */
const PAIRS = [
  { option: '카네이션', hex: '#112233' },
  { option: '크라프트', hex: '#445566' },
]
/** 고정물 T7 칩 4개 모두와 짝 — 점은 이때만 그린다(통합 조건 ⓑ) */
const ALL_PAIRS = [...PAIRS, { option: '감사 문구', hex: '#778899' }, { option: '하트', hex: '#AABBCC' }]

type Opts = { swatches?: unknown; scene?: boolean }
const planOf = ({ swatches, scene = true }: Opts = {}) => {
  const plan = designCutPlanForB() as ReturnType<typeof designCutPlanForB> & Record<string, unknown>
  if (scene) {
    plan.layout = 2
    plan.artDirection = ART
  }
  const sections = plan.sections.map((s) => (s.template === 'T7' && swatches !== undefined ? { ...s, swatches } : s)) as typeof plan.sections
  return { ...plan, sections }
}
const compose = (opts: Opts = {}) =>
  composeDesignCut([], readDesignCut({ designcut: JSON.parse(JSON.stringify(planOf(opts))) })!, { images: IMAGES, sectionOrder: [] })
const optionOf = (out: CanvasSection[]) => out.find((s) => s.layoutId === 'designcut_T7')!
const dotsOf = (sec: CanvasSection) => sec.elements.filter((e) => /^designcut-option-swatch-/.test(e.name ?? ''))
const shapeOf = (sec: CanvasSection) =>
  JSON.stringify({ ...sec, id: '', elements: sec.elements.map((e) => ({ ...e, id: '', groupId: e.groupId ? 'g' : undefined, containerOf: e.containerOf?.length })) }).replace(
    /([a-z]+)_\d+_\d{10,}/g,
    '$1'
  )

describe('계획 표지(markSwatches)', () => {
  const chips = (labels: string[]) => [{ type: 'M8' as const, data: { chips: labels.map((label) => ({ label, color: '#E8A0A8' })) } }]
  const sections = (labels = ['데이지 화이트', '데이지 네이비', '데이지 핑크']) =>
    [
      { template: 'T1', modules: [] },
      { template: 'T7', modules: chips(labels) },
    ] as unknown as Array<Pick<DesigncutSection, 'template' | 'modules' | 'swatches'>>
  const spec = (swatches?: unknown) => ({ productName: '표본', ...(swatches !== undefined ? { swatches } : {}) }) as unknown as PdpSpecSheet
  const SW = [
    { name: '화이트', hex: '#FFFFFF' },
    { name: '네이비', hex: '#1F2A44' },
  ]

  it('입력이 없으면 같은 목록을 돌려준다(저장 문서 바이트 같음)', () => {
    const list = sections()
    expect(markSwatches(list, spec())).toBe(list)
  })

  it('모든 옵션이 짝이면 옵션 칸에만 옵션 순서·칩 이름으로 입력 색을 단다(칩 이름 색은 안 씀)', () => {
    const out = markSwatches(sections(['데이지 화이트', '데이지 네이비']), spec(SW))
    expect(out.find((s) => s.template === 'T7')?.swatches).toEqual([
      { option: '데이지 화이트', hex: '#FFFFFF' },
      { option: '데이지 네이비', hex: '#1F2A44' },
    ])
    expect(out.filter((s) => s.swatches !== undefined)).toHaveLength(1)
  })

  it('짝 없는 옵션이 하나라도 있으면 그대로 — 일부 옵션에만 점을 달지 않는다(통합 조건 ⓑ)', () => {
    const list = sections()
    expect(markSwatches(list, spec(SW))).toBe(list)
  })

  it('짝이 2개 미만이거나 옵션 칸이 없으면 그대로', () => {
    const list = sections(['데이지 화이트', '데이지 핑크'])
    expect(markSwatches(list, spec(SW))).toBe(list)
    const noOption = [{ template: 'T1', modules: [] }] as unknown as Array<Pick<DesigncutSection, 'template' | 'modules'>>
    expect(markSwatches(noOption, spec(SW))).toBe(noOption)
  })
})

describe('계약(readDesignCut) — T7의 형식 맞는 짝만', () => {
  const t7Of = (swatches: unknown) => readDesignCut({ designcut: JSON.parse(JSON.stringify(planOf({ swatches }))) })!.sections.find((s) => s.template === 'T7')!
  it('2개 이상이고 짝마다 이름·#RRGGBB가 있으면 둔다, 아니면 칸이 없다', () => {
    expect(t7Of(PAIRS).swatches).toEqual(PAIRS)
    expect(t7Of(PAIRS.slice(0, 1)).swatches).toBeUndefined()
    expect(t7Of([PAIRS[0], { option: '크라프트', hex: 'brown' }]).swatches).toBeUndefined()
    expect(t7Of('카네이션 #112233').swatches).toBeUndefined()
  })
})

describe('조립 — 옵션 이름 앞 색 점', () => {
  it('장면 모드이고 모든 옵션이 짝이면 옵션 이름 앞마다 입력 색 점을 그리고 이름·칸 높이는 그대로다', () => {
    const base = optionOf(compose())
    const sec = optionOf(compose({ swatches: ALL_PAIRS }))
    const dots = dotsOf(sec)
    expect(dots.map((e) => e.shapeProps?.fill)).toEqual(['#112233', '#445566', '#778899', '#AABBCC'])
    expect(dots.every((e) => Boolean(e.shapeProps?.stroke))).toBe(true)
    expect(sec.canvas.height).toBe(base.canvas.height)
    const labelsOf = (s: CanvasSection) => s.elements.filter((e) => /^designcut-option-label-name-\d+$/.test(e.name ?? '')).map((e) => [e.textProps?.content, e.transform])
    expect(labelsOf(sec)).toEqual(labelsOf(base))
    // 점은 제 이름 글 왼쪽, 같은 칸 안
    for (const dot of dots) {
      const cell = sec.elements.find((e) => e.containerOf?.includes(dot.id))
      expect(cell).toBeDefined()
      expect(dot.transform.x).toBeGreaterThanOrEqual(cell!.transform.x)
    }
  })

  it('짝이 없거나 일부 옵션만 짝이거나 장면 모드가 아니면 지금 그리기와 같다(일부 옵션에만 점을 두지 않는다)', () => {
    expect(shapeOf(optionOf(compose({ swatches: undefined })))).toBe(shapeOf(optionOf(compose())))
    expect(shapeOf(optionOf(compose({ swatches: PAIRS })))).toBe(shapeOf(optionOf(compose())))
    expect(shapeOf(optionOf(compose({ swatches: ALL_PAIRS, scene: false })))).toBe(shapeOf(optionOf(compose({ scene: false }))))
  })

  it('이름 하나라도 한 줄에 안 들면 옵션 칸 전체에 점을 그리지 않는다', () => {
    const labels = ALL_PAIRS.map((p) => p.option)
    expect(swatchDotsFitAll(ALL_PAIRS, labels, TYPE.LABEL, 380)).toBe(true)
    const long = '아주 길어서 한 줄 칸 폭 안에 다 들지 않는 옵션 이름 하나'
    expect(swatchDotsFitAll([...ALL_PAIRS, { option: long, hex: '#010203' }], [...labels, long], TYPE.LABEL, 380)).toBe(false)
    expect(swatchDotsFitAll(ALL_PAIRS, [...labels, '짝 없는 옵션'], TYPE.LABEL, 380)).toBe(false)
  })
})
