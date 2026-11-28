/**
 * 디자인 컷 플레이트 run 재생(D1) — runImagesStep을 designcut 기록 잡으로 돌려 첫 run에 section_plan.designcut이
 * 기록되는지, 플레이트 생성 요청이 플레이트 지시(+ 연령 블록)만 담고 참조 사진·식별카드·스타일 헌장·연출 블록이
 * 없는지, 크기가 정사각·세로인지 확인한다. 이미지 생성·Vision·DB는 모의(유료 호출 0).
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PdpJobRow } from './pdp-state'

const h = vi.hoisted(() => ({
  job: null as PdpJobRow | null,
  calls: [] as Array<{ prompt: string; size: string; refs: number; section: string }>,
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
  fetchImageAsBase64: vi.fn(async (url: string) => ({
    mediaType: 'image/png',
    data: Buffer.from(url).toString('base64'),
  })),
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
    async (args: { prompt: string; size: string; referenceImages: unknown[]; runContext: { stage: string } }) => {
      h.calls.push({
        prompt: args.prompt,
        size: args.size,
        refs: args.referenceImages.length,
        section: args.runContext.stage.replace('images/', ''),
      })
      return { base64: 'AAAA', mimeType: 'image/png' }
    }
  ),
}))
vi.mock('./storage', () => ({
  uploadPdpImage: vi.fn(
    async (_db: unknown, _u: string, _j: string, section: string) => `https://cdn.test/${section}.png`
  ),
}))

import { fetchImageAsBase64 } from '@/lib/agents/registration/thumbnail-vision-agent'
import { judgeImageGate } from '@/lib/agents/registration/pdp-image-agent'
import { runImagesStep } from './pdp-image-stage'
import {
  D2_PRODUCT_SCENE_LINE,
  D2_SCENE_HEADER,
  D2_SHOT_DISTANCE,
  D2_SOLID_REFERENCE_ROLES_TEXT,
  d2PointChapterOf,
  d2ShotDistanceOf,
  SCENE_BACKGROUND_LINE,
} from './pdp-image-scene'
import { describeSceneSet } from './scene-set'
import { buildDesigncutPlan } from './internalized/designcut-plan'
import { applyDesignSkeleton, resolveDesignSkeleton } from './pdp-enrichment-stage'
import { buildAgeComplianceImageBlock } from './compliance-gate'
import { buildPlatePrompt, type PlateTemplate } from '@/lib/agents/registration/prompts/pdp-plate-prompts'
import { designcutStagesOf, styleLightingOf } from './pdp-image-tasks'
import { designcutDrawnKeys } from './internalized/shot-diversity'
import { mergeManualStrategy } from './pdp-strategy-contract'
import { fixtureToJob, loadEnrichmentFixture } from './__golden__/golden-harness'

const FEATURES = ['vocab', 'persuasion', 'layouts', 'shots', 'annotations', 'mobile', 'options', 'designcut']

/**
 * designcut 기록 잡 — 브랜드 스토리(T3c)를 POINT 뒤에 끼워 플레이트 1장이 생기게 한다(2026-10-28부터 상품 컷이 있는 섹션에는
 * 플레이트가 없다). 픽스처 A는 제품 컷이 이미 생성돼 있어 남는 생성은 플레이트뿐이다
 */
function designcutJob(extra: string[] = []): PdpJobRow {
  const job = fixtureToJob(loadEnrichmentFixture('A-track-i'))
  job.analysis = { ...job.analysis, enrichment: { version: 1, features: [...FEATURES, ...extra] } } as PdpJobRow['analysis']
  const strategy = mergeManualStrategy(job.analysis.recommended_strategy_contract ?? {}, job.spec_sheet, [])
  job.section_plan = applyDesignSkeleton(job.section_plan, resolveDesignSkeleton(job, strategy))
  const order = [...job.section_plan.section_order!]
  order.splice(order.indexOf('point_div') + 1, 0, 'concept_desc')
  const skeleton = job.section_plan.internalized_skeleton!
  const stages = [
    ...skeleton.persuasion!.stages,
    { section: 'concept_desc', role: 'brand_story', stage: 'VALUE' as const, reason: 'test' },
  ]
  job.section_plan = {
    ...job.section_plan,
    section_order: order,
    internalized_skeleton: { ...skeleton, persuasion: { ...skeleton.persuasion!, stages } },
  }
  return { ...job, final_html: null, current_step: 'images', progress: 80 }
}

