/**
 * 리뷰 카드 별점 글자(W2b) — 인용 카드처럼 평점이 있으면 그 점수만큼 ★, 평점이 없으면 별 줄을 그리지 않는다
 * (근거 없는 ★5 기본값 제거, 2026-10-30 오너 지시).
 */

import { describe, expect, it } from 'vitest'
import type { DesignPalette } from '../../types/editor'
import { ProSectionType } from '../../types/section'
import { createSectionElements, reviewStars } from './sections'
import { relayoutReviewCards } from '../reviewCardLayout'
import type { CanvasSection } from '../../types/canvas'

describe('reviewStars', () => {
  it('평점이 있으면 그만큼 ★, 나머지 ☆ — 1~5로 반올림해 묶는다', () => {
    expect(reviewStars(4)).toBe('★★★★☆')
    expect(reviewStars(5)).toBe('★★★★★')
    expect(reviewStars(2.6)).toBe('★★★☆☆')
    expect(reviewStars(0)).toBe('★☆☆☆☆')
    expect(reviewStars(9)).toBe('★★★★★')
  })

  it('평점이 없거나 숫자가 아니면 빈 글자(별을 지어내지 않는다)', () => {
    expect(reviewStars(undefined)).toBe('')
    expect(reviewStars('4')).toBe('')
    expect(reviewStars(Number.NaN)).toBe('')
  })
})

describe('후기 카드 — 평점 없는 발췌 카드는 별 줄 없이 아바타·이름만', () => {
  const PALETTE = { primary: '#C2410C', textMain: '#262626', bgMain: '#FFFFFF', bgSub: '#F8FAFC' } as DesignPalette
  const build = (reviews: Array<Record<string, unknown>>) =>
    createSectionElements(ProSectionType.PERFORMANCE_REVIEWS, { reviews }, null, PALETTE)
  const named = (els: ReturnType<typeof build>, name: string) => els.find((e) => e.name === name)

  it('평점이 없으면 별 요소가 없고 머리 행이 아바타 높이(52)로 줄어 글이 바로 아래에 온다', () => {
    const els = build([{ text: '손잡이가 편해요', author: '구매고객' }])
    expect(named(els, 'review_stars_0')).toBeUndefined()
    const avatar = named(els, 'review_avatar_0')!
    expect(named(els, 'review_text_0')!.transform.y).toBe(avatar.transform.y + 52 + 16)
  })

  it('평점이 있으면 인용 카드 — 그 점수만큼 별', () => {
    const els = build([{ text: '손잡이가 편해요', author: '구매고객', rating: 4 }])
    expect(named(els, 'review_stars_0')!.textProps!.content).toBe('★★★★☆')
  })

  it('재배치(StyleTab 간격·여백)도 별 없는 카드의 머리 행을 아바타 높이로 둔다', () => {
    const section = {
      id: 's',
      sectionType: ProSectionType.PERFORMANCE_REVIEWS,
      canvas: { width: 860, height: 1200, backgroundColor: '#FFFFFF' },
      elements: build([{ text: '손잡이가 편해요', author: '구매고객' }]),
    } as unknown as CanvasSection
    const out = relayoutReviewCards(section, { gap: 24, padding: 40, bodyFontSize: 34 })
    const avatar = out.elements.find((e) => e.name === 'review_avatar_0')!
    expect(out.elements.find((e) => e.name === 'review_text_0')!.transform.y).toBe(avatar.transform.y + 52 + 16)
  })
})
