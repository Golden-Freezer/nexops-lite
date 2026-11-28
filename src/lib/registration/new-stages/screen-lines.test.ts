import { describe, expect, it } from 'vitest'
import { HERO_SHOT_KEY, shotKey } from '../templatelib/section-values'
import { imageSlot, templateOf, textSlot } from '../templatelib/engine.fixture'
import { isInputValue } from '../templatelib/slots'
import { copyScreenLines, designcutScreenLines, slotFactAuditLines } from './screen-lines'

describe('copyScreenLines — 카피 최종본의 화면 글만', () => {
  it('화면에 그리는 칸만 읽고 팔레트·SEO·상품 종류 낱말·후기 원문·이미지 힌트는 뺀다', () => {
    const lines = copyScreenLines({
      mainIntro: { benefitHeadline: '아침 3분 정리', subBenefit: '엉킴 없이', productType: '빗' },
      designPalette: { primary: '#fff' } as never,
      seo_keywords: ['빗'],
      problem: { question: '매일 엉키나요?', empathyLines: ['아침마다', ''] },
      pointCards: [{ title: '부드러운 빗살', description: '두피에 닿는 끝이 둥글다' }, { title: '' }],
      detailPoints: [{ claim: '빗살 120개', imageHint: 'macro shot', icon: 'brush' }],
      reviewHighlights: [{ text: '머리가 덜 엉켜요', original: '원문 그대로', author: '김**' }],
      closingCta: { headline: '지금 만나 보세요' },
      headlineAccents: { '아침 3분 정리': '3분' },
      summary: '  ',
    })
    expect(lines).toEqual([
      { id: 'mainIntro.benefitHeadline', text: '아침 3분 정리' },
      { id: 'mainIntro.subBenefit', text: '엉킴 없이' },
      { id: 'problem.question', text: '매일 엉키나요?' },
      { id: 'problem.empathyLines[0]', text: '아침마다' },
      { id: 'pointCards[0].title', text: '부드러운 빗살' },
      { id: 'pointCards[0].description', text: '두피에 닿는 끝이 둥글다' },
      { id: 'detailPoints[0].claim', text: '빗살 120개' },
      { id: 'reviewHighlights[0].text', text: '머리가 덜 엉켜요' },
      { id: 'closingCta.headline', text: '지금 만나 보세요' },
    ])
  })

  it('카피가 없으면 빈 목록', () => {
    expect(copyScreenLines(undefined)).toEqual([])
    expect(copyScreenLines({})).toEqual([])
  })
})

describe('designcutScreenLines — K 라인 칸 글', () => {
  it('C 시제품과 같은 id(<번호>.<섹션 키>.<칸>)이고 목록 칸은 항목 번호를 붙인다', () => {
    const lines = designcutScreenLines({
      sections: [
        { key: 'hook_3step', templateRef: { slots: { title: '엉킴 없는 아침', photo: HERO_SHOT_KEY, badge: null } } },
        { key: 'legacy' },
        {
          key: 'point_div:0',
          templateRef: {
            slots: {
              bullets: ['둥근 빗살', ''],
              cards: [
                { title: '가볍다', body: '120g', image: shotKey(2, 'cards.image', 0) },
                { title: '', body: null },
              ],
              photo: shotKey(2, 'photo', 0),
            },
          },
        },
      ],
    })
    expect(lines).toEqual([
      { id: '0.hook_3step.title', text: '엉킴 없는 아침' },
      { id: '2.point_div:0.bullets[0]', text: '둥근 빗살' },
      { id: '2.point_div:0.cards[0].title', text: '가볍다' },
      { id: '2.point_div:0.cards[0].body', text: '120g' },
    ])
  })

  it('칸에 얹힌 컷 키는 글로 세지 않는다(section-values 키 꼴)', () => {
    expect(designcutScreenLines({ sections: [{ key: 'x', templateRef: { slots: { a: shotKey(11, 'gallery.photo', 3), b: 'hero' } } }] })).toEqual([])
  })

  it('계획이 없으면 빈 목록', () => {
    expect(designcutScreenLines(undefined)).toEqual([])
    expect(designcutScreenLines({})).toEqual([])
  })
})

