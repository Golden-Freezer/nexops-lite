/**
 * K 라인 run 재생 — 첫 run이 선택·슬롯 카피를 불러 계획과 선택 기록을 남기는지, 꺼진 잡은 그 콜을 부르지 않는지 본다.
 * 끝까지 돌리면 대표 컷과 계획의 컷을 모두 만들고 compose로 가는지도 본다. 이미지 생성·Vision·DB·선택 콜은 모의(유료 호출 0).
 */

import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PdpJobRow } from './pdp-state'
import { PARTS_RULE_BLOCK } from './parts-rule'
import { HANDLED } from './templatelib/shot-brief'
import { CORRECT_USE_LINE, handlingFactsOf, USAGE_STEPS_PREFIX, USE_CARD_LINE_PREFIX, USE_LINE_PREFIX } from './templatelib/handling-facts'

const h = vi.hoisted(() => ({
  motionPicks: [] as unknown[] | 'all',
  motionInputs: [] as Array<{ candidates: Array<{ key: string; kinds: string[] }>; max: number }>,
  job: null as PdpJobRow | null,
  calls: { guideline: 0, compose: 0, select: 0, slots: 0 },
  slotsFail: false,
  slotsThrow: null as Error | null,
  /** 슬롯 카피가 칸마다 돌려주는 글 */
  slotText: '글',
  /** 강조 칸이 있는 섹션에 돌려줄 강조 구절(T1-17). 빈 값이면 없음 */
  accentText: '',
  /** 컷 키 → 앞으로 실패할 횟수 */
  cutFails: new Map<string, number>(),
  /** 컷 키 → 게이트 점수 덮어쓰기(한 번) */
  gateOnce: new Map<string, Record<string, unknown>>(),
  /** 컷 키 → 차례로 쓸 게이트 점수 덮어쓰기(재판정 시험, 점검 고침 1) — gateOnce보다 먼저 */
  gateQueue: new Map<string, Array<Record<string, unknown>>>(),
  gates: [] as Array<{ section: string; options: unknown; refs: number }>,
  cuts: [] as Array<{ section: string; prompt: string; size: string | undefined; refs: number }>,
  /** 슬롯 카피 콜이 받은 입력 — 프롬프트 지문을 잴 때 쓴다 */
  copyInputs: [] as unknown[],
  /** 새 단계 콜(R11a) — agent 이름 → 가짜 답. 없으면 원래 callLlm(이 파일의 다른 콜은 모두 에이전트 모의라 여기 오지 않는다) */
  newStageReplies: {} as Record<string, string>,
  /** 새 단계 콜 기록 — cutsBefore: 그 콜 전에 만든 컷 수(감독은 첫 컷 전) */
  newStageCalls: [] as Array<{ agent: string; model: string; effort?: string; cutsBefore: number; content?: unknown }>,
}))

// 새 단계 콜(연출 감독·K 칸 사실 감사, 하네스 R11a) — 새 단계 agent만 가짜 답, 그 밖은 원래 callLlm 그대로
vi.mock('@/lib/agents/llm', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/agents/llm')>()
  return {
    ...actual,
    callLlm: vi.fn(async (route: { model: string; effort?: string }, request: { agentName: string; messages?: Array<{ content: unknown }> }, parser: (text: string) => unknown) => {
      const reply = h.newStageReplies[request.agentName]
      if (reply === undefined) return (actual.callLlm as (...a: unknown[]) => unknown)(route, request, parser)
      h.newStageCalls.push({ agent: request.agentName, model: route.model, effort: route.effort, cutsBefore: h.cuts.length, content: request.messages?.[0]?.content })
      return { success: true, data: parser(reply), usage: { inputTokens: 10, outputTokens: 20, cost: 0.02 }, duration: 1 }
    }),
  }
})

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
  judgeImageGate: vi.fn(async (ref: unknown, section: string, _generated: unknown, _context: unknown, _limits: unknown, options: unknown) => {
    h.gates.push({ section, options, refs: Array.isArray(ref) ? ref.length : 1 })
    const queued = h.gateQueue.get(section)?.shift()
    const once = queued ?? h.gateOnce.get(section)
    if (!queued) h.gateOnce.delete(section)
    return {
      score: { cut: section, same_product: true, consistency: 0.9, has_artifact: false, artifact_reason: '', background_tone_hex: '#FFFFFF', ...once },
      costUsd: 0.01,
    }
  }),
}))
vi.mock('@/lib/agents/image/generate', () => ({
  generateImage: vi.fn(async (args: { prompt: string; size?: string; referenceImages?: unknown[]; runContext: { stage: string } }) => {
    const section = args.runContext.stage.replace('images/', '')
    h.cuts.push({ section, prompt: args.prompt, size: args.size, refs: args.referenceImages?.length ?? 0 })
    const fails = h.cutFails.get(section) ?? 0
    if (fails > 0) {
      h.cutFails.set(section, fails - 1)
      throw new Error('생성 실패')
    }
    return { base64: 'AAAA', mimeType: 'image/png' }
  }),
}))
vi.mock('./storage', () => ({
  uploadPdpImage: vi.fn(async (_db: unknown, _u: string, _j: string, section: string) => `https://cdn.test/${section}.png`),
}))
const COST = 0.01
const free = <T,>(value: T) => ({ value, usedFallback: false, error: null, costUsd: COST })
vi.mock('@/lib/agents/registration/pdp-template-agent', () => ({
  generateTemplateGuideline: vi.fn(async ({ concepts }: { concepts: Array<{ id: string }> }) => {
    h.calls.guideline += 1
    return free({ persona: '고객', tone: '말투', concept: { id: concepts[0].id, reason: '' }, alternatives: [] })
  }),
  composeTemplateSections: vi.fn(async () => {
    h.calls.compose += 1
    return free([])
  }),
  selectTemplatePicks: vi.fn(async ({ slots }: { slots: Array<{ index: number; candidates: Array<{ id: string }> }> }) => {
    h.calls.select += 1
    return free(slots.map((slot) => ({ index: slot.index, templateId: slot.candidates[0].id, reason: '' })))
  }),
}))
// 움직이는 칸 고르기(motionband 잡만) — 모델 콜 없이 고르지 않는다(대표 칸만). 시험이 picks를 바꾼다
vi.mock('@/lib/agents/registration/pdp-motion-pick-agent', () => ({
  pickMotionCells: vi.fn(async (input: { candidates: Array<{ key: string; kinds: string[] }>; max: number }) => {
    h.motionInputs.push(input)
    // 'all' = 후보를 모두(상한 넘게) 고른다 — 거르기가 상한·섹션 한 칸을 지키는지 본다
    const picks = h.motionPicks === 'all' ? input.candidates.map((c) => ({ key: c.key, kind: c.kinds[0], reason: '시험 까닭' })) : h.motionPicks
    return { picks, costUsd: 0, error: null }
  }),
}))
vi.mock('@/lib/agents/registration/pdp-template-copy-agent', () => ({
  fillTemplateSlots: vi.fn(async (input: { sections: Array<{ index: number; slots: Array<{ name: string; list?: unknown; tags?: unknown; accent?: true }> }> }) => {
    const { sections } = input
    h.copyInputs.push(input)
    h.calls.slots += 1
    if (h.slotsThrow) throw h.slotsThrow
    const values = new Map<number, Record<string, string>>()
    if (!h.slotsFail) {
      for (const section of sections) {
        const text = section.slots.filter((slot) => !slot.list && !slot.tags)
        values.set(section.index, Object.fromEntries(text.map((slot) => [slot.name, h.slotText])))
      }
    }
    const accents = new Map<number, string>()
    if (h.accentText) for (const section of sections) if (section.slots.some((slot) => slot.accent)) accents.set(section.index, h.accentText)
    return { values, problems: [], dropped: [], firstProblems: [], fixCalls: 0, accents, accentMisses: 0, error: h.slotsFail ? '콜 실패' : null, costUsd: COST }
  }),
}))

import { selectTemplatePicks } from '@/lib/agents/registration/pdp-template-agent'
import { buildSlotCopyPrompt, type SlotCopyInput } from '@/lib/agents/registration/prompts/pdp-template-copy-prompts'
import { fixtureToJob, loadEnrichmentFixture, rewindTo } from './__golden__/golden-harness'
import { runWithPdpBatch } from './pdp-model-batch-context'
import { newStagesLedger } from './__e2e__/new-stages-ledger'
import { templateLineLedger } from './__e2e__/template-ledger'
import { applyDesignSkeleton, resolveDesignSkeleton } from './pdp-enrichment-stage'
import { buildDesigncutPlan } from './internalized/designcut-plan'
import { describeSceneSet } from './scene-set'
import { GATE_REF_MAX, gatePromptOptionsOf, isGateFailure, runImagesStep, withoutSizeScore } from './pdp-image-stage'
import { cutFailureNotes, gateWarningNotes } from './cut-failures'
import { assembleEditorDataResponse } from './editor-data'
import { SCALE_KEPT_NOTE, gateRecordOf, gateStats } from './gate-record'
import { renderJobHtml } from './eval/render-capture'
import { HERO_SHOT_WORDS, hookPromiseOf, lostSectionsOf } from './templatelib/line-plan'
import { keyedShots } from './templatelib/section-values'
import { pageStageNames } from './templatelib/shot-stage'
import { EFFECT_SHOT_LINE, FAMILY_SHOT_FAMILIES, familyShotLine, heroPromiseLine, shotRouteOf } from './templatelib/shot-brief'
import { mergeManualStrategy } from './pdp-strategy-contract'
import { buildImageTasks, isPlateTask } from './pdp-image-tasks'
import { readIdentityCard } from '@/lib/agents/registration/pdp-image-agent'
import { optionPhotoCoverage, optionPhotoGuard } from './options/option-photo-guard'
import { optionSpecOf } from './internalized/persuasion-signals'
import { CTA_FRAMINGS, FIRST_ANGLE_TEXT, HERO_PERSON, SMILE_MAX, VARY_LIGHT_TEXT, VARY_PRODUCT_EXCLUDED, VARY_REFERENCE_TEXT, varyRefsOf } from './templatelib/shot-variety'
import { PRIORITY_BLOCK } from './rule-priority'
import { templateById } from './templatelib/library'
import { isInputValue } from './templatelib/slots'

/** 하네스 L 갈래와 같은 기능 묶음 */
const FEATURES = ['vocab', 'persuasion', 'layouts', 'shots', 'annotations', 'mobile', 'options', 'designcut', 'designcut2', 'designlayout', 'designlong', 'palette2', 'rhythm', 'flow', 'shotdiv', 'fontpair']

function jobOf(extra: string[]): PdpJobRow {
  const job = fixtureToJob(loadEnrichmentFixture('A-track-i'))
  job.analysis = { ...job.analysis, enrichment: { version: 1, features: [...FEATURES, ...extra] } } as PdpJobRow['analysis']
  const strategy = mergeManualStrategy(job.analysis.recommended_strategy_contract ?? {}, job.spec_sheet, [])
  job.section_plan = applyDesignSkeleton(job.section_plan, resolveDesignSkeleton(job, strategy))
  return { ...job, spec_sheet: { ...job.spec_sheet, material: 'PE' }, section_images: [], final_html: null, current_step: 'images', progress: 80, cost_usd: 1 }
}
/**
 * 시험 잡 모양(cost_pool 'test') — 아래 '꺼진 잡은 바이트 그대로' 지문은 시험 잡(배치 비교)을 지킨다. 운영 잡은 K 선택 씨앗에 잡 id를 섞어(R09c)
 * 같은 상품도 선택이 바뀌므로 이 지문 밖이다. 시험 잡의 씨앗은 이 PR 전처럼 상품명이다
 */
const testJobOf = (extra: string[]): PdpJobRow => ({ ...jobOf(extra), cost_pool: 'test' })
const runOnce = (job: PdpJobRow) => {
  h.job = job
  return runImagesStep({} as never, 'user-1', job, { concurrency: 1 })
}

/** 실물 쓰는 법 줄을 받는 컷 — 손·착용·사용 구도이고 상품 없는 고민 컷(목적 problem, J49)이 아니다(J61: 고민 컷은 사용 구도여도 받지 않는다) */
const getsUseLine = (shot: { composition: string; purpose: string }) => HANDLED.has(shot.composition) && shot.purpose !== 'problem'

