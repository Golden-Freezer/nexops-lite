/**
 * D2(designcut2) 디자인 컷 구조 — 오너 피드백(R10 구디백: POINT 6개는 많다·형태가 단조롭다·후기가 없다)과 NEXFIT 흐름 비교(통합
 * 2026-10-31 배정, pdp-design-structure). 계획(designcut-plan.ts)이 D2 잡에서만 부른다. 순수·결정론 — 새 문구를 만들지 않는다.
 * - 큰 POINT는 3개(features:0~2 — 컷마다 다른 증명 목적은 이미지 쪽 shotdiv 몫). 나머지 특징은 '자세히 보기'(T11) 한 섹션에 묶고
 *   항목마다 자기 피처 컷(features:i)을 쓴다
 * - 후기(T12): 카피 reviewHighlights(#330 규칙 — 가린 작성자·요약 본문·원문 대조)를 최대 5장, 입력 평점·리뷰 수와 한 섹션에 싣는다.
 *   인용 금지 표현·정화 표지가 남은 카드는 한 번 더 뺀다. 카드가 없으면 섹션이 없다(가상 후기 금지)
 * - 형태 변형(layoutVariant): 큰 POINT는 장마다 scene → zigzag → grid → half → cards(cards는 설명 2~4문장일 때만, 아니면 grid — 채움 메시지는
 *   큰 POINT 뒤 순번으로 순환을 잇는다), 자세히 보기는 모든 항목에 컷이 있으면 zigzag 아니면 list,
 *   후기는 card. 편집기(A)가 그 이름으로 그리고 모르는 이름·칸 없음은 scene이다
 * - 흐름: 같은 템플릿·변형이 3번 이어지지 않게 셋째 섹션을 다음 다른 섹션 뒤로(마무리 T8 뒤로는 옮기지 않는다), 못 하면 첫째를 앞으로 옮긴다
 */


import { pageCompareBasis, pageCompareSource } from '../compare-basis-read'
import { fitsCompareRows, type DesigncutCompare } from '../editor/utils/sectionConverter/designCut/compareRows'
import { fitsCards } from '../editor/utils/sectionConverter/designCut/pointCards'
import { INFO_TABLE_KEY, fitsInfoRows } from '../editor/utils/sectionConverter/designCut/infoRows'
import { badgeOfSpec, fitsLayerRows, fitsPartRows } from '../editor/utils/sectionConverter/designCut/inputDevices'
import { fitsMetricRows, metricRowsOf } from '../editor/utils/sectionConverter/designCut/metricRows'
import { fitsScheduleRows } from '../editor/utils/sectionConverter/designCut/scheduleRows'
import { cleanLayers, cleanProductMetrics } from '../input-slots'
import { inputSlotsOf, pairedSwatches, ratingBarsOf } from '../input-slots-read'
import { LONG_FAQ_KEY, LONG_NOTICE_KEY } from './designcut-long'
import { hasRedactionMark } from '../reviews/review-quote-cards'
import { namedPartsOf } from '../templatelib/input-values'
import { isQuoteSafe, maskAuthor } from '../review-scrubber'
import type { CopywritingResult, DesigncutLayoutVariant, DesigncutModule, DesigncutSection, DesigncutTemplate, PdpJobRow, PdpSpecSheet } from '../pdp-state'

type Piece = Omit<DesigncutSection, 'bg' | 'plateKey' | 'plateAspect'>
type DetailItem = Extract<DesigncutModule, { type: 'M11' }>['data']['items'][number]
type ReviewCard = Extract<DesigncutModule, { type: 'M12' }>['data']['cards'][number]
type ReviewBar = NonNullable<Extract<DesigncutModule, { type: 'M12' }>['data']['bars']>[number]

/** 큰 POINT 상한 — 나머지 특징은 자세히 보기(T11)로 */
export const D2_BIG_POINTS = 3
/** 후기 카드 상한(#330) */
const REVIEW_CARDS_MAX = 5
/** 별점 분포 막대를 싣는 최소 리뷰 수(적용 D6 P1 — K7-b 별점 분포 칸과 같은 문턱 5건) */
export const REVIEW_BARS_MIN_TOTAL = 5

