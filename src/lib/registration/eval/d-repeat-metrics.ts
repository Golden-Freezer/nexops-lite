/**
 * D 페이지 반복 지표(적용 D3 P0) — 디자인 컷 계획이 같은 뼈대·부품·장점·제목 첫머리·사진을 몇 번 되풀이하는지 센다. 기록만이고 점수·합격선·계획
 * 동작에 넣지 않는다. K 페이지 구성 지표(templatelib/page-mix.ts pageMix)·같은 말 반복(templatelib/slot-notes.ts pageEchoProblems)과 같은 셈을
 * D 계획 칸으로 옮겼다 — K 함수는 K 템플릿 타입과 K 글 칸 모듈에 묶여 D가 직접 쓰지 못한다. 낱말 자르기(stem·WORD_RE)는 copy-repeats 것을 쓴다.
 *
 * - 뼈대: 템플릿·형태 변형(spreadRuns와 같은 키 'T3a:zigzag'). 큰 POINT(chapter 있음)와 기존 빌더 섹션(kept)은 세지 않고 이웃도 끊는다(K pageMix와 같다).
 *   사실 표(T9)는 D에 다른 표 뼈대가 없어 횟수 상한 밖이라(D3 P1, 통합 11-03 12:52) 'T9 뺀 최다'를 함께 적는다. 계획의 같은 키는 designcut-structure skeletonOf다
 *   (측정이 계획 코드에 기대지 않게 따로 둔다 — 계획을 되돌린 전 측정도 같은 자로 잰다).
 * - 부품: 체크(T4 체크 표식)·말풍선(T2)·원·아치 틀 사진이 든 섹션 수. 원 3칸은 글 길이로 조립이 고르므로 그린 문서로 센다. 문서가 없으면 null이다.
 *   틀은 K devicesOf처럼 템플릿 사진 틀만 센다 — 편집기 장식의 원형 확대(annotations.ts annotation-zoom)는 사진 분석 장식이라 '확대 원'으로 따로 센다.
 * - 장점류: 역할 usp_feature(POINT·자세히 보기)·fill_message(채움 메시지) 섹션 수 — plan-metrics 장점 묶음 역할과 같다.
 * - POINT 같은 말(R-K20): 앞 POINT 제목과 같은 어절 짝(끝 조사를 뗀 이웃 두 어절)을 쓴 POINT 제목 수. 숫자만인 어절·옵션 값·브랜드가 든 짝은 세지 않는다.
 * - 제목 첫머리(R-K21): 같은 두 어절로 시작하는 제목의 최다 수와 상한(K와 같은 2번)을 넘긴 수.
 * - 사진: 대표 컷(hero)을 쓴 첫 화면(T1) 밖 섹션 수와 같은 컷을 쓴 이웃 수. 컷 키는 plan-metrics rowsOfDesigncut과 같은 자(제품 컷 + 모듈 컷)로 읽는다.
 */

import { stem, WORD_RE } from '../copy-repeats'
import { ARCH_CLIP } from '../editor/utils/sectionConverter/designCut/build'
import type { DesigncutPlan, DesigncutSection } from '../pdp-state'
import { rowsOfDesigncut } from './plan-metrics'

/** 첫머리가 같은 제목 상한 — K slot-notes OPENING_MAX와 같은 값(세 번째부터 넘침) */
export const OPENING_MAX = 2
const ADVANTAGE_ROLES: ReadonlySet<string> = new Set(['usp_feature', 'fill_message'])
const HERO_KEY = 'hero'
const FIRST_SCREEN = 'T1'
/** 사실 표 템플릿 — 횟수 상한 밖 */
const TABLE_TEMPLATE = 'T9'
const CHECK_PREFIX = 'designcut-check-'
const BUBBLE_PREFIX = 'designcut-bubble-'
/** 편집기 장식 원형 확대의 이미지 유형(annotations.ts) — 원 틀이지만 템플릿 틀이 아니다 */
const ZOOM_IMAGE_TYPE = 'annotation-zoom'

type SkeletonSection = Pick<DesigncutSection, 'template' | 'layoutVariant' | 'chapter'>

