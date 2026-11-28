/**
 * K 라인 선택 규칙(M5, PDP-KLINE-PLAN §5) — AI 단계 앞뒤의 코드 단계만 담는다. AI는 후보 안에서 고르기만 하고, 그 전후를 여기서 좁히고 검증한다.
 * 컨셉 후보 → 색·글꼴 → 섹션별 상위 5개 → 순서 풀이(selection-order.ts) → 구성 검사. 사실·근거는 selection-facts.ts다.
 * 기록 형식은 하네스 원장(__e2e__/template-ledger.ts)이 읽는 section_plan.templatelib이다. 순수·결정론 — 같은 상품은 같은 결과다.
 */

import type { MotionPlanRecord } from '../motion/pick'
import type { LineShot } from './shot-brief'
import type { ShotRefineRecord } from './shot-refine'
import { CATEGORY_INFOGRAPHIC, INFOGRAPHIC_BONUS } from './category-flow'
import { colorSetsOf, rankForPhoto, type ColorSet } from './color-sets'
import { CONCEPTS, type Concept } from './concepts'
import { FONT_PAIR_TABLE, type FontPair, type FontPairId } from './font-pairs'
import { isInfoCell } from './info-cells'
import type { PalettePickRecord } from './palette-pick'
import { sectionOpen } from './selection-facts'
import { bandOf, darkFirstAllowed } from './surface-budget'
import { FACT_FREE_FILLERS, FILLER_MAX, PAGE_LAST_SECTION, POINT_MAX, POINT_SECTION, REQUIRED_SECTIONS, type OrderResult, type OrderedSection } from './selection-order'
import { PAGE_SECTIONS, type TemplateMeta } from './template-meta'
import { OPTION_LINEUP_INPUT, PARTS_ITEMS_INPUT, type ImageOverlay } from './template-types'
import type { UspAuditRecord } from './usp-audit'

/** 섹션당 AI에게 보여 줄 후보 수 */
export const CANDIDATE_LIMIT = 5
/** 카테고리 템플릿 가점(A·C 결정 11-01, 측정 전 시작값) — 합 2.5가 컨셉 적합 +3보다 작아 컨셉 맞는 공용을 뒤집지 못한다 */
export const FIT_BONUS = { category: 1.5, productFamily: 0.5, pageFamily: 0.5 } as const
/** 후보 가운데 카테고리 템플릿이 차지할 수 있는 몫 — 5개 중 3개. 공용을 남겨 같은 카테고리 상품끼리 페이지가 너무 닮지 않게 한다 */
export const CATEGORY_CANDIDATE_SHARE = 0.6

/** 상품에서 선택 규칙이 읽는 것 */
export interface SelectionProfile {
  /** 결정론 분기 씨앗(잡·상품 식별자) — 같은 상품은 같은 선택, 다른 상품은 다른 선택이 되게 한다 */
  key: string
  categoryKey: string
  /** 제품군(judgeProductFamily가 낸 값) — 없으면 제품군 지정 템플릿을 쓰지 않는다 */
  productFamily?: string
  /** 페이지 family(pickPageFamily) — 같은 값의 템플릿이 가점을 받는다 */
  pageFamily?: string
  photoCount: number
  /** 상품 대표색(사진 측정값) — 없으면 null */
  productHex: string | null
  /** 상품이 가진 근거(evidenceOf) */
  evidence: ReadonlySet<string>
  /** 입력값으로 그릴 수 있는 템플릿인가 — 없으면 따지지 않는다 */
  drawable?: (template: TemplateMeta) => boolean
  /** 방향이 확실한 치수 입력이 있다 — 끝자리 표를 치수 도식이 있는 템플릿으로 고른다 */
  sizeDiagram?: boolean
  /**
   * 번호 구성 템플릿 앞자리(partsbands 스위치 잡, J54) — 구성품 입력이 PARTS_LEAD_MIN개 이상이면 참. 번호 구성 템플릿이 컨셉 점수와 상관없이
   * 그 섹션 후보 맨 앞 1자리를 받는다(라인업·정보 칸과 같은 방식). 없으면 지금 그대로다
   */
  partsLead?: boolean
}

/** 번호 구성 템플릿을 앞자리에 두는 구성품 수(J54 — 쿠팡 경쟁 가위 01~06처럼 셋 이상일 때 번호가 뜻이 있다) */
export const PARTS_LEAD_MIN = 3

