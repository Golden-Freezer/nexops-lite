/**
 * 리뷰 입력(pdp-review-input) — 파서·개인정보 정화·층별 표집·직렬화·경쟁사 상한을 가짜 엑셀(시험 안에서 SheetJS로 만든다)로 고정한다.
 * 실제 오너 파일·개인정보는 쓰지 않는다.
 */

import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import { monthOf, parseReviewWorkbook } from './review-excel-parser'
import { maskAuthor } from '../review-scrubber'
import { competitorNames, containsName, sanitizeReviews, scrubPii, stripNames } from './review-sanitize'
import { sampleReviews, serializeReviews } from './review-sample'
import { intakeReviewFile } from './review-intake'
import { readCompetitorReviews } from './competitor-reviews'
import {
  COMPETITOR_SAMPLE_LIMIT,
  COMPETITOR_TEXT_MAX_CHARS,
  OWN_SERIALIZE_MAX_CHARS,
  type ParsedReview,
} from './review-types'
import type { PdpSpecSheet } from '../pdp-state'

const HEADER = [
  '작성일',
  '리뷰어번호',
  '이름',
  '판매자',
  '상품옵션명',
  '평점',
  '리뷰제목',
  '리뷰내용',
  '사진수',
  '도움',
  '도움된인원수',
]

function row(o: {
  name?: string
  seller?: string
  option?: string
  rating?: number | string | null
  title?: string
  body?: string
  helped?: number
}) {
  return [
    '2026-01-01',
    'R123',
    o.name ?? '김*희',
    o.seller ?? '페어넥스',
    o.option ?? '블랙 1개',
    o.rating ?? 5,
    o.title ?? '',
    o.body ?? '',
    0,
    'Y',
    o.helped ?? 0,
  ]
}

function workbook(sheets: Array<[string, unknown[][]]>): Uint8Array {
  const wb = XLSX.utils.book_new()
  for (const [name, rows] of sheets) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name)
  return new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer)
}

function review(rating: number | null, body: string, helped = 0): ParsedReview {
  return { rating, title: '', body, option: '', helped }
}

describe('parseReviewWorkbook', () => {
  it('헤더로 리뷰 시트를 찾고(앞 시트가 옵션판매비율이어도) 열을 이름으로 매핑한다 — 리뷰어번호는 읽지 않고 이름은 가린 꼴만(P1-6)', () => {
    const bytes = workbook([
      [
        '옵션판매비율',
        [
          ['옵션명', '수량', '판매비율'],
          ['블랙', 3, '60%'],
        ],
      ],
      [
        '전체리뷰',
        [
          HEADER,
          row({ name: '홍*동', rating: 5, title: '좋아요', body: '튼튼하고 손잡이가 편합니다.', helped: 4 }),
          row({ rating: 4, body: '' }), // 별점만 — 목록에서 빠지고 분포에는 센다
          row({ rating: '3', body: '뚜껑이 조금 뻑뻑해요.', seller: '다른상점' }),
        ],
      ],
    ])
    const parsed = parseReviewWorkbook(bytes)
    expect(parsed.stats).toEqual({ total_rows: 3, text_review_count: 2, rating_counts: { '5': 1, '4': 1, '3': 1 } })
    expect(parsed.reviews[0]).toEqual({
      rating: 5,
      title: '좋아요',
      body: '튼튼하고 손잡이가 편합니다.',
      option: '블랙 1개',
      helped: 4,
      month: '2026.01',
      author: '홍**',
    })
    expect(parsed.sellers.sort()).toEqual(['다른상점', '페어넥스'])
    // 쉼표 없는 옵션('블랙 1개')은 상품명으로 보지 않는다
    expect(parsed.productTitles).toEqual([])
    expect(JSON.stringify(parsed.reviews)).not.toContain('홍*동')
    expect(JSON.stringify(parsed.reviews)).not.toContain('R123')
  })

  it('헤더를 못 찾으면 평균 30자 이상인 가장 긴 열을 본문으로 본다, 그것도 없으면 오류', () => {
    const long = '이 제품은 생각보다 훨씬 튼튼하고 마감이 깔끔해서 매일 잘 쓰고 있습니다'
    const parsed = parseReviewWorkbook(
      workbook([
        [
          'Sheet1',
          [
            ['a', 'b'],
            ['x', long],
            ['y', long + '!'],
          ],
        ],
      ])
    )
    expect(parsed.reviews.map((r) => r.body)).toEqual([long, long + '!'])
    expect(() => parseReviewWorkbook(workbook([['Sheet1', [['a'], ['짧음']]]]))).toThrow(/형식/)
  })
})

