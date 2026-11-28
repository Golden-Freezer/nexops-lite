/**
 * images 단계 — MS 2k(힉스필드, R05) 이어 받기. run 기한 안에 받지 못한 컷은 요청을 남겨(imagePending + retryPending) 다음 run이
 * 다시 제출하지 않고 이어 받는다. 지금 배치(2.6) 잡의 호출 인자는 그대로다. 이미지 생성·Vision·DB·스토리지·예산은 모의(유료 호출 0).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PdpJobRow } from './pdp-state'

const h = vi.hoisted(() => ({
  job: null as PdpJobRow | null,
  generate: vi.fn(),
  gate: vi.fn(),
  fetchImage: vi.fn(),
  budget: vi.fn(),
  upload: vi.fn(),
  /** 저장 상한(R08a) — 시험이 작게 바꿀 수 있다(기본은 실제 상한) */
  uploadMax: 5_000_000,
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
  uploadPdpImage: (...args: unknown[]) => h.upload(...args),
}))
vi.mock('./pdp-upload-fit', async (importOriginal) => {
  const real = await importOriginal<typeof import('./pdp-upload-fit')>()
  return { ...real, fitPdpUpload: (image: { base64: string; mimeType: string }) => real.fitPdpUpload(image, h.uploadMax) }
})

import sharp from 'sharp'
import {
  ImageContentRejectedError,
  ImagePendingError,
  ImageProviderBalanceError,
  type GenImageInput,
  type ImagePendingRequest,
} from '@/lib/agents/image/types'
import { runImagesStep } from './pdp-image-stage'
import { isSectionSettled, PDP_PROVIDER_BALANCE_STEP_ERROR, providerBalanceHaltOf } from './pdp-image-tasks'
import { fixtureToJob, loadEnrichmentFixture, rewindTo } from './__golden__/golden-harness'

const PASS = { has_artifact: false, same_product: true, consistency: 0.95, artifact_reason: '' }
const ENOUGH = { allowed: true, spentUsd: 0, budgetUsd: 1000 }
const MS = 'higgsfield-ms-2k'
const pendingOf = (section: string): ImagePendingRequest => ({
  provider: 'higgsfield',
  model: MS,
  requestId: `req-${section}`,
  statusUrl: `https://api.higgsfield.ai/requests/req-${section}/status`,
  submittedAt: new Date().toISOString(),
})

function imagesJob(model: PdpJobRow['image_model']): PdpJobRow {
  const job = rewindTo(fixtureToJob(loadEnrichmentFixture('A-track-s')), 'images')
  return { ...job, image_model: model, image_quality: 'high', current_step: 'images', cost_usd: 1, final_html: null }
}
const calls = () => h.generate.mock.calls.map(([input]) => input as GenImageInput)
const callsFor = (section: string) => calls().filter((c) => c.runContext?.stage === `images/${section}`)

beforeEach(() => {
  h.generate.mockReset().mockImplementation(async (input: GenImageInput) => ({ base64: 'aW1n', mimeType: 'image/png', model: input.model, costUsd: 0.11 }))
  h.gate.mockReset().mockResolvedValue({ score: PASS, costUsd: 0.001 })
  h.fetchImage.mockReset().mockResolvedValue({ data: 'aW1n', mediaType: 'image/png' })
  h.budget.mockReset().mockResolvedValue(ENOUGH)
  h.upload.mockReset().mockImplementation(async (_db: unknown, _u: string, jobId: string, section: string) => `https://cdn.test/${jobId}/${section}.png`)
  h.uploadMax = 5_000_000
})
afterEach(() => {
  vi.restoreAllMocks()
})

