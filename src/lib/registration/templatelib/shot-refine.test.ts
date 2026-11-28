import { describe, expect, it, vi } from 'vitest'
import type { OrderedSection } from './selection-order'
import type { CopyValues } from './slot-copy'
import { refineShotsByCopy, shotTextOf, wordPurposesOf, type RefineContext } from './shot-refine'

const image = (purpose: string[], composition: string[]) => ({ type: 'image', required: true, purpose, composition, aspect: ['1:1'], minHeight: 100 })
const FAKE: Record<string, { slots: Record<string, unknown> }> = {
  wide: { slots: { photo: image(['feature_proof', 'scene', 'action', 'texture', 'underside', 'hero'], ['front', 'closeup', 'in_hand', 'in_use', 'top']) } },
  two: { slots: { a: image(['feature_proof', 'action', 'texture'], ['front', 'in_hand', 'closeup']), b: image(['feature_proof', 'action', 'texture'], ['front', 'in_hand', 'closeup']) } },
  proofOnly: { slots: { photo: image(['feature_proof'], ['front', 'in_hand', 'closeup']) } },
  frontOnly: { slots: { photo: image(['feature_proof'], ['front']) } },
  angles: { slots: { photo: image(['feature_proof'], ['front', 'angle45', 'side']) } },
  heroOnly: { slots: { photo: image(['hero'], ['front', 'closeup']) } },
  sceneOnly: { slots: { photo: image(['scene'], ['front', 'in_hand', 'in_use', 'worn']) } },
  underOnly: { slots: { photo: image(['underside'], ['front', 'in_hand', 'in_use']) } },
  actionOnly: { slots: { photo: image(['action'], ['front', 'in_hand', 'closeup']) } },
  actionAngles: { slots: { photo: image(['action'], ['front', 'angle45', 'side']) } },
  actionFront: { slots: { photo: image(['action'], ['front']) } },
  sizeNoTouch: { slots: { photo: image(['feature_proof', 'scale'], ['front', 'side']) } },
  sizeTouch: { slots: { photo: image(['feature_proof', 'scale'], ['front', 'in_hand']) } },
  under: { slots: { photo: image(['feature_proof', 'underside'], ['in_hand', 'in_use']) } },
  list: { slots: { rows: { type: 'list', min: 2, fields: { caption: { type: 'text' }, photo: image(['feature_proof', 'action', 'texture'], ['front', 'in_hand', 'closeup']) } } } },
  mixed: {
    slots: {
      photo: image(['feature_proof', 'action'], ['front', 'in_hand']),
      rows: { type: 'list', min: 1, fields: { caption: { type: 'text' }, photo: image(['feature_proof', 'action'], ['in_use', 'in_hand']) } },
    },
  },
  mismatch: { slots: {} },
}
vi.mock('./library', async (original) => {
  const real = await original<typeof import('./library')>()
  return { ...real, templateById: (id: string) => FAKE[id] ?? real.templateById(id) }
})

const row = (templateId: string, shots: Array<[string, string, string?]>, section = 'point_div'): OrderedSection =>
  ({ section, templateId, bg: 'P', shots: shots.map(([purpose, composition, slot]) => ({ slot: slot ?? 'photo', purpose, composition })) }) as unknown as OrderedSection
const hook = (): OrderedSection => row('wide', [['hero', 'front']], 'hook_3step')
const context = (over: Partial<RefineContext> = {}): RefineContext => ({ heroKind: 'studio', multiple: false, hasSize: true, materials: [], ...over })
const texts = (values: Record<number, CopyValues>) => new Map(Object.entries(values).map(([key, value]) => [Number(key), value]))
const plans = (sections: readonly OrderedSection[]) => sections.map((one) => one.shots.map((shot) => `${shot.purpose}|${shot.composition}`))

const PULL = '끈을 당기면 입구가 모여요'
const WALL = '욕실에 두고 써요'
const SOFT = '부드러운 실리콘 소재예요'

