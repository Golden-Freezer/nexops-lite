/**
 * 사실 감사 나눠 부르기·잘림·비용(하네스 R11b) — R11 P05 K10-NS 잡 fb4b19b4(20섹션·33컷)에서 사실 감사 한 콜이 상한 16,000에서 잘렸고,
 * 같은 상한·같은 입력으로 다시 불러 또 잘렸으며(두 콜 0.367달러), 그 값이 단계 costUsd·잡 cost_usd에 0으로 남았다.
 * 고친 것: 화면 글을 40줄·1,500자 묶음으로 나눠 동시에 부른다(R11c에서 줄 기준 더함) · 잘린 답은 다시 부르지 않는다 · 실패·잘린 시도 값도 기록에 남긴다. 가짜 콜(유료 0)
 */

import { describe, expect, it } from 'vitest'
import type { LlmRequest, LlmRoute } from '@/lib/agents/llm/types'
import { SDK_NON_STREAMING_MAX_TOKENS } from '@/lib/agents/_base'
import type { AgentOutput } from '@/lib/agents/types'
import { PDP_NEW_BATCH_STAGE_DEADLINE_MS, PDP_NEW_STAGE_ROUTES } from '../pdp-model-routes'
import { runNewStageCall, type CallLlmFn, type NewStageDeps } from './common'
import { buildFactAuditPrompt, FACT_AUDIT_LINE_CHARS_PER_CALL, FACT_AUDIT_LINES_PER_CALL, factAuditChunks, runFactAudit, type FactAuditInput } from './fact-audit'
import { fakeDeps, TEST_OPTIONS, userText } from './new-stages.fixture'
import type { ScreenLine } from './screen-lines'

const SOURCES = { spec: '{"productName":"식물 클립","count":"300개"}', analysis: '{"detected_category":"household"}', research: '{}' }
/** n줄 × 줄마다 chars자 — id는 0.s<i>.body */
const linesOf = (n: number, chars: number): ScreenLine[] => Array.from({ length: n }, (_, i) => ({ id: `${i}.s${i}.body`, text: `${i}`.padEnd(chars, '가') }))
const inputOf = (lines: ScreenLine[]): FactAuditInput => ({ ...SOURCES, lines })

/** 받은 줄마다 supported 항목 하나 — 묶음이 무엇을 받았는지 답에서 되읽는다 */
function auditReply(prompt: string): string {
  const ids = [...prompt.matchAll(/^- (\d+\.s\d+\.body): /gm)].map((m) => m[1])
  return JSON.stringify({
    items: ids.map((id) => ({ id, claim: '300개', verdict: 'supported', evidence: '"count":"300개"', fix: '', regulated: false })),
    summary: { checked: ids.length, unsupported: 0, regulated: 0 },
  })
}

/** 동시에 불리는지 보는 가짜 콜 — 모든 콜이 들어온 뒤에야 답한다(차례로 부르면 첫 콜이 끝나지 않아 시험이 멈춘다) */
function concurrentDeps(expected: number, replyOf: (index: number, prompt: string) => Partial<AgentOutput<unknown>> & { text?: string }) {
  const requests: LlmRequest[] = []
  let release: () => void = () => {}
  const allIn = new Promise<void>((resolve) => (release = resolve))
  const callLlm: CallLlmFn = async <T,>(_route: LlmRoute, request: LlmRequest, parser: (text: string) => T): Promise<AgentOutput<T>> => {
    const index = requests.push(request) - 1
    if (requests.length === expected) release()
    await allIn
    const prompt = String(request.messages[0].content)
    const reply = replyOf(index, prompt)
    const usage = reply.usage ?? { inputTokens: 100, outputTokens: 50, cost: 0.02 }
    if (reply.success === false && 'error' in reply) return { success: false, error: reply.error!, usage, duration: reply.duration ?? 10, ...(reply.spent ? { spent: reply.spent } : {}) }
    return { success: true, data: parser(reply.text ?? auditReply(prompt)), usage, duration: reply.duration ?? 10 * (index + 1) }
  }
  const deps: NewStageDeps = { routeOf: (name) => ({ model: `test-${name}`, maxTokens: 1234, effort: 'high' }), callLlm }
  return { deps, requests }
}

