/**
 * 레퍼런스 원본 준비 — 긴 캡처를 띠로 자르고(sharp), PDF는 머리·쪽 수만 확인한다(PDF 자체는 모델 문서 입력으로 보낸다).
 * 띠 위치는 페이지 세로 %로 남겨 모델이 '어느 구간인지'를 알게 한다. 파일은 메모리에서만 다루고 저장하지 않는다.
 */

import sharp from 'sharp'
import { planStrips, stripPercent } from './reference-plan'
import { REFERENCE_LIMITS } from './reference-types'

// 띠 계획은 화면 띠 자르기와 같은 순수 함수를 쓴다(reference-plan) — 이 모듈은 sharp라 서버 전용이다
export { planStrips, type StripPlan } from './reference-plan'

export interface ReferenceStrip {
  data: string
  mediaType: 'image/jpeg'
  /** 페이지 세로 위치(%) */
  start: number
  end: number
}

/** 긴 캡처 → 띠(JPEG base64). 폭이 너무 좁거나 읽을 수 없으면 error */
export async function sliceReferenceImage(
  bytes: Uint8Array
): Promise<{ strips: ReferenceStrip[]; sampled: boolean } | { error: string }> {
  let meta: sharp.Metadata
  try {
    meta = await sharp(bytes).metadata()
  } catch {
    return { error: '이미지를 읽지 못했습니다.' }
  }
  if (!meta.width || !meta.height) return { error: '이미지 크기를 읽지 못했습니다.' }
  if (meta.width < REFERENCE_LIMITS.imageMinWidth) {
    return { error: `캡처 폭이 너무 좁습니다(최소 ${REFERENCE_LIMITS.imageMinWidth}px).` }
  }
  const width = Math.min(REFERENCE_LIMITS.stripWidth, meta.width)
  let resized: { data: Buffer; info: sharp.OutputInfo }
  try {
    // sharp 기본 픽셀 상한(약 2.7억 화소)을 그대로 둔다 — 압축 폭탄 이미지를 받지 않는다
    resized = await sharp(bytes).resize({ width, withoutEnlargement: true }).toBuffer({ resolveWithObject: true })
  } catch {
    return { error: '이미지가 너무 크거나 손상되어 처리하지 못했습니다.' }
  }
  const pageHeight = resized.info.height
  const plan = planStrips(pageHeight)
  const strips: ReferenceStrip[] = []
  for (const s of plan.strips) {
    const height = Math.min(s.height, pageHeight - s.top)
    const jpeg = await sharp(resized.data)
      .extract({ left: 0, top: s.top, width: resized.info.width, height })
      .jpeg({ quality: 80 })
      .toBuffer()
    strips.push({ data: jpeg.toString('base64'), mediaType: 'image/jpeg', ...stripPercent(s.top, height, pageHeight) })
  }
  return { strips, sampled: plan.sampled }
}

/**
 * PDF 확인 — 머리(%PDF-)와 쪽 수. 쪽 객체(/Type /Page)를 세고, 압축 객체 스트림이라 못 세면 /Count 최댓값을 본다.
 * 그래도 모르면 pages=null(쪽 수 미확인 — 바이트 상한만 적용하고 경고를 남긴다)
 */
export function inspectPdf(bytes: Uint8Array): { pages: number | null } | { error: string } {
  const head = Buffer.from(bytes.subarray(0, 5)).toString('latin1')
  if (head !== '%PDF-') return { error: 'PDF 파일이 아닙니다.' }
  const text = Buffer.from(bytes).toString('latin1')
  const pageObjects = (text.match(/\/Type\s*\/Page(?![a-zA-Z])/g) ?? []).length
  if (pageObjects > 0) return { pages: pageObjects }
  const counts = [...text.matchAll(/\/Count\s+(\d+)/g)].map((m) => Number(m[1]))
  return { pages: counts.length > 0 ? Math.max(...counts) : null }
}

/** 업로드 바이트 → 종류. PNG·JPEG·WebP 이미지, PDF가 아니면 null */
export function sniffReferenceType(bytes: Uint8Array): 'image' | 'pdf' | null {
  const b = bytes
  if (b.length >= 5 && Buffer.from(b.subarray(0, 5)).toString('latin1') === '%PDF-') return 'pdf'
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image'
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image'
  if (b.length >= 12 && Buffer.from(b.subarray(0, 4)).toString('latin1') === 'RIFF' && Buffer.from(b.subarray(8, 12)).toString('latin1') === 'WEBP') {
    return 'image'
  }
  return null
}
