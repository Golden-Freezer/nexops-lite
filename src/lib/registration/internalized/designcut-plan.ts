/**
 * 디자인 컷 비교군 계획(D1) — docs/plans/pdp-enrichment/08_DESIGN_CUTS.md §3·§4.3·§5·§6·§7, 02 D1 절 데이터 계약.
 * 섹션 역할 → 템플릿 배정, usp 분할(POINT), 바탕 유형 교차, 장 번호, 팔레트, 플레이트 화면비, 템플릿 글자·모듈 데이터를
 * 잡 상태(설계 골격·카피·스펙·이미지 태스크 수)에서 결정론으로 만든다. 순수 함수 — 새 문구를 만들지 않고 카피·스펙 값을
 * 그대로 옮긴다(고정 라벨만 예외). 이미지 생성 진행과 무관하게 같은 결과가 나와야 한다(재개·플레이트 태스크 목록 일치).
 */

import { cutBackgroundOf, deriveDesigncutPalette, isHighKeyPhoto, rgbToLch } from './designcut-palette'
import { hasEnrichmentFeature } from '../enrichment-switch'
import { SIZE_SINGLE_SECTION } from '../editor/utils/sectionConverter/designCut/sizeLines'
import { buildPalette2 } from './art-palette'
import { buildFontPair } from './art-fonts'
import { buildD2SceneSet, isLightNeutral, sceneSetInputOf } from '../scene-set'
import { parseColor } from '../editor/utils/mobileReadability'
import { assignImageKeys } from './designcut-images'
import { designlongEnabled, insertLongPieces, readPointPhotos } from './designcut-long'
import { arrangeFillPage, D2_SECTION_TARGET, fillBodyEnabled, messagePieces, readMessageCuts, withInfoSections } from './designcut-fill'
import {
  D2_BIG_POINTS,
  addDetailItem,
  detailPiece,
  heroText,
  markInfoTable,
  markInputDevices,
  markMetricRows,
  markScheduleRows,
  markSwatches,
  markZoneLink,
  pointVariant,
  reviewPiece,
  spreadRuns,
} from './designcut-structure'
import { optionChips, parseAxisDims, parseSizeDims } from './designcut-inputs'
import { solveRhythm } from './bg-rhythm'
import { headlineAccentOf } from '../copy-design-rules'
import { isIconName } from '../templatelib/icons'
import {
  resolveGenerationTrack,
  type DesigncutArtDirection,
  type DesigncutBg,
  type DesigncutPhoto,
  type DesigncutModule,
  type DesigncutPlan,
  type DesigncutSection,
  type DesigncutTemplate,
  type PdpJobRow,
} from '../pdp-state'

/** POINT(usp) 장 수 상한 — 08 §5.1 권장 3~4 */
const MAX_POINTS = 4
/** pdp-image-tasks.ts FEATURE_CAP·HOWTO_CAP과 같은 값(피처 컷 = detailPoints 앞 4, 사용법 컷 = howTo 앞 3) */
const FEATURE_CUTS = 4
/**
 * D2(designcut2) — 특징은 6개까지 싣는다(오너 지시 2026-10-31 '섹션을 늘려 길게', PDP-DR-PLAN §7). 카피 계약은 pointCards 4·
 * detailPoints 6이고 detailPoints 1~4는 pointCards 1~4와 같은 특징이라 겹치지 않는 특징은 6개까지다. 큰 POINT는 3개, 나머지는
 * 자세히 보기(T11) 항목이다(오너 피드백 'POINT 6개는 많다', designcut-structure.ts). 피처 컷도 계획이 쓰는 만큼 6장까지 만든다(d2FeatureCutsOf)
 */
export const MAX_POINTS_D2 = 6
const FEATURE_CUTS_D2 = 6
/**
 * D2 바탕 체계의 밝은 뉴트럴 스튜디오 — 컷 바탕색이 밝은 뉴트럴(L*≥94·C*≤6)이고 흰 기본과 ΔE 3 이상 떨어질 때만 그 색, 아니면
 * 이 색(흰 배경 촬영 상품은 컷 바탕이 흰색이라 그대로 쓰면 바탕 체계가 하나뿐이 된다 — D2-1 검수)
 */
