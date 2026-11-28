/**
 * 잡별 모델 배치(R03) — 새 배치 표 = 오너 2026-11-08 ② 최종 선택 + ③ 운영 반영 1~2 + R06 5차 교체(카피 1단·설계②), 지금 배치는 표 객체 그대로(바이트 불변),
 * 잡 배치로 감싸야만 새 표, 갈래·구독 env와 섞이면 throw, 잡 스냅숏·대조, spec_sheet 예약 키, 새 배치 이미지 모델(R05 경계).
 * 새 표의 모든 단계가 callLlm의 '부르기 전에 막는 설정'에 걸리지 않는지(공급자 모의 — 유료 호출 0).
 * 구독 표지 잡(R13): Claude·GPT 단계만 구독 + API 잇기 표지, Gemini·thinking 끄기 단계는 API 그대로, 백엔드가 없으면 API로 이어 끝난다.
 */

import { describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ calls: [] as Array<{ provider: string; model: unknown }> }))
const ok = { success: true, data: 'ok', usage: { inputTokens: 0, outputTokens: 0, cost: 0 }, duration: 0 }
vi.mock('@/lib/agents/_base', () => ({
  callAgent: async (o: { config: { model: string } }) => (h.calls.push({ provider: 'anthropic', model: o.config.model }), ok),
}))
vi.mock('@/lib/agents/openai-chat', () => ({
  callOpenAiChat: async (o: { model: string }) => (h.calls.push({ provider: 'openai', model: o.model }), ok),
}))
vi.mock('@/lib/agents/llm/providers/gemini', () => ({
  callGemini: async (route: { model: string }) => (h.calls.push({ provider: 'gemini', model: route.model }), ok),
}))

import { callLlm, lookupLlmModel } from '@/lib/agents/llm'
import { clearLocalLlmBackends, LlmSoftStopError } from '@/lib/agents/llm/local-llm-backend'
import { collectSubscriptionFallbacks, type SubscriptionFallbackRecord } from '@/lib/agents/llm/subscription-fallback'
import {
  PDP_NEW_BATCH_IMAGE_MODEL,
  resolveNewBatchImageModel,
  specSheetForSave,
  splitModelBatchKeys,
  withModelBatchKeys,
} from './pdp-model-batch'
import { currentPdpBackend, currentPdpBatch, currentPdpSubscriptionStop, runWithPdpBatch } from './pdp-model-batch-context'
import {
  diffRouteSnapshot,
  PDP_NEW_STAGE_ROUTES,
  pdpNewStageRoute,
  subscriptionRoute,
  PDP_MODEL_ROUTES,
  PDP_MODEL_ROUTES_NEW,
  PDP_MODEL_STAGES,
  PDP_NEW_BATCH_OVERRIDES,
  pdpRoute,
  resolvePdpRoutes,
  snapshotPdpRoutes,
} from './pdp-model-routes'

