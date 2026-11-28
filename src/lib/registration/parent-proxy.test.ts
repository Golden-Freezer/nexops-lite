/**
 * 학부모 대리 구매형(parent_proxy) 판정 — 어린이 KC 인증 제외, 리뷰 5건 이상이면 아이·기관 낱말 리뷰 5건·20% 이상,
 * 리뷰가 적으면 상품명·검색 태그. 실제 픽스처 상품명·태그로 P01·P02는 켜지고 P11은 꺼진다(리뷰 원문은 리포에 없어 합성 리뷰로 본다).
 */

import { describe, expect, it } from 'vitest'
import { getPdpTestProduct } from './__fixtures__/pdp-products'
import type { EnrichmentRecord } from './enrichment-switch'
import {
  countChildContextReviews,
  detectParentProxy,
  readJobAudience,
  splitReviewBodies,
  withAudience,
} from './parent-proxy'
import type { PdpSpecSheet } from './pdp-state'

const spec = (over: Partial<PdpSpecSheet> = {}): PdpSpecSheet => ({ productName: '선물 포장 스티커', ...over })

/** serializeReviews와 같은 꼴 — 머리말 + [리뷰N] 메타(옵션 포함)·제목·내용 */
function serialized(bodies: string[], option = '기본'): string {
  const header = `리뷰 전체: ${bodies.length}건 (텍스트 리뷰 ${bodies.length}건)\n표집: ${bodies.length}건 (평점 분포 유지, 구체적인 긴 리뷰 우선)`
  const blocks = bodies.map((b, i) => `[리뷰${i + 1}] 평점 5/5 · 도움 0 · 옵션: ${option}\n제목: 만족\n내용: ${b}`)
  return [header, ...blocks].join('\n\n')
}

describe('splitReviewBodies — 리뷰 단위 본문', () => {
  it('직렬화 텍스트는 리뷰마다 제목·내용만 — 머리말·옵션 메타·생략 줄은 세지 않는다', () => {
    const text = `${serialized(['붙이기 쉬워요', '튼튼해요'], '어린이집 20매')}\n\n(길이 상한으로 3건 생략)`
    expect(splitReviewBodies(text)).toEqual(['만족 붙이기 쉬워요', '만족 튼튼해요'])
    expect(countChildContextReviews(text)).toEqual({ total: 2, hits: 0 })
  })

  it('붙여넣은 글은 빈 줄이 아닌 줄마다, 빈 글·리뷰 데이터 없음은 0건', () => {
    expect(splitReviewBodies('좋아요\n\n  아이가 좋아해요 \n')).toEqual(['좋아요', '아이가 좋아해요'])
    expect(splitReviewBodies('리뷰 데이터 없음')).toEqual([])
    expect(splitReviewBodies(undefined)).toEqual([])
  })

  it('제외어 오탐 0 — 아이 복합어(아이템·아이디어·아이폰·아이콘·아이스·아이섀도·아이라이너·아이보리·아이고)·아기자기·딸기', () => {
    const text = serialized([
      '아이템 구성이 좋아요',
      '포장 아이디어가 좋네요',
      '아이폰으로 찍어도 예뻐요',
      '아이콘 그림이 귀여워요',
      '아이스박스에 넣어 보냈어요',
      '아이섀도 색감 같은 펄',
      '아이라이너처럼 선이 또렷',
      '아이보리 색이 예뻐요',
      '아이고 빨리 왔네요',
      '아기자기하고 예뻐요',
      '딸기 그림이 귀여워요',
    ])
    expect(countChildContextReviews(text)).toEqual({ total: 11, hits: 0 })
  })

  it('엄마·아빠·부모님은 세지 않고, 아이·아기·어린이집·유치원·초등·자녀·키즈·학부모·아들·딸은 센다', () => {
    const text = serialized([
      '엄마 아빠 부모님께 드렸어요',
      '아이가 좋아했어요',
      '아기 돌잔치 답례',
      '어린이집 답례로 샀어요',
      '유치원 친구들 나눠줬어요',
      '초등 반 친구들 선물',
      '자녀 생일 준비',
      '키즈 파티용',
      '학부모 모임 선물',
      '아들 생일에 썼어요',
      '딸이 반 친구들 주려고',
    ])
    expect(countChildContextReviews(text)).toEqual({ total: 11, hits: 10 })
  })
})