const STUDIO_NEUTRAL = '#F4F3F0'
const STUDIO_MIN_DELTA_FROM_WHITE = 3
const HOWTO_CUTS = 3
/** 고민 말풍선 한 줄 상한 — 카피 정화(pdp-copy-sanitize EMPATHY_LINE_MAX_CHARS)와 같은 값(시험으로 고정) */
export const BUBBLE_MAX_CHARS = 28
const CHECK_MAX_CHARS = 32
/** 규칙 위반 시 대체 순서(08 §4.3 검사) */
const FALLBACK_BG: DesigncutBg[] = ['W', 'T', 'N', 'D', 'P']
/** 08 §2.1 — 정사각 PS·세로 PP(실제 2:3) */
const PLATE_ASPECT: Partial<Record<DesigncutTemplate, '1:1' | '2:3'>> = {
  T1: '2:3',
  T3a: '1:1',
  T3c: '2:3',
  T6: '1:1',
  T8: '2:3',
}
/**
 * 템플릿 명목 높이(캔버스 px) — 짙은 바탕 상한(08 §4.3 D 총 높이 ≤ 30%, 하이키 20%)을 계획 단계에서 추정한다.
 * D2 조립 실측(R1 P02·P03·P07·골든 A·B·C, 2026-10-28)의 대표값. 조립 뒤 실제 비중은 시험이 따로 잰다
 */
const NOMINAL_HEIGHT: Record<DesigncutTemplate, number> = {
  T1: 1300,
  T2: 1270,
  T3a: 1450,
  T3b: 1200,
  T3c: 1290,
  T4: 1100,
  T4Q: 1100,
  T5: 1900,
  T6: 1320,
  T7: 1270,
  T8: 1290,
  // 긴 페이지(designlong) — 표 3~5행, 사용 장면 정사각 컷 2~3장(실측 전 추정값)
  T9: 1100,
  T10: 2400,
  // D2 자세히 보기(특징 1~3개 + 컷)·후기(카드 3~5장) — 실측 전 추정값
  T11: 1800,
  T12: 1500,
}
/** D2 추가 컷 한 장 섹션(long:shot:i)의 명목 높이 — T10 값은 여러 장 막 기준이다 */
const SHOT_NOMINAL_HEIGHT = 1150
/** 막에 사진 한 장 더(fillacts) — 실측 +796 */
const SHOT_EXTRA_HEIGHT = 800
const shotNominalHeight = (p: { modules: ReadonlyArray<{ type: string; data: unknown }> }) => {
  const m10 = p.modules.find((m) => m.type === 'M10')?.data as { scenes?: unknown[] } | undefined
  return SHOT_NOMINAL_HEIGHT + Math.max(0, (m10?.scenes?.length ?? 1) - 1) * SHOT_EXTRA_HEIGHT
}
/** 템플릿 밖(kept) 기존 빌더 섹션의 명목 높이 */
const KEPT_NOMINAL_HEIGHT = 1000
const DARK_SHARE = 0.3
const HIGH_KEY_DARK_SHARE = 0.2
/**
 * 명목 추정 여유 — 계획은 상한의 90%를 목표로 한다. 조립이 섹션 이음 여백을 줄여(compose tightenSeams) 실제 전체 높이가 명목보다
 * 작고, 같은 템플릿도 내용에 따라 높이가 다르다(R1 P02: 명목 18.9% → 조립 뒤 20.3%)
 */
const ESTIMATE_MARGIN = 0.9
/** 사진·고정 바탕 템플릿 — 교차 규칙으로 바꾸지 않는다 */
const FIXED_BG: Partial<Record<DesigncutTemplate, DesigncutBg>> = { T1: 'P', T3b: 'P', T3c: 'P', T8: 'D' }
/** 08 §7.1 바탕 유형 제약(앞이 선호) */
const BG_OPTIONS: Record<DesigncutTemplate, DesigncutBg[]> = {
  T1: ['P'],
  T2: ['T', 'P'],
  // P(사진 배경색 머리)는 마지막 — POINT가 모두 T3a라 밝은 면 연속을 끊을 강한 면이 D 상한 안에서 모자랄 때만(예전 T3b의 P 몫)
  T3a: ['W', 'D', 'T', 'P'],
  T3b: ['P'],
  T3c: ['P'],
  T4: ['W', 'T'],
  T4Q: ['D', 'T'],
  T5: ['W'],
  T6: ['N', 'W'],
  T7: ['T'],
  T8: ['D'],
  // 긴 페이지(designlong) — 사실 표·사용 장면은 밝은 면에만(짙은 면 몫은 기존 막이 쓴다)
  T9: ['N', 'W'],
  T10: ['W', 'N'],
  // D2 자세히 보기·후기도 밝은 면에만
  T11: ['W', 'N'],
  T12: ['N', 'W'],
}
/** 08 §5.1 캡슐 라벨(고정 문구) */
const LABEL = { check: 'CHECK', howto: 'HOW TO', size: 'SIZE', option: 'OPTION', story: 'STORY' }
/** 계약(통합 2026-10-27): 카피에 해당 값이 없는 템플릿의 고정 제목 */
const FIXED_HEADLINE = { howto: '사용 방법', size: '사이즈', target: '이런 분께 추천해요' }
/** 범위 밖 — 기존 빌더 섹션 유지(08 §7.1) */
const KEPT_ROLES = new Set([
  'certification_evidence',
  'promotion_offer',
  'shipping_cs',
  'legal_notice',
  'authenticity',
  'faq',
])

