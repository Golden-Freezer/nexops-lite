/**
 * 식별 카드 사진 역할 한 줄(photoroles 잡, 결정 카드 c12·J20) — roleLine을 받으면 세 프롬프트의 Rules 줄 앞에 끼우고, 없으면 글자까지 지금 그대로.
 * LLM은 모의(유료 호출 0).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  calls: [] as Array<{ options: { messages: Array<{ content: Array<{ type: string; text?: string }> }> } }>,
}))

vi.mock('../llm', () => ({
  callLlm: vi.fn(async (_route: unknown, options: never, parser: (t: string) => unknown) => {
    h.calls.push({ options })
    return { success: true, data: parser('Pouch, 2 cords UNCERTAIN: none'), usage: { cost: 0.002 } }
  }),
}))

import { readIdentityCard } from './pdp-image-agent'
import {
  buildIdentityCardAllPhotosPrompt,
  buildIdentityCardMultiPrompt,
  IDENTITY_CARD_PROMPT,
  IDENTITY_USE_RULE,
  withIdentityRoles,
  withIdentityStates,
  withIdentityUse,
} from './prompts/pdp-image-gate-prompts'

const photo = (data: string) => ({ data, mediaType: 'image/png' as const })
const promptOf = (i: number) => h.calls[i].options.messages[0].content.at(-1)?.text
const LINE = 'Photo roles: photo 2 shows the same product in another purchase option (a different color, pattern or set).'

beforeEach(() => {
  h.calls = []
})

describe('withIdentityRoles', () => {
  it('Rules 줄 바로 앞에 한 번 끼우고 앞뒤 글은 그대로다 — 세 프롬프트 모두', () => {
    for (const base of [IDENTITY_CARD_PROMPT, buildIdentityCardAllPhotosPrompt(3), buildIdentityCardMultiPrompt(2)]) {
      const at = base.indexOf('\nRules:')
      expect(withIdentityRoles(base, LINE)).toBe(`${base.slice(0, at)}\n${LINE}${base.slice(at)}`)
    }
  })

  it('Rules 줄이 없으면 끝에 붙이고, 빈 줄이면 그대로다', () => {
    expect(withIdentityRoles('Describe it.', LINE)).toBe(`Describe it.\n${LINE}`)
    expect(withIdentityRoles(IDENTITY_CARD_PROMPT, '  ')).toBe(IDENTITY_CARD_PROMPT)
  })
})

describe('readIdentityCard — roleLine', () => {
  it('전 사진 + states + roleLine: 상태 문장 뒤 역할 줄이 든 프롬프트, 카드·UNCERTAIN 처리는 그대로', async () => {
    const out = await readIdentityCard(photo('A'), undefined, [photo('B')], { allPhotos: true, states: true, roleLine: LINE })
    expect(promptOf(0)).toBe(withIdentityRoles(withIdentityStates(buildIdentityCardAllPhotosPrompt(2)), LINE))
    expect(out.card).toBe("PRODUCT IDENTITY (read from the user's 2 reference photos — the generated product must match every detail below): Pouch, 2 cords")
    expect(out.uncertain).toBeUndefined()
  })

  it('인쇄물 여러 장도 역할 줄을 받는다', async () => {
    await readIdentityCard(photo('A'), undefined, [photo('B')], { roleLine: LINE })
    expect(promptOf(0)).toBe(withIdentityRoles(buildIdentityCardMultiPrompt(2), LINE))
  })

  it('roleLine이 없으면 지금 프롬프트와 글자까지 같다', async () => {
    await readIdentityCard(photo('A'))
    await readIdentityCard(photo('A'), undefined, [photo('B')], { allPhotos: true, states: true })
    expect(promptOf(0)).toBe(IDENTITY_CARD_PROMPT)
    expect(promptOf(1)).toBe(withIdentityStates(buildIdentityCardAllPhotosPrompt(2)))
  })

  it('역할 줄과 쓰는 법 USE 줄(J18 usefacts)을 함께 받으면 역할 줄은 Rules 앞, USE 요청은 끝맺음 자리 — 둘 다 한 번씩', async () => {
    await readIdentityCard(photo('A'), undefined, [photo('B')], { allPhotos: true, states: true, roleLine: LINE, use: true })
    const prompt = promptOf(0)!
    expect(prompt).toBe(withIdentityUse(withIdentityRoles(withIdentityStates(buildIdentityCardAllPhotosPrompt(2)), LINE)))
    expect(prompt.split(LINE)).toHaveLength(2)
    expect(prompt.split(IDENTITY_USE_RULE)).toHaveLength(2)
    expect(prompt.indexOf(LINE)).toBeLessThan(prompt.indexOf('\nRules:'))
    expect(prompt.indexOf('\nRules:')).toBeLessThan(prompt.indexOf(IDENTITY_USE_RULE))
  })
})
