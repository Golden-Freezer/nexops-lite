/**
 * 카피 프롬프트 예시 색 — 디자인 컷 잡만 뺀다(2026-10-28). 예시 #c2410c가 세 번 나와 P02 R1·D 두 잡 모두 primary가 #C2410C였다.
 * 그 밖의 잡(Track S·대조군)은 프롬프트 그대로다. LLM은 모의(캔드 응답), 유료 호출 0.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ calls: [] as Array<{ agent: string; user: string }> }))

async function respond(options: Record<string, unknown>, parser: (text: string) => unknown) {
  const agent = String(options.agentName ?? '')
  const messages = (options.messages ?? []) as Array<{ content: string }>
  h.calls.push({ agent, user: messages.map((m) => m.content).join('\n') })
  const copy = {
    mainIntro: { brandAndName: '브랜드 · 상품', benefitHeadline: '헤드라인' },
    pointCards: ['하나', '둘', '셋', '넷'].map((title) => ({ title, description: '설명' })),
  }
  const text = agent === 'registration/pdp-copy-retry-pointcards' ? '[]' : JSON.stringify(copy)
  return { success: true, data: parser(text), usage: { inputTokens: 0, outputTokens: 0, cost: 0 }, duration: 0 }
}
vi.mock('@/lib/agents/_base', async (orig) => ({
  ...(await orig<typeof import('@/lib/agents/_base')>()),
  callAgent: (o: Record<string, unknown>, p: (t: string) => unknown) => respond(o, p),
}))
vi.mock('@/lib/agents/openai-chat', async (orig) => ({
  ...(await orig<typeof import('@/lib/agents/openai-chat')>()),
  callOpenAiChat: (o: Record<string, unknown>, p: (t: string) => unknown) => respond(o, p),
}))

import p03 from './__fixtures__/r1/p03-f2d72bd0.json'
import { runPdpCopywriting } from '@/lib/agents/registration/pdp-copy-agent'
import {
  buildPremiumCopywritingPrompt,
  stripExampleHexColors,
} from '@/lib/agents/registration/prompts/pdp-copy-prompts'
import { mergeManualStrategy } from './pdp-strategy-contract'
import type { PdpJobRow, PdpSpecSheet } from './pdp-state'

const HEX = /#[0-9a-fA-F]{6}\b/g

async function structuralPrompt(withoutExampleColors: boolean): Promise<string> {
  const job = p03 as unknown as PdpJobRow
  const out = await runPdpCopywriting({
    specSheet: job.spec_sheet as PdpSpecSheet,
    mode: job.mode,
    analysis: job.analysis,
    research: job.research_result,
    sectionPlan: job.section_plan,
    strategyContract: mergeManualStrategy(job.analysis.recommended_strategy_contract ?? {}, job.spec_sheet, []),
    ...(withoutExampleColors ? { withoutExampleColors } : {}),
  })
  expect(out.success).toBe(true)
  return h.calls.find((c) => c.agent === 'registration/pdp-copy-stage1')?.user ?? ''
}

beforeEach(() => {
  h.calls = []
})

describe('stripExampleHexColors — 예시 hex만 지운다', () => {
  const prompt = buildPremiumCopywritingPrompt({
    planningSkeleton: '{}',
    brandVoiceGuide: '',
    painPoints: '[]',
    reviewInsights: '{}',
    uspMapping: '{}',
    analysisResult: '{}',
    specSheet: '{}',
    essenceType: '',
    reviewsAnalysis: '',
    brandColorInstruction: '',
  })

  it('강조·소재별 예시 hex 목록은 없어지고, 설명어·범위 규칙·JSON #HEX 자리표시는 남는다', () => {
    expect(prompt).toContain('#c2410c')
    const stripped = stripExampleHexColors(prompt)
    expect(stripped).not.toMatch(/#c2410c|#be185d|#16a34a|#fbbf24/i)
    expect(stripped).toContain('따뜻한 브라운/골드 계열')
    expect(stripped).toContain('**녹색 계열 사용 금지**')
    expect(stripped).toContain('(#1a1a1a ~ #333333)')
    expect(stripped).toContain('"primary": "#HEX')
    // 남는 6자리 hex는 본문 글자색 범위 규칙뿐
    expect(new Set(stripped.match(HEX))).toEqual(new Set(['#1a1a1a', '#333333']))
  })
})

describe('runPdpCopywriting — withoutExampleColors', () => {
  it('디자인 컷 잡(플래그)은 구조 카피 프롬프트에서 예시 색이 빠지고, 그 밖은 그대로', async () => {
    const plain = await structuralPrompt(false)
    expect(plain).toContain('#c2410c')
    h.calls = []
    const designcut = await structuralPrompt(true)
    expect(designcut).not.toContain('#c2410c')
    expect(designcut.length).toBeLessThan(plain.length)
    expect(stripExampleHexColors(plain)).toBe(designcut)
  })
})
