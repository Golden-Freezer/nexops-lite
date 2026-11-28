/**
 * 숫자·단위 대조(P0-2) — 최종 카피에 숫자로 쓴 값+단위가 입력에 없으면 찾는다. 숫자 없는 체감 표현·숫자 합성어는 보지 않는다.
 */

import { describe, expect, it } from 'vitest'
import {
  buildNumberRewriteDirective,
  buildNumberSources,
  findUnsupportedNumbers,
  normalizeNativeNumbers,
} from './copy-numbers'
import type { CopywritingResult, PdpSpecSheet } from './pdp-state'

const spec = (fields: Partial<PdpSpecSheet>) => ({ productName: '구디백', ...fields }) as PdpSpecSheet
const tokens = (copy: Record<string, unknown>, fields: Partial<PdpSpecSheet> = {}) =>
  findUnsupportedNumbers(copy as CopywritingResult, buildNumberSources(spec(fields))).map((f) => f.token)
const card = (...titles: string[]) => ({ pointCards: titles.map((title) => ({ title })) })

describe('findUnsupportedNumbers — 입력에 없는 숫자+단위', () => {
  it('입력에 없는 값을 찾고, 입력에 있으면 통과한다(칸·글자 그대로 기록)', () => {
    const found = findUnsupportedNumbers(
      { pointCards: [{ title: '30cm 넉넉한 길이', description: '48시간 지속되는 향' }] } as CopywritingResult,
      buildNumberSources(spec({ size: '길이 30cm' }))
    )
    expect(found).toEqual([{ path: 'pointCards[0].description', token: '48시간', text: '48시간 지속되는 향' }])
  })

  it('같은 양은 환산해 비교한다 — 1.5L = 1,500ml, 120g = 0.12kg, 1일 = 24시간, 1년 = 12개월, 3만원 = 30,000원', () => {
    const fields = {
      keyFeatures: ['1.5L 대용량', '무게 120g', '1일 보온 유지', '1년 품질 보증'],
      eventBannerInfo: '3만원 이상 무료배송',
    }
    expect(
      tokens(card('1,500ml 담는 용량', '0.12kg 가벼움', '24시간 보온', '12개월 보증', '30,000원 이상'), fields)
    ).toEqual([])
    expect(tokens(card('2,000ml', '150g', '36시간', '2년'), fields)).toEqual(['2,000ml', '150g', '36시간', '2년'])
  })

  it("입력의 순우리말 수를 숫자로 본다 — '하루 두 번' → 카피 '1일 2회'(번=회), '두 배' → '2배'", () => {
    expect(tokens(card('1일 2회 뿌려 주세요'), { usageLocation: '하루 두 번 뿌려 주세요' })).toEqual([])
    expect(tokens(card('1일 3회'), { usageLocation: '하루 두 번' })).toEqual(['3회'])
    expect(tokens(card('2배 넉넉한 양'), { keyFeatures: ['두 배 넉넉한 양'] })).toEqual([])
  })

  it("관용 표현은 수치 근거가 아니다 — '하루 종일'은 '24시간'을, '한 번에'는 '1회'를 받치지 않는다", () => {
    expect(tokens(card('24시간 보온'), { keyFeatures: ['하루 종일 따뜻하게'] })).toEqual(['24시간'])
    expect(tokens(card('1회로 끝'), { keyFeatures: ['한 번에 끝나는 청소'] })).toEqual(['1회'])
  })

  it('normalizeNativeNumbers — 세는 말과 함께 쓴 수만, 관용·다른 낱말은 그대로', () => {
    expect(normalizeNativeNumbers('하루 두 번씩, 한 달, 일주일, 일회용, 세 개')).toBe(
      '1일 2번씩, 1달, 1주일, 1회용, 3개'
    )
    expect(normalizeNativeNumbers('석 달, 두 배, 스무 장')).toBe('3달, 2배, 20장')
    for (const text of ['하루 종일', '하루하루', '피부 세포', '365일 년중무휴'])
      expect(normalizeNativeNumbers(text)).toBe(text)
    expect(normalizeNativeNumbers('한 번에 끝')).toBe('단번에 끝')
  })

  it('숫자 없이 말하는 체감 표현은 보지 않는다(오너 기준)', () => {
    expect(tokens(card('하루 종일 든든해요', '한 번 써 보면 알아요', '몇 시간이고 거뜬'))).toEqual([])
  })

  it('숫자 합성어는 숫자 주장이 아니다(통합 결정) — 1회성·1회용·1인분·500ml용·1:1, 관용 1도·등급', () => {
    expect(
      tokens(card('1회성 소분', '1회용 장갑', '1인분 포장', '500ml용 리필', '1:1 맞춤', '자극 1도 없는', '1등급 원단'))
    ).toEqual([])
    expect(tokens(card('2인분 포장', '판매 1등'))).toEqual(['2인분', '1등'])
  })

  it('범위·치수 묶음은 숫자마다 단위를 붙여 본다', () => {
    const fields = { size: '30 x 40 cm', extra: { 사용연령: '3~5세' } }
    expect(tokens(card('30x40cm 넉넉한 크기', '3세부터 5세까지'), fields)).toEqual([])
    expect(tokens(card('30x50cm', '3~7세'), fields)).toEqual(['30x50cm', '3~7세'])
  })

  it('입력 표기 — 대문자 단위·X·치수 머리글자·괄호 속 단위·한쪽에만 붙은 단위·°·～·같은 뜻 단위·RPM·금액 묶음', () => {
    const fields = {
      size: '가로 30 x 세로 40cm, W50×H60mm',
      weight: '2KG',
      keyFeatures: [
        '500ML 대용량',
        '30X45CM 원단',
        '360° 회전',
        '3～5세',
        '100매 구성',
        '10P 세트',
        '3만 RPM 모터',
        '1만 2천원 상당',
      ],
      extraSpecs: [{ key: '용량(ml)', value: '750' }],
    } as Partial<PdpSpecSheet>
    const copy = card(
      '가로 30cm',
      '45cm 넉넉한 원단',
      '2kg',
      '500ml',
      '50mm',
      '360도 회전',
      '5세까지',
      '100장',
      '10개',
      '분당 3만 회전',
      '12,000원',
      '750ml'
    )
    expect(tokens(copy, fields)).toEqual([])
  })

  it('짧은 칸에서 단위가 한쪽에만 붙은 치수는 그 칸의 숫자 모두에 단위를 붙인다 — 측정 단위(길이·무게·부피)일 때만', () => {
    expect(tokens(card('가로 30cm', '세로 40cm'), { size: '가로 30 x 세로 40cm' })).toEqual([])
    // 측정 단위가 아닌 단위(겹·개)는 같은 칸의 다른 숫자를 받치지 않는다 — '2겹'의 2가 '2개'를 받치지 않는다
    expect(tokens(card('2개 들어 있어요'), { keyFeatures: ['2겹 원단, 30개입'] })).toEqual(['2개'])
  })

  it("금액 묶음 '1만 5,000원'은 15,000원이다", () => {
    expect(tokens(card('15,000원 상당'), { eventBannerInfo: '1만 5,000원 상당 사은품' })).toEqual([])
    expect(tokens(card('5,000원 상당'), { eventBannerInfo: '1만 5,000원 상당 사은품' })).toEqual(['5,000원'])
  })

  it('사진 주소·경로 속 숫자는 근거가 아니다', () => {
    const fields = {
      extra: { 사진주소: 'https://cdn.example.com/item/30cm-5kg.jpg' },
    } as unknown as Partial<PdpSpecSheet>
    expect(tokens(card('30cm 길이', '5kg 무게'), fields)).toEqual(['30cm', '5kg'])
  })

  it("한글 단위는 숫자에 붙여 쓴 것만 — 'STEP 1 세척'·'POINT 2 분리형'·'TOP 3 일상템'·'1+1 구성'은 숫자+단위가 아니다", () => {
    expect(tokens(card('STEP 1 세척', 'POINT 2 분리형', 'TOP 3 일상템', '1+1 구성', '1+1 세트'))).toEqual([])
    // '+' 뒤 숫자는 묶음 표기의 일부다('1+1개'의 '1개'를 따로 보지 않는다)
    expect(tokens(card('1+1개 구성', '2+1개 묶음'))).toEqual([])
    expect(tokens(card('3만 원 할인'))).toEqual(['3만 원'])
  })

  it('입력의 숫자 칸은 칸마다 정한 단위만 받친다 — 평점 5가 5배·5년을, 완판 3차가 3일을 받치지 않는다', () => {
    const fields = { rating: 4.8, soldOutCount: 3, reviewCount: 1234, minAgeYears: '14' as unknown as number }
    expect(tokens(card('평점 4.8점', '3차 완판', '1,234개 후기', '만 14세 이상'), fields)).toEqual([])
    expect(tokens(card('평점 4.9점', '5차 완판', '3일 만에 효과', '14일 완성'), fields)).toEqual([
      '4.9점',
      '5차',
      '3일',
      '14일',
    ])
    const quoted = { reviewQuotes: [{ text: '좋아요', rating: 5 }] } as unknown as Partial<PdpSpecSheet>
    expect(tokens(card('5배 튼튼', '5년 보증', '5점 만족'), quoted)).toEqual(['5배', '5년'])
  })

  it('날짜는 이벤트 입력에서만 — 리뷰 직렬화의 평점 5/5·사진 경로는 날짜 근거가 아니다', () => {
    const fields = {
      eventBannerInfo: '3만원 이상 구매 시 5,000원 할인 (10/31까지)',
      certificationInfo: '레드닷 디자인 어워드 2025',
      reviewsText: '평점 5/5 — 빨리 왔어요',
      optionSpec: undefined,
      extra: { 사진: '/2023/05/12/10/3/photo.png' },
    }
    expect(tokens(card('5000원 할인', '30,000원 이상', '31일까지', '2025년 수상'), fields)).toEqual([])
    expect(tokens(card('5일 만에 도착', '12일 완성', '1만원 할인', '2024년 수상'), fields)).toEqual([
      '5일',
      '12일',
      '1만원',
      '2024년',
    ])
  })

  it("입력에서 계산되는 개수 — 색상 옵션 수가 카피의 'N개'를 받친다", () => {
    const fields = { colorOptions: ['레드', '블루', '골드', '믹스'] }
    expect(tokens(card('4개 컬러 중 고르기'), fields)).toEqual([])
    expect(tokens(card('5개 컬러 중 고르기'), fields)).toEqual(['5개'])
  })

  it("입력에서 계산되는 개수 — 등록 옵션 축마다 값 수도 카피의 'N개'를 받친다", () => {
    const optionSpec = {
      source: 'manual',
      axes: [{ kind: 'design', name: '디자인', values: ['A', 'B', 'C'] }],
      variants: [{ label: 'A', values: { design: 'A' } }],
    }
    const fields = { optionSpec } as unknown as Partial<PdpSpecSheet>
    expect(tokens(card('3개 디자인 중 고르기'), fields)).toEqual([])
    expect(tokens(card('4개 디자인 중 고르기'), fields)).toEqual(['4개'])
  })

  it("'N가지'·'N종류'·'N단계'는 보지 않고, 'N종'은 등록 옵션 구조가 없을 때만 본다(있으면 사실 값 정정이 맡는다)", () => {
    expect(tokens(card('7가지 디자인', '3종류', '3단계로 간편하게'))).toEqual([])
    expect(tokens(card('6종 구성'))).toEqual(['6종'])
    expect(tokens(card('디자인 1종'))).toEqual([])
    expect(tokens(card('4종 컬러'), { colorOptions: ['레드', '블루', '골드', '믹스'] })).toEqual([])
    expect(tokens(card('6종 구성'), { productName: '파티 6종 세트' })).toEqual([])
    const optionSpec = {
      source: 'manual',
      axes: [{ kind: 'design', name: '디자인', values: ['A', 'B'] }],
      variants: [{ label: 'A', values: { design: 'A' } }],
    }
    expect(tokens(card('6종 구성'), { optionSpec } as unknown as Partial<PdpSpecSheet>)).toEqual([])
  })

  it('다른 상품의 사실(경쟁사 리뷰·레퍼런스)은 입력으로 보지 않는다', () => {
    const fields = {
      competitorReviews: { reviews: ['48시간 지속돼요'] },
      referenceInputs: [{ summary: '48시간 보습' }],
    } as unknown as Partial<PdpSpecSheet>
    expect(tokens(card('48시간 지속'), fields)).toEqual(['48시간'])
  })

  it('화면에 안 나오는 칸·리뷰 원문 발췌·등록 옵션명·상품명·파생 칸은 보지 않는다', () => {
    const copy = {
      title: '구디백 20개입',
      reviewHighlights: [{ text: '3일 만에 왔어요' }],
      detailPoints: [{ claim: '튼튼해요', imageHint: '45도 각도에서 촬영' }],
      sections: [{ headline: '48시간 보습', image_direction: '85mm 렌즈' }],
      hero_copy: { benefit_headline: '48시간 보습' },
      section_copy_blocks: [{ headline: '48시간 보습' }],
      objection_handlers: [{ objection: '3일 안에 오나요?', answer: '48시간 보습' }],
      cta_variants: [{ type: 'rational', copy: '48시간 보습' }],
      colorOptions: { options: ['50개 세트'] },
      designPalette: { primary: '#1a1a1a' },
    }
    expect(tokens(copy)).toEqual([])
  })

  it('단위 낱말 경계 — 다른 낱말의 일부·분수·만점·통화는 숫자+단위로 보지 않는다', () => {
    expect(tokens(card('3min', '5gb', '3M 테이프', '3분의 1', '5점 만점', '2달러', '3차원', '10W30 오일'))).toEqual([])
  })

  it('같은 글의 같은 숫자는 칸이 달라도 한 번만 — 글이 다르면 따로', () => {
    const found = findUnsupportedNumbers(
      {
        mainIntro: { benefitHeadline: '48시간 보습' },
        keyMessageVariations: { top: '48시간 보습' },
        pointCards: [{ title: '48시간 48시간 지속' }],
      } as CopywritingResult,
      buildNumberSources(spec({}))
    )
    expect(found.map((f) => f.path)).toEqual(['mainIntro.benefitHeadline', 'pointCards[0].title'])
  })

  it('기록하는 글은 80자까지 — 넘으면 자르고 말줄임표를 붙인다', () => {
    const long = `48시간 보습 ${'가'.repeat(100)}`
    const [found] = findUnsupportedNumbers(
      { solution: { summary: long } } as CopywritingResult,
      buildNumberSources(spec({}))
    )
    expect(found.text).toBe(`${long.slice(0, 80)}…`)
  })
})

