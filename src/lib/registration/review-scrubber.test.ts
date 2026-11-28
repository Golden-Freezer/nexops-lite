/**
 * 리뷰 인용 대조·폴백 — 붙여넣은 평문(기존 동작)과 자사 리뷰 파일 직렬화 형식(pdp-review-input: 평점·도움 수 랭킹)을 고정한다.
 */

import { describe, expect, it } from 'vitest'
import {
  isQuoteSafe,
  pickQuoteFallbacks,
  quoteBlockReason,
  benefitReviewSentences,
  summarizeReviewSentences,
  blocksPurchase,
  validateReviewQuotes,
} from './review-scrubber'
import { serializeReviews } from './reviews/review-sample'

describe('pickQuoteFallbacks — 평문(붙여넣기)', () => {
  it('등장 순서로 안전·경험 문장을 고른다(구매 정황·금지 표현 제외)', () => {
    const text =
      '배송이 빨라서 좋았어요. 손잡이가 편해서 매일 들고 다녀요. 최고의 제품이에요. 설거지가 정말 간편해졌어요.'
    expect(pickQuoteFallbacks(text).map((q) => q.text)).toEqual([
      '손잡이가 편해서 매일 들고 다녀요.',
      '설거지가 정말 간편해졌어요.',
    ])
  })
})

describe('pickQuoteFallbacks — 자사 리뷰 파일 직렬화 형식', () => {
  const stats = { total_rows: 4, text_review_count: 4, rating_counts: { '5': 2, '4': 1, '2': 1 } }
  const text = serializeReviews(
    [
      {
        id: 1,
        rating: 5,
        helped: 1,
        title: '만족',
        body: '손잡이가 편해서 매일 들고 다녀요. 색도 예뻐요.',
        option: '블랙',
      },
      { id: 2, rating: 2, helped: 9, title: '', body: '뚜껑이 조금 헐거워서 아쉬웠어요.', option: '' },
      { id: 3, rating: 4, helped: 7, title: '', body: '설거지가 정말 간편해졌어요. 추천합니다.', option: '' },
      {
        id: 4,
        rating: 5,
        helped: 3,
        title: '',
        body: `가볍고 튼튼해서 여행 갈 때 꼭 챙겨요. ${'아주 '.repeat(120)}마음에 들어`,
        option: '',
      },
    ],
    stats,
    10_000
  )

  it('고평점(4~5)만, 도움 수 많은 순, 리뷰당 한 문장 — 머리말·[리뷰N]·제목 줄은 고르지 않는다', () => {
    const quotes = pickQuoteFallbacks(text).map((q) => q.text)
    expect(quotes).toEqual([
      '설거지가 정말 간편해졌어요.',
      '가볍고 튼튼해서 여행 갈 때 꼭 챙겨요.',
      '손잡이가 편해서 매일 들고 다녀요.',
    ])
    for (const q of quotes) expect(q).not.toMatch(/리뷰|평점|도움|내용:/)
  })

  it('직렬화에서 잘린 본문(…)의 마지막 미완성 문장은 쓰지 않는다', () => {
    // 첫 문장(281자)은 길어서 못 쓰고, 둘째 문장은 300자에서 잘려 '손잡이가 편해서 매일 들고 다니는…'만 남는다
    const body = `${'가'.repeat(279)}요. 손잡이가 편해서 매일 들고 다니는데 아주 만족스럽고 가볍습니다.`
    const stats1 = { total_rows: 1, text_review_count: 1, rating_counts: { '5': 1 } }
    const cut = serializeReviews([{ id: 1, rating: 5, helped: 0, title: '', body, option: '' }], stats1, 10_000)
    expect(cut).toContain('손잡이가 편해서 매일 들고 다니는…')
    expect(pickQuoteFallbacks(cut)).toEqual([])
    // 잘리지 않은 같은 문장은 고른다(대조군)
    const whole = serializeReviews(
      [
        {
          id: 1,
          rating: 5,
          helped: 0,
          title: '',
          body: '손잡이가 편해서 매일 들고 다니는데 아주 만족스럽고 가볍습니다.',
          option: '',
        },
      ],
      stats1,
      10_000
    )
    expect(pickQuoteFallbacks(whole).map((q) => q.text)).toEqual([
      '손잡이가 편해서 매일 들고 다니는데 아주 만족스럽고 가볍습니다.',
    ])
  })

  it('직렬화 텍스트의 머리말·[리뷰N] 메타 줄과 정화 표시가 든 문장은 인용으로 통과하지 않는다', () => {
    const withPii = serializeReviews(
      [
        {
          id: 1,
          rating: 5,
          helped: 2,
          title: '',
          body: '문의는 (연락처 삭제)로 주세요. 손잡이가 편해서 좋아요.',
          option: '블랙',
        },
      ],
      { total_rows: 1, text_review_count: 1, rating_counts: { '5': 1 } },
      10_000
    )
    const verified = validateReviewQuotes(
      [
        '리뷰 전체: 1건 (텍스트 리뷰 1건)',
        '평점 5/5 · 도움 2 · 옵션: 블랙',
        '문의는 (연락처 삭제)로 주세요',
        '손잡이가 편해서 좋아요',
      ],
      withPii
    )
    expect(verified.map((q) => q.text)).toEqual(['손잡이가 편해서 좋아요'])
  })

  it('직렬화 텍스트는 줄마다 대조한다 — 두 리뷰에 걸친 조각은 거절, 뒤에 덧붙인 평문 줄은 인정', () => {
    const appended = `${text}\n\n추가로 붙여 넣은 후기: 물빠짐이 좋아서 만족해요`
    expect(validateReviewQuotes(['추천합니다 가볍고 튼튼해서'], appended)).toEqual([])
    expect(validateReviewQuotes(['물빠짐이 좋아서 만족해요'], appended)).toEqual([
      { text: '물빠짐이 좋아서 만족해요', author: '구매고객' },
    ])
  })

  it('모델 인용 대조는 직렬화 텍스트 안의 본문 문장과 맞춰 본다', () => {
    const verified = validateReviewQuotes(['설거지가 정말 간편해졌어요', '없는 문장을 지어냈어요'], text)
    expect(verified).toEqual([{ text: '설거지가 정말 간편해졌어요', author: '구매고객' }])
  })
})