describe('글이 말하는 목적', () => {
  it('장소가 먼저고 다음은 구조·소재·크기·동작 순서다', () => {
    expect(wordPurposesOf('욕실 바닥에 두면 실리콘 소재가 넉넉하게 눌러 돼요', context())).toEqual(['scene', 'underside', 'texture', 'scale', 'action'])
  })
  it('크기 입력이 없으면 크기 낱말을 목적으로 보지 않는다', () => {
    expect(wordPurposesOf('넉넉한 크기', context({ hasSize: false }))).toEqual([])
    expect(wordPurposesOf('넉넉한 크기', context())).toEqual(['scale'])
  })
  it('사양 소재 낱말을 그대로 말하면 질감이다', () => {
    expect(wordPurposesOf('마 원단', context({ materials: ['마직'] }))).toEqual(['texture'])
    expect(wordPurposesOf('마직으로 만들어요', context({ materials: ['마직'] }))).toEqual(['texture'])
    expect(wordPurposesOf('좋아요', context({ materials: ['마직'] }))).toEqual([])
  })
})

describe('컷의 글', () => {
  it('목록 칸은 그 항목의 글, 없으면 섹션의 글이다', () => {
    const copy = { title: '제목', rows: [{ caption: '첫째' }, { caption: '둘째' }] } as unknown as CopyValues
    expect(shotTextOf(copy, { slot: 'rows.photo', item: 1 })).toEqual({ text: '둘째', own: true })
    expect(shotTextOf(copy, { slot: 'photo', item: 0 })).toEqual({ text: '제목', own: false })
    expect(shotTextOf(undefined, { slot: 'photo', item: 0 })).toEqual({ text: '', own: false })
  })
})

describe('목적 고치기', () => {
  it('슬롯이 받으면 목적과 어울리는 구도로 바꾼다', () => {
    const { sections, record } = refineShotsByCopy([hook(), row('wide', [['feature_proof', 'front']])], texts({ 1: { title: PULL } }), [], context())
    expect(plans(sections)[1]).toEqual(['underside|closeup'])
    expect(record).toMatchObject({ total: 1, worded: 1, matchedBefore: 0, matchedAfter: 1, purposeChanged: 1, compositionOnly: 0 })
  })
  it('장소 낱말은 장면 목적과 사용 구도로 바꾼다', () => {
    const { sections } = refineShotsByCopy([hook(), row('wide', [['feature_proof', 'front']])], texts({ 1: { title: WALL } }), [], context())
    expect(plans(sections)[1]).toEqual(['scene|in_use'])
  })
  it('이미 글과 맞는 컷은 그대로이고 맞음으로 센다', () => {
    const { sections, record } = refineShotsByCopy([hook(), row('wide', [['scene', 'front']])], texts({ 1: { title: WALL } }), [], context())
    expect(plans(sections)[1]).toEqual(['scene|front'])
    expect(record).toMatchObject({ matchedBefore: 1, matchedAfter: 1, purposeChanged: 0 })
  })
  it('낱말이 없는 글은 건드리지 않는다', () => {
    const { sections, record } = refineShotsByCopy([hook(), row('wide', [['feature_proof', 'front']])], texts({ 1: { title: '오늘도 좋아요' } }), [], context())
    expect(plans(sections)[1]).toEqual(['feature_proof|front'])
    expect(record).toMatchObject({ total: 1, worded: 0, purposeChanged: 0, compositionOnly: 0 })
  })
  it('글이 없는 칸은 건드리지 않는다', () => {
    const { sections, record } = refineShotsByCopy([hook(), row('wide', [['feature_proof', 'front']])], texts({}), [], context())
    expect(plans(sections)[1]).toEqual(['feature_proof|front'])
    expect(record.worded).toBe(0)
  })
  it('대표 컷은 글이 무엇을 말해도 바꾸지 않고 세지도 않는다', () => {
    const { sections, record } = refineShotsByCopy([hook()], texts({ 0: { title: WALL } }), [], context())
    expect(plans(sections)[0]).toEqual(['hero|front'])
    expect(record.total).toBe(0)
  })
  it.each(['problem', 'color', 'group', 'quantity', 'package', 'ingredient', 'state'])('%s 컷은 글이 바꾸지 않는다', (purpose) => {
    const { sections } = refineShotsByCopy([hook(), row('wide', [[purpose, 'front']])], texts({ 1: { title: WALL } }), [], context())
    expect(plans(sections)[1]).toEqual([`${purpose}|front`])
  })
  it('못 그리는 섹션의 컷은 세지도 바꾸지도 않는다', () => {
    const { sections, record } = refineShotsByCopy([hook(), row('wide', [['feature_proof', 'front']])], texts({ 1: { title: WALL } }), ['1:point_div'], context())
    expect(plans(sections)[1]).toEqual(['feature_proof|front'])
    expect(record.total).toBe(0)
  })
  it('슬롯 수가 컷 수와 다르면(모르는 템플릿) 그대로 둔다', () => {
    const { sections } = refineShotsByCopy([hook(), row('mismatch', [['feature_proof', 'front']])], texts({ 1: { title: WALL } }), [], context())
    expect(plans(sections)[1]).toEqual(['feature_proof|front'])
  })
})

