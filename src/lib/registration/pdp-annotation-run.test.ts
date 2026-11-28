/**
 * 강조 장식 하위 단계 run 재생(T4) — runImagesStep을 이미지가 다 있는 Track I 잡으로 돌려
 * allDone이 장식 완료를 포함하는지, 장식 run마다 정체 감지 서명(PdpProgress.tsx: 단계:장수:progress:cost)이
 * 바뀌는지, Vision은 run당 2콜 이하인지 확인한다. Vision·DB·이미지 생성은 모의(유료 호출 0).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PdpJobRow } from './pdp-state'

const h = vi.hoisted(() => {
  // 모의 생성 컷 — gpt-image-2가 3:4 요청으로 만드는 1024×1536 PNG 헤더(IHDR)만
  const png = Buffer.alloc(24)
  png.writeUInt32BE(0x89504e47, 0)
  png.writeUInt32BE(0x0d0a1a0a, 4)
  png.writeUInt32BE(13, 8)
  png.write('IHDR', 12, 'ascii')
  png.writeUInt32BE(1024, 16)
  png.writeUInt32BE(1536, 20)
  return { job: null as PdpJobRow | null, locate: vi.fn(), png: png.toString('base64') }
})

vi.mock('./pdp-jobs', () => ({
  updatePdpJob: vi.fn(async (_db: unknown, _user: string, _id: string, patch: Record<string, unknown>) => {
    const job = h.job!
    if (patch.sectionImages !== undefined) job.section_images = patch.sectionImages as PdpJobRow['section_images']
    if (patch.costUsd !== undefined) job.cost_usd = patch.costUsd as number
    if (patch.designPrompts !== undefined) job.design_prompts = patch.designPrompts as PdpJobRow['design_prompts']
    if (patch.currentStep !== undefined) job.current_step = patch.currentStep as PdpJobRow['current_step']
    if (patch.progress !== undefined) job.progress = patch.progress as number
    h.job = { ...job }
    return h.job
  }),
}))
vi.mock('@/lib/agents/registration/thumbnail-vision-agent', () => ({
  fetchImageAsBase64: vi.fn(async () => ({ mediaType: 'image/png', data: h.png })),
}))
vi.mock('@/lib/agents/registration/pdp-annotation-agent', () => ({
  locateAnnotations: (...args: unknown[]) => h.locate(...args),
}))
vi.mock('@/lib/agents/registration/pdp-image-agent', () => ({
  readIdentityCard: vi.fn(async () => ({ card: '', costUsd: 0 })),
  judgeImageGate: vi.fn(),
}))
vi.mock('@/lib/agents/image/generate', () => ({
  generateImage: vi.fn(async () => {
    throw new Error('이 재생에서는 이미지를 생성하지 않는다')
  }),
}))
vi.mock('./storage', () => ({ uploadPdpImage: vi.fn() }))

import { runImagesStep } from './pdp-image-stage'
import { updatePdpJob } from './pdp-jobs'
import { editorAnnotationsOf, selectAnnotationTargets } from './pdp-annotation-stage'
import { resolveStepToRun } from './pdp-pipeline'
import { fixtureToJob, loadEnrichmentFixture } from './__golden__/golden-harness'
import { DEFAULT_JOB_COST_CAP_USD } from './job-cost-cap'

const ALL = ['vocab', 'persuasion', 'layouts', 'shots', 'annotations', 'mobile']
const signature = (j: PdpJobRow) => `${j.current_step}:${j.section_images.length}:${j.progress}:${j.cost_usd}`

function imagesDoneJob(features: string[] | null = ALL): PdpJobRow {
  const job = fixtureToJob(loadEnrichmentFixture('A-track-i'))
  // 사용법(hidden_page)·크기 비교(compare_div) 컷이 화면에 나오는 계획
  const shown = [...(job.section_plan.activated_sections ?? []), 'hidden_page', 'compare_div']
  if (features)
    job.section_plan = {
      ...job.section_plan,
      activated_sections: shown,
      enrichment: { version: 1, features, vocabHash: null },
    }
  return { ...job, final_html: null, current_step: 'images', progress: 90, cost_usd: 1 }
}

/** PdpProgress.tsx drive 루프와 같은 종료 조건 — 서명이 같으면 멈춘다 */
async function drive(start: PdpJobRow, maxRuns = 10): Promise<{ job: PdpJobRow; signatures: string[] }> {
  h.job = start
  const signatures = [signature(start)]
  let job = start
  for (let i = 0; i < maxRuns && job.current_step === 'images'; i++) {
    job = await runImagesStep({} as never, 'user-1', job)
    if (signatures.includes(signature(job))) return { job, signatures: [...signatures, signature(job)] }
    signatures.push(signature(job))
  }
  return { job, signatures }
}

beforeEach(() => {
  h.locate.mockReset()
})