describe('새 배치 표(오너 ② 모델 최종 선택 · ③ 1~2 · R06 5차 교체)', () => {
  it('오너가 고른 단계만 바뀐다 — 모델·등급·상한·콜 시간', () => {
    expect(PDP_NEW_BATCH_OVERRIDES).toEqual({
      research: { model: 'gpt-6.1-sol', maxTokens: 8000, maxTokensSteps: [8000, 16000], effort: 'medium', callTimeoutMs: 150_000 },
      'design/section-planning': { model: 'claude-opus-5-5', maxTokens: 8000, effort: 'high', callTimeoutMs: 120_000 },
      // R06 5차(오너 11-08 14:4x) 설계② Opus xhigh → Sol medium — 지금 상한·단계 그대로(28,000·스트리밍 불필요), 150초
      'design/prompt': { model: 'gpt-6.1-sol', maxTokens: 12_000, maxTokensSteps: [12_000, 16_000], effort: 'medium', callTimeoutMs: 150_000 },
      // R06 5차 카피 1단 Sol high → Opus medium — 상한 8,000 → 12,000·잘림 감지, 120초 + 재시도 1
      // R11d(오너 2026-11-09 13:2x) 상한 12,000 → 16,000, 콜 시간 120초 → 165초(실측 초당 약 109토큰이면 16,000에 약 147초)
      // J34(통합 decide 15 ③, c21 판정) 원문 카피 3단 Opus → Gemini argon — 상한·등급·1단 콜 시간·재시도·잘림 감지는 그대로,
      // 2단·3단 콜 시간 150초(decide 18 — c21 2단 실측 최대 110.8초)
      'copy/structural': {
        model: 'gemini-4-argon',
        maxTokens: 16_000,
        effort: 'medium',
        failOnTruncation: true,
        callTimeoutMs: 165_000,
        callMaxRetries: 1,
      },
      'copy/stage2': { model: 'gemini-4-argon', maxTokens: 16000, effort: 'low', callTimeoutMs: 150_000 },
      'copy/stage3': { model: 'gemini-4-argon', maxTokens: 8000, effort: 'low', callTimeoutMs: 150_000 },
      'design/template-guideline': { model: 'claude-opus-5-5', maxTokens: 1500, effort: 'medium', callTimeoutMs: 90_000 },
      'design/template-compose': { model: 'claude-opus-5-5', maxTokens: 2000, effort: 'medium', callTimeoutMs: 90_000 },
      'design/template-select': { model: 'claude-opus-5-5', maxTokens: 4000, effort: 'medium', callTimeoutMs: 90_000 },
      // J34b(통합 decide 25, c21 칸 글 판정) 칸 글 Sol low → Gemini argon low — 상한 그대로
      'copy/template-slots': { model: 'gemini-4-argon', maxTokens: 8000, effort: 'low' },
      // ③ 식별 카드 400 → 2,000 · 게이트 500 → 4,000, 잘림 감지(R02)
      'images/identity': { model: 'gemini-4-argon', maxTokens: 2000, effort: 'high', failOnTruncation: true, callTimeoutMs: 90_000 },
      // R12e 게이트 콜 시간 60초 → 90초·재시도 1(R13 운영 잡 96872abb 성공 최대 58.8초, 3/28콜 60초 시간 초과)
      'images/gate': {
        model: 'gemini-4-argon',
        maxTokens: 4000,
        effort: 'high',
        json: true,
        failOnTruncation: true,
        callTimeoutMs: 90_000,
        callMaxRetries: 1,
      },
      'images/gif-gate': { model: 'claude-opus-5-5', maxTokens: 4000, effort: 'xhigh', failOnTruncation: true },
    })
  })

  it('분석(Haiku off)·움직이는 칸 고르기 등 오너 표 밖 단계는 지금 값 그대로다', () => {
    for (const stage of PDP_MODEL_STAGES) {
      if (stage in PDP_NEW_BATCH_OVERRIDES) continue
      expect(PDP_MODEL_ROUTES_NEW[stage], stage).toBe(PDP_MODEL_ROUTES[stage])
    }
    expect(PDP_MODEL_ROUTES_NEW.analysis).toEqual({ model: 'claude-haiku-5-5', maxTokens: 4096, disableThinking: true })
  })

  it('새 표의 모든 단계가 callLlm의 부르기 전 거절에 걸리지 않고 API 공급자로 간다(구독 없음)', async () => {
    h.calls = []
    for (const stage of PDP_MODEL_STAGES) {
      const route = PDP_MODEL_ROUTES_NEW[stage]
      expect(route, stage).not.toHaveProperty('backend')
      const out = await callLlm(route, { system: 's', messages: [{ role: 'user', content: 'u' }], agentName: 'test/new-batch' }, (t) => t)
      expect(out.success, `${stage} ${!out.success ? out.error.message : ''}`).toBe(true)
    }
    expect(h.calls).toHaveLength(PDP_MODEL_STAGES.length)
  })
})

