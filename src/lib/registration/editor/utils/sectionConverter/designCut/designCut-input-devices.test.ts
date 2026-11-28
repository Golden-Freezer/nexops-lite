/**
 * 적용 D6 입력 장치 — 원형 배지(R-D1, 마무리 T8 사진 위 오른쪽)·층 띠(T1-85, 자세히 보기 T11 머리 아래)·구성품 펼침(T1-83, 사이즈 칸 T6 아래):
 * 입력 값 고르기(인증 첫 이름 → 평점+리뷰 수, 구성 수량 안 씀), 층·구성품 조건 경계, 계획 표지(입력 없으면 그대로·D2만·구성품은 K 구성품 칸과 같은 읽기),
 * 계약(자리 섹션의 형식 맞는 칸만), 조립(장면 모드만 — 배지는 사진 안 높이 그대로, 층 띠는 머리 아래에 끼우고 아래를 내림, 구성품은 수치 줄·캡션 아래 번호 줄),
 * 없으면 바이트 같음, 모바일 판독, 리플로우. LLM·DB 없음
 */

import { describe, expect, it } from 'vitest'
import type { CanvasSection } from '@/lib/registration/editor/types/canvas'
import { checkMobileReadability } from '@/lib/registration/editor/utils/mobileReadability'
import { reflowSectionLayout } from '@/lib/registration/editor/utils/reflowSectionLayout'
import { INPUT_SLOT_SAMPLE, withSampleInputSlots } from '@/lib/registration/__fixtures__/input-slots.sample'
import { TRACK_I_KEYS, fixtureToJob, loadEnrichmentFixture, type FixtureKey } from '@/lib/registration/__golden__/golden-harness'
import { buildDesigncutPlan } from '@/lib/registration/internalized/designcut-plan'
import { markInputDevices } from '@/lib/registration/internalized/designcut-structure'
import { inputSlotsOf } from '@/lib/registration/input-slots-read'
import { applyDesignSkeleton, resolveDesignSkeleton } from '@/lib/registration/pdp-enrichment-stage'
import type { DesigncutTemplate, PdpJobRow, PdpSpecSheet } from '@/lib/registration/pdp-state'
import { mergeManualStrategy } from '@/lib/registration/pdp-strategy-contract'
import { PARTS_MIN } from '@/lib/registration/templatelib/input-values'
import { BADGE } from '@/lib/registration/templatelib/medal'
import { composeDesignCut } from './compose'
import { readDesignCut } from './contract'
import { designCutPlanForB } from './designCut.fixture'
import { PARTS_LABEL, PARTS_MAX, badgeOfSpec, fitsLayerRows, fitsPartRows, type DesigncutLayer } from './inputDevices'
import { CONTENT_W, MARGIN, SCENE_TYPE, W } from './tokens'

const ART = {
  set: { floor: 'light oak floor', wall: 'warm white plaster wall', window: 'soft daylight from the left window', season: 'spring', props: ['linen cloth'] },
  background: { base: '#FFFFFF', studio: '#F5F2EF', accent: '#2B6CD9' },
  corners: 'soft',
}
const IMAGES = { hero: 'https://img.test/hero.png', features: Array.from({ length: 6 }, (_, i) => `https://img.test/f${i}.png`) }
const PARTS = ['본체', '받침대', '세척 솔']
const partsSpec = (value: string) => ({ extraSpecs: [{ key: '구성품', value }] })
const LAYERS: DesigncutLayer[] = [{ name: '겉감 면 100%', note: '부드러운 촉감' }, { name: '충전재 마이크로화이버' }, { name: '안감 폴리에스터', note: '정전기 방지 가공' }]
const DETAIL = {
  key: 'detail',
  role: 'usp_feature',
  template: 'T11',
  bg: 'W',
  chapter: null,
  plateKey: null,
  plateAspect: null,
  productImageKey: null,
  productAlpha: false,
  text: { eyebrow: 'DETAIL', headline: '자세히 보기', sub: null },
  modules: [{ type: 'M11', data: { items: [{ title: '한 손 사용', description: '가볍게 잡혀요', imageKey: null }, { title: '세척 쉬움', description: '물로 헹궈요', imageKey: null }] } }],
}

