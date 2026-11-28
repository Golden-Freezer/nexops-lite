// 원천 사진 참조용 편집(T5) — 원본 파일은 건드리지 않고, 업로드 직전 메모리에서만 고친다.
// fill: 글자 배지 같은 영역을 둘레 평균색으로 덮는다(NO_TEXT). blur: 타사 브랜드 글자를 읽을 수 없게 흐린다(브랜드 비노출).
// 흐린 사각형·단색 사각형은 생성 쪽에 '가림'으로 보여 따라 그려졌다(B 조사) — 그래서 티 나지 않게 고치는 두 가지를 둔다.
// - inpaint: 상자 둘레에서 이어 채운다(Coons 보간 + 이완 — 네 변이 둘레 값과 이어져 사각형 경계가 생기지 않는다).
// - blur의 feather(px): 흐림 세기가 상자 가장자리로 갈수록 0이 되게 섞는다. keepWhite면 흰 무늬(데이지 꽃잎)는 흐리지 않고 그대로 둔다 —
//   흐리기 전에 흰 칸을 주변색으로 잠시 메워 흰 번짐도 막는다(상품 무늬를 바꾸지 않는다).
// 편집은 차례로 겹쳐 적용한다(앞 편집 결과 위에 다음 편집). sharp는 next가 설치한 것을 쓴다(package.json 무변경). 로컬 하네스 전용이다.

import type { PdpPhotoEdit } from './index'

type Box = PdpPhotoEdit['box']
type Info = { width: number; height: number; channels: number }

const RING_PX = 6
const BLUR_SIGMA = 18
/** inpaint 이완 횟수 — Coons 보간 위를 다듬기만 한다 */
const RELAX = 80
/** keepWhite 흰 무늬 판정(명도·채도)과 그 둘레 보호 폭(꽃잎 가장자리) */
const WHITE_V = 0.85
const WHITE_S = 0.2
const WHITE_GROW_PX = 2
/** 꽃잎에 둘러싸인 칸(꽃술) 판정 거리 */
const ENCLOSE_PX = 14

/** 상자 바깥 둘레(RING_PX)의 평균색 — 상자가 그림 가장자리에 붙으면 남은 쪽만 쓴다 */
export function ringAverage(data: Buffer, info: Info, [x, y, w, h]: Box): { r: number; g: number; b: number } {
  const sum = [0, 0, 0]
  let n = 0
  for (let yy = Math.max(0, y - RING_PX); yy < Math.min(info.height, y + h + RING_PX); yy++) {
    for (let xx = Math.max(0, x - RING_PX); xx < Math.min(info.width, x + w + RING_PX); xx++) {
      if (xx >= x && xx < x + w && yy >= y && yy < y + h) continue
      const i = (yy * info.width + xx) * info.channels
      sum[0] += data[i]
      sum[1] += data[i + 1]
      sum[2] += data[i + 2]
      n++
    }
  }
  if (n === 0) throw new Error('편집 상자 둘레가 그림 밖입니다')
  return { r: Math.round(sum[0] / n), g: Math.round(sum[1] / n), b: Math.round(sum[2] / n) }
}

/** 상자 둘레(밖 1px, 그림 가장자리면 안쪽 가장자리)에서 상자 전체를 이어 채운다 */
export function inpaint(px: Buffer, info: Info, [x0, y0, w, h]: Box): void {
  const cx = (x: number) => Math.min(info.width - 1, Math.max(0, x))
  const cy = (y: number) => Math.min(info.height - 1, Math.max(0, y))
  const get = (x: number, y: number, c: number) => px[(cy(y) * info.width + cx(x)) * info.channels + c]
  const [l, r, t, b] = [x0 - 1, x0 + w, y0 - 1, y0 + h]
  for (let c = 0; c < 3; c++) {
    const f = new Float32Array(w * h)
    // Coons 보간 — 네 변이 둘레 값과 정확히 이어진다
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const u = (x + 1) / (w + 1)
        const v = (y + 1) / (h + 1)
        f[y * w + x] =
          (1 - u) * get(l, y0 + y, c) + u * get(r, y0 + y, c) + (1 - v) * get(x0 + x, t, c) + v * get(x0 + x, b, c) -
          ((1 - u) * (1 - v) * get(l, t, c) + u * (1 - v) * get(r, t, c) + (1 - u) * v * get(l, b, c) + u * v * get(r, b, c))
      }
    // 이완(가우스-자이델) — 네 이웃 평균. 상자 밖 이웃은 고정값, 그림 밖 이웃은 뺀다
    const val = (x: number, y: number) => (x >= 0 && x < w && y >= 0 && y < h ? f[y * w + x] : get(x0 + x, y0 + y, c))
    for (let it = 0; it < RELAX; it++)
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          let sum = 0
          let n = 0
          for (const [dx, dy] of NEIGHBORS) {
            const gx = x0 + x + dx
            const gy = y0 + y + dy
            if (gx < 0 || gy < 0 || gx >= info.width || gy >= info.height) continue
            sum += val(x + dx, y + dy)
            n++
          }
          f[y * w + x] = sum / n
        }
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) px[((y0 + y) * info.width + x0 + x) * info.channels + c] = Math.round(f[y * w + x])
  }
}

const NEIGHBORS: ReadonlyArray<readonly [number, number]> = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
]

/**
 * 흰 무늬 칸(상자 안, 둘레 WHITE_GROW_PX까지) — 명도 높고 채도 낮은 칸과, 상하좌우 ENCLOSE_PX 안에 모두 흰 칸이 있는 칸(꽃잎에 둘러싸인
 * 노란 꽃술 — 흐리면 둘레 갈색이 섞여 꽃술이 어두워졌다)
 */
