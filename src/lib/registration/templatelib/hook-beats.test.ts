/**
 * K 첫 화면 안 B '3박자'(hookbeats 스위치, 결정 카드 c19·하네스 J24 — 오너 11-07 승인 카드 원문, 인터뷰 I5-3 '정원부터 스위치로'). 켠 K 잡에만 근거 hook_beats가 서서
 * 정원(garden_diy) 첫 화면 후보에 hook_3step.garden-beats가 든다. lint 예외 3건(보조 둘·사진 0.45·여백 80/40)은 안 B 표지 템플릿에만 열리고, 표지가 없는
 * 템플릿의 lint 결과는 그대로다. 꺼진 잡의 선택·컷·렌더 바이트는 k-line-run 지문 스냅숏이 지킨다. LLM·DB 없음(유료 0)
 */

import { describe, expect, it } from 'vitest'
import { buildSlotCopyPrompt } from '@/lib/agents/registration/prompts/pdp-template-copy-prompts'
import { getPdpTestProduct, PDP_TEST_PRODUCT_IDS } from '../__fixtures__/pdp-products'
import { ENRICHMENT_DEFAULTS, K4_SWITCHED_ON, resolveEnabledFeatures } from '../enrichment-switch'
import type { PdpJobRow } from '../pdp-state'
import { CONCEPTS } from './concepts'
import { renderTemplate } from './engine'
import { HOOK_BEATS_COPY_NOTE, HOOK_BEATS_EVIDENCE, isHookBeats } from './hook-beats'
import { templateById, TEMPLATES } from './library'
import { lintTemplate } from './lint'
import { judgeProductFamily } from './product-family'
import { sampleContext, sampleSlots } from './sample'
import { slotCopySections } from './section-values'
import { lineEvidenceOf, lineFactsOf, selectLineInputOf, selectTemplateLine, type TemplateAgents } from './select-line'
import { candidatesFor, type SelectionProfile } from './selection'
import { factBudget } from './selection-facts'
import type { OrderedSection } from './selection-order'
import type { TemplateMeta } from './template-meta'
import type { Template } from './template-types'

const BEATS_ID = 'hook_3step.garden-beats'
const LIBRARY = TEMPLATES as unknown as TemplateMeta[]
const GARDEN = 'garden_diy'
const SCREEN_H = 1860
const item = getPdpTestProduct('P08')
const beats = (): Template => {
  const found = templateById(BEATS_ID)
  if (!found) throw new Error(`라이브러리에 없음: ${BEATS_ID}`)
  return found
}
/** 표지를 뗀 같은 템플릿 — 예외가 표지에만 열리는지 본다 */
const unmarked = (t: Template): Template => ({ ...t, needs: { ...t.needs, evidence: t.needs.evidence.filter((e) => e !== HOOK_BEATS_EVIDENCE) } })
const details = (t: Template) => lintTemplate(t).map((v) => `${v.rule}: ${v.detail}`)

const free = <T,>(value: T) => ({ value, usedFallback: false, error: null, costUsd: 0 })
const jobOf = (id: string, features: readonly string[], product = item, spec: PdpJobRow['spec_sheet'] = product.specSheet) =>
  ({
    id,
    cost_pool: null,
    spec_sheet: spec,
    analysis: { detected_category: product.categoryKey, ...(features.length > 0 ? { enrichment: { version: 1, features } } : {}) },
    copy_sections: { final: { options: product.specSheet.colorOptions ?? [] } },
    section_plan: {},
  }) as unknown as PdpJobRow

type HookPick = 'first' | 'last'
/** 첫 화면 후보(모델이 받은 목록)와 놓인 첫 화면 — 모델은 받은 첫 후보(first) 또는 마지막 후보(last — 안 B가 아닌 첫 화면을 고르는 콜 흉내)를 고른다 */
async function hookOf(job: PdpJobRow, pick: HookPick = 'first'): Promise<{ candidates: string[]; placed: string | undefined; fallbackFrom: string | undefined }> {
  const candidates: string[] = []
  const agents: TemplateAgents = {
    guideline: async ({ concepts }) => free({ persona: '', tone: '', concept: { id: concepts[0].id, reason: '' }, alternatives: [] }),
    compose: async () => free([]),
    select: async ({ slots }) => {
      for (const slot of slots) if (slot.section === 'hook_3step') candidates.push(...slot.candidates.map((c) => c.id))
      return free(slots.map((slot) => ({ index: slot.index, templateId: slot.candidates[pick === 'first' ? 0 : slot.candidates.length - 1].id, reason: '' })))
    },
  }
  const { order } = await selectTemplateLine(selectLineInputOf(job, LIBRARY), agents)
  const hook = order.sections.find((s) => s.section === 'hook_3step')
  return { candidates, placed: hook?.templateId, fallbackFrom: hook?.fallbackFrom }
}

