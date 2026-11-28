/**
 * 편집기 재생성이 images 단계 재생성 큐로 처리되는지(pdp-image-regen-api) — 골든 픽스처 잡을 images부터 완료까지 돌린 뒤
 * 한 섹션에 재생성을 요청하고 runImagesStep을 다시 돌린다. 요청 검사(planEditorRegen·regenBudgetBlock)도 같은 완료 잡으로 본다.
 * 이미지 생성·Vision·DB·스토리지는 모의(유료 호출 0).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PdpJobRow, SectionImage } from './pdp-state'

const h = vi.hoisted(() => ({
  job: null as PdpJobRow | null,
  generate: vi.fn(),
  gate: vi.fn(),
  fetchImage: vi.fn(),
  uploads: 0,
  /** 디자인 컷 켜짐 판정 덮어쓰기(null = 실제 판정) — 계획이 기록되지 않은 디자인 컷 잡 사례 */
  designcut: null as boolean | null,
}))

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({}) }))
vi.mock('./internalized/designcut-plan', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./internalized/designcut-plan')>()
  return { ...actual, designcutEnabled: (job: PdpJobRow) => h.designcut ?? actual.designcutEnabled(job) }
})
vi.mock('@/lib/agents/budget', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/agents/budget')>()),
  checkMonthlyBudget: vi.fn(async () => ({ allowed: true, spentUsd: 0, budgetUsd: 50 })),
}))
vi.mock('./pdp-jobs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./pdp-jobs')>()),
  getPdpJob: vi.fn(async () => (h.job ? { ...h.job } : null)),
  claimPdpJobRun: vi.fn(async () => ({ job: { ...h.job! }, leaseUntil: null })),
  updatePdpJob: vi.fn(async (_db: unknown, _user: string, _id: string, patch: Record<string, unknown>) => {
    const job = h.job!
    if (patch.sectionImages !== undefined) job.section_images = patch.sectionImages as PdpJobRow['section_images']
    if (patch.sectionPlan !== undefined) job.section_plan = patch.sectionPlan as PdpJobRow['section_plan']
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
  fetchImageAsBase64: (...args: unknown[]) => h.fetchImage(...args),
}))
vi.mock('@/lib/agents/registration/pdp-image-agent', () => ({
  readIdentityCard: vi.fn(async () => ({ card: 'IDENTITY', costUsd: 0 })),
  judgeImageGate: (...args: unknown[]) => h.gate(...args),
}))
vi.mock('@/lib/agents/registration/pdp-annotation-agent', () => ({
  locateAnnotations: vi.fn(async () => ({ rows: [], costUsd: 0.001 })),
}))
vi.mock('@/lib/agents/image/generate', () => ({
  generateImage: (...args: unknown[]) => h.generate(...args),
}))
vi.mock('./storage', () => ({
  uploadPdpImage: vi.fn(
    async (_db: unknown, _u: string, jobId: string, section: string) =>
      `https://cdn.test/${jobId}/${section}-${++h.uploads}.png`
  ),
}))

import { checkMonthlyBudget } from '@/lib/agents/budget'
import { ImageProviderBalanceError } from '@/lib/agents/image/types'
import { selectAnnotationTargets } from './pdp-annotation-stage'
import { runImagesStep } from './pdp-image-stage'
import { resolveStepToRun, runPdpStep } from './pdp-pipeline'
import { markEditorRegen, REGEN_STYLE_HINTS, type RegenEstimate } from './pdp-image-regen'
import { hasOtherImageWork, otherImageWorkReason, planEditorRegen, regenBudgetBlock } from './pdp-image-regen-request'
import { optionPhotoCoverage, optionPhotoGuard } from './options/option-photo-guard'
import { optionSpecOf } from './internalized/persuasion-signals'
import { FAIRNEX_OPTION_LABELS } from './options/__fixtures__/fairnex-option-labels'
import { parseOptionLabels, type OptionSpec } from './options/option-spec'
import { fixtureToJob, loadEnrichmentFixture, rewindTo, type FixtureKey } from './__golden__/golden-harness'
import { buildImageTasks, buildKnownImageTasks } from './pdp-image-tasks'

const PASS = { has_artifact: false, same_product: true, consistency: 0.95, artifact_reason: '' }
const MISMATCH = { has_artifact: false, same_product: false, consistency: 0.3, artifact_reason: 'different product' }
const DONE_AT = '2026-10-29T00:00:00.000Z'

const calls = () =>
  h.generate.mock.calls.map(([input]) => {
    const i = input as { prompt: string; referenceImages?: unknown[]; runContext?: { stage?: string } }
    return { stage: i.runContext?.stage ?? '', prompt: i.prompt, refs: i.referenceImages?.length ?? 0 }
  })

async function run(job: PdpJobRow): Promise<PdpJobRow> {
  h.job = job
  return runImagesStep({} as never, 'user-1', job)
}

