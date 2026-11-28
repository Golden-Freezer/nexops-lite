/**
 * 후기 유래 규제 표현 검출(R6, 2026-10-30) — 자사 리뷰가 있는 모든 잡의 최종 카피에서 인용 후보 차단과 같은 규제 사전(eval/claim-lexicon
 * findRegulatedClaims — 인증·인허가·의학·기능성)으로 찾아 기록만 한다. 지우거나 다시 쓰지 않는다(지우기는 다음 단계). 사용 경험·체감
 * 효익은 규제 표현이 아니라 세지 않는다. 고지·부정 문맥('치료 목적이 아닙니다')도 세지 않는다. 같은 표현은 하나로 묶고 나온 칸(최상위 키)을 모은다.
 * 등록 옵션명(options — 어느 깊이든)·상품명(최상위 title)은 오너가 정한 글이라 보지 않고(copy-facts와 같은 기준), 상품명·옵션 값에 든
 * 표현('항균 도마'의 항균)은 다른 칸에서도 세지 않는다 — 주장 범위 블록이 용도 이름은 그대로 쓰게 한다.
 */

import { findRegulatedClaims, normalizeClaimText, type RegulatedClaim, type TextBlock } from '../eval/claim-lexicon'
import { REVIEW_CLAIM_BLOCK } from '@/lib/agents/registration/prompts/pdp-claim-guard-prompts'
import type { CopywritingResult, PdpSpecSheet } from '../pdp-state'

/**
 * 후기 사용 범위 블록 — 자사 리뷰(spec_sheet.reviewsText)가 있는 모든 잡(Track S·I, 플래너 기록과 무관 — 운영 기본 생성도 막는다).
 * 리뷰가 없는 잡은 null(프롬프트 그대로). 이 판정이 최종 카피 검출(findCopyReviewClaims)도 켠다
 */
export function reviewClaimBlockFor(spec: Pick<PdpSpecSheet, 'reviewsText'>): string | null {
  return spec.reviewsText?.trim() ? REVIEW_CLAIM_BLOCK : null
}

/** 기록 상한 — copy_sections가 커지지 않게 */
export const REVIEW_CLAIM_RECORD_MAX = 30

/** 오너가 정한 글(등록 옵션명·상품명) — 카피가 만든 문장이 아니다 */
const isOwnerText = (key: string, depth: number) => key === 'options' || (depth === 0 && key === 'title')

function collectTexts(value: unknown, section: string, out: TextBlock[]): void {
  if (typeof value === 'string') {
    if (value.trim()) out.push({ section, text: value })
    return
  }
  if (Array.isArray(value)) {
    for (const item of value) collectTexts(item, section, out)
    return
  }
  if (value && typeof value === 'object') {
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      // 후기 카드의 original(P1-6 — 화면에 그리지 않는 원문 대조용)은 세지 않는다
      if (!isOwnerText(key, 1) && key !== 'original') collectTexts(v, section, out)
    }
  }
}

/** 최종 카피의 규제 표현 — allowedText(상품명·옵션 값)에 든 표현은 뺀다. 30건까지 */
export function findCopyReviewClaims(copy: CopywritingResult, allowedText = ''): RegulatedClaim[] {
  const allowed = normalizeClaimText(allowedText)
  const blocks: TextBlock[] = []
  for (const [section, value] of Object.entries(copy)) {
    if (!isOwnerText(section, 0)) collectTexts(value, section, blocks)
  }
  const inAllowed = (term: string) => Boolean(allowed) && allowed.includes(normalizeClaimText(term))
  return findRegulatedClaims(blocks, inAllowed).slice(0, REVIEW_CLAIM_RECORD_MAX)
}
