/**
 * 원본 합성이 images 단계에서 도는지(묶음 4) — 골든 픽스처(A-track-i, pro)를 images 직전으로 되감고 composite 스위치를 켠 뒤
 * runImagesStep을 돌린다. 누끼 백엔드는 가짜(가운데 사각 마스크)를 레지스트리에 등록하고, 자격 판정·이미지 생성·게이트·DB·스토리지는
 * 모의다. 원천 사진은 sharp로 만든 PNG(유료 0·DB 0).
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import sharp from 'sharp'
import type { PdpJobRow } from '../pdp-state'

const h = vi.hoisted(() => ({
  job: null as PdpJobRow | null,
  generate: vi.fn(),
  gate: vi.fn(),
  fetchImage: vi.fn(),
  judge: vi.fn(),
  uploads: [] as string[],
  /** 섹션별 첫 업로드 바이트(base64) — 합성 컷 크기·배경색 확인 */
  uploaded: new Map<string, string>(),
}))

vi.mock('@/lib/agents/budget', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/agents/budget')>()),
  checkMonthlyBudget: vi.fn(async () => ({ allowed: true, spentUsd: 0, budgetUsd: 50 })),
}))
vi.mock('../pdp-jobs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../pdp-jobs')>()),
  updatePdpJob: vi.fn(async (_db: unknown, _user: string, _id: string, patch: Record<string, unknown>) => {
    const job = h.job!
    if (patch.sectionImages !== undefined) job.section_images = patch.sectionImages as PdpJobRow['section_images']
    if (patch.sectionPlan !== undefined) job.section_plan = patch.sectionPlan as PdpJobRow['section_plan']
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
  readIdentityCard: vi.fn(async () => ({ card: 'IDENTITY', costUsd: 0 })),
  judgeImageGate: (...args: unknown[]) => h.gate(...args),
}))
vi.mock('@/lib/agents/registration/pdp-annotation-agent', () => ({
  locateAnnotations: vi.fn(async () => ({ rows: [], costUsd: 0 })),
}))
vi.mock('@/lib/agents/registration/pdp-composite-eligibility-agent', () => ({
  judgeCompositeEligibility: (...args: unknown[]) => h.judge(...args),
}))
vi.mock('@/lib/agents/image/generate', () => ({
  generateImage: (...args: unknown[]) => h.generate(...args),
}))
// K 라인 계획(templatelib, 아래 K 잡 시험만) — 선택·칸 카피 콜은 모델 없이 첫 후보·같은 글(k-line-run 모의와 같은 꼴)
vi.mock('@/lib/agents/registration/pdp-template-agent', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/agents/registration/pdp-template-agent')>()),
  generateTemplateGuideline: vi.fn(async ({ concepts }: { concepts: Array<{ id: string }> }) => ({
    value: { persona: '고객', tone: '말투', concept: { id: concepts[0].id, reason: '' }, alternatives: [] },
    usedFallback: false,
    error: null,
    costUsd: 0,
  })),
  composeTemplateSections: vi.fn(async () => ({ value: [], usedFallback: false, error: null, costUsd: 0 })),
  selectTemplatePicks: vi.fn(async ({ slots }: { slots: Array<{ index: number; candidates: Array<{ id: string }> }> }) => ({
    value: slots.map((slot) => ({ index: slot.index, templateId: slot.candidates[0].id, reason: '' })),
    usedFallback: false,
    error: null,
    costUsd: 0,
  })),
}))
vi.mock('@/lib/agents/registration/pdp-template-copy-agent', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/agents/registration/pdp-template-copy-agent')>()),
  fillTemplateSlots: vi.fn(async ({ sections }: { sections: Array<{ index: number; slots: Array<{ name: string; list?: unknown; tags?: unknown }> }> }) => ({
    values: new Map(sections.map((section) => [section.index, Object.fromEntries(section.slots.filter((slot) => !slot.list && !slot.tags).map((slot) => [slot.name, '글']))])),
    problems: [],
    dropped: [],
    firstProblems: [],
    fixCalls: 0,
    accents: new Map(),
    accentMisses: 0,
    error: null,
    costUsd: 0,
  })),
}))
vi.mock('../storage', () => ({
  uploadPdpImage: vi.fn(async (_db: unknown, _u: string, jobId: string, section: string, base64: string) => {
    h.uploads.push(section)
    if (!h.uploaded.has(section)) h.uploaded.set(section, base64)
    return `https://cdn.test/${jobId}/${section}-${h.uploads.length}.png`
  }),
}))

