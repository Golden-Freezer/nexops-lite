/**
 * GIF 칸 자리 보장(세션 B ③ P5, 통합 11-06 지시 — 오너 22:45 'GIF 칸을 만들어 넣는다') — 켠 잡은 근거 motion을 늘 세우고(인쇄물은 옵션 사진이 있을 때만),
 * 구성 고치기가 빠진 GIF 칸을 넣고(상한이면 채움부터 하나 뺌), 컷 상한이 GIF 칸을 빼지 않는다. 동작 문구·GIF 지시는 실물 쓰는 법과 다른 동작을 막는다.
 * 꺼진 잡은 근거·구성·순서가 지금과 같다. AI 단계는 가짜다(유료 호출 0).
 */

import { describe, expect, it } from 'vitest'
import { SECTION_COPY_GUIDE, sectionGuideLine } from '@/lib/agents/registration/prompts/pdp-template-copy-guide'
import { PDP_TEST_PRODUCT_IDS, getPdpTestProduct } from '../__fixtures__/pdp-products'
import { gifPromptOf } from '../motion/stage'
import { motionTaskOf } from '../motion/task'
import { isTextBearingJob } from '../pdp-image-tasks'
import type { PdpJobRow, PdpSpecSheet } from '../pdp-state'
import { conceptById } from './concepts'
import { lineInputsOf } from './input-values'
import { TEMPLATES } from './library'
import { MOTION_OPTION_PHOTOS_MIN, lineEvidenceOf, selectLineInputOf, selectTemplateLine, type TemplateAgents } from './select-line'
import { FACT_FREE_BODY, compositionIssues, repairComposition } from './selection'
import { one, tpl } from './selection.fixture'
import { evidenceOf } from './selection-facts'
import { FACT_FREE_FILLERS, PAGE_SHOT_MAX, solveOrder } from './selection-order'
import { K_SECTIONS, type MetaSlot, type TemplateMeta, type TemplateZone } from './template-meta'
import { PAGE_SECTIONS } from './template-types'

const SECTION = 'motion_band'
const ALL = TEMPLATES as unknown as TemplateMeta[]
const bare = { productName: '시험 상품' } as unknown as PdpSpecSheet
const photos = (n: number) => ({ options: Array.from({ length: n }, (_, i) => ({ label: `옵션${i}`, image: `https://example.com/o${i}.jpg` })) })

describe('근거 motion — 켠 잡은 늘(인쇄물은 옵션 사진 2장 이상만)', () => {
  it('켠 잡은 사용법·옵션 사진이 없어도 연다', () => {
    expect(evidenceOf(bare).has('usage')).toBe(false)
    expect(lineEvidenceOf({ spec: bare, motionBand: true }).has('motion')).toBe(true)
    expect(lineEvidenceOf({ spec: bare, motionBand: true, textBearing: false, inputs: photos(0) as never }).has('motion')).toBe(true)
  })

  it('인쇄물(GIF를 쓰지 않음)은 실물 옵션 사진이 2장 이상일 때만 연다 — 지금 규칙 그대로', () => {
    const usage = { ...bare, usageLocation: '거실' } as PdpSpecSheet
    expect(lineEvidenceOf({ spec: usage, motionBand: true, textBearing: true }).has('motion')).toBe(false)
    expect(lineEvidenceOf({ spec: bare, motionBand: true, textBearing: true, inputs: photos(MOTION_OPTION_PHOTOS_MIN - 1) as never }).has('motion')).toBe(false)
    expect(lineEvidenceOf({ spec: bare, motionBand: true, textBearing: true, inputs: photos(MOTION_OPTION_PHOTOS_MIN) as never }).has('motion')).toBe(true)
  })

  it('끈 잡은 evidenceOf와 같다', () => {
    for (const textBearing of [false, true]) {
      const off = lineEvidenceOf({ spec: bare, textBearing, inputs: photos(3) as never })
      expect([...off]).toEqual([...evidenceOf(bare)])
    }
  })
})

