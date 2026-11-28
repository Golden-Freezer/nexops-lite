/**
 * 쿠팡 등록 카테고리 해석 (WS-C 기초, 쿠팡 쓰기 없음) — 소싱 category_path(3단계 텍스트)를
 * 쿠팡 등록에 필요한 displayCategoryCode(leaf category_id)로 매핑한다.
 *
 * 문제: category_path("문구/오피스 > 문구/학용품 > 포장/파티용품", 3단계)와 coupang_categories.full_path
 *   (leaf까지 depth 5~6, ">" 구분)는 깊이가 달라 1:N이다. 3단계 노드 아래 leaf가 수십 개일 수 있어
 *   상품명으로 고신뢰 단일 후보를 자동 선택하되(기존 leaf-category-resolver 재사용), 확신이 없으면
 *   오너가 후보 목록에서 leaf를 고른다.
 *
 * guard: coupang_categories 읽기만(요율·시드 무변경). 쿠팡 API·운영 테이블 미접촉.
 */

import type { createAdminClient } from '@/lib/supabase/admin'
import { resolveLeafCategoryCandidate, type LeafCategoryCandidate } from '@/lib/sourcing/trending/leaf-category-resolver'

type AdminClient = ReturnType<typeof createAdminClient>

export interface CategoryCandidate {
  code: number // displayCategoryCode (leaf category_id)
  fullPath: string
  rate: number | null // 판매수수료율(0~1)
}

export interface CategoryResolveResult {
  /** 고신뢰 단일 leaf가 잡혔을 때만 채움(오너 확인 없이 확정 가능한 코드). */
  displayCategoryCode: number | null
  fullPath: string | null
  rate: number | null
  confident: boolean
  /** 오너가 고를 leaf 후보(고신뢰 픽 우선, 이후 경로순). URL 길이·렌더 위해 상한. */
  candidates: CategoryCandidate[]
}

interface CategoryRow {
  category_id: number
  full_path: string
  depth: number | null
  rate: number | null
}

const CANDIDATE_LIMIT = 40

/** category_path("a > b > c")를 세그먼트로 분리. 세그먼트 내부 '/'는 유지, 구분자는 '>'만. */
export function splitRegistrationCategoryPath(categoryPath: string | null): string[] {
  if (!categoryPath) return []
  return categoryPath
    .split('>')
    .map((s) => s.trim())
    .filter(Boolean)
}

/** full_path가 다른 후보의 접두어가 아니면 leaf(말단). 등록은 leaf 코드만 허용. */
export function detectLeafRows(rows: CategoryRow[]): CategoryRow[] {
  const paths = rows.map((r) => r.full_path)
  return rows.filter((r) => !paths.some((p) => p !== r.full_path && p.startsWith(r.full_path + '>')))
}

/**
 * category_path + 상품명으로 등록 카테고리를 해석한다. 3단계 노드(l1/l2/l3) 아래 leaf들을 후보로
 * 모으고, 상품명 컨텍스트로 고신뢰 단일 후보가 있으면 confident로 확정한다.
 */
export async function resolveDisplayCategory(
  db: AdminClient,
  input: { categoryPath: string | null; productName: string | null }
): Promise<CategoryResolveResult> {
  const empty: CategoryResolveResult = {
    displayCategoryCode: null,
    fullPath: null,
    rate: null,
    confident: false,
    candidates: [],
  }
  const segs = splitRegistrationCategoryPath(input.categoryPath)
  if (segs.length === 0) return empty

  // l1/l2/l3 매칭으로 3단계 노드 아래 후보를 좁힌다(있는 세그먼트만 필터).
  let query = db.from('coupang_categories').select('category_id, full_path, depth, rate')
  if (segs[0]) query = query.eq('l1', segs[0])
  if (segs[1]) query = query.eq('l2', segs[1])
  if (segs[2]) query = query.eq('l3', segs[2])
  const { data, error } = await query.limit(1000)
  if (error) throw new Error(`카테고리 조회 실패: ${error.message}`)
  const rows = (data ?? []) as CategoryRow[]
  if (rows.length === 0) return empty

  const leaves = detectLeafRows(rows)
  if (leaves.length === 0) return empty

  // 고신뢰 단일 후보(상품명 컨텍스트) — 기존 리졸버 재사용
  const resolverCandidates: LeafCategoryCandidate[] = leaves.map((l) => ({
    categoryId: l.category_id,
    fullPath: l.full_path,
  }))
  const confidentMatch = resolveLeafCategoryCandidate(resolverCandidates, {
    productName: input.productName,
    breadcrumbLabels: segs,
  })

  const rateByCode = new Map(leaves.map((l) => [l.category_id, l.rate]))
  const toCandidate = (l: CategoryRow): CategoryCandidate => ({
    code: l.category_id,
    fullPath: l.full_path,
    rate: l.rate,
  })

  // 후보 목록: 고신뢰 픽을 맨 앞에, 나머지는 경로순
  const sorted = [...leaves].sort((a, b) => a.full_path.localeCompare(b.full_path, 'ko'))
  const ordered = confidentMatch
    ? [
        ...sorted.filter((l) => l.category_id === confidentMatch.categoryId),
        ...sorted.filter((l) => l.category_id !== confidentMatch.categoryId),
      ]
    : sorted

  return {
    displayCategoryCode: confidentMatch?.categoryId ?? null,
    fullPath: confidentMatch?.fullPath ?? null,
    rate: confidentMatch ? (rateByCode.get(confidentMatch.categoryId) ?? null) : null,
    confident: confidentMatch != null,
    candidates: ordered.slice(0, CANDIDATE_LIMIT).map(toCandidate),
  }
}
