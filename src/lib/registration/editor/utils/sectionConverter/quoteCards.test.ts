/**
 * 인용 카드 표기(R6) — 평점이 있는 카드(W2b, 오너가 고른 자사 리뷰)는 제목 '구매 고객 후기', 작성자 줄(아바타·이니셜·이름) 없이
 * 별점·옵션만(옵션은 별점 아래 28px 줄). 평점이 없는 기존 발췌 카드는 그대로('실제 구매 후기'·'구매고객 고객님').
 * StyleTab 재배치도 같은 머리 행을 쓴다.
 */

import { describe, expect, it } from 'vitest'
import type { CanvasElement, CanvasSection } from '../../types/canvas'
import { ProSectionType } from '../../types/section'
import { REVIEW_CARD_DEFAULTS } from '../../constants/designTokens'
import { checkMobileReadability } from '../mobileReadability'
import { relayoutReviewCards } from '../reviewCardLayout'
import {
  QUOTE_CARD_OPTION_GAP,
  QUOTE_CARD_OPTION_ROW_H,
  QUOTE_CARD_STAR_ROW_H,
  createSectionElements,
  isQuoteCard,
  quoteCardHeaderH,
  quoteCardMetaLabel,
  quoteOptionLabel,
} from './sections'

const palette = {
  primary: '#335CFF',
  secondary: '#111111',
  bgMain: '#FFFFFF',
  bgSub: '#F5F5F5',
  textMain: '#222222',
  textHighlight: '#335CFF',
}
const QUOTES = [
  { text: '손잡이가 편해서 매일 들고 다녀요', author: '구매고객', rating: 4 },
  { text: '거품이 잘 나요', author: '구매고객', rating: 5 },
]
const SPEC = {
  reviewQuotes: [
    { id: 'a', text: '손잡이가 편해서 매일 들고 다녀요', rating: 4, option: '세이지 그린' },
    { id: 'b', text: '거품이 잘 나요', rating: 5 },
  ],
}

const build = (reviews: Array<Record<string, unknown>>, specSheet: Record<string, unknown> = {}) =>
  createSectionElements(ProSectionType.PERFORMANCE_REVIEWS, { reviews }, null, palette, { specSheet })
const byName = (els: CanvasElement[], name: string) => els.find((e) => e.name === name)
const textOf = (els: CanvasElement[], name: string) => byName(els, name)?.textProps?.content
const asSection = (elements: CanvasElement[]) =>
  ({
    id: 's1',
    sectionType: ProSectionType.PERFORMANCE_REVIEWS,
    groupType: 'usp',
    order: 1,
    isVisible: true,
    layoutId: 'perf_reviews_layout_01',
    canvas: { width: 860, height: 2000, backgroundColor: '#FFFFFF' },
    elements,
  }) as unknown as CanvasSection