describe('구성 고치기 — 빠진 GIF 칸을 넣는다', () => {
  const open = [...K_SECTIONS]
  const motion = new Set(['motion'])
  /** 상한(22)까지 찬 구성 — 필수 셋 + 채움 둘 + 사실 없는 본문 하나 + 그 밖 */
  const full = [
    'hook_3step',
    'main_cut',
    'problem_raise',
    'solution_guide',
    'key_message',
    'point_div',
    'point_div',
    'point_div',
    'sub_div',
    'hidden_page',
    'compare',
    'point_list_div',
    'sub2_div_page',
    'option_gallery',
    'review',
    'perf_metric',
    'faq',
    'concept_desc',
    'product_exposure',
    'direction_suggest',
    'spec_table',
    'cta',
  ]

  it('자리가 남으면 그냥 더한다', () => {
    const out = repairComposition(['hook_3step', 'main_cut', 'point_div', 'spec_table', 'cta'], motion, open)
    expect(out.sections.filter((s) => s === SECTION)).toHaveLength(1)
    expect(out.added).toContain(SECTION)
    expect(out.removed).toEqual([])
  })

  it('상한이 차 있으면 채움 칸 하나(뒤에서부터)를 빼고 넣는다 — 길이는 그대로', () => {
    expect(full).toHaveLength(PAGE_SECTIONS.max)
    const out = repairComposition(full, new Set(['motion', 'review']), open)
    expect(out.sections).toHaveLength(PAGE_SECTIONS.max)
    expect(out.sections).toContain(SECTION)
    expect(out.removed).toEqual(['product_exposure'])
    expect(out.sections.filter((s) => (FACT_FREE_FILLERS as readonly string[]).includes(s))).toEqual(['sub2_div_page'])
  })

  it('채움이 없으면 사실을 쓰지 않는 본문, 그것도 없으면 필수·큰 POINT·후기가 아닌 칸을 뒤에서부터 뺀다', () => {
    const noFiller = full.map((s) => ((FACT_FREE_FILLERS as readonly string[]).includes(s) ? 'sub_div' : s))
    const a = repairComposition(noFiller, new Set(['motion', 'review']), open)
    expect(a.removed.at(-1)).toBe('option_gallery')
    expect(a.sections).toContain(SECTION)
    const noBody = noFiller.map((s) => ((FACT_FREE_BODY as readonly string[]).includes(s) ? 'sub_div' : s))
    const b = repairComposition(noBody, new Set(['motion', 'review']), open)
    expect(b.sections).toContain(SECTION)
    expect(b.sections).toEqual(expect.arrayContaining(['hook_3step', 'spec_table', 'cta', 'review']))
    expect(b.sections.filter((s) => s === 'point_div')).toHaveLength(3)
    expect(b.removed.at(-1)).toBe('direction_suggest')
  })

  it('이미 있으면 그대로, 고를 수 없으면(후보 없음) 넣지 않는다', () => {
    const withMotion = repairComposition(['hook_3step', SECTION, 'spec_table', 'cta'], motion, open)
    expect(withMotion.sections.filter((s) => s === SECTION)).toHaveLength(1)
    expect(withMotion.added).not.toContain(SECTION)
    const closed = repairComposition(full, motion, open.filter((s) => s !== SECTION))
    expect(closed.sections).not.toContain(SECTION)
  })

  it('근거 motion이 없으면(꺼진 잡) 지금과 같다 — 구성 목록이 같은 입력과 같은 결과', () => {
    for (const sections of [full, full.slice(0, 12), ['hook_3step', 'spec_table', 'cta']]) {
      const evidence = new Set(['review', 'usage'])
      const out = repairComposition(sections, evidence, open)
      expect(out.sections).not.toContain(SECTION)
      expect(out).toEqual(repairComposition(sections, evidence, open.filter((s) => s !== SECTION)))
    }
  })
})

