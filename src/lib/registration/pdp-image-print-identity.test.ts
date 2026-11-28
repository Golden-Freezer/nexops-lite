/**
 * 상품 정확성 run 재생(2026-10-31, 상품 일치 불통과 P01·P07) — 픽스처 잡을 images 직전으로 되감아 runImagesStep을 끝까지 돌린다.
 * 인쇄물(Track S 스티커, 원천 2장)은 식별카드가 사진 2장을 함께 보고 상품 컷에 도안 규칙이 붙는다. 일반 상품(Track I 구디백)은
 * 식별카드가 인쇄 무늬를 적었을 때만 무늬 보존 줄이 붙는다. 이미지 생성·Vision·DB·스토리지는 모의(유료 호출 0).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PdpJobRow } from './pdp-state'

const h = vi.hoisted(() => ({
  job: null as PdpJobRow | null,
  card: '',
  identity: [] as unknown[][],
  uncertain: '',
  calls: [] as Array<{ section: string; prompt: string }>,
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
  readIdentityCard: vi.fn(async (...args: unknown[]) => {
    h.identity.push(args)
    return { card: h.card, costUsd: 0, ...(h.uncertain ? { uncertain: h.uncertain } : {}) }
  }),
  judgeImageGate: vi.fn(async () => ({
    score: { cut: 'x', same_product: true, background_tone_hex: '#ffffff', consistency: 0.95, has_artifact: false, artifact_reason: '' },
    costUsd: 0,
  })),
}))
vi.mock('@/lib/agents/image/generate', () => ({
  generateImage: vi.fn(async (args: { prompt: string; runContext: { stage: string } }) => {
    h.calls.push({ section: args.runContext.stage.replace('images/', ''), prompt: args.prompt })
    return { base64: 'AAAA', mimeType: 'image/png' }
  }),
}))
vi.mock('./storage', () => ({
  uploadPdpImage: vi.fn(async (_db: unknown, _u: string, jobId: string, section: string) => `https://cdn.test/${jobId}/${section}.png`),
}))

import { runImagesStep } from './pdp-image-stage'
import { isTextBearingJob } from './pdp-image-tasks'
import { fixtureToJob, loadEnrichmentFixture, rewindTo } from './__golden__/golden-harness'
import { buildPrintedDesignsRule, PRINTED_MARKS_RULE } from '@/lib/agents/registration/prompts/pdp-image-prompts'

const P07_LIKE_CARD =
  "PRODUCT IDENTITY (read from the user's reference photo — the generated product must match every detail below): sage green tray, " +
  '2 clear-white glass bowls, black paw print on the left bowl floor, black fish skeleton on the right bowl floor'
const PLAIN_CARD =
  "PRODUCT IDENTITY (read from the user's reference photo — the generated product must match every detail below): translucent pouch, 1 zipper"

async function runToEnd(key: 'B-track-s' | 'C-track-i', edit: (job: PdpJobRow) => PdpJobRow = (j) => j): Promise<PdpJobRow> {
  const base = edit(rewindTo(fixtureToJob(loadEnrichmentFixture(key)), 'images'))
  let job: PdpJobRow = {
    ...base,
    current_step: 'images',
    design_prompts: { ...base.design_prompts, identity_card: undefined },
  }
  for (let i = 0; i < 40 && job.current_step === 'images'; i++) {
    h.job = job
    job = await runImagesStep({} as never, 'user-1', job)
  }
  return job
}

beforeEach(() => {
  h.card = ''
  h.identity = []
  h.uncertain = ''
  h.calls = []
})

describe('인쇄물(Track S 스티커, 원천 2장)', () => {
  it('식별카드가 사진 2장을 함께 보고, 상품 컷(식별카드가 붙는 컷)마다 도안 규칙이 카드 바로 뒤에 붙는다', async () => {
    h.card = "PRODUCT IDENTITY (read from the user's 2 reference photos — …): Design 1: bear; Design 2: rainbow"
    const job = await runToEnd('B-track-s')
    expect(isTextBearingJob(job)).toBe(true)
    expect(job.source_images).toHaveLength(2)

    expect(h.identity).toHaveLength(1)
    expect(h.identity[0][2]).toHaveLength(1)

    const rule = buildPrintedDesignsRule(2)
    const product = h.calls.filter((c) => c.prompt.includes(h.card))
    expect(product.length).toBeGreaterThan(0)
    for (const c of product) expect(c.prompt, c.section).toContain(`${h.card}\n\n${rule}`)
    // 효과 전용 컷(상품이 나오지 않아 참조·식별카드가 없는 컷)에는 붙지 않는다
    const effectOnly = h.calls.filter((c) => !c.prompt.includes(h.card))
    expect(effectOnly.length).toBeGreaterThan(0)
    for (const c of effectOnly) expect(c.prompt, c.section).not.toContain('PRINTED DESIGNS')
    expect(h.calls.some((c) => c.prompt.includes('PRINTED MARKS'))).toBe(false)
    expect(job.current_step).toBe('compose')
  })
})

describe('일반 상품(Track I 구디백)', () => {
  it('식별카드는 지금처럼 첫 사진만 보고, 카드에 인쇄 무늬가 있으면 상품 컷에 무늬 보존 줄이 붙는다', async () => {
    h.card = P07_LIKE_CARD
    const job = await runToEnd('C-track-i')
    expect(isTextBearingJob(job)).toBe(false)

    expect(h.identity).toHaveLength(1)
    expect(h.identity[0][2]).toEqual([])
    const withCard = h.calls.filter((c) => c.prompt.includes(P07_LIKE_CARD))
    expect(withCard.length).toBeGreaterThan(0)
    for (const c of withCard) expect(c.prompt, c.section).toContain(`${P07_LIKE_CARD}\n\n${PRINTED_MARKS_RULE}`)
    expect(h.calls.some((c) => c.prompt.includes('PRINTED DESIGNS'))).toBe(false)
  })

  describe('idcardall', () => {
    const on = (job: PdpJobRow): PdpJobRow => {
      const enrichment = (job.analysis as { enrichment?: { version: number; features: string[] } }).enrichment
      const hero = job.source_images[0]
      return {
        ...job,
        analysis: { ...job.analysis, enrichment: { version: 1, features: [...(enrichment?.features ?? []), 'idcardall'] } } as PdpJobRow['analysis'],
        source_images: [hero, 'https://cdn.test/second.png', 'https://cdn.test/third.png'],
      }
    }

    it('켜면 인쇄물이 아닌 상품도 원천 사진을 함께 읽고 전 사진 표지를 넘긴다', async () => {
      h.card = PLAIN_CARD
      const job = await runToEnd('C-track-i', on)
      expect(isTextBearingJob(job)).toBe(false)
      expect(h.identity).toHaveLength(1)
      expect(h.identity[0][2]).toHaveLength(2)
      // 상태 구분 문장(오너 메모 11-06 P05)도 idcardall 잡의 인쇄물이 아닌 카드에만 켠다
      expect(h.identity[0][3]).toEqual({ allPhotos: true, states: true })
    })

    it('인쇄물은 켜도 상태 구분을 넘기지 않는다 — 도안 판독 인자 그대로', async () => {
      h.card = "PRODUCT IDENTITY (read from the user's 2 reference photos — …): Design 1: bear; Design 2: rainbow"
      const job = await runToEnd('B-track-s', (j) => {
        const enrichment = (j.analysis as { enrichment?: { version: number; features: string[] } }).enrichment
        return { ...j, analysis: { ...j.analysis, enrichment: { version: 1, features: [...(enrichment?.features ?? []), 'idcardall'] } } as PdpJobRow['analysis'] }
      })
      expect(isTextBearingJob(job)).toBe(true)
      expect(h.identity[0][3]).toBeUndefined()
    })

    it('켜고 사진이 1장이면 한 장 판독에 상태 구분만 넘긴다', async () => {
      h.card = PLAIN_CARD
      await runToEnd('C-track-i', (job) => ({ ...on(job), source_images: [job.source_images[0]] }))
      expect(h.identity[0][2]).toEqual([])
      expect(h.identity[0][3]).toEqual({ states: true })
    })

    it('불확실 특징은 기록만 하고 상품 컷 프롬프트에 가지 않는다', async () => {
      h.card = PLAIN_CARD
      h.uncertain = 'black rubber caps on leg ends'
      const job = await runToEnd('C-track-i', on)
      expect(job.design_prompts.identity_uncertain).toBe('black rubber caps on leg ends')
      expect(h.calls.filter((c) => c.prompt.includes(PLAIN_CARD)).length).toBeGreaterThan(0)
      expect(h.calls.some((c) => c.prompt.includes('black rubber caps'))).toBe(false)
    })

    it('끄면 사진이 여러 장이어도 첫 사진만 — 표지를 넘기지 않는다', async () => {
      h.card = PLAIN_CARD
      await runToEnd('C-track-i', (job) => ({ ...job, source_images: on(job).source_images }))
      expect(h.identity[0][2]).toEqual([])
      expect(h.identity[0][3]).toBeUndefined()
    })
  })

  it('카드에 인쇄 무늬가 없으면 어느 줄도 붙지 않는다', async () => {
    h.card = PLAIN_CARD
    await runToEnd('C-track-i')

    expect(h.calls.some((c) => c.prompt.includes(PLAIN_CARD))).toBe(true)
    expect(h.calls.some((c) => c.prompt.includes('PRINTED MARKS') || c.prompt.includes('PRINTED DESIGNS'))).toBe(false)
  })
})
