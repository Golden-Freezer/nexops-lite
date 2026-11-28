/**
 * 조립 연결(15_TEMPLATE_LINE §10) — 선택 기록(templateRef)이 있는 섹션만 엔진으로 그리고, 없으면 지금 그리기 그대로다. LLM·DB 없음
 */

import { describe, expect, it, vi } from 'vitest'
import { composeDesignCut } from '@/lib/registration/editor/utils/sectionConverter/designCut/compose'
import { readDesignCut } from '@/lib/registration/editor/utils/sectionConverter/designCut/contract'
import { designCutPlanForB } from '@/lib/registration/editor/utils/sectionConverter/designCut/designCut.fixture'
import { ENRICHMENT_DEFAULTS, resolveEnabledFeatures } from '@/lib/registration/enrichment-switch'
import { colorSetsOf } from './color-sets'
import { CONCEPTS } from './concepts'
import { FONT_PAIR_IDS, FONT_PAIR_TABLE, GOTHIC_HEADING_TRACKING, headingTrackingOf, type FontPairId } from './font-pairs'

vi.mock('@/lib/registration/templatelib/library', async () => {
  const { imageSlot, templateOf, textSlot } = await import('./engine.fixture')
  const k = templateOf({
    id: 'point_div.fixture',
    section: 'point_div',
    surfaces: ['W'],
    flow: [
      { kind: 'text', slot: 'headline', token: 'H1', gapAfter: 'photoGap' },
      { kind: 'panel', fill: 'D', bleed: true, nodes: [{ kind: 'text', slot: 'note', token: 'BODY' }] },
    ],
    slots: { headline: textSlot({ required: true }), note: textSlot({ required: true }), photo: imageSlot() },
  })
  const anyBg = templateOf({
    id: 'point_div.any-bg',
    section: 'point_div',
    surfaces: ['W', 'T', 'N', 'D'],
    flow: [{ kind: 'text', slot: 'headline', token: 'H1' }],
    slots: { headline: textSlot({ required: true }) },
  })
  // 구역이 다른 K 섹션(여백 호흡 넓음 경계 시험용)
  const trust = templateOf({ ...anyBg, id: 'review.any-zone', section: 'review', order: { zone: 'trust', notNextTo: [] } })
  const all = [k, anyBg, trust]
  return { TEMPLATES: all, templateById: (id: string) => all.find((t) => t.id === id), templatesOf: () => all }
})

const IMAGES = { hero: 'https://img.test/hero.png', features: Array.from({ length: 6 }, (_, i) => `https://img.test/f${i}.png`) }
const ART = {
  set: { floor: 'light oak floor', wall: 'warm white plaster wall', window: 'soft daylight', season: 'spring', props: ['linen'], tone: 'warm' },
  background: { base: '#FFFFFF', studio: '#F5F2EF', accent: '#2B6CD9' },
  corners: 'soft',
}

type Plan = ReturnType<typeof designCutPlanForB> & Record<string, unknown>
const planWith = (ref?: unknown, opts: { scene?: boolean } = {}) => {
  const plan = designCutPlanForB() as Plan
  plan.layout = 2
  if (opts.scene) plan.artDirection = ART
  const target = plan.sections.find((s) => s.key === 'point_div:0')!
  if (ref !== undefined) Object.assign(target, { templateRef: ref })
  return plan
}
const compose = (plan: Plan, stats?: { rendered: number; fallbacks: Array<{ key: string; template: string; to: string }> }) =>
  composeDesignCut([], readDesignCut({ designcut: plan })!, { images: IMAGES, sectionOrder: [], stats: stats as never })

const K_REF = { id: 'point_div.fixture', version: 1, slots: { headline: '템플릿 제목', note: '템플릿 설명' } }
const kSections = (out: ReturnType<typeof compose>) => out.filter((s) => s.layoutId.startsWith('designcut_k_'))

