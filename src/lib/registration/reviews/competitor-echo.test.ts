/**
 * 경쟁사 리뷰 재현 가드(pdp-review-input) — 15자 경계, 카피 섹션 판정, 남은 문장 지우기, 재생성 지시에 원문이 없음을 고정한다.
 */

import { describe, expect, it } from 'vitest'
import type { CopywritingResult } from '../pdp-state'
import {
  buildEchoGuard,
  buildEchoRewriteDirective,
  ECHO_MIN_CHARS,
  findCopyEchoes,
  hasEcho,
  stripCopyEchoes,
} from './competitor-echo'

const REVIEW = '뚜껑을 세게 닫아도 국물이 조금씩 새어 나와서 가방에 넣기가 불안했어요.'

describe('hasEcho', () => {
  const guard = buildEchoGuard([REVIEW])!

  it('공백·문장부호를 빼고 15자 이상 겹치면 재현, 14자는 아니다', () => {
    const norm15 = '국물이조금씩새어나와서가방에넣' // 15자
    expect(norm15).toHaveLength(ECHO_MIN_CHARS)
    expect(hasEcho('국물이 조금씩, 새어 나와서 가방에 넣', guard)).toBe(true)
    expect(hasEcho(norm15.slice(0, 14), guard)).toBe(false)
    expect(hasEcho('밀폐 뚜껑이라 가방에 넣어도 안심이에요', guard)).toBe(false)
  })

  it('조각이 없는 짧은 글만 있으면 가드를 만들지 않는다', () => {
    expect(buildEchoGuard(['짧음', ''])).toBeNull()
  })
})

describe('카피 가드', () => {
  const guard = buildEchoGuard([REVIEW])!
  const raw = {
    hero: { headline: '어디든 들고 다니는 밀폐 도시락', sub: '국물 걱정 없이' },
    problem: {
      question: '뚜껑을 세게 닫아도 국물이 조금씩 새어 나와서 불편하셨죠? 이제 걱정 마세요.',
      empathyLines: ['가방에 넣기 망설여지던 날', '뚜껑을 세게 닫아도 국물이 조금씩 새어 나와서'],
    },
    reviewHighlights: [
      { text: '국물이 조금씩 새어 나와서 가방에 넣기가 불안했어요', author: '구매고객' },
      { text: '설거지가 편해요', author: '구매고객' },
    ],
  }
  const copy = raw as unknown as CopywritingResult

  it('겹친 최상위 섹션만 찾는다', () => {
    expect(findCopyEchoes(copy, guard)).toEqual(['problem', 'reviewHighlights'])
  })

  it('겹친 문장만 지우고, 통째로 겹친 줄·인용은 항목째 뺀다(원본 불변)', () => {
    const { copy: out, removed } = stripCopyEchoes(copy, guard)
    const o = out as unknown as typeof raw
    expect(o.hero).toBe(raw.hero)
    expect(o.problem.question).toBe('이제 걱정 마세요.')
    expect(o.problem.empathyLines).toEqual(['가방에 넣기 망설여지던 날'])
    expect(o.reviewHighlights).toEqual([{ text: '설거지가 편해요', author: '구매고객' }])
    expect(removed).toEqual([
      { section: 'problem', sentences: 2 },
      { section: 'reviewHighlights', sentences: 1 },
    ])
    expect(findCopyEchoes(out, guard)).toEqual([])
    expect(raw.problem.empathyLines).toHaveLength(2)
  })

  it('문장 경계를 넘는 겹침은 그 글을 통째로 비운다', () => {
    const g = buildEchoGuard(['가방에 넣어도. 국물이 새지 않아 정말 편해요'])!
    const { copy: out } = stripCopyEchoes(
      { hero: { sub: '가방에 넣어도. 국물이 새지 않아 정말 좋아요' } } as unknown as CopywritingResult,
      g
    )
    expect((out as unknown as { hero: { sub: string } }).hero.sub).toBe('')
  })

  it('글 칸 하나가 빈 객체 항목(FAQ 답·카드 설명)은 항목째 뺀다', () => {
    const { copy: out } = stripCopyEchoes(
      {
        faq: [
          { q: '새나요?', a: '뚜껑을 세게 닫아도 국물이 조금씩 새어 나와서 불편했어요' },
          { q: '세척은요?', a: '분리해서 씻어요' },
        ],
      } as unknown as CopywritingResult,
      guard
    )
    expect((out as unknown as { faq: unknown[] }).faq).toEqual([{ q: '세척은요?', a: '분리해서 씻어요' }])
  })

  it('자사 리뷰에도 있는 표현은 가드에서 뺀다(자사 인용 오탐 방지)', () => {
    const own = '[리뷰1] 평점 3/5 · 도움 0\n내용: 국물이 조금씩 새어 나와서 가방에 넣기가 불안했어요. 그래도 쓸 만해요'
    const g = buildEchoGuard([REVIEW], [own])!
    expect(hasEcho('국물이 조금씩 새어 나와서 가방에 넣기가 불안했어요', g)).toBe(false)
    expect(hasEcho('뚜껑을 세게 닫아도 국물이 조금씩 새어', g)).toBe(true)
  })

  it('겹침이 없으면 같은 객체', () => {
    const clean = { hero: { headline: '새 표현' } } as unknown as CopywritingResult
    expect(stripCopyEchoes(clean, guard).copy).toBe(clean)
  })

  it('재생성 지시는 섹션 이름만 담는다(원문 문장을 다시 넣지 않는다)', () => {
    const directive = buildEchoRewriteDirective(['problem', 'reviewHighlights'])
    expect(directive).toContain('problem, reviewHighlights')
    expect(directive).not.toContain('국물')
  })
})