describe('슬롯이 받지 않는 목적', () => {
  it('구도만 옮기고 목적은 그대로다', () => {
    const { sections, record } = refineShotsByCopy([hook(), row('actionOnly', [['action', 'front']])], texts({ 1: { title: SOFT } }), [], context())
    expect(plans(sections)[1]).toEqual(['action|closeup'])
    expect(record).toMatchObject({ worded: 1, matchedAfter: 0, purposeChanged: 0, compositionOnly: 1 })
  })
  it('각도만 바뀌는 구도로는 옮기지 않는다', () => {
    const { sections, record } = refineShotsByCopy([hook(), row('actionAngles', [['action', 'front']])], texts({ 1: { title: '바닥이 넓어요' } }), [], context())
    expect(plans(sections)[1]).toEqual(['action|front'])
    expect(record.compositionOnly).toBe(0)
  })
  it('글이 말하는 곳이 보이는 구도가 있으면 옮긴다', () => {
    const { sections } = refineShotsByCopy([hook(), row('actionOnly', [['action', 'front']])], texts({ 1: { title: '바닥이 넓어요' } }), [], context())
    expect(plans(sections)[1]).toEqual(['action|closeup'])
  })
  it('대표 목적 컷을 근접으로 옮기지 않는다', () => {
    const { sections } = refineShotsByCopy([hook(), row('heroOnly', [['hero', 'front']])], texts({ 1: { title: SOFT } }), [], context())
    expect(plans(sections)[1]).toEqual(['hero|front'])
  })
  it('장면 목적 컷은 손에 든 구도 대신 사용 구도로 옮긴다', () => {
    const { sections } = refineShotsByCopy([hook(), row('sceneOnly', [['scene', 'front']])], texts({ 1: { title: '당기면 돼요' } }), [], context())
    expect(plans(sections)[1]).toEqual(['scene|in_use'])
  })
  it('밑면 목적 컷은 손 구도로 옮기지 않는다', () => {
    const { sections } = refineShotsByCopy([hook(), row('underOnly', [['underside', 'front']])], texts({ 1: { title: '당기면 돼요' } }), [], context())
    expect(plans(sections)[1]).toEqual(['underside|front'])
  })
  it('지금 구도가 이미 어울리면 옮기지 않는다', () => {
    const { sections, record } = refineShotsByCopy([hook(), row('sceneOnly', [['scene', 'in_use']])], texts({ 1: { title: '당기면 돼요' } }), [], context())
    expect(plans(sections)[1]).toEqual(['scene|in_use'])
    expect(record.compositionOnly).toBe(0)
  })
  it('옮길 구도도 없으면 그대로다', () => {
    const { sections, record } = refineShotsByCopy([hook(), row('actionFront', [['action', 'front']])], texts({ 1: { title: '바닥이 넓어요' } }), [], context())
    expect(plans(sections)[1]).toEqual(['action|front'])
    expect(record.compositionOnly).toBe(0)
  })
})