type Opts = { scene?: boolean; badge?: unknown; layers?: unknown; parts?: unknown; rows?: unknown }
const planOf = ({ scene = true, badge, layers, parts, rows }: Opts = {}) => {
  const plan = designCutPlanForB() as ReturnType<typeof designCutPlanForB> & Record<string, unknown>
  if (scene) {
    plan.layout = 2
    plan.artDirection = ART
  }
  const sections = [
    ...plan.sections.map((s) =>
      s.template === 'T8' && badge !== undefined
        ? { ...s, badge }
        : s.template === 'T6' && (parts !== undefined || rows !== undefined)
          ? { ...s, ...(parts !== undefined ? { parts } : {}), ...(rows !== undefined ? { metricRows: rows } : {}) }
          : s
    ),
    { ...DETAIL, ...(layers !== undefined ? { layers } : {}) },
  ] as unknown as typeof plan.sections
  const order = [...plan.order]
  order.splice(order.indexOf('cta'), 0, 'detail')
  return { ...plan, sections, order }
}
const compose = (opts: Opts = {}) =>
  composeDesignCut([], readDesignCut({ designcut: JSON.parse(JSON.stringify(planOf(opts))) })!, { images: IMAGES, sectionOrder: [] })
const named = (sec: CanvasSection, name: string | RegExp) => sec.elements.filter((e) => (typeof name === 'string' ? e.name === name : name.test(e.name ?? '')))
const of = (out: CanvasSection[], layout: string) => out.find((s) => s.layoutId === layout)!
const shapeOf = (sec: CanvasSection) =>
  JSON.stringify({ ...sec, id: '', elements: sec.elements.map((e) => ({ ...e, id: '', groupId: e.groupId ? 'g' : undefined, containerOf: e.containerOf?.length })) }).replace(
    /([a-z]+)_\d+_\d{10,}/g,
    '$1'
  )
const spec = (extra: Partial<PdpSpecSheet>) => ({ productName: '시험 상품', ...extra }) as PdpSpecSheet
const bottomOf = (e: { transform: { y: number; height: number } }) => e.transform.y + e.transform.height
// 글자 빌더는 짧은 낱말 뒤 공백을 줄바꿈 없는 공백(U+00A0)으로 바꾼다 — 글은 같다
const textOf = (e: CanvasSection['elements'][number]) => String(e.textProps?.content).replace(/\u00a0/g, ' ')

describe('배지 값(badgeOfSpec) — 입력 그대로, 지어내지 않음', () => {
  it('인증 첫 이름이 먼저, 원 안에 안 들면 입력 평점(리뷰 수 있을 때), 둘 다 없으면 null', () => {
    expect(badgeOfSpec(spec({ certificationInfo: 'KC; FDA', rating: 4.8, reviewCount: 120 }))).toEqual({ input: 'badge.certification', value: 'KC' })
    expect(badgeOfSpec(spec({ certificationInfo: '가'.repeat(7), rating: 4.85, reviewCount: 12 }))).toEqual({ input: 'badge.rating', value: '4.85' })
    expect(badgeOfSpec(spec({ rating: 4.8 }))).toBeNull()
    expect(badgeOfSpec(spec({ reviewCount: 30 }))).toBeNull()
    expect(badgeOfSpec(spec({}))).toBeNull()
  })
  it('구성 수량은 D 배지에 쓰지 않는다', () => {
    expect(badgeOfSpec(spec({ extraSpecs: [{ key: '구성', value: '20개' }] }))).toBeNull()
  })
})

