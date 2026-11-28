/**
 * 카피 단계 재생성 — 걸린 섹션 1콜(regenslot 스위치 잡만, 결정 카드 c14 L·J27). 켠 잡은 재생성이 카피 전체(Stage 1~3)를 다시 돌지 않고 걸린
 * 최상위 섹션만 1콜로 다시 쓰고, 섹션마다 받는다(그 섹션의 대상 위반이 줄고 연령·아이 사용·숫자 가드가 늘지 않을 때만). 걸리지 않은 섹션은
 * 바이트 그대로다(회귀). 꺼진 잡은 pdp-copy-run-budget.test.ts 그대로. 카피 에이전트·섹션 재생성·에코·유사도·숫자 판정·DB는 모의(유료 0).
 * 카피 표시: '어린이' = 연령 위반(실제 검사), 'ECHO' = 경쟁사 리뷰 겹침, 'SIMILAR' = 코퍼스 유사, 'NUMBER' = 입력에 없는 숫자.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PdpJobRow } from './pdp-state'

const h = vi.hoisted(() => ({
  job: null as PdpJobRow | null,
  final: null as Record<string, unknown> | null,
  headline: '',
  echoOn: false,
  corpusOn: false,
  copyCalls: [] as Array<Record<string, unknown>>,
  regenCalls: [] as Array<Record<string, unknown>>,
  /** 섹션 재생성 콜마다 꺼내 쓰는 첫 화면 제목(마지막 것을 반복). null이면 콜 실패 */
  regenHeadlines: [] as Array<string | null>,
  patches: [] as Array<Record<string, unknown>>,
}))

const headlineOf = (copy: unknown) => String((copy as { mainIntro?: { benefitHeadline?: string } } | undefined)?.mainIntro?.benefitHeadline ?? '')

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({}) }))
vi.mock('@/lib/agents/budget', async (orig) => ({
  ...(await orig<typeof import('@/lib/agents/budget')>()),
  checkMonthlyBudget: vi.fn(async () => ({ allowed: true, spentUsd: 0, budgetUsd: 1000 })),
}))
vi.mock('./pdp-jobs', async (orig) => ({
  isPdpJobLeased: (await orig<typeof import('./pdp-jobs')>()).isPdpJobLeased,
  PdpLeaseLostError: (await orig<typeof import('./pdp-jobs')>()).PdpLeaseLostError,
  getPdpJob: vi.fn(async () => h.job),
  claimPdpJobRun: vi.fn(async (_db: unknown, _u: string, job: PdpJobRow) => ({ job, leaseUntil: new Date(Date.now() + 340_000).toISOString() })),
  updatePdpJob: vi.fn(async (_db: unknown, _u: string, _id: string, patch: Record<string, unknown>) => {
    h.patches.push(patch)
    return h.job
  }),
}))
vi.mock('./pdp-review-stage', async (orig) => ({
  ...(await orig<typeof import('./pdp-review-stage')>()),
  competitorEchoGuard: () => (h.echoOn ? {} : null),
  finishCompetitorEcho: (copy: unknown, _guard: unknown, record: Record<string, unknown>) => ({ copy, record: { ...record, removed: [] } }),
}))
vi.mock('./reviews/competitor-echo', async (orig) => ({
  ...(await orig<typeof import('./reviews/competitor-echo')>()),
  findCopyEchoes: (copy: unknown) => (headlineOf(copy).includes('ECHO') ? ['mainIntro'] : []),
}))
vi.mock('./similarity-gate', async (orig) => ({
  ...(await orig<typeof import('./similarity-gate')>()),
  loadCorpusCheck: () => (h.corpusOn ? {} : null),
  checkCopySimilarity: (copy: unknown) => (headlineOf(copy).includes('SIMILAR') ? [{ section: 'mainIntro', sentence: headlineOf(copy), score: 0.93 }] : []),
}))
vi.mock('./copy-numbers', async (orig) => ({
  ...(await orig<typeof import('./copy-numbers')>()),
  findUnsupportedNumbers: (copy: unknown) => (headlineOf(copy).includes('NUMBER') ? [{ path: 'mainIntro.benefitHeadline', token: '48시간', text: headlineOf(copy) }] : []),
}))
vi.mock('@/lib/agents/registration/pdp-copy-agent', async (orig) => ({
  ...(await orig<typeof import('@/lib/agents/registration/pdp-copy-agent')>()),
  runPdpCopywriting: vi.fn(async (input: Record<string, unknown>) => {
    h.copyCalls.push(input)
    const final = h.final as { mainIntro?: Record<string, unknown> }
    return { success: true, data: { final: { ...final, mainIntro: { ...final.mainIntro, benefitHeadline: h.headline } }, warnings: [] }, usage: { inputTokens: 0, outputTokens: 0, cost: 0.3 }, duration: 0 }
  }),
}))
vi.mock('@/lib/agents/registration/pdp-copy-section-regen', () => ({
  regenerateCopySections: vi.fn(async (input: { final: Record<string, unknown>; sections: string[] }) => {
    h.regenCalls.push(input)
    const headline = h.regenHeadlines.length > 1 ? h.regenHeadlines.shift()! : h.regenHeadlines[0]
    if (headline === null) return { success: false, error: { message: '시간 초과', stage: 'timeout', attempts: 1 }, usage: { inputTokens: 0, outputTokens: 0, cost: 0.05 }, duration: 0 }
    const intro = input.final.mainIntro as Record<string, unknown>
    return { success: true, data: { sections: { mainIntro: { ...intro, benefitHeadline: headline } }, dropped: [] }, usage: { inputTokens: 0, outputTokens: 0, cost: 0.1 }, duration: 0 }
  }),
}))