describe('개인정보 정화', () => {
  it('연락처·이메일·링크·주민번호·주문번호·주소·동호를 지운다', () => {
    const out = scrubPii(
      '010-1234-5678 02-123-4567 a.b@x.com https://x.kr/a 900101-1234567 주문번호 2026123456789 송장 2026012312345678 ' +
        '서울특별시 강남구 역삼동 123-45 경기 성남시 분당구 정자로 12 101동 1203호로 받았어요 서초구 반포대로 58 앞 마포구 성산동 123-45 쪽'
    )
    for (const leaked of [
      '010-1234',
      '02-123',
      'a.b@x',
      'x.kr',
      '900101',
      '2026123456789',
      '2026012312345678',
      '강남구',
      '성남시',
      '1203호',
      '반포대로',
      '성산동',
    ]) {
      expect(out).not.toContain(leaked)
    }
    expect(out).toContain('(연락처 삭제)')
    expect(out).toContain('(주소 삭제)')
  })

  it('일상 문장(치수·날짜·지역명·가격)은 건드리지 않는다', () => {
    for (const text of [
      '가로 10cm 세로 20cm라 사용시 입구가 넓어요. 5개 3000원이면 괜찮아요.',
      '245 250 255 260 사이즈 다 있어요',
      '2026-10-28 12:30에 받았어요',
      '제주 서귀포시 여행 필수템이에요',
      '친구 추천으로 2개 샀어요',
      '가구 뒤로 10cm 띄웠어요',
      '운동기구 자동 3단계로 써요',
      '도구 그대로 3년 썼어요',
      '야구 연습용으로 5개 샀어요',
    ]) {
      expect(scrubPii(text)).toBe(text)
    }
  })

  it('중복·개인정보만 남은 행을 버리고, 경쟁사 판매자명(법인 표기 뗀 변형 포함)을 지운다', () => {
    const names = competitorNames(['라스(주)', '쿠팡(주)']).strip
    expect(names).toEqual(expect.arrayContaining(['라스(주)', '라스', '쿠팡(주)', '쿠팡']))
    const { reviews, dropped } = sanitizeReviews(
      [
        review(5, '라스 제품 처음인데 튼튼해요'),
        review(5, '라스 제품 처음인데 튼튼해요!'), // 정규화하면 같은 글
        review(4, '010-1111-2222'),
      ],
      { removeNames: names }
    )
    expect(dropped).toBe(2)
    expect(reviews).toHaveLength(1)
    expect(reviews[0].body).toBe('(상호 삭제) 제품 처음인데 튼튼해요')
  })

  it('상품명 전체·영문 브랜드는 지우고 검사하며, 한글 앞머리는 지우기만, 영문 약어는 어디에도 넣지 않는다', () => {
    const { strip: names, check } = competitorNames(
      ['쿠팡(주)'],
      [
        '라이프팁스 나무 갈고리 안마기',
        'TRAVEL BUDDY 원형크림 용기 3.8 x 2 cm',
        '[1+1] 별오점 엉킨 머리 빗',
        '1+1 세트',
        'USB 충전식 무선 선풍기',
      ]
    )
    expect(names).toEqual(
      expect.arrayContaining([
        '라이프팁스 나무 갈고리 안마기',
        '라이프팁스',
        'TRAVEL BUDDY',
        '별오점 엉킨 머리 빗',
        '별오점',
      ])
    )
    expect(names).not.toContain('1+1')
    expect(names).not.toContain('USB')
    expect(stripNames('travel buddy 뚜껑이 헐거워요', names)).toBe('(상호 삭제) 뚜껑이 헐거워요')
    expect(stripNames('USB-C 포트가 헐거워요', names)).toBe('USB-C 포트가 헐거워요')
    // 검사 목록: 판매자명·상품명 전체·영문 브랜드만 — 한글 앞머리(일반어일 수 있다)는 빠진다
    expect(check).toEqual(
      expect.arrayContaining([
        '쿠팡(주)',
        '쿠팡',
        '라이프팁스 나무 갈고리 안마기',
        'TRAVEL BUDDY',
        'USB 충전식 무선 선풍기',
      ])
    )
    for (const lead of ['라이프팁스', '별오점', 'USB']) expect(check).not.toContain(lead)
  })

  it('두 글자 이름은 앞이 글자가 아닐 때만 지운다(일반어 속 부분 문자열은 그대로)', () => {
    expect(stripNames('라스 제품인데 플라스틱 냄새가 나요. 라스가 낫네요', ['라스'])).toBe(
      '(상호 삭제) 제품인데 플라스틱 냄새가 나요. (상호 삭제)가 낫네요'
    )
    expect(containsName('플라스틱 냄새', ['라스'])).toBe(false)
    expect(containsName('라스 뚜껑 불량', ['라스'])).toBe(true)
  })
})