const P02_PHOTO = readFileSync(join(__dirname, 'internalized/__fixtures__/designcut-v2/p02-source-64.png')).toString(
  'base64'
)

beforeEach(() => {
  h.calls = []
})

describe('designcut 플레이트 — runImagesStep 재생', () => {
  it('첫 run에 계획을 기록하고, 플레이트는 플레이트 지시 + 연령 블록만으로 참조 사진 없이 만든다', async () => {
    let job = designcutJob()
    expect(job.section_plan.designcut).toBeUndefined()
    h.job = job
    for (let i = 0; i < 12 && job.current_step === 'images'; i++) job = await runImagesStep({} as never, 'user-1', job)

    const plan = job.section_plan.designcut!
    expect(plan).toBeDefined()
    // 원천 사진 측정을 계획과 같이 기록한다 — 모의 사진(디코딩 불가)이면 실패 사유만 남기고 카피 팔레트로 폴백
    expect(job.section_plan.designcut_photo).toEqual({ version: 1, failed: 'decode_failed' })
    expect(plan.palette.source).toBeUndefined()
    const plates = plan.sections.filter((s) => s.plateKey)
    expect(plates.map((s) => s.template)).toEqual(['T3c'])
    expect(h.calls.map((c) => c.section)).toEqual(plates.map((s) => s.plateKey))

    const age = buildAgeComplianceImageBlock(job.spec_sheet)
    const designPrompts = job.design_prompts
    for (const sec of plates) {
      const call = h.calls.find((c) => c.section === sec.plateKey)!
      const expected = buildPlatePrompt({
        template: sec.template as PlateTemplate,
        palette: plan.palette,
        category: job.analysis.detected_category,
        chapter: sec.chapter,
        productAlpha: sec.productAlpha,
        lighting: styleLightingOf(job),
      })
      expect(call.prompt).toBe(age ? `${expected}\n\n${age}` : expected)
      expect(call.refs).toBe(0)
      expect(call.size).toBe(sec.plateAspect === '1:1' ? '1024x1024' : '1024x1536')
      if (designPrompts.style_charter) expect(call.prompt).not.toContain(designPrompts.style_charter)
      if (designPrompts.identity_card) expect(call.prompt).not.toContain(designPrompts.identity_card)
      expect(call.prompt).not.toContain('REFERENCE ROLES')
    }
    // 플레이트는 section_images에 키 그대로 남고, 장식 단계 뒤 compose로 넘어간다
    expect(plates.every((s) => job.section_images.some((e) => e.section === s.plateKey && e.url))).toBe(true)
    expect(job.current_step).toBe('compose')
  })

  it('원천 사진을 재서 계획보다 먼저 기록하고, 계획은 그 기록으로 만든다(사진 팔레트) — 기록 뒤 재계산과 같다', async () => {
    const source = designcutJob().source_images[0]
    vi.mocked(fetchImageAsBase64).mockImplementation(async (url: string) =>
      url === source
        ? { mediaType: 'image/png', data: P02_PHOTO }
        : { mediaType: 'image/png', data: Buffer.from(url).toString('base64') }
    )
    try {
      let job = designcutJob()
      // 헌장은 첫 run에 만든다 — 픽스처의 기존 헌장을 비워 이번 run이 만들게 한다
      job = { ...job, design_prompts: { ...job.design_prompts, style_charter: undefined } }
      h.job = job
      job = await runImagesStep({} as never, 'user-1', job)
      const record = job.section_plan.designcut_photo!
      expect('failed' in record).toBe(false)
      const plan = job.section_plan.designcut!
      expect(plan.palette).toMatchObject({
        source: 'photo',
        photoBackground: (record as { background: string }).background,
      })
      expect(buildDesigncutPlan({ ...job, section_plan: { ...job.section_plan, designcut: undefined } })).toEqual(plan)
      // 스타일 헌장 배경도 컷 바탕(사진 촬영 배경) — 편집기 상품 섹션 바탕과 같은 값
      expect(job.design_prompts.style_charter).toContain(plan.palette.photoBackground!)
      // 다음 run은 기록을 다시 쓰지 않는다(재측정 없음)
      vi.mocked(fetchImageAsBase64).mockClear()
      const again = await runImagesStep({} as never, 'user-1', job)
      expect(again.section_plan.designcut_photo).toEqual(record)
    } finally {
      vi.mocked(fetchImageAsBase64).mockImplementation(async (url: string) => ({
        mediaType: 'image/png',
        data: Buffer.from(url).toString('base64'),
      }))
    }
  })

  it('생성 범위 밖이 된 섹션의 예전 재생성 대기가 남아도 images 단계를 끝낸다(배포 전환기 — 무한 반복 방지)', async () => {
    let job = designcutJob()
    // 픽스처의 usage 컷(디자인 컷이 안 쓰는 컷)에 게이트 재생성 대기가 남은 채 배포가 바뀐 경우
    job = {
      ...job,
      section_images: job.section_images.map((e) => (e.section === 'usage' ? { ...e, pendingRegen: true } : e)),
    }
    expect(job.section_images.some((e) => e.section === 'usage' && e.pendingRegen)).toBe(true)
    h.job = job
    for (let i = 0; i < 12 && job.current_step === 'images'; i++) job = await runImagesStep({} as never, 'user-1', job)
    expect(job.current_step).toBe('compose')
    expect(job.progress).toBeLessThanOrEqual(100)
  })

  it('designcut 기록이 없는 잡은 계획을 기록하지 않고 플레이트를 만들지 않는다', async () => {
    let job = designcutJob()
    job.analysis = {
      ...job.analysis,
      enrichment: { version: 1, features: FEATURES.slice(0, -1) },
    } as PdpJobRow['analysis']
    job.section_plan = {
      ...job.section_plan,
      enrichment: { ...job.section_plan.enrichment!, features: FEATURES.slice(0, -1) },
    }
    h.job = job
    for (let i = 0; i < 6 && job.current_step === 'images'; i++) job = await runImagesStep({} as never, 'user-1', job)
    expect(job.section_plan.designcut).toBeUndefined()
    expect(h.calls).toEqual([])
  })
})

