/**
 * images 단계 생성 참조 — 사진 없는 옵션 가드가 걸린 잡은 실물 사진이 있는 옵션의 사진만 참조로 붙인다(R3 ①).
 * R1 P02(d10ea762·e7c09e3b)는 상품 사진 1장이 데이지 옵션 사진과 같은 그림이었다 — 여기서는 사진 없는 체리가 찍힌 상품 사진이
 * 섞인 경우를 재현한다. 이미지 생성·Vision·DB·스토리지는 모의(유료 호출 0).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
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
  uploadPdpImage: vi.fn(async (_db: unknown, _u: string, jobId: string, section: string) => `https://cdn.test/${jobId}/${section}.png`),
}))

import { runImagesStep } from './pdp-image-stage'
import { fixtureToJob, loadEnrichmentFixture, rewindTo } from './__golden__/golden-harness'
import { FAIRNEX_OPTION_LABELS } from './options/__fixtures__/fairnex-option-labels'
import { parseOptionLabels, type OptionSpec } from './options/option-spec'

const PASS = { has_artifact: false, same_product: true, consistency: 0.95, artifact_reason: '' }
// 공개 URL → 그림 내용(같은 그림이면 같은 base64 — 업로드가 달라도 바이트가 같았다: P02 상품 사진 = 데이지 옵션 사진)
const PICTURES: Record<string, string> = {
  'https://cdn.test/src/daisy-upload.jpg': 'DAISY',
  'https://cdn.test/src/cherry-and-daisy.jpg': 'CHERRY_AND_DAISY',
  'https://cdn.test/opt/daisy.jpg': 'DAISY',
}

function p02Spec(): OptionSpec {
  const { spec } = parseOptionLabels(FAIRNEX_OPTION_LABELS.P02)
  return {
    ...spec,
    variants: spec.variants.map((v) => (v.label.includes('데이지') ? { ...v, sourceImage: 'https://cdn.test/opt/daisy.jpg' } : v)),
  }
}

function imagesJob(optionSpec: OptionSpec | null, sourceImages: string[]): PdpJobRow {
  const job = rewindTo(fixtureToJob(loadEnrichmentFixture('A-track-i')), 'images')
  const enrichment = { version: 1, features: ['vocab', 'persuasion', 'options'] }
  return {
    ...job,
    image_quality: 'medium',
    current_step: 'images',
    source_images: sourceImages,
    spec_sheet: { ...job.spec_sheet, ...(optionSpec ? { optionSpec } : {}) },
    analysis: { ...job.analysis, enrichment },
    design_prompts: { ...job.design_prompts, identity_card: undefined },
  } as PdpJobRow
}

async function run(job: PdpJobRow): Promise<void> {
  h.job = job
  await runImagesStep({} as never, 'user-1', job)
}

/** 제품 컷(참조를 붙인 생성)의 참조 그림 — 마지막 장이 hero 스타일 참조면 뺀다 */
const productRefs = () =>
  h.generate.mock.calls
    .map(([input]) => (input as { referenceImages?: { base64: string }[] }).referenceImages ?? [])
    .filter((refs) => refs.length > 0)
    .map((refs) => refs.map((r) => r.base64).filter((d) => d !== 'HERO'))

beforeEach(() => {
  h.generate.mockReset()
  h.identity.mockReset()
  h.gate.mockReset()
  h.fetchImage.mockReset()
  h.generate.mockResolvedValue({ base64: 'aW1n', mimeType: 'image/png', model: 'gpt-image-2' })
  h.identity.mockResolvedValue({ card: 'IDENTITY', costUsd: 0 })
  h.gate.mockResolvedValue({ score: PASS, costUsd: 0.001 })
  h.fetchImage.mockImplementation(async (url: string) =>
    PICTURES[url] ? { data: PICTURES[url], mediaType: 'image/jpeg' } : url.startsWith('https://cdn.test/') ? { data: 'HERO', mediaType: 'image/png' } : null
  )
})

describe('생성 참조 — 사진 없는 옵션 가드 잡은 사진 있는 옵션의 사진만(R3 ①)', () => {
  it('체리가 찍힌 상품 사진은 빼고 데이지 사진만 — 식별 카드·게이트도 데이지 사진을 본다', async () => {
    await run(imagesJob(p02Spec(), ['https://cdn.test/src/cherry-and-daisy.jpg', 'https://cdn.test/src/daisy-upload.jpg']))
    const refs = productRefs()
    expect(refs.length).toBeGreaterThan(0)
    for (const list of refs) expect(list).toEqual(['DAISY'])
    expect(h.identity.mock.calls[0][0]).toEqual({ data: 'DAISY', mediaType: 'image/jpeg' })
    for (const [first] of h.gate.mock.calls) expect(first).toEqual({ data: 'DAISY', mediaType: 'image/jpeg' })
  })

  it('상품 사진에 옵션 사진과 같은 그림이 없으면 옵션 사진을 참조로 붙인다', async () => {
    await run(imagesJob(p02Spec(), ['https://cdn.test/src/cherry-and-daisy.jpg']))
    for (const list of productRefs()) expect(list).toEqual(['DAISY'])
  })

  it('옵션 사진이 많아도 참조는 상품 사진 상한(6장)까지', async () => {
    const { spec } = parseOptionLabels(FAIRNEX_OPTION_LABELS.P01)
    // 생일답례-07만 사진 없음 → 가드. 나머지 11개 옵션은 서로 다른 사진
    const many = {
      ...spec,
      variants: spec.variants.map((v) => (v.label.endsWith('-07') ? v : { ...v, sourceImage: `https://cdn.test/opt/${encodeURIComponent(v.label)}.jpg` })),
    }
    h.fetchImage.mockImplementation(async (url: string) => ({ data: url.startsWith('https://cdn.test/opt/') ? url : 'HERO', mediaType: 'image/jpeg' }))
    await run(imagesJob(many, ['https://cdn.test/src/other.jpg']))
    const refs = productRefs()
    expect(refs.length).toBeGreaterThan(0)
    for (const list of refs) {
      expect(list).toHaveLength(6)
      for (const data of list) expect(data.startsWith('https://cdn.test/opt/')).toBe(true)
    }
  })

  it('옵션 기록이 없거나 모든 옵션에 사진이 있으면 상품 사진 그대로(기존과 같음)', async () => {
    const sources = ['https://cdn.test/src/cherry-and-daisy.jpg', 'https://cdn.test/src/daisy-upload.jpg']
    await run(imagesJob(null, sources))
    for (const list of productRefs()) expect(list).toEqual(['CHERRY_AND_DAISY', 'DAISY'])

    h.generate.mockClear()
    const allShot = { ...p02Spec(), variants: p02Spec().variants.map((v) => ({ ...v, sourceImage: 'https://cdn.test/opt/daisy.jpg' })) }
    await run(imagesJob(allShot, sources))
    for (const list of productRefs()) expect(list).toEqual(['CHERRY_AND_DAISY', 'DAISY'])
  })
})
