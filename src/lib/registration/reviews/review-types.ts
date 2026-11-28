/**
 * 리뷰 입력(pdp-review-input) 공용 타입·상한 — 런타임 의존 없음(화면 컴포넌트도 타입만 가져다 쓴다).
 * 오너 결정(2026-10-28): 자사 리뷰(WING 내보내기)는 생성 입력, 경쟁사 리뷰는 소구점 분석·기획 전용.
 * 저장은 잡 행 spec_sheet만 쓴다(스토리지 미사용 — 통합 결정). 자사는 직렬화 텍스트를 reviewsText에,
 * 경쟁사는 정화·표집한 항목을 competitorReviews에 둔다. 두 키 모두 프롬프트 직렬화에서 뺀다(buildSpecSheetJson).
 */

import type { QuoteBlockReason } from '../review-scrubber'

export type ReviewFileKind = 'own' | 'competitor'

/**
 * 인용 카드로 쓸 수 없는 후보의 사유 — 표시광고법 인용 금지 표현(인증·인허가·의학·기능성·최상급·대가성, review-scrubber)이거나 정화 표지('(연락처 삭제)' 등)가
 * 남은 글, 요약 표시가 켜졌을 때 한두 문장(70자)으로 줄일 수 없는 글('요약', P1-6). 카드 단계(quoteCardHighlights)가 어차피 빼므로
 * 화면은 흐리게 보이고 고를 수 없게 한다
 */
export type ReviewCandidateBlock = QuoteBlockReason | '정화' | '요약'

/** 파일 전체 통계 — 별점만 있는 행도 평점 분포 신호로 센다(NEXFIT review_excel_parser 그대로) */
export interface ReviewStats {
  total_rows: number
  text_review_count: number
  /** 평점(1~5) → 행 수. 평점이 없는 행은 세지 않는다 */
  rating_counts: Record<string, number>
}

/** 파일에서 읽은 리뷰 한 건 — 작성자 이름은 가린 꼴만, 리뷰어번호·판매자는 담지 않는다(개인정보·타사명) */
export interface ParsedReview {
  rating: number | null
  title: string
  body: string
  option: string
  helped: number
  /** 작성 월('YYYY.MM') — 작성일 열이 있을 때만(P1-6) */
  month?: string
  /** 작성자 — 읽는 즉시 가린 꼴(앞 한 글자 + *, maskAuthor)만. 이름 칸이 비면 없다(P1-6) */
  author?: string
}

/** 표집된 리뷰 — id는 직렬화 순서 번호([리뷰N]의 N) */
export interface SampledReview extends ParsedReview {
  id: number
}

/**
 * 자사 리뷰 인용 후보(W2a, PDP-W2W3 계약 v1 §2-1) — 정화 뒤 본문(150자 이하), 이름은 가린 꼴만(author), 리뷰어번호 없음. id는 정규화한 본문의 해시라
 * 같은 파일을 다시 올려도 같다. 리뷰 파일 응답(POST /api/registration/reviews)이 돌려주고 화면이 고른다
 */
export interface ReviewCandidate {
  id: string
  text: string
  /** 1~5 — 평점이 없는 리뷰는 후보가 아니다 */
  rating: number
  option?: string
  /** 작성 월('YYYY.MM')·가린 작성자('김**') — 파일에 있을 때만(P1-6). 카드 작성자 줄이 쓴다 */
  month?: string
  author?: string
  /**
   * 요약 표시가 켜졌을 때 카드에 실을 원문 문장 1~2개 — 자르기 전 본문 전체에서 효익으로 끝나는 문장을 고른 것(2026-11-02). 150자로 자른
   * text에는 없는 문장일 수 있다. 효익 문장이 없거나 요약이 꺼졌으면 없고, 카드 단계는 text에서 고른다
   */
  cardSummary?: string
  /** 인용 카드로 쓸 수 없는 사유(목록 뒤로 보낸다). 고른 카드 저장(spec_sheet.reviewQuotes)에는 남지 않는다 */
  blocked?: ReviewCandidateBlock
}

/**
 * 후기 섹션 인용 카드(spec_sheet.reviewQuotes, 계약 v1 §1) — text는 후보 글 그대로(오너가 줄일 수는 있지만 바꿔 쓰지 않는다),
 * highlights는 text 안에 실제로 있는 조각만(강조 표시)
 */
export interface ReviewQuote extends Omit<ReviewCandidate, 'blocked'> {
  highlights?: string[]
}

