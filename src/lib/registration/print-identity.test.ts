/**
 * 상품 정확성(2026-10-31, 상품 일치 불통과 P01·P07) — 인쇄 도안 규칙·인쇄 무늬 보존 줄 고르기, 식별카드가 함께 볼 사진, 식별카드 프롬프트.
 */

import { describe, expect, it } from 'vitest'
import { hasPrintedMarks, identityCardOthers, printIdentityBlock } from './print-identity'
import { buildPrintedDesignsRule, PRINTED_MARKS_RULE } from '@/lib/agents/registration/prompts/pdp-image-prompts'
import {
  buildIdentityCardMultiPrompt,
  IDENTITY_CARD_MAX_PHOTOS,
  IDENTITY_CARD_PROMPT,
} from '@/lib/agents/registration/prompts/pdp-image-gate-prompts'

/** R5-D P07 잡의 실제 식별카드 본문 */
const P07_CARD =
  'PRODUCT IDENTITY (read from the user\'s reference photo — the generated product must match every detail below): Elevated double pet ' +
  'feeder, sage green oval plastic tray with raised back edges, 2 round clear-white glass bowls seated in circular recesses, black paw ' +
  'print and fish skeleton decals, 4 splayed light natural wood legs, no handles, open top, matte finish.'
/** 골든 고정물의 모의 식별카드 */
const GOLDEN_CARD = 'golden identity: shape, colors, parts and count exactly as in the reference photo'

describe('printIdentityBlock — 상품 컷에 붙일 블록', () => {
  it('인쇄물은 도안 규칙 — 참조 사진의 도안만, 여러 장이면 반복, 새 도안·섞기 금지, 스타일 참조는 도안 출처가 아님', () => {
    const one = printIdentityBlock({ textBearing: true, photoCount: 1, identityCard: GOLDEN_CARD })!
    expect(one).toBe(buildPrintedDesignsRule(1))
    for (const phrase of [
      'PRINTED DESIGNS',
      'the first attached image',
      'not a source of designs',
      'repeat them as needed',
      'Never invent a new design, character, animal, motif',
      'never blend two designs',
    ]) {
      expect(one, phrase).toContain(phrase)
    }
    expect(one).not.toContain('may show different designs')
  })

  it('원천이 2장 이상이면 사진 수를 적고, 사진마다 도안이 다를 수 있다고 적는다', () => {
    const three = printIdentityBlock({ textBearing: true, photoCount: 3 })!
    expect(three).toContain('the first 3 attached images')
    expect(three).toContain('reference photos (')
    expect(three).toContain('The 3 product photos may show different designs of this product — use only those.')
  })

  it('일반 상품은 식별카드에 인쇄 그림·무늬가 있을 때만 무늬 보존 줄 — 지울 것은 브랜드명·글자뿐', () => {
    expect(printIdentityBlock({ textBearing: false, photoCount: 1, identityCard: P07_CARD })).toBe(PRINTED_MARKS_RULE)
    expect(PRINTED_MARKS_RULE).toContain('Only brand names and words')
    expect(PRINTED_MARKS_RULE).toContain('same place, size and color')
    expect(PRINTED_MARKS_RULE).toContain('"smooth surface"')
    for (const card of [GOLDEN_CARD, 'Round white bowl, matte ceramic, no handles', 'Green tray with FAIRNEX logo', '', null, undefined]) {
      expect(printIdentityBlock({ textBearing: false, photoCount: 1, identityCard: card }), String(card)).toBeNull()
    }
  })

  it('원천 사진이 없으면(참조 없음) 어느 블록도 붙이지 않는다', () => {
    expect(printIdentityBlock({ textBearing: true, photoCount: 0 })).toBeNull()
    expect(printIdentityBlock({ textBearing: false, photoCount: 0, identityCard: P07_CARD })).toBeNull()
  })

  it('무늬 판정 — 발바닥 프린트·데칼·꽃무늬·아이콘·만화 그림·물방울·줄무늬는 잡는다', () => {
    for (const s of [
      'black paw print',
      'fish skeleton decals',
      'small floral pattern',
      'star icons',
      'bear illustration',
      'patterned lid',
      'printed cartoon cat',
      'pink polka dots',
      'red stripes',
      'cat picture on the lid',
      'plain white bowl with paw print',
    ]) {
      expect(hasPrintedMarks(`round bowl, ${s}, 4 legs`), s).toBe(true)
    }
  })

  it('무늬 판정 — printed 소재·모양·로고 구절·부정 구절(no·without)은 세지 않는다', () => {
    for (const s of [
      'flat printed paper',
      'blueprint shape',
      'brand logo',
      'green leaf logo icon on front',
      'sage green tray',
      'no printed graphics',
      'plain surface, no patterns',
      'without stripes',
      'free of decals',
    ]) {
      expect(hasPrintedMarks(`round bowl, ${s}, 4 legs`), s).toBe(false)
    }
    expect(hasPrintedMarks(P07_CARD)).toBe(true)
    expect(hasPrintedMarks(GOLDEN_CARD)).toBe(false)
    expect(hasPrintedMarks('')).toBe(false)
    expect(hasPrintedMarks(null)).toBe(false)
  })
})

