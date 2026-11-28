/**
 * Stage 3가 '고칠 곳'을 실제로 반영하게(pdp-stage3-fix-effective) — flow·rhythm 잡은 '고칠 곳'을 검수 기준 안(5-1절, 6절 앞)에 넣고,
 * 블록이 가리킨 칸은 신고 없이 바뀌어도 되돌리지 않는다. 모든 pro 잡은 Stage 3 결과 기록(copy_sections.stage3)을 남긴다.
 * LLM은 모의(유료 호출 0) — Stage 1·2는 같은 카피, Stage 3 답은 시험마다 정한다.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PdpJobRow } from '@/lib/registration/pdp-state'

const h = vi.hoisted(() => ({
  job: null as unknown as PdpJobRow,
  calls: [] as Array<{ agentName: string; prompt: string }>,
  /** Stage 3 답 — Stage 2 카피를 받아 돌려줄 객체(문자열이면 그대로 응답 본문). null이면 콜 실패 */
  stage3: ((copy: Record<string, unknown>) => copy) as ((copy: Record<string, unknown>) => unknown) | null,
}))

/** Stage 1·2 — '손가락 대신'을 여러 섹션에 되풀이한 카피(흐름 검사의 되풀이 문구가 solution·summary 등을 가리키게) */
const stage2Copy = (): Record<string, unknown> => {
  const copy = h.job.copy_sections.final as unknown as Record<string, unknown>
  return {
    ...copy,
    mainIntro: { ...(copy.mainIntro as object), subBenefit: '손가락 대신 브러쉬로 감아요' },
    solution: { summary: '손가락 대신 실리콘 돌기가 닿아요' },
    summary: '손가락 대신 쓰는 샴푸 브러쉬',
    keyMessageCopy: { headline: '손가락 대신 쓰는 브러쉬' },
    compareSummary: '손가락 대신 쓰는 이유',
  }
}
const reply = (options: Record<string, unknown>, parser: (t: string) => unknown) => {
  const messages = options.messages as Array<{ content: string }>
  h.calls.push({ agentName: String(options.agentName), prompt: String(messages[0].content) })
  const usage = { inputTokens: 0, outputTokens: 0, cost: 0.01 }
  if (options.agentName === 'registration/pdp-copy-stage3') {
    if (!h.stage3) return { success: false, error: { message: '모의 실패', stage: 'api', attempts: 1 }, usage, duration: 0 }
    const out = h.stage3(stage2Copy())
    return { success: true, data: parser(typeof out === 'string' ? out : JSON.stringify(out)), usage, duration: 0 }
  }
  const text = options.agentName === 'registration/pdp-copy-retry-pointcards' ? '[]' : JSON.stringify(stage2Copy())
  return { success: true, data: parser(text), usage, duration: 0 }
}
vi.mock('../_base', () => ({ callAgent: async (o: Record<string, unknown>, p: (t: string) => unknown) => reply(o, p) }))
vi.mock('../openai-chat', () => ({ callOpenAiChat: async (o: Record<string, unknown>, p: (t: string) => unknown) => reply(o, p) }))

import { fixtureToJob, loadEnrichmentFixture } from '@/lib/registration/__golden__/golden-harness'
import { STAGE3_FIX_CRITERIA_HEAD, runPdpCopywriting, withStage3FixCriteria } from './pdp-copy-agent'

const savedBackend = process.env.NEXOPS_PDP_LLM_BACKEND
const FACTS = '## [사실 값 — 옵션 개수·수량 숫자는 이 값만 쓴다]\n- 디자인 6가지'
const FLOW_HEAD = '## [흐름 — 고칠 곳(결정론 검사)]'
const REPEAT_HEAD = '## [섹션 사이 반복 — 고칠 곳(결정론 검사)]'
const SIX = '### 6. 미변경 필드 보존'
const INPUT = '## 검수할 JSON'