describe('factAuditChunks — 화면 글을 줄 수가 고른 묶음으로(40줄·1,500자 상한)', () => {
  it(`${FACT_AUDIT_LINES_PER_CALL}줄·${FACT_AUDIT_LINE_CHARS_PER_CALL}자 이하는 한 묶음(지금과 같다)`, () => {
    expect(factAuditChunks(linesOf(15, 100))).toEqual([linesOf(15, 100)])
    expect(factAuditChunks(linesOf(FACT_AUDIT_LINES_PER_CALL, 30))).toEqual([linesOf(FACT_AUDIT_LINES_PER_CALL, 30)])
  })

  it('짧은 줄이 많은 페이지(R11 P07 모양 — 1,500자 이하인데 줄이 많다)는 줄 기준으로 나눈다 — 묶음마다 목표 ⌈줄 ÷ k⌉줄', () => {
    const lines = linesOf(121, 12) // 1,452자 — R11b 글자 기준으로는 한 콜이었다. k = ⌈121 ÷ 40⌉ = 4, 목표 31줄
    const chunks = factAuditChunks(lines)
    expect(chunks.map((chunk) => chunk.length)).toEqual([31, 31, 31, 28])
    expect(chunks.flat()).toEqual(lines)
  })

  it('긴 줄이 몰린 곳은 글자 상한에서 끊어 묶음이 늘어난다 — 묶음마다 40줄·1,500자 이하', () => {
    const lines = [...linesOf(10, 400), ...linesOf(30, 10)] // 4,300자·40줄 → k = 3, 목표 14줄 — 앞쪽 긴 줄은 3줄(1,200자)마다 끊긴다
    const chunks = factAuditChunks(lines)
    expect(chunks.map((chunk) => chunk.length)).toEqual([3, 3, 3, 14, 14, 3])
    expect(chunks.flat()).toEqual(lines)
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(FACT_AUDIT_LINES_PER_CALL)
      expect(chunk.reduce((sum, l) => sum + l.text.length, 0)).toBeLessThanOrEqual(FACT_AUDIT_LINE_CHARS_PER_CALL)
    }
  })

  it('넘으면 ⌈전체 ÷ 상한⌉ 묶음 — 순서·줄 그대로, 빈 묶음 없음, 묶음마다 상한 + 줄 하나 이하', () => {
    const lines = linesOf(40, 100) // 4,000자 → 3묶음
    const chunks = factAuditChunks(lines)
    expect(chunks).toHaveLength(3)
    expect(chunks.flat()).toEqual(lines)
    for (const chunk of chunks) {
      expect(chunk.length).toBeGreaterThan(0)
      expect(chunk.reduce((sum, l) => sum + l.text.length, 0)).toBeLessThanOrEqual(FACT_AUDIT_LINE_CHARS_PER_CALL + 100)
    }
  })

  it('묶음 수는 줄 수를 넘지 않는다 — 긴 줄은 쪼개지 않는다', () => {
    const lines = linesOf(2, 2_500)
    expect(factAuditChunks(lines)).toEqual([[lines[0]], [lines[1]]])
  })
})

