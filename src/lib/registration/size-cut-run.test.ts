/**
 * 사이즈 단독 컷(sizecut) 계획·태스크·이미지 단계 — 스위치·D2 잡에서만 컷이 하나 늘고, 끄면 지금과 같은지, 만든 컷의 제품 경계가 기록되는지 본다.
 * 이미지 생성·Vision·DB는 모의(유료 호출 0). 경계는 sharp로 만든 그림으로 실제로 잰다.
 */

import sharp from 'sharp'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PdpJobRow } from './pdp-state'

const h = vi.hoisted(() => ({
  job: null as PdpJobRow | null,
  images: new Map<string, string>(),
  failSections: new Set<string>(),
  calls: [] as string[],
  gateCalls: [] as string[],
}))

// 월 예산은 넉넉하다고 둔다 — 시험 환경엔 DB가 없어 진짜 조회는 실패(degraded)하고, 이미지 지출 예약은 조회 실패면 닫힌다(점검 고침 5)
vi.mock('@/lib/agents/budget', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/agents/budget')>()),
  checkMonthlyBudget: vi.fn(async () => ({ allowed: true, spentUsd: 0, budgetUsd: 1000 })),
}))
vi.mock('./pdp-jobs', () => ({
  updatePdpJob: vi.fn(async (_db: unknown, _user: string, _id: string, patch: Record<string, unknown>) => {
    const job = { ...h.job! }
    if (patch.sectionPlan !== undefined) job.section_plan = patch.sectionPlan as PdpJobRow['section_plan']
    if (patch.sectionImages !== undefined) job.section_images = patch.sectionImages as PdpJobRow['section_images']
    if (patch.costUsd !== undefined) job.cost_usd = patch.costUsd as number
    if (patch.designPrompts !== undefined) job.design_prompts = patch.designPrompts as PdpJobRow['design_prompts']
    if (patch.currentStep !== undefined) job.current_step = patch.currentStep as PdpJobRow['current_step']
    if (patch.progress !== undefined) job.progress = patch.progress as number
    h.job = job
    return job
  }),
}))
vi.mock('@/lib/agents/registration/thumbnail-vision-agent', () => ({
  fetchImageAsBase64: vi.fn(async (url: string) => ({ mediaType: 'image/png', data: Buffer.from(url).toString('base64') })),
}))
vi.mock('@/lib/agents/registration/pdp-annotation-agent', () => ({
  locateAnnotations: vi.fn(async () => ({ rows: null, costUsd: 0 })),
}))
vi.mock('@/lib/agents/registration/pdp-image-agent', () => ({
  readIdentityCard: vi.fn(async () => ({ card: '', costUsd: 0 })),
  judgeImageGate: vi.fn(async (_ref: unknown, section: string) => {
    h.gateCalls.push(section)
    return { score: { cut: section, same_product: true, consistency: 0.9, has_artifact: false, artifact_reason: '', background_tone_hex: '#FFFFFF' }, costUsd: 0.01 }
  }),
}))
vi.mock('@/lib/agents/image/generate', () => ({
  generateImage: vi.fn(async (args: { prompt: string; runContext: { stage: string } }) => {
    const section = args.runContext.stage.replace('images/', '')
    h.calls.push(section)
    if (h.failSections.has(section)) throw new Error('생성 실패')
    return { base64: h.images.get(section) ?? 'AAAA', mimeType: 'image/png' }
  }),
}))
vi.mock('./storage', () => ({
  uploadPdpImage: vi.fn(async (_db: unknown, _u: string, _j: string, section: string) => `https://cdn.test/${section}.png`),
}))

import { runImagesStep } from './pdp-image-stage'
import { buildImageTasks } from './pdp-image-tasks'
import { buildDesigncutPlan } from './internalized/designcut-plan'
import { applyDesignSkeleton, resolveDesignSkeleton } from './pdp-enrichment-stage'
import { mergeManualStrategy } from './pdp-strategy-contract'
import { fixtureToJob, loadEnrichmentFixture } from './__golden__/golden-harness'
import { SIZE_SINGLE_SECTION } from './size-cut'

const BASE = ['vocab', 'persuasion', 'layouts', 'shots', 'annotations', 'mobile', 'options', 'designcut']
const D2 = [...BASE, 'designcut2']
const SIZE = '57mm×168mm'

function jobOf(features: string[], size: string | null = SIZE): PdpJobRow {
  const job = fixtureToJob(loadEnrichmentFixture('A-track-i'))
  job.analysis = { ...job.analysis, enrichment: { version: 1, features } } as PdpJobRow['analysis']
  job.spec_sheet = { ...job.spec_sheet, size: size ?? '', material: 'PE' }
  const strategy = mergeManualStrategy(job.analysis.recommended_strategy_contract ?? {}, job.spec_sheet, [])
  job.section_plan = applyDesignSkeleton(job.section_plan, resolveDesignSkeleton(job, strategy))
  return { ...job, final_html: null, current_step: 'images', progress: 80 }
}
const t6Of = (job: PdpJobRow) => buildDesigncutPlan(job)?.sections.find((s) => s.template === 'T6')
const sizeTasks = (job: PdpJobRow) => buildImageTasks(job).filter((t) => t.section === SIZE_SINGLE_SECTION)

