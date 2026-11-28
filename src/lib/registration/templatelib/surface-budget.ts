/**
 * K 라인 바탕 예산(분석 2차 A3 3.2·3.5절) — 돌림이 아니라 흰 바탕을 기본으로 두고 짙은 면·연한 면·회색 면을 페이지당 개수 안에서 자리에 맞춰 준다.
 * 판매 페이지는 이웃 바탕 다름이 0.40~0.57인데 돌림은 0.89~0.92였다. 값은 설계 판단이 섞인 시작값이고 K0에서 눈으로 다시 본다. 순수·결정론.
 * 템플릿 안 풀폭 상자(D 16개·T 13개)는 그 색으로 센다. 바탕이 흰색이어도 페이지에서는 짙은 면·연한 면으로 보이기 때문이다.
 * 칸 안 큰 카드 색 C도 T 상한에 같이 센다. 흰 바탕 위 C는 연한 면과 같은 색이라 K0 눈 확인에서 덩어리가 계획보다 많았다(P11 6/계획 3, P07 4/계획 2).
 * 흐름 맨 위가 사진 위 글(풀폭 사진 + overlay)인 템플릿은 사진이 얼굴이라 'P'로 본다(T1-30, D 라인 applyToneRhythm과 같은 값) — 이웃 다름·흰 바탕 연속·간격
 * 판정엔 들고 D·T·N 개수(dCap·tCap·N_CAP)엔 안 든다. 그 칸엔 D·T·N을 주지 않는다(사진에 가린다).
 */

import type { DesigncutBg } from '../pdp-state'
import type { Concept } from './concepts'
import { POINT_SECTION, type TemplateMeta } from './template-meta'

/**
 * 리듬별 페이지당 개수 — dCap은 상자까지 넣어 넘지 않는 값, dGoal은 코드가 바탕으로 채우는 값이다.
 * dark는 K9(상세페이지 조사 L10 적용 후보 2)에서 4·3 → 7·6으로 올렸다 — 짙은 면 위주 페이지(T3a·T3b) 21편의 짙은 면이 25~77%(중앙 32.5~40%)였다
 */
export const SURFACE_BUDGET: Record<Concept['rhythm'], { dCap: number; dGoal: number; tCap: number }> = {
  light: { dCap: 0, dGoal: 0, tCap: 3 },
  mixed: { dCap: 2, dGoal: 2, tCap: 3 },
  dark: { dCap: 7, dGoal: 6, tCap: 2 },
}
/**
 * 카테고리별 T 상한·D 보정(적용 K3 T1-27, 연구 A3 3.4절 '카테고리별(판매)' 표의 T 상한·D 보정 칸 그대로) — 표에 없는 카테고리(반려·문구·포장은
 * 표본이 페이지 5개 안팎이라 못 봄)는 리듬 값 그대로다. T 상한은 리듬 tCap과 작은 쪽을 쓰고, D 보정은 리듬 값에 더한다.
 * 보정은 mixed·dark 리듬에만 건다(통합 11-03 04:58 (가)). light 리듬은 짙은 면이 없어 T·N만으로 이웃 다름을 낸다 — light까지 T 상한을 걸면 484쪽 계산값에서
 * 18섹션 이상 이웃 다름 0.45 미만이 0 → 33·34쪽, 범위 안 0.982 → 0.911, 디지털 light 합격점 미달 +6이었다(K3 측정).
 */
export const CATEGORY_SURFACE: Readonly<Record<string, { tCap: number; dShift: number }>> = {
  fashion: { tCap: 1, dShift: 0 },
  beauty: { tCap: 3, dShift: -1 },
  food: { tCap: 3, dShift: 0 },
  household: { tCap: 2, dShift: 0 },
  digital: { tCap: 2, dShift: 1 },
}

