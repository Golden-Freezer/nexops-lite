/**
 * 강조 장식(E-3, T4) 순수 로직 — docs/plans/pdp-enrichment/00_DESIGN.md §4.5.
 * 대상 선정(selectAnnotationTargets)·허용 라벨·Vision 응답 검증·밀도 상한·번호 배지(결정론)·편집기 전달 형태.
 * Vision 호출은 agents/registration/pdp-annotation-agent.ts, run 오케스트레이션은 pdp-image-stage.ts 소관.
 */

import { LONG_MACRO_FROM } from './long-sections'
import { lookupRoleVocab } from './design-vocab'
import { buildImageTasks } from './pdp-image-tasks'
import { designcutEnabled } from './internalized/designcut-plan'
import {
  resolveGenerationTrack,
  type ImageAnnotation,
  type PdpJobRow,
  type PdpQualityReport,
  type SectionImage,
} from './pdp-state'
import type { AnnotationRenderStats } from './editor/utils/sectionConverter/annotations'

export const ANNOTATION_LIMITS = {
  /** 이미지당 장식 수 */
  perImage: 3,
  /** 페이지에서 Vision 장식을 받는 USP 컷 수 상한 */
  maxPageImages: 4,
  /** 라벨 문구 — 모바일 M5(한 줄·12자). 넘는 문구는 자르지 않고 후보에서 뺀다 */
  labelMaxChars: 12,
  coordMin: 0.05,
  coordMax: 0.95,
  /** 앵커 간 최소 거리(원본 기준) */
  minAnchorGap: 0.12,
  /** 확대 영역 한 변 최소(원본 기준) */
  minZoomSide: 0.15,
} as const

/** 디자인 어휘가 없을 때 쓰는 USP 컷 오버레이 비율 */
const FALLBACK_OVERLAY_SHARE = 0.5

/**
 * 컷을 편집기에 보여 주는 섹션(설계 계획 키 — 백엔드 이름·편집기 섹션 타입 둘 다). 계획에 없으면 그 컷은 화면에
 * 나오지 않으므로 장식 대상이 아니다(sectionConverter: features → point_div·sub_div·point_list_div,
 * size_comparison → compare_div, howto → hidden_page).
 */
const DISPLAY_SECTIONS = {
  features: ['point_cards', 'point_div', 'detail_points', 'sub_div', 'recommended_targets', 'point_list_div'],
  size_comparison: ['compare_div'],
  howto: ['how_to', 'hidden_page'],
} as const

export type AnnotationKind = ImageAnnotation['kind']

export interface AllowedLabel {
  text: string
  source: string
}

export interface AnnotationTarget {
  /** section_images[].section — 'features:0' | 'size_comparison' | 'howto:1' */
  section: string
  url: string
  /** vision: Vision 1콜로 위치를 받는다 / number: 번호 배지를 결정론으로 단다 */
  mode: 'vision' | 'number'
  /** Vision이 고를 수 있는 종류 */
  kinds: AnnotationKind[]
  /** Vision에 주는 허용 라벨 목록(number는 빈 목록) */
  labels: AllowedLabel[]
}

/** 편집기 전달 형태 — 이미지 URL 키. aspect = 원본 가로/세로(투영용, 모르면 null), section = 컷 키(역할 소유 섹션 판정용) */
export interface EditorImageAnnotations {
  aspect: number | null
  section: string
  items: ImageAnnotation[]
}

const indexOf = (section: string) => Number(section.split(':')[1] ?? '-1')

function isSingleLineLabel(text: string): boolean {
  return text.length > 0 && !/[\r\n]/.test(text) && [...text].length <= ANNOTATION_LIMITS.labelMaxChars
}

function pushLabel(list: AllowedLabel[], raw: unknown, source: string) {
  if (typeof raw !== 'string') return
  const text = raw.trim()
  if (!isSingleLineLabel(text) || list.some((l) => l.text === text)) return
  list.push({ text, source })
}

