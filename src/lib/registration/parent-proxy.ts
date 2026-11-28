/**
 * 학부모 대리 구매형(parent_proxy) 판정 — 순수 함수, LLM 0.
 * 어린이 KC 인증 제품이 아닌데 실제로 사고 준비하는 사람은 학부모인 상품(어린이집·유치원 생일 답례, 구디백 등)을 가려
 * 잡 기록(analysis.enrichment.audience)에 남긴다. 기록을 읽어 페르소나·플래너·카피·이미지 지시를 학부모 쪽으로 돌리는 일은
 * 2단계다(통합 결정 2026-10-30, 오너 결정 (A): '어린이집·유치원 답례' 같은 말은 구매 상황 설명으로만 쓰고 아이가 쓰는 장면은 금지).
 *
 * 켜는 조건 — 어린이 KC 인증 정보가 없고 다음 중 하나:
 *  (a) 리뷰가 5건 이상이면 리뷰로 본다: 아이·기관 낱말이 든 리뷰가 5건 이상이고 20% 이상.
 *  (b) 리뷰가 그보다 적으면 상품명·검색 태그에 어린이집·유치원·구디백이 있을 때.
 * '엄마·아빠·부모님'은 세지 않는다 — 어버이날 선물 리뷰(어른 자녀가 부모에게)에 많이 나와 학부모 신호가 아니다.
 * 연령 게이트(minAgeYears ≥ 14)가 켜진 잡도 판정은 기록하되(ageGate: true) 게이트가 우선한다 — 행사 이름도 쓰지 않는다.
 * 이 판정은 표현을 고르는 장치일 뿐 어린이제품 해당 여부의 법적 판단을 대신하지 않는다.
 */

import { isAgeRestricted } from './compliance-gate'
import type { EnrichmentRecord } from './enrichment-switch'
import type { PdpSpecSheet } from './pdp-state'

/** 리뷰 판정 문턱 — 낱말이 든 리뷰 수와 비율 */
export const PARENT_PROXY_MIN_HITS = 5
export const PARENT_PROXY_MIN_SHARE = 0.2

/**
 * 아이·기관 낱말 — '아이'는 복합어(아이템·아이디어·아이폰·아이콘·아이스·아이섀도·아이보리·아이고 등), '아기'는 '아기자기',
 * '딸'은 '딸기'를 뺀다. '어린이'는 '어린이집'을 함께 잡는다
 */
const CHILD_CONTEXT_RE =
  /어린이|유치원|초등|자녀|키즈|학부모|아들|딸(?!기)|아기(?!자기)|아이(?!템|디|폰|콘|스|섀|라이너|메이크|보리|고)/
/** 리뷰가 적을 때 상품명·검색 태그에서 보는 낱말 */
const NAME_TAG_TERMS = ['어린이집', '유치원', '구디백'] as const
/** 인증 칸의 어린이제품 표기와 그 부정('어린이제품 아님'·'해당 없음' 등) */
const CHILD_CERT_RE = /어린이/
const CERT_NEGATION_RE = /아님|아닙니다|비대상|미대상|대상\s*(?:이\s*)?아|해당\s*(?:사항\s*)?없/