import { runImagesStep } from '../pdp-image-stage'
import { resolveStepToRun } from '../pdp-pipeline'
import { registerLocalCutoutBackend, type LocalCutoutBackend } from './cutout-backend'
import { fixtureToJob, loadEnrichmentFixture, rewindTo } from '../__golden__/golden-harness'
import { applyDesignSkeleton, resolveDesignSkeleton } from '../pdp-enrichment-stage'
import { mergeManualStrategy } from '../pdp-strategy-contract'
import { buildImageTasks } from '../pdp-image-tasks'
import { kCompositeTargets } from './k-composite'

const PASS = { has_artifact: false, same_product: true, consistency: 0.95, artifact_reason: '' }
let photo: { data: string; mediaType: 'image/png' }
let unregister: (() => void) | null = null

const squareMask: LocalCutoutBackend = async ({ width, height }) => {
  const alpha = new Uint8Array(width * height)
  for (let y = Math.round(height * 0.3); y < Math.round(height * 0.7); y++) {
    for (let x = Math.round(width * 0.3); x < Math.round(width * 0.7); x++) alpha[y * width + x] = 255
  }
  return alpha
}

const stages = () =>
  h.generate.mock.calls.map(([i]) => (i as { runContext?: { stage?: string } }).runContext?.stage ?? '')
const refsOf = (stage: string) =>
  (
    h.generate.mock.calls.find(
      ([i]) => (i as { runContext?: { stage?: string } }).runContext?.stage === stage
    )?.[0] as {
      referenceImages?: unknown[]
    }
  )?.referenceImages?.length ?? -1
const gated = () => h.gate.mock.calls.map(([, section]) => section as string)

/** 합성 실험 갈래 잡 — 스위치 composite + 히어로 모드 '원본'(original, hero까지 합성) */
function compositeJob(
  features = ['vocab', 'persuasion', 'composite'],
  heroImageMode: PdpJobRow['spec_sheet']['heroImageMode'] = 'original'
): PdpJobRow {
  const job = rewindTo(fixtureToJob(loadEnrichmentFixture('A-track-i')), 'images')
  return {
    ...job,
    image_quality: 'medium',
    current_step: 'images',
    spec_sheet: { ...job.spec_sheet, heroImageMode },
    section_plan: { ...job.section_plan, enrichment: { version: 1, features, vocabHash: null } },
  } as PdpJobRow
}

async function run(job: PdpJobRow): Promise<PdpJobRow> {
  h.job = job
  return runImagesStep({} as never, 'user-1', job)
}
async function drive(job: PdpJobRow): Promise<PdpJobRow> {
  let j = job
  for (let i = 0; i < 40 && j.current_step === 'images'; i++) j = await run(j)
  return j
}
const entry = (job: PdpJobRow, section: string) => job.section_images.find((e) => e.section === section)

beforeAll(async () => {
  const side = 360
  const red = await sharp({ create: { width: side, height: side, channels: 3, background: { r: 210, g: 30, b: 30 } } })
    .png()
    .toBuffer()
  const png = await sharp({ create: { width: 900, height: 900, channels: 3, background: { r: 255, g: 255, b: 255 } } })
    .composite([{ input: red, left: 270, top: 270 }])
    .png()
    .toBuffer()
  photo = { data: png.toString('base64'), mediaType: 'image/png' }
})