describe('층 조건(fitsLayerRows) — 경계', () => {
  it('2~5층만, 이름은 띠 글 칸 660(본문 폭 740 − 안쪽 여백 40×2)에 굵은 본문 52 한 줄 — 한글 12자(624)는 들고 13자(676)는 안 든다, 설명 낱말도 칸 안', () => {
    expect(fitsLayerRows(LAYERS)).toBe(true)
    expect(fitsLayerRows(LAYERS.slice(0, 1))).toBe(false)
    expect(fitsLayerRows([...LAYERS, ...LAYERS])).toBe(false)
    expect(fitsLayerRows([{ name: '가'.repeat(12) }, { name: '나' }])).toBe(true)
    expect(fitsLayerRows([{ name: '가'.repeat(13) }, { name: '나' }])).toBe(false)
    expect(fitsLayerRows([{ name: '겉\n감' }, { name: '나' }])).toBe(false)
    expect(fitsLayerRows([{ name: '겉감', note: `${'가'.repeat(12)} ${'가'.repeat(12)}` }, { name: '나' }])).toBe(true)
    expect(fitsLayerRows([{ name: '겉감', note: '가'.repeat(13) }, { name: '나' }])).toBe(false)
  })
})

describe('구성품 조건(fitsPartRows) — 경계', () => {
  it('2(K PARTS_MIN)~6개만, 이름은 이름 칸 636(본문 폭 740 − 번호 원 80 − 간격 24)에 장면 본문 52 한 줄 — 한글 12자(624)는 들고 13자(676)는 안 든다', () => {
    expect([PARTS_MIN, PARTS_MAX]).toEqual([2, 6])
    expect(fitsPartRows(PARTS)).toBe(true)
    expect(fitsPartRows(PARTS.slice(0, 1))).toBe(false)
    expect(fitsPartRows([])).toBe(false)
    expect(fitsPartRows(Array.from({ length: 6 }, (_, i) => `부속 ${i + 1}`))).toBe(true)
    expect(fitsPartRows(Array.from({ length: 7 }, (_, i) => `부속 ${i + 1}`))).toBe(false)
    expect(fitsPartRows(['가'.repeat(12), '나'])).toBe(true)
    expect(fitsPartRows(['가'.repeat(13), '나'])).toBe(false)
    // 하나라도 안 맞으면 전체가 아니다(일부만 싣지 않는다)
    expect(fitsPartRows([...PARTS, '가'.repeat(13)])).toBe(false)
    expect(fitsPartRows(['본\n체', '나'])).toBe(false)
    expect(fitsPartRows(['  ', '나'])).toBe(false)
  })
})

