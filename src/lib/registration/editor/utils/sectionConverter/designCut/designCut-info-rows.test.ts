/**
 * 적용 D6 P6 — 상품 정보 좌우 줄 표(T1-64·T2-26)와 짙은 머리 띠(T2-27): 조건 경계(이름 한 줄·12자·이름 칸 240, 값 40자), 계획 표지(long:info만,
 * 앞에 질문·주의 보관 표가 있으면 띠), 계약(T9 long:info의 'rows'만), 조립(장면 모드만 — 이름 왼쪽 표 이름 한 묶음·값 오른쪽 480, 띠는 섹션 맨 위
 * 전폭 짙은 면), 띠 없는 조건(놀이형 팔레트·대비 미달·짙은 바탕), 모바일 검사 규칙별 위반 수, 리플로우. LLM·DB 없음
 */

import { describe, expect, it } from 'vitest'
import type { CanvasElement, CanvasSection } from '@/lib/registration/editor/types/canvas'
import { TABLE_NAME_ELEMENT, checkMobileReadability, contrastRatio, parseColor } from '@/lib/registration/editor/utils/mobileReadability'
import { reflowSectionLayout } from '@/lib/registration/editor/utils/reflowSectionLayout'
import { TRACK_I_KEYS, fixtureToJob, loadEnrichmentFixture, type FixtureKey } from '@/lib/registration/__golden__/golden-harness'
import { applyDesignSkeleton, resolveDesignSkeleton } from '@/lib/registration/pdp-enrichment-stage'
import { mergeManualStrategy } from '@/lib/registration/pdp-strategy-contract'
import { buildDesigncutPlan } from '@/lib/registration/internalized/designcut-plan'
import { buildPalette2 } from '@/lib/registration/internalized/art-palette'
import { markInfoTable } from '@/lib/registration/internalized/designcut-structure'
import type { DesigncutPalette2, DesigncutTemplate, PdpJobRow } from '@/lib/registration/pdp-state'
import { composeDesignCut } from './compose'
import { readDesignCut } from './contract'
import { designCutPlanForB } from './designCut.fixture'
import { INFO_BAND_NAME, INFO_NAME_W, INFO_VALUE_W, buildInfoRows, fitsInfoRows } from './infoRows'
import type { CutContext } from './templatesScene'
import { MARGIN, SCENE_TYPE, W } from './tokens'

const ART = {
  set: { floor: 'light oak floor', wall: 'warm white plaster wall', window: 'soft daylight from the left window', season: 'spring', props: ['linen cloth'] },
  background: { base: '#FFFFFF', studio: '#F5F2EF', accent: '#2B6CD9' },
  corners: 'soft',
}
const IMAGES = { hero: 'https://img.test/hero.png', features: Array.from({ length: 6 }, (_, i) => `https://img.test/f${i}.png`) }

/** 상품 정보 표 행(R17-L처럼 이름 5자 이하·값 26자 이하) */
const INFO_ROWS = [
  { label: '상품명', value: '감사 스티커 50매 카네이션' },
  { label: '구성', value: '원형 스티커 50매 · 한 장 5×5cm' },
  { label: '소재', value: '아트지 유광 코팅' },
  { label: '제조국', value: '대한민국' },
  { label: '사용 연령', value: '전 연령' },
]
const FAQ_ROWS = [{ label: 'Q. 떼어낼 때 자국이 남나요?', value: 'A. 떼어낼 때 자국이 거의 남지 않는 점착제를 썼어요. 종이 포장지에도 깔끔해요.' }]

const t9 = (key: string, rows: Array<{ label: string; value: string }>, extra: Record<string, unknown> = {}) => ({
  key,
  role: 'long_expansion',
  template: 'T9',
  bg: 'W',
  chapter: null,
  plateKey: null,
  plateAspect: null,
  productImageKey: null,
  productAlpha: false,
  text: { eyebrow: key === 'long:info' ? '상품 정보' : '구매 전 질문', headline: key === 'long:info' ? '한눈에 보는 상품 정보' : '자주 묻는 질문', sub: null },
  modules: [{ type: 'M9', data: { rows } }],
  ...extra,
})

