/**
 * 후기 발췌 카드(Track S '실제 구매 후기' 경로, P1-6 커밋 B) — 출처 리뷰의 원본 평점·작성 월·가린 작성자, 후기 요약(자르지 않는 원문
 * 문장 1~2개). 결정론(LLM 없음).
 */

import { describe, expect, it } from 'vitest'
import {
  finishExcerptHighlights,
  parseSerializedReviewList,
  pickSummaryFallbacks,
  sourceReviewOf,
  withoutLowRatedExcerpts,
} from './review-excerpts'

const BODY1 = '배송 빨리 왔어요. 손잡이가 편해서 매일 들고 다녀요. 거품도 잘 나요.'
const serializeForTest = (body: string) => `[리뷰1] 평점 5/5 · 도움 1\n내용: ${body}`

const SERIALIZED = [
  '리뷰 전체: 3건 (텍스트 리뷰 3건)',
  '표집: 3건 (평점 분포 유지, 구체적인 긴 리뷰 우선)',
  '[리뷰1] 평점 5/5 · 도움 3 · 작성 2026.10 · 작성자 김**',
  `내용: ${BODY1}`,
  '[리뷰2] 평점 4/5 · 도움 0 · 옵션: 화이트',
  '제목: 만족',
  '내용: 색감이 사진보다 예뻐요.',
  // 직렬화기는 평점 없는 리뷰를 '평점 평점없음'으로 쓴다(review-sample)
  '[리뷰3] 평점 평점없음 · 도움 0 · 작성자 박서연',
  '내용: 뚜껑이 단단하게 잠겨요.',
].join('\n')

describe('parseSerializedReviewList', () => {
  it('직렬화 메타에서 평점·작성 월·가린 작성자를 읽는다 — 가리지 않은 작성자는 받지 않는다', () => {
    expect(parseSerializedReviewList(SERIALIZED)).toEqual([
      { rating: 5, helped: 3, title: '', body: BODY1, month: '2026.10', author: '김**' },
      { rating: 4, helped: 0, title: '만족', body: '색감이 사진보다 예뻐요.' },
      { rating: null, helped: 0, title: '', body: '뚜껑이 단단하게 잠겨요.' },
    ])
    expect(parseSerializedReviewList('그냥 붙여 넣은 리뷰 글')).toEqual([])
  })

  it('발췌의 출처 — 공백·문장부호를 빼고 본문·제목에 들어 있으면, 너무 짧으면 찾지 않는다', () => {
    const reviews = parseSerializedReviewList(SERIALIZED)
    expect(sourceReviewOf('손잡이가 편해서  매일 들고 다녀요', reviews)?.rating).toBe(5)
    expect(sourceReviewOf('만족', reviews)).toBeUndefined()
    expect(sourceReviewOf('물이 새지 않아요', reviews)).toBeUndefined()
  })
})

