/**
 * PDP Pro 전용 템플릿 카피 엔진 — NEXFIT agents/copywriting_agent.py
 * _generate_certification_copy(:368-510)·_generate_event_banner_copy(:557-606) 1:1 이식.
 * LLM 호출 없음(비용 0) — 키워드 감지 + 결정적 문구 조합만 수행한다.
 * Pro + certificationInfo/eventBannerInfo 입력이 있을 때만 pdp-copy-agent.ts가 호출한다.
 */

import type { PdpSpecSheet } from './pdp-state'

// ─────────────────────────────────────────────────────────────────
// 인증 섹션 — 입력 인증 문구 그대로(P0-1b, 2026-10-30 오너 지시 '근거 없는 기본값 제거')
// NEXFIT 원본(copywriting_agent.py:336-510)은 유형별 문구 풀에서 '랭킹 1위'·'국내외 공인 시험기관의 엄격한 기준 통과'·'전 세계 전문가
// 심사를 통과'·'공식 보증'·'100% 정품 보증'·'무상 A/S 및 교환·환불 보장'을 골라 붙였다. 입력에 없는 순위·시험·보증·정책 약속이라
// 모두 뺀다. 제목은 판매자가 적은 첫 항목, 나머지 항목은 목록으로 — 낱말을 바꿔 부르지 않는다('FDA 등록'을 'FDA 승인'으로 등)
// ─────────────────────────────────────────────────────────────────

/**
 * 순위 근거 — 순위 낱말이 있을 때만. 플랫폼 이름·'인기'·'판매량'만으로는 순위가 아니다(입력 '쿠팡 입점'에 1위를 붙이지 않는다).
 * 낱말 경계를 본다 — '특허 No.1023456'·'KC 인증 No.12345'(번호)·'STOP'·'laptop'은 순위가 아니다
 */
export const RANKING_CERT_PATTERN =
  /(?<![\d.,])\d{1,3}\s?위|랭킹|순위|베스트|(?<![A-Za-z])(?:BEST(?:SELLER)?|TOP)(?![A-Za-z])|(?<![A-Za-z])No\.?\s?1(?![\d.,])/i
/** 1위 — 숫자 '1'을 그려도 되는 입력만('11위'·'No.10'·'No.1023456'은 1위가 아니다) */
export const FIRST_RANK_PATTERN = /(?<![\d.,])1\s?위|(?<![A-Za-z])No\.?\s?1(?![\d.,])/i
const AWARD_CERT_KEYWORDS: readonly string[] = ['레드닷', 'iF', '어워드', '수상', '디자인상']
const SAFETY_CERT_KEYWORDS: readonly string[] = ['KC', 'FDA', 'ISO', 'CE', 'GMP', 'HACCP', 'KFDA', 'UL', 'ROHS', '특허', '식약처']

/** 인증 낱말 포함 — 영문 약칭은 앞뒤가 영문자가 아닐 때만('KCL'의 KC·'KFDA'의 FDA·'CERTIFIED'의 CE·'ULTRA'의 UL은 아니다) */
export function hasCertWord(text: string, word: string): boolean {
  if (!/^[A-Za-z]+$/.test(word)) return text.includes(word)
  return new RegExp(`(?<![A-Za-z])${word}(?![A-Za-z])`).test(text)
}

/** 인증 유형 — 판정 순서(ranking→award→safety→genuine)는 NEXFIT 원문 그대로. 인증 배지 이미지 프롬프트도 이 판정을 쓴다 */
export function detectCertType(certInfo: string): 'ranking' | 'award' | 'safety' | 'genuine' {
  if (RANKING_CERT_PATTERN.test(certInfo)) return 'ranking'
  if (AWARD_CERT_KEYWORDS.some((kw) => hasCertWord(certInfo, kw))) return 'award'
  if (SAFETY_CERT_KEYWORDS.some((kw) => hasCertWord(certInfo, kw))) return 'safety'
  return 'genuine'
}

/**
 * 인증 입력 → 판매자가 적은 항목 그대로. 쉼표·슬래시·가운뎃점·세로선·줄바꿈·세미콜론으로 나누되 괄호 안과 숫자 사이의 쉼표·슬래시
 * ('KS C 1234/2020'·'EN71-1/2/3'·'1,000')는 나누지 않는다. 중복은 뺀다
 */
function certItems(certInfo: string): string[] {
  const items: string[] = []
  let current = ''
  let depth = 0
  for (let i = 0; i < certInfo.length; i++) {
    const ch = certInfo[i]
    if ('([{（［'.includes(ch)) depth++
    else if (')]}）］'.includes(ch)) depth = Math.max(0, depth - 1)
    const betweenDigits = /[,/]/.test(ch) && /\d/.test(certInfo[i - 1] ?? '') && /\d/.test(certInfo[i + 1] ?? '')
    if (depth === 0 && /[,/·|\n;]/.test(ch) && !betweenDigits) {
      items.push(current)
      current = ''
    } else current += ch
  }
  items.push(current)
  return [...new Set(items.map((item) => item.trim()).filter(Boolean))]
}

export interface CertificationCopy {
  headline: string
  sub_copy: string
  highlight_text: string
  bullet_points: string[]
  warning_text: string
  cert_badges_text: string
  cert_type: string
}