type Piece = Omit<DesigncutSection, 'bg' | 'plateKey' | 'plateAspect'>

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)
const chars = (s: string) => [...s].length
/** 말풍선은 고민 재진술이라 후기처럼 보이는 따옴표를 쓰지 않는다(08 §3 T2·§8) — 앞뒤 따옴표만 걷는다 */
const QUOTES = /^['"“”‘’「『]+|['"“”‘’」』]+$/g
const unquote = (s: string | null) => (s ? s.replace(QUOTES, '').trim() || null : null)
const shortLines = (list: unknown[] | undefined, max: number) =>
  (list ?? []).map(str).filter((s): s is string => s !== null && chars(s) <= max)
/** 같은 문구 비교용 — 소문자, 공백(줄바꿈 없는 공백 포함)·문장부호·기호 제거 */
const normText = (s: string) => s.toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '')

/** designcut 기록 잡 — Track I + 설계 단계가 designcut을 기록 + 설득 플래너 골격(역할)이 있을 때만 */
export function designcutEnabled(job: PdpJobRow): boolean {
  return (
    resolveGenerationTrack(job) === 'internalized' &&
    (job.section_plan?.enrichment?.features ?? []).includes('designcut') &&
    Boolean(job.section_plan?.internalized_skeleton?.persuasion)
  )
}

/** D2 기록 잡 — 디자인 컷 잡이고 설계 단계가 designcut2도 기록(enrichment-switch는 designcut 없이 designcut2를 기록하지 않는다) */
export function designcut2Enabled(job: PdpJobRow): boolean {
  return designcutEnabled(job) && (job.section_plan?.enrichment?.features ?? []).includes('designcut2')
}

/** 고민 컷 스위치(오너 지적 2026-11-01 — 고민 글 바로 아래 웃는 해결 사진) — D2 잡만 */
export function problemcutEnabled(job: PdpJobRow): boolean {
  return designcut2Enabled(job) && hasEnrichmentFeature(job.analysis, 'problemcut')
}

/** D2 잡의 아트 디렉션(C1) — 기록된 계획, 없으면 결정론으로 다시. 꺼진 잡은 null. 컷 프롬프트(헌장 세트 기술)가 이것만 읽는다 */
export function designcutArtDirectionOf(job: PdpJobRow): DesigncutArtDirection | null {
  if (!designcut2Enabled(job)) return null
  return (job.section_plan.designcut ?? buildDesigncutPlan(job))?.artDirection ?? null
}

/**
 * D2 아트 디렉션(C1) — 세트는 R2와 같은 생성기(scene-set)로 만들고 벽 톤 입력은 컷 바탕색이다(스타일 헌장이 컷 바탕색으로 만들어져
 * 같은 톤이 된다). 바닥·소품은 K와 같은 어휘 표다(적용 D4 ⓒ, buildD2SceneSet — 기록된 계획은 그대로 읽는다). 바탕 체계는 흰 기본 + 밝은 뉴트럴 스튜디오 + 강조, 정렬은 첫 화면·마무리 가운데·본문 왼쪽, 모서리는 motif
 */
function artDirectionOf(job: PdpJobRow, palette: DesigncutPlan['palette'], motif: DesigncutPlan['motif']): DesigncutArtDirection {
  const cutBg = cutBackgroundOf(palette)
  const input = sceneSetInputOf(job)
  return {
    set: buildD2SceneSet({ ...input, palette: { ...input.palette, bgMain: cutBg } }),
    background: { base: '#FFFFFF', studio: studioOf(cutBg), accent: palette.accent },
    alignment: { hero: 'center', closing: 'center', body: 'left' },
    corners: motif.badge === 'SHARP' ? 'sharp' : 'soft',
    // D2 아트 디렉션 v2(palette2 기록 잡만) — 대상별 팔레트·첫 화면 타이포(PALETTE2.md). 사진·컷 바탕(palette)은 그대로
    ...((job.section_plan.enrichment?.features ?? []).includes('palette2')
      ? { palette2: buildPalette2(job.analysis, job.spec_sheet, palette.accent, palette.ink) }
      : {}),
    // 글꼴 짝(fontpair 기록 잡만) — 제목 글꼴 + 본문 Pretendard(디자인 폰트 계획 ①)
    ...((job.section_plan.enrichment?.features ?? []).includes('fontpair') ? { fontPair: buildFontPair(job.analysis, job.spec_sheet) } : {}),
  }
}

function studioOf(cutBg: string): string {
  const rgb = parseColor(cutBg)
  if (!rgb || !isLightNeutral(cutBg)) return STUDIO_NEUTRAL
  const { l, c } = rgbToLch(rgb)
  return Math.hypot(100 - l, c) >= STUDIO_MIN_DELTA_FROM_WHITE ? cutBg : STUDIO_NEUTRAL
}