describe('K 라인 계획 기록', () => {
  beforeEach(() => {
    h.calls = { guideline: 0, compose: 0, select: 0, slots: 0 }
    h.slotsFail = false
    h.slotsThrow = null
    h.slotText = '글'
    h.accentText = ''
    h.cutFails = new Map()
    h.gateOnce = new Map()
    h.gateQueue = new Map()
    h.gates = []
    h.cuts = []
  })

  it('글이 목적을 말하면 컷을 글에 맞추고 무대는 고친 목적으로 정한다', async () => {
    const draft = (await runOnce(jobOf(['templatelib']))).section_plan.templatelib!
    expect(draft.shotRefine).toMatchObject({ worded: 0, purposeChanged: 0, compositionOnly: 0 })

    h.slotText = '욕실에서 끈을 당기면 돼요'
    const record = (await runOnce(jobOf(['templatelib']))).section_plan.templatelib!
    expect(record.shotRefine!.worded).toBeGreaterThan(0)
    expect(record.shotRefine!.purposeChanged).toBeGreaterThan(0)
    expect(record.shots!.map((shot) => shot.key)).toEqual(draft.shots!.map((shot) => shot.key))
    const pairs = (shots: NonNullable<typeof record.shots>) => shots.map((shot) => `${shot.purpose}|${shot.composition}`)
    expect(pairs(record.shots!)).not.toEqual(pairs(draft.shots!))
    // 기록의 섹션 컷과 만들 컷이 같다
    const planned = new Map(record.sections.flatMap((row, index) => keyedShots(index, row).map((shot) => [shot.key, shot] as const)))
    for (const shot of record.shots!) expect(planned.get(shot.key)).toMatchObject({ purpose: shot.purpose, composition: shot.composition })
    expect(record.shots!.map((shot) => shot.stage!.name)).toEqual(pageStageNames(record.shots!))
    // 글이 말한 장소를 무대가 그대로 지시한다
    const placed = record.shots!.filter((shot) => shot.stage!.name === 'place' && shot.show.includes('욕실'))
    expect(placed.length).toBeGreaterThan(0)
    for (const shot of placed) expect(shot.stage!.line).toContain('"욕실"')
  })

  it('켠 잡: 첫 run이 네 콜을 한 번씩 부르고 선택 기록·templateRef 계획을 남긴다', async () => {
    const job = await runOnce(jobOf(['templatelib']))
    expect(h.calls).toEqual({ guideline: 1, compose: 1, select: 1, slots: 1 })

    const plan = job.section_plan.designcut!
    expect(plan.layout).toBe(2)
    expect(plan.sections.length).toBeGreaterThan(0)
    expect(plan.sections.every((section) => section.templateRef)).toBe(true)
    expect(plan.templateColors).toBeTruthy()
    expect(plan.templateFontPair).toBeTruthy()

    const record = job.section_plan.templatelib!
    expect(record.sections.map((section) => section.templateId)).toEqual(plan.sections.map((section) => section.templateRef!.id))
    // 컨셉 모서리(T1-28) — 고른 컨셉의 shape 값이 계획에 실린다
    const { shapeRadius } = await import('./templatelib/concept-radius')
    const { conceptById } = await import('./templatelib/concepts')
    expect(plan.templateRadius).toEqual(shapeRadius(conceptById(record.concept.id)!.shape))
    expect(record.hero?.kind).toBeTruthy()
    expect(record.copy).toMatchObject({ fixCalls: 0, error: null, problems: [] })
    // 하네스 done 확인이 shotdiv 갈래(K_BASE=L)에 이 기록을 요구한다. 컷은 이 기록으로 만들지 않는다(끝까지 돌리는 시험이 본다)
    expect(job.section_plan.extra_shots).toBeTruthy()
    // 선택 3콜 + 카피 1콜 비용이 잡에 쌓인다(컷 비용은 그 위에 더해진다)
    expect(job.cost_usd).toBeGreaterThanOrEqual(1 + COST * 4 - 1e-9)
  })

  it('강조 구절(T1-17): 슬롯 카피가 고른 구절이 그 섹션 templateRef.accent로 가고 기록에 수가 남는다. 없으면 칸이 없다', async () => {
    const none = (await runOnce(jobOf(['templatelib']))).section_plan
    expect(none.designcut!.sections.some((section) => section.templateRef?.accent !== undefined)).toBe(false)
    expect(none.templatelib!.copy).toMatchObject({ accents: 0, accentMisses: 0 })

    h.slotText = '욕실에서 끈을 당기면 돼요'
    h.accentText = '끈을 당기면'
    const plan = (await runOnce(jobOf(['templatelib']))).section_plan
    const marked = plan.designcut!.sections.filter((section) => section.templateRef?.accent === '끈을 당기면')
    expect(marked.length).toBeGreaterThan(0)
    expect(plan.templatelib!.copy!.accents).toBe(marked.length)
  })

  it('장점 후보 근거 대조(uspaudit, J22): 켠 잡만 근거 없음과 겹치는 장점 후보를 칸 카피 사실 목록에서 빼고 수만 기록한다 — 끈 잡은 칸이 없고 사실 목록이 그대로다', async () => {
    const usp = '10개 대용량으로 경제적인 파티 솔루션'
    const factAudit = {
      version: 1,
      stage: 'factAudit',
      status: 'done',
      route: { name: 'copy/fact-audit', model: 'm', effort: null, maxTokens: 1, backend: 'api' },
      result: {
        items: [{ id: 'mainIntro.hook', claim: '10개 대용량이라 경제적이다', verdict: 'unsupported', evidence: '', fix: '', regulated: false }],
        summary: { checked: 1, unsupported: 1, regulated: 0 },
      },
      warnings: [],
      costUsd: 0,
      durationMs: 0,
    }
    const withAudit = (job: PdpJobRow) => ({ ...job, copy_sections: { ...job.copy_sections, fact_audit: factAudit } }) as PdpJobRow
    const factsOfLastCopy = () => (h.copyInputs.at(-1) as { facts: string[] }).facts
    h.copyInputs = []
    const off = await runOnce(withAudit(jobOf(['templatelib', 'uspfacts'])))
    expect(off.section_plan.templatelib).not.toHaveProperty('uspAudit')
    const offFacts = factsOfLastCopy()
    expect(offFacts).toContain(usp)
    const on = await runOnce(withAudit(jobOf(['templatelib', 'uspfacts', 'uspaudit'])))
    expect(on.section_plan.templatelib!.uspAudit).toEqual({ audit: 'done', candidates: 5, dropped: 1, unsupported: 1 })
    expect(factsOfLastCopy()).toEqual(offFacts.filter((fact) => fact !== usp))
  })

  it('켠 잡: 원장 요약이 이 기록을 읽는다', async () => {
    const job = await runOnce(jobOf(['templatelib']))
    const { templateLine } = templateLineLedger(job.section_plan)
    const record = job.section_plan.templatelib!
    expect(templateLine).toMatchObject({ concept: record.concept.id, palette: record.palette.id, fontPair: record.fontPair.id, sections: record.sections.length })
    expect(templateLine!.templates).toHaveLength(record.sections.length)
  })

  it('spec 정본 고정(specfixed, J23): 켠 잡만 칸 카피 입력에 크기·소재·옵션 수 고정 값 줄이 붙고 옵션 이름은 판매자 입력이다 — 끈 잡은 그 칸이 없다', async () => {
    const withColors = (job: PdpJobRow) => ({ ...job, spec_sheet: { ...job.spec_sheet, colorOptions: ['핑크', '블루'] } }) as PdpJobRow
    const lastCopy = () => h.copyInputs.at(-1) as { fixedValues?: string[] }
    h.copyInputs = []
    await runOnce(withColors(jobOf(['templatelib'])))
    expect(lastCopy()).not.toHaveProperty('fixedValues')
    await runOnce(withColors(jobOf(['templatelib', 'specfixed'])))
    const { size } = jobOf([]).spec_sheet
    expect(lastCopy().fixedValues).toEqual([`- 크기: ${size}`, '- 소재: PE', '- 옵션 2개: 핑크/블루'])
  })

  it('다음 run은 선택·카피를 다시 부르지 않는다', async () => {
    const first = await runOnce(jobOf(['templatelib']))
    const calls = { ...h.calls }
    const plan = first.section_plan.designcut
    if (first.current_step === 'images') await runImagesStep({} as never, 'user-1', first, { concurrency: 1 })
    expect(h.calls).toEqual(calls)
    expect(h.job!.section_plan.designcut).toEqual(plan)
  })

  it('카피를 한 칸도 못 받으면 멈춘다 — 계획을 남기지 않아 빈 페이지에 컷 비용을 쓰지 않는다', async () => {
    h.slotsFail = true
    await expect(runOnce(jobOf(['templatelib']))).rejects.toThrow(/슬롯 카피를 받지 못했다: 콜 실패/)
    expect(h.job!.section_plan.designcut).toBeUndefined()
    expect(h.job!.section_plan.templatelib).toBeUndefined()
  })

  it('카피를 못 받아도 끝난 콜의 비용은 잡에 쌓이고, 다시 부르면 그만큼 더 쌓인다', async () => {
    h.slotsFail = true
    await expect(runOnce(jobOf(['templatelib']))).rejects.toThrow(/슬롯 카피를 받지 못했다/)
    expect(h.job!.cost_usd).toBeCloseTo(1 + COST * 4, 6)
    await expect(runImagesStep({} as never, 'user-1', h.job!, { concurrency: 1 })).rejects.toThrow(/슬롯 카피를 받지 못했다/)
    expect(h.job!.cost_usd).toBeCloseTo(1 + COST * 8, 6)
    expect(h.calls.guideline).toBe(2)
  })

  it('슬롯 카피 콜이 소프트 종료로 던져도 오류 이름을 지키고 선택 3콜 비용을 쌓는다', async () => {
    h.slotsThrow = Object.assign(new Error('한도'), { name: 'LlmSoftStopError' })
    await expect(runOnce(jobOf(['templatelib']))).rejects.toMatchObject({ name: 'LlmSoftStopError' })
    expect(h.job!.cost_usd).toBeCloseTo(1 + COST * 3, 6)
    expect(h.job!.section_plan.templatelib).toBeUndefined()
  })

  const runAll = async (start: PdpJobRow, runs = 20) => {
    let job = start
    h.job = job
    for (let i = 0; i < runs && job.current_step === 'images'; i++) job = await runImagesStep({} as never, 'user-1', job, { concurrency: 1 })
    return job
  }

  it('끝까지 돌리면 대표 컷과 계획의 컷만 만들고 compose로 간다', async () => {
    const job = await runAll(jobOf(['templatelib']))
    const shots = job.section_plan.templatelib!.shots!
    expect(shots.length).toBeGreaterThan(5)
    const made = job.section_images.filter((entry) => entry.url).map((entry) => entry.section).sort()
    expect(made).toEqual(['hero', ...shots.map((shot) => shot.key)].sort())
    expect(job.current_step).toBe('compose')
    // 대표 컷이 먼저다 — 다른 컷의 스타일 참조
    expect(h.cuts[0].section).toBe('hero')
  })

  it('첫 화면 첫 칸은 대표 컷을 쓰고, 다른 칸은 자기 컷 키를 쓴다', async () => {
    const job = await runAll(jobOf(['templatelib']))
    const plan = job.section_plan.designcut!
    const hook = plan.sections.find((section) => section.role === 'hook_3step')!
    expect(JSON.stringify(hook.templateRef!.slots)).toContain('"hero"')
    for (const shot of job.section_plan.templatelib!.shots!) {
      expect(JSON.stringify(plan.sections.map((section) => section.templateRef!.slots))).toContain(`"${shot.key}"`)
    }
  })

  it('사진 위 글 칸을 고르면 그 컷과 대표 컷만 글 자리를 비우고, 글자 자리 재생성은 열지 않는다', async () => {
    vi.mocked(selectTemplatePicks).mockImplementationOnce((async ({ slots }: { slots: Array<{ index: number; candidates: Array<{ id: string }> }> }) =>
      free(slots.map((slot) => ({ index: slot.index, templateId: (slot.candidates.find((c) => c.id.includes('.overlay-')) ?? slot.candidates[0]).id, reason: '' })))) as never)
    const job = await runAll(jobOf(['templatelib']))
    const record = job.section_plan.templatelib!
    const hook = record.sections.find((row) => row.section === 'hook_3step')!
    expect(hook.templateId).toContain('.overlay-')
    const heroCut = h.cuts.find((c) => c.section === 'hero')!
    expect(record.hero?.overlayAnchor).toBeTruthy()
    expect(heroCut.prompt).toContain(`Frame: Leave the ${record.hero!.overlayAnchor} 60% of the frame`)
    expect(heroCut.prompt).not.toContain('[Copy zone]')
    expect(job.section_images.find((entry) => entry.section === 'hero')!.copyZone).toBeUndefined()
    const framed = record.shots!.filter((shot) => shot.overlayAnchor)
    for (const shot of record.shots!) {
      const { prompt } = h.cuts.find((c) => c.section === shot.key)!
      if (shot.overlayAnchor) expect(prompt, shot.key).toContain(`Frame: Leave the ${shot.overlayAnchor} 60% of the frame`)
      else expect(prompt, shot.key).not.toContain('Frame: Leave')
      // 원·아치 칸은 자르기 Frame 줄(#555)이 붙는다 — 사진 위 글 자리 줄과 다른 줄이다
      if (shot.clipShape) expect(prompt, shot.key).toContain('Frame: The page')
      else if (!shot.overlayAnchor) expect(prompt, shot.key).not.toContain('Frame: ')
    }
    expect(h.cuts.filter((c) => c.prompt.includes('Frame: Leave')).length).toBe(framed.length + 1)
  })

  it('사진 위 글 칸이 없는 K 잡과 끈 잡은 Frame 줄이 없다', async () => {
    const job = await runAll(jobOf(['templatelib']))
    const record = job.section_plan.templatelib!
    expect(record.sections.some((row) => row.templateId.includes('.overlay-'))).toBe(false)
    expect(record.hero?.overlayAnchor).toBeUndefined()
    expect(h.cuts.some((c) => c.prompt.includes('Frame: Leave'))).toBe(false)
    // Frame 줄은 원·아치 칸의 자르기 줄뿐이다
    for (const shot of record.shots!) {
      const { prompt } = h.cuts.find((c) => c.section === shot.key)!
      if (shot.clipShape) expect(prompt, shot.key).toContain('Frame: The page')
      else expect(prompt, shot.key).not.toContain('Frame: ')
    }
    h.cuts = []
    await runAll(jobOf([]))
    expect(h.cuts.length).toBeGreaterThan(0)
    expect(h.cuts.some((c) => c.prompt.includes('Frame: Leave'))).toBe(false)
  })

  it('K 계획만 세트 어휘를 바꾸고 헌장 세트 줄이 그 값을 쓴다 — 기준 계획은 그대로다', async () => {
    const start = jobOf(['templatelib'])
    const base = buildDesigncutPlan(start)!.artDirection!.set
    const job = await runOnce({ ...start, design_prompts: { ...start.design_prompts, style_charter: undefined } } as PdpJobRow)
    const set = job.section_plan.designcut!.artDirection!.set
    expect({ wall: set.wall, window: set.window, season: set.season }).toEqual({ wall: base.wall, window: base.window, season: base.season })
    expect(set.props.length).toBeLessThanOrEqual(2)
    expect(JSON.stringify(set)).not.toMatch(/\boak\b|plant|succulent|herb|eucalyptus|flower/i)
    expect(job.design_prompts.style_charter).toContain(`- Set description: ${describeSceneSet(set)}`)
    // 끈 잡의 D2 계획도 K와 같은 어휘 표다(적용 D4 ⓒ) — 오크·식물이 없고 소품 2개. K 계획은 그 위에서 부속 소품을 앞에 둔다
    expect(JSON.stringify(base)).not.toMatch(/\boak\b|plant|succulent|herb|eucalyptus|flower/i)
    expect(base.props).toHaveLength(2)
    const off = jobOf([])
    expect(buildDesigncutPlan(off)!.artDirection!.set).toEqual(base)
    const offJob = await runOnce({ ...off, design_prompts: { ...off.design_prompts, style_charter: undefined } } as PdpJobRow)
    expect(offJob.section_plan.designcut!.artDirection!.set).toEqual(base)
    expect(offJob.design_prompts.style_charter).toContain(`- Set description: ${describeSceneSet(base)}`)
  })

  it('입력에 적힌 부속이 K 세트 소품의 첫 값이다', async () => {
    const start = jobOf(['templatelib'])
    const job = await runOnce({ ...start, spec_sheet: { ...start.spec_sheet, extraSpecs: [{ key: '구성품', value: '보관 케이스 포함' }] } })
    expect(job.section_plan.designcut!.artDirection!.set.props[0]).toBe('the 보관 케이스 that comes with this product, exactly as in the reference photos')
  })

  it('컷 프롬프트는 지시 블록을 맨 뒤쪽에 싣고, 비율은 크기 인자로 보낸다', async () => {
    const job = await runAll(jobOf(['templatelib']))
    const sizes: Record<string, string> = { '1:1': '1024x1024', '3:4': '1024x1536', '2:3': '1024x1536', '4:3': '1536x1024' }
    for (const shot of job.section_plan.templatelib!.shots!) {
      const cut = h.cuts.find((c) => c.section === shot.key)!
      expect(cut.prompt, shot.key).toContain('[Shot direction]')
      expect(cut.prompt, shot.key).not.toMatch(/^(- )?Aspect Ratio:/m)
      expect(cut.size, shot.key).toBe(sizes[shot.aspect])
    }
    // 대표 컷은 제품을 가장 크게 두는 지시만 붙는다(적용 K13 ③)
    expect(h.cuts.find((c) => c.section === 'hero')!.prompt).toContain('largest subject')
  })

  it('상품 컷은 참조를 받고, 고민 컷은 상품 참조 없이 만든다. 세트 컷은 단색 바탕을 쓰지 않는다', async () => {
    const job = await runAll(jobOf(['templatelib']))
    for (const shot of job.section_plan.templatelib!.shots!) {
      const cut = h.cuts.find((c) => c.section === shot.key)!
      // 고민 컷은 첫 화면 컷을 빛·색 참조로만 받는다(기존 고민 컷과 같다)
      if (shot.purpose === 'problem') expect(cut.refs, shot.key).toBe(1)
      else expect(cut.refs, shot.key).toBeGreaterThan(0)
      // 쇼룸 최소 장 수(pageStageNames)로 쇼룸에 옮긴 컷은 세트 컷이 아니다 — 무대별 줄은 아래 '컷마다 무대 기록' 시험이 본다
      if (['scene', 'action', 'state', 'scale', 'problem'].includes(shot.purpose) && shot.stage?.name !== 'showroom') expect(cut.prompt, shot.key).toContain('the shared set')
    }
  })

  it('동작·손 컷은 손과 상품만, 다른 카테고리 고민 컷은 기존 문구 그대로다', async () => {
    const job = await runAll(jobOf(['templatelib']))
    const shots = job.section_plan.templatelib!.shots!
    const promptOf = (key: string) => h.cuts.find((c) => c.section === key)!.prompt
    const action = shots.find((shot) => shot.purpose === 'action')!
    expect(promptOf(action.key)).toContain('HANDS AND PRODUCT ONLY')
    const problem = shots.find((shot) => shot.purpose === 'problem')!
    expect(promptOf(problem.key)).toContain('SCENE FOCUS RULE')
    expect(promptOf(problem.key)).not.toContain('distressed')
  })

  it('반려동물 고민 컷은 얼굴 중심 줄을 빼고 근심하는 얼굴을 막는다', async () => {
    const start = jobOf(['templatelib'])
    const job = await runAll({ ...start, analysis: { ...start.analysis, detected_category: 'pet' } })
    const problems = job.section_plan.templatelib!.shots!.filter((shot) => shot.purpose === 'problem')
    expect(problems.length).toBeGreaterThan(0)
    for (const shot of problems) {
      const { prompt } = h.cuts.find((c) => c.section === shot.key)!
      expect(prompt, shot.key).not.toContain('SCENE FOCUS RULE')
      expect(prompt, shot.key).not.toContain('Facial Expression')
      expect(prompt, shot.key).toContain('No worried, sad or distressed face')
    }
  })

  it('만든 컷으로 페이지가 그려진다 — 그릴 수 있는 섹션이 모두 K로 그려지고 만든 컷이 모두 쓰인다', async () => {
    const job = await runAll(jobOf(['templatelib']))
    const record = job.section_plan.templatelib!
    const rendered = await renderJobHtml(job, null)
    const kSections = rendered.doc.sections.filter((section) => section.layoutId?.startsWith('designcut_k_'))
    expect(kSections.length).toBe(job.section_plan.designcut!.sections.length - record.copy!.undrawn.length)
    expect(rendered.html).toContain('https://cdn.test/hero.png')
    const missing = record.shots!.filter((shot) => !rendered.html.includes(`https://cdn.test/${shot.key}.png`))
    expect(missing.map((shot) => shot.key)).toEqual([])
  })

  it('첫 화면은 글자 자리를 비우지 않고, 첫 화면 유형 기록이 첫 칸 배정과 같다', async () => {
    const job = await runAll(jobOf(['templatelib']))
    const hero = job.section_images.find((entry) => entry.section === 'hero')!
    expect(hero.copyZone).toBeUndefined()
    expect(['studio', 'in_use', 'worn']).toContain(job.section_plan.templatelib!.hero!.kind)
  })

  /** 그 컷이 빠지면 섹션을 못 그리는 컷과 섹션 — 실패 없이 돌린 계획에서 고른다 */
  const requiredCut = async () => {
    const job = await runAll(jobOf(['templatelib']))
    const record = job.section_plan.templatelib!
    const urls = job.section_images.filter((entry) => entry.url)
    for (const shot of record.shots!) {
      const lost = lostSectionsOf(job, urls.filter((entry) => entry.section !== shot.key))
      if (lost.length > 0) return { shot, lost: lost[0], planSections: job.section_plan.designcut!.sections.length, undrawn: record.copy!.undrawn.length }
    }
    throw new Error('필수 컷이 없다')
  }

  it('컷이 한 번 실패하면 다음 run이 다시 만들어 섹션이 그대로 그려진다', async () => {
    const { shot, planSections, undrawn } = await requiredCut()
    h.cuts = []
    h.cutFails.set(shot.key, 1)
    const job = await runAll(jobOf(['templatelib']))
    expect(h.cuts.filter((cut) => cut.section === shot.key)).toHaveLength(2)
    expect(job.current_step).toBe('compose')
    expect(job.section_images.find((entry) => entry.section === shot.key)!.url).toBeTruthy()
    expect(job.section_plan.cuts_failed).toEqual({ count: 0, sections: [] })
    expect(job.section_plan.templatelib!.lost).toEqual([])
    const rendered = await renderJobHtml(job, null)
    expect(rendered.doc.sections.filter((section) => section.layoutId?.startsWith('designcut_k_'))).toHaveLength(planSections - undrawn)
  })

  it('다시 만들어도 실패하면 그 섹션만 빠지고 기록이 남으며 compose로 간다', async () => {
    const { shot, lost, planSections, undrawn } = await requiredCut()
    h.cuts = []
    h.cutFails.set(shot.key, 9)
    const job = await runAll(jobOf(['templatelib']))
    // 첫 시도와 재시도 두 번뿐이다 — 모델을 바꾸거나 더 시도하지 않는다
    expect(h.cuts.filter((cut) => cut.section === shot.key)).toHaveLength(2)
    expect(job.current_step).toBe('compose')
    expect(job.section_plan.cuts_failed).toEqual({ count: 1, sections: [shot.key] })
    expect(job.section_plan.templatelib!.lost).toEqual([lost])
    expect(lost.cuts).toEqual([shot.key])
    expect(lost.key).toMatch(/^k\d+_/)
    const rendered = await renderJobHtml(job, null)
    const drawn = rendered.doc.sections.filter((section) => section.layoutId?.startsWith('designcut_k_'))
    expect(drawn).toHaveLength(planSections - undrawn - 1)
    expect(drawn.some((section) => section.layoutId === `designcut_k_${lost.templateId}`)).toBe(false)
  })

  it('컷이 다 있어도 글 탓에 못 그리는 섹션은 잃은 섹션으로 세지 않는다', async () => {
    const job = await runAll(jobOf(['templatelib']))
    expect(job.section_plan.templatelib!.lost).toEqual([])
    const section = job.section_plan.designcut!.sections[0]
    const emptied = { ...section, templateRef: { ...section.templateRef!, slots: {} } }
    const broken = { section_plan: { ...job.section_plan, designcut: { ...job.section_plan.designcut!, sections: [emptied] } } }
    expect(lostSectionsOf(broken, [])).toEqual([])
  })

  it('대표 컷을 끝내 못 만들면 다른 컷을 만들지 않고 잡을 멈춘다 — 잃은 섹션 기록은 없다', async () => {
    h.cutFails.set('hero', 99)
    const job = await runAll(jobOf(['templatelib']))
    expect(job.current_step).toBe('failed')
    expect(new Set(h.cuts.map((cut) => cut.section))).toEqual(new Set(['hero']))
    expect(job.section_plan.templatelib!.lost).toBeUndefined()
  })

  it('컷마다 무대 기록과 Stage 줄이 있고, 쇼룸·근접 컷은 세트 줄을 쓰지 않는다', async () => {
    const job = await runAll(jobOf(['templatelib']))
    const shots = job.section_plan.templatelib!.shots!
    expect(new Set(shots.map((shot) => shot.stage!.name)).size).toBeGreaterThan(2)
    for (const shot of shots) {
      const { prompt } = h.cuts.find((c) => c.section === shot.key)!
      expect(prompt, shot.key).toContain(shot.stage!.line)
      if (shot.stage!.name === 'showroom' || shot.stage!.name === 'macro') expect(prompt, shot.key).not.toContain('Background: the shared set')
      else expect(prompt, shot.key).toContain('the shared set')
    }
  })

  it('바탕이 세트와 다른 컷만 게이트에 알린다 — 대표 컷·세트 컷은 무대 문구가 없다. K 컷은 모두 배열·크기를 묻는다(실물 크기 11-05)', async () => {
    const job = await runAll(jobOf(['templatelib']))
    const shots = job.section_plan.templatelib!.shots!
    const realSize = job.spec_sheet.size!.trim()
    // K 컷은 부품도 묻는다(점검 고침 1). 사용 판정(useCheck)은 사람·손이 쓰는 컷만이라 아래에서 따로 본다
    const line = { lineCut: true, realSize, partsCheck: true }
    const withoutUse = (options: unknown) => {
      const rest = { ...(options as Record<string, unknown>) }
      delete rest.useCheck
      return rest
    }
    expect(withoutUse(h.gates.find((gate) => gate.section === 'hero')!.options)).toEqual(line)
    for (const shot of shots) {
      const gate = h.gates.find((row) => row.section === shot.key)
      if (!gate) continue
      expect(withoutUse(gate.options), shot.key).toEqual(shot.stage!.name === 'life' ? line : { stagedCut: true, ...line })
    }
    expect(h.gates.some((gate) => (gate.options as { stagedCut?: boolean } | undefined)?.stagedCut)).toBe(true)
  })

  it('K 컷 게이트는 원본 여러 장(상한 4)과 부품을 묻고, 사람·손이 쓰는 컷만 사용 판정을 묻는다(점검 고침 1·3)', async () => {
    const job = await runAll(jobOf(['templatelib']))
    const tasks = new Map(buildImageTasks(job).map((task) => [task.section, task]))
    expect(h.gates.length).toBeGreaterThan(0)
    for (const gate of h.gates) {
      const options = gate.options as { partsCheck?: boolean; useCheck?: boolean }
      expect(options.partsCheck, gate.section).toBe(true)
      expect(gate.refs, gate.section).toBeLessThanOrEqual(GATE_REF_MAX)
      expect(gate.refs, gate.section).toBe(h.gates[0].refs)
      expect(Boolean(options.useCheck), gate.section).toBe(Boolean(tasks.get(gate.section)?.useGate))
    }
    expect(h.gates.some((gate) => (gate.options as { useCheck?: boolean }).useCheck)).toBe(true)
    expect(h.gates.some((gate) => !(gate.options as { useCheck?: boolean }).useCheck)).toBe(true)
  })

  it('부품·사용 미달은 재생성하고, 재생성 지시에 무엇이 틀렸는지 한 줄을 싣는다(점검 고침 1·3)', async () => {
    const draft = await runOnce(jobOf(['templatelib']))
    const key = draft.section_plan.templatelib!.shots!.find((shot) => !shotRouteOf(shot.purpose).effectOnly && !shot.sizeCut)!.key
    h.cuts = []
    h.gates = []
    h.gateOnce.set(key, { parts_match: false, parts_reason: 'two knots instead of one' })
    const job = await runAll(jobOf(['templatelib']))
    const regen = h.cuts.find((cut) => cut.section === `${key}/regenerate`)
    expect(regen, key).toBeDefined()
    expect(regen!.prompt).toContain('Specifically: two knots instead of one.')
    expect(job.section_images.find((entry) => entry.section === key)!.gateBefore).toMatchObject({ verdict: 'fail', parts_match: false })
  })

  it('대표 컷은 재생성 뒤 한 번 더 판정하고, 다시 미달이면 나은 쪽을 남기며 빼지 않고 경고를 남긴다(점검 고침 1, 통합 Q1)', async () => {
    h.gateQueue.set('hero', [{ same_product: false, consistency: 0.5 }])
    const passed = await runAll(jobOf(['templatelib']))
    expect(h.gates.filter((gate) => gate.section === 'hero').length).toBe(2)
    const hero = passed.section_images.find((entry) => entry.section === 'hero')!
    expect(hero.gateRejudge).toMatchObject({ kept: 'regen', before: { verdict: 'fail' }, after: { verdict: 'pass' } })
    expect(hero.gateWarning).toBeUndefined()

    h.gates = []
    h.gateQueue.set('hero', [{ same_product: false, consistency: 0.6, artifact_reason: 'strap missing' }, { same_product: false, consistency: 0.4 }])
    const failed = await runAll(jobOf(['templatelib']))
    const kept = failed.section_images.find((entry) => entry.section === 'hero')!
    expect(kept.url).toBeTruthy()
    expect(kept.gateRejudge?.kept).toBe('first')
    expect(kept.gateWarning).toContain('첫 화면 대표 컷')
    expect(kept.droppedForProduct).toBeUndefined()
    expect(gateWarningNotes(failed.section_images).map((note) => note.section)).toEqual(['hero'])
  })

  it('착용 상품의 착용 컷이 재판정 뒤에도 상품 불일치면 페이지에서 빼고, 렌더·편집기 조립은 깨지지 않는다(점검 고침 1)', async () => {
    const start = jobOf(['templatelib', 'shotvary'])
    const strap = { ...start, spec_sheet: { ...start.spec_sheet, productName: '핸드폰 손목 스트랩' } }
    const planned = await runOnce(strap)
    expect(planned.section_plan.templatelib!.hero!.kind).toBe('worn')
    const worn = buildImageTasks(planned).find((task) => task.wornCut && task.section !== 'hero' && !task.effectOnly && !task.skipGate && !task.motion)
    expect(worn).toBeDefined()
    h.cuts = []
    h.gates = []
    h.gateQueue.set(worn!.section, [{ same_product: false, consistency: 0.5 }, { same_product: false, consistency: 0.4, artifact_reason: 'braid instead of two cords' }])
    const job = await runAll(strap)
    const entry = job.section_images.find((e) => e.section === worn!.section)!
    expect(h.gates.filter((gate) => gate.section === worn!.section).length).toBe(2)
    expect(entry.url).toBe('')
    expect(entry.droppedForProduct?.url).toContain('cdn.test')
    expect(entry.error).toContain('페이지에서 뺌')
    expect(cutFailureNotes(job.section_images).find((note) => note.section === worn!.section)?.reason).toBe('원본과 다른 상품이라 뺌')
    // 빠진 컷은 실패 컷과 같은 길 — 렌더·편집기 조립이 깨지지 않고 뺀 사진은 어디에도 쓰지 않는다
    const rendered = await renderJobHtml(job, null)
    expect(rendered.html).not.toContain(entry.droppedForProduct!.url)
    const editor = assembleEditorDataResponse(job, null)
    expect(JSON.stringify(editor)).not.toContain(`"${entry.droppedForProduct!.url}"`)
    // 쿠팡 드래프트 이미지 목록 — pdp-pipeline compose의 appendDraftDetailAssets와 같은 고르기(url 있는 컷만)
    const draftImageUrls = job.section_images.filter((s) => s.url && !isPlateTask(s)).map((s) => s.url)
    expect(draftImageUrls.length).toBeGreaterThan(0)
    expect(draftImageUrls).not.toContain(entry.droppedForProduct!.url)
    expect(draftImageUrls).not.toContain('')
  })

  it('치수가 없는 K 잡은 배열만 묻고 크기는 묻지 않는다(실물 크기 11-05)', async () => {
    const job = jobOf(['templatelib'])
    await runAll({ ...job, spec_sheet: { ...job.spec_sheet, size: '  ' } })
    expect(h.gates.length).toBeGreaterThan(0)
    for (const gate of h.gates) expect((gate.options as { realSize?: string }).realSize, gate.section).toBeUndefined()
    expect(h.gates.every((gate) => (gate.options as { lineCut?: boolean }).lineCut === true)).toBe(true)
  })

  /** 게이트를 거치는, 바탕이 다른 컷 하나 */
  const stagedShot = async () => {
    const job = await runAll(jobOf(['templatelib']))
    const key = h.gates.find((gate) => (gate.options as { stagedCut?: boolean } | undefined)?.stagedCut)!.section
    h.cuts = []
    h.gates = []
    return job.section_plan.templatelib!.shots!.find((shot) => shot.key === key)!
  }

  it('K 컷 크기만 미달이면 다시 만들지 않고 판정 글과 까닭을 남겨 통과시킨다(K5 P01 실측 11-06)', async () => {
    const shot = await stagedShot()
    h.gateOnce.set(shot.key, { size_plausible: false, size_reason: 'twice the hand width' })
    const job = await runAll(jobOf(['templatelib']))
    // 생성 1회·판정 1회 — 재생성 콜이 없다
    expect(h.cuts.filter((cut) => cut.section.split('/')[0] === shot.key)).toHaveLength(1)
    expect(h.gates.filter((gate) => gate.section === shot.key)).toHaveLength(1)
    const entry = job.section_images.find((row) => row.section === shot.key)!
    expect(entry.gate).toEqual({
      verdict: 'pass',
      consistency: 0.9,
      same_product: true,
      has_artifact: false,
      size_plausible: false,
      size_reason: 'twice the hand width',
      note: SCALE_KEPT_NOTE,
    })
    expect(entry.gateBefore).toBeUndefined()
    expect(entry.regenNotRejudged).toBeUndefined()
    expect(entry.error).toBeUndefined()
    expect(gateStats(job.section_images)).toMatchObject({ regenerated: 0, scaleKept: 1 })
    expect(gateStats(job.section_images)).not.toHaveProperty('notRejudged')
  })

  it('크기와 다른 사유가 함께 미달이면 지금처럼 한 번 다시 만들고, 사유·지시는 크기가 아닌 실제 사유다 — 재생성 컷에 재판정 없음 표지', async () => {
    const cases = [
      { once: { consistency: 0.69 }, reason: 'consistency', directive: 'the generated product drifted from the reference' },
      { once: { has_artifact: true, artifact_reason: 'blurry edge' }, reason: 'consistency', directive: 'the generated product drifted from the reference' },
      { once: { same_product: false }, reason: 'structure', directive: 'the product structure did not match the reference' },
    ]
    for (const { once, reason, directive } of cases) {
      const shot = await stagedShot()
      h.gateOnce.set(shot.key, { ...once, size_plausible: false, size_reason: 'twice the hand width' })
      const job = await runAll(jobOf(['templatelib']))
      const label = JSON.stringify(once)
      const cuts = h.cuts.filter((cut) => cut.section.split('/')[0] === shot.key)
      expect(cuts, label).toHaveLength(2)
      expect(cuts[1].prompt, label).toContain(`PREVIOUS ATTEMPT FAILED — ${directive}`)
      expect(cuts[1].prompt, label).not.toContain('the product was drawn at the wrong size')
      // 재생성본은 다시 판정하지 않는다 — 판정 1회
      expect(h.gates.filter((gate) => gate.section === shot.key), label).toHaveLength(1)
      const entry = job.section_images.find((row) => row.section === shot.key)!
      // 미달 기록은 크기 칸까지 남기고 사유는 실제 사유, 까닭 글은 없다(재생성했다)
      expect(entry.gateBefore, label).toMatchObject({ verdict: 'fail', reason, size_plausible: false, size_reason: 'twice the hand width' })
      expect(entry.gateBefore, label).not.toHaveProperty('note')
      expect(entry.gate, label).toBeUndefined()
      expect(entry.regenNotRejudged, label).toBe(true)
      expect(gateStats(job.section_images), label).toMatchObject({ regenerated: 1, reasons: { [reason]: 1 }, notRejudged: 1 })
      expect(gateStats(job.section_images), label).not.toHaveProperty('scaleKept')
    }
  })

  it('무대가 달라도 상품이 다르거나 결함이 있거나 일관성이 0.7 아래면 그대로 다시 만든다', async () => {
    for (const once of [{ same_product: false }, { has_artifact: true, artifact_reason: '글자' }, { consistency: 0.69 }]) {
      const shot = await stagedShot()
      h.gateOnce.set(shot.key, once)
      await runAll(jobOf(['templatelib']))
      // 재생성 콜의 단계 이름은 <키>/regen… 이다
      expect(h.cuts.filter((cut) => cut.section.split('/')[0] === shot.key), JSON.stringify(once)).toHaveLength(2)
    }
    // 임계값 바로 위는 통과다 — 0.7을 바꾸지 않았다
    const shot = await stagedShot()
    h.gateOnce.set(shot.key, { consistency: 0.7 })
    await runAll(jobOf(['templatelib']))
    expect(h.cuts.filter((cut) => cut.section.split('/')[0] === shot.key)).toHaveLength(1)
  })

  it('끈 잡은 끝까지 돌려도 K 지시와 K 컷 키가 없다', async () => {
    const job = await runAll(jobOf([]))
    expect(h.gates.length).toBeGreaterThan(0)
    expect(h.gates.every((gate) => gate.options === undefined)).toBe(true)
    expect(job.section_plan.templatelib).toBeUndefined()
    expect(h.cuts.length).toBeGreaterThan(0)
    expect(h.cuts.some((c) => c.prompt.includes('[Shot direction]'))).toBe(false)
    expect(job.section_images.some((entry) => /^k\d+_/.test(entry.section))).toBe(false)
    expect(job.current_step).toBe('compose')
  })

  it('사진 없는 옵션이 있는 K 잡: 상품 컷에 D와 같은 옵션 규칙이 붙고 컷 지시 글에서 사진 없는 옵션 이름이 빠진다(적용 K6 ③)', async () => {
    const planned = await runAll(jobOf(['templatelib']))
    const shots = planned.section_plan.templatelib!.shots!
    const variant = (label: string, photo?: string) => ({ label, values: { design: label }, ...(photo ? { sourceImage: photo } : {}) })
    const optionSpec = { source: 'manual', axes: [{ kind: 'design', name: '디자인', values: ['데이지', '체리'] }], variants: [variant('데이지', 'https://cdn.example.com/daisy.jpg'), variant('체리')] }
    const withOptions = (spec: typeof optionSpec) =>
      ({
        ...planned,
        spec_sheet: { ...planned.spec_sheet, optionSpec: spec },
        section_plan: { ...planned.section_plan, templatelib: { ...planned.section_plan.templatelib!, shots: shots.map((shot) => ({ ...shot, show: '데이지/체리 컬러로 골라요' })) } },
      }) as PdpJobRow
    const job = withOptions(optionSpec)
    const rule = optionPhotoGuard(optionPhotoCoverage(optionSpecOf(job.spec_sheet, job.analysis)))
    expect(rule).toContain('OPTION DESIGN RULE')
    const tasks = buildImageTasks(job)
    // 대표 컷 + 계획 컷 모두 — 상품이 나오지 않는 컷(effectOnly)은 D처럼 그대로
    expect(tasks.map((task) => task.section)).toEqual(['hero', ...shots.map((shot) => shot.key)])
    for (const task of tasks) {
      if (task.effectOnly) {
        expect(task.prompt, task.section).not.toContain(rule)
        continue
      }
      expect(task.prompt.endsWith(`\n${rule}`), task.section).toBe(true)
      expect(task.prompt, task.section).not.toContain('체리')
      if (task.shotBrief) {
        expect(task.shotBrief, task.section).not.toContain('체리')
        // 대표 컷 지시에는 칸 글이 없다(적용 K13 ③)
        if (task.section !== 'hero') expect(task.shotBrief, task.section).toContain('데이지 컬러로 골라요')
      }
    }
    expect(tasks.some((task) => !task.effectOnly && task.shotBrief)).toBe(true)
    // 옵션 사진이 모두 있으면 규칙이 없고 이름도 그대로다
    const all = buildImageTasks(withOptions({ ...optionSpec, variants: [variant('데이지', 'https://cdn.example.com/daisy.jpg'), variant('체리', 'https://cdn.example.com/cherry.jpg')] }))
    expect(all.some((task) => task.prompt.includes('OPTION DESIGN RULE'))).toBe(false)
    expect(all.filter((task) => task.shotBrief?.includes('Text of this section')).every((task) => task.shotBrief!.includes('데이지/체리 컬러로 골라요'))).toBe(true)
  })

  it('수량 컷: 옵션 수량 가운데 가장 큰 수 이하를 적고, 사진 없는 옵션 이름 지우기(적용 K6 ③)에 지워지지 않는다(적용 K6 R-B7)', async () => {
    const planned = await runAll(jobOf(['templatelib']))
    const shots = planned.section_plan.templatelib!.shots!
    const at = shots.findIndex((shot) => !shotRouteOf(shot.purpose).effectOnly)
    // 가드는 색상·디자인 축만 본다(수량 축은 생김새가 같다) — 수량 × 색상 옵션에서 사진 없는 색(화이트)이 가드를 켠다
    const variant = (quantity: string, color: string, photo?: string) => ({ label: `${quantity} ${color}`, values: { quantity, color }, ...(photo ? { sourceImage: photo } : {}) })
    const optionSpec = {
      source: 'manual',
      axes: [
        { kind: 'quantity', name: '수량', values: ['2개', '6개'] },
        { kind: 'color', name: '색상', values: ['블랙', '화이트'] },
      ],
      variants: [variant('2개', '블랙', 'https://cdn.example.com/two-black.jpg'), variant('6개', '블랙', 'https://cdn.example.com/six-black.jpg'), variant('2개', '화이트'), variant('6개', '화이트')],
    }
    const job = {
      ...planned,
      spec_sheet: { ...planned.spec_sheet, extraSpecs: (planned.spec_sheet.extraSpecs ?? []).filter((row) => row.key !== '구성'), optionSpec },
      section_plan: { ...planned.section_plan, templatelib: { ...planned.section_plan.templatelib!, shots: shots.map((shot, i) => (i === at ? { ...shot, purpose: 'quantity', show: '블랙·화이트 2개·6개 중 골라요' } : shot)) } },
    } as PdpJobRow
    expect(optionPhotoGuard(optionPhotoCoverage(optionSpecOf(job.spec_sheet, job.analysis)))).toContain('OPTION DESIGN RULE')
    const tasks = buildImageTasks(job)
    const quantity = tasks.find((task) => task.section === shots[at].key)!
    expect(quantity.shotBrief).not.toContain('화이트')
    expect(quantity.shotBrief).toContain('Show no more than 6 pieces.')
    expect(tasks.filter((task) => task.section !== shots[at].key).some((task) => task.shotBrief?.includes('no more than'))).toBe(false)
  })

  it('제품군 문장은 계획 기록의 제품군을 따라 맞는 목적 컷 Purpose 줄에만 붙는다 — 기록이 근거 없는 제품군이면 그대로다(적용 K6 T1-80 ①)', async () => {
    const planned = await runAll(jobOf(['templatelib']))
    const record = planned.section_plan.templatelib!
    // 픽스처(파티 폭죽, household)는 제품군이 없다 — 기록 제품군만 바꿔 본다
    expect(record.productFamily).toBeUndefined()
    const withFamily = (productFamily: string, extraSpecs = planned.spec_sheet.extraSpecs) =>
      ({ ...planned, spec_sheet: { ...planned.spec_sheet, extraSpecs }, section_plan: { ...planned.section_plan, templatelib: { ...record, productFamily } } }) as PdpJobRow
    const base = buildImageTasks(planned)
    expect(buildImageTasks(withFamily('garden_diy'))).toEqual(base)
    // 픽스처 컷에 맞는 목적이 있는 제품군 — 그 컷의 Purpose 줄만 바뀐다
    const shots = record.shots!
    const family = FAMILY_SHOT_FAMILIES.find((name) => shots.some((shot) => familyShotLine(name, shot.purpose) !== null))!
    expect(family).toBeTruthy()
    const tasks = buildImageTasks(withFamily(family))
    expect(tasks.map((task) => task.section)).toEqual(base.map((task) => task.section))
    let changed = 0
    for (const [i, task] of tasks.entries()) {
      const shot = shots.find((s) => s.key === task.section)
      const sentence = shot ? familyShotLine(family, shot.purpose) : null
      if (!sentence) {
        expect(task, task.section).toEqual(base[i])
        continue
      }
      changed += 1
      expect(task.shotBrief, task.section).toBe(base[i].shotBrief!.replace(/^(Purpose: .*)$/m, (line) => `${line} ${sentence}`))
      expect({ ...task, shotBrief: '' }, task.section).toEqual({ ...base[i], shotBrief: '' })
    }
    expect(changed).toBeGreaterThan(0)
    // 신선 식품의 재료 이름은 입력 칸에서, 규제 표현이 든 이름은 뺀다
    const scenes = shots.filter((shot) => familyShotLine('fresh', shot.purpose) !== null)
    expect(scenes.length).toBeGreaterThan(0)
    const fresh = buildImageTasks(withFamily('fresh', [...(planned.spec_sheet.extraSpecs ?? []), { key: '원재료', value: '사과, 치료용 배' }]))
    for (const shot of scenes) {
      const brief = fresh.find((task) => task.section === shot.key)!.shotBrief!
      expect(brief, shot.key).toContain('Show the fresh food itself (사과) with')
      expect(brief, shot.key).not.toContain('치료')
    }
  })

  it('K 첫 화면은 계획 기록 hero.kind를 쓰고, 기록이 없으면 K 규칙(화장품 스튜디오)으로 고른다 — D는 heroKindOf 그대로(적용 K6 T1-80 ②)', async () => {
    const planned = await runAll(jobOf(['templatelib']))
    const record = planned.section_plan.templatelib!
    const heroOf = (job: PdpJobRow) => buildImageTasks(job).find((task) => task.section === 'hero')!
    const withHero = (hero: typeof record.hero) => ({ ...planned, section_plan: { ...planned.section_plan, templatelib: { ...record, hero } } }) as PdpJobRow
    // 픽스처(household)는 실사용 — 기록 그대로
    expect(record.hero?.kind).toBe('in_use')
    expect(heroOf(planned)).toMatchObject({ heroKind: 'in_use' })
    expect(heroOf(planned).studioPrompt).toBeTruthy()
    // 기록이 스튜디오면 스튜디오 프롬프트 그대로
    const studio = heroOf(withHero({ ...record.hero!, kind: 'studio' }))
    expect(studio.heroKind).toBe('studio')
    expect(studio.studioPrompt).toBeUndefined()
    // 기록이 없는 화장품 K 잡은 스튜디오, 같은 상품의 D(herotype) 잡은 실사용
    const cosmetic = { ...withHero(undefined), spec_sheet: { ...planned.spec_sheet, productName: '수분 크림' }, analysis: { ...planned.analysis, detected_category: 'beauty' } } as PdpJobRow
    expect(heroOf(cosmetic).heroKind).toBe('studio')
    const dJob = {
      ...cosmetic,
      analysis: { ...cosmetic.analysis, enrichment: { version: 1, features: [...FEATURES, 'herotype'] } },
      section_plan: { ...cosmetic.section_plan, templatelib: undefined },
    } as PdpJobRow
    expect(heroOf(dJob).heroKind).toBe('in_use')
    // 화장품 K 잡을 계획하면 기록 첫 화면 유형이 스튜디오고 제품군이 남는다
    const start = jobOf(['templatelib'])
    const beauty = await runOnce({ ...start, spec_sheet: { ...start.spec_sheet, productName: '수분 크림' }, analysis: { ...start.analysis, detected_category: 'beauty' } })
    expect(beauty.section_plan.templatelib!.hero!.kind).toBe('studio')
    expect(beauty.section_plan.templatelib!.productFamily).toBe('cosmetic')
  })

  it('끈 잡: 선택·카피 콜이 없고 계획에 templateRef가 없다', async () => {
    const job = await runOnce(jobOf([]))
    expect(h.calls).toEqual({ guideline: 0, compose: 0, select: 0, slots: 0 })
    expect(job.section_plan.templatelib).toBeUndefined()
    expect(job.section_plan.designcut!.sections.some((section) => section.templateRef)).toBe(false)
    expect(job.section_plan.designcut!.templateColors).toBeUndefined()
  })
})

