/**
 * ENRICHMENT(T2·T3) 파이프라인 관통 — 골든과 같은 결정론 모의로 실제 runPdpStep을 돌려 설계 §4.7 계약을 확인한다.
 *   Track I만 analysis.enrichment·decision_profile 기록 · 프롬프트 직렬화에서 enrichment 제외 · 설계는 설득 플래너
 *   · 잡 기록이 환경보다 우선(재개 시 env를 바꿔도 같은 결과) · 카피에 설득 흐름 요약 · v2 없는 카테고리도 Track I(pooled)
 *   · quality_report 항상 생성(trust_gate·persuasion·evidenceLevel)
 *   · T3: layouts 기록 잡은 E-2 배정(layout_selections·persuasion.layouts·R7), shots 기록 잡은 컷별 연출 블록,
 *     T2 기록 잡(배포 전 진행 중)은 LLM 배치·공통 블록 그대로
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PdpJobRow } from '../pdp-state'

const golden = vi.hoisted(() => {
  const rec = {
    job: null as unknown as Record<string, unknown>,
    fixture: null as unknown as Record<string, Record<string, unknown>>,
    calls: [] as Array<{ agent: string; user: string }>,
    images: [] as Array<{ prompt: string }>,
  }
  function cannedText(agent: string): string | null {
    const f = rec.fixture
    const copyFinal = (f.copy_sections?.final ?? {}) as Record<string, unknown>
    if (agent === 'registration/pdp-analysis') {
      const { detected_category: _c, recommended_strategy_contract: _r, ...rest } = f.analysis
      return JSON.stringify({ ...rest, decision_profile: { giftability: 'high', explanation_depth: 'quick' } })
    }
    if (agent === 'registration/pdp-category') return JSON.stringify({ category: f.analysis.detected_category })
    if (agent === 'registration/pdp-research') return JSON.stringify(f.research_result)
    if (agent === 'registration/pdp-section-planning') return JSON.stringify(f.section_plan)
    if (agent === 'registration/pdp-design-prompt') return JSON.stringify(f.design_prompts)
    if (agent.startsWith('registration/pdp-copy-stage') || agent === 'registration/pdp-copy-premium') return JSON.stringify(copyFinal)
    if (agent === 'registration/pdp-copy-retry-pointcards') return JSON.stringify(copyFinal.pointCards ?? [])
    if (agent === 'registration/pdp-image-identity') return 'golden identity'
    if (agent === 'registration/pdp-image-gate') return JSON.stringify({ has_artifact: false, same_product: true, consistency: 0.95 })
    return null
  }
  return { rec, cannedText }
})

async function respond(options: Record<string, unknown>, parser: (text: string) => unknown) {
  const { messagesToText } = await import('./golden-harness')
  const agent = String(options.agentName ?? '')
  golden.rec.calls.push({ agent, user: messagesToText(options.messages) })
  const usage = { inputTokens: 0, outputTokens: 0, cost: 0 }
  const text = golden.cannedText(agent)
  if (text === null) return { success: false, error: { message: `no canned ${agent}`, stage: 'api', attempts: 1 }, usage, duration: 0 }
  return { success: true, data: parser(text), usage, duration: 0 }
}

/** 유사도 게이트 결과 대기열 — 비어 있으면 실제 판정(시험이 넣을 때만 재생성을 일으킨다) */
const sim = vi.hoisted(() => ({ queue: [] as Array<Array<{ section: string; sentence: string; score: number }>> }))
vi.mock('../similarity-gate', async (orig) => {
  const real = await orig<typeof import('../similarity-gate')>()
  return {
    ...real,
    loadCorpusCheck: (key: string) => real.loadCorpusCheck(key) ?? (sim.queue.length > 0 ? ({} as never) : null),
    checkCopySimilarity: (...args: Parameters<typeof real.checkCopySimilarity>) =>
      sim.queue.length > 0 ? sim.queue.shift()! : real.checkCopySimilarity(...args),
  }
})
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({}) }))
vi.mock('@/lib/agents/budget', async (orig) => ({
  ...(await orig<typeof import('@/lib/agents/budget')>()),
  checkMonthlyBudget: async () => ({ allowed: true, budgetUsd: 50, spentUsd: 0 }),
  logUsage: async () => true,
}))
vi.mock('@/lib/agents/_base', async (orig) => ({
  ...(await orig<typeof import('@/lib/agents/_base')>()),
  callAgent: (o: Record<string, unknown>, p: (t: string) => unknown) => respond(o, p),
}))
vi.mock('@/lib/agents/openai-chat', async (orig) => ({
  ...(await orig<typeof import('@/lib/agents/openai-chat')>()),
  callOpenAiChat: (o: Record<string, unknown>, p: (t: string) => unknown) => respond(o, p),
}))
vi.mock('@/lib/agents/image/generate', () => ({
  generateImage: async (input: { prompt: string }) => {
    golden.rec.images.push({ prompt: input.prompt })
    return { base64: 'AA', mimeType: 'image/png' }
  },
}))
vi.mock('@/lib/agents/registration/thumbnail-vision-agent', async (orig) => ({
  ...(await orig<typeof import('@/lib/agents/registration/thumbnail-vision-agent')>()),
  fetchImageAsBase64: async () => ({ data: 'AA', mediaType: 'image/png' }),
}))
vi.mock('../storage', () => ({ uploadPdpImage: async (_d: unknown, _u: string, j: string, s: string) => `https://golden.test/${j}/${s}.png` }))
vi.mock('@/lib/sourcing/registration/drafts', () => ({ appendDraftDetailAssets: async () => undefined }))
vi.mock('../pdp-jobs', () => {
  const KEYS: Record<string, string> = {
    analysis: 'analysis', researchResult: 'research_result', designPrompts: 'design_prompts', sectionPlan: 'section_plan',
    copySections: 'copy_sections', sectionImages: 'section_images', finalHtml: 'final_html', currentStep: 'current_step',
    progress: 'progress', error: 'error', costUsd: 'cost_usd', corpusVersion: 'corpus_version',
  }
  const copy = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T
  return {
    getPdpJob: async () => copy(golden.rec.job),
    // 잡 진행 잠금은 pdp-jobs-lease.test.ts 몫 — 골든 run은 늘 쥔다
    isPdpJobLeased: () => false,
    claimPdpJobRun: async () => ({ job: copy(golden.rec.job), leaseUntil: 'golden-lease' }),
    updatePdpJob: async (_d: unknown, _u: string, _i: string, patch: Record<string, unknown>) => {
      for (const [k, v] of Object.entries(patch)) if (v !== undefined && KEYS[k]) golden.rec.job[KEYS[k]] = copy(v)
      return copy(golden.rec.job)
    },
  }
})

