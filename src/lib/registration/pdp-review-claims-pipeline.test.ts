/**
 * 후기 사용 범위·후기 유래 주장 검출(R6) — 자사 리뷰가 있는 모든 잡(Track S·I, 플래너 기록과 무관)은 후기 사용 범위 블록을
 * Stage 1 그라운딩과 Stage 2·3·보충 말미에 받고, 최종 카피의 규제 표현(인증·인허가·의학·기능성)을 copy_sections.review_claims와 경고에 남긴다
 * (지우지 않는다). 리뷰가 없으면 지금 그대로다. 카피 에이전트·DB는 모의(유료 호출 0), 주장 범위 판정(resolveClaimGuardBlock)도 모의.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PdpJobRow } from './pdp-state'

const h = vi.hoisted(() => ({
  job: null as PdpJobRow | null,
  final: null as Record<string, unknown> | null,
  guard: null as string | null,
  patches: [] as Array<Record<string, unknown>>,
  copyCalls: [] as Array<Record<string, unknown>>,
}))

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
vi.mock('./pdp-enrichment-stage', async (orig) => ({
  ...(await orig<typeof import('./pdp-enrichment-stage')>()),
  resolveClaimGuardBlock: () => h.guard,
}))
vi.mock('@/lib/agents/registration/pdp-copy-agent', async (orig) => ({
  ...(await orig<typeof import('@/lib/agents/registration/pdp-copy-agent')>()),
  runPdpCopywriting: vi.fn(async (input: Record<string, unknown>) => {
    h.copyCalls.push(input)
    const final = h.final as { mainIntro?: Record<string, unknown> }
    return {
      success: true,
      data: {
        // 규제 표현(인증 사칭·기능성 효능)과 체감 효익('두피가 시원해요' — 세지 않는다)이 함께 든 카피
        final: {
          ...final,
          mainIntro: { ...final.mainIntro, hook: 'KC 인증 받은 브러시로 감고 나면 두피가 시원해요' },
          solution: { summary: '탈모 완화에 좋은 실리콘 돌기' },
        },
        warnings: [],
      },
      usage: { inputTokens: 0, outputTokens: 0, cost: 0 },
      duration: 0,
    }
  }),
}))

import { REVIEW_CLAIM_BLOCK } from '@/lib/agents/registration/prompts/pdp-claim-guard-prompts'
import { buildAgeComplianceCopyBlock } from './compliance-gate'
import { runPdpStep } from './pdp-pipeline'
import { fixtureToJob, loadEnrichmentFixture, rewindTo } from './__golden__/golden-harness'

const GUARD = '## [주장 범위 — 의학·인증 효능은 쓰지 않고, 체감 효능은 사실과 함께 쓴다]'
const saved = () => h.patches.at(-1) as Record<string, unknown>
const savedSections = () => saved().copySections as Record<string, unknown>
const run = () => runPdpStep(h.job!.id, h.job!.user_id)

function setup({ guard, reviewsText }: { guard: boolean; reviewsText?: string }) {
  const full = fixtureToJob(loadEnrichmentFixture('A-track-i'))
  h.final = full.copy_sections.final as unknown as Record<string, unknown>
  const base = rewindTo(full, 'copywriting')
  // 픽스처는 만 14세 이상 상품 — 연령 재생성이 끼지 않게 뺀다
  const { minAgeYears: _age, ...spec } = base.spec_sheet
  void _age
  h.job = {
    ...base,
    spec_sheet: { ...spec, ...(reviewsText !== undefined ? { reviewsText } : {}) },
  } as PdpJobRow
  h.guard = guard ? GUARD : null
}

beforeEach(() => {
  h.patches = []
  h.copyCalls = []
  vi.stubEnv('VERCEL', '')
  vi.stubEnv('VERCEL_ENV', '')
})
afterEach(() => {
  vi.unstubAllEnvs()
})

describe('stepCopywriting — 후기 사용 범위·후기 유래 규제 표현 검출(R6)', () => {
  it('자사 리뷰가 있는 기록 잡: 주장 범위 뒤에 후기 블록, 최종 카피의 규제 표현을 칸과 함께 기록하고 경고(카피는 그대로)', async () => {
    setup({ guard: true })
    expect(h.job!.spec_sheet.reviewsText?.trim()).toBeTruthy()
    await run()
    const input = h.copyCalls[0]
    const both = [GUARD, REVIEW_CLAIM_BLOCK].join('\n\n')
    expect(input.stageGuardBlock).toBe(both)
    expect(String(input.groundingBlock)).toContain(both)
    const sections = savedSections()
    expect(sections.review_claims).toEqual(
      expect.arrayContaining([
        { kind: 'certification', terms: ['KC 인증'], sections: ['mainIntro'] },
        { kind: 'medical', terms: ['탈모 완화'], sections: ['solution'] },
      ])
    )
    expect(JSON.stringify(sections.review_claims)).not.toContain('시원')
    expect(String(saved().error)).toContain('[ReviewClaims] 자사 리뷰가 있는 잡 — 최종 카피의 인증·의학 표현')
    const final = sections.final as { mainIntro: { hook: string }; solution: { summary: string } }
    expect(final.mainIntro.hook).toBe('KC 인증 받은 브러시로 감고 나면 두피가 시원해요')
    expect(final.solution.summary).toBe('탈모 완화에 좋은 실리콘 돌기')
  })

  it('기록 잡이 아니어도(운영 기본 생성 — 주장 범위 블록 없음) 리뷰가 있으면 후기 블록을 받고 검출·기록한다', async () => {
    setup({ guard: false })
    await run()
    const input = h.copyCalls[0]
    expect(input.stageGuardBlock).toBe(REVIEW_CLAIM_BLOCK)
    expect(String(input.groundingBlock)).toContain(REVIEW_CLAIM_BLOCK)
    expect(savedSections().review_claims).toEqual(
      expect.arrayContaining([{ kind: 'medical', terms: ['탈모 완화'], sections: ['solution'] }])
    )
    expect(String(saved().error)).toContain('[ReviewClaims]')
  })

  it('리뷰가 없으면 블록·검출이 없다 — 기록 잡은 주장 범위만, 기록 없는 잡은 지금 그대로', async () => {
    setup({ guard: true, reviewsText: '' })
    await run()
    expect(h.copyCalls[0].stageGuardBlock).toBe(GUARD)
    expect(String(h.copyCalls[0].groundingBlock)).not.toContain(REVIEW_CLAIM_BLOCK)
    expect(savedSections()).not.toHaveProperty('review_claims')
    expect(String(saved().error ?? '')).not.toContain('[ReviewClaims]')

    h.patches = []
    h.copyCalls = []
    setup({ guard: false, reviewsText: '' })
    await run()
    expect(h.copyCalls[0]).not.toHaveProperty('stageGuardBlock')
    expect(savedSections()).not.toHaveProperty('review_claims')
  })

  it('연령 제한 잡은 Stage 2·3 말미에도 연령 블록을 받는다 — Stage 1과 같은 차례로 마지막(결정 카드 c03)', async () => {
    setup({ guard: true, reviewsText: '' })
    h.job = { ...h.job!, spec_sheet: { ...h.job!.spec_sheet, minAgeYears: 14 } } as PdpJobRow
    await run()
    const age = buildAgeComplianceCopyBlock(h.job!.spec_sheet)!
    expect(h.copyCalls[0].stageGuardBlock).toBe([GUARD, age].join('\n\n'))
    expect(String(h.copyCalls[0].groundingBlock).endsWith(age)).toBe(true)
  })
})
