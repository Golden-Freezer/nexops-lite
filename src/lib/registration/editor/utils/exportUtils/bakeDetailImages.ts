/**
 * 상세 이미지 굽기(U1, docs/plans/pdp-enrichment/02_TASK_CONTRACTS.md U1·07 §9) — 편집기 렌더를 JPEG로 굽는다.
 * - 섹션 이미지: 섹션마다 1장(SLICE_MAX_PX보다 긴 섹션만 나눔). 생성·편집 확인용.
 * - 전체 이미지: 780px 폭 한 장(상품등록 업로드용, 860 캔버스를 2배로 찍어 줄인다). FULL_CHUNK_MAX_PX를 넘으면 이어 붙어 보이는 조각(쿠팡 IMAGE_NO_SPACE용).
 * 한도·근거는 detailImageLimits.ts(옵시디언 쿠팡 샘플 집계, 통합 승인).
 * 파일마다 FILE_MAX_BYTES를 넘으면 품질을 JPEG_QUALITIES 순서로 내리고, 그래도 넘으면 조각을 반으로 나눈다.
 * GIF 칸(세션 B ③ P4)이 있으면 전체 이미지 목록에 그 자리만 저장된 움직이는 WebP를 그대로 끼운다(motionParts.ts). 사진 위 글로 막힌 칸은
 * motionBakeJobId가 있을 때 서버가 글을 구운 WebP를 끼운다(motionTextBake.ts — 못 구우면 포스터 JPEG). 없으면 지금과 같다.
 * 순수 계산(조각·이름·품질 사다리)은 위쪽, 브라우저 굽기(bakeDetailImages)는 아래쪽 — 테스트는 순수 계산만 import한다.
 */

import type { CanvasSection } from '@/lib/registration/editor/types/canvas'
import { PAGE_EXPORT_WIDTH } from '@/lib/registration/templatelib/template-types'
import {
  CANVAS_MAX_SIDE_PX,
  DETAIL_IMAGE_EXT,
  FILE_MAX_BYTES,
  FULL_CHUNK_MAX_PX,
  JPEG_QUALITIES,
  MIN_SECTION_IMAGE_PX,
  SLICE_MAX_PX,
  type DetailImageExt,
  type DetailImageMime,
} from './detailImageLimits'
import { collectMotionParts, motionSlotOf, type BakeMotionText, type MotionClips, type MotionPart } from './motionParts'

export {
  CANVAS_MAX_SIDE_PX,
  FILE_MAX_BYTES,
  FULL_CHUNK_MAX_PX,
  JPEG_QUALITIES,
  MIN_SECTION_IMAGE_PX,
  SLICE_MAX_PX,
}

/** 용량 때문에 더 나눌 때 조각 높이 하한(그보다 작게는 나누지 않고 실패로 본다) */
const MIN_SPLIT_PX = 400
const PREVIEW_QUALITY = 0.85

export interface Span {
  y: number
  height: number
}

/** 높이 total을 max 이하의 거의 같은 조각으로 나눈다(마지막 조각만 짧아지지 않게 고르게) */
export function splitEven(total: number, max: number): Span[] {
  const height = Math.max(0, Math.round(total))
  if (height === 0) return []
  const count = Math.max(1, Math.ceil(height / max))
  const base = Math.floor(height / count)
  const extra = height % count
  const spans: Span[] = []
  let y = 0
  for (let i = 0; i < count; i++) {
    const h = base + (i < extra ? 1 : 0)
    spans.push({ y, height: h })
    y += h
  }
  return spans
}

export interface SectionBox {
  id: string
  sectionType: string
  height: number
}

/** 섹션 비트맵이 페이지에서 차지하는 위치(그리기 원본) — 간격 없이 쌓는다 */
export function stackSpans(sections: readonly SectionBox[]): Span[] {
  let y = 0
  return sections.map((s) => {
    const span = { y, height: Math.round(s.height) }
    y += span.height
    return span
  })
}

/**
 * 섹션 이미지 — 섹션 경계마다 1장. MIN_SECTION_IMAGE_PX보다 낮은 섹션(구분선 40px 등)은 따로 내지 않고 앞 섹션 이미지에 붙인다
 * (맨 앞이면 다음 섹션에). SLICE_MAX_PX보다 긴 묶음만 고르게 나눈다. 페이지 전체를 빠짐없이 덮는다. y는 전체 페이지 기준.
 */