/** images 직전으로 되감은 픽스처를 완료까지 돌리고 compose가 끝난 것처럼 만든다(final_html·done) */
async function doneJob(base: PdpJobRow): Promise<PdpJobRow> {
  let job: PdpJobRow = { ...base, image_quality: 'medium', current_step: 'images' }
  for (let i = 0; i < 40 && job.current_step === 'images'; i++) job = await run(job)
  expect(job.current_step).toBe('compose')
  const done = {
    ...job,
    final_html: '<html></html>',
    current_step: 'done' as const,
    progress: 100,
    updated_at: DONE_AT,
  }
  expect(resolveStepToRun(done)).toBe('done')
  h.generate.mockClear()
  h.gate.mockClear()
  return done
}
const fixtureImagesJob = (key: FixtureKey) => rewindTo(fixtureToJob(loadEnrichmentFixture(key)), 'images')
/** 옵션 사진 가드 잡 — P02(데이지만 실물 옵션 사진, 체리는 사진 없음) */
function optionImagesJob(): PdpJobRow {
  const { spec } = parseOptionLabels(FAIRNEX_OPTION_LABELS.P02)
  const optionSpec: OptionSpec = {
    ...spec,
    variants: spec.variants.map((v) =>
      v.label.includes('데이지') ? { ...v, sourceImage: 'https://cdn.test/opt/daisy.jpg' } : v
    ),
  }
  const base = fixtureImagesJob('A-track-i')
  return {
    ...base,
    spec_sheet: { ...base.spec_sheet, optionSpec },
    analysis: { ...base.analysis, enrichment: { version: 1, features: ['vocab', 'persuasion', 'options'] } },
  } as PdpJobRow
}
/** 장식(annotations)이 켜진 Track I 잡 — features 컷이 장식 대상이 된다(pdp-annotation-run 시험과 같은 켜기) */
function annotatedImagesJob(): PdpJobRow {
  const job = fixtureImagesJob('A-track-i')
  return {
    ...job,
    section_plan: {
      ...job.section_plan,
      enrichment: { version: 1, features: ['vocab', 'persuasion', 'annotations'], vocabHash: null },
    },
  } as PdpJobRow
}

/** 안 쓰는 컷을 빼는(lean) 잡 — A-track-i 골격에는 비교 섹션이 없어 size_comparison·comparison_scene을 만들지 않는다 */
function leanImagesJob(): PdpJobRow {
  const job = fixtureImagesJob('A-track-i')
  return {
    ...job,
    analysis: { ...job.analysis, enrichment: { version: 1, features: ['vocab', 'persuasion', 'lean'] } },
  } as PdpJobRow
}

/** 라우트 POST가 하는 표시 — 재생성 대기 + images로 되돌림 */
function requestRegen(
  job: PdpJobRow,
  section: string,
  extra: { style?: 'lifestyle'; note?: string; keep?: string; useCurrent?: boolean } = {}
): PdpJobRow {
  return {
    ...job,
    section_images: markEditorRegen(job.section_images, { section, ...extra }, '2026-10-29T01:00:00.000Z'),
    current_step: 'images',
  }
}
const entryOf = (job: PdpJobRow, section: string) => job.section_images.find((e) => e.section === section)!
const others = (job: PdpJobRow, section: string) => job.section_images.filter((e) => e.section !== section)

beforeEach(() => {
  h.uploads = 0
  h.designcut = null
  h.generate.mockReset()
  h.gate.mockReset()
  h.fetchImage.mockReset()
  h.generate.mockResolvedValue({ base64: 'aW1n', mimeType: 'image/png', model: 'gpt-image-2' })
  h.gate.mockResolvedValue({ score: PASS, costUsd: 0.001 })
  h.fetchImage.mockResolvedValue({ data: 'aW1n', mediaType: 'image/png' })
})
afterEach(() => {
  vi.restoreAllMocks()
})

