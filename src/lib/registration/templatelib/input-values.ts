/**
 * K 라인 입력값 칸(M5, 15_TEMPLATE_LINE §4) — 템플릿이 source:'input'으로 적은 칸을 잡의 실제 입력에서 채운다. 카피 콜에 보이지 않는 칸이다.
 * 표는 productInfoRows, 후기는 reviewCards, 옵션은 optionChips, 치수는 parseAxisDims를 쓴다. D2와 같은 함수라 같은 사실이 나온다.
 * 값이 없으면 칸을 비운다. 지어내지 않고, 필수 칸이 비면 엔진이 다음 후보로 넘어간다.
 * 후기 글이 칸 상한을 넘으면 자르지 않고 그 후기를 건너뛴다. 남의 말을 잘라 뜻을 바꾸지 않기 위해서다. 순수.
 */

import { isFactClaimSafe } from '../eval/claim-lexicon'
import { demoPhotoUrls } from '../source-photo-roles'
import { DEMO_PHOTOS_INPUT } from './template-types'
import { cleanLayers, cleanNoticeItems, cleanSchedule, cleanSizeMatrix, cleanSwatches, cleanUsageSteps, pairedSwatches, type NoticeItem, type NoticeKind, type ScheduleItem } from '../input-slots'
import { careRows, readLongRecord, REVIEW_ANSWER_SOURCE } from '../long-sections'
import { isRealOptionPhoto } from '../options/option-photo-guard'
import { classifyOptionLabel, isOptionSpec } from '../options/option-spec'
import { optionChips, parseAxisDims } from '../internalized/designcut-inputs'
import { optionSpecOf } from '../internalized/persuasion-signals'
import { hasEnrichmentFeature } from '../enrichment-switch'
import { specOptionLabels } from './spec-fixed'
import { reviewCards } from '../internalized/designcut-structure'
import type { CopywritingResult, PdpJobRow, PdpSpecSheet } from '../pdp-state'
import { productInfoRows, REQUIRED_INFO_LABELS, type InfoRow } from '../product-info-rows'
import { pageCompareBasis } from '../compare-basis-read'
import { factTiles } from './info-cells'
import { scaleRows } from './scale-set'
import { COMPARE_BASIS, COMPARE_INPUT_PREFIX, COMPARE_ITEM_INPUT, COMPARE_ONE_BASE_INPUT, COMPARE_ONE_OURS_INPUT, COMPARE_ROWS_INPUT, FAQ_ANSWER_INPUT, FAQ_QUESTION_INPUT, FAQ_REVIEWS_INPUT, FAQ_SOURCE_INPUT, INGREDIENT_ITEMS_INPUT, INGREDIENT_NAME_INPUT, INGREDIENT_NAMES_INPUT, NOTICE_ICON_INPUT, NOTICE_ITEMS_INPUT, NOTICE_KIND_INPUT, NOTICE_TEXT_INPUT, PART_NAME_INPUT, PARTS_ITEMS_INPUT, RATING_BARS_INPUT, RATING_BARS_MIN_TOTAL, OPTION_IMAGES_INPUT, OPTION_LINEUP_INPUT, OPTION_NAME_INPUT, OPTION_SWATCH_HEX_INPUT, OPTION_SWATCH_NAME_INPUT, OPTION_SWATCHES_INPUT, OPTION_BAND_HEX_INPUT, OPTION_BAND_NAME_INPUT, OPTION_BANDS_INPUT, POINT_STEPS_INPUT, POINT_STEPS_NAME, SCHEDULE_LABEL_INPUT, SCHEDULE_PERIOD_INPUT, SCHEDULE_ROWS_INPUT, SIZE_ROW_LABEL_INPUT, SIZE_ROW_VALUE_INPUT, SIZE_ROWS_INPUT, SIZE_SCALE_HEIGHT_INPUT, SIZE_SCALE_INPUT, SIZE_SCALE_LABEL_INPUT, SIZE_SCALE_WIDTH_INPUT, SPEC_FACT_ICON_INPUT, SPEC_FACT_LABEL_INPUT, SPEC_FACT_VALUE_INPUT, SPEC_FACTS_INPUT, SPEC_ROWS_INPUT, SPEC_SPECIAL_INPUT, USAGE_STEP_NOTE_INPUT, USAGE_STEP_TITLE_INPUT, USAGE_STEPS_INPUT, type FlowNode, type ListSlot, type SlotDef, type SlotItem, type SlotValue, type SlotValues, type Template, type TextSlot } from './template-types'

/** 칸을 채우는 재료 — 잡에서 한 번 읽어 섹션마다 쓴다(lineInputsOf) */
export interface LineInputs {
  spec: PdpSpecSheet
  cards: ReadonlyArray<{ text: string; author: string; rating: number | null }>
  options: ReadonlyArray<{ label: string; image: string | null }>
  /** 판매자 시험 사진(demoshot 잡만, J57) — 원천 사진 역할 demo 주소(원천 순서, 실물 주소만). 없으면 시험 사진 칸 템플릿을 고르지 않는다 */
  demoPhotos?: readonly string[]
  /** 후기 질문 FAQ(K4 ②) — 설계 단계 검사 통과분(답은 자사 후기 원문). 없으면 후기 질문 FAQ 템플릿을 고르지 않는다 */
  faqs?: ReadonlyArray<{ question: string; answer: string }>
  /** 옵션 사진 색(partsbands 잡이고 images 단계가 잰 뒤만, J54) — 옵션 이름과 잰 색. 없으면 옵션 색 띠 템플릿을 고르지 않는다 */
  optionColors?: ReadonlyArray<{ label: string; hex: string }>
}

/**
 * 옵션은 optionChips(D2와 같은 함수)가 정한다 — 상한 자르기, 실물(isRealOptionPhoto — 공개 http(s)이고 자리표시·생성 실패 URL 아님)만 사진으로 보기,
 * 하나라도 사진이 없으면 모두 이름만(unifyChips)이 그 안에 있다(D2 ③ #643). 지어낸 옵션 사진이 격자·라인업에 실리지 않는다(적용 K6 ①).
 * spec 정본 고정(specfixed 잡만, J23)은 등록 옵션 구조(변형 2개 이상)가 없을 때 카피 칸 대신 판매자 입력 옵션 이름을 이름만으로 쓴다(spec-fixed.ts)
 */
export function lineInputsOf(job: Pick<PdpJobRow, 'spec_sheet' | 'analysis' | 'copy_sections'> & Partial<Pick<PdpJobRow, 'section_plan' | 'source_images'>>): LineInputs {
  const copy: CopywritingResult = job.copy_sections.final ?? {}
  const specLabels = specChipLabelsOf(job)
  const chips = (
    specLabels.length > 0
      ? specLabels.map((label) => ({ label, image: null }))
      : optionChips(job as PdpJobRow, Array.isArray(copy.options) ? copy.options : undefined, true)
  ) as ReadonlyArray<{ label?: unknown; image?: unknown }>
  const cards = reviewCards(copy)
  const faqs = reviewFaqsOf(readLongRecord(job.section_plan?.long)?.reviewFaq ?? [], cards, job.spec_sheet)
  return {
    spec: job.spec_sheet,
    cards,
    ...demoPhotosInputOf(job),
    options: chips.flatMap((chip) => (typeof chip?.label === 'string' && chip.label ? [{ label: chip.label, image: typeof chip.image === 'string' ? chip.image : null }] : [])),
    ...(faqs.length > 0 ? { faqs } : {}),
    ...optionColorsInputOf(job),
  }
}

