/**
 * 카피 규칙 검사(P1-1a) — 제목·CTA의 안내형 끝말과 첫 화면의 상품 종류 낱말. 결정론(LLM 없음).
 */

import { describe, expect, it } from 'vitest'
import {
  GUIDE_FIX_LIMIT,
  buildCopyRuleFixBlock,
  endsWithGuide,
  findCopyRuleViolations,
  hookTypeWords,
  productNameTypeWords,
} from './copy-rule-check'
import type { CopywritingResult } from './pdp-state'

const STICKER = { productName: '지야픽 핸드메이드 스티커 수제 선물 포장', brandName: '지야픽' }
const POPPER = { productName: '지야픽 생일 파티 꽃가루 폭죽 세트 10개입', brandName: '지야픽' }
const POUCH = { productName: '지야픽 데이지 구디백 답례품 선물 파우치', brandName: '지야픽' }

describe('endsWithGuide — 보라고 안내하는 끝말', () => {
  it('살펴보세요·확인하세요·확인해 보세요·만나보세요·소개합니다·알아보세요(띄어 쓴 꼴, 끝 문장부호·이모지 포함)', () => {
    for (const text of [
      '밥그릇·물그릇, 두 칸을 살펴보세요',
      '사이즈부터 수량까지\n한눈에 확인하세요',
      '지금 컬러를 확인해보세요',
      '구성을 확인해 보세요.',
      '지금 만나 보세요!',
      '새로운 파우치를 소개합니다 ✨',
      '왜 다들 찾는지 알아보세요~',
      '지금 얼마나 필요한지 볼까요',
      '정성껏 소개해 드립니다',
      '사이즈를 확인해 주세요',
      '컬러를 확인 해보세요',
      '두 제품을 비교해 보세요',
      '구성을 살펴보세요 🎉',
      '“구성을 살펴보세요”',
    ]) {
      expect(endsWithGuide(text), text).toBe(true)
    }
  })

  it('행동·효익으로 끝나거나 안내 말이 문장 끝이 아니면 아니다', () => {
    for (const text of [
      '다가오는 파티, 지금 준비해보세요',
      '필요한 만큼 지금 담아보세요',
      '확인된 성분만 담았어요',
      '살펴본 고객이 다시 찾아요',
      '확인하세요 없이 바로 붙여요',
      '사료와 물, 한 그릇에 나눠 담아요',
    ]) {
      expect(endsWithGuide(text), text).toBe(false)
    }
  })

  it('여러 문장이면 어느 문장 끝이든 본다', () => {
    expect(endsWithGuide('붙이면 끝. 구성을 살펴보세요. 오늘도 간편하게')).toBe(true)
  })

  it('줄바꿈으로 나뉜 한 문장은 이어서, 줄마다 끝난 문장은 줄 끝에서 본다', () => {
    expect(endsWithGuide('사이즈부터 수량까지 확인해\n보세요')).toBe(true)
    expect(endsWithGuide('구성을 살펴보세요\n오늘도 간편하게')).toBe(true)
    expect(endsWithGuide('필요한 만큼\n지금 담아보세요')).toBe(false)
  })
})