/**
 * 허용 라벨 목록 — 카피(pointCards 제목·detailPoints claim)와 스펙(소재·크기)에서 결정론으로 뽑는다.
 * 12자를 넘는 문구는 자르지 않고 뺀다(잘린 문장은 모바일에서 오해를 부른다).
 * 장식 대상은 이 목록 전체가 아니라 컷마다 자기 라벨을 받는다(featureCutLabels·spec.size, R2-2).
 */
export function buildAllowedLabels(job: PdpJobRow): AllowedLabel[] {
  const copy = job.copy_sections.final
  const labels: AllowedLabel[] = []
  ;(copy?.pointCards ?? []).forEach((c, i) => pushLabel(labels, c?.title, `pointCards[${i}].title`))
  ;(copy?.detailPoints ?? []).forEach((p, i) => pushLabel(labels, p?.claim, `detailPoints[${i}].claim`))
  pushLabel(labels, job.spec_sheet.material, 'spec.material')
  pushLabel(labels, job.spec_sheet.size, 'spec.size')
  return labels
}

/**
 * features:i 컷의 라벨 1개 — 그 컷을 보여 주는 POINT 카드 i의 제목(pointCards[i].title). 쓸 수 없으면(12자 초과·여러 줄·없음)
 * 그 컷의 생성 근거 detailPoints[i].claim. 페이지에서 이미 쓴 문구는 주지 않는다(R2-2 — 모든 컷에 같은 목록을 주면 Vision이
 * 컷마다 같은 라벨을 골랐다: R1 P02 '은은한 반투명' ×3). 줄 수 있는 라벨이 없으면 빈 목록(그 컷은 장식하지 않는다).
 * 디자인 컷(designcut) 잡은 claim이 먼저다 — 컷 바로 위 POINT 머리글이 pointCards[i].title이라 제목 칩은 그리기 단계에서
 * 같은 섹션 글자로 늘 빠졌다(D1 T2-45: 저장 11잡 30/30). claim을 쓸 수 없으면 제목으로 돌아가 이전과 같다.
 */
export function featureCutLabels(job: PdpJobRow, index: number, used: ReadonlySet<string>): AllowedLabel[] {
  const copy = job.copy_sections.final
  const candidates: AllowedLabel[] = []
  const title = () => pushLabel(candidates, copy?.pointCards?.[index]?.title, `pointCards[${index}].title`)
  const claim = () => pushLabel(candidates, copy?.detailPoints?.[index]?.claim, `detailPoints[${index}].claim`)
  if (designcutEnabled(job)) {
    claim()
    title()
  } else {
    title()
    claim()
  }
  const label = candidates.find((l) => !used.has(l.text))
  return label ? [label] : []
}

/** 장식 발동 — Track I이고 설계 단계가 annotations를 기록한 잡만(진행 중 Track S·구 Track I 잡은 대상 0) */
export function annotationsEnabled(job: PdpJobRow): boolean {
  return (
    resolveGenerationTrack(job) === 'internalized' &&
    (job.section_plan?.enrichment?.features ?? []).includes('annotations')
  )
}

/**
 * 페이지에서 Vision 장식을 받는 USP 컷 수 — USP 컷 수 × 실측 오버레이 비율(디자인 어휘 usp_feature의
 * overlay.imageShare, 반올림), 1~4. 지시선·확대 남발은 실측상 템플릿 등급 신호였다.
 */
export function pageImageCap(category: string | null | undefined, uspCount: number): number {
  if (uspCount <= 0) return 0
  const share = lookupRoleVocab(category, 'usp_feature')?.role.overlay.imageShare ?? FALLBACK_OVERLAY_SHARE
  return Math.max(1, Math.min(ANNOTATION_LIMITS.maxPageImages, Math.round(uspCount * share)))
}

/**
 * 장식 대상 컷 — features:i(라벨·지시선·확대, 컷마다 자기 라벨 1개(featureCutLabels), 라벨이 있는 컷 중 앞 순서로 페이지 상한까지),
 * size_comparison(spec.size 라벨만), howto:i(번호 배지, Vision 없음). url이 있고 재생성 대기가 아니며, 그 컷을 보여 주는
 * 섹션이 설계 계획에 있는 컷만. 같은 라벨 문구는 페이지에서 한 번만 준다. 발동 조건이 아니면 빈 목록.
 */
