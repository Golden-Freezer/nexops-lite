/**
 * 성분·원료 섹션(적용 K3 R-W8, 통합 11-03 05:38 승인) — 입력에 적힌 재료 이름이 둘 이상일 때만 열리고, 이름은 코드가 입력 그대로 넣는다.
 * 조건 ⓐ 새 컷 0(사진 칸 없는 템플릿만) ⓑ 새 섹션 키 전수 맵 ⓒ 효능 줄 없음·전성분 안 읽음. AI 단계는 가짜다(유료 호출 0).
 */

import { describe, expect, it } from 'vitest'
import { SECTION_COPY_GUIDE } from '@/lib/agents/registration/prompts/pdp-template-copy-guide'
import { SECTION_PURPOSES } from '@/lib/agents/registration/prompts/pdp-template-prompts'
import {
  EVIDENCE_LOCKED as H0_LOCKED,
  EVIDENCE_NAMES as H0_EVIDENCE,
  INGREDIENT_MIN as H0_INGREDIENT_MIN,
  K_SECTIONS as H0_SECTIONS,
  LOCK_EVIDENCE as H0_LOCK_EVIDENCE,
  availableEvidence,
  ingredientNames,
} from '../../../../scripts/pdp-eval/stage-h0-core.mjs'
import { INPUT_SLOT_SAMPLE_EXTRA_SPECS, withSampleInputSlots } from '../__fixtures__/input-slots.sample'
import { PDP_TEST_PRODUCT_IDS, getPdpTestProduct } from '../__fixtures__/pdp-products'
import { inputSlotsOf } from '../input-slots-read'
import type { PdpJobRow, PdpSpecSheet } from '../pdp-state'
import { CONCEPTS } from './concepts'
import { fillInputSlots, INGREDIENT_MIN, lineInputsOf, namedIngredientsOf, requiredInputsFit } from './input-values'
import { TEMPLATES } from './library'
import { selectTemplateLine, type TemplateAgents } from './select-line'
import { defaultComposition, INPUT_INFO_SECTIONS, repairComposition } from './selection'
import { evidenceOf, SECTION_EVIDENCE } from './selection-facts'
import { FLOW_RANK, imageSlots, shotCountOf } from './selection-order'
import { EVIDENCE_LOCKED as META_LOCKED, K_SECTIONS, type TemplateMeta } from './template-meta'
import { EVIDENCE_LOCKED as TYPES_LOCKED, INGREDIENT_ITEMS_INPUT, INGREDIENT_NAME_INPUT, INGREDIENT_NAMES_INPUT, SECTION_TABLE, TEMPLATE_SECTION_IDS, type Template } from './template-types'

const SECTION = 'ingredients'
const templates = TEMPLATES.filter((t) => t.section === SECTION)
const spec = (rows: Array<{ key: string; value: string }>, over: Partial<PdpSpecSheet> = {}) => ({ extraSpecs: rows, ...over }) as unknown as PdpSpecSheet
const inputsOf = (value: PdpSpecSheet) => lineInputsOf({ spec_sheet: value, analysis: {}, copy_sections: { final: {} } } as unknown as PdpJobRow)
const valuesOf = (t: Template, value: PdpSpecSheet) => Object.values(fillInputSlots(t, inputsOf(value)))
const namesIn = (values: unknown[]) => values.flatMap((v) => (Array.isArray(v) ? v.map((item) => (typeof item === 'string' ? item : Object.values(item as object)[0])) : []))

