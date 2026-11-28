/**
 * 원본 합성 렌더(묶음 4) — NEXFIT agents/photo_composite.py를 sharp로 옮겼다. 생성 콜 0건·원가 $0.
 * - 누끼(cutout): 팔레트 배경(그라데이션·짙은 그라데이션·단색) 위에 제품을 컷별 점유율·시선 높이로 놓고, 알파를 블러·오프셋한
 *   접지 그림자를 깐다.
 * - 원본 직접 배치(direct): 테두리가 균일하면 그 색으로, 아니면 팔레트 배경으로 채우고 원본(컷별 중앙 크롭)을 가운데 둔다.
 * 겹치기·그림자 합성은 원시 픽셀로 계산한다(결정론). sharp는 크기 조정(lanczos3)·블러·PNG 인코딩에만 쓴다 — 네이티브라 함수 안에서 불러온다.
 */

import type sharpModule from 'sharp'
import { COMPOSITE_CUT_STYLES, type CompositeStyleKey } from './composite-types'

type Sharp = typeof sharpModule
export type Rgb = [number, number, number]

export interface RgbaImage {
  data: Uint8Array
  width: number
  height: number
}
export type RgbImage = RgbaImage

async function loadSharp(): Promise<Sharp> {
  const mod = await import('sharp')
  return (mod.default ?? mod) as Sharp
}

const DEFAULT_MAIN: Rgb = [247, 247, 245]
const DEFAULT_SUB: Rgb = [233, 235, 232]
/** 제품 가로 점유 상한(NEXFIT _PRODUCT_WIDTH_RATIO) */
const PRODUCT_WIDTH_RATIO = 0.78
const SHADOW_TINT = 30
const SHADOW_ALPHA_MAX = 90
/** 이 값 이하 알파는 바탕 잔여로 버린다 — isnet·키잉은 바탕에 낮은 알파를 남겨, 그대로 두면 제품 상자가 사진 전체로 넓어진다
 *  (NEXFIT getbbox는 깨끗한 PhotoRoom 출력을 전제했다). B 실험의 '투명(≤5)' 기준과 같다 */
const FAINT_ALPHA = 5

/** '1024x1536' → 크기. 생성 크기(pdp-image-stage ASPECT_TO_SIZE)와 같은 프레임을 쓴다 */
export function parseFrameSize(size: string): { width: number; height: number } {
  const m = /^(\d+)x(\d+)$/.exec(size)
  if (!m) return { width: 1024, height: 1536 }
  return { width: Number(m[1]), height: Number(m[2]) }
}

export function hexRgb(value: string | undefined, fallback: Rgb): Rgb {
  const h = (value ?? '').replace(/^#/, '')
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return fallback
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}

const shade = (c: Rgb, f: number): Rgb => c.map((v) => Math.max(0, Math.min(255, Math.round(v * f)))) as Rgb

/** designPalette 배경(NEXFIT make_gradient_background) — gradient: bgMain→bgSub, deep: bgSub→그 음영, flat: bgMain 단색. RGB raw */
export function backdropRaw(
  width: number,
  height: number,
  palette: { bgMain?: string; bgSub?: string },
  backdrop: 'gradient' | 'deep' | 'flat'
): Uint8Array {
  const main = hexRgb(palette.bgMain, DEFAULT_MAIN)
  const sub = hexRgb(palette.bgSub, DEFAULT_SUB)
  const [top, bottom] = backdrop === 'flat' ? [main, main] : backdrop === 'deep' ? [sub, shade(sub, 0.78)] : [main, sub]
  const out = new Uint8Array(width * height * 3)
  for (let y = 0; y < height; y++) {
    const t = y / Math.max(1, height - 1)
    const row = [0, 1, 2].map((i) => Math.round(top[i] + (bottom[i] - top[i]) * t))
    for (let x = 0; x < width; x++) out.set(row, (y * width + x) * 3)
  }
  return out
}

/** 테두리가 균일하면 그 색(NEXFIT _border_color — 분산 400 초과면 연출 배경으로 보고 null) */
export function borderColor(img: RgbImage): Rgb | null {
  const { data, width: w, height: h } = img
  const band = Math.max(1, Math.round(Math.min(w, h) * 0.02))
  const at = (x: number, y: number): Rgb => {
    const i = (y * w + x) * 3
    return [data[i], data[i + 1], data[i + 2]]
  }
  const samples: Rgb[] = []
  for (let x = 0; x < w; x += Math.max(1, Math.floor(w / 64))) {
    samples.push(at(x, band >> 1), at(x, h - 1 - (band >> 1)))
  }
  for (let y = 0; y < h; y += Math.max(1, Math.floor(h / 64))) {
    samples.push(at(band >> 1, y), at(w - 1 - (band >> 1), y))
  }
  if (samples.length === 0) return null
  const mean = [0, 1, 2].map((i) => samples.reduce((s, c) => s + c[i], 0) / samples.length)
  const variance =
    samples.reduce((s, c) => s + [0, 1, 2].reduce((t, i) => t + (c[i] - mean[i]) ** 2, 0), 0) / samples.length
  if (variance > 400) return null
  return mean.map((v) => Math.round(v)) as Rgb
}

/** 잔여 알파(FAINT_ALPHA 이하)를 0으로 만든 사본 */
function clearFaintAlpha(img: RgbaImage): RgbaImage {
  const data = Uint8Array.from(img.data)
  for (let i = 3; i < data.length; i += 4) if (data[i] <= FAINT_ALPHA) data[i] = 0
  return { data, width: img.width, height: img.height }
}

/** 알파가 0보다 큰 영역(PIL getbbox) — 없으면 null */
function nonZeroBBox(img: RgbaImage): { left: number; top: number; width: number; height: number } | null {
  let minX = img.width
  let minY = img.height
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      if (img.data[(y * img.width + x) * 4 + 3] === 0) continue
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }
  return maxX < 0 ? null : { left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1 }
}

