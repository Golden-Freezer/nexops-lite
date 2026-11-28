/**
 * 적용 D3 P1 — 같은 뼈대 이웃 떼기(R-I4)·횟수 상한 시험 고정(R-I4·T1-50·T1-68)·대표 컷 쏠림 줄이기(R-P1 사진 부분).
 * - 채움 순서는 큰 POINT 밖 같은 템플릿·변형이 붙으면 메시지 하나를 그 사이로 옮긴다. 끝 사실 묶음(사이즈표·사이즈·상품 정보) 안 이웃은 그대로다.
 * - 사실 표(T9)는 D에 다른 표 뼈대가 없어 횟수 상한에서 뺀다(통합 11-03 12:52). 그 밖 뼈대·부품은 구조상 상한 안이라 시험으로 고정한다.
 * - 후보 컷을 다 쓴 자리는 hero 대신 덜 쓴 후보를 쓰고 바로 앞·뒤 섹션과 같은 컷은 피한다(새 컷 없음).
 */
import { describe, expect, it } from 'vitest'
import { fixtureToJob, loadEnrichmentFixture } from '../__golden__/golden-harness'
import { applyDesignSkeleton, resolveDesignSkeleton } from '../pdp-enrichment-stage'
import type { DesigncutPlan, DesigncutSection, PdpJobRow } from '../pdp-state'
import { mergeManualStrategy } from '../pdp-strategy-contract'
import { FILL_MESSAGE_ROLE, factsTailOf, separateSkeletons } from './designcut-fill'
import { assignImageKeys } from './designcut-images'
import { buildDesigncutPlan } from './designcut-plan'
import { skeletonOf } from './designcut-structure'

type Piece = Omit<DesigncutSection, 'bg' | 'plateKey' | 'plateAspect'>

const piece = (key: string, template: string, over: Partial<Piece> = {}): Piece =>
  ({ key, role: 'info', template, chapter: null, productImageKey: null, productAlpha: false, text: { eyebrow: null, headline: null, sub: null }, modules: [], ...over }) as Piece
const message = (key: string, layoutVariant: Piece['layoutVariant']) => piece(key, 'T3a', { role: FILL_MESSAGE_ROLE, layoutVariant })

/** 순서를 떼어 본다 — 사실 묶음은 facts 개수만큼 끝이다 */
function separate(pieces: Piece[], order: string[], options: { spare?: string[]; facts?: number } = {}): string[] {
  const out = [...order]
  separateSkeletons(out, new Map(pieces.map((p) => [p.key, p])), new Set(options.spare ?? []), out.length - (options.facts ?? 0))
  return out
}