import { runPdpStep, resolveStepToRun } from '../pdp-pipeline'
import { getCorpusSnapshotV2 } from '../corpus-v2'
import { getDesignVocab } from '../design-vocab'
import { buildSkeleton } from '../internalized/pdp-internalized-skeleton'
import { planPersuasionSkeleton } from '../internalized/persuasion-planner'
import { mergeManualStrategy } from '../pdp-strategy-contract'
import { buildImageTasks } from '../pdp-image-tasks'
import { annotationQualityReport } from '../pdp-annotation-stage'
import { layoutQualityReport } from '../pdp-enrichment-stage'
import { measureEditorBuild } from '../quality-render-stats'
import { assignLayouts } from '../internalized/layout-assign'
import { buildRoleShotBlock } from '../internalized/shot-direction'
import { PARENT_PROXY_PERSONA, PARENT_PROXY_PERSONA_GATED } from '../parent-proxy-copy'
import { LIGHT_RULE } from '../pdp-image-light'
import { SCENE_BACKGROUND_LINE, SCENE_STYLE_REF_TEXT } from '../pdp-image-scene'
import { buildSceneSet, describeSceneSet, sceneSetInputOf } from '../scene-set'
import { SHOT_PLAN_PRIORITY } from '../internalized/shot-plan'
import { GOLDEN_NOW, GOLDEN_SUPABASE_URL, GOLDEN_USER_ID, fixtureToJob, loadEnrichmentFixture, rewindTo, type FixtureKey } from './golden-harness'

/** T2 시기 기록(T3 배포 전에 분석이 끝난 진행 중 잡) — layouts·shots·mobile 없음 */
const RECORD = { version: 1, features: ['vocab', 'persuasion'] }
/** T3 기본값 기록 */
const RECORD_T3 = { version: 1, features: ['vocab', 'persuasion', 'layouts', 'shots', 'mobile'] }
/** T4 기본값(annotations 켬) */
const RECORD_T4 = { version: 1, features: ['vocab', 'persuasion', 'layouts', 'shots', 'annotations', 'mobile'] }
/** T6b 기본값(options 켬) — analysis가 남기는 기록. optionSpec 없는 픽스처라 산출은 T4 기록과 같다 */
const RECORD_T6B = { version: 1, features: [...RECORD_T4.features, 'options'] }

function stage(key: FixtureKey, step: Parameters<typeof rewindTo>[1], enrich: boolean | typeof RECORD_T3): PdpJobRow {
  const fixture = loadEnrichmentFixture(key)
  golden.rec.fixture = fixture as unknown as Record<string, Record<string, unknown>>
  const job = rewindTo(fixtureToJob(fixture), step)
  const record = enrich === true ? RECORD : enrich || null
  if (record && step !== 'analysis') job.analysis = { ...job.analysis, decision_profile: { giftability: 'high' }, enrichment: record } as never
  golden.rec.job = job as unknown as Record<string, unknown>
  golden.rec.calls = []
  golden.rec.images = []
  return job
}

const run = () => runPdpStep(golden.rec.job.id as string, GOLDEN_USER_ID)

async function runUntil(target: string, limit = 60): Promise<PdpJobRow> {
  let job = golden.rec.job as unknown as PdpJobRow
  for (let i = 0; i < limit && resolveStepToRun(job) !== target && job.current_step !== 'failed'; i++) job = await run()
  return job
}

beforeAll(() => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', GOLDEN_SUPABASE_URL)
})
beforeEach(() => {
  vi.stubEnv('NEXOPS_PDP_ENRICHMENT', '')
  vi.spyOn(Date, 'now').mockReturnValue(GOLDEN_NOW)
})
afterEach(() => {
  vi.stubEnv('NEXOPS_PDP_ENRICHMENT', '')
})

describe('analysis — 잡 단위 기록', () => {
  it('Track I: 켜진 기능 기록 + decision_profile 보존', async () => {
    stage('A-track-i', 'analysis', false)
    const job = await run()
    // 기본값 — K4 운영 전환(오너 2026-11-06 '전환 PR 준비 승인'): K4 회차 11잡의 기록 묶음 22개 + K6 뒤 사진 다양화·정보 칸(오너 11-06 20:46) = 24개. 디자인 컷 잡이라 split·lean·long은 빠진다.
    // A는 판정이 꺼져 audience 칸이 없다. J34 켜기(통합 decide 15·17)로 usefacts·usegate가 더해져 기록 27개(templatelib 잡이라 기록된다),
    // J65 켜기(통합 decide 41·42)로 effectshot이 더해져 28개, J69 켜기(통합 decide 44)로 showbeat가 더해져 29개
    const k4 = ['designcut', 'audience', 'designcut2', 'designlayout', 'flow', 'rhythm', 'designlong', 'shotdiv', 'palette2', 'fontpair', 'reviewfaq', 'partsrule', 'idcardall', 'templatelib', 'uspfacts', 'motionband', 'shotvary', 'infocells', 'usefacts', 'usegate', 'effectshot', 'showbeat']
    expect(job.analysis.enrichment).toEqual({ version: 1, features: [...RECORD_T6B.features, ...k4] })
    expect(job.analysis.decision_profile).toMatchObject({ giftability: 'high' })
  })

  it('Track S: 기록·decision_profile 없음', async () => {
    stage('A-track-s', 'analysis', false)
    const job = await run()
    expect(job.analysis.enrichment).toBeUndefined()
    expect(job.analysis.decision_profile).toBeUndefined()
  })

  it('Track I 대조군(NEXOPS_PDP_ENRICHMENT=off): 기록 없음', async () => {
    vi.stubEnv('NEXOPS_PDP_ENRICHMENT', 'off')
    stage('A-track-i', 'analysis', false)
    const job = await run()
    expect(job.analysis.enrichment).toBeUndefined()
  })
})