type Opts = { shape?: unknown; band?: unknown; scene?: boolean; faq?: boolean; rows?: typeof INFO_ROWS; deep?: string; palette2?: DesigncutPalette2 }
/** 고정물 계획 + 질문 표(해결 안내 뒤)·상품 정보 표(사이즈 뒤) — 장면 모드(layout 2)면 아트 디렉션을 준다 */
const planOf = ({ shape, band, scene = true, faq = true, rows = INFO_ROWS, deep, palette2 }: Opts = {}) => {
  const plan = designCutPlanForB() as ReturnType<typeof designCutPlanForB> & Record<string, unknown>
  if (scene) {
    plan.layout = 2
    plan.artDirection = { ...ART, ...(palette2 ? { palette2 } : {}) }
  }
  if (deep) plan.palette = { ...plan.palette, deep }
  const info = t9('long:info', rows, { ...(shape !== undefined ? { tableShape: shape } : {}), ...(band !== undefined ? { tableBand: band } : {}) })
  const sections = [...plan.sections, ...(faq ? [t9('long:faq', FAQ_ROWS)] : []), info] as unknown as typeof plan.sections
  const order = [...plan.order]
  if (faq) order.splice(order.indexOf('hidden_page') + 1, 0, 'long:faq')
  order.splice(order.indexOf('spec_table') + 1, 0, 'long:info')
  return { ...plan, sections, order }
}
const compose = (opts: Opts = {}) =>
  composeDesignCut([], readDesignCut({ designcut: JSON.parse(JSON.stringify(planOf(opts))) })!, { images: IMAGES, sectionOrder: [] })
const infoOf = (out: CanvasSection[]) => out.find((s) => s.layoutId === 'designcut_T9' && s.elements.some((e) => e.textProps?.content === '대한민국'))!
const named = (sec: CanvasSection, name: string | RegExp) => sec.elements.filter((e) => (typeof name === 'string' ? e.name === name : name.test(e.name ?? '')))
const one = (sec: CanvasSection, name: string) => {
  const found = named(sec, name)
  expect(found, name).toHaveLength(1)
  return found[0]
}
const bottomOf = (e: CanvasElement) => e.transform.y + e.transform.height
/** id(무작위)를 뺀 섹션 — 같은 그리기인지 비교 */
const shapeOf = (sec: CanvasSection) =>
  JSON.stringify({ ...sec, id: '', elements: sec.elements.map((e) => ({ ...e, id: '', groupId: e.groupId ? 'g' : undefined, containerOf: e.containerOf?.length })) }).replace(
    /([a-z]+)_\d+_\d{10,}/g,
    '$1'
  )
const ratio = (a: string, b: string) => contrastRatio(parseColor(a)!, parseColor(b)!)

describe('좌우 줄 조건(fitsInfoRows) — 경계', () => {
  const row = (label: string, value = '대한민국') => [{ label, value }]
  it('이름은 한 줄·12자 이하이고 이름 칸 240에 LABEL 32 한 줄로 들 때만 — 한글 7자(224)는 들고 8자(256)는 안 든다', () => {
    expect(fitsInfoRows(row('가'.repeat(7)))).toBe(true)
    expect(fitsInfoRows(row('가'.repeat(8)))).toBe(false)
    // 영문 소문자 12자는 240 안(216)·12자 이하, 13자는 글자 수에서 걸린다
    expect(fitsInfoRows(row('abcdefghijkl'))).toBe(true)
    expect(fitsInfoRows(row('abcdefghijklm'))).toBe(false)
    expect(fitsInfoRows(row('사용\n연령'))).toBe(false)
    expect(fitsInfoRows(row('  '))).toBe(false)
  })

  it('값은 비지 않고 40자 이하(공백 포함) — 40자는 들고 41자는 안 든다. 행이 없으면 아니다', () => {
    // 공백 포함 40자(낱말은 칸 안) — 5자 + 4자 × 7, 사이 공백 7
    const forty = ['가'.repeat(5), ...Array<string>(7).fill('가'.repeat(4))].join(' ')
    expect(forty).toHaveLength(40)
    expect(fitsInfoRows(row('구성', forty))).toBe(true)
    expect(fitsInfoRows(row('구성', `${forty}가`))).toBe(false)
    expect(fitsInfoRows(row('구성', '가 '.repeat(20) + '가'))).toBe(false)
    expect(fitsInfoRows(row('구성', ''))).toBe(false)
    expect(fitsInfoRows([])).toBe(false)
    expect(fitsInfoRows([...INFO_ROWS, { label: '구성', value: '가'.repeat(41) }])).toBe(false)
  })

  it('값의 낱말(공백 단위)마다 값 칸 480에 본문 52 한 줄로 든다 — 한글 9자(468)는 들고 10자(520)는 안 든다(keep-all 넘침)', () => {
    expect(fitsInfoRows(row('구성', '가'.repeat(9)))).toBe(true)
    expect(fitsInfoRows(row('구성', '가'.repeat(10)))).toBe(false)
    expect(fitsInfoRows(row('구성', `${'가'.repeat(9)} ${'가'.repeat(9)} ${'가'.repeat(9)}`))).toBe(true)
    expect(fitsInfoRows(row('구성', '슬리커 브러쉬·미세빗(대)·미세빗(소)'))).toBe(false)
  })

  it('칸 폭 — 값 칸은 본문 폭에서 이름 칸·사이를 뺀 480(M6 2열 하한 380 이상)', () => {
    expect([INFO_NAME_W, INFO_VALUE_W]).toEqual([240, 480])
  })
})