describe('같은 뼈대 이웃 떼기(R-I4)', () => {
  const how = piece('how', 'T5')
  const ingredients = piece('long:ingredients', 'T9')
  const notice = piece('long:notice', 'T9')

  it('붙은 사실 표 사이로 가장 가까운 메시지를 옮긴다', () => {
    const pieces = [piece('hero', 'T1'), message('m1', 'scene'), how, ingredients, notice, piece('cta', 'T8')]
    expect(separate(pieces, ['hero', 'm1', 'how', 'long:ingredients', 'long:notice', 'cta'])).toEqual(['hero', 'how', 'long:ingredients', 'm1', 'long:notice', 'cta'])
  })

  it('옵션 앞에 남은 메시지가 가까운 메시지보다 먼저다', () => {
    const pieces = [piece('a', 'T4'), message('m1', 'scene'), ingredients, notice, piece('x', 'T6'), piece('y', 'T5'), message('m2', 'zigzag'), piece('opt', 'T7')]
    const order = ['a', 'm1', 'long:ingredients', 'long:notice', 'x', 'y', 'm2', 'opt']
    expect(separate(pieces, order, { spare: ['m2'] })).toEqual(['a', 'm1', 'long:ingredients', 'm2', 'long:notice', 'x', 'y', 'opt'])
    // 남은 메시지가 없으면 가까운 메시지다
    expect(separate(pieces, order)).toEqual(['a', 'long:ingredients', 'm1', 'long:notice', 'x', 'y', 'm2', 'opt'])
  })

  it('거리가 같으면 앞 메시지를 옮긴다', () => {
    const pieces = [message('m1', 'scene'), ingredients, notice, piece('x', 'T6'), message('m2', 'zigzag')]
    expect(separate(pieces, ['m1', 'long:ingredients', 'long:notice', 'x', 'm2'])).toEqual(['long:ingredients', 'm1', 'long:notice', 'x', 'm2'])
  })

  it('빼면 그 자리에 같은 뼈대가 붙는 메시지는 옮기지 않고 다음 메시지를 쓴다', () => {
    // m1이 더 가깝지만 빼면 a·b(T4)가 붙는다
    const pieces = [piece('a', 'T4'), message('m1', 'scene'), piece('b', 'T4'), ingredients, notice, piece('x', 'T8'), piece('y', 'T6'), piece('z', 'T7'), message('m2', 'grid')]
    const order = ['a', 'm1', 'b', 'long:ingredients', 'long:notice', 'x', 'y', 'z', 'm2']
    expect(separate(pieces, order)).toEqual(['a', 'm1', 'b', 'long:ingredients', 'm2', 'long:notice', 'x', 'y', 'z'])
  })

  it('같은 변형 메시지가 붙은 자리에는 다른 변형 메시지를 옮긴다', () => {
    const pieces = [message('m1', 'scene'), message('m2', 'scene'), piece('x', 'T5'), message('m3', 'scene'), piece('y', 'T6'), message('m4', 'grid')]
    expect(separate(pieces, ['m1', 'm2', 'x', 'm3', 'y', 'm4'])).toEqual(['m1', 'm4', 'm2', 'x', 'm3', 'y'])
  })

  it('끝 사실 묶음 안 이웃은 그대로 두고, 그 앞 표와 묶음 첫 표 사이에는 메시지를 넣는다', () => {
    const matrix = piece('long:matrix', 'T9')
    const info = piece('long:info', 'T9')
    const inside = [message('m1', 'scene'), piece('cta', 'T8'), matrix, info]
    expect(separate(inside, ['m1', 'cta', 'long:matrix', 'long:info'], { facts: 2 })).toEqual(['m1', 'cta', 'long:matrix', 'long:info'])
    const before = [message('m1', 'scene'), notice, matrix, info]
    expect(separate(before, ['m1', 'long:notice', 'long:matrix', 'long:info'], { facts: 2 })).toEqual(['long:notice', 'm1', 'long:matrix', 'long:info'])
  })

  it('메시지가 없으면 그대로 두고, 큰 POINT와 기존 빌더 섹션은 이웃으로 보지 않는다', () => {
    expect(separate([how, ingredients, notice], ['how', 'long:ingredients', 'long:notice'])).toEqual(['how', 'long:ingredients', 'long:notice'])
    const points = [piece('p0', 'T3a', { chapter: 1, layoutVariant: 'zigzag' }), piece('p1', 'T3a', { chapter: 2, layoutVariant: 'zigzag' }), message('m1', 'scene')]
    expect(separate(points, ['p0', 'p1', 'm1'])).toEqual(['p0', 'p1', 'm1'])
    expect(separate([ingredients, notice, message('m1', 'scene')], ['long:ingredients', 'kept_section', 'long:notice', 'm1'])).toEqual(['long:ingredients', 'kept_section', 'long:notice', 'm1'])
  })

  it('떼지 못한 이웃이 있어도 뒤 이웃은 뗀다 — 같은 변형 메시지 이웃은 같은 변형 메시지로 못 뗀다', () => {
    const pieces = [message('m1', 'scene'), message('m2', 'scene'), piece('x', 'T5'), ingredients, notice, message('m3', 'scene')]
    expect(separate(pieces, ['m1', 'm2', 'x', 'long:ingredients', 'long:notice', 'm3'])).toEqual(['m1', 'm2', 'x', 'long:ingredients', 'm3', 'long:notice'])
  })
})

