/**
 * 계획 지표(레퍼런스 적용 단계 1-1, research/pdp-gap-analysis 4절) — 섹션 순서·바탕·컷·인포그래픽을 계획값으로 잰다. 기록만이고
 * 점수와 합격선에 넣지 않는다. K는 잡이 없어도 순서 풀이 결과로 잴 수 있고(page-heights), D2·K 잡은 계획 기록으로 잰다.
 *
 * - 구조(A1 #1): problemRun 고민 섹션 최장 연속, firstProofAt 첫 근거 위치, howToAt 사용법 위치, closers 끝 표 앞 3자리의 권유 수,
 *   pointFamilyShare 장점 묶음 비중(높이, 높이를 모르면 섹션 수), hookFitsScreen 첫 섹션이 폰 한 화면에 드는가.
 *   위치는 섹션 순번 ÷ (섹션 수 - 1)이라 맨 앞 0, 맨 끝 1이다.
 * - 바탕(A3 #3): 경계 ΔE로는 W↔N·T↔N을 못 세므로 계획의 bg와 풀폭 상자 색으로 센다. 풀폭 상자가 있는 섹션은 페이지에서 그 색으로 보이므로
 *   상자 색 하나로 센다 — 바탕 예산 판정(surface-budget.ts visibleSurfaces)과 같은 자다. 흐름 맨 위가 사진 위 글이면 'P'로 센다(T1-30). t는 띠·바탕만 세고 흰 바탕 위 큰 카드는 card로 따로 센다.
 *   페이지에서 연한 면으로 보이는 수는 t + card다(assignSurfaces tintLike와 같은 셈). 흰 칸 안 카드를 바탕 변화로 볼지는 아직 정하지 않아 이웃 다름에는 넣지 않는다.
 *   디자인 컷 layout 2는 계획 bg가 v1 배정으로 남고 조립이 막 단위로 다시 정하므로(compose.ts, layout2.ts) 조립된 문서의 색으로 잰다(jobPlanMetrics).
 * - 컷(A4 #14): 무대 칸이 계획에 없으면 topStageShare는 null이다. 디자인 컷은 컷 키별 무대 기록(designcut_stages, 적용 D4 ⓐ)으로 재고 그 칸 전의 잡은 null이다. K 잡은 라인 기록(templatelib.shots)으로 재며
 *   대표 컷은 그 기록 밖이라 세지 않는다. 디자인 컷은 추가 컷 기록(extra_shots)으로 목적·앵글을 읽는다.
 * - 인포그래픽(L7 #12): 렌더를 판독하지 않고 모듈·섹션·노드로 어림한다. 그래프·지시선처럼 표식이 없는 유형은 세지 못한다.
 * - 장치(최종 보고 채점 변경 5): 사진 위 글·아이콘·사용법이 든 섹션 수. K는 템플릿 노드로, 사용법은 섹션·역할로 센다. 디자인 컷의 사진 위 글은 렌더 때 글자 자리
 *   측정으로 정해지고 아이콘은 옛 빌더 main_cut에만 있어 조립된 문서로 센다. 문서가 없으면 사진 위 글은 null, 아이콘은 모듈에 없어 0이고 옛 빌더 줄이 끼면 null이다.
 */

import { isWhite } from '../editor/utils/sectionConverter/designCut/layout2'
import { parseColor } from '../editor/utils/mobileReadability'
import { rgbToLch } from '../internalized/designcut-palette'
import type { DesigncutPlan, DesigncutSection, ExtraShotPlan } from '../pdp-state'
import { faceOf, hasCard } from '../templatelib/surface-budget'

/** 폰 한 화면을 캔버스로 옮긴 높이 — design-diagnostics SCREEN_HEIGHT와 같은 값 */
export const SCREEN_HEIGHT = 1860
/** 표 앞 몇 자리에서 권유를 세는가(A1 #4 완료 기준) */
const CLOSER_WINDOW = 3
/** 이 L* 아래 바탕은 짙은 면으로 본다 — 디자인 컷 짙은 면은 L* 40 안팎(designcut-palette)이고 연한 면은 88 이상이다 */
const DARK_SURFACE_L = 60
const SCRIM_ELEMENT = 'designcut-scrim'
const USP_ICON_PREFIX = 'usp_icon_'