describe('계획 표지(markInputDevices)', () => {
  const page = () => (['T1', 'T6', 'T11', 'T8'] as DesigncutTemplate[]).map((template) => ({ key: template, template }))
  it('입력이 없으면 같은 배열을 돌려준다', () => {
    const s = page()
    expect(markInputDevices(s, spec({}))).toBe(s)
    expect(markInputDevices(s, spec({ extraSpecs: [{ key: '구성', value: '20개' }] }))).toBe(s)
  })
  it('인증은 마무리(T8)에만 badge, 층은 자세히 보기(T11)에만 layers', () => {
    const out = markInputDevices(page(), spec({ certificationInfo: 'KC', layers: LAYERS }))
    expect(out.find((s) => s.template === 'T8')).toMatchObject({ badge: { input: 'badge.certification', value: 'KC' } })
    expect(out.find((s) => s.template === 'T11')).toMatchObject({ layers: LAYERS })
    expect(out.filter((s) => 'badge' in s || 'layers' in s || 'parts' in s).map((s) => s.template)).toEqual(['T11', 'T8'])
  })
  it('구성품은 사이즈 칸(T6)에만 parts — 입력 순서·글 그대로, K 구성품 칸과 같은 읽기(inputSlotsOf.parts)', () => {
    const input = spec(partsSpec('본체, 받침대, 세척 솔'))
    const out = markInputDevices(page(), input)
    expect(out.find((s) => s.template === 'T6')).toMatchObject({ parts: PARTS })
    expect(inputSlotsOf(input).parts).toEqual(PARTS)
    expect(out.filter((s) => 'parts' in s).map((s) => s.template)).toEqual(['T6'])
    // 표본 값(render 눈 확인과 같은 값) — 구성품 2개는 T6, 층 2개는 T11, 평점·인증이 없어 배지는 없다
    const sample = markInputDevices(page(), withSampleInputSlots(spec({})))
    expect(sample.find((s) => s.template === 'T6')).toMatchObject({ parts: ['표본 본체', '표본 받침'] })
    expect(sample.find((s) => s.template === 'T11')).toMatchObject({ layers: INPUT_SLOT_SAMPLE.layers })
    expect(sample.some((s) => 'badge' in s)).toBe(false)
    // 규제 표현이 든 이름은 입력 칸 읽기에서 빠진다(K 구성품 칸과 같이 거른 뒤 센다)
    const safe = markInputDevices(page(), spec(partsSpec('본체, 트러블 케어 패드, 받침대')))
    expect(safe.find((s) => s.template === 'T6')).toMatchObject({ parts: ['본체', '받침대'] })
  })
  it('구성품이 하나뿐이거나·6개를 넘거나·하나라도 칸보다 길거나·구성 수량 칸뿐이면 칸이 없다', () => {
    const s = page()
    const seven = Array.from({ length: 7 }, (_, i) => `부속${'가나다라마바사'[i]}`).join(', ')
    for (const value of ['연결 태그', seven, `본체, ${'가'.repeat(13)}`]) expect(markInputDevices(s, spec(partsSpec(value))), value).toBe(s)
    expect(markInputDevices(s, spec({ extraSpecs: [{ key: '구성', value: '본체, 받침대' }] }))).toBe(s)
    const noSize = page().filter((x) => x.template !== 'T6')
    expect(markInputDevices(noSize, spec(partsSpec('본체, 받침대')))).toBe(noSize)
  })
  it('자리 섹션이 없거나 층이 칸에 안 들면 그 장치는 칸이 없다', () => {
    const noClose = page().filter((s) => s.template !== 'T8')
    expect(markInputDevices(noClose, spec({ certificationInfo: 'KC' }))).toBe(noClose)
    const s = page()
    expect(markInputDevices(s, spec({ layers: [{ name: '가'.repeat(14) }, { name: '나' }] }))).toBe(s)
  })
})

