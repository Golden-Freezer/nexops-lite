/**
 * 상세 이미지 굽기의 GIF 칸(움직이는 띠) — 세션 B ③ P4, 통합 gif-delivery 10절(실제 상품 DOM 확인, 11-06 00:4x).
 * 쿠팡 상세는 이미지 업로드(IMAGE_NO_SPACE) 목록이고, 그 안의 움직이는 WebP는 다시 인코딩되지 않고 그대로 움직인다.
 * 그래서 전체 이미지 목록을 [JPEG 조각, 움직이는 WebP, JPEG 조각 …]으로 만든다(bakeDetailImages planFullParts).
 * 움직이는 칸은 저장된 WebP를 그대로 넣는다. 사진 위 글(제목 등)로만 막힌 칸은 글 굽기 콜백이 있으면 그 글을 서버(motion-bake 라우트,
 * motion/text-bake.ts)가 프레임마다 구운 WebP를 넣는다(브라우저에는 움직이는 WebP 인코더가 없다). 편집기 화면·섹션 이미지·이어 붙인 미리보기는 포스터 그대로다.
 *
 * 자리를 못 맞추면 그 칸은 지금처럼 포스터가 든 JPEG로 남고 이유를 남긴다 — 풀폭·같은 비율·돌림/자르기/모서리 없음·위에 얹은 요소 없음
 * (얹은 요소는 굽기 콜백이 없거나 굽지 못했을 때만 — COVERED_REASON).
 * 이 파일은 브라우저 API 없이 계산만 한다(받기는 호출부가 넘긴다).
 */

import type { CanvasElement, CanvasSection } from '@/lib/registration/editor/types/canvas'
import type { MotionClip } from '@/lib/registration/editor/types/editor'
import { PAGE_DESIGN_WIDTH, toExportHeight } from '@/lib/registration/templatelib/template-types'
import { FILE_MAX_BYTES, MOTION_PAGE_MAX_BYTES } from './detailImageLimits'

/** 사진 비율 허용 차(상대) — 편집기 사진 상자와 WebP의 세로/가로가 이만큼 안이면 이음새 없이 바꿔 넣는다 */
const ASPECT_TOLERANCE = 0.01

export type MotionClips = Readonly<Record<string, MotionClip>>

/** 섹션 비트맵(780 폭) 안 움직임 자리 */
export interface MotionSlot {
  top: number
  height: number
  clip: MotionClip
}

/** 페이지(전체 이미지) 기준 움직임 칸 — 받은 WebP를 싣는다 */
export interface MotionPart {
  y: number
  height: number
  blob: Blob
}

function photoOf(el: CanvasElement): { src: string; misfit: string | null } | null {
  if (el.type === 'framed-image' && el.framedImageProps) {
    const p = el.framedImageProps
    // 원 틀은 clipPath 없이 frameId로 깎는다(build.ts image)
    const misfit = p.cropRect
      ? '잘라 낸 사진'
      : p.frameId === 'circle' || p.clipPath !== 'none' || (p.borderWidth ?? 0) > 0
        ? '모서리·테두리가 있는 사진'
        : null
    return { src: p.src, misfit }
  }
  if (el.type === 'image' && el.imageProps) {
    const p = el.imageProps
    const misfit = p.cropRect ? '잘라 낸 사진' : p.borderRadii?.some((r) => r > 0) ? '모서리가 있는 사진' : null
    return { src: p.src, misfit }
  }
  return null
}

const clipOf = (clips: MotionClips, src: string): MotionClip | undefined =>
  Object.hasOwn(clips, src) ? clips[src] : undefined

