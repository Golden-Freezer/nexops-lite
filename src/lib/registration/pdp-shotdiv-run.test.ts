/**
 * 컷 목적 다양화(shotdiv) run 재생 — runImagesStep을 designcut2+shotdiv 잡으로 돌려 컷 목적 기록(계획 전)·POINT 컷 목적 블록(디자인 컷
 * 장면 블록 뒤)·구도 지문으로 거의 같은 구도면 다른 각도 1회·이월된 재생성·추가 컷 태스크(계획이 그리는 키만)를 확인한다.
 * 이미지 생성·Vision·DB는 모의(유료 호출 0). 구도 지문은 sharp로 만든 작은 그림으로 실제로 잰다.
 */

import sharp from 'sharp'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ExtraShotPlan, PdpJobRow } from './pdp-state'

const h = vi.hoisted(() => ({
  job: null as PdpJobRow | null,
  calls: [] as Array<{ prompt: string; section: string }>,
  /** 섹션(재생성은 '/angle' 등 접미어 포함)별 돌려줄 그림 — 없으면 디코딩할 수 없는 바이트(지문 없음) */
  images: new Map<string, string>(),
  /** 섹션별 게이트 응답을 부른 순서대로 — 없으면 통과. null은 채점 실패 */
  gates: new Map<string, Array<Record<string, unknown> | null>>(),
  gateCalls: [] as string[],
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
  judgeImageGate: vi.fn(async (_ref: unknown, section: string) => {
    h.gateCalls.push(section)
    const queued = h.gates.get(section)
    const score = queued?.length ? queued.shift()! : { cut: section, same_product: true, consistency: 0.9, has_artifact: false, artifact_reason: '', background_tone_hex: '#FFFFFF' }
    return { score, costUsd: 0.01 }
  }),
}))
vi.mock('@/lib/agents/image/generate', () => ({
  generateImage: vi.fn(async (args: { prompt: string; runContext: { stage: string } }) => {
    const section = args.runContext.stage.replace('images/', '')
    h.calls.push({ prompt: args.prompt, section })
    return { base64: h.images.get(section) ?? 'AAAA', mimeType: 'image/png' }
  }),
}))
vi.mock('./storage', () => ({
  uploadPdpImage: vi.fn(async (_db: unknown, _u: string, _j: string, section: string) => `https://cdn.test/${section}.png`),
}))

import { runImagesStep } from './pdp-image-stage'
import { buildImageTasks } from './pdp-image-tasks'
import { D2_SCENE_HEADER } from './pdp-image-scene'
import { buildDesigncutPlan, d2FeatureCutsOf } from './internalized/designcut-plan'
import { applyDesignSkeleton, resolveDesignSkeleton } from './pdp-enrichment-stage'
import { mergeManualStrategy } from './pdp-strategy-contract'
import { anglePendingError, dHashOf } from './shot-composition'
import { applyShotPurpose, readExtraShots, shotPurposeContextOf } from './internalized/shot-diversity'
import { fixtureToJob, loadEnrichmentFixture } from './__golden__/golden-harness'

const FEATURES = ['vocab', 'persuasion', 'layouts', 'shots', 'annotations', 'mobile', 'options', 'designcut', 'designcut2']

function shotJob(extra: string[], redo: string[]): PdpJobRow {
  const job = fixtureToJob(loadEnrichmentFixture('A-track-i'))
  job.analysis = { ...job.analysis, enrichment: { version: 1, features: [...FEATURES, ...extra] } } as PdpJobRow['analysis']
  const strategy = mergeManualStrategy(job.analysis.recommended_strategy_contract ?? {}, job.spec_sheet, [])
  job.section_plan = applyDesignSkeleton(job.section_plan, resolveDesignSkeleton(job, strategy))
  return {
    ...job,
    spec_sheet: { ...job.spec_sheet, material: 'PE' },
    section_images: job.section_images.filter((s) => !redo.includes(s.section)),
    final_html: null,
    current_step: 'images',
    progress: 80,
  }
}

