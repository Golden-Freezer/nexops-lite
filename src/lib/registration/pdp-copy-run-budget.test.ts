/**
 * 카피 단계 재생성(연령·에코·유사도 — pdp-cost-time-followup, 숫자·단위 — P0-2) — run 시간 예산·순서·결과 채택 규칙.
 * - Vercel run이면 단계 시작 + 30분을 기한으로 카피 콜에 넘기고, 재생성은 남은 시간이 120초보다 적으면 시작하지 않는다(재생성 실패와
 *   같은 처리 + 경고). 로컬 실행기(Vercel 아님)는 기한이 없다.
 * - 연령 재생성이 맨 앞이다(규정 준수 우선). 뒤의 품질 재생성(에코·유사도)이 어린이 표현을 늘리면 그 결과를 받지 않는다.
 * - 카피 생성(Stage 1)이 기본 카피로 폴백한 재생성 결과는 버리고 이전 카피를 유지한다(이전 예정 pdp-copy-regen-fallback-fix).
 * 카피 에이전트·에코·유사도 판정·DB는 모의(유료 호출 0). 카피 표시: '어린이' = 연령 위반, 'ECHO' = 경쟁사 리뷰 겹침,
 * 'SIMILAR' = 코퍼스 유사. 시각은 Date.now 모의.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PdpJobRow } from './pdp-state'

type Output = { headline: string; stage1FellBack?: true }

const h = vi.hoisted(() => ({
  job: null as PdpJobRow | null,
  /** 되감기 전 픽스처 카피(되감은 잡은 copy_sections.final이 비어 있다) */
  final: null as Record<string, unknown> | null,
  /** 모의 시각의 단계 시작 — 실제 시각 뒤로 잡는다(픽스처 updated_at을 진행 잠금으로 오인하지 않게) */
  t0: 0,
  clock: 0,
  advanceMs: 0,
  /** 카피 콜마다 꺼내 쓰는 결과(마지막 것을 반복) */
  outputs: [] as Output[],
  echoOn: false,
  corpusOn: false,
  copyCalls: [] as Array<Record<string, unknown>>,
  patches: [] as Array<Record<string, unknown>>,
}))

const headlineOf = (copy: unknown) =>
  String((copy as { mainIntro?: { benefitHeadline?: string } } | undefined)?.mainIntro?.benefitHeadline ?? '')

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({}) }))
vi.mock('@/lib/agents/budget', async (orig) => ({
  ...(await orig<typeof import('@/lib/agents/budget')>()),
  checkMonthlyBudget: vi.fn(async () => ({ allowed: true, spentUsd: 0, budgetUsd: 1000 })),
}))
vi.mock('./pdp-jobs', async (orig) => ({
  isPdpJobLeased: (await orig<typeof import('./pdp-jobs')>()).isPdpJobLeased,
  PdpLeaseLostError: (await orig<typeof import('./pdp-jobs')>()).PdpLeaseLostError,
  getPdpJob: vi.fn(async () => h.job),
  claimPdpJobRun: vi.fn(async (_db: unknown, _u: string, job: PdpJobRow) => ({
    job,
    leaseUntil: new Date(Date.now() + 340_000).toISOString(),
  })),
  updatePdpJob: vi.fn(async (_db: unknown, _u: string, _id: string, patch: Record<string, unknown>) => {
    h.patches.push(patch)
    return h.job
  }),
}))
vi.mock('./pdp-review-stage', async (orig) => ({
  ...(await orig<typeof import('./pdp-review-stage')>()),
  competitorEchoGuard: () => (h.echoOn ? {} : null),
  finishCompetitorEcho: (copy: unknown, _guard: unknown, record: Record<string, unknown>) => ({
    copy,
    record: { ...record, removed: [] },
  }),
}))
vi.mock('./reviews/competitor-echo', async (orig) => ({
  ...(await orig<typeof import('./reviews/competitor-echo')>()),
  findCopyEchoes: (copy: unknown) => (headlineOf(copy).includes('ECHO') ? ['mainIntro'] : []),
}))
vi.mock('./similarity-gate', async (orig) => ({
  ...(await orig<typeof import('./similarity-gate')>()),
  loadCorpusCheck: () => (h.corpusOn ? {} : null),
  checkCopySimilarity: (copy: unknown) =>
    headlineOf(copy).includes('SIMILAR') ? [{ section: 'mainIntro', sentence: headlineOf(copy), score: 0.93 }] : [],
}))
vi.mock('./copy-numbers', async (orig) => ({
  ...(await orig<typeof import('./copy-numbers')>()),
  // 숫자·단위 검출은 첫 화면 제목의 NUMBER 표지로 흉내 낸다 — 픽스처 카피의 숫자와 상관없이 재생성 순서·채택만 본다
  findUnsupportedNumbers: (copy: unknown) =>
    headlineOf(copy).includes('NUMBER')
      ? [{ path: 'mainIntro.benefitHeadline', token: '48시간', text: headlineOf(copy) }]
      : [],
}))
vi.mock('@/lib/agents/registration/pdp-copy-agent', async (orig) => ({
  ...(await orig<typeof import('@/lib/agents/registration/pdp-copy-agent')>()),
  runPdpCopywriting: vi.fn(async (input: Record<string, unknown>) => {
    h.copyCalls.push(input)
    h.clock += h.advanceMs
    const out = h.outputs.length > 1 ? h.outputs.shift()! : h.outputs[0]
    const final = h.final as { mainIntro?: Record<string, unknown> }
    return {
      success: true,
      data: {
        final: { ...final, mainIntro: { ...final.mainIntro, benefitHeadline: out.headline } },
        warnings: [],
        ...(out.stage1FellBack ? { stage1FellBack: true } : {}),
      },
      usage: { inputTokens: 0, outputTokens: 0, cost: 0 },
      duration: 0,
    }
  }),
}))

