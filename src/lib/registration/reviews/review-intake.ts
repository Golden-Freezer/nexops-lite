/**
 * 리뷰 파일 받기 — 엑셀 바이트 → 파싱 → 정화 → 표집 → 잡 입력 형태(파싱 라우트가 그대로 돌려준다).
 * - 자사(own): 직렬화 텍스트를 spec_sheet.reviewsText로, 메타를 spec_sheet.reviewFiles.own으로. 인용 후보(reviewCandidates, W2a)는
 *   화면이 고를 목록이라 spec_sheet에 그대로 넣지 않는다(고른 카드만 spec_sheet.reviewQuotes로).
 * - 경쟁사(competitor): 판매자명·상품명을 지운 항목을 spec_sheet.competitorReviews로(옵션은 싣지 않는다, 상한 60건·10,000자).
 * 원본 파일은 어디에도 저장하지 않는다.
 */

import { buildReviewCandidates } from './review-candidates'
import { capCompetitorItems } from './competitor-reviews'
import { reviewSummaryEnabled } from './review-quote-cards'
import { parseReviewWorkbook } from './review-excel-parser'
import { competitorNames, sanitizeReviews } from './review-sanitize'
import { sampleReviews, serializeReviews } from './review-sample'
import {
  COMPETITOR_SAMPLE_LIMIT,
  OWN_SAMPLE_LIMIT,
  OWN_SERIALIZE_MAX_CHARS,
  type CompetitorReviews,
  type OwnReviewFileMeta,
  type ReviewCandidate,
  type ReviewFileKind,
} from './review-types'

export type ReviewIntake =
  | { kind: 'own'; reviewsText: string; meta: OwnReviewFileMeta; reviewCandidates: ReviewCandidate[] }
  | { kind: 'competitor'; competitorReviews: CompetitorReviews }

const FILE_NAME_MAX = 120

export function cleanFileName(name: string): string {
  const base = (name ?? '').split(/[\\/]/).pop() ?? ''
  return (
    base
      .replace(/[\u0000-\u001f]/g, '')
      .trim()
      .slice(0, FILE_NAME_MAX) || 'reviews.xlsx'
  )
}

export function intakeReviewFile(bytes: Uint8Array, kind: ReviewFileKind, fileName: string): ReviewIntake {
  const parsed = parseReviewWorkbook(bytes)
  const name = cleanFileName(fileName)
  if (kind === 'own') {
    const { reviews, dropped } = sanitizeReviews(parsed.reviews)
    if (reviews.length === 0) throw new Error('본문이 있는 리뷰가 없습니다.')
    const sampled = sampleReviews(reviews, OWN_SAMPLE_LIMIT)
    return {
      kind,
      reviewsText: serializeReviews(sampled, parsed.stats, OWN_SERIALIZE_MAX_CHARS),
      meta: { fileName: name, stats: parsed.stats, sampled: sampled.length, dropped },
      // 요약 표시(P1-6)가 켜지면 요약할 수 없는 후보는 사유 '요약'으로 흐리게 — 카드 단계와 같은 기준
      reviewCandidates: buildReviewCandidates(reviews, { summary: reviewSummaryEnabled() }),
    }
  }
  const names = competitorNames(parsed.sellers, parsed.productTitles)
  // 옵션은 경쟁사 항목에 싣지 않는다(capCompetitorItems가 제목·본문만 옮긴다)
  const { reviews, dropped } = sanitizeReviews(parsed.reviews, { removeNames: names.strip })
  if (reviews.length === 0) throw new Error('본문이 있는 리뷰가 없습니다.')
  const items = capCompetitorItems(sampleReviews(reviews, COMPETITOR_SAMPLE_LIMIT))
  return {
    kind,
    competitorReviews: {
      version: 1,
      fileName: name,
      stats: parsed.stats,
      dropped,
      items,
      removedNames: names.strip,
      checkNames: names.check,
    },
  }
}