describe('hookbeats 스위치 — 기본 off, K 잡에서만', () => {
  it('기본 off·K4_SWITCHED_ON 밖 — 운영(Vercel·작업자)은 EXTRA를 무시하고, 로컬 EXTRA로 K 잡에서만 기록하며 K가 아니면 빠진다', () => {
    expect(ENRICHMENT_DEFAULTS.hookbeats).toBe(false)
    expect(K4_SWITCHED_ON).not.toContain('hookbeats')
    expect(resolveEnabledFeatures({})).not.toContain('hookbeats')
    expect(resolveEnabledFeatures({ VERCEL: '1', NEXOPS_PDP_ENRICHMENT_EXTRA: 'hookbeats' })).not.toContain('hookbeats')
    expect(resolveEnabledFeatures({ NEXOPS_PDP_HOSTED: 'railway-worker', NEXOPS_PDP_ENRICHMENT_EXTRA: 'hookbeats' })).not.toContain('hookbeats')
    expect(resolveEnabledFeatures({ NEXOPS_PDP_ENRICHMENT_EXTRA: 'hookbeats' })).toContain('hookbeats')
    expect(resolveEnabledFeatures({ NEXOPS_PDP_ENRICHMENT_EXTRA: 'hookbeats', NEXOPS_PDP_ENRICHMENT_SKIP: 'templatelib' })).not.toContain('hookbeats')
    expect(resolveEnabledFeatures({ NEXOPS_PDP_ENRICHMENT_EXTRA: 'hookbeats', NEXOPS_PDP_ENRICHMENT_SKIP: 'designcut' })).not.toContain('hookbeats')
  })

  it('켜도 다른 기능 목록은 그대로다 — hookbeats 하나만 더해진다', () => {
    const on = resolveEnabledFeatures({ NEXOPS_PDP_ENRICHMENT_EXTRA: 'hookbeats' })
    expect(on.filter((f) => f !== 'hookbeats')).toEqual(resolveEnabledFeatures({}))
  })

  it('켠 잡만 근거 hook_beats가 선다(잡 기록 → 선택 입력 → 근거)', () => {
    expect(lineEvidenceOf({ spec: item.specSheet }).has(HOOK_BEATS_EVIDENCE)).toBe(false)
    expect(lineEvidenceOf({ spec: item.specSheet, hookBeats: true }).has(HOOK_BEATS_EVIDENCE)).toBe(true)
    expect(selectLineInputOf(jobOf('job-0', []), LIBRARY).hookBeats).toBeUndefined()
    expect(selectLineInputOf(jobOf('job-0', ['hookbeats']), LIBRARY).hookBeats).toBe(true)
  })
})

describe('안 B lint 예외 3건 — 표지 템플릿에만', () => {
  it('표지(needs.evidence hook_beats)가 있는 템플릿은 안 B 하나다', () => {
    expect(TEMPLATES.filter(isHookBeats).map((t) => t.id)).toEqual([BEATS_ID])
  })

  it('안 B 템플릿은 lint를 통과하고, 표지를 떼면 지금 lint가 그대로 막는다(보조 둘·사진 0.462·여백 80/40)', () => {
    expect(details(beats())).toEqual([])
    expect(details(unmarked(beats()))).toEqual(['space: top 80 범위 120~140', 'space: bottom 40 범위 120~140', 'hook: 보조 글 2개 — 하나만', 'hook: 첫 화면 가장 큰 사진 0.462 < 0.55'])
  })

  it('표지가 있어도 조건 밖이면 막는다 — 글 3줄·36자 초과, 큰 제목 둘, 여백 80/40 아닌 값', () => {
    const t = beats()
    const longer: Template = { ...t, slots: { ...t.slots, solve: { ...t.slots.solve, maxLines: 2 } as Template['slots'][string] } }
    expect(details(longer)).toContain('hook: 보조 글 2개 — 하나만')
    const odd: Template = { ...t, spacing: { ...t.spacing, top: 100, bottom: 60 } }
    expect(details(odd)).toEqual(expect.arrayContaining(['space: top 100 범위 120~140', 'space: bottom 60 범위 120~140']))
  })

  // 라이브러리 전체 위반 0(표지 없는 템플릿 포함)은 library.test가 본다 — 여기는 예외 세 곳(첫 화면 글·사진·여백)을 지나는 첫 화면 템플릿만 다시 본다
  it('표지가 없는 첫 화면 템플릿 전부 lint 결과가 그대로다(위반 0)', { timeout: 60_000 }, () => {
    const hooks = TEMPLATES.filter((t) => t.section === 'hook_3step' && !isHookBeats(t))
    expect(hooks.length).toBeGreaterThan(0)
    expect(hooks.flatMap((t) => lintTemplate(t))).toEqual([])
  })
})