describe('프롬프트 직렬화', () => {
  it('research 프롬프트에 enrichment 키는 없고 decision_profile은 있다(Track I 변경 범위)', async () => {
    stage('A-track-i', 'research', true)
    await run()
    const research = golden.rec.calls.find((c) => c.agent === 'registration/pdp-research')!
    expect(research.user).not.toContain('"enrichment"')
    expect(research.user).toContain('"decision_profile"')
  })
})

describe('design — 설득 플래너', () => {
  it('기록된 잡은 플래너 골격을 잠그고 근거를 남긴다', async () => {
    const before = stage('A-track-i', 'design', true)
    const job = await run()
    const expected = planPersuasionSkeleton({
      specSheet: before.spec_sheet, analysis: before.analysis,
      strategyContract: mergeManualStrategy(before.analysis.recommended_strategy_contract ?? {}, before.spec_sheet, []),
      research: before.research_result, category: before.analysis.detected_category,
      snapshotV2: getCorpusSnapshotV2(before.analysis.detected_category), vocab: getDesignVocab()!,
    })
    expect(job.section_plan.activated_sections).toEqual(expected.activatedSections.map(String))
    expect(job.section_plan.internalized_skeleton?.persuasion?.grammar).toBe('G4')
    expect(job.section_plan.enrichment).toEqual({ version: 1, features: ['vocab', 'persuasion'], vocabHash: getDesignVocab()!.contentHash })
    const planning = golden.rec.calls.find((c) => c.agent === 'registration/pdp-section-planning')!
    expect(planning.user).toContain('골격 확정')
    expect(planning.user).toContain(JSON.stringify(expected.activatedSections))
  })

  it('잡 기록이 환경보다 우선 — 재개 시 env=off여도 플래너, 기록 없는 잡은 env가 켜져도 기존 골격', async () => {
    vi.stubEnv('NEXOPS_PDP_ENRICHMENT', 'off')
    stage('A-track-i', 'design', true)
    expect((await run()).section_plan.internalized_skeleton?.persuasion).toBeDefined()

    vi.stubEnv('NEXOPS_PDP_ENRICHMENT', '')
    const legacy = stage('A-track-i', 'design', false)
    const job = await run()
    expect(job.section_plan.internalized_skeleton?.persuasion).toBeUndefined()
    const snapshot = getCorpusSnapshotV2(legacy.analysis.detected_category)!
    const strategyContract = mergeManualStrategy(legacy.analysis.recommended_strategy_contract ?? {}, legacy.spec_sheet, [])
    expect(job.section_plan.activated_sections).toEqual(buildSkeleton({ snapshot, specSheet: legacy.spec_sheet, strategyContract }).activatedSections.map(String))
  })
})

describe('copywriting — 설득 흐름 요약', () => {
  it('플래너 잡만 카피 프롬프트에 설득 흐름을 붙인다', async () => {
    stage('A-track-i', 'design', true)
    await run()
    golden.rec.calls = []
    await run()
    const stage1 = golden.rec.calls.find((c) => c.agent === 'registration/pdp-copy-stage1')!
    expect(stage1.user).toContain('[설득 흐름 — 구조 지시, 문구 아님]')
    expect(stage1.user).toContain('응답하지 않는다')
    // R2 특징 배정 — 편집기 중복 정리와 같은 규칙(요약 카드 제목만·CTA 25자·입력 수치만)
    expect(stage1.user).toContain('[특징 배정 — 같은 특징을 같은 말로 되풀이하지 않는다]')
    expect(stage1.user).toContain('closingCta.headline은 25자 이내 완성 문장이다')
    expect(stage1.user).toContain('상품 정보(spec_sheet·등록 옵션)에 있는 값만 쓴다')
    // R2 주장 범위(P03 효능 감점) — Stage 1·2·3 모두. A(파티 폭죽)는 몸에 닿지 않아 결과 주장 금지 줄은 없다
    const copyCalls = (calls: typeof golden.rec.calls) =>
      ['stage1', 'stage2', 'stage3'].map((n) => calls.find((c) => c.agent === `registration/pdp-copy-${n}`)!.user)
    for (const user of copyCalls(golden.rec.calls)) {
      expect(user).toContain('[주장 범위 — 의학·인증 효능은 쓰지 않고, 체감 효능은 사실과 함께 쓴다]')
      expect(user).toContain('"밀림 최소화", "흔들림 적게"')
      expect(user).not.toContain('이 상품은 사람이나 반려동물의 몸')
    }

    stage('A-track-i', 'copywriting', false)
    await run()
    const legacyUser = golden.rec.calls.find((c) => c.agent === 'registration/pdp-copy-stage1')!.user
    expect(legacyUser).not.toContain('[설득 흐름 — 구조 지시')
    expect(legacyUser).not.toContain('[특징 배정')
    for (const user of copyCalls(golden.rec.calls)) expect(user).not.toContain('[주장 범위')
  })
})