async function resizeRaw(
  sharp: Sharp,
  img: RgbaImage,
  channels: 3 | 4,
  width: number,
  height: number
): Promise<Uint8Array> {
  const out = await sharp(Buffer.from(img.data), { raw: { width: img.width, height: img.height, channels } })
    .resize(width, height, { fit: 'fill', kernel: 'lanczos3' })
    .raw()
    .toBuffer()
  return new Uint8Array(out)
}

async function encodePng(sharp: Sharp, rgb: Uint8Array, width: number, height: number): Promise<Buffer> {
  return sharp(Buffer.from(rgb), { raw: { width, height, channels: 3 } })
    .png()
    .toBuffer()
}

/** 누끼 제품 컷(NEXFIT compose_product_cut + _paste_with_shadow) — PNG */
export async function renderCutoutCut(input: {
  cutout: RgbaImage
  /** 합성 모양 — 옛 섹션 이름 또는 K 칸 역할(J29) */
  section: CompositeStyleKey
  frame: { width: number; height: number }
  palette: { bgMain?: string; bgSub?: string }
  /** 디자인 컷 잡 — 컷 바탕 단색(bgMain)만 쓴다(짙은 그라데이션이 컷 바탕과 어긋나지 않게) */
  solid?: boolean
}): Promise<Buffer> {
  const sharp = await loadSharp()
  const style = COMPOSITE_CUT_STYLES[input.section]
  const { width: W, height: H } = input.frame
  const cutout = clearFaintAlpha(input.cutout)
  const box = nonZeroBBox(cutout)
  if (!box) throw new Error('누끼 결과에 불투명 영역이 없습니다')
  const cropped = await sharp(Buffer.from(cutout.data), {
    raw: { width: cutout.width, height: cutout.height, channels: 4 },
  })
    .extract(box)
    .raw()
    .toBuffer()
  const scale = Math.min((H * style.heightRatio) / box.height, (W * (style.widthRatio ?? PRODUCT_WIDTH_RATIO)) / box.width)
  const sw = Math.max(1, Math.round(box.width * scale))
  const sh = Math.max(1, Math.round(box.height * scale))
  const subject = await resizeRaw(
    sharp,
    { data: new Uint8Array(cropped), width: box.width, height: box.height },
    4,
    sw,
    sh
  )
  const posX = Math.floor((W - sw) / 2)
  // 시각 중심을 살짝 위로 — 하단 여백은 카피 오버레이 자리이기도 하다
  const posY = Math.round((H - sh) * style.anchor)

  const out = backdropRaw(W, H, input.palette, input.solid ? 'flat' : style.backdrop)
  // 접지 그림자: 알파(최대 90)를 아래로 옮겨 블러한 뒤 짙은 회색으로 깐다
  const blur = Math.max(2, Math.round(W * 0.018))
  const offset = Math.max(2, Math.round(H * 0.012))
  const mask = new Uint8Array(W * H)
  for (let y = 0; y < sh; y++) {
    const fy = posY + offset + y
    if (fy < 0 || fy >= H) continue
    for (let x = 0; x < sw; x++) {
      const fx = posX + x
      if (fx < 0 || fx >= W) continue
      mask[fy * W + fx] = Math.min(SHADOW_ALPHA_MAX, subject[(y * sw + x) * 4 + 3])
    }
  }
  // sharp는 1채널 raw를 3채널로 내보낼 수 있다 — 한 채널만 뽑는다(B 실험 함정)
  const blurred = await sharp(Buffer.from(mask), { raw: { width: W, height: H, channels: 1 } })
    .blur(blur)
    .extractChannel(0)
    .raw()
    .toBuffer()
  for (let p = 0; p < W * H; p++) {
    const a = blurred[p] / 255
    if (a === 0) continue
    for (let c = 0; c < 3; c++) out[p * 3 + c] = Math.round(out[p * 3 + c] * (1 - a) + SHADOW_TINT * a)
  }
  for (let y = 0; y < sh; y++) {
    const fy = posY + y
    if (fy < 0 || fy >= H) continue
    for (let x = 0; x < sw; x++) {
      const fx = posX + x
      if (fx < 0 || fx >= W) continue
      const s = (y * sw + x) * 4
      const a = subject[s + 3] / 255
      if (a === 0) continue
      const p = (fy * W + fx) * 3
      for (let c = 0; c < 3; c++) out[p + c] = Math.round(out[p + c] * (1 - a) + subject[s + c] * a)
    }
  }
  return encodePng(sharp, out, W, H)
}

