/**
 * K 색 조합 비전 고르기 연결(결정 카드 c28, 하네스 J26 — 가정 B5) — palettepick 잡만 규칙이 색을 고른 컨셉의 앞 3개 조합을 비전 콜에 보이고,
 * 고르면 그 색·실패하면 규칙 색이다. 스위치가 꺼진 잡은 콜 0이고 기록이 바이트까지 같다. AI 단계는 가짜다(유료 호출 0)
 */

import { describe, expect, it, vi } from 'vitest'
import { getPdpTestProduct } from '../__fixtures__/pdp-products'
import type { PdpJobRow } from '../pdp-state'
import { conceptById } from './concepts'
import { TEMPLATES } from './library'
import { paletteCandidatesOf } from './palette-pick'
import { selectLineInputOf, selectTemplateLine, type TemplateAgents } from './select-line'
import type { TemplateMeta } from './template-meta'

const LIBRARY = TEMPLATES as unknown as TemplateMeta[]
const item = getPdpTestProduct('P08')
const PHOTO_HEX = '#2f6fd0'

const jobOf = (features: string[]) =>
  ({
    id: 'job-palette',
    cost_pool: 'test',
    spec_sheet: item.specSheet,
    analysis: { detected_category: item.categoryKey, raw_summary: '요약 한 줄', enrichment: { version: 1, features } },
    copy_sections: { final: { options: item.specSheet.colorOptions ?? [] } },
    section_plan: { designcut_photo: { product: PHOTO_HEX } },
  }) as unknown as PdpJobRow

const OFF = jobOf(['designcut', 'templatelib'])
const ON = jobOf(['designcut', 'templatelib', 'palettepick'])

const free = <T,>(value: T) => ({ value, usedFallback: false, error: null, costUsd: 0 })
const base: TemplateAgents = {
  guideline: async ({ concepts }) => free({ persona: '', tone: '', concept: { id: concepts[0].id, reason: '' }, alternatives: [] }),
  compose: async () => free([]),
  select: async ({ slots }) => free(slots.map((slot) => ({ index: slot.index, templateId: slot.candidates[0].id, reason: '' }))),
}

type PaletteAgent = NonNullable<TemplateAgents['palette']>
const pickAgent = (index: number | null, error: string | null = null, costUsd = 0.003) =>
  vi.fn<PaletteAgent>(async () => ({ value: index === null ? null : { index, reason: '사진 파랑과 어울림' }, usedFallback: index === null, error, costUsd }))
/** palette 칸을 뺀 기록 — 색 말고는 같은지 본다 */
const withoutPalette = (record: { palette: unknown }) => ({ ...record, palette: null })

const run = (job: PdpJobRow, agents: TemplateAgents) => selectTemplateLine(selectLineInputOf(job, LIBRARY), agents)

describe('selectLineInputOf — palettepick', () => {
  it('스위치 잡만 palettePick을 싣는다', () => {
    expect(selectLineInputOf(ON, LIBRARY).palettePick).toBe(true)
    expect(selectLineInputOf(OFF, LIBRARY)).not.toHaveProperty('palettePick')
  })
})

describe('selectTemplateLine — 색 조합 비전 고르기', () => {
  it('꺼진 잡은 콜이 붙어 있어도 부르지 않고, 결과·기록이 콜 없는 실행과 같다(palette 칸 그대로)', async () => {
    const palette = pickAgent(1)
    const withAgent = await run(OFF, { ...base, palette })
    const without = await run(OFF, base)
    expect(palette).not.toHaveBeenCalled()
    expect(withAgent).toEqual(without)
    expect(JSON.stringify(withAgent.record)).toBe(JSON.stringify(without.record))
    expect(withAgent.record.palette).toEqual({ id: without.palette.id })
  })

  it('켠 잡은 규칙 컨셉의 앞 3개를 보내고, 고른 색을 쓰고 기록한다(비용도 센다)', async () => {
    const palette = pickAgent(1)
    const out = await run(ON, { ...base, palette })
    const rule = await run(OFF, base)
    expect(palette).toHaveBeenCalledTimes(1)
    const sent = palette.mock.calls[0][0]
    const expected = paletteCandidatesOf(conceptById(out.concept.id)!, PHOTO_HEX)
    expect(sent.candidates.map((set) => set.id)).toEqual(expected.map((set) => set.id))
    expect(sent.product).toBe(`${item.specSheet.productName} — 요약 한 줄`)
    expect(out.palette).toEqual(expected[1])
    expect(out.record.palette).toEqual({ id: expected[1].id, pick: { by: 'vision', candidates: expected.map((set) => set.id), reason: '사진 파랑과 어울림' } })
    expect(out.costUsd).toBeCloseTo(rule.costUsd + 0.003, 10)
    // 색 말고는 같은 선택이다
    expect(out.concept).toEqual(rule.concept)
    expect(out.record.sections).toEqual(rule.record.sections)
  })

  it('콜이 실패하면 규칙 색이고 까닭이 기록·경고에 남는다', async () => {
    const out = await run(ON, { ...base, palette: pickAgent(null, '시간 초과', 0.001) })
    const rule = await run(OFF, base)
    expect(out.palette).toEqual(rule.palette)
    expect(out.record.palette).toEqual({ id: rule.palette.id, pick: { by: 'rule', candidates: expect.any(Array), error: '시간 초과' } })
    expect(out.warnings).toContain('색 고르기: 시간 초과')
    expect(out.costUsd).toBeCloseTo(rule.costUsd + 0.001, 10)
    expect(withoutPalette(out.record)).toEqual(withoutPalette(rule.record))
  })

  it('후보 밖 번호도 규칙 색이다', async () => {
    const out = await run(ON, { ...base, palette: pickAgent(7) })
    const rule = await run(OFF, base)
    expect(out.palette).toEqual(rule.palette)
    expect(out.record.palette.pick).toMatchObject({ by: 'rule', error: '후보 밖 번호 7' })
    expect(out.warnings).toContain('색 고르기: 후보 밖 번호 7 — 규칙 색')
  })

  it('켠 잡에 콜이 없으면(원본 사진 없음) 규칙 색이고 까닭을 남긴다', async () => {
    const out = await run(ON, base)
    const rule = await run(OFF, base)
    expect(out.palette).toEqual(rule.palette)
    expect(out.record.palette.pick).toMatchObject({ by: 'rule', error: '원본 사진 없음' })
    expect(out.record.palette.pick?.candidates).toHaveLength(3)
    expect(out.warnings).toContain('색 고르기: 원본 사진 없음 — 규칙 색')
  })
})
