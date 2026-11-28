import { describe, expect, it } from 'vitest'
import { getPdpTestProduct, PDP_TEST_PRODUCT_IDS } from '../__fixtures__/pdp-products'
import { heroKindOf } from '../hero-kind'
import type { PdpJobRow, PdpSpecSheet } from '../pdp-state'
import { CONCEPTS } from './concepts'
import { hasManyItems, lineInputsOf } from './input-values'
import { TEMPLATES } from './library'
import { selectTemplateLine, type TemplateAgents } from './select-line'
import { imageSlots } from './selection-order'
import { assignShotRows, firstSlotFits, isTouchScale, shotKeyOf, SHOT_MINIMUM, TOUCH_COMPOSITIONS, type ShotContext, type ShotSlot } from './shot-assign'
import type { TemplateMeta } from './template-meta'
import { yieldToEventLoop } from './__test__/yield'

const slot = (composition: string[], purpose: string[] = ['scene'], name = 'photo'): ShotSlot => ({ slot: name, def: { type: 'image', required: true, purpose, composition } })
const context = (over: Partial<ShotContext> = {}): ShotContext => ({ heroKind: 'studio', multiple: true, hasSize: false, ...over })
const flat = (rows: ReadonlyArray<ReadonlyArray<{ purpose: string; composition: string }>>) => rows.flat()

