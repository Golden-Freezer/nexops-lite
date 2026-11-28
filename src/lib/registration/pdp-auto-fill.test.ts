/**
 * 상세페이지 자동 작성 요청·응답 정리(PDP-W2W3 계약 v1 §2-2) — 상품명 필수, specSheet는 계약 칸만, 리뷰 앞 4,000자,
 * 이미지 http(s) 2장 이하. 응답은 상한으로 자르고 효능·의학 표현이 있는 글·형식이 틀리거나 무채색 극단인 컬러는 버린다.
 */

import { describe, expect, it } from 'vitest'
import {
  AUTO_FILL_REVIEWS_MAX_CHARS,
  autoFillClaimTerms,
  normalizeAutoFillSuggestions,
  parseAutoFillRequest,
} from './pdp-auto-fill'

describe('parseAutoFillRequest', () => {
  it('상품명이 없거나 본문이 객체가 아니면 400 문구', () => {
    expect(parseAutoFillRequest(null)).toEqual({ ok: false, error: '요청 본문이 필요합니다.' })
    expect(parseAutoFillRequest([])).toMatchObject({ ok: false })
    expect(parseAutoFillRequest({ productName: '   ' })).toEqual({
      ok: false,
      error: '상품명(productName)은 필수입니다.',
    })
    expect(parseAutoFillRequest({ productName: 3 })).toMatchObject({ ok: false })
    expect(parseAutoFillRequest({ productName: '컵', category: 3 })).toEqual({
      ok: false,
      error: 'category·brandName은 문자열이어야 합니다.',
    })
  })

  it('계약 칸만 남기고 정리한다 — 무게·원산지·추가 스펙은 잡 저장과 같은 한도, 목록은 중복 없이', () => {
    const out = parseAutoFillRequest({
      productName: '  세척 쉬운\n컵 ',
      category: '주방용품',
      brandName: '',
      specSheet: {
        material: ' 스테인리스 ',
        size: '',
        weight: ' 120g ',
        origin: '중'.repeat(50),
        extraSpecs: [
          { key: '용량', value: '350ml' },
          { key: '', value: '빈 키' },
        ],
        keyFeatures: ['세척 쉬움', '세척 쉬움', 3, ' 가벼움 '],
        colorOptions: [],
        usageLocation: '주방',
        reviewsText: '여기 리뷰는 읽지 않는다',
        certificationInfo: 'KC 인증',
      },
    })
    expect(out).toEqual({
      ok: true,
      value: {
        productName: '세척 쉬운 컵',
        category: '주방용품',
        specSheet: {
          material: '스테인리스',
          usageLocation: '주방',
          weight: '120g',
          origin: '중'.repeat(40),
          extraSpecs: [{ key: '용량', value: '350ml' }],
          keyFeatures: ['세척 쉬움', '가벼움'],
        },
        imageUrls: [],
      },
    })
  })

  it('리뷰는 앞 4,000자만, 문자열이 아니면 400', () => {
    const out = parseAutoFillRequest({ productName: '컵', reviewsText: `  ${'가'.repeat(5000)}` })
    expect(out.ok && out.value.reviewsText).toHaveLength(AUTO_FILL_REVIEWS_MAX_CHARS)
    expect(parseAutoFillRequest({ productName: '컵', reviewsText: 1 })).toMatchObject({ ok: false })
    expect(parseAutoFillRequest({ productName: '컵', reviewsText: '   ' })).toEqual({
      ok: true,
      value: { productName: '컵', specSheet: {}, imageUrls: [] },
    })
  })

  it('이미지는 http(s) 2장까지 — 3장·다른 형식·배열 아님은 400', () => {
    const ok = parseAutoFillRequest({
      productName: '컵',
      imageUrls: [' https://a.example/1.jpg ', '', 'http://b/2.png'],
    })
    expect(ok.ok && ok.value.imageUrls).toEqual(['https://a.example/1.jpg', 'http://b/2.png'])
    expect(
      parseAutoFillRequest({ productName: '컵', imageUrls: ['https://a/1', 'https://a/2', 'https://a/3'] })
    ).toEqual({
      ok: false,
      error: '이미지는 2장까지 보낼 수 있습니다.',
    })
    expect(parseAutoFillRequest({ productName: '컵', imageUrls: ['file:///etc/passwd'] })).toEqual({
      ok: false,
      error: '이미지는 http(s) URL이어야 합니다.',
    })
    expect(parseAutoFillRequest({ productName: '컵', imageUrls: 'https://a/1' })).toMatchObject({ ok: false })
  })
})

