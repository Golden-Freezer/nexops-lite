/**
 * images 단계 참조 사진 업스케일 — NEXFIT agents/image_loading.py load_product_image(LANCZOS 확대) 이식.
 * 긴 변이 REFERENCE_MIN_LONG_SIDE(500) 미만인 참조만 생성 전에 긴 변 500으로 키운다(비율 유지). NEXFIT은 모든 참조를
 * 1024 흰 캔버스로 정규화하지만 여기서는 저해상도 참조만 바꾸고, 500 이상인 참조는 바이트 그대로 넘긴다.
 * 실패(디코드 불가·지원 밖 형식)는 원본을 그대로 돌려준다 — 생성을 막지 않는다.
 */

import type { VisionImage, VisionMediaType } from '@/lib/agents/registration/thumbnail-vision-agent'
import { REFERENCE_MIN_LONG_SIDE, isLowResolutionImage } from './reference-image-quality'

/** 디코더 이름 → 출력 형식. 생성 참조로 넘기는 세 형식만 다룬다(그 밖은 원본 그대로) */
const OUTPUT_MEDIA_TYPE: Record<string, VisionMediaType> = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
}
const LOSSY_QUALITY = 92

/** sharp를 불러오지 못하면(배포 번들 누락 등) 업스케일이 조용히 꺼지지 않게 한 번 남긴다 — 디코드 실패는 입력 문제라 남기지 않는다 */
let sharpLoadWarned = false

async function loadSharp() {
  try {
    return (await import('sharp')).default
  } catch (e) {
    if (!sharpLoadWarned) {
      sharpLoadWarned = true
      console.warn(
        `[registration/pdp-image] sharp 로드 실패 — 저해상도 참조 업스케일 생략: ${e instanceof Error ? e.name : typeof e}`
      )
    }
    return null
  }
}

/** 저해상도 참조를 긴 변 500으로 키운 새 참조 — 바꿀 필요가 없거나 실패하면 받은 참조를 그대로 돌려준다 */
export async function upscaleLowResReference(ref: VisionImage): Promise<VisionImage> {
  const sharp = await loadSharp()
  if (!sharp) return ref
  try {
    const input = Buffer.from(ref.data, 'base64')
    const meta = await sharp(input).metadata()
    const mediaType = OUTPUT_MEDIA_TYPE[meta.format]
    // 긴 변은 EXIF 방향과 무관하다(가로·세로만 바뀐다)
    if (!mediaType || !isLowResolutionImage({ width: meta.width, height: meta.height })) return ref
    // 출력은 메타데이터를 버리므로 EXIF 방향을 먼저 픽셀에 적용한다(인자 없는 rotate = 자동 방향, next가 허용하는 0.34.x 공통).
    // 형식은 실제 디코더 기준이다(헤더의 content-type이 틀려도 맞춰진다)
    const resized = sharp(input).rotate().resize({
      width: REFERENCE_MIN_LONG_SIDE,
      height: REFERENCE_MIN_LONG_SIDE,
      fit: 'inside',
      kernel: 'lanczos3',
    })
    const encoded =
      mediaType === 'image/png'
        ? resized.png()
        : mediaType === 'image/webp'
          ? resized.webp({ quality: LOSSY_QUALITY })
          : resized.jpeg({ quality: LOSSY_QUALITY })
    const output = await encoded.toBuffer()
    console.warn(
      `[registration/pdp-image] 저해상도 참조 ${meta.width}x${meta.height} → 긴 변 ${REFERENCE_MIN_LONG_SIDE}px로 확대`
    )
    return { data: output.toString('base64'), mediaType }
  } catch {
    return ref
  }
}