describe('quoteBlockReason — 인용 금지 사유(화면 표시용 분류)', () => {
  it('질병·의학 주장은 의학·기능성, 최상급·최초 단정은 최상급, 체험단·협찬은 대가성, 없으면 null — isQuoteSafe와 같은 판정', () => {
    const cases: Array<[string, string | null]> = [
      ['두피 염증이 가라앉았어요', '의학·기능성'],
      ['다이어트에 도움이 돼요', '의학·기능성'],
      ['효과 봤어요 추천해요', null],
      ['가장 좋은 선택이었어요', '최상급'],
      ['국내 최초라고 해서 샀어요', '최상급'],
      ['협찬으로 받았지만 솔직하게 써요', '대가성'],
      ['가볍고 손에 잘 맞아요', null],
    ]
    for (const [text, reason] of cases) {
      expect(quoteBlockReason(text), text).toBe(reason)
      expect(isQuoteSafe(text), text).toBe(reason === null)
    }
  })

  it('규제 표현(오너 지시 2026-10-30)만 막는다 — 인증·인허가 사칭·살균·절대 안전·환경 표시, 질병·의학·기능성 효능', () => {
    const cases: Array<[string, string]> = [
      ['KC 인증 받은 제품이라 골랐어요', '인증·인허가'],
      ['피부과 테스트 완료라고 해서 샀어요', '인증·인허가'],
      ['임상 결과가 있대요', '인증·인허가'],
      ['특허 받은 구조라 그런지 튼튼해요', '인증·인허가'],
      ['99.9% 살균된다고 해서 샀어요', '인증·인허가'],
      ['항균 소재라 안심이에요', '인증·인허가'],
      ['무독성이라 장난감으로도 써요', '인증·인허가'],
      ['친환경 소재라 마음에 들어요', '인증·인허가'],
      ['아토피 피부라 걱정했는데 괜찮아요', '의학·기능성'],
      ['손목 통증이 줄었어요', '의학·기능성'],
      ['혈액순환이 잘 되는 느낌', '의학·기능성'],
      ['쓰고 나서 미백 효과가 있어요', '의학·기능성'],
      ['탈모 예방에 좋다고 해서요', '의학·기능성'],
      ['주름 개선은 모르겠지만 촉촉해요', '의학·기능성'],
      ['여드름이 줄었어요', '의학·기능성'],
      ['의사 추천 제품이에요', '의학·기능성'],
    ]
    for (const [text, reason] of cases) {
      expect(quoteBlockReason(text), text).toBe(reason)
      expect(isQuoteSafe(text), text).toBe(false)
    }
  })

  it('사용 경험·체감 효익은 막지 않는다 — R6에서 실린 표현도 규제 표현이 아니면 인용할 수 있다(오너 지시)', () => {
    for (const text of [
      '빗질해도 엉키지 않아요',
      '감고 나면 두피가 시원해요',
      '드라이가 빨라요',
      '노폐물이 빠지는 느낌이 들어요',
      '쓰고 나면 두피 구석구석 개운해요',
      '솔질하면 두피 스케일링 받은 기분이에요',
      '모공까지 시원하게 닦여요',
      '끓는 물에 소독해서 써요',
      '식세기에 돌려도 변형 걱정 없어요',
      '생각보다 정리에 도움 되네요',
      '확실히 효과는 있는 듯해요',
      '저자극이라 매일 써도 괜찮아요',
      '목을 많이 숙이지 않아도 돼서 편해요',
      '엉킴 예방에 좋아요',
    ]) {
      expect(quoteBlockReason(text), text).toBeNull()
    }
  })

  it('질병·증상명이 홀로 나와도 막는다(인용 전용 묶음 — R6b P07 턱드름), 피부 접촉 감각은 통과', () => {
    expect(quoteBlockReason('강아지 턱드름 때문에 식기를 다 바꿨는데 이건 괜찮아요')).toBe('의학·기능성')
    expect(quoteBlockReason('여드름 패치 붙이고 자도 안 떨어져요')).toBe('의학·기능성')
    expect(quoteBlockReason('비듬이 눈에 띄어 고민이었어요')).toBe('의학·기능성')
    expect(quoteBlockReason('아이 피부에 닿아도 부드러워요')).toBeNull()
    expect(quoteBlockReason('감고 나면 두피가 시원해요')).toBeNull()
  })

  it('반려동물·피부 질환명(2026-10-31 R8 P07) — 인용 카드·후기 요약 모두 막는다, 피부 접촉은 통과', () => {
    for (const text of [
      '강아지 턱드름 때문에 식기를 다 바꿨는데, 진작 이걸로 살 걸 그랬어요',
      '고양이 외이염 때문에 고생했는데 잘 먹어요',
      '피부염 있는 아이도 잘 써요',
      '습진 때문에 바꿨어요',
      '탈모가 심해서 샀어요',
      '여드름 피부도 괜찮아요',
    ]) {
      expect(quoteBlockReason(text), text).toBe('의학·기능성')
    }
    // 후기 요약은 질환명 문장을 건너뛰고 다음 경험 문장을 고른다(문장을 고쳐 쓰지 않는다)
    expect(
      summarizeReviewSentences('강아지 턱드름 때문에 식기를 다 바꿨는데, 진작 이걸로 살 걸 그랬어요. 도자기라 뜨거운 물 소독도 가능해요.')
    ).toBe('도자기라 뜨거운 물 소독도 가능해요.')
    expect(summarizeReviewSentences('고양이 결막염이 있어요. 탈모도 심해요.')).toBeNull()
    expect(quoteBlockReason('피부에 닿는 부분이 부드러워요')).toBeNull()
  })

  it('인용 후보는 고지·부정 문맥도 센다 — 후기의 "치료용은 아니지만"도 의학 언급이다', () => {
    expect(quoteBlockReason('치료용은 아니지만 시원해요')).toBe('의학·기능성')
    expect(quoteBlockReason('의료기기는 아니지만 손에 잘 맞아요')).toBe('의학·기능성')
  })

  it('원문 대조·폴백 발췌도 같은 기준으로 뺀다(규제 표현이 든 문장은 인용으로 통과하지 않는다)', () => {
    const text = '피부과 테스트 완료 제품이래요. 손잡이가 편해서 매일 들고 다녀요. 아토피에도 괜찮대요.'
    expect(validateReviewQuotes(['피부과 테스트 완료 제품이래요', '손잡이가 편해서 매일 들고 다녀요'], text)).toEqual([
      { text: '손잡이가 편해서 매일 들고 다녀요', author: '구매고객' },
    ])
    expect(pickQuoteFallbacks(text).map((q) => q.text)).toEqual(['손잡이가 편해서 매일 들고 다녀요.'])
  })
})

