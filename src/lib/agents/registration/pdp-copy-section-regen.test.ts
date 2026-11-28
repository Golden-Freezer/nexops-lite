/**
 * D 카피 재생성 걸린 섹션 1콜(J27) — 프롬프트(지시·고칠 섹션·참고 섹션·단계 말미 블록), route = copy/stage3, 답은 고칠 섹션 키·같은 모양만. callLlm은 모의(유료 0).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LlmRoute } from '../llm/types'
import type { CopywritingResult } from '@/lib/registration/pdp-state'

const h = vi.hoisted(() => ({ calls: [] as Array<{ route: LlmRoute; request: Record<string, unknown> }>, reply: '' as string, fail: false }))

vi.mock('../llm', () => ({
  callLlm: async (route: LlmRoute, request: Record<string, unknown>, parser: (t: string) => unknown) => {
    h.calls.push({ route, request })
    if (h.fail) return { success: false, error: { message: '시간 초과', stage: 'timeout', attempts: 1 }, usage: { inputTokens: 0, outputTokens: 0, cost: 0.01 }, duration: 0 }
    return { success: true, data: parser(h.reply), usage: { inputTokens: 100, outputTokens: 50, cost: 0.02 }, duration: 0 }
  },
}))

import { pdpRoute } from '@/lib/registration/pdp-model-routes'
import { buildCopySectionRegenPrompt, regenerateCopySections, sameSectionShape } from './pdp-copy-section-regen'

const FINAL = {
  mainIntro: { hook: '48시간 보온', benefitHeadline: '하루 종일 따뜻' },
  pointCards: [{ title: 'A', description: '가' }, { title: 'B', description: '나' }],
  summary: '요약 글',
} as unknown as CopywritingResult

beforeEach(() => {
  h.calls = []
  h.fail = false
  h.reply = ''
})

describe('buildCopySectionRegenPrompt', () => {
  it('지시 → 고칠 섹션(원래 값) → 참고 섹션 → 단계 말미 블록 → 사실 값 블록 순, 고칠 섹션은 요청 키만', () => {
    const prompt = buildCopySectionRegenPrompt({ final: FINAL, sections: ['mainIntro', '없는섹션'], directive: '[숫자·단위 재작성 지시]', stageGuardBlock: '[주장 범위]', factsBlock: '[사실 값]' })
    // 머리말에도 '[고칠 섹션]'·'[참고 섹션' 글자가 있어 줄 머리(\n 뒤)로 찾는다
    const at = (s: string) => prompt.indexOf(`\n${s}`)
    expect(at('[숫자·단위 재작성 지시]')).toBeGreaterThan(0)
    expect(at('[고칠 섹션]')).toBeGreaterThan(at('[숫자·단위 재작성 지시]'))
    expect(at('[참고 섹션')).toBeGreaterThan(at('[고칠 섹션]'))
    expect(at('[주장 범위]')).toBeGreaterThan(at('[참고 섹션'))
    expect(at('[사실 값]')).toBeGreaterThan(at('[주장 범위]'))
    const fix = prompt.slice(at('[고칠 섹션]'), at('[참고 섹션'))
    expect(fix).toContain('48시간 보온')
    expect(fix).not.toContain('요약 글')
    expect(prompt).toContain('키는 [고칠 섹션]의 키(mainIntro)만')
  })

  it('같은 모양 — 배열은 같은 개수, 객체는 객체, 그 밖은 같은 타입', () => {
    expect(sameSectionShape([1, 2], [3, 4])).toBe(true)
    expect(sameSectionShape([1, 2], [3])).toBe(false)
    expect(sameSectionShape({ a: 1 }, { b: 2 })).toBe(true)
    expect(sameSectionShape({ a: 1 }, ['a'])).toBe(false)
    expect(sameSectionShape('글', '새 글')).toBe(true)
    expect(sameSectionShape('글', { a: 1 })).toBe(false)
  })
})

describe('regenerateCopySections', () => {
  it('route는 copy/stage3, 답은 고칠 섹션 키·같은 모양만 남기고 나머지는 dropped — 요청하지 않은 섹션 답은 버린다', async () => {
    h.reply = JSON.stringify({ mainIntro: { hook: '오래 따뜻', benefitHeadline: '하루 종일 따뜻' }, pointCards: [{ title: 'C', description: '다' }], summary: '바뀐 요약' })
    const out = await regenerateCopySections({ final: FINAL, sections: ['mainIntro', 'pointCards'], directive: '[지시]' })
    expect(h.calls).toHaveLength(1)
    expect(h.calls[0].route).toEqual(pdpRoute('copy/stage3'))
    expect(h.calls[0].request.agentName).toBe('registration/pdp-copy-section-regen')
    expect(out.success).toBe(true)
    if (!out.success) return
    expect(out.data.sections).toEqual({ mainIntro: { hook: '오래 따뜻', benefitHeadline: '하루 종일 따뜻' } })
    expect(out.data.dropped).toEqual(['pointCards'])
    expect(out.usage.cost).toBe(0.02)
  })

  it('콜 실패는 그대로 돌려준다(부르는 쪽이 이전 카피 유지)', async () => {
    h.fail = true
    const out = await regenerateCopySections({ final: FINAL, sections: ['mainIntro'], directive: '[지시]' })
    expect(out.success).toBe(false)
  })
})
