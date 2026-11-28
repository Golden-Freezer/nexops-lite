/**
 * GIF 칸(움직이는 띠, motion_band — 세션 B ③ P2) — 섹션 목록 세 곳·근거 잠금, 템플릿 꼴, 근거 motion 규칙(motionband 스위치 잡만),
 * 꺼진 잡의 고름이 이 템플릿을 더하기 전과 같음, 켜진 잡에서 한 칸이 사용법 뒤에 놓임. AI 단계는 가짜다(유료 호출 0).
 */

import { describe, expect, it } from 'vitest'
import {
  EVIDENCE_LOCKED as H0_LOCKED,
  K_SECTIONS as H0_SECTIONS,
  LOCK_EVIDENCE as H0_LOCK_EVIDENCE,
} from '../../../../scripts/pdp-eval/stage-h0-core.mjs'
import { PDP_TEST_PRODUCT_IDS, getPdpTestProduct } from '../__fixtures__/pdp-products'
import type { PdpJobRow, PdpSpecSheet } from '../pdp-state'
import { lineInputsOf } from './input-values'
import { TEMPLATES } from './library'
import { MOTION_OPTION_PHOTOS_MIN, lineEvidenceOf, selectLineInputOf, selectTemplateLine, type TemplateAgents } from './select-line'
import { INPUT_INFO_SECTIONS, compositionIssues, defaultComposition, repairComposition } from './selection'
import { SECTION_EVIDENCE, evidenceOf } from './selection-facts'
import { FLOW_RANK } from './selection-order'
import { EVIDENCE_LOCKED as META_LOCKED, K_SECTIONS, type TemplateMeta } from './template-meta'
import { EVIDENCE_LOCKED as TYPES_LOCKED, SECTION_TABLE, type ImageSlot, type TextSlot } from './template-types'

const SECTION = 'motion_band'
const cells = TEMPLATES.filter((t) => t.section === SECTION)
const ALL = TEMPLATES as unknown as TemplateMeta[]
const WITHOUT = ALL.filter((t) => t.section !== SECTION)

const free = <T,>(value: T) => ({ value, usedFallback: false, error: null, costUsd: 0 })
const agents: TemplateAgents = {
  guideline: async ({ concepts }) => free({ persona: '', tone: '', concept: { id: concepts[0].id, reason: '' }, alternatives: [] }),
  compose: async () => free([]),
  select: async ({ slots }) => free(slots.map((slot) => ({ index: slot.index, templateId: slot.candidates[0].id, reason: '' }))),
}
const jobOf = (id: string, features: string[]) => {
  const item = getPdpTestProduct(id)
  return {
    id,
    spec_sheet: item.specSheet,
    analysis: { detected_category: item.categoryKey, enrichment: { version: 1, features } },
    copy_sections: { final: { options: item.specSheet.colorOptions ?? [] } },
    section_plan: {},
  } as unknown as PdpJobRow
}
const OFF = ['designcut', 'templatelib']
const ON = [...OFF, 'motionband']

describe('섹션 목록', () => {
  it('K_SECTIONS·SECTION_TABLE·하네스 H0 세 곳에 있고, 근거 잠금이며 근거 이름은 motion이다', () => {
    expect(K_SECTIONS).toContain(SECTION)
    expect(H0_SECTIONS).toContain(SECTION)
    expect(SECTION_TABLE[SECTION]).toEqual({ target: 2, proType: 'sub2_div_page' })
    for (const locked of [META_LOCKED, TYPES_LOCKED, H0_LOCKED]) expect(locked).toContain(SECTION)
    expect(SECTION_EVIDENCE[SECTION]).toBe('motion')
    expect((H0_LOCK_EVIDENCE as Record<string, string>)[SECTION]).toBe('motion')
  })

  it('자리는 사용법 바로 뒤, 성분 앞이다(첫 화면에서 멀다)', () => {
    expect(FLOW_RANK[SECTION]).toBeGreaterThan(FLOW_RANK.how_to)
    expect(FLOW_RANK[SECTION]).toBeLessThan(FLOW_RANK.ingredients)
  })

  it('입력 정보 섹션·기본 구성의 맨 끝이다(켠 잡은 구성 고치기가 자리를 보장한다 — P5, motion-band-always.test)', () => {
    expect(INPUT_INFO_SECTIONS.at(-1)).toEqual({ section: SECTION, evidence: 'motion' })
    expect(defaultComposition(K_SECTIONS).at(-1)).toBe(SECTION)
  })
})

describe('템플릿', () => {
  it('2개 이상이고 모두 근거 motion·필수 사진 한 장(1:1 풀폭)·필수 동작 한 줄(카피, 사실 0)이다', () => {
    expect(cells.length).toBeGreaterThanOrEqual(2)
    for (const t of cells) {
      expect(t.needs.evidence, t.id).toEqual(['motion'])
      const images = Object.values(t.slots).filter((s): s is ImageSlot => s.type === 'image')
      expect(images, t.id).toHaveLength(1)
      expect(images[0], t.id).toMatchObject({ required: true, aspect: ['1:1'] })
      expect(JSON.stringify(t.flow), t.id).toContain('"bleed":true')
      const motion = t.slots.motion as TextSlot
      expect(motion, t.id).toMatchObject({ type: 'text', required: true, source: 'copy', facts: 0, maxLines: 1 })
    }
  })
})