describe('층별 표집', () => {
  const pool: ParsedReview[] = [
    ...Array.from({ length: 80 }, (_, i) => review(5, `좋아요 ${'가'.repeat(i % 40)}`, i % 3)),
    ...Array.from({ length: 15 }, (_, i) => review(4, `괜찮아요 ${'나'.repeat(i)}`)),
    ...Array.from({ length: 4 }, (_, i) => review(2, `아쉬워요 ${'다'.repeat(i * 5)}`)),
    review(1, '별로예요'),
  ]

  it('평점 분포를 유지하고(비어 있지 않은 층 최소 1건) 층 안에서는 긴 리뷰가 먼저다', () => {
    const sampled = sampleReviews(pool, 20)
    const count = (r: number) => sampled.filter((s) => s.rating === r).length
    expect(sampled).toHaveLength(20)
    // 비례 몫 16·3·0.8·0.2 → 최소 1건 보장으로 넘친 1건은 가장 큰 층에서 던다
    expect([count(5), count(4), count(2), count(1)]).toEqual([15, 3, 1, 1])
    expect(sampled.map((s) => s.id)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1))
    const picked = sampled.filter((s) => s.rating === 5)
    const rest = pool.filter((r) => r.rating === 5 && !picked.some((s) => s.body === r.body))
    expect(Math.min(...picked.map((s) => s.body.length))).toBeGreaterThanOrEqual(
      Math.max(...rest.map((r) => r.body.length))
    )
    // 앞부분에도 층이 섞인다(리서치는 앞 4,000자만 본다)
    expect(sampled.slice(0, 4).map((s) => s.rating)).toEqual([5, 4, 2, 1])
  })

  it('건수가 상한 이하면 전부 싣는다', () => {
    expect(sampleReviews(pool.slice(0, 7), 100)).toHaveLength(7)
  })
})