const PROBLEM_SECTIONS: ReadonlySet<string> = new Set(['problem_raise', 'problem_empathy'])
const PROOF_SECTIONS: ReadonlySet<string> = new Set(['review', 'perf_reviews', 'perf_metric', 'certification'])
const PROOF_ROLES: ReadonlySet<string> = new Set(['social_proof', 'certification_evidence'])
/** K의 hidden_page는 '놓치기 쉬운 세부'라 사용법이 아니다. 디자인 컷은 같은 키를 사용법에 쓰므로 역할로 가른다 */
const HOW_TO_SECTIONS: ReadonlySet<string> = new Set(['how_to'])
const HOW_TO_ROLES: ReadonlySet<string> = new Set(['how_to_guide'])
const CLOSER_SECTIONS: ReadonlySet<string> = new Set(['convert_div', 'cta', 'event_offer'])
/** K convert_div(추천 대상)와 같은 자리가 디자인 컷의 target_recommendation이다 — 두 라인을 같은 자로 잰다 */
const CLOSER_ROLES: ReadonlySet<string> = new Set(['cta', 'promotion_offer', 'target_recommendation'])
/** 장점 묶음 — 분석 문서 A1 1절의 '모두 장점 안' 6종. A1 #10 완료 기준과 같은 묶음이다 */
export const POINT_FAMILY_SECTIONS: ReadonlySet<string> = new Set(['point_div', 'sub_div', 'hidden_page', 'key_message', 'point_list_div', 'compare'])
const POINT_FAMILY_ROLES: ReadonlySet<string> = new Set(['usp_feature', 'fill_message'])
/** 페이지 끝 표 — 사이즈·상품 정보. 디자인 컷 상품 정보 표는 long:info 키다. 구매 전 확인 표는 편집기가 그릴 때 더하므로 계획에 없다 */
const TAIL_SECTIONS: ReadonlySet<string> = new Set(['spec_table', 'long:info'])

const MODULE_INFOGRAPHICS: Readonly<Record<string, string>> = {
  M1: '체크리스트',
  M4: '치수 도식',
  M7: '단계별 사용법',
  M8: '라인업·옵션',
  M11: '번호·카드 요약',
}
const SECTION_INFOGRAPHICS: Readonly<Record<string, string>> = {
  compare: '비교표',
  option_gallery: '라인업·옵션',
  perf_metric: '큰 숫자',
  point_list_div: '체크리스트',
  solution_guide: '단계별 사용법',
  how_to: '단계별 사용법',
}

export interface PlanShot {
  purpose?: string
  composition?: string
  stage?: string
  imageKey?: string
}

export interface PlanRow {
  /** K 섹션 이름 또는 디자인 컷 키에서 조각 번호를 뗀 값 */
  section: string
  /** 디자인 컷 원래 키 — 끝 표를 가른다 */
  key?: string
  /** 디자인 컷 역할. K는 없다 */
  role?: string
  bg: string | null
  height: number | null
  /** 풀폭 상자 색 또는 사진 얼굴 'P'(K 템플릿, surface-budget faceOf) — 있으면 페이지에서 이 색으로 보인다 */
  band?: string | null
  /** 칸 안 큰 카드 색 C가 있는가(K 템플릿). 디자인 컷은 없어 카드 수를 null로 둔다 */
  card?: boolean
  /** 모양 서명의 상자·사진 칸(K 템플릿). 디자인 컷은 없어 '용기 없음 연속'을 null로 둔다 */
  container?: string
  photo?: string
  /** 사진 위 글이 든 섹션인가(K 템플릿). 못 세는 줄은 칸이 없다 */
  overlayText?: boolean
  /** 아이콘이 든 섹션인가(K 템플릿·디자인 컷). 못 세는 줄은 칸이 없다 */
  icon?: boolean
  shots: readonly PlanShot[]
  infographics: readonly string[]
}

