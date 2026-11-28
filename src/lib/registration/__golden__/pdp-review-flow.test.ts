/**
 * 리뷰 입력(pdp-review-input) 파이프라인 흐름 — 골든과 같은 모의(LLM·DB 캔드 응답)로 실제 runPdpStep을
 * analysis → research → design → copywriting 순서로 돌려 다음을 고정한다.
 * - 경쟁사 리뷰 원문은 경쟁사 분석 콜에만 들어간다(본 분석·리서치·설계·카피 프롬프트에는 없다).
 * - 불만 요약은 analysis.competitor_pain_points에 저장되고, 리서치에는 덧붙임 블록으로만 간다(analysis JSON에는 없다).
 * - 카피 재현 가드: 겹친 섹션 재생성 1회(지시에 원문 없음) → 남은 문장 지우기·기록.
 * - 경쟁사 리뷰가 없는 잡은 경쟁사 콜·블록·기록이 없다(나머지 불변은 pdp-golden이 고정한다).
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PdpJobRow, PdpSpecSheet } from '../pdp-state'
import type { CompetitorReviews } from '../reviews/review-types'

const COMPETITOR_SENTENCE = '경쟁품은 뚜껑 고무 패킹이 금방 늘어나서 세 번 쓰고 버렸어요'
const COMPETITOR_REVIEWS: CompetitorReviews = {
  version: 1,
  fileName: 'competitor.xlsx',
  stats: { total_rows: 120, text_review_count: 3, rating_counts: { '5': 80, '2': 40 } },
  dropped: 0,
  removedNames: ['라스'],
  checkNames: ['라스'],
  items: [
    { id: 1, rating: 2, helped: 4, title: '', body: `${COMPETITOR_SENTENCE}.` },
    { id: 2, rating: 2, helped: 0, title: '아쉬움', body: '꽃가루가 바닥에 흩어져서 치우는 데 한참 걸렸어요.' },
    { id: 3, rating: 5, helped: 1, title: '', body: '색이 예쁜데 개수가 생각보다 적었어요.' },
  ],
}
const PAIN_TYPE = '꽃가루 흩날림 정리 부담'
/** 자사 리뷰 파일 메타(reviewFiles)도 프롬프트에 들어가면 안 된다 */
const OWN_FILE_MARKER = 'OWN-REVIEW-FILE-MARKER.xlsx'

const flow = vi.hoisted(() => ({
  job: null as unknown as Record<string, unknown>,
  fixture: null as unknown as Record<string, Record<string, unknown>>,
  calls: [] as Array<{ agent: string; user: string }>,
  /** 카피 캔드 응답에 덧붙일 필드(재현 가드 사례) */
  copyExtra: null as Record<string, unknown> | null,
  /** 경쟁사 콜 실패 사례 */
  competitorFails: false,
}))

function cannedText(agent: string): string | null {
  const f = flow.fixture
  const copyFinal = { ...((f.copy_sections?.final ?? {}) as Record<string, unknown>), ...(flow.copyExtra ?? {}) }
  switch (agent) {
    case 'registration/pdp-category':
      return JSON.stringify({ category: f.analysis.detected_category ?? 'household' })
    case 'registration/pdp-analysis': {
      const { detected_category: _c, recommended_strategy_contract: _r, ...rest } = f.analysis
      return JSON.stringify(rest)
    }
    case 'registration/pdp-competitor-reviews':
      if (flow.competitorFails) return null
      return JSON.stringify({
        pain_points: [
          { type: PAIN_TYPE, review_ids: [2, 3], benefit_direction: '흩어지지 않아 정리가 쉬움' },
          { type: '패킹이 쉽게 늘어남', review_ids: [1], benefit_direction: '오래 써도 모양 유지' },
        ],
      })
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
    default:
      return null
  }
}