describe('별점 3점 이하 후기의 발췌(R17 P06, 시험 글은 지어낸 것)', () => {
  const text = [
    '리뷰 전체: 3건 (텍스트 리뷰 3건)',
    '[리뷰1] 평점 3/5 · 도움 9',
    '내용: 손잡이가 좀 불편했어요. 오래 쓰면 손이 아파요.',
    '[리뷰2] 평점 5/5 · 도움 0',
    '내용: 거품이 잘 나서 매일 써요.',
    '[리뷰3] 평점 4/5 · 도움 0',
    '내용: 색이 사진과 같아서 좋아요.',
  ].join('\n')

  it('모델 후보에서 낮은 후기 문장만 뺀다 — 글·객체 모두, 4점은 남기고 순서는 그대로', () => {
    const low = { text: '오래 쓰면 손이 아파요.' }
    const good = { text: '거품이 잘 나서 매일 써요.' }
    expect(withoutLowRatedExcerpts([low, good, '색이 사진과 같아서 좋아요.'], text)).toEqual({ kept: [good, '색이 사진과 같아서 좋아요.'], lowRated: 1 })
    expect(withoutLowRatedExcerpts(['손잡이가 좀 불편했어요.', good], text).lowRated).toBe(1)
  })

  it('낮은 후보가 없거나 별점을 모르면(붙여 넣은 원문·출처 없음·글 아님) 후보 그대로다', () => {
    const good = [{ text: '거품이 잘 나서 매일 써요.' }, { text: '후기에 없는 지어낸 글입니다.' }, null, 3]
    expect(withoutLowRatedExcerpts(good, text)).toEqual({ kept: good, lowRated: 0 })
    expect(withoutLowRatedExcerpts(['오래 쓰면 손이 아파요.'], '오래 쓰면 손이 아파요.')).toEqual({ kept: ['오래 쓰면 손이 아파요.'], lowRated: 0 })
  })

  it('마무리도 출처 별점이 낮으면 싣지 않고 lowRated로 센다', () => {
    const out = finishExcerptHighlights(
      [{ text: '오래 쓰면 손이 아파요.', author: '구매고객' }, { text: '거품이 잘 나서 매일 써요.', author: '구매고객' }],
      text,
      { summary: false }
    )
    expect(out.highlights.map((h) => h.rating)).toEqual([5])
    expect(out).toMatchObject({ dropped: 0, lowRated: 1 })
  })

  it('요약 폴백은 4점 이상만 고른다', () => {
    expect(pickSummaryFallbacks(text, 3).map((q) => q.text).sort()).toEqual(['거품이 잘 나서 매일 써요.', '색이 사진과 같아서 좋아요.'].sort())
  })
})

describe('finishExcerptHighlights', () => {
  it('요약이 켜지면 원문 문장 1~2개로 — 출처를 찾으면 원본 평점·작성 월·가린 작성자, 출처보다 짧으면 후기 요약·원문', () => {
    const { highlights, dropped } = finishExcerptHighlights(
      [
        { text: BODY1, author: '구매고객' },
        { text: '색감이 사진보다 예뻐요.', author: '구매고객' },
      ],
      SERIALIZED,
      { summary: true }
    )
    expect(dropped).toBe(0)
    expect(highlights).toEqual([
      {
        text: '손잡이가 편해서 매일 들고 다녀요. 거품도 잘 나요.',
        author: '김**',
        rating: 5,
        month: '2026.10',
        summary: true,
        original: BODY1,
      },
      // 출처 본문 그대로면 요약 표기 없이
      { text: '색감이 사진보다 예뻐요.', author: '구매고객', rating: 4 },
    ])
  })

  it('출처를 못 찾으면(붙여 넣은 원문) 평점·작성 월 없이 구매고객 — 지어내지 않는다', () => {
    const { highlights } = finishExcerptHighlights(
      [{ text: '물이 새지 않아서 좋아요.', author: '구매고객' }],
      '물이 새지 않아서 좋아요.',
      {
        summary: true,
      }
    )
    expect(highlights).toEqual([{ text: '물이 새지 않아서 좋아요.', author: '구매고객' }])
  })

  it('요약 문장이 없는 발췌는 빼고 세며, 같은 요약은 한 번만', () => {
    const { highlights, dropped } = finishExcerptHighlights(
      [
        { text: `손잡이가 ${'아주 '.repeat(30)}편해요`, author: '구매고객' },
        { text: '색감이 사진보다 예뻐요.', author: '구매고객' },
        { text: '색감이  사진보다 예뻐요.', author: '구매고객' },
      ],
      SERIALIZED,
      { summary: true }
    )
    expect(highlights.map((h) => h.text)).toEqual(['색감이 사진보다 예뻐요.'])
    expect(dropped).toBe(1)
  })

  it('요약을 끄면(짝 회차 대조군) 발췌 글 그대로 — 출처의 원본 평점·작성 월·가린 작성자는 붙인다(규칙)', () => {
    const { highlights } = finishExcerptHighlights(
      [{ text: '배송 빨리 왔어요. 손잡이가 편해서 매일 들고 다녀요.', author: '구매고객' }],
      SERIALIZED,
      { summary: false }
    )
    expect(highlights).toEqual([
      { text: '배송 빨리 왔어요. 손잡이가 편해서 매일 들고 다녀요.', author: '김**', rating: 5, month: '2026.10' },
    ])
  })
})

