/**
 * K7-c 4c 3축 치수 칸 — dimension `depthSlot`(입력 spec.size.depth 필수 칸). 적용 K14부터 3축 그림은 없고 깊이는 글로만 적는다(선은 dimension-lines.test).
 * 깊이가 없으면 깊이 칸 없는 칸과 바이트 같다. 칸 spec_table.dimension-box. LLM·DB 없음
 */

import { describe, expect, it } from 'vitest'
import type { CanvasSection } from '@/lib/registration/editor/types/canvas'
import { checkMobileReadability } from '@/lib/registration/editor/utils/mobileReadability'
import { PDP_TEST_PRODUCT_IDS, getPdpTestProduct } from '../__fixtures__/pdp-products'
import type { PdpSpecSheet } from '../pdp-state'
import { colorSetsOf } from './color-sets'
import { CONCEPTS } from './concepts'
import { renderTemplate } from './engine'
import { ctxOf, imageSlot, templateOf, textSlot } from './engine.fixture'
import { fillInputSlots, requiredInputsFit } from './input-values'
import { TEMPLATES, templateById } from './library'
import { lintTemplate } from './lint'
import { lintCategoryTemplates, screenKey, skeletonKey } from './lint-category'
import { sampleSlots } from './sample'
import { deriveSignature, signatureKey } from './signature'
import type { DimensionNode, FlowNode, Template } from './template-types'

const W = 860

/** 새 칸 → 같은 섹션 공용 치수 칸(사실 수는 깊이 입력 하나만큼 많다) */
const NEW_CELLS: Readonly<Record<string, string>> = {
  'spec_table.dimension-box': 'spec_table.dimension',
}

const DEPTH_DEF = textSlot({ source: 'input', input: 'spec.size.depth', facts: 1, maxChars: 10, required: true })
const SIZE_SLOTS = {
  photo: imageSlot({ required: true }),
  width: textSlot({ source: 'input', input: 'spec.size.width', facts: 1, maxChars: 10 }),
  height: textSlot({ source: 'input', input: 'spec.size.height', facts: 1, maxChars: 10 }),
}
const dim = (over: Partial<DimensionNode> = {}): DimensionNode => ({ kind: 'dimension', slot: 'photo', widthSlot: 'width', heightSlot: 'height', ...over })
const fixture = (node: DimensionNode, depth = DEPTH_DEF) =>
  templateOf({
    id: 'spec_table.dimension-fixture',
    section: 'spec_table',
    flow: [node],
    slots: node.depthSlot ? { ...SIZE_SLOTS, [node.depthSlot]: depth } : SIZE_SLOTS,
  })
const boxOf = (over: Partial<DimensionNode> = {}) => fixture(dim({ depthSlot: 'depth', ...over }))

type Out = NonNullable<ReturnType<typeof renderTemplate>>
const draw = (t: Template, slots: Parameters<typeof renderTemplate>[1]) => {
  const out = renderTemplate(t, slots, ctxOf())
  if (!out) throw new Error('그리지 못함')
  return out
}
const labelsOf = (out: Out) => out.elements.filter((el) => el.name.startsWith('annotation-label-')).map((el) => el.textProps?.content)
/** 편집기 id(접두_순번_시각)는 실행마다 달라 지우고 비교한다 */
const norm = (out: Out | null) => JSON.stringify(out).replace(/_\d+_\d{13}/g, '_n_T')



const SIZE = { photo: 'a', width: '가로 40cm', height: '세로 30cm' }