describe('blocksPurchase — 구매를 막는 후기 문장', () => {
  it.each([
    '다른 판매자분들은 더 넉넉하게 넣어 주던데요',
    '다른판매자는 양이 더 많아요',
    '타 업체 제품이 더 나은 것 같아요',
    '반품하려다 귀찮아서 그냥 씁니다',
    '환불 받고 싶을 정도예요',
    '사이즈가 조금 아쉬워요',
    '기대보다 실망했어요',
    '돈 아까워요',
    '비추합니다',
    '받자마자 찢어졌어요',
    '이틀 만에 망가졌어요',
  ])('거른다: %s', (sentence) => {
    expect(blocksPurchase(sentence)).toBe(true)
  })

  it.each([
    '봉투 자체가 튼튼해서 찢어질 걱정 없음',
    '얇아서 쉽게 찢어지는 비닐이 아니라 힘이 있어요',
    '재질도 얇아 보이지 않아서 좋아요',
    '머리 감기 불편해서 샀는데 잘 쓰고 있어요',
    '엉킴 때문에 불편했는데 말끔하게 해결했어요',
    '러닝을 하는데 불편함 없이 편하게 썼어요',
    '후회 없는 구매예요',
    '불량 없이 잘 왔어요',
    '실망하지 않았어요',
    '아쉬운 점이 하나도 없어요',
    '돈이 아깝지 않아요',
    '안 깨졌어요',
    '다른 제품보다 마음에 들어요',
    '다음에도 또 구매하자고 했어요',
  ])('살린다: %s', (sentence) => {
    expect(blocksPurchase(sentence)).toBe(false)
  })

  it('요약은 그 문장을 건너뛰고 다음 문장을 쓴다 — 쓸 문장이 없으면 null', () => {
    const next = '다른 판매자분들은 더 넉넉하게 넣어 주던데요. 끈을 당기면 바로 닫혀서 편해요.'
    expect(summarizeReviewSentences(next)).toBe('끈을 당기면 바로 닫혀서 편해요.')
    expect(summarizeReviewSentences('반품하려다 귀찮아서 그냥 씁니다.')).toBeNull()
  })
})

