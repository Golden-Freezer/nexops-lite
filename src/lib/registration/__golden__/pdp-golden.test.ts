/**
 * Track S·Track I 골든(T0, 01_TEST_PLAN.md §2) — 기준 커밋 동작을 픽스처 A·B·C로 고정한다.
 *   ① analysis 단계 프롬프트·저장 JSON ② research·copy 프롬프트 ③ design 프롬프트·섹션 계획(Track I는 골격 잠금 결과)
 *   ④ 이미지 프롬프트(그라운딩·연령 블록 포함) ⑤ resolveStepToRun 판정표 ⑥ buildEditorDocument 결과
 * 실제 runPdpStep을 단계별로 돌리되 LLM(callAgent·callOpenAiChat)·이미지 생성·DB·스토리지는 모의다.
 * LLM 응답은 픽스처 저장 산출을 그대로 돌려준다(캔드 응답) — 비교 대상은 "입력 프롬프트"와 "저장 산출"이다.
 * 이후 모든 작업에서 Track S 골든은 불변, Track I 골든은 ENRICHMENT 전부 off에서 불변이어야 한다.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PdpJobRow } from '../pdp-state'

const golden = vi.hoisted(() => {
  const DECISION_PROFILE = {
    involvement_level: 'low',
    comparison_intensity: 'low',
    proof_sensitivity: 'medium',
    visual_hook_need: 'high',
    explanation_depth: 'quick',
    price_resistance: 'medium',
    repeatability: 'one_off',
    giftability: 'high',
    urgency_level: 'medium',
  }
  const rec = {
    job: null as unknown as Record<string, unknown>,
    fixture: null as unknown as Record<string, Record<string, unknown>>,
    calls: [] as Array<{ agent: string; model: string; system: string; user: string }>,
    images: [] as Array<{ stage: string; model: string; size: string; refs: number; prompt: string }>,
    patches: [] as Array<Record<string, unknown>>,
  }
  /** agentName별 캔드 응답 — 픽스처 저장 산출을 LLM 원문처럼 돌려준다. null이면 호출 실패로 처리. */
  function cannedText(agent: string): string | null {
    const f = rec.fixture
    const copyFinal = (f.copy_sections?.final ?? {}) as Record<string, unknown>
    switch (agent) {
      case 'registration/pdp-category':
        return JSON.stringify({ category: f.analysis.detected_category ?? 'household' })
      case 'registration/pdp-analysis': {
        const { detected_category: _c, recommended_strategy_contract: _r, ...rest } = f.analysis
        return JSON.stringify({ ...rest, decision_profile: DECISION_PROFILE })
      }
      case 'registration/pdp-research':
        return JSON.stringify(f.research_result)
      case 'registration/pdp-section-planning':
        return JSON.stringify(f.section_plan)
      case 'registration/pdp-design-prompt': {
        const { style_charter: _s, identity_card: _i, ...rest } = f.design_prompts
        return JSON.stringify(rest)
      }
      case 'registration/pdp-copy-stage1':
      case 'registration/pdp-copy-premium':
      case 'registration/pdp-copy-stage2':
      case 'registration/pdp-copy-stage3':
        return JSON.stringify(copyFinal)
      case 'registration/pdp-copy-retry-pointcards':
        return JSON.stringify(copyFinal.pointCards ?? [])
      case 'registration/pdp-image-identity':
        return 'golden identity: shape, colors, parts and count exactly as in the reference photo'
      case 'registration/pdp-image-gate':
        return JSON.stringify({ has_artifact: false, same_product: true, consistency: 0.95, artifact_reason: '' })
      default:
        return null
    }
  }
  return { rec, cannedText }
})

