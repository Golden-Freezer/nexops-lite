/**
 * PDP Pro 전용 템플릿 카피 엔진 — NEXFIT agents/copywriting_agent.py
 * _generate_certification_copy(:368-510)·_generate_event_banner_copy(:557-606) 1:1 이식.
 * LLM 호출 없음(비용 0) — 키워드 감지 + 결정적 문구 조합만 수행한다.
 * Pro + certificationInfo/eventBannerInfo 입력이 있을 때만 pdp-copy-agent.ts가 호출한다.
 */

import type { PdpSpecSheet } from './pdp-state'

function pickOne<T>(items: readonly T[]): T {
  return items[Math.floor(Math.random() * items.length)]
}

// ─────────────────────────────────────────────────────────────────
// 인증 섹션 — copywriting_agent.py:336-510
// ─────────────────────────────────────────────────────────────────

const CERT_TYPE_KEYWORDS: Record<string, readonly string[]> = {
  ranking: ['1위', '랭킹', '순위', '판매량', '올리브영', '쿠팡', '베스트', 'TOP', '인기'],
  award: ['레드닷', 'iF', '어워드', '수상', '디자인상'],
  safety: ['KC', 'FDA', 'ISO', 'CE', 'GMP', 'HACCP', 'KFDA', 'UL', 'ROHS', '특허', '식약처'],
}

function detectCertType(certInfo: string): 'ranking' | 'award' | 'safety' | 'genuine' {
  for (const [ctype, keywords] of Object.entries(CERT_TYPE_KEYWORDS)) {
    if (keywords.some((kw) => certInfo.includes(kw))) return ctype as 'ranking' | 'award' | 'safety'
  }
  return 'genuine'
}

const CERT_KNOWN_KEYWORDS = new Set([
  'KC', 'FDA', 'ISO', 'CE', 'GMP', 'HACCP', 'KFDA', 'UL', 'ROHS', 'CSA',
  'KS', 'EMC', 'USDA', 'iF', '레드닷', '특허', '식약처',
])

/** cert_info에서 브랜드명 추출 시도('XX 정품 인증' → 'XX') — copywriting_agent.py:356-366 */
function extractBrandFromCertInfo(certInfo: string): string {
  for (const marker of ['정품', '공식', '인증', '본사']) {
    const m = new RegExp(`^(.+?)\\s*${marker}`).exec(certInfo)
    if (m) {
      const candidate = m[1].trim()
      if (candidate.length > 1 && candidate.length <= 20 && !CERT_KNOWN_KEYWORDS.has(candidate)) {
        return candidate
      }
    }
  }
  return ''
}

const CERT_KEYWORD_LABELS: Array<[string, string]> = [
  ['KC', 'KC 인증'], ['FDA', 'FDA 승인'], ['특허', '특허 취득'],
  ['ISO', 'ISO 인증'], ['GMP', 'GMP 인증'], ['HACCP', 'HACCP 인증'],
  ['레드닷', '레드닷 디자인 어워드'], ['iF', 'iF 디자인 어워드'],
  ['정품', '정품 인증'], ['공식', '공식 인증'],
  ['CE', 'CE 인증'], ['KFDA', '식약처 인증'], ['USDA', 'USDA 인증'],
  ['KS', 'KS 규격 인증'], ['EMC', 'EMC 인증'], ['UL', 'UL 인증'],
  ['CSA', 'CSA 인증'], ['ROHS', 'RoHS 인증'],
]

export interface CertificationCopy {
  headline: string
  sub_copy: string
  highlight_text: string
  bullet_points: string[]
  warning_text: string
  cert_badges_text: string
  cert_type: string
}