describe('계획 — T6 이미지 키', () => {
  it('D2 + sizecut이면 size_single, 스위치가 없으면 빌린 컷', () => {
    expect(t6Of(jobOf([...D2, 'sizecut']))?.productImageKey).toBe(SIZE_SINGLE_SECTION)
    const off = t6Of(jobOf(D2))
    expect(off).toBeDefined()
    expect(off?.productImageKey).not.toBe(SIZE_SINGLE_SECTION)
  })

  it('sizecut은 방향을 모르는 치수에 축을 붙이지 않고 입력 글을 넘긴다 — 스위치가 없으면 지금처럼 첫 숫자를 가로로', () => {
    const raw = '고리 21.4cm, 펼침 37.3cm'
    const m4 = (features: string[]) => t6Of(jobOf(features, raw))?.modules.find((m) => m.type === 'M4')?.data as { dims: Array<{ axis: string; value: number }>; raw: string }
    expect(m4([...D2, 'sizecut'])).toMatchObject({ dims: [], raw })
    expect(m4(D2).dims.map((d) => [d.axis, d.value])).toEqual([['w', 21.4]])
  })

  it('치수 숫자가 아예 없으면 스위치와 상관없이 T6을 뺀다', () => {
    expect(t6Of(jobOf([...D2, 'sizecut'], '대용량 10개입'))).toBeUndefined()
  })

  it('D2가 아닌 디자인 컷 잡은 스위치가 있어도 그대로', () => {
    expect(t6Of(jobOf([...BASE, 'sizecut']))?.productImageKey).not.toBe(SIZE_SINGLE_SECTION)
  })
})

describe('태스크 — 컷 한 장', () => {
  it('D2 + sizecut이면 게이트를 거치는 3:4 컷 하나, 입력 치수가 프롬프트에 있다', () => {
    const tasks = sizeTasks(jobOf([...D2, 'sizecut']))
    expect(tasks).toHaveLength(1)
    expect(tasks[0]).toMatchObject({ aspectRatio: '3:4', effectOnly: false, skipGate: false })
    expect(tasks[0].prompt).toContain(SIZE)
    expect(tasks[0].prompt).toContain('Exactly ONE unit')
  })

  it('새 키는 size_single 하나다 — T6이 빌리던 컷만 빠질 수 있다', () => {
    const off = buildImageTasks(jobOf(D2)).map((t) => t.section)
    const on = buildImageTasks(jobOf([...D2, 'sizecut'])).map((t) => t.section)
    expect(on.filter((s) => !off.includes(s))).toEqual([SIZE_SINGLE_SECTION])
    expect(off.filter((s) => !on.includes(s)).length).toBeLessThanOrEqual(1)
  })

  it('스위치 없음·D2 아님·치수 없음이면 컷이 없다', () => {
    expect(sizeTasks(jobOf(D2))).toEqual([])
    expect(sizeTasks(jobOf([...BASE, 'sizecut']))).toEqual([])
    expect(sizeTasks(jobOf([...D2, 'sizecut'], null))).toEqual([])
  })
})

async function productPng(): Promise<string> {
  const product = await sharp({ create: { width: 200, height: 400, channels: 3, background: '#223344' } }).png().toBuffer()
  const png = await sharp({ create: { width: 512, height: 768, channels: 3, background: '#ffffff' } })
    .composite([{ input: product, left: 156, top: 184 }])
    .png()
    .toBuffer()
  return png.toString('base64')
}

describe('이미지 단계 — 제품 경계 기록', () => {
  let PNG = ''
  beforeAll(async () => {
    PNG = await productPng()
  })
  beforeEach(() => {
    h.images = new Map()
    h.failSections = new Set()
    h.calls = []
    h.gateCalls = []
  })
  const run = async (start: PdpJobRow, runs = 20) => {
    let job = { ...start, section_images: start.section_images.filter((s) => s.section !== SIZE_SINGLE_SECTION) }
    h.job = job
    for (let i = 0; i < runs && job.current_step === 'images'; i++) job = await runImagesStep({} as never, 'user-1', job, { concurrency: 1 })
    return job
  }
  const entryOf = (job: PdpJobRow) => job.section_images.find((s) => s.section === SIZE_SINGLE_SECTION)

  it('만든 컷을 재서 경계를 남기고, 게이트를 거치며, 잡은 compose로 간다', async () => {
    h.images.set(SIZE_SINGLE_SECTION, PNG)
    const job = await run(jobOf([...D2, 'sizecut']))
    const entry = entryOf(job)!
    expect(entry.url).toBe(`https://cdn.test/${SIZE_SINGLE_SECTION}.png`)
    expect(entry.productBox?.aspect).toBeCloseTo(0.667, 2)
    expect(entry.productBox?.width).toBeCloseTo(200 / 512, 1)
    expect(entry.productBox?.height).toBeCloseTo(400 / 768, 1)
    expect(h.gateCalls).toContain(SIZE_SINGLE_SECTION)
    expect(job.current_step).toBe('compose')
  })

  it('재지 못하면(디코딩 불가) 경계 칸 없이 컷은 남는다', async () => {
    const job = await run(jobOf([...D2, 'sizecut']))
    expect(entryOf(job)?.url).toBeTruthy()
    expect(entryOf(job)?.productBox).toBeUndefined()
    expect(job.current_step).toBe('compose')
  })

  it('컷 생성이 실패해도 잡은 compose로 간다(첫 화면 밖 컷) — 빈 항목에 경계가 없다', async () => {
    h.failSections.add(SIZE_SINGLE_SECTION)
    const job = await run(jobOf([...D2, 'sizecut']))
    expect(h.calls).toContain(SIZE_SINGLE_SECTION)
    expect(entryOf(job)?.url ?? '').toBe('')
    expect(entryOf(job)?.productBox).toBeUndefined()
    expect(job.current_step).toBe('compose')
  })

  it('스위치가 없으면 만들지 않는다', async () => {
    const job = await run(jobOf(D2))
    expect(h.calls).not.toContain(SIZE_SINGLE_SECTION)
    expect(entryOf(job)).toBeUndefined()
  })
})
