/**
 * 우리 판매량 칸(J51b, 통합 decide 33) — 근거 sales는 서버가 남긴 합·기간 문구(ownSales)가 둘 다 있을 때만, 성과 섹션은 평점 또는 판매로 열린다.
 * 판매가 있으면 성과 섹션은 판매 칸 템플릿만 후보이고 구성에 반드시 든다. 판매가 없는 잡은 후보·구성이 판매 템플릿이 없던 라이브러리와 같다.
 * 합 100 미만·묶음 수량 모름이면 J51a가 ownSales를 남기지 않아 근거가 서지 않는다(own-sales.test.ts). LLM·DB 없음.
 */

import { describe, expect, it } from 'vitest'
import { availableEvidence, LOCK_EVIDENCE, LOCK_EVIDENCE_ALSO, EVIDENCE_NAMES, SALES_BASIS_MAX_CHARS as H0_BASIS_MAX, SALES_TOTAL_MAX_CHARS as H0_TOTAL_MAX } from '../../../../scripts/pdp-eval/stage-h0-core.mjs'
import type { PdpSpecSheet } from '../pdp-state'
import { computeOwnSales, ownSalesLine } from '../own-sales'
import { conceptById } from './concepts'
import { fillInputSlots, requiredInputsFit, type LineInputs } from './input-values'
import { TEMPLATES } from './library'
import { candidatesFor, compositionIssues, defaultComposition, repairComposition, type SelectionProfile } from './selection'
import { SALES_BASIS_MAX_CHARS, SALES_TOTAL_MAX_CHARS, SECTION_EVIDENCE, SECTION_EVIDENCE_ALSO, evidenceOf, sectionLocks, sectionOpen } from './selection-facts'
import { K_SECTIONS, type TemplateMeta } from './template-meta'

const library = TEMPLATES as unknown as TemplateMeta[]
const SALES_IDS = ['perf_metric.light-band-sales', 'perf_metric.score-circle-sales', 'perf_metric.sales-card', 'perf_metric.sales-bleed']
const SALES_ONLY = ['perf_metric.sales-card', 'perf_metric.sales-bleed']
const LINE = { total: '35,600개', basis: '2026.02~2026.08 쿠팡 누적 판매' }
const concept = conceptById('clean-trust')!
const profile = (evidence: string[], over: Partial<SelectionProfile> = {}): SelectionProfile => ({
  key: 'P02',
  categoryKey: 'household',
  photoCount: 6,
  productHex: null,
  evidence: new Set(evidence),
  ...over,
})
const ids = (section: string, p: SelectionProfile, templates = library) => candidatesFor(section, templates, p, concept, Number.POSITIVE_INFINITY).map((t) => t.id)