describe('pdpRoute — 잡 배치', () => {
  it('감싸지 않으면 지금 배치 — 표 객체 그대로(바이트 불변)', () => {
    expect(currentPdpBatch()).toBe('now')
    for (const stage of PDP_MODEL_STAGES) expect(pdpRoute(stage, {}), stage).toBe(PDP_MODEL_ROUTES[stage])
  })

  it('새 배치로 감싸면 비동기 안에서도 새 표 — 감싼 밖은 그대로', async () => {
    const seen = await runWithPdpBatch('new', async () => {
      await new Promise((r) => setTimeout(r, 1))
      return { batch: currentPdpBatch(), gate: pdpRoute('images/gate', {}) }
    })
    expect(seen).toEqual({ batch: 'new', gate: PDP_MODEL_ROUTES_NEW['images/gate'] })
    expect(pdpRoute('images/gate', {})).toBe(PDP_MODEL_ROUTES['images/gate'])
    expect(runWithPdpBatch('now', () => pdpRoute('research', {}))).toBe(PDP_MODEL_ROUTES.research)
  })

  it('새 배치 기본은 API — 로컬 갈래(M)·구독 env와 섞이면 throw, 운영 실행(Vercel·작업자)은 env를 보지 않는다', () => {
    expect(() => pdpRoute('research', { NEXOPS_PDP_MODEL_ARM: 'M' }, 'new')).toThrow(/모델 갈래/)
    expect(() => pdpRoute('copy/stage2', { NEXOPS_PDP_LLM_BACKEND: 'subscription' }, 'new')).toThrow(/잡 표지/)
    expect(pdpRoute('research', { NEXOPS_PDP_HOSTED: 'railway-worker', NEXOPS_PDP_MODEL_ARM: 'M' }, 'new')).toBe(
      PDP_MODEL_ROUTES_NEW.research
    )
    expect(pdpRoute('research', { NEXOPS_PDP_LLM_BACKEND: 'api' }, 'new')).toBe(PDP_MODEL_ROUTES_NEW.research)
    expect(pdpRoute('research', { VERCEL: '1', NEXOPS_PDP_MODEL_ARM: 'M' }, 'new')).toBe(PDP_MODEL_ROUTES_NEW.research)
    expect(resolvePdpRoutes({}, 'new')['images/identity']).toBe(PDP_MODEL_ROUTES_NEW['images/identity'])
  })
})

describe('잡별 단계 모델 스냅숏', () => {
  it('노드·모델·등급·상한만 남기고, 같은 표면 대조 결과가 비어 있다', () => {
    const now = snapshotPdpRoutes('now')
    const fresh = snapshotPdpRoutes('new')
    expect(now['images/gate']).toEqual({ model: 'claude-sonnet-5-5', maxTokens: 500 })
    expect(fresh['design/prompt']).toEqual({ model: 'gpt-6.1-sol', maxTokens: 12_000, effort: 'medium' })
    expect(fresh['copy/structural']).toEqual({ model: 'gemini-4-argon', maxTokens: 16_000, effort: 'medium' })
    expect(Object.keys(fresh).sort()).toEqual([...PDP_MODEL_STAGES].sort())
    expect(diffRouteSnapshot(fresh, snapshotPdpRoutes('new'))).toEqual([])
  })

  it('배포 중 모델이 바뀐 단계를 찾는다 — 스냅숏보다 뒤에 생긴 단계는 대조하지 않는다', () => {
    const saved = snapshotPdpRoutes('new')
    const changed = { ...saved, 'copy/stage2': { ...saved['copy/stage2'], effort: 'medium' as const } }
    expect(diffRouteSnapshot(changed, saved)).toEqual(['copy/stage2'])
    const { 'images/gif-gate': _gif, ...older } = saved
    void _gif
    expect(diffRouteSnapshot(older, saved)).toEqual([])
  })
})