import { checkMonthlyBudget } from '@/lib/agents/budget'
import { COPY_REGEN_MIN_MS, runPdpStep } from './pdp-pipeline'
import { RUN_TIME_BUDGET_MS } from './pdp-image-stage'
import { fixtureToJob, loadEnrichmentFixture, rewindTo } from './__golden__/golden-harness'

/** 재생성 콜의 종류 — 그라운딩 블록 끝에 붙은 지시로 가린다 */
const kindOf = (c: Record<string, unknown>) => {
  const g = String(c.groundingBlock ?? '')
  if (g.includes('[연령 제한 재작성 지시]')) return 'age'
  if (g.includes('[유사도 게이트 재작성 지시]')) return 'similarity'
  if (g.includes('[경쟁 상품 리뷰 재현 금지 — 재작성 지시]')) return 'echo'
  if (g.includes('[숫자·단위 재작성 지시]')) return 'number'
  return 'main'
}
const kinds = () => h.copyCalls.map(kindOf)
const saved = () => h.patches.at(-1) as Record<string, unknown>
const savedError = () => String(saved()?.error ?? '')
const savedSections = () => saved().copySections as Record<string, unknown>
const savedHeadline = () => headlineOf(savedSections().final)
const run = () => runPdpStep(h.job!.id, h.job!.user_id)

function setup({ minAge, vercel }: { minAge?: number; vercel: boolean }) {
  const full = fixtureToJob(loadEnrichmentFixture('A-track-i'))
  h.final = full.copy_sections.final as unknown as Record<string, unknown>
  const base = rewindTo(full, 'copywriting')
  // 픽스처(A 트랙)는 만 14세 이상 상품이다 — 연령 제한 없는 경우는 값을 지운다
  const { minAgeYears: _fixtureAge, ...spec } = base.spec_sheet
  void _fixtureAge
  h.job = { ...base, spec_sheet: { ...spec, ...(minAge ? { minAgeYears: minAge } : {}) } }
  vi.stubEnv('VERCEL', vercel ? '1' : '')
  vi.stubEnv('VERCEL_ENV', '')
}

