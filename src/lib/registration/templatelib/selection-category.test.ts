/**
 * K 라인 카테고리·제품군 템플릿 고르기 — 안 맞으면 뺀다, 가점, 페이지 family, 후보 몫. 템플릿은 가짜 메타데이터다. LLM·DB 없음.
 */

import { describe, expect, it } from 'vitest'
import { PDP_CATEGORY_KEYS } from '../__fixtures__/pdp-products'
import { specSheetPromptJson, type PdpSpecSheet } from '../pdp-state'
import { CONCEPTS, conceptById } from './concepts'
import { PRODUCT_FAMILIES, productFamilyOf } from './product-family'
import { selectTemplateLine, type TemplateAgents } from './select-line'
import { CANDIDATE_LIMIT, CATEGORY_CANDIDATE_SHARE, FIT_BONUS, buildSelectionRecord, candidatesFor, pickPageFamily, type SelectionProfile } from './selection'
import { tpl, type TplOptions } from './selection.fixture'
import { K_SECTIONS } from './template-meta'

const concept = conceptById('clean-trust')!
/** 컨셉과 밀도가 다른 값 — 밀도 가점을 받지 않는다 */
const otherDensity = concept.density === 'high' ? 'low' : 'high'
const profile = (over: Partial<SelectionProfile> = {}): SelectionProfile => ({ key: 'P01', categoryKey: 'pet', photoCount: 9, productHex: null, evidence: new Set(), ...over })
const a = (id: string, over: Partial<TplOptions> = {}) => tpl(`main_cut.${id}`, over)
const ids = (list: ReadonlyArray<{ id: string }>) => list.map((t) => t.id.split('.')[1])
const pick = (templates: ReturnType<typeof a>[], over: Partial<SelectionProfile> = {}, limit?: number) => ids(candidatesFor('main_cut', templates, profile(over), concept, limit))

describe('안 맞으면 뺀다', () => {
  it('다른 카테고리 템플릿은 쓰지 않는다 — 칸이 비면 공용이다', () => {
    const list = [a('common'), a('empty', { categories: [] }), a('pet', { categories: ['pet'] }), a('food', { categories: ['food'] }), a('both', { categories: ['food', 'pet'] })]
    expect(pick(list).sort()).toEqual(['both', 'common', 'empty', 'pet'])
  })

  it('제품군이 다르면 쓰지 않는다, 제품군 값이 없는 상품에는 제품군 지정 템플릿을 쓰지 않는다', () => {
    const list = [a('common'), a('goods', { categories: ['pet'], productFamilies: ['pet_goods'] }), a('feed', { categories: ['pet'], productFamilies: ['pet_food'] })]
    expect(pick(list).sort()).toEqual(['common'])
    expect(pick(list, { productFamily: 'pet_goods' }).sort()).toEqual(['common', 'goods'])
  })

  it('막힌 카테고리가 먼저다', () => {
    expect(pick([a('x', { categories: ['pet'], block: ['pet'] })])).toEqual([])
  })
})

describe('가점', () => {
  it('값은 시작값이고 합이 컨셉 적합보다 작다', () => {
    expect(FIT_BONUS).toEqual({ category: 1.5, productFamily: 0.5, pageFamily: 0.5 })
    expect(FIT_BONUS.category + FIT_BONUS.productFamily + FIT_BONUS.pageFamily).toBeLessThan(3)
  })

  it('카테고리가 맞으면 공용보다 앞선다 — 밀도 일치(+1)를 넘는다', () => {
    const list = [a('common', { density: concept.density }), a('pet', { density: otherDensity, categories: ['pet'] })]
    expect(pick(list)[0]).toBe('pet')
  })

  it('컨셉 맞는 공용을 가점 합으로 뒤집지 못한다', () => {
    const list = [a('fit', { concepts: [concept.id], density: otherDensity }), a('target', { density: otherDensity, categories: ['pet'], productFamilies: ['pet_goods'], family: 'f1' })]
    expect(pick(list, { productFamily: 'pet_goods', pageFamily: 'f1' })[0]).toBe('fit')
  })

  it('제품군과 페이지 family가 같으면 앞선다', () => {
    const list = [a('plain', { categories: ['pet'] }), a('goods', { categories: ['pet'], productFamilies: ['pet_goods'] })]
    expect(pick(list, { productFamily: 'pet_goods' })[0]).toBe('goods')
    const families = [a('other', { family: 'f2' }), a('same', { family: 'f1' })]
    expect(pick(families, { pageFamily: 'f1' })[0]).toBe('same')
  })

  it('공용만 있으면 제품군·family가 있어도 결과가 같다', () => {
    const list = Array.from({ length: 8 }, (_, i) => a(`t${i}`, { used: i * 3, avg: i % 3 }))
    expect(pick(list, { productFamily: 'pet_goods', pageFamily: 'f1' })).toEqual(pick(list))
  })
})