/**
 * 후기 별점 분포(적용 D6 P1 T1-69·T2-19) — 자사 리뷰 파일 rating_counts 원본만(C1 ratingBarsOf), 5점→1점 개수.
 * 합계가 REVIEW_BARS_MIN_TOTAL 미만이거나 파일이 없으면 null — 평점 입력 하나로 분포를 짓지 않는다
 */
export function reviewBarsOf(spec: Pick<PdpSpecSheet, 'reviewFiles'>): ReviewBar[] | null {
  const bars = ratingBarsOf(spec)
  const total = bars.reduce((sum, bar) => sum + bar.count, 0)
  return total >= REVIEW_BARS_MIN_TOTAL ? bars.map((bar) => ({ star: bar.star, count: bar.count })) : null
}
/**
 * 큰 POINT 형태 순환 — 적용 D6 P2(T2-42 절반 색 면 half, T2-16·T2-20 문장 카드 cards)로 다섯 가지. R17-L은 큰 POINT가 페이지에 6~8칸이라
 * scene → zigzag → grid만 돌면 같은 모양이 2~3번씩 되풀이됐다
 */
const POINT_VARIANTS: readonly DesigncutLayoutVariant[] = ['scene', 'zigzag', 'grid', 'half', 'cards']
/** 자세히 보기·후기 섹션 키 — ':'가 있어 조립이 기존 섹션으로 대체하지 않는다(T11은 기존 섹션이 없다) */
export const DETAIL_KEY = 'detail:more'
const DETAIL_TEXT = { eyebrow: 'DETAIL', headline: '자세히 보기', sub: null }
const REVIEW_TEXT = { eyebrow: 'REVIEW', headline: '구매 고객 후기', sub: null }
const GENERIC_AUTHOR = '구매고객'

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)

/**
 * cards 차례인데 설명이 2~4문장이 아닐 때 — 앞(half)·다음(scene) 차례와 다르고, T3a 6~7칸 페이지에서 같은 형태가 2번을 넘지 않는 모양.
 * R17-L 11잡 측정(11-03 18:5x): zigzag면 8잡이 같은 형태 3번, grid면 8칸 페이지 3잡만 3번이다(scene·half는 앞뒤 차례와 붙는다)
 */
const CARDS_FALLBACK: DesigncutLayoutVariant = 'grid'

/**
 * 큰 POINT 형태 — 순번(1부터) 순서로 돈다. cards 차례인데 설명(sub)이 2~4문장이 아니면 grid로 둔다(CARDS_FALLBACK).
 * 큰 POINT는 장 번호, 채움 메시지는 큰 POINT 수 뒤 순번이다(designcut-fill messagePieces — 페이지 T3a가 한 순환을 잇는다)
 */
export function pointVariant(order: number, sub?: string | null): DesigncutLayoutVariant {
  const variant = POINT_VARIANTS[(order - 1) % POINT_VARIANTS.length]
  return variant !== 'cards' || fitsCards(sub) ? variant : CARDS_FALLBACK
}

/**
 * 같은 뼈대 키 — 템플릿·형태 변형(spreadRuns와 같은 셈, 변형이 없으면 scene). 큰 POINT는 같은 머리에서 나오므로 null이다(세지 않는다 — K page-mix
 * skeletonOf와 같다). 계획(채움 이웃 떼기)과 측정(eval/d-repeat-metrics)이 같은 키를 쓴다
 */
export const skeletonOf = (p: Pick<DesigncutSection, 'template' | 'layoutVariant' | 'chapter'>): string | null =>
  typeof p.chapter === 'number' ? null : `${p.template}:${p.layoutVariant ?? 'scene'}`

/** 첫 화면(T1) 글 — D2는 분류 글자(eyebrow)를 빼고 후킹 문장(mainIntro.hook)을 싣는다(없으면 칸 없음) */
export function heroText(intro: NonNullable<CopywritingResult['mainIntro']>, d2: boolean): Piece['text'] {
  const headline = str(intro.benefitHeadline) ?? str(intro.title)
  const sub = str(intro.subBenefit) ?? str(intro.subtitle)
  if (!d2) return { eyebrow: str(intro.category), headline, sub }
  const hook = str(intro.hook)
  return { eyebrow: null, headline, sub, ...(hook ? { hook } : {}) }
}