describe('안 B 렌더 — 약속 한 줄·정사각 대표·증거 띠·해결 한 줄, 다음 섹션이 보인다', () => {
  it('headline 6자 1줄·풀폭 1:1 대표·증거 띠 195px, 첫 화면 높이 1561(다음 섹션 299px 보임)', () => {
    const t = beats()
    expect(t.slots.headline).toMatchObject({ maxChars: 6, maxLines: 1 })
    const out = renderTemplate(t, sampleSlots(t, { mode: 'full', factor: 1 }), sampleContext())
    const el = (name: string) => out?.elements.find((e) => e.name === name)
    expect(el('designcut-scene')?.transform).toMatchObject({ width: 860, height: 860 })
    expect(el('designcut-panel')?.transform.height).toBe(195)
    expect(out?.height).toBe(1561)
    expect(SCREEN_H - (out?.height ?? SCREEN_H)).toBeGreaterThanOrEqual(299)
  })
})

describe('정원 후보 — 꺼진 잡은 안 B가 없고 켠 잡은 있다', () => {
  const profileOf = (evidence: Set<string>): SelectionProfile => ({ key: item.specSheet.productName!, categoryKey: item.categoryKey, productFamily: GARDEN, productHex: null, photoCount: 6, evidence })

  it('P08(정원) 맞는 모든 컨셉 — 근거 없으면 후보에 없고, hook_beats 근거면 후보에 든다', () => {
    expect(judgeProductFamily(item.categoryKey, item.specSheet)).toBe(GARDEN)
    const fitting = CONCEPTS.filter((concept) => beats().fit.concepts.includes(concept.id))
    expect(fitting.length).toBeGreaterThan(0)
    for (const concept of fitting) {
      expect(candidatesFor('hook_3step', LIBRARY, profileOf(new Set()), concept).map((t) => t.id), concept.id).not.toContain(BEATS_ID)
      expect(candidatesFor('hook_3step', LIBRARY, profileOf(new Set([HOOK_BEATS_EVIDENCE])), concept).map((t) => t.id), concept.id).toContain(BEATS_ID)
    }
  })

  it.each(PDP_TEST_PRODUCT_IDS.filter((id) => judgeProductFamily(getPdpTestProduct(id).categoryKey, getPdpTestProduct(id).specSheet) !== GARDEN))('%s(정원 아님) — hook_beats 근거가 있어도 후보에 없다', (id) => {
    const product = getPdpTestProduct(id)
    const productFamily = judgeProductFamily(product.categoryKey, product.specSheet)
    const profile: SelectionProfile = { key: product.specSheet.productName ?? id, categoryKey: product.categoryKey, ...(productFamily ? { productFamily } : {}), productHex: null, photoCount: 6, evidence: new Set([HOOK_BEATS_EVIDENCE]) }
    for (const concept of CONCEPTS) expect(candidatesFor('hook_3step', LIBRARY, profile, concept, Number.POSITIVE_INFINITY).map((t) => t.id), concept.id).not.toContain(BEATS_ID)
  })

  it('운영 잡 12개 — 꺼진 잡은 모델이 받은 첫 화면 후보에 안 B가 없고, 켠 잡은 늘 있다', async () => {
    for (let i = 0; i < 12; i++) {
      const off = await hookOf(jobOf(`job-${i}`, []))
      const on = await hookOf(jobOf(`job-${i}`, ['hookbeats']))
      expect(off.candidates, `job-${i}`).not.toContain(BEATS_ID)
      expect(off.placed, `job-${i}`).not.toBe(BEATS_ID)
      expect(on.candidates, `job-${i}`).toContain(BEATS_ID)
    }
  })
})

