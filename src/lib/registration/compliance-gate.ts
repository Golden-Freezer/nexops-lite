/**
 * 연령 제한 컴플라이언스 게이트 — 순수 함수, LLM 0 (오너 적발 2026-08-12: 만 14세 이상 상품인데
 * 산출물이 어린이 사용을 묘사 — 어린이제품 KC 인증 없는 상품은 만 14세 미만 사용 묘사·타겟팅이
 * 법적 리스크다. 어린이제품안전특별법상 만 13세 이하 대상 제품은 별도 KC 인증 필요).
 *
 * 3중 장치(spec_sheet.minAgeYears ≥ 14일 때만 발동 — 미설정 잡은 완전 무접촉):
 *  ① 카피 프롬프트 금지 블록 + 고지 문구 지시 (buildAgeComplianceCopyBlock)
 *  ② 이미지 프롬프트 금지 지시 — 미성년 묘사 금지 (buildAgeComplianceImageBlock)
 *  ③ 산출 후 검수: 어린이 표현 탐지(재생성 1회 지시) + 리뷰 원문 발췌는 재작성 불가라 제거 +
 *     고지 문구 존재 확인. 잔여 위반은 경고로 표면화(similarity gate와 동일 "경고만" 계약).
 *
 * 이 장치는 표현·묘사 차원의 방어일 뿐 법적 판단을 대체하지 않는다 — 상품별 인증 의무·표시 의무는
 * 전문 자격사 확인이 필요하다.
 */

import type { CopywritingResult, PdpSpecSheet } from './pdp-state'

/** 어린이제품 경계 — 이 값 이상으로 minAgeYears가 설정된 잡에서만 게이트가 발동한다. */
export const CHILD_AGE_THRESHOLD = 14

/** 단독으로도 어린이 사용을 지시하는 표현 (부분 문자열 매칭 안전) */
const CHILD_TERMS_PLAIN = ['어린이', '아동', '유아', '키즈', '아기', '초등학생', '유치원', '자녀'] as const

/**
 * '아이'는 복합어 오탐이 많아(아이템·아이디어·아이디·아이폰·아이콘·아이스·아이섀도·아이라이너)
 * 뒤따르는 음절을 제외하고 매칭한다. '아이들'은 항상 어린이 지칭이라 포함.
 */
const AI_WORD_REGEX = /아이(?!템|디|폰|콘|스|섀|라이너|메이크)/

export interface AgeComplianceFinding {
  section: string
  term: string
  sentence: string
}

export interface AgeComplianceReport {
  min_age: number
  removed_review_highlights: number
  notice_present: boolean
  violations: AgeComplianceFinding[]
}

/** 게이트 발동 여부 — minAgeYears가 어린이제품 경계 이상일 때만. */
export function isAgeRestricted(specSheet: PdpSpecSheet): boolean {
  return (specSheet.minAgeYears ?? 0) >= CHILD_AGE_THRESHOLD
}

/** 텍스트에서 어린이 표현을 찾는다 — 발견된 표현 목록(중복 제거). */
export function findChildTerms(text: string): string[] {
  const found = new Set<string>()
  for (const term of CHILD_TERMS_PLAIN) {
    if (text.includes(term)) found.add(term)
  }
  if (AI_WORD_REGEX.test(text)) found.add('아이')
  return [...found]
}

/** 필수 고지 문구 — 프롬프트 지시와 존재 검사가 같은 문자열 골격을 공유한다(만 N세 이상). */
export function ageNoticePhrase(minAge: number): string {
  return `만 ${minAge}세 이상`
}

