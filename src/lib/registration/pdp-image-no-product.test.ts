/**
 * 상품 없는 K 컷(목적 problem — 고민 섹션·비교 왼쪽 칸, J49 decide 24) — 오너 J33 메모: 고민 컷에 우리 상품이 나와 '우리 상품 때문에 생긴 고민'처럼 읽힘.
 * 컷 지시 뒤에 붙어 상품을 부르던 네 줄을 고민 컷에서만 뺀다: ① 감독 컷 지시 문장(빛·세트만 남김) ② 게이트의 같은 상품·일관성 미달 재생성
 * ('Match the reference product') ③ 학부모 블록의 '준비된 결과' ④ 인쇄 상품 보존 블록(일반 글자 금지 판으로). 다른 컷은 지금 그대로.
 * 이미지 생성·Vision·LLM·DB·스토리지·예산은 모의(유료 호출 0).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PdpJobRow } from './pdp-state'

const h = vi.hoisted(() => ({
  job: null as PdpJobRow | null,
  generate: vi.fn(),
  scores: {} as Record<string, Record<string, unknown>>,
}))

const PASS = { has_artifact: false, same_product: true, consistency: 0.95, artifact_reason: '' }

vi.mock('@/lib/agents/budget', async (orig) => ({
  ...(await orig<typeof import('@/lib/agents/budget')>()),
  checkMonthlyBudget: vi.fn(async () => ({ allowed: true, spentUsd: 0, budgetUsd: 1000 })),
}))
vi.mock('./pdp-jobs', () => ({
  updatePdpJob: vi.fn(async (_db: unknown, _user: string, _id: string, patch: Record<string, unknown>) => {
    const job = { ...h.job! }
    if (patch.sectionImages !== undefined) job.section_images = patch.sectionImages as PdpJobRow['section_images']
    if (patch.costUsd !== undefined) job.cost_usd = patch.costUsd as number
    if (patch.designPrompts !== undefined) job.design_prompts = patch.designPrompts as PdpJobRow['design_prompts']
    if (patch.sectionPlan !== undefined) job.section_plan = patch.sectionPlan as PdpJobRow['section_plan']
    if (patch.currentStep !== undefined) job.current_step = patch.currentStep as PdpJobRow['current_step']
    if (patch.error !== undefined) job.error = patch.error as string | null
    h.job = job
    return job
  }),
}))
vi.mock('@/lib/agents/registration/thumbnail-vision-agent', () => ({
  fetchImageAsBase64: vi.fn(async () => ({ data: 'aW1n', mediaType: 'image/png' })),
}))
vi.mock('@/lib/agents/registration/pdp-image-agent', () => ({
  readIdentityCard: vi.fn(async () => ({ card: 'IDENTITY', costUsd: 0 })),
  judgeImageGate: vi.fn(async (_refs: unknown, section: string) => ({ score: h.scores[section] ?? PASS, costUsd: 0 })),
}))
vi.mock('@/lib/agents/registration/pdp-annotation-agent', () => ({ locateAnnotations: vi.fn() }))
vi.mock('@/lib/agents/image/generate', () => ({ generateImage: (...args: unknown[]) => h.generate(...args) }))
vi.mock('./storage', () => ({
  uploadPdpImage: vi.fn(async (_db: unknown, _u: string, jobId: string, section: string) => `https://cdn.test/${jobId}/${section}.png`),
}))

import { NO_TEXT_INSTRUCTION, PRINTED_DESIGN_PRESERVE_INSTRUCTION } from '@/lib/agents/registration/prompts/pdp-image-prompts'
import type { GenImageInput } from '@/lib/agents/image/types'
import { PARENT_PREP_IMAGE_BLOCK, PARENT_PREP_NO_PRODUCT_BLOCK } from './parent-proxy-copy'
import { isNoProductGateFailure, isNoProductRegenReason, runImagesStep } from './pdp-image-stage'
import { runWithPdpBatch } from './pdp-model-batch-context'
import { fixtureToJob, loadEnrichmentFixture, rewindTo } from './__golden__/golden-harness'

const DIRECTOR = {
  light: 'Soft left window light.',
  set: 'Pale oak table.',
  cuts: [
    { key: 'k1_photo_0', distance: 'mid', people: 'hand', direction: 'Pouch centered on the table.', exception: '' },
    { key: 'k2_photo_0', distance: 'mid', people: 'person', direction: 'Top-down view of a table with empty daisy-print pouches.', exception: '' },
  ],
  conflicts_removed: [],
}
const DONE = { version: 1, stage: 'director', status: 'done', route: { name: 'images/director', model: 'm', effort: 'low', maxTokens: 1, backend: 'api' }, warnings: [], costUsd: 0, durationMs: 0, result: DIRECTOR }
const POINT = { key: 'k1_photo_0', section: 'point_div', purpose: 'feature_proof', composition: 'front', aspect: '1:1', show: '한 장씩 쏙' }
const PROBLEM = { key: 'k2_photo_0', section: 'problem_empathy', purpose: 'problem', composition: 'top', aspect: '3:4', show: '언제 다 하죠?' }
const AUDIENCE = { kind: 'parent_proxy', version: 1, basis: 'name_tags', terms: ['구디백'], ageGate: false }

/** 새 배치·감독이 끝난 학부모 대리·인쇄 상품(봉투) K 잡 — 감독은 고민 컷에도 상품을 소품으로 적었다(P02 462d097d 꼴) */
function noProductJob(shots: readonly object[] = [POINT, PROBLEM]): PdpJobRow {
  const job = rewindTo(fixtureToJob(loadEnrichmentFixture('A-track-s')), 'images')
  return {
    ...job,
    model_batch: 'new',
    spec_sheet: { ...job.spec_sheet, productName: '데이지 조리개 봉투 답례품' },
    analysis: { ...job.analysis, enrichment: { version: 1, features: ['newstages', 'audience'], audience: AUDIENCE } } as PdpJobRow['analysis'],
    section_plan: { ...job.section_plan, templatelib: { shots } } as PdpJobRow['section_plan'],
    design_prompts: { ...job.design_prompts, director: DONE } as PdpJobRow['design_prompts'],
    current_step: 'images',
    cost_usd: 1,
  }
}
const run = (job: PdpJobRow) => {
  h.job = job
  return runWithPdpBatch('new', () => runImagesStep({} as never, 'user-1', job, { leaseUntil: 'L' }))
}
const sent = () => h.generate.mock.calls.map(([input]) => input as GenImageInput)
const promptOf = (stage: string) => sent().find((p) => p.runContext?.stage === stage)?.prompt ?? ''

