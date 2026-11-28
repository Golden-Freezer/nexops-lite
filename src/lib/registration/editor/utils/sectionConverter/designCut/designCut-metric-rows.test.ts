/**
 * 적용 D6 P7 — 사이즈 칸 수치 줄(T1-63·T2-22): 조건 경계(이름 한 줄·12자·이름 칸 240, 값이 480에 장면 H2 한 줄, 1~3줄), 계획 표지(입력 칸
 * productMetrics만 — 크기 글의 이름 붙은 값은 쓰지 않음, 앞 3줄, 하나라도 안 맞으면 없음, D2만), 계약(T6의 형식 맞는 줄만), 조립(장면 모드만 —
 * 캡션 아래 이름 왼쪽 표 이름 한 묶음·값 오른쪽 큰 숫자, 없으면 바이트 같음), 모바일 검사 규칙별 위반 수, 리플로우. LLM·DB 없음
 */

import { describe, expect, it } from 'vitest'
import type { CanvasSection } from '@/lib/registration/editor/types/canvas'
import { TABLE_NAME_ELEMENT, checkMobileReadability } from '@/lib/registration/editor/utils/mobileReadability'
import { reflowSectionLayout } from '@/lib/registration/editor/utils/reflowSectionLayout'
import { INPUT_SLOT_SAMPLE } from '@/lib/registration/__fixtures__/input-slots.sample'
import { TRACK_I_KEYS, fixtureToJob, loadEnrichmentFixture, type FixtureKey } from '@/lib/registration/__golden__/golden-harness'
import type { ProductMetric } from '@/lib/registration/input-slots'
import { buildDesigncutPlan } from '@/lib/registration/internalized/designcut-plan'
import { markMetricRows } from '@/lib/registration/internalized/designcut-structure'
import { applyDesignSkeleton, resolveDesignSkeleton } from '@/lib/registration/pdp-enrichment-stage'
import type { DesigncutTemplate, PdpJobRow, PdpSpecSheet } from '@/lib/registration/pdp-state'
import { mergeManualStrategy } from '@/lib/registration/pdp-strategy-contract'
import { composeDesignCut } from './compose'
import { readDesignCut } from './contract'
import { designCutPlanForB } from './designCut.fixture'
import { INFO_NAME_W, INFO_VALUE_W } from './infoRows'
import { METRIC_ROWS_MAX, fitsMetricRows, metricRowsOf, type MetricRow } from './metricRows'
import { MARGIN, SCENE_TYPE } from './tokens'

const ART = {
  set: { floor: 'light oak floor', wall: 'warm white plaster wall', window: 'soft daylight from the left window', season: 'spring', props: ['linen cloth'] },
  background: { base: '#FFFFFF', studio: '#F5F2EF', accent: '#2B6CD9' },
  corners: 'soft',
}
const IMAGES = { hero: 'https://img.test/hero.png', features: Array.from({ length: 6 }, (_, i) => `https://img.test/f${i}.png`) }
const ROWS: MetricRow[] = [
  { name: '한 장 지름', value: '50mm' },
  { name: '두께', value: '0.2mm' },
  { name: '무게', value: '3g' },
]
const metric = (name: string, value: string, unit: string): ProductMetric => ({ name, value, unit })

type Opts = { rows?: unknown; scene?: boolean; template?: DesigncutTemplate }
/** 고정물 계획(사이즈 칸 spec_table T6) — rows면 그 칸에 metricRows를 단다. 장면 모드(layout 2)면 아트 디렉션을 준다 */
const planOf = ({ rows, scene = true }: Opts = {}) => {
  const plan = designCutPlanForB() as ReturnType<typeof designCutPlanForB> & Record<string, unknown>
  if (scene) {
    plan.layout = 2
    plan.artDirection = ART
  }
  const sections = plan.sections.map((s) => (s.key === 'spec_table' && rows !== undefined ? { ...s, metricRows: rows } : s)) as typeof plan.sections
  return { ...plan, sections }
}
const compose = (opts: Opts = {}) =>
  composeDesignCut([], readDesignCut({ designcut: JSON.parse(JSON.stringify(planOf(opts))) })!, { images: IMAGES, sectionOrder: [] })