describe('효익으로 끝나는 문장을 먼저(2026-11-02)', () => {
  it('폴백·발췌 마무리 모두 산 계기 문장을 건너뛴다', () => {
    const body = '허전해서 소품을 두고 싶었거든요. 올려 두니 책상이 깔끔해요.'
    const text = serializeForTest(body)
    expect(pickSummaryFallbacks(text).map((q) => q.text)).toEqual(['올려 두니 책상이 깔끔해요.'])
    const { highlights } = finishExcerptHighlights([{ text: body, author: '구매고객' }], text, { summary: true })
    expect(highlights.map((h) => h.text)).toEqual(['올려 두니 책상이 깔끔해요.'])
  })
})

describe('pickSummaryFallbacks', () => {
  it("직렬화면 고평점(4~5)·도움 수 순으로 리뷰마다 원문 문장 1~2개 — '사진보다'에서 끊지 않는다", () => {
    expect(pickSummaryFallbacks(SERIALIZED).map((q) => q.text)).toEqual([
      '손잡이가 편해서 매일 들고 다녀요. 거품도 잘 나요.',
      '색감이 사진보다 예뻐요.',
    ])
  })

  it('붙여 넣은 원문은 줄마다 — 구매·배송 정황뿐인 줄은 건너뛴다, 상한까지', () => {
    const pasted =
      '색감이 사진보다 예뻐요\n배송이 빨라요\n손잡이가 편해요 매일 써요\n뚜껑이 단단하게 잠겨요\n가볍고 튼튼해요 정말로'
    expect(pickSummaryFallbacks(pasted).map((q) => q.text)).toEqual([
      '색감이 사진보다 예뻐요',
      '손잡이가 편해요 매일 써요',
      '뚜껑이 단단하게 잠겨요',
    ])
  })
})

describe('발췌 마무리 경계(P1-6 검수 반영)', () => {
  const TITLED = [
    '[리뷰1] 평점 5/5 · 도움 0',
    '제목: 손잡이가 정말 편한 브러쉬예요.',
    '내용: 머리 감을 때 손이 덜 아파요.',
  ].join('\n')

  it("제목에서 찾은 발췌는 원본 평점만 — 본문과 대조할 수 없어 '후기 요약'을 붙이지 않는다", () => {
    const { highlights } = finishExcerptHighlights(
      [{ text: '손잡이가 정말 편한 브러쉬예요.', author: '구매고객' }],
      TITLED,
      {
        summary: true,
      }
    )
    expect(highlights).toEqual([{ text: '손잡이가 정말 편한 브러쉬예요.', author: '구매고객', rating: 5 }])
  })

  it('CRLF로 붙여 넣은 직렬화 텍스트도 같은 리뷰로 읽는다', () => {
    expect(parseSerializedReviewList(SERIALIZED.replace(/\n/g, '\r\n'))).toEqual(parseSerializedReviewList(SERIALIZED))
  })

  it('붙여 넣은 원문이 한 문단이어도 폴백은 문장마다 한 장', () => {
    const pasted =
      '아이 생일파티에 썼는데 다들 좋아했어요. 돌리기만 하면 돼서 사용이 쉽습니다. 꽃가루 색이 화려해서 사진이 예쁘게 나와요.'
    expect(pickSummaryFallbacks(pasted).map((q) => q.text)).toEqual([
      '아이 생일파티에 썼는데 다들 좋아했어요.',
      '돌리기만 하면 돼서 사용이 쉽습니다.',
      '꽃가루 색이 화려해서 사진이 예쁘게 나와요.',
    ])
  })
})
