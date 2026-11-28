/**
 * 정원(garden_diy) 첫 화면·메인 컷 후보 넓히기(하네스 R12b, 오너 11-09 06:44 '지금 넓히기') — 운영 첫 잡 3ac1adf4가 R09c(운영 잡 씨앗에 잡 id) 뒤에도
 * 첫 화면 hook_3step.garden-title-scene-sub·메인 컷이 11-06 잡과 같았다. 후보는 5개였지만 정원 전용 칸이 섹션마다 하나라 가점(카테고리 1.5 + 제품군 0.5)으로
 * 늘 맨 앞이었고, 씨앗은 동점 순서만 바꿔 맨 앞이 바뀌지 않았다. 정원 전용 칸을 하나씩 더해 두 칸이 같은 점수가 되고 씨앗이 앞뒤를 가른다.
 * AI 단계는 가짜다(유료 호출 0) — 모델은 늘 받은 첫 후보를 고른다
 */

import { describe, expect, it } from 'vitest'
import { getPdpTestProduct, PDP_TEST_PRODUCT_IDS } from '../__fixtures__/pdp-products'
import type { PdpJobRow } from '../pdp-state'
import { CONCEPTS } from './concepts'
import { TEMPLATES } from './library'
import { judgeProductFamily } from './product-family'
import { selectLineInputOf, selectTemplateLine, type TemplateAgents } from './select-line'
import { candidatesFor, type SelectionProfile } from './selection'
import { K_SECTIONS, type TemplateMeta } from './template-meta'

const LIBRARY = TEMPLATES as unknown as TemplateMeta[]
const GARDEN = 'garden_diy'
const SECTIONS = ['hook_3step', 'main_cut'] as const
const isGarden = (t: Pick<TemplateMeta, 'fit'>) => t.fit.productFamilies?.includes(GARDEN) ?? false
const gardenOf = (section: string) => LIBRARY.filter((t) => t.section === section && isGarden(t))
const item = getPdpTestProduct('P08')
const JOB_IDS = Array.from({ length: 12 }, (_, i) => `job-${i}`)

const free = <T,>(value: T) => ({ value, usedFallback: false, error: null, costUsd: 0 })

const jobOf = (id: string, costPool: 'test' | null) =>
  ({
    id,
    cost_pool: costPool,
    spec_sheet: item.specSheet,
    analysis: { detected_category: item.categoryKey },
    copy_sections: { final: { options: item.specSheet.colorOptions ?? [] } },
    section_plan: {},
  }) as unknown as PdpJobRow

/** 놓인 첫 화면·메인 컷 템플릿 — 모델은 받은 첫 후보를 고른다 */
async function placedOf(job: PdpJobRow): Promise<Record<(typeof SECTIONS)[number], string | undefined>> {
  const agents: TemplateAgents = {
    guideline: async ({ concepts }) => free({ persona: '', tone: '', concept: { id: concepts[0].id, reason: '' }, alternatives: [] }),
    compose: async () => free([]),
    select: async ({ slots }) => free(slots.map((slot) => ({ index: slot.index, templateId: slot.candidates[0].id, reason: '' }))),
  }
  const { record } = await selectTemplateLine(selectLineInputOf(job, LIBRARY), agents)
  const of = (section: string) => record.sections.find((s) => s.section === section)?.templateId
  return { hook_3step: of('hook_3step'), main_cut: of('main_cut') }
}

describe('정원 상품 후보 — 첫 화면·메인 컷 정원 전용 칸이 2개 이상', () => {
  it.each(SECTIONS)('%s 정원 전용 칸이 둘 이상이고, 같은 컨셉·밀도라 점수가 같다', (section) => {
    const cells = gardenOf(section)
    expect(cells.length).toBeGreaterThanOrEqual(2)
    expect(new Set(cells.map((t) => [...t.fit.concepts].sort().join()))).toHaveLength(1)
    expect(new Set(cells.map((t) => t.fit.density))).toHaveLength(1)
  })

  it.each(SECTIONS)('P08(정원) %s — 정원 칸이 맞는 모든 컨셉에서 정원 칸 둘이 함께 후보에 든다', (section) => {
    expect(judgeProductFamily(item.categoryKey, item.specSheet)).toBe(GARDEN)
    const profile: SelectionProfile = { key: item.specSheet.productName!, categoryKey: item.categoryKey, productFamily: GARDEN, productHex: null, photoCount: 6, evidence: new Set() }
    const fitting = CONCEPTS.filter((concept) => gardenOf(section)[0].fit.concepts.includes(concept.id))
    expect(fitting.length).toBeGreaterThan(0)
    for (const concept of fitting) {
      const ids = candidatesFor(section, LIBRARY, profile, concept).map((t) => t.id)
      expect(ids.filter((id) => gardenOf(section).some((t) => t.id === id)).length, `${concept.id} ${ids.join()}`).toBeGreaterThanOrEqual(2)
    }
  })
})

describe('정원 상품 · 운영 잡과 시험 잡', () => {
  it('운영 잡 12개 — 잡 id에 따라 첫 화면·메인 컷이 정원 칸 둘 사이에서 갈린다', async () => {
    const placed = await Promise.all(JOB_IDS.map((id) => placedOf(jobOf(id, null))))
    for (const section of SECTIONS) {
      const used = new Set(placed.map((p) => p[section]))
      expect(used.size, section).toBeGreaterThanOrEqual(2)
      for (const id of used) expect(gardenOf(section).some((t) => t.id === id), `${section} ${id}`).toBe(true)
    }
  })

  it('같은 운영 잡 id는 다시 돌려도 같은 첫 화면·메인 컷이다', async () => {
    expect(await placedOf(jobOf('job-3', null))).toEqual(await placedOf(jobOf('job-3', null)))
  })

  it('시험 잡은 잡 id가 달라도 같은 첫 화면·메인 컷이다(상품명 씨앗 — 배치 비교 공정성)', async () => {
    const placed = await Promise.all(JOB_IDS.map((id) => placedOf(jobOf(id, 'test'))))
    expect(new Set(placed.map((p) => JSON.stringify(p)))).toHaveLength(1)
    for (const section of SECTIONS) expect(gardenOf(section).some((t) => t.id === placed[0][section]), section).toBe(true)
  })
})

describe('다른 상품은 그대로 — 정원 전용 칸은 정원 제품군 상품의 후보에만 든다', () => {
  it.each(PDP_TEST_PRODUCT_IDS.filter((id) => judgeProductFamily(getPdpTestProduct(id).categoryKey, getPdpTestProduct(id).specSheet) !== GARDEN))('%s 모든 섹션·컨셉 후보에 정원 칸이 없다', (id) => {
    const product = getPdpTestProduct(id)
    const productFamily = judgeProductFamily(product.categoryKey, product.specSheet)
    const profile: SelectionProfile = {
      key: product.specSheet.productName ?? id,
      categoryKey: product.categoryKey,
      ...(productFamily ? { productFamily } : {}),
      productHex: null,
      photoCount: 6,
      evidence: new Set(['size', 'option', 'review', 'usage', 'notice', 'ingredient']),
    }
    for (const concept of CONCEPTS) {
      for (const section of K_SECTIONS) expect(candidatesFor(section, LIBRARY, profile, concept, Number.POSITIVE_INFINITY).filter(isGarden), `${concept.id} ${section}`).toEqual([])
    }
  })
})