describe('쓰임 증거 칸이 받는 증거 갈래(적용 K6 ⑤ R-K12)', () => {
  it('feature_proof 칸은 구조 글이면 밑면, 소재 글이면 질감 목적을 받는다 — 구도는 그 목적의 구도로', () => {
    const structure = refineShotsByCopy([hook(), row('proofOnly', [['feature_proof', 'front']])], texts({ 1: { title: PULL } }), [], context())
    expect(plans(structure.sections)[1]).toEqual(['underside|closeup'])
    expect(structure.record).toMatchObject({ worded: 1, matchedAfter: 1, purposeChanged: 1, compositionOnly: 0 })
    expect(plans(refineShotsByCopy([hook(), row('proofOnly', [['feature_proof', 'front']])], texts({ 1: { title: SOFT } }), [], context()).sections)[1]).toEqual(['texture|closeup'])
    // 칸이 받는 구도가 각도뿐이면 밑면을 받는 칸과 같이 그 각도로 간다
    expect(plans(refineShotsByCopy([hook(), row('angles', [['feature_proof', 'front']])], texts({ 1: { title: '바닥이 넓어요' } }), [], context()).sections)[1]).toEqual(['underside|angle45'])
  })
  it('크기는 열지 않는다 — 크기 글이면 손 구도로만 옮긴다', () => {
    const { sections, record } = refineShotsByCopy([hook(), row('proofOnly', [['feature_proof', 'front']])], texts({ 1: { title: '한 손에 들어와요' } }), [], context())
    expect(plans(sections)[1]).toEqual(['feature_proof|in_hand'])
    expect(record).toMatchObject({ purposeChanged: 0, compositionOnly: 1 })
  })
  it('feature_proof를 받지 않는 칸은 열지 않는다', () => {
    expect(plans(refineShotsByCopy([hook(), row('actionOnly', [['action', 'front']])], texts({ 1: { title: SOFT } }), [], context()).sections)[1]).toEqual(['action|closeup'])
    expect(plans(refineShotsByCopy([hook(), row('heroOnly', [['hero', 'front']])], texts({ 1: { title: '바닥이 넓어요' } }), [], context()).sections)[1]).toEqual(['hero|front'])
  })
  it('같은 목적 3연속·최소 장 수 규칙은 그대로 막는다', () => {
    const rows = [hook(), row('under', [['underside', 'in_hand']]), row('under', [['underside', 'in_use']]), row('proofOnly', [['feature_proof', 'front']])]
    const { sections } = refineShotsByCopy(rows, texts({ 3: { title: '바닥이 넓어요' } }), [], context())
    expect(sections[3].shots[0].purpose).toBe('feature_proof')
    // 하나뿐인 손 컷은 밑면 구도로 옮기지 않는다(손·몸 최소 장 수) — 규칙이 막은 컷으로 센다
    const kept = refineShotsByCopy([hook(), row('proofOnly', [['feature_proof', 'in_hand']])], texts({ 1: { title: '바닥이 넓어요' } }), [], context())
    expect(plans(kept.sections)[1]).toEqual(['feature_proof|in_hand'])
    expect(kept.record.blocked.rule).toBe(1)
    // 받는 낱말(밑면)이 규칙에 막히면 다른 낱말(동작)의 구도가 이미 맞아도 규칙으로 센다
    const both = refineShotsByCopy([hook(), row('proofOnly', [['feature_proof', 'in_hand']])], texts({ 1: { title: '바닥을 당기면 돼요' } }), [], context())
    expect(both.record.blocked).toMatchObject({ rule: 1, composition: 0 })
  })
})