describe('3축 치수 도식 그리기 — 깊이 없으면 지금 그대로', () => {
  it.each([
    ['사진 아래 도식', {}],
    ['사진 옆 도식(side)', { side: true }],
  ])('%s: 깊이 칸이 비면 깊이 칸 없는 칸과 그리기 결과가 바이트 같다', (_name, over) => {
    const plain = fixture(dim(over))
    const withDepth = fixture(dim({ ...over, depthSlot: 'depth' }), textSlot({ source: 'input', input: 'spec.size.depth', facts: 1, maxChars: 10 }))
    for (const slots of [SIZE, { photo: 'a', width: '가로 12cm' }, { photo: 'a', height: '높이 20cm' }]) {
      expect(norm(renderTemplate(withDepth, slots, ctxOf()))).toBe(norm(renderTemplate(plain, slots, ctxOf())))
    }
  })

  it('라이브러리의 새 칸 밖 치수 칸은 모두 depthSlot이 없다(새 경로를 타지 않는다)', () => {
    const dims = (nodes: readonly FlowNode[]): DimensionNode[] =>
      nodes.flatMap((n) => (n.kind === 'dimension' ? [n] : n.kind === 'row' ? n.columns.flatMap((c) => dims(c.nodes)) : n.kind === 'panel' || n.kind === 'repeat' ? dims(n.nodes) : []))
    const old = TEMPLATES.filter((t) => !(t.id in NEW_CELLS)).flatMap((t) => dims(t.flow).map((n) => ({ id: t.id, n })))
    expect(old.length).toBeGreaterThan(0)
    for (const { id, n } of old) expect(n.depthSlot, id).toBeUndefined()
  })
})

describe('3축 치수 린트 — 깊이 칸은 입력 필수', () => {
  const issues = (t: Template) => lintTemplate(t).filter((v) => v.detail.includes('깊이 칸'))

  it('깊이 칸이 입력 spec.size.depth 필수 글 칸이면 위반이 없다', () => {
    expect(issues(boxOf())).toEqual([])
    expect(issues(boxOf({ side: true }))).toEqual([])
  })

  it.each([
    ['선택 칸', textSlot({ source: 'input', input: 'spec.size.depth', facts: 1, maxChars: 10 })],
    ['다른 입력 키', textSlot({ source: 'input', input: 'spec.size.width', facts: 1, maxChars: 10, required: true })],
  ])('깊이 칸이 %s이면 위반 — 깊이 입력 없는 상품의 후보가 된다', (_name, depth) => {
    expect(issues(fixture(dim({ depthSlot: 'depth' }), depth)).map((v) => v.rule)).toEqual(['meta'])
  })

  it('깊이 칸 없는 2축 도식은 이 검사를 받지 않는다', () => {
    expect(issues(fixture(dim()))).toEqual([])
  })
})

describe('3축 치수 서명·화면 키', () => {
  it('서명은 2축과 같은 사진 도식(inset)이고, 뼈대·화면 키는 3축 상자를 따로 센다', () => {
    const plain = fixture(dim())
    const box = boxOf()
    expect(deriveSignature(plain).photo).toBe('inset')
    expect(deriveSignature(box).photo).toBe('inset')
    expect([skeletonKey(plain.flow), skeletonKey(box.flow)]).toEqual(['dimension', 'dimension:box'])
    expect([screenKey(plain.flow), screenKey(box.flow)]).toEqual(['dimension', 'dimension:box'])
  })
})