async function gradientPng(reverse = false): Promise<string> {
  const w = 64
  const raw = Buffer.alloc(w * w * 3)
  for (let y = 0; y < w; y++)
    for (let x = 0; x < w; x++) raw.fill(Math.round(((reverse ? x : w - 1 - x) / (w - 1)) * 255), (y * w + x) * 3, (y * w + x) * 3 + 3)
  return (await sharp(raw, { raw: { width: w, height: w, channels: 3 } }).png().toBuffer()).toString('base64')
}

let GRAD = ''
let GRAD_REV = ''
beforeAll(async () => {
  GRAD = await gradientPng()
  GRAD_REV = await gradientPng(true)
})
beforeEach(() => {
  h.calls = []
  h.images = new Map()
  h.gates = new Map()
  h.gateCalls = []
})

const run = async (job: PdpJobRow, runs = 20) => {
  h.job = job
  for (let i = 0; i < runs && job.current_step === 'images'; i++)
    job = await runImagesStep({} as never, 'user-1', job, { concurrency: 1 })
  return job
}
const promptOf = (section: string) => h.calls.find((c) => c.section === section)?.prompt ?? ''

describe('shotdiv — 컷 목적 기록과 POINT 컷 목적 블록', () => {
  it('첫 run에 컷 목적을 계획보다 먼저 기록하고, POINT 컷은 디자인 컷 장면 블록 뒤에 목적 블록을 단다', async () => {
    const job = await run(shotJob(['shotdiv'], ['hero', 'features:0', 'features:1', 'features:2', 'features:3']))
    const shots = job.section_plan.extra_shots!
    expect(shots.version).toBe(1)
    // POINT 컷 수 = 기록 전 계획의 POINT 사용 수(T10 막이 바꾸지 않는다)
    expect(shots.points).toHaveLength(d2FeatureCutsOf(job.section_plan.designcut!))
    for (const p of shots.points.filter((x) => h.calls.some((c) => c.section === x.key))) {
      const prompt = promptOf(p.key)
      expect(prompt.indexOf('[Shot purpose]'), p.key).toBeGreaterThan(prompt.indexOf(D2_SCENE_HEADER))
      expect(prompt.indexOf(D2_SCENE_HEADER), p.key).toBeGreaterThanOrEqual(0)
    }
    expect(promptOf('hero')).not.toContain('[Shot purpose]')
    expect(job.current_step).toBe('compose')
  })

  it('목적 블록은 잡의 제품군·재료·사양 크기로 짓는다(적용 D4 ⓑ) — K 컷 지시와 같은 접촉·크기·제품군 문장이 실제 프롬프트에 실린다', async () => {
    const base = shotJob(['shotdiv'], ['features:0', 'features:1', 'features:2', 'features:3'])
    const size = '가로 10cm'
    const job = await run({
      ...base,
      analysis: { ...base.analysis, detected_category: 'household' },
      spec_sheet: { ...base.spec_sheet, productFamily: 'kitchen_storage', size },
    } as PdpJobRow)
    const plan = readExtraShots(job.section_plan.extra_shots)
    const context = shotPurposeContextOf(job)
    expect(context.family).toBe('kitchen_storage')
    const drawn = job.section_plan.extra_shots!.points.filter((p) => h.calls.some((c) => c.section === p.key))
    expect(drawn.length).toBeGreaterThan(0)
    let withFamily = 0
    for (const p of drawn) {
      const block = applyShotPurpose('', p.key, plan, size, context)
      expect(promptOf(p.key), p.key).toContain(block)
      if (block !== applyShotPurpose('', p.key, plan, size)) withFamily++
    }
    expect(withFamily).toBeGreaterThan(0)
  })

  it('D2 잡의 추가 컷은 컷마다 T10 섹션 하나다 — 기록 번호·캡션(제목) 그대로 싣고, 그 컷을 목적 블록과 함께 만든다', async () => {
    const job = await run(shotJob(['designlong', 'shotdiv'], []))
    const shots = job.section_plan.extra_shots!.shots
    expect(shots.length).toBeGreaterThanOrEqual(2)
    const t10s = job.section_plan.designcut!.sections.filter((s) => s.template === 'T10')
    expect(t10s).toHaveLength(shots.length)
    shots.forEach((shot, i) => {
      const t10 = t10s.find((s) => s.key === `long:shot:${i}`)!
      expect(t10.text.headline, shot.key).toBe(shot.caption)
      const m10 = t10.modules.find((m) => m.type === 'M10') as { data: { scenes: Array<{ imageKey: string }> } }
      expect(m10.data.scenes.map((scene) => scene.imageKey)).toEqual([shot.key])
    })
    for (const s of shots) {
      expect(promptOf(s.key), s.key).toContain('[Shot purpose]')
      expect(job.section_images.some((e) => e.section === s.key && e.url), s.key).toBe(true)
    }
    expect(job.current_step).toBe('compose')
  })

  it('shotdiv가 없는 디자인 컷 잡은 컷 목적 기록·목적 블록·구도 지문이 없다', async () => {
    h.images.set('features:0', GRAD)
    const job = await run(shotJob([], ['features:0', 'features:1']))
    expect(job.section_plan.extra_shots).toBeUndefined()
    expect(h.calls.some((c) => c.prompt.includes('[Shot purpose]'))).toBe(false)
    expect(job.section_images.some((e) => e.dhash)).toBe(false)
  })
})