async function respond(options: Record<string, unknown>, parser: (text: string) => unknown) {
  const { messagesToText } = await import('./golden-harness')
  const agent = String(options.agentName ?? '')
  flow.calls.push({ agent, user: `${String(options.system ?? '')}\n${messagesToText(options.messages)}` })
  const usage = { inputTokens: 0, outputTokens: 0, cost: 0 }
  const text = cannedText(agent)
  if (text === null)
    return {
      success: false,
      error: { message: `캔드 응답 없음(${agent})`, stage: 'api', attempts: 1 },
      usage,
      duration: 0,
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
  callAgent: (options: Record<string, unknown>, parser: (text: string) => unknown) => respond(options, parser),
}))
vi.mock('@/lib/agents/openai-chat', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/agents/openai-chat')>()),
  callOpenAiChat: (options: Record<string, unknown>, parser: (text: string) => unknown) => respond(options, parser),
}))
vi.mock('@/lib/sourcing/registration/drafts', () => ({ appendDraftDetailAssets: async () => undefined }))
vi.mock('../pdp-jobs', () => {
  const PATCH_KEYS: Record<string, string> = {
    analysis: 'analysis',
    researchResult: 'research_result',
    designPrompts: 'design_prompts',
    sectionPlan: 'section_plan',
    copySections: 'copy_sections',
    currentStep: 'current_step',
    progress: 'progress',
    error: 'error',
    costUsd: 'cost_usd',
    corpusVersion: 'corpus_version',
  }
  const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T
  return {
    getPdpJob: async () => copy(flow.job),
    isPdpJobLeased: () => false,
    claimPdpJobRun: async () => ({ job: copy(flow.job), leaseUntil: 'lease' }),
    updatePdpJob: async (_db: unknown, _u: string, _id: string, patch: Record<string, unknown>) => {
      for (const [key, value] of Object.entries(patch)) {
        if (value !== undefined && PATCH_KEYS[key]) flow.job[PATCH_KEYS[key]] = copy(value)
      }
      return copy(flow.job)
    },
  }
})

import { runPdpStep } from '../pdp-pipeline'
import { findCopyEchoes, buildEchoGuard } from '../reviews/competitor-echo'
import {
  GOLDEN_NOW,
  GOLDEN_SUPABASE_URL,
  GOLDEN_USER_ID,
  fixtureToJob,
  loadEnrichmentFixture,
  rewindTo,
} from './golden-harness'

function start(withCompetitor: boolean): void {
  const fixture = loadEnrichmentFixture('A-track-s')
  flow.fixture = fixture as unknown as Record<string, Record<string, unknown>>
  const job = rewindTo(fixtureToJob(fixture), 'analysis')
  if (withCompetitor) {
    job.spec_sheet = {
      ...job.spec_sheet,
      competitorReviews: COMPETITOR_REVIEWS,
      reviewFiles: { own: { fileName: OWN_FILE_MARKER, stats: COMPETITOR_REVIEWS.stats, sampled: 1, dropped: 0 } },
    } as PdpSpecSheet
  }
  flow.job = job as unknown as Record<string, unknown>
  flow.copyExtra = null
  flow.competitorFails = false
}