export interface PlanMetrics {
  problemRun: number
  firstProofAt: number | null
  howToAt: number | null
  closers: number
  pointFamilyShare: number | null
  hookFitsScreen: boolean | null
  surfaces: {
    neighborDiff: number | null
    t: number
    d: number
    n: number
    /** 흰 바탕 위 큰 C 카드 수 — t에 더하지 않는다 */
    card: number | null
    wShare: number | null
    longestSame: number
    noContainerRun: number | null
  }
  shots: {
    total: number
    topStageShare: number | null
    neighborSame: number | null
    purposeKinds: number
    compositionKinds: number
    scaleFirstAt: number | null
    reused: number
  }
  infographics: { kinds: number; types: string[] }
  /** 장치가 든 섹션 수(기록만, 점수 밖). 못 세는 칸은 null */
  devices: { overlayText: number | null; icon: number | null; howTo: number }
  /** 계획 대비 빠진 섹션 수(K 잡, missingSectionCount). 라인 기록이 없으면 null */
  missingSections: number | null
}

const round = (value: number) => Math.round(value * 1000) / 1000
const positionOf = (index: number, total: number) => (index < 0 ? null : total > 1 ? round(index / (total - 1)) : 0)

const isIn = (row: PlanRow, sections: ReadonlySet<string>, roles?: ReadonlySet<string>) =>
  row.role !== undefined && roles ? roles.has(row.role) : sections.has(row.section)

/** 조건을 만족하는 칸의 최장 연속 */
function longestRun<T>(list: readonly T[], test: (item: T) => boolean): number {
  let best = 0
  let run = 0
  for (const item of list) {
    run = test(item) ? run + 1 : 0
    best = Math.max(best, run)
  }
  return best
}

/** 페이지에서 보이는 색 */
const visibleOf = (row: PlanRow) => row.band ?? row.bg

function longestSameOf(rows: readonly PlanRow[]): number {
  let best = 0
  let run = 0
  rows.forEach((row, i) => {
    run = i > 0 && visibleOf(row) === visibleOf(rows[i - 1]) ? run + 1 : 1
    best = Math.max(best, run)
  })
  return best
}

function closersOf(rows: readonly PlanRow[]): number {
  let end = rows.length
  while (end > 0 && TAIL_SECTIONS.has(rows[end - 1].key ?? rows[end - 1].section)) end--
  return rows.slice(Math.max(0, end - CLOSER_WINDOW), end).filter((row) => isIn(row, CLOSER_SECTIONS, CLOSER_ROLES)).length
}

function pointShareOf(rows: readonly PlanRow[]): number | null {
  if (rows.length === 0) return null
  const known = rows.every((row) => row.height !== null)
  const weight = (row: PlanRow) => (known ? (row.height as number) : 1)
  const total = rows.reduce((sum, row) => sum + weight(row), 0)
  if (total === 0) return null
  const family = rows.filter((row) => isIn(row, POINT_FAMILY_SECTIONS, POINT_FAMILY_ROLES)).reduce((sum, row) => sum + weight(row), 0)
  return round(family / total)
}

function surfacesOf(rows: readonly PlanRow[]): PlanMetrics['surfaces'] {
  const known = rows.filter((row) => visibleOf(row) !== null)
  const pairs = known.slice(1).map((row, i) => visibleOf(row) !== visibleOf(known[i]))
  const count = (bg: string) => known.filter((row) => visibleOf(row) === bg).length
  const measurable = rows.length > 0 && rows.every((row) => row.container !== undefined && row.photo !== undefined && row.bg !== null)
  return {
    neighborDiff: pairs.length > 0 ? round(pairs.filter(Boolean).length / pairs.length) : null,
    t: count('T'),
    d: count('D'),
    n: count('N'),
    card: rows.length > 0 && rows.every((row) => row.card !== undefined) ? known.filter((row) => row.card && visibleOf(row) === 'W').length : null,
    wShare: known.length > 0 ? round(count('W') / known.length) : null,
    longestSame: longestSameOf(known),
    noContainerRun: measurable
      ? longestRun(rows, (row) => row.container === 'none' && (visibleOf(row) === 'W' || visibleOf(row) === 'N') && row.photo !== 'none' && !String(row.photo).startsWith('bleed'))
      : null,
  }
}