/** 옵션 사진 색 입력(J54) — partsbands 잡이고 잰 기록이 있을 때만. 꺼진 잡·기록 없는 잡은 빈 객체라 입력이 지금과 같다 */
function optionColorsInputOf(job: Pick<PdpJobRow, 'analysis'> & Partial<Pick<PdpJobRow, 'section_plan'>>): Pick<LineInputs, 'optionColors'> {
  const record = job.section_plan?.option_colors
  if (!hasEnrichmentFeature(job.analysis, 'partsbands') || !record || !('colors' in record)) return {}
  return { optionColors: record.colors.map(({ label, hex }) => ({ label, hex })) }
}

/**
 * spec 정본 옵션 이름(specfixed 잡이고 등록 옵션 구조 칩이 아닐 때만) — 아니면 빈 목록이라 옵션 칩은 지금 길(optionChips)을 그대로 탄다.
 * 등록 옵션 구조가 칩을 정하는 잡(optionSpecOf — options 기록·변형 2개 이상)은 지금처럼 그 칩(실물 사진 포함)이다
 */
function specChipLabelsOf(job: Pick<PdpJobRow, 'spec_sheet' | 'analysis'>): string[] {
  if (!hasEnrichmentFeature(job.analysis, 'specfixed') || optionSpecOf(job.spec_sheet, job.analysis)) return []
  return specOptionLabels(job.spec_sheet)
}

