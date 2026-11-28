/**
 * 리뷰 받을 쿠팡 상품 번호(spec_sheet.reviewSourceProductIds) — 오너 승인(2026-11-05, ops-lead 전달): 등록할 상품이 정해지면
 * 상세페이지 생성 단계에서 같은·경쟁 상품의 리뷰를 모아 생성에 읽어 쓴다.
 * - 폼이 번호 1~3개를 받아 수집 요청 입구(POST /api/competitor-reviews/requests)에 넣고 상태(GET ?product_id=)를 보여 준다.
 * - 잡 생성 때 서버가 그때까지 받은 competitor_reviews를 읽어 competitorReviews를 채운다(collected-reviews.ts). 수집이 덜 끝났어도
 *   기다리지 않는다 — 기다릴지 지금 있는 것으로 시작할지는 오너가 고른다.
 * 순수 함수·타입만(화면·서버 공용, 런타임 의존 없음). 입구 계약은 ops PR #795(review-requests.ts)와 같다.
 */

export const REVIEW_SOURCE_MAX_PRODUCTS = 3
export const REVIEW_REQUEST_PATH = '/api/competitor-reviews/requests'
const PRODUCT_ID_RE = /^\d{1,20}$/
const PRODUCT_URL_RE = /\/vp\/products\/(\d{1,20})/
const SOURCE_KEY_MAX = 200

/** 입구가 돌려주는 수집 상태 — blocked는 오늘 리뷰 수집 차단 신호가 있을 때 */
export type ReviewRequestState = 'queued' | 'running' | 'done' | 'failed' | 'blocked'
/** 화면 상태 — 입구 상태에 더해, 요청한 적 없음(404 NOT_REQUESTED)·수집 불가(표·입구 없음 503/404) */
export type ReviewSourceState = ReviewRequestState | 'not_requested' | 'unavailable'

export const REVIEW_STATE_LABEL: Readonly<Record<ReviewSourceState, string>> = {
  queued: '대기',
  running: '진행',
  done: '끝',
  failed: '실패',
  blocked: '차단',
  not_requested: '요청 없음',
  unavailable: '수집 불가',
}

export interface ReviewSourceView {
  productId: string
  state: ReviewSourceState
  rows: number | null
  collectedAt: string | null
  lastError: string | null
  /** 최근 7일 안에 받은 리뷰가 있어 다시 모으지 않음(접수 outcome fresh) */
  fresh?: boolean
}

/** 잡 생성 때 쓴 수집 리뷰 기록(spec_sheet.reviewSourceSnapshot) — 서버만 쓴다. 프롬프트에 넣지 않는다 */
export interface ReviewSourceSnapshot {
  version: 1
  at: string
  /** collected = 수집 리뷰를 씀 · excel = 오너가 올린 경쟁사 파일이 있어 수집 리뷰를 읽지 않음 · empty = 읽었지만 쓸 본문이 없음 · unavailable = 읽지 못함 */
  outcome: 'collected' | 'excel' | 'empty' | 'unavailable'
  /** 상품마다 읽은 행 수(최대 1,500)·가장 늦은 collected_at — 읽지 않았으면 null */
  products: Array<{ productId: string; rows: number | null; collectedAt: string | null }>
  /** competitorReviews에 실은 항목 수 */
  sampled: number
  error?: string
}

/** 숫자 문자열 1~3개, 겹침 없이 — 모양이 틀린 값은 버린다(서버가 저장 전에 부른다) */
export function normalizeReviewSourceProductIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const ids: string[] = []
  for (const v of raw) {
    const id = typeof v === 'string' ? v.trim() : ''
    if (PRODUCT_ID_RE.test(id) && !ids.includes(id)) ids.push(id)
    if (ids.length >= REVIEW_SOURCE_MAX_PRODUCTS) break
  }
  return ids
}