describe('spec_sheet 예약 키(DDL 없음)', () => {
  it('꺼내면 spec에서 지우고 배치·스냅숏을 돌려준다 — 키가 없으면 같은 객체·지금 배치', () => {
    const plain = { productName: '컵' }
    expect(splitModelBatchKeys(plain)).toEqual({ spec: plain, present: false, batch: 'now', snapshot: null, backend: 'api' })
    expect(splitModelBatchKeys(plain).spec).toBe(plain)
    const saved = withModelBatchKeys(plain, 'new', { research: { model: 'gpt-6.1-sol', maxTokens: 8000 } })
    expect(saved).toEqual({
      productName: '컵',
      modelBatch: 'new',
      modelRouteSnapshot: { research: { model: 'gpt-6.1-sol', maxTokens: 8000 } },
    })
    expect(splitModelBatchKeys(saved)).toEqual({
      spec: { productName: '컵' },
      present: true,
      batch: 'new',
      snapshot: { research: { model: 'gpt-6.1-sol', maxTokens: 8000 } },
      backend: 'api',
    })
    // 모르는 값은 지금 배치로 읽는다
    expect(splitModelBatchKeys({ productName: '컵', modelBatch: 'm2' }).batch).toBe('now')
  })

  it('다시 저장할 때 키를 다시 붙인다 — 키가 없던 잡(이 기능 전)은 그대로', () => {
    const spec = { productName: '컵', category: 'kitchen' }
    expect(specSheetForSave({}, spec)).toBe(spec)
    expect(specSheetForSave({ model_batch: 'new', model_route_snapshot: null }, spec)).toEqual({ ...spec, modelBatch: 'new' })
  })
})

