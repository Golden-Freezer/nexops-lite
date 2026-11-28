/**
 * 상세페이지 단계별 모델 지정(묶음 1) — 기본 표(pdp-model-refresh: Haiku 5.5·Sonnet 5.5·gpt-6.1-sol API, 상한은 이전 그대로)와
 * 모든 모델이 레지스트리에 있는지 고정한다. 모델을 바꾸면 이 표가 함께 바뀌어야 한다.
 */

import { describe, expect, it } from 'vitest'
import { lookupLlmModel } from '@/lib/agents/llm'
import {
  M_ARM_MODELS,
  M_ARM_TIMEOUT_SCALE,
  mArmMaxTokens,
  PDP_MODEL_ROUTES,
  PDP_MODEL_STAGES,
  pdpRoute,
  resolvePdpRoutes,
} from './pdp-model-routes'

describe('PDP_MODEL_ROUTES', () => {
  it('기본 표 — 구조화 추출 Haiku 5.5, 생성·설계·비전 Sonnet 5.5(thinking 끔), copy/stage2 gpt-6.1-sol API effort medium', () => {
    expect(PDP_MODEL_ROUTES).toEqual({
      // Haiku 5.5 — temperature 없음(기본값이 아니면 400), adaptive thinking 끔
      // 600 — 한국어 reasoning 포함 JSON이 smoke에서 262토큰(이전 상한 300에 근접)
      'analysis/category': { model: 'claude-haiku-5-5', maxTokens: 600, disableThinking: true },
      analysis: { model: 'claude-haiku-5-5', maxTokens: 4096, disableThinking: true },
      // pdp-review-input — 경쟁사 리뷰 파일이 있는 잡만 부른다
      'analysis/competitor-reviews': { model: 'claude-haiku-5-5', maxTokens: 2000, disableThinking: true },
      'analysis/reference': { model: 'claude-sonnet-5-5', maxTokens: 8000, disableThinking: true },
      research: { model: 'claude-sonnet-5-5', maxTokens: 8000, maxTokensSteps: [8000, 16000], disableThinking: true },
      'design/section-planning': { model: 'claude-sonnet-5-5', maxTokens: 8000, disableThinking: true },
      // reviewfaq 잡만 부른다
      'design/review-faq': { model: 'claude-haiku-5-5', maxTokens: 1500, disableThinking: true },
      'design/prompt': {
        model: 'claude-sonnet-5-5',
        maxTokens: 12000,
        maxTokensSteps: [12000, 16000],
        disableThinking: true,
      },
      'copy/structural': { model: 'claude-sonnet-5-5', maxTokens: 8000, disableThinking: true },
      // 웹·로컬 같은 표(Vercel 전용 표 없음) — API, 로컬 구독은 NEXOPS_PDP_LLM_BACKEND로만
      'copy/stage2': { model: 'gpt-6.1-sol', maxTokens: 16000, effort: 'medium' },
      'copy/stage3': { model: 'claude-sonnet-5-5', maxTokens: 8000, disableThinking: true },
      'copy/retry-pointcards': { model: 'claude-sonnet-5-5', maxTokens: 1000, disableThinking: true },
      // pdp-copy-regen-api — 편집기 요청 때만 부른다
      'copy/editor-regen': { model: 'claude-sonnet-5-5', maxTokens: 1000, disableThinking: true },
      // 템플릿 조합 라인 — templatelib 잡만
      'design/template-guideline': { model: 'claude-sonnet-5-5', maxTokens: 1500, disableThinking: true },
      'design/template-compose': { model: 'claude-sonnet-5-5', maxTokens: 2000, disableThinking: true },
      'design/template-select': { model: 'claude-sonnet-5-5', maxTokens: 4000, disableThinking: true },
      // 움직이는 칸 고르기 — motionband 잡만
      'design/motion-pick': { model: 'claude-sonnet-5-5', maxTokens: 800, disableThinking: true },
      // K 색 조합 비전 고르기 — palettepick 잡만(J26)
      'design/palette-pick': { model: 'claude-sonnet-5-5', maxTokens: 400, disableThinking: true },
      'copy/template-slots': { model: 'claude-sonnet-5-5', maxTokens: 8000, disableThinking: true },
      // 생성 화면 자동 작성 — 화면 요청 때만 부른다(잡 밖)
      'copy/auto-fill': { model: 'claude-sonnet-5-5', maxTokens: 1500, disableThinking: true },
      'images/identity': { model: 'claude-sonnet-5-5', maxTokens: 400, disableThinking: true },
      'images/gate': { model: 'claude-sonnet-5-5', maxTokens: 500, disableThinking: true },
      // GIF 검사(R03) — 지금 배치는 게이트와 같은 값(요청 바이트 그대로), 새 배치에서 나뉜다
      'images/gif-gate': { model: 'claude-sonnet-5-5', maxTokens: 500, disableThinking: true },
      'images/annotation': { model: 'claude-sonnet-5-5', maxTokens: 400, disableThinking: true },
      // pdp-original-composite — 합성 스위치가 켜진 잡만 부른다. PDP는 Claude·GPT만(오너 2026-10-29)
      'images/composite-eligibility': { model: 'claude-sonnet-5-5', maxTokens: 600, disableThinking: true },
    })
  })

  it('기본 표는 API 백엔드만이다 — 구독 전환은 로컬 env 스위치로만(웹 잡이 구독 미등록으로 멈추지 않게)', () => {
    for (const [stage, route] of Object.entries(PDP_MODEL_ROUTES)) {
      expect(route, stage).not.toHaveProperty('backend')
    }
  })

  // 지금 기본 표만 — Gemini(gemini-4-argon)는 API 단계로 받는다(오너 2026-11-07 18:53, R02 llm-r02.test.ts). 새 배치 표는 R03
  it('지금 기본 표에는 Gemini 모델이 없다(Claude·GPT만 — 지금 배치 바이트 불변)', () => {
    for (const [stage, route] of Object.entries(PDP_MODEL_ROUTES)) {
      expect(['anthropic', 'openai'], stage).toContain(lookupLlmModel(route.model)!.provider)
    }
  })

  it('json 강제는 네이티브 JSON 공급자에만 둔다', () => {
    for (const [stage, route] of Object.entries(PDP_MODEL_ROUTES)) {
      if ('json' in route && route.json) expect(lookupLlmModel(route.model)!.json, stage).toBe('native')
    }
  })

  it('모든 단계 모델이 레지스트리에 있고, 상한 단계는 첫 값이 maxTokens다', () => {
    for (const [stage, route] of Object.entries(PDP_MODEL_ROUTES)) {
      expect(lookupLlmModel(route.model), stage).not.toBeNull()
      if ('maxTokensSteps' in route) expect(route.maxTokensSteps[0], stage).toBe(route.maxTokens)
      // temperature는 허용 모델에만 둔다(Claude 5·5.5·추론형 GPT는 거부)
      if ('temperature' in route) expect(lookupLlmModel(route.model)!.temperature, stage).toBe(true)
      // thinking 끄기와 effort xhigh·max를 같이 두지 않는다(Sonnet 5.5·Haiku 5.5는 high 이하에서만 끌 수 있다)
      if ('disableThinking' in route && 'effort' in route) expect(['xhigh', 'max'], stage).not.toContain(route.effort)
    }
  })
})