describe('크기·밑면 구도', () => {
  it('크기는 손·몸 구도가 있어야 받는다', () => {
    const size = '한 손에 들어와요'
    const touch = refineShotsByCopy([hook(), row('sizeTouch', [['feature_proof', 'front']])], texts({ 1: { title: size } }), [], context())
    expect(plans(touch.sections)[1]).toEqual(['scale|in_hand'])
    const none = refineShotsByCopy([hook(), row('sizeNoTouch', [['feature_proof', 'front']])], texts({ 1: { title: size } }), [], context())
    expect(plans(none.sections)[1]).toEqual(['feature_proof|front'])
  })
  it('손 구도뿐인 슬롯은 밑면 목적을 받지 않는다', () => {
    const { sections } = refineShotsByCopy([hook(), row('under', [['feature_proof', 'in_hand']])], texts({ 1: { title: '바닥이 넓어요' } }), [], context())
    expect(plans(sections)[1]).toEqual(['feature_proof|in_hand'])
  })
})

describe('페이지 규칙', () => {
  // 앞선 두 컷과 짝이 겹치지 않게 둔다 — 같은 짝 상한이 먼저 막으면 이 규칙을 보지 못한다
  it('같은 목적이 앞에 둘 있으면 목적은 그대로 두고 구도만 옮긴다', () => {
    const rows = [hook(), row('wide', [['action', 'front']]), row('wide', [['action', 'in_use']]), row('wide', [['feature_proof', 'top']])]
    const { sections, record } = refineShotsByCopy(rows, texts({ 3: { title: '당기면 돼요' } }), [], context())
    expect(plans(sections)[3]).toEqual(['feature_proof|in_hand'])
    expect(record).toMatchObject({ purposeChanged: 0, compositionOnly: 1 })
  })
  it('같은 목적이 뒤에 둘 있어도 바꾸지 않는다', () => {
    const rows = [hook(), row('wide', [['feature_proof', 'top']]), row('wide', [['action', 'front']]), row('wide', [['action', 'in_use']])]
    const { sections } = refineShotsByCopy(rows, texts({ 1: { title: '당기면 돼요' } }), [], context())
    expect(plans(sections)[1]).toEqual(['feature_proof|in_hand'])
  })
  it('앞뒤에 하나씩 있어 셋이 되어도 바꾸지 않는다', () => {
    const rows = [hook(), row('wide', [['action', 'front']]), row('wide', [['feature_proof', 'top']]), row('wide', [['action', 'in_use']])]
    const { sections } = refineShotsByCopy(rows, texts({ 2: { title: '당기면 돼요' } }), [], context())
    expect(plans(sections)[2]).toEqual(['feature_proof|in_hand'])
  })
  it('둘까지는 이어져도 바꾼다', () => {
    const rows = [hook(), row('wide', [['action', 'front']]), row('wide', [['feature_proof', 'top']])]
    const { sections } = refineShotsByCopy(rows, texts({ 2: { title: '당기면 돼요' } }), [], context())
    expect(plans(sections)[2]).toEqual(['action|in_hand'])
  })
  it('같은 짝을 초안의 최다 반복보다 많이 만들지 않는다', () => {
    const rows = [hook(), row('wide', [['scene', 'in_use']]), row('wide', [['feature_proof', 'front']])]
    const { sections } = refineShotsByCopy(rows, texts({ 2: { title: WALL } }), [], context())
    expect(plans(sections)[2]).toEqual(['feature_proof|in_use'])
  })
  it('손·몸 최소 장 수를 깨면서 구도를 옮기지 않는다', () => {
    const rows = [hook(), row('wide', [['feature_proof', 'in_hand']]), row('wide', [['feature_proof', 'in_hand']])]
    const { sections } = refineShotsByCopy(rows, texts({ 1: { title: SOFT } }), [], context())
    expect(plans(sections)[1]).toEqual(['feature_proof|in_hand'])
  })
  it('최소를 넘는 컷은 옮길 수 있다', () => {
    const rows = [hook(), row('wide', [['feature_proof', 'in_hand']]), row('wide', [['feature_proof', 'in_hand']]), row('wide', [['feature_proof', 'in_use']]), row('wide', [['feature_proof', 'in_hand']])]
    const { sections } = refineShotsByCopy(rows, texts({ 1: { title: SOFT } }), [], context())
    expect(plans(sections)[1]).toEqual(['texture|closeup'])
  })
  it('하나뿐인 손 크기 컷을 없애지 않는다', () => {
    const rows = [hook(), row('sizeTouch', [['scale', 'in_hand']]), row('wide', [['feature_proof', 'in_hand']])]
    const { sections, record } = refineShotsByCopy(rows, texts({ 1: { title: '오늘도 좋아요' } }), [], context())
    expect(plans(sections)[1]).toEqual(['scale|in_hand'])
    expect(record.purposeChanged).toBe(0)
  })
})