describe('새 섹션 키 전수 맵 — 빠짐 0(조건 ⓑ)', () => {
  it('섹션 목록 세 곳(K_SECTIONS·SECTION_TABLE·하네스 H0)이 같고 성분이 들어 있다', () => {
    expect([...K_SECTIONS]).toEqual(H0_SECTIONS)
    expect([...TEMPLATE_SECTION_IDS].sort()).toEqual([...K_SECTIONS].sort())
    expect(K_SECTIONS).toContain(SECTION)
    expect(SECTION_TABLE.ingredients.target).toBeLessThanOrEqual(templates.length)
  })

  it('섹션마다 흐름 자리·목적·카피 안내가 있다', () => {
    for (const section of K_SECTIONS) {
      expect(FLOW_RANK[section], section).toBeGreaterThan(0)
      expect(SECTION_PURPOSES[section], section).toBeTruthy()
      expect(SECTION_COPY_GUIDE[section], section).toBeDefined()
    }
    // 사용법 바로 뒤 — 사용법보다 먼저 놓여 사용법의 바탕·사실 몫을 쓰지 않는다
    expect(FLOW_RANK.ingredients).toBeGreaterThan(FLOW_RANK.how_to)
    expect(FLOW_RANK.ingredients).toBeLessThan(FLOW_RANK.product_exposure)
  })

  it('근거 잠금 네 곳(template-types·template-meta·H0·SECTION_EVIDENCE)이 같고 성분은 ingredient로 열린다', () => {
    expect([...TYPES_LOCKED]).toEqual([...META_LOCKED])
    expect([...META_LOCKED]).toEqual(H0_LOCKED)
    expect(Object.keys(SECTION_EVIDENCE).sort()).toEqual([...META_LOCKED].sort())
    expect(SECTION_EVIDENCE.ingredients).toBe('ingredient')
    expect((H0_LOCK_EVIDENCE as Record<string, string>).ingredients).toBe('ingredient')
    expect(H0_EVIDENCE).toContain('ingredient')
    expect(H0_INGREDIENT_MIN).toBe(INGREDIENT_MIN)
  })

  it('입력 정보 섹션·기본 구성에 있고, 기본 구성에서는 맨 끝이라 자리가 넘치면 먼저 빠진다', () => {
    expect(INPUT_INFO_SECTIONS).toContainEqual({ section: SECTION, evidence: 'ingredient' })
    // 주의·보관(K7-c (가))이 성분 앞 — 자리가 하나면 주의가 먼저 든다
    // GIF 칸(motion_band)은 성분 뒤 — motionband 스위치 잡에만 열려, 열리지 않은 페이지에서는 성분이 맨 끝이다
    expect(INPUT_INFO_SECTIONS.map((s) => s.section)).toEqual(['how_to', 'notice', SECTION, 'motion_band'])
    const open = K_SECTIONS.filter((s) => s !== 'motion_band')
    expect(defaultComposition(open).at(-1)).toBe(SECTION)
    expect(defaultComposition(open.filter((s) => s !== SECTION))).not.toContain(SECTION)
    const full = repairComposition(defaultComposition(open), new Set(['review', 'ingredient', 'usage']), open)
    expect(full.sections).not.toContain(SECTION)
    expect(full.removed).toContain(SECTION)
  })

  it('템플릿 3개 이상이 라이브러리에 있고 모두 근거 ingredient·입력 재료 이름 칸을 쓴다', () => {
    expect(templates.length).toBeGreaterThanOrEqual(3)
    for (const t of templates) {
      expect(t.needs.evidence, t.id).toEqual(['ingredient'])
      const inputs = Object.values(t.slots).flatMap((s) => (s.type === 'list' ? [s.input] : []))
      expect(inputs.every((key) => key === INGREDIENT_NAMES_INPUT || key === INGREDIENT_ITEMS_INPUT), t.id).toBe(true)
      for (const s of Object.values(t.slots)) if (s.type === 'list') expect(s.min, t.id).toBe(INGREDIENT_MIN)
    }
  })
})

describe('새 컷 0 — 섹션이 열려도 이미지 단계가 컷을 더 만들지 않는다(조건 ⓐ)', () => {
  it('성분 템플릿은 사진 칸이 없다 — 컷 계획(imageSlots·shotCountOf)이 0장이다', () => {
    for (const t of templates) {
      expect(t.needs.photos, t.id).toBe(0)
      expect(imageSlots(t as unknown as TemplateMeta), t.id).toEqual([])
      expect(shotCountOf(t as unknown as TemplateMeta), t.id).toBe(0)
      expect(JSON.stringify(t.flow), t.id).not.toContain('"kind":"image"')
    }
  })
})