/** 자세히 보기 섹션 — 첫 항목이 들어올 때 페이지에 놓이고, 뒤 항목은 같은 섹션에 이어 붙는다(제자리 변경) */
export function detailPiece(role: string): Piece {
  return {
    key: DETAIL_KEY,
    role,
    template: 'T11',
    chapter: null,
    productImageKey: null,
    productAlpha: false,
    text: { ...DETAIL_TEXT },
    modules: [{ type: 'M11', data: { items: [] } }],
    layoutVariant: 'list',
  }
}

export function addDetailItem(piece: Piece, item: DetailItem): void {
  const detail = piece.modules.find((m): m is Extract<DesigncutModule, { type: 'M11' }> => m.type === 'M11')
  if (!detail) return
  detail.data.items.push(item)
  piece.layoutVariant = detail.data.items.every((i) => i.imageKey) ? 'zigzag' : 'list'
}

/** 후기 카드 — 카피 reviewHighlights에서 글이 있고 인용 안전·정화 표지 없는 것만, 작성자는 가린 꼴(없으면 '구매고객') */
export function reviewCards(copy: CopywritingResult): ReviewCard[] {
  const cards: ReviewCard[] = []
  for (const h of copy.reviewHighlights ?? []) {
    const text = str(h?.text)
    if (!text || !isQuoteSafe(text) || hasRedactionMark(text)) continue
    const author = str(h.author)
    const rating = typeof h.rating === 'number' && h.rating >= 1 && h.rating <= 5 ? h.rating : null
    cards.push({
      text,
      author: !author || author === GENERIC_AUTHOR ? GENERIC_AUTHOR : maskAuthor(author),
      rating,
      ...(str(h.month) ? { month: str(h.month)! } : {}),
      ...(h.summary === true ? { summary: true as const } : {}),
    })
    if (cards.length >= REVIEW_CARDS_MAX) break
  }
  return cards
}

/** 후기 섹션(T12) — 카드가 없으면 null */
export function reviewPiece(job: PdpJobRow, key: string, role: string): Piece | null {
  const cards = reviewCards(job.copy_sections.final ?? {})
  if (cards.length === 0) return null
  const rating = job.spec_sheet.rating
  const count = job.spec_sheet.reviewCount
  const bars = reviewBarsOf(job.spec_sheet)
  return {
    key,
    role,
    template: 'T12',
    chapter: null,
    productImageKey: null,
    productAlpha: false,
    text: { ...REVIEW_TEXT },
    modules: [
      {
        type: 'M12',
        data: {
          cards,
          rating: typeof rating === 'number' && rating >= 1 && rating <= 5 ? rating : null,
          count: typeof count === 'number' && Number.isInteger(count) && count > 0 ? count : null,
          ...(bars ? { bars } : {}),
        },
      },
    ],
    layoutVariant: 'card',
  }
}

/** 옵션 칩 형태 통일 — 모든 옵션에 실물 사진이 있으면 사진 카드, 하나라도 없으면 모두 이름만(사진·이름이 섞이지 않게) */
export function unifyChips<T extends { image?: string | null }>(chips: T[]): T[] {
  return chips.every((c) => c.image) ? chips : chips.map((c) => ({ ...c, image: null }))
}

/**
 * 같은 템플릿·변형 3연속 풀기(제자리 변경) — pageOrder(기존 빌더 섹션 포함)로 이웃을 보고, 셋째를 다음 다른 섹션 뒤로 옮긴다. 다음 다른
 * 섹션이 마무리(T8)뿐이면 첫째를 앞 다른 섹션 앞으로 옮긴다. pieces는 pageOrder 순서로 다시 맞춘다
 */