const ON = ['vocab', 'persuasion', 'layouts', 'shots', 'annotations', 'mobile', 'options', 'designcut']
const FILL = [...ON, 'designcut2', 'fillacts']
/** C1 입력을 넣은 새 D2 잡 — 주의·보관 2줄·성분 3개·사이즈 행렬(사실 표가 4개로 는다) */
const INPUTS = {
  noticeItems: [
    { kind: 'caution', text: '불 가까이에 두지 마세요' },
    { kind: 'storage', text: '직사광선을 피해 서늘한 곳에 보관하세요' },
  ],
  sizeMatrix: { columns: ['가로', '세로'], rows: [{ label: 'S', values: ['10', '12'] }, { label: 'M', values: ['12', '14'] }] },
  extraSpecs: [{ key: '성분', value: '정제수, 글리세린, 판테놀' }],
}
const FIXTURES = ['A-track-i', 'B-track-i', 'C-track-i'] as const

/** 채움 메시지 카피 칸(designcut-fill MESSAGE_SECTIONS 순서) — 앞 messages개만 남기면 메시지 수가 준다 */
const MESSAGE_COPY = ['keyMessageCopy', 'mainCutCopy', 'conceptCopy', 'productExposure', 'directionHint']

function job(fixture: (typeof FIXTURES)[number], spec: Record<string, unknown> = {}, messages = MESSAGE_COPY.length): PdpJobRow {
  const j = fixtureToJob(loadEnrichmentFixture(fixture))
  j.analysis = { ...j.analysis, enrichment: { version: 1, features: FILL } } as PdpJobRow['analysis']
  j.spec_sheet = { ...j.spec_sheet, extraSpecs: [], ...spec } as PdpJobRow['spec_sheet']
  const final = { ...(j.copy_sections.final as Record<string, unknown>) }
  for (const field of MESSAGE_COPY.slice(messages)) delete final[field]
  j.copy_sections = { ...j.copy_sections, final } as PdpJobRow['copy_sections']
  const strategy = mergeManualStrategy(j.analysis.recommended_strategy_contract ?? {}, j.spec_sheet, [])
  j.section_plan = applyDesignSkeleton(j.section_plan, resolveDesignSkeleton(j, strategy))
  return j
}
const planOf = (j: PdpJobRow) => buildDesigncutPlan(j)!
const pageOf = (plan: DesigncutPlan) => {
  const byKey = new Map(plan.sections.map((s) => [s.key, s]))
  return plan.order.map((key) => byKey.get(key) ?? null)
}
const FACTS = new Set(['long:matrix', 'long:info'])
/** 끝 사실 묶음 둘 다가 아닌 같은 뼈대 이웃 */
const neighbors = (plan: DesigncutPlan) =>
  pageOf(plan).flatMap((s, i, page) => {
    const prev = page[i - 1]
    if (!s || !prev || skeletonOf(s) === null || skeletonOf(s) !== skeletonOf(prev)) return []
    const bothFacts = (FACTS.has(prev.key) || prev.template === 'T6') && (FACTS.has(s.key) || s.template === 'T6')
    return bothFacts ? [] : [`${prev.key}|${s.key}`]
  })
const countBy = <T,>(items: readonly T[]) => items.reduce((m, k) => m.set(k, (m.get(k) ?? 0) + 1), new Map<T, number>())