export function planSectionSlices(
  sections: readonly SectionBox[],
  maxPx = SLICE_MAX_PX,
  minPx = MIN_SECTION_IMAGE_PX
): Array<Span & { sectionId: string }> {
  const groups: Array<Span & { sectionId: string }> = []
  let top = 0
  let leading = 0
  for (const section of sections) {
    const h = Math.round(section.height)
    if (h < minPx && groups.length > 0) groups[groups.length - 1].height += h
    else if (h < minPx) leading += h
    else {
      groups.push({ sectionId: section.id, y: top - leading, height: h + leading })
      leading = 0
    }
    top += h
  }
  if (groups.length === 0 && top > 0) groups.push({ sectionId: sections[0].id, y: 0, height: top })
  return groups.flatMap((g) =>
    splitEven(g.height, maxPx).map((part) => ({ sectionId: g.sectionId, y: g.y + part.y, height: part.height }))
  )
}

/**
 * 정지 구간 [start, end)를 max 이하 조각으로 — 조각 수는 splitEven과 같고, 자르는 자리만 같은 높이 자리에서 가장 가까운 섹션 경계로 옮긴다
 * (AX-CT-36 — 섹션 비트맵은 간격 없이 쌓이므로 경계에서 자르면 글자가 잘리지 않는다. 11-19 구디백 03·04 제목 위 경계).
 * 경계는 조각 ≤ max이고 남은 길이를 남은 조각 수로 덮을 수 있을 때만 고른다. 맞는 경계가 없으면 같은 높이 자리(그 범위 안으로 당김).
 * 경계를 안 주거나 한 조각이면 splitEven 결과 그대로다.
 */
export function planStillCuts(start: number, end: number, boundaries: readonly number[], max: number): Span[] {
  const even = splitEven(end - start, max).map((s) => ({ y: start + s.y, height: s.height }))
  if (even.length <= 1) return even
  const inside = [...new Set(boundaries.map(Math.round))].filter((b) => b > start && b < end).sort((a, b) => a - b)
  if (inside.length === 0) return even
  const last = start + even.reduce((sum, s) => sum + s.height, 0)
  const cuts: number[] = []
  let prev = start
  for (let k = 1; k < even.length; k++) {
    const ideal = even[k].y
    const left = even.length - k
    const lo = Math.max(prev + 1, last - left * max)
    const hi = Math.min(prev + max, last - 1)
    let pick: number | null = null
    for (const b of inside) if (b >= lo && b <= hi && (pick === null || Math.abs(b - ideal) < Math.abs(pick - ideal))) pick = b
    const cut = pick ?? Math.min(hi, Math.max(lo, ideal))
    cuts.push(cut)
    prev = cut
  }
  return [start, ...cuts].map((y, i) => ({ y, height: (cuts[i] ?? last) - y }))
}

/** 전체 이미지 조각 — 한 장이면 [전체] */
export function planFullChunks(totalHeight: number, maxPx = FULL_CHUNK_MAX_PX): Span[] {
  return splitEven(totalHeight, maxPx)
}

/**
 * 전체 이미지 목록 — 움직임 칸(페이지 기준 y·높이, 위에서부터) 사이의 정지 구간마다 planFullChunks를 쓰고, 움직임 칸은 한 칸으로 둔다.
 * motion은 그 칸의 번호다. 움직임 칸이 없으면 planFullChunks(totalHeight)와 같다. 앞 칸과 겹치거나 페이지 밖인 칸은 넣지 않는다.
 * boundaries(섹션 경계 y, 페이지 기준)를 주면 정지 구간의 자르는 자리를 경계로 옮긴다(planStillCuts). 안 주면 지금 그대로다.
 */
export function planFullParts(
  totalHeight: number,
  motions: readonly Span[],
  maxPx = FULL_CHUNK_MAX_PX,
  boundaries: readonly number[] = []
): Array<Span & { motion?: number }> {
  const parts: Array<Span & { motion?: number }> = []
  let cursor = 0
  const stills = (end: number) => {
    if (end <= cursor) return
    parts.push(...planStillCuts(cursor, end, boundaries, maxPx))
  }
  motions.forEach((m, i) => {
    if (m.y < cursor || m.height <= 0 || m.y + m.height > totalHeight) return
    stills(m.y)
    parts.push({ y: m.y, height: m.height, motion: i })
    cursor = m.y + m.height
  })
  stills(Math.round(totalHeight))
  return parts
}

export interface DrawOp {
  source: number
  /** 원본(섹션 비트맵) 안의 y */
  sy: number
  /** 대상 조각 안의 y */
  dy: number
  height: number
}

