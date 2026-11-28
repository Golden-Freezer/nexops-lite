/**
 * 브랜드색 안전망(NEXFIT 18dcaa1) — lightenHex·enforceBrandPalette 표, 카피 후처리 끝 배선(runPdpCopywriting).
 * 분석 maxTokens 4096(NEXFIT 51c8174) 배선도 함께 본다. LLM은 모의(callAgent 캔드 응답), 유료 호출 0.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ callAgent: vi.fn(), copy: {} as Record<string, unknown> }))

vi.mock('../_base', () => ({ callAgent: (...args: unknown[]) => h.callAgent(...args) }))
vi.mock('../openai-chat', () => ({ callOpenAiChat: vi.fn() }))

import { enforceBrandPalette, lightenHex } from './pdp-copy-defaults'
import { runPdpCopywriting } from './pdp-copy-agent'
import { runPdpAnalysis } from './pdp-analysis-agent'
import type { PdpSpecSheet } from '@/lib/registration/pdp-state'

const USAGE = { inputTokens: 0, outputTokens: 0, cost: 0 }

beforeEach(() => {
  h.callAgent.mockReset()
  h.callAgent.mockImplementation(async (opts: { agentName: string }, parser: (text: string) => unknown) => {
    const text =
      opts.agentName === 'registration/pdp-copy-retry-pointcards'
        ? '[]'
        : opts.agentName === 'registration/pdp-analysis'
          ? JSON.stringify({ keywords: ['k'], usp_candidates: ['u'], raw_summary: 's' })
          : JSON.stringify(h.copy)
    return { success: true, data: parser(text), usage: USAGE, duration: 0 }
  })
  h.copy = {
    mainIntro: { brandAndName: '브랜드 · 상품', benefitHeadline: '헤드라인' },
    designPalette: { primary: '#D63384', secondary: '#F59E0B', bgMain: '#FFF8F2', bgSub: '#FFE8D6', textMain: '#2A2A2A', textHighlight: '#D63384' },
    pointCards: [
      { title: '원터치 사용', description: '돌리기만 하면 끝' },
      { title: '안전 소재', description: '인증 소재' },
      { title: '대용량 구성', description: '10개입' },
      { title: '간편 보관', description: '접어서 보관' },
    ],
  }
})

describe('lightenHex — NEXFIT _lighten_hex 1:1', () => {
  it.each([
    ['#000000', 0.3, '#4c4c4c'],
    ['#ffffff', 0.3, '#ffffff'],
    ['#1E40AF', 0.3, '#6179c7'],
    ['#0a0b0c', 0.5, '#848585'],
    ['#12345', 0.3, '#12345'],
    ['zzzzzz', 0.3, 'zzzzzz'],
  ])('%s × %s → %s', (hex, factor, expected) => {
    expect(lightenHex(hex, factor)).toBe(expected)
  })
})

describe('enforceBrandPalette', () => {
  const palette = { primary: '#D63384', secondary: '#F59E0B', bgMain: '#FFF8F2', textHighlight: '#D63384' }

  it('지정 색과 다르면 primary·textHighlight를 지정 색으로, secondary를 30% 밝힌 색으로 바꾼다(나머지 보존)', () => {
    const out = enforceBrandPalette(palette, ' #1E40AF ')
    expect(out.replaced).toBe(true)
    expect(out.palette).toEqual({ primary: '#1E40AF', secondary: '#6179c7', bgMain: '#FFF8F2', textHighlight: '#1E40AF' })
  })

  it('이미 같으면(대소문자 무시) 손대지 않는다', () => {
    const out = enforceBrandPalette({ ...palette, primary: '#1e40af' }, '#1E40AF')
    expect(out.replaced).toBe(false)
    expect(out.palette).toEqual({ ...palette, primary: '#1e40af' })
  })

  it.each([undefined, '', '1E40AF', '#1E40A', '#GGGGGG', '#1E40AF00'])('유효하지 않은 지정 색(%s)은 무시한다', (hex) => {
    expect(enforceBrandPalette(palette, hex)).toEqual({ palette, replaced: false })
  })
})

describe('runPdpCopywriting — 후처리 끝에서 브랜드색 강제', () => {
  function copyInput(brandHexColor?: string) {
    return {
      specSheet: { productName: '파티 꽃가루 폭죽', ...(brandHexColor ? { brandHexColor } : {}) } as PdpSpecSheet,
      mode: 'premium' as const,
      analysis: {},
      research: {},
      sectionPlan: { activated_sections: ['main_intro'] },
      strategyContract: {},
    }
  }

  it('LLM이 지정 색을 무시하면 최종 팔레트를 지정 색으로 바꾼다', async () => {
    const out = await runPdpCopywriting(copyInput('#1E40AF'))
    expect(out.success).toBe(true)
    if (!out.success) return
    expect(out.data.final.designPalette).toMatchObject({ primary: '#1E40AF', secondary: '#6179c7', textHighlight: '#1E40AF', bgMain: '#FFF8F2' })
  })

  it('지정 색이 없으면 LLM 팔레트 그대로다', async () => {
    const out = await runPdpCopywriting(copyInput())
    if (!out.success) throw new Error('copy failed')
    expect(out.data.final.designPalette).toMatchObject({ primary: '#D63384', secondary: '#F59E0B' })
  })
})

describe('runPdpAnalysis — 분석 콜 출력 상한', () => {
  it('데이터 분석 콜은 maxTokens 4096으로 부른다', async () => {
    await runPdpAnalysis({ specSheet: { productName: 'p', category: 'household' }, reviewsSummary: '리뷰 데이터 없음' })
    const analysisCall = h.callAgent.mock.calls.find(([opts]) => (opts as { agentName: string }).agentName === 'registration/pdp-analysis')
    expect((analysisCall![0] as { config: { maxTokens: number } }).config.maxTokens).toBe(4096)
  })
})
