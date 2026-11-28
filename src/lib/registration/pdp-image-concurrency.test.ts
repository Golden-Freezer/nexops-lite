/**
 * images 단계 동시 생성(속도 개선 1차) — 지연을 넣은 가짜 이미지 백엔드로 동시 상한·hero 선행·저장 순서·예산 소진·504 뒤 부분
 * 산출·잠금 유지와 해제·게이트 시간 상한을 고정한다. 이미지 생성·Vision·DB·스토리지는 모의(유료 호출 0).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PdpJobRow, SectionImage } from './pdp-state'

const h = vi.hoisted(() => ({
  job: null as PdpJobRow | null,
  /** 생성 호출 — 시작·끝 시각, 게이트 재생성 여부 */
  calls: [] as Array<{ section: string; regen: boolean; refs: number; start: number; end?: number }>,
  inflight: 0,
  maxInflight: 0,
  delayMs: 30,
  /** 섹션·재생성별 지연(없으면 delayMs) */
  delayFor: null as ((section: string, regen: boolean) => number) | null,
  /** 끝나지 않는 섹션(504 재현) */
  hang: new Set<string>(),
  /** 첫 생성이 한 번 실패하는 섹션 */
  failOnce: new Set<string>(),
  /** 게이트가 한 번 미달로 판정하는 섹션 */
  gateFailOnce: new Set<string>(),
  /** 게이트 채점이 한 번 실패(점수 없음)하는 섹션 */
  gateNullOnce: new Set<string>(),
  /** 새 배치 게이트가 끝까지 잘려 판정하지 못하는(truncated) 섹션(R03) */
  gateTruncatedOnce: new Set<string>(),
  gateCalls: [] as Array<{ cut: string; limits: unknown }>,
  /** 생성·게이트 호출 순서 — `gen:<섹션>`(재생성은 `/regen`)·`gate:<섹션>` */
  order: [] as string[],
  /** 이 URL의 n번째 받기만 실패(null) */
  fetchNullAt: null as { url: string; n: number } | null,
  fetchCount: new Map<string, number>(),
  /** 저장 — 순서대로 url 있는 섹션, 실은 잠금 기한 */
  saves: [] as string[][],
  leases: [] as Array<string | undefined>,
  failNextUrlSave: false,
  saveInflight: 0,
  maxSaveInflight: 0,
  budgetUsd: 1000,
  /** 손으로 움직이는 시계(null이면 실제 시계) — 생성 1회마다 genAdvanceMs씩 흐른다 */
  clock: null as number | null,
  genAdvanceMs: 0,
}))

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

