/**
 * 디자인 콜② 입력의 사진 없는 옵션 가드(R2-1 원천) — R1 P02 잡 d10ea762의 실제 입력(USP 후보·문제 인사이트·등록 옵션,
 * 데이지만 실물 사진)을 재현해, 사진 없는 옵션 이름(체리)이 LLM에 가는 장면 재료에 들어가지 않는지 고정한다.
 * LLM은 모의(callLlmWithTokenSteps가 캔드 응답을 parser에 넣어 돌려준다), 유료 호출 0.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ steps: vi.fn() }))

vi.mock('../_base', () => ({ callAgent: vi.fn() }))
// 모델 계층(묶음 1) — 설계 콜 ②는 라우트로 부른다(route, request, parser, steps). 시험은 요청·파서만 본다
vi.mock('./token-steps', () => ({
  callLlmWithTokenSteps: (_route: unknown, ...args: unknown[]) => h.steps(...args),
}))

import { generatePdpDesignPrompts } from './pdp-design-agent'
import { FAIRNEX_OPTION_LABELS } from '@/lib/registration/options/__fixtures__/fairnex-option-labels'
import { parseOptionLabels, type OptionSpec } from '@/lib/registration/options/option-spec'
import type { AnalysisResult, PdpSpecSheet } from '@/lib/registration/pdp-state'

// d10ea762(R1 P02 treatment) 실제 값 — analysis.usp_candidates·research.pain_points[0].insight
const USP_CANDIDATES = [
  '페어넥스 브랜드의 전문성 있는 포장솔루션',
  '반투명 소재의 프리미엄한 선물 포장 경험',
  'S/L 사이즈 옵션으로 다양한 상품 대응 가능',
  '데이지/체리 컬러로 감성적 선물 연출',
]
const PAIN_INSIGHT = '선물 포장 시 상품 크기에 맞는 봉투 사이즈를 가늠하기 어려워 구매를 망설인다'
const OPTIONS_ON = ['vocab', 'persuasion', 'layouts', 'shots', 'annotations', 'mobile', 'options']

function daisyOnly(): OptionSpec {
  const { spec } = parseOptionLabels(FAIRNEX_OPTION_LABELS.P02)
  return {
    ...spec,
    variants: spec.variants.map((v) =>
      v.values.design === '데이지' ? { ...v, sourceImage: 'https://cdn.test/daisy.jpg' } : v
    ),
  }
}

function input(features: string[] | null, optionSpec: OptionSpec | undefined = daisyOnly()) {
  const analysis = {
    detected_category: 'packaging',
    usp_candidates: USP_CANDIDATES,
    ...(features ? { enrichment: { version: 1, features } } : {}),
  } as unknown as AnalysisResult
  return {
    analysis,
    research: { pain_points: [{ insight: PAIN_INSIGHT }] },
    strategyContract: {},
    specSheet: {
      productName: '페어넥스 구디백 포장봉투 선물 파우치 반투명',
      ...(optionSpec ? { optionSpec, colorOptions: optionSpec.variants.map((v) => v.label) } : {}),
    } as PdpSpecSheet,
  }
}

beforeEach(() => {
  h.steps.mockReset()
  h.steps.mockImplementation(async (_opts: unknown, parser: (text: string) => unknown) => ({
    success: true,
    data: parser(JSON.stringify({ feature_prompts: [{ positive: 'x', negative: '' }] })),
    usage: { inputTokens: 0, outputTokens: 0, cost: 0 },
    duration: 0,
  }))
})

const promptOf = () => (h.steps.mock.calls[0][0] as { messages: Array<{ content: string }> }).messages[0].content

describe('디자인 콜② — 사진 없는 옵션은 장면 재료에 넣지 않는다(d10ea762 재현)', () => {
  it('USP 후보 "데이지/체리 컬러로 …"에서 체리를 지우고, 사진 있는 데이지만 쓰라는 규칙을 붙인다', async () => {
    await generatePdpDesignPrompts(input(OPTIONS_ON))
    const prompt = promptOf()
    expect(prompt).not.toContain('체리')
    expect(prompt).toContain('데이지 컬러로 감성적 선물 연출')
    expect(prompt).toContain('S/L 사이즈 옵션으로 다양한 상품 대응 가능')
    expect(prompt).toContain('## 옵션 사진 규칙 (이 상품에 한함)')
    expect(prompt).toContain('제품은 참조 사진의 데이지 디자인 그대로만 그리세요')
  })

  /** 같은 기록에서 옵션 구조를 넣었을 때와 뺐을 때의 프롬프트(기록마다 다른 블록이 붙으므로 같은 기록끼리 비교한다) */
  async function promptsWithAndWithout(features: string[] | null, optionSpec: OptionSpec = daisyOnly()) {
    h.steps.mockClear()
    await generatePdpDesignPrompts(input(features, optionSpec))
    const withSpec = promptOf()
    h.steps.mockClear()
    await generatePdpDesignPrompts(input(features, undefined))
    return { withSpec, without: promptOf() }
  }

  it('options 기록이 없는 잡(Track S·대조군 R0)은 옵션 구조가 있어도 프롬프트가 기존 그대로다', async () => {
    for (const features of [null, ['vocab', 'persuasion']]) {
      const { withSpec, without } = await promptsWithAndWithout(features)
      expect(withSpec).toBe(without)
      expect(withSpec).toContain('데이지/체리 컬러로 감성적 선물 연출')
      expect(withSpec).not.toContain('## 옵션 사진 규칙')
    }
  })

  it('모든 옵션에 실물 사진이 있으면 그대로다', async () => {
    const { spec } = parseOptionLabels(FAIRNEX_OPTION_LABELS.P02)
    const allPhotos = { ...spec, variants: spec.variants.map((v) => ({ ...v, sourceImage: 'https://cdn.test/a.jpg' })) }
    await generatePdpDesignPrompts(input(OPTIONS_ON, allPhotos))
    const prompt = promptOf()
    expect(prompt).toContain('데이지/체리 컬러로 감성적 선물 연출')
    expect(prompt).not.toContain('## 옵션 사진 규칙')
  })
})
