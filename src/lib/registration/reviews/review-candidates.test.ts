/**
 * 자사 리뷰 인용 후보(W2a, PDP-W2W3 계약 v1 §2-1) — 30건 이하, 4~5점 먼저·길이·도움 순, 같은 본문 한 번, 안정 id(다시 올려도 같다),
 * 150자 이하(문장 끝에서 자름), 평점 없는 리뷰 제외. 가짜 리뷰만 쓴다(실제 오너 파일·개인정보 없음).
 */

import { describe, expect, it } from 'vitest'
import { buildReviewCandidates, clipQuote } from './review-candidates'
import { quoteCardHighlights, reviewSummaryEnabled } from './review-quote-cards'
import { REVIEW_CANDIDATE_LIMIT, type ParsedReview } from './review-types'

const review = (rating: number | null, body: string, helped = 0, option = ''): ParsedReview => ({
  rating,
  title: '',
  body,
  option,
  helped,
})

describe('buildReviewCandidates', () => {
  it('4~5점 먼저, 그다음 긴 본문·도움 수 순 — 평점 없는 리뷰는 빠진다', () => {
    const out = buildReviewCandidates([
      review(2, '아쉬운 점이 많은데 길게 씁니다. 뚜껑이 헐거워요. 국물이 샜어요.'),
      review(5, '짧아요', 20),
      review(4, '세척이 쉬워요. 매일 씁니다.', 3),
      review(5, '설거지가 편해요. 매일 써요!', 9),
      review(null, '평점이 없는 아주 긴 리뷰입니다. 평점이 없으면 별점을 보일 수 없어요.'),
    ])
    // 길이가 도움 수보다 먼저(도움 20인 짧은 글은 4~5점 중 맨 뒤), 같은 길이(16자)는 도움 수가 많은 쪽 먼저
    expect(out.map((c) => c.rating)).toEqual([5, 4, 5, 2])
    expect(out[0].text).toBe('설거지가 편해요. 매일 써요!')
    expect(out.at(-1)!.text).toContain('아쉬운 점이 많은데')
    expect(out.some((c) => c.text.includes('평점이 없는'))).toBe(false)
  })

  it('같은 본문(띄어쓰기·문장부호만 다른 것 포함)은 한 번만, id는 같은 본문이면 늘 같다', () => {
    const a = buildReviewCandidates([review(5, '손잡이가 편해요. 튼튼해요.'), review(5, '손잡이가 편해요 튼튼해요!!')])
    expect(a).toHaveLength(1)
    const b = buildReviewCandidates([review(4, '손잡이가 편해요. 튼튼해요.', 7, '화이트')])
    expect(b[0].id).toBe(a[0].id)
    expect(b[0]).toEqual({ id: a[0].id, text: '손잡이가 편해요. 튼튼해요.', rating: 4, option: '화이트' })
    expect(a[0]).not.toHaveProperty('option')
  })

  it('정화 표지가 남은 글은 평점과 상관없이 맨 뒤(빼지는 않는다) — 사유 정화', () => {
    const out = buildReviewCandidates([
      review(5, '연락은 (연락처 삭제)로 주세요. 아주 만족해요'),
      review(3, '보통이에요 그냥 그래요'),
    ])
    expect(out.map((c) => c.rating)).toEqual([3, 5])
    expect(out.map((c) => c.blocked)).toEqual([undefined, '정화'])
  })

  it('인용 금지 표현(의학·기능성·최상급·대가성)은 사유를 달아 평점·길이와 상관없이 뒤로 — 카드에 남는 후보는 사유가 없다', () => {
    const out = buildReviewCandidates([
      review(5, '두피 통증이 사라졌어요. 매일 쓰니 정말 좋아요. 아주 길게 쓴 후기입니다.'),
      review(5, '지금까지 써 본 것 중 최고예요 오래 쓸게요'),
      review(5, '체험단으로 받아서 써 봤어요 괜찮네요'),
      review(4, '가볍고 손에 잘 맞아요'),
      review(2, '조금 작아요'),
    ])
    expect(out.map((c) => c.blocked ?? null)).toEqual([null, null, '의학·기능성', '최상급', '대가성'])
    expect(out[0].text).toBe('가볍고 손에 잘 맞아요')
    // 사유가 없는 후보만 카드 단계에서 남는다
    expect(quoteCardHighlights(out)?.highlights.map((h) => h.text)).toEqual(
      out.filter((c) => !c.blocked).map((c) => c.text)
    )
  })

  it('사유는 카드에 실릴 글(자른 본문)로 본다 — 잘려 나간 뒤쪽 표현은 걸지 않는다', () => {
    const head = '가방이 가볍고 수납공간이 넉넉해서 출근길에 매일 들고 다녀요. 끈 길이도 쉽게 맞출 수 있어 편합니다.'
    const body = `${head} ${'색감도 사진과 같아요. '.repeat(8)}이 가격에 최고예요`
    const [cand] = buildReviewCandidates([review(5, body)])
    expect(cand.text.length).toBeLessThanOrEqual(150)
    expect(cand.text).not.toContain('최고')
    expect(cand).not.toHaveProperty('blocked')
  })

  it('자르는 자리가 정화 표지 중간이면(…(연락처) 정화로 본다 — 카드 단계도 같은 기준으로 뺀다', () => {
    const body = `${'가'.repeat(60)} ${'나'.repeat(70)} 연락은 (연락처 삭제)${'나'.repeat(20)}`
    const out = buildReviewCandidates([review(5, body), review(3, '보통이에요 그냥 그래요')])
    expect(out.map((c) => c.rating)).toEqual([3, 5])
    expect(out[1].text).toMatch(/\([^)]*$/)
    expect(out[1].blocked).toBe('정화')
    expect(quoteCardHighlights([out[1]])?.highlights).toEqual([])
  })

  it('30건까지 — 넘으면 사유 있는 후보가 먼저 빠진다', () => {
    const out = buildReviewCandidates(Array.from({ length: 50 }, (_, i) => review(5, `서로 다른 후기 ${i}번째예요`)))
    expect(REVIEW_CANDIDATE_LIMIT).toBe(30)
    expect(out).toHaveLength(30)
    const mixed = buildReviewCandidates([
      ...Array.from({ length: 5 }, (_, i) => review(5, `정말 최고의 제품이에요 아주 길게 쓴 ${i}번째 후기입니다`)),
      ...Array.from({ length: 30 }, (_, i) => review(4, `무난해요 ${i}`)),
    ])
    expect(mixed).toHaveLength(30)
    expect(mixed.some((c) => c.blocked)).toBe(false)
  })
})