describe('후보 몫', () => {
  const targets = (n: number) => Array.from({ length: n }, (_, i) => a(`pet${i}`, { categories: ['pet'] }))
  const commons = (n: number) => Array.from({ length: n }, (_, i) => a(`common${i}`))
  const isTarget = (id: string) => id.startsWith('pet')

  it('5개 중 카테고리 템플릿은 3개까지고 나머지는 공용이다', () => {
    expect(CANDIDATE_LIMIT).toBe(5)
    expect(CATEGORY_CANDIDATE_SHARE).toBe(0.6)
    const out = pick([...targets(6), ...commons(6)])
    expect(out).toHaveLength(5)
    expect(out.filter(isTarget)).toHaveLength(3)
  })

  it('공용이 모자라면 후보가 적어진다 — 몫을 넘겨 채우지 않는다', () => {
    const out = pick([...targets(6), ...commons(1)])
    expect(out).toHaveLength(4)
    expect(out.filter(isTarget)).toHaveLength(3)
  })

  it('한 개만 볼 때는 하나, 전부 볼 때는 몫 제한이 없다', () => {
    expect(pick(targets(6), {}, 1)).toHaveLength(1)
    expect(pick([...targets(6), ...commons(2)], {}, Number.POSITIVE_INFINITY)).toHaveLength(8)
  })

  it('제품군만 지정한 템플릿도 몫에 든다', () => {
    const only = Array.from({ length: 6 }, (_, i) => a(`pet${i}`, { productFamilies: ['pet_goods'] }))
    expect(pick([...only, ...commons(6)], { productFamily: 'pet_goods' }).filter(isTarget)).toHaveLength(3)
  })
})

describe('페이지 family', () => {
  const list = ['f1', 'f2', 'f3', 'f4'].map((family) => a(family, { family, concepts: [concept.id] }))

  it('같은 상품은 같은 값, 상품이 달라지면 갈린다', () => {
    const picked = ['P01', 'P02', 'P03', 'P04', 'P05', 'P06', 'P07', 'P08'].map((key) => pickPageFamily(list, profile({ key }), concept))
    expect(pickPageFamily(list, profile(), concept)).toBe(picked[0])
    expect(new Set(picked).size).toBeGreaterThan(1)
  })

  it('이 상품에 쓸 수 있고 컨셉에 맞는 템플릿이 있는 family만 본다', () => {
    const only = [
      a('other', { family: 'f-other', concepts: ['nope'] }),
      a('food', { family: 'f-food', concepts: [concept.id], categories: ['food'] }),
      a('ok', { family: 'f-ok', concepts: [concept.id], categories: ['pet'] }),
    ]
    expect(pickPageFamily(only, profile(), concept)).toBe('f-ok')
  })

  it('없으면 null이다', () => {
    expect(pickPageFamily([a('plain', { concepts: [concept.id] })], profile(), concept)).toBeNull()
  })
})

describe('제품군 값', () => {
  it('8개 카테고리 키를 모두 덮고 값이 겹치지 않는다', () => {
    expect(Object.keys(PRODUCT_FAMILIES).sort()).toEqual([...PDP_CATEGORY_KEYS].sort())
    const all = Object.values(PRODUCT_FAMILIES).flat()
    expect(new Set(all).size).toBe(all.length)
  })

  it('그 카테고리의 값만 받는다', () => {
    expect(productFamilyOf('pet', ' pet_goods ')).toBe('pet_goods')
    expect(productFamilyOf('food', 'pet_goods')).toBeUndefined()
    expect(productFamilyOf('pet', '')).toBeUndefined()
    expect(productFamilyOf('pet', undefined)).toBeUndefined()
    expect(productFamilyOf('', 'pet_goods')).toBeUndefined()
  })

  it('프롬프트에 들어가지 않는다', () => {
    const spec = { productName: '상품' } as PdpSpecSheet
    expect(specSheetPromptJson({ ...spec, productFamily: 'pet_goods' })).toBe(specSheetPromptJson(spec))
  })
})

