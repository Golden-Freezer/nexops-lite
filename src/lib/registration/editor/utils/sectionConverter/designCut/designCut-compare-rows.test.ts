/**
 * 적용 C5 ② R-D2 D — 기존 제품과 비교 줄(상품 정보 표 T9 long:info 아래): 조건 경계(이름 한 줄·12자·240, 값 줄 '우리 …'·'기존 …' 40자·480 폭),
 * 계획 표지(입력 없으면 그대로·거른 행만·상품 정보 표에만), 계약(T9 long:info만), 조립(장면 모드만 — 표 아래에 덧붙이고 표 요소는 그대로, 기존이 비면 줄표,
 * 출처 줄), 없으면 바이트 같음, 모바일 판독. LLM·DB 없음
 */

import { describe, expect, it } from 'vitest'
import type { CanvasSection } from '@/lib/registration/editor/types/canvas'
import { TABLE_NAME_ELEMENT, checkMobileReadability } from '@/lib/registration/editor/utils/mobileReadability'
import { markInputDevices } from '@/lib/registration/internalized/designcut-structure'
import type { DesigncutTemplate, PdpSpecSheet } from '@/lib/registration/pdp-state'
import { COMPARE_LABEL, COMPARE_NEUTRAL, fitsCompareRows, type DesigncutCompare } from './compareRows'
import { composeDesignCut } from './compose'
import { readDesignCut } from './contract'
import { designCutPlanForB } from './designCut.fixture'
import { INFO_NAME_W, INFO_COL_GAP } from './infoRows'
import { MARGIN } from './tokens'

const ART = {
  set: { floor: 'light oak floor', wall: 'warm white plaster wall', window: 'soft daylight from the left window', season: 'spring', props: ['linen cloth'] },
  background: { base: '#FFFFFF', studio: '#F5F2EF', accent: '#2B6CD9' },
  corners: 'soft',
}
const IMAGES = { hero: 'https://img.test/hero.png', features: Array.from({ length: 6 }, (_, i) => `https://img.test/f${i}.png`) }
const INFO_ROWS = [
  { label: '상품명', value: '감사 스티커 50매 카네이션' },
  { label: '소재', value: '아트지 유광 코팅' },
  { label: '제조국', value: '대한민국' },
]
const COMPARE: DesigncutCompare = {
  rows: [
    { label: '용량', ours: '500ml', other: '350ml' },
    { label: '세척', ours: '분리 세척' },
  ],
  source: '자사 측정 2026년 10월',
}
const t9 = (key: string, extra: Record<string, unknown> = {}) => ({
  key,
  role: 'long_expansion',
  template: 'T9',
  bg: 'W',
  chapter: null,
  plateKey: null,
  plateAspect: null,
  productImageKey: null,
  productAlpha: false,
  text: { eyebrow: '상품 정보', headline: '한눈에 보는 상품 정보', sub: null },
  modules: [{ type: 'M9', data: { rows: INFO_ROWS } }],
  ...extra,
})

type Opts = { scene?: boolean; compare?: unknown; key?: string }
const planOf = ({ scene = true, compare, key = 'long:info' }: Opts = {}) => {
  const plan = designCutPlanForB() as ReturnType<typeof designCutPlanForB> & Record<string, unknown>
  if (scene) {
    plan.layout = 2
    plan.artDirection = ART
  }
  const info = t9(key, compare !== undefined ? { compare } : {})
  const sections = [...plan.sections, info] as unknown as typeof plan.sections
  const order = [...plan.order]
  order.splice(order.indexOf('spec_table') + 1, 0, key)
  return { ...plan, sections, order }
}
const compose = (opts: Opts = {}) => composeDesignCut([], readDesignCut({ designcut: JSON.parse(JSON.stringify(planOf(opts))) })!, { images: IMAGES, sectionOrder: [] })
const infoOf = (out: CanvasSection[]) => out.find((s) => s.layoutId === 'designcut_T9' && s.elements.some((e) => e.textProps?.content === '대한민국'))!
const named = (sec: CanvasSection, name: RegExp) => sec.elements.filter((e) => name.test(e.name ?? ''))
const textOf = (e: CanvasSection['elements'][number]) => String(e.textProps?.content).replace(/ /g, ' ')
const shapeOf = (sec: CanvasSection) =>
  JSON.stringify({ ...sec, id: '', elements: sec.elements.map((e) => ({ ...e, id: '', groupId: e.groupId ? 'g' : undefined, containerOf: e.containerOf?.length })) }).replace(
    /([a-z]+)_\d+_\d{10,}/g,
    '$1'
  )