describe('slotFactAuditLines — K 칸 사실 감사 줄은 입력 칸을 뺀다(J47)', () => {
  const bars = [5, 4, 3, 2, 1].map((star, i) => ({ star: String(star), count: String([4, 0, 1, 0, 0][i]), share: String([0.8, 0, 0.2, 0, 0][i]) }))
  const reviewSection = {
    key: 'k6_review',
    templateRef: { id: 'review.bars-quotes', slots: { headline: '쓴 사람들이 먼저 말해요', bars, items: [{ quote: '털이 한 번에 모여요', name: '김*' }] } },
  }
  const copySection = { key: 'k2_point_div', templateRef: { id: 'point_div.fixture-none', slots: { headline: '버튼 한 번', sub: '털 정리 끝' } } }

  it('리뷰 별점 막대·후기 인용(입력 칸)은 빠지고, 모델이 쓴 칸(제목)은 남는다 — 남는 줄의 id는 그대로다', () => {
    const plan = { sections: [copySection, reviewSection] }
    const all = designcutScreenLines(plan)
    const audit = slotFactAuditLines(plan)
    expect(all.some((line) => line.id.startsWith('1.k6_review.bars['))).toBe(true)
    expect(all.some((line) => line.id.startsWith('1.k6_review.items['))).toBe(true)
    expect(audit.map((line) => line.id)).toEqual(['0.k2_point_div.headline', '0.k2_point_div.sub', '1.k6_review.headline'])
    expect(audit).toEqual(all.filter((line) => !/^1\.k6_review\.(bars|items)\[/.test(line.id)))
  })

  it('입력 칸이 없는 계획·템플릿 id가 없는 옛 기록·라이브러리에 없는 템플릿은 칸 글 전부와 같다(감사 프롬프트 바이트 그대로)', () => {
    for (const plan of [
      { sections: [copySection] },
      { sections: [{ key: 'k6_review', templateRef: { slots: reviewSection.templateRef.slots } }] },
      { sections: [{ key: 'k6_review', templateRef: { id: 'review.not-in-library', slots: reviewSection.templateRef.slots } }] },
    ]) {
      expect(slotFactAuditLines(plan)).toEqual(designcutScreenLines(plan))
    }
    expect(slotFactAuditLines(undefined)).toEqual([])
  })
})

describe('isInputValue — 입력 칸 판정(J47)', () => {
  const t = templateOf({
    slots: {
      headline: textSlot(),
      rating: textSlot({ source: 'input', input: 'review.rating' }),
      photo: imageSlot(),
      bars: { type: 'list', required: true, source: 'input', input: 'review.ratingBars', min: 5, max: 5, fields: { count: textSlot({ source: 'input' }) } },
      mixed: { type: 'list', required: false, min: 1, max: 3, fields: { title: textSlot(), name: textSlot({ source: 'input', input: 'option.name' }) } },
    },
  })

  it('입력 글 칸·입력 목록(필드 포함)·모델 목록 안의 입력 필드는 입력이고, 모델 칸·사진 칸·없는 칸은 아니다', () => {
    expect(isInputValue(t, 'rating')).toBe(true)
    expect(isInputValue(t, 'bars')).toBe(true)
    expect(isInputValue(t, 'bars', 'count')).toBe(true)
    expect(isInputValue(t, 'mixed', 'name')).toBe(true)
    expect(isInputValue(t, 'mixed')).toBe(false)
    expect(isInputValue(t, 'mixed', 'title')).toBe(false)
    expect(isInputValue(t, 'headline')).toBe(false)
    expect(isInputValue(t, 'photo')).toBe(false)
    expect(isInputValue(t, 'nope')).toBe(false)
  })
})