describe('섹션 글과 항목 글', () => {
  it('섹션 글을 같이 쓰는 컷은 같은 말을 한 번만 그린다', () => {
    const rows = [hook(), row('two', [['feature_proof', 'front', 'a'], ['feature_proof', 'closeup', 'b']])]
    const { sections } = refineShotsByCopy(rows, texts({ 1: { title: '당기면 돼요' } }), [], context())
    expect(plans(sections)[1]).toEqual(['action|in_hand', 'feature_proof|closeup'])
  })
  it('섹션 글이 두 가지를 말하면 컷마다 다른 말을 그린다', () => {
    const rows = [hook(), row('two', [['feature_proof', 'front', 'a'], ['feature_proof', 'front', 'b']])]
    const { sections } = refineShotsByCopy(rows, texts({ 1: { title: `${SOFT} 당기면 돼요` } }), [], context())
    expect(plans(sections)[1]).toEqual(['texture|closeup', 'action|in_hand'])
  })
  it('이미 그 말을 그리는 컷이 있으면 섹션 글을 같이 쓰는 다음 컷은 그 말을 그리지 않는다', () => {
    const rows = [hook(), row('two', [['action', 'front', 'a'], ['feature_proof', 'front', 'b']])]
    const { sections } = refineShotsByCopy(rows, texts({ 1: { title: '당기면 돼요' } }), [], context())
    expect(plans(sections)[1]).toEqual(['action|front', 'feature_proof|front'])
  })
  it('섹션 글이 먼저 그린 말이어도 항목은 자기 글을 그린다', () => {
    const rows = [hook(), row('mixed', [['feature_proof', 'front', 'photo'], ['feature_proof', 'in_use', 'rows.photo']])]
    const copy = { title: '당기면 돼요', rows: [{ caption: '당기면 돼요' }] } as unknown as CopyValues
    const { sections } = refineShotsByCopy(rows, texts({ 1: copy }), [], context())
    expect(plans(sections)[1]).toEqual(['action|in_hand', 'action|in_use'])
  })
  it('항목은 자기 글을 따른다', () => {
    const rows = [hook(), row('list', [['feature_proof', 'front', 'rows.photo'], ['feature_proof', 'front', 'rows.photo']])]
    const copy = { rows: [{ caption: SOFT }, { caption: '당기면 돼요' }] } as unknown as CopyValues
    const { sections } = refineShotsByCopy(rows, texts({ 1: copy }), [], context())
    expect(plans(sections)[1]).toEqual(['texture|closeup', 'action|in_hand'])
  })
})