const sizeOf = (out: CanvasSection[]) => out.find((s) => s.layoutId === 'designcut_T6')!
const named = (sec: CanvasSection, name: string | RegExp) => sec.elements.filter((e) => (typeof name === 'string' ? e.name === name : name.test(e.name ?? '')))
const bottomOf = (e: { transform: { y: number; height: number } }) => e.transform.y + e.transform.height
/** id(무작위)를 뺀 섹션 — 같은 그리기인지 비교 */
const shapeOf = (sec: CanvasSection) =>
  JSON.stringify({ ...sec, id: '', elements: sec.elements.map((e) => ({ ...e, id: '', groupId: e.groupId ? 'g' : undefined, containerOf: e.containerOf?.length })) }).replace(
    /([a-z]+)_\d+_\d{10,}/g,
    '$1'
  )

describe('수치 줄 조건(fitsMetricRows) — 경계', () => {
  const one = (name: string, value = '10cm') => [{ name, value }]
  it('이름은 한 줄·12자 이하이고 이름 칸 240에 LABEL 32 한 줄 — 한글 7자는 들고 8자는 안 든다', () => {
    expect(fitsMetricRows(one('가'.repeat(7)))).toBe(true)
    expect(fitsMetricRows(one('가'.repeat(8)))).toBe(false)
    expect(fitsMetricRows(one('abcdefghijkl'))).toBe(true)
    expect(fitsMetricRows(one('abcdefghijklm'))).toBe(false)
    expect(fitsMetricRows(one('한 장\n지름'))).toBe(false)
    expect(fitsMetricRows(one('  '))).toBe(false)
  })

  it('값은 줄바꿈 없이 값 칸 480에 장면 H2 74 한 줄 — 숫자 7자+cm(436)는 들고 8자+cm(486)는 안 든다', () => {
    expect(fitsMetricRows(one('길이', '1234567cm'))).toBe(true)
    expect(fitsMetricRows(one('길이', '12345678cm'))).toBe(false)
    expect(fitsMetricRows(one('길이', '10\ncm'))).toBe(false)
    expect(fitsMetricRows(one('길이', ' '))).toBe(false)
  })

  it('1~3줄만 — 없거나 4줄이면 아니다. 한 줄이라도 안 맞으면 전체가 아니다', () => {
    expect(METRIC_ROWS_MAX).toBe(3)
    expect(fitsMetricRows(ROWS)).toBe(true)
    expect(fitsMetricRows([])).toBe(false)
    expect(fitsMetricRows([...ROWS, { name: '높이', value: '1cm' }])).toBe(false)
    expect(fitsMetricRows([ROWS[0], { name: '가'.repeat(8), value: '1cm' }])).toBe(false)
  })

  it('입력 수치 → 줄: 입력 순서대로 앞 3개, 값과 단위는 한 칸', () => {
    const metrics = [metric('길이', '7.3', 'cm'), metric('굵기', '3.2', 'cm'), metric('무게', '40', 'g'), metric('높이', '2', 'cm')]
    expect(metricRowsOf(metrics)).toEqual([
      { name: '길이', value: '7.3cm' },
      { name: '굵기', value: '3.2cm' },
      { name: '무게', value: '40g' },
    ])
  })
})