/** 폼 입력(번호 또는 쿠팡 상품 주소, 쉼표·공백·줄바꿈으로 나눔) → 상품 번호. 읽지 못한 조각은 invalid, 3개를 넘으면 overflow */
export function parseReviewSourceInput(text: string): { ids: string[]; invalid: string[]; overflow: boolean } {
  const ids: string[] = []
  const invalid: string[] = []
  let overflow = false
  for (const piece of text.split(/[\s,]+/).filter(Boolean)) {
    const id = PRODUCT_ID_RE.test(piece) ? piece : PRODUCT_URL_RE.exec(piece)?.[1]
    if (!id) {
      invalid.push(piece)
      continue
    }
    if (ids.includes(id)) continue
    if (ids.length >= REVIEW_SOURCE_MAX_PRODUCTS) {
      overflow = true
      continue
    }
    ids.push(id)
  }
  return { ids, invalid, overflow }
}

/** 접수 본문 — source_key는 상품명으로(200자 안). 비어 있으면 넣지 않는다 */
export function reviewRequestBody(productIds: readonly string[], productName?: string): { product_ids: string[]; source: 'pdp'; source_key?: string } {
  const key = Array.from(productName?.trim() ?? '')
    .slice(0, SOURCE_KEY_MAX - 4)
    .join('')
  return { product_ids: [...productIds], source: 'pdp', ...(key ? { source_key: `pdp:${key}` } : {}) }
}

const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v)
const STATES: readonly ReviewRequestState[] = ['queued', 'running', 'done', 'failed', 'blocked']
const count = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.trunc(v) : null)
const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null)

function viewOf(productId: string, raw: Record<string, unknown>): ReviewSourceView {
  const state = STATES.includes(raw.state as ReviewRequestState) ? (raw.state as ReviewRequestState) : 'failed'
  return {
    productId,
    state,
    rows: count(raw.rows),
    collectedAt: text(raw.collected_at),
    lastError: text(raw.last_error),
    ...(raw.outcome === 'fresh' ? { fresh: true } : {}),
  }
}

const unavailable = (productId: string, lastError: string | null): ReviewSourceView => ({
  productId,
  state: 'unavailable',
  rows: null,
  collectedAt: null,
  lastError,
})

/**
 * 접수 응답(POST) 판독 — 200이면 results[]의 상품별 상태, 503(표 없음)·404(입구 없음)·그 밖의 실패면 모두 수집 불가.
 * 응답에 없는 상품도 수집 불가로 둔다
 */
export function readIntakeResponse(productIds: readonly string[], status: number, json: unknown): ReviewSourceView[] {
  const message = isObj(json) ? text(json.error) : null
  if (status !== 200 || !isObj(json) || !isObj(json.data) || !Array.isArray(json.data.results)) {
    return productIds.map((id) => unavailable(id, message))
  }
  const byId = new Map<string, Record<string, unknown>>()
  for (const r of json.data.results) if (isObj(r) && typeof r.product_id === 'string') byId.set(r.product_id, r)
  return productIds.map((id) => {
    const raw = byId.get(id)
    return raw ? viewOf(id, raw) : unavailable(id, '응답에 이 상품이 없습니다.')
  })
}

/** 조회 응답(GET ?product_id=) 판독 — 404 NOT_REQUESTED는 요청 없음, 그 밖의 실패(503 표 없음·입구 없음)는 수집 불가 */
export function readStatusResponse(productId: string, status: number, json: unknown): ReviewSourceView {
  if (status === 404 && isObj(json) && json.code === 'NOT_REQUESTED') {
    return { productId, state: 'not_requested', rows: null, collectedAt: null, lastError: null }
  }
  if (status !== 200 || !isObj(json) || !isObj(json.data)) return unavailable(productId, isObj(json) ? text(json.error) : null)
  return viewOf(productId, json.data)
}

/** 아직 바뀔 수 있는 상태인가 — 화면이 이때만 다시 묻는다 */
export const isActiveReviewState = (state: ReviewSourceState): boolean => state === 'queued' || state === 'running'