describe('images 단계의 편집기 재생성', () => {
  it('요청한 컷만 같은 참조·식별 카드로 다시 만들고, 게이트를 통과하면 바꾼 뒤 done으로 돌아간다', async () => {
    const done = await doneJob(fixtureImagesJob('A-track-s'))
    const before = entryOf(done, 'hero')
    const after = await run(requestRegen(done, 'hero', { style: 'lifestyle', note: '더 밝게' }))

    expect(calls()).toHaveLength(1)
    const [call] = calls()
    expect(call.stage).toBe('images/hero/editor')
    expect(call.prompt).toContain('IDENTITY')
    expect(call.prompt).toContain(REGEN_STYLE_HINTS.lifestyle)
    expect(call.prompt).toContain('Owner request (may be in Korean): 더 밝게')
    expect(call.refs).toBe(done.source_images.length)
    expect(h.gate).toHaveBeenCalledTimes(1)

    const hero = entryOf(after, 'hero')
    expect(hero.url).not.toBe(before.url)
    expect(hero.pendingRegen).toBe(false)
    expect(hero.editorRegen).toMatchObject({
      status: 'done',
      style: 'lifestyle',
      note: '더 밝게',
      previousUrl: before.url,
    })
    // 다른 컷은 손대지 않는다
    expect(others(after, 'hero')).toStrictEqual(others(done, 'hero'))
    expect(after.cost_usd).toBeGreaterThan(done.cost_usd)
    // final_html은 그대로 — compose를 다시 돌지 않고 바로 done
    expect(after.final_html).toBe(done.final_html)
    expect(resolveStepToRun(after)).toBe('done')

    // 다음 run 한 번으로 done — compose를 거치지 않고 진행률은 끝(100)으로
    expect(after.current_step).toBe('compose')
    const settled = await runPdpStep(after.id, 'user-1')
    expect(settled).toMatchObject({ current_step: 'done', progress: 100, final_html: done.final_html })
    expect(calls()).toHaveLength(1)
  })

  it('게이트 미달이면 재생성 1회, 그래도 미달이면 이전 이미지를 둔다(rejected) — 재생성에도 조정 블록이 붙는다', async () => {
    const done = await doneJob(fixtureImagesJob('A-track-s'))
    h.gate.mockResolvedValue({ score: MISMATCH, costUsd: 0.001 })
    const after = await run(requestRegen(done, 'usage', { note: '창가 배경' }))

    expect(calls().map((c) => c.stage)).toStrictEqual(['images/usage/editor', 'images/usage/regenerate'])
    expect(calls()[1].prompt).toContain('Owner request (may be in Korean): 창가 배경')
    const usage = entryOf(after, 'usage')
    const prior = entryOf(done, 'usage')
    expect(usage).toStrictEqual({
      ...prior,
      pendingRegen: false,
      editorRegen: expect.objectContaining({ status: 'rejected', note: '창가 배경' }),
    })
    expect(usage.editorRegen?.message).toContain('이전 이미지를 유지했습니다')
    expect(resolveStepToRun(after)).toBe('done')
  })

  it('생성이 실패하면 failed로 남기고 재시도 대기를 만들지 않는다(images를 다시 부르지 않는다)', async () => {
    const done = await doneJob(fixtureImagesJob('A-track-s'))
    h.generate.mockRejectedValue(new Error('OpenAI 이미지 생성 실패(500): server error'))
    const after = await run(requestRegen(done, 'hero'))

    const hero = entryOf(after, 'hero')
    expect(hero.url).toBe(entryOf(done, 'hero').url)
    expect(hero.retryPending).toBeUndefined()
    expect(hero.editorRegen?.status).toBe('failed')
    expect(hero.editorRegen?.message).toContain('OpenAI 이미지 생성 실패(500)')
    expect(h.gate).not.toHaveBeenCalled()
    expect(resolveStepToRun(after)).toBe('done')
  })

  it('공급자 잔액 부족이어도 끝난 페이지는 단계 오류로 멈추지 않는다 — 이전 이미지를 두고 사유를 남긴다(R12c)', async () => {
    const done = await doneJob(fixtureImagesJob('A-track-s'))
    h.generate.mockRejectedValue(new ImageProviderBalanceError('higgsfield', '힉스필드 요청 r1 failed — Your credit balance is too low to complete this request.'))
    const after = await run(requestRegen(done, 'hero'))

    const hero = entryOf(after, 'hero')
    expect(hero.url).toBe(entryOf(done, 'hero').url)
    expect(hero.retryPending).toBeUndefined()
    expect(hero.providerBlocked).toBeUndefined()
    expect(hero.editorRegen?.status).toBe('failed')
    expect(hero.editorRegen?.message).toContain('잔액 부족')
    expect(resolveStepToRun(after)).toBe('done')
  })

  it('게이트가 판정하지 못하면(채점 실패) url을 바꾸지 않고 failed로 남긴다', async () => {
    const done = await doneJob(fixtureImagesJob('A-track-s'))
    h.gate.mockResolvedValue({ score: null, costUsd: 0.001 })
    const after = await run(requestRegen(done, 'hero'))
    const hero = entryOf(after, 'hero')
    expect(hero.url).toBe(entryOf(done, 'hero').url)
    expect(hero.editorRegen).toMatchObject({ status: 'failed' })
    expect(hero.editorRegen?.message).toContain('채점 실패')
    expect(calls()).toHaveLength(1)
  })

  it('원천 사진을 받지 못하면(참조 0장) 게이트를 판정할 수 없어 생성하지 않고 끝낸다(지출 0)', async () => {
    const done = await doneJob(fixtureImagesJob('A-track-s'))
    h.fetchImage.mockResolvedValue(null)
    const after = await run(requestRegen(done, 'usage'))
    const usage = entryOf(after, 'usage')
    expect(usage.url).toBe(entryOf(done, 'usage').url)
    expect(usage.editorRegen?.status).toBe('failed')
    expect(usage.editorRegen?.message).toContain('원천 사진을 받지 못해')
    expect(calls()).toHaveLength(0)
    expect(after.cost_usd).toBe(done.cost_usd)
  })

  it('게이트 응답에 점수가 빠지면(미달 신호도 없음) 통과로 보지 않는다', async () => {
    const done = await doneJob(fixtureImagesJob('A-track-s'))
    h.gate.mockResolvedValue({ score: { has_artifact: false, same_product: true }, costUsd: 0.001 })
    const after = await run(requestRegen(done, 'hero'))
    const hero = entryOf(after, 'hero')
    expect(hero.url).toBe(entryOf(done, 'hero').url)
    expect(hero.editorRegen?.status).toBe('failed')
    expect(hero.editorRegen?.message).toContain('점수 없음')
  })

  it('미달 뒤 재생성 뒤 게이트까지 들어갈 시간이 없으면 다시 만들지 않는다(rejected, 생성 1장)', async () => {
    const done = await doneJob(fixtureImagesJob('A-track-s'))
    // 생성 1장에 110초 — 미달 판정 시점 110초 + 재생성 최악 135초 + 게이트 40초 = 285초 > 시간 예산 280초
    let clock = 0
    vi.spyOn(Date, 'now').mockImplementation(() => clock)
    h.generate.mockImplementation(async () => {
      clock += 110_000
      return { base64: 'aW1n', mimeType: 'image/png', model: 'gpt-image-2' }
    })
    h.gate.mockResolvedValue({ score: MISMATCH, costUsd: 0.001 })
    const after = await run(requestRegen(done, 'usage'))
    expect(calls()).toHaveLength(1)
    expect(entryOf(after, 'usage').editorRegen?.status).toBe('rejected')
    expect(entryOf(after, 'usage').editorRegen?.message).toContain('시간·예산이 없어')
  })

  it('편집기 일은 생성 뒤 게이트 시간까지 남을 때만 시작한다 — 모자라면 다음 run의 대기로 남는다', async () => {
    const done = await doneJob(fixtureImagesJob('A-track-s'))
    let clock = 0
    vi.spyOn(Date, 'now').mockImplementation(() => clock)
    h.generate.mockImplementation(async () => {
      clock += 110_000
      return { base64: 'aW1n', mimeType: 'image/png', model: 'gpt-image-2' }
    })
    // hero가 110초에 끝난 뒤 usage: 110 + 135 + 40 = 285초 > 280초 — 시작하지 않는다
    const after = await run(requestRegen(requestRegen(done, 'usage'), 'hero'))
    expect(calls().map((c) => c.stage)).toStrictEqual(['images/hero/editor'])
    expect(entryOf(after, 'hero').editorRegen?.status).toBe('done')
    expect(entryOf(after, 'usage')).toMatchObject({ pendingRegen: true, editorRegen: { status: 'pending' } })
    expect(resolveStepToRun(after)).toBe('images')
  })

  it('예산 막힘에 편집기 아닌 일도 섞여 있으면 편집기 요청은 failed로 끝내고 단계 실패로 알린다', async () => {
    const done = await doneJob(fixtureImagesJob('A-track-s'))
    const missing = { ...done, section_images: done.section_images.filter((e) => e.section !== 'usage') }
    vi.mocked(checkMonthlyBudget).mockResolvedValueOnce({ allowed: false, spentUsd: 50, budgetUsd: 50 })
    await expect(run(requestRegen(missing, 'hero'))).rejects.toThrow('월 AI 예산')
    expect(entryOf(h.job!, 'hero').editorRegen?.status).toBe('failed')
    expect(calls()).toHaveLength(0)
  })

  it('두 컷을 한 run에서 — hero가 먼저 끝나고, 다른 컷은 바뀐 hero를 스타일 참조로 쓴다', async () => {
    const done = await doneJob(fixtureImagesJob('A-track-s'))
    const both = requestRegen(requestRegen(done, 'usage'), 'hero')
    const after = await run(both)
    expect(calls().map((c) => c.stage)).toStrictEqual(['images/hero/editor', 'images/usage/editor'])
    expect(calls()[1].refs).toBe(done.source_images.length + 1)
    expect(entryOf(after, 'hero').editorRegen?.status).toBe('done')
    expect(entryOf(after, 'usage').editorRegen?.status).toBe('done')
    expect(resolveStepToRun(after)).toBe('done')
  })

  it('월 예산으로 시작하지 못하면 이전 이미지를 둔 채 failed로 끝내고 단계는 진행한다(대기로 남지 않는다)', async () => {
    const done = await doneJob(fixtureImagesJob('A-track-s'))
    vi.mocked(checkMonthlyBudget).mockResolvedValueOnce({ allowed: false, spentUsd: 50, budgetUsd: 50 })
    const after = await run(requestRegen(done, 'hero'))
    const hero = entryOf(after, 'hero')
    expect(calls()).toHaveLength(0)
    expect(hero).toMatchObject({
      url: entryOf(done, 'hero').url,
      pendingRegen: false,
      editorRegen: { status: 'failed' },
    })
    expect(hero.editorRegen?.message).toContain('월 AI 예산')
    expect(after.current_step).toBe('compose')
    expect(resolveStepToRun(after)).toBe('done')
  })

  it('Track I: 바꾼 장식 대상 컷은 같은 run에서 장식을 다시 고른다', async () => {
    const done = await doneJob(annotatedImagesJob())
    const target = selectAnnotationTargets(done)[0]
    expect(target).toBeDefined()
    const after = await run(requestRegen(done, target.section))
    const entry = entryOf(after, target.section)
    expect(entry.editorRegen?.status).toBe('done')
    expect(entry.url).not.toBe(target.url)
    expect(entry.annotationStatus).toBeDefined()
    expect(resolveStepToRun(after)).toBe('done')
  })

  it('옵션 사진 가드 잡: 태스크 프롬프트의 가드가 그대로 붙고, 문구 속 사진 없는 옵션 이름은 지운다', async () => {
    const done = await doneJob(optionImagesJob())
    await run(requestRegen(done, 'hero', { note: '체리 말고 데이지를 크게' }))

    const coverage = optionPhotoCoverage(optionSpecOf(done.spec_sheet, done.analysis))!
    const [call] = calls()
    expect(call.prompt).toContain(optionPhotoGuard(coverage))
    const editorBlock = call.prompt.split('EDITOR REGENERATION REQUEST')[1]
    expect(editorBlock).toContain('데이지')
    expect(editorBlock).not.toContain('체리')
  })
})

