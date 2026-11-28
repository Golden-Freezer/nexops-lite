/**
 * 연령 컴플라이언스 게이트 단위 테스트 — 오너 적발(2026-08-12) 재발 방지: 만 14세 이상 상품에서
 * 어린이 사용 묘사 탐지·리뷰 발췌 제거·고지 문구 검사·프롬프트 블록 발동 조건을 고정한다.
 */

import { describe, it, expect } from 'vitest'
import {
  CHILD_AGE_THRESHOLD,
  buildAgeBanDirective,
  buildAgeComplianceCopyBlock,
  buildAgeComplianceImageBlock,
  checkAgeCompliance,
  findChildTerms,
  isAgeRestricted,
  stripChildReviewHighlights,
} from './compliance-gate'

describe('findChildTerms — 어린이 표현 탐지(오탐 방지 포함)', () => {
  it('명시적 어린이 표현을 잡는다 — E2E 실사고 문장 포함', () => {
    expect(findChildTerms('아이 생일파티에 썼는데 아이들이 정말 좋아했어요')).toContain('아이')
    expect(findChildTerms('어린이 선물로 좋아요')).toContain('어린이')
    expect(findChildTerms('아동용으로 구매')).toContain('아동')
    expect(findChildTerms('유아부터 사용 가능')).toContain('유아')
    expect(findChildTerms('키즈 파티 필수템')).toContain('키즈')
    expect(findChildTerms('자녀 생일에 준비했어요')).toContain('자녀')
  })

  it('복합어 오탐을 내지 않는다 — 아이템·아이디어·아이콘·아이스·아이섀도', () => {
    for (const safe of ['파티 필수 아이템', '좋은 아이디어', 'USP 아이콘 40종', '아이스크림 파티', '아이섀도 컬러']) {
      expect(findChildTerms(safe), safe).toEqual([])
    }
  })
})

describe('발동 조건 — minAgeYears ≥ 14일 때만, 미설정 잡은 완전 무접촉', () => {
  it('미설정·14 미만은 발동하지 않는다', () => {
    expect(isAgeRestricted({ productName: 'x' })).toBe(false)
    expect(isAgeRestricted({ productName: 'x', minAgeYears: 8 })).toBe(false)
    expect(buildAgeComplianceCopyBlock({ productName: 'x' })).toBeNull()
    expect(buildAgeComplianceImageBlock({ productName: 'x' })).toBeNull()
  })

  it('14 이상이면 카피·이미지 블록이 나온다 — 고지 문구·미성년 금지 포함', () => {
    const spec = { productName: 'x', minAgeYears: CHILD_AGE_THRESHOLD }
    const copyBlock = buildAgeComplianceCopyBlock(spec)!
    expect(copyBlock).toContain('만 14세 이상')
    expect(copyBlock).toContain('금지')
    const imageBlock = buildAgeComplianceImageBlock(spec)!
    expect(imageBlock).toContain('Do NOT depict children')
  })
})

describe('checkAgeCompliance — 산출 카피 전수 검사', () => {
  it('중첩 필드의 위반을 섹션 라벨과 함께 찾고, 고지 문구 존재를 판정한다', () => {
    const result = checkAgeCompliance(
      {
        mainIntro: { benefitHeadline: '아이들이 좋아하는 폭죽' },
        pointCards: [{ title: '간편 사용', description: '어린이도 쉽게' }],
        closingCta: { headline: '지금 준비하세요', subtext: '본 제품은 만 14세 이상 사용 가능한 제품입니다' },
      },
      14
    )
    expect(result.violations.length).toBe(2)
    expect(result.violations.map((v) => v.section)).toEqual(expect.arrayContaining(['mainIntro', 'pointCards']))
    expect(result.noticePresent).toBe(true)
  })

  it('위반 없는 성인 문맥 카피는 통과하고, 고지가 없으면 noticePresent=false', () => {
    const result = checkAgeCompliance({ mainIntro: { benefitHeadline: '파티 필수 아이템' } }, 14)
    expect(result.violations).toEqual([])
    expect(result.noticePresent).toBe(false)
  })
})

describe('stripChildReviewHighlights — 리뷰 원문 발췌는 재작성 불가라 제거가 유일한 안전 처리', () => {
  it('어린이 표현이 담긴 발췌만 제거하고 나머지는 보존한다(원본 불변)', () => {
    const copy = {
      reviewHighlights: [
        { text: '아이 생일파티에 썼는데 아이들이 정말 좋아했어요', author: '구매고객' },
        { text: '돌리기만 하면 돼서 사용이 쉽습니다', author: '구매고객' },
      ],
    }
    const { copy: next, removed } = stripChildReviewHighlights(copy)
    expect(removed).toBe(1)
    expect(next.reviewHighlights).toHaveLength(1)
    expect(next.reviewHighlights![0].text).toContain('돌리기만')
    expect(copy.reviewHighlights).toHaveLength(2) // 원본 비파괴
  })

  it('위반이 없으면 동일 객체를 그대로 반환한다', () => {
    const copy = { reviewHighlights: [{ text: '사용이 쉽습니다' }] }
    expect(stripChildReviewHighlights(copy).copy).toBe(copy)
  })
})

describe('buildAgeBanDirective — 재생성 지시', () => {
  it('위반 문장·표현을 명시하고 성인 문맥 재작성을 지시한다', () => {
    const directive = buildAgeBanDirective(
      [{ section: 'mainIntro', term: '아이', sentence: '아이들이 좋아하는 폭죽' }],
      14
    )
    expect(directive).toContain('아이들이 좋아하는 폭죽')
    expect(directive).toContain('만 14세 미만')
  })
})

describe('후기 요약 카드의 원문(P1-6)', () => {
  it('화면에 그리지 않는 original은 연령 검사에서 보지 않는다 — 보이는 요약에 어린이 표현이 없으면 위반이 아니다', () => {
    const copy = {
      reviewHighlights: [
        {
          text: '손잡이가 편해서 매일 들고 다녀요.',
          author: '구매고객',
          rating: 5,
          summary: true,
          original: '딸아이 생일 선물로 골랐어요. 손잡이가 편해서 매일 들고 다녀요.',
        },
      ],
    } as unknown as Parameters<typeof checkAgeCompliance>[0]
    expect(checkAgeCompliance(copy, 14).violations).toEqual([])
    expect(stripChildReviewHighlights(copy).removed).toBe(0)
  })
})
