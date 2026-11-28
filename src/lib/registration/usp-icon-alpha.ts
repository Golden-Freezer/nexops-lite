/**
 * USP 아이콘 후처리 — 배경 투명화 + 잉크 단색화. NEXFIT agents/icon_postprocess.py(1bb69d5) 이식.
 *
 * 생성 모델은 "투명 배경"을 요청해도 알파를 주지 않고 불투명한 흰 배경을 그린다. 그래서 프롬프트는
 * 키잉이 가장 깨끗한 "흰 배경 위 검정 선"으로 뽑고(pdp-image-prompts의 USP 아이콘 지시), 알파·잉크
 * 색·획 굵기는 여기서 결정론적으로 입힌다. 투명 PNG면 카드 배경이 그대로 비쳐 흰 사각형이 사라지고,
 * 잉크를 고정색으로 칠하므로 모델이 낸 색에 기대지 않는다.
 *
 * 변환할 수 없는 그림(sharp 로드·디코딩 실패, 채워진 그림)은 사유를 로그로 남기고 원본을 그대로 돌려준다 —
 * 아이콘이 없는 것보다 배경이 있는 아이콘이 낫다. 렌더러의 결정론 SVG 폴백은 이 경로를 타지 않는다.
 */

import type sharpModule from 'sharp'

type Sharp = typeof sharpModule

/** 상세페이지 카드 슬롯은 80x80 — 원본을 그보다 크게 두되 파일은 가볍게(정사각 입력만 맞춘다) */
export const ICON_OUTPUT_SIZE = 512
/** 기본 잉크 — 순검정은 인쇄물처럼 딱딱해 보여 살짝 누른 값(본문 텍스트와 같은 계열) */
export const ICON_INK_HEX = '#1a1a1a'
/** 알파 팽창 반경(출력 크기 기준 px) — 0이면 팽창하지 않는다 */
export const ICON_THICKEN_PX = 3
/** 잉크가 캔버스를 이 비율보다 많이 덮으면 라인아트가 아니라 채워진 그림 — 변환을 포기한다 */
export const MAX_INK_COVERAGE = 0.55
/** 배경으로 볼 색 거리(0~255, 휘도 기준) — 라인아트는 배경과 확실히 떨어져 있어 넉넉해도 안전하다 */
const BG_DISTANCE = 48
/** 이 값 미만의 알파는 0 — 모델의 흰 배경이 균일하지 않아 카드 전체에 옅은 회색 막이 씌워지지 않게(255 기준 약 10%) */
const ALPHA_NOISE_FLOOR = 26

export interface IconImage {
  base64: string
  mimeType: string
}

export interface IconAlphaResult extends IconImage {
  converted: boolean
  /** 원본을 유지한 사유 */
  reason?: string
  /** 팽창 전 잉크 커버리지(알파 128 이상 픽셀 비율) */
  coverage?: number
}

export interface IconAlphaOptions {
  inkHex?: string
  thickenPx?: number
  size?: number
}

interface RgbImage {
  data: Buffer
  width: number
  height: number
}

/** 생성 컷 중 후처리 대상 — USP 아이콘만(다른 섹션 저장 형식은 그대로) */
export function isUspIconSection(section: string): boolean {
  return section.startsWith('usp_icons:')
}

function hexRgb(value: string, fallback: [number, number, number] = [26, 26, 26]): [number, number, number] {
  const h = (value || '').replace(/^#/, '')
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return fallback
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}

/** 파이썬 round(짝수 반올림) — NEXFIT은 PIL point()에 이 반올림을 쓴다. 같은 알파가 나오게 맞춘다. */
function roundHalfEven(x: number): number {
  const f = Math.floor(x)
  const d = x - f
  if (d !== 0.5) return d > 0.5 ? f + 1 : f
  return f % 2 === 0 ? f : f + 1
}

/** 배경과의 휘도 차 → 알파. 안티에일리어싱된 가장자리가 부드럽게 남는다. */
const ALPHA_LUT = Uint8Array.from({ length: 256 }, (_, v) => {
  const a = Math.min(255, roundHalfEven((v * 255) / BG_DISTANCE))
  return a < ALPHA_NOISE_FLOOR ? 0 : a
})

/** 테두리 픽셀의 채널별 중앙값 = 배경색. 아이콘은 여백을 두고 그려지므로 테두리는 배경이다. */
function borderColor({ data, width: w, height: h }: RgbImage): [number, number, number] {
  const pixels: number[] = []
  const xStep = Math.max(1, Math.floor(w / 48))
  for (let x = 0; x < w; x += xStep) pixels.push(x, (h - 1) * w + x)
  const yStep = Math.max(1, Math.floor(h / 48))
  for (let y = 0; y < h; y += yStep) pixels.push(y * w, y * w + w - 1)
  const mid = pixels.length >> 1
  const median = (c: number) => pixels.map((p) => data[p * 3 + c]).sort((a, b) => a - b)[mid]
  return [median(0), median(1), median(2)]
}

/** 정사각 창 최댓값 필터(PIL MaxFilter(2r+1) — 테두리는 가장자리 값 복제라 창을 이미지 안으로 자른 것과 같다) */
function maxFilter(src: Uint8Array, w: number, h: number, r: number): Uint8Array {
  const rows = new Uint8Array(src.length)
  for (let y = 0; y < h; y++) {
    const base = y * w
    for (let x = 0; x < w; x++) {
      let m = 0
      for (let k = Math.max(0, x - r), end = Math.min(w - 1, x + r); k <= end; k++) m = Math.max(m, src[base + k])
      rows[base + x] = m
    }
  }
  const out = new Uint8Array(src.length)
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      let m = 0
      for (let k = Math.max(0, y - r), end = Math.min(h - 1, y + r); k <= end; k++) m = Math.max(m, rows[k * w + x])
      out[y * w + x] = m
    }
  }
  return out
}

