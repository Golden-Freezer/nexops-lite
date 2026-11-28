/**
 * 사진 아닌 정보 칸(infocells 스위치, 세션 B — 오너 2026-11-06 ④ P07 '차트·그래프·픽토그램'). 켠 잡에만 근거 infocells가 서고, 칸 글은 입력 그대로다.
 * 사실 아이콘은 코드가 채운 칸에서만 그려지고 모델 고르기 목록에는 없다. 꺼진 잡의 선택·컷·렌더 바이트는 k-line-run 지문 스냅숏이 지킨다. LLM·DB 없음
 */

import { describe, expect, it } from 'vitest'
import { buildSlotCopyPrompt } from '@/lib/agents/registration/prompts/pdp-template-copy-prompts'
import { getPdpTestProduct } from '../__fixtures__/pdp-products'
import type { PdpJobRow, PdpSpecSheet } from '../pdp-state'
import { productInfoRows, REQUIRED_INFO_LABELS } from '../product-info-rows'
import { CONCEPTS } from './concepts'
import { renderTemplate } from './engine'
import { iconChoices, iconFragment, isIconName } from './icons'
import { factTiles, INFO_CELL_MAX, INFOCELLS_EVIDENCE, infoCellCopyNote, isInfoCell } from './info-cells'
import { fillInputSlots, lineInputsOf, requiredInputsFit } from './input-values'
import { templateById, TEMPLATES, templatesOf } from './library'
import { lintTemplate } from './lint'
import { sampleContext } from './sample'
import { lineEvidenceOf, selectTemplateLine, type TemplateAgents } from './select-line'
import { slotCopySections } from './section-values'
import type { OrderedSection } from './selection-order'
import type { TemplateMeta } from './template-meta'
import type { SlotValues, Template } from './template-types'

const CELLS = ['how_to.flow-steps', 'product_exposure.parts-tiles', 'sub_div.fact-icons']
const cell = (id: string): Template => {
  const found = templateById(id)
  if (!found) throw new Error(`라이브러리에 없음: ${id}`)
  return found
}
const BASE = { productName: '표본 상품', brandName: '표본', color: '아이보리', size: '가로 20cm × 세로 30cm', material: '면 100%', origin: '대한민국' } as unknown as PdpSpecSheet
const specOf = (over: Record<string, unknown>) => ({ ...BASE, ...over }) as unknown as PdpSpecSheet
const inputsOf = (spec: PdpSpecSheet) => lineInputsOf({ spec_sheet: spec, analysis: {}, copy_sections: { final: {} } } as unknown as PdpJobRow)
const STEPS = [{ title: '뚜껑을 열어요' }, { title: '내용물을 부어요', description: '선까지 채워요' }, { title: '뚜껑을 닫아요' }]
const PARTS = [{ key: '구성품', value: '본품, 파우치, 끈' }]
const drawn = (id: string, spec: PdpSpecSheet, copy: SlotValues) => renderTemplate(cell(id), { ...fillInputSlots(cell(id), inputsOf(spec)), ...copy }, sampleContext())
const named = (out: ReturnType<typeof drawn>, name: string) => (out?.elements ?? []).filter((e) => e.name === name)
const photos = (out: ReturnType<typeof drawn>) => (out?.elements ?? []).filter((e) => e.type === 'image' || e.type === 'framed-image')

describe('정보 칸 — 근거 잠금과 린트', () => {
  it('정보 칸은 셋이고 모두 근거 infocells로 잠겨 있다 — 그 밖의 템플릿은 이 근거를 쓰지 않는다', () => {
    expect(TEMPLATES.filter(isInfoCell).map((t) => t.id).sort()).toEqual(CELLS)
    for (const id of CELLS) expect(cell(id).needs.evidence, id).toContain(INFOCELLS_EVIDENCE)
  })

  it.each(CELLS)('%s — 린트 위반 0', (id) => {
    expect(lintTemplate(cell(id)).map((v) => `${v.rule}:${v.detail}`)).toEqual([])
  })

  it('근거 infocells는 스위치 잡에만 선다', () => {
    expect(lineEvidenceOf({ spec: BASE }).has(INFOCELLS_EVIDENCE)).toBe(false)
    expect(lineEvidenceOf({ spec: BASE, infoCells: true }).has(INFOCELLS_EVIDENCE)).toBe(true)
  })
})