beforeEach(() => {
  h.t0 = Date.now() + 3_600_000
  h.clock = h.t0
  h.advanceMs = 0
  h.outputs = [{ headline: '어린이도 쉽게 쓰는 컵' }]
  h.echoOn = false
  h.corpusOn = false
  h.copyCalls = []
  h.patches = []
  vi.spyOn(Date, 'now').mockImplementation(() => h.clock)
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

describe('stepCopywriting — run 시간 예산', () => {
  it('Vercel run: 기한(단계 시작 + 30분)을 카피 콜에 넘기고, 남은 시간이 넉넉하면 재생성을 지금처럼 한다', async () => {
    setup({ minAge: 14, vercel: true })
    h.advanceMs = 10_000
    await run()
    expect(kinds()).toEqual(['main', 'age'])
    for (const c of h.copyCalls) expect(c.deadlineAt).toBe(h.t0 + RUN_TIME_BUDGET_MS)
    expect(savedError()).not.toContain('재생성 건너뜀')
  })

  it('남은 시간이 120초보다 적으면 재생성 3종 모두 시작하지 않고 경고만 남긴다(유사도는 처음 findings, 에코는 재생성 없음 기록)', async () => {
    expect(COPY_REGEN_MIN_MS).toBe(120_000)
    setup({ minAge: 14, vercel: true })
    h.outputs = [{ headline: '어린이도 쉽게 쓰는 ECHO SIMILAR 컵' }]
    h.echoOn = true
    h.corpusOn = true
    h.advanceMs = RUN_TIME_BUDGET_MS - 110_000
    await run()
    expect(h.copyCalls).toHaveLength(1)
    for (const kind of ['연령 표현', '경쟁사 리뷰 재현', '코퍼스 유사도'])
      expect(savedError()).toContain(`${kind} 재생성 건너뜀(남은 110초)`)
    expect(savedError()).toContain('[AgeGate]')
    expect(savedSections().similarity_warnings).toEqual([{ section: 'mainIntro', score: 0.93 }])
    expect(savedSections().competitor_echo).toMatchObject({ rewritten_sections: ['mainIntro'], regenerated: false })
    expect(saved()).toMatchObject({ currentStep: 'images' })
  })

  it('로컬 실행기(Vercel 아님)는 기한이 없다 — 시간이 지나도 재생성하고 콜 인자에 기한을 싣지 않는다', async () => {
    setup({ minAge: 14, vercel: false })
    h.advanceMs = 250_000
    await run()
    expect(kinds()).toEqual(['main', 'age'])
    for (const c of h.copyCalls) expect(c).not.toHaveProperty('deadlineAt')
    expect(savedError()).not.toContain('재생성 건너뜀')
  })
})

describe('stepCopywriting — 재생성 순서·결과 채택', () => {
  it('연령 재생성이 맨 앞이다 — 시간이 한 벌만 남으면 품질 재생성(에코·유사도)보다 연령이 먼저 돈다', async () => {
    setup({ minAge: 14, vercel: true })
    // 두 콜 뒤 100초만 남도록 한다: 연령 재생성은 돌고 뒤 품질 재생성은 건너뛴다.
    h.outputs = [{ headline: '어린이도 쉽게 쓰는 ECHO SIMILAR 컵' }, { headline: '누구나 쉽게 쓰는 ECHO SIMILAR 컵' }]
    h.echoOn = true
    h.corpusOn = true
    h.advanceMs = (RUN_TIME_BUDGET_MS - 100_000) / 2
    await run()
    expect(kinds()).toEqual(['main', 'age'])
    expect(savedHeadline()).toBe('누구나 쉽게 쓰는 ECHO SIMILAR 컵')
    expect(savedError()).toContain('경쟁사 리뷰 재현 재생성 건너뜀')
    expect(savedError()).toContain('코퍼스 유사도 재생성 건너뜀')
    expect(savedError()).not.toContain('[AgeGate]')
  })

  it('카피 생성이 기본 카피로 폴백한 재생성 결과는 버리고 이전 카피와 위반 경고를 유지한다', async () => {
    setup({ minAge: 14, vercel: false })
    h.outputs = [{ headline: '어린이도 쉽게 쓰는 컵' }, { headline: '기본 카피', stage1FellBack: true }]
    await run()
    expect(kinds()).toEqual(['main', 'age'])
    expect(savedHeadline()).toBe('어린이도 쉽게 쓰는 컵')
    expect(savedError()).toContain('연령 표현 재생성의 카피 생성이 기본 카피로 폴백')
    expect(savedError()).toContain('[AgeGate]')
  })

  it('품질 재생성 결과가 어린이 표현을 늘리면 받지 않는다(연령 제한 잡) — 유사도 findings는 경고로 남는다', async () => {
    setup({ minAge: 14, vercel: false })
    h.outputs = [{ headline: '누구나 쓰는 SIMILAR 컵' }, { headline: '어린이도 좋아하는 컵' }]
    h.corpusOn = true
    await run()
    expect(kinds()).toEqual(['main', 'similarity'])
    expect(savedHeadline()).toBe('누구나 쓰는 SIMILAR 컵')
    expect(savedError()).toContain('코퍼스 유사도 재생성 결과가 어린이 표현을 늘림')
    expect(savedSections().similarity_warnings).toEqual([{ section: 'mainIntro', score: 0.93 }])
  })

  it('연령 제한이 없는 잡은 에코 → 유사도 순서·채택이 지금 그대로다', async () => {
    setup({ vercel: false })
    h.outputs = [
      { headline: '어린이도 ECHO SIMILAR 컵' },
      { headline: '어린이도 SIMILAR 컵' },
      { headline: '어린이도 쉬운 컵' },
    ]
    h.echoOn = true
    h.corpusOn = true
    await run()
    expect(kinds()).toEqual(['main', 'echo', 'similarity'])
    expect(savedHeadline()).toBe('어린이도 쉬운 컵')
    expect(savedSections()).not.toHaveProperty('age_compliance')
  })
})

describe('stepCopywriting — 숫자·단위 재작성(P0-2)', () => {
  it('연령 재생성 뒤·품질 재생성(에코·유사도) 앞에 1회 — 입력에 없는 숫자를 줄인 결과를 받는다', async () => {
    setup({ minAge: 14, vercel: false })
    h.outputs = [
      { headline: '어린이도 NUMBER ECHO SIMILAR 컵' },
      { headline: '누구나 NUMBER ECHO SIMILAR 컵' },
      { headline: '누구나 ECHO SIMILAR 컵' },
      { headline: '누구나 SIMILAR 컵' },
      { headline: '누구나 쓰는 컵' },
    ]
    h.echoOn = true
    h.corpusOn = true
    await run()
    expect(kinds()).toEqual(['main', 'age', 'number', 'echo', 'similarity'])
    expect(savedHeadline()).toBe('누구나 쓰는 컵')
    expect(savedSections().number_check).toEqual({ found: 1, regenerated: true, remaining: [] })
    expect(savedError()).not.toContain('[CopyNumbers]')
  })

  it('품질 재생성 결과가 입력에 없는 숫자를 늘리면 받지 않는다', async () => {
    setup({ vercel: false })
    h.outputs = [{ headline: '쉬운 SIMILAR 컵' }, { headline: '쉬운 NUMBER 컵' }]
    h.corpusOn = true
    await run()
    expect(kinds()).toEqual(['main', 'similarity'])
    expect(savedHeadline()).toBe('쉬운 SIMILAR 컵')
    expect(savedError()).toContain('코퍼스 유사도 재생성 결과가 입력에 없는 숫자를 늘림')
    expect(savedSections()).not.toHaveProperty('number_check')
  })

  it('숫자 재작성 결과가 어린이 표현을 늘리면 받지 않는다(연령 제한 잡) — 남은 숫자는 경고·기록', async () => {
    setup({ minAge: 14, vercel: false })
    h.outputs = [{ headline: '쉬운 NUMBER 컵' }, { headline: '어린이도 쉬운 컵' }]
    await run()
    expect(kinds()).toEqual(['main', 'number'])
    expect(savedHeadline()).toBe('쉬운 NUMBER 컵')
    expect(savedError()).toContain('숫자·단위 재생성 결과가 어린이 표현을 늘림')
    expect(savedSections().number_check).toMatchObject({ found: 1, regenerated: false })
  })

  it('숫자 재작성의 카피 생성이 기본 카피로 폴백하면 버리고 이전 카피를 둔다', async () => {
    setup({ minAge: 14, vercel: false })
    h.outputs = [{ headline: '쉬운 NUMBER 컵' }, { headline: '기본 카피', stage1FellBack: true }]
    await run()
    expect(kinds()).toEqual(['main', 'number'])
    expect(savedHeadline()).toBe('쉬운 NUMBER 컵')
    expect(savedError()).toContain('숫자·단위 재생성의 카피 생성이 기본 카피로 폴백')
    expect(savedError()).not.toContain('숫자·단위 재생성이 입력에 없는 숫자를 줄이지 못함')
  })

  it('지시는 Stage 1 그라운딩과 Stage 2·3 말미 블록에 함께 실린다', async () => {
    setup({ minAge: 14, vercel: false })
    h.outputs = [{ headline: '쉬운 NUMBER 컵' }, { headline: '쉬운 컵' }]
    await run()
    const regen = h.copyCalls[1]
    expect(String(regen.groundingBlock)).toContain('[숫자·단위 재작성 지시]')
    expect(String(regen.stageGuardBlock)).toContain('[숫자·단위 재작성 지시]')
    expect(String(h.copyCalls[0].stageGuardBlock ?? '')).not.toContain('[숫자·단위 재작성 지시]')
  })

  it('남은 시간이 모자라면 숫자 재작성도 시작하지 않고, 남은 숫자를 경고·기록한다', async () => {
    setup({ minAge: 14, vercel: true })
    h.outputs = [{ headline: '쉬운 NUMBER 컵' }]
    h.advanceMs = RUN_TIME_BUDGET_MS - 110_000
    await run()
    expect(h.copyCalls).toHaveLength(1)
    expect(savedError()).toContain('숫자·단위 재생성 건너뜀(남은 110초)')
    expect(savedError()).toContain('[CopyNumbers] 입력에 없는 숫자·단위 1건')
    expect(savedSections().number_check).toEqual({
      found: 1,
      regenerated: false,
      remaining: [{ path: 'mainIntro.benefitHeadline', token: '48시간', text: '쉬운 NUMBER 컵' }],
    })
  })
})

describe('시험 잡 예산 풀(오너 지시 10-31)', () => {
  it("cost_pool='test' 잡은 단계 예산을 시험 풀로 판정하고, 카피 콜 runContext에 pdp-test를 싣는다 — 운영 잡은 싣지 않는다", async () => {
    setup({ vercel: false })
    h.outputs = [{ headline: '쉬운 컵' }]
    h.job = { ...h.job!, cost_pool: 'test' }
    await run()
    expect(vi.mocked(checkMonthlyBudget)).toHaveBeenCalledWith('registration/pdp-pipeline', 'claude-sonnet-5-5', 'pdp-test')
    expect(h.copyCalls[0].runContext).toMatchObject({ stage: 'copywriting', costPool: 'pdp-test' })

    vi.mocked(checkMonthlyBudget).mockClear()
    setup({ vercel: false })
    h.copyCalls = []
    await run()
    expect(vi.mocked(checkMonthlyBudget)).toHaveBeenCalledWith('registration/pdp-pipeline', 'claude-sonnet-5-5', undefined)
    expect(h.copyCalls[0].runContext).not.toHaveProperty('costPool')
  })
})

describe('단계 시작 검사 — 예산 조회 실패 문구·잡당 비용 상한(점검 고침 5)', () => {
  it("예산 조회 실패(degraded)는 '소진 $0.00'이 아니라 조회 실패로 알리고 카피 콜을 하지 않는다", async () => {
    setup({ vercel: false })
    vi.mocked(checkMonthlyBudget).mockResolvedValueOnce({ allowed: false, spentUsd: 0, budgetUsd: 50, degraded: true, degradedReason: 'db down' })
    await run()
    expect(h.copyCalls).toHaveLength(0)
    expect(savedError()).toContain('AI 예산 조회 실패 — 잡을 멈춥니다')
    expect(savedError()).toContain('db down')
    expect(savedError()).not.toContain('소진')
  })

  it('예산이 실제로 바닥나면 지금 문구 그대로다', async () => {
    setup({ vercel: false })
    vi.mocked(checkMonthlyBudget).mockResolvedValueOnce({ allowed: false, spentUsd: 50.5, budgetUsd: 50 })
    await run()
    expect(savedError()).toContain('월 AI 예산($50) 소진 — 당월 지출 $50.50')
  })

  it('첫 생성이 상한(기본 $10)을 넘었으면 카피 단계를 돌리지 않고 재시도 없이 failed로 둔다 — 예산 조회도 하지 않는다', async () => {
    setup({ vercel: false })
    h.job = { ...h.job!, cost_usd: 10.4, final_html: null }
    vi.mocked(checkMonthlyBudget).mockClear()
    await run()
    expect(h.copyCalls).toHaveLength(0)
    expect(vi.mocked(checkMonthlyBudget)).not.toHaveBeenCalled()
    expect(saved()).toMatchObject({ currentStep: 'failed', error: '잡 비용 상한 $10 도달 — 이 잡 지출 $10.40. 잡을 멈춥니다.' })
  })

  it('상한 아래 첫 생성은 그대로 돈다 — 12월 뒤 전부 API 평균($7.26)도 걸리지 않는다', async () => {
    setup({ vercel: false })
    h.job = { ...h.job!, cost_usd: 7.26, final_html: null }
    await run()
    expect(h.copyCalls.length).toBeGreaterThan(0)
    expect(saved()).toMatchObject({ currentStep: 'images' })
  })
})