describe('구독 표지 잡(R13)', () => {
  const REQ = { system: 's', messages: [{ role: 'user' as const, content: 'u' }], agentName: 'test/new-batch-sub' }

  it('표지 키는 subscription일 때만 붙고, 꺼내면 spec에서 지운다 — 화면이 보낸 표지 키만 있어도 지운다', () => {
    const plain = { productName: '컵' }
    expect(withModelBatchKeys(plain, 'new', null)).toEqual({ productName: '컵', modelBatch: 'new' })
    const marked = withModelBatchKeys(plain, 'new', null, 'subscription')
    expect(marked).toEqual({ productName: '컵', modelBatch: 'new', modelBackend: 'subscription' })
    expect(splitModelBatchKeys(marked)).toMatchObject({ spec: plain, batch: 'new', backend: 'subscription' })
    expect(splitModelBatchKeys({ productName: '컵', modelBackend: 'subscription' })).toMatchObject({
      spec: plain,
      present: true,
      backend: 'subscription',
    })
    expect(splitModelBatchKeys({ productName: '컵', modelBatch: 'new', modelBackend: 'cli' }).backend).toBe('api')
    expect(specSheetForSave({ model_batch: 'new', model_backend: 'subscription' }, plain)).toEqual(marked)
    expect(specSheetForSave({ model_batch: 'new', model_backend: 'api' }, plain)).toEqual({ productName: '컵', modelBatch: 'new' })
  })

  it('감싼 백엔드를 비동기 안에서도 읽는다 — 감싸지 않으면 API', async () => {
    expect(currentPdpBackend()).toBe('api')
    const seen = await runWithPdpBatch(
      'new',
      async () => {
        await new Promise((r) => setTimeout(r, 1))
        return currentPdpBackend()
      },
      'subscription'
    )
    expect(seen).toBe('subscription')
    expect(runWithPdpBatch('new', () => currentPdpBackend())).toBe('api')
  })

  it('새 배치 Claude·GPT 단계만 구독 + API 잇기 — Gemini·thinking 끄기 단계는 API 표 객체 그대로', () => {
    const subscribed: string[] = []
    for (const stage of PDP_MODEL_STAGES) {
      const base = PDP_MODEL_ROUTES_NEW[stage]
      const route = pdpRoute(stage, {}, 'new', 'subscription')
      const provider = lookupLlmModel(base.model)?.provider
      if (provider === 'gemini' || base.disableThinking) {
        expect(route, stage).toBe(base)
        continue
      }
      expect(route, stage).toEqual({ ...base, backend: 'subscription', subscriptionFallback: 'api' })
      subscribed.push(stage)
    }
    expect(subscribed.sort()).toEqual(
      [
        'research',
        'design/section-planning',
        'design/prompt',
        'design/template-guideline',
        'design/template-compose',
        'design/template-select',
        'images/gif-gate',
      ].sort()
    )
    expect(pdpRoute('images/gate', {}, 'new', 'subscription')).toBe(PDP_MODEL_ROUTES_NEW['images/gate'])
    // J34 원문 카피 3단 Gemini argon — 구독이 없어 표지 잡도 API 표 객체 그대로
    expect(pdpRoute('copy/stage2', {}, 'new', 'subscription')).toBe(PDP_MODEL_ROUTES_NEW['copy/stage2'])
    // J34b 칸 글 Gemini argon — 같은 까닭으로 API 표 객체 그대로
    expect(pdpRoute('copy/template-slots', {}, 'new', 'subscription')).toBe(PDP_MODEL_ROUTES_NEW['copy/template-slots'])
    expect(pdpRoute('analysis', {}, 'new', 'subscription')).toBe(PDP_MODEL_ROUTES_NEW.analysis)
    // 새 단계 5개는 모두 Claude(생각 끄기 없음)
    expect(pdpNewStageRoute('compose/final-review', {}, 'new', 'subscription')).toEqual({
      ...PDP_NEW_STAGE_ROUTES['compose/final-review'],
      backend: 'subscription',
      subscriptionFallback: 'api',
    })
  })

  it('지금 배치는 표지가 있어도 지금 표 그대로 · 구독 env 갈래와는 여전히 섞이지 않는다', () => {
    for (const stage of PDP_MODEL_STAGES) expect(pdpRoute(stage, {}, 'now', 'subscription'), stage).toBe(PDP_MODEL_ROUTES[stage])
    expect(() => pdpRoute('copy/stage2', { NEXOPS_PDP_LLM_BACKEND: 'subscription' }, 'new', 'subscription')).toThrow(/잡 표지/)
    expect(resolvePdpRoutes({}, 'new', 'subscription')['design/template-select']).toMatchObject({ backend: 'subscription' })
  })

  it('GPT 잘림 감지·JSON 강제 단계는 구독으로 보내지 않는다(코덱스·CLI가 지킬 수 없다)', () => {
    const gpt = { model: 'gpt-6.1-sol', maxTokens: 100, effort: 'low' as const }
    expect(subscriptionRoute({ ...gpt, failOnTruncation: true })).not.toHaveProperty('backend')
    expect(subscriptionRoute({ model: 'claude-opus-5-5', maxTokens: 100, json: true })).not.toHaveProperty('backend')
    expect(subscriptionRoute({ model: 'claude-opus-5-5', maxTokens: 100, failOnTruncation: true })).toMatchObject({
      backend: 'subscription',
    })
  })

  it('구독 백엔드가 없는 곳(웹)에서 표지 잡의 모든 단계는 부르기 전 거절 없이 같은 모델 API로 이어 끝나고 잇기 기록이 남는다', async () => {
    h.calls = []
    const records: SubscriptionFallbackRecord[] = []
    try {
      await collectSubscriptionFallbacks(records, async () => {
        for (const stage of PDP_MODEL_STAGES) {
          clearLocalLlmBackends()
          const route = pdpRoute(stage, {}, 'new', 'subscription')
          const out = await callLlm(route, { ...REQ, runContext: { stage } }, (t) => t)
          expect(out.success, `${stage} ${!out.success ? out.error.message : ''}`).toBe(true)
        }
      })
    } finally {
      clearLocalLlmBackends()
    }
    expect(h.calls).toHaveLength(PDP_MODEL_STAGES.length)
    expect(h.calls.map((c) => c.model)).toEqual(PDP_MODEL_STAGES.map((stage) => PDP_MODEL_ROUTES_NEW[stage].model))
    // 구독 단계 7개(J34로 원문 카피 3단, J34b로 칸 글은 Gemini API — 잇기 기록이 없다)
    expect(records).toHaveLength(7)
    expect(records.find((r) => r.stage === 'copy/template-slots')).toBeUndefined()
    expect(records.every((r) => r.reason === 'unavailable' && r.apiSuccess)).toBe(true)
    expect(records.find((r) => r.stage === 'copy/stage2')).toBeUndefined()
    expect(records.find((r) => r.stage === 'design/template-select')).toMatchObject({ backend: 'claude-cli', model: 'claude-opus-5-5' })
    expect(records.find((r) => r.stage === 'research')).toMatchObject({ backend: 'codex-cli', model: 'gpt-6.1-sol' })
  })
})