export function spreadRuns(pieces: Piece[], pageOrder: string[]): void {
  const byKey = new Map(pieces.map((p) => [p.key, p]))
  const sig = (key: string) => {
    const p = byKey.get(key)
    return p ? `${p.template}:${p.layoutVariant ?? 'scene'}` : `kept:${key}`
  }
  const isCta = (key: string) => byKey.get(key)?.template === 'T8'
  const move = (from: number, to: number) => {
    const [key] = pageOrder.splice(from, 1)
    pageOrder.splice(to, 0, key)
  }
  for (let guard = 0; guard < pageOrder.length * pageOrder.length; guard++) {
    const i = pageOrder.findIndex((k, n) => n >= 2 && byKey.has(k) && sig(k) === sig(pageOrder[n - 1]) && sig(k) === sig(pageOrder[n - 2]))
    if (i === -1) break
    const run = sig(pageOrder[i])
    const after = pageOrder.findIndex((k, n) => n > i && sig(k) !== run && !isCta(k))
    if (after !== -1) {
      move(i, after)
      continue
    }
    let before = i - 3
    while (before >= 0 && sig(pageOrder[before]) === run) before--
    if (before < 0) break
    move(i - 2, before)
  }
  const index = new Map(pageOrder.map((k, n) => [k, n]))
  pieces.sort((a, b) => (index.get(a.key) ?? 0) - (index.get(b.key) ?? 0))
}

/** 해결 안내 섹션 키 — 계획 칸(T4)이든 기존 빌더 섹션(kept)이든 이 키다 */
const SOLUTION_KEY = 'solution_guide'

/**
 * 구역 연결 표식 자리(적용 D6 P5 R-W9·T2-13, 통합 11-03 21:4x) — 페이지 순서에서 고민(T2) 바로 다음 칸이 해결 안내(solution_guide — 기존
 * 빌더 섹션 포함) 또는 첫 큰 POINT(가장 작은 장 번호)면 그 T2에 linkBelow를 단다(고민 → 해결로 넘어가는 자리). 페이지당 1개(상한 1).
 * 그 밖의 칸이 바로 다음이면 그대로 돌려준다
 */
export function markZoneLink<T extends Pick<DesigncutSection, 'key' | 'template' | 'chapter'>>(sections: T[], pageOrder: readonly string[]): T[] {
  const byKey = new Map(sections.map((s) => [s.key, s]))
  const at = pageOrder.findIndex((k) => byKey.get(k)?.template === 'T2')
  if (at === -1) return sections
  const nextKey = pageOrder[at + 1] ?? ''
  const next = byKey.get(nextKey)
  const chapters = sections.flatMap((s) => (s.chapter === null ? [] : [s.chapter]))
  const toSolution = nextKey.split(':')[0] === SOLUTION_KEY
  const toFirstPoint = next !== undefined && next.chapter !== null && next.chapter === Math.min(...chapters)
  if (!toSolution && !toFirstPoint) return sections
  return sections.map((s) => (s.key === pageOrder[at] ? { ...s, linkBelow: true as const } : s))
}

/**
 * 상품 정보 좌우 줄 표 자리(적용 D6 P6 T1-64·T2-26·T2-27, 통합 11-03 22:1x) — 상품 정보 표(T9 long:info)의 행이 모두 좌우 줄 조건(이름 한 줄·
 * 12자·이름 칸 240, 값 40자 이하 — 편집기 infoRows fitsInfoRows와 같은 함수)에 맞으면 tableShape 'rows'를 단다. 페이지 순서에서 그 앞에 다른
 * 사실 표(T9 질문 long:faq·주의 보관 long:notice)가 있으면 두 번째 사실 표라 tableBand(짙은 머리 띠)도 단다. 질문·주의 보관·구매 전 확인 표는
 * 그대로다(질문·답은 40자를 넘고, 주의 표는 경고 표식 열이 있고, 구매 전 확인 표는 계획 밖). 맞지 않으면 그대로 돌려준다
 */
export function markInfoTable<T extends Pick<DesigncutSection, 'key' | 'template' | 'modules'>>(sections: T[], pageOrder: readonly string[]): T[] {
  const info = sections.find((s) => s.key === INFO_TABLE_KEY && s.template === 'T9')
  const rows = info?.modules.flatMap((m) => (m.type === 'M9' ? [m.data.rows] : []))[0] ?? []
  if (!info || !fitsInfoRows(rows)) return sections
  // 계획 사실 표 키 — designcut-long과 서로 부르는 모듈이라 함수 안에서 읽는다
  const factTables = new Set(sections.filter((s) => s.template === 'T9' && (s.key === LONG_FAQ_KEY || s.key === LONG_NOTICE_KEY)).map((s) => s.key))
  const at = pageOrder.indexOf(info.key)
  const second = at > 0 && pageOrder.slice(0, at).some((k) => factTables.has(k))
  return sections.map((s) => (s === info ? { ...s, tableShape: 'rows' as const, ...(second ? { tableBand: true as const } : {}) } : s))
}