export function selectAnnotationTargets(job: PdpJobRow): AnnotationTarget[] {
  if (!annotationsEnabled(job)) return []
  const planned = new Set(job.section_plan.activated_sections ?? [])
  const shows = (kind: keyof typeof DISPLAY_SECTIONS) => DISPLAY_SECTIONS[kind].some((k) => planned.has(k))
  const ready = job.section_images.filter((e) => e.url && !e.pendingRegen)
  const targets: AnnotationTarget[] = []

  // 긴 상세페이지 디테일 근접(L-2) 매크로 컷(특징 5·6번)은 장식하지 않고 상한에도 세지 않는다 — 짝 회차(R9-NL)에서 1~4번 컷의 장식이
  // 같게. 디자인 컷 D2 잡은 POINT 6장의 자기 컷이라 그대로 센다
  const d2 = (job.section_plan?.enrichment?.features ?? []).includes('designcut2')
  const isFeature = (section: string) => /^features:\d+$/.test(section) && (d2 || indexOf(section) < LONG_MACRO_FROM)
  const features = ready.filter((e) => isFeature(e.section)).sort((a, b) => indexOf(a.section) - indexOf(b.section))
  const allFeatures = job.section_images.filter((e) => isFeature(e.section)).length
  const cap = pageImageCap(job.analysis.detected_category, allFeatures)
  // 크기 컷 라벨은 spec.size에서 따로 뽑는다(허용 목록은 같은 문구의 POINT 제목을 먼저 남겨 크기 컷이 라벨을 잃었다)
  const sizeLabels: AllowedLabel[] = []
  pushLabel(sizeLabels, job.spec_sheet.size, 'spec.size')
  const size = ready.find((e) => e.section === 'size_comparison')
  const showSize = Boolean(size) && sizeLabels.length > 0 && shows('size_comparison')
  // 크기 컷 라벨은 그 컷 몫이다 — USP 컷이 같은 문구를 받지 않게 먼저 둔다
  const used = new Set<string>(showSize ? sizeLabels.map((l) => l.text) : [])
  if (shows('features')) {
    for (const e of features) {
      if (targets.length >= cap) break
      const own = featureCutLabels(job, indexOf(e.section), used)
      if (own.length === 0) continue
      own.forEach((l) => used.add(l.text))
      targets.push({ section: e.section, url: e.url, mode: 'vision', kinds: ['label', 'leader', 'zoom'], labels: own })
    }
  }

  if (size && showSize) {
    targets.push({ section: size.section, url: size.url, mode: 'vision', kinds: ['label'], labels: sizeLabels })
  }

  for (const e of shows('howto') ? ready.filter((x) => /^howto:\d+$/.test(x.section)) : []) {
    targets.push({ section: e.section, url: e.url, mode: 'number', kinds: ['number'], labels: [] })
  }
  return targets
}

/** 장식 결과가 아직 없는 대상 */
export function pendingAnnotationTargets(job: PdpJobRow): AnnotationTarget[] {
  return selectAnnotationTargets(job).filter(
    (t) => !job.section_images.find((e) => e.section === t.section && e.url === t.url)?.annotationStatus
  )
}

/** 번호 배지(결정론) — 단계 번호 1개. 위치는 편집기가 보이는 영역 모서리에 정한다(앵커는 기록용) */
export function buildNumberAnnotations(target: AnnotationTarget): ImageAnnotation[] {
  const i = indexOf(target.section)
  return [{ kind: 'number', anchor: { x: 0.1, y: 0.1 }, text: String(i + 1), source: `howto[${i}]` }]
}

const inRange = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v >= ANNOTATION_LIMITS.coordMin && v <= ANNOTATION_LIMITS.coordMax

