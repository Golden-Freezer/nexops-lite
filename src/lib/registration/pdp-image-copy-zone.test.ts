/**
 * D2-3 첫 화면 글자 자리 run 재생(C4) — designcut2 잡의 hero·cta를 다시 만들게 해 runImagesStep을 끝까지 돌린다. hero 생성물은 sharp로
 * 만든 실제 PNG(위쪽 띠가 고른 것·줄무늬)라 측정이 실제로 돈다. 이미지 생성·Vision·DB·스토리지는 모의(유료 호출 0).
 */

import sharp from 'sharp'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PdpJobRow, SectionImage } from './pdp-state'

const h = vi.hoisted(() => ({
  job: null as PdpJobRow | null,
  calls: [] as Array<{ prompt: string; section: string; refs: string[] }>,
  heroImages: [] as string[],
  failStage: '',
  uploads: {} as Record<string, number>,
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
  judgeImageGate: vi.fn(),
}))
vi.mock('@/lib/agents/image/generate', () => ({
  generateImage: vi.fn(
    async (args: { prompt: string; referenceImages: Array<{ base64: string }>; runContext: { stage: string } }) => {
      const section = args.runContext.stage.replace('images/', '')
      h.calls.push({ prompt: args.prompt, section, refs: args.referenceImages.map((r) => r.base64) })
      if (section === h.failStage) throw new Error('500 upstream')
      const queued = section.startsWith('hero') ? h.heroImages.shift() : undefined
      return { base64: queued ?? 'AAAA', mimeType: 'image/png' }
    }
  ),
}))
// url은 섹션별 번호(hero-1, hero-2 …) — 함께 도는 다른 컷의 업로드 수에 기대지 않는다
vi.mock('./storage', () => ({
  uploadPdpImage: vi.fn(async (_db: unknown, _u: string, _j: string, section: string) => {
    h.uploads[section] = (h.uploads[section] ?? 0) + 1
    return `https://cdn.test/${section}-${h.uploads[section]}.png`
  }),
}))

import { judgeImageGate } from '@/lib/agents/registration/pdp-image-agent'
import { runImagesStep } from './pdp-image-stage'
import { measureHeroCopyZone } from './designcut-photo'
import { COPY_ZONE_HEADER, HERO_COPY_ZONE } from './internalized/hero-copy-zone'
import { applyDesignSkeleton, resolveDesignSkeleton } from './pdp-enrichment-stage'
import { mergeManualStrategy } from './pdp-strategy-contract'
import { fixtureToJob, loadEnrichmentFixture } from './__golden__/golden-harness'

const FEATURES = ['vocab', 'persuasion', 'layouts', 'shots', 'annotations', 'mobile', 'options', 'designcut']
const GATE_PASS = {
  cut: 'hero',
  same_product: true,
  background_tone_hex: '#f5f0ea',
  consistency: 0.95,
  has_artifact: false,
  artifact_reason: '',
}
const GATE_FAIL = { ...GATE_PASS, same_product: false, consistency: 0.4, artifact_reason: '다른 상품' }
/** 재생성 + 게이트(135초 + 40초)는 들어가지 않지만 hero 생성(135초)은 시작할 수 있는 run 예산 */
const SHORT_BUDGET = 174_999

/** 디자인 컷 잡(extra로 designcut2) — hero·cta를 지우고 헌장도 비워 이번 run이 다시 만든다(cta는 hero 뒤에 시작하는 상품 컷) */
function heroRedoJob(extra: string[], hero?: SectionImage): PdpJobRow {
  const job = fixtureToJob(loadEnrichmentFixture('A-track-i'))
  job.analysis = { ...job.analysis, enrichment: { version: 1, features: [...FEATURES, ...extra] } } as PdpJobRow['analysis']
  const strategy = mergeManualStrategy(job.analysis.recommended_strategy_contract ?? {}, job.spec_sheet, [])
  job.section_plan = applyDesignSkeleton(job.section_plan, resolveDesignSkeleton(job, strategy))
  const kept = job.section_images.filter((s) => s.section !== 'hero' && s.section !== 'cta')
  return {
    ...job,
    final_html: null,
    current_step: 'images',
    progress: 80,
    design_prompts: { ...job.design_prompts, style_charter: undefined },
    section_images: hero ? [hero, ...kept] : kept,
  }
}