describe('글 칸 — 효능 줄 없음(조건 ⓒ)', () => {
  it('모델 글은 제목 하나(사실 0)이고, 목록 칸은 재료 이름 입력뿐이다 — 재료별 설명 칸이 없다', () => {
    for (const t of templates) {
      for (const [name, def] of Object.entries(t.slots)) {
        if (def.type === 'text') {
          expect(name, t.id).toBe('headline')
          expect(def.source, t.id).toBe('copy')
          expect(def.facts, t.id).toBe(0)
        }
        if (def.type !== 'list') continue
        expect(def.source, t.id).toBe('input')
        for (const field of Object.values(def.fields)) expect(field.type === 'text' && field.source === 'input' && field.input === INGREDIENT_NAME_INPUT, t.id).toBe(true)
      }
    }
  })
})

describe('근거 ingredient — 하네스 H0와 같은 식', () => {
  const cases: Array<[string, PdpSpecSheet, boolean]> = [
    ['원재료 두 이름', spec([{ key: '원재료', value: '쌀, 보리' }]), true],
    ['괄호 안 함량·원산지는 이름이 아니다', spec([{ key: '원재료명 및 함량', value: '밀가루(국산) 70%, 설탕(외국산)' }]), true],
    ['이름 하나', spec([{ key: '원재료', value: '쌀' }]), false],
    ['같은 이름 두 번', spec([{ key: '원료', value: '쌀, 쌀' }]), false],
    ['전성분은 읽지 않는다', spec([{ key: '전성분', value: '정제수, 글리세린, 향료' }]), false],
    ['소재는 제품 재질이라 읽지 않는다', spec([{ key: '소재', value: '면, 폴리에스터' }]), false],
    ['다른 곳을 가리키는 고시 문구', spec([{ key: '원재료', value: '상세페이지 참조, 별도 표기' }]), false],
    ['두 칸에 나눠 적은 이름', spec([{ key: '주원료', value: '쌀' }, { key: '성분', value: '현미' }]), true],
    ['추가 스펙 없음', spec([]), false],
  ]

  it.each(cases)('%s', (_, value, open) => {
    expect(namedIngredientsOf(value)).toEqual(ingredientNames(value))
    expect(evidenceOf(value).has('ingredient')).toBe(open)
    expect(availableEvidence(value).has('ingredient')).toBe(open)
  })

  it('시험 11상품은 재료 이름이 없어 근거가 서지 않는다', () => {
    for (const id of PDP_TEST_PRODUCT_IDS) {
      const value = getPdpTestProduct(id).specSheet
      expect(evidenceOf(value).has('ingredient'), id).toBe(false)
      expect(availableEvidence(value).has('ingredient'), id).toBe(false)
    }
  })
})