describe('지금 컷을 바탕으로 고치기·유지할 것(P1-4)', () => {
  it('지금 컷을 참조 맨 끝에 붙이고 hero 스타일 참조는 뺀다 — 지시문에 지금 컷 안내·유지할 것', async () => {
    const done = await doneJob(fixtureImagesJob('A-track-s'))
    const current = entryOf(done, 'usage').url
    h.fetchImage.mockClear()
    await run(requestRegen(done, 'usage', { note: '창가 배경', keep: '제품 각도', useCurrent: true }))
    const [call] = calls()
    expect(call.prompt).toContain('The LAST attached reference image is the CURRENT version of this cut.')
    expect(call.prompt).toContain('Keep unchanged (owner, may be in Korean): 제품 각도')
    expect(call.prompt).not.toContain('STYLE REFERENCE')
    expect(call.refs).toBe(done.source_images.length + 1)
    const fetched = h.fetchImage.mock.calls.map(([url]) => url)
    expect(fetched).toContain(current)
    expect(fetched).not.toContain(entryOf(done, 'hero').url)
  })

  it('지금 컷을 받지 못하면 예전처럼 만든다(지금 컷 안내 없음, hero 스타일 참조 그대로)', async () => {
    const done = await doneJob(fixtureImagesJob('A-track-s'))
    const current = entryOf(done, 'usage').url
    h.fetchImage.mockImplementation(async (url: unknown) => (url === current ? null : { data: 'aW1n', mediaType: 'image/png' }))
    await run(requestRegen(done, 'usage', { useCurrent: true }))
    const [call] = calls()
    expect(call.prompt).not.toContain('CURRENT version')
    expect(call.prompt).toContain('STYLE REFERENCE')
    expect(call.refs).toBe(done.source_images.length + 1)
  })
})