/**
 * 결정론 씨앗 방식(R09c, 오너 11-08 22:4x '1번으로 진행') — 'product+job'은 상품명에 잡 id를 섞은 씨앗이다(운영 잡).
 * 같은 상품을 다시 만들어도 컨셉 순서·색·페이지 계열·템플릿 동점·채움 차례가 바뀌고, 같은 잡 id는 늘 같다
 */
export type SelectionSeed = 'product+job'

/** 문자열 → 부호 없는 32비트 해시(FNV-1a) */
export function stableHash(text: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash
}

/**
 * 가이드라인 모델에게 보여 줄 컨셉 — 막힌 카테고리는 뺀다. 카테고리에 맞는 컨셉을 앞에 두고, 같은 무리 안에서는 상품 씨앗으로 섞어
 * 상품마다 앞줄이 달라지게 한다(H2 '한 컨셉 40% 이하')
 */
export function conceptCandidates(profile: Pick<SelectionProfile, 'key' | 'categoryKey'>): Concept[] {
  const rank = (c: Concept) => stableHash(`${profile.key}:${c.id}`)
  const open = CONCEPTS.filter((c) => !c.categoryBlock.includes(profile.categoryKey))
  const fit = open.filter((c) => c.categories.includes(profile.categoryKey))
  const rest = open.filter((c) => !c.categories.includes(profile.categoryKey))
  return [...fit.sort((a, b) => rank(a) - rank(b)), ...rest.sort((a, b) => rank(a) - rank(b))]
}

/**
 * 색 조합 고르기 — 사진 색에 맞는 순서에서 맨 앞 강조색을 정하고, 그 강조색의 조합 가운데 씨앗으로 하나를 고른다.
 * 통과한 조합이 하나도 없으면 null(컨셉 값 오류 — 시험이 막는다)
 */
export function pickPalette(concept: Concept, profile: Pick<SelectionProfile, 'key' | 'productHex'>): ColorSet | null {
  const { sets } = rankForPhoto(colorSetsOf(concept).sets, profile.productHex)
  if (sets.length === 0) return null
  const sameAccent = sets.filter((s) => s.accent === sets[0].accent)
  return sameAccent[stableHash(`${profile.key}:${concept.id}:palette`) % sameAccent.length]
}

export function fontPairOf(concept: Concept): { id: FontPairId; pair: FontPair } {
  return { id: concept.fontPair, pair: FONT_PAIR_TABLE[concept.fontPair] }
}

const isCategoryTemplate = (t: TemplateMeta) => (t.fit.categories?.length ?? 0) > 0 || (t.fit.productFamilies?.length ?? 0) > 0

/** 카테고리·제품군이 맞는가 — 지정이 없으면 공용이다. 제품군 지정 템플릿은 제품군 값이 없는 상품에 쓰지 않는다 */
function targetFits(t: TemplateMeta, profile: SelectionProfile): boolean {
  const { categories, productFamilies } = t.fit
  if (categories?.length && !categories.includes(profile.categoryKey)) return false
  return !productFamilies?.length || (profile.productFamily !== undefined && productFamilies.includes(profile.productFamily))
}

/** 이 상품에서 쓸 수 있는 템플릿인가 — 사진 수·근거·막힌 카테고리·맞는 카테고리와 제품군. 전수 검사 실패는 라이브러리에 들어오지 않는다 */
function usable(t: TemplateMeta, profile: SelectionProfile): boolean {
  return (
    t.needs.photos <= profile.photoCount &&
    (profile.drawable?.(t) ?? true) &&
    t.needs.evidence.every((key) => profile.evidence.has(key)) &&
    !t.fit.categoryBlock.includes(profile.categoryKey) &&
    targetFits(t, profile)
  )
}

/**
 * 페이지 family — 같은 모티프 계열이 한 페이지에 모이게 컨셉을 정할 때 상품 씨앗으로 하나 고른다. 이 상품에 쓸 수 있고 컨셉에 맞는 템플릿이 있는 family만 본다.
 * 없으면 null이고 family 가점이 없다
 */
export function pickPageFamily(templates: readonly TemplateMeta[], profile: SelectionProfile, concept: Pick<Concept, 'id'>): string | null {
  const families = new Set(templates.flatMap((t) => (t.family && t.fit.concepts.includes(concept.id) && usable(t, profile) ? [t.family] : [])))
  if (families.size === 0) return null
  const sorted = [...families].sort()
  return sorted[stableHash(`${profile.key}:${concept.id}:family`) % sorted.length]
}