describe('shotdiv — 구도 중복(dHash)', () => {
  it('POINT 컷끼리 거의 같은 구도면 뒤 컷을 다른 각도로 한 번 다시 만들고, 새 지문·짝 기록을 남긴다', async () => {
    h.images.set('features:0', GRAD)
    h.images.set('features:1', GRAD)
    h.images.set('features:1/angle', GRAD_REV)
    const job = await run(shotJob(['shotdiv'], ['features:0', 'features:1']))

    const angle = promptOf('features:1/angle')
    expect(angle).toContain('[Different angle]')
    expect(angle).toContain('the features:0 cut')
    expect(h.calls.filter((c) => c.section.startsWith('features:1')).map((c) => c.section)).toEqual([
      'features:1',
      'features:1/angle',
    ])
    const f0 = job.section_images.find((e) => e.section === 'features:0')!
    const f1 = job.section_images.find((e) => e.section === 'features:1')!
    expect(f0.compositionTwin).toBeUndefined()
    expect(f1).toMatchObject({ compositionTwin: { of: 'features:0', distance: 0 }, retried: true })
    expect(f1.dhash).toBe(await dHashOf(GRAD_REV))
    expect(f1.pendingRegen).toBeFalsy()
    expect(f1.compositionTwin?.keptFirst).toBeUndefined()
    // 다시 만든 컷은 게이트를 거쳐 받았다 — 그 판정이 칸에 남는다
    expect(f1.gate?.verdict).toBe('pass')
    // 다시 만든 컷도 게이트를 본다 — 처음 컷 1 + 다른 각도 컷 1
    expect(h.gateCalls.filter((s) => s === 'features:1')).toHaveLength(2)
    expect(job.current_step).toBe('compose')
  })

  describe('다시 만든 컷의 게이트 — 통과를 확인한 컷만 받는다', () => {
    const PASS = { cut: 'features:1', same_product: true, consistency: 0.9, has_artifact: false, artifact_reason: '', background_tone_hex: '#FFFFFF' }
    const prepare = () => {
      h.images.set('features:0', GRAD)
      h.images.set('features:1', GRAD)
      h.images.set('features:1/angle', GRAD_REV)
    }
    const f1Of = (job: PdpJobRow) => job.section_images.find((e) => e.section === 'features:1')!

    it('게이트 미달이면 앞 컷을 두고 사유를 남긴다 — 더 만들지 않는다', async () => {
      prepare()
      h.gates.set('features:1', [PASS, { ...PASS, same_product: false }])
      const job = await run(shotJob(['shotdiv'], ['features:0', 'features:1']))
      const f1 = f1Of(job)
      expect(f1.dhash).toBe(await dHashOf(GRAD))
      expect(f1.compositionTwin).toMatchObject({ of: 'features:0', distance: 0, keptFirst: expect.stringContaining('게이트 미달') })
      expect(f1).toMatchObject({ retried: true, pendingRegen: false })
      expect(f1.error).toBeUndefined()
      expect(h.calls.filter((c) => c.section.startsWith('features:1'))).toHaveLength(2)
      expect(job.current_step).toBe('compose')
    })

    it('채점에 실패해도 받지 않는다 — 판정 못 한 컷을 통과로 치지 않는다', async () => {
      prepare()
      h.gates.set('features:1', [PASS, null])
      const job = await run(shotJob(['shotdiv'], ['features:0', 'features:1']))
      expect(f1Of(job).dhash).toBe(await dHashOf(GRAD))
      expect(f1Of(job).compositionTwin?.keptFirst).toContain('판정 못 함')
    })

    it('이월된 재생성도 같다 — 미달이면 이월 표지를 지우고 앞 컷을 둔다', async () => {
      const base = shotJob(['shotdiv'], [])
      const before = base.section_images.find((e) => e.section === 'features:1')!
      const job0: PdpJobRow = {
        ...base,
        section_images: base.section_images.map((e) =>
          e.section === 'features:1' ? { ...e, pendingRegen: true, error: anglePendingError('features:0'), compositionTwin: { of: 'features:0', distance: 3 } } : e
        ),
      }
      h.images.set('features:1/angle', GRAD_REV)
      h.gates.set('features:1', [{ ...PASS, has_artifact: true, artifact_reason: 'stain' }])
      const job = await run(job0)
      const f1 = f1Of(job)
      expect(f1.url).toBe(before.url)
      expect(f1).toMatchObject({ pendingRegen: false, retried: true, compositionTwin: { of: 'features:0', distance: 3, keptFirst: expect.stringContaining('게이트 미달') } })
      expect(f1.error).toBeUndefined()
      expect(job.current_step).toBe('compose')
    })
  })

  it('이월된 구도 중복 재생성은 다음 run 맨 앞에서 다른 각도 지시로 만든다(게이트 사유 지시가 아니다)', async () => {
    const base = shotJob(['shotdiv'], [])
    const job0: PdpJobRow = {
      ...base,
      section_images: base.section_images.map((e) =>
        e.section === 'features:1'
          ? { ...e, pendingRegen: true, error: anglePendingError('features:0'), compositionTwin: { of: 'features:0', distance: 3 } }
          : e
      ),
    }
    h.images.set('features:1/angle', GRAD_REV)
    const job = await run(job0)
    expect(h.calls[0]?.section).toBe('features:1/angle')
    expect(h.calls[0]?.prompt).toContain('the features:0 cut')
    expect(h.calls[0]?.prompt).not.toContain('구도 중복')
    const f1 = job.section_images.find((e) => e.section === 'features:1')!
    expect(f1).toMatchObject({ pendingRegen: false, retried: true, compositionTwin: { of: 'features:0', distance: 3 } })
    expect(f1.error).toBeUndefined()
  })
})