describe('계획 표지(markMetricRows)', () => {
  const page = () => [
    { key: 'hero', template: 'T1' as DesigncutTemplate },
    { key: 'spec_table', template: 'T6' as DesigncutTemplate },
  ]
  const spec = (extra: Partial<PdpSpecSheet>) => ({ productName: '시험 상품', ...extra }) as PdpSpecSheet
  const marked = (extra: Partial<PdpSpecSheet>) => markMetricRows(page(), spec(extra)).find((s) => s.template === 'T6') as { metricRows?: MetricRow[] }

  it('입력 칸 수치가 있으면 사이즈 칸에만 앞 3줄을 단다(표본 값 2줄)', () => {
    const out = markMetricRows(page(), spec({ productMetrics: INPUT_SLOT_SAMPLE.productMetrics }))
    expect(out.find((s) => s.template === 'T6')).toMatchObject({ metricRows: [{ name: '표본길이', value: '10cm' }, { name: '표본무게', value: '200g' }] })
    expect(out.filter((s) => 'metricRows' in s).map((s) => s.key)).toEqual(['spec_table'])
    const four = [metric('길이', '7.3', 'cm'), metric('굵기', '3.2', 'cm'), metric('무게', '40', 'g'), metric('가'.repeat(8), '2', 'cm')]
    expect(marked({ productMetrics: four }).metricRows?.map((r) => r.name)).toEqual(['길이', '굵기', '무게'])
  })

  it('입력 칸이 없으면 그대로 — 크기 글의 이름 붙은 값(사이즈 캡션·상품 정보 표에 이미 있음)은 쓰지 않는다', () => {
    const sections = page()
    expect(markMetricRows(sections, spec({ size: '길이 7.3cm 굵기 3.2cm' }))).toBe(sections)
    expect(markMetricRows(sections, spec({ productMetrics: [] }))).toBe(sections)
    expect(markMetricRows(sections, spec({ productMetrics: [{ name: '길이', value: '약 7', unit: 'cm' }] }))).toBe(sections)
  })

  it('앞 3줄 중 하나라도 칸에 안 들면 그대로, 사이즈 칸이 없어도 그대로', () => {
    const sections = page()
    expect(markMetricRows(sections, spec({ productMetrics: [metric('길이', '7.3', 'cm'), metric('가'.repeat(8), '2', 'cm')] }))).toBe(sections)
    expect(markMetricRows(sections, spec({ productMetrics: [metric('길이', '12345678', 'cm')] }))).toBe(sections)
    const noSize = [page()[0]]
    expect(markMetricRows(noSize, spec({ productMetrics: INPUT_SLOT_SAMPLE.productMetrics }))).toBe(noSize)
  })

  it('규제 표현이 든 수치는 입력 칸 읽기(inputSlotsOf)에서 빠진다', () => {
    const rows = marked({ productMetrics: [metric('항균력', '99.9', '%'), metric('길이', '7.3', 'cm')] }).metricRows
    expect(rows?.map((r) => r.name)).toEqual(['길이'])
  })
})

describe('계획(buildDesigncutPlan) — 골든 잡', () => {
  const ON = ['vocab', 'persuasion', 'layouts', 'shots', 'annotations', 'mobile', 'options', 'designcut']
  const D2 = [...ON, 'designcut2', 'designlayout']
  const planFor = (key: FixtureKey, features: string[], metrics?: ProductMetric[]) => {
    const j = fixtureToJob(loadEnrichmentFixture(key))
    j.analysis = { ...j.analysis, enrichment: { version: 1, features } } as PdpJobRow['analysis']
    if (metrics) j.spec_sheet = { ...j.spec_sheet, productMetrics: metrics }
    const strategy = mergeManualStrategy(j.analysis.recommended_strategy_contract ?? {}, j.spec_sheet, [])
    j.section_plan = applyDesignSkeleton(j.section_plan, resolveDesignSkeleton(j, strategy))
    return buildDesigncutPlan(j)!
  }

  it('D2 잡은 입력 수치가 있을 때만 사이즈 칸에 줄, 없으면 계획 바이트 같음 — D2가 아니면 칸 없음', () => {
    let sized = 0
    for (const key of TRACK_I_KEYS) {
      const plain = planFor(key, D2)
      expect(plain.sections.some((s) => s.metricRows), key).toBe(false)
      const withInput = planFor(key, D2, INPUT_SLOT_SAMPLE.productMetrics)
      const t6 = withInput.sections.filter((s) => s.template === 'T6')
      if (t6.length) sized++
      expect(withInput.sections.filter((s) => s.metricRows).map((s) => s.template), key).toEqual(t6.map(() => 'T6'))
      // 입력 칸은 계획의 다른 곳을 바꾸지 않는다
      const drop = (p: typeof plain) => JSON.stringify(p, (k, v) => (k === 'metricRows' ? undefined : v))
      expect(drop(withInput), key).toBe(drop(plain))
      expect(planFor(key, ON, INPUT_SLOT_SAMPLE.productMetrics).sections.some((s) => s.metricRows), key).toBe(false)
    }
    expect(sized).toBeGreaterThan(0)
  })
})