async function respond(options: Record<string, unknown>, parser: (text: string) => unknown, model: string) {
  const { messagesToText } = await import('./golden-harness')
  const agent = String(options.agentName ?? '')
  golden.rec.calls.push({ agent, model, system: String(options.system ?? ''), user: messagesToText(options.messages) })
  const usage = { inputTokens: 0, outputTokens: 0, cost: 0 }
  const text = golden.cannedText(agent)
  if (text === null) {
    return { success: false, error: { message: `golden: 캔드 응답 없음(${agent})`, stage: 'api', attempts: 1 }, usage, duration: 0 }
  }
  try {
    return { success: true, data: parser(text), usage, duration: 0 }
  } catch (e) {
    return { success: false, error: { message: String(e), stage: 'parse', attempts: 1 }, usage, duration: 0 }
  }
}

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({}) }))
vi.mock('@/lib/agents/budget', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/agents/budget')>()),
  checkMonthlyBudget: async () => ({ allowed: true, budgetUsd: 50, spentUsd: 0 }),
  logUsage: async () => true,
}))
vi.mock('@/lib/agents/_base', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/agents/_base')>()),
  callAgent: (options: Record<string, unknown>, parser: (text: string) => unknown) =>
    respond(options, parser, String((options.config as { model?: string } | undefined)?.model ?? '')),
}))
vi.mock('@/lib/agents/openai-chat', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/agents/openai-chat')>()),
  callOpenAiChat: (options: Record<string, unknown>, parser: (text: string) => unknown) =>
    respond(options, parser, String(options.model ?? 'openai-default')),
}))
vi.mock('@/lib/agents/image/generate', () => ({
  generateImage: async (input: Record<string, unknown>) => {
    golden.rec.images.push({
      stage: String((input.runContext as { stage?: string } | undefined)?.stage ?? ''),
      model: String(input.model),
      size: String(input.size ?? ''),
      refs: Array.isArray(input.referenceImages) ? input.referenceImages.length : 0,
      prompt: String(input.prompt),
    })
    return { base64: 'AA', mimeType: 'image/png' }
  },
}))
vi.mock('@/lib/agents/registration/thumbnail-vision-agent', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/agents/registration/thumbnail-vision-agent')>()),
  fetchImageAsBase64: async () => ({ data: 'AA', mediaType: 'image/png' }),
}))
vi.mock('../storage', () => ({
  uploadPdpImage: async (_db: unknown, _u: string, jobId: string, section: string) => `https://golden.test/${jobId}/${section}.png`,
}))
vi.mock('@/lib/sourcing/registration/drafts', () => ({ appendDraftDetailAssets: async () => undefined }))
vi.mock('../pdp-jobs', () => {
  const PATCH_KEYS: Record<string, string> = {
    analysis: 'analysis',
    researchResult: 'research_result',
    designPrompts: 'design_prompts',
    sectionPlan: 'section_plan',
    copySections: 'copy_sections',
    sectionImages: 'section_images',
    finalHtml: 'final_html',
    currentStep: 'current_step',
    progress: 'progress',
    error: 'error',
    costUsd: 'cost_usd',
    corpusVersion: 'corpus_version',
  }
  const copy = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T
  return {
    getPdpJob: async () => copy(golden.rec.job),
    // 잡 진행 잠금은 pdp-jobs-lease.test.ts 몫 — 골든 run은 늘 쥐고, 패치 기록에서 잠금 기한은 뺀다(스냅샷은 산출만)
    isPdpJobLeased: () => false,
    claimPdpJobRun: async () => ({ job: copy(golden.rec.job), leaseUntil: 'golden-lease' }),
    updatePdpJob: async (_db: unknown, _u: string, _id: string, patch: Record<string, unknown>) => {
      const { leaseUntil: _lease, ...recorded } = patch
      golden.rec.patches.push(copy(recorded))
      for (const [key, value] of Object.entries(patch)) {
        if (value !== undefined && PATCH_KEYS[key]) golden.rec.job[PATCH_KEYS[key]] = copy(value)
      }
      return copy(golden.rec.job)
    },
  }
})

import { runPdpStep, resolveStepToRun } from '../pdp-pipeline'
import { assembleEditorDataResponse } from '../editor-data'
import { buildEditorDocument } from '../editor/utils/buildEditorDocument'
import { getCorpusSnapshotV2 } from '../corpus-v2'
import { buildSkeleton } from '../internalized/pdp-internalized-skeleton'
import { mergeManualStrategy } from '../pdp-strategy-contract'
import { sectionFromImageStage } from '../__e2e__/e2e-env'
import {
  GOLDEN_NOW,
  GOLDEN_SUPABASE_URL,
  GOLDEN_USER_ID,
  TRACK_I_KEYS,
  TRACK_I_VARIANT_KEYS,
  TRACK_S_KEYS,
  digestJson,
  digestText,
  dumpGolden,
  fixtureToJob,
  loadEnrichmentFixture,
  normalizeEditorJson,
  rewindTo,
  sha256,
  type FixtureKey,
} from './golden-harness'