describe('normalizeAutoFillSuggestions', () => {
  it('글은 한 줄로 상한(페르소나 200·보이스 400)까지, 컬러는 #RRGGBB 대문자로', () => {
    const { suggestions, warnings } = normalizeAutoFillSuggestions({
      targetPersona: `  매일 도시락을 싸는\n직장인  ${'가'.repeat(300)}`,
      brandVoiceGuide: '나'.repeat(500),
      brandHexColor: '3366cc',
    })
    expect(suggestions.targetPersona).toHaveLength(200)
    expect(suggestions.targetPersona!.startsWith('매일 도시락을 싸는 직장인 가')).toBe(true)
    expect(suggestions.brandVoiceGuide).toHaveLength(400)
    expect(suggestions.brandHexColor).toBe('#3366CC')
    expect(warnings).toEqual([])
  })

  it('인증·의학 표현이 있는 글은 버리고 경고를 남긴다(규제 사전)', () => {
    const { suggestions, warnings } = normalizeAutoFillSuggestions({
      targetPersona: '탈모 예방에 관심 많은 30대 직장인',
      brandVoiceGuide: '치료 효과를 강조하는 전문가 톤',
      brandHexColor: '#2E7D5B',
    })
    expect(suggestions).toEqual({ brandHexColor: '#2E7D5B' })
    expect(warnings).toEqual([
      '타겟 페르소나 제안에 인증·의학 표현(탈모 예방)이 있어 뺐습니다.',
      '브랜드 보이스 제안에 인증·의학 표현(치료)이 있어 뺐습니다.',
    ])
  })

  it('리뷰에서 온 질병·증상명 단독(턱드름)도 버린다 — 규제 표현에 든 이름은 한 번만, 고민 서술은 남긴다', () => {
    expect(autoFillClaimTerms('강아지 턱드름이 신경 쓰이는 보호자')).toEqual([])
    expect(autoFillClaimTerms('비듬 걱정이 많은 20대')).toEqual([])
    expect(autoFillClaimTerms('여드름으로 고민하는 10대')).toEqual([])
    // 고민이 사라진다는 말은 효능 암시 — 고민 서술 예외가 아니다
    expect(autoFillClaimTerms('탈모 걱정 없는 두피 케어 톤')).toEqual(['탈모'])
    expect(autoFillClaimTerms('비듬 걱정 끝')).toEqual(['비듬'])
    expect(autoFillClaimTerms('여드름 고민 해결을 약속하는 톤')).toEqual(['여드름'])
    const { suggestions, warnings } = normalizeAutoFillSuggestions({
      targetPersona: '강아지 턱드름에 좋은 식기를 찾는 보호자',
      brandVoiceGuide: '탈모 예방을 말하는 톤',
    })
    expect(suggestions).toEqual({})
    expect(warnings).toEqual([
      '타겟 페르소나 제안에 인증·의학 표현(턱드름)이 있어 뺐습니다.',
      '브랜드 보이스 제안에 인증·의학 표현(탈모 예방)이 있어 뺐습니다.',
    ])
  })

  it('인증 사칭·절대 안전 표시는 버린다, 기능 설명·정도 표현은 남긴다', () => {
    expect(autoFillClaimTerms('KC 인증 제품을 고르는 사람')).toEqual(['KC 인증'])
    expect(autoFillClaimTerms('무독성 소재를 찾는 부모')).toEqual(['무독성'])
    expect(autoFillClaimTerms('저자극 소재를 찾는 부모')).toEqual([])
    expect(autoFillClaimTerms('설거지 시간을 줄이고 싶은 1인 가구')).toEqual([])
  })

  it('계약 예시: 탈모 예방·면역·다이어트 효과(의학·기능성)는 버리고, 냄새 제거·탈취 같은 사용 효익과 고민 서술은 남긴다(오너 지시)', () => {
    expect(autoFillClaimTerms('탈모 예방에 관심 많은 30대')).toEqual(['탈모 예방'])
    expect(autoFillClaimTerms('면역 강화에 관심 많은 부모')).toEqual(['면역 강화'])
    expect(autoFillClaimTerms('다이어트 효과를 기대하는 직장인')).toEqual(['다이어트 효과'])
    expect(autoFillClaimTerms('냄새 제거 효과를 원하는 1인 가구')).toEqual([])
    expect(autoFillClaimTerms('탈취 효과를 중요하게 보는 반려인')).toEqual([])
    expect(autoFillClaimTerms('곰팡이 방지가 필요한 욕실')).toEqual([])
    expect(autoFillClaimTerms('탈모 고민이 있는 30대')).toEqual([])
  })

  it('인증·의학 표현이 있는 문장만 빼고 나머지는 남긴다(경고)', () => {
    const { suggestions, warnings } = normalizeAutoFillSuggestions({
      brandVoiceGuide: '담백한 생활 톤으로 쓴다. 효능이나 의학 표현은 쓰지 않는다. 문장은 짧게 쓴다.',
    })
    expect(suggestions).toEqual({ brandVoiceGuide: '담백한 생활 톤으로 쓴다. 문장은 짧게 쓴다.' })
    expect(warnings).toEqual(['브랜드 보이스 제안에서 인증·의학 표현(의학)이 있는 문장을 뺐습니다.'])
    // '효능' 단독은 체감 효능이라 세지 않는다(J50 — 오너 11-10 '효능 문구 부활')
    expect(autoFillClaimTerms('세정 효능을 살리는 생활 톤')).toEqual([])
    // 고지 문장('의학적 효능을 표방하지 않습니다')은 주장이 아니라 남긴다
    expect(
      normalizeAutoFillSuggestions({ brandVoiceGuide: '의학적 효능을 표방하지 않습니다. 짧게 쓴다.' }).warnings
    ).toEqual([])
  })

  it('컬러가 형식이 틀리거나 검정·흰색에 가까우면 버린다, 빈 값·객체 아님은 조용히 비운다', () => {
    expect(normalizeAutoFillSuggestions({ brandHexColor: 'blue' }).warnings).toEqual([
      '브랜드 컬러 제안이 #RRGGBB 형식이 아니라 뺐습니다.',
    ])
    expect(normalizeAutoFillSuggestions({ brandHexColor: '#FAFAFA' })).toEqual({
      suggestions: {},
      warnings: ['브랜드 컬러 제안(#FAFAFA)이 검정·흰색에 가까워 뺐습니다.'],
    })
    expect(normalizeAutoFillSuggestions({ targetPersona: '  ', brandHexColor: '' })).toEqual({
      suggestions: {},
      warnings: [],
    })
    expect(normalizeAutoFillSuggestions(null)).toEqual({ suggestions: {}, warnings: [] })
    expect(normalizeAutoFillSuggestions({ targetPersona: 3 })).toEqual({ suggestions: {}, warnings: [] })
  })
})
