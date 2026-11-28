/**
 * 디자인 콜② 텍스트 보유 상품 분기(NEXFIT b90f6c0 A-3) — 판정 배선·프롬프트 스코프·코드 강제(applyTextBearingPolicy).
 * LLM은 모의(callLlmWithTokenSteps가 캔드 응답을 parser에 넣어 돌려준다), 유료 호출 0.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ steps: vi.fn() }))

vi.mock('../_base', () => ({ callAgent: vi.fn() }))
// 모델 계층(묶음 1) — 설계 콜 ②는 라우트로 부른다(route, request, parser, steps). 시험은 요청·파서만 본다
vi.mock('./token-steps', () => ({
  callLlmWithTokenSteps: (_route: unknown, ...args: unknown[]) => h.steps(...args),
}))

import { applyTextBearingPolicy, generatePdpDesignPrompts, stripTextNegatives } from './pdp-design-agent'
import { NO_TEXT_INSTRUCTION, PRINTED_DESIGN_PRESERVE_INSTRUCTION } from './prompts/pdp-image-prompts'
import { TEXT_BEARING_PROMPT_SCOPE } from './prompts/pdp-design-prompts'
import type { DesignPrompts, PdpSpecSheet } from '@/lib/registration/pdp-state'

const NO_TEXT_SENTENCE = 'No text, letters, or typography anywhere in the image.'
const USAGE = { inputTokens: 0, outputTokens: 0, cost: 0.01 }

const RAW: DesignPrompts = {
  section_image_prompts: {
    hero: { positive: `Sticker sheet on linen. ${NO_TEXT_SENTENCE}`, negative: 'text, letters, watermark, children' },
    problem: { positive: `Frustrated person. ${NO_TEXT_INSTRUCTION}`, negative: 'Text, typography' },
  },
  feature_prompts: [{ positive: `Close-up of the print. ${NO_TEXT_SENTENCE}`, negative: 'words, blur' }],
  howto_prompts: [{ positive: 'Hands peeling a sticker.', negative: '' }],
  lighting_params: { direction: 'top-left' },
  color_params: { primary: '{palette.primary}' },
  composition_notes: 'cohesive set',
}

function input(productName: string, category = 'household', extra: Partial<{ textBearing: boolean }> = {}) {
  return {
    analysis: { detected_category: category, usp_candidates: ['선명한 인쇄'] },
    research: {},
    strategyContract: {},
    specSheet: { productName } as PdpSpecSheet,
    ...extra,
  }
}

beforeEach(() => {
  h.steps.mockReset()
  h.steps.mockImplementation(async (_opts: unknown, parser: (text: string) => unknown) => ({
    success: true,
    data: parser(JSON.stringify(RAW)),
    usage: USAGE,
    duration: 0,
  }))
})

const promptOf = () => (h.steps.mock.calls[0][0] as { messages: Array<{ content: string }> }).messages[0].content

describe('stripTextNegatives', () => {
  it.each([
    ['text, letters, watermark, children', 'watermark, children, text on background, caption'],
    ['Text, TYPOGRAPHY, words, writing', 'text on background, caption, watermark'],
    ['', 'text on background, caption, watermark'],
    ['caption, blur', 'caption, blur, text on background, watermark'],
  ])('%s → %s', (src, expected) => {
    expect(stripTextNegatives(src)).toBe(expected)
  })
})

describe('applyTextBearingPolicy — 코드 강제', () => {
  it('전 컷 positive에서 텍스트 금지를 지우고 보존 지시를 한 번 붙이며, negative는 제품 밖 텍스트만 금지한다', () => {
    const out = applyTextBearingPolicy(RAW)
    const entries = [
      ...Object.values(out.section_image_prompts ?? {}),
      ...(out.feature_prompts ?? []),
      ...(out.howto_prompts ?? []),
    ] as Array<{ positive?: string; negative?: string }>
    for (const e of entries) {
      expect(e.positive).not.toContain(NO_TEXT_SENTENCE)
      expect(e.positive).not.toContain(NO_TEXT_INSTRUCTION)
      expect(e.positive!.split(PRINTED_DESIGN_PRESERVE_INSTRUCTION)).toHaveLength(2)
      expect(e.negative).toContain('text on background')
      expect(e.negative!.split(', ')).not.toContain('text')
    }
    // 원본은 바꾸지 않는다(불변), 두 번 적용해도 같다
    expect(RAW.section_image_prompts!.hero.positive).toContain(NO_TEXT_SENTENCE)
    expect(applyTextBearingPolicy(out)).toEqual(out)
    expect(out.lighting_params).toEqual(RAW.lighting_params)
  })
})

describe('generatePdpDesignPrompts — 텍스트 보유 상품 판정 배선', () => {
  it('스티커 상품은 판정을 따로 넘기지 않아도 스코프를 붙이고 결과에 코드 강제를 적용한다', async () => {
    const result = await generatePdpDesignPrompts(input('핸드메이드 감사 스티커'))
    expect(promptOf()).toContain(TEXT_BEARING_PROMPT_SCOPE.trim())
    expect(result.usedFallback).toBe(false)
    expect(result.designPrompts.section_image_prompts!.hero.positive).toContain(PRINTED_DESIGN_PRESERVE_INSTRUCTION)
    expect(result.designPrompts.section_image_prompts!.hero.positive).not.toContain(NO_TEXT_SENTENCE)
    expect(result.designPrompts.frame_system).toBeDefined()
  })

  it('stationery 카테고리도 텍스트 보유 상품이다', async () => {
    await generatePdpDesignPrompts(input('선물 포장 세트', 'stationery'))
    expect(promptOf()).toContain(TEXT_BEARING_PROMPT_SCOPE.trim())
  })

  it('일반 상품은 스코프도 강제도 없다(기존 그대로)', async () => {
    const result = await generatePdpDesignPrompts(input('스테인리스 머그컵'))
    expect(promptOf()).not.toContain(TEXT_BEARING_PROMPT_SCOPE.trim())
    expect(result.designPrompts.section_image_prompts).toEqual(RAW.section_image_prompts)
  })

  it('명시값이 판정을 이긴다', async () => {
    await generatePdpDesignPrompts(input('감사 스티커', 'household', { textBearing: false }))
    expect(promptOf()).not.toContain(TEXT_BEARING_PROMPT_SCOPE.trim())
  })

  it('LLM 실패 폴백(기본 프롬프트)에도 코드 강제를 적용한다', async () => {
    h.steps.mockResolvedValue({ success: false, error: { message: 'parse', stage: 'parse', attempts: 2 }, usage: USAGE, duration: 0 })
    const result = await generatePdpDesignPrompts(input('감사 스티커'))
    expect(result.usedFallback).toBe(true)
    const hero = result.designPrompts.section_image_prompts!.hero.positive!
    expect(hero).toContain(PRINTED_DESIGN_PRESERVE_INSTRUCTION)
    expect(hero).not.toContain(NO_TEXT_INSTRUCTION)
  })
})