describe('게이트 판정 옵션·미달 기준(실물 크기 11-05)', () => {
  it('D 라인 태스크는 옵션이 없다 — 지금과 같다', () => {
    expect(gatePromptOptionsOf({})).toBeUndefined()
    expect(gatePromptOptionsOf({ stagedGate: true })).toEqual({ stagedCut: true })
  })

  it('K 라인 태스크는 배열을, 치수가 있으면 크기도 묻는다', () => {
    expect(gatePromptOptionsOf({ lineGate: {} })).toEqual({ lineCut: true })
    expect(gatePromptOptionsOf({ lineGate: { realSize: '9.7cm x 18.3cm' } })).toEqual({ lineCut: true, realSize: '9.7cm x 18.3cm' })
    expect(gatePromptOptionsOf({ stagedGate: true, lineGate: { realSize: '1cm' } })).toEqual({ stagedCut: true, lineCut: true, realSize: '1cm' })
  })

  it('크기 칸은 미달 기준에 들지 않는다(K5 P01 실측 11-06) — 크기만 미달은 통과, 다른 사유가 함께면 미달', () => {
    const ok = { has_artifact: false, same_product: true, consistency: 0.9 }
    expect(isGateFailure(ok)).toBe(false)
    expect(isGateFailure({ ...ok, size_plausible: true })).toBe(false)
    expect(isGateFailure({ ...ok, size_plausible: false })).toBe(false)
    expect(isGateFailure({ ...ok, size_plausible: false, consistency: 0.69 })).toBe(true)
    expect(isGateFailure({ ...ok, size_plausible: false, has_artifact: true })).toBe(true)
    expect(isGateFailure({ ...ok, consistency: 0.69 })).toBe(true)
    expect(isGateFailure({ ...ok, consistency: 0.7 })).toBe(false)
    expect(isGateFailure({ ...ok, same_product: false })).toBe(true)
    expect(isGateFailure({ ...ok, has_artifact: true })).toBe(true)
  })

  it('크기 칸을 뺀 점수는 칸이 false일 때만 사본이고, 칸이 없거나 true면 같은 객체다 — 원본은 그대로', () => {
    const plain = { same_product: true, artifact_reason: '' }
    expect(withoutSizeScore(plain)).toBe(plain)
    const sized = { ...plain, size_plausible: true, size_reason: '' }
    expect(withoutSizeScore(sized)).toBe(sized)
    const small = { ...plain, size_plausible: false, size_reason: 'twice the hand width' }
    expect(withoutSizeScore(small)).toEqual(plain)
    expect(small).toEqual({ ...plain, size_plausible: false, size_reason: 'twice the hand width' })
  })

  it('크기 단독 통과 기록 글은 통과 판정에만 붙는다', () => {
    const score = { consistency: 0.9, same_product: true, has_artifact: false, artifact_reason: '', size_plausible: false, size_reason: 'r' }
    expect(gateRecordOf({ verdict: 'pass', score })!.note).toBe(SCALE_KEPT_NOTE)
    expect(gateRecordOf({ verdict: 'fail', reason: 'consistency', score: { ...score, consistency: 0.5 } })).not.toHaveProperty('note')
    expect(gateRecordOf({ verdict: 'pass', score: { ...score, size_plausible: true } })).not.toHaveProperty('note')
  })
})