describe('편집기 사후 재생성(W5b) — lean 잡이 만들지 않은 골격 밖 섹션', () => {
  const NOW = Date.parse(DONE_AT)

  it('아는 키는 받아 새 컷을 끝에 덧붙인다 — 같은 프롬프트·hero 스타일 참조·게이트, previousUrl 없음·added', async () => {
    const done = await doneJob(leanImagesJob())
    expect(done.section_images.some((e) => e.section === 'size_comparison')).toBe(false)
    expect(planEditorRegen(done, { section: 'size_comparison' }, NOW)).toMatchObject({
      ok: true,
      block: null,
      runner: 'web',
      estimate: { billed: true },
    })
    const requested = requestRegen(done, 'size_comparison')
    expect(resolveStepToRun(requested)).toBe('images')
    const after = await run(requested)

    expect(calls().map((c) => c.stage)).toStrictEqual(['images/size_comparison/editor'])
    const known = buildKnownImageTasks(done).find((t) => t.section === 'size_comparison')!
    expect(calls()[0].prompt.startsWith(known.prompt)).toBe(true)
    expect(calls()[0].refs).toBe(done.source_images.length + 1)
    expect(h.gate).toHaveBeenCalledTimes(1)

    const added = entryOf(after, 'size_comparison')
    expect(added.url).toContain('size_comparison')
    expect(added.pendingRegen).toBe(false)
    expect(added.editorRegen).toMatchObject({ status: 'done', added: true })
    expect(added.editorRegen).not.toHaveProperty('previousUrl')
    // 다른 컷·순서는 그대로, 새 컷은 끝에. 잡 태스크(lean)는 바뀌지 않는다 — 완료 판정·사용률에 섞이지 않는다
    expect(after.section_images.slice(0, -1)).toStrictEqual(done.section_images)
    expect(after.section_images.at(-1)?.section).toBe('size_comparison')
    expect(buildImageTasks(after)).toStrictEqual(buildImageTasks(done))
    expect(after.final_html).toBe(done.final_html)
    expect(resolveStepToRun(after)).toBe('done')
  })

  it('생성이 실패하면 대기를 남기지 않고 빈 항목에 사유만 남긴다 — 다시 요청할 수 있다', async () => {
    const done = await doneJob(leanImagesJob())
    h.generate.mockRejectedValue(new Error('OpenAI 이미지 생성 실패(500): server error'))
    const after = await run(requestRegen(done, 'size_comparison'))

    const added = entryOf(after, 'size_comparison')
    expect(added).toMatchObject({ url: '', pendingRegen: false, editorRegen: { status: 'failed', added: true } })
    expect(added.editorRegen?.message).toContain('새 사진을 넣지 않았습니다')
    expect(added.editorRegen?.message).not.toContain('이전 이미지')
    expect(h.gate).not.toHaveBeenCalled()
    expect(resolveStepToRun(after)).toBe('done')
    expect(planEditorRegen(after, { section: 'size_comparison' }, NOW)).toMatchObject({ ok: true, block: null })
  })

  it('게이트 미달이면 재생성 1회 뒤 rejected — 새 컷을 넣지 않고 빈 항목에 사유만 남긴다', async () => {
    const done = await doneJob(leanImagesJob())
    h.gate.mockResolvedValue({ score: MISMATCH, costUsd: 0.001 })
    const after = await run(requestRegen(done, 'size_comparison'))
    expect(calls().map((c) => c.stage)).toStrictEqual([
      'images/size_comparison/editor',
      'images/size_comparison/regenerate',
    ])
    const added = entryOf(after, 'size_comparison')
    expect(added).toMatchObject({ url: '', pendingRegen: false, editorRegen: { status: 'rejected', added: true } })
    expect(added.editorRegen?.message).toContain('새 사진을 넣지 않았습니다')
    expect(resolveStepToRun(after)).toBe('done')
  })

  it('월 예산으로 시작하지 못하면 failed로 끝내고 대기로 남지 않는다(지출 0)', async () => {
    const done = await doneJob(leanImagesJob())
    vi.mocked(checkMonthlyBudget).mockResolvedValueOnce({ allowed: false, spentUsd: 50, budgetUsd: 50 })
    const after = await run(requestRegen(done, 'size_comparison'))
    expect(calls()).toHaveLength(0)
    const added = entryOf(after, 'size_comparison')
    expect(added).toMatchObject({ url: '', pendingRegen: false, editorRegen: { status: 'failed', added: true } })
    expect(added.editorRegen?.message).toContain('월 AI 예산')
    expect(added.editorRegen?.message).toContain('새 사진을 넣지 않았습니다')
    expect(after.cost_usd).toBe(done.cost_usd)
    expect(resolveStepToRun(after)).toBe('done')
  })

  it('효과 컷(comparison_scene)은 참조 없이 만든다 — 태스크 규칙 그대로', async () => {
    const done = await doneJob(leanImagesJob())
    const after = await run(requestRegen(done, 'comparison_scene'))
    expect(calls().map((c) => c.stage)).toStrictEqual(['images/comparison_scene/editor'])
    expect(calls()[0].refs).toBe(0)
    expect(entryOf(after, 'comparison_scene').editorRegen).toMatchObject({ status: 'done', added: true })
  })

  it('시간이 모자라 시작하지 못한 골격 밖 요청은 다음 run의 대기로 남는다', async () => {
    const done = await doneJob(leanImagesJob())
    let clock = 0
    vi.spyOn(Date, 'now').mockImplementation(() => clock)
    h.generate.mockImplementation(async () => {
      clock += 110_000
      return { base64: 'aW1n', mimeType: 'image/png', model: 'gpt-image-2' }
    })
    // hero가 110초에 끝난 뒤 size_comparison: 110 + 135 + 40 = 285초 > 280초 — 시작하지 않는다
    const after = await run(requestRegen(requestRegen(done, 'size_comparison'), 'hero'))
    expect(calls().map((c) => c.stage)).toStrictEqual(['images/hero/editor'])
    expect(entryOf(after, 'size_comparison')).toMatchObject({
      pendingRegen: true,
      editorRegen: { status: 'pending', added: true },
    })
    expect(after.current_step).toBe('images')
    expect(resolveStepToRun(after)).toBe('images')

    const next = await run(after)
    expect(calls().map((c) => c.stage)).toStrictEqual(['images/hero/editor', 'images/size_comparison/editor'])
    expect(entryOf(next, 'size_comparison').editorRegen).toMatchObject({ status: 'done', added: true })
    expect(resolveStepToRun(next)).toBe('done')
  })

  it('모르는 키의 남은 대기는 images를 부르지 않는다(영원히 돌지 않게)', async () => {
    const done = await doneJob(leanImagesJob())
    expect(planEditorRegen(done, { section: 'nope' }, NOW)).toMatchObject({ ok: false, status: 400 })
    const stale = requestRegen(done, 'nope')
    expect(resolveStepToRun(stale)).toBe('done')
  })
})