describe('copywriting — 기록 잡 전략 신호·Stage 3 특징 배정(R4 pdp-r4-copy-flow)', () => {
  it('기록 잡만 Stage 1에 구매 결정 성향·후킹 진단(사실형), Stage 3에 특징 배정 — 기록 없는 잡은 그대로', async () => {
    const user = (n: string) => golden.rec.calls.find((c) => c.agent === `registration/pdp-copy-${n}`)!.user
    stage('A-track-i', 'design', true)
    await run()
    golden.rec.calls = []
    await run()
    const stage1 = user('stage1')
    // decision_profile(giftability high)·planning_skeleton.hook_score(A: novelty 0.55·proof 0.5 미달)
    expect(stage1).toContain('선물 적합성이 높은 상품입니다')
    expect(stage1).toContain('후킹 진단: 신선도가 낮습니다')
    expect(stage1).toContain('상품 정보에 있는 사실(소재·구성·규격)을 앞당겨 배치하세요')
    expect(stage1).not.toContain('수치·인증 등 근거를 앞당겨')
    expect(stage1).not.toContain('후킹 진단: 명확성이 낮습니다')
    const stage3 = user('stage3')
    expect(stage3).toContain('[검수 때도 특징 배정을 지킨다')
    expect(stage3).toContain('[특징 배정 — 같은 특징을 같은 말로 되풀이하지 않는다]')
    expect(stage3).not.toContain('동일하거나 유사한 키워드를 사용하지 마세요')
    expect(stage3).not.toContain('얇은 판 구조라 한 손으로 들고 다녀요')
    expect(user('stage2')).not.toContain('[특징 배정')
    // R4 copy-bridge — 섹션 잇기(Stage 1 받는 말, Stage 2·3 보존)
    expect(stage1).toContain('## [섹션 잇기 — 받는 말, 문구 아님]')
    for (const n of ['stage2', 'stage3']) expect(user(n)).toContain('## [섹션 잇기 보존]')
    expect(stage1.indexOf('[섹션 잇기 — 받는 말')).toBeGreaterThan(stage1.indexOf('[특징 배정'))

    stage('A-track-i', 'copywriting', false)
    await run()
    for (const n of ['stage1', 'stage2', 'stage3']) expect(user(n)).not.toContain('[섹션 잇기')
    expect(user('stage1')).not.toContain('선물 적합성')
    expect(user('stage1')).not.toContain('후킹 진단')
    expect(user('stage3')).toContain('동일하거나 유사한 키워드를 사용하지 마세요')
    expect(user('stage3')).not.toContain('[검수 때도 특징 배정')
  })
})

describe('copywriting — 유사도 재생성도 기록 잡 입력을 받는다(R4 pdp-r4-copy-flow)', () => {
  it('재생성 콜의 Stage 1·3에도 전략 신호·특징 배정이 붙는다', async () => {
    stage('A-track-i', 'design', true)
    await run()
    golden.rec.calls = []
    sim.queue = [[{ section: 'mainIntro', sentence: '코퍼스와 겹친 문장', score: 0.9 }], []]
    await run()
    sim.queue = []
    const users = (n: string) =>
      golden.rec.calls.filter((c) => c.agent === `registration/pdp-copy-${n}`).map((c) => c.user)
    const [first, regen] = users('stage1')
    expect(users('stage1')).toHaveLength(2)
    expect(first).not.toContain('[유사도 게이트 재작성 지시]')
    expect(regen).toContain('[유사도 게이트 재작성 지시]')
    for (const user of users('stage1')) expect(user).toContain('선물 적합성이 높은 상품입니다')
    expect(users('stage3')).toHaveLength(2)
    for (const user of users('stage3')) expect(user).toContain('[검수 때도 특징 배정을 지킨다')
  })
})

describe('copywriting — 디자인 컷 잡만 예시 색 hex를 뺀다(2026-10-28)', () => {
  it('designcut 기록 잡은 Stage 1 색 지시에서 예시 hex가 빠지고, 기록 없는 잡은 그대로', async () => {
    const stage1 = async (features: string[]) => {
      stage('A-track-i', 'design', { version: 1, features })
      await run()
      golden.rec.calls = []
      await run()
      return golden.rec.calls.find((c) => c.agent === 'registration/pdp-copy-stage1')!.user
    }
    const plain = await stage1(RECORD_T6B.features)
    expect(plain).toContain('#c2410c')
    const designcut = await stage1([...RECORD_T6B.features, 'designcut'])
    expect(designcut).not.toContain('#c2410c')
    expect(designcut).toContain('따뜻한 브라운/골드 계열')
    expect(designcut).toContain('(#1a1a1a ~ #333333)')
  })
})

describe('v2 없는 카테고리(stationery) — Track I 유지(pooled)', () => {
  it('설계·이미지·합성이 pooled 근거로 진행되고 quality_report를 항상 만든다', async () => {
    stage('B-track-i-stationery', 'design', true)
    let job = await run()
    expect(job.section_plan.internalized_skeleton?.persuasion?.priorSource).toBe('coupang:pooled')

    golden.rec.calls = []
    job = await run() // copywriting — v2가 없으므로 pooled 블록 + 설득 흐름
    const stage1 = golden.rec.calls.find((c) => c.agent === 'registration/pdp-copy-stage1')!
    expect(stage1.user).toContain('[범용 근거]')
    expect(stage1.user).toContain('[설득 흐름 — 구조 지시, 문구 아님]')

    golden.rec.images = []
    job = await runUntil('compose')
    expect(resolveStepToRun(job)).toBe('compose')
    expect(golden.rec.images.length).toBeGreaterThan(0)
    expect(golden.rec.images.every((i) => i.prompt.includes('[모바일 판독 기준]'))).toBe(true)

    job = await run()
    expect(job.current_step).toBe('done')
    const report = job.copy_sections.quality_report!
    expect(report.trust_gate).toBeDefined()
    expect(report.evidenceLevel).toMatchObject({ level: 'pooled', priorSource: 'coupang:pooled' })
    expect(report.persuasion?.grammar).toBe('G4')
    // R4 섹션 잇기 측정(카피 기준) — 기록 잡이면 늘 실린다
    expect(report.bridges).toBeDefined()
    expect(report.bridges!.pairs).toBeGreaterThan(0)
    expect(report.bridges!.linked + report.bridges!.unlinked.length).toBe(report.bridges!.pairs)
    // T2 시기 기록(layouts·annotations 없음) — T4b 필드도 없다
    expect(report).not.toHaveProperty('annotations')
    expect(report).not.toHaveProperty('layouts')
  })

  it('기록 없는 구 잡은 기존 standard 폴백(quality_report 없음)', async () => {
    stage('B-track-i-stationery', 'compose', false)
    const job = await run()
    expect(job.copy_sections.quality_report).toBeUndefined()
  })
})