describe('D·운영 기본 게이트는 크기 기록 전과 바이트까지 같다(K5 P01 11-06 수리는 K 컷만)', () => {
  beforeEach(() => {
    h.gateOnce = new Map()
    h.gates = []
    h.cuts = []
  })
  const runAll = async (start: PdpJobRow, runs = 30) => {
    let job = start
    h.job = job
    for (let i = 0; i < runs && job.current_step === 'images'; i++) job = await runImagesStep({} as never, 'user-1', job, { concurrency: 1 })
    return job
  }
  const opsJob = (key: 'A-track-s' | 'A-track-i' | 'B-track-s' | 'C-track-i'): PdpJobRow => ({
    ...rewindTo(fixtureToJob(loadEnrichmentFixture(key)), 'images'),
    current_step: 'images',
  })
  /** 크기 칸이 없던 때의 기록 — 키 순서까지 */
  const PASS_RECORD = JSON.stringify({ verdict: 'pass', consistency: 0.9, same_product: true, has_artifact: false })
  const FAIL_RECORD = JSON.stringify({ verdict: 'fail', consistency: 0.69, same_product: true, has_artifact: false, reason: 'consistency' })

  it.each([
    ['D 디자인 컷', () => jobOf([])],
    ['운영 기본 Track S', () => opsJob('A-track-s')],
    ['운영 기본 Track I', () => opsJob('A-track-i')],
  ])('%s: 판정 문구 옵션·미달 재생성·기록·원장 요약 키가 그대로다', async (_name, make) => {
    // 게이트를 거치는 상품 컷 하나를 골라 일관성 미달을 준다
    await runAll(make())
    const target = h.gates.find((gate) => gate.section !== 'hero')!.section
    h.gates = []
    h.cuts = []
    h.gateOnce.set(target, { consistency: 0.69 })
    const job = await runAll(make())
    expect(job.current_step).toBe('compose')
    expect(h.gates.every((gate) => gate.options === undefined)).toBe(true)
    // 미달 컷은 한 번 다시 만들고(지시는 일관성), 재생성본은 판정하지 않는다
    const cuts = h.cuts.filter((cut) => cut.section.split('/')[0] === target)
    expect(cuts).toHaveLength(2)
    expect(cuts[1].prompt).toContain('PREVIOUS ATTEMPT FAILED — the generated product drifted from the reference')
    const regen = job.section_images.find((entry) => entry.section === target)!
    expect(JSON.stringify(regen.gateBefore)).toBe(FAIL_RECORD)
    expect(regen.gate).toBeUndefined()
    // 새 칸(재판정 없음 표지·크기 까닭 글)이 어디에도 없다
    const serialized = JSON.stringify(job.section_images)
    expect(serialized).not.toContain('regenNotRejudged')
    expect(serialized).not.toContain('"note"')
    expect(serialized).not.toContain('"size_plausible"')
    expect(serialized).not.toContain('"size_reason"')
    for (const entry of job.section_images) if (entry.gate) expect(JSON.stringify(entry.gate), entry.section).toBe(PASS_RECORD)
    expect(Object.keys(gateStats(job.section_images)!)).toEqual(['judged', 'regenerated', 'reasons', 'consistency'])
  })
})