export function whiteMask(px: Buffer, info: Info, [x0, y0, w, h]: Box): Uint8Array {
  const white = new Uint8Array(w * h)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = ((y0 + y) * info.width + x0 + x) * info.channels
      const max = Math.max(px[i], px[i + 1], px[i + 2])
      const min = Math.min(px[i], px[i + 1], px[i + 2])
      white[y * w + x] = max / 255 > WHITE_V && (max === 0 ? 0 : (max - min) / max) < WHITE_S ? 1 : 0
    }
  const hits = (x: number, y: number, dx: number, dy: number) => {
    for (let s = 1; s <= ENCLOSE_PX; s++) {
      const [xx, yy] = [x + dx * s, y + dy * s]
      if (xx < 0 || yy < 0 || xx >= w || yy >= h) return false
      if (white[yy * w + xx]) return true
    }
    return false
  }
  const core = white.map((v, k) => {
    if (v) return 1
    const [x, y] = [k % w, Math.floor(k / w)]
    return hits(x, y, -1, 0) && hits(x, y, 1, 0) && hits(x, y, 0, -1) && hits(x, y, 0, 1) ? 1 : 0
  })
  const out = new Uint8Array(w * h)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (!core[y * w + x]) continue
      for (let dy = -WHITE_GROW_PX; dy <= WHITE_GROW_PX; dy++)
        for (let dx = -WHITE_GROW_PX; dx <= WHITE_GROW_PX; dx++) {
          const [xx, yy] = [x + dx, y + dy]
          if (xx >= 0 && yy >= 0 && xx < w && yy < h) out[yy * w + xx] = 1
        }
    }
  return out
}

/** 흰 칸을 주변(흰 칸 아닌) 값으로 한 겹씩 메운 상자 사본 — 흐리기 전에 흰 번짐을 막는다 */
function withoutWhite(region: Buffer, mask: Uint8Array, w: number, h: number, ch: number): Buffer {
  const out = Buffer.from(region)
  const done = mask.map((m) => (m ? 0 : 1))
  for (let pass = 0, left = mask.reduce((a, m) => a + m, 0); left > 0 && pass < w + h; pass++) {
    const ring: Array<[number, number[]]> = []
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        if (done[y * w + x]) continue
        const sum = [0, 0, 0]
        let n = 0
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const [xx, yy] = [x + dx, y + dy]
            if (xx < 0 || yy < 0 || xx >= w || yy >= h || !done[yy * w + xx]) continue
            for (let c = 0; c < 3; c++) sum[c] += out[(yy * w + xx) * ch + c]
            n++
          }
        if (n) ring.push([y * w + x, sum.map((s) => Math.round(s / n))])
      }
    for (const [k, v] of ring) {
      for (let c = 0; c < 3; c++) out[k * ch + c] = v[c]
      done[k] = 1
    }
    left -= ring.length
  }
  return out
}

/** 가장자리 페더 가중치 — 상자 가장자리에서 0, feather px 안쪽부터 1(부드러운 계단) */
const featherWeight = (x: number, y: number, w: number, h: number, feather: number) => {
  const t = Math.min(1, Math.min(x, y, w - 1 - x, h - 1 - y) / feather)
  return t * t * (3 - 2 * t)
}

export async function applyPhotoEdits(buf: Buffer, edits: readonly PdpPhotoEdit[]): Promise<Buffer> {
  if (edits.length === 0) return buf
  const sharp = (await import('sharp')).default
  const { data, info } = await sharp(buf).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  const px = Buffer.from(data)
  const ch = info.channels
  const raw = { width: info.width, height: info.height, channels: ch as 3 }
  for (const edit of edits) {
    const [left, top, width, height] = edit.box
    if (left < 0 || top < 0 || left + width > info.width || top + height > info.height) {
      throw new Error(`편집 상자가 그림 밖입니다(${info.width}x${info.height}): ${edit.box.join(',')}`)
    }
    if (edit.kind === 'inpaint') {
      inpaint(px, info, edit.box)
      continue
    }
    const row = width * ch
    const region = Buffer.alloc(width * height * ch)
    for (let y = 0; y < height; y++) px.copy(region, y * row, ((top + y) * info.width + left) * ch, ((top + y) * info.width + left) * ch + row)
    let patch: Buffer
    if (edit.kind === 'fill') {
      const { r, g, b } = ringAverage(px, info, edit.box)
      patch = Buffer.alloc(width * height * ch)
      for (let i = 0; i < patch.length; i += ch) patch.set([r, g, b], i)
    } else {
      const keep = edit.keepWhite ? whiteMask(px, info, edit.box) : null
      const source = keep ? withoutWhite(region, keep, width, height, ch) : region
      const blurred = await sharp(source, { raw: { width, height, channels: ch as 3 } }).blur(BLUR_SIGMA).raw().toBuffer()
      patch = Buffer.alloc(width * height * ch)
      for (let y = 0; y < height; y++)
        for (let x = 0; x < width; x++) {
          const k = y * width + x
          const a = (edit.feather ? featherWeight(x, y, width, height, edit.feather) : 1) * (keep?.[k] ? 0 : 1)
          for (let c = 0; c < 3; c++) patch[k * ch + c] = Math.round(a * blurred[k * ch + c] + (1 - a) * region[k * ch + c])
        }
    }
    for (let y = 0; y < height; y++) patch.copy(px, ((top + y) * info.width + left) * ch, y * row, (y + 1) * row)
  }
  return sharp(px, { raw }).png().toBuffer()
}