describe('MS 2k 이어 받기(R05)', () => {
  it('hero가 기한 안에 안 끝나면 요청을 남기고, 다음 run이 다시 제출하지 않고 이어 받는다 — 비용은 받을 때 한 번', async () => {
    const start = imagesJob(MS)
    let first = true
    h.generate.mockImplementation(async (input: GenImageInput) => {
      if (input.runContext?.stage === 'images/hero' && first) {
        first = false
        throw new ImagePendingError(pendingOf('hero'))
      }
      return { base64: 'aW1n', mimeType: 'image/png', model: input.model, costUsd: 0.11 }
    })
    h.job = start
    const run1 = await runImagesStep({} as never, 'user-1', start)
    const hero1 = run1.section_images.find((e) => e.section === 'hero')!
    expect(hero1).toMatchObject({ url: '', retryPending: true, imagePending: { requestId: 'req-hero', model: MS } })
    expect(hero1.error).toContain('다음 run에서 이어 받음')
    // 비동기 공급자에만 기한을 넘긴다. 첫 제출은 resume이 없다
    expect(callsFor('hero')[0].deadlineAt).toEqual(expect.any(Number))
    expect(callsFor('hero')[0].resume).toBeUndefined()
    // 받지 못한 hero는 비용을 더하지 않는다(받을 때 한 번) — 같은 run에 함께 시작한 효과 전용 컷·게이트 비용만 쌓인다
    const others = calls().filter((c) => c.runContext?.stage !== 'images/hero').length
    expect(run1.cost_usd).toBeCloseTo(start.cost_usd + others * 0.11 + h.gate.mock.calls.length * 0.001, 6)
    expect(run1.current_step).toBe('images')

    const run2 = await runImagesStep({} as never, 'user-1', run1)
    const heroCalls = callsFor('hero')
    expect(heroCalls).toHaveLength(2)
    expect(heroCalls[1].resume).toEqual(hero1.imagePending)
    const hero2 = run2.section_images.find((e) => e.section === 'hero')!
    expect(hero2.url).toContain('/hero.png')
    expect(hero2.imagePending).toBeUndefined()
    expect(hero2.retryPending).toBeFalsy()
  })

  it('이어 받는 run에서도 안 끝나면 계속 이어 받는다(요청은 하나)', async () => {
    const start = imagesJob(MS)
    let heroTries = 0
    h.generate.mockImplementation(async (input: GenImageInput) => {
      if (input.runContext?.stage === 'images/hero' && heroTries++ < 2) throw new ImagePendingError(input.resume ?? pendingOf('hero'))
      return { base64: 'aW1n', mimeType: 'image/png', model: input.model, costUsd: 0.11 }
    })
    h.job = start
    const run1 = await runImagesStep({} as never, 'user-1', start)
    const run2 = await runImagesStep({} as never, 'user-1', run1)
    expect(run2.section_images.find((e) => e.section === 'hero')).toMatchObject({ retryPending: true, imagePending: { requestId: 'req-hero' } })
    const run3 = await runImagesStep({} as never, 'user-1', run2)
    expect(run3.section_images.find((e) => e.section === 'hero')?.url).toContain('/hero.png')
    expect(callsFor('hero').slice(1).every((c) => c.resume?.requestId === 'req-hero')).toBe(true)
  })

  it('덜어 낸 지시는 실제로 보낸 글(sentPrompt)과 덜어 낸 블록 머리(promptFit)로 남는다', async () => {
    h.generate.mockImplementation(async (input: GenImageInput) => ({
      base64: 'aW1n',
      mimeType: 'image/png',
      model: input.model,
      costUsd: 0.11,
      sentPrompt: 'FITTED',
      promptFit: { dropped: ['GLOBAL STYLE CHARTER'], originalLength: 12000 },
    }))
    const start = imagesJob(MS)
    h.job = start
    const run = await runImagesStep({} as never, 'user-1', start)
    const hero = run.section_images.find((e) => e.section === 'hero')!
    expect(hero.sentPrompt).toBe('FITTED')
    expect(hero.sentPromptMeta?.length).toBe('FITTED'.length)
    // 2단 맞추기(R07b)가 먼저 덜고(원래 길이는 맞추기 전 글), 공급자가 더 덜어 낸 머리는 그 뒤에 잇는다
    const sent = callsFor('hero')[0].prompt
    expect(hero.promptFit?.dropped.at(-1)).toBe('GLOBAL STYLE CHARTER')
    expect(hero.promptFit!.originalLength).toBeGreaterThan(sent.length)
  })

  it('MS 잡은 모든 컷 지시를 상한 5000자 안으로 보내고, 맞추기 전 길이·덜어 낸 머리를 컷 기록에 남긴다(R07b)', async () => {
    const start = imagesJob(MS)
    h.job = start
    const run = await runImagesStep({} as never, 'user-1', start)
    const ms = calls().filter((c) => c.model === MS)
    expect(ms.length).toBeGreaterThan(0)
    for (const c of ms) expect(c.prompt.length, c.runContext?.stage).toBeLessThanOrEqual(5000)
    const fitted = run.section_images.filter((e) => e.promptFit)
    expect(fitted.length).toBeGreaterThan(0)
    for (const e of fitted) {
      expect(e.promptFit!.originalLength).toBeGreaterThan(5000)
      expect(e.promptFit!.dropped.length + (e.promptFit!.compacted?.length ?? 0)).toBeGreaterThan(0)
      expect(e.sentPrompt!.length).toBeLessThanOrEqual(5000)
    }
  })

  it('지금 배치(2.6) 잡은 호출 인자에 기한·이어 받기가 없고, 지시를 맞추지 않는다(덜어 낸 기록 없음)', async () => {
    const start = imagesJob('gpt-image-2.6-sunburst')
    h.job = start
    const run = await runImagesStep({} as never, 'user-1', start)
    expect(calls().length).toBeGreaterThan(0)
    for (const c of calls()) {
      expect(c).not.toHaveProperty('deadlineAt')
      expect(c).not.toHaveProperty('resume')
    }
    // 2.6 지시는 5000자를 넘어도 그대로 간다(헌장 블록이 남는다)
    expect(calls().some((c) => c.prompt.length > 5000 && c.prompt.includes('GLOBAL STYLE CHARTER'))).toBe(true)
    expect(run.section_images.some((e) => e.promptFit)).toBe(false)
  })
})