/** 3:4 첫 화면 컷 — 위 36%는 고른 밝은 벽(calm) 또는 창살 줄무늬(busy), 그 아래 상품 덩어리 */
async function heroPng(top: 'calm' | 'busy'): Promise<string> {
  const w = 192
  const ht = 256
  const raw = Buffer.alloc(w * ht * 3)
  for (let y = 0; y < ht; y++) {
    for (let x = 0; x < w; x++) {
      const v = y < ht * 0.36 ? (top === 'calm' ? 236 : Math.floor(x / 6) % 2 ? 40 : 220) : x > 40 && x < 152 && y > 110 ? 60 : 200
      raw.fill(v, (y * w + x) * 3, (y * w + x) * 3 + 3)
    }
  }
  return (await sharp(raw, { raw: { width: w, height: ht, channels: 3 } }).png().toBuffer()).toString('base64')
}

/** run을 끝까지 — budgets[i]가 있으면 i번째 run의 시간 예산 */
async function runToEnd(job: PdpJobRow, budgets: number[] = []): Promise<PdpJobRow> {
  h.job = job
  for (let i = 0; i < 20 && job.current_step === 'images'; i++) {
    job = await runImagesStep({} as never, 'user-1', job, budgets[i] ? { budgetMs: budgets[i] } : {})
  }
  return job
}

/** hero 게이트만 차례대로 정한 결과를 낸다(나머지 컷·남은 차례는 통과) */
function heroGates(...scores: Array<typeof GATE_PASS | null>) {
  let n = 0
  vi.mocked(judgeImageGate).mockImplementation(async (_ref, section) => {
    const score = section === 'hero' && n < scores.length ? scores[n++] : GATE_PASS
    return { score, costUsd: 0 }
  })
}

const heroOf = (job: PdpJobRow): SectionImage => job.section_images.find((s) => s.section === 'hero')!
const heroSections = () => h.calls.filter((c) => c.section.startsWith('hero')).map((c) => c.section)
const indexOf = (section: string) => h.calls.findIndex((c) => c.section === section)
const refOf = (url: string) => Buffer.from(url).toString('base64')

beforeEach(() => {
  h.calls = []
  h.heroImages = []
  h.failStage = ''
  h.uploads = {}
  vi.mocked(judgeImageGate).mockReset()
  vi.mocked(judgeImageGate).mockResolvedValue({ score: GATE_PASS, costUsd: 0 })
})

describe('measureHeroCopyZone — sharp 64px 회색조', () => {
  it('고른 위쪽 띠는 통과, 줄무늬는 detail 미달, 읽지 못하는 바이트는 사유만', async () => {
    const calm = await measureHeroCopyZone(await heroPng('calm'), 1)
    expect(calm).toMatchObject({ version: 1, zone: HERO_COPY_ZONE, attempt: 1, measure: { pass: true, ink: 'dark' } })
    const busy = await measureHeroCopyZone(await heroPng('busy'), 2)
    expect(busy.attempt).toBe(2)
    expect(busy.measure?.pass).toBe(false)
    expect(busy.measure?.reasons).toContain('detail')
    expect(await measureHeroCopyZone('AAAA', 1)).toEqual({ version: 1, zone: HERO_COPY_ZONE, attempt: 1, failed: 'decode_failed' })
  })
})