describe('intakeReviewFile', () => {
  const rows = [
    HEADER,
    row({ rating: 5, title: '만족', body: '손잡이가 편하고 튼튼해요. 매일 씁니다.', helped: 2, option: '화이트' }),
    row({ rating: 2, body: '뚜껑이 헐거워서 국물이 샜어요. 010-9999-8888로 연락 주세요.' }),
    row({ rating: 5, body: '손잡이가 편하고 튼튼해요. 매일 씁니다.' }), // 중복
  ]

  it('자사: 개인정보를 지운 직렬화 텍스트(옵션 포함)와 메타를 돌려준다', () => {
    const out = intakeReviewFile(workbook([['전체리뷰', rows]]), 'own', 'C:\\x\\리뷰다운로드.xlsx')
    if (out.kind !== 'own') throw new Error('kind')
    expect(out.meta).toEqual({
      fileName: '리뷰다운로드.xlsx',
      stats: { total_rows: 3, text_review_count: 3, rating_counts: { '5': 2, '2': 1 } },
      sampled: 2,
      dropped: 1,
    })
    expect(out.reviewsText).toContain('리뷰 전체: 3건 (텍스트 리뷰 3건) · 평점 분포: 5점 2 / 2점 1')
    expect(out.reviewsText).toMatch(
      /\[리뷰\d\] 평점 5\/5 · 도움 2 · 작성 2026\.01 · 작성자 김\*\* · 옵션: 화이트\n제목: 만족\n내용: 손잡이가 편하고/
    )
    expect(out.reviewsText).not.toContain('010-9999')
    expect(out.reviewsText).not.toContain('김*희')
    expect(out.reviewsText.length).toBeLessThanOrEqual(OWN_SERIALIZE_MAX_CHARS)
  })

  it('자사: 인용 후보(W2a)는 정화한 리뷰에서 — 중복 한 번, 4~5점 먼저, 개인정보·이름 없음', () => {
    const out = intakeReviewFile(workbook([['전체리뷰', rows]]), 'own', '리뷰.xlsx')
    if (out.kind !== 'own') throw new Error('kind')
    expect(out.reviewCandidates.map((c) => [c.rating, c.option])).toEqual([
      [5, '화이트'],
      [2, '블랙 1개'],
    ])
    expect(out.reviewCandidates[0].text).toBe('손잡이가 편하고 튼튼해요. 매일 씁니다.')
    expect(JSON.stringify(out.reviewCandidates)).not.toMatch(/010-9999|김\*희|R123/)
  })

  it('경쟁사: 옵션·판매자명 없이 항목만, 60건·10,000자 상한', () => {
    const many = [
      HEADER,
      ...Array.from({ length: 90 }, (_, i) =>
        row({
          seller: '라스(주)',
          rating: (i % 5) + 1,
          option: '라이프팁스 갈고리 안마기 블랙, 1개',
          body: `라스 제품 라이프팁스 갈고리 안마기 ${i}번째 후기 ${'불편'.repeat(150)}`,
        })
      ),
    ]
    const out = intakeReviewFile(workbook([['전체리뷰', many]]), 'competitor', '경쟁.xlsx')
    if (out.kind !== 'competitor') throw new Error('kind')
    const c = out.competitorReviews
    expect(c.items.length).toBeLessThanOrEqual(COMPETITOR_SAMPLE_LIMIT)
    expect(c.items.reduce((a, it) => a + it.title.length + it.body.length, 0)).toBeLessThanOrEqual(
      COMPETITOR_TEXT_MAX_CHARS
    )
    expect(JSON.stringify(c.items)).not.toMatch(/라스|라이프팁스|블랙/)
    expect(c.checkNames).toEqual(expect.arrayContaining(['라스(주)', '라스', '라이프팁스 갈고리 안마기 블랙']))
    expect(c.checkNames).not.toContain('라이프팁스')
    expect(c.removedNames).toEqual(
      expect.arrayContaining(['라스(주)', '라스', '라이프팁스 갈고리 안마기 블랙', '라이프팁스'])
    )
    expect(c.items.map((it) => it.id)).toEqual(c.items.map((_, i) => i + 1))
  })

  it('본문 있는 리뷰가 없으면 오류', () => {
    expect(() => intakeReviewFile(workbook([['전체리뷰', [HEADER, row({ body: '' })]]]), 'own', 'a.xlsx')).toThrow(
      /본문/
    )
  })
})

describe('readCompetitorReviews', () => {
  const base = { productName: 'x' } as PdpSpecSheet

  it('없거나 모양이 틀리면 null, 있으면 상한을 다시 걸어 정규화한다', () => {
    expect(readCompetitorReviews(base)).toBeNull()
    expect(readCompetitorReviews({ ...base, competitorReviews: { version: 2 } } as never)).toBeNull()
    const items = Array.from({ length: 80 }, (_, i) => ({
      id: i + 1,
      rating: 9,
      helped: -3,
      title: 't',
      body: 'b'.repeat(500),
    }))
    const read = readCompetitorReviews({
      ...base,
      competitorReviews: {
        version: 1,
        fileName: 'f',
        stats: {},
        dropped: 0,
        items,
        removedNames: ['라스', 1, 'x'],
        checkNames: ['라스', ' '],
      },
    } as never)!
    expect(read.items.length).toBeLessThanOrEqual(COMPETITOR_SAMPLE_LIMIT)
    expect(read.items[0]).toEqual({ id: 1, rating: null, helped: 0, title: 't', body: 'b'.repeat(300) })
    expect(read.removedNames).toEqual(['라스'])
    expect(read.checkNames).toEqual(['라스'])
    // 짧은 본문이면 글자 상한보다 건수 상한(60)이 먼저 걸린다
    const short = Array.from({ length: 80 }, (_, i) => ({ id: i + 1, rating: 5, helped: 0, title: '', body: '좋아요' }))
    const capped = readCompetitorReviews({
      ...base,
      competitorReviews: { version: 1, fileName: 'f', stats: {}, dropped: 0, items: short, removedNames: [] },
    } as never)!
    expect(capped.items).toHaveLength(COMPETITOR_SAMPLE_LIMIT)
  })

  it('경쟁사 직렬화는 옵션 없이 [리뷰N] 번호로', () => {
    const text = serializeReviews(
      [{ id: 1, rating: 2, helped: 0, title: '', body: '줄\n바꿈  본문', option: '숨김' }],
      { total_rows: 1, text_review_count: 1, rating_counts: { '2': 1 } },
      1000,
      { withOption: false }
    )
    expect(text).toContain('[리뷰1] 평점 2/5 · 도움 0\n내용: 줄 바꿈 본문')
    expect(text).not.toContain('숨김')
  })
})