import { runPdpStep } from './pdp-pipeline'
import { fixtureToJob, loadEnrichmentFixture, rewindTo } from './__golden__/golden-harness'

const saved = () => h.patches.at(-1) as Record<string, unknown>
const savedSections = () => saved().copySections as Record<string, unknown>
const savedFinal = () => savedSections().final as Record<string, unknown>
const savedError = () => String(saved()?.error ?? '')
const run = () => runPdpStep(h.job!.id, h.job!.user_id)
const directiveOf = (call: Record<string, unknown>) => String(call.directive ?? '')

function setup({ minAge, regenslot = true }: { minAge?: number; regenslot?: boolean }) {
  const full = fixtureToJob(loadEnrichmentFixture('A-track-i'))
  h.final = full.copy_sections.final as unknown as Record<string, unknown>
  const base = rewindTo(full, 'copywriting')
  const { minAgeYears: _fixtureAge, ...spec } = base.spec_sheet
  void _fixtureAge
  const enrichment = (base.analysis as { enrichment?: { version: 1; features: string[] } }).enrichment
  const features = [...(enrichment?.features ?? []), ...(regenslot ? ['regenslot'] : [])]
  h.job = { ...base, spec_sheet: { ...spec, ...(minAge ? { minAgeYears: minAge } : {}) }, analysis: { ...base.analysis, enrichment: { version: 1, features } } } as PdpJobRow
  vi.stubEnv('VERCEL', '')
  vi.stubEnv('VERCEL_ENV', '')
}

/** 첫 카피(재생성 전)의 섹션 — 걸리지 않은 섹션이 그대로인지 비교한다 */
const firstFinal = () => ({ ...(h.final as Record<string, unknown>), mainIntro: { ...((h.final as { mainIntro: object }).mainIntro), benefitHeadline: h.headline } })