describe('컷 배정 규칙', () => {
  it('착용 구도는 착용 상품만 받고, 슬롯이 그것뿐이면 사용 구도로 내린다', () => {
    const rows = [[slot(['front'])], [slot(['worn', 'in_use'])], [slot(['worn'])]]
    expect(flat(assignShotRows(rows, context())).map((s) => s.composition)).toEqual(['front', 'in_use', 'in_use'])
    expect(flat(assignShotRows(rows, context({ heroKind: 'worn' }))).filter((s) => s.composition === 'worn').length).toBeGreaterThan(0)
  })

  it('첫 컷은 첫 화면 유형을 따른다 — 슬롯이 받지 않아도 그 유형이다', () => {
    const first = (heroKind: ShotContext['heroKind'], composition: string[]) => assignShotRows([[slot(composition, ['hero', 'scene'])]], context({ heroKind }))[0][0]
    expect(first('studio', ['in_use', 'front'])).toMatchObject({ purpose: 'hero', composition: 'front' })
    expect(first('in_use', ['front', 'in_use'])).toMatchObject({ purpose: 'scene', composition: 'in_use' })
    expect(first('in_use', ['front'])).toMatchObject({ composition: 'in_use' })
    expect(first('worn', ['front'])).toMatchObject({ composition: 'worn' })
    expect(first('studio', ['in_use'])).toMatchObject({ composition: 'front' })
  })

  it('붙인 컷 칸이 첫 화면 유형과 맞는다는 판정은 실제 첫 컷이 그 칸이 받는 닿는 구도인 것과 같다(적용 K6 R-K15)', () => {
    const slots = [
      slot(['in_use', 'top', 'front'], ['state', 'hero']),
      slot(['in_use', 'group'], ['state', 'group']),
      slot(['in_use'], ['state', 'action']),
      slot(['worn', 'in_use'], ['scene', 'action']),
      slot(['worn'], ['hero']),
      slot(['in_hand', 'front'], ['state', 'hero']),
    ]
    for (const heroKind of ['studio', 'in_use', 'worn'] as const) {
      for (const one of slots) {
        const first = assignShotRows([[one]], context({ heroKind }))[0][0]
        expect(firstSlotFits(one.def, context({ heroKind })), `${heroKind} ${one.def.composition}`).toBe(TOUCH_COMPOSITIONS.includes(first.composition) && one.def.composition.includes(first.composition))
      }
    }
  })

  it('붙인 컷 칸(맨 앞 목적 state·맨 앞 구도 worn)은 첫 화면 유형이 그 칸이 받는 닿는 구도를 낼 때만 맞다(적용 K6 R-K15)', () => {
    const fits = (heroKind: ShotContext['heroKind'], composition: string[], purpose: string[]) => firstSlotFits(slot(composition, purpose).def, context({ heroKind }))
    // P11 스티커 첫 칸 — 스튜디오면 hero|front 놓인 컷이 된다
    expect(fits('studio', ['in_use', 'top', 'front'], ['state', 'hero'])).toBe(false)
    expect(fits('in_use', ['in_hand', 'front'], ['state', 'hero'])).toBe(true)
    expect(fits('in_use', ['in_use', 'top', 'front'], ['state', 'hero'])).toBe(true)
    expect(fits('worn', ['in_use', 'top', 'front'], ['state', 'hero'])).toBe(false)
    expect(fits('studio', ['in_use', 'group'], ['state', 'group'])).toBe(false)
    // 입은 모습 칸 — 쓰는 모습 유형은 칸이 받는 in_use로 간다
    expect(fits('studio', ['worn', 'in_use'], ['scene', 'action'])).toBe(false)
    expect(fits('in_use', ['worn', 'in_use'], ['scene', 'action'])).toBe(true)
    expect(fits('worn', ['worn', 'in_use'], ['scene', 'action'])).toBe(true)
    // 붙인 컷 칸이 아니면 늘 맞다 — 둘째 값이 state·worn이어도, 사진 칸이 없어도
    for (const heroKind of ['studio', 'in_use', 'worn'] as const) {
      expect(fits(heroKind, ['in_use', 'front'], ['hero', 'scene'])).toBe(true)
      expect(fits(heroKind, ['front', 'worn'], ['hero', 'state'])).toBe(true)
      expect(firstSlotFits(undefined, context({ heroKind }))).toBe(true)
    }
  })

  it('둘째 슬롯부터는 슬롯이 받는 값을 넘지 않는다', () => {
    const rows = [[slot(['front'])], [slot(['side', 'top'], ['texture'])], [slot(['side', 'top'], ['texture'])]]
    const [, ...rest] = assignShotRows(rows, context())
    for (const shot of rest.flat()) {
      expect(['side', 'top']).toContain(shot.composition)
      expect(shot.purpose).toBe('texture')
    }
  })

  it('구성이 하나인 상품은 여러 개 구도·목적을 받지 않는다', () => {
    const rows = [[slot(['front'])], [slot(['group', 'top'], ['group', 'hero'])], [slot(['group'], ['group'])]]
    const shots = flat(assignShotRows(rows, context({ multiple: false })))
    expect(shots.some((s) => s.composition === 'group')).toBe(false)
    expect(shots.some((s) => s.purpose === 'group')).toBe(false)
    expect(shots[2]).toMatchObject({ purpose: 'hero', composition: 'front' })
  })

  it('재료 목적은 입력에 재료 이름이 있을 때만 고른다 — 값이 없으면 문맥이 없어도 못 고른다', () => {
    const rows = [[slot(['front'])], [slot(['top'], ['ingredient', 'texture'])], [slot(['side'], ['ingredient'])]]
    const purposes = (over?: ShotContext) => flat(assignShotRows(rows, over)).map((shot) => shot.purpose)
    for (const over of [undefined, context(), context({ multiple: false }), context({ namedIngredient: false })]) {
      expect(purposes(over)).not.toContain('ingredient')
      // 재료만 받는 칸도 비지 않는다
      expect(purposes(over).at(-1)).toBe('hero')
    }
    expect(purposes(context({ namedIngredient: true }))).toContain('ingredient')
    expect(purposes(context({ namedIngredient: true, multiple: false }))).toContain('ingredient')
  })

  it('크기 입력이 있으면 크기 컷이 생기고, 없으면 지어내지 않는다', () => {
    const rows = [[slot(['front'])], [slot(['closeup'], ['texture'])], [slot(['in_hand', 'top'])], [slot(['in_use'], ['problem'])]]
    const sized = flat(assignShotRows(rows, context({ hasSize: true })))
    expect(sized[2]).toMatchObject({ purpose: 'scale', composition: 'in_hand' })
    expect(sized[0].purpose).not.toBe('scale')
    expect(sized[3].purpose).toBe('problem')
    expect(flat(assignShotRows(rows, context())).some((s) => s.purpose === 'scale')).toBe(false)
    // 슬롯이 크기를 받아도 손·몸에 닿는 구도일 때만 쓴다
    expect(flat(assignShotRows([[slot(['front'])], [slot(['in_hand'], ['scene', 'scale'])]], context({ hasSize: true })))[1]).toMatchObject({ purpose: 'scale', composition: 'in_hand' })
    expect(flat(assignShotRows([[slot(['front'])], [slot(['front'], ['scene', 'scale'])]], context({ hasSize: true })))[1].purpose).toBe('scene')
    // 손·사용 구도를 받는 슬롯이 없으면 못 만든 대로 둔다
    expect(flat(assignShotRows([[slot(['front'])], [slot(['top'])]], context({ hasSize: true }))).some((s) => s.purpose === 'scale')).toBe(false)
  })

  it('치수 섹션 사진은 크기 감 컷으로 세지 않는다 — 치수 컷은 두고 손·몸에 닿는 컷을 따로 만든다', () => {
    const dimension = slot(['front'], ['scale'])
    const shots = flat(assignShotRows([[slot(['front'])], [slot(['in_use', 'top'])], [slot(['closeup'], ['texture'])], [dimension]], context({ hasSize: true })))
    expect(shots[3]).toMatchObject({ purpose: 'scale', composition: 'front' })
    expect(shots[1]).toMatchObject({ purpose: 'scale', composition: 'in_use' })
    expect(shots.filter(isTouchScale)).toHaveLength(1)
    // 크기 입력이 없으면 치수 슬롯만 두고 더 만들지 않는다
    expect(flat(assignShotRows([[slot(['front'])], [slot(['in_use', 'top'])], [dimension]], context())).filter(isTouchScale)).toHaveLength(0)
  })

  it('크기 컷을 따로 만들 때 이미 손·몸에 닿는 슬롯을 먼저 고르고 근접 컷을 깎지 않는다', () => {
    const rows = [[slot(['front'])], [slot(['closeup', 'in_hand'], ['texture'])], [slot(['closeup', 'in_hand'], ['texture'])], [slot(['in_hand'])], [slot(['closeup'], ['texture'])], [slot(['closeup'], ['texture'])]]
    const shots = flat(assignShotRows(rows, context({ hasSize: true })))
    const scale = shots.filter(isTouchScale)
    expect(scale).toHaveLength(1)
    expect(shots.filter((s) => s.composition === 'closeup').length).toBeGreaterThanOrEqual(SHOT_MINIMUM.closeup)
  })

  it('착용 상품은 슬롯이 착용만 받아도 크기 컷을 만든다', () => {
    const shots = flat(assignShotRows([[slot(['worn'])], [slot(['worn', 'top'])]], context({ heroKind: 'worn', hasSize: true })))
    expect(shots[1]).toMatchObject({ purpose: 'scale', composition: 'worn' })
  })

  it('최소 장 수를 먼저 채우고, 슬롯이 받으면 같은 목적을 세 번 잇지 않는다', () => {
    const rows = Array.from({ length: 6 }, () => [slot(['closeup', 'in_hand', 'front'], ['scene', 'texture'])])
    const shots = flat(assignShotRows(rows, context()))
    expect(shots.filter((s) => s.composition === 'closeup').length).toBeGreaterThanOrEqual(SHOT_MINIMUM.closeup)
    expect(shots.filter((s) => s.composition === 'in_hand').length).toBeGreaterThanOrEqual(SHOT_MINIMUM.handOrWorn)
    for (let i = 2; i < shots.length; i++) expect(new Set([shots[i - 2].purpose, shots[i - 1].purpose, shots[i].purpose]).size).toBeGreaterThan(1)
    // 최소 장 수가 없으면 슬롯이 받는 쌍을 겹치지 않게 쓴다
    expect(new Set(flat(assignShotRows(rows)).map(shotKeyOf)).size).toBe(rows.length)
  })

  describe('같은 목적 3연속 끊기(적용 K6 ④ T1-51)', () => {
    const scene = slot(['front'], ['scene'])
    const purposesOf = (rows: ShotSlot[][], over: Partial<ShotContext> = {}) => flat(assignShotRows(rows, context(over))).map((s) => s.purpose)
    const compositionsOf = (rows: ShotSlot[][], over: Partial<ShotContext> = {}) => flat(assignShotRows(rows, context(over))).map((s) => s.composition)

    it('셋째 칸이 그 목적뿐이면 같은 섹션 앞 이웃 하나를 그 칸이 받는 다른 목적으로 바꾼다 — 구도·컷 수는 그대로다', () => {
      // 앞 섹션이 scene을 두 번 써서 다음 섹션 앞 두 칸이 texture로 가고, 셋째 칸은 texture만 받는다
      const rows = [[slot(['front'], ['hero'])], [scene, scene], [slot(['top'], ['texture', 'scene']), slot(['side'], ['texture', 'scene']), slot(['closeup'], ['texture'])]]
      expect(purposesOf(rows)).toEqual(['hero', 'scene', 'scene', 'texture', 'scene', 'texture'])
      expect(compositionsOf(rows)).toEqual(['front', 'front', 'front', 'top', 'side', 'closeup'])
      // 셋째 칸이 손·몸 구도 없이 크기 목적도 받으면 그 목적뿐인 칸이다. 이웃도 크기 목적으로 바꾸지 않는다(닿지 않는 크기 컷이 생긴다)
      const scaleToo = [[slot(['front'], ['hero'])], [scene, scene], [slot(['top'], ['texture', 'scene']), slot(['side'], ['texture', 'scale', 'scene']), slot(['closeup'], ['texture', 'scale'])]]
      expect(purposesOf(scaleToo)).toEqual(['hero', 'scene', 'scene', 'texture', 'scene', 'texture'])
    })

    it('바로 앞 이웃이 못 바꾸면 그 앞 이웃을 바꾸고, 바꾸면 새 3연속이 생기는 자리는 그대로 둔다', () => {
      const tail = [slot(['top'], ['texture', 'scene']), slot(['side'], ['texture']), slot(['closeup'], ['texture'])]
      expect(purposesOf([[slot(['front'], ['hero'])], [scene, slot(['front'], ['color'])], tail])).toEqual(['hero', 'scene', 'color', 'scene', 'texture', 'texture'])
      // 앞 섹션이 scene 두 번이면 scene으로 바꿀 때 새 3연속이 생겨 그대로다
      expect(purposesOf([[slot(['front'], ['hero'])], [scene, scene], tail])).toEqual(['hero', 'scene', 'scene', 'texture', 'texture', 'texture'])
      // 둘 다 바꿀 수 있으면 바로 앞 이웃을 바꾼다
      const both = [slot(['top'], ['texture', 'scene']), slot(['side'], ['texture', 'scene']), slot(['closeup'], ['texture'])]
      expect(purposesOf([[slot(['front'], ['hero'])], [scene, slot(['front'], ['color'])], both])).toEqual(['hero', 'scene', 'color', 'texture', 'scene', 'texture'])
    })

    it('바꿀 목적이 여럿이면 페이지에 덜 쓴 목적을 고른다', () => {
      const rows = [[slot(['front'], ['hero'])], [slot(['top'], ['color']), slot(['front'], ['color']), slot(['top'], ['scene'])], [slot(['top'], ['texture', 'scene', 'color']), slot(['side'], ['texture']), slot(['closeup'], ['texture'])]]
      expect(purposesOf(rows)).toEqual(['hero', 'color', 'color', 'scene', 'scene', 'texture', 'texture'])
    })

    it('다른 섹션 이웃은 바꾸지 않는다', () => {
      const rows = [[slot(['front'], ['hero'])], [scene, scene], [slot(['top'], ['texture', 'scene']), slot(['side'], ['texture', 'scene'])], [slot(['closeup'], ['texture'])]]
      expect(purposesOf(rows)).toEqual(['hero', 'scene', 'scene', 'texture', 'texture', 'texture'])
    })

    it('세 칸 모두 그 목적뿐이면 그대로다', () => {
      const problem = slot(['in_use'], ['problem'])
      expect(purposesOf([[slot(['front'], ['hero'])], [problem, problem, problem]])).toEqual(['hero', 'problem', 'problem', 'problem'])
    })

    it('첫 컷과 크기 컷은 바꾸지 않는다', () => {
      // 첫 컷은 다른 목적을 받아도 첫 화면 유형 목적 그대로다
      expect(purposesOf([[slot(['front'], ['hero', 'scene']), slot(['top'], ['hero']), slot(['side'], ['hero'])]])).toEqual(['hero', 'hero', 'hero'])
      // 손에 닿는 크기 컷은 다른 목적을 받아도 크기 컷 그대로다(치수 칸이 뒤에 이어져도)
      const dimension = slot(['front'], ['scale'])
      const shots = flat(assignShotRows([[slot(['front'], ['hero'])], [slot(['in_hand'], ['scale', 'scene']), dimension, dimension]], context({ hasSize: true })))
      expect(shots.map((s) => s.purpose)).toEqual(['hero', 'scale', 'scale', 'scale'])
      expect(shots.filter(isTouchScale)).toHaveLength(1)
    })
  })

  it('여러 개를 보여 줄 수 있는지는 구성 수나 옵션 수로 본다', () => {
    const spec = (over: Partial<PdpSpecSheet>) => ({ spec: over as PdpSpecSheet })
    expect(hasManyItems(spec({}))).toBe(false)
    expect(hasManyItems(spec({ colorOptions: ['검정'] }))).toBe(false)
    expect(hasManyItems(spec({ colorOptions: ['검정', '흰색'] }))).toBe(true)
    expect(hasManyItems(spec({ extraSpecs: [{ key: '구성', value: '3개입' }] } as Partial<PdpSpecSheet>))).toBe(true)
    expect(hasManyItems(spec({ extraSpecs: [{ key: '구성', value: '1개' }] } as Partial<PdpSpecSheet>))).toBe(false)
    expect(hasManyItems({ ...spec({}), options: [{ label: 'A', image: null }, { label: 'B', image: null }] })).toBe(true)
  })
})