describe('근거 sales', () => {
  it('ownSales 합·기간 문구가 둘 다 있을 때만 — K와 하네스 H0가 같다', () => {
    const cases: Array<[Partial<PdpSpecSheet>, boolean]> = [
      [{ ownSales: LINE }, true],
      [{ ownSales: { total: '35,600개', basis: ' ' } }, false],
      [{ ownSales: { total: '', basis: LINE.basis } }, false],
      [{ ownSalesProductIds: ['15969912606'] }, false],
      [{}, false],
    ]
    for (const [over, want] of cases) {
      const spec = { productName: 'x', ...over } as PdpSpecSheet
      expect(evidenceOf(spec).has('sales'), JSON.stringify(over)).toBe(want)
      expect(availableEvidence(spec).has('sales'), JSON.stringify(over)).toBe(want)
    }
    expect(EVIDENCE_NAMES).toContain('sales')
    expect(LOCK_EVIDENCE_ALSO).toEqual(SECTION_EVIDENCE_ALSO)
  })

  it('판매 숫자가 칸 상한(8자)을 넘으면 근거를 세우지 않는다 — 성과 섹션을 억지로 넣지 않고 판매 없는 잡처럼(평점 템플릿 또는 섹션 없음, decide 36)', () => {
    for (const t of TEMPLATES.filter((x) => SALES_IDS.includes(x.id))) {
      expect(t.slots.sales, t.id).toMatchObject({ maxChars: SALES_TOTAL_MAX_CHARS })
      expect(t.slots.salesBasis, t.id).toMatchObject({ maxChars: SALES_BASIS_MAX_CHARS })
    }
    expect([H0_TOTAL_MAX, H0_BASIS_MAX]).toEqual([SALES_TOTAL_MAX_CHARS, SALES_BASIS_MAX_CHARS])
    const long = { productName: 'x', ownSales: { total: '1,234,567개', basis: LINE.basis }, rating: 4.8, reviewCount: 120 } as PdpSpecSheet
    expect(evidenceOf(long).has('sales')).toBe(false)
    expect(availableEvidence(long).has('sales')).toBe(false)
    expect(evidenceOf({ ...long, ownSales: { total: '123,456개', basis: LINE.basis } }).has('sales')).toBe(true)
    // 평점이 있으면 지금처럼 평점 템플릿, 없으면 섹션이 잠기고 구성 고치기가 더하지 않는다
    expect(ids('perf_metric', profile([...evidenceOf(long)])).some((id) => id.includes('sales'))).toBe(false)
    expect(ids('perf_metric', profile([...evidenceOf(long)])).length).toBeGreaterThan(0)
    const onlyLong = { productName: 'x', ownSales: long.ownSales } as PdpSpecSheet
    expect(ids('perf_metric', profile([...evidenceOf(onlyLong)]))).toEqual([])
    const open = [...K_SECTIONS]
    expect(repairComposition(['hook_3step', 'spec_table'], evidenceOf(onlyLong), open).added).not.toContain('perf_metric')
  })

  it('합 100 미만이면 J51a가 ownSales를 남기지 않아 근거가 없다', () => {
    const row = { rowId: '00000000-0000-4000-8000-000000000001', productId: '1', optionName: '20개 데이지(S)' }
    const below = computeOwnSales(['1'], [row], [{ rowId: row.rowId, orderDate: '2026-03-01', quantity: 4 }], {}, '2026-11-11T00:00:00Z')
    expect(below.outcome).toBe('below_min')
    const spec = { productName: 'x', ownSalesSnapshot: below, ...(ownSalesLine(below) ? { ownSales: ownSalesLine(below)! } : {}) } as PdpSpecSheet
    expect(evidenceOf(spec).has('sales')).toBe(false)
    expect(ids('perf_metric', profile([...evidenceOf(spec)]))).toEqual([])
  })
})

describe('섹션 열림', () => {
  it('근거 하나짜리 잠금 섹션은 지금과 같다 — 여는 근거가 SECTION_EVIDENCE 하나뿐', () => {
    for (const [section, lock] of Object.entries(SECTION_EVIDENCE)) {
      if (section === 'perf_metric') continue
      expect(sectionLocks(section), section).toEqual([lock])
      expect(sectionOpen(section, new Set([lock])), section).toBe(true)
      expect(sectionOpen(section, new Set(['sales', 'rating'].filter((k) => k !== lock))), section).toBe(false)
    }
    for (const section of K_SECTIONS.filter((s) => !(s in SECTION_EVIDENCE))) expect(sectionOpen(section, new Set()), section).toBe(true)
    expect((LOCK_EVIDENCE as Record<string, string>).perf_metric).toBe('rating')
  })

  it('성과 섹션은 평점 또는 판매로 열린다', () => {
    expect(sectionLocks('perf_metric')).toEqual(['rating', 'sales'])
    expect(sectionOpen('perf_metric', new Set())).toBe(false)
    expect(sectionOpen('perf_metric', new Set(['rating']))).toBe(true)
    expect(sectionOpen('perf_metric', new Set(['sales']))).toBe(true)
  })
})

describe('후보', () => {
  it('판매가 없는 잡은 모든 섹션 후보가 판매 템플릿이 없던 라이브러리와 같다', () => {
    const without = library.filter((t) => !SALES_IDS.includes(t.id))
    const rich = ['review', 'rating', 'certification', 'offer', 'faq', 'size', 'option', 'quantity', 'usage', 'ingredient', 'notice']
    for (const evidence of [rich, ['review'], []]) {
      for (const section of K_SECTIONS) {
        for (const key of ['P02', 'P05', 'P09']) {
          const p = profile(evidence, { key })
          expect(ids(section, p), `${section} ${key} ${evidence.join(',')}`).toEqual(ids(section, p, without))
        }
      }
    }
  })

  it('판매가 있으면 성과 섹션은 판매 칸 템플릿만 — 평점까지 있으면 넷, 판매만이면 판매 전용 둘', () => {
    expect(ids('perf_metric', profile(['rating', 'sales'])).sort()).toEqual([...SALES_IDS].sort())
    expect(ids('perf_metric', profile(['sales'])).sort()).toEqual([...SALES_ONLY].sort())
    expect(ids('perf_metric', profile(['rating']))).not.toEqual(expect.arrayContaining([expect.stringMatching(/sales/)]))
  })
})