/** 인증 섹션 카피 — certificationInfo 없으면 undefined(섹션 스킵). 입력 문구만 싣고 순위·시험·보증·정책 문구를 덧붙이지 않는다 */
export function generateCertificationCopy(specSheet: PdpSpecSheet): CertificationCopy | undefined {
  const certInfo = (specSheet.certificationInfo ?? '').trim()
  if (!certInfo) return undefined
  const items = certItems(certInfo)
  return {
    headline: items[0] ?? certInfo,
    sub_copy: '',
    highlight_text: '',
    bullet_points: items.slice(1),
    warning_text: '',
    // 제목·목록이 이미 모든 항목을 싣는다 — 같은 글을 배지 줄로 되풀이하지 않는다
    cert_badges_text: '',
    cert_type: detectCertType(certInfo),
  }
}

// ─────────────────────────────────────────────────────────────────
// 이벤트 배너 — copywriting_agent.py:512-606
// ─────────────────────────────────────────────────────────────────

interface EventCategory {
  keywords: readonly string[]
  badge: string
  cta: string
  sub_default: string
}

const EVENT_CATEGORIES: Record<string, EventCategory> = {
  discount: { keywords: ['할인', '세일', 'sale', 'off', '반값', '특가', '최저가'], badge: 'SPECIAL OFFER', cta: '지금 바로 할인받기', sub_default: '이 기회를 놓치지 마세요' },
  gift: { keywords: ['증정', '사은품', '선물', 'gift', '무료 제공', '덤'], badge: 'BONUS GIFT', cta: '사은품과 함께 구매하기', sub_default: '' },
  free_shipping: { keywords: ['무료배송', '무배', '배송비 무료', 'free shipping'], badge: 'FREE SHIPPING', cta: '무료배송으로 주문하기', sub_default: '배송비 걱정 없이 편하게 쇼핑하세요' },
  limited: { keywords: ['한정', '마감', '선착순', 'until', '까지', '소진시', '한시적'], badge: 'LIMITED TIME', cta: '마감 전 서두르세요', sub_default: '' },
  bundle: { keywords: ['1+1', '번들', '세트', '묶음', '추가', '2개', '3개'], badge: 'BUNDLE DEAL', cta: '세트로 담아 보세요', sub_default: '' },
  coupon: { keywords: ['쿠폰', 'coupon'], badge: 'COUPON', cta: '쿠폰 적용하고 구매하기', sub_default: '지금 바로 쿠폰 혜택을 받아보세요' },
}
const EVENT_GENERAL: EventCategory = { keywords: [], badge: 'EVENT', cta: '이벤트 혜택 받기', sub_default: '고객님을 위한 특별한 혜택' }
// P0-1b 문구 정리: '%'만으로 할인으로 보지 않는다('100% 정품'), 사은품은 조건부일 수 있어 '구매 고객님께 … 드립니다' 대신 구성 안내,
// 기간 한정 입력에 '수량 한정'을 붙이지 않는다, '코드'·'적용'만으로 쿠폰으로 보지 않는다('전 품목 적용')

/**
 * 할인 표시 — 할인·세일·OFF·쿠폰 낱말에 붙은 퍼센트·금액만, '최대'는 그대로. '5% 적립'·'100% 정품'은 할인율이 아니고,
 * '3만원 이상 구매 시 5,000원 할인'은 5,000원이다
 */
function discountText(eventInfo: string): string {
  const pct =
    /(최대\s*)?(\d+(?:\.\d+)?)\s*%\s*(?:할인|세일|sale|off)/i.exec(eventInfo) ??
    /(?:할인|세일|sale|off)\s*(최대\s*)?(\d+(?:\.\d+)?)\s*%/i.exec(eventInfo)
  if (pct) return `${pct[1] ? '최대 ' : ''}${pct[2]}% OFF`
  const amt =
    /(최대\s*)?(\d[\d,]*)\s*(천원|만원|원)\s*(?:할인|쿠폰)/.exec(eventInfo) ??
    /(?:할인|쿠폰)\s*(최대\s*)?(\d[\d,]*)\s*(천원|만원|원)/.exec(eventInfo)
  return amt ? `${amt[1] ? '최대 ' : ''}${amt[2]}${amt[3]} 할인` : ''
}

export interface EventBannerCopy {
  headline: string
  sub_copy: string
  highlight_text: string
  cta_text: string
  urgency_text: string
  badge_text: string
}

/** 이벤트 배너 카피를 템플릿 기반으로 생성 — eventBannerInfo 없으면 undefined(섹션 스킵) */
export function generateEventBannerCopy(specSheet: PdpSpecSheet): EventBannerCopy | undefined {
  const eventInfo = (specSheet.eventBannerInfo ?? '').trim()
  if (!eventInfo) return undefined

  const eventLower = eventInfo.toLowerCase()
  const matchedCat = Object.values(EVENT_CATEGORIES).find((cat) => cat.keywords.some((kw) => eventLower.includes(kw))) ?? EVENT_GENERAL

  // 금액·퍼센트는 할인을 말할 때만 — '3만원 이상 구매 시 사은품'의 3만원을 할인으로 바꾸지 않는다
  const highlightText = discountText(eventInfo)

  const deadlineMatch = /[~∼]?\s*(\d{1,2}\/\d{1,2})\s*(까지)?/.exec(eventInfo)
  const countMatch = /(선착순\s*\d+\s*명)/.exec(eventInfo)
  let urgencyText = ''
  if (deadlineMatch) urgencyText = `⏰ ${deadlineMatch[1]}까지 한정`
  else if (countMatch) urgencyText = `⏰ ${countMatch[1]} 한정`

  return {
    headline: eventInfo,
    sub_copy: matchedCat.sub_default,
    highlight_text: highlightText,
    cta_text: matchedCat.cta,
    urgency_text: urgencyText,
    badge_text: matchedCat.badge,
  }
}