describe('pdpRoute — 갈래·백엔드 해석(pdp-llm-subscription-backend)', () => {
  it('env가 없으면 모든 단계가 표 그대로다', () => {
    for (const stage of PDP_MODEL_STAGES) expect(pdpRoute(stage, {}), stage).toBe(PDP_MODEL_ROUTES[stage])
    expect(pdpRoute('copy/stage2', { NEXOPS_PDP_LLM_BACKEND: 'api' })).toBe(PDP_MODEL_ROUTES['copy/stage2'])
  })

  it('Vercel이면(VERCEL=1 또는 VERCEL_ENV — token-steps·enrichment-switch와 같은 판별) 갈래·백엔드 env를 무시한다', () => {
    const switches = { NEXOPS_PDP_MODEL_ARM: 'M', NEXOPS_PDP_LLM_BACKEND: 'subscription' }
    for (const vercel of [{ VERCEL: '1' }, { VERCEL_ENV: 'production' }]) {
      for (const stage of PDP_MODEL_STAGES) {
        expect(pdpRoute(stage, { ...vercel, ...switches }), stage).toBe(PDP_MODEL_ROUTES[stage])
      }
    }
  })

  it('구독 백엔드는 OpenAI 단계(copy/stage2)만 바꾼다 — Claude 단계는 API 그대로', () => {
    const env = { NEXOPS_PDP_LLM_BACKEND: ' subscription ' }
    expect(pdpRoute('copy/stage2', env)).toEqual({
      model: 'gpt-6.1-sol',
      maxTokens: 16000,
      effort: 'medium',
      backend: 'subscription',
    })
    for (const stage of PDP_MODEL_STAGES.filter((s) => s !== 'copy/stage2')) {
      expect(pdpRoute(stage, env), stage).toBe(PDP_MODEL_ROUTES[stage])
    }
  })

  it('M 갈래 — Claude 단계는 Opus 5.5(thinking 끔·temperature 없음, 단계별 effort, 상한 확대, 시간 제한 3배), GPT 단계는 gpt-6.1-sol 구독', () => {
    const env = { NEXOPS_PDP_MODEL_ARM: 'M' }
    expect(M_ARM_TIMEOUT_SCALE).toBe(3)
    expect(pdpRoute('analysis/category', env)).toEqual({
      model: 'claude-opus-5-5',
      maxTokens: 2600,
      effort: 'low',
      timeoutScale: 3,
    })
    expect(pdpRoute('research', env)).toEqual({
      model: 'claude-opus-5-5',
      maxTokens: 12000,
      maxTokensSteps: [12000, 20000],
      effort: 'medium',
      timeoutScale: 3,
    })
    expect(pdpRoute('design/prompt', env)).toMatchObject({
      maxTokens: 18000,
      maxTokensSteps: [18000, 20000],
      effort: 'medium',
    })
    expect(pdpRoute('images/gate', env)).toEqual({
      model: 'claude-opus-5-5',
      maxTokens: 2500,
      effort: 'low',
      timeoutScale: 3,
    })
    expect(pdpRoute('copy/stage2', env)).toEqual({
      model: 'gpt-6.1-sol',
      maxTokens: 16000,
      effort: 'high',
      backend: 'subscription',
    })
    for (const stage of PDP_MODEL_STAGES) {
      const route = pdpRoute(stage, env)
      expect([M_ARM_MODELS.anthropic, M_ARM_MODELS.openai], stage).toContain(route.model)
      expect(route, stage).not.toHaveProperty('disableThinking')
      expect(route, stage).not.toHaveProperty('temperature')
      expect(route.maxTokens, stage).toBeLessThanOrEqual(20000)
      if (route.maxTokensSteps) expect(route.maxTokensSteps[0], stage).toBe(route.maxTokens)
    }
  })

  it('상한 확대 — 1.5배와 +2000 중 큰 값, 20000까지', () => {
    expect([300, 1000, 8000, 12000, 16000].map(mArmMaxTokens)).toEqual([2300, 3000, 12000, 18000, 20000])
  })

  it('모르는 갈래·백엔드 값은 조용히 넘어가지 않고 throw', () => {
    expect(() => pdpRoute('research', { NEXOPS_PDP_MODEL_ARM: 'm2' })).toThrow(/M만/)
    expect(() => pdpRoute('research', { NEXOPS_PDP_LLM_BACKEND: 'codex' })).toThrow(/subscription\|api/)
    // M 갈래는 GPT 단계를 구독으로 돌리는 비교 조건 — api를 명시하면 조용히 무시하지 않는다
    expect(() => pdpRoute('copy/stage2', { NEXOPS_PDP_MODEL_ARM: 'M', NEXOPS_PDP_LLM_BACKEND: 'api' })).toThrow(
      /함께 쓸 수 없습니다/
    )
    expect(pdpRoute('copy/stage2', { NEXOPS_PDP_MODEL_ARM: 'M', NEXOPS_PDP_LLM_BACKEND: 'subscription' }).model).toBe(
      'gpt-6.1-sol'
    )
  })

  it('resolvePdpRoutes — 모든 단계를 같은 env로 해석한다(점수 JSON 지정값)', () => {
    const routes = resolvePdpRoutes({ NEXOPS_PDP_LLM_BACKEND: 'subscription' })
    expect(Object.keys(routes).sort()).toEqual([...PDP_MODEL_STAGES].sort())
    expect(routes['copy/stage2'].backend).toBe('subscription')
    expect(routes.research).toBe(PDP_MODEL_ROUTES.research)
  })
})
