/** 카테고리 경로를 화면용 세그먼트로 정규화한다. */
export function splitCategoryPath(categoryPath: string | null | undefined): string[] {
  if (!categoryPath) return []
  return categoryPath
    .split('>')
    .map((segment) => segment.trim())
    .filter(Boolean)
}

/** 테이블 폭 보호: 깊이 4 이상이면 1차와 리프 사이를 생략한다. */
export function compactCategorySegments(categorySegments: string[]): string[] {
  if (categorySegments.length <= 3) return [...categorySegments]
  return [categorySegments[0], '…', categorySegments[categorySegments.length - 1]]
}

export interface CategoryTreeEntry {
  categoryCode: number
  l1: string | null
  l2: string | null
  categorySegments: string[]
}

export interface CategoryTreeGroup<T extends CategoryTreeEntry> {
  l1: string
  categories: T[]
}

export const UNCATEGORIZED_L1 = '미분류'

export function categoryL1(category: CategoryTreeEntry): string {
  return category.l1 ?? category.categorySegments[0] ?? UNCATEGORIZED_L1
}

export function categoryL2(category: CategoryTreeEntry): string | null {
  return category.l2 ?? category.categorySegments[1] ?? null
}

/** 카드 누락 없이 l1 섹션으로 묶는다. 입력 순서와 각 그룹 내부 순서를 유지한다. */
export function groupCategoriesByL1<T extends CategoryTreeEntry>(categories: T[]): CategoryTreeGroup<T>[] {
  const groups = new Map<string, T[]>()
  for (const category of categories) {
    const l1 = categoryL1(category)
    const entries = groups.get(l1) ?? []
    entries.push(category)
    groups.set(l1, entries)
  }
  return [...groups].map(([l1, entries]) => ({ l1, categories: entries }))
}

export function filterCategoriesByTree<T extends CategoryTreeEntry>(
  categories: T[],
  selectedL1: string | null,
  selectedL2: string | null
): T[] {
  return categories.filter((category) => {
    if (selectedL1 && categoryL1(category) !== selectedL1) return false
    if (selectedL2 && categoryL2(category) !== selectedL2) return false
    return true
  })
}

export function getL2Options<T extends CategoryTreeEntry>(categories: T[], selectedL1: string | null): string[] {
  if (!selectedL1) return []
  return [
    ...new Set(
      categories
        .filter((category) => categoryL1(category) === selectedL1)
        .map(categoryL2)
        .filter((value): value is string => Boolean(value))
    )
  ]
}

/** 기존 탭/필터 쿼리는 보존하면서 카테고리 트리 상태만 갱신한다. */
export function buildCategoryTreeQuery(currentQuery: string, l1: string | null, l2: string | null = null): string {
  const params = new URLSearchParams(currentQuery)
  if (l1) params.set('l1', l1)
  else params.delete('l1')
  if (l1 && l2) params.set('l2', l2)
  else params.delete('l2')
  return params.toString()
}
