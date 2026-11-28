/**
 * K 장점 후보 근거 대조(결정 카드 c11, 하네스 J22 — 가정 C3 'USP 근거는 사실 감사 결과', 스위치 uspaudit 기본 off). 순수·결정론.
 *
 * 카피 뒤 사실 감사(copy_sections.fact_audit — 새 배치 + newstages 잡, 카피 단계에서 끝나 K 계획보다 먼저 있다)가 '근거 없음'(unsupported)으로
 * 본 주장과 글이 크게 겹치는 장점 후보를 K 사실 목록(uspFacts)에서 뺀다. 감사는 화면 글 줄을 보므로 장점 후보를 다른 말로 바꿔 쓴 줄은
 * 잡지 못한다 — 겹침이 큰 것만 뺀다(근거 있음·일부만 있음 판정은 쓰지 않는다). 감사 기록이 없거나 끝나지 않았으면 그대로 둔다.
 * 기록에는 글을 남기지 않고 수만 남긴다.
 */

import type { CopySectionsPayload } from '../pdp-state'

/**
 * 겹침 문턱 — 짧은 쪽 글자 짝(2글자) 가운데 긴 쪽에도 있는 몫. 11-09 사실 감사가 끝난 운영·시험 잡 2개의 장점 후보 × 감사 주장 295짝을 잰 값:
 * 주제가 다른 짝은 최대 0.25, 장점 후보를 바꿔 쓴 주장은 0.3~0.75(0.4 이상 8짝 모두 같은 주제). 근거 없음 주장 5개의 최대는 0.21이라 그 두 잡에서는 빠지는 후보가 없다
 */
export const USP_AUDIT_OVERLAP = 0.4
/** 짧은 쪽 글자 짝이 이보다 적으면 겹침을 보지 않는다 — 한두 낱말 주장이 흔한 낱말 하나로 장점 후보를 지우지 않게 */
const MIN_PAIRS = 3

export interface UspAuditRecord {
  /** 사실 감사 기록 상태 — done이 아니면 아무것도 빼지 않았다 */
  audit: 'done' | 'failed' | 'skipped' | 'none'
  /** 대조한 장점 후보 수와 뺀 수 */
  candidates: number
  dropped: number
  /** 대조에 쓴 근거 없음 주장 수 */
  unsupported: number
}

const squash = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')

function pairsOf(text: string): Set<string> {
  const s = squash(text)
  const pairs = new Set<string>()
  for (let i = 0; i + 1 < s.length; i++) pairs.add(s.slice(i, i + 2))
  return pairs
}

/** 두 글의 겹침 — 짧은 쪽 글자 짝 가운데 긴 쪽에도 있는 몫(짧은 쪽이 MIN_PAIRS 미만이면 0) */
export function pairOverlap(a: string, b: string): number {
  const pa = pairsOf(a)
  const pb = pairsOf(b)
  const small = pa.size <= pb.size ? pa : pb
  const large = small === pa ? pb : pa
  if (small.size < MIN_PAIRS) return 0
  let shared = 0
  for (const pair of small) if (large.has(pair)) shared++
  return shared / small.size
}

/** 장점 후보 → 근거 없음 주장과 겹치는 것을 뺀 목록과 수 기록. 순서는 그대로다 */
export function auditUspFacts(
  usps: readonly string[],
  audit: CopySectionsPayload['fact_audit'] | undefined
): { usps: string[]; record: UspAuditRecord } {
  if (!audit || audit.status !== 'done') {
    return { usps: [...usps], record: { audit: audit?.status ?? 'none', candidates: usps.length, dropped: 0, unsupported: 0 } }
  }
  const claims = audit.result.items.filter((item) => item.verdict === 'unsupported').map((item) => item.claim)
  const kept = usps.filter((usp) => !claims.some((claim) => pairOverlap(usp, claim) >= USP_AUDIT_OVERLAP))
  return { usps: kept, record: { audit: 'done', candidates: usps.length, dropped: usps.length - kept.length, unsupported: claims.length } }
}