/** 카테고리 템플릿 가점 — 공용 템플릿은 0이다 */
function targetBonus(t: TemplateMeta, profile: SelectionProfile): number {
  return (
    (t.fit.categories?.includes(profile.categoryKey) ? FIT_BONUS.category : 0) +
    (profile.productFamily !== undefined && t.fit.productFamilies?.includes(profile.productFamily) ? FIT_BONUS.productFamily : 0) +
    (profile.pageFamily !== undefined && t.family === profile.pageFamily ? FIT_BONUS.pageFamily : 0)
  )
}

/** 흐름에 이 종류의 노드가 있는가 */
function hasNodeKind(value: unknown, kind: string): boolean {
  if (!value || typeof value !== 'object') return false
  if (Array.isArray(value)) return value.some((item) => hasNodeKind(item, kind))
  const node = value as Record<string, unknown>
  return node.kind === kind || Object.values(node).some((item) => hasNodeKind(item, kind))
}

/** 치수 도식 노드가 있는 템플릿인가 */
const showsDimension = (flow: unknown) => hasNodeKind(flow, 'dimension')

/** 카테고리별 인포그래픽 가점(적용 K5 ①-b T1-88) — 그 카테고리에서 자주 쓰는 노드가 흐름에 있으면 INFOGRAPHIC_BONUS */
function infographicBonus(t: TemplateMeta, profile: Pick<SelectionProfile, 'categoryKey'>): number {
  const kinds = CATEGORY_INFOGRAPHIC[profile.categoryKey]
  return kinds?.some((kind) => hasNodeKind(t.flow, kind)) ? INFOGRAPHIC_BONUS : 0
}

/**
 * 늘 첫·끝 자리인 섹션 — 짙은 풀폭 띠는 이 자리에 놓이지 않는다(surface-budget bandFits). 후보로 보이면 모델이 골라도 늘 다음 후보로 넘어가
 * 484페이지에서 한 번도 놓이지 않았다(적용 K12 #14: hook_3step.dark-band·spec_table.dark-band). 그래서 후보에서 뺀다.
 * 첫 자리(hook_3step)는 dark 리듬이면 짙은 띠를 둘 수 있어 남긴다(K9 후보 2, surface-budget darkFirstAllowed)
 */
const FIRST_SECTION = 'hook_3step'
const EDGE_SECTIONS: ReadonlySet<string> = new Set([FIRST_SECTION, PAGE_LAST_SECTION])
const edgeDark = (section: string, t: TemplateMeta, concept: Concept) =>
  EDGE_SECTIONS.has(section) && bandOf(t) === 'D' && !(section === FIRST_SECTION && darkFirstAllowed(concept.rhythm))

/** 우리 판매량 근거(J51b)와 그 숫자를 싣는 섹션 */
const SALES_EVIDENCE = 'sales'
const SALES_SECTION = 'perf_metric'

/**
 * 섹션의 상위 후보 — 근거 잠금 섹션은 자료가 없으면 비어 있다. 점수 = 컨셉 적합(+3) + 밀도 일치(+1) + 평균 점수(있으면 5점 만점의 절반 비중) −
 * 많이 쓴 정도(최대 1) + 카테고리 템플릿 가점(FIT_BONUS) + 카테고리별 인포그래픽 가점(category-flow.ts). 같으면 상품 씨앗 순서라 상품마다 고른 앞줄이 달라진다.
 * 카테고리 템플릿은 CATEGORY_CANDIDATE_SHARE까지만 들어가고 그 자리는 다음 공용이 받는다. 공용이 모자라면 후보가 limit보다 적을 수 있다
 * 방향이 확실한 치수 입력이 있으면 끝자리 표는 치수 도식이 있는 템플릿만 후보다 — 치수가 페이지에서 빠지지 않게 한다(통합 결정 11-01, R16 P09). 그런 템플릿이 없으면 전체에서 고른다
 * 우리 판매량 근거(sales)가 있으면 성과 섹션은 판매 칸이 있는 템플릿만 후보다(J51b). 그런 템플릿이 없으면 전체에서 고른다
 */