describe('T4b — 품질 보고서 annotations·layouts(compose 연결)', () => {
  it('T4 기본값 기록 잡: compose가 편집기 최초 빌드를 한 번 만들어 장식·배정 결과를 quality_report에 남긴다', async () => {
    stage('A-track-i', 'design', RECORD_T4)
    let job = await run()
    expect(job.section_plan.enrichment?.features).toEqual(RECORD_T4.features)
    job = await runUntil('compose')
    expect(resolveStepToRun(job)).toBe('compose')
    job = await run()
    expect(job.current_step).toBe('done')

    const report = job.copy_sections.quality_report!
    const { stats } = await measureEditorBuild(job)
    expect(report.annotations).toEqual(annotationQualityReport(job, stats.annotations))
    expect(report.layouts).toEqual(layoutQualityReport(job, stats.layouts))
    const a = report.annotations!
    expect(a.targets).toBeGreaterThan(0)
    expect(a.done + a.skipped + a.failed).toBe(a.targets)
    expect(report.layouts!.assigned).toBeGreaterThan(0)
    expect(report.layouts).toMatchObject({ tried: expect.any(Number), guardDropped: expect.any(Number) })
  })
})

describe('T3 — 레이아웃 배정(E-2)·컷별 연출(E-4)', () => {
  it('layouts 기록 잡: E-2가 layout_selections를 정하고 근거(persuasion.layouts)·R7 판정을 남긴다', async () => {
    const before = stage('A-track-i', 'design', RECORD_T3)
    const job = await run()
    const persuasion = job.section_plan.internalized_skeleton!.persuasion!
    const expected = assignLayouts({
      sectionOrder: job.section_plan.section_order!,
      stages: persuasion.stages,
      category: before.analysis.detected_category,
      vocab: getDesignVocab()!,
      llmSelections: (golden.rec.fixture.section_plan as { layout_selections?: Record<string, string> }).layout_selections,
      comparisonIntensity: mergeManualStrategy(before.analysis.recommended_strategy_contract ?? {}, before.spec_sheet, []).comparison_intensity,
    })
    expect(job.section_plan.layout_selections).toEqual(expected.selections)
    expect(persuasion.layouts).toEqual(expected.records)
    expect(persuasion.layouts.map((l) => l.section)).toEqual(job.section_plan.section_order!.filter((s) => s !== 'divider'))
    expect(persuasion.rules.find((r) => r.id === 'R7')).toEqual({ id: 'R7', pass: true })
    expect(job.section_plan.enrichment?.features).toEqual(RECORD_T3.features)
  })

  it('T2 기록 잡(배포 전 진행 중): 배정하지 않고 R7은 판정 보류 그대로', async () => {
    stage('A-track-i', 'design', true)
    const persuasion = (await run()).section_plan.internalized_skeleton!.persuasion!
    expect(persuasion.layouts).toEqual([])
    expect(persuasion.rules.find((r) => r.id === 'R7')?.detail).toContain('판정 보류')
  })

  it('shots 기록 잡: 연출 대상 컷만 [공통 규칙 + 연출 + 연령] 블록, 그래픽 컷은 기존 공통 블록', async () => {
    stage('A-track-i', 'design', RECORD_T3)
    await run()
    await runUntil('images')
    const atImages = golden.rec.job as unknown as PdpJobRow
    golden.rec.images = []
    await runUntil('compose')
    const persuasion = atImages.section_plan.internalized_skeleton!.persuasion!
    const ctx = {
      category: atImages.analysis.detected_category,
      vocab: getDesignVocab()!,
      grammar: persuasion.grammar,
      stylePack: mergeManualStrategy(atImages.analysis.recommended_strategy_contract ?? {}, atImages.spec_sheet, []).visual_style_pack,
      proofTypes: atImages.research_result.proof_plan?.required_proof_types,
    }
    const tasks = buildImageTasks(atImages)
    let shotCuts = 0
    for (const task of tasks) {
      const prompt = golden.rec.images.find((i) => i.prompt.startsWith(task.prompt))?.prompt
      if (!prompt) continue
      const shot = buildRoleShotBlock(task.section, ctx, { effectOnly: task.effectOnly })
      expect(prompt.includes('[Shot direction'), task.section).toBe(shot !== null)
      expect(prompt, task.section).toContain('[AGE RESTRICTION - MANDATORY]') // A는 만 14세 — 모든 컷 유지
      if (task.effectOnly) expect(shot ?? '', task.section).not.toMatch(/Proof|Premium cue/)
      if (shot) {
        shotCuts++
        expect(prompt).toContain(shot)
        expect(prompt).not.toContain('[실측 디자인 레시피') // 공통 타이포 수치 블록을 연출이 대신한다
      }
    }
    expect(shotCuts).toBeGreaterThan(0)
  })

  it('T2 기록 잡의 이미지는 연출 블록 없이 기존 공통 블록', async () => {
    stage('A-track-i', 'design', true)
    await run()
    await runUntil('images')
    golden.rec.images = []
    await runUntil('compose')
    expect(golden.rec.images.length).toBeGreaterThan(0)
    expect(golden.rec.images.some((i) => i.prompt.includes('[Shot direction'))).toBe(false)
  })
})

// ── 학부모 대리 구매형(parent_proxy 2단계, audience 기능 — R7 판정 뒤 기본 on) ──

const AUDIENCE = { kind: 'parent_proxy', version: 1, basis: 'name_tags', terms: ['구디백'], ageGate: false }
const RECORD_AUDIENCE = { version: 1, features: [...RECORD_T6B.features, 'lean', 'audience'], audience: AUDIENCE }
const RECORD_AUDIENCE_GATED = { ...RECORD_AUDIENCE, audience: { ...AUDIENCE, ageGate: true } }

