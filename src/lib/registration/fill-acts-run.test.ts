/**
 * 채움 재설계(fillacts) run 재생 — runImagesStep을 돌려 첫 run의 컷 계획 기록 → 디자인 컷 계획 → 컷 생성까지 이어지는지 본다.
 * 이미지 생성·Vision·DB는 모의(유료 호출 0).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PdpJobRow } from './pdp-state'

const h = vi.hoisted(() => ({
  job: null as PdpJobRow | null,
  calls: [] as Array<{ prompt: string; section: string }>,
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
  judgeImageGate: vi.fn(async (_ref: unknown, section: string) => ({
    score: { cut: section, same_product: true, consistency: 0.9, has_artifact: false, artifact_reason: '', background_tone_hex: '#FFFFFF' },
    costUsd: 0.01,
  })),
}))
vi.mock('@/lib/agents/image/generate', () => ({
  generateImage: vi.fn(async (args: { prompt: string; runContext: { stage: string } }) => {
    h.calls.push({ prompt: args.prompt, section: args.runContext.stage.replace('images/', '') })
    return { base64: 'AAAA', mimeType: 'image/png' }
  }),
}))
vi.mock('./storage', () => ({
  uploadPdpImage: vi.fn(async (_db: unknown, _u: string, _j: string, section: string) => `https://cdn.test/${section}.png`),
}))

import { fixtureToJob, loadEnrichmentFixture } from './__golden__/golden-harness'
import { applyDesignSkeleton, resolveDesignSkeleton } from './pdp-enrichment-stage'
import { runImagesStep } from './pdp-image-stage'
import { mergeManualStrategy } from './pdp-strategy-contract'

const FEATURES = ['vocab', 'persuasion', 'layouts', 'shots', 'annotations', 'mobile', 'options', 'designcut', 'designcut2', 'shotdiv']

function jobOf(extra: string[]): PdpJobRow {
  const job = fixtureToJob(loadEnrichmentFixture('A-track-i'))
  job.analysis = { ...job.analysis, enrichment: { version: 1, features: [...FEATURES, ...extra] } } as PdpJobRow['analysis']
  const strategy = mergeManualStrategy(job.analysis.recommended_strategy_contract ?? {}, job.spec_sheet, [])
  job.section_plan = applyDesignSkeleton(job.section_plan, resolveDesignSkeleton(job, strategy))
  return { ...job, spec_sheet: { ...job.spec_sheet, material: 'PE' }, section_images: [], final_html: null, current_step: 'images', progress: 80 }
}
const run = async (start: PdpJobRow, runs = 20) => {
  let job = start
  h.job = job
  for (let i = 0; i < runs && job.current_step === 'images'; i++) job = await runImagesStep({} as never, 'user-1', job, { concurrency: 1 })
  return job
}

describe('fillacts run', () => {
  beforeEach(() => {
    h.calls = []
  })

  it('컷 계획을 기록하고, 막 2개와 POINT 사진을 그리는 컷을 전부 만들어 compose로 간다', async () => {
    const job = await run(jobOf(['fillacts']))
    const shots = job.section_plan.extra_shots!
    expect(shots.acts).toHaveLength(2)
    const plan = job.section_plan.designcut!
    expect(plan.sections.filter((s) => s.template === 'T10').map((s) => s.key)).toEqual(['long:shot:0', 'long:shot:1'])
    const made = new Set(job.section_images.filter((e) => e.url).map((e) => e.section))
    for (const shot of shots.shots) expect(made.has(shot.key), shot.key).toBe(true)
    expect(job.current_step).toBe('compose')
  })

  it('POINT 사진 프롬프트는 목적 블록과 그 항목의 주제 글을 싣고, 뒤에서 본 지시는 어디에도 없다', async () => {
    const job = await run(jobOf(['fillacts']))
    const extras = job.section_plan.extra_shots!.shots.filter((s) => s.point !== undefined)
    expect(extras.length).toBeGreaterThan(0)
    for (const shot of extras) {
      const prompt = h.calls.find((c) => c.section === shot.key)!.prompt
      expect(prompt, shot.key).toContain('[Shot purpose]')
      if (shot.show) expect(prompt, shot.key).toContain(shot.show)
    }
    expect(h.calls.some((c) => c.prompt.includes('from behind — the side the first-screen cut does not show'))).toBe(false)
  })

  it('스위치가 없으면 지금 채움 그대로 — 막 기록이 없고 POINT 사진 컷이 없다', async () => {
    const job = await run(jobOf([]))
    expect(job.section_plan.extra_shots!.acts).toBeUndefined()
    expect(job.section_plan.extra_shots!.shots.some((s) => s.point !== undefined)).toBe(false)
    expect(job.current_step).toBe('compose')
  })
})
