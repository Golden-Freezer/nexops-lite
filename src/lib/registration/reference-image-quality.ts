/**
 * 생성 입력 품질 판정 — NEXFIT 080ab03 frontend/src/utils/imageQualityWarnings.ts 이식(순수 함수만).
 * 생성 폼(PdpForm)의 저해상도·무채색 경고와 images 단계의 참조 업스케일(reference-upscale.ts)이 같은 기준을 쓴다.
 */

/**
 * 참조 사진 최소 해상도(긴 변) — NEXFIT agents/image_generation_agent.py REFERENCE_MIN_LONG_SIDE.
 * 222px 썸네일을 참조로 넣으면 제품 재현이 무너진다(NEXFIT 2026-07-29 실측). 미만이면 폼은 경고하고(막지 않음),
 * images 단계는 생성 전에 이 길이로 키운다.
 */
export const REFERENCE_MIN_LONG_SIDE = 500

/** 권장 해상도 — 안내 문구에 노출되는 값 */
export const REFERENCE_RECOMMENDED_LONG_SIDE = 800

export interface ImageDimensions {
  width: number
  height: number
}

/** 참조로 쓰기에 해상도가 부족한 사진인지 — 크기를 모르면(로드 전·실패) 판정하지 않는다 */
export function isLowResolutionImage(dims: ImageDimensions | null | undefined): boolean {
  if (!dims || !(dims.width > 0) || !(dims.height > 0)) return false
  return Math.max(dims.width, dims.height) < REFERENCE_MIN_LONG_SIDE
}

export const LOW_RESOLUTION_MESSAGE = `사진이 작아(긴 변 ${REFERENCE_MIN_LONG_SIDE}px 미만) 제품 재현 품질이 크게 떨어질 수 있습니다. 원본 크기 사진(${REFERENCE_RECOMMENDED_LONG_SIDE}px 이상)을 권장합니다.`

/**
 * 검정·흰색 근처 무채색 브랜드 컬러인지 — NEXFIT isAchromaticExtreme과 같은 기준(채널 차 24 이하 & 최댓값 48 이하 또는
 * 최솟값 207 이상). 브랜드 컬러는 CTA 섹션의 전폭 배경이 된다(sectionConverter/convert.ts).
 * NEXFIT과 달리 #RRGGBB만 본다 —
 * 생성은 6자리 HEX만 브랜드 컬러로 쓰므로(pdp-copy-defaults enforceBrandPalette) 3자리 입력은 페이지에 칠해지지 않는다.
 */
export function isAchromaticExtreme(hex: string | null | undefined): boolean {
  const value = (hex ?? '').trim()
  if (!/^#[0-9a-fA-F]{6}$/.test(value)) return false
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(value.slice(i, i + 2), 16))
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  return max - min <= 24 && (max <= 48 || min >= 207)
}

export const ACHROMATIC_BRAND_COLOR_MESSAGE =
  '브랜드 컬러는 구매 유도(CTA) 섹션 같은 전폭 배경에 쓰입니다. 검정·흰색에 가까운 색은 페이지가 단색 덩어리로 보일 수 있습니다.'
