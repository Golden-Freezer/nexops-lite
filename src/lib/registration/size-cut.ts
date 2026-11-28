/**
 * 사이즈 단독 컷(sizecut, 오너 지적 2026-11-01) — 치수선이 사진 틀을 재서 제품 두 개 사진이면 틀린 값이 됐다(P04 57mm×168mm). 제품 하나를 입력 비율대로 만들고,
 * 사진에서 제품 경계를 재서 그 경계에 선을 긋는다. 비율이 입력과 다르면 선 없이 글자만 표기한다(designCut/sizeLines.ts). 재는 값은 비용이 없다.
 * 바탕색도 함께 잰다. 생성 컷 바탕은 요구한 색과 조금씩 달라(R15 최대 5단계) 무대를 이 색으로 칠해야 사진 네모가 보이지 않는다.
 */

import type sharpModule from 'sharp'
import type { ProductBox } from './pdp-state'

export { SIZE_SINGLE_SECTION } from './editor/utils/sectionConverter/designCut/sizeLines'

export function buildSizeSinglePrompt(args: { productName: string; size: string; bgMain?: string }): string {
  const { productName, size, bgMain = '#ffffff' } = args
  return `SINGLE PRODUCT SIZE CUT:
- Exactly ONE unit of the product, even if it is sold as a set or pack. Never two.
- Complete silhouette, nothing cropped, straight-on front view with no perspective, the product standing or lying naturally.
- Center it with clear empty margin on every side. The product fills about 60% of the frame.
- Real proportions of the product — real size (reference only, never drawn as text): ${size}
- Plain solid ${bgMain} background with no props, hands, surfaces, patterns or gradient, and only a faint contact shadow.
- No rulers, arrows, lines, numbers or text in the image.

Product: ${productName}
Aspect Ratio: 3:4`
}

const SAMPLE_WIDTH = 256
const CORNER = 0.03
/** 바탕과 다른 픽셀 — 채널 차이 최대값(옅은 그림자는 넘지 않게) */
const DIFF = 28
/** 바탕과 비슷한 제품을 보는 문턱 — 이 문턱의 경계가 DIFF 경계보다 FAINT_SPREAD 넘게 넓으면 제품 일부가 빠진 것이다(R15 P11 흰 스티커) */
const DIFF_FAINT = 10
const FAINT_SPREAD = 0.08
/** 네 귀퉁이가 이만큼 다르면 단색 바탕이 아니다 */
const CORNER_SPREAD = 24
/** 잡티를 빼는 줄 비율 */
const LINE_SHARE = 0.015
const MIN_AREA = 0.03
const MAX_SPAN = 0.96

/** 픽셀에서 제품 경계 — 바탕이 단색이 아니거나 제품이 없거나 꽉 차면 null(재지 못함 → 선 없이 글자만) */
export function productBoxOfPixels(data: Uint8Array, width: number, height: number, channels: number): ProductBox | null {
  const at = (x: number, y: number, c: number) => data[(y * width + x) * channels + c]
  const patch = Math.max(2, Math.round(width * CORNER))
  const corners = [
    [0, 0],
    [width - patch, 0],
    [0, height - patch],
    [width - patch, height - patch],
  ].map(([ox, oy]) => {
    const sum = [0, 0, 0]
    for (let y = oy; y < oy + patch; y++) for (let x = ox; x < ox + patch; x++) for (let c = 0; c < 3; c++) sum[c] += at(x, y, c)
    return sum.map((v) => v / (patch * patch))
  })
  for (let c = 0; c < 3; c++) {
    const values = corners.map((corner) => corner[c])
    if (Math.max(...values) - Math.min(...values) > CORNER_SPREAD) return null
  }
  const background = [0, 1, 2].map((c) => corners.reduce((sum, corner) => sum + corner[c], 0) / 4)
  const rows = new Array<number>(height).fill(0)
  const columns = new Array<number>(width).fill(0)
  const faintRows = new Array<number>(height).fill(0)
  const faintColumns = new Array<number>(width).fill(0)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const diff = Math.max(...[0, 1, 2].map((c) => Math.abs(at(x, y, c) - background[c])))
      if (diff > DIFF) {
        rows[y]++
        columns[x]++
      }
      if (diff > DIFF_FAINT) {
        faintRows[y]++
        faintColumns[x]++
      }
    }
  }
  const first = (counts: number[], need: number) => counts.findIndex((n) => n >= need)
  const last = (counts: number[], need: number) => counts.length - 1 - [...counts].reverse().findIndex((n) => n >= need)
  const top = first(rows, width * LINE_SHARE)
  const left = first(columns, height * LINE_SHARE)
  if (top < 0 || left < 0) return null
  const boxWidth = (last(columns, height * LINE_SHARE) - left + 1) / width
  const boxHeight = (last(rows, width * LINE_SHARE) - top + 1) / height
  if (boxWidth * boxHeight < MIN_AREA || (boxWidth > MAX_SPAN && boxHeight > MAX_SPAN)) return null
  const round = (v: number) => Math.round(v * 1000) / 1000
  const hex = `#${background.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`
  // 옅은 문턱에서 경계가 크게 넓어지면 바탕과 비슷한 부분이 있다 — 아래 변은 그림자가 깔리니 왼쪽·오른쪽·위만 본다
  const faintLeft = first(faintColumns, height * LINE_SHARE)
  const faintTop = first(faintRows, width * LINE_SHARE)
  const faintRight = last(faintColumns, height * LINE_SHARE)
  const right = last(columns, height * LINE_SHARE)
  const uncertain =
    (left - faintLeft) / width > FAINT_SPREAD || (top - faintTop) / height > FAINT_SPREAD || (faintRight - right) / width > FAINT_SPREAD
  return {
    left: round(left / width),
    top: round(top / height),
    width: round(boxWidth),
    height: round(boxHeight),
    aspect: round(width / height),
    background: hex,
    ...(uncertain ? { uncertain: true as const } : {}),
  }
}

export async function measureProductBox(base64: string): Promise<ProductBox | null> {
  let sharp: typeof sharpModule
  try {
    const mod = await import('sharp')
    sharp = (mod.default ?? mod) as typeof sharpModule
  } catch {
    return null
  }
  try {
    const { data, info } = await sharp(Buffer.from(base64, 'base64')).flatten({ background: '#ffffff' }).resize({ width: SAMPLE_WIDTH }).removeAlpha().raw().toBuffer({ resolveWithObject: true })
    return productBoxOfPixels(new Uint8Array(data), info.width, info.height, info.channels)
  } catch {
    return null
  }
}