describe('D2(designcut2) 상품 장면 컷 — runImagesStep 재생(C2)', () => {
  /** 상품 컷을 다시 만들게 한 잡 — 헌장도 비워 이번 run이 만든다 */
  const regenJob = (extra: string[], redo: string[]): PdpJobRow => {
    const base = designcutJob(extra)
    return {
      ...base,
      design_prompts: { ...base.design_prompts, style_charter: undefined },
      section_images: base.section_images.filter((s) => !redo.includes(s.section)),
    }
  }
  const promptOf = (section: string) => h.calls.find((c) => c.section === section)?.prompt ?? ''

  it('첫 화면·POINT·마무리 컷은 세트 안 장면 + 역할별 거리, 헌장 세트 기술은 기록한 아트 디렉션 세트', async () => {
    vi.mocked(judgeImageGate).mockResolvedValue({ score: null, costUsd: 0 })
    const redo = ['hero', 'features:0', 'features:1', 'cta', 'product_exposure']
    let job = regenJob(['designcut2'], redo)
    h.job = job
    for (let i = 0; i < 20 && job.current_step === 'images'; i++) job = await runImagesStep({} as never, 'user-1', job)

    const plan = job.section_plan.designcut!
    const art = plan.artDirection!
    expect(job.design_prompts.style_charter).toContain(`- Set description: ${describeSceneSet(art.set)}`)
    // D2 POINT 5·6번(sub_div 새 특징)의 피처 컷도 이번 run이 만든다
    for (const section of ['hero', 'features:0', 'features:1', 'cta', 'features:4', 'features:5']) {
      const prompt = promptOf(section)
      expect(prompt, section).toContain(D2_PRODUCT_SCENE_LINE)
      expect(prompt, section).not.toMatch(/- Background: solid /)
      expect(prompt, section).toContain(`Shot distance: ${d2ShotDistanceOf(section, d2PointChapterOf(plan, section))}.`)
      expect(prompt, section).not.toContain(D2_SOLID_REFERENCE_ROLES_TEXT)
    }
    // 세트 장면이 아닌 상품 컷(T6 제품 단독)은 단색 바탕 그대로 — 세트 장면 히어로에서 빛·색감만 받는다
    const exposure = promptOf('product_exposure')
    expect(exposure).toMatch(/- Background: solid /)
    expect(exposure).toContain(D2_SOLID_REFERENCE_ROLES_TEXT)
    expect(exposure).not.toContain(D2_SCENE_HEADER)
    expect(job.current_step).toBe('compose')
  })

  it('designcut만 켠 잡(짝 D)은 상품 컷이 단색 바탕 그대로이고 세트 장면 블록이 없다', async () => {
    vi.mocked(judgeImageGate).mockResolvedValue({ score: null, costUsd: 0 })
    let job = regenJob([], ['hero'])
    h.job = job
    for (let i = 0; i < 20 && job.current_step === 'images'; i++) job = await runImagesStep({} as never, 'user-1', job)

    expect(promptOf('hero')).toMatch(/- Background: solid /)
    expect(h.calls.some((c) => c.prompt.includes(D2_SCENE_HEADER))).toBe(false)
  })

  it('계획과 함께 컷마다 무대 이름을 기록하고, 이름은 그 컷 프롬프트의 바탕 갈래와 맞는다 — 프롬프트는 이 기록을 읽지 않는다(적용 D4 ⓐ)', async () => {
    vi.mocked(judgeImageGate).mockResolvedValue({ score: null, costUsd: 0 })
    const counts: Record<string, Record<string, number>> = {}
    let d2Job: PdpJobRow | null = null
    for (const extra of [['designcut2'], []]) {
      h.calls = []
      const base = designcutJob(extra)
      let job: PdpJobRow = { ...base, design_prompts: { ...base.design_prompts, style_charter: undefined }, section_images: [] }
      h.job = job
      for (let i = 0; i < 20 && job.current_step === 'images'; i++) job = await runImagesStep({} as never, 'user-1', job)
      const stages = job.section_plan.designcut_stages!
      expect(stages).toEqual(designcutStagesOf(job))
      // K 라인 잡은 라인 기록이 무대를 갖고 있어 이 기록을 만들지 않는다
      expect(designcutStagesOf({ ...job, analysis: { ...job.analysis, enrichment: { version: 1, features: [...FEATURES, ...extra, 'templatelib'] } } } as PdpJobRow)).toEqual({})
      expect(Object.keys(stages).sort()).toEqual([...designcutDrawnKeys(job.section_plan.designcut)].sort())
      const tally: Record<string, number> = {}
      for (const [section, stage] of Object.entries(stages)) {
        const prompt = promptOf(section)
        expect(prompt, section).not.toBe('')
        tally[stage] = (tally[stage] ?? 0) + 1
        if (stage === 'solid') expect(prompt, section).toMatch(/- Background: solid /)
        else expect(prompt, section).not.toMatch(/- Background: solid /)
        if (stage === 'life') expect([D2_PRODUCT_SCENE_LINE, SCENE_BACKGROUND_LINE].some((line) => prompt.includes(line)), section).toBe(true)
        if (stage === 'macro') expect(prompt, section).toContain(`Shot distance: ${D2_SHOT_DISTANCE.macro}.`)
      }
      counts[extra.join('') || 'designcut'] = tally
      if (extra.length) d2Job = job
    }
    // D2는 세트 안 컷과 매크로 POINT가 있고, 짝 D(designcut만)는 모두 단색 바탕이다
    expect(counts.designcut2.life).toBeGreaterThan(0)
    expect(counts.designcut2.macro).toBeGreaterThan(0)
    expect(Object.keys(counts.designcut)).toEqual(['solid'])
    // POINT 거리는 계획의 장 번호를 따른다(피처 번호와 다르면 장 번호) — 첫 피처 컷을 2장으로 옮기면 매크로다
    const plan = d2Job!.section_plan.designcut!
    const first = plan.sections.find((s) => s.role === 'usp_feature' && s.productImageKey === 'features:0')!
    expect(d2Job!.section_plan.designcut_stages!['features:0']).toBe('life')
    const moved = { ...plan, sections: plan.sections.map((s) => (s === first ? { ...s, chapter: 2 } : s)) }
    expect(designcutStagesOf({ ...d2Job!, section_plan: { ...d2Job!.section_plan, designcut: moved } })['features:0']).toBe('macro')
    // shotdiv 잡은 컷 목적 기록을 따른다 — 다른 장소 장면은 place, 질감은 macro
    const enrichment = d2Job!.section_plan.enrichment!
    const extraShots = { version: 1, shots: [], points: [{ key: 'features:0', purpose: 'scene' }, { key: 'cta', purpose: 'texture' }], captions: { checked: 0, unspaced: [], mismatched: [] } }
    const withPurpose = { ...d2Job!, section_plan: { ...d2Job!.section_plan, enrichment: { ...enrichment, features: [...enrichment.features, 'shotdiv'] }, extra_shots: extraShots } } as PdpJobRow
    expect(designcutStagesOf(withPurpose)).toMatchObject({ 'features:0': 'place', cta: 'macro', hero: 'life' })
  })
})