/** 뼈대 키 — 큰 POINT는 null(세지 않는다). 변형 칸이 없으면 scene(spreadRuns와 같다) */
export const skeletonOfSection = (section: SkeletonSection): string | null =>
  typeof section.chapter === 'number' ? null : `${section.template}:${section.layoutVariant ?? 'scene'}`

/** 그린 문서 섹션에서 부품이 읽는 칸 */
export interface DeviceSection {
  isVisible?: boolean
  canvas: { height: number }
  elements: ReadonlyArray<{ name?: string; framedImageProps?: { frameId?: string; clipPath?: string; imageType?: string } }>
}

export interface DeviceCounts {
  check: number
  bubble: number
  frame: number
  /** 원형 확대 장식이 든 섹션 수 — 틀에 넣지 않는다 */
  zoom: number
}

export interface DRepeatMetrics {
  /** 페이지 순서 칸 수(기존 빌더 섹션 포함)와 그중 계획 섹션 수 */
  sections: { total: number; planned: number }
  skeleton: { max: number; top: string | null; repeats: number; adjacent: number; maxOutsideTables: number }
  devices: DeviceCounts | null
  advantages: number
  pointEchoes: number
  opening: { max: number; top: string | null; over: number }
  shots: { heroBorrowed: number; sameNeighbors: number }
}

/** 안 보이는 섹션과 높이 10 미만 조각은 페이지에 없는 것으로 본다(plan-metrics jobPlanMetrics와 같은 기준) */
export function drawnDevicesOf(sections: readonly DeviceSection[]): DeviceCounts {
  const visible = sections.filter((section) => section.isVisible !== false && section.canvas.height >= 10)
  const countWith = (test: (element: DeviceSection['elements'][number]) => boolean) => visible.filter((section) => section.elements.some(test)).length
  return {
    check: countWith((element) => (element.name ?? '').startsWith(CHECK_PREFIX)),
    bubble: countWith((element) => (element.name ?? '').startsWith(BUBBLE_PREFIX)),
    frame: countWith((element) => {
      const props = element.framedImageProps
      return props?.imageType !== ZOOM_IMAGE_TYPE && (props?.frameId === 'circle' || props?.clipPath === ARCH_CLIP)
    }),
    zoom: countWith((element) => element.framedImageProps?.imageType === ZOOM_IMAGE_TYPE),
  }
}

/** 제목 첫머리 키(끝 조사를 뗀 첫 두 어절) — K slot-notes openingOf와 같은 셈. 어절이 둘 안 되면 null */
export function openingKeyOf(title: string): string | null {
  const [first, second] = title.match(WORD_RE) ?? []
  return first && second ? `${stem(first)} ${stem(second)}` : null
}

/** 제목의 어절 짝 — K slot-notes wordPairs와 같은 셈(숫자만인 어절과 빼는 낱말이 든 짝은 세지 않는다) */
function wordPairsOf(title: string, excluded: readonly string[]): Set<string> {
  const skip = (word: string) => /^\d+$/.test(word) || excluded.some((term) => word === term || (term.length >= 2 && word.startsWith(term)))
  const words = title.match(WORD_RE) ?? []
  const pairs = new Set<string>()
  for (let i = 0; i + 1 < words.length; i++) if (!skip(words[i]) && !skip(words[i + 1])) pairs.add(`${stem(words[i])} ${stem(words[i + 1])}`)
  return pairs
}

/** 가장 많이 나온 키 — 같은 수면 페이지에서 먼저 나온 키 */
function topOf(counts: ReadonlyMap<string, number>): { max: number; top: string | null } {
  let max = 0
  let top: string | null = null
  for (const [key, n] of counts) if (n > max) [max, top] = [n, key]
  return { max, top }
}

function skeletonsOf(page: ReadonlyArray<DesigncutSection | null>): DRepeatMetrics['skeleton'] {
  const counts = new Map<string, number>()
  let adjacent = 0
  let prev: string | null = null
  for (const section of page) {
    const key = section ? skeletonOfSection(section) : null
    if (key !== null) {
      counts.set(key, (counts.get(key) ?? 0) + 1)
      if (key === prev) adjacent++
    }
    prev = key
  }
  const outside = [...counts].filter(([key]) => !key.startsWith(`${TABLE_TEMPLATE}:`)).map(([, n]) => n)
  return { ...topOf(counts), repeats: [...counts.values()].reduce((sum, n) => sum + n - 1, 0), adjacent, maxOutsideTables: Math.max(0, ...outside) }
}