describe('runFactAudit — 나눠 부르기', () => {
  it('짧은 화면 글은 콜 하나·프롬프트 바이트 그대로, calls 칸 없음, 잘린 답을 다시 부르지 않게 보낸다', async () => {
    const input = inputOf(linesOf(10, 50))
    const { deps, calls } = fakeDeps({ text: auditReply(buildFactAuditPrompt(input)) })
    const record = await runFactAudit(input, deps, TEST_OPTIONS)
    expect(calls).toHaveLength(1)
    expect(userText(calls[0])).toBe(buildFactAuditPrompt(input))
    expect(calls[0].request.retryTruncated).toBe(false)
    expect(record.status).toBe('done')
    expect(record).not.toHaveProperty('calls')
  })

  it(`경계 — ${FACT_AUDIT_LINES_PER_CALL}줄·1,480자는 콜 하나·프롬프트 바이트 그대로, 한 줄 더(${FACT_AUDIT_LINES_PER_CALL + 1}줄)는 줄 기준으로 둘(R11c)`, async () => {
    const input = inputOf(linesOf(FACT_AUDIT_LINES_PER_CALL, 37))
    const { deps, calls } = fakeDeps({ text: auditReply(buildFactAuditPrompt(input)) })
    expect(await runFactAudit(input, deps, TEST_OPTIONS)).toMatchObject({ status: 'done' })
    expect(calls).toHaveLength(1)
    expect(userText(calls[0])).toBe(buildFactAuditPrompt(input))

    const over = inputOf(linesOf(FACT_AUDIT_LINES_PER_CALL + 1, 12)) // 492자 — 글자 기준으로는 한 콜
    const two = concurrentDeps(2, () => ({}))
    expect(await runFactAudit(over, two.deps, TEST_OPTIONS)).toMatchObject({ status: 'done', calls: 2 })
    expect(two.requests.map((request) => request.messages[0].content)).toEqual(factAuditChunks(over.lines).map((lines) => buildFactAuditPrompt({ ...over, lines })))
  })

  it('긴 화면 글은 묶음마다 같은 프롬프트(줄만 그 묶음)로 동시에 부르고 항목·요약·비용을 합친다 — 시간은 가장 긴 콜', async () => {
    const input = inputOf(linesOf(40, 100))
    const { deps, requests } = concurrentDeps(3, () => ({}))
    const record = await runFactAudit(input, deps, TEST_OPTIONS)
    expect(requests).toHaveLength(3)
    const chunks = factAuditChunks(input.lines)
    requests.forEach((request, i) => expect(request.messages[0].content).toBe(buildFactAuditPrompt({ ...input, lines: chunks[i] })))
    expect(record).toMatchObject({ status: 'done', calls: 3, durationMs: 30 })
    if (record.status !== 'done') return
    expect(record.costUsd).toBeCloseTo(0.06, 10)
    expect(record.result.items.map((item) => item.id)).toEqual(input.lines.map((l) => l.id))
    expect(record.result.summary).toEqual({ checked: 40, unsupported: 0, regulated: 0 })
    expect(record.warnings).toEqual([])
  })

  it('합친 감사의 경고는 전체 입력으로 낸다 — 다른 묶음에 보낸 줄 id도 보낸 줄이다', async () => {
    const input = inputOf(linesOf(40, 100))
    const { deps } = concurrentDeps(3, (index, prompt) =>
      index === 1 ? { text: JSON.stringify({ items: [{ id: '0.s0.body', claim: '500개', verdict: 'unsupported', evidence: '', fix: '', regulated: false }], summary: { checked: 1, unsupported: 1, regulated: 0 } }) } : { text: auditReply(prompt) },
    )
    const record = await runFactAudit(input, deps, TEST_OPTIONS)
    expect(record.status).toBe('done')
    if (record.status === 'done') expect(record.warnings).toEqual(['사실 감사: 입력에 없는 주장 1줄(0.s0.body)'])
  })

  it('한 묶음이 잘리면 실패(종류 truncated·몇째 묶음) — 비용은 잘린 콜(spent)과 끝난 콜을 모두 더한다', async () => {
    const input = inputOf(linesOf(40, 100))
    const truncated = { message: '응답이 출력 상한에서 잘렸습니다(stop_reason max_tokens)', stage: 'parse' as const, attempts: 1, stopReason: 'max_tokens' }
    const { deps } = concurrentDeps(3, (index) =>
      index === 1 ? { success: false, error: truncated, usage: { inputTokens: 0, outputTokens: 0, cost: 0 }, spent: { inputTokens: 11_785, outputTokens: 16_000, cost: 0.1836 }, duration: 104_000 } : {},
    )
    const record = await runFactAudit(input, deps, TEST_OPTIONS)
    expect(record).toMatchObject({ status: 'failed', calls: 3, durationMs: 104_000, failure: { kind: 'truncated' } })
    if (record.status !== 'failed') return
    expect(record.failure.message).toMatch(/^나눔 2\/3: /)
    expect(record.costUsd).toBeCloseTo(0.1836 + 0.02 + 0.02, 10)
  })
})