describe('GIF 칸 태스크(세션 B ③ P3) — 스위치 꺼진 잡은 그대로', () => {
  const runAll = async (start: PdpJobRow, runs = 20) => {
    let job = start
    h.job = job
    for (let i = 0; i < runs && job.current_step === 'images'; i++) job = await runImagesStep({} as never, 'user-1', job, { concurrency: 1 })
    return job
  }
  const withoutMotionband = (job: PdpJobRow): PdpJobRow =>
    ({ ...job, analysis: { ...job.analysis, enrichment: { version: 1, features: [...FEATURES, 'templatelib'] } } }) as PdpJobRow

  it('꺼진 잡은 태스크·기록에 motion이 없고, 켠 잡도 motion_band가 아닌 컷 태스크는 스위치만 뺀 같은 계획과 같다', async () => {
    const off = await runAll(jobOf(['templatelib']))
    expect(buildImageTasks(off).filter((task) => 'motion' in task)).toEqual([])
    expect(off.section_images.filter((entry) => 'motion' in entry)).toEqual([])
    const on = await runAll(jobOf(['templatelib', 'motionband']))
    const motionKeys = new Set((on.section_plan.templatelib?.shots ?? []).filter((shot) => shot.section === 'motion_band').map((shot) => shot.key))
    // 켠 잡은 대표 칸 태스크(hero_motion)가 대표 컷 바로 뒤에 하나 더 있다(움직이는 칸 자리 규칙 ①) — 그 밖은 아래처럼 같다
    const all = buildImageTasks(on)
    expect(all.filter((task) => task.section === 'hero_motion').map((task) => [all.indexOf(task), task.motion?.role, task.skipGate])).toEqual([[1, 'hero', true]])
    expect(on.section_plan.templatelib?.motion).toMatchObject({ engine: 'gif-sheet', hero: true, cells: [] })
    const tasksOn = all.filter((task) => task.section !== 'hero_motion')
    const tasksOff = buildImageTasks(withoutMotionband(on))
    expect(tasksOn.map((task) => task.section)).toEqual(tasksOff.map((task) => task.section))
    tasksOn.forEach((task, i) => {
      if (!motionKeys.has(task.section)) expect(task, task.section).toEqual(tasksOff[i])
      else expect({ ...task, motion: undefined }, task.section).toEqual({ ...tasksOff[i], motion: undefined })
    })
    expect(tasksOff.filter((task) => 'motion' in task)).toEqual([])
  })

  it('손·착용·사용 컷만 실물 쓰는 법 줄을 받고(점검 고침 3), Use 줄은 재료가 있을 때만·없으면 useFacts none을 기록한다', async () => {
    h.cuts = []
    const job = await runAll(jobOf(['templatelib']))
    const shots = new Map((job.section_plan.templatelib?.shots ?? []).map((shot) => [shot.key, shot]))
    const stills = h.cuts.filter((cut) => shots.has(cut.section))
    expect(stills.some((cut) => getsUseLine(shots.get(cut.section)!))).toBe(true)
    for (const cut of stills) {
      const handled = getsUseLine(shots.get(cut.section)!)
      expect(cut.prompt.includes(`Correct use: ${CORRECT_USE_LINE}`), cut.section).toBe(handled)
      // Use 줄은 재료(판매자 메모·식별 카드의 쓰는 법 문장)가 있을 때만, 없으면 기록 — 이 잡의 재료로 기대값을 만든다
      const facts = handlingFactsOf(job.spec_sheet.identityNote, job.design_prompts.identity_card)
      expect(cut.prompt.includes(`Use (from the seller note and the product photos — follow exactly): ${facts}`), cut.section).toBe(handled && facts !== null)
      const entry = job.section_images.find((e) => e.section === cut.section)
      if (entry?.url) expect(entry.useFacts, cut.section).toBe(handled && facts === null ? 'none' : undefined)
    }
    expect(h.cuts.find((cut) => cut.section === 'hero')?.prompt).not.toContain('Correct use:')
  })

  it('움직이는 칸 GIF 지시도 정지 컷과 같은 조립을 거친다(점검 고침 2) — 참조 안내·Refs 줄·부품 규칙 뒤에 ANIMATION, 대표 칸은 맨 끝 대표 컷 Refs', async () => {
    h.cuts = []
    await runAll(jobOf(['templatelib', 'motionband', 'partsrule']))
    const gifs = h.cuts.filter((cut) => cut.section.endsWith('/motion'))
    expect(gifs.map((cut) => cut.section)).toContain('hero_motion/motion')
    for (const cut of gifs) {
      expect(cut.prompt, cut.section).toContain("REFERENCE ROLES: the FIRST attached image is the USER'S ORIGINAL PRODUCT PHOTO")
      expect(cut.prompt, cut.section).toContain(PARTS_RULE_BLOCK)
      expect(cut.prompt.indexOf(PARTS_RULE_BLOCK), cut.section).toBeLessThan(cut.prompt.indexOf('ANIMATION (do not render this text):'))
    }
    expect(gifs.find((cut) => cut.section === 'hero_motion/motion')?.prompt).toContain('LAST image = this page hero cut (frame 1)')
    // 잡 기록 sentPrompt(#883)도 조립 뒤 글 — 대표 칸 entry의 기록이 GIF로 보낸 글과 같고 참조 안내·부품 규칙·ANIMATION을 담는다
    const heroMotion = (await runAll(jobOf(['templatelib', 'motionband', 'partsrule']))).section_images.find((e) => e.section === 'hero_motion')
    expect(heroMotion?.sentPrompt).toBe(gifs.find((cut) => cut.section === 'hero_motion/motion')?.prompt)
    for (const part of ['REFERENCE ROLES', PARTS_RULE_BLOCK, 'ANIMATION (do not render this text):']) expect(heroMotion?.sentPrompt, part).toContain(part)
    // 정지 대표 컷도 참조 안내를 받는다(스타일 참조가 없는 컷)
    const hero = h.cuts.find((cut) => cut.section === 'hero')
    expect(hero?.prompt).toContain('Refs: photo 1 = structure master')
  })

  it('계획 AI가 후보를 모두 골라도 고른 칸은 상한(대표 포함 3) 안이고, 고른 컷 태스크만 그 칸 비율의 움직이는 칸이 된다', async () => {
    h.motionPicks = 'all'
    h.motionInputs = []
    try {
      const on = await runAll(jobOf(['templatelib', 'motionband']))
      const record = on.section_plan.templatelib?.motion
      const band = (on.section_plan.templatelib?.shots ?? []).some((shot) => shot.section === 'motion_band')
      expect(h.motionInputs).toHaveLength(1)
      expect(h.motionInputs[0].max).toBe(band ? 1 : 2)
      expect(record?.cells.length).toBeGreaterThan(0)
      expect(record?.cells.length).toBeLessThanOrEqual(h.motionInputs[0].max)
      expect(1 + (band ? 1 : 0) + (record?.cells.length ?? 0)).toBeLessThanOrEqual(3)
      const picked = new Set(record?.cells.map((cell) => cell.key))
      const tasks = buildImageTasks(on)
      const shotsByKey = new Map((on.section_plan.templatelib?.shots ?? []).map((shot) => [shot.key, shot]))
      for (const task of tasks) {
        if (picked.has(task.section)) expect(task.motion, task.section).toMatchObject({ role: 'pick', aspect: shotsByKey.get(task.section)?.aspect, reason: '시험 까닭' })
        else if (task.section !== 'hero_motion' && !(task.motion && !task.motion.role)) expect(task.motion, task.section).toBeUndefined()
      }
    } finally {
      h.motionPicks = []
    }
  })
})