/** 인용 대조용 — 공백·따옴표·문장부호를 뺀다(후기 카드 글은 따옴표가 붙어 올 수 있다) */
const squashQuote = (text: string) => text.replace(/[\s"'“”‘’.,!?~…·\-—()]/g, '')
/** 이보다 짧은 인용은 겹침으로 보지 않는다 — 짧은 말은 여러 후기에 우연히 들어 있다 */
const QUOTE_OVERLAP_MIN = 6

/**
 * 후기 질문 FAQ 항목(K4 ②) — 검사 통과분 가운데 규제 표현이 없고(D 구매 전 질문 표와 같은 claimSafe 기준), 페이지 후기 카드와 같은 인용이 아닌 것.
 * 후기 카드가 그 인용을 쓰면 FAQ에서 뺀다(같은 후기를 두 번 싣지 않는다 — 한쪽만). 같은 답은 한 번이다
 */
export function reviewFaqsOf(items: ReadonlyArray<{ question: string; answer: string }>, cards: LineInputs['cards'], spec: Pick<PdpSpecSheet, 'certificationInfo'>): Array<{ question: string; answer: string }> {
  const shown = cards.map((card) => squashQuote(card.text)).filter((text) => text.length >= QUOTE_OVERLAP_MIN)
  const seen = new Set<string>()
  return items.flatMap((item) => {
    const question = typeof item?.question === 'string' ? item.question.trim() : ''
    const answer = typeof item?.answer === 'string' ? item.answer.trim() : ''
    const key = squashQuote(answer)
    if (!question || key.length < QUOTE_OVERLAP_MIN || seen.has(key)) return []
    if (!isFactClaimSafe(`${question} ${answer}`, spec.certificationInfo)) return []
    if (shown.some((text) => text.includes(key) || key.includes(text))) return []
    seen.add(key)
    return [{ question, answer }]
  })
}

const charCount = (value: string) => value.replace(/\s+/g, '').length
const fits = (value: string, def: Pick<TextSlot, 'maxChars'> | undefined) => !def || def.maxChars === undefined || charCount(value) <= def.maxChars
const isRequiredRow = (row: InfoRow) => (REQUIRED_INFO_LABELS as readonly string[]).includes(row.label)

/** 후기 수 표기 — 숫자만 두면 무엇을 세었는지 알 수 없다 */
const countLabel = (count: number) => `후기 ${count.toLocaleString('en-US')}건`

/** 평점·후기 수 — 입력값을 먼저, 없으면 자사 리뷰 파일 집계. evidenceOf의 rating 근거와 같은 기준이다 */
function ratingOf(spec: PdpSpecSheet): { rating: string; count: string } | null {
  if (Number(spec.rating) > 0 && Number(spec.reviewCount) > 0) return { rating: Number(spec.rating).toFixed(1), count: countLabel(Number(spec.reviewCount)) }
  const counts = Object.entries(spec.reviewFiles?.own?.stats?.rating_counts ?? {}).map(([star, n]) => [Number(star), Number(n)] as const)
  const total = counts.reduce((sum, [, n]) => sum + n, 0)
  if (total <= 0) return null
  return { rating: (counts.reduce((sum, [star, n]) => sum + star * n, 0) / total).toFixed(1), count: countLabel(total) }
}

/**
 * 별점 분포 줄(적용 K7-b) — 자사 리뷰 파일 rating_counts 원본만 5점부터 1점까지. 합계가 RATING_BARS_MIN_TOTAL 미만이면 빈 목록이라 칸이 안 나온다.
 * 퍼센트·막대 폭은 share로 그린다. 입력 평점(spec.rating)만 있고 분포가 없으면 만들지 않는다(근거 없는 기본값 금지, #289)
 */
export function ratingBarItems(spec: Pick<PdpSpecSheet, 'reviewFiles'>): SlotItem[] {
  const counts = (spec.reviewFiles?.own?.stats?.rating_counts ?? {}) as Record<string, unknown>
  const countOf = (star: number) => {
    const n = Number(counts[String(star)])
    return Number.isInteger(n) && n > 0 ? n : 0
  }
  const stars = [5, 4, 3, 2, 1]
  const total = stars.reduce((sum, star) => sum + countOf(star), 0)
  if (total < RATING_BARS_MIN_TOTAL) return []
  return stars.map((star) => ({ star: String(star), count: String(countOf(star)), share: String(countOf(star) / total) }))
}

/** 치수 표기 — 축 값이 없으면 null(만들지 않는다) */
/** 치수 도식 칸 — 방향이 확실한 치수만 적는다(R15 P09: '고리 21.4cm'가 가로로 적혔다). 모르면 비우고, 값은 표의 사이즈 행에 입력 글 그대로 남는다 */
const AXIS_NAME = { w: '가로', h: '세로', d: '깊이' } as const
function sizeOf(spec: PdpSpecSheet, axis: 'w' | 'h' | 'd'): string | null {
  const dim = parseAxisDims(typeof spec.size === 'string' ? spec.size : undefined).find((d) => d.axis === axis)
  return dim ? `${AXIS_NAME[axis]} ${dim.value}${dim.unit}` : null
}

/** 방향이 확실한 치수 입력이 있는가 — 있으면 끝자리 표에 치수 도식이 들어간다. 방향을 모르는 값은 표의 사이즈 행에만 있다 */
export const hasSizeDiagram = (inputs: Pick<LineInputs, 'spec'>): boolean => sizeOf(inputs.spec, 'w') !== null || sizeOf(inputs.spec, 'h') !== null

const METRIC = /([가-힣]+)\s*:?\s*(\d+(?:\.\d+)?)\s*(mm|cm|kg|ml|g|m|L)(?![a-zA-Z])/g
/** 값 앞에 붙는 말이지 수치의 이름이 아니다 — '약 30cm'를 '약' 수치로 그리지 않는다 */
const NOT_METRIC_NAME: ReadonlySet<string> = new Set(['약', '총', '최대', '최소', '대략'])

/**
 * 제품 수치 — 크기 입력에 이름이 적힌 값만('길이 7.3cm', '지름 50mm'). 이름 없는 값('5cm 원형')은 지어내지 않고 뺀다.
 * 방향이 확실한 치수가 있으면 끝자리 치수 표와 상품 정보 표에 이미 실려 비운다(같은 사실 3곳 금지, 통합 결정 11-01).
 */
export function metricsOf(spec: PdpSpecSheet): Array<{ name: string; value: string; unit: string }> {
  if (typeof spec.size !== 'string' || parseAxisDims(spec.size).length > 0) return []
  return [...spec.size.matchAll(METRIC)].filter((match) => !NOT_METRIC_NAME.has(match[1])).map((match) => ({ name: match[1], value: match[2], unit: match[3] }))
}

/** 수량 표기 — 입력의 구성 칸이 숫자+개일 때만 */
function quantityOf(spec: PdpSpecSheet): string | null {
  const row = (spec.extraSpecs ?? []).find((e) => e.key === '구성')
  const match = /^\s*(\d+)\s*(개|매|장|입|세트)/.exec(row?.value ?? '')
  return match ? `${match[1]}${match[2]}` : null
}

/** 수량 컷이 수를 적는 상한(적용 K6 R-B7) — 이보다 많으면 지금 묶음 문장 그대로다 */
export const SHOT_COUNT_MAX = 6

/** 수량 컷에 적을 수 — exact는 구성 칸 그대로, max는 옵션 수량 가운데 가장 큰 수(옵션마다 수가 달라 하나로 못 정한다) */
export type ShotQuantity = { exact: number; noun: string } | { max: number; noun: string }

/** 수량 단위 → 영어 낱말 — 세트·쌍은 그 낱말, 나머지는 낱개 */
function countNoun(value: string, count: number): string {
  if (/세트|셋트|set/i.test(value)) return count === 1 ? 'set' : 'sets'
  if (/쌍|켤레/.test(value)) return count === 1 ? 'pair' : 'pairs'
  return count === 1 ? 'piece' : 'pieces'
}

/** 옵션 수량 값 — 구조화된 옵션(optionSpec)의 수량 축, 없으면 옵션 이름(colorOptions)에서 수량 조각 */
function optionQuantities(spec: PdpSpecSheet): string[] {
  if (isOptionSpec(spec.optionSpec)) return spec.optionSpec.axes.filter((axis) => axis.kind === 'quantity').flatMap((axis) => axis.values)
  return (spec.colorOptions ?? []).flatMap((label) => (typeof label === 'string' ? (classifyOptionLabel(label).quantity ?? []) : []))
}

/**
 * 수량 컷에 적을 수(적용 K6 R-B7, 통합 11-03 13:3x (나)) — R P10 수량 사진이 입력 1~6개와 달리 8개였다.
 * 구성 칸(quantityOf)이 있으면 그 수가 6 이하일 때 정확히 그 수, 구성 칸이 없으면 옵션 수량 가운데 가장 큰 수가 6 이하일 때 그 수 이하다.
 * 둘 다 있으면 구성 칸이 이긴다. 7 이상이거나 수가 없으면 null(지금 문장 그대로)
 */
export function shotQuantityOf(spec: PdpSpecSheet): ShotQuantity | null {
  const set = quantityOf(spec)
  const countOf = (value: string) => Number(/\d+/.exec(value)?.[0] ?? 0)
  if (set) {
    const exact = countOf(set)
    return exact >= 1 && exact <= SHOT_COUNT_MAX ? { exact, noun: countNoun(set, exact) } : null
  }
  const values = optionQuantities(spec).filter((value) => countOf(value) >= 1)
  if (values.length === 0) return null
  const top = values.reduce((a, b) => (countOf(b) > countOf(a) ? b : a))
  const max = countOf(top)
  return max <= SHOT_COUNT_MAX ? { max, noun: countNoun(top, max) } : null
}

/**
 * 재료 이름을 적는 입력 칸(extraSpecs 키, 공백 뺌) — '소재'는 제품 자체의 재질이라 넣지 않고, '전성분'은 규정 표시 전체라 소품 재료 이름으로 쓰지 않는다
 */
const INGREDIENT_KEYS: ReadonlySet<string> = new Set(['원재료', '원재료명', '원재료명및함량', '재료', '주재료', '원료', '주원료', '성분', '주성분', '주요성분'])
/** 이름이 아니라 다른 곳을 가리키는 값 — '상세페이지 참조' 같은 고시 문구를 재료로 읽지 않는다 */
const NOT_INGREDIENT_NAME = /상세|참조|별도|표기|라벨|없음|해당|확인/
const INGREDIENT_NAME_MAX = 20

/**
 * 입력에 적힌 재료 이름(오너 11-01 '입력 이름만') — 없으면 빈 목록이고 짓지 않는다. 괄호 안 함량·원산지는 이름이 아니라 뺀다.
 * 재료 사진 목적(`ingredient`)은 이 목록이 있을 때만 열린다
 */
export function namedIngredientsOf(spec: Pick<PdpSpecSheet, 'extraSpecs'>): string[] {
  return [...new Set(namesIn(spec, INGREDIENT_KEYS))]
}

/** 성분·원료 섹션(적용 K3 R-W8)을 여는 이름 수 — 이름 하나는 목록이 아니다. 근거 ingredient와 템플릿 목록 최소 수가 이 값이다 */
export const INGREDIENT_MIN = 2
/** 구성품 목록을 여는 이름 수(적용 K7-c (나) T1-83 K, D6 구성품 펼침 T1-83 D와 공용) — 이름 하나는 구성이 아니다 */
export const PARTS_MIN = 2

/**
 * 성분·원료 섹션에 싣는 재료 이름 — 입력 이름 그대로(inputSlotsOf.ingredients와 같은 규제 표현 거르기), 효능·함량은 싣지 않는다.
 * 칸 상한보다 이름이 많거나 칸보다 긴 이름이 하나라도 있으면 목록 전체를 비운다 — 일부만 실으면 그게 전부인 것처럼 읽힌다(자르지 않는다). 필수 목록이라 그 템플릿을 고르지 않는다
 */
function ingredientNames(inputs: LineInputs, max: number, fitsSlot: (name: string) => boolean): string[] {
  const names = namedIngredientsOf(inputs.spec).filter((name) => isFactClaimSafe(name, inputs.spec.certificationInfo))
  return names.length <= max && names.every(fitsSlot) ? names : []
}

function namesIn(spec: Pick<PdpSpecSheet, 'extraSpecs'>, keys: ReadonlySet<string>, clean: (name: string) => string = (name) => name): string[] {
  return (Array.isArray(spec.extraSpecs) ? spec.extraSpecs : [])
    .filter((row) => typeof row?.key === 'string' && typeof row?.value === 'string' && keys.has(row.key.replace(/\s+/g, '')))
    .flatMap((row) => row.value.replace(/\([^)]*\)/g, '').split(/[,，、·/]/))
    .map((name) => clean(name.trim()))
    .filter((name) => name.length > 0 && name.length <= INGREDIENT_NAME_MAX && /[가-힣a-zA-Z]/.test(name) && !NOT_INGREDIENT_NAME.test(name))
}

/** 부속 이름을 적는 입력 칸 — '구성'은 수량과 본품이 함께 적혀 있어 읽지 않는다(P06 '슬리커 브러쉬·미세빗', P02 '20개') */
const PART_KEYS: ReadonlySet<string> = new Set(['구성품', '구성품목', '부속', '부속품'])

/** 입력에 적힌 부속 이름 — K 세트 소품의 첫 후보다(A4 5절). 없으면 빈 목록이고 짓지 않는다. '2개'처럼 수량만 있는 값은 이름이 아니다 */
export function namedPartsOf(spec: Pick<PdpSpecSheet, 'extraSpecs'>): string[] {
  return [...new Set(namesIn(spec, PART_KEYS, (name) => name.replace(/\s*포함$/, '')).filter((name) => !/^\d/.test(name)))]
}

/** 주의·보관 줄 종류 — 추가 스펙 관리 행 이름으로 정한다(D T9와 K notice가 같은 값) */
export function noticeKindOf(label: string): NoticeKind {
  if (/보관/.test(label)) return 'storage'
  if (/관리|세탁|세척|손질/.test(label)) return 'care'
  return 'caution'
}

/** 입력한 주의·보관 줄 다음에 추가 스펙의 관리·보관 행. 같은 글은 한 번 — D(inputSlotsOf.notices)와 K notice 섹션이 함께 읽는다. 규제 표현 거르기는 부르는 쪽이 한다 */
export function namedNoticesOf(spec: Pick<PdpSpecSheet, 'noticeItems' | 'extraSpecs'>): NoticeItem[] {
  const fromSpecs = careRows(spec).map((row) => ({ kind: noticeKindOf(row.label), text: row.value }))
  return cleanNoticeItems([...cleanNoticeItems(spec.noticeItems), ...fromSpecs])
}

/** 상품 정보 표가 싣는 특수 행 수 — spec_table 칸마다 spec.special 목록 상한이 이 값이다(시험이 대조한다) */
export const TABLE_SPECIAL_MAX = 3

/**
 * K 주의·보관 섹션에 싣는 줄(적용 K7-c (가), 통합 11-04 01:2x ⑤) — 상품 정보 표(모든 페이지에 있고 칸마다 특수 행 3줄)가 이미 싣는 관리·보관 글은 뺀다(같은 글 두 번 금지).
 * 근거(selection-facts notice)와 칸 채우기가 같은 값을 쓴다
 */
export function pageNoticesOf(spec: PdpSpecSheet): NoticeItem[] {
  const shown = new Set(productInfoRows(spec).filter((row) => !isRequiredRow(row)).slice(0, TABLE_SPECIAL_MAX).map((row) => row.value))
  return namedNoticesOf(spec).filter((item) => !shown.has(item.text))
}

/** 줄 종류 이름(D NOTICE_ROW_LABEL과 같은 글 — 시험이 대조한다)과 종류 아이콘(사전 icons.ts). 주의는 뜻이 중립인 아이콘이 없어 두지 않는다 */
export const NOTICE_KIND_LABEL: Readonly<Record<NoticeKind, string>> = { caution: '주의', storage: '보관', care: '관리' }
const NOTICE_KIND_ICON: Readonly<Partial<Record<NoticeKind, string>>> = { storage: 'storage', care: 'clean' }

/** 여러 개를 함께 보여 줄 수 있는가 — 구성이 둘 이상이거나 옵션이 둘 이상이다 */
export function hasManyItems(inputs: Pick<LineInputs, 'spec'> & Partial<Pick<LineInputs, 'options'>>): boolean {
  const quantity = Number(/^\d+/.exec(quantityOf(inputs.spec) ?? '')?.[0] ?? 1)
  return quantity > 1 || (inputs.options?.length ?? 0) >= 2 || (inputs.spec.colorOptions?.length ?? 0) >= 2
}

/** 이름표 글자 상한 — 장식 라벨 12자 ÷ 스트레스 1.2(공백 포함) */
const TAG_MAX = 10

/** 인증 이름 목록 — 입력 글을 줄·세미콜론·가운뎃점·쉼표로 나눈다. 고쳐 쓰지 않는다 */
export function certificationNames(spec: Pick<PdpSpecSheet, 'certificationInfo'>): string[] {
  return (spec.certificationInfo ?? '').split(/\r?\n|[;·]|,\s+/).map((name) => name.trim()).filter(Boolean)
}

/** 글자 칸 하나의 값 — 모르는 키·값 없음은 null. topCard는 대표 후기 칸에 들어가는 후기다(글과 작성자가 같은 후기여야 한다) */
function textInput(key: string | undefined, def: TextSlot, inputs: LineInputs, chapter: number | undefined, topCard: LineInputs['cards'][number] | undefined): string | null {
  const value = ((): string | null => {
    switch (key) {
      case 'chapter':
        return chapter ? String(chapter) : null
      case 'review.rating':
        return ratingOf(inputs.spec)?.rating ?? null
      case 'review.count':
        return ratingOf(inputs.spec)?.count ?? null
      // 우리 판매량(J51b) — 잡 생성 때 서버가 센 판매 수 × 묶음 수량 합과 기간 문구(ownSales). 판매 기록이 없거나 묶음 수량을 모르거나 100 미만이면 없다
      case 'sales.total':
        return inputs.spec.ownSales?.total?.trim() || null
      case 'sales.basis':
        return inputs.spec.ownSales?.basis?.trim() || null
      case 'review.quote':
        return topCard?.text ?? null
      case 'review.name':
        return topCard?.author ?? null
      case 'spec.quantity':
      case 'badge.quantity':
        return quantityOf(inputs.spec)
      // 원형 배지(R-D1) — 입력 평점 그대로(반올림·리뷰 파일 평균 없음), 리뷰 수 입력이 있을 때만. 수는 근거 확인으로만 쓴다
      case 'badge.rating':
        return Number(inputs.spec.rating) > 0 && Number(inputs.spec.reviewCount) > 0 ? String(inputs.spec.rating) : null
      // 입력 인증 이름의 첫 이름 그대로 — 입력에 없는 인증은 그리지 않는다(인증 사칭 금지)
      case 'badge.certification':
        return certificationNames(inputs.spec)[0] ?? null
      case 'offer.info':
        return inputs.spec.eventBannerInfo?.trim() || null
      case 'spec.size.width':
        return sizeOf(inputs.spec, 'w')
      case 'spec.size.height':
        return sizeOf(inputs.spec, 'h')
      case COMPARE_ONE_BASE_INPUT:
        return compareOne(inputs.spec, 'base')
      case COMPARE_ONE_OURS_INPUT:
        return compareOne(inputs.spec, 'ours')
      // 깊이(적용 K7-c 4c T1-41) — 방향이 확실한 셋째 축만. 없으면 3축 치수 칸은 고르지 않는다(필수 입력)
      case 'spec.size.depth':
        return sizeOf(inputs.spec, 'd')
      default:
        return null
    }
  })()
  return value && fits(value, def) ? value : null
}

const fieldOf = (def: ListSlot, input: string) => Object.entries(def.fields).find(([, field]) => field.type === 'text' && field.input === input) as [string, TextSlot] | undefined

function reviewItems(def: ListSlot, inputs: LineInputs): SlotItem[] {
  const quote = fieldOf(def, 'review.quote')
  const name = fieldOf(def, 'review.name')
  const stars = fieldOf(def, 'review.stars')
  return inputs.cards
    .filter((card) => !quote || fits(card.text, quote[1]))
    .slice(0, def.max)
    .map((card) => ({
      ...(quote ? { [quote[0]]: card.text } : {}),
      ...(name ? { [name[0]]: card.author } : {}),
      ...(stars && card.rating !== null ? { [stars[0]]: card.rating.toFixed(1) } : {}),
    }))
}

/**
 * 후기 질문 FAQ 줄(K4 ②) — 답은 후기 원문을 따옴표로 감싸고 출처 칸에 '구매 고객 후기'를 단다(D 구매 전 질문 표와 같은 표시). 칸보다 긴 질문·답은 자르지 않고
 * 그 줄을 건너뛴다. 줄이 목록 최소 수보다 적으면 칸이 비어 그 템플릿을 고르지 않는다(listInput)
 */
function faqItems(def: ListSlot, inputs: LineInputs): SlotItem[] {
  const question = fieldOf(def, FAQ_QUESTION_INPUT)
  const answer = fieldOf(def, FAQ_ANSWER_INPUT)
  const source = fieldOf(def, FAQ_SOURCE_INPUT)
  if (!question || !answer) return []
  return (inputs.faqs ?? [])
    .map((item) => ({ q: item.question, a: `"${item.answer}"` }))
    .filter(({ q, a }) => fits(q, question[1]) && fits(a, answer[1]))
    .slice(0, def.max)
    .map(({ q, a }) => ({ [question[0]]: q, [answer[0]]: a, ...(source && fits(REVIEW_ANSWER_SOURCE, source[1]) ? { [source[0]]: REVIEW_ANSWER_SOURCE } : {}) }))
}

function metricItems(def: ListSlot, inputs: LineInputs): SlotItem[] {
  const name = fieldOf(def, 'spec.metric.name')
  const value = fieldOf(def, 'spec.metric.value')
  if (!name || !value) return []
  // 값과 단위는 한 칸이다 — 나누면 '7.3'과 'cm'이 다른 줄로 떨어진다
  return metricsOf(inputs.spec)
    .map((metric) => ({ name: metric.name, value: `${metric.value}${metric.unit}` }))
    .filter((metric) => fits(metric.name, name[1]) && fits(metric.value, value[1]))
    .slice(0, def.max)
    .map((metric) => ({ [name[0]]: metric.name, [value[0]]: metric.value }))
}

/**
 * 층·단면(적용 K1 T1-85) — inputSlotsOf와 같은 정리·규제 표현 거르기를 지난 값만 쓴다. 층은 순서 있는 구조라 이름이 칸보다 긴 층이 하나라도 있으면
 * 목록 전체를 비운다(한 층만 빼면 단면이 틀린다 — 필수 목록이라 그 칸을 고르지 않는다). 설명이 칸보다 길면 그 층 설명만 뺀다(자르지 않는다)
 */
function layerItems(def: ListSlot, inputs: LineInputs): SlotItem[] {
  const name = fieldOf(def, 'product.layer.name')
  if (!name) return []
  const note = fieldOf(def, 'product.layer.note')
  const safe = (text: string) => isFactClaimSafe(text, inputs.spec.certificationInfo)
  const layers = cleanLayers(cleanLayers(inputs.spec.layers).filter((layer) => safe(`${layer.name} ${layer.note ?? ''}`)))
  if (layers.length > def.max || !layers.every((layer) => fits(layer.name, name[1]))) return []
  return layers.map((layer) => ({ [name[0]]: layer.name, ...(note && layer.note && fits(layer.note, note[1]) ? { [note[0]]: layer.note } : {}) }))
}

function rowItems(def: ListSlot, rows: readonly InfoRow[]): SlotItem[] {
  return rows.slice(0, def.max).map((row) => ({ label: row.label, value: row.value }))
}

/** 사실 타일(infocells) — factTiles 가운데 칸 글자 상한에 드는 행만 표 순서대로 칸 상한까지. 최소 수에 못 미치면 listInput이 비워 그 템플릿을 고르지 않는다 */
function factTileItems(def: ListSlot, inputs: LineInputs): SlotItem[] {
  const icon = fieldOf(def, SPEC_FACT_ICON_INPUT)
  const label = fieldOf(def, SPEC_FACT_LABEL_INPUT)
  const value = fieldOf(def, SPEC_FACT_VALUE_INPUT)
  if (!icon || !label || !value) return []
  return factTiles(inputs.spec)
    .filter((tile) => fits(tile.icon, icon[1]) && fits(tile.label, label[1]) && fits(tile.value, value[1]))
    .slice(0, def.max)
    .map((tile) => ({ [icon[0]]: tile.icon, [label[0]]: tile.label, [value[0]]: tile.value }))
}

/**
 * 구성품 이름(적용 K7-c (나) T1-83 K) — inputSlotsOf.parts와 같은 값(namedPartsOf + 규제 표현 거르기). PARTS_MIN 미만이거나 칸 상한을 넘거나
 * 칸보다 긴 이름이 하나라도 있으면 목록 전체를 비운다 — 일부만 실으면 그게 구성 전부인 것처럼 읽힌다(자르지 않는다)
 */
function partItems(def: ListSlot, inputs: LineInputs): SlotItem[] {
  const field = fieldOf(def, PART_NAME_INPUT)
  if (!field) return []
  const names = namedPartsOf(inputs.spec).filter((name) => isFactClaimSafe(name, inputs.spec.certificationInfo))
  const complete = names.length >= PARTS_MIN && names.length <= def.max && names.every((name) => fits(name, field[1]))
  return complete ? names.map((name) => ({ [field[0]]: name })) : []
}

/**
 * 사용 순서(적용 K7-c (나) T1-61) — inputSlotsOf.usageSteps와 같은 값(2~5단계, 한 단계라도 규제 표현이면 통째로 비움). 순서라 단계 수가 칸 상한을 넘거나
 * 제목이 칸보다 긴 단계가 하나라도 있으면 전체를 비운다(한 단계만 빼면 순서가 틀린다). 설명이 칸보다 길면 그 단계 설명만 뺀다(자르지 않는다)
 */
function usageStepItems(def: ListSlot, inputs: LineInputs): SlotItem[] {
  const title = fieldOf(def, USAGE_STEP_TITLE_INPUT)
  if (!title) return []
  const note = fieldOf(def, USAGE_STEP_NOTE_INPUT)
  const steps = cleanUsageSteps(inputs.spec.usageSteps)
  const safe = steps.every((step) => isFactClaimSafe(`${step.title} ${step.description ?? ''}`, inputs.spec.certificationInfo))
  if (!safe || steps.length > def.max || !steps.every((step) => fits(step.title, title[1]))) return []
  return steps.map((step) => ({ [title[0]]: step.title, ...(note && step.description && fits(step.description, note[1]) ? { [note[0]]: step.description } : {}) }))
}

/** 효과 시간표 — 기간이 몸·피부 변화로 이어지는 줄(뷰티 전후·기능성 표현). 사용·교체·배송 주기만 남긴다(통합 01:14 ④) */
const BODY_CHANGE = /효과|개선|변화|감소|완화|회복|재생|미백|주름|탄력|피부|모발|탈모|체중|살이|붓기|통증|혈행|면역/

/**
 * 사용·교체·배송 주기(적용 C5 ④ R-D3) — 정리(2~6줄) 뒤 효과 시간표 줄과 규제 표현 줄을 빼고, 남은 게 2개 미만이면 없음.
 * K how_to.schedule-rows·D 사용 방법 '주기' 줄·inputSlotsOf.schedule이 같은 값을 쓴다
 */
export function scheduleOf(spec: Pick<PdpSpecSheet, 'schedule' | 'certificationInfo'>): ScheduleItem[] {
  return cleanSchedule(cleanSchedule(spec.schedule).filter((item) => !BODY_CHANGE.test(`${item.label} ${item.period}`) && isFactClaimSafe(`${item.label} ${item.period}`, spec.certificationInfo)))
}

/** 주기 줄 칸 — 줄 수가 칸 상한을 넘거나 하나라도 칸보다 길면 전체를 비운다(자르지 않는다, 일부만 실으면 그게 전부인 것처럼 읽힌다) */
function scheduleItems(def: ListSlot, inputs: LineInputs): SlotItem[] {
  const label = fieldOf(def, SCHEDULE_LABEL_INPUT)
  const period = fieldOf(def, SCHEDULE_PERIOD_INPUT)
  if (!label || !period) return []
  const items = scheduleOf(inputs.spec)
  if (items.length > def.max || !items.every((item) => fits(item.label, label[1]) && fits(item.period, period[1]))) return []
  return items.map((item) => ({ [label[0]]: item.label, [period[0]]: item.period }))
}

/**
 * 견본 색 칩 칸(적용 C5 ③ T1-99) — 입력 견본(cleanSwatches = inputSlotsOf.swatches)을 옵션 이름(optionChips — D T7과 같은 함수)과 짝지은 값(pairedSwatches).
 * 이름은 짝 옵션 이름(옵션 없으면 견본 이름), 색은 입력 #RRGGBB 그대로 — 사진·옵션 이름에서 색을 짓지 않는다. 옵션이 있으면 **모든 옵션이 짝일 때만**
 * (통합 11-04 06:2x DECISION — 7옵션 중 2개만 칩이면 '색은 이 2가지뿐'으로 읽혀 상품 사실을 줄여 보인다, D 옵션 칸 점과 같은 규칙).
 * 짝이 2개 미만이거나 짝 없는 옵션이 있거나 칸 상한을 넘거나 이름 하나라도 칸보다 길면 전체를 비운다(자르지 않는다)
 */
function swatchItems(def: ListSlot, inputs: LineInputs): SlotItem[] {
  const name = fieldOf(def, OPTION_SWATCH_NAME_INPUT)
  const hex = fieldOf(def, OPTION_SWATCH_HEX_INPUT)
  if (!name || !hex) return []
  const labels = inputs.options.map((option) => option.label.trim()).filter(Boolean)
  const pairs = pairedSwatches(cleanSwatches(inputs.spec.swatches), labels)
  if (labels.length > 0 && pairs.length !== labels.length) return []
  const items = pairs.map((pair) => ({ name: pair.option ?? pair.name, hex: pair.hex }))
  if (items.length > def.max || !items.every((item) => fits(item.name, name[1]))) return []
  return items.map((item) => ({ [name[0]]: item.name, [hex[0]]: item.hex }))
}

/**
 * 옵션 색 띠(J54 named-bands) — 판매 옵션 이름(inputs.options)마다 그 옵션 사진에서 잰 색(optionColors)을 짝짓는다. 이름은 입력 그대로, 색은 측정값이다.
 * 모든 옵션이 색을 가질 때만(일부만 띠면 '색은 이것뿐'으로 읽힌다 — 견본 칩과 같은 규칙), 2개 이상·칸 상한 이하·이름이 칸에 들어갈 때만 채운다(자르지 않는다)
 */
function bandItems(def: ListSlot, inputs: LineInputs): SlotItem[] {
  const name = fieldOf(def, OPTION_BAND_NAME_INPUT)
  const hex = fieldOf(def, OPTION_BAND_HEX_INPUT)
  if (!name || !hex || !inputs.optionColors) return []
  const colorOf = new Map(inputs.optionColors.map((c) => [c.label.trim(), c.hex]))
  const items = inputs.options.map((option) => ({ name: option.label.trim(), hex: colorOf.get(option.label.trim()) }))
  if (items.length < 2 || items.length > def.max || !items.every((item) => item.hex && fits(item.name, name[1]))) return []
  return items.map((item) => ({ [name[0]]: item.name, [hex[0]]: item.hex as string }))
}

/**
 * 사이즈 표 줄(적용 K7-c (나) T1-65 K) — inputSlotsOf.sizeMatrix와 같은 값을 D 사이즈표(designcut-long matrixRows)와 같은 '열 값 · 열 값' 줄로.
 * 격자는 그리지 않는다(줄 모드, 통합 11-04 00:4x). 줄 수가 칸 상한을 넘거나 하나라도 칸보다 길면 전체를 비운다
 */
function sizeRowItems(def: ListSlot, inputs: LineInputs): SlotItem[] {
  const label = fieldOf(def, SIZE_ROW_LABEL_INPUT)
  const value = fieldOf(def, SIZE_ROW_VALUE_INPUT)
  const matrix = cleanSizeMatrix(inputs.spec.sizeMatrix)
  if (!label || !value || !matrix) return []
  if (!isFactClaimSafe([...matrix.columns, ...matrix.rows.flatMap((row) => [row.label, ...row.values])].join(' '), inputs.spec.certificationInfo)) return []
  const rows = matrix.rows.map((row) => ({ label: row.label, value: matrix.columns.map((column, i) => `${column} ${row.values[i]}`).join(' · ') }))
  if (rows.length > def.max || !rows.every((row) => fits(row.label, label[1]) && fits(row.value, value[1]))) return []
  return rows.map((row) => ({ [label[0]]: row.label, [value[0]]: row.value }))
}

/**
 * 같은 축척 윤곽 줄(적용 K7 4d T1-84·T2-32) — 사이즈 표의 가로·세로 열 숫자(scaleRows). 규제 표현 거름은 사이즈 표 줄과 같다.
 * 그릴 수 없는 꼴(축 열 없음·단위 없음·범위·행 수·이름 글자·축 비율)이거나 칸 상한을 넘거나 하나라도 칸보다 길면 전체를 비운다(필수 목록이라 그 칸은 후보에서 빠진다)
 */
export function scaleItems(def: ListSlot, inputs: Pick<LineInputs, 'spec'>): SlotItem[] {
  const label = fieldOf(def, SIZE_SCALE_LABEL_INPUT)
  const width = fieldOf(def, SIZE_SCALE_WIDTH_INPUT)
  const height = fieldOf(def, SIZE_SCALE_HEIGHT_INPUT)
  const matrix = cleanSizeMatrix(inputs.spec.sizeMatrix)
  if (!label || !width || !height || !matrix) return []
  if (!isFactClaimSafe([...matrix.columns, ...matrix.rows.flatMap((row) => [row.label, ...row.values])].join(' '), inputs.spec.certificationInfo)) return []
  const rows = scaleRows(matrix)
  if (rows.length < def.min || rows.length > def.max || !rows.every((row) => fits(row.label, label[1]) && fits(row.width, width[1]) && fits(row.height, height[1]))) return []
  return rows.map((row) => ({ [label[0]]: row.label, [width[0]]: row.width, [height[0]]: row.height }))
}

/**
 * 주의·보관 줄(적용 K7-c (가)) — pageNoticesOf에서 규제 표현 줄을 거른다(D inputSlotsOf.notices와 같음). 주의 줄은 하나만 빠져도 안 되므로 칸 상한을 넘거나 하나라도 칸보다 길거나
 * 아이콘 칸이 있는데 아이콘 없는 종류가 있으면 목록 전체를 비운다(필수 목록이라 그 칸은 후보에서 빠진다, 자르지 않는다)
 */
function noticeItems(def: ListSlot, inputs: LineInputs): SlotItem[] {
  const kind = fieldOf(def, NOTICE_KIND_INPUT)
  const text = fieldOf(def, NOTICE_TEXT_INPUT)
  if (!kind || !text) return []
  const icon = fieldOf(def, NOTICE_ICON_INPUT)
  const notices = pageNoticesOf(inputs.spec).filter((item) => isFactClaimSafe(item.text, inputs.spec.certificationInfo))
  const complete = notices.length <= def.max && notices.every((item) => fits(item.text, text[1]) && (!icon || NOTICE_KIND_ICON[item.kind]))
  return complete ? notices.map((item) => ({ [kind[0]]: NOTICE_KIND_LABEL[item.kind], [text[0]]: item.text, ...(icon ? { [icon[0]]: NOTICE_KIND_ICON[item.kind]! } : {}) })) : []
}

/**
 * 비교 근거 항목 줄(적용 C5 ②, 통합 11-04 04:5x ①②) — pageCompareBasis 그대로(순서·글). 항목(item)만 싣는 칸(✓ 우리·줄표 기존 표, 열 머리 '우리 제품'·'기존 제품')은
 * 모든 행의 기존이 비어야 한다(줄표 = 입력 없음과 같은 뜻 — 기존 값을 줄표로 가리지 않는다).
 * 칸 상한을 넘거나 하나라도 칸보다 길면 목록 전체를 비운다(일부만 실으면 그게 비교 전부인 것처럼 읽힌다).
 * 기존 → 우리 값 줄(side-rows)은 줄마다 기존·우리를 가르는 글이 없어 닫았다(통합 11-04 05:15) — 다시 열 때 고정 이름표 설계와 함께 행 기존·우리 칸을 더한다
 */
function compareRowItems(def: ListSlot, inputs: LineInputs): SlotItem[] {
  const item = fieldOf(def, COMPARE_ITEM_INPUT)
  if (!item) return []
  const rows = pageCompareBasis(inputs.spec)
  if (rows.length === 0 || rows.length > def.max || rows.some((row) => row.other)) return []
  if (!rows.every((row) => fits(row.label, item[1]))) return []
  return rows.map((row) => ({ [item[0]]: row.label }))
}

/** 비교 카드 한 쌍(적용 C5 ② ③) — 행이 정확히 1개이고 기존이 있을 때만 그 행의 기존·우리 값 */
function compareOne(spec: PdpSpecSheet, side: 'base' | 'ours'): string | null {
  const rows = pageCompareBasis(spec)
  if (rows.length !== 1 || !rows[0].other) return null
  return side === 'base' ? rows[0].other : rows[0].ours
}

/** 비교 근거를 요구하는 템플릿에 비교 입력 칸이 있는가(통합 11-04 04:5x ④⑤ — 입력 사실이 안 나오는 비교 칸은 닫는다) */
function hasCompareInput(template: Pick<Template, 'slots'>): boolean {
  const isCompare = (input: unknown) => typeof input === 'string' && input.startsWith(COMPARE_INPUT_PREFIX)
  return Object.values(template.slots).some((def) => def.type !== 'image' && def.source === 'input' && isCompare(def.input))
}

/** POINT 진행 목록(R-W7) — POINT마다 항목 하나, 이름은 그 POINT의 소구 이름 글이다. 칸보다 긴 이름은 자르지 않고 빈 항목으로 둔다(엔진이 점 줄로 그린다) */
function stepItems(def: ListSlot, steps: ReadonlyArray<string | null>): SlotItem[] {
  const field = def.fields[POINT_STEPS_NAME]
  if (field?.type !== 'text') return []
  return steps.slice(0, def.max).map((step) => (step && fits(step, field) ? { [POINT_STEPS_NAME]: step } : {}))
}

/**
 * 옵션 라인업(적용 K3 R-W6) — 옵션 수가 칸 최소~상한(2~4) 안이고, 모두 실물 사진(isRealOptionPhoto — 생성 실패·자리표시 URL 아님)이며, 이름이 모두 칸에 들 때만
 * 옵션마다 사진·이름 한 항목. 하나라도 아니면 목록 전체를 비운다 — 일부만 실으면 그게 전부인 라인업처럼 읽힌다(#124 생성 옵션 사진 금지). 5개 이상은 기존 격자가 받는다.
 * 옵션별 설명 칸은 없다
 */
function lineupItems(def: ListSlot, inputs: LineInputs): SlotItem[] {
  const photo = Object.entries(def.fields).find(([, field]) => field.type === 'image')?.[0]
  const name = fieldOf(def, OPTION_NAME_INPUT)
  const options = inputs.options
  const complete =
    options.length >= def.min && options.length <= def.max && options.every((option) => isRealOptionPhoto(option.image ?? undefined) && (!name || fits(option.label, name[1])))
  if (!photo || !complete) return []
  return options.map((option) => ({ [photo]: option.image, ...(name ? { [name[0]]: option.label } : {}) }))
}

/** 목록 칸 하나의 값 — 최소 수에 못 미치면 비운다(엔진이 그리지 않는다) */
function listInput(def: ListSlot, inputs: LineInputs, steps: ReadonlyArray<string | null>): SlotValue {
  const rows = () => productInfoRows(inputs.spec)
  const value = ((): string[] | SlotItem[] => {
    switch (def.input) {
      case 'review.items':
        return reviewItems(def, inputs)
      case FAQ_REVIEWS_INPUT:
        return faqItems(def, inputs)
      case SPEC_ROWS_INPUT:
        return rowItems(def, rows().filter(isRequiredRow))
      case SPEC_SPECIAL_INPUT:
        return rowItems(def, rows().filter((row) => !isRequiredRow(row)))
      case SPEC_FACTS_INPUT:
        return factTileItems(def, inputs)
      case 'certification.items': {
        const field = fieldOf(def, 'certification.name')
        // 칸보다 긴 이름은 자르지 않고 건너뛴다
        return field ? certificationNames(inputs.spec).filter((name) => fits(name, field[1])).slice(0, def.max).map((name) => ({ [field[0]]: name })) : []
      }
      case 'spec.metrics':
        return metricItems(def, inputs)
      case 'product.layers':
        return layerItems(def, inputs)
      case POINT_STEPS_INPUT:
        return stepItems(def, steps)
      case 'certification.names':
        return certificationNames(inputs.spec).filter((name) => name.length <= TAG_MAX).slice(0, def.max)
      case DEMO_PHOTOS_INPUT:
        return demoPhotoItems(def, inputs)
      case INGREDIENT_NAMES_INPUT:
        return ingredientNames(inputs, def.max, (name) => name.length <= TAG_MAX)
      case INGREDIENT_ITEMS_INPUT: {
        const field = fieldOf(def, INGREDIENT_NAME_INPUT)
        return field ? ingredientNames(inputs, def.max, (name) => fits(name, field[1])).map((name) => ({ [field[0]]: name })) : []
      }
      case NOTICE_ITEMS_INPUT:
        return noticeItems(def, inputs)
      case COMPARE_ROWS_INPUT:
        return compareRowItems(def, inputs)
      case PARTS_ITEMS_INPUT:
        return partItems(def, inputs)
      case USAGE_STEPS_INPUT:
        return usageStepItems(def, inputs)
      case SIZE_ROWS_INPUT:
        return sizeRowItems(def, inputs)
      case SIZE_SCALE_INPUT:
        return scaleItems(def, inputs)
      case SCHEDULE_ROWS_INPUT:
        return scheduleItems(def, inputs)
      case OPTION_SWATCHES_INPUT:
        return swatchItems(def, inputs)
      case OPTION_BANDS_INPUT:
        return bandItems(def, inputs)
      case RATING_BARS_INPUT:
        return ratingBarItems(inputs.spec)
      case 'option.names': {
        // 판매 옵션은 앞 몇 개만 보여 주지 않는다(K14) — 칸 상한을 넘으면 비우고 고르기가 그 템플릿을 거른다(showsAllOptions)
        const names = inputs.options.map((option) => option.label)
        return names.length <= (def.inputMax ?? def.max) ? names : []
      }
      case OPTION_LINEUP_INPUT:
        return lineupItems(def, inputs)
      case OPTION_IMAGES_INPUT: {
        const photo = Object.entries(def.fields).find(([, field]) => field.type === 'image')?.[0]
        if (!photo) return []
        const name = fieldOf(def, OPTION_NAME_INPUT)
        const photos = inputs.options.flatMap((option) => {
          if (!option.image) return []
          if (!name) return [{ [photo]: option.image }]
          // 이름이 붙는 칸 — 칸보다 긴 이름은 자르지 않고 그 옵션을 건너뛴다(이름 없는 사진을 섞지 않는다)
          return fits(option.label, name[1]) ? [{ [photo]: option.image, [name[0]]: option.label }] : []
        })
        // 앞 몇 장만 보여 주지 않는다(K14) — 칸 상한을 넘으면 비워 그 템플릿을 고르지 않는다
        return photos.length <= (def.inputMax ?? def.max) ? photos : []
      }
      default:
        return []
    }
  })()
  return value.length >= def.min ? value : null
}

function isInputSlot(def: SlotDef): def is (TextSlot & { input: string }) | (ListSlot & { input: string }) {
  return def.type !== 'image' && def.source === 'input' && typeof def.input === 'string'
}

/**
 * 템플릿 입력값 칸을 채운 값 — 카피 칸·사진 칸은 넣지 않는다. 이 값을 카피 칸·컷 키와 합쳐 renderTemplate에 넘긴다.
 * chapter는 큰 POINT 순번이다(첫 POINT가 1). steps는 페이지 POINT마다 소구 이름(없으면 null)이고 POINT 진행 목록을 채운다. 출처가 아직 없는 키(review.keywords)는 비운다.
 */
export function fillInputSlots(template: Pick<Template, 'slots'>, inputs: LineInputs, chapter?: number, steps: ReadonlyArray<string | null> = []): SlotValues {
  const values: SlotValues = {}
  const quoteDef = Object.values(template.slots).find((def): def is TextSlot => def.type === 'text' && def.input === 'review.quote')
  const topCard = inputs.cards.find((card) => fits(card.text, quoteDef))
  for (const [name, def] of Object.entries(template.slots)) {
    if (!isInputSlot(def)) continue
    const value = def.type === 'list' ? listInput(def, inputs, steps) : textInput(def.input, def, inputs, chapter, topCard)
    if (value !== null) values[name] = value
  }
  return values
}

/** 시험 사진 입력(demoshot 잡만, J57) — 꺼진 잡·시험 사진 없는 잡은 빈 객체라 입력이 지금과 같다 */
function demoPhotosInputOf(job: Pick<PdpJobRow, 'spec_sheet' | 'analysis'> & Partial<Pick<PdpJobRow, 'source_images'>>): Pick<LineInputs, 'demoPhotos'> {
  if (!hasEnrichmentFeature(job.analysis, 'demoshot')) return {}
  const roles = job.spec_sheet.sourcePhotoRoles ?? []
  const photos = demoPhotoUrls(job.source_images ?? roles.map((r) => r.url), roles).filter((url) => isRealOptionPhoto(url))
  return photos.length > 0 ? { demoPhotos: photos } : {}
}

/** 시험 사진 칸(J57 compare.demo-photo) — 사진 주소 그대로, 칸 상한까지(시연 칸은 한 장). 없으면 비워 그 템플릿을 고르지 않는다 */
function demoPhotoItems(def: ListSlot, inputs: LineInputs): SlotItem[] {
  const photo = Object.entries(def.fields).find(([, field]) => field.type === 'image')?.[0]
  return photo ? (inputs.demoPhotos ?? []).slice(0, def.max).map((url) => ({ [photo]: url })) : []
}

/**
 * 입력값으로 채우는 필수 칸이 모두 채워지는가 — 못 채우면 엔진이 그 템플릿을 그리지 않는다. 고르기 전에 걸러야 페이지 높이 계산에 그려지지 않을 섹션이 들지 않는다.
 * 큰 POINT 번호처럼 순번으로 정해지는 칸은 첫 순번으로 본다.
 */
export function requiredInputsFit(template: Pick<Template, 'slots'> & Partial<Pick<Template, 'flow' | 'needs'>>, inputs: LineInputs): boolean {
  if (template.needs?.evidence?.includes(COMPARE_BASIS) && !hasCompareInput(template)) return false
  const values = fillInputSlots(template, inputs, 1)
  const required = Object.entries(template.slots).every(([name, def]) => !isInputSlot(def) || !def.required || values[name] !== undefined)
  return required && showsAllOptions(template, values, inputs) && (template.flow ?? []).every((node) => dimensionFits(node, values))
}

/** 옵션마다 한 항목인 칸 — 사이즈 칸(option.sizeRows·sizeScale)은 옵션 수와 상관없는 표라 뺀다 */
const OPTION_LIST_INPUTS: ReadonlySet<string> = new Set(['option.names', OPTION_IMAGES_INPUT, OPTION_LINEUP_INPUT, OPTION_SWATCHES_INPUT, OPTION_BANDS_INPUT])

/**
 * 판매 옵션을 다 보여 주는가(K14, V2 K2 P01·P10 입력 7개 화면 6개) — 옵션 칸이 있는 템플릿은 어느 한 칸이 입력 옵션을 모두 그려야 고른다.
 * 옵션 칸이 없는 템플릿은 보지 않는다. 사진이 일부만 있어도 이름 칸이 모두 그리면 된다
 */
function showsAllOptions(template: Pick<Template, 'slots'>, values: SlotValues, inputs: LineInputs): boolean {
  const shown = Object.entries(template.slots).flatMap(([name, def]) => {
    if (def.type !== 'list' || !def.input || !OPTION_LIST_INPUTS.has(def.input)) return []
    const value = values[name]
    return [Array.isArray(value) ? value.length : 0]
  })
  return shown.length === 0 || Math.max(...shown) >= inputs.options.length
}

/** 치수 도식은 가로·세로 중 하나가 있어야 그려진다 — 칸은 선택이지만 둘 다 비면 도식과 함께 그 사진까지 빠져 생성한 컷이 버려진다 */
function dimensionFits(node: FlowNode, values: SlotValues): boolean {
  if (node.kind === 'dimension') return values[node.widthSlot] !== undefined || values[node.heightSlot] !== undefined
  if (node.kind === 'panel' || node.kind === 'repeat') return node.nodes.every((child) => dimensionFits(child, values))
  if (node.kind === 'row') return node.columns.every((column) => column.nodes.every((child) => dimensionFits(child, values)))
  return true
}
