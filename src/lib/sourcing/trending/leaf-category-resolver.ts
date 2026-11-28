import { splitCategoryPath } from './category-tree'

export interface LeafCategoryCandidate {
  categoryId: number
  fullPath: string
}

export interface LeafCategoryResolveInput {
  productName: string | null
  breadcrumbLabels: string[]
}

export interface LeafCategoryMatch {
  categoryId: number
  fullPath: string
  score: number
  margin: number | null
}

export const MIN_LEAF_CATEGORY_SCORE = 50
export const MIN_LEAF_CATEGORY_MARGIN = 8
/** 형제 정밀화 후보로 인정하는 1위와의 점수 창 — 부모가 같으면 breadcrumb 신호가 동일해 점수차가 작다 */
export const SIBLING_REFINEMENT_WINDOW = 30

/** 한글·영숫자만 남겨 쿠팡 전시명과 SSOT 표기의 슬래시/공백 차이를 흡수한다. */
export function normalizeCategoryText(
  value: string | null | undefined
): string {
  return (value ?? '')
    .toLocaleLowerCase('ko-KR')
    .replace(/[^0-9a-z가-힣]+/g, '')
}

/** 제목/브레드크럼의 의미 단위. 한 글자 토큰은 오탐이 커 제외한다. */
export function tokenizeCategoryText(
  value: string | null | undefined
): string[] {
  return [
    ...new Set(
      (value ?? '')
        .toLocaleLowerCase('ko-KR')
        .split(/[^0-9a-z가-힣]+/g)
        .map(normalizeCategoryText)
        .filter(
          (token) => token.length >= 2 && token !== '쿠팡' && token !== '홈'
        )
    ),
  ]
}

function scoreCandidate(
  candidate: LeafCategoryCandidate,
  input: LeafCategoryResolveInput
): number | null {
  const segments = splitCategoryPath(candidate.fullPath)
  if (segments.length === 0) return null

  const segmentNorms = segments.map(normalizeCategoryText)
  const pathNorm = normalizeCategoryText(candidate.fullPath)
  const leafNorm = segmentNorms[segmentNorms.length - 1]
  const breadcrumbLabels = input.breadcrumbLabels
    .map((label) => label.trim())
    .filter(Boolean)
  const lastBreadcrumb = breadcrumbLabels[breadcrumbLabels.length - 1] ?? ''
  const lastNorm = normalizeCategoryText(lastBreadcrumb)
  const lastTokens = tokenizeCategoryText(lastBreadcrumb)

  // 마지막 전시 breadcrumb와 전혀 닿지 않는 SSOT 후보는 초기에 제외한다.
  if (
    lastTokens.length === 0 ||
    !lastTokens.some(
      (token) => leafNorm.includes(token) || pathNorm.includes(token)
    )
  ) {
    return null
  }

  let score = 0
  if (lastNorm && leafNorm === lastNorm) score += 80
  if (lastNorm && segmentNorms.includes(lastNorm)) score += 18
  for (const token of lastTokens) {
    if (leafNorm.includes(token)) score += 24
    else if (pathNorm.includes(token)) score += 6
  }

  for (const label of breadcrumbLabels.slice(0, -1)) {
    const normalized = normalizeCategoryText(label)
    if (!normalized) continue
    if (segmentNorms.includes(normalized)) score += 18
    else if (pathNorm.includes(normalized)) score += 6
  }

  const breadcrumbTokens = new Set(
    breadcrumbLabels.flatMap(tokenizeCategoryText)
  )
  for (const token of breadcrumbTokens) {
    if (leafNorm.includes(token)) score += 8
    else if (pathNorm.includes(token)) score += 4
  }
  for (const token of tokenizeCategoryText(input.productName)) {
    if (leafNorm.includes(token)) score += 10
    else if (pathNorm.includes(token)) score += 2
  }
  return score
}

/** 정규화 문자열의 2-gram 집합. 상품명↔리프명 친화도의 기본 단위다. */
function bigramsOf(norm: string): Set<string> {
  const grams = new Set<string>()
  for (let i = 0; i + 2 <= norm.length; i++) grams.add(norm.slice(i, i + 2))
  return grams
}