describe('사진 다양화(shotvary, 세션 B variety) — 꺼진 잡은 컷 프롬프트가 바이트 그대로', () => {
  beforeEach(() => {
    h.calls = { guideline: 0, compose: 0, select: 0, slots: 0 }
    h.slotsFail = false
    h.slotsThrow = null
    h.slotText = '글'
    h.accentText = ''
    h.cutFails = new Map()
    h.gateOnce = new Map()
    h.gates = []
    h.cuts = []
  })
  const runAll = async (start: PdpJobRow, runs = 20) => {
    let job = start
    h.job = job
    for (let i = 0; i < runs && job.current_step === 'images'; i++) job = await runImagesStep({} as never, 'user-1', job, { concurrency: 1 })
    return job
  }
  /** 컷 키와 프롬프트 지문 — 스냅숏은 이 PR 전 코드로 만들었다(스위치가 꺼진 잡은 이 값이 바뀌면 안 된다) */
  // J61(스위치 없음): 사용 구도 고민 컷(k3_photo_0·k14_left_0·k13_left_0, 목적 problem·in_use)이 실물 쓰는 법 줄을 잃어 세 지문을 다시 만들었다
  const promptPrints = () => h.cuts.map((cut) => `${cut.section} ${createHash('sha256').update(cut.prompt).digest('hex').slice(0, 16)} refs=${cut.refs}`)

  it.each([
    ['생활(기본 카테고리)', (job: PdpJobRow) => job],
    ['반려', (job: PdpJobRow) => ({ ...job, analysis: { ...job.analysis, detected_category: 'pet' } }) as PdpJobRow],
  ])('%s K 잡: 컷마다 프롬프트 지문이 이 PR 전과 같다', async (_name, shape) => {
    const job = await runAll(shape(testJobOf(['templatelib'])))
    expect(job.current_step).toBe('compose')
    expect(promptPrints()).toMatchSnapshot()
    // 꺼진 잡은 계획에 카메라·사람 칸이 없고 구도 짝 기록도 없다
    for (const shot of job.section_plan.templatelib!.shots!) expect(shot, shot.key).not.toHaveProperty('camera')
    expect(JSON.stringify(job.section_images)).not.toContain('lineTwin')
  })

  it.each([
    ['생활', (job: PdpJobRow) => job],
    ['반려', (job: PdpJobRow) => ({ ...job, analysis: { ...job.analysis, detected_category: 'pet' } }) as PdpJobRow],
  ])('%s: 켠 잡은 컷마다 카메라를, 사람 컷은 박자를 기록하고 프롬프트가 그 값을 싣는다 — 고정 장면·표정·렌즈 줄은 빠지고 품질 규칙은 남는다', async (_name, shape) => {
    const job = await runAll(shape(jobOf(['templatelib', 'shotvary'])))
    expect(job.current_step).toBe('compose')
    const shots = job.section_plan.templatelib!.shots!
    const promptOf = (key: string) => h.cuts.find((c) => c.section === key)!.prompt
    for (const shot of shots) {
      const prompt = promptOf(shot.key)
      if (shot.sizeCut) {
        expect(shot, shot.key).not.toHaveProperty('camera')
        continue
      }
      expect(shot.camera, shot.key).toBeDefined()
      expect(prompt, shot.key).toMatch(/^Camera: .+ — .+; camera /m)
      // 사용 기본 프롬프트를 받는 컷은 컷마다 같던 줄이 빠진다
      for (const label of ['Scene', 'Environment', 'Expression', 'Lens']) expect(prompt, `${shot.key} ${label}`).not.toMatch(new RegExp(`^- ${label}: `, 'm'))
      if (shotRouteOf(shot.purpose).base === 'usage') expect(prompt, shot.key).toContain('Human Subject Quality Rules:')
      if (shot.person) expect(prompt, shot.key).toMatch(/^Person: /m)
      else expect(prompt, shot.key).not.toMatch(/^Person: /m)
      // 상품 참조를 받는 컷은 대표 컷에서 정체성·옷·빛만 받는다
      // 상품 참조를 받는 컷 — 사람이 보이는 Person 줄 컷만 대표 컷에서 사람·옷·빛을, 그 밖은 빛·색만 받고, 둘 다 첫 장 각도를 풀어 준다(운영 P08)
      if (!shotRouteOf(shot.purpose).effectOnly) {
        expect(prompt, shot.key).toContain(FIRST_ANGLE_TEXT)
        if (varyRefsOf(shot.person) === 'person') expect(prompt, shot.key).toContain(VARY_REFERENCE_TEXT)
        else expect(prompt, shot.key).toContain(VARY_LIGHT_TEXT)
      }
    }
    expect(shots.filter((shot) => shot.person).length).toBeGreaterThan(0)
    // 사람 대표 컷은 계획 0번(K6 P07 후속) — K 컷 웃는 얼굴은 상한에서 대표 컷 몫을 뺀 수까지, 마무리 사진(cta) 사람 컷은 얼굴 없는 몸 범위만
    const hero = HERO_PERSON[job.section_plan.templatelib!.hero!.kind]
    const smiling = shots.filter((shot) => shot.person?.face === 'soft_smile' || shot.person?.face === 'laugh').length
    expect(smiling).toBeLessThanOrEqual(SMILE_MAX - (hero ? 1 : 0))
    for (const shot of shots) if (hero && shot.section === 'cta' && shot.person) expect(CTA_FRAMINGS.has(shot.person.framing), shot.key).toBe(true)
    // 실제로 보낸 전체 프롬프트가 잡 기록에 남는다(점검 고침 0) — 바탕 글(prompt)과 달리 식별 카드·참조 안내까지 담는다
    const stills = job.section_images.filter((entry) => entry.url && !entry.motion)
    expect(stills.length).toBeGreaterThan(0)
    for (const entry of stills) {
      const sent = h.cuts.filter((c) => c.section === entry.section).at(-1)!.prompt
      expect(entry.sentPrompt, entry.section).toBe(sent)
      expect(entry.sentPromptMeta, entry.section).toMatchObject({ length: sent.length })
      expect(entry.sentPromptMeta!.sha256, entry.section).toMatch(/^[0-9a-f]{16}$/)
    }
    // 대표 컷은 지금 프롬프트 그대로(참조 안내 덧붙임 없음)
    expect(promptOf('hero')).not.toContain(VARY_REFERENCE_TEXT)
    expect(promptOf('hero')).not.toContain(FIRST_ANGLE_TEXT)
  })

  it('착용 상품(스트랩, 대표 컷 worn) — 사람이 보이는 컷도 상품 구조는 첫 장에서만 받고 대표 컷에서 받지 않는다(K7 P09)', async () => {
    const start = jobOf(['templatelib', 'shotvary'])
    const job = await runAll({ ...start, spec_sheet: { ...start.spec_sheet, productName: '핸드폰 손목 스트랩' } })
    expect(job.section_plan.templatelib!.hero!.kind).toBe('worn')
    const promptOf = (key: string) => h.cuts.find((c) => c.section === key)!.prompt
    const personCuts = job.section_plan.templatelib!.shots!.filter((shot) => !shot.sizeCut && !shotRouteOf(shot.purpose).effectOnly && varyRefsOf(shot.person) === 'person')
    expect(personCuts.length).toBeGreaterThan(0)
    for (const shot of personCuts) {
      const prompt = promptOf(shot.key)
      expect(prompt, shot.key).toContain(VARY_REFERENCE_TEXT)
      expect(prompt, shot.key).toContain(VARY_PRODUCT_EXCLUDED)
      expect(prompt, shot.key).not.toContain('what they wear')
      // 앞의 참조 역할 문구(첫 장 = 구조 정본)와 같은 쪽을 가리킨다
      expect(prompt, shot.key).toContain('single source of truth for the product')
    }
  })
})

describe('규칙 충돌 정리(rulepriority, 결정 카드 c05·J10) — 켠 K 잡만 컷 지시가 바뀐다', () => {
  beforeEach(() => {
    h.calls = { guideline: 0, compose: 0, select: 0, slots: 0 }
    h.slotsFail = false
    h.slotsThrow = null
    h.slotText = '글'
    h.accentText = ''
    h.cutFails = new Map()
    h.gateOnce = new Map()
    h.gates = []
    h.cuts = []
  })
  const runAll = async (start: PdpJobRow, runs = 20) => {
    let job = start
    h.job = job
    for (let i = 0; i < runs && job.current_step === 'images'; i++) job = await runImagesStep({} as never, 'user-1', job, { concurrency: 1 })
    return job
  }

  it('켠 잡: 사진 컷 지시마다 이긴다 문장이 없고 순위 블록이 한 번 붙는다 — 꺼진 잡은 이긴다 문장이 그대로다', async () => {
    const off = await runAll(jobOf(['templatelib']))
    expect(off.current_step).toBe('compose')
    const offStills = h.cuts.filter((cut) => !cut.section.endsWith('/motion'))
    expect(offStills.some((cut) => /wins over/.test(cut.prompt))).toBe(true)
    expect(offStills.some((cut) => cut.prompt.includes(PRIORITY_BLOCK))).toBe(false)
    h.cuts = []
    const on = await runAll(jobOf(['templatelib', 'rulepriority']))
    expect(on.current_step).toBe('compose')
    const stills = h.cuts.filter((cut) => !cut.section.endsWith('/motion'))
    expect(stills.length).toBeGreaterThan(0)
    for (const cut of stills) {
      expect(cut.prompt, cut.section).not.toMatch(/wins over/)
      expect(cut.prompt.split(PRIORITY_BLOCK), cut.section).toHaveLength(2)
    }
    // 잡 기록 sentPrompt도 바뀐 글이다
    for (const entry of on.section_images.filter((e) => e.url && !e.motion)) expect(entry.sentPrompt, entry.section).toContain(PRIORITY_BLOCK)
  })
})

describe('후킹 약속 ↔ 대표 컷(hookhero, 결정 카드 c09·J21) — 켠 K 잡만 칸 카피 입력·계획·대표 컷 지시가 바뀐다', () => {
  beforeEach(() => {
    h.calls = { guideline: 0, compose: 0, select: 0, slots: 0 }
    h.slotsFail = false
    h.slotsThrow = null
    h.slotText = '글'
    h.accentText = ''
    h.cutFails = new Map()
    h.gateOnce = new Map()
    h.gates = []
    h.cuts = []
    h.copyInputs = []
  })
  const runAll = async (start: PdpJobRow, runs = 20) => {
    let job = start
    h.job = job
    for (let i = 0; i < runs && job.current_step === 'images'; i++) job = await runImagesStep({} as never, 'user-1', job, { concurrency: 1 })
    return job
  }
  const heroPrompt = () => h.cuts.find((cut) => cut.section === 'hero')!.prompt

  it('꺼진 잡: 칸 카피 입력에 대표 컷 줄이 없고, 계획에 hook이 없고, 대표 컷 지시에 약속 줄이 없다', async () => {
    const off = await runAll(jobOf(['templatelib']))
    expect(off.current_step).toBe('compose')
    expect(h.copyInputs[0]).not.toHaveProperty('heroShot')
    expect(off.section_plan.templatelib!.hero).not.toHaveProperty('hook')
    expect(heroPrompt()).not.toContain('First-screen promise')
  })

  it('켠 잡: 칸 카피 입력이 대표 컷 유형을 싣고 첫 화면 규칙에 한 줄, 첫 화면 headline이 계획 hook으로 남아 대표 컷 지시 끝에 참고로만 붙는다', async () => {
    const on = await runAll(jobOf(['templatelib', 'hookhero']))
    expect(on.current_step).toBe('compose')
    const hero = on.section_plan.templatelib!.hero!
    const first = h.copyInputs[0] as SlotCopyInput
    expect(first.heroShot).toBe(HERO_SHOT_WORDS[hero.kind])
    expect(buildSlotCopyPrompt(first)).toContain(`첫 화면 사진은 ${HERO_SHOT_WORDS[hero.kind]}이다.`)
    // 가짜 칸 카피는 모든 칸에 같은 글을 쓴다 — 첫 화면 headline이 그 글이다
    expect(hero.hook).toBe('글')
    expect(heroPrompt()).toContain(heroPromiseLine('글'))
    // 글자는 그리지 않는 참고다
    expect(heroPromiseLine('글')).toContain('reference only, never drawn as text')
  })

  it('hookPromiseOf — 첫 화면 headline의 줄바꿈은 빈칸으로, 첫 화면 섹션이나 글이 없으면 null', () => {
    const rows = [{ section: 'hook_3step' }, { section: 'point' }] as never
    expect(hookPromiseOf(rows, new Map([[0, { headline: '아침 준비가\n3분 빨라져요', sub: 'x' }]]))).toBe('아침 준비가 3분 빨라져요')
    expect(hookPromiseOf(rows, new Map([[1, { headline: '다른 섹션' }]]))).toBeNull()
    expect(hookPromiseOf([{ section: 'point' }] as never, new Map([[0, { headline: '글' }]]))).toBeNull()
  })
})