describe('runNewStageCall — 잘린 답·비용', () => {
  it('실패 콜도 과금된 값(spent)을 기록한다 — fb4b19b4는 잘린 두 콜이 0으로 남았다', async () => {
    const callLlm: CallLlmFn = async () => ({
      success: false,
      error: { message: '응답이 출력 상한에서 잘렸습니다(stop_reason max_tokens)', stage: 'parse', attempts: 1, stopReason: 'max_tokens' },
      usage: { inputTokens: 0, outputTokens: 0, cost: 0 },
      spent: { inputTokens: 11_785, outputTokens: 16_000, cost: 0.1836 },
      duration: 104_000,
    })
    const record = await runNewStageCall(
      { stage: 'factAudit', system: 's', content: 'c', parse: (t) => t, check: () => [] },
      { routeOf: () => ({ model: 'm', maxTokens: 1 }), callLlm },
      TEST_OPTIONS,
    )
    expect(record).toMatchObject({ status: 'failed', costUsd: 0.1836, failure: { kind: 'truncated' } })
  })

  it('성공 콜의 spent(앞선 실패 시도 포함)가 있으면 그것, 없으면 usage', async () => {
    const out = (spent?: number): CallLlmFn => async <T,>(_r: LlmRoute, _q: LlmRequest, parser: (text: string) => T) => ({
      success: true as const,
      data: parser('x'),
      usage: { inputTokens: 1, outputTokens: 1, cost: 0.05 },
      duration: 1,
      ...(spent !== undefined ? { spent: { inputTokens: 2, outputTokens: 2, cost: spent } } : {}),
    })
    const run = (callLlm: CallLlmFn) =>
      runNewStageCall({ stage: 'director', system: 's', content: 'c', parse: (t) => t, check: () => [] }, { routeOf: () => ({ model: 'm', maxTokens: 1 }), callLlm }, TEST_OPTIONS)
    expect(await run(out(0.12))).toMatchObject({ status: 'done', costUsd: 0.12 })
    expect(await run(out())).toMatchObject({ status: 'done', costUsd: 0.05 })
  })
})