/**
 * sharp는 네이티브 바이너리라 배포 환경에서 로드에 실패할 수 있다 — 모듈 최상단이 아니라 여기서 불러
 * 실패가 이 모듈을 가져오는 run 라우트 전체(파이프라인 전 단계)로 번지지 않게 하고, 그때는 원본을 유지한다.
 */
async function loadSharp(): Promise<Sharp> {
  const mod = await import('sharp')
  return (mod.default ?? mod) as Sharp
}

/** RGB 8비트로 디코딩(알파는 합성하지 않고 버린다 — PIL convert("RGB")와 같다). 정사각이면 size로 맞춘다. */
async function decodeRgb(sharp: Sharp, bytes: Buffer, size: number): Promise<RgbImage> {
  const { data, info } = await sharp(bytes)
    .removeAlpha()
    .toColourspace('srgb')
    .raw({ depth: 'uchar' })
    .toBuffer({ resolveWithObject: true })
  if (info.channels !== 3) throw new Error(`채널 ${info.channels}개`)
  const { width, height } = info
  if (!size || width !== height || width === size) return { data, width, height }
  const resized = await sharp(data, { raw: { width, height, channels: 3 } })
    .resize(size, size, { kernel: 'lanczos3' })
    .raw()
    .toBuffer()
  return { data: resized, width: size, height: size }
}

/**
 * 흰 배경 라인아트 → 배경 투명 + 잉크 단색 RGBA PNG.
 * 변환하지 못하면 원본(base64·mimeType)을 그대로 돌려주고 converted=false·reason을 남긴다.
 */
export async function toTransparentInk(image: IconImage, options: IconAlphaOptions = {}): Promise<IconAlphaResult> {
  const { inkHex = ICON_INK_HEX, thickenPx = ICON_THICKEN_PX, size = ICON_OUTPUT_SIZE } = options
  const keep = (reason: string, coverage?: number): IconAlphaResult => {
    console.warn(`[usp-icon-alpha] ${reason} — 원본 유지`)
    return { base64: image.base64, mimeType: image.mimeType, converted: false, reason, ...(coverage === undefined ? {} : { coverage }) }
  }

  let sharp: Sharp
  try {
    sharp = await loadSharp()
  } catch (e) {
    return keep(`sharp 로드 실패: ${e instanceof Error ? e.message : String(e)}`)
  }

  let src: RgbImage
  try {
    src = await decodeRgb(sharp, Buffer.from(image.base64, 'base64'), size)
  } catch (e) {
    return keep(`디코딩 실패: ${e instanceof Error ? e.message : String(e)}`)
  }

  const { data, width: w, height: h } = src
  const [br, bg, bb] = borderColor(src)
  const alpha = new Uint8Array(w * h)
  let inked = 0
  for (let i = 0, p = 0; i < alpha.length; i++, p += 3) {
    // ImageChops.difference → convert("L"): 채널별 차이의 ITU-R 601-2 휘도(PIL 정수 근사와 같은 식)
    const diff =
      (Math.abs(data[p] - br) * 19595 + Math.abs(data[p + 1] - bg) * 38470 + Math.abs(data[p + 2] - bb) * 7471 + 0x8000) >> 16
    alpha[i] = ALPHA_LUT[diff]
    if (alpha[i] >= 128) inked++
  }
  const coverage = inked / (w * h)
  if (coverage > MAX_INK_COVERAGE) {
    return keep(`잉크 커버리지 ${Math.round(coverage * 100)}% — 라인아트가 아니라 판단해 변환 생략`, coverage)
  }

  const keyed = thickenPx > 0 ? maxFilter(alpha, w, h, thickenPx) : alpha
  const [ir, ig, ib] = hexRgb(inkHex)
  const rgba = Buffer.alloc(w * h * 4)
  for (let i = 0, q = 0; i < keyed.length; i++, q += 4) {
    rgba[q] = ir
    rgba[q + 1] = ig
    rgba[q + 2] = ib
    rgba[q + 3] = keyed[i]
  }
  let png: Buffer
  try {
    png = await sharp(rgba, { raw: { width: w, height: h, channels: 4 } }).png({ compressionLevel: 9 }).toBuffer()
  } catch (e) {
    return keep(`PNG 인코딩 실패: ${e instanceof Error ? e.message : String(e)}`, coverage)
  }
  console.info(`[usp-icon-alpha] 투명화 완료 (${w}x${h}, 잉크 ${(coverage * 100).toFixed(1)}%, 팽창 ${thickenPx}px, ${inkHex})`)
  return { base64: png.toString('base64'), mimeType: 'image/png', converted: true, coverage }
}
