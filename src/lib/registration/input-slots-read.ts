// 입력 칸 읽기(적용 JOB C1) — D 부품과 K 칸이 같은 값을 받는 한 곳이다. 없으면 빈 값이고 그리지 않는다. 짓지 않는다.
// 새 칸(input-slots.ts)과 이미 있는 입력(추가 스펙·인증 글·자사 리뷰 파일 집계)을 합친다. 규제 표현이 든 줄은 뺀다(상품 정보 표와 같은 규칙).
// 사용 순서는 한 단계만 빼도 뜻이 달라져 통째로 비운다. 비교 근거는 깎아내리는 행을, 주기는 효과 시간표 줄을 뺀다(C5). 고객 화면에 붙이는 일은 K·D 부품 몫이다.

import { pageCompareBasis, pageCompareSource } from './compare-basis-read'
import { isFactClaimSafe } from './eval/claim-lexicon'
import {
  cleanLayers,
  cleanProductColor,
  cleanProductMetrics,
  cleanRealPhotos,
  cleanSizeMatrix,
  cleanSwatches,
  cleanUsageSteps,
  INPUT_SLOT_LIMITS,
  type ColorSwatch,
  type CompareBasisRow,
  type NoticeItem,
  type ProductLayer,
  type ProductMetric,
  type RealPhoto,
  type ScheduleItem,
  type SizeMatrix,
  type UsageStep,
} from './input-slots'
import type { PdpSpecSheet } from './pdp-state'
import { certificationNames, metricsOf, namedIngredientsOf, namedNoticesOf, namedPartsOf, scheduleOf } from './templatelib/input-values'

export interface RatingBar {
  star: 1 | 2 | 3 | 4 | 5
  count: number
  /** 전체에서 차지하는 몫 0~1 */
  share: number
}

export interface InputSlotValues {
  notices: NoticeItem[]
  metrics: ProductMetric[]
  ratingBars: RatingBar[]
  certifications: string[]
  ingredients: string[]
  usageSteps: UsageStep[]
  sizeMatrix: SizeMatrix | null
  parts: string[]
  layers: ProductLayer[]
  swatches: ColorSwatch[]
  realPhotos: RealPhoto[]
  productColor: string | null
  /** 비교 근거(C5) — 규제 표현·깎아내리기(부정어)·타사 표식이 든 행은 뺀다 */
  compareBasis: CompareBasisRow[]
  compareSource: string | null
  /** 주기(C5) — 규제 표현·효과 시간표(기간 → 몸·피부 변화) 줄은 빼고, 2개 미만이면 없음 */
  schedule: ScheduleItem[]
}


const STARS = [5, 4, 3, 2, 1] as const

/** 입력한 주의·보관 줄 다음에 추가 스펙의 관리·보관 행. 같은 글은 한 번 — K notice 섹션과 같은 읽기(templatelib/input-values namedNoticesOf) */
function noticesOf(spec: PdpSpecSheet, safe: (text: string) => boolean): NoticeItem[] {
  return namedNoticesOf(spec).filter((item) => safe(item.text))
}

/** 별점 분포 — 자사 리뷰 파일 집계만 쓴다. 평점 입력 하나로 분포를 만들지 않는다 */
export function ratingBarsOf(spec: Pick<PdpSpecSheet, 'reviewFiles'>): RatingBar[] {
  const counts = spec.reviewFiles?.own?.stats?.rating_counts as Record<string, unknown> | undefined
  const countOf = (star: number) => {
    const n = Number(counts?.[String(star)])
    return Number.isInteger(n) && n > 0 ? n : 0
  }
  const total = STARS.reduce((sum, star) => sum + countOf(star), 0)
  return total > 0 ? STARS.map((star) => ({ star, count: countOf(star), share: countOf(star) / total })) : []
}

export function inputSlotsOf(spec: PdpSpecSheet): InputSlotValues {
  const safe = (text: string) => isFactClaimSafe(text, spec.certificationInfo)
  const metrics = cleanProductMetrics(spec.productMetrics)
  const steps = cleanUsageSteps(spec.usageSteps)
  const matrix = cleanSizeMatrix(spec.sizeMatrix)
  return {
    notices: noticesOf(spec, safe),
    metrics: (metrics.length ? metrics : metricsOf(spec)).filter((m) => safe(`${m.name} ${m.value}${m.unit}`)).slice(0, INPUT_SLOT_LIMITS.metric.max),
    ratingBars: ratingBarsOf(spec),
    certifications: certificationNames(spec),
    ingredients: namedIngredientsOf(spec).filter(safe),
    usageSteps: steps.every((s) => safe(`${s.title} ${s.description ?? ''}`)) ? steps : [],
    sizeMatrix: matrix && safe([...matrix.columns, ...matrix.rows.flatMap((row) => [row.label, ...row.values])].join(' ')) ? matrix : null,
    parts: namedPartsOf(spec).filter(safe),
    layers: cleanLayers(cleanLayers(spec.layers).filter((layer) => safe(`${layer.name} ${layer.note ?? ''}`))),
    swatches: cleanSwatches(spec.swatches),
    realPhotos: cleanRealPhotos(spec.realPhotos).filter((photo) => safe(photo.caption ?? '')),
    productColor: cleanProductColor(spec.productColor),
    // 비교 근거 거르기(깎아내리기·타사 표식·규제 표현)는 K 칸 채우기와 같은 함수 — compare-basis-read
    compareBasis: pageCompareBasis(spec),
    compareSource: pageCompareSource(spec),
    // 효과 시간표 줄·규제 표현 줄 뺌은 K how_to.schedule-rows와 같은 함수(input-values scheduleOf, 적용 C5 ④)
    schedule: scheduleOf(spec),
  }
}

// 견본 ↔ 옵션 짝은 K 견본 칩(templatelib input-values)도 부르므로 의존 없는 input-slots에 둔다(적용 C5 ③ — import 순환 피함)
export { pairedSwatches } from './input-slots'