export function candidatesFor(
  section: string,
  templates: readonly TemplateMeta[],
  profile: SelectionProfile,
  concept: Concept,
  limit = CANDIDATE_LIMIT
): TemplateMeta[] {
  if (!sectionOpen(section, profile.evidence)) return []
  const score = (t: TemplateMeta) =>
    (t.fit.concepts.includes(concept.id) ? 3 : 0) +
    (t.fit.density === concept.density ? 1 : 0) +
    (t.check.avgScore ?? 0) * 0.5 -
    Math.min(t.check.usedIn / 50, 1) +
    targetBonus(t, profile) +
    infographicBonus(t, profile)
  const tie = (t: TemplateMeta) => stableHash(`${profile.key}:${t.id}`)
  const categoryMax = Math.ceil(limit * CATEGORY_CANDIDATE_SHARE)
  let categoryCount = 0
  const pool = templates.filter((t) => t.section === section && usable(t, profile) && !edgeDark(section, t, concept))
  const withDimension = section === PAGE_LAST_SECTION && profile.sizeDiagram ? pool.filter((t) => showsDimension(t.flow)) : []
  // 우리 판매량(J51b) — 판매 근거가 있으면 성과 섹션은 판매 칸이 있는 템플릿만 후보다(판매 수가 페이지에서 빠지지 않게). 판매 근거가 없는 잡은 그런 템플릿이 고를 수 없어(usable) 지금과 같다
  const withSales = section === SALES_SECTION && profile.evidence.has(SALES_EVIDENCE) ? pool.filter((t) => t.needs.evidence.includes(SALES_EVIDENCE)) : []
  const ranked = (withDimension.length > 0 ? withDimension : withSales.length > 0 ? withSales : pool)
    .sort((a, b) => score(b) - score(a) || tie(a) - tie(b))
    .filter((t) => !isCategoryTemplate(t) || ++categoryCount <= categoryMax)
  // 옵션 라인업(적용 K3 R-W6, 통합 05:38) — 그릴 수 있으면(옵션 2~4개 모두 실물 사진) 후보 맨 앞 1자리를 보장한다.
  // 사진 아닌 정보 칸(infocells 스위치 잡만 후보에 있다, 설계 I4)도 같다 — 꺼진 잡은 근거 잠금으로 후보에 없어 앞줄이 그대로다
  // 번호 구성 템플릿(partsbands 잡, J54)도 같다 — 구성품 입력이 셋 이상이면 컨셉 점수와 상관없이 앞자리다. 꺼진 잡은 partsLead가 없어 앞줄이 그대로다
  const lead = ranked.findIndex((t) => isLineup(t) || isInfoCell(t) || (profile.partsLead === true && isNumberedParts(t)))
  return (lead > 0 ? [ranked[lead], ...ranked.filter((_, i) => i !== lead)] : ranked).slice(0, limit)
}

/** 번호 구성 템플릿인가 — 구성품 입력 목록(parts.items)을 번호 원과 함께 그린다(product_exposure.parts-numbered·parts-side·parts-tiles 등) */
export const isNumberedParts = (t: Pick<TemplateMeta, 'slots' | 'flow'>): boolean =>
  Object.values(t.slots).some((slot) => slot.type === 'list' && slot.input === PARTS_ITEMS_INPUT) && hasNodeKind(t.flow, 'mark')

/** 옵션 라인업 템플릿인가 — 사진·이름 목록이 라인업 입력이다 */
export const isLineup = (t: Pick<TemplateMeta, 'slots'>): boolean =>
  Object.values(t.slots).some((slot) => slot.type === 'list' && slot.input === OPTION_LINEUP_INPUT)

/**
 * 사실 예산을 쓰지 않는 본문 섹션 — 사실이 적은 상품은 사실을 요구하는 본문이 예산에서 빠지므로, 이 둘이 길이를 받친다. 구성에 없으면 더한다.
 * 글이 있는 본문이라 사진 채움(FACT_FREE_FILLERS)의 상한을 받지 않는다. 옵션이 둘 이상이어야 그려지는 option_gallery는 후보가 없으면 더해지지 않는다.
 */