async function step(expected: string): Promise<{ job: PdpJobRow; calls: typeof flow.calls }> {
  flow.calls = []
  const job = await runPdpStep(flow.job.id as string, GOLDEN_USER_ID)
  expect(job.current_step, job.error ?? '').toBe(expected)
  return { job, calls: [...flow.calls] }
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

describe('경쟁사 리뷰가 있는 잡', () => {
  it('원문은 경쟁사 콜에만 — 요약은 analysis에 저장되고 리서치에만 블록으로 간다, 카피 가드 기록', async () => {
    start(true)

    const analysis = await step('research')
    const competitorCalls = analysis.calls.filter((c) => c.agent === 'registration/pdp-competitor-reviews')
    expect(competitorCalls).toHaveLength(1)
    expect(competitorCalls[0].user).toContain(COMPETITOR_SENTENCE)
    for (const c of analysis.calls.filter((c) => c.agent !== 'registration/pdp-competitor-reviews')) {
      expect(c.user, c.agent).not.toContain(COMPETITOR_SENTENCE)
      expect(c.user, c.agent).not.toContain('competitorReviews')
    }
    expect(analysis.job.analysis.competitor_pain_points).toEqual({
      version: 1,
      sample_size: 3,
      total_rows: 120,
      items: [
        { type: PAIN_TYPE, count: 2, share: 0.67, benefit_direction: '흩어지지 않아 정리가 쉬움' },
        { type: '패킹이 쉽게 늘어남', count: 1, share: 0.33, benefit_direction: '오래 써도 모양 유지' },
      ],
    })

    const research = await step('design')
    const researchCall = research.calls.find((c) => c.agent === 'registration/pdp-research')!
    expect(researchCall.user).toContain('## 경쟁 상품 고객 불만 요약(기획 전용 — 리뷰 원문 아님)')
    expect(researchCall.user).toContain(`1. ${PAIN_TYPE} · 효용 방향:`)
    expect(researchCall.user).not.toContain(COMPETITOR_SENTENCE)
    expect(researchCall.user).not.toContain('competitor_pain_points')

    const design = await step('copywriting')
    const copy = await step('images')
    for (const c of [...design.calls, ...copy.calls]) {
      expect(c.user, c.agent).not.toContain(COMPETITOR_SENTENCE)
      expect(c.user, c.agent).not.toContain('경쟁 상품 고객 불만 요약')
      expect(c.user, c.agent).not.toContain(PAIN_TYPE)
      expect(c.user, c.agent).not.toContain('competitor_pain_points')
    }
    expect(copy.job.copy_sections.competitor_echo).toEqual({ rewritten_sections: [], regenerated: false, removed: [] })
    for (const c of [...analysis.calls, ...research.calls, ...design.calls, ...copy.calls]) {
      expect(c.user, c.agent).not.toContain(OWN_FILE_MARKER)
    }
  })

  it('경쟁사 콜이 실패하면 경고만 남기고 요약·블록 없이 계속한다', async () => {
    start(true)
    flow.competitorFails = true
    const analysis = await step('research')
    expect(analysis.job.error).toContain('[CompetitorReviews] 경쟁사 리뷰 분석 실패')
    expect('competitor_pain_points' in analysis.job.analysis).toBe(false)
    const research = await step('design')
    expect(research.calls.find((c) => c.agent === 'registration/pdp-research')!.user).not.toContain('경쟁 상품')
  })

  it('카피가 경쟁사 리뷰 문장을 옮기면 그 섹션 이름만 지시해 1회 재생성하고, 남은 문장은 지워 기록한다', async () => {
    start(true)
    await step('research')
    await step('design')
    await step('copywriting')
    flow.copyExtra = { summary: `${COMPETITOR_SENTENCE}. 정리가 쉬운 구조예요.` }
    const before = flow.calls.length
    const copy = await step('images')
    const stage1 = copy.calls.filter((c) => c.agent === 'registration/pdp-copy-stage1')
    expect(stage1.length, `calls ${before}`).toBeGreaterThanOrEqual(2)
    const directiveCall = stage1.find((c) => c.user.includes('[경쟁 상품 리뷰 재현 금지 — 재작성 지시]'))!
    expect(directiveCall.user).toContain(': summary')
    // 재생성 입력(Stage 1·지시)에는 원문이 없다 — Stage 2·3은 앞 단계 산출을 받으므로 이 모의 사례에서는 겹친 산출이 이어진다
    for (const c of stage1) expect(c.user, c.agent).not.toContain(COMPETITOR_SENTENCE)

    const record = copy.job.copy_sections.competitor_echo!
    expect(record.rewritten_sections).toEqual(['summary'])
    expect(record.regenerated).toBe(true)
    expect(record.removed).toEqual([{ section: 'summary', sentences: 1 }])
    const final = copy.job.copy_sections.final as unknown as { summary: string }
    expect(final.summary).toBe('정리가 쉬운 구조예요.')
    const guard = buildEchoGuard(COMPETITOR_REVIEWS.items.map((it) => it.body))!
    expect(findCopyEchoes(copy.job.copy_sections.final!, guard)).toEqual([])
    expect(copy.job.error).toContain('[CompetitorEcho]')
  })
})

describe('경쟁사 리뷰가 없는 잡', () => {
  it('경쟁사 콜·요약·블록·가드 기록이 없다', async () => {
    start(false)
    const analysis = await step('research')
    expect(analysis.calls.map((c) => c.agent)).not.toContain('registration/pdp-competitor-reviews')
    expect('competitor_pain_points' in analysis.job.analysis).toBe(false)
    const research = await step('design')
    expect(research.calls.find((c) => c.agent === 'registration/pdp-research')!.user).not.toContain('경쟁 상품')
    await step('copywriting')
    const copy = await step('images')
    expect('competitor_echo' in copy.job.copy_sections).toBe(false)
  })
})