describe('K7-c 4c 칸 — spec_table.dimension-box', () => {
  const cell = (id: string): Template => {
    const found = templateById(id)
    if (!found) throw new Error(`라이브러리에 없음: ${id}`)
    return found
  }

  it('린트 위반 0, W·N, 사진 옆 도식, 깊이 칸은 입력 spec.size.depth 필수', () => {
    for (const id of Object.keys(NEW_CELLS)) {
      const t = cell(id)
      expect(lintTemplate(t), id).toEqual([])
      expect(t.surfaces, id).toEqual(['W', 'N'])
      const node = t.flow.find((n): n is DimensionNode => n.kind === 'dimension')
      expect([node?.depthSlot, node?.side], id).toEqual(['depth', true])
      expect(t.slots.depth, id).toMatchObject({ type: 'text', required: true, input: 'spec.size.depth' })
      expect(t.needs.photos, id).toBe(1)
    }
  })

  it('같은 섹션 공용과 서명이 다르고, 카테고리 칸과 화면이 겹치지 않는다(전수 린트는 library.test)', () => {
    for (const id of Object.keys(NEW_CELLS)) {
      const t = cell(id)
      const others = TEMPLATES.filter((other) => other.section === t.section && other.id !== id && !(other.fit?.categories?.length ?? 0))
      for (const other of others) expect(signatureKey(deriveSignature(other)), `${id} ↔ ${other.id}`).not.toBe(signatureKey(deriveSignature(t)))
    }
    expect(lintCategoryTemplates(TEMPLATES)).toEqual([])
  })

  it('사실 수는 공용 치수 칸 + 깊이 입력 하나', () => {
    for (const [id, near] of Object.entries(NEW_CELLS)) {
      const { min, max } = cell(near).needs.facts
      expect(cell(id).needs.facts, id).toEqual({ min: min + 1, max: max + 1 })
    }
  })

  it('3축 입력(AxBxC)에서 깊이 칸을 채우고, 깊이 입력이 없으면 후보가 아니다', () => {
    const spec = (size: string) => ({ productName: '수납 상자', brandName: '페어넥스', size, material: 'PP', origin: '중국' }) as unknown as PdpSpecSheet
    const of = (size: string) => ({ spec: spec(size), cards: [], options: [] })
    const box = cell('spec_table.dimension-box')
    expect(fillInputSlots(box, of('40cm x 30cm x 20cm'))).toMatchObject({ width: '가로 40cm', height: '세로 30cm', depth: '깊이 20cm' })
    for (const id of Object.keys(NEW_CELLS)) {
      expect(requiredInputsFit(cell(id), of('40cm x 30cm x 20cm')), id).toBe(true)
      expect(requiredInputsFit(cell(id), of('16.5cm x 20.7cm')), id).toBe(false)
      expect(requiredInputsFit(cell(id), of('고리 21.4cm, 펼침 37.3cm')), id).toBe(false)
    }
  })

  it('실제 시험 상품 — 3축 입력이 있는 P06·P07만 새 칸 후보이고, 그 둘은 2축 치수 칸 후보이기도 하다', () => {
    const fits = (id: string) => PDP_TEST_PRODUCT_IDS.filter((p) => requiredInputsFit(cell(id), { spec: getPdpTestProduct(p).specSheet, cards: [], options: [] }))
    for (const id of Object.keys(NEW_CELLS)) expect(fits(id), id).toEqual(['P06', 'P07'])
    expect(fits('spec_table.dimension')).toEqual(expect.arrayContaining(['P06', 'P07']))
  })

  it('표본 채움에서 이름표 셋(가로·세로·깊이)을 그리고, 모든 컨셉 색 조합 × W·N에서 글자 대비(M2)·글자 하한(M1) 위반이 없다', () => {
    const sets = CONCEPTS.flatMap((c) => colorSetsOf(c).sets)
    expect(sets.length).toBeGreaterThan(500)
    const failures: string[] = []
    for (const id of Object.keys(NEW_CELLS)) {
      const t = cell(id)
      const slots = sampleSlots(t, { mode: 'full' })
      expect(labelsOf(draw(t, slots)), id).toHaveLength(3)
      for (const set of sets) {
        for (const bg of t.surfaces) {
          const out = renderTemplate(t, slots, ctxOf({ colors: set.colors, bg }))
          if (!out) {
            failures.push(`${id} ${set.id} ${bg} 그리지 못함`)
            continue
          }
          const section = {
            id: 's',
            sectionType: t.section,
            groupType: 'modules',
            order: 0,
            isVisible: true,
            layoutId: 'designcut_k_x',
            preserveBottomPad: true,
            canvas: { width: W, height: out.height, backgroundColor: out.background },
            elements: out.elements,
          } as unknown as CanvasSection
          const bad = checkMobileReadability({ sections: [section] }).violations.filter((v) => v.rule === 'M1' || v.rule === 'M2')
          for (const v of bad) failures.push(`${id} ${set.id} ${bg} ${v.rule} ${v.detail}`)
        }
      }
    }
    expect(failures.slice(0, 10)).toEqual([])
  }, 60_000)
})