beforeAll(() => {
  h.job = fixtureToJob(loadEnrichmentFixture('A-track-i'))
})
beforeEach(() => {
  delete process.env.NEXOPS_PDP_LLM_BACKEND
  h.calls = []
  h.stage3 = (copy) => copy
})
afterEach(() => {
  if (savedBackend !== undefined) process.env.NEXOPS_PDP_LLM_BACKEND = savedBackend
})

const run = (extra: Partial<Parameters<typeof runPdpCopywriting>[0]> = {}) =>
  runPdpCopywriting({
    specSheet: h.job.spec_sheet,
    mode: 'pro',
    analysis: h.job.analysis,
    research: h.job.research_result,
    sectionPlan: h.job.section_plan,
    strategyContract: {},
    runContext: { userId: 'user-1', stage: 'copywriting' },
    ...extra,
  })
const stage3Prompt = () => h.calls.find((c) => c.agentName === 'registration/pdp-copy-stage3')!.prompt
const dataOf = async (extra: Partial<Parameters<typeof runPdpCopywriting>[0]>) => {
  const out = await run(extra)
  if (!out.success) throw new Error('카피 실패')
  return out.data
}

describe('Stage 3 고칠 곳 자리 — flow·rhythm 잡만 검수 기준 안', () => {
  it('flow 잡은 고칠 곳이 5-1절로 6절(미변경 보존·변경 추적)과 검수할 JSON 앞에 들어가고, 사실 값은 그대로 맨 끝', async () => {
    await run({ checkRepeats: true, flowFix: true, factsBlock: FACTS })
    const p = stage3Prompt()
    const at = (s: string) => p.indexOf(s)
    expect(at(STAGE3_FIX_CRITERIA_HEAD)).toBeGreaterThan(0)
    expect(at(STAGE3_FIX_CRITERIA_HEAD)).toBeLessThan(at(FLOW_HEAD))
    expect(at(FLOW_HEAD)).toBeLessThan(at(SIX))
    expect(at(SIX)).toBeLessThan(at(INPUT))
    expect(p.endsWith(FACTS)).toBe(true)
  })

  it('재현 비교 옵션(stage3FixInCriteria)은 flow·rhythm 없이도 반복 고칠 곳을 기준 안으로 보낸다 — 옵션이 없으면 끝자리 그대로', async () => {
    await run({ checkRepeats: true, stage3FixInCriteria: true })
    const on = stage3Prompt()
    expect(on).toContain(STAGE3_FIX_CRITERIA_HEAD)
    expect(on.indexOf(REPEAT_HEAD)).toBeLessThan(on.indexOf(SIX))
    h.calls.length = 0
    await run({ checkRepeats: true })
    const off = stage3Prompt()
    expect(off).not.toContain(STAGE3_FIX_CRITERIA_HEAD)
    expect(off.indexOf(REPEAT_HEAD)).toBeGreaterThan(off.indexOf(SIX))
  })

  it('rhythm만 켠 잡도 반복·리듬 고칠 곳이 기준 안으로 간다', async () => {
    await run({ checkRepeats: true, rhythm: true })
    const p = stage3Prompt()
    expect(p.indexOf(REPEAT_HEAD)).toBeGreaterThan(p.indexOf(STAGE3_FIX_CRITERIA_HEAD))
    expect(p.indexOf(REPEAT_HEAD)).toBeLessThan(p.indexOf(SIX))
  })

  it('flow·rhythm이 없는 잡은 고칠 곳이 예전처럼 끝(검수할 JSON 뒤)에 붙고 5-1절이 없다', async () => {
    await run({ checkRepeats: true, factsBlock: FACTS })
    const p = stage3Prompt()
    expect(p).not.toContain(STAGE3_FIX_CRITERIA_HEAD)
    expect(p.indexOf(REPEAT_HEAD)).toBeGreaterThan(p.indexOf(INPUT))
  })

  it('표지(6절)가 없는 프롬프트면 끝에 붙이고, 블록이 없으면 그대로', () => {
    expect(withStage3FixCriteria('A\n### 6. 미변경 필드 보존\nB', ['X'])).toBe(`A\n${STAGE3_FIX_CRITERIA_HEAD}\n\nX\n\n### 6. 미변경 필드 보존\nB`)
    expect(withStage3FixCriteria('A', ['X', undefined])).toBe(`A\n\n${STAGE3_FIX_CRITERIA_HEAD}\n\nX`)
    expect(withStage3FixCriteria('A', ['', undefined])).toBe('A')
  })
})