describe('계획 표지(markInfoTable)', () => {
  const s = (key: string, template: DesigncutTemplate, rows = INFO_ROWS) => ({ key, template, modules: [{ type: 'M9' as const, data: { rows } }] })
  const info = s('long:info', 'T9')
  const faq = s('long:faq', 'T9', FAQ_ROWS)
  const notice = s('long:notice', 'T9', [{ label: '주의', value: '불 가까이 두지 마세요' }])

  it('행이 모두 맞으면 상품 정보 표에만 rows, 앞에 질문·주의 보관 표가 있으면 띠도', () => {
    const page = [faq, s('spec_table', 'T6'), info]
    const out = markInfoTable(page, page.map((p) => p.key))
    expect(out.find((p) => p.key === 'long:info')).toMatchObject({ tableShape: 'rows', tableBand: true })
    expect(out.filter((p) => 'tableShape' in p).map((p) => p.key)).toEqual(['long:info'])
    const withNotice = [notice, info]
    expect(markInfoTable(withNotice, ['long:notice', 'long:info']).find((p) => p.key === 'long:info')).toMatchObject({ tableBand: true })
  })

  it('앞에 사실 표가 없거나(뒤에만 있거나, 기존 빌더 FAQ뿐이면) 띠 없이 rows만', () => {
    const alone = markInfoTable([info], ['long:info']).find((p) => p.key === 'long:info')!
    expect(alone).toMatchObject({ tableShape: 'rows' })
    expect(alone).not.toHaveProperty('tableBand')
    const after = markInfoTable([info, faq], ['long:info', 'long:faq']).find((p) => p.key === 'long:info')!
    expect(after).not.toHaveProperty('tableBand')
    const between = markInfoTable([s('spec_table', 'T6'), info, faq], ['spec_table', 'long:info', 'long:faq']).find((p) => p.key === 'long:info')!
    expect(between).toMatchObject({ tableShape: 'rows' })
    expect(between).not.toHaveProperty('tableBand')
    const keptFaq = markInfoTable([info], ['faq', 'long:info']).find((p) => p.key === 'long:info')!
    expect(keptFaq).not.toHaveProperty('tableBand')
  })

  it('행 하나라도 안 맞으면(값 41자·이름 8자) 또는 상품 정보 표가 없으면 그대로 돌려준다', () => {
    const long = [s('long:info', 'T9', [...INFO_ROWS, { label: '구성', value: '가'.repeat(41) }])]
    expect(markInfoTable(long, ['long:info'])).toBe(long)
    const wide = [s('long:info', 'T9', [{ label: '가'.repeat(8), value: '대한민국' }])]
    expect(markInfoTable(wide, ['long:info'])).toBe(wide)
    const none = [faq]
    expect(markInfoTable(none, ['long:faq'])).toBe(none)
  })
})