/** 조각 span을 채우려면 어느 섹션 비트맵의 어느 부분을 어디에 그릴지 */
export function drawOpsFor(sources: readonly Span[], span: Span): DrawOp[] {
  const ops: DrawOp[] = []
  sources.forEach((source, index) => {
    const top = Math.max(span.y, source.y)
    const bottom = Math.min(span.y + span.height, source.y + source.height)
    if (bottom > top) ops.push({ source: index, sy: top - source.y, dy: top - span.y, height: bottom - top })
  })
  return ops
}

/** 품질 사다리 — 상한 안에 드는 첫 품질. 끝까지 넘으면 null(호출 측이 조각을 나눈다) */
export async function encodeWithinLimit(
  encode: (quality: number) => Promise<Blob>,
  maxBytes = FILE_MAX_BYTES,
  qualities: readonly number[] = JPEG_QUALITIES
): Promise<{ blob: Blob; quality: number } | null> {
  for (const quality of qualities) {
    const blob = await encode(quality)
    if (blob.size <= maxBytes) return { blob, quality }
  }
  return null
}

export interface EncodedSpan extends Span {
  blob: Blob
  quality: number
}

/** 조각마다 품질 사다리를 돌리고, 그래도 크면 반으로 나눠 다시 굽는다(순서 유지) */
export async function encodeSpans(
  spans: readonly Span[],
  encodeSpan: (span: Span, quality: number) => Promise<Blob>,
  maxBytes = FILE_MAX_BYTES
): Promise<EncodedSpan[]> {
  const out: EncodedSpan[] = []
  for (const span of spans) {
    const encoded = await encodeWithinLimit((q) => encodeSpan(span, q), maxBytes)
    if (encoded) {
      out.push({ ...span, ...encoded })
      continue
    }
    if (span.height < MIN_SPLIT_PX * 2) {
      throw new Error(
        `이미지 조각(${span.height}px)이 품질을 낮춰도 ${Math.round(maxBytes / 1024 / 1024)}MB를 넘습니다`
      )
    }
    out.push(
      ...(await encodeSpans(
        splitEven(span.height, Math.ceil(span.height / 2)).map((s) => ({ y: span.y + s.y, height: s.height })),
        encodeSpan,
        maxBytes
      ))
    )
  }
  return out
}

/** 다운로드 파일명용 상품명 — 파일 시스템 금지 문자·제어 문자 제거, 공백은 하이픈, 40자 */
export function safeProductName(name: string | null | undefined): string {
  const cleaned = (name ?? '')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 40)
    .replace(/-+$/, '')
  return cleaned || 'product'
}

/** 내려받기 파일 이름 — 전체 이미지의 GIF 칸만 ext 'webp'(섹션·미리보기는 언제나 jpg) */
export function detailFileName(
  product: string,
  kind: 'section' | 'full' | 'full-preview',
  index: number,
  count: number,
  ext: DetailImageExt = 'jpg'
): string {
  const nn = String(index + 1).padStart(2, '0')
  if (kind === 'section') return `${product}-section-${nn}.jpg`
  if (kind === 'full-preview') return `${product}-detail-full-preview.jpg`
  return count === 1 ? `${product}-detail-full.${ext}` : `${product}-detail-full-${nn}.${ext}`
}

/** 전체 이미지 한 장 — JPEG 조각(quality 있음) 또는 GIF 칸의 움직이는 WebP(quality null, 저장된 파일 그대로) */
export interface FullPart extends Span {
  blob: Blob
  quality: number | null
  mime: DetailImageMime
}

export const extOfPart = (part: Pick<FullPart, 'mime'>): DetailImageExt => DETAIL_IMAGE_EXT[part.mime]

/**
 * 전체 이미지 목록 굽기 — 정지 구간은 지금처럼 encodeSpans(품질 사다리·넘치면 나누기)로 JPEG, 움직임 칸은 받은 WebP 그대로.
 * 움직임 칸이 없으면 encodeSpans(planFullChunks(totalHeight))와 같은 조각·품질·호출 순서다.
 * boundaries(섹션 경계)를 주면 정지 구간 자르는 자리만 경계로 옮긴다(planStillCuts, AX-CT-36).
 */