/** A(만 14세 폭죽)를 학부모 대리 구매형 상품처럼 — 상품명만 바꾸고 페르소나·리뷰를 비운다. gate=false면 연령 게이트도 끈다 */
function asParentProduct(gate = false) {
  const spec = { ...(golden.rec.job.spec_sheet as Record<string, unknown>) }
  spec.productName = '어린이집 구디백 포장봉투 20매'
  delete spec.targetPersona
  delete spec.reviewsText
  if (!gate) delete spec.minAgeYears
  golden.rec.job.spec_sheet = spec
}

const fixtureFinal = () => (golden.rec.fixture.copy_sections as { final: Record<string, unknown> }).final

describe('학부모 대리 구매형(parent_proxy 2단계) — audience 기록 잡만', () => {
  afterEach(() => {
    vi.stubEnv('NEXOPS_PDP_ENRICHMENT_EXTRA', '')
  })

  it('analysis: 기본값(on)이면 켜진 판정을 기록하고, 대조군(off)이면 기록하지 않는다', async () => {
    stage('A-track-i', 'analysis', false)
    asParentProduct()
    const on = await run()
    expect(on.analysis.enrichment?.features).toContain('audience')
    expect(on.analysis.enrichment?.audience).toEqual({
      kind: 'parent_proxy',
      version: 1,
      basis: 'name_tags',
      terms: ['어린이집', '구디백'],
      ageGate: false,
    })

    vi.stubEnv('NEXOPS_PDP_ENRICHMENT', 'off')
    stage('A-track-i', 'analysis', false)
    asParentProduct()
    const off = await run()
    expect(off.analysis.enrichment).toBeUndefined()
  })

  it('research·design·copy: 빈 targetPersona에 기본 학부모 페르소나가 흐르고(저장 안 함), 설득 기록에 대상, 카피 Stage 1·2·3에 화자 블록', async () => {
    stage('A-track-i', 'research', RECORD_AUDIENCE)
    asParentProduct()
    await run()
    expect(golden.rec.calls.find((c) => c.agent === 'registration/pdp-research')!.user).toContain(PARENT_PROXY_PERSONA)

    golden.rec.calls = []
    const designed = await run()
    expect(golden.rec.calls.find((c) => c.agent === 'registration/pdp-design-prompt')!.user).toContain(PARENT_PROXY_PERSONA)
    expect(designed.section_plan.internalized_skeleton?.persuasion?.audience).toBe('parent_proxy')
    expect(designed.spec_sheet.targetPersona).toBeUndefined()

    golden.rec.calls = []
    const copied = await run()
    const user = (n: number) => golden.rec.calls.find((c) => c.agent === `registration/pdp-copy-stage${n}`)!.user
    expect(user(1)).toContain(`타겟 페르소나: ${PARENT_PROXY_PERSONA}`)
    for (const n of [1, 2, 3]) expect(user(n)).toContain('[학부모 대리 구매형 — 화자·장면]')
    expect(copied.copy_sections.parent_proxy).toEqual({ found: 0, regenerated: false, remaining: [] })
  })

  it('copy: 아이 사용 문장이 있으면 재작성 1회 — 줄이지 못하면 이전 카피·경고·잔여 기록', async () => {
    stage('A-track-i', 'copywriting', RECORD_AUDIENCE)
    asParentProduct()
    fixtureFinal().usageSceneTags = ['#생일답례', '#아이와함께붙이기']
    const job = await run()
    const stage1 = golden.rec.calls.filter((c) => c.agent === 'registration/pdp-copy-stage1')
    // 본 콜 + 학부모 시점 재작성 + 숫자·단위 재작성(P0-2 — 이 시험은 연령 칸을 지워 픽스처 카피의 연령 고지 '14세'가 입력에 없다)
    expect(stage1).toHaveLength(3)
    expect(stage1[1].user).toContain('[학부모 시점 재작성 지시]')
    expect(stage1[2].user).toContain('[숫자·단위 재작성 지시]')
    expect(stage1[1].user).toContain('#아이와함께붙이기')
    expect(job.copy_sections.parent_proxy).toMatchObject({ found: 1, regenerated: false })
    expect(job.copy_sections.parent_proxy!.remaining).toEqual([
      { section: 'usageSceneTags', kind: '함께 사용', sentence: '#아이와함께붙이기' },
    ])
    expect(job.error).toContain('학부모 시점 재생성이 아이 사용·반응 문장을 줄이지 못함')
    expect(job.error).toContain('[ParentProxy] 아이 사용·반응 문장 잔여 1건')
  })

  it('copy: 재작성이 문장을 줄이면 그 결과를 받는다', async () => {
    stage('A-track-i', 'copywriting', RECORD_AUDIENCE)
    asParentProduct()
    const base = fixtureFinal()
    const real = golden.cannedText
    let copyCalls = 0
    golden.cannedText = (agent: string) => {
      if (!agent.startsWith('registration/pdp-copy-stage')) return real(agent)
      copyCalls++
      return JSON.stringify({ ...base, usageSceneTags: copyCalls <= 3 ? ['#아이와함께붙이기'] : ['#생일답례준비'] })
    }
    try {
      const job = await run()
      expect(job.copy_sections.parent_proxy).toEqual({ found: 1, regenerated: true, remaining: [] })
      expect(job.copy_sections.final?.usageSceneTags).toEqual(['#생일답례준비'])
    } finally {
      golden.cannedText = real
    }
  })

  it('연령 게이트 잡(ageGate)은 게이트가 우선 — 게이트용 페르소나·블록, 학부모 검사·재작성은 하지 않는다', async () => {
    stage('A-track-i', 'copywriting', RECORD_AUDIENCE_GATED)
    asParentProduct(true)
    const job = await run()
    const stage1 = golden.rec.calls.find((c) => c.agent === 'registration/pdp-copy-stage1')!.user
    expect(stage1).toContain(`타겟 페르소나: ${PARENT_PROXY_PERSONA_GATED}`)
    expect(stage1).toContain('연령 제한 블록의 금지어')
    // 연령 블록이 학부모 블록 뒤(마지막에 우선)
    expect(stage1.indexOf('[연령 제한')).toBeGreaterThan(stage1.indexOf('[학부모 대리 구매형'))
    expect(golden.rec.calls.some((c) => c.user.includes('[학부모 시점 재작성 지시]'))).toBe(false)
    expect(job.copy_sections.parent_proxy).toBeUndefined()
  })

  it('images: 기록 잡은 컷 프롬프트에 어른 손·준비된 결과물 지시, 기록 없는 잡은 없다', async () => {
    stage('A-track-i', 'images', RECORD_AUDIENCE)
    asParentProduct()
    const atImages = golden.rec.job as unknown as PdpJobRow
    await runUntil('compose')
    let checked = 0
    for (const task of buildImageTasks(atImages)) {
      const prompt = golden.rec.images.find((i) => i.prompt.startsWith(task.prompt))?.prompt
      if (!prompt) continue
      checked++
      expect(prompt, task.section).toContain('[PARENT-PREP SCENE - MANDATORY]')
    }
    expect(checked).toBeGreaterThan(0)

    stage('A-track-i', 'images', RECORD_T6B)
    asParentProduct()
    await runUntil('compose')
    expect(golden.rec.images.length).toBeGreaterThan(0)
    expect(golden.rec.images.some((i) => i.prompt.includes('[PARENT-PREP SCENE'))).toBe(false)
  })
})