const spec = (extra: Partial<PdpSpecSheet>) => ({ productName: '시험 상품', ...extra }) as PdpSpecSheet

describe('비교 줄 조건(fitsCompareRows) — 경계', () => {
  it('이름은 한 줄·12자·이름 칸 240, 값 줄은 앞말(우리·기존) 포함 40자·낱말마다 480 폭 — 하나라도 넘으면 블록 전체를 안 그린다', () => {
    expect(fitsCompareRows(COMPARE)).toBe(true)
    expect(fitsCompareRows({ rows: [] })).toBe(false)
    expect(fitsCompareRows({ rows: [{ label: '열세글자가넘는아주긴항목이름', ours: '있음' }] })).toBe(false)
    // '우리 ' 3자 + 38자 = 41자 → 넘침, 37자 = 40자 → 듦
    const words = (n: number) => Array.from({ length: n }, (_, i) => (i % 3 === 2 ? ' ' : '가')).join('')
    expect(fitsCompareRows({ rows: [{ label: '항목', ours: words(37) }] })).toBe(true)
    expect(fitsCompareRows({ rows: [{ label: '항목', ours: words(38) }] })).toBe(false)
  })
})

describe('계획 표지(markInputDevices) — 비교 줄', () => {
  const sections = [
    { key: 'long:faq', template: 'T9' as DesigncutTemplate },
    { key: 'long:info', template: 'T9' as DesigncutTemplate },
    { key: 'cta', template: 'T8' as DesigncutTemplate },
  ]
  it('입력이 없으면 같은 배열을 돌려준다', () => {
    expect(markInputDevices(sections, spec({}))).toBe(sections)
  })
  it('상품 정보 표(long:info)에만 거른 행·출처를 단다 — 질문 표(long:faq)는 그대로', () => {
    const out = markInputDevices(sections, spec({ compareBasis: COMPARE.rows, compareSource: COMPARE.source }))
    expect((out[1] as { compare?: unknown }).compare).toEqual(COMPARE)
    expect(out[0]).toBe(sections[0])
    expect(out[2]).toBe(sections[2])
  })
  it('깎아내리는 행·타사 표식 행은 빼고 남은 행만, 다 빠지거나 하나라도 칸에 안 들거나 상품 정보 표가 없으면 칸이 없다', () => {
    const mixed = markInputDevices(sections, spec({ compareBasis: [...COMPARE.rows, { label: '내구', ours: '튼튼함', other: '쉽게 망가짐' }] }))
    expect((mixed[1] as { compare?: DesigncutCompare }).compare?.rows).toEqual(COMPARE.rows)
    expect(markInputDevices(sections, spec({ compareBasis: [{ label: '비교', ours: '가벼움', other: '타사 제품' }] }))).toBe(sections)
    expect(markInputDevices(sections, spec({ compareBasis: [{ label: '열세글자가넘는아주긴항목이름', ours: '있음' }] }))).toBe(sections)
    // 입력 정리(값 24자)는 지나지만 띄어쓰기 없는 낱말이 값 칸 480에 안 드는 행 — 계획이 칸을 달지 않는다(그리는 쪽과 같은 fitsCompareRows)
    expect(markInputDevices(sections, spec({ compareBasis: [COMPARE.rows[0], { label: '구성', ours: '가나다라마바사아자차카타파하가나다라' }] }))).toBe(sections)
    const noInfo = sections.filter((s) => s.key !== 'long:info')
    expect(markInputDevices(noInfo, spec({ compareBasis: COMPARE.rows }))).toBe(noInfo)
  })
})

