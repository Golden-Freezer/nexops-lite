/**
 * 통이미지 드리프트 — 두 이미지를 글자 상자 밖에서 비교한다(결정론, 생성 콜 0건). 마스크 없는 이미지 편집이 구도·제품을 바꿨는지 본다.
 * 안 A: 통이미지 ↔ 글자 지운 바탕(바탕이 원본 구도를 지켰는지). 안 B: G 바탕 ↔ 글자 얹은 통이미지(통이미지가 G 구도를 지켜 상자 좌표를
 * G에 그대로 쓸 수 있는지) — 방향만 다르고 계산은 같다. sharp는 크기 조정·회색조에만 쓴다(네이티브라 함수 안에서 불러온다).
 */

import type sharpModule from 'sharp'
import type { TextBox } from './fullimage-types'

type Sharp = typeof sharpModule

/** 시작 문턱(0~255 평균 절대차) — R<n>-F 오프라인 측정에서 조정한다 */
export const DRIFT_THRESHOLD = 6
/** 비교 해상도(가로 px) */
const SAMPLE_WIDTH = 64
/** 글자 상자 둘레 여유(이미지 폭·높이 비율) — 지운 자리의 번짐을 빼고 본다 */
const BOX_PAD = 0.08
/** 비율이 이만큼 넘게 다르면 같은 구도로 보지 않는다(코덱스 산출 검증 ±3%와 같은 값) */
const ASPECT_TOLERANCE = 0.03

export interface DriftResult {
  /** 글자 상자 밖 평균 절대차(0~255). 비율이 다르거나 비교할 화소가 없으면 null */
  mad: number | null
  /** 비교에 쓴 화소 비율 */
  coverage: number
  aspectMismatch: boolean
}

async function loadSharp(): Promise<Sharp> {
  const mod = await import('sharp')
  return (mod.default ?? mod) as Sharp
}

/** 상자 안(여유 포함)이면 비교에서 뺀다 */
export function inPaddedBox(nx: number, ny: number, boxes: TextBox[], pad = BOX_PAD): boolean {
  return boxes.some((b) => nx >= b.x - pad && nx <= b.x + b.w + pad && ny >= b.y - pad && ny <= b.y + b.h + pad)
}

/** 회색조 화소 두 벌의 상자 밖 평균 절대차 — 순수 계산(시험은 이 함수로 한다) */
export function maskedMeanAbsDiff(a: Uint8Array, b: Uint8Array, width: number, height: number, boxes: TextBox[]): DriftResult {
  let sum = 0
  let count = 0
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (inPaddedBox((x + 0.5) / width, (y + 0.5) / height, boxes)) continue
      const i = y * width + x
      sum += Math.abs(a[i] - b[i])
      count++
    }
  }
  return { mad: count > 0 ? sum / count : null, coverage: count / (width * height), aspectMismatch: false }
}

/** 두 PNG(또는 sharp가 읽는 형식)를 같은 작은 회색조로 줄여 상자 밖을 비교한다 */
export async function computeDrift(imageA: Buffer, imageB: Buffer, boxes: TextBox[]): Promise<DriftResult> {
  const sharp = await loadSharp()
  const [ma, mb] = await Promise.all([sharp(imageA).metadata(), sharp(imageB).metadata()])
  if (!ma.width || !ma.height || !mb.width || !mb.height) return { mad: null, coverage: 0, aspectMismatch: false }
  const ra = ma.width / ma.height
  const rb = mb.width / mb.height
  if (Math.abs(ra - rb) / ra > ASPECT_TOLERANCE) return { mad: null, coverage: 0, aspectMismatch: true }
  const width = SAMPLE_WIDTH
  const height = Math.max(1, Math.round(SAMPLE_WIDTH / ra))
  const gray = (img: Buffer) =>
    sharp(img).removeAlpha().resize(width, height, { fit: 'fill' }).grayscale().raw().toBuffer()
  const [ga, gb] = await Promise.all([gray(imageA), gray(imageB)])
  return maskedMeanAbsDiff(new Uint8Array(ga), new Uint8Array(gb), width, height, boxes)
}