describe('clipQuote', () => {
  it('150자 이하는 그대로(줄바꿈·연속 공백은 한 칸으로)', () => {
    expect(clipQuote('좋아요.\n\n  또 살게요')).toBe('좋아요. 또 살게요')
  })

  it('넘으면 상한 안의 마지막 문장 끝에서 자른다 — 말을 바꾸지 않고 줄이기만', () => {
    const text = `${'가'.repeat(60)}요. ${'나'.repeat(60)}다. ${'다'.repeat(60)}`
    expect(clipQuote(text)).toBe(`${'가'.repeat(60)}요. ${'나'.repeat(60)}다.`)
  })

  it('문장부호 끝을 먼저 고른다', () => {
    expect(clipQuote(`${'가'.repeat(50)}. 정말 좋아요 ${'나'.repeat(120)}`)).toBe(`${'가'.repeat(50)}.`)
  })

  it('문장부호가 없으면 말끝(…요)에서 — 조사 보다·낱말 필요는 문장 끝이 아니다', () => {
    const text = `${'가'.repeat(50)} 정말 좋아요 다른 컵보다 가볍고 세척솔 필요 없이 ${'나'.repeat(120)}`
    expect(clipQuote(text)).toBe(`${'가'.repeat(50)} 정말 좋아요`)
    expect(clipQuote(`${'가'.repeat(50)} 다른 컵보다 가볍고 ${'나'.repeat(120)}`)).toBe(
      `${'가'.repeat(50)} 다른 컵보다 가볍고`
    )
  })

  it('문장 끝이 없으면 마지막 띄어쓰기, 그것도 없으면 상한에서', () => {
    expect(clipQuote(`${'가'.repeat(100)} ${'나'.repeat(100)}`)).toBe('가'.repeat(100))
    expect(clipQuote('가'.repeat(200))).toBe('가'.repeat(150))
    // 상한이 이모지 가운데면 그 이모지를 통째로 뺀다
    expect(clipQuote(`${'가'.repeat(149)}😀${'나'.repeat(10)}`)).toBe('가'.repeat(149))
  })
})

describe('오너가 고르는 길은 별점으로 막지 않는다(2026-11-02 통합 결정, 시험 글은 지어낸 것)', () => {
  it('3점 후보는 사유 없이 4~5점 뒤에 있고 카드 단계도 그대로 남긴다', () => {
    const out = buildReviewCandidates([review(3, '손잡이가 좀 불편했어요'), review(5, '거품이 잘 나요')])
    expect(out.map((c) => [c.rating, c.blocked ?? null])).toEqual([[5, null], [3, null]])
    expect(quoteCardHighlights(out)).toMatchObject({ dropped: 0, unsummarized: 0 })
    expect(quoteCardHighlights(out)?.highlights.map((h) => h.rating)).toEqual([5, 3])
  })
})

