/**
 * 첫 칸 글 굽기 — 브라우저 쪽(세션 B, 설계 work/pdp-b/motion-text-bake/DESIGN.md).
 * 움직이는 칸 사진 위에 제목 같은 요소가 얹혀 있으면(motionParts COVERED_REASON) 그 칸의 글 층만 투명 PNG로 찍고,
 * 지금 찍은 정지 칸 그림(JPEG)과 함께 서버 POST /api/registration/pdp/[jobId]/motion-bake로 보낸다.
 * 서버가 저장된 움직이는 WebP 프레임마다 글을 굽고 첫 프레임을 정지 칸과 대조해 돌려준다. 못 구우면 { skip }이고 그 칸은 지금처럼 포스터 JPEG다.
 *
 * 편집기 DOM에는 요소 id가 없다. CanvasSection.tsx는 섹션 div 첫 자식(클리핑 래퍼) 안에 보이는 요소를 zIndex 순(같으면 원래 순서)으로 그린다.
 * 그래서 복제본의 그 자식 순서와 zIndex 인라인 값을 같은 순서의 요소 목록과 대조하고, 맞지 않으면 굽지 않는다(지금처럼 포스터).
 * 순수 계산(층 고르기·대조·base64·응답 읽기)은 위쪽, 브라우저 찍기는 아래쪽 — 시험은 순수 계산만 import한다.
 */

import type { CanvasElement, CanvasSection } from '@/lib/registration/editor/types/canvas'
import { PAGE_EXPORT_WIDTH } from '@/lib/registration/templatelib/template-types'
import type { MotionSlot } from './motionParts'

/** 정지 칸 JPEG 품질 — 첫 프레임 판독용(서버 dHash)이라 높지 않아도 된다 */
const STILL_QUALITY = 0.85

/** CanvasSection.tsx와 같은 그리기 순서 — 보이는 요소만, zIndex 오름차순(같으면 원래 순서) */
export function paintOrderOf(section: CanvasSection): CanvasElement[] {
  return section.elements.filter((el) => el.isVisible).sort((a, b) => a.zIndex - b.zIndex)
}

/**
 * 글 층에서 숨길 요소 번호(그리기 순서) — 사진과 그보다 먼저 그려진 것(사진 밑에 깔린 것). 사진이 없으면 null.
 * 사진보다 뒤에 그려진 것(위에 얹힌 제목·띠·로고)만 글 층에 남는다.
 */
export function hiddenLayerIndices(section: CanvasSection, photoId: string): number[] | null {
  const order = paintOrderOf(section)
  const at = order.findIndex((el) => el.id === photoId)
  if (at < 0) return null
  return order.slice(0, at + 1).map((_, i) => i)
}

/** 복제본 래퍼 자식의 zIndex 인라인 값이 그리기 순서와 하나씩 맞는지 — 개수·값이 다르면 굽지 않는다 */
export function layersMatch(nodeZ: readonly string[], section: CanvasSection): boolean {
  const order = paintOrderOf(section)
  return nodeZ.length === order.length && order.every((el, i) => nodeZ[i] === String(el.zIndex))
}

/** 바이트 → base64(큰 배열도 스택을 넘지 않게 나눠서) */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  return btoa(binary)
}

/** 서버 굽기 응답 읽기 — image/webp면 구운 파일, 아니면 { skip: 까닭 }(오류·HTTP 실패도 까닭으로) */
export async function readMotionBakeResponse(res: Response): Promise<Blob | { skip: string }> {
  const type = res.headers.get('content-type') ?? ''
  if (res.ok && type.startsWith('image/webp')) return new Blob([await res.arrayBuffer()], { type: 'image/webp' })
  const json = (await res.json().catch(() => ({}))) as { skip?: unknown; error?: unknown }
  if (typeof json.skip === 'string') return { skip: json.skip }
  if (typeof json.error === 'string') return { skip: json.error }
  return { skip: `HTTP ${res.status}` }
}