describe('summarizeReviewSentences — 후기 요약(P1-6, 발췌형)', () => {
  it('구매·배송 정황 문장은 건너뛰고, 처음 쓸 수 있는 문장과 바로 뒤 문장을 70자 안에서 잇는다', () => {
    expect(summarizeReviewSentences('배송 빨리 왔어요. 아이가 매일 들고 다녀요. 색감이 사진보다 예뻐요. 또 살게요.')).toBe(
      '아이가 매일 들고 다녀요. 색감이 사진보다 예뻐요.'
    )
  })

  it('뒤 문장을 이으면 70자를 넘으면 한 문장만 — 문장을 자르지 않는다', () => {
    const long = `손잡이가 길어서 ${'아주 '.repeat(20)}편해요.`
    expect(summarizeReviewSentences(`거품이 잘 나서 머리 감기가 편해졌어요. ${long}`)).toBe('거품이 잘 나서 머리 감기가 편해졌어요.')
  })

  it('70자 안에 들어오는 쓸 수 있는 문장이 없으면 null — 그 리뷰는 카드에서 뺀다', () => {
    expect(summarizeReviewSentences(`손잡이가 ${'아주 '.repeat(30)}편해요.`)).toBeNull()
    expect(summarizeReviewSentences('주문하고 이틀 만에 도착했어요.')).toBeNull()
    expect(summarizeReviewSentences('좋아요')).toBeNull()
    expect(summarizeReviewSentences('')).toBeNull()
  })

  it('규제·최상급·대가성 문장과 조각 문장은 쓰지 않는다 — 다음 문장으로 넘어간다', () => {
    expect(summarizeReviewSentences('아토피가 나았어요. 촉감이 부드러워서 잘 써요.')).toBe('촉감이 부드러워서 잘 써요.')
    expect(summarizeReviewSentences('이 가격에 최고예요. 뚜껑이 단단하게 잠겨요.')).toBe('뚜껑이 단단하게 잠겨요.')
  })

  it('요약은 원문 문장 그대로다 — 공백만 정리하고 숫자·말을 더하지 않는다', () => {
    const text = '물병이   가볍고\n손에 잘 맞아요. 하루 두 번 씻어도 냄새가 안 배요.'
    const summary = summarizeReviewSentences(text)!
    expect(summary).toBe('물병이 가볍고 손에 잘 맞아요. 하루 두 번 씻어도 냄새가 안 배요.')
    expect(text.replace(/\s+/g, ' ')).toContain(summary)
  })

  it("말끝 '요·다'로 끝나는 낱말('사진보다'·'필요') 뒤에서 문장을 나누지 않는다 — 문장부호로만", () => {
    expect(summarizeReviewSentences('색이 사진보다 예뻐요.')).toBe('색이 사진보다 예뻐요.')
    expect(summarizeReviewSentences('따로 필요 없이 바로 써서 편해요. 세척도 쉬워요.')).toBe('따로 필요 없이 바로 써서 편해요. 세척도 쉬워요.')
    // 문장부호 없는 긴 글은 나누지 않고 통째로 본다 — 70자를 넘으면 쓰지 않는다
    expect(summarizeReviewSentences(`가볍고 좋아요 ${'색도 예뻐요 '.repeat(12)}`)).toBeNull()
  })

  it('마침표 뒤에 띄어쓰지 않아도, ~·ㅎㅎ·이모지 뒤에서도 문장을 나눈다 — 소수점(1.5)은 아니다', () => {
    expect(summarizeReviewSentences('손잡이가 편해요.색도 사진이랑 같아서 좋아요.')).toBe('손잡이가 편해요. 색도 사진이랑 같아서 좋아요.')
    expect(summarizeReviewSentences('물이 1.5L 들어가서 넉넉해요.')).toBe('물이 1.5L 들어가서 넉넉해요.')
    expect(summarizeReviewSentences(`매일 들고 다녀요 ㅎㅎ ${'색도 예쁘고 '.repeat(12)}좋아요.`)).toBe('매일 들고 다녀요 ㅎㅎ')
    expect(summarizeReviewSentences(`손잡이가 편해요~ ${'정말 '.repeat(30)}좋아요.`)).toBe('손잡이가 편해요~')
  })

  it('여러 조각의 마지막 조각은 문장 끝 표시가 있을 때만 — 말끝에서 잘린 꼬리를 요약으로 쓰지 않는다', () => {
    // 인용 후보는 150자 안의 말끝('쓰다 보니'의 '쓰다 ')에서 잘릴 수 있다
    expect(summarizeReviewSentences('너무 예뻐요. 아침마다 들고 다니는데 하루 종일 쓰다')).toBeNull()
    expect(summarizeReviewSentences('색감이 예뻐요. 아침마다 들고 다니는데 하루 종일 편해요.')).toBe(
      '색감이 예뻐요. 아침마다 들고 다니는데 하루 종일 편해요.'
    )
  })

  it('잘린 본문(…)의 마지막 문장은 쓰지 않는다', () => {
    expect(summarizeReviewSentences('색감이 예뻐요. 손잡이가 조금…')).toBe('색감이 예뻐요.')
  })
})