describe('사실 아이콘 — 코드가 채운 칸에서만', () => {
  it.each(['material', 'origin', 'color'])('%s — 그림은 있고, 모델 고르기 목록·카피 칸 검사에는 없다', (name) => {
    expect(iconFragment(name)).toMatch(/^<(path|circle) /)
    expect(iconFragment(name)).not.toMatch(/currentColor|<script|on\w+=|href=/)
    expect(isIconName(name)).toBe(false)
    expect(iconChoices()).not.toContain(`${name}(`)
  })
})

describe('사실 칸 sub_div.fact-icons', () => {
  it('상품 정보 표 순서대로 아이콘이 정해진 행만 이름·값 그대로 싣는다 — 상품명·브랜드·사용연령·원산지는 싣지 않는다', () => {
    expect(factTiles(BASE)).toEqual([
      { icon: 'color', label: '색상/수량', value: '아이보리' },
      { icon: 'size', label: '사이즈', value: '가로 20cm × 세로 30cm' },
      { icon: 'material', label: '소재', value: '면 100%' },
    ])
  })

  it('수량만인 색상/수량은 구성 그림이고, 같은 그림은 첫 행 한 번이다 — 그림이 없는 특별 행(용량)은 싣지 않는다', () => {
    const spec = specOf({ color: '20개', extraSpecs: [{ key: '구성품', value: '본품, 파우치' }, { key: '용량', value: '500ml' }, { key: '보관방법', value: '서늘한 곳' }] })
    expect(factTiles(spec).map((t) => `${t.icon}:${t.label}`)).toEqual(['set:색상/수량', 'size:사이즈', 'material:소재', 'storage:보관방법'])
  })

  it('칸 글자 상한을 넘는 행은 건너뛰고 칸 상한(4)까지 — 아이콘 행이 3개 미만이면 고르지 않는다', () => {
    const long = specOf({ material: '가'.repeat(30), extraSpecs: [{ key: '보관방법', value: '서늘한 곳' }] })
    const items = fillInputSlots(cell('sub_div.fact-icons'), inputsOf(long)).facts as Array<Record<string, string>>
    expect(items.map((item) => item.label)).toEqual(['색상/수량', '사이즈', '보관방법'])
    expect(requiredInputsFit(cell('sub_div.fact-icons'), inputsOf(long))).toBe(true)
    const few = { productName: '표본 상품', size: '10cm', origin: '중국' } as unknown as PdpSpecSheet
    expect(requiredInputsFit(cell('sub_div.fact-icons'), inputsOf(few))).toBe(false)
  })

  it('그리기 — 사진이 없고 아이콘이 행 수만큼이다', () => {
    const out = drawn('sub_div.fact-icons', BASE, { headline: '한눈에 보는 기본 정보' })
    expect(out).not.toBeNull()
    expect(named(out, 'designcut-icon')).toHaveLength(3)
    expect(photos(out)).toHaveLength(0)
  })
})