describe('Stage 3 결과 기록(copy_sections.stage3)과 고칠 곳 칸 남기기', () => {
  it('미신고 응답 — 응답 그대로·비율 0, 기록 reported=null과 실제로 바뀐 칸, 경고 한 줄', async () => {
    h.stage3 = (copy) => ({ ...copy, summary: '바꾼 요약' })
    const data = await dataOf({ checkRepeats: true })
    expect(data.stage3_changed_ratio).toBe(0)
    expect(data.stage3).toEqual({ version: 1, parsed: 'object', reported: null, restored: [], kept: [], changedTopLevel: ['summary'] })
    expect(data.warnings.some((w) => w.startsWith('[Copywriting] Stage 3 _changed_fields 미신고'))).toBe(true)
  })

  it('flow 잡 — 빈 신고로 고칠 곳 칸(solution)을 바꾸면 남기고 신고로 센다. 고칠 곳 밖 칸(recommendedTargets)은 되돌린다', async () => {
    h.stage3 = (copy) => ({ ...copy, solution: { summary: '실리콘 돌기가 두피에 닿아요' }, recommendedTargets: ['바뀐 대상'], _changed_fields: [] })
    const data = await dataOf({ checkRepeats: true, flowFix: true })
    expect(data.stage3).toMatchObject({ parsed: 'object', reported: [], kept: ['solution'], restored: ['recommendedTargets'], fixInCriteria: true })
    expect(data.stage3!.changedTopLevel).toContain('solution')
    expect(data.stage3!.changedTopLevel).not.toContain('recommendedTargets')
    expect(data.stage3_changed_ratio).toBeGreaterThan(0)
    expect((data.stage2 as unknown as { solution: { summary: string } }).solution.summary).toBe('손가락 대신 실리콘 돌기가 닿아요')
    expect(data.warnings).toContain('[Copywriting] Stage 3 미신고 변경을 고칠 곳 칸이라 남김: solution')
  })

  it('flow·rhythm이 없는 잡은 같은 응답이어도 예전처럼 둘 다 되돌린다(남기기 없음)', async () => {
    h.stage3 = (copy) => ({ ...copy, solution: { summary: '실리콘 돌기가 두피에 닿아요' }, _changed_fields: [] })
    const data = await dataOf({ checkRepeats: true })
    expect(data.stage3).toEqual({ version: 1, parsed: 'object', reported: [], restored: ['solution'], kept: [], changedTopLevel: [] })
    expect(data.stage3_changed_ratio).toBe(0)
  })

  it('신고한 칸은 그대로 쓰고 기록에 신고 경로를 남긴다', async () => {
    h.stage3 = (copy) => ({ ...copy, summary: '바꾼 요약', _changed_fields: ['summary'] })
    const data = await dataOf({ checkRepeats: true })
    expect(data.stage3).toMatchObject({ reported: ['summary'], restored: [], changedTopLevel: ['summary'] })
    expect(data.stage3_changed_ratio).toBeGreaterThan(0)
  })

  it('콜 실패는 parsed failed·비율 없음(Stage 2 그대로)', async () => {
    h.stage3 = null
    const failed = await dataOf({ checkRepeats: true, rhythm: true })
    expect(failed.stage3).toEqual({ version: 1, parsed: 'failed', reported: null, restored: [], kept: [], changedTopLevel: [], fixInCriteria: true })
    expect(failed.stage3_changed_ratio).toBeUndefined()
  })
})
