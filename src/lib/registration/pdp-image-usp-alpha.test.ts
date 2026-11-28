/**
 * images 단계 run 재생 — USP 아이콘 생성물만 투명 PNG로 바꿔 올리고, 다른 컷은 생성 결과(형식·바이트)를 그대로 올린다.
 * 픽스처 잡을 images 직전으로 되감아 runImagesStep을 끝까지 돌린다. 이미지 생성·Vision·DB·스토리지는 모의(유료 호출 0).
 */

import sharp from 'sharp'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PdpJobRow } from './pdp-state'

const h = vi.hoisted(() => ({
  job: null as PdpJobRow | null,
  generate: vi.fn(),
  uploads: [] as Array<{ section: string; base64: string; mimeType: string }>,
}))

// 월 예산은 넉넉하다고 둔다 — 시험 환경엔 DB가 없어 진짜 조회는 실패(degraded)하고, 이미지 지출 예약은 조회 실패면 닫힌다(점검 고침 5)
vi.mock('@/lib/agents/budget', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/agents/budget')>()),
  checkMonthlyBudget: vi.fn(async () => ({ allowed: true, spentUsd: 0, budgetUsd: 1000 })),
}))
vi.mock('./pdp-jobs', () => ({
  updatePdpJob: vi.fn(async (_db: unknown, _user: string, _id: string, patch: Record<string, unknown>) => {
    const job = h.job!
    if (patch.sectionImages !== undefined) job.section_images = patch.sectionImages as PdpJobRow['section_images']
    if (patch.costUsd !== undefined) job.cost_usd = patch.costUsd as number
    if (patch.designPrompts !== undefined) job.design_prompts = patch.designPrompts as PdpJobRow['design_prompts']
    if (patch.currentStep !== undefined) job.current_step = patch.currentStep as PdpJobRow['current_step']
    if (patch.progress !== undefined) job.progress = patch.progress as number
    if (patch.error !== undefined) job.error = patch.error as string | null
    h.job = { ...job }
    return h.job
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
vi.mock('@/lib/agents/image/generate', () => ({
  generateImage: (...args: unknown[]) => h.generate(...args),
}))
vi.mock('./storage', () => ({
  uploadPdpImage: vi.fn(async (_db: unknown, _u: string, jobId: string, section: string, base64: string, mimeType: string) => {
    h.uploads.push({ section, base64, mimeType })
    return `https://cdn.test/${jobId}/${section}`
  }),
}))

import { runImagesStep } from './pdp-image-stage'
import { fixtureToJob, loadEnrichmentFixture, rewindTo } from './__golden__/golden-harness'

/** 흰 배경 검정 라인아트 JPEG(모델이 실제로 내는 형식) */
async function lineArtJpeg(): Promise<string> {
  const size = 256
  const raw = Buffer.alloc(size * size * 3, 255)
  for (let y = 64; y < 192; y++) for (let x = 64; x < 192; x++) if (x < 76 || x >= 180 || y < 76 || y >= 180) raw.fill(0, (y * size + x) * 3, (y * size + x) * 3 + 3)
  return (await sharp(raw, { raw: { width: size, height: size, channels: 3 } }).jpeg({ quality: 95 }).toBuffer()).toString('base64')
}

async function runToEnd(): Promise<PdpJobRow> {
  let job: PdpJobRow = { ...rewindTo(fixtureToJob(loadEnrichmentFixture('A-track-s')), 'images'), image_quality: 'medium', current_step: 'images' }
  for (let i = 0; i < 40 && job.current_step === 'images'; i++) {
    h.job = job
    job = await runImagesStep({} as never, 'user-1', job)
  }
  return job
}

beforeEach(() => {
  h.uploads = []
  h.generate.mockReset()
  // 라이브러리 아이콘 선택을 끄고 모든 USP 아이콘을 생성 경로로 보낸다
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '')
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('USP 아이콘 투명화 배선', () => {
  it('usp_icons 생성물만 PNG(알파)로 올라가고, 다른 컷은 생성 결과 그대로 올라간다', async () => {
    // 다른 컷에도 변환 가능한 흰 배경 JPEG를 준다 — 배선이 모든 섹션을 변환하면 이 테스트가 실패한다
    const lineArt = await lineArtJpeg()
    h.generate.mockImplementation(async (input: { runContext?: { stage?: string } }) => ({
      base64: lineArt,
      mimeType: 'image/jpeg',
      model: input.runContext?.stage?.startsWith('images/usp_icons:') ? 'gemini-3.1-flash-image' : 'gpt-image-2',
    }))
    vi.spyOn(console, 'info').mockImplementation(() => {})

    const job = await runToEnd()
    expect(job.current_step).toBe('compose')

    const icons = h.uploads.filter((u) => u.section.startsWith('usp_icons:'))
    const others = h.uploads.filter((u) => !u.section.startsWith('usp_icons:'))
    expect(icons.length).toBeGreaterThan(0)
    expect(others.length).toBeGreaterThan(0)
    for (const u of icons) {
      expect(u.mimeType).toBe('image/png')
      const { data, info } = await sharp(Buffer.from(u.base64, 'base64')).raw().toBuffer({ resolveWithObject: true })
      expect(info.channels).toBe(4)
      expect(data[3]).toBe(0) // 모서리 = 배경 → 투명
    }
    for (const u of others) expect(u).toMatchObject({ base64: lineArt, mimeType: 'image/jpeg' })
  })

  it('변환할 수 없는 아이콘(디코딩 실패)은 원본 형식 그대로 올라가고 섹션은 실패하지 않는다', async () => {
    h.generate.mockResolvedValue({ base64: 'aW1n', mimeType: 'image/jpeg', model: 'gpt-image-2' })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const job = await runToEnd()

    const icons = h.uploads.filter((u) => u.section.startsWith('usp_icons:'))
    expect(icons.length).toBeGreaterThan(0)
    for (const u of icons) expect(u).toMatchObject({ base64: 'aW1n', mimeType: 'image/jpeg' })
    expect(job.section_images.filter((e) => e.section.startsWith('usp_icons:')).every((e) => e.url && !e.error)).toBe(true)
    expect(warn.mock.calls.some(([m]) => String(m).includes('[usp-icon-alpha]'))).toBe(true)
  })
})
