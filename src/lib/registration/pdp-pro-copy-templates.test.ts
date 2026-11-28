/**
 * 인증·이벤트 템플릿(P0-1b) — 입력 인증 문구 그대로, 입력에 없는 순위·시험·심사·보증·정책 약속을 덧붙이지 않는다.
 */

import { describe, expect, it } from 'vitest'
import { buildCertificationBadgePrompt } from '@/lib/agents/registration/prompts/pdp-image-pro-prompts'
import { createSectionElements } from './editor/utils/sectionConverter'
import { ProSectionType } from './editor/types/section'
import type { DesignPalette } from './editor/types/editor'
import { composePdp } from './pdp-composer'
import { detectCertType, generateCertificationCopy, generateEventBannerCopy } from './pdp-pro-copy-templates'
import type { PdpSpecSheet } from './pdp-state'

const cert = (certificationInfo: string, brandName = '페어넥스') =>
  generateCertificationCopy({ productName: '구디백', brandName, certificationInfo } as PdpSpecSheet)!

const event = (eventBannerInfo: string) =>
  generateEventBannerCopy({ productName: '구디백', eventBannerInfo } as PdpSpecSheet)!

/** 입력에 없으면 템플릿이 만들면 안 되는 말 */
const INVENTED =
  /1위|No\.1|공인|시험기관|전문가|심사|보증|A\/S|교환|환불|승인|검증 완료|정품|공식|베스트셀러|재구매|판매량/

describe('generateCertificationCopy — 입력 인증 문구 그대로', () => {
  it('항목을 나눠 첫 항목은 제목, 나머지는 목록 — 강조·경고·부제·배지 줄 문구를 만들지 않는다', () => {
    expect(cert('KC 인증, 특허 제10-1234567호')).toEqual({
      headline: 'KC 인증',
      sub_copy: '',
      highlight_text: '',
      bullet_points: ['특허 제10-1234567호'],
      warning_text: '',
      cert_badges_text: '',
      cert_type: 'safety',
    })
    expect(cert('  ')).toBeUndefined()
  })

  it('괄호 안과 숫자 사이의 쉼표·슬래시는 나누지 않는다', () => {
    expect([cert('KS C 1234/2020').headline, ...cert('KS C 1234/2020').bullet_points]).toEqual(['KS C 1234/2020'])
    const en = cert('EN71-1/2/3, KC')
    expect([en.headline, ...en.bullet_points]).toEqual(['EN71-1/2/3', 'KC'])
    const paren = cert('KC 인증(어린이제품, 공급자적합성)/FDA 등록')
    expect([paren.headline, ...paren.bullet_points]).toEqual(['KC 인증(어린이제품, 공급자적합성)', 'FDA 등록'])
    const slash = cert('KC/FDA · ISO 9001\nKC')
    expect([slash.headline, ...slash.bullet_points]).toEqual(['KC', 'FDA', 'ISO 9001'])
  })

  it('입력에 없는 순위·시험·심사·보증·정책을 덧붙이지 않고, 낱말을 바꿔 부르지 않는다(FDA 등록 ≠ 승인)', () => {
    for (const input of ['KC 인증', 'FDA 등록', '레드닷 디자인 어워드 2025', '쿠팡 입점', '자체 품질 검사'])
      expect(JSON.stringify(cert(input)), input).not.toMatch(INVENTED)
    expect(cert('FDA 등록').headline).toBe('FDA 등록')
  })

  it('순위는 순위 낱말이 있을 때만 — 플랫폼 이름만으로는 순위로 보지 않고, 있으면 입력 그대로', () => {
    expect(cert('쿠팡 입점').cert_type).toBe('genuine')
    expect(cert('올리브영 인기 상품').cert_type).toBe('genuine')
    const ranked = cert('쿠팡 생활용품 랭킹 3위')
    expect(ranked.cert_type).toBe('ranking')
    expect(ranked.headline).toBe('쿠팡 생활용품 랭킹 3위')
    expect(JSON.stringify(ranked)).not.toContain('1위')
  })

  it('순위 낱말은 경계를 본다 — 인증·특허 번호의 No., STOP·laptop은 순위가 아니다', () => {
    expect(detectCertType('특허 No.1023456')).toBe('safety')
    expect(detectCertType('KC 인증 No.12345')).toBe('safety')
    expect(detectCertType('STOP 마크')).toBe('genuine')
    expect(detectCertType('laptop 거치 인증')).toBe('genuine')
    for (const input of ['판매 11위', 'BEST 상품', 'TOP 10', 'No.1 브랜드', '베스트셀러'])
      expect(detectCertType(input), input).toBe('ranking')
  })

  it('영문 인증 약칭은 낱말 경계 — KCL·KFDA·CERTIFIED·ULTRA를 KC·FDA·CE·UL로 보지 않는다', () => {
    expect(detectCertType('KCL 시험성적서')).toBe('genuine')
    expect(detectCertType('CERTIFIED ULTRA')).toBe('genuine')
    expect(detectCertType('KC인증')).toBe('safety')
    expect(detectCertType('KFDA')).toBe('safety')
  })

  it('정품·공식 판매처 입력도 입력 문구만 — 100% 정품 보증·A/S·교환·환불 약속을 붙이지 않는다', () => {
    const genuine = cert('페어넥스 공식 판매처')
    expect(genuine.headline).toBe('페어넥스 공식 판매처')
    expect(JSON.stringify(genuine)).not.toMatch(/보증|A\/S|교환|환불|위조품/)
  })
})