beforeEach(() => {
  h.scores = {}
  h.generate.mockReset().mockImplementation(async (input: GenImageInput) => ({ base64: 'aW1n', mimeType: 'image/png', model: input.model, costUsd: 0.1 }))
})

describe('상품 없는 컷 지시(J49) — 고민 컷만 상품을 부르는 줄을 뺀다', () => {
  it('감독 줄은 빛·세트만, 학부모 블록은 준비된 결과 없이, 인쇄 보존 대신 일반 글자 금지 — 상품 빼기 줄은 그대로', async () => {
    await run(noProductJob())
    const problem = promptOf('images/k2_photo_0')
    expect(problem).toContain('Art direction: Light: Soft left window light. Set: Pale oak table.')
    expect(problem).not.toContain('daisy-print pouches')
    expect(problem).toContain(PARENT_PREP_NO_PRODUCT_BLOCK)
    expect(problem).not.toContain('prepared result')
    expect(problem).not.toContain(PRINTED_DESIGN_PRESERVE_INSTRUCTION)
    expect(problem).toContain(NO_TEXT_INSTRUCTION)
    expect(problem).toContain('DO NOT show the product itself in this image.')
    expect(problem).toContain('Purpose: Show the everyday inconvenience named below — without this product.')
  })

  it('다른 컷은 지금 그대로 — 감독 컷 지시 문장·학부모 원래 블록이 붙고, 고민 컷이 있어도 없어도 지시가 바이트까지 같다', async () => {
    await run(noProductJob())
    const point = promptOf('images/k1_photo_0')
    const hero = promptOf('images/hero')
    expect(point).toContain('Art direction: Pouch centered on the table. Light: Soft left window light. Set: Pale oak table.')
    expect(point).toContain(PARENT_PREP_IMAGE_BLOCK)
    expect(hero).toContain(PARENT_PREP_IMAGE_BLOCK)

    h.generate.mockClear()
    await run(noProductJob([POINT]))
    expect(promptOf('images/k1_photo_0')).toBe(point)
    expect(promptOf('images/hero')).toBe(hero)
  })
})

describe('상품 없는 컷 게이트(J49) — 같은 상품·일관성은 보지 않고 글자·브랜드만', () => {
  const productMismatch = { has_artifact: false, same_product: false, consistency: 0.1, artifact_reason: '' }

  it('고민 컷은 같은 상품·일관성 미달로 다시 만들지 않는다 — 상품 컷은 지금처럼 다시 만든다', async () => {
    h.scores = { k2_photo_0: productMismatch, k1_photo_0: productMismatch }
    const out = await run(noProductJob())
    expect(sent().filter((p) => p.runContext?.stage?.startsWith('images/k2_photo_0'))).toHaveLength(1)
    expect(out.section_images.find((e) => e.section === 'k2_photo_0')).toMatchObject({ url: expect.stringContaining('k2_photo_0') })
    expect(out.section_images.find((e) => e.section === 'k2_photo_0')?.error).toBeFalsy()
    // 상품 컷은 같은 상품 미달이면 재생성 지시로 다시 만든다(지금 그대로)
    expect(promptOf('images/k1_photo_0/regenerate')).toContain('PREVIOUS ATTEMPT FAILED')
  })

  it("고민 컷도 글자가 생기면 다시 만들고, 지시는 글자 금지 판이다('Match the reference product'·인쇄 재현 판 아님)", async () => {
    h.scores = { k2_photo_0: { has_artifact: true, same_product: false, consistency: 0.1, artifact_reason: 'Korean text printed on the pouch' } }
    await run(noProductJob())
    const regen = promptOf('images/k2_photo_0/regenerate')
    expect(regen).toContain('PREVIOUS ATTEMPT FAILED — rendered text appeared in the image.')
    expect(regen).not.toContain('Match the reference')
    expect(regen).not.toContain('Reproduce the printed wording')
  })

  it('재생성 사유 판정 — 결함 글이 글자·브랜드일 때만, 같은 상품·일관성·부품·얼룩·모양은 아니다', () => {
    expect(isNoProductGateFailure({ has_artifact: true, artifact_reason: 'visible letters on the wall' })).toBe(true)
    expect(isNoProductGateFailure({ has_artifact: true, artifact_reason: 'brand logo on the box' })).toBe(true)
    expect(isNoProductGateFailure({ has_artifact: true, artifact_reason: 'stain on the table' })).toBe(false)
    expect(isNoProductGateFailure({ has_artifact: true, artifact_reason: 'different shape' })).toBe(false)
    expect(isNoProductGateFailure({ has_artifact: false, artifact_reason: 'text' })).toBe(false)
    expect(isNoProductRegenReason({ same_product: false })).toBe(false)
    expect(isNoProductRegenReason({ parts_match: false, artifact_reason: '' })).toBe(false)
    expect(isNoProductRegenReason({ same_product: false, artifact_reason: 'caption text' })).toBe(true)
  })
})