/** 자사 리뷰 파일 메타 — 본문은 reviewsText에 있다 */
export interface OwnReviewFileMeta {
  fileName: string
  stats: ReviewStats
  sampled: number
  /** 정화에서 버린 행(중복·개인정보만 남은 행) */
  dropped: number
}

/** 경쟁사 리뷰 항목 — 옵션은 담지 않는다(상품·브랜드 이름이 섞이기 쉽다) */
export interface CompetitorReviewItem {
  id: number
  rating: number | null
  helped: number
  title: string
  body: string
}

/** spec_sheet.competitorReviews — 분석 단계 경쟁사 콜과 재현 가드만 읽는다 */
export interface CompetitorReviews {
  version: 1
  fileName: string
  stats: ReviewStats
  dropped: number
  items: CompetitorReviewItem[]
  /** 본문·제목에서 지운 경쟁사 이름(판매자명·상품명·앞머리) — 기록용 */
  removedNames: string[]
  /** 분석 산출 검사(재현 가드 ①)에 쓰는 이름 — 판매자명·상품명 전체·영문 브랜드. 한글 앞머리는 일반어일 수 있어 뺀다 */
  checkNames: string[]
  /**
   * 'collected' = 잡 생성 때 서버가 수집 리뷰(competitor_reviews)로 채운 값(collected-reviews.ts). 없으면 오너가 올린 엑셀이다 —
   * 엑셀이 있으면 수집 리뷰를 읽지 않고(둘을 섞지 않음), 수집으로 채운 값은 다음 잡 생성 때 다시 읽는다
   */
  origin?: 'collected'
}

/** 경쟁사 불만 유형 — 빈도는 모델이 고른 리뷰 번호를 코드가 센다 */
export interface CompetitorPainPoint {
  type: string
  count: number
  /** count / sample_size, 소수 둘째 자리 */
  share: number
  benefit_direction: string
}

/** analysis.competitor_pain_points — analysisForPrompt가 빼고, 리서치에는 덧붙임 블록으로만 넘긴다 */
export interface CompetitorPainSummary {
  version: 1
  sample_size: number
  total_rows: number
  items: CompetitorPainPoint[]
}

// ─── 상한 ───

/** 업로드 파일 상한(Vercel 함수 본문 4.5MB 안) */
export const REVIEW_FILE_MAX_BYTES = 4 * 1024 * 1024
/** 자사 표집 건수·직렬화 길이 상한(NEXFIT DEFAULT_SAMPLE_LIMIT·SERIALIZE_MAX_CHARS) */
export const OWN_SAMPLE_LIMIT = 100
export const OWN_SERIALIZE_MAX_CHARS = 12_000
/** 경쟁사 표집 상한 — 잡 행이 커지지 않게(약 30KB): 60건, 제목·본문 합계 10,000자 */
export const COMPETITOR_SAMPLE_LIMIT = 60
export const COMPETITOR_TEXT_MAX_CHARS = 10_000
/** 저장·직렬화 본문 길이(NEXFIT _BODY_TRIM_SERIALIZED) */
export const REVIEW_BODY_MAX_CHARS = 300
export const REVIEW_TITLE_MAX_CHARS = 60
export const REVIEW_OPTION_MAX_CHARS = 60

/** 인용 후보·카드(계약 v1) — 후보 30건, 카드 6장, 글 150자, 강조 3개·각 12자 */
export const REVIEW_CANDIDATE_LIMIT = 30
export const REVIEW_QUOTE_LIMIT = 6
export const REVIEW_QUOTE_MAX_CHARS = 150
export const REVIEW_QUOTE_HIGHLIGHT_LIMIT = 3
export const REVIEW_QUOTE_HIGHLIGHT_MAX_CHARS = 12
/** 후기 요약 글자 상한(P1-6) — 원문 문장 1~2개 */
export const REVIEW_SUMMARY_MAX_CHARS = 70
/**
 * 사람 없이 자동으로 고르는 후기의 최소 별점(2026-11-02, R17 P06) — 모델 발췌·후기 질문·폴백·시험 하네스가 3점 이하를 고르지 않는다.
 * 오너가 화면에서 별점을 보고 고른 카드(reviewQuotes)에는 쓰지 않는다
 */
export const REVIEW_QUOTE_MIN_RATING = 4

/** 별점을 알고 그 값이 낮으면 참 — 별점을 모르면(붙여 넣은 원문) 거짓이다 */
export function isLowRating(rating: unknown): boolean {
  return typeof rating === 'number' && rating < REVIEW_QUOTE_MIN_RATING
}