describe('작성 월·가린 작성자(P1-6)', () => {
  it('작성일은 YYYY.MM으로 — 엑셀 날짜 일련번호·Date·여러 글 꼴, 알아볼 수 없으면 없다', () => {
    expect(monthOf(45658)).toBe('2025.01')
    expect(monthOf(new Date(2026, 9, 31))).toBe('2026.10')
    expect(monthOf('2026-10-15')).toBe('2026.10')
    expect(monthOf('2026.3.2 13:20')).toBe('2026.03')
    expect(monthOf('2026/12/01')).toBe('2026.12')
    expect(monthOf('2026년 7월')).toBe('2026.07')
    expect(monthOf('어제')).toBeUndefined()
    expect(monthOf('1999-01-01')).toBeUndefined()
    expect(monthOf('2026-13-01')).toBeUndefined()
    expect(monthOf(null)).toBeUndefined()
  })

  it('이름은 앞 한 글자만 남기고 가린다 — 쿠팡이 가운데를 가린 이름도 끝 글자를 가린다, 원래 이름은 어디에도 없다', () => {
    const bytes = workbook([
      [
        '전체리뷰',
        [
          HEADER,
          row({ name: '박서연', rating: 5, body: '손잡이가 편해서 매일 들고 다녀요.' }),
          row({ name: '', rating: 4, body: '색이 사진보다 예뻐요.' }),
        ],
      ],
    ])
    const parsed = parseReviewWorkbook(bytes)
    expect(parsed.reviews.map((r) => r.author)).toEqual(['박**', undefined])
    expect(JSON.stringify(parsed)).not.toMatch(/서연/)
    expect(maskAuthor('김*희')).toBe('김**')
    expect(maskAuthor('이도')).toBe('이*')
    expect(maskAuthor('happyday')).toBe('h***')
    // 한 글자 이름은 가려도 다 보이고, 글자로 시작하지 않는 칸은 이름이 아니다
    expect(maskAuthor('김')).toBe('구매고객')
    expect(maskAuthor('*희')).toBe('구매고객')
    expect(maskAuthor('(탈퇴회원)')).toBe('구매고객')
    expect(maskAuthor('  ')).toBe('구매고객')
  })

  it('자사 직렬화에만 작성 월·가린 작성자 — 경쟁사는 싣지 않는다', () => {
    const sampled = sampleReviews([{ ...review(5, '튼튼해요'), month: '2026.10', author: '김**' }], 10)
    const own = serializeReviews(sampled, { total_rows: 1, text_review_count: 1, rating_counts: { '5': 1 } }, 5000)
    expect(own).toContain('[리뷰1] 평점 5/5 · 도움 0 · 작성 2026.10 · 작성자 김**')
    const comp = serializeReviews(sampled, { total_rows: 1, text_review_count: 1, rating_counts: { '5': 1 } }, 5000, {
      withOption: false,
    })
    expect(comp).not.toMatch(/작성 2026|작성자/)
  })

  it('인용 후보에 작성 월·가린 작성자가 실린다', () => {
    const out = intakeReviewFile(
      workbook([['전체리뷰', [HEADER, row({ name: '이도윤', rating: 5, body: '거품이 잘 나고 손이 편해요.' })]]]),
      'own',
      '리뷰.xlsx'
    )
    if (out.kind !== 'own') throw new Error('kind')
    expect(out.reviewCandidates[0]).toMatchObject({ month: '2026.01', author: '이**' })
    expect(JSON.stringify(out)).not.toContain('도윤')
  })
})
