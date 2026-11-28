/**
 * images 단계 생성 참조 — 긴 변 500px 미만 상품 사진은 생성 전에 500으로 키워 붙인다(NEXFIT REFERENCE_MIN_LONG_SIDE).
 * 식별 카드·Vision 게이트도 같은 참조를 본다. 이미지 생성·Vision·DB·스토리지는 모의(유료 호출 0).
 */

import sharp from 'sharp'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PdpJobRow } from './pdp-state'

const h = vi.hoisted(() => ({
  job: null as PdpJobRow | null,
  generate: vi.fn(),
  identity: vi.fn(),
  gate: vi.fn(),
  fetchImage: vi.fn(),
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
    h.job = { ...job }
    return h.job
  }),
}))
vi.mock('@/lib/agents/registration/thumbnail-vision-agent', () => ({
  fetchImageAsBase64: (...args: unknown[]) => h.fetchImage(...args),
}))
vi.mock('@/lib/agents/registration/pdp-image-agent', () => ({
  readIdentityCard: (...args: unknown[]) => h.identity(...args),
  judgeImageGate: (...args: unknown[]) => h.gate(...args),
}))
vi.mock('@/lib/agents/registration/pdp-annotation-agent', () => ({ locateAnnotations: vi.fn() }))
vi.mock('@/lib/agents/image/generate', () => ({
  generateImage: (...args: unknown[]) => h.generate(...args),
}))
vi.mock('./storage', () => ({
  uploadPdpImage: vi.fn(
    async (_db: unknown, _u: string, jobId: string, section: string) => `https://cdn.test/${jobId}/${section}.png`
  ),
}))

import { runImagesStep } from './pdp-image-stage'
import { fixtureToJob, loadEnrichmentFixture, rewindTo } from './__golden__/golden-harness'
import { FAIRNEX_OPTION_LABELS } from './options/__fixtures__/fairnex-option-labels'
import { parseOptionLabels, type OptionSpec } from './options/option-spec'

const PASS = { has_artifact: false, same_product: true, consistency: 0.95, artifact_reason: '' }
const SMALL_URL = 'https://cdn.test/src/thumb-222.png'
const LARGE_URL = 'https://cdn.test/src/original-800.jpg'
const CHERRY_URL = 'https://cdn.test/src/cherry-and-daisy.png'
const DAISY_UPLOAD_URL = 'https://cdn.test/src/daisy-upload.png'
const DAISY_OPTION_URL = 'https://cdn.test/opt/daisy.png'
const pictures: Record<string, { data: string; mediaType: string }> = {}

async function picture(width: number, height: number, format: 'png' | 'jpeg', r = 200): Promise<string> {
  const img = sharp({ create: { width, height, channels: 3, background: { r, g: 120, b: 40 } } })
  return (await img.toFormat(format).toBuffer()).toString('base64')
}

async function sizeOf(base64: string) {
  const meta = await sharp(Buffer.from(base64, 'base64')).metadata()
  return { width: meta.width, height: meta.height }
}

function imagesJob(sourceImages: string[], optionSpec?: OptionSpec): PdpJobRow {
  const job = rewindTo(fixtureToJob(loadEnrichmentFixture('A-track-i')), 'images')
  return {
    ...job,
    image_quality: 'medium',
    current_step: 'images',
    source_images: sourceImages,
    ...(optionSpec
      ? {
          spec_sheet: { ...job.spec_sheet, optionSpec },
          analysis: { ...job.analysis, enrichment: { version: 1, features: ['vocab', 'persuasion', 'options'] } },
        }
      : {}),
    design_prompts: { ...job.design_prompts, identity_card: undefined },
  } as PdpJobRow
}

/** P02 옵션 — 데이지에만 실물 사진(사진 없는 옵션 가드가 걸린다, pdp-image-option-refs.test.ts와 같은 구성) */
function p02Spec(): OptionSpec {
  const { spec } = parseOptionLabels(FAIRNEX_OPTION_LABELS.P02)
  return {
    ...spec,
    variants: spec.variants.map((v) => (v.label.includes('데이지') ? { ...v, sourceImage: DAISY_OPTION_URL } : v)),
  }
}