/** 이유 글에 남길 포스터 파일 이름 — 주소의 마지막 조각만(쿼리 없이, 60자까지) */
const fileNameOf = (url: string) => (url.split(/[?#]/)[0].split('/').pop() || url).slice(0, 60)

const overlaps = (a: CanvasElement['transform'], b: CanvasElement['transform']) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height

/** 사진 요소를 WebP로 바꿔 넣어도 화면과 같아지는지 — 아니면 이유 */
function misfitOf(section: CanvasSection, el: CanvasElement, clip: MotionClip, photoMisfit: string | null): string | null {
  const t = el.transform
  if (photoMisfit) return photoMisfit
  if (t.rotation !== 0) return '돌린 사진'
  if (el.opacity < 1) return '투명도를 바꾼 사진'
  if (t.x > 1 || t.x + t.width < PAGE_DESIGN_WIDTH - 1) return '풀폭이 아닌 사진'
  if (t.y < 0 || t.y + t.height > section.canvas.height) return '섹션 밖으로 나간 사진'
  const want = clip.height / clip.width
  if (Math.abs(t.height / t.width - want) / want > ASPECT_TOLERANCE) return '사진 비율이 움직이는 칸과 다름'
  const covered = section.elements.some((o) => o !== el && o.isVisible && o.zIndex > el.zIndex && overlaps(o.transform, t))
  return covered ? COVERED_REASON : null
}

/** 사진 위에 더 높은 요소(제목 등)가 겹친 칸 — 글 굽기 콜백이 있으면 굽기 후보, 없으면 지금처럼 건너뛴다 */
export const COVERED_REASON = '사진 위에 얹은 요소가 있음'

/** 칸 자리 — cover가 있으면 사진 위 글을 프레임에 구워야 화면과 같다(photoId = 그 사진 요소) */
export type MotionSlotResult = { slot: MotionSlot; cover?: { photoId: string } } | { skip: string } | null

/**
 * 섹션 안 움직임 칸 자리. 포스터가 motion_clips에 있는 사진 요소가 없으면 null(지금 그대로),
 * 있는데 바꿔 넣을 수 없으면 { skip: 이유 }. 섹션에 둘 이상이면 맨 위 하나만 본다(고른 칸은 섹션마다 한 칸 — motion/pick clampPicks).
 * exportHeight = 이 섹션 비트맵 높이(780 폭 기준) — 자리가 그 밖으로 나가면 넣지 않는다.
 * allowCovered면 막힌 까닭이 '사진 위에 얹은 요소'뿐인 칸을 { slot, cover }로 돌려준다(첫 칸 글 굽기). 아니면 지금과 같다.
 */
export function motionSlotOf(
  section: CanvasSection,
  clips: MotionClips,
  exportHeight: number,
  opts: { allowCovered?: boolean } = {}
): MotionSlotResult {
  const found = motionPhotoOf(section, clips)
  if (!found?.photo) return null
  const clip = clipOf(clips, found.photo.src)!
  const reason = misfitOf(section, found.el, clip, found.photo.misfit)
  const covered = reason === COVERED_REASON && opts.allowCovered === true
  if (reason && !covered) return { skip: reason }
  const top = toExportHeight(found.el.transform.y)
  const bottom = toExportHeight(found.el.transform.y + found.el.transform.height)
  if (bottom <= top || bottom > exportHeight) return { skip: '섹션 밖으로 나간 사진' }
  return { slot: { top, height: bottom - top, clip }, ...(covered ? { cover: { photoId: found.el.id } } : {}) }
}

/** 섹션의 움직임 칸 후보 사진 — 포스터가 motion_clips에 있는 보이는 사진 요소 중 맨 위 하나(motionSlotOf·미리보기 재생이 같은 자리를 본다) */
function motionPhotoOf(section: CanvasSection, clips: MotionClips) {
  return section.elements
    .filter((el) => el.isVisible)
    .map((el) => ({ el, photo: photoOf(el) }))
    .filter((x) => x.photo && clipOf(clips, x.photo.src))
    .sort((a, b) => a.el.transform.y - b.el.transform.y)[0]
}

/**
 * 편집기 미리보기 재생(결정 카드 c30) — 내보내기가 움직이는 WebP로 바꿔 넣는 칸의 사진 요소 id → WebP 주소.
 * 사진 위 글로 막힌 칸(첫 칸 글 굽기 후보)도 넣는다 — 미리보기는 글 요소가 사진 위에 그대로 얹혀 구운 결과와 같아 보인다(서버가 못 구우면 내보내기는 포스터).
 * 바꿔 넣지 못하는 칸(잘림·돌림·풀폭 아님·비율 다름 등)은 내보내기처럼 포스터 그대로라 넣지 않는다. 보이는 섹션만(bakeableSections와 같은 기준).
 */
export function previewMotionSrcs(sections: readonly CanvasSection[], clips: MotionClips): Record<string, string> {
  const out: Record<string, string> = {}
  for (const section of sections) {
    if (!section.isVisible || section.sectionType === 'divider' || section.canvas.height <= 0) continue
    const r = motionSlotOf(section, clips, toExportHeight(section.canvas.height), { allowCovered: true })
    if (!r || !('slot' in r)) continue
    out[motionPhotoOf(section, clips)!.el.id] = r.slot.clip.webpUrl
  }
  return out
}

/**
 * 사진 위 글을 움직이는 칸에 굽는 콜백(bakeDetailImages가 넘긴다) — 구운 WebP 또는 { skip: 까닭 }.
 * index = collectMotionParts에 넘긴 섹션 번호.
 */
export type BakeMotionText = (input: { index: number; slot: MotionSlot; photoId: string }) => Promise<Blob | { skip: string }>

/** 페이지 움직임 합 예산 — 넘으면 뒤 칸부터 뺀다(motion/encode.ts fitPageBudget과 같은 규칙). 뺄 번호를 돌려준다 */
export function overMotionBudget(bytes: readonly number[], max = MOTION_PAGE_MAX_BYTES): number[] {
  let total = bytes.reduce((s, b) => s + b, 0)
  const out: number[] = []
  for (let i = bytes.length - 1; i >= 0 && total > max; i--) {
    total -= bytes[i]
    out.unshift(i)
  }
  return out
}

/** RIFF····WEBP 머리 — 받은 파일이 WebP인지 */
export function isWebpHeader(head: Uint8Array): boolean {
  const ascii = (from: number, to: number) => String.fromCharCode(...head.subarray(from, to))
  return head.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP'
}

/**
 * 구운 섹션들(보이는 순서, 비트맵 자리 sources)에서 움직임 칸을 찾아 WebP를 받는다.
 * 받지 못하거나·WebP가 아니거나·파일 상한을 넘거나·페이지 합 예산을 넘는 칸은 넣지 않고 notes에 이유를 남긴다(그 칸은 포스터 JPEG).
 * motion_clips에는 있는데 구운 섹션의 보이는 사진 어디에도 그 포스터 URL이 없는 칸도 이유를 남긴다(받기·자리는 그대로, 세션 B ③ P4 확인).
 * clips가 비면 아무것도 받지 않는다.
 * opts.bakeText가 있으면 사진 위 글만으로 막힌 칸은 받지 않고 그 콜백으로 구운 WebP를 쓴다(같은 파일·머리·예산 검사).
 * 콜백이 없으면 지금처럼 그 칸은 포스터 JPEG이고 이유를 남긴다.
 */
export async function collectMotionParts(
  sections: readonly CanvasSection[],
  sources: ReadonlyArray<{ y: number; height: number }>,
  clips: MotionClips,
  fetchBlob: (url: string) => Promise<Blob>,
  opts: { bakeText?: BakeMotionText } = {}
): Promise<{ parts: MotionPart[]; notes: string[] }> {
  const notes: string[] = []
  const found: Array<{ y: number; height: number; clip: MotionClip; label: string; bake?: { index: number; slot: MotionSlot; photoId: string } }> = []
  const shown = new Set<string>()
  sections.forEach((section, i) => {
    const source = sources[i]
    if (!source) return
    for (const el of section.elements) {
      const src = el.isVisible ? photoOf(el)?.src : undefined
      if (src) shown.add(src)
    }
    const r = motionSlotOf(section, clips, source.height, { allowCovered: Boolean(opts.bakeText) })
    const label = `${i + 1}번째 섹션`
    if (r && 'skip' in r) notes.push(`${label}: ${r.skip}`)
    else if (r) {
      const bake = r.cover ? { index: i, slot: r.slot, photoId: r.cover.photoId } : undefined
      found.push({ y: source.y + r.slot.top, height: r.slot.height, clip: r.slot.clip, label, ...(bake ? { bake } : {}) })
    }
  })
  const missing = Object.keys(clips).filter((poster) => !shown.has(poster))
  if (missing.length > 0) notes.push(`움직이는 칸 ${missing.length}개: 포스터와 같은 사진이 페이지에 없음(${missing.map(fileNameOf).join(', ')})`)

  const fetched: Array<{ part: MotionPart; label: string }> = []
  for (const f of found) {
    try {
      let blob: Blob
      if (f.bake && opts.bakeText) {
        const baked = await opts.bakeText(f.bake)
        if ('skip' in baked) throw new Error(`사진 위 글을 굽지 못함: ${baked.skip}`)
        blob = baked
      } else blob = await fetchBlob(f.clip.webpUrl)
      if (blob.size > FILE_MAX_BYTES) throw new Error(`파일이 ${Math.round(FILE_MAX_BYTES / 1024 / 1024)}MB를 넘음`)
      if (!isWebpHeader(new Uint8Array(await blob.slice(0, 12).arrayBuffer()))) throw new Error('WebP가 아님')
      fetched.push({ part: { y: f.y, height: f.height, blob: new Blob([blob], { type: 'image/webp' }) }, label: f.label })
    } catch (err) {
      notes.push(`${f.label}: 움직이는 WebP를 쓰지 못함(${err instanceof Error ? err.message : String(err)})`)
    }
  }

  const drop = new Set(overMotionBudget(fetched.map((f) => f.part.blob.size)))
  drop.forEach((i) => notes.push(`${fetched[i].label}: 페이지 움직임 합 ${Math.round(MOTION_PAGE_MAX_BYTES / 1024)}KB를 넘음`))
  return { parts: fetched.filter((_, i) => !drop.has(i)).map((f) => f.part), notes }
}