describe('시험 상품 전 컨셉', () => {
  const free = <T,>(value: T) => ({ value, usedFallback: false, error: null, costUsd: 0 })
  const agentsFor = (conceptId: string) =>
    ({
      guideline: async () => free({ persona: '', tone: '', concept: { id: conceptId, reason: '' }, alternatives: [] }),
      compose: async () => free([]),
      select: async ({ slots }: { slots: Array<{ index: number; candidates: Array<{ id: string }> }> }) => free(slots.map((s) => ({ index: s.index, templateId: s.candidates[0].id, reason: '' }))),
    }) as unknown as TemplateAgents

  it('11상품 × 44컨셉에서 착용·첫 컷·여러 개·크기·최소 장 수 위반이 없다', async () => {
    let pages = 0
    for (const id of PDP_TEST_PRODUCT_IDS) {
      const product = getPdpTestProduct(id)
      const inputs = lineInputsOf({ spec_sheet: product.specSheet, analysis: {}, copy_sections: { final: { options: product.specSheet.colorOptions ?? [] } } } as unknown as PdpJobRow)
      const kind = heroKindOf(product.specSheet, product.categoryKey, false).kind
      const many = hasManyItems(inputs)
      for (const concept of CONCEPTS) {
        await yieldToEventLoop()
        const { order } = await selectTemplateLine(
          {
            key: id,
            categoryKey: product.categoryKey,
            productHex: null,
            spec: product.specSheet,
            templates: TEMPLATES as unknown as TemplateMeta[],
            inputs,
            product: { category: product.categoryKey, persona: null, summary: '', keywords: [], usps: [], pains: [] },
          },
          agentsFor(concept.id)
        )
        pages++
        const label = `${id}·${concept.id}`
        const shots = order.sections.flatMap((s) => s.shots)
        const first = order.sections[0].shots[0]
        if (kind !== 'worn') expect(shots.filter((s) => s.composition === 'worn').length, label).toBe(0)
        if (kind === 'worn') expect(first.composition, label).toBe('worn')
        if (kind === 'in_use') expect(['in_use', 'in_hand'], label).toContain(first.composition)
        if (kind === 'studio') expect(['worn', 'in_use', 'in_hand'], label).not.toContain(first.composition)
        // 첫 화면 템플릿의 첫 사진 칸이 첫 화면 유형과 맞다 — 붙인 컷 칸에 놓인 컷이 나오지 않는다(적용 K6 R-K15)
        const hook = (TEMPLATES as unknown as TemplateMeta[]).find((t) => t.id === order.sections[0].templateId)!
        expect(firstSlotFits(imageSlots(hook)[0]?.def, { heroKind: kind }), label).toBe(true)
        if (!many) expect(shots.filter((s) => s.composition === 'group' || s.purpose === 'group' || s.purpose === 'quantity').length, label).toBe(0)
        if (many) expect(shots.filter((s) => s.composition === 'group').length, label).toBeGreaterThanOrEqual(SHOT_MINIMUM.group)
        if (product.specSheet.size) expect(shots.filter(isTouchScale).length, label).toBeGreaterThanOrEqual(SHOT_MINIMUM.scale)
        expect(shots.filter((s) => s.composition === 'in_hand' || s.composition === 'worn').length, label).toBeGreaterThanOrEqual(SHOT_MINIMUM.handOrWorn)
        expect(shots.filter((s) => s.composition === 'closeup').length, label).toBeGreaterThanOrEqual(SHOT_MINIMUM.closeup)
        const keys = shots.map(shotKeyOf)
        const same = keys.filter((key, i) => i > 0 && key === keys[i - 1]).length
        expect(same / Math.max(1, keys.length - 1), label).toBeLessThanOrEqual(0.3)
      }
    }
    expect(pages).toBe(PDP_TEST_PRODUCT_IDS.length * CONCEPTS.length)
  }, 120000)
})