/** ① 카피 프롬프트 금지 블록 — copywriting groundingBlock 말미에 append(양 트랙 공통). */
export function buildAgeComplianceCopyBlock(specSheet: PdpSpecSheet): string | null {
  if (!isAgeRestricted(specSheet)) return null
  const minAge = specSheet.minAgeYears!
  return [
    `[연령 제한 — 법적 준수, 다른 모든 지시보다 우선] 이 상품은 만 ${minAge}세 이상 사용 가능한 제품이다(어린이 KC 인증 없음).`,
    `- 어린이·아이·아동·유아·키즈 등 만 ${minAge}세 미만의 사용·등장을 묘사하거나 암시하는 표현을 카피 어디에도 쓰지 마라. "아이 생일파티", "아이들이 좋아해요" 같은 문장 전부 금지.`,
    '- 리뷰 인용(reviewHighlights)에도 어린이 사용이 담긴 문장을 선택하지 마라.',
    `- 클로징/CTA 부근에 "본 제품은 ${ageNoticePhrase(minAge)} 사용 가능한 제품입니다" 고지 문구를 반드시 포함하라.`,
  ].join('\n')
}

/** ② 이미지 프롬프트 금지 지시 — image stage의 grounding 블록에 append(전 컷 공통). */
export function buildAgeComplianceImageBlock(specSheet: PdpSpecSheet): string | null {
  if (!isAgeRestricted(specSheet)) return null
  const minAge = specSheet.minAgeYears!
  return (
    `[AGE RESTRICTION - MANDATORY] This product is for ages ${minAge}+ only (no child-product certification). ` +
    'Do NOT depict children, minors, toddlers, babies, or anyone who could appear under ' +
    `${minAge} years old in any image. No scenes implying use by children. Adults only.`
  )
}

/** 유사도 게이트와 동일한 재귀 수집 관례 — CopywritingResult의 문자열 리프 전수 검사. */
function collectViolations(value: unknown, section: string, out: AgeComplianceFinding[]): void {
  if (typeof value === 'string') {
    for (const term of findChildTerms(value)) {
      out.push({ section, term, sentence: value.length > 80 ? `${value.slice(0, 80)}…` : value })
    }
    return
  }
  if (Array.isArray(value)) {
    for (const item of value) collectViolations(item, section, out)
    return
  }
  if (value && typeof value === 'object') {
    for (const v of Object.values(value as Record<string, unknown>)) collectViolations(v, section, out)
  }
}

/** ③-a 산출 카피 전수 검사 — 어린이 표현 위반 목록. */
export function checkAgeCompliance(copy: CopywritingResult, minAge: number): {
  violations: AgeComplianceFinding[]
  noticePresent: boolean
} {
  const violations: AgeComplianceFinding[] = []
  for (const [section, value] of Object.entries(copy)) {
    collectViolations(value, section, violations)
  }
  return { violations, noticePresent: JSON.stringify(copy).includes(ageNoticePhrase(minAge)) }
}

/**
 * ③-b 리뷰 원문 발췌 제거 — reviewHighlights는 실제 리뷰 원문이라(창작 금지 규칙) 재작성이 불가능하다.
 * 어린이 표현이 담긴 발췌는 제거가 유일한 안전 처리다. 원본을 변형하지 않고 새 객체를 반환한다.
 */
export function stripChildReviewHighlights(copy: CopywritingResult): { copy: CopywritingResult; removed: number } {
  const highlights = copy.reviewHighlights
  if (!Array.isArray(highlights) || highlights.length === 0) return { copy, removed: 0 }
  const kept = highlights.filter((h) => findChildTerms(h?.text ?? '').length === 0)
  if (kept.length === highlights.length) return { copy, removed: 0 }
  return { copy: { ...copy, reviewHighlights: kept }, removed: highlights.length - kept.length }
}

/** 재생성 지시 블록 — 위반 문장을 명시해 같은 의미를 성인 문맥으로 다시 쓰게 한다(1회). */
export function buildAgeBanDirective(findings: AgeComplianceFinding[], minAge: number): string {
  const lines = findings.slice(0, 15).map((f) => `- [${f.section}] "${f.sentence}" (표현: ${f.term})`)
  return (
    `[연령 제한 재작성 지시] 아래 문장들은 만 ${minAge}세 미만 사용을 묘사·암시한다. ` +
    '같은 소구를 성인·일반 사용자 문맥으로 다시 쓰고, 어린이 관련 표현을 완전히 제거하라:\n' +
    lines.join('\n')
  )
}