/** 리듬 예산에 카테고리 보정을 얹은 값 — light 리듬이거나 카테고리가 없거나 표에 없으면 리듬 값 그대로다 */
export function surfaceBudgetOf(rhythm: Concept['rhythm'], category?: string): { dCap: number; dGoal: number; tCap: number } {
  const base = SURFACE_BUDGET[rhythm]
  const fit = rhythm !== 'light' && category ? CATEGORY_SURFACE[category] : undefined
  if (!fit) return base
  return { dCap: Math.max(0, base.dCap + fit.dShift), dGoal: Math.max(0, base.dGoal + fit.dShift), tCap: Math.min(base.tCap, fit.tCap) }
}
export const N_CAP = 3
/** 이만큼은 회색 면을 넣는다 — 이웃 다름 상한을 넘기면 덜 넣는다 */
const N_GOAL = 2
/** 흰 바탕이 이어져도 되는 최대 수 */
export const W_MAX_RUN = 4
/** 짙은 면끼리 최소 간격(칸 차이) */
export const D_MIN_GAP = 3
/** T처럼 보이는 카드의 최소 폭(860 기준) — K0 눈 확인 값(줄 폭 25%, 시작값). 세로 기준 90px(390 기준)은 렌더 값이라 시험이 지금 템플릿을 확인한다 */
export const CARD_MIN_WIDTH = 215
/** 페이지당 큰 카드 수 — 많으면 연한 면 자리를 다 써서 바탕이 흰색으로 이어진다 */
export const CARD_MAX = 1
/** 이웃 바탕이 다른 비율의 목표 범위 — 18섹션 이상 페이지 기준이다 */
export const CHANGE_RANGE = { min: 0.45, max: 0.75 }
/** 짙은 면·연한 면이 차지할 수 있는 칸 비율 — light·mixed는 흰 계열(W+N) 70% 이상, dark는 50% 이상(K9 후보 2) */
export const NON_WHITE_SHARE: Record<Concept['rhythm'], number> = { light: 0.3, mixed: 0.3, dark: 0.5 }
/** 첫 자리에 짙은 띠를 둘 수 있는 리듬 — 조사에서 짙은 면 위주 페이지는 첫 화면부터 짙은 편이 많았다(T3b 8/10·T3a 4/11) */
const DARK_FIRST_RHYTHMS: ReadonlySet<Concept['rhythm']> = new Set(['dark'])
/** 첫 자리 짙은 띠를 이 리듬에 허용하는가 — 후보 고르기(selection.ts)와 자리 판정(bandFits)이 같이 본다 */
export const darkFirstAllowed = (rhythm: Concept['rhythm']) => DARK_FIRST_RHYTHMS.has(rhythm)

const D_FIRST: ReadonlySet<string> = new Set(['concept_desc', 'key_message', 'problem_raise', 'problem_empathy', 'review', 'convert_div'])
const T_FIRST: ReadonlySet<string> = new Set(['solution_guide', 'faq', 'review', 'direction_suggest', 'problem_raise', 'problem_empathy'])
/** 짙은 면을 가장 뒤로 미루는 자리 — 사용법은 연한 면이 먼저다 */
const D_LAST: ReadonlySet<string> = new Set(['solution_guide'])

export type SurfaceRow = Pick<TemplateMeta, 'surfaces'> & Partial<Pick<TemplateMeta, 'section' | 'order' | 'flow'>>

/** 템플릿 안 풀폭 상자의 색 — 없으면 null이다. 칸 안의 작은 상자는 세지 않는다 */
export function bandOf(template: Pick<TemplateMeta, 'flow'>): 'D' | 'T' | null {
  let found: 'D' | 'T' | null = null
  const walk = (value: unknown): void => {
    if (found === 'D' || !value || typeof value !== 'object') return
    if (Array.isArray(value)) return value.forEach(walk)
    const node = value as Record<string, unknown>
    if (node.kind === 'panel' && node.bleed === true && (node.fill === 'D' || node.fill === 'T')) found = node.fill
    Object.values(node).forEach(walk)
  }
  walk(template.flow)
  return found
}

