/**
 * 식별 카드 USE 줄(usefacts 잡, 결정 카드 c02·하네스 J18) — 같은 콜에 쓰는 법 한 줄을 묻고 응답에서 꺼내 카드와 따로 돌려준다.
 * 끈 잡은 프롬프트·system·응답 처리가 글자까지 지금과 같다. LLM은 모의(유료 호출 0).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  calls: [] as Array<{ options: { system: string; messages: Array<{ content: Array<{ type: string; text?: string }> }> } }>,
  reply: '',
}))

vi.mock('../llm', () => ({
  callLlm: vi.fn(async (_route: unknown, options: never, parser: (t: string) => unknown) => {
    h.calls.push({ options })
    return { success: true, data: parser(h.reply), usage: { cost: 0.002 } }
  }),
}))

import { IDENTITY_USE_MAX_CHARS, readIdentityCard, splitUseLine } from './pdp-image-agent'
import {
  buildIdentityCardAllPhotosPrompt,
  buildIdentityCardMultiPrompt,
  IDENTITY_CARD_PROMPT,
  IDENTITY_USE_ANSWER_LINE,
  IDENTITY_USE_RULE,
  withIdentityStates,
  withIdentityUse,
} from './prompts/pdp-image-gate-prompts'

const photo = (data: string) => ({ data, mediaType: 'image/png' as const })
const promptOf = (i: number) => h.calls[i].options.messages[0].content.at(-1)?.text
const ANSWER = 'Answer with the description only, no preamble.'
const ONE = "PRODUCT IDENTITY (read from the user's reference photo — the generated product must match every detail below): "
const ALL2 = "PRODUCT IDENTITY (read from the user's 2 reference photos — the generated product must match every detail below): "

beforeEach(() => {
  h.calls = []
  h.reply = ''
})

describe('withIdentityUse — 끝맺음 줄 자리에 USE 줄 요청', () => {
  it('세 프롬프트 모두 끝맺음 줄만 USE 요청 + 새 끝맺음으로 바뀌고 앞 글은 그대로다', () => {
    for (const base of [IDENTITY_CARD_PROMPT, buildIdentityCardAllPhotosPrompt(3), buildIdentityCardMultiPrompt(2), withIdentityStates(IDENTITY_CARD_PROMPT)]) {
      expect(base.endsWith(ANSWER)).toBe(true)
      const out = withIdentityUse(base)
      expect(out).toBe(`${base.slice(0, -ANSWER.length)}${IDENTITY_USE_RULE}\n${IDENTITY_USE_ANSWER_LINE}`)
      expect(out).not.toContain(ANSWER)
    }
  })

  it('끝맺음 줄이 없으면 끝에 붙인다', () => {
    expect(withIdentityUse('Describe it.')).toBe(`Describe it.\n${IDENTITY_USE_RULE}\n${IDENTITY_USE_ANSWER_LINE}`)
  })

  it('요청 — 줄 머리 USE:, 25단어, 쥐는 곳·작동면·착용 위치, 보이는 것만, 없으면 none, 설명과 따로', () => {
    expect(IDENTITY_USE_RULE).toContain("'USE: '")
    expect(IDENTITY_USE_RULE).toContain('at most 25 words')
    expect(IDENTITY_USE_RULE).toContain('which part the hand grips or holds')
    expect(IDENTITY_USE_RULE).toContain('which side, face or end does the work')
    expect(IDENTITY_USE_RULE).toContain('where it is worn or attached')
    expect(IDENTITY_USE_RULE).toContain("'USE: none'")
    expect(IDENTITY_USE_RULE).toContain('not part of the description')
  })
})

describe('splitUseLine — 응답에서 USE 줄 꺼내기', () => {
  it('USE 머리가 없으면 응답 그대로·USE 없음', () => {
    expect(splitUseLine('Round bowl, 2 compartments')).toEqual({ rest: 'Round bowl, 2 compartments', use: '' })
  })

  it('따로 된 줄 — 그 줄만 꺼내고, 줄 머리는 대소문자를 가리지 않는다', () => {
    expect(splitUseLine('Brush, wooden handle\nUSE: grip the handle, bristles face the scalp')).toEqual({
      rest: 'Brush, wooden handle',
      use: 'grip the handle, bristles face the scalp',
    })
    expect(splitUseLine('Brush\n  Use: grip the handle').use).toBe('grip the handle')
  })

  it('UNCERTAIN 앞뒤 어디에 있어도 USE 줄만 빠지고 UNCERTAIN은 남는다', () => {
    expect(splitUseLine('Bench, 4 legs UNCERTAIN: black caps\nUSE: sit on the flat top')).toEqual({ rest: 'Bench, 4 legs UNCERTAIN: black caps', use: 'sit on the flat top' })
    expect(splitUseLine('Bench, 4 legs\nUSE: sit on the flat top\nUNCERTAIN: none')).toEqual({ rest: 'Bench, 4 legs\nUNCERTAIN: none', use: 'sit on the flat top' })
  })

  it('한 줄로 붙여 쓴 응답 — 문장 부호 뒤 USE:부터 같은 줄의 UNCERTAIN 앞까지', () => {
    expect(splitUseLine('Brush, wooden handle. USE: grip the handle UNCERTAIN: none')).toEqual({ rest: 'Brush, wooden handle.\nUNCERTAIN: none', use: 'grip the handle' })
  })

  it('설명 안의 낱말 use는 머리가 아니다(문장 부호 뒤·줄 맨 앞이 아님)', () => {
    expect(splitUseLine('Brush for everyday use: soft nylon tips').use).toBe('')
  })

  it("'none'·빈 줄은 USE 없음 — 나머지는 그대로 꺼낸다", () => {
    expect(splitUseLine('Sticker sheet\nUSE: none')).toEqual({ rest: 'Sticker sheet', use: '' })
    expect(splitUseLine('Sticker sheet\nUSE: None.')).toEqual({ rest: 'Sticker sheet', use: '' })
    expect(splitUseLine('Sticker sheet\nUSE:')).toEqual({ rest: 'Sticker sheet', use: '' })
  })

  it(`길이 상한 ${IDENTITY_USE_MAX_CHARS}자 — 넘으면 자르고 '…'`, () => {
    const use = splitUseLine(`Brush\nUSE: ${'grip '.repeat(80)}`).use
    expect(use).toHaveLength(IDENTITY_USE_MAX_CHARS)
    expect(use.endsWith('…')).toBe(true)
  })
})

describe('readIdentityCard — use 켬', () => {
  it('한 장: USE 요청이 든 프롬프트·system, 카드에는 USE 줄이 없고 use로 따로 돌려준다', async () => {
    h.reply = 'Round brush, wooden handle, black bristles\nUSE: grip the wooden handle, bristles face the scalp'
    const out = await readIdentityCard(photo('A'), undefined, [], { use: true })
    expect(promptOf(0)).toBe(withIdentityUse(IDENTITY_CARD_PROMPT))
    expect(h.calls[0].options.system).toBe('You catalogue product photos for another image model. Answer with the description and the USE line only.')
    expect(out).toEqual({ card: `${ONE}Round brush, wooden handle, black bristles`, costUsd: 0.002, use: 'grip the wooden handle, bristles face the scalp' })
  })

  it('전 사진 + states: 상태 문장 뒤 USE 요청, UNCERTAIN 기록·카드·USE가 서로 섞이지 않는다', async () => {
    h.reply = 'Folding brush, heart cutout handle UNCERTAIN: black caps\nUSE: hold the heart cutout handle, bristles down'
    const out = await readIdentityCard(photo('A'), undefined, [photo('B')], { allPhotos: true, states: true, use: true })
    expect(promptOf(0)).toBe(withIdentityUse(withIdentityStates(buildIdentityCardAllPhotosPrompt(2))))
    expect(out).toEqual({ card: `${ALL2}Folding brush, heart cutout handle`, costUsd: 0.002, uncertain: 'black caps', use: 'hold the heart cutout handle, bristles down' })
  })

  it('인쇄물 여러 장도 USE 요청이 든 도안 프롬프트를 쓴다', async () => {
    h.reply = 'Sticker; Design 1: bear\nUSE: peel the backing and press flat on a box'
    const out = await readIdentityCard(photo('A'), undefined, [photo('B')], { use: true })
    expect(promptOf(0)).toBe(withIdentityUse(buildIdentityCardMultiPrompt(2)))
    expect(out.use).toBe('peel the backing and press flat on a box')
    expect(out.card).not.toContain('USE')
  })

  it("'USE: none'이면 use 칸이 없다", async () => {
    h.reply = 'Round bowl\nUSE: none'
    expect(await readIdentityCard(photo('A'), undefined, [], { use: true })).toEqual({ card: `${ONE}Round bowl`, costUsd: 0.002 })
  })
})

describe('readIdentityCard — use 끔(지금 그대로)', () => {
  it('프롬프트·system이 글자까지 같고, 응답에 USE:가 있어도 나누지 않는다', async () => {
    h.reply = 'Round bowl\nUSE: hold the rim'
    const out = await readIdentityCard(photo('A'))
    await readIdentityCard(photo('A'), undefined, [photo('B')], { allPhotos: true, states: true })
    expect(promptOf(0)).toBe(IDENTITY_CARD_PROMPT)
    expect(promptOf(1)).toBe(withIdentityStates(buildIdentityCardAllPhotosPrompt(2)))
    for (const call of h.calls) expect(call.options.system).toBe('You catalogue product photos for another image model. Answer with the description only.')
    expect(out).toEqual({ card: `${ONE}Round bowl USE: hold the rim`, costUsd: 0.002 })
  })
})
