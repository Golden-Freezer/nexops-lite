// 캠페인명 → 상품 귀속 매칭 (순수 함수).
//
// 배경: 광고 원장(ad_campaigns)은 일일 dailySettlement 교체 삽입이라 product_id가 항상
// NULL이고, 순이익 랭킹은 미연결 광고비를 전 상품 매출 비중으로 배부한다. 매출 1위 상품이
// 남의 캠페인 비용까지 뒤집어쓰는 왜곡(2026-08-19 피쿠미 클리어덱 적자 오표시)의 원인.
// 캠페인명에는 상품 별칭이 들어가므로("포켓몬카드슬리브", "화장품소분공병") 읽기 시점에
// 이름으로 귀속한다 — 행 스탬프는 일일 교체로 소실되므로 저장하지 않는다.
//
// 보수 원칙: 확신 없는 매칭은 하지 않는다(미연결 = 기존 매출 비중 배부 유지).
// 세그먼트 전체가 한 상품의 표기(상품명+옵션명+키워드) 조각들로 완전히 커버될 때만 매칭.

export interface MatchableProduct {
  productId: string
  /** 상품명·옵션명·키워드를 이어 붙인 원문 (normalize는 내부에서 수행) */
  text: string
}

/** 한글·영문·숫자만 남기고 소문자화 */
function normalize(value: string): string {
  return value.toLowerCase().replace(/[^가-힣a-z0-9]/g, '')
}

/** 캠페인 세그먼트용: 숫자는 날짜·퍼센트·수량 노이즈라 제거 */
function normalizeSegment(value: string): string {
  return normalize(value).replace(/[0-9]/g, '')
}

/**
 * segment를 길이 2 이상의 조각들로 분해해 전부 haystack의 부분 문자열로 커버할 수 있는지 DP 판정.
 * 예: '화장품소분공병' → '화장품소분'(상품명) + '공병'(옵션명) → 커버 성공.
 */
export function canCoverSegment(segment: string, haystack: string): boolean {
  if (segment.length < 2) return false
  const n = segment.length
  const reachable = new Array<boolean>(n + 1).fill(false)
  reachable[0] = true
  for (let i = 0; i < n; i += 1) {
    if (!reachable[i]) continue
    for (let j = i + 2; j <= n; j += 1) {
      if (reachable[j]) continue
      if (haystack.includes(segment.slice(i, j))) reachable[j] = true
    }
  }
  return reachable[n]
}

/** 세그먼트 최소 길이 — 이보다 짧으면 '스티커'류 범용어 오귀속 위험이 커서 매칭하지 않는다 */
const MIN_SEGMENT_LENGTH = 4

/**
 * 캠페인명에서 상품을 식별해 productId 집합을 돌려준다. 빈 배열 = 귀속 불가(공유 배부 유지).
 * 같은 상품군(옵션 여러 개)이 모두 매칭될 수 있으며, 배부는 호출부에서 집합 내 매출 비중으로 한다.
 */
export function matchCampaignProducts(
  campaignName: string | null | undefined,
  products: MatchableProduct[],
): string[] {
  if (!campaignName) return []
  const segments = campaignName
    .split(/[_\s\-–—/|,()[\]]+/)
    .map(normalizeSegment)
    .filter((segment) => segment.length >= MIN_SEGMENT_LENGTH)
  if (segments.length === 0) return []

  const matched = new Set<string>()
  const haystacks = products.map((product) => ({
    productId: product.productId,
    haystack: normalize(product.text),
  }))
  for (const segment of segments) {
    for (const { productId, haystack } of haystacks) {
      if (matched.has(productId)) continue
      if (haystack.length >= 2 && canCoverSegment(segment, haystack)) matched.add(productId)
    }
  }
  return [...matched]
}

/** 캠페인명 목록을 한 번에 매칭해 Map<campaignName, productIds>로 돌려준다. */
export function buildCampaignProductLinks(
  campaignNames: Iterable<string | null | undefined>,
  products: MatchableProduct[],
): Map<string, string[]> {
  const links = new Map<string, string[]>()
  for (const name of campaignNames) {
    if (!name || links.has(name)) continue
    links.set(name, matchCampaignProducts(name, products))
  }
  return links
}