// ── Track S(표준 생성) 학부모 대리 구매형 — 판정이 켜진 잡만 audience 하나(통합 결정: 오너 요청이 운영 기본 생성에도 해당) ──

const RECORD_TRACK_S = {
  version: 1,
  features: ['audience'],
  audience: { kind: 'parent_proxy', version: 1, basis: 'name_tags', terms: ['구디백'], ageGate: false },
}

/** C(구디백) Track S 잡을 단계 앞에 두고 Track S 분석이 남기는 기록만 얹는다(decision_profile 없음). null이면 기록 없는 Track S 잡 */
function stageTrackS(step: Parameters<typeof rewindTo>[1], record: object | null = RECORD_TRACK_S): PdpJobRow {
  const job = stage('C-track-s', step, false)
  if (record) job.analysis = { ...job.analysis, enrichment: record } as never
  return job
}

describe('Track S 학부모 대리 구매형 — 판정이 켜진 잡만 audience 하나를 기록', () => {
  it('analysis: 판정이 켜진 잡(C 구디백)은 audience 하나만 기록하고 decision_profile은 없다 — 대조군 off면 기록 없음', async () => {
    stage('C-track-s', 'analysis', false)
    const on = await run()
    expect(on.analysis.enrichment).toEqual(RECORD_TRACK_S)
    expect(on.analysis.decision_profile).toBeUndefined()

    vi.stubEnv('NEXOPS_PDP_ENRICHMENT', 'off')
    stage('C-track-s', 'analysis', false)
    expect((await run()).analysis.enrichment).toBeUndefined()
  })

  it('research·design·copy: 빈 targetPersona에 학부모 페르소나(저장 안 함), 카피 Stage 1·2·3에 화자 블록 — 설득 플래너는 없다', async () => {
    stageTrackS('research')
    await run()
    expect(golden.rec.calls.find((c) => c.agent === 'registration/pdp-research')!.user).toContain(PARENT_PROXY_PERSONA)

    golden.rec.calls = []
    const designed = await run()
    expect(golden.rec.calls.find((c) => c.agent === 'registration/pdp-design-prompt')!.user).toContain(PARENT_PROXY_PERSONA)
    expect(designed.section_plan.internalized_skeleton?.persuasion).toBeUndefined()
    expect(designed.spec_sheet.targetPersona ?? '').toBe('')

    golden.rec.calls = []
    const copied = await run()
    const user = (n: number) => golden.rec.calls.find((c) => c.agent === `registration/pdp-copy-stage${n}`)!.user
    expect(user(1)).toContain(`타겟 페르소나: ${PARENT_PROXY_PERSONA}`)
    for (const n of [1, 2, 3]) expect(user(n)).toContain('[학부모 대리 구매형 — 화자·장면]')
    expect(copied.copy_sections.parent_proxy).toBeDefined()
  })

  it('images: 판정이 켜진 Track S 잡은 컷 프롬프트에 어른 손·준비된 결과물 지시, 기록 없는 Track S 잡은 없다', async () => {
    const atImages = stageTrackS('images')
    await runUntil('compose')
    let checked = 0
    for (const task of buildImageTasks(atImages)) {
      const prompt = golden.rec.images.find((i) => i.prompt.startsWith(task.prompt))?.prompt
      if (!prompt) continue
      checked++
      expect(prompt, task.section).toContain('[PARENT-PREP SCENE - MANDATORY]')
    }
    expect(checked).toBeGreaterThan(0)

    stageTrackS('images', null)
    await runUntil('compose')
    expect(golden.rec.images.length).toBeGreaterThan(0)
    expect(golden.rec.images.some((i) => i.prompt.includes('[PARENT-PREP SCENE'))).toBe(false)
  })
})

// ── R1 빛·색온도 정본(light 기능, 기본 off) ──