/**
 * 사이즈 칸 수치 줄 자리(적용 D6 P7 T1-63·T2-22, 통합 11-03 23:42) — 입력 칸 제품 수치(productMetrics)가 있을 때만, 규제 표현 거르기를 지난 값의
 * 앞 3줄이 모두 칸(이름 한 줄·12자·240 폭, 값이 480에 장면 H2 한 줄 — 편집기 metricRows fitsMetricRows와 같은 함수)에 들면 사이즈 칸(T6)에
 * metricRows를 단다. 입력이 없을 때 inputSlotsOf가 대신 읽는 크기 글의 이름 붙은 값은 쓰지 않는다(이미 사이즈 캡션·상품 정보 표 두 곳 — 세 번째
 * 반복). 사이즈 칸이 없거나 하나라도 안 맞으면 그대로 돌려준다
 */
export function markMetricRows<T extends Pick<DesigncutSection, 'template'>>(sections: T[], spec: PdpSpecSheet): T[] {
  if (cleanProductMetrics(spec.productMetrics).length === 0) return sections
  const size = sections.find((s) => s.template === 'T6')
  const rows = metricRowsOf(inputSlotsOf(spec).metrics)
  if (!size || !fitsMetricRows(rows)) return sections
  return sections.map((s) => (s === size ? { ...s, metricRows: rows } : s))
}

/** 비교 줄 값(C5 ②) — 비교 입력이 없는 잡은 읽지 않는다. 거르고 남은 행이 없거나 하나라도 칸에 안 들면 null(일부만 싣지 않는다) */
function compareOfSpec(spec: PdpSpecSheet): DesigncutCompare | null {
  if (!Array.isArray(spec.compareBasis) || spec.compareBasis.length === 0) return null
  const rows = pageCompareBasis(spec)
  const source = pageCompareSource(spec)
  const compare: DesigncutCompare = { rows: rows.map((row) => ({ label: row.label, ours: row.ours, ...(row.other ? { other: row.other } : {}) })), ...(source ? { source } : {}) }
  return rows.length > 0 && fitsCompareRows(compare) ? compare : null
}

/**
 * 사용 방법 칸 주기 줄 자리(적용 C5 ④ R-D3, 통합 11-04 01:14 ④) — 입력 칸 주기(schedule)가 있을 때만. 효과 시간표·규제 표현 줄을 뺀 값(inputSlotsOf.schedule)이
 * 2~6줄이고 모두 칸에 들면(편집기 scheduleRows fitsScheduleRows와 같은 함수) 사용 방법 칸(T5)에 scheduleRows를 단다. 사용 방법 칸이 없거나 하나라도 안 맞으면 그대로 돌려준다
 */
export function markScheduleRows<T extends Pick<DesigncutSection, 'template'>>(sections: T[], spec: PdpSpecSheet): T[] {
  if (spec.schedule === undefined) return sections
  const howto = sections.find((s) => s.template === 'T5')
  const rows = inputSlotsOf(spec).schedule
  if (!howto || !fitsScheduleRows(rows)) return sections
  return sections.map((s) => (s === howto ? { ...s, scheduleRows: rows.map((row) => ({ label: row.label, period: row.period })) } : s))
}

/**
 * 옵션 칸 색 점 자리(적용 C5 ③ T1-99, 통합 11-04 01:14 ①·03:23 ③) — 입력 칸 견본(swatches)이 있을 때만. 옵션 칸(T7) 칩 이름과 견본을 짝지어
 * (pairedSwatches — K 견본 칩과 같은 함수, 옵션 순서대로 이름 맞는 견본만) **모든 옵션이 짝일 때만**(2개 이상) T7에 swatches를 단다 — 일부 옵션에만 점이
 * 있으면 그 옵션만 골라 둔 표시처럼 읽혀 어색하다(통합 05:3x 조건 ⓑ, render 표본 P01·P10 7옵션 중 2점 눈 확인). 색은 입력 #RRGGBB 그대로이고
 * 칩의 colorByName(이름에서 지은 색)은 쓰지 않는다. 옵션 칸이 없거나 짝 없는 옵션이 하나라도 있으면 그대로 돌려준다
 */