beforeEach(() => {
  h.uploads = []
  h.uploaded = new Map()
  h.generate.mockReset().mockResolvedValue({ base64: 'aW1n', mimeType: 'image/png', model: 'gpt-image-2' })
  h.gate.mockReset().mockResolvedValue({ score: PASS, costUsd: 0.001 })
  h.fetchImage.mockReset().mockResolvedValue(photo)
  h.judge
    .mockReset()
    .mockResolvedValue({ eligibility: { has_person: false, flat_print: false, reason: 'object' }, costUsd: 0.001 })
  unregister = registerLocalCutoutBackend(squareMask)
})
afterEach(() => {
  unregister?.()
  unregister = null
  vi.restoreAllMocks()
})

describe('images 단계의 원본 합성', () => {
  it('누끼가 되면 hero·premium_hero·product_exposure를 생성 대신 합성하고 게이트를 거치지 않는다 — 나머지는 합성 hero를 스타일 참조로', async () => {
    const start = compositeJob()
    const first = await run(start)

    const record = first.section_plan.composite_source!
    expect(record).toMatchObject({ mode: 'cutout', method: 'isnet', metrics: { longSide: 900 } })
    expect(record.cutoutUrl).toContain('composite-cutout')
    expect(h.judge).toHaveBeenCalledTimes(1)
    expect(h.judge.mock.calls[0][1]).toMatchObject({ userId: 'user-1', stage: 'images/composite-eligibility' })
    for (const section of ['hero', 'premium_hero', 'product_exposure']) {
      expect(entry(first, section)).toMatchObject({ prompt: 'composite:cutout', composite: { mode: 'cutout' } })
    }
    const done = await drive(first)
    expect(stages().some((s) => /^images\/(hero|premium_hero|product_exposure)(\/|$)/.test(s))).toBe(false)
    expect(gated().filter((s) => ['hero', 'premium_hero', 'product_exposure'].includes(s))).toEqual([])
    // 제품이 나오는 생성 컷은 합성 hero를 스타일 참조로 받는다(원천 1장 + hero 1장)
    expect(refsOf('images/usage')).toBe(start.source_images.length + 1)
    expect(done.cost_usd).toBeGreaterThanOrEqual(0.001)
    expect(resolveStepToRun({ ...done, final_html: '<html></html>' })).toBe('done')
    // 판정은 잡당 한 번, 합성 컷도 한 번 — 다음 run은 기록·끝난 섹션을 읽는다(images로 다시 들어가는 run을 하나 더 돌려 본다)
    const again = await run({ ...done, current_step: 'images' })
    expect(h.judge).toHaveBeenCalledTimes(1)
    expect(h.uploads.filter((s) => s === 'hero')).toHaveLength(1)
    expect(h.uploads.filter((s) => s === 'composite-cutout')).toHaveLength(1)
    expect(entry(again, 'hero')?.url).toBe(entry(done, 'hero')?.url)
    // 합성 hero는 생성 크기(3:4 → 1024×1536)와 잡 팔레트 배경(bgMain #fff8f2, 그라데이션 맨 윗줄)
    const hero = Buffer.from(h.uploaded.get('hero')!, 'base64')
    const { data, info } = await sharp(hero).removeAlpha().raw().toBuffer({ resolveWithObject: true })
    expect([info.width, info.height]).toEqual([1024, 1536])
    expect(Array.from(data.subarray(0, 3))).toEqual([255, 248, 242])
  })

  it("hero는 히어로 모드가 '원본(original)'일 때만 합성한다 — studio·lifestyle은 hero를 생성하고 나머지 제품 단독 컷만 합성", async () => {
    for (const mode of ['studio', 'lifestyle'] as const) {
      h.generate.mockClear()
      const job = await drive(compositeJob(undefined, mode))
      expect(entry(job, 'hero')?.composite).toBeUndefined()
      expect(stages()).toContain('images/hero')
      expect(entry(job, 'premium_hero')).toMatchObject({ composite: { mode: 'cutout' } })
    }
  })

  it('누끼 백엔드가 없으면(웹) no_backend로 기록하고 지금처럼 생성한다 — 판정 콜 없음', async () => {
    unregister?.()
    unregister = null
    const job = await drive(compositeJob())
    expect(job.section_plan.composite_source).toMatchObject({ mode: 'skip', reason: 'no_backend' })
    expect(h.judge).not.toHaveBeenCalled()
    expect(stages()).toContain('images/hero')
    expect(entry(job, 'hero')?.composite).toBeUndefined()
  })

  it('사람이 나오는 사진은 원본 직접 배치(direct)로 합성한다', async () => {
    h.judge.mockResolvedValue({ eligibility: { has_person: true, reason: 'a hand' }, costUsd: 0.001 })
    const job = await run(compositeJob())
    expect(job.section_plan.composite_source).toMatchObject({ mode: 'direct', reason: 'has_person' })
    expect(entry(job, 'hero')).toMatchObject({ prompt: 'composite:direct', composite: { mode: 'direct' } })
  })

  it('공급처 표기가 있으면 합성하지 않고 생성한다(판정 비용은 잡에 남는다)', async () => {
    // 판정 비용을 크게 둬 잡 비용에 더해졌는지 가린다(생성·게이트 비용과 섞이지 않게)
    h.judge.mockResolvedValue({ eligibility: { supplier_marks: true }, costUsd: 2 })
    const job = await drive(compositeJob())
    expect(job.section_plan.composite_source).toMatchObject({ mode: 'skip', reason: 'marks' })
    expect(stages()).toContain('images/hero')
    expect(job.cost_usd).toBeGreaterThanOrEqual(2)
  })

  it('스위치가 없는 잡은 하위 단계를 돌지 않는다(기록·판정·업로드 없음 — 기본 경로 그대로)', async () => {
    const job = await drive(compositeJob(['vocab', 'persuasion']))
    expect(job.section_plan.composite_source).toBeUndefined()
    expect(h.judge).not.toHaveBeenCalled()
    expect(h.uploads).not.toContain('composite-cutout')
    expect(stages()).toContain('images/hero')
  })

  it('합성 컷이 실패하면 그 컷만 생성 경로로 간다', async () => {
    const storage = await import('../storage')
    const upload = vi.mocked(storage.uploadPdpImage)
    upload.mockImplementation(async (_db, _u, jobId, section) => {
      h.uploads.push(section)
      if (section === 'premium_hero' && !h.generate.mock.calls.length) throw new Error('storage down')
      return `https://cdn.test/${jobId}/${section}-${h.uploads.length}.png`
    })
    const job = await drive(compositeJob())
    expect(entry(job, 'hero')?.composite?.mode).toBe('cutout')
    expect(entry(job, 'premium_hero')?.composite).toBeUndefined()
    expect(stages()).toContain('images/premium_hero')
    // 합성 실패 컷은 기록에 남는다(compose_error)
    expect(job.section_plan.composite_source?.failedCuts).toEqual(['premium_hero'])
  })
})

