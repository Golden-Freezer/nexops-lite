/**
 * 상세페이지 에이전트 라우트 배선(묶음 1) — 에이전트마다 PDP_MODEL_ROUTES의 맞는 단계로 부르고, 실제 공급자 호출
 * (callAgent·callOpenAiChat)까지 모델·상한·thinking·temperature와 runContext(user_id 격리)가 그대로 가는지 고정한다.
 * 같은 모델 단계끼리 바꿔 끼우면(예: 게이트 → 식별 카드, 상한 500 → 200) 골든은 못 잡는다 — 여기서 잡는다.
 * 공급자 SDK·HTTP는 모의(유료 호출 0).
 */

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PdpJobRow } from '@/lib/registration/pdp-state'

type Recorded = { agent: string; options: Record<string, unknown>; provider: 'anthropic' | 'openai' | 'gemini' }
const h = vi.hoisted(() => ({ calls: [] as Recorded[], job: null as unknown as PdpJobRow }))

function canned(agent: string): string {
  const job = h.job
  const copyFinal = job.copy_sections.final as unknown as { pointCards: unknown[] }
  switch (agent) {
    case 'registration/pdp-category':
      return '{"category":"household"}'
    case 'registration/pdp-analysis':
      return JSON.stringify({ keywords: ['k'], usp_candidates: ['u'], raw_summary: 's' })
    case 'registration/pdp-research':
      return JSON.stringify(job.research_result)
    case 'registration/pdp-section-planning':
      return JSON.stringify(job.section_plan)
    case 'registration/pdp-design-prompt': {
      const { style_charter: _s, identity_card: _i, ...rest } = job.design_prompts
      return JSON.stringify(rest)
    }
    case 'registration/pdp-template-guideline':
      return '{"persona":"p","tone":"t","concept":{"id":"clean-trust","reason":"r"},"alternatives":[]}'
    case 'registration/pdp-template-compose':
      return '{"sections":["cta"]}'
    case 'registration/pdp-template-copy':
      return '{"sections":[{"index":0,"slots":{"must":"글"}}]}'
    case 'registration/pdp-template-select':
      return '{"picks":[{"index":0,"templateId":"cta.a","reason":"r"}]}'
    case 'registration/pdp-copy-retry-pointcards':
      return '[]'
    case 'registration/pdp-copy-regen':
      return '{"text":"메인","alt1":"대안 1","alt2":"대안 2"}'
    case 'registration/pdp-auto-fill':
      return '{"targetPersona":"페르소나","brandVoiceGuide":"보이스","brandHexColor":"#3366CC"}'
    case 'registration/pdp-image-identity':
      return 'identity card'
    case 'registration/pdp-image-gate':
      return JSON.stringify({ has_artifact: false, same_product: true, consistency: 0.95, artifact_reason: '' })
    case 'registration/pdp-annotation':
      return '[{"kind":"label","text":"라벨","x":0.5,"y":0.5}]'
    default:
      // 카피 Stage 1·2·3 — 카드 2개만 돌려 pointCards 보충 콜까지 부르게 한다
      return JSON.stringify({ ...copyFinal, pointCards: copyFinal.pointCards.slice(0, 2) })
  }
}

async function record(
  provider: Recorded['provider'],
  options: Record<string, unknown>,
  parser: (t: string) => unknown
) {
  const agent = String(options.agentName)
  h.calls.push({ agent, options, provider })
  return {
    success: true,
    data: parser(canned(agent)),
    usage: { inputTokens: 0, outputTokens: 0, cost: 0 },
    duration: 0,
  }
}

vi.mock('../_base', () => ({
  callAgent: (o: Record<string, unknown>, p: (t: string) => unknown) => record('anthropic', o, p),
}))
vi.mock('../openai-chat', () => ({
  callOpenAiChat: (o: Record<string, unknown>, p: (t: string) => unknown) => record('openai', o, p),
}))
// 새 배치(R03) 게이트·식별 카드는 Gemini — 라우트와 요청을 함께 남긴다
vi.mock('../llm/providers/gemini', () => ({
  callGemini: (route: Record<string, unknown>, req: Record<string, unknown>, p: (t: string) => unknown) =>
    record('gemini', { ...req, route }, p),
}))

