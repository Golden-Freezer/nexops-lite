import { describe, expect, it } from 'vitest'
import {
  failureOf,
  NEW_STAGE_AGENT_NAMES,
  NEW_STAGE_RESULT_KEYS,
  NEW_STAGE_ROUTE_NAMES,
  parseStrictJsonObject,
  runNewStageCall,
  skippedRecord,
} from './common'
import { fakeDeps, TEST_OPTIONS } from './new-stages.fixture'

describe('parseStrictJsonObject — 빈 답·잘림·형식 오류는 던진다', () => {
  it('JSON 객체 하나를 읽는다(코드 울타리는 벗긴다)', () => {
    expect(parseStrictJsonObject('{"a":1}')).toEqual({ a: 1 })
    expect(parseStrictJsonObject('```json\n{"a":[1,2]}\n```')).toEqual({ a: [1, 2] })
    expect(parseStrictJsonObject('  {"a":"x}y"}  ')).toEqual({ a: 'x}y' })
  })

  it('문자열 안 날 줄바꿈은 한 번 고쳐 읽는다', () => {
    expect(parseStrictJsonObject('{"a":"첫 줄\n둘째 줄"}')).toEqual({ a: '첫 줄\n둘째 줄' })
  })

  it.each([
    ['', '[빈 답]'],
    ['   \n ', '[빈 답]'],
    ['```json\n```', '[빈 답]'],
  ])('빈 답 %j', (text, tag) => {
    expect(() => parseStrictJsonObject(text)).toThrow(tag)
  })

  it.each([
    ['{"items":[{"id":"a"'],
    ['{"a":"끝나지 않은 글'],
    ['```json\n{"a":{"b":1}'],
  ])('잘린 답 %j', (text) => {
    expect(() => parseStrictJsonObject(text)).toThrow('[잘림]')
  })

  it.each([
    ['좋습니다. {"a":1}'],
    ['{"a":1} 이상입니다'],
    ['[{"a":1}]'],
    ['{"a":1,}'],
    ['{"a":1}}'],
    ['null'],
  ])('형식 오류 %j(앞뒤 글을 버리지 않는다)', (text) => {
    expect(() => parseStrictJsonObject(text)).toThrow('[형식 오류]')
  })
})

describe('failureOf — 실패 종류', () => {
  it('stop_reason max_tokens·잘림 표지는 truncated', () => {
    expect(failureOf({ message: 'x', stage: 'parse', attempts: 1, stopReason: 'max_tokens' }).kind).toBe('truncated')
    expect(failureOf({ message: '[잘림] 괄호', stage: 'parse', attempts: 1 }).kind).toBe('truncated')
  })

  it('빈 답(파서 표지·공급자 잘림 감지 글)은 empty', () => {
    expect(failureOf({ message: '[빈 답] 빈 답입니다', stage: 'parse', attempts: 1 }).kind).toBe('empty')
    expect(failureOf({ message: '빈 응답입니다(stop_reason end_turn)', stage: 'parse', attempts: 1 }).kind).toBe('empty')
  })

  it('그 밖의 파싱 실패는 format, API·시간·예산은 그대로', () => {
    expect(failureOf({ message: '[형식 오류] $.a', stage: 'parse', attempts: 1 }).kind).toBe('format')
    expect(failureOf({ message: 'Unexpected token', stage: 'parse', attempts: 1 }).kind).toBe('format')
    expect(failureOf({ message: '500', stage: 'api', attempts: 2 }).kind).toBe('api')
    expect(failureOf({ message: 't', stage: 'timeout', attempts: 1 }).kind).toBe('timeout')
    expect(failureOf({ message: 'b', stage: 'budget', attempts: 0 }).kind).toBe('budget')
  })
})