describe('장식 하위 단계 — runImagesStep 재생', () => {
  it('번호 배지는 첫 run에 전부, Vision은 run당 2콜 이하, 장식이 끝나야 compose로 넘어간다', async () => {
    const start = imagesDoneJob()
    const targets = selectAnnotationTargets(start)
    const vision = targets.filter((t) => t.mode === 'vision')
    // 첫 콜은 정상 응답, 둘째는 호출 실패, 나머지는 빈 응답
    let n = 0
    h.locate.mockImplementation(async (_img: unknown, labels: string[]) => {
      n++
      if (n === 1) return { rows: [{ kind: 'label', text: labels[0], x: 0.5, y: 0.5 }], costUsd: 0.004 }
      if (n === 2) return { rows: null, costUsd: 0 }
      return { rows: [], costUsd: 0.003 }
    })

    const first = await runImagesStep({} as never, 'user-1', ((h.job = start), start))
    expect(h.locate).toHaveBeenCalledTimes(Math.min(2, vision.length))
    const numbers = first.section_images.filter((e) => e.section.startsWith('howto:'))
    expect(numbers.every((e) => e.annotationStatus === 'done' && e.annotations?.[0]?.kind === 'number')).toBe(true)
    expect(first.current_step).toBe(vision.length > 2 ? 'images' : 'compose')

    const { job } = await drive(first)
    expect(job.current_step).toBe('compose')
    expect(job.progress).toBe(95)
    expect(h.locate).toHaveBeenCalledTimes(vision.length)
    const status = (s: string) => job.section_images.find((e) => e.section === s)?.annotationStatus
    expect(status(vision[0].section)).toBe('done')
    // 받은 이미지 헤더의 실제 비율(1024×1536)이 기록되고 편집기 전달에 쓰인다 — 비율 힌트(3:4)가 아니다
    const done = job.section_images.find((e) => e.section === vision[0].section)!
    expect(done.imageAspect).toBeCloseTo(1024 / 1536, 6)
    expect(editorAnnotationsOf(job)![done.url].aspect).toBeCloseTo(1024 / 1536, 6)
    expect(status(vision[1].section)).toBe('failed')
    for (const t of vision.slice(2)) expect(status(t.section)).toBe('skipped')
    // compose 뒤 재개 판정이 images로 되돌리지 않는다(왕복 없음)
    expect(resolveStepToRun(job)).toBe('compose')
  })

  it('장식 run마다 정체 감지 서명이 바뀐다 — 비용 0인 run(호출 실패·번호 배지)도 멈추지 않는다', async () => {
    h.locate.mockResolvedValue({ rows: null, costUsd: 0 })
    const { job, signatures } = await drive(imagesDoneJob())
    expect(job.current_step).toBe('compose')
    expect(new Set(signatures).size).toBe(signatures.length)
  })

  it('Track S·구 Track I 잡은 장식 단계에 들어가지 않는다(Vision 0콜, 바로 compose)', async () => {
    for (const start of [imagesDoneJob(null), { ...imagesDoneJob(), generation_track: 'standard' as const }]) {
      h.job = start
      const job = await runImagesStep({} as never, 'user-1', start)
      expect(job.current_step).toBe('compose')
      expect(job.section_images.some((e) => e.annotationStatus)).toBe(false)
    }
    expect(h.locate).not.toHaveBeenCalled()
  })
})

describe('장식 하위 단계 — 잡당 비용 상한(점검 고침 5·R04)', () => {
  const status = (job: PdpJobRow, s: string) => job.section_images.find((e) => e.section === s)?.annotationStatus

  it('첫 생성 잡 지출이 상한에 닿으면 Vision 장식을 부르지 않고 생략으로 기록해 compose로 넘어간다 — 왕복 없음', async () => {
    const start = { ...imagesDoneJob(), cost_usd: DEFAULT_JOB_COST_CAP_USD - 0.01 }
    const vision = selectAnnotationTargets(start).filter((t) => t.mode === 'vision')
    expect(vision.length).toBeGreaterThan(0)
    const { job } = await drive(start)
    expect(h.locate).not.toHaveBeenCalled()
    expect(job.current_step).toBe('compose')
    for (const t of vision) expect(status(job, t.section)).toBe('skipped')
    // 돈을 쓰지 않는 번호 배지는 그대로 붙는다
    expect(job.section_images.filter((e) => e.section.startsWith('howto:')).every((e) => e.annotationStatus === 'done')).toBe(true)
    expect(resolveStepToRun(job)).toBe('compose')
  })

  it('상한 아래면 지금처럼 Vision 장식을 한다', async () => {
    h.locate.mockResolvedValue({ rows: [], costUsd: 0.003 })
    const { job } = await drive({ ...imagesDoneJob(), cost_usd: DEFAULT_JOB_COST_CAP_USD - 1 })
    expect(h.locate).toHaveBeenCalled()
    expect(job.current_step).toBe('compose')
  })

  it('편집기 재생성 기록이 있는 잡은 상한을 보지 않는다', async () => {
    h.locate.mockResolvedValue({ rows: [], costUsd: 0.003 })
    const base = imagesDoneJob()
    const edited = base.section_images.map((e, i) => (i === 0 ? { ...e, editorRegen: { status: 'done' as const, requestedAt: '2026-11-08T00:00:00.000Z' } } : e))
    await drive({ ...base, section_images: edited, cost_usd: DEFAULT_JOB_COST_CAP_USD + 5 })
    expect(h.locate).toHaveBeenCalled()
  })
})

describe('장식 하위 단계 — 잡 진행 잠금', () => {
  it('장식 중간 저장(번호 배지·Vision 컷)도 잠금 기한을 싣고, run의 마지막 저장만 기한 없이 잠금을 푼다', async () => {
    h.locate.mockResolvedValue({ rows: [], costUsd: 0.003 })
    const start = imagesDoneJob()
    h.job = start
    vi.mocked(updatePdpJob).mockClear()
    await runImagesStep({} as never, 'user-1', start, { leaseUntil: 'LEASE' })
    const leases = vi.mocked(updatePdpJob).mock.calls.map(([, , , patch]) => patch.leaseUntil)
    expect(h.locate).toHaveBeenCalled()
    expect(leases.length).toBeGreaterThan(2)
    expect(leases.slice(0, -1)).toEqual(leases.slice(0, -1).map(() => 'LEASE'))
    expect(leases.at(-1)).toBeUndefined()
  })
})