import {
  PDP_MODEL_ROUTES,
  PDP_MODEL_ROUTES_NEW,
  type PdpModelRoute,
  type PdpModelStage,
} from '@/lib/registration/pdp-model-routes'
import { runWithPdpBatch } from '@/lib/registration/pdp-model-batch-context'
import { fixtureToJob, loadEnrichmentFixture } from '@/lib/registration/__golden__/golden-harness'
import { runPdpAnalysis } from './pdp-analysis-agent'
import { runPdpResearch } from './pdp-research-agent'
import { generatePdpDesignPrompts, planPdpSections } from './pdp-design-agent'
import { composeTemplateSections, generateTemplateGuideline, selectTemplatePicks } from './pdp-template-agent'
import { fillTemplateSlots } from './pdp-template-copy-agent'
import { conceptById } from '@/lib/registration/templatelib/concepts'
import { tpl } from '@/lib/registration/templatelib/selection.fixture'
import { runPdpCopywriting } from './pdp-copy-agent'
import { judgeImageGate, readIdentityCard } from './pdp-image-agent'
import { locateAnnotations } from './pdp-annotation-agent'
import { callCopyRegenModel } from './pdp-copy-regen-agent'
import { callAutoFillModel } from './pdp-auto-fill-agent'

const RUN = { userId: 'user-1', businessId: 'biz-1', stage: 'routing' }
const IMAGE = { mediaType: 'image/png' as const, data: 'AA' }

const EXPECTED: Array<[agent: string, stage: PdpModelStage]> = [
  ['registration/pdp-category', 'analysis/category'],
  ['registration/pdp-analysis', 'analysis'],
  ['registration/pdp-research', 'research'],
  ['registration/pdp-section-planning', 'design/section-planning'],
  ['registration/pdp-design-prompt', 'design/prompt'],
  ['registration/pdp-template-guideline', 'design/template-guideline'],
  ['registration/pdp-template-compose', 'design/template-compose'],
  ['registration/pdp-template-select', 'design/template-select'],
  ['registration/pdp-template-copy', 'copy/template-slots'],
  ['registration/pdp-copy-stage1', 'copy/structural'],
  ['registration/pdp-copy-stage2', 'copy/stage2'],
  ['registration/pdp-copy-stage3', 'copy/stage3'],
  ['registration/pdp-copy-retry-pointcards', 'copy/retry-pointcards'],
  ['registration/pdp-copy-regen', 'copy/editor-regen'],
  ['registration/pdp-auto-fill', 'copy/auto-fill'],
  ['registration/pdp-image-identity', 'images/identity'],
  ['registration/pdp-image-gate', 'images/gate'],
  ['registration/pdp-annotation', 'images/annotation'],
]

beforeAll(() => {
  h.job = fixtureToJob(loadEnrichmentFixture('A-track-i'))
})
beforeEach(() => {
  h.calls = []
})