describe('인용 카드 표기(R6)', () => {
  it('평점이 있는 카드: 제목 구매 고객 후기, 작성자 줄 없이 별점, 그 아래 옵션 줄', () => {
    const els = build(QUOTES, SPEC)
    expect(textOf(els, 'review_count_label')).toBe('구매 고객 후기')
    for (const part of ['review_avatar_', 'review_initial_', 'review_author_']) {
      expect(
        els.some((e) => e.name.startsWith(part)),
        part
      ).toBe(false)
    }
    expect(els.some((e) => (e.textProps?.content ?? '').includes('고객님'))).toBe(false)
    const bg = byName(els, 'review_card_bg_0')!
    const stars = byName(els, 'review_stars_0')!
    const option = byName(els, 'review_option_0')!
    const { marginX, padding } = REVIEW_CARD_DEFAULTS
    expect(stars.textProps?.content).toBe('★★★★☆')
    expect([stars.transform.x, stars.transform.y]).toEqual([marginX + padding, bg.transform.y + padding])
    expect(option.textProps?.content).toBe('옵션: 세이지 그린')
    expect([option.transform.x, option.transform.y]).toEqual([
      marginX + padding,
      stars.transform.y + QUOTE_CARD_STAR_ROW_H + QUOTE_CARD_OPTION_GAP,
    ])
    expect(option.textProps?.fontSize).toBe(28)
    // 글은 옵션 줄 바로 아래(머리 행 = 별점 + 간격 + 옵션 줄)
    expect(byName(els, 'review_text_0')!.transform.y).toBe(option.transform.y + QUOTE_CARD_OPTION_ROW_H + 16)
    expect(quoteCardHeaderH(true)).toBe(QUOTE_CARD_STAR_ROW_H + QUOTE_CARD_OPTION_GAP + QUOTE_CARD_OPTION_ROW_H)
    // 옵션이 없는 카드는 옵션 줄도, 그 높이도 없다
    expect(byName(els, 'review_option_1')).toBeUndefined()
    const bg1 = byName(els, 'review_card_bg_1')!
    expect(byName(els, 'review_text_1')!.transform.y).toBe(bg1.transform.y + padding + quoteCardHeaderH(false) + 16)
    // 카드 자식 연결(reflow) — 별점·옵션·글
    const children = new Set(bg.containerOf)
    for (const name of ['review_stars_0', 'review_option_0', 'review_text_0'])
      expect(children.has(byName(els, name)!.id), name).toBe(true)
  })

  it('옵션 줄은 모바일 검사에 걸리지 않는다 — 별점과 나란한 좁은 2열(M6)·글자 하한(M1) 없음', () => {
    const { violations } = checkMobileReadability({ sections: [asSection(build(QUOTES, SPEC))] })
    expect(violations.filter((v) => v.rule === 'M6')).toEqual([])
    expect(violations.filter((v) => (v.element ?? '').startsWith('review_option'))).toEqual([])
  })

  it('평점이 없는 기존 발췌 카드는 그대로 — 실제 구매 후기, 아바타·작성자 줄', () => {
    const els = build([{ text: '손잡이가 편해요', author: '구매고객' }], SPEC)
    expect(textOf(els, 'review_count_label')).toBe('실제 구매 후기')
    expect(textOf(els, 'review_author_0')).toBe('구매고객 고객님')
    expect(byName(els, 'review_avatar_0')).toBeDefined()
    expect(byName(els, 'review_option_0')).toBeUndefined()
  })

  it('옵션은 고른 카드(spec_sheet.reviewQuotes)에서 같은 글로 찾는다 — 없으면 옵션 줄 없음', () => {
    expect(byName(build(QUOTES), 'review_option_0')).toBeUndefined()
    const changed = build([{ ...QUOTES[0], text: '다른 글' }], SPEC)
    expect(byName(changed, 'review_option_0')).toBeUndefined()
  })

  it('연령 제한 상품은 어린이 표현이 든 옵션명을 보이지 않는다', () => {
    const spec = { minAgeYears: 14, reviewQuotes: [{ ...SPEC.reviewQuotes[0], option: '키즈 핑크' }] }
    expect(byName(build(QUOTES, spec), 'review_option_0')).toBeUndefined()
    expect(textOf(build(QUOTES, { ...spec, minAgeYears: undefined }), 'review_option_0')).toBe('옵션: 키즈 핑크')
  })

  it('quoteOptionLabel — 공백 정리, 20자 넘으면 자르고 …, 글이 아니면 빈 줄 / isQuoteCard — 평점 숫자만', () => {
    expect(quoteOptionLabel('  블랙   2개 ')).toBe('옵션: 블랙 2개')
    expect(quoteOptionLabel('아주 긴 옵션 이름이 계속 이어지는 경우')).toBe('옵션: 아주 긴 옵션 이름이 계속 이어지는…')
    expect(quoteOptionLabel(undefined)).toBe('')
    expect(quoteOptionLabel('   ')).toBe('')
    expect(quoteOptionLabel('아이보리', true)).toBe('')
    expect(isQuoteCard({ rating: 4 })).toBe(true)
    expect(isQuoteCard({ rating: '4' })).toBe(false)
    expect(isQuoteCard({ rating: Number.NaN })).toBe(false)
    expect(isQuoteCard({})).toBe(false)
  })

  it('StyleTab 재배치(relayoutReviewCards)도 인용 카드 머리 행(별점, 그 아래 옵션)을 지킨다', () => {
    const params = { ...REVIEW_CARD_DEFAULTS, padding: 40, gap: 30, bodyFontSize: 30 }
    const next = relayoutReviewCards(asSection(build(QUOTES, SPEC)), params).elements
    const bg = byName(next, 'review_card_bg_0')!
    const stars = byName(next, 'review_stars_0')!
    const { marginX } = REVIEW_CARD_DEFAULTS
    expect([stars.transform.x, stars.transform.y]).toEqual([marginX + 40, bg.transform.y + 40])
    expect([byName(next, 'review_option_0')!.transform.x, byName(next, 'review_option_0')!.transform.y]).toEqual([
      marginX + 40,
      stars.transform.y + QUOTE_CARD_STAR_ROW_H + QUOTE_CARD_OPTION_GAP,
    ])
    expect(byName(next, 'review_text_0')!.transform.y).toBe(
      byName(next, 'review_option_0')!.transform.y + QUOTE_CARD_OPTION_ROW_H + 16
    )
    const bg1 = byName(next, 'review_card_bg_1')!
    expect(byName(next, 'review_text_1')!.transform.y).toBe(bg1.transform.y + 40 + quoteCardHeaderH(false) + 16)
  })
})

