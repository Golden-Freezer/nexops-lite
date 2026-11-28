/**
 * K 선택 씨앗(R09c, 오너 11-08 22:4x '1번으로 진행') — 운영 잡(cost_pool 없음)은 상품명에 잡 id를 섞어 같은 상품도 잡마다 컨셉 순서·색·페이지 계열·후보 순서가 바뀐다.
 * 같은 잡 id는 늘 같고, 시험 잡(cost_pool 'test')은 이 PR 전처럼 상품명만 쓴다. AI 단계는 가짜다(유료 호출 0)
 */

import { describe, expect, it } from 'vitest'
import { getPdpTestProduct } from '../__fixtures__/pdp-products'
import type { PdpJobRow } from '../pdp-state'
import { CONCEPTS } from './concepts'
import { TEMPLATES } from './library'
import { selectionKeyOf, selectLineInputOf, selectTemplateLine, type TemplateAgents } from './select-line'
import { candidatesFor, conceptCandidates, pickPageFamily, pickPalette, type SelectionProfile } from './selection'
import { tpl } from './selection.fixture'
import { K_SECTIONS, type TemplateMeta } from './template-meta'

const LIBRARY = TEMPLATES as unknown as TemplateMeta[]
const item = getPdpTestProduct('P08')
const NAME = item.specSheet.productName!.trim()
const JOB_IDS = Array.from({ length: 12 }, (_, i) => `job-${i}`)

const jobOf = (id: string, costPool?: 'test' | null, productName: string | undefined = item.specSheet.productName) =>
  ({
    id,
    ...(costPool !== undefined ? { cost_pool: costPool } : {}),
    spec_sheet: { ...item.specSheet, productName },
    analysis: { detected_category: item.categoryKey },
    copy_sections: { final: { options: item.specSheet.colorOptions ?? [] } },
    section_plan: {},
  }) as unknown as PdpJobRow

const free = <T,>(value: T) => ({ value, usedFallback: false, error: null, costUsd: 0 })

/** 모델은 늘 받은 첫 후보를 고른다 — 결과가 받은 후보·순서만 따른다. 받은 컨셉 순서와 섹션 후보 순서를 남긴다 */
async function run(job: PdpJobRow) {
  const seen = { concepts: [] as string[], slots: [] as string[][] }
  const agents: TemplateAgents = {
    guideline: async ({ concepts }) => {
      seen.concepts = concepts.map((c) => c.id)
      return free({ persona: '', tone: '', concept: { id: concepts[0].id, reason: '' }, alternatives: [] })
    },
    compose: async () => free([]),
    select: async ({ slots }) => {
      seen.slots = slots.map((slot) => slot.candidates.map((c) => c.id))
      return free(slots.map((slot) => ({ index: slot.index, templateId: slot.candidates[0].id, reason: '' })))
    },
  }
  const out = await selectTemplateLine(selectLineInputOf(job, LIBRARY), agents)
  return { seen, record: out.record }
}

const profileOf = (key: string): SelectionProfile => ({ key, categoryKey: item.categoryKey, productHex: null, photoCount: 6, evidence: new Set() })
const distinct = (values: readonly unknown[]) => new Set(values.map((v) => JSON.stringify(v))).size

describe('selectionKeyOf — 잡 → K 선택 씨앗', () => {
  it('운영 잡(cost_pool null·없음)은 상품명에 잡 id를 섞고 방식을 싣는다', () => {
    expect(selectionKeyOf(jobOf('job-a', null))).toEqual({ key: `${NAME}#job-a`, seed: 'product+job' })
    expect(selectionKeyOf(jobOf('job-a'))).toEqual({ key: `${NAME}#job-a`, seed: 'product+job' })
    expect(selectionKeyOf(jobOf('job-a', null, '  '))).toEqual({ key: '#job-a', seed: 'product+job' })
  })

  it('시험 잡은 이 PR 전과 같다 — 상품명, 없으면 잡 id, 방식 칸 없음', () => {
    expect(selectionKeyOf(jobOf('job-a', 'test'))).toEqual({ key: NAME })
    expect(selectionKeyOf(jobOf('job-a', 'test', ' '))).toEqual({ key: 'job-a' })
    expect(selectLineInputOf(jobOf('job-a', 'test'), LIBRARY)).not.toHaveProperty('seed')
  })
})

describe('같은 상품 · 운영 잡', () => {
  it('잡 id가 다르면 AI가 받는 컨셉 순서와 섹션 후보 순서가 달라지고, 기록에 씨앗 방식이 남는다', async () => {
    const a = await run(jobOf('job-a', null))
    const b = await run(jobOf('job-b', null))
    expect(a.seen.concepts).not.toEqual(b.seen.concepts)
    expect(a.seen.slots).not.toEqual(b.seen.slots)
    expect(a.record.concept.id).not.toBe(b.record.concept.id)
    expect(a.record.seed).toBe('product+job')
    expect(b.record.seed).toBe('product+job')
  })

  it('같은 잡 id는 몇 번을 돌려도 같은 후보·같은 기록이다', async () => {
    const first = await run(jobOf('job-a', null))
    const again = await run(jobOf('job-a', null))
    expect(again).toEqual(first)
  })

  it('잡 12개에서 컨셉 순서·색·페이지 계열·후보 순서가 여러 값으로 갈린다(컨셉을 고정해도)', () => {
    const keys = JOB_IDS.map((id) => selectionKeyOf(jobOf(id, null)).key)
    expect(distinct(keys.map((key) => conceptCandidates(profileOf(key)).map((c) => c.id)))).toBe(keys.length)
    // 같은 컨셉 안에서 — 색은 같은 강조색 조합이 둘 이상인 컨셉, 페이지 계열은 계열이 둘 이상인 컨셉에서 갈린다
    const palettesVary = CONCEPTS.filter((concept) => distinct(keys.map((key) => pickPalette(concept, profileOf(key))?.id)) > 1)
    expect(palettesVary.length).toBeGreaterThan(0)
    // 페이지 계열 — 지금 라이브러리에는 계열 칸이 있는 템플릿이 없어(늘 null) 계열 넷짜리 표본으로 잰다
    const concept = CONCEPTS[0]
    const families = ['f1', 'f2', 'f3', 'f4'].map((family) => tpl(`point_div.${family}`, { family, concepts: [concept.id] }))
    expect(distinct(keys.map((key) => pickPageFamily(families, profileOf(key), concept)))).toBeGreaterThan(1)
    const candidateOrders = keys.map((key) => K_SECTIONS.map((section) => candidatesFor(section, LIBRARY, profileOf(key), concept).map((t) => t.id)))
    expect(distinct(candidateOrders)).toBeGreaterThan(1)
  })
})

describe('같은 상품 · 시험 잡', () => {
  it('잡 id가 달라도 받는 후보·기록이 같고 씨앗 방식 칸이 없다 — 상품명 씨앗 그대로', async () => {
    const a = await run(jobOf('job-a', 'test'))
    const b = await run(jobOf('job-b', 'test'))
    expect(b).toEqual(a)
    expect(a.record).not.toHaveProperty('seed')
  })

  it('잡 12개 모두 씨앗이 상품명 하나다 — 색·페이지 계열·후보 순서가 잡 id를 따르지 않는다', () => {
    const keys = JOB_IDS.map((id) => selectionKeyOf(jobOf(id, 'test')).key)
    expect(new Set(keys)).toEqual(new Set([NAME]))
  })
})