describe('요청 검사(planEditorRegen)', () => {
  it('완료 잡은 통과 — 잡 모델 단가로 추정하고 웹 실행기다', async () => {
    const done = await doneJob(fixtureImagesJob('A-track-s'))
    const plan = planEditorRegen(done, { section: 'hero' }, Date.parse(DONE_AT))
    expect(plan).toMatchObject({ ok: true, block: null, runner: 'web', estimate: { billed: true } })
  })

  it('모르는 섹션은 400이다 — 아는 섹션은 이미지가 없어도(생성 실패) 받는다(새로 만든다)', async () => {
    const done = await doneJob(fixtureImagesJob('A-track-s'))
    expect(planEditorRegen(done, { section: 'nope' })).toMatchObject({ ok: false, status: 400 })
    expect(planEditorRegen(done, { section: 'features:99' })).toMatchObject({ ok: false, status: 400 })
    const noUrl = {
      ...done,
      section_images: done.section_images.map((e) => (e.section === 'hero' ? { ...e, url: '', error: 'x' } : e)),
    }
    expect(planEditorRegen(noUrl, { section: 'hero' }, Date.parse(DONE_AT))).toMatchObject({ ok: true, block: null })
  })

  it('막히는 사유: 완료 전·진행 잠금·이미 대기', async () => {
    const done = await doneJob(fixtureImagesJob('A-track-s'))
    const now = Date.parse(DONE_AT)
    expect(planEditorRegen({ ...done, final_html: null }, { section: 'hero' }, now)).toMatchObject({
      block: { code: 'not_ready' },
    })
    const leased = { ...done, updated_at: new Date(now + 300_000).toISOString() }
    expect(planEditorRegen(leased, { section: 'hero' }, now)).toMatchObject({ block: { code: 'busy' } })
    // 잠금 기한의 마지막 30초(잡 모듈은 잠금으로 보지 않는 여유 구간)도 막는다
    const tail = { ...done, updated_at: new Date(now + 10_000).toISOString() }
    expect(planEditorRegen(tail, { section: 'hero' }, now)).toMatchObject({ block: { code: 'busy' } })
    const pending = requestRegen(done, 'hero')
    expect(planEditorRegen(pending, { section: 'hero' }, now)).toMatchObject({ block: { code: 'already_pending' } })
    // 다른 섹션의 편집기 요청은 막지 않는다(연달아 요청)
    expect(planEditorRegen(pending, { section: 'usage' }, now)).toMatchObject({ ok: true, block: null })
    // 단계 실패로 멈춘 잡의 대기는 처리되지 않으므로 다시 요청할 수 있다
    expect(planEditorRegen({ ...pending, current_step: 'failed' }, { section: 'hero' }, now)).toMatchObject({
      ok: true,
      block: null,
    })
  })

  it('식별 카드가 없는 잡은 other_work(되돌리면 유료 판독을 다시 한다), 바꾼 컷의 장식 대기는 편집기 몫이라 막지 않는다', async () => {
    const done = await doneJob(fixtureImagesJob('A-track-s'))
    const noCard = { ...done, design_prompts: { ...done.design_prompts, identity_card: undefined } }
    expect(hasOtherImageWork(noCard)).toBe(true)
    expect(otherImageWorkReason(noCard)).toContain('식별 카드')
    // 원천 사진도 실물 옵션 사진도 없으면 images가 판독하지 않는다 — 막지 않는다
    expect(hasOtherImageWork({ ...noCard, source_images: [] })).toBe(false)
    // 원천 사진이 없어도 옵션 사진 가드 잡은 실물 옵션 사진을 참조로 받아 판독한다
    const optionDone = await doneJob(optionImagesJob())
    const optionNoCard = {
      ...optionDone,
      source_images: [],
      design_prompts: { ...optionDone.design_prompts, identity_card: undefined },
    }
    expect(hasOtherImageWork(optionNoCard)).toBe(true)

    const doneI = await doneJob(annotatedImagesJob())
    const target = selectAnnotationTargets(doneI)[0]
    const regenerated = {
      ...doneI,
      section_images: doneI.section_images.map((e): SectionImage => {
        if (e.section !== target.section) return e
        // 편집기 재생성이 끝난 새 항목 — 이전 컷의 장식 기록은 따라오지 않는다
        const next: SectionImage = {
          ...e,
          url: `${e.url}?v2`,
          editorRegen: { requestedAt: DONE_AT, status: 'done', previousUrl: e.url },
        }
        delete next.annotationStatus
        delete next.annotations
        return next
      }),
    }
    expect(resolveStepToRun(regenerated)).toBe('images')
    expect(hasOtherImageWork(regenerated)).toBe(false)
  })

  it('요청 밖 이미지 일이 있으면 other_work — 빠진 컷·게이트 재생성 대기', async () => {
    const done = await doneJob(fixtureImagesJob('A-track-s'))
    const now = Date.parse(DONE_AT)
    const missing = { ...done, section_images: done.section_images.filter((e) => e.section !== 'usage') }
    expect(hasOtherImageWork(missing)).toBe(true)
    expect(planEditorRegen(missing, { section: 'hero' }, now)).toMatchObject({ block: { code: 'other_work' } })
    const gatePending = {
      ...done,
      section_images: done.section_images.map(
        (e): SectionImage => (e.section === 'usage' ? { ...e, pendingRegen: true } : e)
      ),
    }
    expect(planEditorRegen(gatePending, { section: 'hero' }, now)).toMatchObject({ block: { code: 'other_work' } })
    expect(hasOtherImageWork(done)).toBe(false)
  })

  it('디자인 컷 잡인데 계획이 기록되지 않았으면 other_work — 되돌리면 images가 계획을 새로 써 편집기 문서가 바뀐다', async () => {
    const done = await doneJob(fixtureImagesJob('A-track-s'))
    expect(done.section_plan.designcut).toBeUndefined()
    h.designcut = true
    expect(hasOtherImageWork(done)).toBe(true)
    expect(planEditorRegen(done, { section: 'hero' }, Date.parse(DONE_AT))).toMatchObject({
      block: { code: 'other_work' },
    })
  })

  it('codex-image 잡은 로컬 실행기·0원이다', async () => {
    const done = await doneJob(fixtureImagesJob('A-track-s'))
    const plan = planEditorRegen({ ...done, image_model: 'codex-image' }, { section: 'hero' }, Date.parse(DONE_AT))
    expect(plan).toMatchObject({ ok: true, runner: 'local', estimate: { billed: false, maxImageUsd: 0 } })
  })
})