/** 원본 직접 배치(NEXFIT compose_direct_frame) — 테두리 색은 크롭 전 원본에서 읽는다. PNG */
export async function renderDirectCut(input: {
  photo: RgbImage
  /** 합성 모양 — 옛 섹션 이름 또는 K 칸 역할(J29) */
  section: CompositeStyleKey
  frame: { width: number; height: number }
  palette: { bgMain?: string; bgSub?: string }
  /** 디자인 컷 잡 — 사진 테두리 색 대신 컷 바탕 단색(bgMain) */
  solid?: boolean
}): Promise<Buffer> {
  const sharp = await loadSharp()
  const style = COMPOSITE_CUT_STYLES[input.section]
  const { width: W, height: H } = input.frame
  const edge = input.solid ? null : borderColor(input.photo)
  let photo = input.photo
  if (style.crop > 0 && style.crop < 1) {
    const cw = Math.round(photo.width * style.crop)
    const ch = Math.round(photo.height * style.crop)
    const left = Math.floor((photo.width - cw) / 2)
    const top = Math.floor((photo.height - ch) / 2)
    const data = await sharp(Buffer.from(photo.data), {
      raw: { width: photo.width, height: photo.height, channels: 3 },
    })
      .extract({ left, top, width: cw, height: ch })
      .raw()
      .toBuffer()
    photo = { data: new Uint8Array(data), width: cw, height: ch }
  }
  const out = edge
    ? backdropRaw(W, H, { bgMain: `#${edge.map((v) => v.toString(16).padStart(2, '0')).join('')}` }, 'flat')
    : backdropRaw(W, H, input.palette, input.solid ? 'flat' : style.backdrop)
  const scale = Math.min((W * style.fit) / photo.width, (H * style.fit) / photo.height)
  const pw = Math.max(1, Math.round(photo.width * scale))
  const ph = Math.max(1, Math.round(photo.height * scale))
  const resized = await resizeRaw(sharp, photo, 3, pw, ph)
  const left = Math.floor((W - pw) / 2)
  const top = Math.floor((H - ph) / 2)
  for (let y = 0; y < ph; y++) {
    const fy = top + y
    if (fy < 0 || fy >= H) continue
    for (let x = 0; x < pw; x++) {
      const fx = left + x
      if (fx < 0 || fx >= W) continue
      out.set(resized.subarray((y * pw + x) * 3, (y * pw + x) * 3 + 3), (fy * W + fx) * 3)
    }
  }
  return encodePng(sharp, out, W, H)
}