function shotsOf(rows: readonly PlanRow[]): PlanMetrics['shots'] {
  const shots = rows.flatMap((row) => [...row.shots])
  const stages = shots.map((shot) => shot.stage)
  const stageCounts = new Map<string, number>()
  for (const stage of stages) if (stage) stageCounts.set(stage, (stageCounts.get(stage) ?? 0) + 1)
  const allStaged = shots.length > 0 && stages.every(Boolean)
  const withComposition = shots.filter((shot) => shot.composition)
  const pairs = withComposition.slice(1).map((shot, i) => shot.composition === withComposition[i].composition && shot.stage === withComposition[i].stage)
  const keys = shots.map((shot) => shot.imageKey ?? `${shot.purpose ?? ''}|${shot.composition ?? ''}`)
  return {
    total: shots.length,
    topStageShare: allStaged ? round(Math.max(...stageCounts.values()) / shots.length) : null,
    neighborSame: pairs.length > 0 ? round(pairs.filter(Boolean).length / pairs.length) : null,
    purposeKinds: new Set(shots.flatMap((shot) => (shot.purpose ? [shot.purpose] : []))).size,
    compositionKinds: new Set(withComposition.map((shot) => shot.composition)).size,
    // scale은 사진 목적 값이다(구도 값이 아니다)
    scaleFirstAt: positionOf(rows.findIndex((row) => row.shots.some((shot) => shot.purpose === 'scale')), rows.length),
    reused: keys.length - new Set(keys).size,
  }
}

/** 모든 줄을 셀 수 있을 때만 수를 낸다 — 일부만 세면 실제보다 적게 보인다(card와 같은 방식) */
function deviceCount(rows: readonly PlanRow[], pick: (row: PlanRow) => boolean | undefined): number | null {
  return rows.length > 0 && rows.every((row) => pick(row) !== undefined) ? rows.filter((row) => pick(row)).length : null
}

function devicesOf(rows: readonly PlanRow[], drawn: DrawnPage | null): PlanMetrics['devices'] {
  return {
    overlayText: drawn ? drawn.overlayText : deviceCount(rows, (row) => row.overlayText),
    icon: drawn ? drawn.icon : deviceCount(rows, (row) => row.icon),
    howTo: rows.filter((row) => isIn(row, HOW_TO_SECTIONS, HOW_TO_ROLES)).length,
  }
}

/** 조립된 문서 섹션에서 지표가 읽는 칸 */
export interface DrawnSection {
  isVisible?: boolean
  canvas: { height: number; backgroundColor: string }
  elements: ReadonlyArray<{ name?: string }>
}

/** 조립된 문서에서 잰 값 — 계획으로 모르는 칸만 */
export interface DrawnPage {
  surfaces: ReadonlyArray<'W' | 'N' | 'D' | null>
  overlayText: number
  icon: number
}

/**
 * 화면 바탕색 → 바탕 칸. layout 2 배정에는 W·N·D·P만 있고(layout2.ts, T 없음) P는 사진 배경색이라 색으로 흰·연한 면·짙은 면을 가른다.
 * 스튜디오 색은 페이지마다 달라(#F4F3F0·#FAF6ED) 연한 색은 모두 N이다. 색이 아닌 값(그라데이션)은 null이다
 */
function surfaceOfFill(fill: string): DrawnPage['surfaces'][number] {
  const rgb = parseColor(fill)
  if (!rgb) return null
  if (isWhite(fill)) return 'W'
  return rgbToLch(rgb).l < DARK_SURFACE_L ? 'D' : 'N'
}

export function drawnPageOf(sections: readonly DrawnSection[]): DrawnPage {
  const countWith = (test: (name: string) => boolean) => sections.filter((section) => section.elements.some((element) => test(element.name ?? ''))).length
  return {
    surfaces: sections.map((section) => surfaceOfFill(section.canvas.backgroundColor)),
    overlayText: countWith((name) => name === SCRIM_ELEMENT),
    icon: countWith((name) => name.startsWith(USP_ICON_PREFIX)),
  }
}