describe('계획(buildDesigncutPlan) — 골든 잡', () => {
  const ON = ['vocab', 'persuasion', 'layouts', 'shots', 'annotations', 'mobile', 'options', 'designcut']
  const D2 = [...ON, 'designcut2', 'designlayout']
  const planFor = (key: FixtureKey, features: string[], extra?: Partial<PdpSpecSheet>) => {
    const j = fixtureToJob(loadEnrichmentFixture(key))
    j.analysis = { ...j.analysis, enrichment: { version: 1, features } } as PdpJobRow['analysis']
    if (extra) j.spec_sheet = { ...j.spec_sheet, ...extra }
    const strategy = mergeManualStrategy(j.analysis.recommended_strategy_contract ?? {}, j.spec_sheet, [])
    j.section_plan = applyDesignSkeleton(j.section_plan, resolveDesignSkeleton(j, strategy))
    return buildDesigncutPlan(j)!
  }
  it('D2 잡만, 입력이 있을 때만 자리 섹션에 칸 — 층 입력은 계획의 나머지를 바꾸지 않는다(인증 입력은 규제 판정 등 다른 곳도 바꿔 자리만 본다)', () => {
    let placed = 0
    for (const key of TRACK_I_KEYS) {
      const plain = planFor(key, D2)
      expect(plain.sections.some((s) => s.badge || s.layers), key).toBe(false)
      const withLayers = planFor(key, D2, { layers: LAYERS })
      const drop = (p: typeof plain) => JSON.stringify(p, (k, v) => (k === 'layers' ? undefined : v))
      expect(drop(withLayers), key).toBe(drop(plain))
      const withInput = planFor(key, D2, { certificationInfo: 'KC', layers: LAYERS })
      for (const s of withInput.sections.filter((x) => x.badge)) expect([s.template, s.badge], key).toEqual(['T8', { input: 'badge.certification', value: 'KC' }])
      for (const s of withInput.sections.filter((x) => x.layers)) expect(s.template, key).toBe('T11')
      placed += withInput.sections.filter((x) => x.badge || x.layers).length
      expect(planFor(key, ON, { certificationInfo: 'KC', layers: LAYERS }).sections.some((s) => s.badge || s.layers), key).toBe(false)
    }
    expect(placed).toBeGreaterThan(0)
  })
  it('구성품 입력은 사이즈 칸(T6) 첫 섹션에만 parts를 달고 계획의 나머지를 바꾸지 않는다 — D2가 아니면 칸 없음', () => {
    let sized = 0
    for (const key of TRACK_I_KEYS) {
      const plain = planFor(key, D2)
      expect(plain.sections.some((s) => s.parts), key).toBe(false)
      const base = fixtureToJob(loadEnrichmentFixture(key)).spec_sheet
      const extraSpecs = [...(base.extraSpecs ?? []), { key: '구성품', value: '본체, 받침대, 세척 솔' }]
      const withParts = planFor(key, D2, { extraSpecs })
      const t6 = withParts.sections.filter((s) => s.template === 'T6')
      if (t6.length) sized++
      expect(withParts.sections.filter((s) => s.parts).map((s) => [s.template, s.parts]), key).toEqual(t6.slice(0, 1).map(() => ['T6', PARTS]))
      // 상품 정보 표(T9)의 '구성품' 행은 지금도 같은 입력에서 나온다(이 장치 밖) — 그 행과 parts만 빼고 같은지 본다
      const drop = (p: typeof plain) =>
        JSON.stringify(p, (k, v) => (k === 'parts' ? undefined : k === 'rows' && Array.isArray(v) ? v.filter((r) => r?.label !== '구성품') : v))
      expect(drop(withParts), key).toBe(drop(plain))
      expect(planFor(key, ON, { extraSpecs }).sections.some((s) => s.parts), key).toBe(false)
    }
    expect(sized).toBeGreaterThan(0)
  })
})

describe('계약', () => {
  const read = (opts: Opts) => readDesignCut({ designcut: JSON.parse(JSON.stringify(planOf(opts))) })!.sections
  it('배지는 T8의 배지 입력 둘 중 하나만, 층은 T11의 2~5층만 읽는다', () => {
    expect(read({ badge: { input: 'badge.rating', value: '4.8' } }).find((s) => s.template === 'T8')!.badge).toEqual({ input: 'badge.rating', value: '4.8' })
    for (const bad of [{ input: 'badge.quantity', value: '20개' }, { input: 'badge.rating' }, 'KC'])
      expect(read({ badge: bad }).find((s) => s.template === 'T8'), JSON.stringify(bad)).not.toHaveProperty('badge')
    expect(read({ layers: LAYERS }).find((s) => s.template === 'T11')!.layers).toEqual(LAYERS)
    for (const bad of [LAYERS.slice(0, 1), [...LAYERS, ...LAYERS], [{ name: '겉감' }, { note: '설명' }], 'x'])
      expect(read({ layers: bad }).find((s) => s.template === 'T11'), JSON.stringify(bad)).not.toHaveProperty('layers')
    expect(read({ parts: PARTS }).find((s) => s.template === 'T6')!.parts).toEqual(PARTS)
    for (const bad of [PARTS.slice(0, 1), Array.from({ length: 7 }, (_, i) => `부속 ${i}`), ['본체', 3], ['본체', ' '], 'x', { 0: '본체' }])
      expect(read({ parts: bad }).find((s) => s.template === 'T6'), JSON.stringify(bad)).not.toHaveProperty('parts')
    const plan = planOf()
    Object.assign(plan.sections.find((s) => s.template === 'T1')!, { badge: { input: 'badge.rating', value: '4.8' }, layers: LAYERS, parts: PARTS })
    const t1 = readDesignCut({ designcut: JSON.parse(JSON.stringify(plan)) })!.sections.find((s) => s.template === 'T1')!
    expect(t1).not.toHaveProperty('badge')
    expect(t1).not.toHaveProperty('layers')
    expect(t1).not.toHaveProperty('parts')
  })
})