describe('계획(buildDesigncutPlan) — 골든 잡', () => {
  const ON = ['vocab', 'persuasion', 'layouts', 'shots', 'annotations', 'mobile', 'options', 'designcut']
  const D2 = [...ON, 'designcut2', 'designlayout']
  /** long: designlong 기록(설계 단계가 고른 사실 표 종류) — 긴 페이지 스위치(designlongEnabled)는 계획 기록의 기능 목록을 읽는다 */
  const planFor = (key: FixtureKey, features: string[], long?: string[]) => {
    const j = fixtureToJob(loadEnrichmentFixture(key))
    j.analysis = { ...j.analysis, enrichment: { version: 1, features } } as PdpJobRow['analysis']
    const strategy = mergeManualStrategy(j.analysis.recommended_strategy_contract ?? {}, j.spec_sheet, [])
    j.section_plan = applyDesignSkeleton(j.section_plan, resolveDesignSkeleton(j, strategy))
    if (long) j.section_plan = { ...j.section_plan, long: { version: 1, kinds: long, excluded: [] } } as PdpJobRow['section_plan']
    return buildDesigncutPlan(j)!
  }
  it('D2 잡은 상품 정보 표에만 rows(질문 표가 없어 띠 없음), D2가 아니면 칸 없음', () => {
    for (const key of TRACK_I_KEYS) {
      const p = planFor(key, D2)
      expect(p.sections.filter((s) => s.tableShape).map((s) => s.key), key).toEqual(['long:info'])
      expect(p.sections.some((s) => s.tableBand), key).toBe(false)
      expect(p.sections.some((s) => s.key === 'long:faq' || s.key === 'long:notice'), key).toBe(false)
      expect(planFor(key, ON).sections.some((s) => s.tableShape || s.tableBand), key).toBe(false)
    }
  })

  it('D2가 아닌 긴 페이지(designlong) 잡은 사실 표가 있어도 상품 정보 표를 짓지 않아(D2만 짓는다) 칸이 없다', () => {
    for (const key of TRACK_I_KEYS) {
      const p = planFor(key, [...ON, 'designlong'], ['size', 'care', 'faq'])
      expect(p.sections.some((s) => s.template === 'T9'), key).toBe(true)
      expect(p.sections.some((s) => s.key === 'long:info'), key).toBe(false)
      expect(p.sections.some((s) => s.tableShape || s.tableBand), key).toBe(false)
    }
  })
})

describe('계약', () => {
  const sectionOf = (opts: Opts, key = 'long:info') => readDesignCut({ designcut: JSON.parse(JSON.stringify(planOf(opts))) })!.sections.find((s) => s.key === key)!
  it("상품 정보 표의 'rows'만 읽고, 띠는 rows일 때 true만 — 다른 값·다른 표는 칸을 두지 않는다", () => {
    expect(sectionOf({ shape: 'rows', band: true })).toMatchObject({ tableShape: 'rows', tableBand: true })
    expect(sectionOf({ shape: 'rows', band: 'yes' })).not.toHaveProperty('tableBand')
    expect(sectionOf({ shape: 'grid', band: true })).not.toHaveProperty('tableShape')
    expect(sectionOf({ shape: 'grid', band: true })).not.toHaveProperty('tableBand')
    expect(sectionOf({ band: true })).not.toHaveProperty('tableBand')
    const plan = planOf()
    Object.assign(plan.sections.find((s) => s.key === 'long:faq')!, { tableShape: 'rows', tableBand: true })
    expect(readDesignCut({ designcut: JSON.parse(JSON.stringify(plan)) })!.sections.find((s) => s.key === 'long:faq')).not.toHaveProperty('tableShape')
  })
})

describe('조립 — 상품 정보 좌우 줄', () => {
  it('이름은 왼쪽 240 표 이름(한 묶음)·값은 오른쪽 480 본문, 이름은 값 첫 줄 가운데 높이, 행마다 투명 행 상자 — 쌓기 표보다 낮다', () => {
    const sec = infoOf(compose({ shape: 'rows' }))
    const names = named(sec, TABLE_NAME_ELEMENT)
    const values = named(sec, /^designcut-info-value-\d+$/)
    expect(names.map((e) => e.textProps?.content)).toEqual(INFO_ROWS.map((r) => r.label))
    expect(values).toHaveLength(INFO_ROWS.length)
    expect(new Set(names.map((e) => e.groupId)).size).toBe(1)
    expect(names[0].groupId).toBeTruthy()
    names.forEach((name, i) => {
      const value = values[i]
      expect(name.transform).toMatchObject({ x: MARGIN, width: INFO_NAME_W })
      expect(value.transform).toMatchObject({ x: MARGIN + INFO_NAME_W + 20, width: INFO_VALUE_W })
      expect([name.textProps?.fontSize, value.textProps?.fontSize]).toEqual([32, SCENE_TYPE.BODY.size])
      expect(name.transform.y - value.transform.y).toBe(25)
      const box = sec.elements.find((e) => e.containerOf?.includes(name.id))!
      expect(box.name).toBe('designcut-row')
      expect(box.shapeProps?.fill).toBe('transparent')
      expect(box.containerOf).toEqual([name.id, value.id])
      expect(one(sec, `designcut-info-rule-${i}`).transform.y).toBe(Math.max(bottomOf(name), bottomOf(value)) + 32)
    })
    expect(named(sec, /^designcut-purchase-/)).toEqual([])
    expect(named(sec, INFO_BAND_NAME)).toEqual([])
    expect(sec.needsInitialReflow).toBe(true)
    expect(sec.canvas.height).toBeLessThan(infoOf(compose()).canvas.height)
  })

  it('칸이 없거나·장면 모드가 아니거나·행이 칸에 안 들면 지금 쌓기 표 그대로(바이트 같음)', () => {
    expect(named(infoOf(compose()), /^designcut-purchase-label-\d+$/)).toHaveLength(INFO_ROWS.length)
    expect(shapeOf(infoOf(compose({ shape: 'rows', scene: false })))).toBe(shapeOf(infoOf(compose({ scene: false }))))
    const long = [...INFO_ROWS, { label: '구성', value: '가'.repeat(41) }]
    expect(shapeOf(infoOf(compose({ shape: 'rows', rows: long })))).toBe(shapeOf(infoOf(compose({ rows: long }))))
  })

  it('상품 정보 표 밖은 바이트 같다 — 다른 섹션 모두', () => {
    const base = compose()
    const out = compose({ shape: 'rows', band: true })
    expect(out.map((s) => s.layoutId)).toEqual(base.map((s) => s.layoutId))
    const infoAt = out.indexOf(infoOf(out))
    out.forEach((sec, i) => {
      if (i !== infoAt) expect(shapeOf(sec), sec.layoutId).toBe(shapeOf(base[i]))
    })
  })
})