describe('월 예산(regenBudgetBlock)', () => {
  const billed: RegenEstimate = { model: 'gpt-image-2', quality: 'high', billed: true, imageUsd: 0.2, maxImageUsd: 0.4 }
  const free: RegenEstimate = { model: 'codex-image', quality: 'high', billed: false, imageUsd: 0, maxImageUsd: 0 }

  it('한도가 찼으면 구독 모델도 막는다(게이트·장식 비전 콜 과금)', () => {
    expect(regenBudgetBlock(free, { allowed: false, spentUsd: 50, budgetUsd: 50 })).toMatchObject({ code: 'budget' })
  })

  it('남은 한도(전역·에이전트 중 작은 쪽)가 최대 비용보다 작으면 막는다', () => {
    expect(regenBudgetBlock(billed, { allowed: true, spentUsd: 49.7, budgetUsd: 50 })).toMatchObject({ code: 'budget' })
    expect(regenBudgetBlock(billed, { allowed: true, spentUsd: 10, budgetUsd: 50 })).toBeNull()
    expect(
      regenBudgetBlock(billed, { allowed: true, spentUsd: 10, budgetUsd: 50, agentSpentUsd: 9.8, agentBudgetUsd: 10 })
    ).toMatchObject({ code: 'budget' })
  })

  it('구독 모델은 남은 한도가 작아도 막지 않는다', () => {
    expect(regenBudgetBlock(free, { allowed: true, spentUsd: 49.99, budgetUsd: 50 })).toBeNull()
  })

  it('지출을 읽지 못하면(degraded) 막고 그 사유를 그대로 말한다', () => {
    const block = regenBudgetBlock(free, { allowed: false, spentUsd: 0, budgetUsd: 50, degraded: true })
    expect(block).toMatchObject({ code: 'budget' })
    expect(block?.error).toContain('지출을 읽지 못해')
  })
})