async function runAllAgents() {
  const job = h.job
  await runPdpAnalysis({
    specSheet: { ...job.spec_sheet, category: '' },
    reviewsSummary: '리뷰 데이터 없음',
    runContext: RUN,
  })
  await runPdpResearch({ specSheet: job.spec_sheet, analysis: job.analysis, strategyContract: {}, runContext: RUN })
  const designInput = {
    analysis: job.analysis,
    research: job.research_result,
    strategyContract: {},
    specSheet: job.spec_sheet,
    runContext: RUN,
  }
  await planPdpSections(designInput)
  await generatePdpDesignPrompts(designInput)
  const product = { category: 'household', persona: null, summary: '', keywords: [], usps: [], pains: [] }
  const guideline = await generateTemplateGuideline({ product, concepts: [conceptById('clean-trust')!] }, RUN)
  await composeTemplateSections({ product, guideline: guideline.value, open: ['cta'], facts: { count: 0, places: 0 }, range: { min: 18, max: 22 } }, RUN)
  await selectTemplatePicks({ product, guideline: guideline.value, conceptName: 'c', slots: [{ index: 0, section: 'cta', candidates: [tpl('cta.a')] }] }, RUN)
  await fillTemplateSlots(
    { product, guideline: guideline.value, facts: [], spec: job.spec_sheet, sections: [{ index: 0, section: 'cta', factSlots: 0, slots: [{ name: 'must', required: true, facts: 0 }] }] },
    RUN
  )
  await runPdpCopywriting({
    specSheet: job.spec_sheet,
    mode: 'pro',
    analysis: job.analysis,
    research: job.research_result,
    sectionPlan: job.section_plan,
    strategyContract: {},
    runContext: RUN,
  })
  await readIdentityCard(IMAGE, RUN)
  await judgeImageGate(IMAGE, 'hero', IMAGE, RUN)
  await locateAnnotations(IMAGE, ['라벨'], ['label'], RUN)
  await callCopyRegenModel({ system: 's', user: 'u' }, RUN)
  await callAutoFillModel({ productName: '컵', specSheet: {}, imageUrls: [] }, [IMAGE], RUN)
}

describe('에이전트 → 단계 라우트 → 공급자 배선', () => {
  it('에이전트마다 맞는 단계의 모델·첫 상한·thinking·temperature로 부르고, runContext가 그대로 간다', async () => {
    await runAllAgents()
    for (const [agent, stage] of EXPECTED) {
      const call = h.calls.find((c) => c.agent === agent)
      expect(call, agent).toBeDefined()
      const route = PDP_MODEL_ROUTES[stage] as {
        model: string
        maxTokens: number
        temperature?: number
        disableThinking?: boolean
      }
      if (call!.provider === 'openai') {
        expect(call!.options, agent).toMatchObject({ model: route.model, maxTokens: route.maxTokens, runContext: RUN })
        expect(call!.options, agent).not.toHaveProperty('temperature')
        continue
      }
      expect(call!.options.config, agent).toEqual({
        model: route.model,
        maxTokens: route.maxTokens,
        ...(route.temperature !== undefined ? { temperature: route.temperature } : {}),
        ...(route.disableThinking ? { disableThinking: true } : {}),
      })
      expect(call!.options.runContext, agent).toEqual(RUN)
    }
    expect(new Set(h.calls.map((c) => c.agent))).toEqual(new Set(EXPECTED.map(([agent]) => agent)))
  })
})