export async function encodeFullParts(
  totalHeight: number,
  motions: readonly MotionPart[],
  encodeSpan: (span: Span, quality: number) => Promise<Blob>,
  maxBytes = FILE_MAX_BYTES,
  boundaries: readonly number[] = []
): Promise<FullPart[]> {
  const full: FullPart[] = []
  for (const part of planFullParts(totalHeight, motions, FULL_CHUNK_MAX_PX, boundaries)) {
    if (part.motion !== undefined) {
      full.push({ y: part.y, height: part.height, blob: motions[part.motion].blob, quality: null, mime: 'image/webp' })
      continue
    }
    for (const encoded of await encodeSpans([part], encodeSpan, maxBytes)) full.push({ ...encoded, mime: 'image/jpeg' })
  }
  return full
}

// ─────────────────────────────────────────────
// 브라우저 굽기
// ─────────────────────────────────────────────

export interface BakeResult {
  sections: EncodedSpan[]
  full: FullPart[]
  /** GIF 칸을 WebP로 넣지 못하고 포스터 JPEG로 둔 이유(섹션별) — 움직임 칸이 없으면 빈 목록 */
  motionNotes: string[]
  /** 전체가 2조각 이상일 때 이어 붙인 미리보기 1장(다운로드 전용) — 캔버스 한도를 넘으면 null */
  preview: Blob | null
  previewSkipReason: string | null
  totalHeight: number
}

function toJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('JPEG 변환 실패'))), 'image/jpeg', quality)
  )
}

function paint(bitmaps: readonly ImageBitmap[], sources: readonly Span[], span: Span): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = PAGE_EXPORT_WIDTH
  canvas.height = span.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('캔버스를 만들 수 없습니다')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  for (const op of drawOpsFor(sources, span)) {
    const bitmap = bitmaps[op.source]
    ctx.drawImage(bitmap, 0, op.sy, bitmap.width, op.height, 0, op.dy, PAGE_EXPORT_WIDTH, op.height)
  }
  return canvas
}

/** 저장된 움직이는 WebP 받기(스토리지 공개 URL — inlineExternalImages와 같은 cors 받기) */
async function fetchBlobCors(url: string): Promise<Blob> {
  const res = await fetch(url, { mode: 'cors' })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.blob()
}

/** 캔버스 메모리 즉시 반납(780×20,000 조각 하나가 약 62MB) */
function release(canvas: HTMLCanvasElement | null | undefined) {
  if (canvas) canvas.width = canvas.height = 0
}

/** 편집기 캔버스(Canvas.tsx getVisibleSortedSections)와 같은 "보이는 섹션" — 비표시·구분선·0높이 제외, order 순 */
export function bakeableSections<
  T extends Pick<CanvasSection, 'isVisible' | 'sectionType' | 'order'> & { canvas: { height: number } },
>(sections: readonly T[]): T[] {
  return [...sections]
    .sort((a, b) => a.order - b.order)
    .filter((s) => s.isVisible && s.sectionType !== 'divider' && s.canvas.height > 0)
}

/**
 * 편집기 캔버스에 그려진 섹션(bakeableSections)을 기존 섹션 내보내기와 같은 방식(withClonedCapture + dom-to-image)으로
 * 2배로 찍어 780 폭으로 줄인 뒤 섹션 이미지·전체 이미지를 만든다. 편집기 캔버스는 섹션을 간격 없이 쌓으므로(`flex flex-col`) 이어 붙이면 전체와 같다.
 * 섹션 단위로 찍는다 — dom-to-image는 한 변 16,384px를 넘는 캔버스의 배율을 낮추기 때문에 페이지 전체를 한 번에 찍지 않는다.
 * 글꼴은 섹션에 쓰인 것만 넣는다(captureToBlob·fontEmbed.ts, U1b — 매번 전체 웹폰트를 받던 것이 U1 E2E 276초의 원인).
 * 파생본 미리보기가 아닌 원본(master) 화면에서만 부른다(호출 측이 막는다).
 * motionClips(GIF 칸, 편집기 응답 motion_clips)가 있으면 전체 이미지의 그 포스터 자리를 저장된 움직이는 WebP로 바꾼다(motionParts.ts).
 * motionBakeJobId가 있으면 사진 위 글로 막힌 칸은 글 층을 한 번 더 찍어 서버가 WebP에 구운 것을 쓴다(motionTextBake.ts). 없으면 지금과 같다.
 */