describe('detectParentProxy — 판정', () => {
  const childReviews = (hits: number, total: number) =>
    serialized(Array.from({ length: total }, (_, i) => (i < hits ? '어린이집 생일 답례로 준비했어요' : '포장이 깔끔해요')))

  it('리뷰 5건 이상이면 리뷰로 — 5건·20% 이상이면 켜고 근거 수를 남긴다', () => {
    expect(detectParentProxy(spec({ reviewsText: childReviews(5, 25) }))).toEqual({
      record: { kind: 'parent_proxy', version: 1, ageGate: false, basis: 'reviews', reviews: { total: 25, hits: 5 } },
      reason: 'reviews',
      reviews: { total: 25, hits: 5 },
    })
  })

  it('리뷰 판정은 두 문턱을 다 넘어야 — 4건(비율 높음)·5건이지만 20% 미만은 끈다. 이름·태그 신호가 있어도 리뷰가 이긴다', () => {
    const tagged = { productName: '어린이집 구디백 봉투', searchTags: ['유치원답례품'] }
    expect(detectParentProxy(spec({ ...tagged, reviewsText: childReviews(4, 5) })).record).toBeNull()
    expect(detectParentProxy(spec({ ...tagged, reviewsText: childReviews(5, 26) })).record).toBeNull()
    expect(detectParentProxy(spec({ ...tagged, reviewsText: childReviews(5, 26) })).reason).toBe('none')
  })

  it('리뷰 1~4건 경계 — 리뷰 문턱(5건)을 채울 수 없어 상품명·태그로 판정한다. 5건부터는 리뷰로', () => {
    const goodyBag = { productName: '구디백 봉투' }
    for (const n of [1, 4]) {
      expect(detectParentProxy(spec({ ...goodyBag, reviewsText: childReviews(n, n) })).reason).toBe('name_tags')
      expect(detectParentProxy(spec({ reviewsText: childReviews(n, n) })).reason).toBe('none')
    }
    expect(detectParentProxy(spec({ ...goodyBag, reviewsText: childReviews(0, 5) })).reason).toBe('none')
    expect(detectParentProxy(spec({ reviewsText: childReviews(5, 5) })).reason).toBe('reviews')
  })

  it('어버이날 엄마 선물 리뷰는 꺼진다 — 엄마·아빠·부모님 선물 리뷰가 대부분이어도 학부모 신호가 아니다', () => {
    const parentsDay = serialized([
      '어버이날 엄마 선물 포장에 썼어요',
      '엄마 아빠께 카네이션이랑 드렸어요',
      '부모님 선물 포장이 예뻐졌어요',
      '어버이날 엄마가 좋아하셨어요',
      '아빠 생신 선물에 붙였어요',
      '스승의날 선생님 선물에도 썼어요',
    ])
    const out = detectParentProxy(spec({ productName: '카네이션 감사 스티커', reviewsText: parentsDay }))
    expect(out).toEqual({ record: null, reason: 'none', reviews: { total: 6, hits: 0 } })
  })

  it('리뷰가 5건보다 적으면 상품명·검색 태그 — 어린이집·유치원·구디백이 있으면 켜고 걸린 낱말을 남긴다', () => {
    const out = detectParentProxy(spec({ productName: '구디백 봉투', searchTags: ['어린이집답례품'], reviewsText: childReviews(0, 2) }))
    expect(out.record).toEqual({ kind: 'parent_proxy', version: 1, ageGate: false, basis: 'name_tags', terms: ['어린이집', '구디백'] })
    expect(detectParentProxy(spec({ productName: '돌잔치 답례 봉투', searchTags: ['결혼식답례'] })).record).toBeNull()
  })

  it('어린이 KC 인증 정보가 있으면 끈다 — 어린이제품 아님·해당 없음은 인증이 아니다', () => {
    const tagged = { productName: '어린이집 구디백' }
    expect(detectParentProxy(spec({ ...tagged, certificationInfo: '어린이제품 KC 공급자적합성확인' })).reason).toBe('child_kc')
    expect(detectParentProxy(spec({ ...tagged, certificationInfo: '어린이제품 아님' })).reason).toBe('name_tags')
    expect(detectParentProxy(spec({ ...tagged, certificationInfo: '어린이제품 해당 없음' })).reason).toBe('name_tags')
    expect(detectParentProxy(spec({ ...tagged, certificationInfo: 'KC 전기용품 안전인증' })).reason).toBe('name_tags')
  })

  it('연령 게이트(만 14세 이상) 잡도 기록은 남기되 ageGate로 게이트 우선을 표시한다', () => {
    expect(detectParentProxy(spec({ productName: '유치원 구디백', minAgeYears: 14 })).record?.ageGate).toBe(true)
    expect(detectParentProxy(spec({ productName: '유치원 구디백', minAgeYears: 8 })).record?.ageGate).toBe(false)
  })

  it('실제 픽스처 상품명·태그 — P01(태그)·P02(상품명 구디백)는 켜지고 P11(어버이날 카네이션)은 꺼진다', () => {
    const fixture = (id: string) => {
      const p = getPdpTestProduct(id)
      return detectParentProxy({ ...p.specSheet, searchTags: p.searchTags })
    }
    expect(fixture('P01').record?.basis).toBe('name_tags')
    expect(fixture('P02').record?.terms).toContain('구디백')
    expect(fixture('P11').record).toBeNull()
  })
})

describe('잡 기록 — analysis.enrichment.audience', () => {
  const record: EnrichmentRecord = { version: 1, features: ['vocab', 'persuasion'] }
  const audience = detectParentProxy(spec({ productName: '구디백' })).record

  it('기록이 있고 켜진 판정일 때만 더한다 — 기록 없는 잡(대조군·Track S)·꺼진 판정은 그대로', () => {
    expect(withAudience(record, audience)).toEqual({ ...record, audience })
    expect(withAudience(record, null)).toBe(record)
    expect(withAudience(null, audience)).toBeNull()
  })

  it('읽기는 형식이 맞을 때만 — 기록 없음·다른 kind·버전 불일치는 null', () => {
    expect(readJobAudience({ enrichment: withAudience(record, audience) })).toEqual(audience)
    expect(readJobAudience({ enrichment: record })).toBeNull()
    expect(readJobAudience({ enrichment: { ...record, audience: { ...audience, kind: 'other' } } })).toBeNull()
    expect(readJobAudience({ enrichment: { ...record, audience: { ...audience, version: 2 } } })).toBeNull()
    expect(readJobAudience(null)).toBeNull()
  })
})