/**
 * 계획 대비 빠진 섹션 수 — 글 탓(copy.undrawn, 필수 칸이 빔)과 컷 탓(lost, 글은 찼는데 컷 실패)을 더한다. lost만 보면 글 탓을 못 잡는다(K14, V2 K2 lost 0인데 섹션 빠짐).
 * 두 값은 겹치지 않는다(lostSectionsOf가 글 탓을 뺀다). 이미지 단계 전이면 lost 칸이 없어 글 탓만 센다. 카피 기록이 없으면 null
 */
export function missingSectionCount(record: { copy?: { undrawn: readonly string[] }; lost?: readonly unknown[] } | null | undefined): number | null {
  return record?.copy ? record.copy.undrawn.length + (record.lost?.length ?? 0) : null
}

const show = (value: number | boolean | null) => (value === null ? '-' : String(value))

/** 상품·잡 한 줄(기록만, 값은 계산값) */
export function planMetricsLine(id: string, m: PlanMetrics): string {
  const s = m.surfaces
  const c = m.shots
  return [
    `  ${id} 구조 고민연속 ${m.problemRun} 첫근거 ${show(m.firstProofAt)} 사용법 ${show(m.howToAt)} 끝권유 ${m.closers} 장점비중 ${show(m.pointFamilyShare)} 첫화면맞음 ${show(m.hookFitsScreen)}`,
    `바탕 이웃다름 ${show(s.neighborDiff)} T${s.t} D${s.d} N${s.n} 카드 ${show(s.card)} W비율 ${show(s.wShare)} 최장같음 ${s.longestSame} 용기없음연속 ${show(s.noContainerRun)}`,
    `컷 ${c.total} 최다무대 ${show(c.topStageShare)} 이웃같은구도 ${show(c.neighborSame)} 목적 ${c.purposeKinds} 구도 ${c.compositionKinds} 크기감첫 ${show(c.scaleFirstAt)} 겹침 ${c.reused}`,
    `인포그래픽 ${m.infographics.kinds}(${m.infographics.types.join('·')})`,
    `장치 사진위글 ${show(m.devices.overlayText)} 아이콘 ${show(m.devices.icon)} 사용법 ${m.devices.howTo}`,
    `빠진섹션 ${show(m.missingSections)}`,
  ].join(' | ')
}

/** drawn이 있으면 바탕과 사진 위 글·아이콘은 조립된 문서 값이다. missingSections는 호출처가 잰 값(missingSectionCount)이고 모르면 null이다 */
export function planMetrics(rows: readonly PlanRow[], drawn: DrawnPage | null = null, missingSections: number | null = null): PlanMetrics {
  const types = [...new Set(rows.flatMap((row) => [...row.infographics]))].sort()
  const first = rows[0]
  return {
    problemRun: longestRun(rows, (row) => PROBLEM_SECTIONS.has(row.section)),
    firstProofAt: positionOf(rows.findIndex((row) => isIn(row, PROOF_SECTIONS, PROOF_ROLES)), rows.length),
    howToAt: positionOf(rows.findIndex((row) => isIn(row, HOW_TO_SECTIONS, HOW_TO_ROLES)), rows.length),
    closers: closersOf(rows),
    pointFamilyShare: pointShareOf(rows),
    hookFitsScreen: first && first.height !== null ? first.height <= SCREEN_HEIGHT : null,
    surfaces: surfacesOf(drawn ? drawn.surfaces.map((bg): PlanRow => ({ section: '', bg, height: null, shots: [], infographics: [] })) : rows),
    shots: shotsOf(rows),
    infographics: { kinds: types.length, types },
    devices: devicesOf(rows, drawn),
    missingSections,
  }
}

/** 템플릿에서 지표가 쓰는 칸만 — eval이 라이브러리를 직접 읽지 않게 호출처가 넘긴다 */
export interface TemplateLike {
  section: string
  height: number
  signature?: { container: string; photo: string }
  flow?: readonly unknown[]
}