describe('D2 첫 화면 글자 자리 — runImagesStep 재생', () => {
  it('첫 컷이 미달이면 강화 지시로 한 번 다시 만들어 통과한 컷을 쓴다 — cta는 그 뒤에 바뀐 hero를 참조로 받는다', async () => {
    h.heroImages = [await heroPng('busy'), await heroPng('calm')]
    const job = await runToEnd(heroRedoJob(['designcut2']))

    expect(heroSections()).toEqual(['hero', 'hero/copy-zone'])
    const [first, retry] = h.calls.filter((c) => c.section.startsWith('hero'))
    expect(first.prompt).toContain(COPY_ZONE_HEADER)
    expect(first.prompt).not.toContain('previous attempt')
    expect(retry.prompt).toContain('too much detail')
    // 다시 만든 컷의 게이트도 본다
    expect(vi.mocked(judgeImageGate).mock.calls.filter(([, section]) => section === 'hero')).toHaveLength(2)
    // hero 일(재생성 포함)이 끝난 뒤에야 상품 컷이 시작하고, 스타일 참조는 바뀐 hero다
    expect(indexOf('cta')).toBeGreaterThan(indexOf('hero/copy-zone'))
    const cta = h.calls[indexOf('cta')]
    expect(cta.refs).toContain(refOf('https://cdn.test/hero-2.png'))
    expect(cta.refs).not.toContain(refOf('https://cdn.test/hero-1.png'))

    const hero = heroOf(job)
    expect(hero.url).toBe('https://cdn.test/hero-2.png')
    expect(hero.error).toBeUndefined()
    expect(hero.copyZone).toMatchObject({ attempt: 2, measure: { pass: true }, other: { pass: false } })
    expect(hero.copyZone?.retry).toBeUndefined()
    // D2 상품 장면 컷은 실제 가로/세로를 남긴다(D2-2b 편집기 풀폭 높이·글자 자리) — 시험 PNG는 192×256
    expect(hero.imageAspect).toBe(0.75)
    expect(job.current_step).toBe('compose')
  })

  it('다시 만든 컷도 미달이면 처음 컷을 두고 kept — 더 만들지 않는다(편집기는 지금 T1)', async () => {
    h.heroImages = [await heroPng('busy'), await heroPng('busy')]
    const job = await runToEnd(heroRedoJob(['designcut2']))

    expect(heroSections()).toEqual(['hero', 'hero/copy-zone'])
    const hero = heroOf(job)
    expect(hero.url).toBe('https://cdn.test/hero-1.png')
    expect(hero.copyZone).toMatchObject({ attempt: 1, measure: { pass: false }, retry: 'kept', other: { pass: false } })
  })

  it('다시 만든 컷이 게이트 미달이거나 게이트를 판정하지 못하면 글자 자리를 통과해도 처음 컷을 둔다', async () => {
    for (const second of [GATE_FAIL, null]) {
      h.calls = []
      h.uploads = {}
      heroGates(GATE_PASS, second)
      h.heroImages = [await heroPng('busy'), await heroPng('calm')]
      const job = await runToEnd(heroRedoJob(['designcut2']))

      expect(heroSections()).toEqual(['hero', 'hero/copy-zone'])
      const hero = heroOf(job)
      expect(hero.url).toBe('https://cdn.test/hero-1.png')
      expect(hero.copyZone).toMatchObject({ attempt: 1, retry: 'kept', other: { pass: true } })
    }
  })

  it('재생성 생성이 실패하면 처음 컷과 그 기록을 그대로 두고 kept', async () => {
    h.failStage = 'hero/copy-zone'
    h.heroImages = [await heroPng('busy')]
    const job = await runToEnd(heroRedoJob(['designcut2']))

    const hero = heroOf(job)
    expect(hero.url).toBe('https://cdn.test/hero-1.png')
    expect(hero.error).toBeUndefined()
    expect(hero.retryPending).toBeUndefined()
    expect(hero.copyZone).toMatchObject({ attempt: 1, measure: { pass: false }, retry: 'kept' })
    expect(hero.copyZone?.other).toBeUndefined()
  })

  it('첫 컷이 통과하면 다시 만들지 않는다', async () => {
    h.heroImages = [await heroPng('calm')]
    const job = await runToEnd(heroRedoJob(['designcut2']))

    expect(heroSections()).toEqual(['hero'])
    expect(heroOf(job).copyZone).toMatchObject({ attempt: 1, measure: { pass: true } })
  })

  it('게이트 재생성으로 만든 컷도 재서 미달이면 한 번 더 다시 만든다(hero 3장)', async () => {
    heroGates(GATE_FAIL)
    h.heroImages = [await heroPng('busy'), await heroPng('busy'), await heroPng('calm')]
    const job = await runToEnd(heroRedoJob(['designcut2']))

    expect(heroSections()).toEqual(['hero', 'hero/regenerate', 'hero/copy-zone'])
    const hero = heroOf(job)
    expect(hero.url).toBe('https://cdn.test/hero-3.png')
    expect(hero.copyZone).toMatchObject({ attempt: 2, measure: { pass: true } })
  })

  it('앞 run이 미룬 게이트 재생성(pendingRegen)으로 만든 컷도 같은 규칙', async () => {
    const pending: SectionImage = {
      section: 'hero',
      url: 'https://cdn.test/hero-old.png',
      error: '게이트 미달 — 재생성 대기: 다른 상품',
      pendingRegen: true,
    }
    h.heroImages = [await heroPng('busy'), await heroPng('calm')]
    const job = await runToEnd(heroRedoJob(['designcut2'], pending))

    expect(heroSections()).toEqual(['hero/regenerate', 'hero/copy-zone'])
    expect(heroOf(job)).toMatchObject({ url: 'https://cdn.test/hero-2.png', copyZone: { attempt: 2, measure: { pass: true } } })
  })

  it('이번 run에 재생성 + 게이트 시간이 모자라면 다음 run 맨 앞으로 미루고, 상품 컷도 그때까지 기다린다', async () => {
    h.heroImages = [await heroPng('busy'), await heroPng('calm')]
    let job = heroRedoJob(['designcut2'])
    h.job = job
    job = await runImagesStep({} as never, 'user-1', job, { budgetMs: SHORT_BUDGET })

    expect(heroOf(job).copyZone).toMatchObject({ attempt: 1, measure: { pass: false }, retry: 'pending' })
    expect(indexOf('cta')).toBe(-1)
    expect(job.current_step).toBe('images')

    job = await runToEnd(job)
    expect(heroSections()).toEqual(['hero', 'hero/copy-zone'])
    expect(indexOf('cta')).toBeGreaterThan(indexOf('hero/copy-zone'))
    expect(h.calls[indexOf('cta')].refs).toContain(refOf('https://cdn.test/hero-2.png'))
    expect(heroOf(job)).toMatchObject({ url: 'https://cdn.test/hero-2.png', copyZone: { attempt: 2, measure: { pass: true } } })
    expect(job.current_step).toBe('compose')
  })

  it('미룬 run에도 시간이 모자라면 더 미루지 않고 skipped로 끝낸다', async () => {
    h.heroImages = [await heroPng('busy'), await heroPng('calm')]
    const job = await runToEnd(heroRedoJob(['designcut2']), [SHORT_BUDGET, SHORT_BUDGET])

    expect(heroSections()).toEqual(['hero'])
    expect(heroOf(job)).toMatchObject({
      url: 'https://cdn.test/hero-1.png',
      copyZone: { attempt: 1, measure: { pass: false }, retry: 'skipped' },
    })
    expect(job.current_step).toBe('compose')
  })

  it('잴 수 없는 생성물은 사유만 남기고 다시 만들지 않는다', async () => {
    const job = await runToEnd(heroRedoJob(['designcut2']))

    expect(heroSections()).toEqual(['hero'])
    expect(heroOf(job).copyZone).toEqual({ version: 1, zone: HERO_COPY_ZONE, attempt: 1, failed: 'decode_failed' })
  })

  it('designcut만 켠 잡(짝 D)은 글자 자리 지시·측정·재생성이 없다', async () => {
    h.heroImages = [await heroPng('busy')]
    const job = await runToEnd(heroRedoJob([]))

    expect(heroSections()).toEqual(['hero'])
    expect(h.calls.some((c) => c.prompt.includes(COPY_ZONE_HEADER))).toBe(false)
    expect(heroOf(job).copyZone).toBeUndefined()
    expect(heroOf(job).imageAspect).toBeUndefined()
  })
})
