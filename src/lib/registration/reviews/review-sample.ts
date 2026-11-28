/**
 * 리뷰 표집·직렬화 — NEXFIT review_excel_parser.sample_reviews·serialize_reviews 대응(표집 규칙은 계약대로 바꿈).
 * - 표집: 평점 층별 비례 배분으로 파일의 평점 분포를 유지한다(비어 있지 않은 층은 최소 1건).
 *   층 안에서는 구체적인 긴 리뷰가 먼저다(직렬화 길이까지의 본문 길이 → 도움 수 → 파일 순서).
 * - 순서: 층마다 첫 리뷰를 맨 앞에 두고 섞어, 앞부분에도 평점이 고루 오게 한다 — 리서치는 리뷰 텍스트의 앞 4,000자만 본다.
 * - 직렬화: 전체 통계 머리말 + [리뷰N] 평점·도움 수(·옵션) + 제목·내용. 길이 상한을 넘으면 뒤를 생략한다.
 */

import {
  REVIEW_BODY_MAX_CHARS,
  REVIEW_OPTION_MAX_CHARS,
  REVIEW_TITLE_MAX_CHARS,
  type ParsedReview,
  type ReviewStats,
  type SampledReview,
} from './review-types'

const NO_RATING = 'none'

function stratumOf(r: ParsedReview): string {
  return r.rating === null ? NO_RATING : String(r.rating)
}

/** 층별 몫 — 최대 나머지 방식, 비어 있지 않은 층 최소 1건(층 수가 상한 이하일 때), 층 크기 상한 */
function stratumQuotas(sizes: Map<string, number>, limit: number): Map<string, number> {
  const total = [...sizes.values()].reduce((a, b) => a + b, 0)
  const quotas = new Map<string, number>()
  const remainders: Array<{ key: string; rem: number }> = []
  for (const [key, size] of sizes) {
    const exact = (limit * size) / total
    quotas.set(key, Math.min(size, Math.floor(exact)))
    remainders.push({ key, rem: exact - Math.floor(exact) })
  }
  if (sizes.size <= limit) {
    for (const [key, size] of sizes) if (size > 0 && quotas.get(key) === 0) quotas.set(key, 1)
  }
  let used = [...quotas.values()].reduce((a, b) => a + b, 0)
  // 최소 1건 보장으로 넘쳤으면 큰 층부터 하나씩 덜어 낸다
  const bySize = [...sizes.keys()].sort((a, b) => sizes.get(b)! - sizes.get(a)!)
  for (let i = 0; used > limit && i < bySize.length * limit; i += 1) {
    const key = bySize[i % bySize.length]
    if (quotas.get(key)! > 1) {
      quotas.set(key, quotas.get(key)! - 1)
      used -= 1
    }
  }
  // 남은 몫은 나머지가 큰 층부터, 층 크기를 넘지 않게 채운다
  remainders.sort((a, b) => b.rem - a.rem || sizes.get(b.key)! - sizes.get(a.key)!)
  while (used < limit) {
    const next = remainders.find(({ key }) => quotas.get(key)! < sizes.get(key)!)
    if (!next) break
    quotas.set(next.key, quotas.get(next.key)! + 1)
    used += 1
    remainders.push(remainders.splice(remainders.indexOf(next), 1)[0])
  }
  return quotas
}

function specificity(r: ParsedReview): number {
  return Math.min(r.body.length, REVIEW_BODY_MAX_CHARS)
}

/** 평점 분포를 유지한 표집 — id는 반환 순서(1부터) */
export function sampleReviews(reviews: ParsedReview[], limit: number): SampledReview[] {
  const strata = new Map<string, Array<{ r: ParsedReview; idx: number }>>()
  reviews.forEach((r, idx) => {
    const key = stratumOf(r)
    const list = strata.get(key)
    if (list) list.push({ r, idx })
    else strata.set(key, [{ r, idx }])
  })
  const sizes = new Map([...strata].map(([key, list]) => [key, list.length]))
  const quotas = reviews.length <= limit ? sizes : stratumQuotas(sizes, limit)

  const picked: Array<{ r: ParsedReview; pos: number; rating: number }> = []
  for (const [key, list] of strata) {
    const quota = quotas.get(key) ?? 0
    const ranked = [...list].sort(
      (a, b) => specificity(b.r) - specificity(a.r) || b.r.helped - a.r.helped || a.idx - b.idx
    )
    // 각 층의 첫 리뷰가 맨 앞에 모이고, 이후는 층 몫에 비례한 간격으로 섞인다
    ranked.slice(0, quota).forEach(({ r }, rank) => {
      picked.push({ r, pos: rank / quota, rating: r.rating ?? 0 })
    })
  }
  picked.sort((a, b) => a.pos - b.pos || b.rating - a.rating)
  return picked.map(({ r }, i) => ({ ...r, id: i + 1 }))
}

function flatten(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

function trimWithEllipsis(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text
}

export function formatRatingDistribution(stats: ReviewStats): string {
  return Object.keys(stats.rating_counts)
    .sort((a, b) => Number(b) - Number(a))
    .map((k) => `${k}점 ${stats.rating_counts[k]}`)
    .join(' / ')
}

/**
 * 표집 리뷰 → 프롬프트용 텍스트. withOption=false면 옵션을 싣지 않는다(경쟁사).
 * 상한을 넘기면 남은 건수를 적고 멈춘다(원본 serialize_reviews 그대로).
 */
export function serializeReviews(
  sampled: SampledReview[],
  stats: ReviewStats,
  maxChars: number,
  options: { withOption?: boolean } = {}
): string {
  if (sampled.length === 0) return '리뷰 데이터 없음'
  const dist = formatRatingDistribution(stats)
  const header =
    `리뷰 전체: ${stats.total_rows}건 (텍스트 리뷰 ${stats.text_review_count}건)` +
    (dist ? ` · 평점 분포: ${dist}` : '') +
    `\n표집: ${sampled.length}건 (평점 분포 유지, 구체적인 긴 리뷰 우선)`
  const parts = [header]
  let used = header.length
  for (const [i, r] of sampled.entries()) {
    const rating = r.rating !== null ? `${r.rating}/5` : '평점없음'
    let meta = `[리뷰${r.id}] 평점 ${rating} · 도움 ${r.helped}`
    // 작성 월·가린 작성자(P1-6, 자사만) — 후기 카드 작성자 줄이 리뷰 번호로 되찾는다. 원래 이름은 파서가 이미 가렸다
    if (options.withOption !== false && r.month) meta += ` · 작성 ${r.month}`
    if (options.withOption !== false && r.author) meta += ` · 작성자 ${r.author}`
    if (options.withOption !== false && r.option)
      meta += ` · 옵션: ${flatten(r.option).slice(0, REVIEW_OPTION_MAX_CHARS)}`
    const lines = [meta]
    // 셀 안 줄바꿈은 한 줄로 편다 — 한 리뷰가 [리뷰N]·제목·내용 세 줄을 넘지 않게(review-scrubber가 이 형식을 읽는다)
    const title = flatten(r.title)
    if (title) lines.push(`제목: ${title.slice(0, REVIEW_TITLE_MAX_CHARS)}`)
    lines.push(`내용: ${trimWithEllipsis(flatten(r.body), REVIEW_BODY_MAX_CHARS)}`)
    const block = lines.join('\n')
    if (used + block.length + 2 > maxChars) {
      parts.push(`(길이 상한으로 ${sampled.length - i}건 생략)`)
      break
    }
    parts.push(block)
    used += block.length + 2
  }
  return parts.join('\n\n')
}
