/**
 * 식별카드 판독(readIdentityCard) — 한 장은 지금 프롬프트·머리말 그대로, 인쇄물 여러 장은 사진 전부를 한 번에 보내고 도안 목록 프롬프트·
 * 사진 수 머리말·늘어난 길이 상한. LLM은 모의(유료 호출 0).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  calls: [] as Array<{ route: unknown; options: { messages: Array<{ content: Array<{ type: string; text?: string }> }> } }>,
  reply: '',
}))

vi.mock('../llm', () => ({
  callLlm: vi.fn(async (route: unknown, options: never, parser: (t: string) => unknown) => {
    h.calls.push({ route, options })
    return { success: true, data: parser(h.reply), usage: { cost: 0.002 } }
  }),
}))

import { readIdentityCard } from './pdp-image-agent'
import {
  buildIdentityCardAllPhotosPrompt,
  buildIdentityCardMultiPrompt,
  IDENTITY_CARD_MAX_CHARS,
  IDENTITY_CARD_MULTI_MAX_CHARS,
  IDENTITY_CARD_PROMPT,
  IDENTITY_STATES_RULE,
  withIdentityStates,
} from './prompts/pdp-image-gate-prompts'

const photo = (data: string) => ({ data, mediaType: 'image/png' as const })
const contentOf = (i: number) => h.calls[i].options.messages[0].content

beforeEach(() => {
  h.calls = []
  h.reply = ''
})

describe('readIdentityCard', () => {
  it('한 장은 사진 1장 + 한 장 프롬프트, 머리말은 지금 그대로', async () => {
    h.reply = 'Round bowl, black paw print on the left bowl floor'
    const { card, costUsd } = await readIdentityCard(photo('A'))

    expect(contentOf(0).filter((b) => b.type === 'image')).toHaveLength(1)
    expect(contentOf(0).at(-1)?.text).toBe(IDENTITY_CARD_PROMPT)
    expect(card).toBe(
      "PRODUCT IDENTITY (read from the user's reference photo — the generated product must match every detail below): Round bowl, black paw print on the left bowl floor"
    )
    expect(costUsd).toBe(0.002)
  })

  it('전 사진(idcardall)은 사진 전부를 보내고, 확정 기준·부품 끝·중복 세기 금지 프롬프트와 도안 말이 없는 머리말을 쓴다', async () => {
    h.reply = 'Wooden bench, 4 legs, black rubber caps on leg ends UNCERTAIN: none'
    const { card, uncertain } = await readIdentityCard(photo('A'), undefined, [photo('B'), photo('C')], { allPhotos: true })

    const images = contentOf(0).filter((b) => b.type === 'image') as unknown as Array<{ source: { data: string } }>
    expect(images.map((b) => b.source.data)).toEqual(['A', 'B', 'C'])
    const prompt = buildIdentityCardAllPhotosPrompt(3)
    expect(contentOf(0).at(-1)?.text).toBe(prompt)
    expect(prompt).toContain('in the first photo or in at least two of the photos')
    expect(prompt).toContain('count it once')
    expect(prompt).toContain('UNCERTAIN')
    expect(uncertain).toBeUndefined()
    expect(card).toBe(
      "PRODUCT IDENTITY (read from the user's 3 reference photos — the generated product must match every detail below): Wooden bench, 4 legs, black rubber caps on leg ends"
    )
    expect(card).not.toContain('printed designs')
    expect((h.calls[0].options as unknown as { timeoutMs: number }).timeoutMs).toBe(60_000)
  })

  it('한 장에만 있거나 어긋나는 특징은 카드에 넣지 않고 따로 돌려준다 — 생성 프롬프트에 가지 않는다', async () => {
    h.reply = 'Wooden bench, 4 legs, oak finish, UNCERTAIN: black rubber caps on leg ends (photo 3 only); seat color differs in photo 2'
    const { card, uncertain } = await readIdentityCard(photo('A'), undefined, [photo('B'), photo('C')], { allPhotos: true })
    expect(card).toBe(
      "PRODUCT IDENTITY (read from the user's 3 reference photos — the generated product must match every detail below): Wooden bench, 4 legs, oak finish"
    )
    expect(card).not.toContain('caps')
    expect(uncertain).toBe('black rubber caps on leg ends (photo 3 only); seat color differs in photo 2')
  })

  it('UNCERTAIN 표지가 없으면 응답 전부가 확정이다', async () => {
    h.reply = 'Wooden bench, 4 legs'
    const { card, uncertain } = await readIdentityCard(photo('A'), undefined, [photo('B')], { allPhotos: true })
    expect(card).toContain('Wooden bench, 4 legs')
    expect(uncertain).toBeUndefined()
  })

  it('인쇄물 여러 장은 UNCERTAIN을 나누지 않는다 — 지금 경로 그대로', async () => {
    h.reply = 'Sticker; Design 1: bear UNCERTAIN: x'
    const { card, uncertain } = await readIdentityCard(photo('A'), undefined, [photo('B')])
    expect(card).toContain('UNCERTAIN: x')
    expect(uncertain).toBeUndefined()
  })

  it('전 사진을 켜도 사진이 1장이면 한 장 프롬프트·머리말 그대로', async () => {
    h.reply = 'Wooden bench, 4 legs'
    const { card } = await readIdentityCard(photo('A'), undefined, [], { allPhotos: true })
    expect(contentOf(0).at(-1)?.text).toBe(IDENTITY_CARD_PROMPT)
    expect(card).toContain("read from the user's reference photo —")
  })

  it('인쇄물 여러 장은 사진 전부를 한 번에 보내고, 머리말에 사진 수와 도안은 목록 중 하나라고 적는다', async () => {
    h.reply = 'Round flat sticker; Design 1: bear with cake; Design 2: bear with balloon; Design 3: crayon rainbow'
    const { card } = await readIdentityCard(photo('A'), undefined, [photo('B'), photo('C')])

    const images = contentOf(0).filter((b) => b.type === 'image') as unknown as Array<{ source: { data: string } }>
    expect(images.map((b) => b.source.data)).toEqual(['A', 'B', 'C'])
    expect(contentOf(0).at(-1)?.text).toBe(buildIdentityCardMultiPrompt(3))
    expect(card).toContain("read from the user's 3 reference photos")
    expect(card).toContain('printed designs come only from the reference photos, as listed below')
    expect(card).toContain('Design 3: crayon rainbow')
  })

  it('여러 줄 응답은 한 줄로 모은다(카드는 한 줄 블록)', async () => {
    h.reply = 'Round flat sticker;\nDesign 1: bear\n\nDesign 2:   rainbow '
    const { card } = await readIdentityCard(photo('A'), undefined, [photo('B')])
    expect(card).not.toContain('\n')
    expect(card.endsWith('Round flat sticker; Design 1: bear Design 2: rainbow')).toBe(true)
  })

  it('길이 상한 — 한 장 500자, 여러 장 1000자', async () => {
    h.reply = 'x'.repeat(2000)
    const single = await readIdentityCard(photo('A'))
    const multi = await readIdentityCard(photo('A'), undefined, [photo('B')])
    expect(IDENTITY_CARD_MAX_CHARS).toBe(500)
    expect(IDENTITY_CARD_MULTI_MAX_CHARS).toBe(1000)
    expect(single.card.endsWith('x'.repeat(IDENTITY_CARD_MAX_CHARS))).toBe(true)
    expect(single.card).not.toContain('x'.repeat(IDENTITY_CARD_MAX_CHARS + 1))
    expect(multi.card.endsWith('x'.repeat(IDENTITY_CARD_MULTI_MAX_CHARS))).toBe(true)
    expect(multi.card).not.toContain('x'.repeat(IDENTITY_CARD_MULTI_MAX_CHARS + 1))
  })

  it('빈 응답은 카드 없이 진행한다', async () => {
    h.reply = '   '
    expect((await readIdentityCard(photo('A'), undefined, [photo('B')])).card).toBe('')
  })
})

describe('상태 구분 문장(states, idcardall 잡 — 오너 메모 11-06 P05)', () => {
  it('Rules 줄 바로 앞에 한 번 끼우고 앞뒤 글은 그대로다 — 한 장·전 사진 프롬프트 모두', () => {
    for (const base of [IDENTITY_CARD_PROMPT, buildIdentityCardAllPhotosPrompt(2)]) {
      const out = withIdentityStates(base)
      const at = base.indexOf('\nRules:')
      expect(out).toBe(`${base.slice(0, at)}\n${IDENTITY_STATES_RULE}${base.slice(at)}`)
      expect(out.split(IDENTITY_STATES_RULE)).toHaveLength(2)
    }
  })

  it('Rules 줄이 없으면 끝에 붙인다', () => {
    expect(withIdentityStates('describe it')).toBe(`describe it\n${IDENTITY_STATES_RULE}`)
  })

  it('문장 — 한 상품, 상태마다 따로, 감싸는 관계, 따로 된 덮개 없음, 작은 걸쇠', () => {
    expect(IDENTITY_STATES_RULE).toContain('it is still ONE product')
    expect(IDENTITY_STATES_RULE).toContain("'State <name>: ...'")
    expect(IDENTITY_STATES_RULE).toContain('which part holds, wraps or covers which')
    expect(IDENTITY_STATES_RULE).toContain('no separate cover, case or extra part')
    expect(IDENTITY_STATES_RULE).toContain('small latches, pins and tips')
  })

  it('전 사진 + states는 상태 문장이 든 전 사진 프롬프트를 보내고 카드 머리말·UNCERTAIN 나누기는 그대로다', async () => {
    h.reply = 'Folding brush, heart cutout handle, State open: head in line; State folded: handle wraps the bristles UNCERTAIN: none'
    const { card, uncertain } = await readIdentityCard(photo('A'), undefined, [photo('B')], { allPhotos: true, states: true })
    expect(contentOf(0).at(-1)?.text).toBe(withIdentityStates(buildIdentityCardAllPhotosPrompt(2)))
    expect(uncertain).toBeUndefined()
    expect(card).toBe(
      "PRODUCT IDENTITY (read from the user's 2 reference photos — the generated product must match every detail below): Folding brush, heart cutout handle, State open: head in line; State folded: handle wraps the bristles"
    )
  })

  it('한 장 + states는 상태 문장이 든 한 장 프롬프트, 머리말은 그대로다', async () => {
    h.reply = 'Folding brush'
    const { card } = await readIdentityCard(photo('A'), undefined, [], { states: true })
    expect(contentOf(0).at(-1)?.text).toBe(withIdentityStates(IDENTITY_CARD_PROMPT))
    expect(card).toContain("read from the user's reference photo —")
  })

  it('인쇄물 여러 장은 states를 받아도 도안 프롬프트 그대로다', async () => {
    h.reply = 'Sticker; Design 1: bear'
    await readIdentityCard(photo('A'), undefined, [photo('B')], { states: true })
    expect(contentOf(0).at(-1)?.text).toBe(buildIdentityCardMultiPrompt(2))
  })

  it('states가 없으면 지금 프롬프트와 글자까지 같다', async () => {
    await readIdentityCard(photo('A'))
    await readIdentityCard(photo('A'), undefined, [photo('B')], { allPhotos: true })
    expect(contentOf(0).at(-1)?.text).toBe(IDENTITY_CARD_PROMPT)
    expect(contentOf(1).at(-1)?.text).toBe(buildIdentityCardAllPhotosPrompt(2))
    expect(IDENTITY_CARD_PROMPT).not.toContain('State <name>')
  })
})