/** 제품 컷(참조를 붙인 생성)의 참조 — 마지막 장이 hero 스타일 참조면 뺀다 */
const productRefs = () =>
  h.generate.mock.calls
    .map(([input]) => (input as { referenceImages?: { base64: string; mimeType: string }[] }).referenceImages ?? [])
    .filter((refs) => refs.length > 0)
    .map((refs) => refs.filter((r) => r.base64 !== 'HERO'))

beforeAll(async () => {
  pictures[SMALL_URL] = { data: await picture(222, 148, 'png'), mediaType: 'image/png' }
  pictures[LARGE_URL] = { data: await picture(800, 600, 'jpeg'), mediaType: 'image/jpeg' }
  // 같은 그림 = 같은 바이트(P02 상품 사진 = 데이지 옵션 사진). 체리가 찍힌 사진은 다른 그림
  const daisy = await picture(240, 320, 'png', 90)
  pictures[CHERRY_URL] = { data: await picture(240, 320, 'png', 230), mediaType: 'image/png' }
  pictures[DAISY_UPLOAD_URL] = { data: daisy, mediaType: 'image/png' }
  pictures[DAISY_OPTION_URL] = { data: daisy, mediaType: 'image/png' }
})

beforeEach(() => {
  h.generate.mockReset()
  h.identity.mockReset()
  h.gate.mockReset()
  h.fetchImage.mockReset()
  h.generate.mockResolvedValue({ base64: 'aW1n', mimeType: 'image/png', model: 'gpt-image-2' })
  h.identity.mockResolvedValue({ card: 'IDENTITY', costUsd: 0 })
  h.gate.mockResolvedValue({ score: PASS, costUsd: 0.001 })
  h.fetchImage.mockImplementation(async (url: string) =>
    pictures[url]
      ? { ...pictures[url] }
      : url.startsWith('https://cdn.test/')
        ? { data: 'HERO', mediaType: 'image/png' }
        : null
  )
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

describe('생성 참조 — 저해상도 상품 사진은 생성 전에 긴 변 500으로', () => {
  it('222×148 참조 → 500×333으로 붙이고, 식별 카드·게이트도 키운 참조를 본다 / 800×600 참조는 바이트 그대로', async () => {
    h.job = imagesJob([SMALL_URL, LARGE_URL])
    await runImagesStep({} as never, 'user-1', h.job)

    const refs = productRefs()
    expect(refs.length).toBeGreaterThan(0)
    const [small, large] = refs[0]
    expect(small.mimeType).toBe('image/png')
    expect(await sizeOf(small.base64)).toEqual({ width: 500, height: 333 })
    expect(large).toEqual({ base64: pictures[LARGE_URL].data, mimeType: 'image/jpeg' })
    for (const list of refs) expect(list).toEqual(refs[0])

    expect(h.identity.mock.calls[0][0]).toEqual({ data: small.base64, mediaType: 'image/png' })
    expect(h.gate.mock.calls.length).toBeGreaterThan(0)
    for (const [first] of h.gate.mock.calls) expect(first).toEqual({ data: small.base64, mediaType: 'image/png' })
  })

  it('옵션 가드 잡: 저해상도 상품 사진과 옵션 사진이 같은 그림이면 키운 뒤에도 같은 그림으로 판정돼 1장만 붙는다', async () => {
    h.job = imagesJob([CHERRY_URL, DAISY_UPLOAD_URL], p02Spec())
    await runImagesStep({} as never, 'user-1', h.job)

    const refs = productRefs()
    expect(refs.length).toBeGreaterThan(0)
    const [daisy] = refs[0]
    expect(refs[0]).toHaveLength(1)
    expect(await sizeOf(daisy.base64)).toEqual({ width: 375, height: 500 })
    for (const list of refs) expect(list).toEqual([daisy])
  })
})