describe('새 배치 이미지 모델(R05 경계)', () => {
  it('공급자가 등록되지 않았으면 명시 오류 — 다른 모델로 넘어가지 않는다', () => {
    const missing = resolveNewBatchImageModel(['gpt-image-2.6-sunburst', 'gpt-image-2'])
    expect(missing.ok).toBe(false)
    if (!missing.ok) expect(missing.error).toContain(PDP_NEW_BATCH_IMAGE_MODEL)
  })

  it('등록돼 있으면 그 id(higgsfield-ms-2k)', () => {
    expect(PDP_NEW_BATCH_IMAGE_MODEL).toBe('higgsfield-ms-2k')
    expect(resolveNewBatchImageModel(['gpt-image-2', 'higgsfield-ms-2k'])).toEqual({ ok: true, model: 'higgsfield-ms-2k' })
  })
})

describe('구독 멈춤 표지 잡(AX-CT-29)', () => {
  const REQ = { system: 's', messages: [{ role: 'user' as const, content: 'u' }], agentName: 'test/new-batch-stop' }

  it('예약 키 subscriptionStop은 구독 표지 잡에만 붙고 꺼내면 spec에서 지운다 — 키가 없는 옛 잡은 지금과 같은 결과(칸 없음)', () => {
    const plain = { productName: '컵' }
    // 키 없음: 지금 시험(present false)과 같은 모양 — subscriptionStop 칸 자체가 없다
    expect(splitModelBatchKeys(plain)).toEqual({ spec: plain, present: false, batch: 'now', snapshot: null, backend: 'api' })
    expect(splitModelBatchKeys(plain)).not.toHaveProperty('subscriptionStop')
    const subscription = withModelBatchKeys(plain, 'new', null, 'subscription')
    expect(splitModelBatchKeys(subscription)).not.toHaveProperty('subscriptionStop')
    // 표지가 있으면 붙는다
    const stop = withModelBatchKeys(plain, 'new', null, 'subscription', true)
    expect(stop).toEqual({ productName: '컵', modelBatch: 'new', modelBackend: 'subscription', subscriptionStop: true })
    expect(splitModelBatchKeys(stop)).toMatchObject({ spec: plain, backend: 'subscription', subscriptionStop: true })
    // API 잡에는 붙지 않고, 붙어 있어도 구독 표지가 없으면 읽지 않는다(그래도 spec에서는 지운다)
    expect(withModelBatchKeys(plain, 'new', null, 'api', true)).toEqual({ productName: '컵', modelBatch: 'new' })
    const stray = splitModelBatchKeys({ productName: '컵', modelBatch: 'new', subscriptionStop: true })
    expect(stray).not.toHaveProperty('subscriptionStop')
    expect(stray.spec).toEqual(plain)
    // true가 아닌 값은 표지가 아니다
    expect(splitModelBatchKeys({ productName: '컵', modelBackend: 'subscription', subscriptionStop: 'yes' })).not.toHaveProperty('subscriptionStop')
  })

  it('다시 저장할 때 표지를 잃지 않는다(specSheetForSave) — 표지 없는 구독 잡은 지금과 같은 바이트', () => {
    const plain = { productName: '컵' }
    const stop = { model_batch: 'new' as const, model_backend: 'subscription' as const, subscription_stop: true }
    expect(specSheetForSave(stop, plain)).toEqual({ productName: '컵', modelBatch: 'new', modelBackend: 'subscription', subscriptionStop: true })
    expect(specSheetForSave({ model_batch: 'new', model_backend: 'subscription' }, plain)).toEqual({
      productName: '컵',
      modelBatch: 'new',
      modelBackend: 'subscription',
    })
  })

  it('감싼 멈춤 표지를 비동기 안에서도 읽는다 — 감싸지 않으면 false', async () => {
    expect(currentPdpSubscriptionStop()).toBe(false)
    const seen = await runWithPdpBatch(
      'new',
      async () => {
        await new Promise((r) => setTimeout(r, 1))
        return currentPdpSubscriptionStop()
      },
      'subscription',
      true
    )
    expect(seen).toBe(true)
    expect(runWithPdpBatch('new', () => currentPdpSubscriptionStop(), 'subscription')).toBe(false)
  })

  it('subscriptionRoute — 표지 없는 잡은 지금과 바이트까지 같고(잇기 api), stop 잡은 잇기 대신 멈춤 표지', () => {
    const claude = PDP_MODEL_ROUTES_NEW.research
    expect(subscriptionRoute(claude)).toEqual({ ...claude, backend: 'subscription', subscriptionFallback: 'api' })
    expect(JSON.stringify(subscriptionRoute(claude, false))).toBe(JSON.stringify(subscriptionRoute(claude)))
    const stop = subscriptionRoute(claude, true)
    expect(stop).toEqual({ ...claude, backend: 'subscription', subscriptionHalt: true })
    expect(stop).not.toHaveProperty('subscriptionFallback')
    // 구독으로 못 가는 단계(생각 끄기·JSON·잘림 감지 GPT)는 stop 잡도 그대로 API
    expect(subscriptionRoute({ model: 'claude-opus-5-5', maxTokens: 100, json: true }, true)).not.toHaveProperty('backend')
    expect(subscriptionRoute({ model: 'gpt-6.1-sol', maxTokens: 100, failOnTruncation: true }, true)).not.toHaveProperty('backend')
  })

  it('pdpRoute·pdpNewStageRoute — 잡 표지(컨텍스트)로 stop 잡만 멈춤 표지, 표지 없는 호출은 지금과 같다', () => {
    for (const stage of PDP_MODEL_STAGES) {
      const without = pdpRoute(stage, {}, 'new', 'subscription')
      const explicit = pdpRoute(stage, {}, 'new', 'subscription', false)
      expect(JSON.stringify(explicit), stage).toBe(JSON.stringify(without))
      const viaContext = runWithPdpBatch('new', () => pdpRoute(stage, {}), 'subscription', true)
      const stopRoute = pdpRoute(stage, {}, 'new', 'subscription', true)
      expect(viaContext, stage).toEqual(stopRoute)
      expect(stopRoute, stage).not.toHaveProperty('subscriptionFallback')
      if (stopRoute.backend === 'subscription') expect(stopRoute.subscriptionHalt, stage).toBe(true)
      else expect(stopRoute, stage).toBe(PDP_MODEL_ROUTES_NEW[stage])
    }
    expect(pdpNewStageRoute('compose/final-review', {}, 'new', 'subscription', true)).toEqual({
      ...PDP_NEW_STAGE_ROUTES['compose/final-review'],
      backend: 'subscription',
      subscriptionHalt: true,
    })
  })

  it('stop 잡 — 구독 백엔드가 없으면 구독 단계는 API 공급자를 한 번도 부르지 않고 LlmSoftStopError로 멈추고, Gemini·생각 끄기 단계는 그대로 API', async () => {
    h.calls = []
    const stopped: string[] = []
    const viaApi: string[] = []
    clearLocalLlmBackends()
    try {
      for (const stage of PDP_MODEL_STAGES) {
        const route = pdpRoute(stage, {}, 'new', 'subscription', true)
        const before = h.calls.length
        try {
          const out = await callLlm(route, { ...REQ, runContext: { stage } }, (t) => t)
          expect(out.success, stage).toBe(true)
          viaApi.push(stage)
          expect(h.calls.length - before, stage).toBe(1)
          expect(route.backend, stage).not.toBe('subscription')
        } catch (error) {
          expect(error, stage).toBeInstanceOf(LlmSoftStopError)
          expect((error as LlmSoftStopError).stop.reason).toBe('unavailable')
          expect(h.calls.length - before, stage).toBe(0)
          stopped.push(stage)
        }
        clearLocalLlmBackends()
      }
    } finally {
      clearLocalLlmBackends()
    }
    expect(stopped.sort()).toEqual(
      [
        'research',
        'design/section-planning',
        'design/prompt',
        'design/template-guideline',
        'design/template-compose',
        'design/template-select',
        'images/gif-gate',
      ].sort()
    )
    expect(viaApi).toContain('images/gate')
    expect(viaApi).toContain('copy/stage2')
    expect(viaApi).toContain('analysis')
    expect(stopped.length + viaApi.length).toBe(PDP_MODEL_STAGES.length)
    // 구독 단계가 막혀도 API 공급자(Claude·OpenAI) 호출은 0 — API 호출은 Gemini·생각 끄기 단계 몫뿐이다
    expect(h.calls.length).toBe(viaApi.length)
  })
})
