/**
 * 새 단계 5개 연결(R10) — 켬 판정(새 배치 + newstages + 첫 생성), 자리별 '남았나' 판정, 새 단계 route 표(새 배치만·callLlm 사전 거절 없음),
 * 합성 뒤 검수 기록(첫 화면 웹 생략·잡 비용 상한·편집기 재생성), 연출 감독 한 줄. 공급자는 모의(유료 호출 0).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  calls: [] as Array<{ provider: string; model: unknown; maxTokens?: unknown; effort?: unknown; agent?: unknown; text?: unknown }>,
  reply: '{"flags":[],"pass":true}',
}))
vi.mock('@/lib/agents/_base', () => ({
  callAgent: async (o: { config: { model: string; maxTokens: number; effort?: string }; agentName: string; messages: Array<{ content: unknown }> }, parser: (t: string) => unknown) => {
    h.calls.push({ provider: 'codex', model: o.config.model, maxTokens: o.config.maxTokens, effort: o.config.effort, agent: o.agentName, text: o.messages[0]?.content })
    return { success: true, data: parser(h.reply), usage: { inputTokens: 10, outputTokens: 20, cost: 0.05 }, duration: 3 }
  },
}))

import { callLlm } from '@/lib/agents/llm'
import { NEW_STAGE_ROUTE_NAMES, type NewStageRecord } from './new-stages/common'
import type { DirectorPlan } from './new-stages/director'
import { PDP_MODEL_ROUTES, PDP_NEW_BATCH_STAGE_DEADLINE_MS, PDP_NEW_STAGE_ROUTES, pdpNewStageRoute } from './pdp-model-routes'
import {
  directorLineFor,
  finalScreenLinesOf,
  needsCopyFactAudit,
  needsDirector,
  needsPagePlan,
  needsSlotFactAudit,
  newStageFits,
  newStagesActive,
  runComposeReviewStages,
} from './pdp-new-stages-stage'
import type { PdpJobRow } from './pdp-state'
import { runWithPdpBatch } from './pdp-model-batch-context'

const ON = { enrichment: { version: 1, features: ['newstages'] } }

function job(over: Partial<PdpJobRow> = {}): PdpJobRow {
  return {
    id: 'job-00000001',
    analysis: ON,
    model_batch: 'new',
    section_images: [],
    spec_sheet: { productName: '두피 빗' },
    research_result: { target_insights: '직장인' },
    section_plan: {},
    design_prompts: {},
    copy_sections: { final: { mainIntro: { benefitHeadline: '아침 3분' } } },
    cost_usd: 1,
    ...over,
  } as PdpJobRow
}
const CTX = { userId: 'u1', stage: 'compose' }

beforeEach(() => {
  h.calls = []
  h.reply = '{"flags":[],"pass":true}'
})

describe('켬 판정 — 새 배치 + newstages 기록 + 첫 생성', () => {
  it('셋이 모두 맞을 때만 켠다', () => {
    expect(newStagesActive(job())).toBe(true)
    expect(newStagesActive(job({ model_batch: 'now' }))).toBe(false)
    expect(newStagesActive(job({ model_batch: undefined }))).toBe(false)
    expect(newStagesActive(job({ analysis: {} as never }))).toBe(false)
    expect(newStagesActive(job({ analysis: { enrichment: { version: 1, features: ['templatelib'] } } as never }))).toBe(false)
    expect(newStagesActive(job({ section_images: [{ section: 'hero', url: 'x', editorRegen: { at: 'now' } } as never] }))).toBe(false)
  })

  it('자리별 남았나 — 기록이 있거나 앞 산출이 없으면 false', () => {
    expect(needsPagePlan(job())).toBe(true)
    expect(needsPagePlan(job({ research_result: {} }))).toBe(false)
    expect(needsPagePlan(job({ research_result: { page_plan: { version: 1, stage: 'plan', status: 'skipped', reason: 'no_input' } } as never }))).toBe(false)
    expect(needsCopyFactAudit(job())).toBe(true)
    expect(needsCopyFactAudit(job({ copy_sections: {} }))).toBe(false)
    expect(needsSlotFactAudit(job())).toBe(false)
    expect(needsSlotFactAudit(job({ section_plan: { designcut: { sections: [] } } as never }))).toBe(true)
    expect(needsDirector(job(), {})).toBe(true)
    expect(needsDirector(job(), { director: { version: 1, stage: 'director', status: 'skipped', reason: 'no_input' } })).toBe(false)
    // 꺼진 잡은 모두 false — 단계 판정·저장이 그대로다
    const off = job({ model_batch: 'now' })
    expect([needsPagePlan(off), needsCopyFactAudit(off), needsSlotFactAudit({ ...off, section_plan: { designcut: { sections: [] } } as never }), needsDirector(off, {})]).toEqual([false, false, false, false])
  })
})

describe('새 단계 route 표 — 새 배치만, 지금 표에 없음', () => {
  it('route 이름 다섯 개가 표에 있고 지금 표(PDP_MODEL_ROUTES)에는 없다', () => {
    expect(Object.keys(PDP_NEW_STAGE_ROUTES).sort()).toEqual(Object.values(NEW_STAGE_ROUTE_NAMES).sort())
    for (const name of Object.values(NEW_STAGE_ROUTE_NAMES)) expect(Object.keys(PDP_MODEL_ROUTES)).not.toContain(name)
  })

  it('모델·등급 = R10 완료 조건(기획 Opus xhigh·사실 감사 Opus xhigh(R11d — Sonnet xhigh에서)·연출 감독 Opus low·첫 화면 Opus low·최종 검수 Opus xhigh)', () => {
    const pick = (name: keyof typeof PDP_NEW_STAGE_ROUTES) => [PDP_NEW_STAGE_ROUTES[name].model, PDP_NEW_STAGE_ROUTES[name].effort]
    expect(pick('research/page-plan')).toEqual(['claude-opus-5-5', 'xhigh'])
    expect(pick('copy/fact-audit')).toEqual(['claude-opus-5-5', 'xhigh'])
    expect(pick('images/director')).toEqual(['claude-opus-5-5', 'low'])
    expect(pick('compose/first-screen')).toEqual(['claude-opus-5-5', 'low'])
    expect(pick('compose/final-review')).toEqual(['claude-opus-5-5', 'xhigh'])
    for (const route of Object.values(PDP_NEW_STAGE_ROUTES)) {
      expect(route.maxTokens).toBeLessThanOrEqual(21_333)
      expect(route.callTimeoutMs).toBeGreaterThanOrEqual(25 * 60_000)
      expect(route.callTimeoutMs + 20_000).toBeLessThanOrEqual(PDP_NEW_BATCH_STAGE_DEADLINE_MS)
      expect(route.failOnTruncation).toBe(true)
    }
  })

  it('지금 배치 잡에서는 던진다(조용히 다른 표로 가지 않는다), 로컬 갈래·구독 env와 섞여도 던진다', () => {
    expect(() => pdpNewStageRoute('copy/fact-audit', {}, 'now')).toThrow('새 배치 잡만')
    expect(() => pdpNewStageRoute('copy/fact-audit', { NEXOPS_PDP_MODEL_ARM: 'M' }, 'new')).toThrow('모델 갈래')
    // 새 배치 구독은 env 갈래가 아니라 잡 표지(R13)로만 켠다
    expect(() => pdpNewStageRoute('copy/fact-audit', { NEXOPS_PDP_LLM_BACKEND: 'subscription' }, 'new')).toThrow('잡 표지')
    expect(pdpNewStageRoute('copy/fact-audit', { VERCEL: '1', NEXOPS_PDP_MODEL_ARM: 'M' }, 'new')).toBe(PDP_NEW_STAGE_ROUTES['copy/fact-audit'])
    expect(pdpNewStageRoute('copy/fact-audit', { NEXOPS_PDP_HOSTED: 'railway-worker', NEXOPS_PDP_MODEL_ARM: 'M' }, 'new')).toBe(
      PDP_NEW_STAGE_ROUTES['copy/fact-audit']
    )
    expect(runWithPdpBatch('new', () => pdpNewStageRoute('images/director', {}))).toBe(PDP_NEW_STAGE_ROUTES['images/director'])
  })

  it('모든 새 단계 route가 callLlm의 부르기 전 거절에 걸리지 않는다(공급자 모의)', async () => {
    for (const [name, route] of Object.entries(PDP_NEW_STAGE_ROUTES)) {
      const out = await callLlm(route, { system: 's', messages: [{ role: 'user', content: 'u' }], agentName: 'test/new-stages' }, (t) => t)
      expect(out.success, `${name} ${!out.success ? out.error.message : ''}`).toBe(true)
    }
    expect(h.calls.map((c) => c.provider)).toEqual(Array(5).fill('codex'))
  })

  it('이 run에 콜 시간 + 저장 여유 20초가 남았을 때만 부른다', () => {
    const now = 1_000_000
    const factAuditNeed = PDP_NEW_STAGE_ROUTES['copy/fact-audit'].callTimeoutMs + 20_000
    const directorNeed = PDP_NEW_STAGE_ROUTES['images/director'].callTimeoutMs + 20_000
    expect(newStageFits('factAudit', now + factAuditNeed, now)).toBe(true)
    expect(newStageFits('factAudit', now + factAuditNeed - 1, now)).toBe(false)
    expect(newStageFits('director', now + directorNeed, now)).toBe(true)
  })
})

describe('연출 감독 한 줄', () => {
  const plan: DirectorPlan = {
    light: 'Soft left light.',
    set: 'Oak table.',
    cuts: [{ key: 'hero', distance: 'mid', people: 'none', direction: 'Brush centered.', exception: '' }],
    conflicts_removed: [],
  }
  const done: NewStageRecord<DirectorPlan> = {
    version: 1,
    stage: 'director',
    status: 'done',
    route: { name: 'images/director', model: 'm', effort: 'low', maxTokens: 1, backend: 'api' },
    result: plan,
    warnings: [],
    costUsd: 0,
    durationMs: 0,
  }

  it('끝난 감독의 지시가 있는 컷만 한 줄, 그 밖은 null(지시 그대로)', () => {
    expect(directorLineFor({ director: done }, 'hero')).toBe('Art direction: Brush centered. Light: Soft left light. Set: Oak table.')
    expect(directorLineFor({ director: done }, 'k3_photo_0')).toBeNull()
    expect(directorLineFor({}, 'hero')).toBeNull()
    expect(directorLineFor(undefined, 'hero')).toBeNull()
    expect(directorLineFor({ director: { ...done, status: 'failed', failure: { kind: 'format', message: 'x' } } as never }, 'hero')).toBeNull()
  })

  it('상품 없는 컷(lightSetOnly, J49)은 컷 지시 문장 없이 빛·세트만', () => {
    expect(directorLineFor({ director: done }, 'hero', { lightSetOnly: true })).toBe('Art direction: Light: Soft left light. Set: Oak table.')
    expect(directorLineFor({}, 'hero', { lightSetOnly: true })).toBeNull()
  })
})

describe('합성 뒤 검수(첫 화면 심사·최종 검수)', () => {
  it('꺼진 잡은 null(저장 그대로) — 지금 배치·스위치 없음', async () => {
    expect(await runComposeReviewStages(job({ model_batch: 'now' }), CTX, Date.now() + 30 * 60_000)).toBeNull()
    expect(await runComposeReviewStages(job({ analysis: {} as never }), CTX, Date.now() + 30 * 60_000)).toBeNull()
    expect(h.calls).toHaveLength(0)
  })

  it('켠 잡 — 첫 화면은 웹 생략, 최종 검수는 새 단계 route로 화면 글을 보낸다', async () => {
    const out = await runWithPdpBatch('new', () => runComposeReviewStages(job(), CTX, Date.now() + 30 * 60_000))
    expect(out?.first_screen).toEqual({ version: 1, stage: 'firstScreen', status: 'skipped', reason: 'web_no_renderer' })
    expect(out?.final_review).toMatchObject({ status: 'done', result: { flags: [], pass: true }, costUsd: 0.05 })
    expect(out?.costUsd).toBe(0.05)
    expect(h.calls).toHaveLength(1)
    expect(h.calls[0]).toMatchObject({ model: 'claude-opus-5-5', effort: 'xhigh', maxTokens: 12_000, agent: 'registration/pdp-final-review' })
    expect(String(h.calls[0].text)).toContain('- mainIntro.benefitHeadline: 아침 3분')
  })

  it('잡 비용 상한에 닿았으면 둘 다 cost_cap 생략(부르지 않는다), 편집기 재생성 잡은 not_first_generation', async () => {
    const capped = await runComposeReviewStages(job({ cost_usd: 10 }), CTX, Date.now() + 30 * 60_000)
    expect([capped?.first_screen, capped?.final_review].map((r) => r && r.status === 'skipped' && r.reason)).toEqual(['cost_cap', 'cost_cap'])
    const regen = await runComposeReviewStages(job({ section_images: [{ section: 'hero', url: 'x', editorRegen: { at: 'now' } } as never] }), CTX, Date.now() + 30 * 60_000)
    expect([regen?.first_screen, regen?.final_review].map((r) => r && r.status === 'skipped' && r.reason)).toEqual(['not_first_generation', 'not_first_generation'])
    expect(h.calls).toHaveLength(0)
  })

  it('이미 기록이 있으면 다시 부르지 않는다(null)', async () => {
    const recorded = job({ section_plan: { first_screen: { version: 1, stage: 'firstScreen', status: 'skipped', reason: 'web_no_renderer' }, final_review: { version: 1, stage: 'finalReview', status: 'skipped', reason: 'no_input' } } })
    expect(await runComposeReviewStages(recorded, CTX, Date.now() + 30 * 60_000)).toBeNull()
    expect(h.calls).toHaveLength(0)
  })

  it('나가는 화면 글 — K 라인은 디자인 컷 칸 글, 없으면 카피 최종본', () => {
    expect(finalScreenLinesOf(job())).toEqual([{ id: 'mainIntro.benefitHeadline', text: '아침 3분' }])
    const k = job({ section_plan: { designcut: { sections: [{ key: 'hook_3step', templateRef: { id: 't', version: 1, slots: { title: '엉킴 없는 아침' } } }] } } as never })
    expect(finalScreenLinesOf(k)).toEqual([{ id: '0.hook_3step.title', text: '엉킴 없는 아침' }])
  })
})