/** 칸 안 큰 카드 색 C가 있는가 — 흰 바탕 위에서 연한 면과 같은 색이다(engine surfaceOfFill). 풀폭 상자와 좁은 칸은 아니다 */
export function hasCard(template: Pick<TemplateMeta, 'flow'>): boolean {
  let found = false
  const walk = (value: unknown): void => {
    if (found || !value || typeof value !== 'object') return
    if (Array.isArray(value)) return value.forEach(walk)
    const node = value as Record<string, unknown>
    if (node.kind === 'panel' && node.fill === 'C' && node.bleed !== true && (typeof node.w !== 'number' || node.w >= CARD_MIN_WIDTH)) {
      found = true
      return
    }
    Object.values(node).forEach(walk)
  }
  walk(template.flow)
  return found
}

/** 놓인 템플릿 가운데 연한 면으로 보이는 것 — 연한 띠와 큰 카드 */
const tintLikeCount = (placed: ReadonlyArray<Pick<TemplateMeta, 'flow'>>) => placed.filter((row) => bandOf(row) === 'T' || hasCard(row)).length

/**
 * 이 자리에 이 상자를 놓아도 되는가 — 순서 풀이가 후보를 고를 때 본다. 짙은 띠는 끝 자리와 첫 자리(dark 리듬은 첫 자리 허용)에 두지 않고, 상자 수가 예산을
 * 넘지 않으며, 간격 규칙을 지킨다. 끝 자리 spec_table.dark-band가 여기서 걸린다. 큰 카드는 연한 띠와 같은 상한을 나눠 쓴다.
 */
export function bandFits(
  candidate: Pick<TemplateMeta, 'flow'>,
  placed: ReadonlyArray<Pick<TemplateMeta, 'flow'>>,
  isLast: boolean,
  rhythm: Concept['rhythm'],
  category?: string
): boolean {
  const band = bandOf(candidate)
  const budget = surfaceBudgetOf(rhythm, category)
  if (!band) return !hasCard(candidate) || (placed.filter(hasCard).length < CARD_MAX && tintLikeCount(placed) < budget.tCap)
  const bands = placed.map(bandOf)
  if (bands.at(-1) === 'T' || (band === 'T' && bands.at(-1) === 'D')) return false
  if (band === 'T') return tintLikeCount(placed) < budget.tCap
  if (isLast || (placed.length === 0 && !darkFirstAllowed(rhythm))) return false
  if (bands.slice(-(D_MIN_GAP - 1)).includes('D')) return false
  return bands.filter((b) => b === 'D').length < budget.dCap
}

/** 흐름 맨 위가 풀폭 사진 위 글인가 — 사진 위 글은 흐름 맨 위 풀폭 사진에만 쓴다(lint overlay) */
export function photoFace(template: Pick<TemplateMeta, 'flow'>): boolean {
  const top = template.flow?.[0] as Record<string, unknown> | undefined
  return top?.kind === 'image' && top.bleed === true && Boolean(top.overlay)
}

/** 템플릿이 바탕 대신 보이는 얼굴 — 풀폭 상자 색, 사진 얼굴 'P', 없으면 null(배정 바탕이 보인다) */
export function faceOf(template: Pick<TemplateMeta, 'flow'>): 'D' | 'T' | 'P' | null {
  return bandOf(template) ?? (photoFace(template) ? 'P' : null)
}

/** 페이지에서 보이는 색 — 상자가 있으면 상자 색, 사진 얼굴이면 'P'다. 이웃·개수 판정은 이 값으로 한다 */
export function visibleSurfaces(rows: readonly SurfaceRow[], backgrounds: readonly DesigncutBg[]): DesigncutBg[] {
  return rows.map((row, i) => faceOf(row) ?? backgrounds[i])
}

export function changeRatio(cells: readonly DesigncutBg[]): number {
  if (cells.length < 2) return 0
  return cells.filter((cell, i) => i > 0 && cell !== cells[i - 1]).length / (cells.length - 1)
}

/**
 * 바탕 배정 — 흰 바탕을 기본으로 두고 D → T → N 순서로 예산만큼 넣는다. 템플릿 surfaces 안에서만 고른다.
 * 자리는 우선 섹션 → 다른 면과 고르게 떨어진 곳 → 구역이 바뀌는 곳(동점 규칙, A1 안을 합침) → 앞쪽 순서로 정한다.
 * 첫·끝 섹션은 D·T·N을 주지 않는다(템플릿이 그 바탕만 받으면 그대로 둔다). 이웃 다름이 상한을 넘으면 더 넣지 않는다. 예산은 카테고리 보정을 얹은 값이다(surfaceBudgetOf).
 */