describe('구성', () => {
  const open = [...K_SECTIONS]

  it('판매 근거가 있으면 성과 섹션을 반드시 두고, 빠지면 구성 검사가 잡는다(후기와 같은 규칙)', () => {
    const base = defaultComposition(open).filter((s) => s !== 'perf_metric')
    const out = repairComposition(base, new Set(['sales']), open)
    expect(out.sections).toContain('perf_metric')
    expect(out.added).toContain('perf_metric')
    expect(compositionIssues(base, new Set(['sales']))).toContain('판매 자료가 있는데 성과 섹션이 없음')
    expect(compositionIssues(out.sections, new Set(['sales']))).not.toContain('판매 자료가 있는데 성과 섹션이 없음')
  })

  it('판매 근거가 없으면 성과 섹션을 더하지 않는다 — 평점만 있는 잡도 지금처럼 구성 콜 선택 그대로', () => {
    const base = defaultComposition(open).filter((s) => s !== 'perf_metric')
    for (const evidence of [new Set<string>(), new Set(['rating'])]) {
      const out = repairComposition(base, evidence, open)
      expect(out.added).not.toContain('perf_metric')
      expect(compositionIssues(base, evidence).some((issue) => issue.includes('판매'))).toBe(false)
    }
  })

  it('판매 근거 하나로 연 성과 섹션은 근거 없는 섹션이 아니다', () => {
    expect(compositionIssues(['perf_metric'], new Set(['sales']))).not.toContain('근거 없는 섹션: perf_metric')
    expect(compositionIssues(['perf_metric'], new Set())).toContain('근거 없는 섹션: perf_metric')
  })
})

describe('입력 칸', () => {
  const inputs = (spec: Partial<PdpSpecSheet>): LineInputs => ({ spec: { productName: 'x', ...spec } as PdpSpecSheet, cards: [], options: [] })
  const tpl = (id: string) => TEMPLATES.find((t) => t.id === id)!

  it('판매 칸은 ownSales 값 그대로 — 카피 글이 아니다', () => {
    for (const id of SALES_IDS) {
      const slots = tpl(id).slots
      expect(slots.sales, id).toMatchObject({ type: 'text', source: 'input', input: 'sales.total', required: true })
      expect(slots.salesBasis, id).toMatchObject({ type: 'text', source: 'input', input: 'sales.basis', required: true })
    }
    const values = fillInputSlots(tpl('perf_metric.sales-card'), inputs({ ownSales: LINE }))
    expect(values.sales).toBe('35,600개')
    expect(values.salesBasis).toBe('2026.02~2026.08 쿠팡 누적 판매')
  })

  it('ownSales가 없거나 칸 상한을 넘으면 필수 칸이 비어 그 템플릿을 쓰지 않는다(지어내기 0)', () => {
    expect(requiredInputsFit(tpl('perf_metric.sales-card'), inputs({ ownSales: LINE }))).toBe(true)
    expect(requiredInputsFit(tpl('perf_metric.sales-card'), inputs({}))).toBe(false)
    expect(requiredInputsFit(tpl('perf_metric.sales-card'), inputs({ ownSales: { total: '1,234,567개', basis: LINE.basis } }))).toBe(false)
    expect(requiredInputsFit(tpl('perf_metric.light-band-sales'), inputs({ ownSales: LINE, rating: 4.8, reviewCount: 120 }))).toBe(true)
    expect(requiredInputsFit(tpl('perf_metric.light-band-sales'), inputs({ ownSales: LINE }))).toBe(false)
  })

  it('판매 템플릿은 원형 배지를 쓰지 않는다', () => {
    for (const id of SALES_IDS) expect(Object.values(tpl(id).slots).some((s) => s.type === 'text' && s.input?.startsWith('badge.')), id).toBe(false)
  })
})
