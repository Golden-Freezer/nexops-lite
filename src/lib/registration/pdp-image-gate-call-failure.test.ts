/**
 * 새 배치 게이트 호출 실패를 통과로 치지 않는다(하네스 R12e) — R13 운영 잡 96872abb에서 게이트 3/28콜이 60초 시간 초과로 검사 없이
 * 통과했다. 새 배치 일반 생성은 채점 호출 실패를 게이트 대기(gatePending)로 다음 run 맨 앞에서 다시 판정하고(컷마다 2번까지), 그 뒤에도
 * 실패하면 이미지는 두고 판정 못 함(gateUnjudged)으로 남긴다. 시도 시간이 60초 아래로 줄면 부르지 않고 대기로 넘긴다. 지금 배치는 그대로.
 * 이미지 생성·Vision·DB·스토리지는 모의(유료 0)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PdpJobRow, SectionImage } from './pdp-state'

const h = vi.hoisted(() => ({
  job: null as PdpJobRow | null,
  /** 섹션별 남은 게이트 호출 실패 수(callFailed) */
  gateCallFail: new Map<string, number>(),
  gateCalls: [] as Array<{ cut: string; limits: unknown }>,
  order: [] as string[],
  clock: null as number | null,
  genAdvanceMs: 0,
}))

vi.mock('./pdp-jobs', () => ({
  updatePdpJob: vi.fn(async (_db: unknown, _user: string, _id: string, patch: Record<string, unknown>) => {
    const job = { ...h.job! }
    if (patch.sectionImages !== undefined) job.section_images = patch.sectionImages as SectionImage[]
    if (patch.costUsd !== undefined) job.cost_usd = patch.costUsd as number
    if (patch.designPrompts !== undefined) job.design_prompts = patch.designPrompts as PdpJobRow['design_prompts']
    if (patch.currentStep !== undefined) job.current_step = patch.currentStep as PdpJobRow['current_step']
    if (patch.progress !== undefined) job.progress = patch.progress as number
    h.job = job
    return job
  }),
}))
vi.mock('@/lib/agents/registration/thumbnail-vision-agent', () => ({
  fetchImageAsBase64: vi.fn(async () => ({ mediaType: 'image/png', data: 'SRC' })),
}))
vi.mock('@/lib/agents/registration/pdp-image-agent', () => ({
  readIdentityCard: vi.fn(async () => ({ card: 'IDENTITY', costUsd: 0 })),
  judgeImageGate: vi.fn(async (_ref: unknown, cut: string, _gen: unknown, _ctx: unknown, limits: unknown) => {
    h.gateCalls.push({ cut, limits })
    h.order.push(`gate:${cut}`)
    const left = h.gateCallFail.get(cut) ?? 0
    if (left > 0) {
      h.gateCallFail.set(cut, left - 1)
      // 실패한 시도의 과금(R12d spent)도 돌려준다
      return { score: null, costUsd: 0.01, callFailed: true }
    }
    return { score: { has_artifact: false, same_product: true, consistency: 0.95, artifact_reason: '' }, costUsd: 0.002 }
  }),
}))
vi.mock('@/lib/agents/registration/pdp-annotation-agent', () => ({ locateAnnotations: vi.fn() }))
vi.mock('@/lib/agents/image/generate', () => ({
  generateImage: vi.fn(async (args: { runContext: { stage: string } }) => {
    const regen = args.runContext.stage.endsWith('/regenerate')
    const section = args.runContext.stage.replace(/^images\//, '').replace(/\/regenerate$/, '')
    h.order.push(`gen:${section}${regen ? '/regen' : ''}`)
    if (h.clock !== null) h.clock += h.genAdvanceMs
    return { base64: 'aW1n', mimeType: 'image/png' }
  }),
}))
vi.mock('./storage', () => ({
  uploadPdpImage: vi.fn(async (_db: unknown, _u: string, jobId: string, section: string) => `https://cdn.test/${jobId}/${section}.png`),
}))
vi.mock('@/lib/agents/budget', async (orig) => ({
  ...(await orig<typeof import('@/lib/agents/budget')>()),
  checkMonthlyBudget: vi.fn(async () => ({ allowed: true, spentUsd: 0, budgetUsd: 1000 })),
}))

import { runWithPdpBatch } from './pdp-model-batch-context'
import {
  GATE_CALL_FAILURE_REJUDGE_MAX,
  GATE_NEW_BATCH_MIN_ATTEMPT_MS,
  GATE_UNDECIDED_CALL_FAILED,
  RUN_TIME_BUDGET_MS,
  runImagesStep,
} from './pdp-image-stage'
import { resolveStepToRun } from './pdp-pipeline'
import { buildImageTasks } from './pdp-image-tasks'
import { fixtureToJob, loadEnrichmentFixture, rewindTo } from './__golden__/golden-harness'

/** images 단계에서 시작하는 잡(제품 컷·효과 전용 컷이 섞인 Pro 잡) — 배치만 바꾼다 */
function imagesJob(batch: 'now' | 'new'): PdpJobRow {
  const job = rewindTo(fixtureToJob(loadEnrichmentFixture('A-track-i')), 'images')
  return {
    ...job,
    image_model: 'gpt-image-2',
    image_quality: 'medium',
    current_step: 'images',
    cost_usd: 0,
    analysis: { ...job.analysis, enrichment: { version: 1, features: ['vocab', 'persuasion'] } },
    section_plan: { ...job.section_plan, enrichment: { version: 1, features: ['vocab', 'persuasion'] } },
    ...(batch === 'new' ? { model_batch: 'new' as const } : {}),
  } as PdpJobRow
}

async function run(job: PdpJobRow): Promise<PdpJobRow> {
  h.job = job
  return runWithPdpBatch(job.model_batch ?? 'now', () => runImagesStep({} as never, 'user-1', job, { concurrency: 1 }))
}

const heroOf = (job: PdpJobRow) => job.section_images.find((e) => e.section === 'hero')!
const gatesOf = (cut: string) => h.order.filter((o) => o === `gate:${cut}`).length

/** 손으로 움직이는 시계 — 생성 1회마다 advanceMs씩 흐른다 */
function manualClock(advanceMs: number) {
  h.clock = 1_000_000
  h.genAdvanceMs = advanceMs
  vi.spyOn(Date, 'now').mockImplementation(() => h.clock!)
}

beforeEach(() => {
  h.gateCallFail = new Map()
  h.gateCalls = []
  h.order = []
  h.clock = null
  h.genAdvanceMs = 0
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => vi.restoreAllMocks())

describe('새 배치 — 채점 호출 실패는 통과로 치지 않는다', () => {
  it('실패 → 게이트 대기(1번) → 다음 run 맨 앞에서 다시 판정해 통과, 실패한 시도 값도 잡 비용에', async () => {
    h.gateCallFail.set('hero', 1)
    const first = await run(imagesJob('new'))
    expect(h.order.slice(0, 2)).toEqual(['gen:hero', 'gate:hero'])
    expect(heroOf(first)).toMatchObject({ gatePending: true, gateCallFailures: 1, url: expect.stringContaining('hero') })
    expect(heroOf(first)).not.toHaveProperty('gateUnjudged')
    // 판정 전 hero를 스타일 참조로 쓰지 않게 상품 컷은 다음 run까지 기다린다(시간 부족 대기와 같은 규칙)
    const productCuts = buildImageTasks(first).filter((t) => t.section !== 'hero' && !t.effectOnly).map((t) => `gen:${t.section}`)
    expect(productCuts.length).toBeGreaterThan(0)
    expect(h.order.filter((o) => productCuts.includes(o))).toEqual([])
    // 실패한 게이트 시도 값(0.01)이 잡 비용에 든다 — 효과 전용 컷 생성 값과 함께
    expect(first.cost_usd).toBeGreaterThanOrEqual(0.01)
    expect(resolveStepToRun(first)).toBe('images')

    h.order = []
    const second = await run(first)
    expect(h.order[0]).toBe('gate:hero')
    expect(h.order.filter((o) => o === 'gen:hero')).toHaveLength(0)
    expect(heroOf(second).gatePending).toBeUndefined()
    expect(heroOf(second).gate).toMatchObject({ verdict: 'pass' })
    expect(heroOf(second)).not.toHaveProperty('gateUnjudged')
    expect(second.current_step).toBe('compose')
    expect(second.cost_usd).toBeGreaterThan(first.cost_usd)
  })

  it(`상한 — ${GATE_CALL_FAILURE_REJUDGE_MAX}번 다시 판정해도 실패하면 이미지는 두고 판정 못 함, 재생성 없이 다음으로`, async () => {
    h.gateCallFail.set('hero', 99)
    let job = imagesJob('new')
    for (let i = 1; i <= GATE_CALL_FAILURE_REJUDGE_MAX; i++) {
      job = await run(job)
      expect(heroOf(job)).toMatchObject({ gatePending: true, gateCallFailures: i })
    }
    job = await run(job)
    expect(gatesOf('hero')).toBe(GATE_CALL_FAILURE_REJUDGE_MAX + 1)
    expect(heroOf(job)).toMatchObject({ gateUnjudged: GATE_UNDECIDED_CALL_FAILED, gateCallFailures: GATE_CALL_FAILURE_REJUDGE_MAX + 1 })
    expect(heroOf(job).gatePending).toBeUndefined()
    expect(heroOf(job).url).toBeTruthy()
    expect(h.order.filter((o) => o.startsWith('gen:hero'))).toEqual(['gen:hero'])
    expect(job.current_step).toBe('compose')
    expect(GATE_UNDECIDED_CALL_FAILED).toBe('게이트 판정 못 함(채점 호출 실패 3번)')
  })
})

describe('새 배치 — 시도 시간', () => {
  it('30분 route는 run의 받기 여유를 넘으므로 남은 시간에서 받기 25초를 뺀 한 번으로 제한한다', async () => {
    await run(imagesJob('new'))
    expect(h.gateCalls.length).toBeGreaterThan(0)
    for (const call of h.gateCalls) {
      expect(call.limits).toMatchObject({ maxRetries: 0 })
      expect((call.limits as { timeoutMs: number }).timeoutMs).toBeLessThan(30 * 60_000)
      expect((call.limits as { timeoutMs: number }).timeoutMs).toBeGreaterThanOrEqual(GATE_NEW_BATCH_MIN_ATTEMPT_MS)
    }
  })

  it('빠듯하면 남은 시간 − 받기 25초(30분 상한)로 한 번, 60초 아래면 부르지 않고 대기(호출 실패 수에 안 셈)', async () => {
    // hero 생성 뒤 115초 → 시도 90초
    manualClock(RUN_TIME_BUDGET_MS - 115_000)
    await run(imagesJob('new'))
    expect(h.gateCalls).toEqual([{ cut: 'hero', limits: { timeoutMs: 90_000, maxRetries: 0 } }])

    // 남은 90초 → 시도 65초(60초 이상이라 부른다)
    h.gateCalls = []
    manualClock(RUN_TIME_BUDGET_MS - 90_000)
    await run(imagesJob('new'))
    expect(h.gateCalls).toEqual([{ cut: 'hero', limits: { timeoutMs: 65_000, maxRetries: 0 } }])

    // 남은 80초 → 시도 55초 < 60초 → 부르지 않고 대기
    h.gateCalls = []
    manualClock(RUN_TIME_BUDGET_MS - 80_000)
    const out = await run(imagesJob('new'))
    expect(h.gateCalls).toHaveLength(0)
    expect(heroOf(out)).toMatchObject({ gatePending: true })
    expect(heroOf(out)).not.toHaveProperty('gateCallFailures')
    expect(GATE_NEW_BATCH_MIN_ATTEMPT_MS).toBe(60_000)
  })
})

describe('지금 배치 — 그대로', () => {
  it('채점 호출 실패는 지금처럼 통과와 같은 처리(대기·판정 못 함 기록 없음)', async () => {
    h.gateCallFail.set('hero', 1)
    const out = await run(imagesJob('now'))
    expect(heroOf(out).gatePending).toBeUndefined()
    expect(heroOf(out)).not.toHaveProperty('gateUnjudged')
    expect(heroOf(out)).not.toHaveProperty('gateCallFailures')
    expect(out.current_step).toBe('compose')
  })

  it('시도 시간은 60초 상한·최소 시도 없음 — 남은 80초면 55초로 부른다', async () => {
    manualClock(RUN_TIME_BUDGET_MS - 80_000)
    await run(imagesJob('now'))
    expect(h.gateCalls).toEqual([{ cut: 'hero', limits: { timeoutMs: 55_000, maxRetries: 0 } }])
  })
})