describe('MS 2k 받은 뒤 저장 실패·저장 상한(R08a)', () => {
  /** MS 공급자처럼 받은 요청을 돌려준다 — 이미 받은 요청(billed)을 다시 받으면 비용 0(generate.ts가 기록하지 않는다) */
  const msResult = (input: GenImageInput, base64 = 'aW1n') => ({
    base64,
    mimeType: 'image/png',
    model: input.model,
    costUsd: input.resume?.billed ? 0 : 0.11,
    ...(input.model === MS
      ? { asyncRequest: input.resume ?? { ...pendingOf(String(input.runContext?.stage).replace('images/', '')) } }
      : {}),
  })

  it('받은 뒤 올리기에서 실패하면 받은 요청을 남기고, 다음 run은 다시 제출하지 않고 받기만 한다 — 비용은 한 번(재제출 422·중복 과금 없음)', async () => {
    h.generate.mockImplementation(async (input: GenImageInput) => msResult(input))
    let heroUploads = 0
    h.upload.mockImplementation(async (_db: unknown, _u: string, jobId: string, section: string) => {
      if (section === 'hero' && heroUploads++ === 0) throw new Error('PDP 이미지 업로드 실패(hero): The object exceeded the maximum allowed size')
      return `https://cdn.test/${jobId}/${section}.png`
    })
    const start = imagesJob(MS)
    h.job = start
    const run1 = await runImagesStep({} as never, 'user-1', start)
    const hero1 = run1.section_images.find((e) => e.section === 'hero')!
    expect(hero1).toMatchObject({ url: '', retryPending: true, imagePending: { requestId: 'req-hero', model: MS, billed: true } })
    expect(hero1.error).toContain('받은 뒤 저장 실패')
    expect(hero1.error).toContain('exceeded the maximum allowed size')
    // 받은 hero 비용(0.11)은 이번 run에 센다 — 이번 run의 모든 생성 호출이 0.11씩
    const run1Calls = calls().length
    const run1Gates = h.gate.mock.calls.length
    expect(run1.cost_usd).toBeCloseTo(start.cost_usd + run1Calls * 0.11 + run1Gates * 0.001, 6)

    const run2 = await runImagesStep({} as never, 'user-1', run1)
    const heroCalls = callsFor('hero')
    expect(heroCalls).toHaveLength(2)
    // 다시 제출하지 않고 같은 요청을 받기만 한다(billed 그대로 — 사용량·비용을 다시 적지 않는다)
    expect(heroCalls[1].resume).toEqual(hero1.imagePending)
    const hero2 = run2.section_images.find((e) => e.section === 'hero')!
    expect(hero2.url).toContain('/hero.png')
    expect(hero2.imagePending).toBeUndefined()
    expect(hero2.retryPending).toBeFalsy()
    expect(hero2.error).toBeUndefined()
    // run2 비용 = hero(0) + 새로 만든 컷들 — hero는 두 번 세지 않는다
    const run2New = calls().slice(run1Calls).filter((c) => !c.resume).length
    expect(run2.cost_usd).toBeCloseTo(run1.cost_usd + run2New * 0.11 + (h.gate.mock.calls.length - run1Gates) * 0.001, 6)
  })

  it('받은 요청을 다시 받는 run에서도 저장에 실패하면, 이어 받을 시간이 지나 공급자가 거절할 때 끝난 실패가 된다', async () => {
    h.generate.mockImplementation(async (input: GenImageInput) => {
      if (input.runContext?.stage === 'images/hero' && input.resume) throw new Error('힉스필드 요청 req-hero이 10분 안에 끝나지 않아 이어 받지 않음')
      return msResult(input)
    })
    h.upload.mockImplementation(async (_db: unknown, _u: string, jobId: string, section: string) => {
      if (section === 'hero') throw new Error('PDP 이미지 업로드 실패(hero): The object exceeded the maximum allowed size')
      return `https://cdn.test/${jobId}/${section}.png`
    })
    const start = imagesJob(MS)
    h.job = start
    const run1 = await runImagesStep({} as never, 'user-1', start)
    expect(run1.section_images.find((e) => e.section === 'hero')).toMatchObject({ retryPending: true, imagePending: { billed: true } })
    const run2 = await runImagesStep({} as never, 'user-1', run1)
    const hero2 = run2.section_images.find((e) => e.section === 'hero')!
    expect(hero2.error).toContain('이어 받지 않음')
    expect(hero2.retryPending).toBeFalsy()
    expect(hero2.imagePending).toBeUndefined()
  })

  it('MS 컷이 저장 상한을 넘으면 WebP로 바꿔 올리고 원래 바이트·형식·품질을 남긴다 — 지금 배치(2.6)는 같은 크기여도 받은 바이트 그대로', async () => {
    const png = await sharp({ create: { width: 96, height: 96, channels: 3, background: { r: 0, g: 0, b: 0 }, noise: { type: 'gaussian', mean: 128, sigma: 40 } } })
      .png({ compressionLevel: 0 })
      .toBuffer()
    const lossless = await sharp(png).webp({ lossless: true }).toBuffer()
    h.uploadMax = lossless.length
    h.generate.mockImplementation(async (input: GenImageInput) => msResult(input, png.toString('base64')))

    const ms = imagesJob(MS)
    h.job = ms
    const runMs = await runImagesStep({} as never, 'user-1', ms)
    const heroUpload = h.upload.mock.calls.find((c) => c[3] === 'hero')!
    expect(heroUpload[5]).toBe('image/webp')
    expect(Buffer.from(String(heroUpload[4]), 'base64').length).toBe(lossless.length)
    expect(runMs.section_images.find((e) => e.section === 'hero')?.uploadFit).toEqual({
      from: 'image/png',
      originalBytes: png.length,
      to: 'image/webp',
      bytes: lossless.length,
      quality: 'lossless',
    })

    h.upload.mockClear()
    const now = imagesJob('gpt-image-2.6-sunburst')
    h.job = now
    const runNow = await runImagesStep({} as never, 'user-1', now)
    // 움직이는 칸 조각('<칸>-motion'·'-poster')은 이 경로가 아니라 뺀다
    const stillUploads = h.upload.mock.calls.filter((c) => !String(c[3]).includes('-'))
    expect(stillUploads.length).toBeGreaterThan(0)
    for (const c of stillUploads) expect(c[5], String(c[3])).not.toBe('image/webp')
    expect(stillUploads.find((c) => c[3] === 'hero')![4]).toBe(png.toString('base64'))
    expect(runNow.section_images.some((e) => e.uploadFit)).toBe(false)
  })
})

