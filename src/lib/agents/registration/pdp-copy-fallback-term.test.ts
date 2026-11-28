/**
 * 카피 대체 문구에 판정 코드가 나오지 않는지 — 소재가 빈 잡은 spec.category가 대체 공감 줄·포인트 카드로 그대로 흘렀다.
 * 소재가 있는 잡과 직접 입력한 카테고리의 문구는 그대로다. LLM은 모의(callAgent 캔드 응답), 유료 호출 0.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ callAgent: vi.fn() }))

vi.mock('../_base', () => ({ callAgent: (...args: unknown[]) => h.callAgent(...args) }))
vi.mock('../openai-chat', () => ({ callOpenAiChat: vi.fn() }))

import { fallbackCopyTerm } from '@/lib/registration/pdp-copy-rules'
import type { PdpSpecSheet } from '@/lib/registration/pdp-state'
import { THUMBNAIL_CATEGORIES } from '@/lib/registration/thumbnail-types'
import { runPdpCopywriting } from './pdp-copy-agent'

const USAGE = { inputTokens: 0, outputTokens: 0, cost: 0 }

// 카드·공감 줄을 비워 답해 대체 경로를 탄다
beforeEach(() => {
  h.callAgent.mockReset()
  h.callAgent.mockImplementation(async (opts: { agentName: string }, parser: (text: string) => unknown) => {
    const text = opts.agentName === 'registration/pdp-copy-retry-pointcards' ? '[]' : JSON.stringify({ mainIntro: { brandAndName: '브랜드 · 상품', benefitHeadline: '헤드라인' }, pointCards: [] })
    return { success: true, data: parser(text), usage: USAGE, duration: 0 }
  })
})

async function fallbackCopy(over: Partial<PdpSpecSheet>) {
  const out = await runPdpCopywriting({
    specSheet: { productName: '시험 상품', ...over },
    mode: 'premium',
    analysis: {},
    research: {},
    sectionPlan: { activated_sections: ['main_intro'] },
    strategyContract: {},
  })
  if (!out.success) throw new Error('copy failed')
  const { pointCards = [], problem } = out.data.final
  return {
    cards: pointCards.map((card) => `${card.title} / ${card.description}`),
    lines: [...(problem?.empathyLines ?? []), ...(problem?.empathyDeepLines ?? [])],
  }
}

describe('runPdpCopywriting — 대체 문구의 카테고리', () => {
  it.each(THUMBNAIL_CATEGORIES)('소재가 비면 판정 코드 %s가 나오지 않고 카테고리 없는 잡과 같은 문구다', async (category) => {
    const copy = await fallbackCopy({ category })
    expect(copy.cards.length).toBeGreaterThan(0)
    expect(copy.lines.length).toBeGreaterThan(0)
    expect([...copy.cards, ...copy.lines].join('\n')).not.toContain(category)
    expect(copy).toEqual(await fallbackCopy({}))
  })

  it('소재가 있으면 카테고리 코드와 상관없이 소재로 쓴다', async () => {
    const copy = await fallbackCopy({ material: '국내산 쌀', category: 'food' })
    expect(copy.cards[0]).toContain('국내산 쌀')
    expect(copy.lines).toContain('국내산 쌀 선택 어려우셨죠')
    expect(copy).toEqual(await fallbackCopy({ material: '국내산 쌀' }))
  })

  it('직접 입력한 카테고리는 그대로 쓴다', async () => {
    const copy = await fallbackCopy({ category: '건강식품' })
    expect(copy.cards[0]).toContain('건강식품')
    expect(copy.lines).toContain('건강식품 선택 어려우셨죠')
  })
})

describe('fallbackCopyTerm', () => {
  it('소재가 먼저, 코드는 빼고, 직접 입력은 그대로다', () => {
    expect(fallbackCopyTerm({ material: 'PE', category: 'household' })).toBe('PE')
    expect(fallbackCopyTerm({ material: 'PE', category: '건강식품' })).toBe('PE')
    expect(fallbackCopyTerm({ material: 'PE' })).toBe('PE')
    expect(fallbackCopyTerm({ category: 'household' })).toBe('')
    expect(fallbackCopyTerm({ category: ' food ' })).toBe('')
    expect(fallbackCopyTerm({ category: '식품' })).toBe('식품')
    expect(fallbackCopyTerm({})).toBe('')
  })
})