beforeEach(() => {
  h.headline = '보온 컵'
  h.echoOn = false
  h.corpusOn = false
  h.copyCalls = []
  h.regenCalls = []
  h.regenHeadlines = ['고친 컵']
  h.patches = []
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

describe('stepCopywriting — 걸린 섹션 1콜(regenslot)', () => {
  it('숫자·단위: 카피 전체를 다시 돌지 않고 걸린 섹션만 1콜, 고쳐지면 그 섹션만 받고 다른 섹션은 바이트 그대로다', async () => {
    setup({})
    h.headline = 'NUMBER 컵'
    const first = firstFinal()
    await run()
    expect(h.copyCalls).toHaveLength(1)
    expect(h.regenCalls).toHaveLength(1)
    expect(h.regenCalls[0].sections).toEqual(['mainIntro'])
    expect(directiveOf(h.regenCalls[0])).toContain('[숫자·단위 재작성 지시]')
    expect(headlineOf(savedFinal())).toBe('고친 컵')
    for (const [key, value] of Object.entries(first)) if (key !== 'mainIntro') expect(savedFinal()[key], key).toEqual(value)
    expect(saved()).toMatchObject({ currentStep: 'images' })
  })

  it('고쳐지지 않으면 받지 않는다(이전 카피 유지 경고), 콜이 실패해도 이전 카피 그대로다', async () => {
    setup({})
    h.headline = 'NUMBER 컵'
    h.regenHeadlines = ['NUMBER 그대로']
    await run()
    expect(headlineOf(savedFinal())).toBe('NUMBER 컵')
    expect(savedError()).toContain('숫자·단위 재생성이 입력에 없는 숫자를 줄이지 못함 — 이전 카피 유지')
    h.patches = []
    h.regenCalls = []
    h.regenHeadlines = [null]
    await run()
    expect(headlineOf(savedFinal())).toBe('NUMBER 컵')
    expect(savedError()).toContain('숫자·단위 섹션 재생성 실패 — 이전 카피 유지')
  })

  it('연령 표현(만 14세 이상): 위반이 있는 섹션만 다시 쓰고, 그 섹션의 위반이 줄면 받는다', async () => {
    setup({ minAge: 14 })
    h.headline = '어린이도 쉽게 쓰는 컵'
    await run()
    expect(h.copyCalls).toHaveLength(1)
    expect(h.regenCalls[0].sections).toEqual(['mainIntro'])
    expect(directiveOf(h.regenCalls[0])).toContain('[연령 제한 재작성 지시]')
    expect(headlineOf(savedFinal())).toBe('고친 컵')
  })

  it('경쟁사 재현·유사도: 겹침을 고쳐도 어린이 표현을 늘리면 받지 않고, 다음 재생성이 그 섹션을 다시 판정한다', async () => {
    setup({ minAge: 14 })
    h.headline = 'ECHO SIMILAR 컵'
    h.echoOn = true
    h.corpusOn = true
    h.regenHeadlines = ['어린이 SIMILAR 컵', '조용한 컵']
    await run()
    expect(h.copyCalls).toHaveLength(1)
    expect(h.regenCalls.map((call) => directiveOf(call).match(/\[(경쟁 상품 리뷰 재현 금지|유사도 게이트)[^\]]*\]/)?.[1])).toEqual(['경쟁 상품 리뷰 재현 금지', '유사도 게이트'])
    expect(savedError()).toContain('경쟁사 리뷰 재현 재생성 결과가 어린이 표현을 늘림 — 재생성 결과를 버리고 이전 카피 유지')
    expect(headlineOf(savedFinal())).toBe('조용한 컵')
    // 유사 판정이 비면 기록 키가 없다
    expect(savedSections().similarity_warnings ?? []).toEqual([])
    expect(savedSections().competitor_echo).toMatchObject({ rewritten_sections: ['mainIntro'], regenerated: false })
  })

  it('스위치가 꺼진 잡은 지금처럼 카피 전체를 다시 돈다(섹션 재생성 0)', async () => {
    setup({ regenslot: false })
    h.headline = 'NUMBER 컵'
    await run()
    expect(h.regenCalls).toHaveLength(0)
    expect(h.copyCalls).toHaveLength(2)
  })
})