/** 서버에 굽기 요청 — 던지지 않는다(받기 실패도 { skip }) */
export async function requestMotionBake(
  jobId: string,
  input: { webpUrl: string; overlay: Blob; still: Blob },
  fetchImpl: typeof fetch = fetch
): Promise<Blob | { skip: string }> {
  try {
    const b64 = async (blob: Blob) => bytesToBase64(new Uint8Array(await blob.arrayBuffer()))
    const res = await fetchImpl(`/api/registration/pdp/${encodeURIComponent(jobId)}/motion-bake`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ webpUrl: input.webpUrl, overlay: await b64(input.overlay), still: await b64(input.still) }),
    })
    return await readMotionBakeResponse(res)
  } catch (err) {
    return { skip: `굽기 요청 실패(${err instanceof Error ? err.message : String(err)})` }
  }
}

// ─────────────────────────────────────────────
// 브라우저 찍기
// ─────────────────────────────────────────────

function toBlobOf(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error(`${type} 변환 실패`))), type, quality)
  )
}

/** 섹션 비트맵(780 폭)에서 칸 자리만 잘라 낸다 */
async function cropSlot(bitmap: ImageBitmap, slot: MotionSlot, type: 'image/png' | 'image/jpeg', quality?: number): Promise<Blob> {
  const canvas = document.createElement('canvas')
  canvas.width = PAGE_EXPORT_WIDTH
  canvas.height = slot.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('캔버스를 만들 수 없습니다')
  if (type === 'image/jpeg') {
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
  }
  ctx.drawImage(bitmap, 0, slot.top, bitmap.width, slot.height, 0, 0, PAGE_EXPORT_WIDTH, slot.height)
  try {
    return await toBlobOf(canvas, type, quality)
  } finally {
    canvas.width = canvas.height = 0
  }
}

/** 지금 찍은 섹션 비트맵의 칸 자리 = 정지 칸 그림(포스터 + 글) */
export function stillOfSlot(bitmap: ImageBitmap, slot: MotionSlot): Promise<Blob> {
  return cropSlot(bitmap, slot, 'image/jpeg', STILL_QUALITY)
}

/**
 * 글 층 찍기 — 복제본 섹션(sectionEl)에서 사진과 그 밑 요소를 숨기고 바탕을 투명으로 둔 채 한 번 더 찍어 칸 자리만 PNG로 자른다.
 * 찍은 뒤 숨긴 것·바탕은 되돌린다(같은 복제본을 다른 섹션이 쓴다). 층이 맞지 않으면 { skip }.
 */
export async function captureOverlayLayer(
  sectionEl: HTMLElement,
  section: CanvasSection,
  photoId: string,
  slot: MotionSlot,
  capture: (node: HTMLElement, options: { bgcolor?: string }) => Promise<ImageBitmap>
): Promise<Blob | { skip: string }> {
  const wrapper = sectionEl.firstElementChild
  const nodes = wrapper ? (Array.from(wrapper.children) as HTMLElement[]) : []
  if (!layersMatch(nodes.map((n) => n.style.zIndex), section)) return { skip: '편집기 요소 층이 섹션 기록과 맞지 않음' }
  const hide = hiddenLayerIndices(section, photoId)
  if (!hide) return { skip: '사진 요소를 찾지 못함' }
  const saved = hide.map((i) => ({ node: nodes[i], visibility: nodes[i].style.visibility }))
  const sectionCss = sectionEl.style.cssText
  saved.forEach((s) => (s.node.style.visibility = 'hidden'))
  sectionEl.style.background = 'transparent'
  sectionEl.style.backgroundColor = 'transparent'
  let bitmap: ImageBitmap | null = null
  try {
    bitmap = await capture(sectionEl, {})
    return await cropSlot(bitmap, slot, 'image/png')
  } catch (err) {
    return { skip: `글 층을 찍지 못함(${err instanceof Error ? err.message : String(err)})` }
  } finally {
    bitmap?.close()
    saved.forEach((s) => (s.node.style.visibility = s.visibility))
    sectionEl.style.cssText = sectionCss
  }
}