export const FACT_FREE_BODY = ['option_gallery', 'convert_div'] as const
/**
 * 입력이 있을 때 더하는 정보 섹션(적용 K3 T1-38, 통합 11-03 05:30) — 사용법은 근거 usage가 있고 고를 수 있는데 구성에서 빠졌으면 구성 고치기가 더한다.
 * 성분·원료(R-W8, 통합 11-03 05:38)는 입력 재료 이름이 둘 이상(근거 ingredient)이고 그 이름이 칸에 들어갈 때다. 자리가 하나면 앞에 적은 사용법이 먼저다.
 * 필수가 아니다: 남은 자리가 있을 때만 들어가고(상한 22를 넘기지 않는다) 사실을 쓰지 않는 본문(FACT_FREE_BODY)보다 앞이다. 빠져도 구성 검사 문제로 세지 않는다.
 */
export const INPUT_INFO_SECTIONS: ReadonlyArray<{ section: string; evidence: string }> = [
  { section: 'how_to', evidence: 'usage' },
  // 주의·보관(적용 K7-c (가))은 성분보다 앞 — 자리가 하나면 주의가 먼저 든다(통합 11-04 01:2x ①, DEFAULT_COMPOSITION과 같은 순서)
  { section: 'notice', evidence: 'notice' },
  { section: 'ingredients', evidence: 'ingredient' },
  // GIF 칸(움직이는 띠, motionband 스위치 잡만 근거 motion) — 맨 뒤다. 켠 잡은 구성 고치기가 이보다 먼저 자리를 만들어 넣는다(withMotionBand, P5).
  // 꺼진 잡은 근거가 없어 지금과 같다
  { section: 'motion_band', evidence: 'motion' },
]
/**
 * 고민 섹션 — 합쳐 하나까지다(분석 2차 A1 #3, 판매 페이지는 쿠팡 134/136·네이버 559/620이 한 섹션). 둘을 이으면 같은 말이 된다.
 * 사실이 적어 합격점에 못 미치는 페이지만 selectTemplateLine이 나머지 하나를 더한다.
 */
export const PROBLEM_SECTIONS = ['problem_raise', 'problem_empathy'] as const
const PROBLEM_MAX = 1
const OFFER_MAX = 1
/** GIF 칸은 페이지에 하나까지다(B DESIGN 1절 'K 1개') */
const MOTION_MAX = 1
/** 구성 콜이 실패했을 때 쓰는 기본 구성 — 고를 수 있는 것만 남긴다. 길이는 순서 풀이가 채운다 */
const DEFAULT_COMPOSITION = [
  'hook_3step',
  'main_cut',
  'problem_raise',
  'solution_guide',
  'key_message',
  'point_div',
  'point_div',
  'point_div',
  'sub_div',
  'hidden_page',
  'compare',
  'point_list_div',
  'option_gallery',
  'how_to',
  'review',
  'perf_metric',
  'certification',
  'faq',
  'spec_table',
  'event_offer',
  'convert_div',
  'cta',
  // 주의·보관(적용 K7-c (가))은 성분보다 앞 — 22개를 넘으면 성분이 먼저 빠진다(오너가 적은 주의를 숨기지 않는다, 통합 11-04 01:2x ①). 입력이 없으면 열리지 않아 지금과 같다
  'notice',
  // 성분·원료는 자리가 남을 때만이다 — 맨 끝이라 22개를 넘으면 먼저 빠진다(놓이는 자리는 순서 풀이의 자리 띠가 정한다)
  'ingredients',
  // GIF 칸(motionband 스위치 잡만 열림)은 맨 끝 — 22개를 넘으면 가장 먼저 빠진다. 놓이는 자리는 순서 풀이(사용법 뒤)가 정한다
  'motion_band',
]

export function defaultComposition(open: readonly string[]): string[] {
  return DEFAULT_COMPOSITION.filter((section) => open.includes(section))
}

const MOTION_SECTION = 'motion_band'

/**
 * GIF 칸 자리 보장(세션 B ③ P5, 통합 11-06 지시 ② — 오너 22:45 'GIF 칸을 만들어 넣는다') — 근거 motion(켠 잡)이고 고를 수 있는데 구성에 없으면 하나 넣는다.
 * 상한(22)이 차 있으면 덜 중요한 칸 하나를 뺀다: 채움(FACT_FREE_FILLERS) → 사실을 쓰지 않는 본문(FACT_FREE_BODY) → 그 밖의 필수가 아닌 칸, 각각 뒤에서부터.
 * 필수·제품군이 더한 칸(must)·큰 POINT·후기는 빼지 않는다. 놓이는 자리는 순서 풀이(사용법 뒤 15.2)가 정한다. 근거가 없는 잡(꺼진 잡)은 그대로 돌려준다.
 */
