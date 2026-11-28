/**
 * 쿠팡 수수료 조회 모듈
 * coupang_categories 테이블 기반 (16,358개 카테고리)
 */

import type { CategoryNode } from '@/types/calc'
import { DEFAULT_COMMISSION_RATE } from '@/lib/settings/config'

/** 수수료율 조회 (3단계 fallback) — coupang_categories 사용. 못 찾으면 기본 수수료율 */
export async function getCommissionRate(
  supabase: any,
  major: string,
  mid?: string | null,
  sub?: string | null
): Promise<number> {
  return (await findCategoryCommissionRate(supabase, major, mid, sub)) ?? DEFAULT_COMMISSION_RATE // 카테고리를 못 찾으면 기본 수수료율(하나로 둔다)
}

/**
 * 카테고리 수수료율 3단계 매칭(소분류 → 중분류 → 대분류). 못 찾으면 null — 기본 수수료율로 대체하지 않아
 * 호출부가 출처('category' | 'business_default')를 구분할 수 있다. 소싱 수익 엔진(profit/)은 이 경로 하나만 쓴다.
 */
export async function findCategoryCommissionRate(
  supabase: any,
  major: string,
  mid?: string | null,
  sub?: string | null
): Promise<number | null> {
  // 1. l1 + l2 + l3 매칭
  if (sub && mid) {
    const { data } = await supabase
      .from('coupang_categories')
      .select('rate')
      .eq('l1', major)
      .eq('l2', mid)
      .eq('l3', sub)
      .limit(1)
      .single()
    if (data) return Number(data.rate)
  }

  // 2. l1 + l2 매칭 (해당 조합의 첫 번째 rate)
  if (mid) {
    const { data } = await supabase
      .from('coupang_categories')
      .select('rate')
      .eq('l1', major)
      .eq('l2', mid)
      .limit(1)
      .single()
    if (data) return Number(data.rate)
  }

  // 3. l1 매칭 (대분류 첫 번째 rate)
  const { data } = await supabase
    .from('coupang_categories')
    .select('rate')
    .eq('l1', major)
    .limit(1)
    .single()

  return data ? Number(data.rate) : null
}

/** 전체 카테고리 트리 구성 (UI 드롭다운용) — coupang_categories 사용 */
export async function getCategoryTree(supabase: any): Promise<CategoryNode[]> {
  // Supabase PostgREST max_rows=1000 제한 → 페이지네이션으로 전체 조회
  const PAGE_SIZE = 1000
  const rows: any[] = []
  let from = 0

  while (true) {
    const { data } = await supabase
      .from('coupang_categories')
      .select('l1, l2, l3, rate')
      .order('l1')
      .order('l2')
      .order('l3')
      .range(from, from + PAGE_SIZE - 1)

    if (!data || data.length === 0) break
    rows.push(...data)
    if (data.length < PAGE_SIZE) break
    from += PAGE_SIZE
  }

  if (rows.length === 0) return []

  const tree: Map<string, CategoryNode> = new Map()
  // 소분류 중복 제거를 위한 Set
  const seenSub = new Set<string>()

  for (const row of rows) {
    const l1 = row.l1 as string
    const l2 = row.l2 as string | null
    const l3 = row.l3 as string | null
    const rate = Number(row.rate)

    // 대분류 노드
    if (!tree.has(l1)) {
      tree.set(l1, {
        label: l1,
        value: l1,
        rate,
        children: [],
      })
    }
    const majorNode = tree.get(l1)!

    if (!l2) continue

    // 중분류 노드 (중복 방지)
    const midKey = `${l1}>${l2}`
    let midNode = majorNode.children?.find(c => c.value === l2)
    if (!midNode) {
      midNode = { label: l2, value: l2, rate, children: [] }
      majorNode.children!.push(midNode)
    }

    if (!l3) continue

    // 소분류 노드 (중복 방지)
    const subKey = `${l1}>${l2}>${l3}`
    if (!seenSub.has(subKey)) {
      seenSub.add(subKey)
      midNode.children!.push({
        label: l3,
        value: l3,
        rate,
      })
    }
  }

  return Array.from(tree.values())
}

/** 수수료율을 % 문자열로 변환 */
export function formatRate(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`
}