describe('인증 배지 이미지 프롬프트', () => {
  it("순위 낱말이 없으면 순위 배지를 그리지 않고, 1위·No.1이 있을 때만 숫자 '1'", () => {
    expect(buildCertificationBadgePrompt('쿠팡 입점')).not.toMatch(/crown|number '1'/)
    expect(buildCertificationBadgePrompt('쿠팡 랭킹 3위')).toContain('no numbers')
    expect(buildCertificationBadgePrompt('쿠팡 랭킹 3위')).not.toContain("number '1'")
    expect(buildCertificationBadgePrompt('쿠팡 생활용품 1위')).toContain("number '1'")
    expect(buildCertificationBadgePrompt('No.1 브랜드')).toContain("number '1'")
    for (const input of ['판매 11위', 'BEST No.10', '특허 No.1023456', 'KC 인증 No.12345'])
      expect(buildCertificationBadgePrompt(input), input).not.toContain("number '1'")
  })

  it('FDA는 정부 공식 인장을 흉내 내지 않는다(약칭 글자만 든 일반 배지)', () => {
    const prompt = buildCertificationBadgePrompt('FDA 등록')
    expect(prompt).not.toContain('circular blue seal with eagle')
    expect(prompt).toContain('not an official government seal')
  })

  it('정품·기본 인증 배지는 인증·위조 방지 실이나 기관 인장처럼 그리지 않는다, 약칭은 낱말 경계', () => {
    const genuine = buildCertificationBadgePrompt('쿠팡 입점')
    expect(genuine).not.toMatch(/Anti-counterfeit|authentication sticker|product verification/)
    const fallback = buildCertificationBadgePrompt('특허 제10-1234567호')
    expect(fallback).not.toContain('government-style')
    expect(fallback).toContain('not an official government or agency seal')
    expect(buildCertificationBadgePrompt('KFDA 등록')).not.toContain("initials 'FDA'")
    expect(buildCertificationBadgePrompt('KCL 시험성적서, 특허')).not.toContain('KC safety certification mark')
  })
})

describe('이벤트 배너', () => {
  it('할인 표시는 할인·세일·OFF·쿠폰에 붙은 퍼센트·금액만 — 구매 조건 금액·적립·정품 퍼센트는 아니다', () => {
    expect(event('3만원 이상 구매 시 사은품 증정').highlight_text).toBe('')
    expect(event('3만원 이상 구매 시 5,000원 할인').highlight_text).toBe('5,000원 할인')
    expect(event('5000원 할인 쿠폰').highlight_text).toBe('5000원 할인')
    expect(event('전 품목 20% 세일').highlight_text).toBe('20% OFF')
    expect(event('SALE 15%').highlight_text).toBe('15% OFF')
    expect(event('최대 30% 할인').highlight_text).toBe('최대 30% OFF')
    expect(event('구매 금액 5% 적립').highlight_text).toBe('')
    expect(event('100% 정품 사은품 증정').highlight_text).toBe('')
  })

  it('고정 문구가 입력에 없는 사실을 말하지 않는다 — 전원 증정·수량 한정·쿠폰', () => {
    expect(event('3만원 이상 구매 시 사은품 증정').sub_copy).not.toContain('구매 고객님께')
    const limited = event('한정 판매')
    expect(`${limited.sub_copy} ${limited.urgency_text}`).not.toContain('수량 한정')
    expect(event('10/31까지 한정 판매').urgency_text).toBe('⏰ 10/31까지 한정')
    expect(event('전 품목 적용 이벤트').badge_text).not.toBe('COUPON')
    expect(event('100% 국내산 이벤트').badge_text).not.toBe('SPECIAL OFFER')
  })
})

describe('조립기·편집기', () => {
  const composeCert = (certificationInfo: string, withCopy: boolean) =>
    composePdp({
      mode: 'pro',
      copy: {
        mainIntro: { title: '구디백' },
        ...(withCopy ? { certificationCopy: cert(certificationInfo) } : {}),
      },
      images: {},
      specSheet: { productName: '구디백', brandName: '페어넥스', certificationInfo },
      sectionPlan: { section_order: ['certification', 'cta'] },
    } as unknown as Parameters<typeof composePdp>[0])

  it('인증 카피가 없으면 final_html 인증 제목은 입력 인증 문구 — "{브랜드} 정품 인증"을 만들지 않는다', () => {
    const { sections } = composeCert('KC 인증', false)
    expect(sections.find((s) => s.type === 'certification')?.headline).toBe('KC 인증')
  })

  it('final_html은 둘째 인증 항목부터도 그린다(목록)', () => {
    const { finalHtml } = composeCert('KC 인증, FDA 등록, ISO 9001', true)
    for (const item of ['KC 인증', 'FDA 등록', 'ISO 9001']) expect(finalHtml, item).toContain(item)
  })

  it('편집기 배지 줄은 배지 이미지와 겹치지 않는다', () => {
    const palette: DesignPalette = {
      primary: '#1A1A2E',
      secondary: '#E94560',
      bgMain: '#FFFFFF',
      bgSub: '#F7F7F7',
      textMain: '#333333',
      textHighlight: '#1A1A2E',
    }
    const elements = createSectionElements(
      ProSectionType.CERTIFICATION,
      { text: 'KC 인증', certBadgesText: 'KC | FDA' },
      'https://cdn.example.com/badge.png',
      palette
    )
    const badge = elements.find((e) => e.name === 'cert_badge')!
    const line = elements.find((e) => e.name === 'cert_badges')!
    expect(line.transform.y >= badge.transform.y + badge.transform.height).toBe(true)
  })
})