describe('buildNumberSources reviewStats — 리뷰 파일 통계(재현 검사 전용)', () => {
  const withStats = {
    ...spec({ reviewsText: '리뷰 전체: 300건 (텍스트 리뷰 140건) · 평점 분포: 5점 292 / 4점 2 · 표집: 100건' }),
    reviewFiles: { own: { fileName: 'a.xlsx', sampled: 100, dropped: 1, stats: { total_rows: 300, text_review_count: 140, rating_counts: { '5': 292, '4': 2 } } } },
  } as unknown as PdpSpecSheet
  const says = (text: string) => ({ headline: text }) as unknown as CopywritingResult
  const tokens = (text: string, sheet: PdpSpecSheet, options?: { reviewStats?: boolean }) => findUnsupportedNumbers(says(text), buildNumberSources(sheet, options)).map((f) => f.token)

  it('켜면 별점별 건수가 근거가 된다 — 단위 없는 글 표기 5점 292와 292건을 잇는다', () => {
    expect(tokens('5점 후기 292건', withStats, { reviewStats: true })).toEqual([])
  })

  it('끄면(기본, 운영 카피 게이트) 지금과 같다', () => {
    expect(tokens('5점 후기 292건', withStats)).toEqual(['292건'])
  })

  it('통계에 없는 숫자는 켜도 걸린다 — 근거를 무턱대고 넓히지 않는다', () => {
    expect(tokens('후기 293건', withStats, { reviewStats: true })).toEqual(['293건'])
  })

  it('통계가 없어도 던지지 않는다', () => {
    expect(tokens('후기 3건', spec({}), { reviewStats: true })).toEqual(['3건'])
  })
})

describe('buildNumberRewriteDirective', () => {
  it('걸린 칸·글·숫자를 보여 주고, 숫자 없는 체감 표현은 써도 된다고 말한다(15건까지)', () => {
    const findings = Array.from({ length: 20 }, (_, i) => ({
      path: `pointCards[${i}].title`,
      token: '48시간',
      text: '48시간 보습',
    }))
    const directive = buildNumberRewriteDirective(findings)
    expect(directive).toContain('[숫자·단위 재작성 지시]')
    expect(directive).toContain('- [pointCards[0].title] "48시간 보습" (48시간)')
    expect(directive).toContain('숫자 없이 체감으로 말하는 표현은 그대로 써도 된다')
    expect(directive.split('\n').filter((l) => l.startsWith('- '))).toHaveLength(15)
  })
})