describe('사진 아닌 정보 칸(infocells, 세션 B infographic) — 꺼진 잡은 선택·컷·렌더가 바이트 그대로', () => {
  beforeEach(() => {
    h.calls = { guideline: 0, compose: 0, select: 0, slots: 0 }
    h.slotsFail = false
    h.slotsThrow = null
    h.slotText = '글'
    h.accentText = ''
    h.cutFails = new Map()
    h.gateOnce = new Map()
    h.gates = []
    h.cuts = []
  })
  const runAll = async (start: PdpJobRow, runs = 20) => {
    let job = start
    h.job = job
    for (let i = 0; i < runs && job.current_step === 'images'; i++) job = await runImagesStep({} as never, 'user-1', job, { concurrency: 1 })
    return job
  }
  const sha = (text: string) => createHash('sha256').update(text).digest('hex').slice(0, 16)

  it.each([
    ['생활(기본 카테고리)', (job: PdpJobRow) => job],
    ['반려', (job: PdpJobRow) => ({ ...job, analysis: { ...job.analysis, detected_category: 'pet' } }) as PdpJobRow],
  ])('%s K 잡: 템플릿 선택·컷 키·렌더 HTML 지문이 이 PR 전과 같다', async (_name, shape) => {
    const job = await runAll(shape(testJobOf(['templatelib'])))
    expect(job.current_step).toBe('compose')
    const rendered = await renderJobHtml(job, null)
    expect({
      templates: (job.section_plan.designcut?.sections ?? []).map((section) => section.templateRef?.id ?? section.key),
      cuts: h.cuts.map((cut) => cut.section),
      // SVG 그라데이션 id(fade_<난수>_<시각>)는 렌더마다 바뀐다 — 그 id만 고정 글로 바꿔 잰다
      html: sha(rendered.html.replace(/\b([A-Za-z]+)_\d+_\d{12,14}\b/g, '$1_ID')),
    }).toMatchSnapshot()
  })

  // 정보 칸 제목 안내(세션 B, K6 P05) — 안내 줄은 정보 칸 템플릿 섹션에만 붙는다. 이 지문은 안내를 넣기 전 코드로 만들었다
  // J64(띄어쓰기 규칙 한 줄, 모든 K 잡 공통)로 두 지문을 다시 만들었다 — 정보 칸 안내 줄은 여전히 이 지문에 없다
  it.each([
    ['생활(기본 카테고리)', (job: PdpJobRow) => job],
    ['반려', (job: PdpJobRow) => ({ ...job, analysis: { ...job.analysis, detected_category: 'pet' } }) as PdpJobRow],
  ])('%s K 잡: 슬롯 카피 콜 프롬프트 지문이 정보 칸 제목 안내 전과 같다', async (_name, shape) => {
    h.copyInputs = []
    await runAll(shape(testJobOf(['templatelib'])))
    expect(h.copyInputs.length).toBeGreaterThan(0)
    expect(h.copyInputs.map((input) => sha(buildSlotCopyPrompt(input as SlotCopyInput)))).toMatchSnapshot()
  })
})

describe('운영 잡 K 선택 씨앗(R09c) — 같은 픽스처의 시험 잡과 다른 것은 K 선택과 그 뒤 K 계획뿐', () => {
  beforeEach(() => {
    h.calls = { guideline: 0, compose: 0, select: 0, slots: 0 }
    h.slotsFail = false
    h.slotsThrow = null
    h.slotText = '글'
    h.accentText = ''
    h.cutFails = new Map()
    h.gateOnce = new Map()
    h.gates = []
    h.cuts = []
  })
  const planOf = async (job: PdpJobRow) => (await runOnce(job)).section_plan

  it('운영 잡은 계획 기록에 씨앗 방식을 싣고 시험 잡은 싣지 않는다 — 같은 잡 id는 같은 계획, 다른 잡 id는 다른 K 선택', async () => {
    const test = await planOf(testJobOf(['templatelib']))
    const ops = await planOf(jobOf(['templatelib']))
    const opsAgain = await planOf(jobOf(['templatelib']))
    const other = await planOf({ ...jobOf(['templatelib']), id: 'golden-other-job' })
    expect(test.templatelib).not.toHaveProperty('seed')
    expect(ops.templatelib!.seed).toBe('product+job')
    expect(opsAgain).toEqual(ops)
    const pick = (plan: typeof ops) => ({ concept: plan.templatelib!.concept.id, palette: plan.templatelib!.palette.id, sections: plan.templatelib!.sections.map((row) => row.templateId) })
    expect(pick(other)).not.toEqual(pick(ops))
    // 시험 잡과 다른 계획 칸은 K 계획(templatelib·designcut)뿐이다 — 원천 사진 측정·컷 목적 등 K 선택 앞 기록은 같다
    const changed = Object.keys({ ...test, ...ops }).filter((key) => JSON.stringify(test[key as keyof typeof test]) !== JSON.stringify(ops[key as keyof typeof ops]))
    expect(changed.every((key) => key === 'templatelib' || key === 'designcut')).toBe(true)
  })
})

describe('새 단계 — 하네스 K<n>-NS 모양 시험 잡의 이미지 단계(R11a, 가짜 콜)', () => {
  const AUDIT = JSON.stringify({ items: [], summary: { checked: 0, unsupported: 0, regulated: 0 } })
  const DIRECTOR = JSON.stringify({ light: '부드러운 창가 빛', set: '밝은 거실', cuts: [], conflicts_removed: [] })
  beforeEach(() => {
    h.calls = { guideline: 0, compose: 0, select: 0, slots: 0 }
    h.cuts = []
    h.gates = []
    h.newStageCalls = []
    h.newStageReplies = { 'registration/pdp-fact-audit': AUDIT, 'registration/pdp-director': DIRECTOR }
  })
  // 파이프라인처럼 잡 배치 문맥 안에서 돈다(runPdpStep의 runWithPdpBatch) — 새 단계 route는 새 배치 문맥에서만 풀린다
  const runAllIn = async (start: PdpJobRow, runs = 20) => {
    let job = start
    h.job = job
    for (let i = 0; i < runs && job.current_step === 'images'; i++) {
      const current = job
      job = await runWithPdpBatch(current.model_batch ?? 'now', () => runImagesStep({} as never, 'user-1', current, { concurrency: 1 }))
    }
    return job
  }
  const nsJob = (): PdpJobRow => ({ ...testJobOf(['templatelib', 'newstages']), model_batch: 'new' })

  it('K 계획 뒤 칸 사실 감사, 헌장·식별 카드 뒤 첫 컷 전 연출 감독을 한 번씩 부르고 기록한 뒤 compose로 간다', async () => {
    const job = await runAllIn(nsJob())
    // 칸 사실 감사는 한 자리에서 한 번 — 이 시험 잡의 K 칸 글은 55줄(R11c 두 묶음)이지만 입력 칸(판매자 입력을 그대로 옮긴 스펙 표·후기 등)을
    // 빼고 보내(J47) 40줄 안이라 한 번 부른다. 보낸 줄에 입력 칸이 없다
    expect(h.newStageCalls.map((c) => c.agent)).toEqual(['registration/pdp-fact-audit', 'registration/pdp-director'])
    expect(h.newStageCalls.every((c) => c.cutsBefore === 0)).toBe(true)
    expect(h.newStageCalls[1]).toMatchObject({ model: 'claude-opus-5-5', effort: 'low' })
    expect(job.section_plan.kslot_fact_audit).toMatchObject({ stage: 'factAudit', status: 'done', route: { name: 'copy/fact-audit' } })
    // 한 콜이면 나눔 수(calls) 칸이 없다(runFactAudit 한 묶음 길)
    expect(job.section_plan.kslot_fact_audit).not.toHaveProperty('calls')
    const auditText = JSON.stringify(h.newStageCalls[0].content)
    const inputSlotIds = (job.section_plan.designcut?.sections ?? []).flatMap((section, index) => {
      const template = section.templateRef ? templateById(section.templateRef.id) : undefined
      return template ? Object.keys(section.templateRef!.slots).filter((slot) => isInputValue(template, slot)).map((slot) => `${index}.${section.key}.${slot}`) : []
    })
    expect(inputSlotIds.length).toBeGreaterThan(0)
    for (const id of inputSlotIds) expect(auditText, id).not.toContain(`- ${id}`)
    expect(job.design_prompts.director).toMatchObject({ stage: 'director', status: 'done', route: { name: 'images/director' } })
    expect(job.current_step).toBe('compose')
    // 원장 요약도 두 자리를 센다(기획·카피 감사·합성 뒤 두 자리는 이 잡 앞뒤 단계 — pdp-new-stages-pipeline 시험)
    expect(newStagesLedger(job)).toMatchObject({ on: true, stages: { factAuditSlots: 'done', director: 'done' } })
  })

  it('짝 K<n>-N 모양(newstages 없음)은 새 단계 콜·기록이 없다', async () => {
    const job = await runAllIn({ ...testJobOf(['templatelib']), model_batch: 'new' })
    expect(h.newStageCalls).toEqual([])
    expect(job.section_plan.kslot_fact_audit).toBeUndefined()
    expect(job.design_prompts.director).toBeUndefined()
    expect(job.current_step).toBe('compose')
  })
})

describe('쓰는 법 재료(usefacts, 결정 카드 c02·J18) — 꺼진 잡은 식별 카드 콜·컷 지시가 지금 그대로', () => {
  beforeEach(() => {
    h.cutFails = new Map()
    h.gateOnce = new Map()
    h.gateQueue = new Map()
    h.gates = []
    h.cuts = []
    vi.mocked(readIdentityCard).mockClear()
  })
  const runAll = async (start: PdpJobRow, runs = 20) => {
    let job = start
    h.job = job
    for (let i = 0; i < runs && job.current_step === 'images'; i++) job = await runImagesStep({} as never, 'user-1', job, { concurrency: 1 })
    return job
  }
  const USE = 'pull both yellow cords to close the top, carry it by the cords'
  const CARD = "PRODUCT IDENTITY (read from the user's reference photo — the generated product must match every detail below): drawstring pouch, two yellow cords"
  const STEPS = [{ title: '끈을 당겨 연다' }, { title: '물건을 넣는다', description: '바닥이 평평하다' }]
  const withHeroKind = (job: PdpJobRow, kind: 'in_use' | 'worn' | 'studio'): PdpJobRow => {
    const lib = job.section_plan.templatelib!
    return { ...job, section_plan: { ...job.section_plan, templatelib: { ...lib, hero: { ...lib.hero, kind } } } }
  }
  // 픽스처 잡은 식별 카드가 이미 있어 카드 콜을 건너뛴다 — 콜 인자를 보려면 카드를 지운 잡으로 시작한다
  const withoutCard = (job: PdpJobRow): PdpJobRow => {
    const prompts = { ...job.design_prompts }
    delete prompts.identity_card
    return { ...job, design_prompts: prompts }
  }
  const withoutUsefacts = (job: PdpJobRow): PdpJobRow =>
    ({ ...job, analysis: { ...job.analysis, enrichment: { version: 1, features: [...FEATURES, 'templatelib', 'motionband'] } } }) as PdpJobRow

  it('켠 잡: 식별 카드 콜에 use를 넘겨 USE 줄을 카드와 따로 두고, 손·착용·사용 컷 Use 재료는 USE 줄·사용 순서뿐(카드 문장 없음)', async () => {
    vi.mocked(readIdentityCard).mockResolvedValueOnce({ card: CARD, costUsd: 0, use: USE })
    const start = withoutCard(jobOf(['templatelib', 'usefacts']))
    const job = await runAll({ ...start, spec_sheet: { ...start.spec_sheet, usageSteps: STEPS } })
    const calls = vi.mocked(readIdentityCard).mock.calls
    expect(calls).toHaveLength(1)
    expect(calls[0][3]).toMatchObject({ use: true })
    expect(job.design_prompts.identity_use).toBe(USE)
    expect(job.design_prompts.identity_card).toBe(CARD)
    const shots = new Map((job.section_plan.templatelib?.shots ?? []).map((shot) => [shot.key, shot]))
    const stills = h.cuts.filter((cut) => shots.has(cut.section))
    expect(stills.some((cut) => getsUseLine(shots.get(cut.section)!))).toBe(true)
    for (const cut of stills) {
      const handled = getsUseLine(shots.get(cut.section)!)
      expect(cut.prompt.includes(`Correct use: ${CORRECT_USE_LINE}`), cut.section).toBe(handled)
      expect(cut.prompt.includes(`${USE_CARD_LINE_PREFIX}${USE}`), cut.section).toBe(handled)
      expect(cut.prompt.includes(`${USAGE_STEPS_PREFIX}1. 끈을 당겨 연다; 2. 물건을 넣는다 — 바닥이 평평하다`), cut.section).toBe(handled)
      expect(cut.prompt, cut.section).not.toContain(USE_LINE_PREFIX)
      const entry = job.section_images.find((e) => e.section === cut.section)
      if (entry?.url) expect(entry.useFacts, cut.section).toBeUndefined()
    }
    // 대표 컷은 사용·착용 유형일 때만 쓰는 법 줄을 받는다(스튜디오 대표 컷은 지금 그대로)
    const personHero = job.section_plan.templatelib?.hero?.kind !== 'studio'
    expect(h.cuts.find((cut) => cut.section === 'hero')?.prompt.includes(`${USE_CARD_LINE_PREFIX}${USE}`)).toBe(personHero)
  })

  it('켠 잡에 USE 줄·사용 순서·howTo가 모두 없으면 손·착용·사용 컷은 바르게 쓰기 줄만 받고 useFacts none을 남긴다', async () => {
    const start = jobOf(['templatelib', 'usefacts'])
    const final = start.copy_sections.final ? { ...start.copy_sections.final, howTo: [] } : start.copy_sections.final
    const job = await runAll({ ...start, copy_sections: { ...start.copy_sections, final } })
    expect(job.design_prompts.identity_use).toBeUndefined()
    const shots = new Map((job.section_plan.templatelib?.shots ?? []).map((shot) => [shot.key, shot]))
    const handled = h.cuts.filter((cut) => shots.has(cut.section) && getsUseLine(shots.get(cut.section)!))
    expect(handled.length).toBeGreaterThan(0)
    for (const cut of handled) {
      expect(cut.prompt, cut.section).toContain(`Correct use: ${CORRECT_USE_LINE}`)
      expect(cut.prompt, cut.section).not.toContain(USE_CARD_LINE_PREFIX)
      expect(cut.prompt, cut.section).not.toContain(USAGE_STEPS_PREFIX)
      const entry = job.section_images.find((e) => e.section === cut.section)
      if (entry?.url) expect(entry.useFacts, cut.section).toBe('none')
    }
  })

  it('켠 잡: 사용·착용 대표 컷과 대표 칸만 useCut — 스튜디오 대표 컷과 꺼진 잡은 값이 없다', async () => {
    const planned = await runAll(jobOf(['templatelib', 'usefacts', 'motionband']))
    const heroTasks = (job: PdpJobRow) => buildImageTasks(job).filter((task) => task.section === 'hero' || task.section === 'hero_motion')
    for (const kind of ['in_use', 'worn'] as const) {
      const tasks = heroTasks(withHeroKind(planned, kind))
      expect(tasks.map((task) => [task.section, task.useCut]), kind).toEqual([
        ['hero', true],
        ['hero_motion', true],
      ])
    }
    expect(heroTasks(withHeroKind(planned, 'studio')).map((task) => task.useCut)).toEqual([undefined, undefined])
    expect(heroTasks(withHeroKind(withoutUsefacts(planned), 'worn')).map((task) => task.useCut)).toEqual([undefined, undefined])
  })

  it('꺼진 잡: 식별 카드 콜에 use가 없고 Use 줄 머리는 지금 그대로(판매자 메모·사진)다', async () => {
    vi.mocked(readIdentityCard).mockResolvedValueOnce({ card: CARD, costUsd: 0, use: USE })
    const job = await runAll(withoutCard(jobOf(['templatelib'])))
    const calls = vi.mocked(readIdentityCard).mock.calls
    expect(calls).toHaveLength(1)
    expect((calls[0][3] as { use?: boolean } | undefined)?.use).toBeUndefined()
    expect(job.design_prompts.identity_use).toBeUndefined()
    expect(h.cuts.some((cut) => cut.prompt.includes(USE_CARD_LINE_PREFIX) || cut.prompt.includes(USAGE_STEPS_PREFIX))).toBe(false)
  })
})