describe('MS 2k 공급자 잔액 부족(R12c)', () => {
  // 11-09 R11 P07 55182d22 상태 조회 9건의 실제 사유
  const BALANCE = '힉스필드 요청 req-x failed — Your credit balance is too low to complete this request. Please top up your balance and try again.'
  const balanceError = () => new ImageProviderBalanceError('higgsfield', BALANCE)
  const ok = (input: GenImageInput) => ({ base64: 'aW1n', mimeType: 'image/png', model: input.model, costUsd: 0.11 })
  const entryOf = (job: PdpJobRow, section: string) => job.section_images.find((e) => e.section === section)!
  const ONE = { concurrency: 1 }

  it('hero가 잔액 부족이면 재시도로 세지 않고 보류한 채 단계 오류로 멈춘다 — 뒤 컷은 시작하지 않고, 충전 뒤 다음 run이 첫 시도로 만든다', async () => {
    const start = imagesJob(MS)
    let toppedUp = false
    h.generate.mockImplementation(async (input: GenImageInput) => {
      if (!toppedUp) throw balanceError()
      return ok(input)
    })
    h.job = start
    await expect(runImagesStep({} as never, 'user-1', start, ONE)).rejects.toThrow(PDP_PROVIDER_BALANCE_STEP_ERROR)
    const held = h.job!
    const hero = entryOf(held, 'hero')
    expect(hero).toMatchObject({ url: '', retryPending: true, providerBlocked: 'balance' })
    expect(hero.error).toContain('Your credit balance is too low')
    expect(isSectionSettled(hero)).toBe(false)
    // 동시 1 — hero 뒤로 같은 공급자 일을 더 시작하지 않는다(효과 전용 컷 포함)
    expect(calls()).toHaveLength(1)
    expect(providerBalanceHaltOf(held)).toContain('hero')

    toppedUp = true
    const run2 = await runImagesStep({} as never, 'user-1', held, ONE)
    const hero2 = entryOf(run2, 'hero')
    expect(hero2.url).toBe(`https://cdn.test/${start.id}/hero.png`)
    expect(hero2.error).toBeUndefined()
    expect(hero2.providerBlocked).toBeUndefined()
    expect(hero2.retryPending).toBeUndefined()
    expect(providerBalanceHaltOf(run2)).toBeNull()
  })

  it('잔액 부족 시도는 재시도 1번으로 세지 않는다 — 충전 뒤 첫 시도가 다른 사유로 실패해도 재시도 1번이 남는다(다른 failed는 지금 규칙, 사유는 칸에)', async () => {
    const start = imagesJob(MS)
    const heroOutcomes: Array<'balance' | 'failed' | 'ok'> = ['balance', 'failed', 'ok']
    h.generate.mockImplementation(async (input: GenImageInput) => {
      if (input.runContext?.stage === 'images/hero') {
        const next = heroOutcomes.shift()
        if (next === 'balance') throw balanceError()
        if (next === 'failed') throw new Error('힉스필드 요청 req-y failed — internal error')
      }
      return ok(input)
    })
    h.job = start
    await expect(runImagesStep({} as never, 'user-1', start, ONE)).rejects.toThrow(PDP_PROVIDER_BALANCE_STEP_ERROR)
    // 충전 뒤 첫 시도 — 다른 사유 실패는 지금처럼 재시도 대기(끝난 실패가 아니다), 단계 오류도 없다
    const run2 = await runImagesStep({} as never, 'user-1', h.job!, ONE)
    const hero2 = entryOf(run2, 'hero')
    expect(hero2).toMatchObject({ url: '', retryPending: true })
    expect(hero2.providerBlocked).toBeUndefined()
    expect(hero2.error).toContain('internal error')
    // 남은 재시도 1번으로 만든다
    const run3 = await runImagesStep({} as never, 'user-1', run2, ONE)
    expect(entryOf(run3, 'hero').url).toBe(`https://cdn.test/${start.id}/hero.png`)
    expect(callsFor('hero')).toHaveLength(3)
  })

  it('상품 컷이 잔액 부족이면 끝난 컷은 저장하고 그 run의 새 MS 컷은 시작하지 않는다 — 다음 run이 보류 컷을 첫 시도로 잇는다', async () => {
    const start = imagesJob(MS)
    let n = 0
    let toppedUp = false
    h.generate.mockImplementation(async (input: GenImageInput) => {
      n += 1
      if (!toppedUp && n >= 2) throw balanceError()
      return ok(input)
    })
    h.job = start
    await expect(runImagesStep({} as never, 'user-1', start, ONE)).rejects.toThrow(/보류 컷 1개/)
    const held = h.job!
    expect(entryOf(held, 'hero').url).toBeTruthy()
    const blocked = held.section_images.filter((e) => e.providerBlocked === 'balance')
    expect(blocked).toHaveLength(1)
    expect(blocked[0]).toMatchObject({ url: '', retryPending: true })
    expect(calls()).toHaveLength(2)
    expect(held.cost_usd).toBeCloseTo(start.cost_usd + 0.11 + h.gate.mock.calls.length * 0.001, 6)

    toppedUp = true
    const run2 = await runImagesStep({} as never, 'user-1', held, ONE)
    const again = entryOf(run2, blocked[0].section)
    expect(again.url).toBeTruthy()
    expect(again.providerBlocked).toBeUndefined()
    // 보류 컷의 다음 시도는 재시도가 아니라 첫 시도다 — 같은 단계 이름으로 한 번 더 부를 뿐 이어 받기(resume)도 없다
    const blockedCalls = callsFor(blocked[0].section)
    expect(blockedCalls).toHaveLength(2)
    expect(blockedCalls[1].resume).toBeUndefined()
  })

  it('게이트 재생성이 잔액 부족이면 재생성 1번을 쓰지 않고 앞 컷을 둔 채 이월한다 — 다음 run이 다시 재생성한다', async () => {
    const start = imagesJob(MS)
    const FAIL = { ...PASS, same_product: false, consistency: 0.4, artifact_reason: '다른 상품' }
    h.gate.mockReset().mockResolvedValueOnce({ score: FAIL, costUsd: 0.001 }).mockResolvedValue({ score: PASS, costUsd: 0.001 })
    let toppedUp = false
    h.generate.mockImplementation(async (input: GenImageInput) => {
      if (input.runContext?.stage === 'images/hero/regenerate' && !toppedUp) throw balanceError()
      return ok(input)
    })
    h.job = start
    await expect(runImagesStep({} as never, 'user-1', start, ONE)).rejects.toThrow(PDP_PROVIDER_BALANCE_STEP_ERROR)
    const hero = entryOf(h.job!, 'hero')
    expect(hero.url).toBe(`https://cdn.test/${start.id}/hero.png`)
    expect(hero.pendingRegen).toBe(true)
    expect(hero.retried).toBeFalsy()
    expect(hero.error).toContain('재생성 대기')
    expect(calls().map((c) => c.runContext?.stage)).toStrictEqual(['images/hero', 'images/hero/regenerate'])

    toppedUp = true
    const run2 = await runImagesStep({} as never, 'user-1', h.job!, ONE)
    const hero2 = entryOf(run2, 'hero')
    expect(hero2).toMatchObject({ retried: true, pendingRegen: false })
    expect(hero2.error).toBeUndefined()
    expect(callsFor('hero/regenerate')).toHaveLength(2)
  })

  it('하네스 멈춤 판정 — 잔액 부족 단계 오류나 보류 컷이 있으면 사유, 없으면 null', () => {
    const job = imagesJob(MS)
    expect(providerBalanceHaltOf(job)).toBeNull()
    expect(providerBalanceHaltOf({ ...job, error: `[images] ${PDP_PROVIDER_BALANCE_STEP_ERROR}(보류 컷 1개·시작 안 한 일 0개) — x` })).toContain('충전 뒤 다시 시도')
    const held = { section: 'k1_photo_0', url: '', error: 'x', retryPending: true, providerBlocked: 'balance' as const }
    expect(providerBalanceHaltOf({ ...job, section_images: [held] })).toContain('k1_photo_0')
    // 다시 만든 컷(표지 없음)·끝난 실패는 멈춤이 아니다
    expect(providerBalanceHaltOf({ ...job, section_images: [{ section: 'hero', url: 'u' }, { section: 'k2', url: '', error: 'x' }] })).toBeNull()
  })
})