describe('summarizeReviewSentences — 효익으로 끝나는 문장을 먼저(2026-11-02)', () => {
  it('산 계기·고민 문장을 건너뛰고 효익 문장을 고른다 — 문장을 고쳐 쓰지 않는다', () => {
    const text = '책상이 허전해서 소품을 두고 싶었거든요. 쓸 때마다 짜증이 났어요. 올려 두니 책상이 훨씬 깔끔해요.'
    const summary = summarizeReviewSentences(text)!
    expect(summary).toBe('올려 두니 책상이 훨씬 깔끔해요.')
    expect(text).toContain(summary)
  })

  it('효익 문장 바로 뒤 문장도 효익이고 70자 안이면 둘 다, 아니면 하나', () => {
    expect(summarizeReviewSentences('베란다를 꾸미고 있어요. 손잡이가 편해요. 색도 사진처럼 예뻐요.')).toBe('손잡이가 편해요. 색도 사진처럼 예뻐요.')
    expect(summarizeReviewSentences('손잡이가 편해요. 어머니가 쓰고 계세요.')).toBe('손잡이가 편해요.')
    const long = `손잡이가 길어서 ${'아주 '.repeat(15)}편해요.`
    expect(summarizeReviewSentences(`거품이 잘 나서 머리 감기가 편해졌어요. ${long}`)).toBe('거품이 잘 나서 머리 감기가 편해졌어요.')
  })

  it('효익 문장이 없으면 예전 기준 — 처음 쓸 수 있는 문장과 바로 뒤 문장', () => {
    const text = '아침마다 들고 다녀요. 어머니가 쓰고 계세요. 동생도 가져갔어요.'
    expect(benefitReviewSentences(text)).toBeNull()
    expect(summarizeReviewSentences(text)).toBe('아침마다 들고 다녀요. 어머니가 쓰고 계세요.')
  })

  it('규제 표현·구매 막는 문장·구매 정황은 효익 낱말이 있어도 고르지 않는다', () => {
    expect(summarizeReviewSentences('아토피가 좋아졌어요. 받침이 잘 맞아요.')).toBe('받침이 잘 맞아요.')
    expect(summarizeReviewSentences('반품하려다 그냥 좋아요. 받침이 잘 맞아요.')).toBe('받침이 잘 맞아요.')
    expect(summarizeReviewSentences('배송이 빨라서 좋아요. 받침이 잘 맞아요.')).toBe('받침이 잘 맞아요.')
  })

  it('쓸 수 있는 문장이 없으면 효익 낱말이 있어도 null — 카드 수가 효익 기준으로 움직이지 않는다', () => {
    const runOn = `손잡이가 정말 좋아요 ${'색도 예뻐요 '.repeat(12)}`
    expect(benefitReviewSentences(runOn)).toBe('손잡이가 정말 좋아요')
    expect(summarizeReviewSentences(runOn)).toBeNull()
  })

  it('문장부호 없이 이어 쓴 글은 말끝에서 나눈 효익 조각 하나 — 끊긴 꼬리는 쓰지 않는다', () => {
    const text = '물이 시원하게 잘 빠져요 출근이 잦아서 가방이 무거운 편이고.. 어머니가 쓰고 계세요.'
    expect(summarizeReviewSentences(text)).toBe('물이 시원하게 잘 빠져요')
    // 낱말 '필요' 뒤에서는 나누지 않는다
    expect(benefitReviewSentences(`손잡이가 편한 제품이 필요 없을 만큼 ${'아주 '.repeat(25)}길게 썼어요 어머니가 쓰고 계세요.`)).toBeNull()
  })

  it('잘린 꼬리일 수 있는 마지막 조각은 효익 낱말이 있어도 고르지 않는다', () => {
    expect(benefitReviewSentences('어머니가 쓰고 계세요. 손잡이가 정말 편하고 좋')).toBeNull()
    expect(benefitReviewSentences('어머니가 쓰고 계세요. 손잡이가 정말 편해요 색도 좋…')).toBeNull()
    expect(summarizeReviewSentences('어머니가 쓰고 계세요. 손잡이가 정말 편하고 좋')).toBe('어머니가 쓰고 계세요.')
  })
})

describe('validateReviewQuotes — 후기 요약이 켜지면 자르지 않는다(P1-6)', () => {
  it('clip:false면 60자를 넘는 발췌도 그대로 넘긴다(발췌 마무리가 원문 문장 1~2개로 다시 고른다), 기본은 60자 자르기 그대로', () => {
    const long = '손잡이가 편해서 매일 들고 다녀요. 거품도 잘 나고 머리 감을 때 손이 덜 아파서 아침마다 쓰게 돼요. 색도 예뻐요.'
    expect(long.length).toBeGreaterThan(60)
    const text = `리뷰 원문입니다. ${long}`
    expect(validateReviewQuotes([long], text, 3, { clip: false })[0].text).toBe(long)
    expect(validateReviewQuotes([long], text)[0].text).toBe(long.slice(0, 60))
  })
})