describe.each(FIXTURES)('픽스처 %s — 채움 D2 계획', (fixture) => {
  const base = planOf(job(fixture))
  const withInputs = planOf(job(fixture, INPUTS))
  // 메시지 하나 — 끼우기(앞 본문 뒤)만으로는 사용법 뒤 성분·주의 표가 붙는다
  const oneMessage = planOf(job(fixture, INPUTS, 1))

  it('C1 입력에 메시지가 하나뿐이어도 그 메시지가 성분·주의 표 사이로 옮겨, 같은 뼈대 이웃이 없다(끝 사실 묶음 제외)', () => {
    const order = oneMessage.order
    expect(order.slice(order.indexOf('long:ingredients'), order.indexOf('long:notice') + 1)).toEqual(['long:ingredients', 'key_message:body', 'long:notice'])
    expect(oneMessage.sections.find((s) => s.key === 'key_message:body')?.role).toBe(FILL_MESSAGE_ROLE)
    for (const plan of [base, withInputs, oneMessage]) expect(neighbors(plan)).toEqual([])
  })

  it('메시지가 없으면 붙은 표는 그대로 둔다(빼지 않는다)', () => {
    expect(neighbors(planOf(job(fixture, INPUTS, 0)))).toEqual(['long:ingredients|long:notice'])
  })

  it('끝 두 자리·섹션 수는 그대로다', () => {
    for (const plan of [base, withInputs, oneMessage]) {
      expect(factsTailOf(plan).ok).toBe(true)
      expect(new Set(plan.order).size).toBe(plan.sections.length + plan.kept.length)
    }
  })

  it('같은 뼈대는 사실 표(T9) 밖에서 2번까지다(R-I4 횟수, T9는 상한 밖)', () => {
    for (const plan of [base, withInputs]) {
      const keys = pageOf(plan).flatMap((s) => (s && s.template !== 'T9' && skeletonOf(s) ? [skeletonOf(s)] : []))
      expect(Math.max(...countBy(keys).values())).toBeLessThanOrEqual(2)
    }
    expect(withInputs.sections.filter((s) => s.template === 'T9')).toHaveLength(4)
  })

  it('부품·틀 상한(T1-68·T1-50): 체크 2곳·말풍선 1곳·자세히 보기(원 3칸 자리) 1곳 이하, 비교·K 틀 없음', () => {
    for (const plan of [base, withInputs]) {
      const has = (type: string) => plan.sections.filter((s) => s.modules.some((m) => m.type === type)).length
      expect(has('M1')).toBeLessThanOrEqual(2)
      expect(has('M2a')).toBeLessThanOrEqual(1)
      expect(plan.sections.filter((s) => s.template === 'T11')).toHaveLength(1)
      expect(plan.sections.filter((s) => s.key.startsWith('compare') || s.templateRef)).toEqual([])
    }
  })
})

describe('대표 컷 쏠림 줄이기(R-P1 사진)', () => {
  const cut = (template: string, productImageKey: string | null = 'hero', key = template) => ({ key, template, productImageKey }) as Pick<DesigncutSection, 'template' | 'productImageKey'> & { key: string }
  const keysOf = (pieces: ReturnType<typeof cut>[], pro = false) => assignImageKeys(pieces, pro).map((p) => p.productImageKey)

  it('후보가 남으면 지금처럼 쓰지 않은 후보를 순서대로 고른다(Pro는 Pro 컷 먼저)', () => {
    expect(keysOf([cut('T1'), cut('T3a', 'hero', 'm1'), cut('T3a', 'hero', 'm2'), cut('T7'), cut('T8')])).toEqual(['hero', 'solution', 'usage', null, 'cta'])
    expect(keysOf([cut('T1'), cut('T3a', 'hero', 'm1')], true)).toEqual(['hero', 'product_exposure'])
  })

  it('후보를 다 쓰면 hero 대신 덜 쓴 후보를 쓴다 — 같으면 후보 순서, hero는 맨 뒤', () => {
    expect(keysOf([cut('T1'), cut('T3a', 'hero', 'm1'), cut('T3a', 'hero', 'm2'), cut('T5', 'howto:0'), cut('T3a', 'hero', 'm3')])).toEqual(['hero', 'solution', 'usage', 'howto:0', 'solution'])
  })

  it('바로 앞 섹션이 받은 컷은 덜 썼어도 고르지 않는다', () => {
    const pieces = [cut('T1'), cut('T5', 'solution'), cut('T2', null), cut('T3a', 'hero', 'm1'), cut('T3a', 'hero', 'm2'), cut('T3a', 'hero', 'm3')]
    expect(keysOf(pieces)).toEqual(['hero', 'solution', null, 'solution', 'usage', 'hero'])
  })

  it('바로 뒤 섹션의 자기 컷도 고르지 않는다', () => {
    const pieces = [cut('T5', 'solution'), cut('T5', 'usage'), cut('T3a', 'hero', 'm1'), cut('T3a', 'hero', 'm2'), cut('T2', null), cut('T3a', 'hero', 'm3'), cut('T5', 'hero')]
    expect(keysOf(pieces)).toEqual(['solution', 'usage', 'solution', 'usage', null, 'solution', 'hero'])
  })

  it('고를 컷이 hero뿐이면 hero다(비Pro 크기 표 — 후보가 모두 Pro 컷)', () => {
    expect(keysOf([cut('T1'), cut('T6')])).toEqual(['hero', 'hero'])
  })
})
