/**
 * 업로드 준비 묶음(AX-CT-37 — 오너 2026-11-20 18:4x "지난번처럼 이미지 업로드를 바로 할 수 있도록 굽는 작업을 알아서").
 * 굽기·저장 창의 전체 이미지 조각을 쿠팡 Wing 상세설명 '이미지 업로드'에 바로 올리는 꼴로 한 ZIP 에 담는다.
 *   - 파일 이름 = 올릴 순서(01.jpg · 02.webp …). 이어 붙인 미리보기는 넣지 않는다.
 *   - 움직이는 WebP 는 서버 /opaque-webp 로 투명도 없는 판으로 바꿔 넣는다(11-16 실측: 그 꼴이 이미지 업로드에서 움직였다).
 *     못 바꾸면 원본을 넣고 까닭을 남긴다(묶음은 만든다).
 *   - '올리는 법.txt' — 순서·방식·바꾸기 전 캡처·되돌리기.
 * 지금 있는 '전체 조각 ZIP'·저장·Wing HTML 길은 그대로다(이 파일은 그것들을 부르지 않는다).
 */

import { DETAIL_IMAGE_EXT } from './detailImageLimits'

export interface PackPart {
  blob: Blob
  mime: keyof typeof DETAIL_IMAGE_EXT
}

export const UPLOAD_GUIDE_NAME = '올리는 법.txt'

/** 올릴 순서 이름 — 99장 넘으면 세 자리 */
export function uploadPackName(index: number, total: number, ext: string): string {
  return `${String(index + 1).padStart(total > 99 ? 3 : 2, '0')}.${ext}`
}

export interface GuideInput {
  productName: string
  fileNames: readonly string[]
  motionFiles: readonly string[]
  notes: readonly string[]
}

/** 오너용 안내 글 — 묶음 안 '올리는 법.txt' */
export function uploadPackGuide({ productName, fileNames, motionFiles, notes }: GuideInput): string {
  return [
    `${productName} — 쿠팡 상세설명 이미지 업로드 묶음`,
    '',
    `올릴 파일 ${fileNames.length}장(이 순서대로): ${fileNames.join(' → ')}`,
    motionFiles.length > 0 ? `움직이는 칸: ${motionFiles.join(', ')} (투명도 없는 판 — 이미지 업로드로 올리면 움직입니다)` : '움직이는 칸: 없음',
    '',
    '올리는 법',
    '1. 바꾸기 전에 지금 Wing 상세설명을 캡처해 둡니다(되돌릴 때 씀).',
    "2. Wing → 상품 수정 → 상세설명 등록 방식을 '이미지 업로드'로 둡니다. (HTML 로 넣으면 움직이는 칸이 정지 그림이 됩니다)",
    '3. 있던 이미지를 지우고 위 순서대로 올린 뒤 저장합니다. 조각은 간격 없이 이어 붙어 한 장처럼 보입니다.',
    '4. 반영 뒤 실제 상품 화면에서 움직이는 칸과 조각 사이 틈을 봅니다.',
    '',
    '되돌리기: 1번에서 캡처해 둔 옛 상세를 같은 방식으로 다시 넣습니다.',
    `이 글 파일(${UPLOAD_GUIDE_NAME})은 올리지 않습니다.`,
    ...(notes.length > 0 ? ['', '알림', ...notes.map((n) => `- ${n}`)] : []),
    '',
  ].join('\r\n')
}

export interface BuildPackDeps {
  /** 움직이는 WebP → 투명도 없는 판(서버). 던지면 원본을 넣는다 */
  opaque: (blob: Blob) => Promise<Blob>
  zip: (files: Array<{ name: string; blob: Blob }>) => Promise<Blob>
}

export interface UploadPack {
  zip: Blob
  files: string[]
  motionFiles: string[]
  notes: string[]
}

/** 전체 이미지 조각(굽기 결과 순서) → 업로드 준비 묶음 */
export async function buildUploadPack(parts: readonly PackPart[], productName: string, deps: BuildPackDeps): Promise<UploadPack> {
  if (parts.length === 0) throw new Error('구운 전체 이미지가 없습니다.')
  const files: Array<{ name: string; blob: Blob }> = []
  const motionFiles: string[] = []
  const notes: string[] = []
  for (const [i, part] of parts.entries()) {
    const name = uploadPackName(i, parts.length, DETAIL_IMAGE_EXT[part.mime])
    let blob = part.blob
    if (part.mime === 'image/webp') {
      motionFiles.push(name)
      try {
        blob = await deps.opaque(part.blob)
      } catch (e) {
        notes.push(`${name}: 투명도 없는 판으로 바꾸지 못해 원본을 넣었습니다(${e instanceof Error ? e.message : String(e)}) — 쿠팡에서 정지 그림이 될 수 있습니다.`)
      }
    }
    files.push({ name, blob })
  }
  const names = files.map((f) => f.name)
  const guide = uploadPackGuide({ productName, fileNames: names, motionFiles, notes })
  files.push({ name: UPLOAD_GUIDE_NAME, blob: new Blob([guide], { type: 'text/plain;charset=utf-8' }) })
  return { zip: await deps.zip(files), files: names, motionFiles, notes }
}

/** 서버에 투명도 없는 판을 청한다 — 200 image/webp 가 아니면 던진다 */
export async function requestOpaqueWebp(jobId: string, blob: Blob, fetchImpl: typeof fetch = fetch): Promise<Blob> {
  const res = await fetchImpl(`/api/registration/pdp/${encodeURIComponent(jobId)}/opaque-webp`, {
    method: 'POST',
    headers: { 'Content-Type': 'image/webp' },
    body: blob,
  })
  const type = res.headers.get('content-type') ?? ''
  if (!res.ok || !type.startsWith('image/webp')) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null
    throw new Error(body?.error ?? `HTTP ${res.status}`)
  }
  return new Blob([await res.arrayBuffer()], { type: 'image/webp' })
}