/** 인증 섹션 카피를 템플릿 기반으로 생성 — certificationInfo 없으면 undefined(섹션 스킵) */
export function generateCertificationCopy(specSheet: PdpSpecSheet): CertificationCopy | undefined {
  const certInfo = (specSheet.certificationInfo ?? '').trim()
  if (!certInfo) return undefined

  const brand = (specSheet.brandName ?? '').trim() || extractBrandFromCertInfo(certInfo)
  const certType = detectCertType(certInfo)
  const matched = CERT_KEYWORD_LABELS.filter(([k]) => certInfo.includes(k)).map(([, v]) => v)
  let certBadgesText = matched.length > 0 ? matched.join(' | ') : certInfo
  const brandLabel = brand || '브랜드'

  let headline: string
  let subCopy: string
  let highlightText: string
  const bulletPoints: string[] = []

  if (certType === 'ranking') {
    const platform = ['올리브영', '쿠팡', '네이버', 'SSG', '무신사', '마켓컬리'].find((p) => certInfo.includes(p)) ?? ''
    const platformLabel = platform ? ` ${platform}` : ''
    headline = pickOne([
      `소비자가 선택한${platformLabel} No.1`,
      `${brandLabel}${platformLabel} 랭킹 1위`,
      `${brandLabel}, 판매량이 증명합니다`,
    ])
    subCopy = `${brandLabel}은${platformLabel} 베스트셀러로 검증된 제품입니다.\n수많은 고객이 선택한 데는 이유가 있습니다.`
    highlightText = platform ? `${platformLabel} BEST SELLER` : 'BEST SELLER'
    bulletPoints.push(
      `${brandLabel}${platformLabel} 베스트 랭킹 달성`,
      '누적 판매량 기반 실구매 검증 제품',
      '높은 재구매율이 증명하는 만족도',
    )
  } else if (certType === 'award') {
    const awardLabel = ['레드닷', 'iF', '어워드'].find((a) => certInfo.includes(a)) ?? '디자인 어워드'
    headline = pickOne([
      `${awardLabel} 수상, 세계가 인정한 디자인`,
      `${brandLabel}, ${awardLabel} 수상 제품`,
      `글로벌 디자인 어워드가 인정한 ${brandLabel}`,
    ])
    subCopy = `${brandLabel}은 ${awardLabel} 수상을 통해\n세계적 수준의 디자인과 품질을 인정받았습니다.`
    highlightText = `${awardLabel} WINNER`
    bulletPoints.push(
      `${awardLabel} 수상 — 글로벌 디자인 품질 인증`,
      '전 세계 전문가 심사를 통과한 제품',
      `${brandLabel}의 기술력과 디자인 철학의 결정체`,
    )
  } else if (certType === 'safety') {
    headline = pickOne(['까다로운 기준, 확실한 검증', `${brandLabel}, 공인 인증으로 증명합니다`, '국제 기준을 통과한 안심 제품'])
    subCopy = `${certBadgesText} 검증을 완료한 제품입니다.\n엄격한 국내외 기준을 통과하여 안심하고 사용할 수 있습니다.`
    highlightText = '공인 인증 완료'
    bulletPoints.push(
      `${certBadgesText} 검증 완료`,
      '국내외 공인 시험기관의 엄격한 기준 통과',
      `${brandLabel} 제품의 안전성과 품질을 공식 보증`,
    )
  } else {
    const hasGenuineKw = certInfo.includes('정품')
    const hasOfficialKw = certInfo.includes('공식')
    headline = pickOne([
      `${brandLabel} 공식 인증 판매처`,
      '정품과 유사품의 확실한 차이',
      `믿을 수 있는 ${brandLabel}, 공식 판매처에서`,
      `${brandLabel} 정품만을 취급합니다`,
    ])
    if (hasGenuineKw) {
      subCopy = `본 판매처는 ${brandLabel}에서 공식 인증한 정품 취급점입니다.\n정품 구매 시에만 본사 A/S가 보장됩니다.`
    } else if (hasOfficialKw) {
      subCopy = `${brandLabel}가 직접 인증한 공식 판매처입니다.\n안심하고 구매하세요.`
    } else {
      subCopy = `본 판매처는 ${brandLabel} 공식 인증 판매처입니다.\n정품 구매 시에만 본사 A/S가 보장됩니다.`
    }
    highlightText = '100% 정품 보증'
    certBadgesText = brand ? `${brandLabel} 공식 정품 인증` : certBadgesText
    bulletPoints.push(`${brandLabel} 본사에서 공식 인증한 정품 판매처입니다.`, '공식 판매처 구매 시 무상 A/S 및 교환·환불이 보장됩니다.')
    if (matched.length > 0) bulletPoints.push(`${certBadgesText} 검증 완료 제품입니다.`)
  }

  if (certType === 'genuine' || certType === 'safety') {
    bulletPoints.push('비공식 채널 구매 시 위조품 위험 및 A/S 불가에 유의하세요.')
  }

  return {
    headline,
    sub_copy: subCopy,
    highlight_text: highlightText,
    bullet_points: bulletPoints,
    warning_text: '비공식 판매처에서 구입 시 교환·환불·A/S 처리가 제한될 수 있습니다.',
    cert_badges_text: certBadgesText,
    cert_type: certType,
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
  discount: { keywords: ['할인', '세일', 'sale', 'off', '%', '반값', '특가', '최저가'], badge: 'SPECIAL OFFER', cta: '지금 바로 할인받기', sub_default: '이 기회를 놓치지 마세요' },
  gift: { keywords: ['증정', '사은품', '선물', 'gift', '무료 제공', '덤'], badge: 'BONUS GIFT', cta: '사은품과 함께 구매하기', sub_default: '구매 고객님께 특별한 선물을 드립니다' },
  free_shipping: { keywords: ['무료배송', '무배', '배송비 무료', 'free shipping'], badge: 'FREE SHIPPING', cta: '무료배송으로 주문하기', sub_default: '배송비 걱정 없이 편하게 쇼핑하세요' },
  limited: { keywords: ['한정', '마감', '선착순', 'until', '까지', '소진시', '한시적'], badge: 'LIMITED TIME', cta: '마감 전 서두르세요', sub_default: '수량 한정, 조기 마감될 수 있습니다' },
  bundle: { keywords: ['1+1', '번들', '세트', '묶음', '추가', '2개', '3개'], badge: 'BUNDLE DEAL', cta: '세트로 더 알뜰하게', sub_default: '함께 구매하면 더 합리적인 가격' },
  coupon: { keywords: ['쿠폰', 'coupon', '코드', '적용'], badge: 'COUPON', cta: '쿠폰 적용하고 구매하기', sub_default: '지금 바로 쿠폰 혜택을 받아보세요' },
}
const EVENT_GENERAL: EventCategory = { keywords: [], badge: 'EVENT', cta: '이벤트 혜택 받기', sub_default: '고객님을 위한 특별한 혜택' }

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

  const pctMatch = /(\d+)\s*%/.exec(eventInfo)
  const amtMatch = /(\d+)\s*(천원|만원|원)/.exec(eventInfo)
  const highlightText = pctMatch ? `${pctMatch[1]}% OFF` : amtMatch ? `${amtMatch[1]}${amtMatch[2]} 할인` : ''

  const deadlineMatch = /[~∼]?\s*(\d{1,2}\/\d{1,2})\s*(까지)?/.exec(eventInfo)
  const countMatch = /(선착순\s*\d+\s*명)/.exec(eventInfo)
  let urgencyText = ''
  if (deadlineMatch) urgencyText = `⏰ ${deadlineMatch[1]}까지 한정`
  else if (countMatch) urgencyText = `⏰ ${countMatch[1]} 한정`
  else if (matchedCat.badge === 'LIMITED TIME') urgencyText = '수량 한정, 조기 마감될 수 있습니다'

  return {
    headline: eventInfo,
    sub_copy: matchedCat.sub_default,
    highlight_text: highlightText,
    cta_text: matchedCat.cta,
    urgency_text: urgencyText,
    badge_text: matchedCat.badge,
  }
}