describe('templateRef 조립', () => {
  it('기록이 없으면 엔진을 지나지 않는다', () => {
    expect(kSections(compose(planWith()))).toHaveLength(0)
  })

  it('기록이 있는 섹션만 엔진으로 그리고 나머지는 그대로다', () => {
    const baseline = compose(planWith())
    const out = compose(planWith(K_REF))
    expect(out).toHaveLength(baseline.length)
    const [k] = kSections(out)
    expect(k.layoutId).toBe('designcut_k_point_div.fixture')
    expect(k.sectionType).toBe('point_div')
    expect(k.elements.map((e) => e.textProps?.content).filter(Boolean)).toEqual(['템플릿 제목', '템플릿 설명'])
    // 다른 섹션은 같은 템플릿·같은 글이다
    const ids = (list: typeof out) => list.filter((s) => s !== k).map((s) => s.layoutId)
    expect(ids(out)).toEqual(baseline.map((s) => s.layoutId).filter((_, i) => out[i] !== k))
  })

  it('마운트 리플로우를 켜고 아래 여백은 보존한다 — 글자 높이 추정과 실제의 차이를 실측으로 맞춘다', () => {
    const [k] = kSections(compose(planWith(K_REF)))
    expect(k.needsInitialReflow).toBe(true)
    expect(k.preserveBottomPad).toBe(true)
  })

  it('기록 없는 섹션은 아래 여백 보존 칸이 없다', () => {
    for (const s of compose(planWith())) expect(s.preserveBottomPad).toBeUndefined()
  })

  it('장면 모드에서 풀폭 띠로 끝나면 아래 여백을 더하지 않는다', () => {
    const [k] = kSections(compose(planWith(K_REF, { scene: true })))
    const panel = k.elements.find((e) => e.name === 'designcut-panel')!
    expect(panel.transform.y + panel.transform.height).toBe(k.canvas.height)
  })

  it('장면 모드에서 K 섹션끼리 맞닿으면 여백 호흡으로 경계를 맞춘다 — POINT 연속은 좁음 88 + 88(K9 개선 #11), 장면 모드가 아니면 그대로', () => {
    const ANY = { id: 'point_div.any-bg', version: 1, slots: { headline: '템플릿 제목' } }
    const twoK = (scene: boolean) => {
      const plan = planWith(ANY, { scene })
      Object.assign(plan.sections.find((s) => s.key === 'point_div:1')!, { templateRef: ANY })
      return kSections(compose(plan))
    }
    const seam = ([a, b]: ReturnType<typeof twoK>) => {
      const bottom = Math.max(...a.elements.map((e) => e.transform.y + e.transform.height))
      return a.canvas.height - bottom + Math.min(...b.elements.map((e) => e.transform.y))
    }
    expect(seam(twoK(true))).toBe(176)
    expect(seam(twoK(false))).not.toBe(176)
    // 구역이 바뀌면 넓음 150 + 150 — 장면 모드 경계 목표 260에 깎이지 않고 M4 상한 300까지 둔다
    const plan = planWith(ANY, { scene: true })
    Object.assign(plan.sections.find((s) => s.key === 'point_div:1')!, { templateRef: { ...ANY, id: 'review.any-zone' } })
    expect(seam(kSections(compose(plan)) as ReturnType<typeof twoK>)).toBe(300)
  })

  it('라이브러리에 없는 id는 원래 템플릿으로 그리고 기록한다', () => {
    const stats = { rendered: 0, fallbacks: [] as Array<{ key: string; template: string; to: string }> }
    const out = compose(planWith({ ...K_REF, id: 'point_div.none' }), stats)
    expect(kSections(out)).toHaveLength(0)
    expect(stats.fallbacks).toContainEqual(expect.objectContaining({ key: 'point_div:0', to: 'template-fallback' }))
  })

  it('필수 슬롯이 비면 원래 템플릿으로 그리고 기록한다', () => {
    const stats = { rendered: 0, fallbacks: [] as Array<{ key: string; template: string; to: string }> }
    const out = compose(planWith({ ...K_REF, slots: { headline: '제목만' } }), stats)
    expect(kSections(out)).toHaveLength(0)
    expect(stats.fallbacks.map((f) => f.to)).toContain('template-fallback')
  })
})

describe('K 바탕·색', () => {
  const COLORS = { base: '#FFFFFF', accent: '#112233', accentText: '#223344', deep: '#334455', tint: '#445566', ink: '#000000', photo: '#667788', onDeep: '#FFFFFF', onAccent: '#FFFFFF', neutral: '#778899', heading: '#111111', highlight: false }
  const ANY_REF = { id: 'point_div.any-bg', version: 1, slots: { headline: '템플릿 제목' } }
  const withBg = (bg: string, extra: Partial<Plan> = {}) => {
    const plan = planWith(ANY_REF)
    Object.assign(plan.sections.find((s) => s.key === 'point_div:0')!, { bg })
    return Object.assign(plan, extra)
  }
  const kFill = (plan: Plan) => kSections(compose(plan))[0].canvas.backgroundColor

  it('막 배정이 K 바탕을 덮지 않는다', () => {
    expect(kFill(withBg('D', { templateColors: COLORS }))).toBe(COLORS.deep)
    expect(kFill(withBg('T', { templateColors: COLORS }))).toBe(COLORS.tint)
    expect(kFill(withBg('N', { templateColors: COLORS }))).toBe(COLORS.neutral)
  })

  it('고른 색은 K 섹션에만 쓰고 다른 섹션은 그대로다', () => {
    const plain = compose(withBg('D'))
    const colored = compose(withBg('D', { templateColors: COLORS }))
    const others = (list: typeof plain) => list.filter((s) => !s.layoutId.startsWith('designcut_k_')).map((s) => [s.layoutId, s.canvas.backgroundColor])
    expect(others(colored)).toEqual(others(plain))
    expect(kSections(plain)[0].canvas.backgroundColor).not.toBe(COLORS.deep)
  })

  it('칸이 없으면 계획 색이고, 기록 없는 잡은 막 배정 그대로다', () => {
    const baseline = compose(planWith())
    expect(compose(Object.assign(planWith(), { templateColors: COLORS })).map((s) => s.canvas.backgroundColor)).toEqual(baseline.map((s) => s.canvas.backgroundColor))
  })

  it('형식이 틀린 색은 통째로 두지 않는다', () => {
    const read = (templateColors: unknown) => readDesignCut({ designcut: Object.assign(planWith(), { templateColors }) })!.templateColors
    expect(read(COLORS)).toEqual(COLORS)
    expect(read({ ...COLORS, accent: 'red' })).toBeUndefined()
    expect(read({ ...COLORS, highlight: 'no' })).toBeUndefined()
    expect(read(undefined)).toBeUndefined()
    expect(read(Object.fromEntries(Object.entries(COLORS).filter(([name]) => name !== 'neutral')))).toBeUndefined()
  })

  it('실제 색 조합은 모두 기록을 지나간다', () => {
    for (const concept of CONCEPTS) {
      for (const set of colorSetsOf(concept).sets) {
        expect(readDesignCut({ designcut: Object.assign(planWith(), { templateColors: set.colors }) })!.templateColors, `${concept.id} ${set.id}`).toEqual(set.colors)
      }
    }
  })
})