/**
 * D2 잡의 피처 컷 장 수 — 계획 POINT·자세히 보기 항목(M11)이 쓰는 features:<i> 번호까지(최소 4 = 기존 섹션 대체 키 몫, 최대 6).
 * sub_div가 빠져 특징이 4개면 4장이다 — 기존 섹션의 대체 키(features:*)가 태스크 필터를 열어 둬도 안 쓰는 5·6번 컷을 만들지 않는다(D2-1 검수)
 */
export function d2FeatureCutsOf(plan: DesigncutPlan | null): number {
  const used = (plan?.sections ?? [])
    .flatMap((s) => [s.productImageKey, ...s.modules.flatMap((m) => (m.type === 'M11' ? m.data.items.map((i) => i.imageKey) : []))])
    .map((key) => /^features:(\d+)$/.exec(key ?? '')?.[1])
    .filter((n): n is string => n !== undefined)
    .map((n) => Number(n) + 1)
  return Math.min(FEATURE_CUTS_D2, Math.max(FEATURE_CUTS, ...used))
}

/** 원천 사진 측정 기록(images 단계가 계획보다 먼저 기록) — 실패 기록·기록 없음은 null(카피 팔레트 폴백) */
function photoOf(job: PdpJobRow): DesigncutPhoto | null {
  const record = job.section_plan.designcut_photo
  return record && !('failed' in record) ? record : null
}

function motifOf(job: PdpJobRow): DesigncutPlan['motif'] {
  const pack = job.analysis.recommended_strategy_contract?.visual_style_pack
  if (pack === 'clean_proof' || pack === 'premium_editorial') return { badge: 'SHARP' }
  if (pack === 'warm_story' || pack === 'cute_soft') return { badge: 'SOFT' }
  return { badge: ['digital', 'stationery'].includes(job.analysis.detected_category ?? '') ? 'SHARP' : 'SOFT' }
}

const FALLBACK_COST = 10

/**
 * D 개수 범위(08 §4.3: 섹션 ≥ 9면 2~3). 하이키는 1~3 — 하한 2면 D가 1개일 때 붙는 500이 밝음 연속 600과 합쳐져 같은 유형 이웃 1000을
 * 넘어, 상한 안에서 마무리 바로 앞 섹션을 짙게 칠해 D→D 이웃이 생겼다(verifier 3차: T1·T3a×6·T6·T4·T8 → …T4D·T8D)
 */
export function designcutDRange(sectionCount: number, highKey: boolean): [number, number] | null {
  return sectionCount >= 9 ? [highKey ? 1 : 2, 3] : null
}

/**
 * 바탕 배정(08 §4.3) — 페이지 전체를 한 번에 푼다(동적 계획). 우선순위: 짙은 바탕 높이 상한 → 교차 규칙 위반 최소 →
 * D 개수(섹션 ≥ 9면 2~3, 하이키 1~3) → 템플릿 선호 순서(제약 표 밖 대체는 W→T→N→D 순, 비용 가산 — P는 사진 템플릿만).
 * 고정 바탕 템플릿(T1·T3b·T3c P, T8 D)은 후보 1개. 상태 = (마지막 바탕, 같은 밝기 연속 수, D 개수 상한 4, D 명목 높이 합).
 * D 높이 합은 페이지 명목 높이의 30%(하이키 20%) × 여유 0.9 안(08 §4.3 개정 2026-10-28).
 */
function assignBackgrounds(pieces: Piece[], keptCount: number, highKey: boolean): DesigncutBg[] {
  let pointSeries = 0
  const candidates = pieces.map((p) => {
    const fixed = FIXED_BG[p.template]
    if (fixed) return [{ bg: fixed, cost: 0 }]
    // 사진 바탕(P)은 사진 템플릿(고정 P)과 늘 제품 사진이 있는 POINT(T3a)만 — 사진 없는 템플릿의 P는 편집기가 짙은 면으로 채워
    // 짙은 바탕 상한을 비켜 간다(R1 P03 재생)
    let options = BG_OPTIONS[p.template].filter((bg) => bg !== 'P' || p.template === 'T3a')
    // POINT 시리즈 헤더는 W→D→T 순으로 돌린다(P는 늘 마지막)
    if (p.template === 'T3a') {
      const turn = options.filter((bg) => bg !== 'P')
      options = [...turn.slice(pointSeries % 3), ...turn.slice(0, pointSeries % 3), 'P']
      pointSeries++
    }
    const fallback = FALLBACK_BG.filter((bg) => bg !== 'P' && !options.includes(bg))
    return [
      ...options.map((bg, rank) => ({ bg, cost: rank })),
      ...fallback.map((bg, rank) => ({ bg, cost: FALLBACK_COST + rank })),
    ]
  })
  const heights = pieces.map((p) => (p.key.startsWith('long:shot:') ? shotNominalHeight(p) : NOMINAL_HEIGHT[p.template]))
  const total = heights.reduce((a, b) => a + b, 0) + keptCount * KEPT_NOMINAL_HEIGHT
  return solveRhythm(candidates, designcutDRange(pieces.length, highKey), 0, {
    heights,
    total,
    maxShare: (highKey ? HIGH_KEY_DARK_SHARE : DARK_SHARE) * ESTIMATE_MARGIN,
  })
}