describe('사실 칸에는 원산지를 싣지 않는다 — 오너 2026-11-06 21:38 "쓰기 전 꼭 확인할 정보 세션에는 원산지는 넣지 마라"(운영 P08 ea485268 k9_sub_div)', () => {
  const P08 = getPdpTestProduct('P08').specSheet
  const p08Inputs = lineInputsOf({ spec_sheet: P08, analysis: {}, copy_sections: { final: { options: P08.colorOptions ?? [] } } } as unknown as PdpJobRow)

  it('P08 사실 칸 — 원산지 칸·origin 아이콘이 없고, 남은 사실(구성·사이즈·소재)로 칸이 그대로 선다', () => {
    const facts = fillInputSlots(cell('sub_div.fact-icons'), p08Inputs).facts as Array<Record<string, string>>
    expect(facts.map((item) => item.label)).toEqual(['색상/수량', '사이즈', '소재'])
    expect(JSON.stringify(facts)).not.toMatch(/원산지|origin|중국/)
    expect(requiredInputsFit(cell('sub_div.fact-icons'), p08Inputs)).toBe(true)
    const out = drawn('sub_div.fact-icons', P08, { headline: '쓰기 전\n꼭 확인할 정보' })
    expect(JSON.stringify(out?.elements ?? [])).not.toMatch(/원산지|중국/)
  })

  it('맨 아래 상품 정보 표(필수 7행)에는 원산지가 그대로 있다', () => {
    expect(REQUIRED_INFO_LABELS).toContain('원산지')
    expect(productInfoRows(P08)).toContainEqual(expect.objectContaining({ label: '원산지', value: '중국' }))
    const tables = templatesOf('spec_table')
    expect(tables.length).toBeGreaterThan(0)
    for (const table of tables) {
      const rows = fillInputSlots(table, p08Inputs).rows as Array<Record<string, string>> | undefined
      expect(rows, table.id).toContainEqual(expect.objectContaining({ label: '원산지', value: '중국' }))
    }
  })

  it('사실 칸 카피 안내도 원산지를 예로 들지 않는다', () => {
    expect(infoCellCopyNote('sub_div.fact-icons')).not.toContain('원산지')
  })
})

describe('사용 순서 도식 how_to.flow-steps · 구성 칸 product_exposure.parts-tiles', () => {
  it('입력이 없으면 고르지 않는다 — 짓지 않는다', () => {
    expect(requiredInputsFit(cell('how_to.flow-steps'), inputsOf(BASE))).toBe(false)
    expect(requiredInputsFit(cell('product_exposure.parts-tiles'), inputsOf(BASE))).toBe(false)
    expect(requiredInputsFit(cell('how_to.flow-steps'), inputsOf(specOf({ usageSteps: STEPS })))).toBe(true)
    expect(requiredInputsFit(cell('product_exposure.parts-tiles'), inputsOf(specOf({ extraSpecs: PARTS })))).toBe(true)
  })

  it('구성품 이름이 하나라도 이름표보다 길면 목록 전체를 비운다(일부만 싣지 않는다)', () => {
    const spec = specOf({ extraSpecs: [{ key: '구성품', value: '본품, 아주 긴 구성품 이름' }] })
    expect(requiredInputsFit(cell('product_exposure.parts-tiles'), inputsOf(spec))).toBe(false)
  })

  it('그리기 — 순서는 대표 동작 컷 1장 + 단계 수만큼 번호, 단계 사이 화살표. 구성은 사진 없이 이름 수만큼 번호', () => {
    const steps = drawn('how_to.flow-steps', specOf({ usageSteps: STEPS }), { headline: '이렇게 써요', photo: 'how_to:0' })
    expect(named(steps, 'designcut-mark-number')).toHaveLength(3)
    expect(named(steps, 'designcut-arrow')).toHaveLength(2)
    expect(photos(steps)).toHaveLength(1)
    const parts = drawn('product_exposure.parts-tiles', specOf({ extraSpecs: PARTS }), {})
    expect(named(parts, 'designcut-mark-number')).toHaveLength(3)
    expect(photos(parts)).toHaveLength(0)
  })
})