function readZoomRect(raw: unknown): ImageAnnotation['zoomRect'] | null {
  if (!raw || typeof raw !== 'object') return null
  const { x, y, w, h } = raw as Record<string, unknown>
  if (![x, y, w, h].every((v) => typeof v === 'number' && Number.isFinite(v))) return null
  const rect = { x: x as number, y: y as number, w: w as number, h: h as number }
  if (rect.x < 0 || rect.y < 0 || rect.x + rect.w > 1 || rect.y + rect.h > 1) return null
  if (rect.w < ANNOTATION_LIMITS.minZoomSide || rect.h < ANNOTATION_LIMITS.minZoomSide) return null
  return rect
}

/**
 * Vision 응답 검증 — 목록 밖 문자열·범위 밖 좌표(0.05~0.95)·근접 앵커(< 0.12)·작은 확대 영역(< 0.15)·허용 밖 종류를
 * 버리고 이미지당 3개까지 남긴다. 새 문구를 만들지 않는다(목록 문자열과 정확히 같을 때만, 앞뒤 공백만 무시).
 */
export function validateAnnotations(rows: unknown, target: AnnotationTarget): ImageAnnotation[] {
  if (!Array.isArray(rows)) return []
  const accepted: ImageAnnotation[] = []
  for (const row of rows) {
    if (accepted.length >= ANNOTATION_LIMITS.perImage) break
    if (!row || typeof row !== 'object') continue
    const r = row as Record<string, unknown>
    const kind = r.kind as AnnotationKind
    if (!target.kinds.includes(kind) || kind === 'number') continue

    const text = typeof r.text === 'string' ? r.text.trim() : ''
    const label = text ? target.labels.find((l) => l.text === text) : undefined
    let anchor: { x: number; y: number }
    let zoomRect: ImageAnnotation['zoomRect']
    if (kind === 'zoom') {
      const rect = readZoomRect(r.zoomRect ?? r.zoom)
      if (!rect) continue
      zoomRect = rect
      anchor = { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 }
    } else {
      if (!label) continue
      anchor = { x: r.x as number, y: r.y as number }
    }
    if (!inRange(anchor.x) || !inRange(anchor.y)) continue
    if (label && accepted.some((a) => a.text === label.text)) continue
    const tooClose = accepted.some(
      (a) => Math.hypot(a.anchor.x - anchor.x, a.anchor.y - anchor.y) < ANNOTATION_LIMITS.minAnchorGap
    )
    if (tooClose) continue

    accepted.push({
      kind,
      anchor,
      ...(zoomRect ? { zoomRect } : {}),
      // 확대에 붙은 문구가 목록 밖이면 문구만 버린다
      ...(label ? { text: label.text } : {}),
      source: label?.source ?? 'image',
    })
  }
  return accepted
}

/** 장식 결과를 컷에 기록한다 — 남은 장식이 없으면 skipped. aspect는 받은 이미지에서 읽은 실제 비율 */
export function withAnnotationResult(
  entry: SectionImage,
  result: { annotations: ImageAnnotation[]; aspect?: number | null } | 'failed'
): SectionImage {
  if (result === 'failed') return { ...entry, annotationStatus: 'failed' }
  if (result.annotations.length === 0) return { ...entry, annotationStatus: 'skipped' }
  return {
    ...entry,
    annotations: result.annotations,
    annotationStatus: 'done',
    ...(result.aspect ? { imageAspect: result.aspect } : {}),
  }
}

/**
 * 이미지 바이트(base64) 헤더에서 가로/세로 — PNG(IHDR)·JPEG(SOF)·WebP(VP8·VP8L·VP8X). 읽지 못하면 null.
 * 생성 모델이 비율 힌트와 다른 고정 크기로 만드는 경우가 있어(gpt-image-2 3:4 → 1024×1536) 투영은 실제 비율을 쓴다.
 */