/** 템플릿 흐름 어딘가에 이 노드가 있는가 — 노드마다 자식 칸 이름이 달라 값을 모두 돈다(bandOf와 같은 방식) */
function hasNodeKind(value: unknown, kind: string): boolean {
  if (!value || typeof value !== 'object') return false
  if (Array.isArray(value)) return value.some((item) => hasNodeKind(item, kind))
  const node = value as Record<string, unknown>
  return node.kind === kind || Object.values(node).some((item) => hasNodeKind(item, kind))
}

/** 템플릿 흐름 어딘가에 사진 위 글(image.overlay)이 있는가 */
function hasImageOverlay(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  if (Array.isArray(value)) return value.some(hasImageOverlay)
  const node = value as Record<string, unknown>
  return (node.kind === 'image' && Boolean(node.overlay)) || Object.values(node).some(hasImageOverlay)
}

/** K 순서 풀이 한 줄 또는 K 잡 계획 한 줄 */
export function rowOfTemplate(template: TemplateLike, placed: { bg: string | null; shots?: readonly PlanShot[] }): PlanRow {
  const infographics = new Set<string>()
  const sectionType = SECTION_INFOGRAPHICS[template.section]
  if (sectionType) infographics.add(sectionType)
  if (hasNodeKind(template.flow, 'dimension')) infographics.add('치수 도식')
  return {
    section: template.section,
    bg: placed.bg,
    height: template.height,
    band: faceOf(template),
    ...(template.flow ? { card: hasCard(template), overlayText: hasImageOverlay(template.flow), icon: hasNodeKind(template.flow, 'icon') } : {}),
    ...(template.signature ? { container: template.signature.container, photo: template.signature.photo } : {}),
    shots: placed.shots ?? [],
    infographics: [...infographics],
  }
}

/** 디자인 컷 키 → 섹션 이름 — 'point_div:0'·'k3_point_div' 꼴을 'point_div'로 */
export const planSectionOf = (key: string) => key.replace(/^k\d+_/, '').replace(/:.*$/, '')

/** K 잡의 컷 기록 한 줄(templatelib.shots) — 키 k<섹션 번호>_<칸>_<순번>. 무대는 이름과 지시문이 함께 있어 이름으로 센다 */
export interface LineShotLike {
  key: string
  purpose?: string
  composition?: string
  stage?: { name: string }
}

/** K 섹션 키(k3_point_div)의 컷 — K 키가 아니거나 기록이 없으면 null이다 */
function lineShotsOfKey(lineShots: readonly LineShotLike[] | undefined, sectionKey: string): PlanShot[] | null {
  const index = /^k(\d+)_/.exec(sectionKey)?.[1]
  if (!lineShots || index === undefined) return null
  return lineShots
    .filter((shot) => shot.key.startsWith(`k${index}_`))
    .map(({ key, purpose, composition, stage }) => ({ imageKey: key, purpose, composition, stage: stage?.name }))
}

/** 추가 컷 기록 → 컷 키별 목적·앵글. 디자인 컷은 구도 값이 없어 앵글 번호를 구도로 쓴다 */
function shotDetailsOf(extraShots: ExtraShotPlan | null | undefined): Map<string, PlanShot> {
  const details = new Map<string, PlanShot>()
  for (const shot of [...(extraShots?.points ?? []), ...(extraShots?.shots ?? [])]) {
    details.set(shot.key, { purpose: shot.purpose, ...(shot.angle !== undefined ? { composition: `angle:${shot.angle}` } : {}) })
  }
  return details
}

function shotsOfDesigncut(section: DesigncutSection, details: ReadonlyMap<string, PlanShot>, stages?: Readonly<Record<string, string>> | null): PlanShot[] {
  const keys = new Set<string>()
  if (section.productImageKey) keys.add(section.productImageKey)
  for (const item of section.modules ?? []) {
    const data = item.data as { imageKey?: unknown; scenes?: Array<{ imageKey?: unknown }>; items?: Array<{ imageKey?: unknown }> }
    if (typeof data.imageKey === 'string') keys.add(data.imageKey)
    for (const part of [...(data.scenes ?? []), ...(data.items ?? [])]) if (typeof part.imageKey === 'string') keys.add(part.imageKey)
  }
  return [...keys].map((imageKey) => ({ imageKey, ...details.get(imageKey), ...(stages?.[imageKey] ? { stage: stages[imageKey] } : {}) }))
}