describe('조립 — 원형 배지(T8)', () => {
  it('장면 사진 안 위 오른쪽 모서리에 원 + 이름표·값, 섹션 높이 그대로', () => {
    const base = of(compose(), 'designcut_T8')
    const sec = of(compose({ badge: { input: 'badge.certification', value: 'KC' } }), 'designcut_T8')
    const photo = named(sec, 'designcut-scene')[0]
    const disc = named(sec, 'designcut-badge-disc')[0]
    expect(disc.transform).toMatchObject({ x: W - BADGE.inset - BADGE.size, y: photo.transform.y + BADGE.inset, width: BADGE.size, height: BADGE.size })
    expect(named(sec, /^designcut-badge-(label|value)$/).map((e) => e.textProps?.content)).toEqual(['인증', 'KC'])
    expect(sec.canvas.height).toBe(base.canvas.height)
    const rest = (s: CanvasSection) => shapeOf({ ...s, elements: s.elements.filter((e) => !/^designcut-badge/.test(e.name ?? '')) })
    expect(rest(sec)).toBe(rest(base))
  })
  it('칸이 없거나·장면 모드가 아니거나·원 안에 안 들면 그대로(바이트 같음)', () => {
    expect(named(of(compose(), 'designcut_T8'), /^designcut-badge/)).toEqual([])
    expect(shapeOf(of(compose({ badge: { input: 'badge.certification', value: 'KC' }, scene: false }), 'designcut_T8'))).toBe(shapeOf(of(compose({ scene: false }), 'designcut_T8')))
    expect(shapeOf(of(compose({ badge: { input: 'badge.certification', value: '가'.repeat(7) } }), 'designcut_T8'))).toBe(shapeOf(of(compose(), 'designcut_T8')))
  })
})