export function imageAspectFromBase64(data: string): number | null {
  const b = Buffer.from(data, 'base64')
  const ratio = (w: number, h: number) => (w > 0 && h > 0 ? w / h : null)
  if (b.length >= 24 && b.readUInt32BE(0) === 0x89504e47) return ratio(b.readUInt32BE(16), b.readUInt32BE(20))
  if (b.length >= 30 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') {
    const chunk = b.toString('ascii', 12, 16)
    if (chunk === 'VP8 ') return ratio(b.readUInt16LE(26) & 0x3fff, b.readUInt16LE(28) & 0x3fff)
    if (chunk === 'VP8L') {
      const bits = b.readUInt32LE(21)
      return ratio((bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1)
    }
    if (chunk === 'VP8X') return ratio(b.readUIntLE(24, 3) + 1, b.readUIntLE(27, 3) + 1)
    return null
  }
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) return null
      const marker = b[i + 1]
      const len = b.readUInt16BE(i + 2)
      // SOF0~SOF15(C4 DHT·C8·CC DAC 제외)
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return ratio(b.readUInt16BE(i + 7), b.readUInt16BE(i + 5))
      }
      i += 2 + len
    }
  }
  return null
}

/**
 * 장식 단계 진행률 — 남은 대상이 줄 때마다 1씩 오른다(95 − 남은 수). 번호 배지만 다는 run처럼 비용·장수가
 * 그대로인 run도 정체 감지 서명(단계:장수:progress:cost, PdpProgress.tsx)이 바뀐다. compose 진입은 95.
 */
export function annotationProgress(remaining: number): number {
  return Math.max(76, 95 - Math.max(1, remaining))
}

function parseAspect(ratio: string | undefined): number | null {
  const m = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(ratio ?? '')
  if (!m) return null
  const w = Number(m[1])
  const h = Number(m[2])
  return w > 0 && h > 0 ? w / h : null
}

/**
 * 편집기 전달 — 장식이 기록된 컷만 이미지 URL 키로. 원본 비율은 장식 단계가 읽은 실제 비율, 없으면(번호 배지)
 * 생성 태스크의 비율 힌트(투영용).
 * 장식이 하나도 없으면 null(Track S·구 잡 응답 형태 불변).
 */
export function editorAnnotationsOf(job: PdpJobRow): Record<string, EditorImageAnnotations> | null {
  const done = (job.section_images ?? []).filter(
    (e) => e.url && e.annotationStatus === 'done' && (e.annotations?.length ?? 0) > 0
  )
  if (done.length === 0) return null
  const aspects = new Map(buildImageTasks(job).map((t) => [t.section, parseAspect(t.aspectRatio)]))
  const out: Record<string, EditorImageAnnotations> = {}
  for (const e of done) {
    if (out[e.url]) continue
    out[e.url] = { aspect: e.imageAspect ?? aspects.get(e.section) ?? null, section: e.section, items: e.annotations! }
  }
  return out
}

/**
 * 품질 보고서 annotations(설계 §4.6, T4b) — 대상·성공·생략·실패·기록 장식 수는 잡 기록에서, 그린 수·영역 밖 제외·
 * 자리 없음·화면 상한·화면에 없음은 편집기 최초 빌드 측정에서. 장식 발동 잡이 아니면 null.
 */
export function annotationQualityReport(
  job: PdpJobRow,
  render?: AnnotationRenderStats | null
): NonNullable<PdpQualityReport['annotations']> | null {
  if (!annotationsEnabled(job)) return null
  const targets = selectAnnotationTargets(job)
  const entries = targets.map((t) => job.section_images.find((e) => e.section === t.section && e.url === t.url))
  const count = (status: SectionImage['annotationStatus']) =>
    entries.filter((e) => e?.annotationStatus === status).length
  return {
    targets: targets.length,
    done: count('done'),
    skipped: count('skipped'),
    failed: count('failed'),
    recorded: entries.reduce((sum, e) => sum + (e?.annotationStatus === 'done' ? (e.annotations?.length ?? 0) : 0), 0),
    ...(render
      ? {
          placed: render.placed,
          outOfView: render.outOfView,
          noRoom: render.noRoom,
          screenCap: render.screenCap,
          notShown: render.notShown,
        }
      : {}),
  }
}