describe('runNewStageCall — route 이름으로 풀고 기록 모양을 돌려준다', () => {
  const spec = {
    stage: 'factAudit' as const,
    system: 'SYS',
    content: 'USER',
    parse: (text: string) => parseStrictJsonObject(text),
    check: (o: Record<string, unknown>) => (o.bad ? ['나쁨'] : []),
  }

  it('route는 이름으로 받고 기록에는 풀린 값을 적는다(모델을 박지 않는다)', async () => {
    const { deps, calls, routeNames } = fakeDeps({ text: '{"bad":true}', cost: 0.031 })
    const record = await runNewStageCall(spec, deps, { ...TEST_OPTIONS, deadlineAt: 123, runContext: { stage: 'copywriting' } })
    expect(routeNames).toEqual(['copy/fact-audit'])
    expect(calls[0].route.model).toBe('test-model-for-copy/fact-audit')
    expect(calls[0].request).toMatchObject({
      system: 'SYS',
      messages: [{ role: 'user', content: 'USER' }],
      agentName: 'registration/pdp-fact-audit',
      timeoutMs: 60_000,
      maxRetries: 1,
      deadlineAt: 123,
      runContext: { stage: 'copywriting' },
    })
    expect(record).toEqual({
      version: 1,
      stage: 'factAudit',
      status: 'done',
      route: { name: 'copy/fact-audit', model: 'test-model-for-copy/fact-audit', effort: 'high', maxTokens: 1234, backend: 'api' },
      result: { bad: true },
      warnings: ['나쁨'],
      costUsd: 0.031,
      durationMs: 7,
    })
  })

  it('기한이 없으면 deadlineAt을 보내지 않는다', async () => {
    const { deps, calls } = fakeDeps({ text: '{}' })
    await runNewStageCall(spec, deps, TEST_OPTIONS)
    expect('deadlineAt' in calls[0].request).toBe(false)
    expect('runContext' in calls[0].request).toBe(false)
  })

  it.each([
    [{ text: '{"items":[' }, 'truncated'],
    [{ text: '' }, 'empty'],
    [{ text: '답: {}' }, 'format'],
    [{ text: '{}', error: { message: 'overloaded', stage: 'api' as const, attempts: 2 } }, 'api'],
  ])('실패는 조용히 통과하지 않고 failed로 기록한다 %#', async (reply, kind) => {
    const { deps } = fakeDeps(reply)
    const record = await runNewStageCall(spec, deps, TEST_OPTIONS)
    expect(record.status).toBe('failed')
    if (record.status !== 'failed') return
    expect(record.failure.kind).toBe(kind)
    expect(record.costUsd).toBe(0.02)
    expect('result' in record).toBe(false)
  })

  it('표에 없는 이름이면 부르는 쪽 routeOf가 던진 것을 그대로 던진다', async () => {
    const { deps } = fakeDeps({ text: '{}' })
    const throwing = { ...deps, routeOf: () => { throw new Error('표에 없는 route') } }
    await expect(runNewStageCall(spec, throwing, TEST_OPTIONS)).rejects.toThrow('표에 없는 route')
  })
})

describe('이름·키', () => {
  it('route 이름·사용량 주체·결과 키가 단계마다 하나씩 겹치지 않는다', () => {
    expect(new Set(Object.values(NEW_STAGE_ROUTE_NAMES)).size).toBe(5)
    expect(new Set(Object.values(NEW_STAGE_AGENT_NAMES)).size).toBe(5)
    const keys = Object.values(NEW_STAGE_RESULT_KEYS).map((k) => `${k.column}.${k.key}`)
    expect(new Set(keys).size).toBe(keys.length)
    expect(keys).toEqual([
      'research_result.page_plan',
      'copy_sections.fact_audit',
      'section_plan.kslot_fact_audit',
      'design_prompts.director',
      'section_plan.first_screen',
      'section_plan.final_review',
    ])
  })

  it('생략 기록은 사유만 남긴다', () => {
    expect(skippedRecord('firstScreen', 'cost_cap')).toEqual({ version: 1, stage: 'firstScreen', status: 'skipped', reason: 'cost_cap' })
  })
})