describe('안 B 고정(J41) — 켠 잡 + 정원 fit이면 첫 화면이 안 B, 꺼진 잡·fit 밖 잡은 그대로', () => {
  const NOT_GARDEN = PDP_TEST_PRODUCT_IDS.filter((id) => judgeProductFamily(getPdpTestProduct(id).categoryKey, getPdpTestProduct(id).specSheet) !== GARDEN)

  it('P08 켠 잡 12개 — 모델이 받은 첫 화면 후보는 안 B 하나이고, 마지막 후보를 고르는 콜이어도 놓인 첫 화면은 안 B다', async () => {
    for (let i = 0; i < 12; i++) {
      for (const pick of ['first', 'last'] as const) {
        const on = await hookOf(jobOf(`job-${i}`, ['hookbeats']), pick)
        expect(on.candidates, `job-${i} ${pick}`).toEqual([BEATS_ID])
        expect(on.placed, `job-${i} ${pick}`).toBe(BEATS_ID)
        expect(on.fallbackFrom, `job-${i} ${pick}`).toBeUndefined()
      }
    }
  })

  it('P08 꺼진 잡 — 후보에 안 B가 없고 여러 후보 중 콜이 고른 첫 화면이 놓인다(고정 없음)', async () => {
    for (let i = 0; i < 12; i++) {
      const first = await hookOf(jobOf(`job-${i}`, []), 'first')
      const last = await hookOf(jobOf(`job-${i}`, []), 'last')
      expect(first.candidates, `job-${i}`).not.toContain(BEATS_ID)
      expect(first.candidates.length, `job-${i}`).toBeGreaterThan(1)
      expect(last.candidates, `job-${i}`).toEqual(first.candidates)
      expect([first.placed, last.placed], `job-${i}`).not.toContain(BEATS_ID)
    }
  })

  it.each(NOT_GARDEN)('%s(정원 아님) — 켠 잡의 첫 화면 후보·놓인 첫 화면이 꺼진 잡과 같다', async (id) => {
    const product = getPdpTestProduct(id)
    for (let i = 0; i < 3; i++) {
      for (const pick of ['first', 'last'] as const) {
        const off = await hookOf(jobOf(`job-${i}`, [], product), pick)
        const on = await hookOf(jobOf(`job-${i}`, ['hookbeats'], product), pick)
        expect(on, `job-${i} ${pick}`).toEqual(off)
        expect(on.candidates, `job-${i} ${pick}`).not.toContain(BEATS_ID)
      }
    }
  })

  it('켠 정원 잡에서 사실 칸이 1칸뿐이면(안 B는 2칸) 고정 전 후보로 내려가고(fallbackFrom = 안 B) 첫 화면이 빠지지 않는다', async () => {
    const { productName, category, categoryDetail, brandName, colorOptions } = item.specSheet
    const thin = { productName, category, categoryDetail, brandName, colorOptions } as PdpJobRow['spec_sheet']
    expect(factBudget(lineFactsOf({ spec: thin })).places).toBe(1)
    const off = await hookOf(jobOf('job-thin', [], item, thin))
    const on = await hookOf(jobOf('job-thin', ['hookbeats'], item, thin))
    expect(off.placed).toBeDefined()
    expect(on.candidates).toEqual([BEATS_ID])
    expect(on.placed).toBeDefined()
    expect(on.placed).not.toBe(BEATS_ID)
    expect(on.fallbackFrom).toBe(BEATS_ID)
  })
})

describe('안 B 칸 카피 안내 — 안 B 섹션에만', () => {
  const row = (templateId: string): OrderedSection => ({ section: 'hook_3step', templateId, factSlots: 2 }) as unknown as OrderedSection

  it('안 B 섹션만 proof·solve 뜻 한 줄이 붙고, 다른 첫 화면은 note가 없다', () => {
    const [sectionB] = slotCopySections([row(BEATS_ID)])
    expect(sectionB.note).toBe(HOOK_BEATS_COPY_NOTE)
    const others = TEMPLATES.filter((t) => t.section === 'hook_3step' && !isHookBeats(t))
    expect(others.length).toBeGreaterThan(0)
    for (const t of others) expect(slotCopySections([row(t.id)])[0]?.note, t.id).toBeUndefined()
  })

  it('칸 카피 프롬프트 — 안 B 섹션이 있는 콜에만 안내 줄이 들어간다', () => {
    const input = (templateId: string) => ({
      product: { category: item.categoryKey, persona: null, summary: '', keywords: [], usps: [], pains: [] },
      guideline: { persona: '', tone: '' },
      facts: ['별점 4.8'],
      sections: slotCopySections([row(templateId)]),
    })
    expect(buildSlotCopyPrompt(input(BEATS_ID))).toContain(HOOK_BEATS_COPY_NOTE)
    expect(buildSlotCopyPrompt(input('hook_3step.garden-title-scene-sub'))).not.toContain('칸 안내')
  })
})