describe('조립 — 층 띠(T11)', () => {
  it('머리 아래 48에 칸 폭 띠를 맞닿게 쌓고(위 옅음 → 아래 짙음), 머리 밖 요소는 띠 높이 + 48만큼 내려간다', () => {
    const base = of(compose(), 'designcut_T11')
    const sec = of(compose({ layers: LAYERS }), 'designcut_T11')
    const headBottom = Math.max(...named(sec, /^designcut-(eyebrow|headline|sub)/).map((e) => e.transform.y + e.transform.height))
    const bands = named(sec, 'designcut-layer')
    expect(bands).toHaveLength(LAYERS.length)
    expect(bands[0].transform).toMatchObject({ x: MARGIN, y: headBottom + 48, width: CONTENT_W })
    bands.slice(1).forEach((band, i) => expect(band.transform.y).toBe(bands[i].transform.y + bands[i].transform.height))
    expect(named(sec, /^designcut-layer-name-\d$/).map((e) => e.textProps?.content?.replace(/ /g, ' '))).toEqual(LAYERS.map((l) => l.name))
    expect(named(sec, /^designcut-layer-note-\d$/)).toHaveLength(2)
    // 띠마다 자기 이름·설명을 상자 식구로 묶는다(글이 늘면 그 띠가 늘고 아래 띠를 민다)
    bands.forEach((band, i) => expect(band.containerOf).toEqual(named(sec, new RegExp(`^designcut-layer-(name|note)-${i}$`)).map((e) => e.id)))
    const last = bands[bands.length - 1]
    const shift = last.transform.y + last.transform.height - headBottom
    expect(sec.canvas.height).toBe(base.canvas.height + shift)
    const title = (s: CanvasSection) => named(s, 'designcut-detail-title-0')[0].transform.y
    expect(title(sec)).toBe(title(base) + shift)
    expect(new Set(sec.elements.map((e) => e.zIndex)).size).toBe(sec.elements.length)
  })
  it('칸이 없거나·장면 모드가 아니거나·층이 칸에 안 들면 그대로(바이트 같음), 자세히 보기 밖 섹션은 모두 같다', () => {
    expect(shapeOf(of(compose({ layers: LAYERS, scene: false }), 'designcut_T11'))).toBe(shapeOf(of(compose({ scene: false }), 'designcut_T11')))
    expect(shapeOf(of(compose({ layers: [{ name: '가'.repeat(14) }, { name: '나' }] }), 'designcut_T11'))).toBe(shapeOf(of(compose(), 'designcut_T11')))
    const base = compose()
    const out = compose({ layers: LAYERS, badge: { input: 'badge.rating', value: '4.8' } })
    out.forEach((s, i) => {
      if (s.layoutId !== 'designcut_T11' && s.layoutId !== 'designcut_T8') expect(shapeOf(s), s.layoutId).toBe(shapeOf(base[i]))
    })
  })
})