describe('근거 motion(lineEvidenceOf)', () => {
  const spec = getPdpTestProduct(PDP_TEST_PRODUCT_IDS[0]).specSheet
  const usage = { ...spec, usageLocation: '거실' }
  const photos = (n: number) => ({ options: Array.from({ length: n }, (_, i) => ({ label: `옵션${i}`, image: `https://example.com/o${i}.jpg` })) })

  it('스위치가 없으면 evidenceOf와 같다 — 사용법·옵션 사진이 있어도 motion이 없다', () => {
    const off = lineEvidenceOf({ spec: usage, inputs: photos(3) as never })
    expect([...off]).toEqual([...evidenceOf(usage)])
    expect(off.has('motion')).toBe(false)
  })

  it('스위치 잡은 늘 연다(P5) — 인쇄물만 실물 옵션 사진이 2장 이상일 때다(자리표시 사진은 세지 않는다)', () => {
    expect(lineEvidenceOf({ spec: usage, motionBand: true }).has('motion')).toBe(true)
    const bare = { productName: '시험 상품' } as unknown as PdpSpecSheet
    expect(evidenceOf(bare).has('usage')).toBe(false)
    expect(lineEvidenceOf({ spec: bare, motionBand: true }).has('motion')).toBe(true)
    expect(lineEvidenceOf({ spec: usage, motionBand: true, textBearing: true }).has('motion')).toBe(false)
    expect(lineEvidenceOf({ spec: bare, motionBand: true, textBearing: true, inputs: photos(MOTION_OPTION_PHOTOS_MIN - 1) as never }).has('motion')).toBe(false)
    expect(lineEvidenceOf({ spec: bare, motionBand: true, textBearing: true, inputs: photos(MOTION_OPTION_PHOTOS_MIN) as never }).has('motion')).toBe(true)
    const placeholder = { options: [{ label: 'a', image: null }, { label: 'b', image: null }] }
    expect(lineEvidenceOf({ spec: bare, motionBand: true, textBearing: true, inputs: placeholder as never }).has('motion')).toBe(false)
  })

  it('잡 입력은 motionband 스위치가 기록된 잡만 motionBand를 싣는다 — 끈 잡은 칸이 없다', () => {
    const id = PDP_TEST_PRODUCT_IDS[0]
    expect('motionBand' in selectLineInputOf(jobOf(id, OFF), ALL)).toBe(false)
    expect(selectLineInputOf(jobOf(id, ON), ALL).motionBand).toBe(true)
  })
})

describe('구성 고치기', () => {
  it('GIF 칸은 페이지에 하나까지다 — 둘째는 뺀다', () => {
    const open = [...K_SECTIONS]
    const evidence = new Set(['motion', 'usage'])
    const out = repairComposition(['hook_3step', 'main_cut', 'motion_band', 'point_div', 'motion_band', 'spec_table', 'cta'], evidence, open)
    expect(out.sections.filter((s) => s === SECTION)).toHaveLength(1)
    expect(out.removed).toContain(SECTION)
  })
})

describe('실제 라이브러리 × 시험 상품', () => {
  const run = (id: string, features: string[], templates: TemplateMeta[]) => {
    const job = jobOf(id, features)
    return selectTemplateLine({ ...selectLineInputOf(job, templates), inputs: lineInputsOf(job) }, agents)
  }

  it.each(PDP_TEST_PRODUCT_IDS)('%s 스위치를 끈 잡은 GIF 칸 템플릿을 더하기 전과 고름·순서·경고가 같다', async (id) => {
    const [withCells, without] = await Promise.all([run(id, OFF, ALL), run(id, OFF, WITHOUT)])
    expect(withCells.order.sections).toEqual(without.order.sections)
    expect(withCells.warnings).toEqual(without.warnings)
    expect(withCells.record).toEqual(without.record)
    expect(withCells.order.sections.map((s) => s.section)).not.toContain(SECTION)
  })

  it('스위치를 켠 잡은 근거가 있으면 GIF 칸 하나를 사용법 뒤에 놓고, 근거 없는 섹션으로 세지 않는다', async () => {
    const placedIn: string[] = []
    for (const id of PDP_TEST_PRODUCT_IDS) {
      const job = jobOf(id, ON)
      const input = { ...selectLineInputOf(job, ALL), inputs: lineInputsOf(job) }
      const line = await selectTemplateLine(input, agents)
      const sections = line.order.sections.map((s) => s.section)
      const count = sections.filter((s) => s === SECTION).length
      expect(count, id).toBeLessThanOrEqual(1)
      if (!lineEvidenceOf(input).has('motion')) {
        expect(count, id).toBe(0)
        continue
      }
      expect(compositionIssues(sections, lineEvidenceOf(input)).filter((issue) => issue.includes(SECTION)), id).toEqual([])
      if (count === 0) continue
      placedIn.push(id)
      const at = sections.indexOf(SECTION)
      expect(at, id).toBeGreaterThan(1)
      if (sections.includes('how_to')) expect(at, id).toBeGreaterThan(sections.indexOf('how_to'))
    }
    expect(placedIn.length).toBeGreaterThan(0)
  })
})