describe('새 배치(R03) — 잡 배치로 감싸면 같은 에이전트가 새 표로 부른다', () => {
  it('단계마다 새 표의 모델·등급·상한·콜 시간·재시도가 공급자까지 간다(Opus·Sol·Argon, thinking 끔 없음)', async () => {
    await runWithPdpBatch('new', runAllAgents)
    for (const [agent, stage] of EXPECTED) {
      const call = h.calls.find((c) => c.agent === agent)
      expect(call, agent).toBeDefined()
      const route: PdpModelRoute = PDP_MODEL_ROUTES_NEW[stage]
      const o = call!.options
      if (call!.provider === 'gemini') {
        expect(o.route, agent).toEqual(route)
      } else if (call!.provider === 'openai') {
        expect(o, agent).toMatchObject({ model: route.model, maxTokens: route.maxTokens, runContext: RUN })
        if (route.effort) expect(o.reasoningEffort, agent).toBe(route.effort)
      } else {
        expect(o.config, agent).toEqual({
          model: route.model,
          maxTokens: route.maxTokens,
          ...(route.disableThinking ? { disableThinking: true } : {}),
          ...(route.effort ? { effort: route.effort } : {}),
        })
      }
      if (route.callTimeoutMs !== undefined) expect(o.timeoutMs, agent).toBe(route.callTimeoutMs)
      if (route.callMaxRetries !== undefined) expect(o.maxRetries, agent).toBe(route.callMaxRetries)
    }
    const providerOf = (agent: string) => h.calls.find((c) => c.agent === agent)?.provider
    expect(providerOf('registration/pdp-image-gate')).toBe('gemini')
    expect(providerOf('registration/pdp-image-identity')).toBe('gemini')
    expect(providerOf('registration/pdp-research')).toBe('openai')
    // R06 5차(오너 11-08 14:4x) — 설계② Sol medium. J34(통합 decide 15 ③) — 원문 카피 3단 Gemini argon
    expect(providerOf('registration/pdp-copy-stage1')).toBe('gemini')
    expect(providerOf('registration/pdp-copy-stage2')).toBe('gemini')
    expect(providerOf('registration/pdp-copy-stage3')).toBe('gemini')
    expect(providerOf('registration/pdp-design-prompt')).toBe('openai')
  })

  it('감싸지 않으면 지금 표 그대로(지금 배치 — 같은 에이전트 호출)', async () => {
    await runAllAgents()
    const gate = h.calls.find((c) => c.agent === 'registration/pdp-image-gate')!
    expect(gate.provider).toBe('anthropic')
    expect(gate.options.config).toEqual({ model: 'claude-sonnet-5-5', maxTokens: 500, disableThinking: true })
    const research = h.calls.find((c) => c.agent === 'registration/pdp-research')!
    expect(research.options.timeoutMs).toBe(90_000)
  })

  it('GIF 검사는 게이트와 route가 나뉜다 — 새 배치는 Opus xhigh 4,000·잘림 감지, 지금 배치는 게이트와 같은 값', async () => {
    await runWithPdpBatch('new', () => judgeImageGate(IMAGE, 'motion', IMAGE, RUN, { timeoutMs: 40_000, maxRetries: 0 }, undefined, 'images/gif-gate'))
    expect(h.calls[0].provider).toBe('anthropic')
    // 기록 이름도 게이트와 나뉜다(model-trace 단계별 집계)
    expect(h.calls[0].agent).toBe('registration/pdp-image-gif-gate')
    expect(h.calls[0].options).toMatchObject({
      config: { model: 'claude-opus-5-5', maxTokens: 4000, effort: 'xhigh' },
      timeoutMs: 40_000,
      maxRetries: 0,
      failOnTruncation: true,
    })
    h.calls = []
    await judgeImageGate(IMAGE, 'motion', IMAGE, RUN, { timeoutMs: 40_000, maxRetries: 0 }, undefined, 'images/gif-gate')
    expect(h.calls[0].options.config).toEqual(PDP_MODEL_ROUTES['images/gate'] as unknown as Record<string, unknown>)
  })

  it('단계 기한(새 배치 설계·리서치 280초)은 받으면 공급자 요청까지 간다 — 안 받으면 칸이 없다', async () => {
    const job = h.job
    const deadlineAt = Date.now() + 280_000
    const designInput = { analysis: job.analysis, research: job.research_result, strategyContract: {}, specSheet: job.spec_sheet, runContext: RUN }
    await runWithPdpBatch('new', async () => {
      await runPdpResearch({ specSheet: job.spec_sheet, analysis: job.analysis, strategyContract: {}, runContext: RUN, deadlineAt })
      await planPdpSections({ ...designInput, deadlineAt })
      await generatePdpDesignPrompts({ ...designInput, deadlineAt })
    })
    for (const agent of ['registration/pdp-research', 'registration/pdp-section-planning', 'registration/pdp-design-prompt']) {
      expect(h.calls.find((c) => c.agent === agent)?.options.deadlineAt, agent).toBe(deadlineAt)
    }
    h.calls = []
    await planPdpSections(designInput)
    expect(h.calls[0].options).not.toHaveProperty('deadlineAt')
  })
})