export async function bakeDetailImages(
  canvasEl: HTMLElement,
  sections: readonly CanvasSection[],
  onProgress?: (pct: number) => void,
  options: { motionClips?: MotionClips; fetchBlob?: (url: string) => Promise<Blob>; motionBakeJobId?: string } = {}
): Promise<BakeResult> {
  const visible = bakeableSections(sections)
  const { withClonedCapture, captureExportBitmap } = await import('./capture')
  const clips = options.motionClips ?? {}
  const bakeJobId = Object.keys(clips).length > 0 ? options.motionBakeJobId : undefined
  const textBake = bakeJobId ? await import('./motionTextBake') : null
  /** 글 굽기 후보 칸의 글 층(찍은 섹션 번호 → PNG 또는 못 찍은 까닭) — 복제본이 살아 있을 때 찍어 둔다 */
  const overlays = new Map<number, Blob | { skip: string }>()

  const bitmaps: ImageBitmap[] = []
  const boxes: SectionBox[] = []
  const captured: CanvasSection[] = []
  // 같은 조각은 한 번만 그리고 품질 단계마다 다시 쓴다(오류가 나도 finally에서 반납)
  const painted: { key: string; canvas: HTMLCanvasElement | null } = { key: '', canvas: null }
  try {
    await withClonedCapture(canvasEl, async (clone) => {
      for (let i = 0; i < visible.length; i++) {
        const section = visible[i]
        const el = clone.querySelector<HTMLElement>(`[data-section-id="${section.id}"]`)
        if (!el) continue
        const bitmap = await captureExportBitmap(el, { bgcolor: el.style.backgroundColor || '#ffffff' })
        bitmaps.push(bitmap)
        boxes.push({ id: section.id, sectionType: String(section.sectionType), height: bitmap.height })
        captured.push(section)
        if (textBake) {
          const r = motionSlotOf(section, clips, bitmap.height, { allowCovered: true })
          if (r && 'slot' in r && r.cover) {
            overlays.set(captured.length - 1, await textBake.captureOverlayLayer(el, section, r.cover.photoId, r.slot, captureExportBitmap))
          }
        }
        onProgress?.(Math.round(((i + 1) / visible.length) * 50))
      }
    })
    if (bitmaps.length === 0) throw new Error('구울 섹션이 없습니다')

    const sources = stackSpans(boxes)
    const totalHeight = boxes.reduce((sum, b) => sum + b.height, 0)
    const encode = (span: Span, quality: number) => {
      const key = `${span.y}:${span.height}`
      if (!painted.canvas || painted.key !== key) {
        release(painted.canvas)
        painted.key = key
        painted.canvas = paint(bitmaps, sources, span)
      }
      return toJpeg(painted.canvas, quality)
    }

    const sectionImages = await encodeSpans(planSectionSlices(boxes), encode)
    onProgress?.(75)
    const bakeText: BakeMotionText | undefined =
      textBake && bakeJobId
        ? async ({ index, slot }) => {
            const overlay = overlays.get(index)
            if (!overlay) return { skip: '글 층을 찍지 않음' }
            if ('skip' in overlay) return overlay
            const still = await textBake.stillOfSlot(bitmaps[index], slot)
            return textBake.requestMotionBake(bakeJobId, { webpUrl: slot.clip.webpUrl, overlay, still })
          }
        : undefined
    const motion =
      Object.keys(clips).length > 0
        ? await collectMotionParts(captured, sources, clips, options.fetchBlob ?? fetchBlobCors, bakeText ? { bakeText } : {})
        : { parts: [], notes: [] }
    // 전체 조각은 섹션 경계에서 자른다(AX-CT-36) — 비트맵이 간격 없이 쌓여 경계가 곧 섹션 사이다
    const full = await encodeFullParts(totalHeight, motion.parts, encode, FILE_MAX_BYTES, sources.map((s) => s.y))
    release(painted.canvas)
    painted.canvas = null
    onProgress?.(90)

    let preview: Blob | null = null
    let previewSkipReason: string | null = null
    if (full.length > 1) {
      if (totalHeight <= CANVAS_MAX_SIDE_PX) {
        const whole = paint(bitmaps, sources, { y: 0, height: totalHeight })
        preview = await toJpeg(whole, PREVIEW_QUALITY).finally(() => release(whole))
      } else {
        previewSkipReason = `총 높이 ${totalHeight.toLocaleString()}px가 브라우저 캔버스 한도 ${CANVAS_MAX_SIDE_PX.toLocaleString()}px를 넘어 이어 붙인 미리보기를 만들지 않았습니다`
      }
    }
    onProgress?.(100)
    return { sections: sectionImages, full, motionNotes: motion.notes, preview, previewSkipReason, totalHeight }
  } finally {
    release(painted.canvas)
    bitmaps.forEach((b) => b.close())
  }
}