export function assignSurfaces(rows: readonly SurfaceRow[], rhythm: Concept['rhythm'], category?: string): DesigncutBg[] {
  const budget = surfaceBudgetOf(rhythm, category)
  const n = rows.length
  const backgrounds: DesigncutBg[] = rows.map(({ surfaces }) => (surfaces.includes('W') ? 'W' : surfaces[0]))
  const cells = visibleSurfaces(rows, backgrounds)
  const count = (bg: DesigncutBg) => cells.filter((cell) => cell === bg).length
  const near = (i: number, bg: DesigncutBg, gap = 1) => cells.some((cell, j) => cell === bg && j !== i && Math.abs(i - j) <= gap)
  const inner = (i: number) => i > 0 && i < n - 1
  const free = (i: number, bg: DesigncutBg) => inner(i) && cells[i] === 'W' && !bandOf(rows[i]) && rows[i].surfaces.includes(bg)
  const pointIndexes = rows.flatMap((row, i) => (row.section === POINT_SECTION ? [i] : []))
  const inPointRun = (i: number) => pointIndexes.length > 0 && i >= pointIndexes[0] && i <= pointIndexes[pointIndexes.length - 1]
  const zoneChanges = (i: number) => i > 0 && rows[i].order !== undefined && rows[i - 1].order !== undefined && rows[i].order?.zone !== rows[i - 1].order?.zone
  const gapOf = (i: number) => Math.min(i, n - 1 - i, ...cells.flatMap((cell, j) => (cell === 'W' ? [] : [Math.abs(i - j)])))

  /** 예산이 찰 때까지 가장 좋은 자리에 넣는다 — 간격 목표를 넘은 자리끼리는 동점이라 구역 경계가 고른다 */
  const fill = (bg: DesigncutBg, goal: number, first: ReadonlySet<string>, open: (i: number) => boolean, last: ReadonlySet<string> = new Set(), counted: () => number = () => count(bg)) => {
    while (counted() < goal) {
      const spots = rows.flatMap((_, i) => (free(i, bg) && open(i) ? [i] : []))
      if (spots.length === 0) return
      const marks = cells.filter((cell) => cell !== 'W').length + goal - counted()
      const enough = Math.max(2, Math.floor(n / (marks + 1)))
      const seat = (section = '') => (first.has(section) ? 2 : last.has(section) ? 0 : 1)
      const rank = (i: number) => [seat(rows[i].section), Math.min(gapOf(i), enough), zoneChanges(i) ? 1 : 0]
      const best = spots.reduce((a, b) => {
        const [ra, rb] = [rank(a), rank(b)]
        const diff = rb.findIndex((value, k) => value !== ra[k])
        return diff >= 0 && rb[diff] > ra[diff] ? b : a
      })
      cells[best] = bg
      if (changeRatio(cells) > CHANGE_RANGE.max) {
        cells[best] = 'W'
        return
      }
      backgrounds[best] = bg
    }
  }

  fill('D', budget.dGoal, D_FIRST, (i) => !near(i, 'D', D_MIN_GAP - 1) && !near(i, 'T'), D_LAST)
  // 흰 계열 비율(light·mixed 70%, dark 50%)을 지키려고 짧은 페이지는 연한 면을 줄인다. 예산이 있는 리듬은 하나는 남긴다
  const tGoal = Math.min(budget.tCap, Math.max(1, Math.floor(n * NON_WHITE_SHARE[rhythm]) - count('D')))
  // 흰 바탕 위 큰 카드는 연한 면으로 보인다 — 상한에 같이 세고, 연한 면을 그 옆이나 그 칸에 넣지 않는다
  const cards = rows.map((row) => hasCard(row))
  const whiteCard = (i: number) => cards[i] && cells[i] === 'W'
  const tintLike = () => count('T') + rows.filter((_, i) => whiteCard(i)).length
  const nearCard = (i: number) => [i - 1, i, i + 1].some((j) => j >= 0 && j < n && whiteCard(j))
  const tintOpen = (i: number) => !inPointRun(i) && !near(i, 'T') && !near(i, 'D') && !near(i, 'N') && !nearCard(i)
  const greyOpen = (i: number) => !near(i, 'T') && !near(i, 'N')
  fill('T', tGoal, T_FIRST, tintOpen, new Set(), tintLike)

  /** 흰 바탕 묶음 — 긴 것부터 */
  const whiteRuns = () => {
    const runs: Array<{ from: number; length: number }> = []
    cells.forEach((cell, i) => {
      if (cell !== 'W') return
      if (i > 0 && cells[i - 1] === 'W') runs[runs.length - 1].length++
      else runs.push({ from: i, length: 1 })
    })
    return runs.sort((a, b) => b.length - a.length || a.from - b.from)
  }
  // 묶음 가운데에서 가까운 칸부터 — 흰 바탕을 반으로 나눈다
  const middleOut = ({ from, length }: { from: number; length: number }) =>
    Array.from({ length }, (_, k) => from + k).sort((a, b) => Math.abs(a - (from + (length - 1) / 2)) - Math.abs(b - (from + (length - 1) / 2)) || a - b)
  while (count('N') < N_CAP) {
    const runs = whiteRuns()
    const tooLong = (runs[0]?.length ?? 0) > W_MAX_RUN
    if (!tooLong && count('N') >= N_GOAL && changeRatio(cells) >= CHANGE_RANGE.min) break
    const spot = runs.flatMap(middleOut).find((i) => free(i, 'N') && greyOpen(i))
    if (spot === undefined) break
    cells[spot] = 'N'
    if (!tooLong && changeRatio(cells) > CHANGE_RANGE.max) {
      cells[spot] = 'W'
      break
    }
    backgrounds[spot] = 'N'
  }

  /** 예산을 다 쓰고도 흰 바탕이 길면 이미 놓은 면 하나를 그 안으로 옮긴다 — 개수는 그대로고, 옮긴 자리에 새 묶음이 생기지 않을 때만 */
  const moveInto = (bg: DesigncutBg, open: (i: number) => boolean): boolean => {
    const length = whiteRuns()[0].length
    const from = rows.flatMap((row, j) => (backgrounds[j] === bg && cells[j] === bg && inner(j) && row.surfaces.includes('W') ? [j] : []))
    for (const to of middleOut(whiteRuns()[0])) {
      for (const j of from) {
        cells[j] = 'W'
        if (free(to, bg) && open(to)) {
          cells[to] = bg
          if (whiteRuns()[0].length < length && changeRatio(cells) <= CHANGE_RANGE.max) {
            backgrounds[j] = 'W'
            backgrounds[to] = bg
            return true
          }
          cells[to] = 'W'
        }
        cells[j] = bg
      }
    }
    return false
  }
  /** 묶음 안 카드 칸에 연한 면을 준다 — 카드가 흰색이 되어 연한 면 수는 그대로고 흰 바탕만 끊긴다 */
  const cardToTint = (): boolean => {
    const spot = middleOut(whiteRuns()[0]).find((i) => whiteCard(i) && free(i, 'T') && !inPointRun(i) && !near(i, 'T') && !near(i, 'D') && !near(i, 'N'))
    if (spot === undefined) return false
    cells[spot] = 'T'
    if (changeRatio(cells) > CHANGE_RANGE.max) {
      cells[spot] = 'W'
      return false
    }
    backgrounds[spot] = 'T'
    return true
  }
  for (let tries = 0; tries < n && (whiteRuns()[0]?.length ?? 0) > W_MAX_RUN; tries++) {
    // 옮길 때는 카드 옆 자리도 받는다 — 긴 흰 바탕을 끊는 쪽이 낫다. 카드 칸 자체는 아니다
    if (!cardToTint() && !moveInto('N', greyOpen) && !moveInto('T', (i) => !inPointRun(i) && !near(i, 'T') && !near(i, 'D') && !near(i, 'N') && !whiteCard(i))) break
  }
  return backgrounds
}