describe('findCopyRuleViolations — 안내형 끝말은 제목·CTA 칸만', () => {
  const copy = {
    title: '상품 소개합니다',
    mainIntro: { hook: '스티커 하나로 끝', benefitHeadline: '포장이 인사가 돼요', subBenefit: '구성을 확인하세요' },
    closingCta: { headline: '밥그릇·물그릇, 두 칸을 살펴보세요', subtext: '지금 만나보세요' },
    compareSummary: '차이를 비교해 보세요',
    directionHint: { headline: '지금 컬러를 확인해보세요', subCopy: '고르기 쉬워요' },
    pointCards: [{ title: '구성 살펴보세요', description: '사이즈를 확인하세요' }],
    detailPoints: [{ claim: '붙이면 끝나요', proof: '접착면을 확인하세요', benefit: '깔끔해요' }],
    howTo: [{ step: '사용 전 접착면을 확인하세요', description: '물기를 확인하세요' }],
    hero_copy: { hook: '구성을 확인하세요' },
    sections: [{ headline: '구성을 확인하세요' }],
  } as unknown as CopywritingResult

  it('걸린 칸 — 첫 화면·CTA·오버레이 제목·카드 제목·비교 요약', () => {
    expect(findCopyRuleViolations(copy, STICKER).guideEndings.map((f) => f.path)).toEqual([
      'mainIntro.subBenefit',
      'closingCta.headline',
      'closingCta.subtext',
      'compareSummary',
      'directionHint.headline',
      'pointCards[0].title',
    ])
  })

  it('CTA가 문자열 꼴(Stage 2 산출)이어도 본다', () => {
    const copy = { closingCta: '구성을 살펴보세요' } as unknown as CopywritingResult
    expect(findCopyRuleViolations(copy, STICKER).guideEndings).toEqual([
      { path: 'closingCta', text: '구성을 살펴보세요' },
    ])
  })

  it('본문(카드 설명·증명)·사용법(단계·설명 — 맞는 안내)·파생 칸(hero_copy·sections)·상품명(최상위 title)은 보지 않는다', () => {
    const paths = findCopyRuleViolations(copy, STICKER).guideEndings.map((f) => f.path)
    for (const p of [
      'pointCards[0].description',
      'detailPoints[0].proof',
      'howTo[0].step',
      'howTo[0].description',
      'hero_copy.hook',
      'title',
    ]) {
      expect(paths).not.toContain(p)
    }
    expect(paths.some((p) => p.startsWith('sections'))).toBe(false)
  })
})

describe('상품 종류 낱말 — 첫 화면(hook·benefitHeadline·subBenefit)', () => {
  it("상품명 끝 낱말이 종류가 아니어도 — 브랜드·쓰임 말(핸드메이드·수제·선물·포장)을 빼면 '스티커'", () => {
    expect(productNameTypeWords(STICKER)).toEqual(['스티커'])
    expect(productNameTypeWords(POPPER)).toEqual(['꽃가루', '폭죽'])
    expect(productNameTypeWords(POUCH)).toEqual(['데이지', '구디백', '파우치'])
  })

  it('카피가 고른 productType이 상품명에 있으면 그것(여러 낱말이면 끝 낱말), 없거나 상품명에 없으면 상품명 낱말', () => {
    const typed = (productType: string) => ({ mainIntro: { productType } }) as CopywritingResult
    expect(hookTypeWords(typed('스티커'), STICKER)).toEqual({ words: ['스티커'], source: 'copy' })
    expect(hookTypeWords(typed('꽃가루 폭죽'), POPPER)).toEqual({ words: ['폭죽'], source: 'copy' })
    expect(hookTypeWords(typed('포장지'), STICKER)).toEqual({ words: ['스티커'], source: 'name' })
    // 카피가 쓰임 말·브랜드를 골라도 종류 낱말로 보지 않는다
    expect(hookTypeWords(typed('포장'), STICKER)).toEqual({ words: ['스티커'], source: 'name' })
    expect(hookTypeWords(typed('지야픽'), STICKER)).toEqual({ words: ['스티커'], source: 'name' })
    expect(hookTypeWords({} as CopywritingResult, STICKER)).toEqual({ words: ['스티커'], source: 'name' })
  })

  it("R7 P01 '톡 붙이는 답례 포장 한 장' — 스티커가 없으면 걸리고, 셋 중 한 곳에 있으면 된다", () => {
    const intro = (mainIntro: Record<string, string>) =>
      ({ mainIntro: { productType: '스티커', ...mainIntro } }) as CopywritingResult
    expect(findCopyRuleViolations(intro({ benefitHeadline: '톡 붙이는 답례 포장 한 장' }), STICKER).hookType).toEqual({
      words: ['스티커'],
      source: 'copy',
      present: false,
    })
    expect(
      findCopyRuleViolations(
        intro({ benefitHeadline: '톡 붙이는 답례 포장', subBenefit: '감사 문구 스티커로 끝' }),
        STICKER
      ).hookType?.present
    ).toBe(true)
  })

  it('첫 화면 분류 라벨(mainIntro.category — 디자인 컷 eyebrow, 오너 지시로 그리지 않음)에만 종류 낱말이 있으면 첫 화면에 없다', () => {
    const labelOnly = {
      mainIntro: { productType: '스티커', category: '스티커', hook: '톡 붙이면 끝', benefitHeadline: '답례 포장 한 장' },
    } as unknown as CopywritingResult
    expect(findCopyRuleViolations(labelOnly, STICKER).hookType?.present).toBe(false)
    const inHook = {
      mainIntro: { productType: '스티커', category: '스티커', hook: '스티커 한 장이면 끝', benefitHeadline: '답례 포장 한 장' },
    } as unknown as CopywritingResult
    expect(findCopyRuleViolations(inHook, STICKER).hookType?.present).toBe(true)
  })

  it('상품명 낱말로 볼 때는 그중 하나만 있어도 된다 — 첫 화면 밖(요약·CTA)은 세지 않는다', () => {
    const copy = {
      mainIntro: { subBenefit: '돌리면 터지는 컬러 꽃가루' },
      summary: '폭죽 하나로 끝',
    } as CopywritingResult
    expect(findCopyRuleViolations(copy, POPPER).hookType?.present).toBe(true)
    const outside = { mainIntro: { hook: '축하 한 방' }, summary: '폭죽 하나로 끝' } as CopywritingResult
    expect(findCopyRuleViolations(outside, POPPER).hookType?.present).toBe(false)
  })

  it("R7 P01 — 카피가 productType을 '포장'으로 골라도 첫 화면에 스티커가 없으면 걸린다", () => {
    const copy = {
      mainIntro: { productType: '포장', benefitHeadline: '톡 붙이는 답례 포장 한 장' },
    } as CopywritingResult
    expect(findCopyRuleViolations(copy, STICKER).hookType).toEqual({
      words: ['스티커'],
      source: 'name',
      present: false,
    })
  })

  it('상품명 낱말은 한글 낱말만 — 영문 규격·괄호 머리말은 빼고 나눈다', () => {
    expect(productNameTypeWords({ productName: '지야픽 【정품】 XL 스티커', brandName: '지야픽' })).toEqual(['스티커'])
  })

  it('브랜드·수량·쓰임 말만이면 보지 않는다(null)', () => {
    expect(
      findCopyRuleViolations({} as CopywritingResult, { productName: '지야픽 선물 세트 10개입', brandName: '지야픽' })
        .hookType
    ).toBeNull()
  })
})