function withMotionBand(
  out: readonly string[],
  evidence: ReadonlySet<string>,
  open: readonly string[],
  must: readonly string[]
): { sections: string[]; dropped: string | null; added: boolean } {
  if (!evidence.has('motion') || !open.includes(MOTION_SECTION) || out.includes(MOTION_SECTION)) return { sections: [...out], dropped: null, added: false }
  const sections = [...out]
  let dropped: string | null = null
  if (sections.length >= PAGE_SECTIONS.max) {
    const spare = (section: string) => !must.includes(section) && section !== POINT_SECTION && section !== 'review'
    const tiers = [
      (section: string) => (FACT_FREE_FILLERS as readonly string[]).includes(section),
      (section: string) => (FACT_FREE_BODY as readonly string[]).includes(section),
      () => true,
    ]
    for (const tier of tiers) {
      const at = sections.findLastIndex((section) => spare(section) && tier(section))
      if (at < 0) continue
      dropped = sections[at]
      sections.splice(at, 1)
      break
    }
    if (sections.length >= PAGE_SECTIONS.max) return { sections: [...out], dropped: null, added: false }
  }
  sections.push(MOTION_SECTION)
  return { sections, dropped, added: true }
}

/**
 * 구성 고치기 — 모델이 낸 목록을 규칙에 맞춘다. 다시 부르지 않고 코드로 고쳐 추가 비용이 없다. 고를 수 없는 섹션·넘친 POINT·둘째 고민·둘째 행사를 빼고, 필수 섹션과 자료가 있는
 * 후기를 더하고, 상한을 넘으면 필수가 아닌 것을 뒤에서부터 뺀다. 자리가 남으면 입력이 있는 정보 섹션(INPUT_INFO_SECTIONS), 그다음 사실을 쓰지 않는 본문을 더한다.
 * 고친 내용은 돌려줘 모델 품질을 잴 수 있게 한다.
 * add는 제품군 구성 줄(category-flow.ts)이 더하는 섹션이다 — 고를 수 있을 때만 필수처럼 더하고 상한에 밀리지 않는다. 뺄 섹션은 부르는 쪽이 open에서 뺀다.
 */
export function repairComposition(
  sections: readonly string[],
  evidence: ReadonlySet<string>,
  open: readonly string[],
  add: readonly string[] = []
): { sections: string[]; removed: string[]; added: string[] } {
  const removed: string[] = []
  let points = 0
  let fillers = 0
  let problems = 0
  let offers = 0
  let motions = 0
  const isFiller = (section: string) => (FACT_FREE_FILLERS as readonly string[]).includes(section)
  const isProblem = (section: string) => (PROBLEM_SECTIONS as readonly string[]).includes(section)
  const kept = sections.filter((section) => {
    // 모델이 채움 섹션을 고르면 코드가 더한 채움과 같은 상한을 받는다(순서 풀이가 합쳐 센다)
    const allowed =
      open.includes(section) &&
      (section !== POINT_SECTION || ++points <= POINT_MAX) &&
      (!isFiller(section) || ++fillers <= FILLER_MAX) &&
      (!isProblem(section) || ++problems <= PROBLEM_MAX) &&
      (section !== 'event_offer' || ++offers <= OFFER_MAX) &&
      (section !== 'motion_band' || ++motions <= MOTION_MAX)
    if (!allowed) removed.push(section)
    return allowed
  })
  const must = [
    ...new Set([
      ...REQUIRED_SECTIONS,
      ...(evidence.has('review') ? ['review'] : []),
      // 우리 판매량(J51b) — 판매 근거가 있으면 성과 섹션을 후기처럼 반드시 둔다(열려 있을 때만)
      ...(evidence.has(SALES_EVIDENCE) ? [SALES_SECTION] : []),
      ...add.filter((section) => open.includes(section)),
    ]),
  ]
  const added = must.filter((section) => open.includes(section) && !kept.includes(section))
  const trimmed = [...kept, ...added]
  for (let i = trimmed.length - 1; i >= 0 && trimmed.length > PAGE_SECTIONS.max; i--) {
    if (must.includes(trimmed[i])) continue
    removed.push(trimmed[i])
    trimmed.splice(i, 1)
  }
  const motion = withMotionBand(trimmed, evidence, open, must)
  const out = motion.sections
  if (motion.dropped) removed.push(motion.dropped)
  if (motion.added) added.push(MOTION_SECTION)
  const info = INPUT_INFO_SECTIONS.filter(({ section, evidence: key }) => evidence.has(key) && open.includes(section) && !out.includes(section))
    .map(({ section }) => section)
    .slice(0, Math.max(0, PAGE_SECTIONS.max - out.length))
  const body = FACT_FREE_BODY.filter((section) => open.includes(section) && !out.includes(section)).slice(0, Math.max(0, PAGE_SECTIONS.max - out.length - info.length))
  return { sections: [...out, ...info, ...body], removed, added: [...added, ...info, ...body] }
}

