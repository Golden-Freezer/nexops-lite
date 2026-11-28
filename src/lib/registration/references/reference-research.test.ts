/**
 * 레퍼런스 리서치 블록(13_REFERENCE_INPUT PR②) — 스위치 references 켜진 잡만, 원문 없이 구조만, 경쟁사 블록 뒤에 덧붙임.
 * 리서치 콜은 모의(유료 호출 0).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ call: vi.fn() }))
vi.mock('@/lib/agents/registration/token-steps', () => ({ callLlmWithTokenSteps: (...a: unknown[]) => h.call(...a) }))

import { runPdpResearch } from '@/lib/agents/registration/pdp-research-agent'
import { buildReferenceResearchBlock } from '@/lib/agents/registration/prompts/pdp-reference-prompts'
import { ENRICHMENT_DEFAULTS, resolveEnabledFeatures } from '../enrichment-switch'
import type { PdpJobRow } from '../pdp-state'
import { referenceResearchBlock } from './reference-research'
import type { ReferenceInput, ReferenceSection } from './reference-types'

const TRANSCRIPT = '물에 헹구기만 하면 끝나는 간편한 세척 구조라서 매일 쓰기 좋아요'
const section = (i: number, over: Partial<ReferenceSection> = {}): ReferenceSection => ({
  start: i * 5,
  end: i * 5 + 5,
  role: i === 0 ? 'hook' : 'usp',
  layout: i % 2 ? 'icon_grid' : 'full_photo',
  visual: '제품 단독 컷',
  move: '주장→근거',
  appeals: ['세척 편의'],
  density: 'low',
  ...over,
})
const ref = (over: Partial<ReferenceInput> = {}): ReferenceInput => ({
  id: 'r1',
  kind: 'competitor',
  fileName: 'rival-page.png',
  source: 'image',
  units: 6,
  insights: {
    version: 1,
    sections: [section(0), section(1), section(2)],
    flow: 'hook → usp ×2',
    strengths: ['첫 화면에 제품이 크게 보인다'],
    weaknesses: ['주장 뒤 근거가 약하다'],
    regulatedSuspects: 1,
  },
  transcript: TRANSCRIPT,
  costUsd: 0.08,
  analyzedAt: '2026-10-30T00:00:00.000Z',
  warnings: [],
  ...over,
})
const job = (features: string[] | null, refs: unknown): Pick<PdpJobRow, 'analysis' | 'spec_sheet'> =>
  ({
    analysis: features ? { enrichment: { version: 1, features } } : {},
    spec_sheet: { productName: '식기', referenceInputs: refs },
  }) as never

describe('스위치 references — 기본 off, 로컬 EXTRA로만', () => {
  it('기본값에 없고, EXTRA로만 더한다(Vercel은 무시)', () => {
    expect(ENRICHMENT_DEFAULTS.references).toBe(false)
    expect(resolveEnabledFeatures({})).not.toContain('references')
    expect(resolveEnabledFeatures({ NEXOPS_PDP_ENRICHMENT_EXTRA: 'references' })).toContain('references')
    expect(resolveEnabledFeatures({ NEXOPS_PDP_ENRICHMENT_EXTRA: 'references', VERCEL: '1' })).not.toContain('references')
  })
})

describe('referenceResearchBlock — 켜진 잡이고 레퍼런스가 있을 때만', () => {
  it('스위치가 꺼졌거나 기록이 없거나 레퍼런스가 없으면 undefined', () => {
    expect(referenceResearchBlock(job(['persuasion'], [ref()]))).toBeUndefined()
    expect(referenceResearchBlock(job(null, [ref()]))).toBeUndefined()
    expect(referenceResearchBlock(job(['references'], undefined))).toBeUndefined()
    expect(referenceResearchBlock(job(['references'], [ref({ insights: { ...ref().insights, sections: [] } })]))).toBeUndefined()
  })

  it('구조(흐름·구간·배치 빈도·강약점)만 싣고, 원문·파일명·비용·규제 수치는 싣지 않는다', () => {
    const block = referenceResearchBlock(job(['references'], [ref()]))!
    expect(block).toContain('### 레퍼런스 1 — 경쟁 상세페이지')
    expect(block).toContain('- 흐름: hook → usp ×2')
    expect(block).toContain('1) hook · full_photo · 주장→근거 · 소구: 세척 편의')
    expect(block).toContain('- 자주 쓴 배치: full_photo 2, icon_grid 1')
    expect(block).toContain('- 강점: 첫 화면에 제품이 크게 보인다')
    for (const absent of [TRANSCRIPT, 'rival-page', '0.08', 'regulated']) expect(block).not.toContain(absent)
    expect(block).toContain('usp_mapping과 planning_skeleton에만')
    expect(block).not.toContain('현행 페이지 진단(자사 기존 페이지)은 강점은 살리고')
  })

  it('자사 기존 페이지(own)는 현행 페이지 진단으로 표기하고 강점 유지를 지시한다', () => {
    const block = buildReferenceResearchBlock([ref({ kind: 'own' }), ref({ id: 'r2', kind: 'other' })])!
    expect(block).toContain('### 레퍼런스 1 — 현행 페이지 진단(자사 기존 페이지)')
    expect(block).toContain('### 레퍼런스 2 — 참고 페이지')
    expect(block).toContain('현행 페이지 진단(자사 기존 페이지)은 강점은 살리고 약점을 고치는 방향')
  })

  it('구간 줄은 레퍼런스당 12개까지', () => {
    const many = ref({ insights: { ...ref().insights, sections: Array.from({ length: 20 }, (_, i) => section(i)) } })
    const block = buildReferenceResearchBlock([many])!
    expect(block).toContain("'기존 제품'으로만")
    expect(block).not.toContain('기존 제품과 달리')
    expect(block).toContain('  12) ')
    expect(block).not.toContain('  13) ')
  })
})

describe('runPdpResearch — 레퍼런스 블록은 경쟁사 블록 뒤에, 없으면 프롬프트 그대로', () => {
  beforeEach(() => {
    h.call.mockReset().mockResolvedValue({ success: false, error: { message: 'x', stage: 'parse', attempts: 1 }, usage: { inputTokens: 0, outputTokens: 0, cost: 0 }, duration: 1 })
  })
  const input = { specSheet: { productName: '식기' }, analysis: {}, strategyContract: {} } as never
  const promptOf = () => (h.call.mock.calls.at(-1)![1] as { messages: Array<{ content: string }> }).messages[0].content

  it('순서: 본문 → 경쟁사 블록 → 레퍼런스 블록', async () => {
    await runPdpResearch(input)
    const base = promptOf()
    await runPdpResearch({ ...(input as object), competitorBlock: 'COMPETITOR', referenceBlock: 'REFERENCE' } as never)
    expect(promptOf()).toBe(`${base}\n\nCOMPETITOR\n\nREFERENCE`)
    await runPdpResearch({ ...(input as object), competitorBlock: 'COMPETITOR' } as never)
    expect(promptOf()).toBe(`${base}\n\nCOMPETITOR`)
  })
})