describe('quoteCardHighlights — 가린 작성자·작성 월·후기 요약(P1-6)', () => {
  const quote = (text: string, extra: Record<string, unknown> = {}) => ({ id: text.slice(0, 4), text, rating: 5, ...extra })

  it('요약이 꺼지면 글 그대로 — 가린 작성자·작성 월은 넘기고, 없으면 구매고객(지어내지 않는다)', () => {
    const out = quoteCardHighlights([
      quote('손잡이가 편해서 매일 들고 다녀요.', { author: '김**', month: '2026.10' }),
      quote('거품이 잘 나요. 머리 감기가 편해졌어요.'),
    ])!
    expect(out.highlights).toEqual([
      { text: '손잡이가 편해서 매일 들고 다녀요.', author: '김**', rating: 5, month: '2026.10' },
      { text: '거품이 잘 나요. 머리 감기가 편해졌어요.', author: '구매고객', rating: 5 },
    ])
    expect(out.unsummarized).toBe(0)
  })

  it('요약이 켜지면 원문 문장 1~2개로 바꾸고 원문을 남긴다 — 강조는 요약에 남은 조각만', () => {
    const text = '배송 빨리 왔어요. 손잡이가 편해서 매일 들고 다녀요. 거품도 잘 나요.'
    const [card] = quoteCardHighlights([quote(text, { highlights: ['배송', '손잡이'], month: '2026.09' })], {
      summary: true,
    })!.highlights
    expect(card).toEqual({
      text: '손잡이가 편해서 매일 들고 다녀요. 거품도 잘 나요.',
      author: '구매고객',
      rating: 5,
      month: '2026.09',
      highlights: ['손잡이'],
      summary: true,
      original: text,
    })
  })

  it('요약 문장이 없는 카드는 빼고 센다(문장을 자르지 않는다), 인용 금지 카드는 따로 센다', () => {
    const out = quoteCardHighlights(
      [quote(`손잡이가 ${'아주 '.repeat(30)}편해요.`), quote('이 가격에 최고예요'), quote('색이 사진보다 예뻐요.')],
      { summary: true }
    )!
    expect(out.highlights.map((h) => h.text)).toEqual(['색이 사진보다 예뻐요.'])
    expect([out.dropped, out.unsummarized]).toEqual([1, 1])
  })

  it('요약 표시 스위치 — 기본 on, 로컬에서만 NEXOPS_PDP_REVIEW_SUMMARY=off로 끈다(Vercel은 무시)', () => {
    expect(reviewSummaryEnabled({})).toBe(true)
    expect(reviewSummaryEnabled({ NEXOPS_PDP_REVIEW_SUMMARY: 'off' })).toBe(false)
    expect(reviewSummaryEnabled({ NEXOPS_PDP_REVIEW_SUMMARY: 'OFF ', VERCEL: '1' })).toBe(true)
    expect(reviewSummaryEnabled({ NEXOPS_PDP_REVIEW_SUMMARY: 'on' })).toBe(true)
  })

  it('이미 한두 문장인 카드는 원문 그대로 — 후기 요약으로 표기하지 않는다', () => {
    const [card] = quoteCardHighlights([quote('색이 사진보다 예뻐요.')], { summary: true })!.highlights
    expect(card).toEqual({ text: '색이 사진보다 예뻐요.', author: '구매고객', rating: 5 })
  })

  it("요약 표시가 켜지면 요약할 수 없는 후보는 사유 '요약'으로 뒤로(화면은 흐리게) — 꺼지면 그대로", () => {
    const reviews = [review(5, `손잡이가 ${'아주 '.repeat(30)}편해요`), review(5, '가볍고 손에 잘 맞아요')]
    const on = buildReviewCandidates(reviews, { summary: true })
    expect(on.map((c) => [c.text.slice(0, 4), c.blocked ?? null])).toEqual([
      ['가볍고 ', null],
      ['손잡이가', '요약'],
    ])
    expect(buildReviewCandidates(reviews).every((c) => !c.blocked)).toBe(true)
  })

  describe('본문 전체에서 고른 카드 문장(cardSummary, 2026-11-02)', () => {
    const motive = '출근 가방이 무거워서 물병을 들 때마다 어깨가 많이 뻐근했어요. '.repeat(4)
    const longBody = `${motive}바꿔 보니 뚜껑이 부드럽게 열려요.`

    it('150자 뒤 효익 문장을 고르고 후보 글은 그대로 둔다', () => {
      expect(longBody.length).toBeGreaterThan(150)
      const [on] = buildReviewCandidates([review(5, longBody)], { summary: true })
      const [off] = buildReviewCandidates([review(5, longBody)])
      expect(on.text).toBe(clipQuote(longBody))
      expect(on.text).not.toContain('열려요')
      expect(on.cardSummary).toBe('바꿔 보니 뚜껑이 부드럽게 열려요.')
      expect(off).toEqual({ id: on.id, text: on.text, rating: 5 })
    })

    it('효익 문장이 없거나 카드로 못 쓰는 후보에는 없다 — 사유·순서는 그대로', () => {
      const none = buildReviewCandidates([review(5, '어머니가 쓰고 계세요. 동생도 가져갔어요.')], { summary: true })
      expect(none[0]).not.toHaveProperty('cardSummary')
      const banned = buildReviewCandidates([review(5, '이 가격에 최고예요. 손잡이가 편해요.')], { summary: true })
      expect(banned[0].blocked).toBe('최상급')
      expect(banned[0]).not.toHaveProperty('cardSummary')
      const runOn = buildReviewCandidates([review(5, `가볍고 좋아요 ${'색도 예뻐요 '.repeat(12)}`)], { summary: true })
      expect(runOn[0].blocked).toBe('요약')
      expect(runOn[0]).not.toHaveProperty('cardSummary')
    })

    it('150자 뒤 규제 표현 문장은 고르지 않는다', () => {
      const [cand] = buildReviewCandidates([review(5, `${motive}아토피가 좋아졌어요. 받침이 잘 맞아요.`)], { summary: true })
      expect(cand.cardSummary).toBe('받침이 잘 맞아요.')
    })

    it('카드는 고른 문장을 쓰고 후기 요약으로 표기한다 — 원문은 옵션 열쇠인 글 그대로, 강조는 문장에 있는 조각만', () => {
      const text = '가방이 자주 무거웠어요. 어깨가 뻐근했어요.'
      const cardSummary = '바꿔 보니 부드럽게 열려요.'
      const [card] = quoteCardHighlights([quote(text, { cardSummary, highlights: ['부드럽게', '뻐근했어요'] })], {
        summary: true,
      })!.highlights
      expect(card).toEqual({
        text: cardSummary,
        author: '구매고객',
        rating: 5,
        highlights: ['부드럽게'],
        summary: true,
        original: text,
      })
    })

    it('글과 같으면 후기 요약이 아니고, 요약이 꺼지면 쓰지 않는다', () => {
      const text = '색이 사진보다 예뻐요.'
      const [same] = quoteCardHighlights([quote(text, { cardSummary: text })], { summary: true })!.highlights
      expect(same).toEqual({ text, author: '구매고객', rating: 5 })
      const [off] = quoteCardHighlights([quote('어머니가 쓰고 계세요.', { cardSummary: text })])!.highlights
      expect(off).toEqual({ text: '어머니가 쓰고 계세요.', author: '구매고객', rating: 5 })
    })

    it('다시 검사해 통과하지 못하는 문장은 버리고 글에서 고른다 — 글에 금지 표현이 있으면 카드를 뺀다', () => {
      const [card] = quoteCardHighlights([quote('손잡이가 편해요.', { cardSummary: '아토피가 좋아졌어요.' })], {
        summary: true,
      })!.highlights
      expect(card.text).toBe('손잡이가 편해요.')
      const out = quoteCardHighlights([quote('이 가격에 최고예요.', { cardSummary: '손잡이가 편해요.' })], { summary: true })!
      expect(out.highlights).toEqual([])
      expect(out.dropped).toBe(1)
    })

    it('예전에 저장한 카드(cardSummary 없음)는 글 안에서 효익 문장을 고른다', () => {
      const [card] = quoteCardHighlights([quote('가방이 자주 무거웠어요. 바꿔 보니 부드럽게 열려요.')], { summary: true })!.highlights
      expect(card.text).toBe('바꿔 보니 부드럽게 열려요.')
    })
  })

  it('인용 후보에 작성 월·가린 작성자를 싣는다', () => {
    const [cand] = buildReviewCandidates([{ ...review(5, '가볍고 손에 잘 맞아요'), month: '2026.08', author: '박**' }])
    expect(cand).toMatchObject({ month: '2026.08', author: '박**' })
  })
})