/** 구성 검사(H3·H4 통과 기준) — 섹션 수, 큰 POINT 수, 자료 없는 잠금 섹션, 자료가 있는데 빠진 후기, 필수인 상품 정보 표 */
export function compositionIssues(sections: readonly string[], evidence: ReadonlySet<string>): string[] {
  const issues: string[] = []
  const { min, max } = PAGE_SECTIONS
  if (sections.length < min || sections.length > max) issues.push(`섹션 ${sections.length}개(${min}~${max})`)
  const points = sections.filter((s) => s === POINT_SECTION).length
  if (points > POINT_MAX) issues.push(`큰 POINT ${points}개(최대 ${POINT_MAX})`)
  for (const section of new Set(sections)) {
    if (!sectionOpen(section, evidence)) issues.push(`근거 없는 섹션: ${section}`)
  }
  if (evidence.has('review') && !sections.includes('review')) issues.push('후기 자료가 있는데 후기 섹션이 없음')
  // 우리 판매량(J51b, 통합 decide 33) — 오너가 고른 판매 상품이 있으면 성과 섹션에 싣는다(후기와 같은 규칙)
  if (evidence.has(SALES_EVIDENCE) && !sections.includes(SALES_SECTION)) issues.push('판매 자료가 있는데 성과 섹션이 없음')
  if (!sections.includes('spec_table')) issues.push('상품 정보 표가 없음')
  return issues
}

/** 두 페이지의 구성 거리(0~1) — 쓴 템플릿 집합의 자카드 거리 */
export function compositionDistance(a: readonly string[], b: readonly string[]): number {
  const [x, y] = [new Set(a), new Set(b)]
  const union = new Set([...x, ...y]).size
  if (union === 0) return 0
  const shared = [...x].filter((id) => y.has(id)).length
  return 1 - shared / union
}

/** 상품 간 구성 거리 중앙값(H4 통과 기준 0.3 이상) — 페이지가 둘 미만이면 null */
export function medianCompositionDistance(pages: ReadonlyArray<readonly string[]>): number | null {
  const values: number[] = []
  for (let i = 0; i < pages.length; i++) for (let j = i + 1; j < pages.length; j++) values.push(compositionDistance(pages[i], pages[j]))
  if (values.length === 0) return null
  values.sort((p, q) => p - q)
  const mid = values.length >> 1
  return values.length % 2 ? values[mid] : (values[mid - 1] + values[mid]) / 2
}

/** 첫 화면 사진 유형(오너 지시 11-01 '착용·사용 장면이어야 효익이 상상된다') — in_use 실사용, worn 착용, studio 상품 단독 */
export const HERO_KINDS = ['in_use', 'worn', 'studio'] as const
export type HeroKind = (typeof HERO_KINDS)[number]

/** 컷이 빠져 그리지 못한 섹션 — 섹션 키, 고른 템플릿, 빠진 컷 키 */
export interface LostSection {
  key: string
  templateId: string
  cuts: string[]
}