/** 리뷰 직렬화(serializeReviews) 표지 — [리뷰N] 메타 줄로 리뷰를 나누고, 머리말 줄은 세지 않는다 */
const SERIALIZED_META_RE = /^\[리뷰\d+\] /m
const SERIALIZED_HEADER_RE = /^(?:리뷰 전체: |표집: |\(길이 상한으로 )/
const NO_REVIEWS = '리뷰 데이터 없음'

export interface AudienceRecord {
  kind: 'parent_proxy'
  version: 1
  /** 판정 근거 — 리뷰(5건 이상) 또는 상품명·검색 태그 */
  basis: 'reviews' | 'name_tags'
  /** 리뷰 판정일 때만 — 본 리뷰 수와 아이·기관 낱말이 든 리뷰 수 */
  reviews?: { total: number; hits: number }
  /** 상품명·검색 태그 판정일 때만 — 걸린 낱말 */
  terms?: string[]
  /** 연령 게이트가 켜진 잡 — 게이트 규칙이 우선한다 */
  ageGate: boolean
}

export interface ParentProxyDecision {
  /** 켜진 잡만 — 잡에 남길 기록 */
  record: AudienceRecord | null
  /** 판정 사유(꺼진 잡 포함, 시험·실측 보고용) */
  reason: 'child_kc' | 'reviews' | 'name_tags' | 'none'
  reviews: { total: number; hits: number }
}

/** 리뷰 텍스트 → 리뷰 단위 본문. 직렬화 텍스트면 리뷰마다 제목·내용만(옵션 메타 제외), 붙여넣은 글이면 빈 줄이 아닌 줄마다 */
export function splitReviewBodies(reviewsText: string | undefined): string[] {
  const text = (reviewsText ?? '').trim()
  if (!text || text === NO_REVIEWS) return []
  if (!SERIALIZED_META_RE.test(text)) {
    return text
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
  }
  return text
    .split(/^(?=\[리뷰\d+\] )/m)
    .filter((block) => SERIALIZED_META_RE.test(block))
    .map((block) =>
      block
        .split('\n')
        .slice(1)
        .filter((line) => line.trim() && !SERIALIZED_HEADER_RE.test(line))
        .map((line) => line.replace(/^(?:제목|내용): /, ''))
        .join(' ')
        .trim()
    )
    .filter(Boolean)
}

/** 아이·기관 낱말이 든 리뷰 수 */
export function countChildContextReviews(reviewsText: string | undefined): { total: number; hits: number } {
  const bodies = splitReviewBodies(reviewsText)
  return { total: bodies.length, hits: bodies.filter((b) => CHILD_CONTEXT_RE.test(b)).length }
}

/** 인증 칸에 어린이제품 인증이 적혀 있는지 — '어린이제품 아님'·'해당 없음' 같은 부정은 인증이 아니다 */
export function hasChildCertification(spec: PdpSpecSheet): boolean {
  const cert = spec.certificationInfo ?? ''
  return CHILD_CERT_RE.test(cert) && !CERT_NEGATION_RE.test(cert)
}

export function detectParentProxy(spec: PdpSpecSheet): ParentProxyDecision {
  const reviews = countChildContextReviews(spec.reviewsText)
  if (hasChildCertification(spec)) return { record: null, reason: 'child_kc', reviews }
  const base = { kind: 'parent_proxy', version: 1, ageGate: isAgeRestricted(spec) } as const

  if (reviews.total >= PARENT_PROXY_MIN_HITS) {
    const on = reviews.hits >= PARENT_PROXY_MIN_HITS && reviews.hits / reviews.total >= PARENT_PROXY_MIN_SHARE
    return on
      ? { record: { ...base, basis: 'reviews', reviews }, reason: 'reviews', reviews }
      : { record: null, reason: 'none', reviews }
  }
  const haystack = [spec.productName, ...(spec.searchTags ?? [])].join('\n')
  const terms = NAME_TAG_TERMS.filter((t) => haystack.includes(t))
  return terms.length > 0
    ? { record: { ...base, basis: 'name_tags', terms }, reason: 'name_tags', reviews }
    : { record: null, reason: 'none', reviews }
}

/** 잡 기록에 판정을 더한다 — 기록이 없는 잡(대조군·Track S·켜진 기능 없음)이나 꺼진 판정이면 그대로 */
export function withAudience(
  record: EnrichmentRecord | null,
  audience: AudienceRecord | null
): EnrichmentRecord | null {
  return record && audience ? { ...record, audience } : record
}

/** analysis.enrichment.audience 읽기 — 형식이 맞지 않으면 null(기존 동작) */
export function readJobAudience(analysis: unknown): AudienceRecord | null {
  const enrichment = (analysis as { enrichment?: unknown } | null | undefined)?.enrichment
  const raw = (enrichment as { audience?: unknown } | null | undefined)?.audience
  if (!raw || typeof raw !== 'object') return null
  const a = raw as Partial<AudienceRecord>
  if (a.kind !== 'parent_proxy' || a.version !== 1 || typeof a.ageGate !== 'boolean') return null
  if (a.basis !== 'reviews' && a.basis !== 'name_tags') return null
  return a as AudienceRecord
}