vi.mock('./pdp-jobs', () => ({
  updatePdpJob: vi.fn(async (_db: unknown, _user: string, _id: string, patch: Record<string, unknown>) => {
    h.saveInflight++
    h.maxSaveInflight = Math.max(h.maxSaveInflight, h.saveInflight)
    await sleep(2)
    h.saveInflight--
    const images = patch.sectionImages as SectionImage[] | undefined
    if (h.failNextUrlSave && images?.some((e) => e.url)) {
      h.failNextUrlSave = false
      throw new Error('PDP 잡 갱신 실패: 일시 오류')
    }
    const job = { ...h.job! }
    if (images !== undefined) job.section_images = images
    if (patch.costUsd !== undefined) job.cost_usd = patch.costUsd as number
    if (patch.designPrompts !== undefined) job.design_prompts = patch.designPrompts as PdpJobRow['design_prompts']
    if (patch.currentStep !== undefined) job.current_step = patch.currentStep as PdpJobRow['current_step']
    if (patch.progress !== undefined) job.progress = patch.progress as number
    if (images !== undefined) h.saves.push(images.filter((e) => e.url).map((e) => e.section))
    h.leases.push(patch.leaseUntil as string | undefined)
    h.job = job
    return job
  }),
}))
vi.mock('@/lib/agents/registration/thumbnail-vision-agent', () => ({
  fetchImageAsBase64: vi.fn(async (url: string) => {
    const n = (h.fetchCount.get(url) ?? 0) + 1
    h.fetchCount.set(url, n)
    if (h.fetchNullAt?.url === url && h.fetchNullAt.n === n) return null
    return { mediaType: 'image/png', data: 'SRC' }
  }),
}))
vi.mock('@/lib/agents/registration/pdp-image-agent', () => ({
  readIdentityCard: vi.fn(async () => ({ card: 'IDENTITY', costUsd: 0 })),
  judgeImageGate: vi.fn(async (_ref: unknown, cut: string, _gen: unknown, _ctx: unknown, limits: unknown) => {
    h.gateCalls.push({ cut, limits })
    h.order.push(`gate:${cut}`)
    if (h.gateNullOnce.delete(cut)) return { score: null, costUsd: 0 }
    if (h.gateTruncatedOnce.delete(cut)) return { score: null, costUsd: 0, truncated: true }
    const fail = h.gateFailOnce.delete(cut)
    return {
      score: { has_artifact: fail, same_product: true, consistency: 0.95, artifact_reason: fail ? 'warped label' : '' },
      costUsd: 0,
    }
  }),
}))
vi.mock('@/lib/agents/registration/pdp-annotation-agent', () => ({ locateAnnotations: vi.fn() }))
vi.mock('@/lib/agents/image/generate', () => ({
  generateImage: vi.fn(async (args: { runContext: { stage: string }; referenceImages?: unknown[] }) => {
    const regen = args.runContext.stage.endsWith('/regenerate')
    const section = args.runContext.stage.replace(/^images\//, '').replace(/\/regenerate$/, '')
    const call = { section, regen, refs: args.referenceImages?.length ?? 0, start: Date.now() } as (typeof h.calls)[0]
    h.calls.push(call)
    h.order.push(`gen:${section}${regen ? '/regen' : ''}`)
    h.inflight++
    h.maxInflight = Math.max(h.maxInflight, h.inflight)
    if (h.hang.has(section)) await new Promise(() => {})
    await sleep(h.delayFor?.(section, regen) ?? h.delayMs)
    if (h.clock !== null) h.clock += h.genAdvanceMs
    h.inflight--
    call.end = Date.now()
    if (!regen && h.failOnce.delete(section)) throw new Error('OpenAI 이미지 생성 실패(503): busy')
    return { base64: 'aW1n', mimeType: 'image/png' }
  }),
}))
vi.mock('./storage', () => ({
  uploadPdpImage: vi.fn(
    async (_db: unknown, _u: string, jobId: string, section: string) => `https://cdn.test/${jobId}/${section}.png`
  ),
}))
vi.mock('@/lib/agents/budget', async (orig) => ({
  ...(await orig<typeof import('@/lib/agents/budget')>()),
  checkMonthlyBudget: vi.fn(async () => ({ allowed: true, spentUsd: 0, budgetUsd: h.budgetUsd })),
}))

import { estimateImageCostUsd } from '@/lib/agents/image/types'
import { GENERATION_WORST_MS, RUN_TIME_BUDGET_MS, runImagesStep } from './pdp-image-stage'
import { buildImageTasks } from './pdp-image-tasks'
import { fixtureToJob, loadEnrichmentFixture, rewindTo } from './__golden__/golden-harness'

/** images 단계에서 시작하는 잡(제품 컷·효과 전용 컷이 섞인 Pro 잡) — 장식·디자인 컷 기록 없음 */
function imagesJob(patch: Partial<PdpJobRow> = {}): PdpJobRow {
  const job = rewindTo(fixtureToJob(loadEnrichmentFixture('A-track-i')), 'images')
  return {
    ...job,
    image_model: 'gpt-image-2',
    image_quality: 'medium',
    current_step: 'images',
    analysis: { ...job.analysis, enrichment: { version: 1, features: ['vocab', 'persuasion'] } },
    section_plan: { ...job.section_plan, enrichment: { version: 1, features: ['vocab', 'persuasion'] } },
    ...patch,
  } as PdpJobRow
}

async function run(job: PdpJobRow, options: Parameters<typeof runImagesStep>[3] = {}) {
  h.job = job
  return runImagesStep({} as never, 'user-1', job, options)
}

const productCutsOf = (job: PdpJobRow) =>
  buildImageTasks(job)
    .filter((t) => t.section !== 'hero' && !t.effectOnly)
    .map((t) => t.section)

beforeEach(() => {
  h.calls = []
  h.inflight = 0
  h.maxInflight = 0
  h.delayMs = 30
  h.delayFor = null
  h.hang = new Set()
  h.failOnce = new Set()
  h.gateFailOnce = new Set()
  h.gateNullOnce = new Set()
  h.gateTruncatedOnce = new Set()
  h.gateCalls = []
  h.order = []
  h.fetchNullAt = null
  h.fetchCount = new Map()
  h.saves = []
  h.leases = []
  h.failNextUrlSave = false
  h.saveInflight = 0
  h.maxSaveInflight = 0
  h.budgetUsd = 1000
  h.clock = null
  h.genAdvanceMs = 0
})
afterEach(() => {
  vi.restoreAllMocks()
})

/** 손으로 움직이는 시계 — 생성 1회마다 advanceMs씩 흐른다 */
function manualClock(advanceMs: number) {
  h.clock = 1_000_000
  h.genAdvanceMs = advanceMs
  vi.spyOn(Date, 'now').mockImplementation(() => h.clock!)
}

describe('images 단계 동시 생성 — 상한·hero 선행', () => {
  it('hero가 먼저 끝나고 나서 제품 컷이 시작한다(효과 전용 컷은 함께), 동시 상한 4를 넘지 않고 실제로 겹친다', async () => {
    const job = imagesJob()
    const tasks = buildImageTasks(job)
    const out = await run(job)
    expect(h.calls[0].section).toBe('hero')
    const heroEnd = h.calls.find((c) => c.section === 'hero')!.end!
    const productCuts = productCutsOf(job)
    expect(productCuts.length).toBeGreaterThan(4)
    for (const c of h.calls.filter((c) => productCuts.includes(c.section)))
      expect(c.start).toBeGreaterThanOrEqual(heroEnd)
    expect(h.maxInflight).toBeLessThanOrEqual(4)
    expect(h.maxInflight).toBeGreaterThan(1)
    // 예산이 넉넉하면 한 run에 전부 — compose로 넘어간다
    expect(new Set(h.calls.map((c) => c.section))).toEqual(new Set(tasks.map((t) => t.section)))
    expect(out.current_step).toBe('compose')
  })

  it('hero 게이트 재생성까지 끝난 뒤에 제품 컷이 시작한다 — 바뀐 hero가 스타일 참조가 된다', async () => {
    const job = imagesJob()
    h.gateFailOnce = new Set(['hero'])
    // 효과 전용 컷이 hero 재생성 도중에 끝나게 — 그때 풀이 다시 고르더라도 제품 컷은 아직 시작하면 안 된다
    const effectOnly = new Set(
      buildImageTasks(job)
        .filter((t) => t.effectOnly)
        .map((t) => t.section)
    )
    h.delayFor = (section, regen) => (regen ? 120 : effectOnly.has(section) ? 60 : 30)
    await run(job)
    const heroRegen = h.calls.find((c) => c.section === 'hero' && c.regen)!
    expect(heroRegen).toBeDefined()
    const productCuts = productCutsOf(job)
    for (const c of h.calls.filter((c) => productCuts.includes(c.section)))
      expect(c.start).toBeGreaterThanOrEqual(heroRegen.end!)
  })

  it('hero가 첫 실패로 끝나면 이번 run은 제품 컷을 시작하지 않는다 — 다음 run에 hero를 다시 만든 뒤 스타일 참조와 함께', async () => {
    const job = imagesJob()
    h.failOnce = new Set(['hero'])
    const productCuts = productCutsOf(job)
    const first = await run(job)
    expect(first.section_images.find((e) => e.section === 'hero')).toMatchObject({ url: '', retryPending: true })
    expect(h.calls.filter((c) => productCuts.includes(c.section))).toHaveLength(0)
    // 효과 전용 컷은 hero를 쓰지 않으므로 그대로 진행한다
    expect(h.calls.some((c) => c.section !== 'hero')).toBe(true)
    expect(first.current_step).toBe('images')

    h.calls = []
    const second = await run(first)
    expect(second.section_images.find((e) => e.section === 'hero')!.url).toContain('/hero.png')
    const cuts = h.calls.filter((c) => productCuts.includes(c.section))
    expect(cuts).toHaveLength(productCuts.length)
    // 원본 참조 + hero 스타일 참조
    const sourceRefs = h.calls.find((c) => c.section === 'hero')!.refs
    for (const c of cuts) expect(c.refs).toBe(sourceRefs + 1)
  })

  it('hero 스타일 참조 받기가 한 번 실패해도 이 run의 뒤 컷은 다시 받는다(실패를 남겨 두지 않는다)', async () => {
    const job = imagesJob()
    // hero 받기 1번째 = hero 게이트, 2번째 = 첫 제품 컷의 스타일 참조(실패)
    h.fetchNullAt = { url: `https://cdn.test/${job.id}/hero.png`, n: 2 }
    await run(job, { concurrency: 1 })
    const sourceRefs = h.calls.find((c) => c.section === 'hero')!.refs
    const cuts = h.calls.filter((c) => productCutsOf(job).includes(c.section))
    expect(cuts.length).toBeGreaterThan(2)
    expect(cuts.filter((c) => c.refs === sourceRefs)).toHaveLength(1)
    expect(cuts.filter((c) => c.refs === sourceRefs + 1)).toHaveLength(cuts.length - 1)
  })

  it('로컬 백엔드(codex-image)는 동시 2 — 실행기의 동시 상한과 같다', async () => {
    await run(imagesJob({ image_model: 'codex-image' }))
    expect(h.maxInflight).toBeLessThanOrEqual(2)
    expect(h.maxInflight).toBe(2)
  })
})

describe('images 단계 동시 생성 — 저장', () => {
  it('저장은 한 번에 하나씩, 완료마다 그때의 최신 상태 — 앞 저장의 컷이 뒤 저장에서 사라지지 않는다', async () => {
    const job = imagesJob()
    await run(job)
    expect(h.maxSaveInflight).toBe(1)
    for (let i = 1; i < h.saves.length; i++) {
      for (const section of h.saves[i - 1]) expect(h.saves[i]).toContain(section)
    }
    expect(new Set(h.saves.at(-1))).toEqual(new Set(buildImageTasks(job).map((t) => t.section)))
  })

  it('새 항목은 끝난 순서가 아니라 일 순서로 쌓인다(드래프트 상세 이미지·이력 썸네일 순서)', async () => {
    const job = imagesJob()
    const out = await run(job)
    expect(out.section_images.map((e) => e.section)).toEqual(buildImageTasks(job).map((t) => t.section))
  })

  it('저장 하나가 실패해도 뒤 저장은 시도한다 — 비용이 나간 끝난 컷은 잡에 남고, run은 오류로 멈춘다', async () => {
    const job = imagesJob()
    h.failNextUrlSave = true
    await expect(run(job)).rejects.toThrow('일시 오류')
    const finished = h.calls.filter((c) => c.end !== undefined).map((c) => c.section)
    expect(finished.length).toBeGreaterThan(1)
    const saved = h.job!.section_images.filter((e) => e.url).map((e) => e.section)
    for (const section of finished) expect(saved).toContain(section)
    expect(h.job!.cost_usd).toBeGreaterThan(job.cost_usd)
  })

  it('저장이 실패한 뒤 이어 저장할 일이 없어도(동시 1) 멈출 때 한 번 더 저장해 끝난 컷을 남긴다', async () => {
    const job = imagesJob()
    h.failNextUrlSave = true
    await expect(run(job, { concurrency: 1 })).rejects.toThrow('일시 오류')
    expect(h.calls.map((c) => c.section)).toEqual(['hero'])
    expect(h.job!.section_images.find((e) => e.section === 'hero')!.url).toContain('/hero.png')
    expect(h.job!.cost_usd).toBeGreaterThan(job.cost_usd)
  })

  it('끝나지 않는 컷이 있어도(504 재현) 끝난 컷은 이미 잡에 저장돼 있다', async () => {
    const job = imagesJob()
    h.hang = new Set(['features:1'])
    void run(job)
    // 끝나지 않는 컷을 뺀 나머지가 모두 저장될 때까지 기다린다(run은 끝나지 않는다)
    const expected = buildImageTasks(job).filter((t) => t.section !== 'features:1').length
    for (let i = 0; i < 200 && (h.saves.at(-1)?.length ?? 0) < expected; i++) await sleep(10)
    expect(h.saves.at(-1)).toHaveLength(expected)
    expect(h.saves.at(-1)).toContain('hero')
    expect(h.saves.at(-1)).not.toContain('features:1')
    // 끝난 컷의 게이트·저장이 마저 끝나게 둔다 — 남은 저장이 다음 시험의 기록에 섞이지 않게
    await sleep(100)
  })

  it('잠금: 중간 저장은 모두 잠금 기한을 싣고, 마지막 저장만 기한 없이 잠금을 푼다', async () => {
    await run(imagesJob(), { leaseUntil: 'LEASE' })
    expect(h.leases.length).toBeGreaterThan(2)
    expect(h.leases.slice(0, -1)).toEqual(h.leases.slice(0, -1).map(() => 'LEASE'))
    expect(h.leases.at(-1)).toBeUndefined()
  })
})

describe('images 단계 동시 생성 — 예산', () => {
  it('시간 예산: 최악 소요가 들어갈 때만 새로 시작하고 진행 중인 컷만 끝낸다(나머지는 다음 run)', async () => {
    const job = imagesJob()
    h.delayMs = 60
    // 장당 최악 소요(제공자 상한 + 업로드) — 예산이 그보다 100ms 길면 처음 100ms 안에만 새 컷을 시작한다
    const out = await run(job, { budgetMs: GENERATION_WORST_MS + 100 })
    const tasks = buildImageTasks(job)
    expect(h.calls.length).toBeGreaterThan(1)
    expect(h.calls.length).toBeLessThan(tasks.length)
    for (const c of h.calls) expect(c.end).toBeDefined()
    expect(out.current_step).toBe('images')
    expect(out.section_images.filter((e) => e.url)).toHaveLength(h.calls.length)
  })

  it('지출 예약: 남은 월 한도만큼만 시작한다 — 동시 4건이 한꺼번에 예산 검사를 통과하지 않는다', async () => {
    const job = imagesJob()
    h.budgetUsd = estimateImageCostUsd('gpt-image-2', 'medium') * 3 + 0.0001
    const out = await run(job)
    // 시작한 컷의 단가 합이 한도 안 — 태스크마다 모델·품질이 다를 수 있다(저가 컷은 gpt-image-2 low, 제품 예약 경로와 같은 규칙)
    const costOf = new Map(
      buildImageTasks(job).map((t) => [
        t.section,
        estimateImageCostUsd(t.model ?? job.image_model, t.quality ?? job.image_quality),
      ])
    )
    const spent = h.calls.reduce((sum, c) => sum + costOf.get(c.section)!, 0)
    expect(h.calls.length).toBeGreaterThanOrEqual(2)
    expect(spent).toBeLessThanOrEqual(h.budgetUsd)
    expect(out.current_step).toBe('images')
  })

  it('월 한도가 일 하나의 단가보다 작으면 시작하지 않고 단계 오류로 알린다(조용히 멈추지 않는다)', async () => {
    h.budgetUsd = 0
    await expect(run(imagesJob())).rejects.toThrow('월 AI 예산 한도')
    expect(h.calls).toHaveLength(0)
  })
})

describe('images 단계 동시 생성 — 게이트 시간 상한', () => {
  it('남은 시간이 넉넉하면 게이트는 기본 상한(시도 상한·재시도를 바꾸지 않는다)', async () => {
    await run(imagesJob())
    expect(h.gateCalls.length).toBeGreaterThan(0)
    expect(h.gateCalls.every((g) => g.limits === undefined)).toBe(true)
  })

  it('빠듯하면 남은 시간에 맞춰 재시도 없이 한 번만, 그보다 적으면 이번 run에는 보지 않고 게이트 대기로 남긴다 — 다음 생성도 시작하지 않는다', async () => {
    // hero 생성에 165초 — 남은 115초는 기본 최악(약 208초)보다 짧고, 다음 생성의 최악 소요(135초)도 들어가지 않는다
    manualClock(165_000)
    await run(imagesJob(), { concurrency: 1 })
    expect(h.gateCalls).toEqual([{ cut: 'hero', limits: { timeoutMs: 60_000, maxRetries: 0 } }])
    expect(h.calls.map((c) => c.section)).toEqual(['hero'])

    // hero 생성에 210초 — 남은 70초에서 받기 25초를 빼고 채점 시도 상한 45초
    h.calls = []
    h.gateCalls = []
    manualClock(210_000)
    await run(imagesJob(), { concurrency: 1 })
    expect(h.gateCalls).toEqual([{ cut: 'hero', limits: { timeoutMs: 45_000, maxRetries: 0 } }])

    // hero 생성에 245초 — 남은 35초로는 받기 + 채점 1회도 어렵다(통과로 치지 않는다)
    h.calls = []
    h.gateCalls = []
    manualClock(245_000)
    const out = await run(imagesJob(), { concurrency: 1 })
    expect(h.gateCalls).toHaveLength(0)
    expect(out.section_images.find((e) => e.section === 'hero')).toMatchObject({
      url: expect.stringContaining('hero'),
      gatePending: true,
    })
    expect(RUN_TIME_BUDGET_MS).toBe(280_000)
  })
})

describe('images 단계 — 게이트 대기(시간이 모자라 판정하지 못한 게이트)', () => {
  /** 코덱스처럼 컷 1장에 260초 — 생성이 끝나면 남은 20초라 그 컷의 게이트는 이번 run에 못 본다 */
  const CODEX_CUT_MS = 260_000
  const heroOf = (job: PdpJobRow) => job.section_images.find((e) => e.section === 'hero')!
  const pendingOf = (job: PdpJobRow) => job.section_images.filter((e) => e.gatePending).map((e) => e.section)

  it('예산 부족 → 대기 → 다음 run 맨 앞 판정: 판정 전 hero로는 상품 컷을 시작하지 않고, 끝까지 돌면 모든 컷이 게이트를 한 번씩 거친다', async () => {
    manualClock(CODEX_CUT_MS)
    const job = imagesJob({ image_model: 'codex-image' })
    const first = await run(job, { concurrency: 1 })
    expect(h.order).toEqual(['gen:hero'])
    expect(heroOf(first)).toMatchObject({ gatePending: true })
    expect(heroOf(first).error).toBeUndefined()
    expect(first.current_step).toBe('images')

    // 다음 run — 새 생성보다 hero 게이트가 먼저, 판정하면 표지를 지운다. 이번 run에 만든 컷은 다시 대기로 남는다
    h.order = []
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const second = await run(first, { concurrency: 1 })
    expect(h.order[0]).toBe('gate:hero')
    expect(h.order[1]).toMatch(/^gen:/)
    expect(heroOf(second).gatePending).toBeUndefined()
    expect(warn.mock.calls.map((c) => String(c[0]))).toContain("[registration/pdp-image] 'hero' 대기 게이트 판정 — 통과")
    const madeInSecond = buildImageTasks(job).find((t) => t.section === h.order[1].slice('gen:'.length))!
    expect(pendingOf(second)).toEqual(madeInSecond.skipGate ? [] : [madeInSecond.section])

    // 끝까지 — run마다 앞 run의 대기 게이트부터 본다. 대기가 남은 동안은 compose로 넘어가지 않는다
    h.order = []
    h.gateCalls = []
    let current = second
    for (let i = 0; i < 60 && current.current_step === 'images'; i++) {
      const waiting = pendingOf(current)
      const before = h.order.length
      current = await run(current, { concurrency: 1 })
      if (waiting.length > 0) expect(h.order[before]).toBe(`gate:${waiting[0]}`)
      if (current.current_step !== 'images') expect(pendingOf(current)).toEqual([])
    }
    expect(current.current_step).toBe('compose')
    expect(pendingOf(current)).toEqual([])
    // hero 뒤의 게이트 있는 컷은 모두 정확히 한 번씩 판정됐다(hero는 둘째 run에서 판정)
    const gated = buildImageTasks(job).filter((t) => !t.skipGate && t.section !== 'hero')
    expect(gated.length).toBeGreaterThan(3)
    expect(h.gateCalls.map((g) => g.cut).sort()).toEqual(gated.map((t) => t.section).sort())
  })

  it('다음 run 판정이 미달이면 게이트 재생성 규칙 그대로 — 시간이 있으면 즉시 1회, 모자라면 재생성 대기로 이월', async () => {
    manualClock(CODEX_CUT_MS)
    const first = await run(imagesJob({ image_model: 'codex-image' }), { concurrency: 1 })
    expect(heroOf(first).gatePending).toBe(true)

    // 즉시 재생성: run 시작이라 재생성 최악 소요(135초)가 들어간다
    h.order = []
    h.gateFailOnce = new Set(['hero'])
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const regen = await run(first, { concurrency: 1 })
    expect(h.order.slice(0, 2)).toEqual(['gate:hero', 'gen:hero/regen'])
    expect(warn.mock.calls.map((c) => String(c[0])).filter((m) => m.includes('대기 게이트 판정'))).toEqual([
      expect.stringMatching(/^\[registration\/pdp-image\] 'hero' 대기 게이트 판정 — 미달\(.+\) — 재생성$/),
    ])
    expect(heroOf(regen)).toMatchObject({ retried: true, pendingRegen: false })
    expect(heroOf(regen).gatePending).toBeUndefined()
    expect(heroOf(regen).error).toBeUndefined()

    // 이월: 게이트(40초)는 들어가지만 재생성(135초)은 들어가지 않는 run — 재생성 대기로 남고 다음 run 맨 앞에서 다시 만든다
    h.order = []
    h.gateFailOnce = new Set(['hero'])
    const carried = await run(first, { concurrency: 1, budgetMs: 100_000 })
    expect(h.order).toEqual(['gate:hero'])
    expect(heroOf(carried)).toMatchObject({ pendingRegen: true, error: expect.stringContaining('게이트 미달 — 재생성 대기') })
    expect(heroOf(carried).gatePending).toBeUndefined()
    h.order = []
    const after = await run(carried, { concurrency: 1 })
    expect(h.order[0]).toBe('gen:hero/regen')
    expect(heroOf(after)).toMatchObject({ retried: true, pendingRegen: false })
  })

  it('시간 말고 다른 이유로 판정하지 못한 게이트(채점 실패)는 지금처럼 통과와 같은 처리 — 대기로 남기지 않는다', async () => {
    h.gateNullOnce = new Set(['hero'])
    const out = await run(imagesJob(), { concurrency: 1 })
    expect(h.order.slice(0, 2)).toEqual(['gen:hero', 'gate:hero'])
    expect(heroOf(out).gatePending).toBeUndefined()
    expect(out.current_step).toBe('compose')
    // 지금 배치 채점 실패는 컷 기록에 경고를 남기지 않는다(지금 그대로)
    expect(heroOf(out)).not.toHaveProperty('gateUnjudged')
  })

  it('새 배치 게이트가 끝까지 잘려 판정하지 못하면 통과로 치지 않고 컷에 경고를 남긴다 — 이미지는 두고 추가 재생성 없음(R03)', async () => {
    h.gateTruncatedOnce = new Set(['hero'])
    const out = await run(imagesJob(), { concurrency: 1 })
    expect(h.order.filter((o) => o.startsWith('gen:hero'))).toEqual(['gen:hero'])
    expect(heroOf(out)).toMatchObject({ gateUnjudged: '게이트 판정 못 함(응답 잘림·빈 답)' })
    expect(heroOf(out).url).toBeTruthy()
    expect(heroOf(out).gatePending).toBeUndefined()
    expect(out.current_step).toBe('compose')
  })
})