/** 상품명과 리프명이 공유하는 2-gram 수 (순수). 형제 리프들 사이의 판별 신호로 쓴다. */
export function nameLeafAffinity(
  productName: string | null | undefined,
  leafNorm: string
): number {
  const nameNorm = normalizeCategoryText(productName)
  if (nameNorm.length < 2 || leafNorm.length < 2) return 0
  const leafGrams = bigramsOf(leafNorm)
  let shared = 0
  for (const gram of bigramsOf(nameNorm)) {
    if (leafGrams.has(gram)) shared += 1
  }
  return shared
}

interface RankedCandidate {
  candidate: LeafCategoryCandidate
  score: number
  leafNorm: string
  parentNorm: string
}

/**
 * 전시 breadcrumb 코드가 SSOT 코드공간과 다르므로 문자열 컨텍스트로 고신뢰 단일 후보만 확정한다.
 *
 * 2026-08-24 정밀화(실측 9케이스 기반): breadcrumb만으로는 두 실패군을 못 가른다 —
 * ① 리프가 같은 미러 경로(해외직구·공용 등)와의 동점 ② breadcrumb가 부모(모자·양말 등)에서
 * 끝나 형제 리프 전원이 동점. ①은 마진 판정에서 같은 리프·같은 부모 후보를 제외해 해소하고,
 * ②는 부모가 같은 형제군을 상품명↔리프 2-gram 친화도로 정밀화한다(유일 최대만 채택).
 * 판별 신호가 없는 진짜 모호(형제 동률·교차 부모 근소차)는 이전처럼 null 보류.
 */
export function resolveLeafCategoryCandidate(
  candidates: LeafCategoryCandidate[],
  input: LeafCategoryResolveInput,
  {
    minScore = MIN_LEAF_CATEGORY_SCORE,
    minMargin = MIN_LEAF_CATEGORY_MARGIN,
  }: { minScore?: number; minMargin?: number } = {}
): LeafCategoryMatch | null {
  const ranked: RankedCandidate[] = candidates
    .map((candidate) => ({
      candidate,
      score: scoreCandidate(candidate, input),
    }))
    .filter(
      (row): row is { candidate: LeafCategoryCandidate; score: number } =>
        row.score != null
    )
    .sort(
      (a, b) =>
        b.score - a.score || a.candidate.categoryId - b.candidate.categoryId
    )
    .map((row) => {
      const segmentNorms = splitCategoryPath(row.candidate.fullPath).map(
        normalizeCategoryText
      )
      return {
        ...row,
        leafNorm: segmentNorms[segmentNorms.length - 1] ?? '',
        parentNorm: segmentNorms.slice(0, -1).join('>'),
      }
    })

  let best = ranked[0]
  if (!best || best.score < minScore) return null

  // ② 형제 정밀화 — 1위와 부모가 같고 점수 창 안인 후보군에서 상품명 친화도의 유일 최대를 찾는다
  const siblings = ranked.filter(
    (row) =>
      row.parentNorm === best.parentNorm &&
      row.score >= best.score - SIBLING_REFINEMENT_WINDOW
  )
  let siblingsResolved = siblings.length <= 1
  if (!siblingsResolved) {
    const affinities = siblings.map((row) => nameLeafAffinity(input.productName, row.leafNorm))
    const maxAffinity = Math.max(...affinities)
    const winners = siblings.filter((_, index) => affinities[index] === maxAffinity)
    if (maxAffinity >= 1 && winners.length === 1) {
      best = winners[0]
      siblingsResolved = true
    } else {
      // 친화도로 못 가른 형제군: 1위가 형제 2위를 자력(minMargin)으로 이겨야만 통과 (이전 동작 유지)
      const siblingRival = siblings.find((row) => row !== best)
      siblingsResolved =
        siblingRival == null || best.score - siblingRival.score >= minMargin
    }
  }
  if (!siblingsResolved) return null

  // ① 마진 — 같은 리프(미러 경로)와 같은 부모(정밀화로 이미 판정한 형제)는 경쟁자에서 제외한다
  const rival = ranked.find(
    (row) =>
      row.candidate.categoryId !== best.candidate.categoryId &&
      row.leafNorm !== best.leafNorm &&
      row.parentNorm !== best.parentNorm
  )
  const margin = rival ? best.score - rival.score : null
  if (margin != null && margin < minMargin) return null

  return {
    categoryId: best.candidate.categoryId,
    fullPath: best.candidate.fullPath,
    score: best.score,
    margin,
  }
}