function summarizeCalls(key: string, step: string) {
  return golden.rec.calls.map((c, i) => {
    dumpGolden(`${key}.${step}.${i}.${c.agent}`, `${c.system}\n=====\n${c.user}`)
    return { agent: c.agent, model: c.model, system: digestText(c.system), user: digestText(c.user) }
  })
}

/** 픽스처 하나를 골든 대상으로 세우고, 지정 단계 직전 상태에서 runPdpStep을 1회 돌린다. */
async function runFrom(key: FixtureKey, step: Parameters<typeof rewindTo>[1]): Promise<PdpJobRow> {
  const fixture = loadEnrichmentFixture(key)
  golden.rec.fixture = fixture as unknown as Record<string, Record<string, unknown>>
  golden.rec.job = rewindTo(fixtureToJob(fixture), step) as unknown as Record<string, unknown>
  golden.rec.calls = []
  golden.rec.images = []
  golden.rec.patches = []
  return runPdpStep(golden.rec.job.id as string, GOLDEN_USER_ID)
}

beforeAll(() => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', GOLDEN_SUPABASE_URL)
})
afterAll(() => {
  vi.unstubAllEnvs()
})
beforeEach(() => {
  vi.spyOn(Date, 'now').mockReturnValue(GOLDEN_NOW)
  vi.spyOn(Math, 'random').mockReturnValue(0)
})

function defineGoldenSuite(key: FixtureKey) {
  it('① analysis — 프롬프트·저장 JSON', async () => {
    const job = await runFrom(key, 'analysis')
    expect(job.current_step, job.error ?? '').toBe('research')
    expect({ calls: summarizeCalls(key, 'analysis'), analysis: job.analysis, error: job.error }).toMatchSnapshot()
  })

  it('② research — 프롬프트', async () => {
    const job = await runFrom(key, 'research')
    expect(job.current_step, job.error ?? '').toBe('design')
    expect({ calls: summarizeCalls(key, 'research'), research: digestJson(job.research_result), error: job.error }).toMatchSnapshot()
  })

  it('③ design — 그라운딩·섹션 설계 프롬프트·섹션 계획', async () => {
    const job = await runFrom(key, 'design')
    expect(job.current_step, job.error ?? '').toBe('copywriting')
    expect({
      calls: summarizeCalls(key, 'design'),
      sectionPlan: job.section_plan,
      designPrompts: digestJson(job.design_prompts),
      error: job.error,
    }).toMatchSnapshot()
  })

  it('② copywriting — 프롬프트·게이트 결과', async () => {
    const job = await runFrom(key, 'copywriting')
    expect(job.current_step, job.error ?? '').toBe('images')
    const { final, ...gates } = job.copy_sections
    expect({
      calls: summarizeCalls(key, 'copywriting'),
      final: digestJson(final),
      gates,
      corpusVersion: (golden.rec.job.corpus_version as string | null) ?? null,
      error: job.error,
    }).toMatchSnapshot()
  })

  it('④ images — 컷별 프롬프트(그라운딩·연령 블록 포함)', async () => {
    let job = await runFrom(key, 'images')
    const allCalls = [...golden.rec.calls]
    const allImages = [...golden.rec.images]
    for (let i = 0; i < 40 && resolveStepToRun(job) === 'images' && job.current_step !== 'failed'; i++) {
      golden.rec.calls = []
      golden.rec.images = []
      job = await runPdpStep(job.id, GOLDEN_USER_ID)
      allCalls.push(...golden.rec.calls)
      allImages.push(...golden.rec.images)
    }
    expect(resolveStepToRun(job), job.error ?? '').toBe('compose')
    golden.rec.calls = allCalls
    const images = allImages.map((c, i) => {
      dumpGolden(`${key}.images.${i}.${c.stage}`, c.prompt)
      return { section: sectionFromImageStage(c.stage), stage: c.stage, model: c.model, size: c.size, refs: c.refs, prompt: digestText(c.prompt) }
    })
    expect({
      visionCalls: summarizeCalls(key, 'images-vision'),
      images,
      styleCharter: digestText(String(job.design_prompts.style_charter ?? '')),
      identityCard: digestText(String(job.design_prompts.identity_card ?? '')),
      sectionImages: job.section_images.map((s) => ({ section: s.section, url: s.url, error: s.error ?? null })),
    }).toMatchSnapshot()
  })

  it('compose — final_html·quality_report', async () => {
    const job = await runFrom(key, 'compose')
    expect(job.current_step, job.error ?? '').toBe('done')
    dumpGolden(`${key}.compose.final_html`, job.final_html ?? '')
    expect({
      finalHtml: { length: job.final_html?.length ?? 0, sha256: sha256(job.final_html ?? '') },
      qualityReport: job.copy_sections.quality_report ?? null,
      calls: summarizeCalls(key, 'compose'),
    }).toMatchSnapshot()
  })

  it('⑤ resolveStepToRun 판정표', () => {
    const done = fixtureToJob(loadEnrichmentFixture(key))
    const steps = ['analysis', 'research', 'design', 'copywriting', 'images', 'compose'] as const
    const table: Record<string, string> = {}
    for (const step of steps) table[`rewind:${step}`] = resolveStepToRun(rewindTo(done, step))
    table.done = resolveStepToRun(done)
    const [first, ...rest] = done.section_images
    table['pendingRegen 1건'] = resolveStepToRun({ ...done, section_images: [{ ...first, pendingRegen: true }, ...rest] })
    table['컷 1건 오류(url 없음)'] = resolveStepToRun({ ...done, section_images: [{ ...first, url: '', error: 'x' }, ...rest] })
    table['컷 1건 누락'] = resolveStepToRun({ ...done, section_images: rest })
    expect(table).toMatchSnapshot()
  })

  it('⑥ buildEditorDocument — 저장 산출로 만든 편집기 문서', async () => {
    const job = fixtureToJob(loadEnrichmentFixture(key))
    const response = assembleEditorDataResponse(job, null)
    const doc = await buildEditorDocument(job.id, { ...response, is_new: true, sections_data: [] })
    const normalized = normalizeEditorJson({ ...doc, id: '<doc>' })
    dumpGolden(`${key}.editor`, normalized)
    expect({
      sha256: sha256(normalized),
      sections: doc.sections.map((s) => ({
        type: s.sectionType,
        layoutId: s.layoutId,
        height: s.canvas.height,
        elements: s.elements.length,
      })),
    }).toMatchSnapshot()
  })
}

