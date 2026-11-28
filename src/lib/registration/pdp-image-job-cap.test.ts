/**
 * images 단계 — 잡당 비용 상한·예산 조회 실패 때 멈춤(점검 고침 5, 통합 2026-11-07 Q1~Q3 · 하네스 R04 $10·첫 생성 전체).
 * 픽스처 잡을 images 직전으로 되감아 runImagesStep을 여러 run 돌린다. 이미지 생성·Vision·DB·스토리지·예산은 모의(유료 호출 0).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PdpJobRow } from './pdp-state'

const h = vi.hoisted(() => ({
  job: null as PdpJobRow | null,
  generate: vi.fn(),
  gate: vi.fn(),
  fetchImage: vi.fn(),
  budget: vi.fn(),
}))

vi.mock('@/lib/agents/budget', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/agents/budget')>()),
  checkMonthlyBudget: (...args: unknown[]) => h.budget(...args),
}))
vi.mock('./pdp-jobs', () => ({
  updatePdpJob: vi.fn(async (_db: unknown, _user: string, _id: string, patch: Record<string, unknown>) => {
    const job = h.job!
    if (patch.sectionImages !== undefined) job.section_images = patch.sectionImages as PdpJobRow['section_images']
    if (patch.costUsd !== undefined) job.cost_usd = patch.costUsd as number
    if (patch.designPrompts !== undefined) job.design_prompts = patch.designPrompts as PdpJobRow['design_prompts']
    if (patch.sectionPlan !== undefined) job.section_plan = patch.sectionPlan as PdpJobRow['section_plan']
    if (patch.currentStep !== undefined) job.current_step = patch.currentStep as PdpJobRow['current_step']
    if (patch.progress !== undefined) job.progress = patch.progress as number
    if (patch.error !== undefined) job.error = patch.error as string | null
    h.job = { ...job }
    return h.job
  }),
}))
vi.mock('@/lib/agents/registration/thumbnail-vision-agent', () => ({
  fetchImageAsBase64: (...args: unknown[]) => h.fetchImage(...args),
}))
vi.mock('@/lib/agents/registration/pdp-image-agent', () => ({
  readIdentityCard: vi.fn(async () => ({ card: 'IDENTITY', costUsd: 0 })),
  judgeImageGate: (...args: unknown[]) => h.gate(...args),
}))
vi.mock('@/lib/agents/registration/pdp-annotation-agent', () => ({ locateAnnotations: vi.fn() }))
vi.mock('@/lib/agents/image/generate', () => ({
  generateImage: (...args: unknown[]) => h.generate(...args),
}))
vi.mock('./storage', () => ({
  uploadPdpImage: vi.fn(async (_db: unknown, _u: string, jobId: string, section: string) => `https://cdn.test/${jobId}/${section}.png`),
}))

import { estimateImageCostUsd, type ImageModel } from '@/lib/agents/image/types'
import { cutFailureNotes } from './cut-failures'
import { DEFAULT_JOB_COST_CAP_USD, GATE_RESERVE_USD } from './job-cost-cap'
import { runImagesStep } from './pdp-image-stage'
import { fixtureToJob, loadEnrichmentFixture, rewindTo } from './__golden__/golden-harness'

const PASS = { has_artifact: false, same_product: true, consistency: 0.95, artifact_reason: '' }
const ENOUGH = { allowed: true, spentUsd: 0, budgetUsd: 1000 }

function imagesJob(costUsd: number): PdpJobRow {
  const job = rewindTo(fixtureToJob(loadEnrichmentFixture('A-track-s')), 'images')
  return { ...job, image_quality: 'medium', current_step: 'images', cost_usd: costUsd, final_html: null }
}

async function drive(job: PdpJobRow, runs = 40): Promise<PdpJobRow> {
  h.job = job
  let current = job
  for (let i = 0; i < runs && current.current_step === 'images'; i++) current = await runImagesStep({} as never, 'user-1', current)
  return current
}

const generatedSections = () => h.generate.mock.calls.map(([input]) => (input as { runContext?: { stage?: string } }).runContext?.stage ?? '')

beforeEach(() => {
  h.generate.mockReset().mockResolvedValue({ base64: 'aW1n', mimeType: 'image/png', model: 'gpt-image-2' })
  h.gate.mockReset().mockResolvedValue({ score: PASS, costUsd: 0.001 })
  h.fetchImage.mockReset().mockResolvedValue({ data: 'aW1n', mediaType: 'image/png' })
  h.budget.mockReset().mockResolvedValue(ENOUGH)
})
afterEach(() => {
  vi.restoreAllMocks()
})

describe('잡당 비용 상한(점검 고침 5) — 첫 생성만', () => {
  it('남은 몫이 2컷분이면 2컷만 만들고, 나머지는 잡 비용 상한 실패 컷으로 정리해 compose로 간다 — 대표 컷은 있다', async () => {
    const start = imagesJob(0)
    const unit = estimateImageCostUsd(start.image_model as ImageModel, 'medium') + GATE_RESERVE_USD
    // 2컷분 + 아주 조금 — 3컷째는 예약이 막힌다
    const job = await drive({ ...start, cost_usd: DEFAULT_JOB_COST_CAP_USD - unit * 2 - 0.0001 })
    expect(job.current_step).toBe('compose')
    const made = job.section_images.filter((e) => e.url)
    expect(made.length).toBe(2)
    expect(made.map((e) => e.section)).toContain('hero')
    expect(h.generate).toHaveBeenCalledTimes(2)
    const notes = cutFailureNotes(job.section_images, job.section_plan.cuts_failed)
    expect(notes.length).toBeGreaterThan(0)
    expect(notes.every((n) => n.reason === '잡 비용 상한으로 만들지 않음')).toBe(true)
    expect(job.section_plan.cuts_failed?.sections.sort()).toEqual(notes.map((n) => n.section).sort())
    // 이월 표지가 남지 않는다(다음 run이 같은 컷을 다시 고르지 않는다)
    expect(job.section_images.some((e) => e.retryPending || e.pendingRegen)).toBe(false)
    // 잡 기록 경고(section_plan.job_cost_cap) — 상한·그 run 시작 지출·정리한 컷
    const record = job.section_plan.job_cost_cap
    expect(record?.capUsd).toBe(DEFAULT_JOB_COST_CAP_USD)
    expect(record?.spentUsd).toBeLessThan(DEFAULT_JOB_COST_CAP_USD)
    expect(record?.sections.sort()).toEqual(notes.map((n) => n.section).sort())
  })

  it('대표 컷 전에 몫이 없으면 아무것도 만들지 않고 지금 규칙대로 잡을 failed로 끝낸다', async () => {
    const job = await drive(imagesJob(DEFAULT_JOB_COST_CAP_USD))
    expect(h.generate).not.toHaveBeenCalled()
    expect(job.current_step).toBe('failed')
    expect(job.error).toContain('첫 화면(hero)')
    expect(job.error).toContain('잡 비용 상한')
  })

  it('편집기 재생성 기록이 있는 잡(생성이 한 번 끝난 잡)은 상한을 보지 않는다 — 지출이 상한을 넘어도 컷을 만든다', async () => {
    const start = imagesJob(DEFAULT_JOB_COST_CAP_USD + 5)
    const edited = { section: 'hero', url: 'https://cdn.test/old-hero.png', editorRegen: { status: 'done' as const, requestedAt: '2026-11-08T00:00:00.000Z' } }
    const job = await drive({ ...start, final_html: '<html></html>', section_images: [edited] })
    expect(job.current_step).toBe('compose')
    expect(h.generate).toHaveBeenCalled()
    expect(job.section_images.every((e) => e.url)).toBe(true)
    expect(job.section_plan.job_cost_cap).toBeUndefined()
  })

  it('최종 HTML이 있어도 편집기 기록이 없으면 첫 생성이다(합성 뒤 단계 포함 범위) — 상한을 넘었으면 컷을 만들지 않는다', async () => {
    const job = await drive({ ...imagesJob(DEFAULT_JOB_COST_CAP_USD + 0.5), final_html: '<html></html>' })
    expect(h.generate).not.toHaveBeenCalled()
    expect(job.current_step).toBe('failed')
    expect(job.error).toContain('잡 비용 상한')
  })

  it('지금 운영 잡 비용(images 단계 시작 $1 안팎, 장당 $5~8)은 상한에 닿지 않는다 — 모든 컷을 만들고 경고 기록이 없다', async () => {
    const job = await drive(imagesJob(1))
    expect(job.current_step).toBe('compose')
    expect(job.section_plan.cuts_failed).toEqual({ count: 0, sections: [] })
    expect(job.section_plan.job_cost_cap).toBeUndefined()
  })
})

describe('예산 조회 실패(degraded) — 이미지를 시작하지 않고 멈춘다(점검 고침 5)', () => {
  it('조회 실패면 생성하지 않고 단계 실패로 알린다 — 실패 컷이 쌓여 대표 컷 실패로 잡이 죽지 않는다', async () => {
    h.budget.mockResolvedValue({ allowed: false, spentUsd: 0, budgetUsd: 50, degraded: true, degradedReason: 'db down' })
    const job = imagesJob(1)
    h.job = job
    await expect(runImagesStep({} as never, 'user-1', job)).rejects.toThrow('AI 예산 조회 실패')
    expect(h.generate).not.toHaveBeenCalled()
    expect(h.job!.section_images.some((e) => e.error)).toBe(false)
    expect(h.job!.current_step).toBe('images')
  })

  it('예산 모듈이 던져도 같다(닫힘)', async () => {
    h.budget.mockRejectedValue(new Error('boom'))
    const job = imagesJob(1)
    h.job = job
    await expect(runImagesStep({} as never, 'user-1', job)).rejects.toThrow('AI 예산 조회 실패')
    expect(h.generate).not.toHaveBeenCalled()
  })

  it('조회가 돌아오면 이어서 끝까지 만든다', async () => {
    h.budget.mockResolvedValueOnce({ allowed: false, spentUsd: 0, budgetUsd: 50, degraded: true })
    const job = imagesJob(1)
    h.job = job
    await expect(runImagesStep({} as never, 'user-1', job)).rejects.toThrow()
    const done = await drive(h.job!)
    expect(done.current_step).toBe('compose')
    expect(generatedSections()).toContain('images/hero')
  })
})