describe('shotdiv — 추가 컷 태스크', () => {
  const extraShots: ExtraShotPlan = {
    version: 1,
    shots: [{ key: 'features:6', purpose: 'texture', proves: 'spec.material', caption: '가까이 본 PE 소재' }],
    points: [],
    captions: { checked: 1, unspaced: [], mismatched: [] },
  }
  const withPlan = (extra: string[], drawn: boolean): PdpJobRow => {
    const base = shotJob(extra, [])
    const job = { ...base, section_plan: { ...base.section_plan, extra_shots: extraShots } }
    const plan = buildDesigncutPlan(job)!
    // T10 막(C 계획)이 그 키를 그리는 것과 같은 꼴 — 계획 섹션이 추가 컷 키를 쓴다
    const sections = drawn
      ? [...plan.sections, { ...plan.sections[0], key: 'long:detail', productImageKey: 'features:6', plateKey: null, modules: [] }]
      : plan.sections
    return { ...job, section_plan: { ...job.section_plan, designcut: { ...plan, sections } } }
  }

  it('계획이 그리는 추가 컷 키만 태스크가 된다 — 정사각, 근거 글(사양 소재)을 맥락으로', () => {
    expect(buildImageTasks(withPlan(['shotdiv'], false)).some((t) => t.section === 'features:6')).toBe(false)
    const task = buildImageTasks(withPlan(['shotdiv'], true)).find((t) => t.section === 'features:6')!
    expect(task.aspectRatio).toBe('1:1')
    expect(task.prompt).toContain('- Aspect Ratio: 1:1')
    expect(task.prompt).toContain('Context (scene description for you, never to be drawn as text): PE')
    // shotdiv가 없는 잡은 기록이 있어도 추가 컷을 만들지 않는다
    expect(buildImageTasks(withPlan([], true)).some((t) => t.section === 'features:6')).toBe(false)
  })

  it('단품이면 증명 컷 끝에만 정확히 1개 줄 — 장면 컷·POINT 피처 컷·다른 태스크와 구성 2개 상품은 그대로(적용 D5 P2 ①)', () => {
    const ONE = 'Show exactly 1 piece — no more, no fewer.'
    const withSet = (value: string | null): PdpJobRow => {
      const base = shotJob(['shotdiv'], [])
      const shots: ExtraShotPlan = {
        ...extraShots,
        shots: [...extraShots.shots, { key: 'long_scene:0', purpose: 'scene', proves: 'everyday', caption: '거실 선반 위' }],
      }
      const job = {
        ...base,
        spec_sheet: { ...base.spec_sheet, extraSpecs: value ? [{ key: '구성', value }] : [] },
        section_plan: { ...base.section_plan, extra_shots: shots },
      }
      const plan = buildDesigncutPlan(job)!
      const detail = {
        ...plan.sections[0],
        key: 'long:detail',
        productImageKey: 'features:6',
        plateKey: null,
        modules: [{ type: 'M10' as const, data: { scenes: [{ imageKey: 'long_scene:0', caption: '' }] } }],
      }
      return { ...job, section_plan: { ...job.section_plan, designcut: { ...plan, sections: [...plan.sections, detail] } } }
    }
    const single = buildImageTasks(withSet('1개'))
    const plain = buildImageTasks(withSet(null))
    const proof = single.find((t) => t.section === 'features:6')!
    expect(proof.prompt).toBe(`${plain.find((t) => t.section === 'features:6')!.prompt}\n\n${ONE}`)
    // 장면 컷(long_scene:0)·POINT 피처 컷(features:0~)·사이즈 등 다른 태스크는 줄이 없고 지시 글이 같다
    expect(single.some((t) => t.section === 'long_scene:0')).toBe(true)
    expect(single.some((t) => /^features:[0-5]$/.test(t.section))).toBe(true)
    expect(single.filter((t) => t.prompt.includes('Show exactly')).map((t) => t.section)).toEqual(['features:6'])
    expect(single.filter((t) => t.section !== 'features:6')).toEqual(plain.filter((t) => t.section !== 'features:6'))
    // 구성 2개는 지금 그대로
    expect(buildImageTasks(withSet('2개'))).toEqual(plain)
  })
})