describe('계약 — 비교 줄은 T9 long:info만', () => {
  it('long:info의 1~5행만 읽고, 다른 표·형식이 틀린 칸은 버린다', () => {
    const read = (opts: Opts) => readDesignCut({ designcut: JSON.parse(JSON.stringify(planOf(opts))) })!.sections.find((s) => s.template === 'T9')!
    expect(read({ compare: COMPARE }).compare).toEqual(COMPARE)
    expect(read({ compare: COMPARE, key: 'long:faq' }).compare).toBeUndefined()
    expect(read({ compare: { rows: [{ label: '용량' }] } }).compare).toBeUndefined()
    expect(read({ compare: { rows: Array.from({ length: 6 }, () => ({ label: '용량', ours: '500ml' })) } }).compare).toBeUndefined()
  })
})

describe('조립 — 상품 정보 표 아래 비교 줄', () => {
  it('표 요소는 그대로 두고 아래에 머리·줄(이름 왼쪽, 우리·기존 두 줄, 기존이 비면 줄표)·출처를 덧붙인다', () => {
    const base = infoOf(compose())
    const sec = infoOf(compose({ compare: COMPARE }))
    expect(sec.elements.slice(0, base.elements.length).map((e) => ({ ...e, id: '', groupId: undefined }))).toEqual(base.elements.map((e) => ({ ...e, id: '', groupId: undefined })))
    expect(sec.canvas.height).toBeGreaterThan(base.canvas.height)
    const label = named(sec, /^designcut-compare-label$/)
    expect(label.map(textOf)).toEqual([COMPARE_LABEL])
    expect(label[0].transform.y).toBeGreaterThanOrEqual(Math.max(...base.elements.map((e) => e.transform.y + e.transform.height)))
    expect(named(sec, /^designcut-compare-ours-/).map(textOf)).toEqual(['우리 500ml', '우리 분리 세척'])
    expect(named(sec, /^designcut-compare-other-/).map(textOf)).toEqual(['기존 350ml', `기존 ${COMPARE_NEUTRAL}`])
    for (const e of named(sec, /^designcut-compare-(ours|other)-/)) expect(e.transform.x).toBe(MARGIN + INFO_NAME_W + INFO_COL_GAP)
    const names = sec.elements.filter((e) => e.name === TABLE_NAME_ELEMENT && ['용량', '세척'].includes(textOf(e)))
    expect(names.map((e) => e.transform.x)).toEqual([MARGIN, MARGIN])
    expect(new Set(names.map((e) => e.groupId)).size).toBe(1)
    expect(named(sec, /^designcut-compare-source$/).map(textOf)).toEqual(['출처: 자사 측정 2026년 10월'])
  })

  it('칸이 없거나·장면 모드가 아니거나·칸에 안 들면 지금 표 그대로(바이트 같음), 다른 섹션은 모두 같다', () => {
    const base = compose()
    const withCompare = compose({ compare: COMPARE })
    expect(withCompare.filter((s) => s !== infoOf(withCompare)).map(shapeOf)).toEqual(base.filter((s) => s !== infoOf(base)).map(shapeOf))
    expect(shapeOf(infoOf(compose({ compare: { rows: [{ label: '열세글자가넘는아주긴항목이름', ours: '있음' }] } })))).toBe(shapeOf(infoOf(base)))
    const flat = compose({ scene: false })
    expect(compose({ scene: false, compare: COMPARE }).map(shapeOf)).toEqual(flat.map(shapeOf))
  })
})

describe('모바일 검사 — 규칙별 위반 수가 늘지 않고 비교 줄 요소에 위반이 없다', () => {
  it('비교 줄', () => {
    const before = checkMobileReadability({ sections: compose() }).counts
    const after = checkMobileReadability({ sections: compose({ compare: COMPARE }) })
    for (const rule of ['M1', 'M2', 'M4', 'M5', 'M6', 'M7'] as const) expect(after.counts[rule], rule).toBeLessThanOrEqual(before[rule])
    expect(after.violations.filter((v) => /^designcut-compare/.test(v.element ?? ''))).toEqual([])
  })
})