const headlineOf = (section: DesigncutSection) => section.text?.headline ?? null

function pointEchoesOf(page: readonly DesigncutSection[], excluded: readonly string[]): number {
  const earlier: Array<Set<string>> = []
  let echoes = 0
  for (const section of page) {
    const title = headlineOf(section)
    if (typeof section.chapter !== 'number' || !title) continue
    const pairs = wordPairsOf(title, excluded)
    if ([...pairs].some((key) => earlier.some((seen) => seen.has(key)))) echoes++
    earlier.push(pairs)
  }
  return echoes
}

function openingsOf(page: readonly DesigncutSection[]): DRepeatMetrics['opening'] {
  const counts = new Map<string, number>()
  for (const section of page) {
    const key = openingKeyOf(headlineOf(section) ?? '')
    if (key !== null) counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return { ...topOf(counts), over: [...counts.values()].reduce((sum, n) => sum + Math.max(0, n - OPENING_MAX), 0) }
}

/**
 * 계획 한 건 측정. drawn은 그 계획을 조립한 편집기 문서 섹션이다(부품만 읽는다). excludeTerms는 옵션 값·브랜드 낱말(copy-repeats
 * repeatExclusionTerms) — POINT 같은 말에서 뺀다.
 */
export function dRepeatMetrics(plan: DesigncutPlan, options: { drawn?: readonly DeviceSection[]; excludeTerms?: readonly string[] } = {}): DRepeatMetrics {
  const byKey = new Map(plan.sections.map((section) => [section.key, section]))
  const keys = plan.order?.length ? plan.order : plan.sections.map((section) => section.key)
  const page = keys.map((key) => byKey.get(key) ?? null)
  const planned = page.filter((section): section is DesigncutSection => section !== null)
  // rowsOfDesigncut은 같은 키 순서로 줄을 낸다 — 줄 i가 page[i]다
  const shotKeys = rowsOfDesigncut(plan).map((row) => new Set(row.shots.flatMap((shot) => (shot.imageKey ? [shot.imageKey] : []))))
  const sameNeighbors = shotKeys.slice(1).filter((keysHere, i) => [...keysHere].some((key) => shotKeys[i].has(key))).length
  const heroBorrowed = page.filter((section, i) => section !== null && section.template !== FIRST_SCREEN && shotKeys[i].has(HERO_KEY)).length
  return {
    sections: { total: page.length, planned: planned.length },
    skeleton: skeletonsOf(page),
    devices: options.drawn ? drawnDevicesOf(options.drawn) : null,
    advantages: planned.filter((section) => ADVANTAGE_ROLES.has(section.role)).length,
    pointEchoes: pointEchoesOf(planned, options.excludeTerms ?? []),
    opening: openingsOf(planned),
    shots: { heroBorrowed, sameNeighbors },
  }
}

/** 잡 한 줄(기록만, 값은 계산값) */
export function dRepeatLine(id: string, m: DRepeatMetrics): string {
  const d = m.devices
  return [
    `  ${id} 섹션 ${m.sections.planned}/${m.sections.total}`,
    `뼈대 최다 ${m.skeleton.max}(${m.skeleton.top ?? '-'}) T9 뺀 최다 ${m.skeleton.maxOutsideTables} 반복 ${m.skeleton.repeats} 이웃 ${m.skeleton.adjacent}`,
    `부품 체크 ${d ? d.check : '-'} 말풍선 ${d ? d.bubble : '-'} 틀 ${d ? d.frame : '-'} 확대 원 ${d ? d.zoom : '-'}`,
    `장점류 ${m.advantages}`,
    `POINT 같은 말 ${m.pointEchoes}`,
    `첫머리 최다 ${m.opening.max}(${m.opening.top ?? '-'}) 넘침 ${m.opening.over}`,
    `대표 컷 빌림 ${m.shots.heroBorrowed} 같은 컷 이웃 ${m.shots.sameNeighbors}`,
  ].join(' | ')
}