/** 잡 기록(section_plan.templatelib) — 하네스 원장이 읽는 칸. 이유는 사람이 판독하려고 함께 둔다 */
export interface TemplateLibRecord {
  version: 1
  concept: { id: string; alternatives: string[]; reason?: string }
  /** pick — 색 조합 비전 고르기(palettepick 잡만, J26): 고른 방식·보여 준 후보·이유. 없는 잡은 지금 규칙 색이다 */
  palette: { id: string; pick?: PalettePickRecord }
  fontPair: { id: FontPairId }
  /** 페이지가 말을 거는 고객과 말투 — 카피 단계가 받는다 */
  guideline?: { persona: string; tone: string }
  /** 상품 제품군과 페이지 family — 값이 있을 때만 싣는다 */
  productFamily?: string
  pageFamily?: string
  /** 결정론 씨앗 방식(R09c) — 운영 잡만 싣는다. 없으면 상품명 씨앗이다(시험 잡과 이 칸 전 잡) */
  seed?: SelectionSeed
  /** 첫 화면 사진 유형과 고른 이유 — 파이프라인 연결 때 채우고, 채점이 유형별로 나눠 본다 */
  /** hook — 첫 화면 headline(hookhero 잡만, c09·J21). 대표 컷 지시가 참고로만 읽는다 */
  hero?: { kind: HeroKind; reason?: string; overlayAnchor?: ImageOverlay['anchor']; hook?: string }
  /** 만들 컷(line-plan) — 대표 컷 말고. 이 기록이 있는 잡만 K 컷을 만든다 */
  shots?: LineShot[]
  /** 움직이는 칸 자리(motionband 잡만, 움직이는 칸 자리 규칙) — 대표 칸·계획 AI가 고른 칸과 까닭·엔진. 없는 잡은 지금처럼 motion_band만 */
  motion?: MotionPlanRecord
  /** 카피 뒤 컷 고치기 결과(shot-refine) — 숫자만 */
  shotRefine?: ShotRefineRecord
  /** 장점 후보 근거 대조(uspaudit 잡만, J22) — 감사 상태와 수만, 글은 없다. 없는 잡은 장점 후보를 거르지 않았다 */
  uspAudit?: UspAuditRecord
  /** 이미지 단계가 끝날 때 쓴다 — 0건도 쓴다(다시 돌린 잡의 앞 기록을 지운다). 칸이 없으면 아직 끝나지 않았다 */
  lost?: LostSection[]
  /** 슬롯 카피 결과(line-plan) — 칸과 종류만, 글은 없다. undrawn은 이 글로 못 그리는 섹션이다 */
  copy?: {
    /** detail은 글자 수 문제(length·over)에만 — 몇 자 넘었는지. 글은 남기지 않는다. 이 칸 전에 만든 잡에는 없다 */
    firstProblems: Array<{ index: number; slot: string; kind: string; detail?: string }>
    problems: Array<{ index: number; slot: string; kind: string; detail?: string }>
    dropped: Array<{ index: number; slot: string; kind: string }>
    fixCalls: number
    /** POINT 제목 글자 수 기록. 이 칸 전에 만든 잡에는 없다 */
    pointTitle?: { count: number; medianChars: number | null }
    /** 모델이 고른 강조 구절이 검사를 넘은 섹션 수와 못 넘은 섹션 수(T1-17). 이 칸 전에 만든 잡에는 없다 */
    accents?: number
    accentMisses?: number
    undrawn: string[]
    error: string | null
  }
  sections: Array<OrderedSection & { reason?: string }>
  issues: string[]
  droppedForFacts: string[]
  droppedForShots: string[]
  height: OrderResult['height']
}

export function buildSelectionRecord(input: {
  concept: Concept
  alternatives: readonly string[]
  conceptReason?: string
  palette: ColorSet
  /** 색 조합 비전 고르기 기록(palettepick 잡만) — 없으면 palette 칸이 지금 그대로다 */
  palettePick?: PalettePickRecord
  order: OrderResult
  reasons?: Readonly<Record<string, string>>
  guideline?: { persona: string; tone: string }
  hero?: TemplateLibRecord['hero']
  productFamily?: string
  pageFamily?: string
  seed?: SelectionSeed
}): TemplateLibRecord {
  const { concept, alternatives, conceptReason, palette, palettePick, order, reasons, guideline, hero, productFamily, pageFamily, seed } = input
  return {
    version: 1,
    concept: { id: concept.id, alternatives: [...alternatives], ...(conceptReason ? { reason: conceptReason } : {}) },
    palette: { id: palette.id, ...(palettePick ? { pick: palettePick } : {}) },
    fontPair: { id: concept.fontPair },
    ...(guideline ? { guideline } : {}),
    ...(productFamily ? { productFamily } : {}),
    ...(pageFamily ? { pageFamily } : {}),
    ...(seed ? { seed } : {}),
    ...(hero ? { hero } : {}),
    sections: order.sections.map((row) => ({ ...row, ...(reasons?.[row.templateId] ? { reason: reasons[row.templateId] } : {}) })),
    issues: order.issues,
    droppedForFacts: order.droppedForFacts,
    droppedForShots: order.droppedForShots,
    height: order.height,
  }
}