/**
 * 잡의 디자인 컷 계획 → 줄. 계획 순서에만 있고 계획 섹션이 없는 키(그대로 둔 기존 섹션)는 바탕을 모르는 줄로 둔다.
 * heights는 그린 문서 섹션 높이다. 줄 수가 다르면 어느 섹션이 빠졌는지 몰라 쓰지 않는다(템플릿 높이로 대신한다).
 * extraShots는 잡의 추가 컷 기록이다. 없으면 컷 목적·앵글을 모른다. lineShots는 K 잡의 컷 기록이고, 있으면 그 섹션 줄의 컷은 이 값이다.
 * stages는 디자인 컷 잡의 컷 키별 무대 기록(designcut_stages, 적용 D4 ⓐ)이다. 없으면 무대를 몰라 최다 무대가 null이다.
 */
export function rowsOfDesigncut(
  plan: DesigncutPlan | null | undefined,
  options: {
    heights?: readonly number[]
    templateOf?: (id: string) => TemplateLike | undefined
    extraShots?: ExtraShotPlan | null
    lineShots?: readonly LineShotLike[]
    stages?: Readonly<Record<string, string>> | null
  } = {},
): PlanRow[] {
  if (!plan) return []
  const details = shotDetailsOf(options.extraShots)
  const shotsOf = (section: DesigncutSection) => lineShotsOfKey(options.lineShots, section.key) ?? shotsOfDesigncut(section, details, options.stages)
  const byKey = new Map(plan.sections.map((section) => [section.key, section]))
  const keys = plan.order?.length ? plan.order : plan.sections.map((section) => section.key)
  const heights = options.heights?.length === keys.length ? options.heights : null
  return keys.map((key, i): PlanRow => {
    const section = byKey.get(key)
    const height = heights ? heights[i] : null
    if (!section) return { section: planSectionOf(key), key, bg: null, height, shots: [], infographics: [] }
    const template = section.templateRef ? options.templateOf?.(section.templateRef.id) : undefined
    if (template) return { ...rowOfTemplate(template, { bg: section.bg, shots: shotsOf(section) }), key, height: height ?? template.height }
    const infographics = (section.modules ?? []).flatMap((item) => (MODULE_INFOGRAPHICS[item.type] ? [MODULE_INFOGRAPHICS[item.type]] : []))
    // K 섹션의 역할 칸은 섹션 이름이라 디자인 컷 역할 표로 가르면 틀린다(템플릿을 못 찾은 경로, 잡 측정이 여기로 온다)
    return { section: planSectionOf(key), key, ...(section.templateRef ? {} : { role: section.role, icon: false }), bg: section.bg, height, shots: shotsOf(section), infographics }
  })
}

/**
 * 잡 한 건 측정 — 계획 + 조립된 문서. 디자인 컷 layout 2만 바탕·장치를 문서로 잰다. K는 조립이 바탕을 덮지 않고(compose.ts) 템플릿으로 장치를 센다.
 * 안 보이는 섹션과 높이 10 미만 조각은 페이지에 없는 것으로 본다.
 */
export function jobPlanMetrics(
  plan: DesigncutPlan,
  sections: readonly DrawnSection[],
  options: {
    templateOf?: (id: string) => TemplateLike | undefined
    extraShots?: ExtraShotPlan | null
    lineShots?: readonly LineShotLike[]
    stages?: Readonly<Record<string, string>> | null
    /** K 잡의 라인 기록 — 빠진 섹션 수를 잰다. 디자인 컷 잡은 없다 */
    lineRecord?: Parameters<typeof missingSectionCount>[0]
  } = {},
): PlanMetrics {
  const visible = sections.filter((section) => section.isVisible !== false && section.canvas.height >= 10)
  const rows = rowsOfDesigncut(plan, { ...options, heights: visible.map((section) => section.canvas.height) })
  return planMetrics(rows, plan.layout === 2 && !plan.sections.some((section) => section.templateRef) ? drawnPageOf(visible) : null, missingSectionCount(options.lineRecord))
}