describe('Track S 골든', () => {
  for (const key of TRACK_S_KEYS) describe(key, () => defineGoldenSuite(key))
})

describe('Track I 골든(대조군 기준 — 이후 작업에서는 ENRICHMENT 전부 off 조건)', () => {
  // T2가 도입할 대조군 스위치. 지금은 읽는 코드가 없어 동작 영향이 없다(앞으로의 조건을 미리 고정).
  // 스위치는 호출 시점에 읽어야 이 stub이 먹는다(모듈 로드 시점에 읽으면 이 골든이 실패로 드러난다).
  // 블록이 끝나면 원래 값으로 되돌려 Track S 골든이 off 상태로 돌지 않게 한다(순서 섞기 실행 대비).
  let previousSwitch: string | undefined
  beforeAll(() => {
    previousSwitch = process.env.NEXOPS_PDP_ENRICHMENT
    vi.stubEnv('NEXOPS_PDP_ENRICHMENT', 'off')
  })
  afterAll(() => {
    if (previousSwitch === undefined) delete process.env.NEXOPS_PDP_ENRICHMENT
    else process.env.NEXOPS_PDP_ENRICHMENT = previousSwitch
  })

  for (const key of TRACK_I_VARIANT_KEYS) describe(key, () => defineGoldenSuite(key))

  for (const key of TRACK_I_KEYS) {
    describe(key, () => {
      defineGoldenSuite(key)

      it('buildSkeleton — 저장 analysis·spec 기준 골격', () => {
        const job = fixtureToJob(loadEnrichmentFixture(key))
        const snapshot = getCorpusSnapshotV2(job.analysis.detected_category)
        expect(snapshot, `v2 스냅샷 없음: ${job.analysis.detected_category}`).toBeTruthy()
        const strategyContract = mergeManualStrategy(job.analysis.recommended_strategy_contract ?? {}, job.spec_sheet, [])
        expect(buildSkeleton({ snapshot: snapshot!, specSheet: job.spec_sheet, strategyContract })).toMatchSnapshot()
      })
    })
  }
})