describe('계약', () => {
  const sizeSection = (rows: unknown) => readDesignCut({ designcut: JSON.parse(JSON.stringify(planOf({ rows }))) })!.sections.find((s) => s.key === 'spec_table')!
  it('사이즈 칸(T6)의 형식 맞는 1~3줄만 읽는다 — 다른 값·다른 칸은 칸을 두지 않는다', () => {
    expect(sizeSection(ROWS).metricRows).toEqual(ROWS)
    for (const bad of [[], [...ROWS, { name: '높이', value: '1cm' }], [{ name: '길이' }], [ROWS[0], { name: '높이' }], [{ name: '', value: '1cm' }], 'rows', { 0: ROWS[0] }])
      expect(sizeSection(bad), JSON.stringify(bad)).not.toHaveProperty('metricRows')
    const plan = planOf()
    Object.assign(plan.sections.find((s) => s.template === 'T1')!, { metricRows: ROWS })
    expect(readDesignCut({ designcut: JSON.parse(JSON.stringify(plan)) })!.sections.find((s) => s.template === 'T1')).not.toHaveProperty('metricRows')
  })
})

describe('조립 — 사이즈 칸 수치 줄', () => {
  it('캡션 아래 위 구분선, 이름은 왼쪽 240 표 이름(한 묶음)·값은 오른쪽 480 장면 H2, 이름은 큰 숫자 가운데 높이, 행마다 투명 행 상자', () => {
    const base = sizeOf(compose())
    const sec = sizeOf(compose({ rows: ROWS }))
    const caption = named(sec, 'designcut-dim-caption')[0]
    const top = named(sec, 'designcut-metric-rule-top')[0]
    expect(top.transform.y).toBe(bottomOf(caption) + 48)
    const names = named(sec, TABLE_NAME_ELEMENT)
    const values = named(sec, /^designcut-metric-value-\d+$/)
    // 글자 빌더는 짧은 낱말 뒤 공백을 줄바꿈 없는 공백(U+00A0)으로 바꾼다 — 글은 같다
    const textOf = (e: (typeof names)[number]) => String(e.textProps?.content).replace(/ /g, ' ')
    expect(names.map(textOf)).toEqual(ROWS.map((r) => r.name))
    expect(values.map(textOf)).toEqual(ROWS.map((r) => r.value))
    expect(new Set(names.map((e) => e.groupId)).size).toBe(1)
    expect(names[0].groupId).toBeTruthy()
    names.forEach((name, i) => {
      const value = values[i]
      expect(name.transform).toMatchObject({ x: MARGIN, width: INFO_NAME_W })
      expect(value.transform).toMatchObject({ x: MARGIN + INFO_NAME_W + 20, width: INFO_VALUE_W })
      expect([name.textProps?.fontSize, value.textProps?.fontSize]).toEqual([32, SCENE_TYPE.H2.size])
      expect(name.transform.y - value.transform.y).toBe(Math.round((Math.ceil(74 * 1.45) - Math.ceil(32 * 1.2)) / 2))
      const box = sec.elements.find((e) => e.containerOf?.includes(name.id))!
      expect(box.name).toBe('designcut-row')
      expect(box.shapeProps?.fill).toBe('transparent')
      expect(box.containerOf).toEqual([name.id, value.id])
      expect(named(sec, `designcut-metric-rule-${i}`)[0].transform.y).toBe(Math.max(bottomOf(name), bottomOf(value)) + 32)
    })
    // 캡션까지는 지금 그리기 그대로이고 줄만큼 섹션이 길어진다
    const prefix = (s: CanvasSection) => shapeOf({ ...s, canvas: { ...s.canvas, height: 0 }, elements: s.elements.filter((e) => !/^designcut-(metric|row)/.test(e.name ?? '') && e.name !== TABLE_NAME_ELEMENT) })
    expect(prefix(sec)).toBe(prefix(base))
    // 마지막 구분선 아래 여백은 지금 캡션 아래 여백과 같다
    const last = named(sec, `designcut-metric-rule-${ROWS.length - 1}`)[0]
    const baseCaption = named(base, 'designcut-dim-caption')[0]
    expect(sec.canvas.height - bottomOf(last)).toBe(base.canvas.height - bottomOf(baseCaption))
    expect(sec.canvas.height).toBeGreaterThan(base.canvas.height)
  })

  it('칸이 없거나·장면 모드가 아니거나·줄이 칸에 안 들면 지금 사이즈 칸 그대로(바이트 같음)', () => {
    expect(named(sizeOf(compose()), /^designcut-metric-/)).toEqual([])
    expect(shapeOf(sizeOf(compose({ rows: ROWS, scene: false })))).toBe(shapeOf(sizeOf(compose({ scene: false }))))
    expect(shapeOf(sizeOf(compose({ rows: [{ name: '가'.repeat(8), value: '1cm' }] })))).toBe(shapeOf(sizeOf(compose())))
    expect(shapeOf(sizeOf(compose({ rows: [{ name: '길이', value: '12345678cm' }] })))).toBe(shapeOf(sizeOf(compose())))
  })

  it('사이즈 칸 밖은 바이트 같다 — 다른 섹션 모두', () => {
    const base = compose()
    const out = compose({ rows: ROWS })
    expect(out.map((s) => s.layoutId)).toEqual(base.map((s) => s.layoutId))
    const at = out.indexOf(sizeOf(out))
    out.forEach((sec, i) => {
      if (i !== at) expect(shapeOf(sec), sec.layoutId).toBe(shapeOf(base[i]))
    })
  })
})