describe('identityCardOthers — 식별카드가 함께 볼 원천 사진', () => {
  it('인쇄물이고 원천이 2장 이상이면 나머지를 합쳐 최대 4장까지', () => {
    expect(IDENTITY_CARD_MAX_PHOTOS).toBe(4)
    expect(identityCardOthers(['a', 'b', 'c', 'd', 'e'], true)).toEqual(['b', 'c', 'd'])
    expect(identityCardOthers(['a', 'b'], true)).toEqual(['b'])
  })

  it('idcardall이면 인쇄물이 아닌 상품도 나머지를 합쳐 최대 8장까지 — 1장이면 여전히 없다', () => {
    const refs = Array.from({ length: 10 }, (_, i) => String(i))
    expect(identityCardOthers(refs, false, true)).toEqual(refs.slice(1, 8))
    expect(identityCardOthers(['a', 'b'], false, true)).toEqual(['b'])
    expect(identityCardOthers(['a'], false, true)).toEqual([])
  })

  it('idcardall이어도 인쇄물은 지금처럼 최대 4장', () => {
    expect(identityCardOthers(['a', 'b', 'c', 'd', 'e'], true, true)).toEqual(['b', 'c', 'd'])
  })

  it('원천이 1장이거나 인쇄물이 아니면 지금처럼 첫 사진만', () => {
    expect(identityCardOthers(['a'], true)).toEqual([])
    expect(identityCardOthers(['a', 'b', 'c'], false)).toEqual([])
  })
})

describe('식별카드 프롬프트', () => {
  it('한 장 — 인쇄 그림·무늬와 그 위치를 (6)으로 적고 50단어, 브랜드 이름·로고는 뺀다', () => {
    expect(IDENTITY_CARD_PROMPT).toContain('(6) pictures, icons or patterns printed on the product')
    expect(IDENTITY_CARD_PROMPT).toContain('exactly where each one is')
    expect(IDENTITY_CARD_PROMPT).toContain('at most 50 words')
    expect(IDENTITY_CARD_PROMPT).toContain('brand names, logos or marketing language')
    expect(IDENTITY_CARD_PROMPT).not.toContain('branding')
  })

  it('여러 장 — 사진 수, 공통 형태(개수·부위별 색 포함) + 사진 순서대로 도안 목록, 반복 도안 표기, 로고 제외', () => {
    const p = buildIdentityCardMultiPrompt(3)
    expect(p).toContain('3 photos of ONE printed product')
    expect(p).toContain('number of sheets or pieces in the set')
    expect(p).toContain('exact colors of each part')
    expect(p).toContain("'Design 1: ...; Design 2: ...'")
    expect(p).toContain('same as Design j')
    expect(p).toContain('without inventing new artwork')
    expect(p).toContain('brand names, logos or marketing language')
  })
})
