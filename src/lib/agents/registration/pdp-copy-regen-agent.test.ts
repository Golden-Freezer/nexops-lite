/**
 * 편집기 카피 재생성 1콜(pdp-copy-regen-api) — 응답 파싱(text·alt1·alt2 문자열만)과 실패 전달(사유·단계·공급자가 알려 준 비용).
 * 라우트 배선(모델·상한·thinking·temperature 없음·runContext)은 pdp-model-routing.test.ts가 고정한다. 공급자는 모의(유료 호출 0).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ result: null as unknown, options: null as Record<string, unknown> | null }))

vi.mock('../_base', () => ({
  callAgent: async (options: Record<string, unknown>, parser: (t: string) => unknown) => {
    h.options = options
    const r = h.result as { text?: string; fail?: { message: string; stage: string; cost: number } }
    if (r.fail) {
      return {
        success: false,
        error: { message: r.fail.message, stage: r.fail.stage, attempts: 2 },
        usage: { inputTokens: 10, outputTokens: 5, cost: r.fail.cost },
        duration: 0,
      }
    }
    try {
      return {
        success: true,
        data: parser(r.text ?? ''),
        usage: { inputTokens: 10, outputTokens: 5, cost: 0.006 },
        duration: 0,
      }
    } catch (error) {
      // 실제 callAgent(_base.ts)처럼 모든 시도가 실패하면 사용량 0을 돌려준다(시도별 비용은 ai_usage_log에만)
      return {
        success: false,
        error: { message: (error as Error).message, stage: 'parse', attempts: 2 },
        usage: { inputTokens: 0, outputTokens: 0, cost: 0 },
        duration: 0,
      }
    }
  },
}))

import { callCopyRegenModel, COPY_REGEN_AGENT, parseCopyRegenResponse } from './pdp-copy-regen-agent'

beforeEach(() => {
  h.result = null
  h.options = null
})

describe('parseCopyRegenResponse', () => {
  it('text·alt1·alt2 순서로 비지 않은 문자열만 꺼낸다(코드 블록·배열 감싸기도 읽는다)', () => {
    expect(parseCopyRegenResponse('{"text":"메인","alt1":"대안 1","alt2":"대안 2"}')).toEqual([
      '메인',
      '대안 1',
      '대안 2',
    ])
    expect(parseCopyRegenResponse('```json\n{"alt2":"둘","text":"하나","alt1":""}\n```')).toEqual(['하나', '둘'])
    expect(parseCopyRegenResponse('[{"text":"첫\\n줄","alt1":3}]')).toEqual(['첫\n줄'])
  })

  it('객체가 아니거나 문자열 후보가 없으면 null', () => {
    expect(parseCopyRegenResponse('카피입니다')).toBeNull()
    expect(parseCopyRegenResponse('{"text":"  ","alt1":null}')).toBeNull()
    expect(parseCopyRegenResponse('{"main":"메인"}')).toBeNull()
  })
})

describe('callCopyRegenModel', () => {
  it('후보와 든 비용을 돌려주고, 시스템·사용자 프롬프트와 에이전트 이름·재시도 1회로 부른다', async () => {
    h.result = { text: '{"text":"메인","alt1":"대안"}' }
    const run = { userId: 'user-1', stage: 'editor-copy-regen' }
    expect(await callCopyRegenModel({ system: 'SYS', user: 'USR' }, run)).toEqual({
      ok: true,
      candidates: ['메인', '대안'],
      costUsd: 0.006,
    })
    expect(h.options).toMatchObject({
      agentName: COPY_REGEN_AGENT,
      system: 'SYS',
      messages: [{ role: 'user', content: 'USR' }],
      maxRetries: 1,
      runContext: run,
    })
  })

  it('파싱 실패·호출 실패는 사유·단계와 공급자가 알려 준 비용(실패면 0)으로 돌려준다', async () => {
    h.result = { text: '설명만 있는 응답' }
    expect(await callCopyRegenModel({ system: 's', user: 'u' })).toEqual({
      ok: false,
      error: '카피 재생성 응답을 JSON으로 읽지 못했습니다',
      stage: 'parse',
      costUsd: 0,
    })
    h.result = { fail: { message: '월 AI 예산 한도', stage: 'budget', cost: 0 } }
    expect(await callCopyRegenModel({ system: 's', user: 'u' })).toEqual({
      ok: false,
      error: '월 AI 예산 한도',
      stage: 'budget',
      costUsd: 0,
    })
  })
})