describe('인용 카드 작성 정보 줄(P1-6)', () => {
  const SUMMARY = {
    text: '손잡이가 편해서 매일 들고 다녀요.',
    author: '김**',
    rating: 5,
    month: '2026.10',
    summary: true,
    original: '배송 빨리 왔어요. 손잡이가 편해서 매일 들고 다녀요.',
  }
  const SPEC_ORIGINAL = {
    reviewQuotes: [{ id: 'a', text: SUMMARY.original, rating: 5, option: '세이지 그린' }],
  }

  it('카드 문장이 150자로 자른 글에 없어도 옵션은 글로 찾는다', () => {
    const els = build([{ ...SUMMARY, text: '자른 글 뒤의 문장이 부드럽게 열려요.' }], SPEC_ORIGINAL)
    expect(byName(els, 'review_option_0')!.textProps?.content).toBe('옵션: 세이지 그린')
    expect(textOf(els, 'review_text_0')).toBe('"자른 글 뒤의 문장이 부드럽게 열려요."')
  })

  it('가린 작성자 또는 구매 고객·작성 월·후기 요약 — 셋 다 없으면 줄 없음(기존 카드)', () => {
    expect(quoteCardMetaLabel(SUMMARY)).toBe('김** · 2026.10 · 후기 요약')
    expect(quoteCardMetaLabel({ author: '구매고객', rating: 5, month: '2026.09' })).toBe('구매 고객 · 2026.09')
    expect(quoteCardMetaLabel({ author: '구매고객', rating: 5, summary: true })).toBe('구매 고객 · 후기 요약')
    expect(quoteCardMetaLabel({ author: '구매고객', rating: 5 })).toBe('')
    // 가리지 않은 이름은 쓰지 않는다
    expect(quoteCardMetaLabel({ author: '김철수', rating: 5, month: '2026.09' })).toBe('구매 고객 · 2026.09')
  })

  it('별점 아래 작성 정보 줄, 그 아래 옵션 줄(옵션은 원문 글로 찾는다) — 머리 행 높이에 두 줄을 더한다', () => {
    const els = build([SUMMARY], SPEC_ORIGINAL)
    const stars = byName(els, 'review_stars_0')!
    const meta = byName(els, 'review_meta_0')!
    const option = byName(els, 'review_option_0')!
    expect(meta.textProps?.content).toBe('김** · 2026.10 · 후기 요약')
    expect(option.textProps?.content).toBe('옵션: 세이지 그린')
    expect(meta.transform.y).toBe(stars.transform.y + QUOTE_CARD_STAR_ROW_H + QUOTE_CARD_OPTION_GAP)
    expect(option.transform.y).toBe(meta.transform.y + QUOTE_CARD_OPTION_ROW_H + QUOTE_CARD_OPTION_GAP)
    expect(byName(els, 'review_text_0')!.transform.y).toBe(option.transform.y + QUOTE_CARD_OPTION_ROW_H + 16)
    expect(textOf(els, 'review_text_0')).toBe(`"${SUMMARY.text}"`)
    expect(quoteCardHeaderH(true, true)).toBe(quoteCardHeaderH(true) + QUOTE_CARD_OPTION_GAP + QUOTE_CARD_OPTION_ROW_H)
    // 작성자 줄 요소(아바타·이니셜·이름)는 여전히 없다 — 재배치가 인용 카드로 알아본다
    expect(byName(els, 'review_author_0')).toBeUndefined()
  })

  it('작성 정보 줄도 모바일 검사에 걸리지 않는다', () => {
    const { violations } = checkMobileReadability({ sections: [asSection(build([SUMMARY], SPEC_ORIGINAL))] })
    expect(violations.filter((v) => v.rule === 'M6')).toEqual([])
    expect(violations.filter((v) => (v.element ?? '').startsWith('review_meta'))).toEqual([])
  })

  it('StyleTab 재배치도 별점 → 작성 정보 줄 → 옵션 줄 순서를 지킨다', () => {
    const params = { ...REVIEW_CARD_DEFAULTS, padding: 40, gap: 30, bodyFontSize: 30 }
    const next = relayoutReviewCards(asSection(build([SUMMARY], SPEC_ORIGINAL)), params).elements
    const stars = byName(next, 'review_stars_0')!
    const meta = byName(next, 'review_meta_0')!
    const option = byName(next, 'review_option_0')!
    expect(meta.transform.y).toBe(stars.transform.y + QUOTE_CARD_STAR_ROW_H + QUOTE_CARD_OPTION_GAP)
    expect(option.transform.y).toBe(meta.transform.y + QUOTE_CARD_OPTION_ROW_H + QUOTE_CARD_OPTION_GAP)
    expect(byName(next, 'review_text_0')!.transform.y).toBe(option.transform.y + QUOTE_CARD_OPTION_ROW_H + 16)
  })
})

describe('평점 없는 발췌 카드의 작성자 줄(P1-6)', () => {
  it('작성 정보(가린 작성자·작성 월·후기 요약)가 있으면 그 표기, 없으면 예전 그대로(구매고객 고객님)', () => {
    const els = build([
      { text: '손잡이가 편해요.', author: '구매고객', summary: true, original: '배송 빨리 왔어요. 손잡이가 편해요.' },
      { text: '거품이 잘 나요', author: '구매고객' },
    ])
    expect(textOf(els, 'review_author_0')).toBe('구매 고객 · 후기 요약')
    expect(textOf(els, 'review_author_1')).toBe('구매고객 고객님')
  })
})