describe('못 맞춘 까닭', () => {
  it('글이 정하지 않는 컷·슬롯이 받지 않는 컷·규칙이 막은 컷을 나눠 센다', () => {
    const fixed = refineShotsByCopy([hook(), row('wide', [['problem', 'front']])], texts({ 1: { title: WALL } }), [], context())
    expect(fixed.record.blocked).toEqual({ fixed: 1, said: 0, composition: 0, slot: 0, rule: 0 })
    const slot = refineShotsByCopy([hook(), row('frontOnly', [['feature_proof', 'front']])], texts({ 1: { title: WALL } }), [], context())
    expect(slot.record.blocked).toEqual({ fixed: 0, said: 0, composition: 0, slot: 1, rule: 0 })
    const rule = refineShotsByCopy([hook(), row('sizeNoTouch', [['feature_proof', 'front']])], texts({ 1: { title: '한 손에 들어와요' } }), [], context())
    expect(rule.record.blocked).toEqual({ fixed: 0, said: 0, composition: 0, slot: 0, rule: 1 })
  })
  it('같은 섹션 다른 컷이 이미 그린 말과 지금 구도가 이미 그 말인 컷은 따로 센다(적용 K6 ⑤ R-K12)', () => {
    const said = refineShotsByCopy([hook(), row('two', [['feature_proof', 'front', 'a'], ['feature_proof', 'front', 'b']])], texts({ 1: { title: SOFT } }), [], context())
    expect(plans(said.sections)[1]).toEqual(['texture|closeup', 'feature_proof|front'])
    expect(said.record.blocked).toEqual({ fixed: 0, said: 1, composition: 0, slot: 0, rule: 0 })
    const composition = refineShotsByCopy([hook(), row('sceneOnly', [['scene', 'in_use']])], texts({ 1: { title: '당기면 돼요' } }), [], context())
    expect(composition.record.blocked).toEqual({ fixed: 0, said: 0, composition: 1, slot: 0, rule: 0 })
  })
  it('낱말 컷은 맞음·구도만·까닭 다섯 가운데 하나로 한 번만 센다', () => {
    const rows = [
      hook(),
      row('wide', [['problem', 'front']]),
      row('two', [['feature_proof', 'front', 'a'], ['feature_proof', 'front', 'b']]),
      row('sceneOnly', [['scene', 'in_use']]),
      row('frontOnly', [['feature_proof', 'front']]),
      row('sizeNoTouch', [['feature_proof', 'front']]),
      row('actionOnly', [['action', 'front']]),
      row('wide', [['scene', 'front']]),
    ]
    const { record } = refineShotsByCopy(rows, texts({ 1: { title: WALL }, 2: { title: SOFT }, 3: { title: '당기면 돼요' }, 4: { title: WALL }, 5: { title: '한 손에 들어와요' }, 6: { title: SOFT }, 7: { title: WALL } }), [], context())
    const { fixed, said, composition, slot, rule } = record.blocked
    expect([fixed, said, composition, slot, rule]).toEqual([1, 1, 1, 1, 1])
    expect(record.worded).toBe(record.matchedAfter + record.compositionOnly + fixed + said + composition + slot + rule)
  })
  it('맞췄으면 까닭을 세지 않는다', () => {
    const { record } = refineShotsByCopy([hook(), row('wide', [['feature_proof', 'front']])], texts({ 1: { title: WALL } }), [], context())
    expect(record.blocked).toEqual({ fixed: 0, said: 0, composition: 0, slot: 0, rule: 0 })
  })
})

describe('결과', () => {
  it('입력을 고치지 않고 슬롯 순서는 그대로이며 같은 입력이면 같은 값이다', () => {
    const rows = [hook(), row('two', [['feature_proof', 'front', 'a'], ['feature_proof', 'front', 'b']])]
    const before = JSON.stringify(rows)
    const first = refineShotsByCopy(rows, texts({ 1: { title: SOFT } }), [], context())
    expect(JSON.stringify(rows)).toBe(before)
    expect(first.sections[1].shots.map((shot) => shot.slot)).toEqual(['a', 'b'])
    expect(refineShotsByCopy(rows, texts({ 1: { title: SOFT } }), [], context())).toEqual(first)
  })
  it('글을 기록에 남기지 않는다', () => {
    const { record } = refineShotsByCopy([hook(), row('wide', [['feature_proof', 'front']])], texts({ 1: { title: WALL } }), [], context())
    expect(JSON.stringify(record)).not.toMatch(/[가-힣]/)
  })
})