describe('조립 — 구성품 펼침(T6)', () => {
  const sizeOf = (out: CanvasSection[]) => of(out, 'designcut_T6')
  it('캡션 아래 48에 구성품 라벨, 줄마다 왼쪽 번호 원 80(1부터)·오른쪽 이름 636 장면 본문, 줄마다 투명 행 상자 — 캡션까지는 그대로이고 줄만큼 길어진다', () => {
    const base = sizeOf(compose())
    const sec = sizeOf(compose({ parts: PARTS }))
    const caption = named(sec, 'designcut-dim-caption')[0]
    const label = named(sec, 'designcut-parts-label')[0]
    expect(textOf(label)).toBe(PARTS_LABEL)
    expect(label.transform).toMatchObject({ x: MARGIN, y: bottomOf(caption) + 48 })
    const marks = named(sec, /^designcut-part-mark-\d$/)
    const numbers = named(sec, /^designcut-part-number-\d$/)
    const names = named(sec, /^designcut-part-name-\d$/)
    expect(numbers.map(textOf)).toEqual(['1', '2', '3'])
    expect(names.map(textOf)).toEqual(PARTS)
    let prev = bottomOf(label)
    names.forEach((name, i) => {
      const box = sec.elements.find((e) => e.containerOf?.includes(name.id))!
      expect(box).toMatchObject({ name: 'designcut-row', shapeProps: { fill: 'transparent' } })
      expect(box.containerOf).toEqual([marks[i].id, numbers[i].id, name.id])
      expect(box.transform.y).toBe(prev + 24)
      expect(marks[i].transform).toMatchObject({ x: MARGIN, width: 80, height: 80 })
      expect(name.transform).toMatchObject({ x: MARGIN + 80 + 24, width: CONTENT_W - 80 - 24, y: box.transform.y })
      expect(name.textProps?.fontSize).toBe(SCENE_TYPE.BODY.size)
      // 번호 원은 이름 첫 줄 가운데 높이
      expect(marks[i].transform.y).toBe(box.transform.y + Math.round((Math.ceil(52 * 1.7) - 80) / 2))
      prev = bottomOf(box)
    })
    const prefix = (s: CanvasSection) =>
      shapeOf({ ...s, canvas: { ...s.canvas, height: 0 }, elements: s.elements.filter((e) => !/^designcut-(part|row)/.test(e.name ?? '')) })
    expect(prefix(sec)).toBe(prefix(base))
    // 마지막 줄 아래 여백은 지금 캡션 아래 여백과 같다
    expect(sec.canvas.height - prev).toBe(base.canvas.height - bottomOf(named(base, 'designcut-dim-caption')[0]))
  })
  it('수치 줄이 함께 있으면 마지막 구분선 아래에 이어 그린다', () => {
    const rows = [{ name: '길이', value: '7.3cm' }]
    const withRows = sizeOf(compose({ rows }))
    const sec = sizeOf(compose({ rows, parts: PARTS }))
    const rule = named(sec, 'designcut-metric-rule-0')[0]
    expect(named(sec, 'designcut-parts-label')[0].transform.y).toBe(bottomOf(rule) + 48)
    const drop = (s: CanvasSection) =>
      shapeOf({
        ...s,
        canvas: { ...s.canvas, height: 0 },
        elements: s.elements.filter((e) => !/^designcut-part/.test(e.name ?? '') && !(e.name === 'designcut-row' && e.transform.y > bottomOf(rule))),
      })
    expect(drop(sec)).toBe(drop(withRows))
  })
  it('칸이 없거나·장면 모드가 아니거나·이름이 칸에 안 들면 지금 사이즈 칸 그대로(바이트 같음), 사이즈 칸 밖 섹션은 모두 같다', () => {
    expect(named(sizeOf(compose()), /^designcut-part/)).toEqual([])
    expect(shapeOf(sizeOf(compose({ parts: PARTS, scene: false })))).toBe(shapeOf(sizeOf(compose({ scene: false }))))
    expect(shapeOf(sizeOf(compose({ parts: ['본체', '가'.repeat(13)] })))).toBe(shapeOf(sizeOf(compose())))
    const base = compose()
    const out = compose({ parts: PARTS })
    out.forEach((s, i) => {
      if (s.layoutId !== 'designcut_T6') expect(shapeOf(s), s.layoutId).toBe(shapeOf(base[i]))
    })
  })
  it('리플로우 — 실측이 같으면 높이 그대로, 이름이 늘면 그 줄 아래만 함께 내려가고 위 줄·그 줄 번호는 그대로', () => {
    const same = structuredClone(sizeOf(compose({ parts: PARTS })))
    const height = same.canvas.height
    reflowSectionLayout(same)
    expect(same.canvas.height).toBe(height)
    const grown = structuredClone(sizeOf(compose({ parts: PARTS })))
    const at = (name: string) => named(grown, name)[0].transform.y
    const [first, mark1, next] = [at('designcut-part-name-0'), at('designcut-part-mark-1'), at('designcut-part-name-2')]
    const name = named(grown, 'designcut-part-name-1')[0]
    name.measuredHeight = name.transform.height + 100
    reflowSectionLayout(grown)
    expect([at('designcut-part-name-0'), at('designcut-part-mark-1')]).toEqual([first, mark1])
    expect(at('designcut-part-name-2')).toBe(next + 100)
    expect(grown.canvas.height).toBe(height + 100)
  })
})

describe('모바일 검사 — 규칙별 위반 수가 늘지 않고 장치 요소에 위반이 없다', () => {
  it('배지·층 띠·구성품', () => {
    const before = checkMobileReadability({ sections: compose() }).counts
    const after = checkMobileReadability({ sections: compose({ layers: LAYERS, badge: { input: 'badge.certification', value: 'KC' }, parts: PARTS }) })
    for (const rule of ['M1', 'M2', 'M4', 'M5', 'M6', 'M7'] as const) expect(after.counts[rule], rule).toBeLessThanOrEqual(before[rule])
    expect(after.violations.filter((v) => /^designcut-(badge|layer|part)/.test(v.element ?? ''))).toEqual([])
  })
})