describe('buildCopyRuleFixBlock — Stage 3 고칠 곳', () => {
  it('걸린 것이 없으면 빈 문자열(프롬프트 불변)', () => {
    const clean = { mainIntro: { productType: '스티커', hook: '스티커 하나로 끝' } } as CopywritingResult
    expect(buildCopyRuleFixBlock(findCopyRuleViolations(clean, STICKER))).toBe('')
  })

  it('안내형 끝말 칸과 첫 화면 종류 낱말을 적고, 입력에 없는 약속을 넣지 말라고 함께 말한다', () => {
    const copy = {
      mainIntro: { hook: '포장이 인사가 돼요' },
      closingCta: { headline: '밥그릇·물그릇,\n두 칸을 살펴보세요' },
    } as CopywritingResult
    const block = buildCopyRuleFixBlock(findCopyRuleViolations(copy, POPPER))
    expect(block.split('\n')[0]).toBe('## [카피 규칙 — 고칠 곳(결정론 검사)]')
    expect(block).toContain('입력에 없는 약속(배송·보증·기간·수치)은 넣지 않는다')
    expect(block).toContain('이 규칙으로는 아래 칸만 고친다(다른 검수 기준은 그대로 적용한다)')
    expect(block).toContain('- [closingCta.headline] "밥그릇·물그릇, 두 칸을 살펴보세요" — 보라고 안내하는 끝말 대신')
    expect(block).toContain("상품 종류 낱말 '꽃가루' 또는 '폭죽'이(가) 없다")
  })

  it(`안내형 끝말은 ${GUIDE_FIX_LIMIT}칸까지만 넘긴다`, () => {
    const copy = {
      mainIntro: { productType: '폭죽', hook: '폭죽 하나로' },
      pointCards: Array.from({ length: 10 }, (_, i) => ({ title: `구성 ${i} 살펴보세요` })),
    } as CopywritingResult
    const lines = buildCopyRuleFixBlock(findCopyRuleViolations(copy, POPPER))
      .split('\n')
      .filter((l) => l.startsWith('- ['))
    expect(lines).toHaveLength(GUIDE_FIX_LIMIT)
  })
})