describe('컷 상한 — GIF 칸은 빼지 않는다', () => {
  const concept = conceptById('clean-trust')!
  const shots = (n: number): Record<string, MetaSlot> =>
    Object.fromEntries(Array.from({ length: n }, (_, i) => [`photo${i}`, { type: 'image' as const, required: true, purpose: ['scene'], composition: ['front'] }]))
  const cut = (id: string, n: number, zone: TemplateZone = 'value') => tpl(id, { slots: shots(n), zone })

  it('컷 1장 칸끼리 같으면 뒤쪽을 빼던 규칙에서 GIF 칸을 지키고 다른 칸을 뺀다', () => {
    const r = solveOrder(
      [one('hook_3step', cut('hook_3step.t', PAGE_SHOT_MAX - 3, 'intro')), one('a', cut('a.t', 1)), one(SECTION, cut(`${SECTION}.t`, 1)), one('cta', cut('cta.t', 2, 'decision'))],
      concept
    )
    // 최소 컷 합 33 > 32 — 예전에는 컷 1장끼리 같아 뒤쪽인 GIF 칸이 빠졌다
    expect(r.droppedForShots).toEqual(['a'])
    expect(r.sections.map((s) => s.section)).toEqual(expect.arrayContaining(['hook_3step', SECTION, 'cta']))
  })
})

describe('동작 문구·GIF 지시 — 실물 쓰는 법과 다른 동작 금지(오너 11-05 지적)', () => {
  it('카피 안내표 GIF 칸 줄은 상품 사실·사용 장면에서 고르고 반대로 쥐기 같은 동작을 피한다', () => {
    expect(SECTION_COPY_GUIDE[SECTION].title).toContain('상품 사실·사용 장면')
    expect(sectionGuideLine(SECTION)).toContain('실물을 쓰는 방식과 다른 동작(반대로 쥐기')
    expect(sectionGuideLine(SECTION)).not.toMatch(/효과|체감|효익/)
  })

  it('GIF 지시는 실물 쓰는 방향·면·위아래를 지키라고 한다', () => {
    const prompt = gifPromptOf('BASE', { action: '머리를 빗는 모습', loop: 'back_and_forth' })
    expect(prompt).toContain('exactly the way it is really used')
    expect(prompt).toContain('Never hold it backwards or upside down')
  })
})

describe('실제 라이브러리 × 시험 상품', () => {
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

  it.each(PDP_TEST_PRODUCT_IDS)('%s 켠 잡은 GIF 칸이 한 개 놓이고(인쇄물+옵션 사진 부족은 0), 태스크가 GIF 칸을 만든다', async (id) => {
    const job = jobOf(id, ['designcut', 'templatelib', 'motionband'])
    const input = { ...selectLineInputOf(job, ALL), inputs: lineInputsOf(job) }
    const line = await selectTemplateLine(input, agents)
    const sections = line.order.sections.map((s) => s.section)
    const expected = lineEvidenceOf(input).has('motion') ? 1 : 0
    expect(sections.filter((s) => s === SECTION)).toHaveLength(expected)
    expect(compositionIssues(sections, lineEvidenceOf(input)).filter((issue) => issue.includes(SECTION))).toEqual([])
    if (expected === 0) {
      expect(input.textBearing).toBe(true)
      return
    }
    const task = motionTaskOf(job, { section: SECTION, show: '펼쳐 쓰는 모습' }, isTextBearingJob(job))
    expect(task?.mode).toBe(input.textBearing ? 'slide' : evidenceOf(job.spec_sheet).has('usage') || (task?.optionPhotos.length ?? 0) < 2 ? 'gif' : 'slide')
  })

  it.each(PDP_TEST_PRODUCT_IDS)('%s 끈 잡은 GIF 칸이 없고, 켠 잡과 근거만 motion 하나 다르다', async (id) => {
    const off = jobOf(id, ['designcut', 'templatelib'])
    const input = { ...selectLineInputOf(off, ALL), inputs: lineInputsOf(off) }
    const line = await selectTemplateLine(input, agents)
    expect(line.order.sections.map((s) => s.section)).not.toContain(SECTION)
    const on = { ...selectLineInputOf(jobOf(id, ['designcut', 'templatelib', 'motionband']), ALL), inputs: lineInputsOf(off) }
    const extra = [...lineEvidenceOf(on)].filter((e) => !lineEvidenceOf(input).has(e))
    expect(extra.length).toBeLessThanOrEqual(1)
    if (extra.length === 1) expect(extra).toEqual(['motion'])
  })
})
