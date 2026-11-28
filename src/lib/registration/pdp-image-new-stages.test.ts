/**
 * images 단계 새 단계 자리(R10) — K 칸 카피 뒤 사실 감사(K 계획 기록 뒤)·연출 감독(헌장·식별 카드 뒤, 첫 생성 전), run에 콜 시간이 모자라면
 * 저장하고(잠금 해제) 다음 run으로, 감독이 끝난 잡은 컷 지시 뒤에 한 줄. 꺼진 잡은 부르지 않고 컷 지시가 바이트까지 같다.
 * 이미지 생성·Vision·LLM·DB·스토리지·예산은 모의(유료 호출 0).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PdpJobRow } from './pdp-state'

const h = vi.hoisted(() => ({
  job: null as PdpJobRow | null,
  patches: [] as Array<Record<string, unknown>>,
  generate: vi.fn(),
  llm: [] as Array<{ agent: string; model: string; effort?: string; text: string }>,
  replies: {} as Record<string, string>,
}))

vi.mock('@/lib/agents/budget', async (orig) => ({
  ...(await orig<typeof import('@/lib/agents/budget')>()),
  checkMonthlyBudget: vi.fn(async () => ({ allowed: true, spentUsd: 0, budgetUsd: 1000 })),
}))
vi.mock('@/lib/agents/_base', async (orig) => ({
  ...(await orig<typeof import('@/lib/agents/_base')>()),
  callAgent: async (o: { config: { model: string; effort?: string }; agentName: string; messages: Array<{ content: unknown }> }, parser: (t: string) => unknown) => {
    const text = typeof o.messages[0]?.content === 'string' ? (o.messages[0].content as string) : ''
    h.llm.push({ agent: o.agentName, model: o.config.model, effort: o.config.effort, text })
    return { success: true, data: parser(h.replies[o.agentName] ?? ''), usage: { inputTokens: 1, outputTokens: 1, cost: 0.04 }, duration: 1 }
  },
}))
vi.mock('./pdp-jobs', () => ({
  updatePdpJob: vi.fn(async (_db: unknown, _user: string, _id: string, patch: Record<string, unknown>) => {
    h.patches.push(patch)
    const job = { ...h.job! }
    if (patch.sectionImages !== undefined) job.section_images = patch.sectionImages as PdpJobRow['section_images']
    if (patch.costUsd !== undefined) job.cost_usd = patch.costUsd as number
    if (patch.designPrompts !== undefined) job.design_prompts = patch.designPrompts as PdpJobRow['design_prompts']
    if (patch.sectionPlan !== undefined) job.section_plan = patch.sectionPlan as PdpJobRow['section_plan']
    if (patch.currentStep !== undefined) job.current_step = patch.currentStep as PdpJobRow['current_step']
    if (patch.progress !== undefined) job.progress = patch.progress as number
    if (patch.error !== undefined) job.error = patch.error as string | null
    h.job = job
    return job
  }),
}))
vi.mock('@/lib/agents/registration/thumbnail-vision-agent', () => ({
  fetchImageAsBase64: vi.fn(async () => ({ data: 'aW1n', mediaType: 'image/png' })),
}))
vi.mock('@/lib/agents/registration/pdp-image-agent', () => ({
  readIdentityCard: vi.fn(async () => ({ card: 'IDENTITY', costUsd: 0 })),
  judgeImageGate: vi.fn(async () => ({ score: { has_artifact: false, same_product: true, consistency: 0.95, artifact_reason: '' }, costUsd: 0 })),
}))
vi.mock('@/lib/agents/registration/pdp-annotation-agent', () => ({ locateAnnotations: vi.fn() }))
vi.mock('@/lib/agents/image/generate', () => ({ generateImage: (...args: unknown[]) => h.generate(...args) }))
vi.mock('./storage', () => ({
  uploadPdpImage: vi.fn(async (_db: unknown, _u: string, jobId: string, section: string) => `https://cdn.test/${jobId}/${section}.png`),
}))

import type { GenImageInput } from '@/lib/agents/image/types'
import { runImagesStep } from './pdp-image-stage'
import { runWithPdpBatch } from './pdp-model-batch-context'
import { fixtureToJob, loadEnrichmentFixture, rewindTo } from './__golden__/golden-harness'

const DIRECTOR = {
  light: 'Soft left window light.',
  set: 'Pale oak table.',
  cuts: [{ key: 'k1_photo_0', distance: 'mid', people: 'none', direction: 'Brush centered.', exception: '' }],
  conflicts_removed: [],
}
const SHOT = { key: 'k1_photo_0', section: 'main_cut', purpose: 'hero', composition: 'front', aspect: '1:1', show: '엉킴 없는 아침' }
const DESIGNCUT = { palette: { tint: '#F5F1EA' }, sections: [{ key: 'hook_3step', templateRef: { id: 't', version: 1, slots: { title: '엉킴 없는 아침' } } }] }

function imagesJob(batch: 'new' | 'now', extra: Partial<PdpJobRow['section_plan']> = {}): PdpJobRow {
  const job = rewindTo(fixtureToJob(loadEnrichmentFixture('A-track-s')), 'images')
  return {
    ...job,
    model_batch: batch,
    analysis: { ...job.analysis, enrichment: { version: 1, features: ['newstages'] } },
    section_plan: { ...job.section_plan, ...extra },
    current_step: 'images',
    cost_usd: 1,
  }
}
const run = (job: PdpJobRow, budgetMs?: number) => {
  h.job = job
  return runWithPdpBatch(job.model_batch ?? 'now', () => runImagesStep({} as never, 'user-1', job, { leaseUntil: 'L', ...(budgetMs ? { budgetMs } : {}) }))
}
const prompts = () => h.generate.mock.calls.map(([input]) => input as GenImageInput)

beforeEach(() => {
  h.patches = []
  h.llm = []
  h.replies = {
    'registration/pdp-fact-audit': JSON.stringify({ items: [], summary: { checked: 0, unsupported: 0, regulated: 0 } }),
    'registration/pdp-director': JSON.stringify(DIRECTOR),
  }
  h.generate.mockReset().mockImplementation(async (input: GenImageInput) => ({ base64: 'aW1n', mimeType: 'image/png', model: input.model, costUsd: 0.1 }))
})

describe('K 칸 카피 뒤 사실 감사', () => {
  it('K 계획(칸 글)이 있으면 첫 생성 전에 한 번 부르고 section_plan.kslot_fact_audit에 키만 더한다', async () => {
    const out = await run(imagesJob('new', { designcut: DESIGNCUT, templatelib: { shots: [SHOT] } } as never))
    // K 칸 감사 → 연출 감독 순서(감사는 K 계획 뒤, 감독은 헌장·식별 카드 뒤)
    expect(h.llm.map((c) => c.agent)).toEqual(['registration/pdp-fact-audit', 'registration/pdp-director'])
    const audit = h.llm.find((c) => c.agent === 'registration/pdp-fact-audit')!
    // K 칸 감사는 카피 뒤 감사와 같은 route(copy/fact-audit) — R11d에서 함께 Opus 5.5 xhigh
    expect(audit).toMatchObject({ model: 'claude-opus-5-5', effort: 'xhigh' })
    expect(audit.text).toContain('- 0.hook_3step.title: 엉킴 없는 아침')
    expect(out.section_plan.kslot_fact_audit).toMatchObject({ stage: 'factAudit', status: 'done' })
    expect(out.section_plan.designcut).toEqual(DESIGNCUT)
  })

  it('run에 콜 시간이 모자라면 부르지 않고 저장해 잠금을 푼다 — 컷도 만들지 않는다', async () => {
    // 라이트 콜 시간 30분 + 저장 여유 20초가 필요하므로 210초 예산에서는 시작하지 않는다.
    const out = await run(imagesJob('new', { designcut: DESIGNCUT } as never), 210_000)
    expect(h.llm).toHaveLength(0)
    expect(h.generate).not.toHaveBeenCalled()
    expect(out.section_plan.kslot_fact_audit).toBeUndefined()
    expect(h.patches.at(-1)).not.toHaveProperty('leaseUntil')
  })
})

describe('연출 감독 — 헌장·식별 카드 뒤, 첫 생성 전', () => {
  it('K 계획 컷으로 한 번 부르고, 감독 지시가 있는 컷의 생성 지시 뒤에 한 줄을 붙인다', async () => {
    const out = await run(imagesJob('new', { templatelib: { shots: [SHOT] } } as never))
    const director = h.llm.find((c) => c.agent === 'registration/pdp-director')!
    expect(director).toMatchObject({ model: 'claude-opus-5-5', effort: 'low' })
    expect(director.text).toContain('- k1_photo_0: main_cut · hero · front · 엉킴 없는 아침')
    expect(director.text).toContain('IDENTITY')
    expect(out.design_prompts.director).toMatchObject({ status: 'done', result: DIRECTOR })
    // 감독 기록 뒤에 컷을 만든다 — 기록 저장이 첫 생성보다 앞이다
    const directorSave = h.patches.findIndex((p) => (p.designPrompts as { director?: unknown } | undefined)?.director)
    const firstImage = h.patches.findIndex((p) => Array.isArray(p.sectionImages) && (p.sectionImages as unknown[]).length > 0)
    expect(directorSave).toBeGreaterThanOrEqual(0)
    expect(directorSave).toBeLessThan(firstImage)
  })

  it('컷 키가 맞는 태스크의 지시 뒤에 붙는다(다른 컷은 그대로)', async () => {
    const done = { version: 1, stage: 'director', status: 'done', route: { name: 'images/director', model: 'm', effort: 'low', maxTokens: 1, backend: 'api' }, warnings: [], costUsd: 0, durationMs: 0 }
    const withHero = imagesJob('new')
    withHero.design_prompts = { ...withHero.design_prompts, director: { ...done, result: { ...DIRECTOR, cuts: [{ ...DIRECTOR.cuts[0], key: 'hero' }] } } as never }
    await run(withHero)
    const hero = prompts().find((p) => p.runContext?.stage === 'images/hero')!
    expect(hero.prompt).toContain('Art direction: Brush centered. Light: Soft left window light. Set: Pale oak table.')
    expect(prompts().filter((p) => p.prompt.includes('Art direction:'))).toHaveLength(1)
    expect(h.llm).toHaveLength(0)
  })

  it('run에 감독 콜 시간이 모자라면 헌장·식별 카드까지 저장하고 다음 run으로(컷 없음)', async () => {
    const out = await run(imagesJob('new'), 130_000)
    expect(h.llm).toHaveLength(0)
    expect(h.generate).not.toHaveBeenCalled()
    expect(out.design_prompts.director).toBeUndefined()
    expect(out.design_prompts.identity_card).toContain('IDENTITY')
    expect(h.patches.at(-1)).not.toHaveProperty('leaseUntil')
  })
})

describe('꺼진 잡(지금 배치) — 바이트 그대로', () => {
  it('새 단계를 부르지 않고 기록하지 않으며, 컷 지시가 켠 잡(감독 지시 없음)과 같다', async () => {
    await run(imagesJob('now', { designcut: DESIGNCUT, templatelib: { shots: [SHOT] } } as never))
    const offPrompts = prompts().map((p) => [p.runContext?.stage, p.prompt])
    expect(h.llm).toHaveLength(0)
    expect(h.job!.section_plan.kslot_fact_audit).toBeUndefined()
    expect(h.job!.design_prompts.director).toBeUndefined()

    h.generate.mockClear()
    h.replies['registration/pdp-director'] = JSON.stringify({ ...DIRECTOR, cuts: [] })
    await run(imagesJob('new', { designcut: DESIGNCUT, templatelib: { shots: [SHOT] } } as never))
    expect(prompts().map((p) => [p.runContext?.stage, p.prompt])).toEqual(offPrompts)
  })
})