/**
 * 디자인 컷 계획 — designcut 기록 잡이 아니면 null. 섹션 순서는 설계 골격(section_order), 역할은 설득 플래너 기록.
 */
export function buildDesigncutPlan(job: PdpJobRow): DesigncutPlan | null {
  if (!designcutEnabled(job)) return null
  const copy = job.copy_sections.final ?? {}
  const persuasion = job.section_plan.internalized_skeleton!.persuasion!
  const roleOf = new Map<string, string>(persuasion.stages.map((s) => [s.section, s.role]))
  const d2 = designcut2Enabled(job)
  // fillacts 재구성 — 플래너가 뺀 정보 섹션 가운데 근거가 있는 것을 더한다(designcut-fill.ts)
  const fillBody = d2 && fillBodyEnabled(job)
  const plannedOrder = job.section_plan.section_order ?? job.section_plan.activated_sections ?? []
  const order = fillBody ? withInfoSections(job, plannedOrder, roleOf) : plannedOrder
  const maxPoints = d2 ? MAX_POINTS_D2 : MAX_POINTS
  const featureCuts = Math.min(copy.detailPoints?.length ?? 0, d2 ? FEATURE_CUTS_D2 : FEATURE_CUTS)
  const howtoCuts = Math.min(copy.howTo?.length ?? 0, HOWTO_CUTS)
  const annotations = (job.section_plan.enrichment?.features ?? []).includes('annotations')

  const pieces: Piece[] = []
  const kept: string[] = []
  const omitted: DesigncutPlan['omitted'] = []
  const pageOrder: string[] = []
  let heroPlaced = false
  /** POINT 모듈 — 장 번호(M6), 장식 참조(M2b — annotations 기록 잡이고 피처 컷일 때) */
  const pointModules = (chapterNo: number, imageKey: string): DesigncutModule[] => [
    { type: 'M6', data: { chapter: chapterNo } },
    ...(annotations && imageKey.startsWith('features:') ? [{ type: 'M2b' as const, data: { imageKey } }] : []),
  ]
  /**
   * 페이지에 POINT 제목으로 나오는 문구(정규화) — 해결 요약 체크리스트가 같은 말을 되풀이하지 않게 한다(B 배치 점검 ⑧:
   * 체크리스트 4개가 POINT 01~04 제목과 같아 같은 말이 세 번 나왔다)
   */
  const usp = (key: string) => order.includes(key) && roleOf.get(key) === 'usp_feature'
  const pointHeadlines = new Set(
    [
      ...(usp('point_div') ? (copy.pointCards ?? []).map((c) => c?.title) : []),
      ...(usp('sub_div') ? (copy.detailPoints ?? []).map((p) => p?.claim) : []),
    ]
      .map(str)
      .filter((s): s is string => s !== null)
      .map(normText)
  )
  let chapter = 0
  const base = (key: string, role: string, template: DesigncutTemplate): Piece => ({
    key,
    role,
    template,
    chapter: null,
    productImageKey: null,
    productAlpha: false,
    text: { eyebrow: null, headline: null, sub: null },
    modules: [],
  })
  const push = (p: Piece) => {
    pieces.push(p)
    pageOrder.push(p.key)
  }
  const omit = (key: string, reason: string) => omitted.push({ key, reason })

  /**
   * usp 조각 — POINT 번호, 모두 '장 머리·제목 → 사진'(T3a) 한 순서. 예전에는 짝수 장을 '사진 → 글'(T3b)로 바꿔 POINT 01 사진과
   * 02 사진, 02 글과 03 글이 붙어 어느 사진이 어느 POINT인지 알 수 없었다(B 배치 점검 ①). 리듬은 바탕색 교차(W→D→T)로만 준다
   */
  /** D2 — point_div가 POINT로 나오면 detailPoints 1~4는 같은 특징(카피 계약)이라 sub_div에서 다시 싣지 않는다 */
  const sharedFeatures = d2 && usp('point_div') ? Math.min(copy.pointCards?.length ?? 0, MAX_POINTS) : 0
  /** D2 자세히 보기(T11) — 큰 POINT 밖 특징이 처음 나온 자리에 놓이고 뒤 특징은 같은 섹션에 이어 붙는다 */
  let detail: Piece | null = null
  const pointPhotos = d2 ? readPointPhotos((job.section_plan as { extra_shots?: unknown }).extra_shots) : new Map<number, string>()
  const pushPoint = (key: string, role: string, pointIndex: number, title: unknown, body: unknown, ownCut = false, icon?: unknown) => {
    if (ownCut && pointIndex < sharedFeatures) return omit(key, `D2 — POINT ${pointIndex + 1}과 같은 특징(point_div)`)
    if (chapter >= maxPoints) return omit(key, `POINT 상한 ${maxPoints}개`)
    // point_div는 기존 빌더처럼 장 순서의 피처 컷, sub_div는 그 조각의 카피와 같은 인덱스의 피처 컷. D2는 point_div도 자기 인덱스 —
    // pointCards i와 detailPoints i가 같은 특징이라 사진이 맞고, sub_div가 앞에 와도 sub_div 5·6번 컷과 겹치지 않는다
    const cutIndex = ownCut || d2 ? pointIndex : chapter
    // D2 — 큰 POINT는 features:0~2(3개), 그 밖 특징은 자세히 보기 항목(자기 피처 컷, 없으면 글만)
    if (d2 && (cutIndex >= D2_BIG_POINTS || chapter >= D2_BIG_POINTS)) {
      const headline = str(title)
      if (!headline) return omit(key, 'D2 자세히 보기 — 특징 제목 없음')
      if (!detail) push((detail = detailPiece(role)))
      const imageKey = cutIndex < featureCuts ? `features:${cutIndex}` : null
      // 아이콘(적용 T1-60 D)은 카피가 K 사전 이름을 줄 때만 옮긴다 — 지금 카피 프롬프트는 고르지 않아 칸이 생기지 않는다
      addDetailItem(detail, { title: headline, description: str(body), imageKey, ...(typeof icon === 'string' && isIconName(icon) ? { icon } : {}) })
      return omit(key, 'D2 — 자세히 보기(T11)에 묶음')
    }
    chapter++
    const imageKey = cutIndex < featureCuts ? `features:${cutIndex}` : 'hero'
    push({
      ...base(key, role, 'T3a'),
      chapter,
      pointIndex,
      productImageKey: imageKey,
      text: { eyebrow: null, headline: str(title), sub: str(body) },
      modules: [
        ...pointModules(chapter, imageKey),
        // fillacts — 큰 POINT 사진 한 장 더(편집기가 섹션 끝에 놓는다)
        ...((photo) => (photo ? [{ type: 'M10' as const, data: { scenes: [{ imageKey: photo, caption: '' }] } }] : []))(pointPhotos.get(cutIndex)),
      ],
      ...(d2 ? { layoutVariant: pointVariant(chapter, str(body)) } : {}),
    })
  }

  for (const key of order) {
    const role = roleOf.get(key)
    if (key === 'divider') {
      omit(key, '구분선 — 디자인 컷은 색면 교차로 구분한다')
      continue
    }
    if (!role || KEPT_ROLES.has(role)) {
      kept.push(key)
      pageOrder.push(key)
      continue
    }
    switch (role) {
      case 'hook':
      case 'product_intro': {
        if (heroPlaced) {
          omit(key, '히어로(T1) 하나로 합침')
          break
        }
        heroPlaced = true
        const intro = copy.mainIntro ?? {}
        // 후킹은 카피·이미지만(오너 지시) — 옵션 컬러칩 띠(M8)를 붙이지 않는다. 옵션은 옵션 섹션(T7)이 보여 준다
        // D2 — 분류 글자 대신 후킹 문장(오너 지시: 후킹 → 제목 → 보조 효익 → 사진)
        push({ ...base(key, role, 'T1'), productImageKey: 'hero', text: heroText(intro, d2) })
        break
      }
      case 'problem': {
        if (key === 'solution_guide') {
          const lines = shortLines(
            (copy.pointCards ?? []).map((c) => c?.title),
            CHECK_MAX_CHARS
          )
          const items = lines.filter((t) => !pointHeadlines.has(normText(t))).slice(0, 5)
          // POINT 제목과 같은 항목을 빼고 3개가 안 되면 체크리스트 대신 기존 해결 섹션(요약 문구)을 그린다
          if (items.length < 3 && items.length < lines.length) {
            kept.push(key)
            pageOrder.push(key)
            break
          }
          if (items.length < 3) {
            omit(key, '해결 요약 항목 3개 미만')
            break
          }
          push({
            ...base(key, role, 'T4'),
            text: { eyebrow: LABEL.check, headline: str(copy.solution?.declaration), sub: str(copy.solution?.summary) },
            modules: [{ type: 'M1', data: { items } }],
          })
          break
        }
        if (pieces.some((p) => p.template === 'T2')) {
          omit(key, '고민(T2) 하나로 합침')
          break
        }
        const lines = shortLines(
          (copy.problem?.empathyLines ?? []).map((l) => unquote(str(l))),
          BUBBLE_MAX_CHARS
        ).slice(0, 3)
        if (lines.length < 2) {
          omit(key, '고객 고민 문장 2개 미만(28자 이하)')
          break
        }
        push({
          ...base(key, role, 'T2'),
          // problemcut — 고민 사진(상품 없음). 없으면 지금처럼 글만
          ...(problemcutEnabled(job) ? { productImageKey: 'problem' } : {}),
          // 라벨 없음 — '이런 고민' 문구 삭제(오너 지시 11-01), 제목이 고민을 묻는다
          text: { eyebrow: null, headline: str(copy.problem?.question), sub: str(copy.problem?.empathy) },
          modules: [{ type: 'M2a', data: { lines } }],
        })
        break
      }
      case 'usp_feature': {
        if (key === 'point_div') {
          ;(copy.pointCards ?? []).forEach((c, i) => pushPoint(`point_div:${i}`, role, i, c?.title, c?.description))
        } else if (key === 'sub_div') {
          ;(copy.detailPoints ?? []).forEach((p, i) =>
            pushPoint(`sub_div:${i}`, role, i, p?.claim, p?.benefit ?? p?.proof, true, p?.icon)
          )
        } else {
          pushPoint(key, role, 0, null, null)
        }
        break
      }
      case 'social_proof': {
        // D2 — 실제 후기 카드(카피 reviewHighlights)가 있으면 후기(T12) 한 섹션에 평점과 묶는다. D1은 예전 그대로
        if (!d2) {
          omit(key, '자사 후기 미확인 — 인용 카드 비활성(08 §8)')
          break
        }
        if (pieces.some((p) => p.template === 'T12')) {
          omit(key, '후기(T12) 하나로 합침')
          break
        }
        const review = reviewPiece(job, key, role)
        if (review) push(review)
        else omit(key, 'D2 — 인용할 수 있는 실제 후기 카드 없음')
        break
      }
      case 'how_to_guide': {
        const steps = (copy.howTo ?? [])
          .map((s) => ({ title: str(s?.step), description: str(s?.description) }))
          .filter((s): s is { title: string; description: string } => s.title !== null)
          .map((s) => ({ title: s.title, description: s.description }))
          .slice(0, 4)
        if (steps.length < 2) {
          omit(key, '사용 단계 2개 미만')
          break
        }
        push({
          ...base(key, role, 'T5'),
          productImageKey: howtoCuts > 0 ? 'howto:0' : null,
          text: { eyebrow: LABEL.howto, headline: FIXED_HEADLINE.howto, sub: null },
          modules: [{ type: 'M7', data: { steps } }],
        })
        break
      }
      case 'target_recommendation': {
        const items = shortLines(copy.recommendedTargets, CHECK_MAX_CHARS).slice(0, 5)
        if (items.length < 3) {
          omit(key, '추천 대상 3개 미만')
          break
        }
        push({
          ...base(key, role, 'T4'),
          text: { eyebrow: LABEL.check, headline: FIXED_HEADLINE.target, sub: null },
          modules: [{ type: 'M1', data: { items } }],
        })
        break
      }
      case 'size_spec': {
        const raw = job.spec_sheet.size ?? ''
        // sizecut 잡은 제품 하나짜리 전용 컷을 쓰고, 방향을 모르는 치수는 축을 붙이지 않고 입력 글 그대로 적는다(T6). 그 밖은 빌린 컷(assignImageKeys)
        const sizeCut = designcut2Enabled(job) && hasEnrichmentFeature(job.analysis, 'sizecut')
        const dims = sizeCut ? parseAxisDims(raw) : parseSizeDims(raw)
        if (parseSizeDims(raw).length === 0) {
          omit(key, 'spec.size에서 치수(숫자+단위)를 읽지 못함')
          break
        }
        push({
          ...base(key, role, 'T6'),
          productImageKey: sizeCut ? SIZE_SINGLE_SECTION : 'hero',
          text: { eyebrow: LABEL.size, headline: FIXED_HEADLINE.size, sub: null },
          modules: [{ type: 'M4', data: { dims, raw } }],
        })
        break
      }
      case 'brand_story': {
        // D2 — 상품 없는 빈 분위기 컷(T3c)은 기본에서 뺀다(PDP-DR-PLAN §2 C7, P03 −4.98)
        if (d2) {
          omit(key, 'D2 — 빈 분위기 컷(T3c)은 기본에서 뺀다')
          break
        }
        const story = copy.keyMessageCopy ?? copy.conceptCopy
        if (!str(story?.headline)) {
          omit(key, '스토리 문구 없음')
          break
        }
        push({
          ...base(key, role, 'T3c'),
          text: { eyebrow: LABEL.story, headline: str(story?.headline), sub: str(story?.subCopy) },
        })
        break
      }
      case 'option_catalog': {
        const options = optionChips(job, copy.colorOptions?.options, d2)
        if (options.length < 2) {
          omit(key, '옵션 2개 미만')
          break
        }
        push({
          ...base(key, role, 'T7'),
          productImageKey: 'hero',
          text: {
            eyebrow: LABEL.option,
            headline: str(copy.colorOptions?.title),
            sub: str(copy.colorOptions?.description),
          },
          modules: [{ type: 'M8', data: { chips: options } }],
        })
        break
      }
      case 'cta':
        push({
          ...base(key, role, 'T8'),
          productImageKey: 'hero',
          text: { eyebrow: null, headline: str(copy.closingCta?.headline), sub: str(copy.closingCta?.subtext) },
        })
        break
      default:
        kept.push(key)
        pageOrder.push(key)
    }
  }

  // 디자인 컷 긴 페이지(designlong 기록 잡) — 사실 표·구석구석 보면 막을 제자리에 끼운다. D2는 상품 정보 표 하나와 이미지 쪽 추가 컷
  // 막(extra_shots)을 designlong 없이도 둔다(designcut-long.ts). D2는 같은 템플릿·변형 3연속을 푼다(designcut-structure.ts)
  if (designlongEnabled(job) || d2) insertLongPieces(job, pieces, pageOrder, { d2 })
  if (fillBody) {
    // 그래도 비는 섹션은 카피의 메시지로 채우고, 막과 본문을 표 앞으로 모은다
    const cuts = readMessageCuts((job.section_plan as { extra_shots?: unknown }).extra_shots)
    const messages = messagePieces(job, pieces, D2_SECTION_TARGET - (pieces.length + kept.length), cuts)
    pieces.push(...messages)
    pageOrder.push(...messages.map((m) => m.key))
    arrangeFillPage(pieces, pageOrder)
  }
  // spreadRuns는 표 뒤로 옮길 수 있어 재구성 잡에는 쓰지 않는다 — 재구성 순서는 메시지를 끼우고 형태를 돌려 같은 형태 3연속이 나지 않는다
  if (d2 && !fillBody) spreadRuns(pieces, pageOrder)
  const keyed = assignImageKeys(pieces, job.mode === 'pro')
  const photo = photoOf(job)
  const bgs = assignBackgrounds(keyed, kept.length, photo ? isHighKeyPhoto(photo) : false)
  const sections: DesigncutSection[] = keyed.map((p, i) => {
    // 상품 컷이 있는 섹션에는 플레이트를 깔지 않는다(통합 지시 2026-10-28 — 편집기가 컷 바탕색으로 이어 칠한다). 상품 컷이 없는
    // 분위기(T3c)만 플레이트를 만든다 — 마무리(T8)는 키 배정이 늘 컷을 준다(cta→usage→solution→hero)
    const aspect = p.template === 'T3c' ? (PLATE_ASPECT[p.template] ?? null) : null
    // 모델이 고른 제목 강조 구절(T1-17) — 카피 headlineAccents에서 이 제목 글로 찾고 다시 검사한다. 없으면 칸을 두지 않는다(지금 규칙)
    const accent = headlineAccentOf(p.text.headline, copy.headlineAccents)
    return { ...p, ...(accent ? { text: { ...p.text, accent } } : {}), bg: bgs[i], plateKey: aspect ? `plate:${p.key}` : null, plateAspect: aspect }
  })
  const palette = deriveDesigncutPalette(copy.designPalette?.primary, job.analysis.detected_category, photo)
  const motif = motifOf(job)
  return {
    version: 1,
    palette,
    motif,
    // D2 구역 연결 표식(D6 P5) — 고민 바로 다음이 해결 안내 또는 첫 큰 POINT면 T2에 표지. 상품 정보 표 좌우 줄·짙은 머리 띠(D6 P6).
    // 사이즈 칸 입력 수치 줄(D6 P7). 입력 장치 — 마무리 원형 배지·자세히 보기 층 띠·사이즈 칸 구성품(D6 R-D1·T1-85·T1-83). 옵션 칸 색 점(C5 ③)
    sections: d2
      ? markSwatches(markInputDevices(markScheduleRows(markMetricRows(markInfoTable(markZoneLink(sections, pageOrder), pageOrder), job.spec_sheet), job.spec_sheet), job.spec_sheet), job.spec_sheet)
      : sections,
    kept,
    omitted,
    order: pageOrder,
    ...(d2 ? { artDirection: artDirectionOf(job, palette, motif) } : {}),
    // 렌더 v2 실험 스위치(designlayout 기록 잡만) — 바탕은 편집기 조립이 막 단위로 다시 정한다(designCut/layout2.ts)
    ...((job.section_plan.enrichment?.features ?? []).includes('designlayout') ? { layout: 2 as const } : {}),
    // 사이즈·상품 정보가 페이지 맨 끝(designcut-fill) — 조립의 구매 전 확인 표와 측정의 마무리 규칙이 읽는다
    ...(fillBody ? { factsLast: true as const } : {}),
  }
}

export { rhythmViolations, solveRhythm, type RhythmCandidate } from './bg-rhythm'
export { parseAxisDims, parseSizeDims } from './designcut-inputs'