describe('R1 빛·색온도 정본 — light 기록 잡만', () => {
  const RECORD_LIGHT = { version: 1, features: [...RECORD_T6B.features, 'lean', 'light'] }

  it('design: light 기록 잡의 설계 콜에만 헌장 우선 블록이 붙는다', async () => {
    stage('A-track-i', 'design', RECORD_LIGHT)
    await run()
    const designCall = () => golden.rec.calls.find((c) => c.agent === 'registration/pdp-design-prompt')!.user
    expect(designCall()).toContain('## 빛·색온도(스타일 헌장이 정한다)')
    expect(designCall()).not.toContain('Golden hour warm soft lighting.')
    stage('A-track-i', 'design', RECORD_T6B)
    await run()
    expect(designCall()).not.toContain('## 빛·색온도')
    expect(designCall()).toContain('Golden hour warm soft lighting.')
  })

  it('images: light 기록 잡의 헌장 있는 컷에만 규칙 줄이 붙고 사진 기본의 조명 줄이 빠진다', async () => {
    stage('A-track-i', 'images', RECORD_LIGHT)
    await runUntil('compose')
    const withCharter = golden.rec.images.filter((i) => i.prompt.includes('GLOBAL STYLE CHARTER'))
    expect(withCharter.length).toBeGreaterThan(0)
    for (const image of withCharter) {
      expect(image.prompt.split(LIGHT_RULE).length - 1).toBe(1)
      expect(image.prompt).not.toContain('large softbox at 45-degree angle')
      expect(image.prompt).not.toContain('Category lighting')
    }

    stage('A-track-i', 'images', RECORD_T6B)
    await runUntil('compose')
    expect(golden.rec.images.length).toBeGreaterThan(0)
    expect(golden.rec.images.some((i) => i.prompt.includes(LIGHT_RULE))).toBe(false)
  })
})

// ── R2 세트 기술·장면 컷(scene 기능, 기본 off) ──

describe('R2 세트 기술·장면 컷 — scene 기록 잡만', () => {
  const RECORD_SCENE = { version: 1, features: [...RECORD_T6B.features, 'scene'] }
  /** 컷 하나의 실제 생성 프롬프트(태스크 프롬프트로 시작하는 것) */
  const promptOf = (atImages: PdpJobRow, section: string) => {
    const task = buildImageTasks(atImages).find((t) => t.section === section)
    return task ? golden.rec.images.find((i) => i.prompt.startsWith(task.prompt))?.prompt : undefined
  }

  it('images: 헌장 setDesc는 결정론 세트, 장면 컷은 세트 바탕, 상품 없는 장면 컷(문제)은 히어로 빛·색 참조 안내', async () => {
    const atImages = stage('A-track-i', 'images', RECORD_SCENE)
    await runUntil('compose')
    const setDesc = describeSceneSet(buildSceneSet(sceneSetInputOf(atImages)))
    const charterCuts = golden.rec.images.filter((i) => i.prompt.includes('GLOBAL STYLE CHARTER'))
    expect(charterCuts.length).toBeGreaterThan(0)
    for (const image of charterCuts) expect(image.prompt).toContain(`- Set description: ${setDesc}`)
    const problem = promptOf(atImages, 'problem')
    expect(problem).toContain(SCENE_STYLE_REF_TEXT)
    expect(problem).toContain(SCENE_BACKGROUND_LINE)
    const hero = promptOf(atImages, 'hero')
    expect(hero).toMatch(/- Background: solid /)
    expect(hero).not.toContain(SCENE_STYLE_REF_TEXT)
  })

  it('images: scene 기록이 없으면 세트·장면 안내가 없다(지금 그대로)', async () => {
    stage('A-track-i', 'images', RECORD_T6B)
    await runUntil('compose')
    expect(golden.rec.images.length).toBeGreaterThan(0)
    expect(golden.rec.images.some((i) => i.prompt.includes(SCENE_STYLE_REF_TEXT) || i.prompt.includes(SCENE_BACKGROUND_LINE))).toBe(false)
  })
})

// ── R3 촬영 계획(shotplan 기능, 기본 off) ──

describe('R3 촬영 계획 — shotplan 기록 잡만', () => {
  const RECORD_PLAN = { version: 1, features: [...RECORD_T6B.features, 'shotplan'] }
  const CAST_LINE = '- Cast (identical in every cut that shows people, hands or animals): '

  // 픽스처의 설계 골격에는 설득 기록이 없다 — 연출 블록(shots)은 설득 플래너 잡만 받으므로 설계부터 다시 돌린다(T3 시험과 같다).
  // 설계 응답 모의는 픽스처 design_prompts(옛 run의 헌장·식별 카드 포함)를 돌려주므로, images 직전에 rewindTo('images')처럼
  // 헌장·식별 카드를 비워 이번 run이 만들게 한다
  const runFromDesign = async (record: typeof RECORD_T6B) => {
    stage('A-track-i', 'design', record)
    await run()
    await runUntil('images')
    const { style_charter: _charter, identity_card: _identity, ...prompts } = golden.rec.job.design_prompts as Record<string, unknown>
    golden.rec.job.design_prompts = prompts
    golden.rec.images = []
    await runUntil('compose')
  }

  it('images: 헌장에 잡 단위 출연 한 줄, 연출 블록이 붙는 컷에는 촬영 계획(역할 의도·금지·거리·앵글)', async () => {
    await runFromDesign(RECORD_PLAN)
    const charterCuts = golden.rec.images.filter((i) => i.prompt.includes('GLOBAL STYLE CHARTER'))
    expect(charterCuts.length).toBeGreaterThan(0)
    for (const image of charterCuts) expect(image.prompt).toContain(CAST_LINE)
    const planned = golden.rec.images.filter((i) => i.prompt.includes('[Page shot plan]'))
    expect(planned.length).toBeGreaterThan(0)
    // 계획 블록은 연출 블록 뒤에, 첫 줄은 컷 지시 우선. 축을 못 박는 pro 차별 컷(픽스처 A는 pro)은 의도·금지만 받고 거리·앵글은 없다
    for (const image of planned) {
      expect(image.prompt).toContain('[Shot direction')
      expect(image.prompt).toContain(`[Page shot plan]\n${SHOT_PLAN_PRIORITY}`)
    }
    expect(
      planned.some((i) => /\nDistance: /.test(i.prompt) && /\nAngle: /.test(i.prompt) && /\nIntent: /.test(i.prompt))
    ).toBe(true)
  })

  it('images: shotplan 기록이 없으면 출연 줄·촬영 계획이 없다(연출 블록은 그대로)', async () => {
    await runFromDesign(RECORD_T6B)
    expect(golden.rec.images.some((i) => i.prompt.includes('[Shot direction'))).toBe(true)
    expect(golden.rec.images.some((i) => i.prompt.includes(CAST_LINE) || i.prompt.includes('[Page shot plan]'))).toBe(false)
  })
})