describe('칸 채우기 — 입력 이름 그대로', () => {
  const sample = withSampleInputSlots(getPdpTestProduct('P01').specSheet)
  const sampleNames = INPUT_SLOT_SAMPLE_EXTRA_SPECS.find((row) => row.key === '원재료')!.value.split(',').map((name) => name.trim())

  it('표본 원재료 두 이름이 템플릿마다 그대로 들어간다 — 입력 칸 읽기(inputSlotsOf)와 같은 값이다', () => {
    expect(inputSlotsOf(sample).ingredients).toEqual(sampleNames)
    for (const t of templates) {
      expect(requiredInputsFit(t, inputsOf(sample)), t.id).toBe(true)
      expect(namesIn(valuesOf(t, sample)), t.id).toEqual(sampleNames)
    }
  })

  it('규제 표현이 든 이름은 뺀다 — 남은 이름이 하나면 칸을 채우지 못해 섹션을 고르지 않는다', () => {
    const mixed = spec([{ key: '원재료', value: '쌀, 보리, 항균 성분' }])
    expect(evidenceOf(mixed).has('ingredient')).toBe(true)
    for (const t of templates) expect(namesIn(valuesOf(t, mixed)), t.id).toEqual(['쌀', '보리'])
    const one = spec([{ key: '원재료', value: '쌀, 항균 성분' }])
    expect(evidenceOf(one).has('ingredient')).toBe(true)
    for (const t of templates) expect(requiredInputsFit(t, inputsOf(one)), t.id).toBe(false)
  })

  it('칸 상한보다 이름이 많으면 목록 전체를 비운다 — 일부만 싣지 않는다', () => {
    for (const t of templates) {
      const list = Object.values(t.slots).find((s) => s.type === 'list')!
      const max = list.type === 'list' ? list.max : 0
      const names = Array.from({ length: max + 1 }, (_, i) => `재료${String.fromCharCode(0xac00 + i)}`)
      const many = spec([{ key: '원재료', value: names.join(', ') }])
      expect(requiredInputsFit(t, inputsOf(many)), t.id).toBe(false)
      const fit = spec([{ key: '원재료', value: names.slice(0, max).join(', ') }])
      expect(namesIn(valuesOf(t, fit)), t.id).toEqual(names.slice(0, max))
    }
  })

  it('칸보다 긴 이름이 하나라도 있으면 목록 전체를 비운다 — 자르지 않는다', () => {
    // 17자 — 재료 이름 상한(20자) 안이라 이름으로는 읽히지만 어느 칸(이름표 10자·줄 16자)에도 들지 않는다
    const long = spec([{ key: '원재료', value: `쌀, ${'긴'.repeat(17)}` }])
    for (const t of templates) {
      expect(requiredInputsFit(t, inputsOf(long)), t.id).toBe(false)
      expect(namesIn(valuesOf(t, long)), t.id).toEqual([])
      expect(namedIngredientsOf(long), t.id).toHaveLength(2)
    }
  })

  it('전성분만 있으면 어느 칸도 채우지 않는다', () => {
    const full = spec([{ key: '전성분', value: '정제수, 글리세린, 향료' }])
    for (const t of templates) expect(requiredInputsFit(t, inputsOf(full)), t.id).toBe(false)
  })
})

describe('선택 흐름 — 시험 상품', () => {
  const free = <T,>(value: T) => ({ value, usedFallback: false, error: null, costUsd: 0 })
  const run = async (id: string, value: PdpSpecSheet, concept: (typeof CONCEPTS)[number]) => {
    const product = getPdpTestProduct(id)
    const agents = {
      guideline: async () => free({ persona: '', tone: '', concept: { id: concept.id, reason: '' }, alternatives: [] }),
      compose: async () => free([]),
      select: async ({ slots }: { slots: Array<{ index: number; candidates: Array<{ id: string }> }> }) => free(slots.map((s) => ({ index: s.index, templateId: s.candidates[0].id, reason: '' }))),
    } as unknown as TemplateAgents
    const out = await selectTemplateLine(
      { key: id, categoryKey: product.categoryKey, productHex: null, spec: value, templates: TEMPLATES as unknown as TemplateMeta[], inputs: inputsOf(value), product: { category: product.categoryKey, persona: null, summary: '', keywords: [], usps: [], pains: [] } },
      agents
    )
    return out.order.sections
  }
  const shotsOf = (sections: Awaited<ReturnType<typeof run>>) => sections.reduce((sum, s) => sum + s.shots.length, 0)

  it(
    '재료 이름이 없으면 성분 섹션이 없고, 표본 두 이름이 있으면 자리가 있는 페이지에 들며 그 섹션의 컷은 0이다',
    async () => {
      const opened: string[] = []
      for (const id of ['P01', 'P04', 'P07', 'P09', 'P11']) {
        const product = getPdpTestProduct(id)
        for (const concept of CONCEPTS.slice(0, 2)) {
          expect((await run(id, product.specSheet, concept)).some((s) => s.section === SECTION), id).toBe(false)
          const sections = await run(id, withSampleInputSlots(product.specSheet), concept)
          const row = sections.find((s) => s.section === SECTION)
          if (row) {
            opened.push(id)
            expect(row.shots, id).toEqual([])
          }
          expect(sections.filter((s) => s.section === SECTION).length, id).toBeLessThanOrEqual(1)
          expect(shotsOf(sections), id).toBeLessThanOrEqual(32)
        }
      }
      expect(opened.length).toBeGreaterThan(0)
    },
    30_000
  )
})