describe('K 라인 잡의 원본 합성(결정 카드 c18·J29)', () => {
  const K_FEATURES = ['vocab', 'persuasion', 'layouts', 'shots', 'annotations', 'mobile', 'options', 'designcut', 'designcut2', 'designlayout', 'designlong', 'palette2', 'rhythm', 'flow', 'shotdiv', 'fontpair', 'templatelib']

  /** K 잡(k-line-run과 같은 꼴) — composite는 잡 스위치 목록(section_plan.enrichment)에. 히어로 모드 studio라 대표 컷 hero는 생성한다 */
  function kJob(composite: boolean): PdpJobRow {
    const job = fixtureToJob(loadEnrichmentFixture('A-track-i'))
    const features = composite ? [...K_FEATURES, 'composite'] : K_FEATURES
    job.analysis = { ...job.analysis, enrichment: { version: 1, features } } as PdpJobRow['analysis']
    const strategy = mergeManualStrategy(job.analysis.recommended_strategy_contract ?? {}, job.spec_sheet, [])
    job.section_plan = applyDesignSkeleton(job.section_plan, resolveDesignSkeleton(job, strategy))
    return {
      ...job,
      spec_sheet: { ...job.spec_sheet, material: 'PE', heroImageMode: 'studio' },
      section_plan: { ...job.section_plan, enrichment: { version: 1, features, vocabHash: null } },
      section_images: [],
      final_html: null,
      current_step: 'images',
      progress: 80,
      cost_usd: 1,
    } as PdpJobRow
  }

  it('스위치를 켠 K 잡은 상품 단독·디테일·포장 라벨 칸을 칸 비율로 합성하고 칸 역할을 남긴다 — 게이트·생성 없음, 나머지 칸은 생성', async () => {
    const done = await drive(kJob(true))
    const shots = done.section_plan.templatelib!.shots!
    const targets = kCompositeTargets(done, buildImageTasks(done))
    expect(targets.length).toBeGreaterThan(0)
    expect(done.section_plan.composite_source).toMatchObject({ mode: 'cutout', method: 'isnet' })
    for (const { section, role } of targets) {
      expect(entry(done, section)).toMatchObject({ prompt: 'composite:cutout', composite: { mode: 'cutout', kRole: role } })
      expect(stages()).not.toContain(`images/${section}`)
      expect(gated()).not.toContain(section)
    }
    // 합성하지 않는 K 칸·대표 컷은 지금처럼 생성하고, 옛 섹션 합성(hero)은 히어로 모드 studio라 없다
    const composed = new Set(targets.map((t) => t.section))
    for (const shot of shots.filter((s) => !composed.has(s.key))) {
      expect(entry(done, shot.key)?.composite).toBeUndefined()
      expect(stages()).toContain(`images/${shot.key}`)
    }
    expect(entry(done, 'hero')?.composite).toBeUndefined()
    expect(stages()).toContain('images/hero')
    // 역할마다 첫 칸 하나 — 같은 그림 되풀이 막기
    expect(new Set(targets.map((t) => t.role)).size).toBe(targets.length)
    // 합성 칸 크기 = 같은 칸을 생성할 때 보내는 크기(pdp-image-stage ASPECT_TO_SIZE — 3:4는 1024×1536)
    const GENERATION_SIZE: Record<string, [number, number]> = { '1:1': [1024, 1024], '3:4': [1024, 1536], '2:3': [1024, 1536], '4:3': [1536, 1024] }
    for (const { section } of targets) {
      const { width, height } = await sharp(Buffer.from(h.uploaded.get(section)!, 'base64')).metadata()
      expect([width, height]).toEqual(GENERATION_SIZE[shots.find((s) => s.key === section)!.aspect])
    }
    expect(done.current_step).toBe('compose')
  })

  it('스위치가 꺼진 K 잡은 합성 기록·판정·합성 칸 없이 모든 칸을 생성한다(지금 운영 그대로)', async () => {
    const done = await drive(kJob(false))
    expect(done.section_plan.composite_source).toBeUndefined()
    expect(h.judge).not.toHaveBeenCalled()
    expect(h.uploads).not.toContain('composite-cutout')
    expect(done.section_images.some((e) => e.composite)).toBe(false)
    for (const shot of done.section_plan.templatelib!.shots!) expect(stages()).toContain(`images/${shot.key}`)
  })

  it('누끼 백엔드가 없으면(웹 잡) K 칸도 no_backend로 기록하고 모두 생성한다', async () => {
    unregister?.()
    unregister = null
    const done = await drive(kJob(true))
    expect(done.section_plan.composite_source).toMatchObject({ mode: 'skip', reason: 'no_backend' })
    expect(h.judge).not.toHaveBeenCalled()
    expect(done.section_images.some((e) => e.composite)).toBe(false)
    for (const shot of done.section_plan.templatelib!.shots!) expect(stages()).toContain(`images/${shot.key}`)
  })
})