describe('원천 사진 역할(photoroles, 결정 카드 c12·J20) — 꺼진 잡은 원천·식별 카드 콜이 지금 그대로', () => {
  beforeEach(() => {
    h.cutFails = new Map()
    h.gateOnce = new Map()
    h.gateQueue = new Map()
    h.gates = []
    h.cuts = []
    vi.mocked(readIdentityCard).mockClear()
  })
  const runAll = async (start: PdpJobRow, runs = 20) => {
    let job = start
    h.job = job
    for (let i = 0; i < runs && job.current_step === 'images'; i++) job = await runImagesStep({} as never, 'user-1', job, { concurrency: 1 })
    return job
  }
  const P1 = 'https://cdn.example.com/registration/uploads/p1.jpg'
  const P2 = 'https://cdn.example.com/registration/uploads/p2-panel.jpg'
  const P3 = 'https://cdn.example.com/registration/uploads/p3-pink.jpg'
  const ROLES = [
    { url: P2, role: 'explain' as const },
    { url: P3, role: 'option' as const },
  ]
  // 사진 받기 모의는 주소를 base64로 돌려준다 — 받은 참조를 주소로 되읽는다
  const urlOf = (image: { data: string }) => Buffer.from(image.data, 'base64').toString()
  // 세 장 + 역할, 식별 카드는 지워 카드 콜이 불리게(픽스처 잡은 카드가 이미 있다)
  const withPhotos = (job: PdpJobRow): PdpJobRow => {
    const prompts = { ...job.design_prompts }
    delete prompts.identity_card
    return { ...job, source_images: [P1, P2, P3], spec_sheet: { ...job.spec_sheet, sourcePhotoRoles: ROLES }, design_prompts: prompts }
  }

  it('켠 잡: 설명 그림은 생성 원천에서 빠지고, 식별 카드 콜에 옵션 사진 역할 한 줄이 붙는다', async () => {
    const job = await runAll(withPhotos(jobOf(['templatelib', 'idcardall', 'photoroles'])))
    const calls = vi.mocked(readIdentityCard).mock.calls
    expect(calls).toHaveLength(1)
    const [reference, , others, options] = calls[0]
    expect(urlOf(reference)).toBe(P1)
    expect((others ?? []).map(urlOf)).toEqual([P3])
    expect(options).toMatchObject({ allPhotos: true, roleLine: expect.stringMatching(/^Photo roles: photo 2 shows the same product in another purchase option/) })
    expect(job.spec_sheet.sourcePhotoRoles).toEqual(ROLES)
    expect(h.gates.length).toBeGreaterThan(0)
    for (const gate of h.gates) expect(gate.refs, gate.section).toBeLessThanOrEqual(2)
  })

  it('photoroles와 usefacts(J18)를 함께 켠 잡: 식별 카드 콜 하나에 역할 줄과 USE 표지가 같이 간다', async () => {
    await runAll(withPhotos(jobOf(['templatelib', 'idcardall', 'photoroles', 'usefacts'])))
    const calls = vi.mocked(readIdentityCard).mock.calls
    expect(calls).toHaveLength(1)
    expect(calls[0][3]).toMatchObject({ allPhotos: true, use: true, roleLine: expect.stringMatching(/^Photo roles: photo 2/) })
  })

  it('꺼진 잡: 역할이 있어도 세 장 모두 원천이고 식별 카드 콜에 역할 줄이 없다', async () => {
    await runAll(withPhotos(jobOf(['templatelib', 'idcardall'])))
    const calls = vi.mocked(readIdentityCard).mock.calls
    expect(calls).toHaveLength(1)
    const [reference, , others, options] = calls[0]
    expect(urlOf(reference)).toBe(P1)
    expect((others ?? []).map(urlOf)).toEqual([P2, P3])
    expect((options as { roleLine?: string } | undefined)?.roleLine).toBeUndefined()
  })

  it('켠 잡이라도 옵션 사진이 없으면 역할 줄이 없다(설명 그림만 빠짐)', async () => {
    const start = withPhotos(jobOf(['templatelib', 'idcardall', 'photoroles']))
    await runAll({ ...start, spec_sheet: { ...start.spec_sheet, sourcePhotoRoles: [ROLES[0]] } })
    const [, , others, options] = vi.mocked(readIdentityCard).mock.calls[0]
    expect((others ?? []).map(urlOf)).toEqual([P3])
    expect((options as { roleLine?: string } | undefined)?.roleLine).toBeUndefined()
  })
})

describe('게이트 기대 쓰는 법·사용 미달 끝 처리(usegate, 결정 카드 c08·J19) — 꺼진 잡은 게이트·재판정·기록이 지금 그대로', () => {
  beforeEach(() => {
    h.cutFails = new Map()
    h.gateOnce = new Map()
    h.gateQueue = new Map()
    h.gates = []
    h.cuts = []
  })
  const runAll = async (start: PdpJobRow, runs = 20) => {
    let job = start
    h.job = job
    for (let i = 0; i < runs && job.current_step === 'images'; i++) job = await runImagesStep({} as never, 'user-1', job, { concurrency: 1 })
    return job
  }
  const USE = 'grip the handle; the working end faces the surface'
  const withUse = (job: PdpJobRow): PdpJobRow => ({ ...job, design_prompts: { ...job.design_prompts, identity_use: USE } })
  const optionsOf = (gate: { options: unknown }) => (gate.options ?? {}) as { useCheck?: boolean; expectedUse?: string }
  /** 사용 판정을 받는 K 컷 하나 — 대표·착용 컷이 아닌 것(그 둘은 스위치와 상관없이 재판정한다). 같은 계획을 쓰려고 한 번 돌려 고른다 */
  const useCutOf = async (features: string[]) => {
    const planned = await runOnce(jobOf(features))
    const task = buildImageTasks(planned).find((t) => t.useGate && !t.wornCut && t.section !== 'hero' && !t.effectOnly && !t.skipGate && !t.motion)
    expect(task).toBeDefined()
    h.cuts = []
    h.gates = []
    return task!
  }

  it('켠 잡: 사용 판정 컷 게이트에만 기대 쓰는 법(식별 카드 USE 줄)을 싣고, 꺼진 잡·USE 줄 없는 잡은 싣지 않는다', async () => {
    await runAll(withUse(jobOf(['templatelib', 'usegate'])))
    const useGates = h.gates.filter((gate) => optionsOf(gate).useCheck)
    expect(useGates.length).toBeGreaterThan(0)
    for (const gate of useGates) expect(optionsOf(gate).expectedUse, gate.section).toBe(USE)
    for (const gate of h.gates.filter((g) => !optionsOf(g).useCheck)) expect(optionsOf(gate).expectedUse, gate.section).toBeUndefined()
    h.gates = []
    await runAll(withUse(jobOf(['templatelib'])))
    expect(h.gates.length).toBeGreaterThan(0)
    expect(h.gates.every((gate) => optionsOf(gate).expectedUse === undefined)).toBe(true)
    h.gates = []
    await runAll(jobOf(['templatelib', 'usegate']))
    expect(h.gates.every((gate) => optionsOf(gate).expectedUse === undefined)).toBe(true)
  })

  it('켠 잡: 사용 판정 컷이 재판정 뒤에도 사용 미달이면 페이지에서 빼고 까닭을 남긴다 — 렌더·초안 사진에 뺀 주소가 없다', async () => {
    const task = await useCutOf(['templatelib', 'usegate'])
    h.gateQueue.set(task.section, [
      { use_correct: false, use_reason: 'held upside down' },
      { use_correct: false, use_reason: 'still held by the wrong end' },
    ])
    const job = await runAll(jobOf(['templatelib', 'usegate']))
    const entry = job.section_images.find((e) => e.section === task.section)!
    expect(h.gates.filter((gate) => gate.section === task.section)).toHaveLength(2)
    expect(entry.url).toBe('')
    expect(entry.droppedForUse).toEqual({ url: expect.stringContaining('cdn.test'), reason: '쓰는 법 미달: still held by the wrong end' })
    expect(entry.gateRejudge?.kept).toBe('regen')
    expect(cutFailureNotes(job.section_images).find((note) => note.section === task.section)?.reason).toBe('쓰는 법이 원본과 달라 뺌')
    const rendered = await renderJobHtml(job, null)
    expect(rendered.html).not.toContain(entry.droppedForUse!.url)
    const draftImageUrls = job.section_images.filter((s) => s.url && !isPlateTask(s)).map((s) => s.url)
    expect(draftImageUrls).not.toContain(entry.droppedForUse!.url)
    expect(job.current_step).toBe('compose')
  })

  it('켠 잡: 다시 판정에서 사용이 맞으면 새 컷을 남긴다', async () => {
    const task = await useCutOf(['templatelib', 'usegate'])
    h.gateQueue.set(task.section, [{ use_correct: false, use_reason: 'held upside down' }, {}])
    const job = await runAll(jobOf(['templatelib', 'usegate']))
    const entry = job.section_images.find((e) => e.section === task.section)!
    expect(h.gates.filter((gate) => gate.section === task.section)).toHaveLength(2)
    expect(entry.url).toContain('cdn.test')
    expect(entry.gateRejudge?.kept).toBe('regen')
    expect(entry.droppedForUse).toBeUndefined()
    expect(entry.regenNotRejudged).toBeUndefined()
  })

  it('꺼진 잡: 같은 사용 미달이어도 지금처럼 한 번 다시 만들고 재판정 없이 새 컷을 둔다(뺄 컷 없음)', async () => {
    const task = await useCutOf(['templatelib'])
    h.gateQueue.set(task.section, [
      { use_correct: false, use_reason: 'held upside down' },
      { use_correct: false, use_reason: 'still held by the wrong end' },
    ])
    const job = await runAll(jobOf(['templatelib']))
    const entry = job.section_images.find((e) => e.section === task.section)!
    expect(h.gates.filter((gate) => gate.section === task.section)).toHaveLength(1)
    expect(entry.url).toContain('cdn.test')
    expect(entry.regenNotRejudged).toBe(true)
    expect(entry.droppedForUse).toBeUndefined()
    expect(job.section_images.some((e) => e.droppedForUse)).toBe(false)
  })
})

describe('체감 결과 문장 길이 가드 배선(J65)', () => {
  beforeEach(() => {
    h.calls = { guideline: 0, compose: 0, select: 0, slots: 0 }
    h.cutFails = new Map()
    h.gateOnce = new Map()
    h.gateQueue = new Map()
    h.gates = []
    h.cuts = []
  })
  const runAll = async (start: PdpJobRow, runs = 20) => {
    let job = start
    h.job = job
    for (let i = 0; i < runs && job.current_step === 'images'; i++) job = await runImagesStep({} as never, 'user-1', job, { concurrency: 1 })
    return job
  }

  it('effectshot 켠 MS 2k 잡: 문장이 붙은 기능·사용 컷만 effectShot을 남기고, 지금 배치 잡은 기록이 없다', async () => {
    const job = await runAll({ ...jobOf(['templatelib', 'effectshot']), image_model: 'higgsfield-ms-2k' })
    const effectCuts = new Set(buildImageTasks(job).filter((t) => t.shotBrief?.includes(EFFECT_SHOT_LINE)).map((t) => t.section))
    expect(effectCuts.size).toBeGreaterThan(0)
    for (const entry of job.section_images) {
      if (effectCuts.has(entry.section)) expect(['shown', 'too-long'], entry.section).toContain(entry.effectShot)
      else expect(entry.effectShot, entry.section).toBeUndefined()
    }
    expect(job.section_images.filter((e) => e.effectShot)).toHaveLength(effectCuts.size)
    const now = await runAll(jobOf(['templatelib', 'effectshot']))
    expect(now.section_images.some((e) => e.effectShot)).toBe(false)
  })
})