describe('조립 — 짙은 머리 띠', () => {
  it('섹션 맨 위 전폭 짙은 면(deep), 머리는 띠 안 위·아래 64, 첫 행은 띠 아래 64 — 머리 글은 바탕 글자색(대비 4.5 이상)', () => {
    const out = compose({ shape: 'rows', band: true })
    const sec = infoOf(out)
    const band = one(sec, INFO_BAND_NAME)
    expect(band.transform).toMatchObject({ x: 0, y: 0, width: W })
    expect(band.shapeProps?.fill).toBe(designCutPlanForB().palette.deep)
    const inner = sec.elements.filter((e) => band.containerOf?.includes(e.id))
    expect(inner.length).toBeGreaterThanOrEqual(2)
    expect(Math.min(...inner.map((e) => e.transform.y))).toBe(64)
    expect(Math.max(...inner.map(bottomOf))).toBe(band.transform.height - 64)
    expect(band.zIndex).toBeLessThan(Math.min(...inner.map((e) => e.zIndex)))
    const headline = one(sec, 'designcut-headline')
    expect(ratio(headline.textProps!.color!, band.shapeProps!.fill!)).toBeGreaterThanOrEqual(4.5)
    const firstBox = named(sec, 'designcut-row')[0]
    expect(firstBox.transform.y).toBe(band.transform.height + 64)
  })

  it('띠 없음 — 칸이 없거나, 짙은 면 위 글자 대비가 4.5 미만이거나, 놀이형 팔레트(짙은 면 없음)면 지금 머리', () => {
    expect(named(infoOf(compose({ shape: 'rows' })), INFO_BAND_NAME)).toEqual([])
    expect(named(infoOf(compose({ shape: 'rows', band: true, deep: '#9A9A9A' })), INFO_BAND_NAME)).toEqual([])
    const playful = buildPalette2(
      { enrichment: { version: 1, features: [], audience: { kind: 'parent_proxy', version: 1, basis: 'name_tags', terms: ['어린이집'], ageGate: false } } } as never,
      null,
      '#D9622B',
      '#1A1A1A'
    )
    expect(playful?.tone).toBe('playful')
    const sec = infoOf(compose({ shape: 'rows', band: true, palette2: playful! }))
    expect(named(sec, INFO_BAND_NAME)).toEqual([])
    expect(named(sec, TABLE_NAME_ELEMENT)).toHaveLength(INFO_ROWS.length)
  })

  it('짙은 바탕(D) 상품 정보 표는 띠를 두지 않는다(직접 그리기)', () => {
    const plan = readDesignCut({ designcut: JSON.parse(JSON.stringify(planOf({ shape: 'rows', band: true }))) })!
    const s = plan.sections.find((x) => x.key === 'long:info')!
    const ctx = (bg: 'D' | 'W'): CutContext => ({
      section: { ...s, bg, modules: { rows: INFO_ROWS } },
      colors: { base: '#FFFFFF', accent: '#D9622B', accentText: '#A8441A', deep: '#4A2414', tint: '#FBF0E8', ink: '#1A1A1A', photo: '#F5F2EF', onDeep: '#FFFFFF', onAccent: '#1A1A1A', neutral: '#F4F4F4', heading: '#1A1A1A', highlight: false },
      radius: { capsule: 999, card: 24, bubble: 24, chip: 999 },
      image: () => null,
      scene: { band: '#FFFFFF' },
      type: SCENE_TYPE,
    })
    expect(named({ elements: buildInfoRows(ctx('W'), INFO_ROWS)!.elements } as CanvasSection, INFO_BAND_NAME)).toHaveLength(1)
    expect(named({ elements: buildInfoRows(ctx('D'), INFO_ROWS)!.elements } as CanvasSection, INFO_BAND_NAME)).toEqual([])
    expect(buildInfoRows(ctx('W'), [{ label: '구성', value: '가'.repeat(41) }])).toBeNull()
  })
})