describe('정보 칸 카피 안내 — 제목이 아래 입력 줄을 묶는 말이 되게(K6 P05)', () => {
  const row = (section: string, templateId: string) => ({ section, templateId, bg: 'W', shots: [] }) as unknown as OrderedSection
  const PRODUCT = { category: 'household', persona: null, summary: '', keywords: [], usps: [], pains: [] }
  const promptOf = (rows: OrderedSection[]) => buildSlotCopyPrompt({ product: PRODUCT, guideline: { persona: '', tone: '' }, facts: [], sections: slotCopySections(rows) })

  it.each(CELLS)('%s — 카피 칸이 있는 정보 칸은 안내 한 줄을 받고, 그 줄이 프롬프트 섹션 설명에 실린다', (id) => {
    const note = infoCellCopyNote(id)
    expect(note).toMatch(/^ {2}칸 안내: /)
    const [section] = slotCopySections([row(cell(id).section, id)])
    expect(section.note).toBe(note)
    expect(promptOf([row(cell(id).section, id)])).toContain(note!)
  })

  it('안내는 새 사실을 만들지 않는다 — 숫자가 없고, 줄에 없는 말을 새로 하지 말라는 말로 끝난다', () => {
    for (const id of CELLS) {
      expect(infoCellCopyNote(id), id).not.toMatch(/\d/)
      expect(infoCellCopyNote(id), id).toMatch(/새로 말하지 않는다\.$/)
    }
  })

  it('정보 칸이 아닌 템플릿은 안내가 없고 섹션 입력에 note 칸도 없다 — 꺼진 잡의 카피 프롬프트는 그대로다(k-line-run 프롬프트 지문)', () => {
    const others = TEMPLATES.filter((t) => !isInfoCell(t))
    expect(others.filter((t) => infoCellCopyNote(t.id) !== null).map((t) => t.id)).toEqual([])
    const [plain] = slotCopySections([row('sub_div', 'sub_div.title-chips')])
    expect(plain).toBeDefined()
    expect('note' in plain).toBe(false)
    expect(promptOf([row('sub_div', 'sub_div.title-chips')])).not.toContain('칸 안내:')
  })
})

describe('선택 — 켠 잡만, 쪽당 상한·같은 칸 한 번(첫 후보 스텁, 모델 호출 없음)', () => {
  const free = <T,>(value: T) => ({ value, usedFallback: false, error: null, costUsd: 0 })
  const agentsFor = (conceptId: string) =>
    ({
      guideline: async () => free({ persona: '', tone: '', concept: { id: conceptId, reason: '' }, alternatives: [] }),
      compose: async () => free([]),
      select: async ({ slots }: { slots: Array<{ index: number; candidates: Array<{ id: string }> }> }) =>
        free(slots.map((s) => ({ index: s.index, templateId: s.candidates[0].id, reason: '' }))),
    }) as unknown as TemplateAgents
  const pick = async (id: string, conceptId: string, infoCells: boolean) => {
    const product = getPdpTestProduct(id)
    const inputs = lineInputsOf({ spec_sheet: product.specSheet, analysis: {}, copy_sections: { final: { options: product.specSheet.colorOptions ?? [] } } } as unknown as PdpJobRow)
    const { order } = await selectTemplateLine(
      {
        key: id,
        categoryKey: product.categoryKey,
        productHex: null,
        spec: product.specSheet,
        templates: TEMPLATES as unknown as TemplateMeta[],
        inputs,
        motionBand: true,
        ...(infoCells ? { infoCells: true } : {}),
        product: { category: product.categoryKey, persona: null, summary: '', keywords: [], usps: [], pains: [] },
      },
      agentsFor(conceptId)
    )
    return { ids: order.sections.map((s) => s.templateId), inputs }
  }

  it.each(['P07', 'P09'])('%s — 꺼진 잡은 정보 칸 0, 켠 잡은 사실 칸이 들고 상한·중복·근거를 지킨다', async (id) => {
    for (const concept of CONCEPTS.slice(0, 4)) {
      const off = await pick(id, concept.id, false)
      expect(off.ids.filter((tid) => isInfoCell(cell(tid))), concept.id).toEqual([])
      const on = await pick(id, concept.id, true)
      const info = on.ids.filter((tid) => isInfoCell(cell(tid)))
      expect(info, concept.id).toContain('sub_div.fact-icons')
      expect(info.length, concept.id).toBeLessThanOrEqual(INFO_CELL_MAX)
      expect(new Set(info).size, concept.id).toBe(info.length)
      for (const tid of info) expect(requiredInputsFit(cell(tid), on.inputs), `${concept.id} ${tid}`).toBe(true)
    }
  })
})