describe('긴 상품 시간·상한 근거(실측 값으로 고정)', () => {
  /** C 4차 P05 Sonnet 5.5 xhigh: 화면 글 1,501자 → 출력 8,629토큰(생각 포함)·58.5초 */
  const C4 = { chars: 1501, outTokens: 8629, seconds: 58.5 }
  /** C 4차 Sonnet 5.5 xhigh 줄 수·출력 토큰 — P05 56줄 → 8,629, P07 52줄 → 6,465(줄당 154·124) */
  const C4_LINES = [
    { lines: 56, outTokens: 8629 },
    { lines: 52, outTokens: 6465 },
  ]
  /** R11 운영 P07 K11-NS 잡 7d9ee39a(a5af0a41) ai_usage_log — 사실 감사 둘 다 한 콜(R11b 1,500자 기준에 안 걸림) */
  const P07 = { copyOutTokens: 16_519, slotsOutTokens: 19_120 }
  /**
   * R11d부터 사실 감사는 Opus 5.5 xhigh — 같은 모델·등급 실측 속도(fb4b19b4 ai_usage_log 기획 research/page-plan 11,357토큰/106초,
   * 초당 약 107토큰)로 콜 시간을 본다. Sonnet(C 4차 초당 약 148토큰)보다 느리다
   */
  const OPUS_XHIGH = { outTokens: 11_357, seconds: 106 }
  const tokensPerChar = C4.outTokens / C4.chars
  const tokensPerSecond = OPUS_XHIGH.outTokens / OPUS_XHIGH.seconds
  const route = PDP_NEW_STAGE_ROUTES['copy/fact-audit']

  it('사실 감사 route는 Opus 5.5 xhigh(오너 2026-11-09 13:2x) — 상한 20,000·잘림 감지·재시도 1 그대로, 기획과 같은 모델·등급', () => {
    expect(route).toMatchObject({ model: 'claude-opus-5-5', effort: 'xhigh', maxTokens: 20_000, failOnTruncation: true, callMaxRetries: 1 })
    expect(PDP_NEW_STAGE_ROUTES['research/page-plan']).toMatchObject({ model: route.model, effort: route.effort })
    expect(C4.outTokens / C4.seconds).toBeGreaterThan(tokensPerSecond)
  })

  it('묶음 하나의 예상 출력은 상한의 절반 아래다(여유 2배 이상) — 글자 기준(C 4차 글자당)·줄 기준(줄당 250토큰 = C 4차 최고의 1.6배 이상)', () => {
    expect(FACT_AUDIT_LINE_CHARS_PER_CALL * tokensPerChar).toBeLessThan(route.maxTokens / 2)
    const perLineMax = Math.max(...C4_LINES.map(({ lines, outTokens }) => outTokens / lines))
    expect(perLineMax * 1.6).toBeLessThanOrEqual(250)
    expect(FACT_AUDIT_LINES_PER_CALL * 250).toBeLessThanOrEqual(route.maxTokens / 2)
  })

  it('P07 7d9ee39a 증거 — 1,500자 이하 한 콜이 상한에 붙었고(K 칸 > 95%), 카피 뒤도 글자 기준 예상의 1.9배를 넘었다 → 글자 기준만으로는 모자라 줄 기준을 더했다', () => {
    expect(P07.slotsOutTokens / route.maxTokens).toBeGreaterThan(0.95)
    expect(P07.copyOutTokens / FACT_AUDIT_LINE_CHARS_PER_CALL).toBeGreaterThan(tokensPerChar * 1.9)
  })

  it('상한까지 써도 콜 시간 안이고(Opus xhigh 속도면 약 187초 < 200초), 비스트리밍 경계 안이며, 콜 시간 + 저장 여유가 run 기한(280초) 안이다 — 묶음은 동시에 돈다', () => {
    expect(route.maxTokens).toBeLessThanOrEqual(SDK_NON_STREAMING_MAX_TOKENS)
    expect((route.maxTokens / tokensPerSecond) * 1000).toBeLessThan(route.callTimeoutMs)
    expect(route.callTimeoutMs + 20_000).toBeLessThanOrEqual(PDP_NEW_BATCH_STAGE_DEADLINE_MS)
  })

  it('다른 새 단계 — fb4b19b4 실측 출력이 상한의 2/3 아래, 상한까지 써도 콜 시간 안(같은 속도), 비스트리밍 경계 안', () => {
    /** fb4b19b4 ai_usage_log: 출력 토큰·초 */
    const measured = {
      'research/page-plan': { out: 11_357, seconds: 106 },
      'images/director': { out: 4_346, seconds: 39 },
      'compose/final-review': { out: 5_267, seconds: 47 },
    } as const
    for (const [name, { out, seconds }] of Object.entries(measured) as Array<[keyof typeof measured, { out: number; seconds: number }]>) {
      const r = PDP_NEW_STAGE_ROUTES[name]
      expect(out, name).toBeLessThan((r.maxTokens * 2) / 3)
      expect((r.maxTokens / (out / seconds)) * 1000, name).toBeLessThan(r.callTimeoutMs)
      expect(r.maxTokens, name).toBeLessThanOrEqual(SDK_NON_STREAMING_MAX_TOKENS)
    }
  })
})