describe('모바일 검사 — 규칙별 위반 수가 쌓기 표보다 늘지 않는다', () => {
  it.each([
    ['띠 없음', { shape: 'rows' }],
    ['띠', { shape: 'rows', band: true }],
  ] as const)('%s', (_, opts) => {
    const before = checkMobileReadability({ sections: compose() }).counts
    const after = checkMobileReadability({ sections: compose(opts) })
    for (const rule of ['M1', 'M2', 'M4', 'M5', 'M6', 'M7'] as const) expect(after.counts[rule], rule).toBeLessThanOrEqual(before[rule])
    const names = new Set([TABLE_NAME_ELEMENT, INFO_BAND_NAME, 'designcut-headline', 'designcut-eyebrow', 'designcut-eyebrow-text'])
    const info = after.violations.filter((v) => names.has(v.element ?? '') || /^designcut-info-/.test(v.element ?? ''))
    expect(info).toEqual([])
  })
})

describe('리플로우', () => {
  it('실측이 같으면 높이 그대로, 값이 한 줄 늘면 그 행 아래만 함께 내려가고 이름은 그대로, 이름이 줄면 아무것도 안 움직인다', () => {
    const same = structuredClone(infoOf(compose({ shape: 'rows' })))
    const height = same.canvas.height
    reflowSectionLayout(same)
    expect(same.canvas.height).toBe(height)

    const grown = structuredClone(infoOf(compose({ shape: 'rows' })))
    const value = one(grown, 'designcut-info-value-1')
    const name = named(grown, TABLE_NAME_ELEMENT)[1]
    const [nameY, ruleY, nextY] = [name.transform.y, one(grown, 'designcut-info-rule-1').transform.y, one(grown, 'designcut-info-value-2').transform.y]
    const valueY0 = one(grown, 'designcut-info-value-0').transform.y
    value.measuredHeight = value.transform.height + 88
    reflowSectionLayout(grown)
    expect(name.transform.y).toBe(nameY)
    expect(one(grown, 'designcut-info-value-0').transform.y).toBe(valueY0)
    expect(one(grown, 'designcut-info-rule-1').transform.y).toBe(ruleY + 88)
    expect(one(grown, 'designcut-info-value-2').transform.y).toBe(nextY + 88)
    expect(grown.canvas.height).toBe(height + 88)

    const shrunk = structuredClone(infoOf(compose({ shape: 'rows' })))
    const shortName = named(shrunk, TABLE_NAME_ELEMENT)[0]
    const rule0 = one(shrunk, 'designcut-info-rule-0').transform.y
    shortName.measuredHeight = shortName.transform.height - 10
    reflowSectionLayout(shrunk)
    expect(one(shrunk, 'designcut-info-rule-0').transform.y).toBe(rule0)
    expect(shrunk.canvas.height).toBe(height)
  })

  it('띠 머리 글이 60 늘면 띠가 60 늘고 행이 모두 60 내려간다', () => {
    const sec = structuredClone(infoOf(compose({ shape: 'rows', band: true })))
    const band = one(sec, INFO_BAND_NAME)
    const [bandH, rowY, height] = [band.transform.height, named(sec, 'designcut-row')[0].transform.y, sec.canvas.height]
    const headline = one(sec, 'designcut-headline')
    headline.measuredHeight = headline.transform.height + 60
    reflowSectionLayout(sec)
    expect(band.transform.height).toBe(bandH + 60)
    expect(named(sec, 'designcut-row')[0].transform.y).toBe(rowY + 60)
    expect(sec.canvas.height).toBe(height + 60)
  })
})