describe('K 제목 자간(K9 — 굵은 고딕 −1.5%)', () => {
  const HEADING = new Set(['display', 'h1', 'h2'])
  const withPair = (id?: FontPairId) => {
    const plan = planWith(K_REF)
    if (id) Object.assign(plan, { templateFontPair: { heading: FONT_PAIR_TABLE[id].heading, weight: FONT_PAIR_TABLE[id].weight } })
    return compose(plan).flatMap((s) => s.elements.flatMap((e) => (e.textProps ? [{ name: `${s.layoutId}/${e.name}`, ...e.textProps }] : [])))
  }
  const baseline = withPair()

  it('고딕 계열 짝만 자간 값이 있다', () => {
    const tracked = FONT_PAIR_IDS.filter((id) => headingTrackingOf(FONT_PAIR_TABLE[id]) !== undefined)
    expect(tracked).toEqual(['gothic-suit', 'gothic-wanted', 'gothic-paperlogy', 'gothic-line', 'gothic-a1', 'round-gmarket', 'impact-blackhan', 'impact-dohyeon'])
    expect(headingTrackingOf(FONT_PAIR_TABLE['gothic-suit'])).toBe(GOTHIC_HEADING_TRACKING)
    expect(headingTrackingOf({ heading: 'SUIT Variable', weight: 400 })).toBeUndefined()
  })

  it('고딕 짝이면 페이지 모든 제목 수준 글자의 자간이 글자 크기 × −1.5%다 — 본문·표·캡션은 그대로', () => {
    const texts = withPair('gothic-suit')
    const headings = texts.filter((t) => HEADING.has(t.typoLevel ?? ''))
    expect(headings.some((t) => t.name.startsWith('designcut_k_'))).toBe(true)
    for (const t of headings) expect(t.letterSpacing, t.name).toBe(Math.round(t.fontSize * GOTHIC_HEADING_TRACKING * 10) / 10)
    const rest = (list: typeof texts) => list.filter((t) => !HEADING.has(t.typoLevel ?? '')).map((t) => t.letterSpacing)
    expect(rest(texts)).toEqual(rest(baseline))
  })

  it('명조 짝은 지금 자간 그대로다', () => {
    expect(withPair('serif-noto').map((t) => t.letterSpacing)).toEqual(baseline.map((t) => t.letterSpacing))
  })
})

describe('기록 읽기', () => {
  const read = (ref: unknown) => readDesignCut({ designcut: planWith(ref) })!.sections.find((s) => s.key === 'point_div:0')!.templateRef

  it('형식이 맞으면 남긴다', () => {
    expect(read(K_REF)).toEqual(K_REF)
  })

  it('형식이 틀리면 칸을 두지 않는다', () => {
    expect(read({ id: 'x' })).toBeUndefined()
    expect(read({ slots: {} })).toBeUndefined()
    expect(read('point_div.fixture')).toBeUndefined()
  })
})

describe('스위치', () => {
  it('기본 on(K4 운영 전환) — designcut과 함께일 때만 기록하고, designcut을 빼면 함께 빠진다', () => {
    expect(ENRICHMENT_DEFAULTS.templatelib).toBe(true)
    expect(resolveEnabledFeatures({})).toContain('templatelib')
    expect(resolveEnabledFeatures({ VERCEL: '1' })).toContain('templatelib')
    expect(resolveEnabledFeatures({ NEXOPS_PDP_ENRICHMENT_SKIP: 'designcut' })).not.toContain('templatelib')
    expect(resolveEnabledFeatures({ NEXOPS_PDP_ENRICHMENT_SKIP: 'templatelib' })).not.toContain('templatelib')
  })
})