describe('모바일 검사 — 규칙별 위반 수가 늘지 않고 수치 줄에 위반이 없다', () => {
  it('표본 줄', () => {
    const before = checkMobileReadability({ sections: compose() }).counts
    const after = checkMobileReadability({ sections: compose({ rows: ROWS }) })
    for (const rule of ['M1', 'M2', 'M4', 'M5', 'M6', 'M7'] as const) expect(after.counts[rule], rule).toBeLessThanOrEqual(before[rule])
    expect(after.violations.filter((v) => v.element === TABLE_NAME_ELEMENT || /^designcut-metric-/.test(v.element ?? ''))).toEqual([])
  })
})

describe('리플로우', () => {
  it('실측이 같으면 높이 그대로, 값이 늘면 그 행 아래만 함께 내려가고 이름은 그대로', () => {
    const same = structuredClone(sizeOf(compose({ rows: ROWS })))
    const height = same.canvas.height
    reflowSectionLayout(same)
    expect(same.canvas.height).toBe(height)

    const grown = structuredClone(sizeOf(compose({ rows: ROWS })))
    const value = named(grown, 'designcut-metric-value-1')[0]
    const name = named(grown, TABLE_NAME_ELEMENT)[1]
    const [nameY, ruleY, nextY, firstY] = [
      name.transform.y,
      named(grown, 'designcut-metric-rule-1')[0].transform.y,
      named(grown, 'designcut-metric-value-2')[0].transform.y,
      named(grown, 'designcut-metric-value-0')[0].transform.y,
    ]
    value.measuredHeight = value.transform.height + 100
    reflowSectionLayout(grown)
    expect(name.transform.y).toBe(nameY)
    expect(named(grown, 'designcut-metric-value-0')[0].transform.y).toBe(firstY)
    expect(named(grown, 'designcut-metric-rule-1')[0].transform.y).toBe(ruleY + 100)
    expect(named(grown, 'designcut-metric-value-2')[0].transform.y).toBe(nextY + 100)
    expect(grown.canvas.height).toBe(height + 100)
  })
})