describe('MS 2k content rejection - nsfw (J60)', () => {
  const ok = (input: GenImageInput) => ({ base64: 'aW1n', mimeType: 'image/png', model: input.model, costUsd: 0.11 })
  const entryOf = (job: PdpJobRow, section: string) => job.section_images.find((e) => e.section === section)!
  const ONE = { concurrency: 1 }
  const nsfwError = () => new ImageContentRejectedError('higgsfield', 'nsfw', 'req-n nsfw - flagged')
  const sectionOf = (input: GenImageInput) => input.runContext?.stage?.replace(/^images\//, '') ?? ''

  /** hero 다음 첫 컷을 nsfw로 끝내는 생성 모의 — rejectTimes번 거절한다 */
  function rejectFirstCut(rejectTimes: number) {
    const state = { target: null as string | null, rejected: 0 }
    h.generate.mockImplementation(async (input: GenImageInput) => {
      const section = sectionOf(input)
      if (state.target === null && section !== 'hero' && !section.includes('/')) state.target = section
      if (section === state.target && state.rejected < rejectTimes) {
        state.rejected += 1
        throw nsfwError()
      }
      return ok(input)
    })
    return state
  }

  it('nsfw 첫 시도는 거절 표지·재시도 대기로 남고, 다음 run의 재시도 1번이 안전 장면 지시로 부른다 — 재시도 비용도 잡 비용에 든다', async () => {
    const start = imagesJob(MS)
    const state = rejectFirstCut(1)
    h.job = start
    const run1 = await runImagesStep({} as never, 'user-1', start, ONE)
    const target = state.target!
    const first = entryOf(run1, target)
    expect(first).toMatchObject({ url: '', retryPending: true, contentRejected: 'nsfw' })
    expect(first.error).toContain('nsfw')
    expect(isSectionSettled(first)).toBe(false)
    expect(callsFor(target)[0].prompt).not.toContain('soft long sleeves')
    const cost1 = run1.cost_usd

    const run2 = await runImagesStep({} as never, 'user-1', run1, ONE)
    const retried = entryOf(run2, target)
    expect(retried.url).toBe(`https://cdn.test/${start.id}/${target}.png`)
    expect(retried.sceneSafety).toBe('nsfw-retry')
    expect(retried.contentRejected).toBeUndefined()
    expect(retried.retryPending).toBeUndefined()
    expect(callsFor(target)).toHaveLength(2)
    const sent = callsFor(target)[1].prompt
    expect(sent).toContain('soft long sleeves')
    expect(sent.length).toBeLessThanOrEqual(5000)
    // 재시도 생성 비용(0.11)이 잡 비용에 더해진다(원장 기록은 generateImage가 호출마다 한다)
    expect(run2.cost_usd).toBeGreaterThanOrEqual(cost1 + 0.11 - 1e-9)
  })

  it('재시도도 nsfw면 끝난 실패 — 표지만 남고 더 부르지 않는다', async () => {
    const start = imagesJob(MS)
    const state = rejectFirstCut(2)
    h.job = start
    const run1 = await runImagesStep({} as never, 'user-1', start, ONE)
    const run2 = await runImagesStep({} as never, 'user-1', run1, ONE)
    const target = state.target!
    const last = entryOf(run2, target)
    expect(last).toMatchObject({ url: '', contentRejected: 'nsfw', sceneSafety: 'nsfw-retry' })
    expect(last.retryPending).toBeUndefined()
    expect(isSectionSettled(last)).toBe(true)
    expect(callsFor(target)).toHaveLength(2)
  })

  it('거절이 없는 MS 잡은 장면 안전 지시가 없다 — 샤워·목욕 장면 없는 지시는 바이트 그대로', async () => {
    const start = imagesJob(MS)
    h.job = start
    const done = await runImagesStep({} as never, 'user-1', start, ONE)
    expect(done.section_images.some((e) => e.sceneSafety || e.contentRejected)).toBe(false)
    expect(calls().some((c) => c.prompt.includes('soft long sleeves') || c.prompt.includes('dressed as in the other cuts'))).toBe(false)
  })
})

describe('MS 2k 보여 줄 동작 문장(J63 showbeat)', () => {
  const ONE = { concurrency: 1 }
  const SHOTS = [
    { key: 'k2_photo_0', section: 'how_to', purpose: 'action', composition: 'in_hand', aspect: '1:1', show: '두피를문지르는모습' },
    { key: 'k3_photo_0', section: 'point_div', purpose: 'hero', composition: 'front', aspect: '1:1', show: '취향에맞게고르는' },
  ]
  function beatJob(features: string[]): PdpJobRow {
    const job = imagesJob(MS)
    return {
      ...job,
      spec_sheet: { ...job.spec_sheet, usageSteps: [{ title: '돌기면으로 두피 문지르기', description: '작은 원을 그리듯 문지릅니다.' }] },
      analysis: { ...job.analysis, enrichment: { version: 1, features } } as PdpJobRow['analysis'],
      section_plan: { ...job.section_plan, templatelib: { shots: SHOTS } } as PdpJobRow['section_plan'],
    }
  }

  it('켜진 잡은 받은 컷만 문장을 실어 보내고 shown으로 남긴다 — 꺼진 잡은 문장·표지가 없다', async () => {
    const on = beatJob(['templatelib', 'showbeat'])
    h.job = on
    const done = await runImagesStep({} as never, 'user-1', on, ONE)
    const line = 'Show plainly: the hand rubbing it in small circles on the surface it works on, mid-stroke.'
    expect(callsFor('k2_photo_0')[0].prompt).toContain(` ${line}`)
    expect(done.section_images.find((e) => e.section === 'k2_photo_0')?.showBeat).toBe('shown')
    // 사실 출처 표지(J63 2단계) — spec 사용 순서 칸에 줄기가 있으면 spec
    expect(done.section_images.find((e) => e.section === 'k2_photo_0')?.showBeatSource).toBe('spec')
    expect(callsFor('k3_photo_0')[0].prompt).not.toContain('Show plainly:')
    expect(done.section_images.find((e) => e.section === 'k3_photo_0')?.showBeat).toBeUndefined()

    h.generate.mockClear()
    const off = beatJob(['templatelib'])
    h.job = off
    const plain = await runImagesStep({} as never, 'user-1', off, ONE)
    expect(calls().some((c) => c.prompt.includes('Show plainly:'))).toBe(false)
    expect(plain.section_images.some((e) => e.showBeat)).toBe(false)
  })

  it('사실이 이번 run 식별 카드 USE 줄에만 있으면 카드 뒤 태스크를 다시 짜 문장을 싣고 출처를 card로 남긴다 — USE 줄이 없거나 끈 잡은 문장이 없다(J63 2단계)', async () => {
    const { readIdentityCard } = await import('@/lib/agents/registration/pdp-image-agent')
    const USE = 'Hold the grip knob and rub the bristles on the scalp in small circles.'
    /** spec·카피 howTo에 사실이 없고 카드가 아직 없는 잡 — 이번 run이 카드를 읽는다 */
    const cardOnly = (features: string[]): PdpJobRow => {
      const job = beatJob(features)
      const prompts = { ...job.design_prompts }
      delete prompts.identity_card
      delete prompts.identity_use
      const final = job.copy_sections.final ? { ...job.copy_sections.final, howTo: [] } : job.copy_sections.final
      return {
        ...job,
        spec_sheet: { ...job.spec_sheet, keyFeatures: [], usageSteps: [], material: '', usageLocation: '', identityNote: '' },
        design_prompts: prompts,
        copy_sections: { ...job.copy_sections, final },
      } as PdpJobRow
    }
    const run = async (features: string[], use: string) => {
      h.generate.mockClear()
      vi.mocked(readIdentityCard).mockResolvedValueOnce({ card: 'IDENTITY', costUsd: 0, ...(use ? { use } : {}) })
      const start = cardOnly(features)
      h.job = start
      const done = await runImagesStep({} as never, 'user-1', start, ONE)
      return { done, sent: callsFor('k2_photo_0')[0].prompt, entry: done.section_images.find((e) => e.section === 'k2_photo_0') }
    }

    const on = await run(['templatelib', 'showbeat', 'usefacts'], USE)
    expect(on.done.design_prompts.identity_use).toBe(USE)
    expect(on.sent).toContain('Show plainly: the hand rubbing it in small circles on the surface it works on, mid-stroke.')
    expect(on.entry).toMatchObject({ showBeat: 'shown', showBeatSource: 'card' })

    // 같은 잡에 USE 줄이 안 오면 사실이 없어 지시 그대로
    const noUse = await run(['templatelib', 'showbeat', 'usefacts'], '')
    expect(noUse.sent).not.toContain('Show plainly:')
    expect(noUse.entry?.showBeat).toBeUndefined()

    // showbeat를 끈 잡은 USE 줄이 와도 문장·표지가 없다
    const off = await run(['templatelib', 'usefacts'], USE)
    expect(off.done.design_prompts.identity_use).toBe(USE)
    expect(calls().some((c) => c.prompt.includes('Show plainly:'))).toBe(false)
    expect(off.done.section_images.some((e) => e.showBeat || e.showBeatSource)).toBe(false)
  })
})
