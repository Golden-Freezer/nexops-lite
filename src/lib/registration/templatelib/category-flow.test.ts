/**
 * 제품군 구성 사전값(적용 K5 ①-b T1-42)과 카테고리별 인포그래픽 가점(T1-88) — 표 값·찾는 순서·구성 고치기·후보 가점. 템플릿은 가짜 메타데이터다. LLM·DB 없음.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { getPdpTestProduct } from '../__fixtures__/pdp-products'
import type { PdpJobRow } from '../pdp-state'
import { CATEGORY_INFOGRAPHIC, FAMILY_FLOW, INFOGRAPHIC_BONUS, KEY_FLOW, categoryFlowOf } from './category-flow'
import { CONCEPTS, conceptById } from './concepts'
import { lineInputsOf } from './input-values'
import { TEMPLATES } from './library'
import { PRODUCT_FAMILIES } from './product-family'
import { selectTemplateLine, type TemplateAgents } from './select-line'
import { FIT_BONUS, candidatesFor, repairComposition, type SelectionProfile } from './selection'
import { tpl } from './selection.fixture'
import { REQUIRED_SECTIONS } from './selection-order'
import { K_SECTIONS, PAGE_SECTIONS, type TemplateMeta } from './template-meta'

const families = Object.values(PRODUCT_FAMILIES).flat()

describe('표 값', () => {
  it('제품군 줄은 있는 제품군이고, 섹션은 K 섹션이며, 필수 섹션을 빼지 않는다', () => {
    for (const [family, row] of Object.entries(FAMILY_FLOW)) {
      expect(families).toContain(family)
      for (const section of [...(row.add ?? []), ...(row.drop ?? [])]) expect(K_SECTIONS as readonly string[]).toContain(section)
      for (const section of row.drop ?? []) expect(REQUIRED_SECTIONS as readonly string[]).not.toContain(section)
      // 같은 섹션을 더하고 빼지 않는다
      expect((row.add ?? []).filter((section) => (row.drop ?? []).includes(section))).toEqual([])
    }
  })

  it('A1 시작값 — 시험 7제품군 가운데 줄이 있는 것은 보호대·뷰티 도구뿐이고 나머지는 기본 구성이다', () => {
    expect(FAMILY_FLOW.sports_support).toEqual({ add: ['how_to'] })
    expect(FAMILY_FLOW.beauty_tool).toEqual({ add: ['how_to'], drop: ['certification'] })
    for (const family of ['pet_goods', 'sticker_deco', 'gift_wrap', 'garden_diy', 'phone_accessory']) expect(FAMILY_FLOW[family]).toBeUndefined()
    expect(FAMILY_FLOW.apparel.drop).toEqual(['problem_raise', 'problem_empathy', 'certification'])
    expect(FAMILY_FLOW.processed.drop).toEqual(['problem_raise', 'problem_empathy'])
  })

  it('순수 데이터다 — 다른 모듈을 읽지 않는다(D 쪽 import 후보)', () => {
    const source = readFileSync(join(__dirname, 'category-flow.ts'), 'utf8')
    expect(source).not.toMatch(/^\s*import\s/m)
  })

  it('인포그래픽 가점은 카테고리 키에만, 카테고리 가점보다 작다', () => {
    expect(Object.keys(CATEGORY_INFOGRAPHIC).sort()).toEqual(['fashion', 'household'])
    expect(INFOGRAPHIC_BONUS).toBeLessThan(FIT_BONUS.productFamily)
  })
})

describe('찾는 순서', () => {
  it('제품군 줄 → 키 줄 → 기본(빈 줄)', () => {
    expect(categoryFlowOf('fashion', 'sports_support')).toBe(FAMILY_FLOW.sports_support)
    expect(categoryFlowOf('pet', 'pet_goods')).toEqual({})
    expect(categoryFlowOf('pet', undefined)).toEqual({})
    expect(categoryFlowOf(undefined, undefined)).toEqual({})
    expect(KEY_FLOW).toEqual({})
  })
})

describe('구성 고치기 add', () => {
  const open = ['hook_3step', 'main_cut', 'how_to', 'faq', 'point_div', 'sub_div', 'spec_table', 'cta']

  it('고를 수 있으면 빠진 섹션을 더하고, 고를 수 없으면 더하지 않는다', () => {
    const base = ['hook_3step', 'main_cut', 'spec_table', 'cta']
    expect(repairComposition(base, new Set(), open, ['how_to']).added).toContain('how_to')
    expect(repairComposition(base, new Set(), open.filter((s) => s !== 'how_to'), ['how_to']).sections).not.toContain('how_to')
    // add가 없으면 전과 같다
    expect(repairComposition(base, new Set(), open)).toEqual(repairComposition(base, new Set(), open, []))
  })

  it('필수처럼 상한에 밀리지 않고, 이미 있으면 두 번 넣지 않는다', () => {
    const many = ['hook_3step', ...Array.from({ length: PAGE_SECTIONS.max }, () => 'sub_div'), 'how_to', 'spec_table', 'cta']
    const { sections } = repairComposition(many, new Set(), open, ['how_to'])
    expect(sections.length).toBeLessThanOrEqual(PAGE_SECTIONS.max)
    expect(sections.filter((s) => s === 'how_to')).toHaveLength(1)
    expect(repairComposition(many, new Set(), open).sections).not.toContain('how_to')
  })
})

describe('시험 상품 — 모델 구성이 사용법을 빼고 자리를 채웠을 때', () => {
  const free = <T,>(value: T) => ({ value, usedFallback: false, error: null, costUsd: 0 })
  /**
   * 사용법·POINT·둘째 고민을 뺀 열린 섹션 + 상한까지 sub_div — 구성 고치기가 뺄 것이 없어 자리가 꽉 차고, 입력 정보 섹션(INPUT_INFO_SECTIONS)으로는 사용법이 못 들어온다
   */
  const skip = new Set(['how_to', 'point_div', 'problem_empathy'])
  const run = async (id: string) => {
    const product = getPdpTestProduct(id)
    const inputs = lineInputsOf({ spec_sheet: product.specSheet, analysis: {}, copy_sections: { final: { options: product.specSheet.colorOptions ?? [] } } } as unknown as PdpJobRow)
    const pages: Array<{ open: boolean; added: boolean }> = []
    for (const concept of CONCEPTS.slice(0, 8)) {
      let open = false
      const agents = {
        guideline: async () => free({ persona: '', tone: '', concept: { id: concept.id, reason: '' }, alternatives: [] }),
        compose: async (input: { open: string[] }) => {
          open = input.open.includes('how_to')
          return free([...input.open.filter((s) => !skip.has(s)), ...Array.from({ length: PAGE_SECTIONS.max }, () => 'sub_div')].slice(0, PAGE_SECTIONS.max))
        },
        select: async ({ slots }: { slots: Array<{ index: number; candidates: Array<{ id: string }> }> }) => free(slots.map((s) => ({ index: s.index, templateId: s.candidates[0].id, reason: '' }))),
      } as unknown as TemplateAgents
      const out = await selectTemplateLine(
        { key: id, categoryKey: product.categoryKey, productHex: null, spec: product.specSheet, templates: TEMPLATES as unknown as TemplateMeta[], inputs, product: { category: product.categoryKey, persona: null, summary: '', keywords: [], usps: [], pains: [] } },
        agents
      )
      pages.push({ open, added: out.warnings.some((w) => /^구성 고침: .*더함 [^/]*how_to/.test(w)) })
    }
    return pages
  }

  it('보호대(P10, 사용법 더함)는 사용법을 고를 수 있으면 구성 고치기가 더하고, 줄이 없는 폰 소품(P09)은 자리가 없으면 더하지 않는다 — 놓일지는 순서 풀이의 사실 예산이 정한다', { timeout: 30_000 }, async () => {
    const support = await run('P10')
    expect(support.some((p) => p.open)).toBe(true)
    expect(support.filter((p) => p.open !== p.added)).toEqual([])
    const phone = await run('P09')
    expect(phone.some((p) => p.open)).toBe(true)
    expect(phone.filter((p) => p.added)).toEqual([])
  })
})

describe('인포그래픽 가점', () => {
  const concept = conceptById('clean-trust')!
  const profile = (categoryKey: string): SelectionProfile => ({ key: 'P01', categoryKey, photoCount: 9, productHex: null, evidence: new Set(['size']) })
  const dimension = { ...tpl('spec_table.dim'), flow: [{ kind: 'dimension' }] } as unknown as TemplateMeta
  // 컨셉 적합 +3 없이 평균 점수로 가점보다 작은 차만 앞선다
  const plain = tpl('spec_table.plain', { avg: 0.4 })
  const order = (categoryKey: string) => candidatesFor('spec_table', [plain, dimension], profile(categoryKey), concept).map((t) => t.id)

  it('치수 도식 노드가 자주 쓰이는 카테고리(패션·생활)에서만 그 템플릿이 앞선다', () => {
    expect(order('fashion')).toEqual(['spec_table.dim', 'spec_table.plain'])
    expect(order('household')).toEqual(['spec_table.dim', 'spec_table.plain'])
    expect(order('food')).toEqual(['spec_table.plain', 'spec_table.dim'])
  })
})