describe('선택 흐름', () => {
  const free = <T,>(value: T) => ({ value, usedFallback: false, error: null, costUsd: 0 })
  const agents: TemplateAgents = {
    guideline: async ({ concepts }) => free({ persona: '', tone: '', concept: { id: concepts[0].id, reason: '' }, alternatives: [] }),
    compose: async () => free([]),
    select: async ({ slots }) => free(slots.map((s) => ({ index: s.index, templateId: s.candidates[0].id, reason: '' }))),
  }
  const common = K_SECTIONS.flatMap((section) => Array.from({ length: 6 }, (_, i) => tpl(`${section}.t${i}`, { section, height: 1700 })))
  const input = (specOver: Partial<PdpSpecSheet>, templates = common) => ({
    key: 'P01',
    categoryKey: 'pet',
    productHex: null,
    spec: { material: '면', ...specOver } as PdpSpecSheet,
    product: { category: 'pet', persona: null, summary: '', keywords: [], usps: [], pains: [] },
    templates,
  })

  it('공용만 있으면 기록에 새 칸이 없고 제품군을 줘도 고른 결과가 같다', async () => {
    const plain = await selectTemplateLine(input({}), agents)
    const named = await selectTemplateLine(input({ productFamily: 'pet_goods' }), agents)
    expect(plain.record).not.toHaveProperty('productFamily')
    expect(plain.record).not.toHaveProperty('pageFamily')
    expect(plain.warnings.some((w) => w.startsWith('제품군 값 무시'))).toBe(false)
    expect(named.record.sections).toEqual(plain.record.sections)
    expect(named.record.productFamily).toBe('pet_goods')
  })

  it('입력값이 없으면 상품명으로 판정해 제품군 템플릿을 고르고, 다른 키 값은 경고하고 판정으로 내려간다', async () => {
    const special = tpl('main_cut.pet', { section: 'main_cut', height: 1700, categories: ['pet'], productFamilies: ['pet_goods'], family: 'f1', concepts: CONCEPTS.map((c) => c.id) })
    const judged = await selectTemplateLine(input({ productName: '강아지 밥그릇' }, [...common, special]), agents)
    expect(judged.record.productFamily).toBe('pet_goods')
    expect(judged.record.sections.map((s) => s.templateId)).toContain('main_cut.pet')
    expect(judged.warnings.some((w) => w.startsWith('제품군 값 무시'))).toBe(false)

    const given = await selectTemplateLine(input({ productFamily: 'pet_food', productName: '강아지 밥그릇' }, [...common, special]), agents)
    expect(given.record.productFamily).toBe('pet_food')
    expect(given.record.sections.map((s) => s.templateId)).not.toContain('main_cut.pet')

    const wrong = await selectTemplateLine(input({ productFamily: 'fresh', productName: '강아지 밥그릇' }), agents)
    expect(wrong.record.productFamily).toBe('pet_goods')
    expect(wrong.warnings.some((w) => w.startsWith('제품군 값 무시'))).toBe(true)
  })

  it('페이지 family를 기록하고 카테고리 템플릿을 고른다', async () => {
    const special = tpl('main_cut.pet', { section: 'main_cut', height: 1700, categories: ['pet'], productFamilies: ['pet_goods'], family: 'f1', concepts: CONCEPTS.map((c) => c.id) })
    const out = await selectTemplateLine(input({ productFamily: 'pet_goods' }, [...common, special]), agents)
    expect(out.record.pageFamily).toBe('f1')
    expect(out.record.sections.map((s) => s.templateId)).toContain('main_cut.pet')
  })

  it('다른 카테고리의 제품군 값은 무시하고 경고를 남긴다', async () => {
    const out = await selectTemplateLine(input({ productFamily: 'fresh' }), agents)
    expect(out.warnings).toContain('제품군 값 무시: fresh(pet)')
    expect(out.record).not.toHaveProperty('productFamily')
  })

  it('기록 함수는 값이 있을 때만 싣는다', async () => {
    const { order, palette, concept: chosen } = await selectTemplateLine(input({}), agents)
    const base = { concept: chosen, alternatives: [], palette, order }
    expect(buildSelectionRecord(base)).not.toHaveProperty('pageFamily')
    expect(buildSelectionRecord({ ...base, pageFamily: 'f1', productFamily: 'pet_goods' })).toMatchObject({ pageFamily: 'f1', productFamily: 'pet_goods' })
  })
})