export function markSwatches<T extends Pick<DesigncutSection, 'template' | 'modules'>>(sections: T[], spec: PdpSpecSheet): T[] {
  if (spec.swatches === undefined) return sections
  const option = sections.find((s) => s.template === 'T7')
  if (!option) return sections
  const labels = option.modules.flatMap((m) => (m.type === 'M8' ? m.data.chips.map((chip) => chip.label) : []))
  const pairs = pairedSwatches(inputSlotsOf(spec).swatches, labels)
  if (labels.length === 0 || pairs.length !== labels.length) return sections
  return sections.map((s) => (s === option ? { ...s, swatches: pairs.map((pair) => ({ option: pair.option ?? pair.name, hex: pair.hex })) } : s))
}

/**
 * 입력 장치 자리(적용 D6 R-D1·T1-85, 통합 11-04 00:4x) — 입력이 있을 때만. ① 원형 배지: 인증 첫 이름 → 입력 평점(리뷰 수 있을 때) 중 원 안에 드는 첫 값을
 * 마무리(T8)에 badge로 단다(구성 수량은 D에서 쓰지 않는다 — 이미 문서 두 곳 이상). ② 층 띠: 입력 층(inputSlotsOf — 정리·규제 표현 거르기 지난 값)
 * 2~5개가 모두 칸에 들면 자세히 보기(T11)에 layers를 단다. ③ 구성품 펼침(T1-83): 입력 부속 이름(inputSlotsOf.parts — K 구성품 칸과 같은 읽기)
 * 2~6개가 모두 한 줄에 들면 사이즈 칸(T6)에 parts를 단다. ④ 비교 줄(C5 ②): 입력 비교 근거(compare-basis-read — 깎아내리기·타사 표식·규제 표현을
 * 거른 행)가 모두 칸에 들면 상품 정보 표(T9 long:info)에 compare를 단다. 자리 섹션이 없거나 안 맞으면 그 장치는 칸이 없다
 */
export function markInputDevices<T extends Pick<DesigncutSection, 'template'> & { key?: string }>(sections: T[], spec: PdpSpecSheet): T[] {
  const badge = badgeOfSpec(spec)
  // 층·구성품 입력이 없는 잡은 입력 칸 읽기를 부르지 않는다
  const slots = cleanLayers(spec.layers).length > 0 || namedPartsOf(spec).length > 0 ? inputSlotsOf(spec) : null
  const layers = slots && fitsLayerRows(slots.layers) ? slots.layers : null
  const parts = slots && fitsPartRows(slots.parts) ? slots.parts : null
  const marks: Array<[DesigncutTemplate, Pick<DesigncutSection, 'badge' | 'layers' | 'parts'> | null]> = [
    ['T8', badge ? { badge } : null],
    ['T11', layers ? { layers } : null],
    ['T6', parts ? { parts } : null],
  ]
  // 자리마다 첫 섹션 하나에만 단다
  const placed = new Map<T, Pick<DesigncutSection, 'badge' | 'layers' | 'parts' | 'compare'>>()
  for (const [template, mark] of marks) {
    const at = mark ? sections.find((s) => s.template === template) : undefined
    if (at && mark) placed.set(at, mark)
  }
  // ④ 기존 제품과 비교 줄(C5 ② R-D2 D): 입력 비교 근거(거른 행)가 있고 모두 칸에 들면 상품 정보 표(T9 long:info)에 단다 — 비교 입력이 없는 잡은 읽지 않는다
  const compare = compareOfSpec(spec)
  const info = compare ? sections.find((s) => s.template === 'T9' && s.key === INFO_TABLE_KEY) : undefined
  if (info && compare) placed.set(info, { ...(placed.get(info) ?? {}), compare })
  return placed.size === 0 ? sections : sections.map((s) => (placed.has(s) ? { ...s, ...placed.get(s) } : s))
}
