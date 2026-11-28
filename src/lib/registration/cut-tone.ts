/**
 * 컷 밝기·채도 기록(결정 카드 c29, 가정 A5 — 문턱을 넘으면 경고만, 다시 만들지 않는다). 컷 저장 때 평균 밝기·채도를 컷 기록(tone)에 남기고,
 * 페이지 편차(컷마다 페이지 중앙값과의 차)는 평가 도구·시험 원장이 pageToneSpread로 센다. 운영 동작·화면은 그대로다(기록만).
 * - 잼: 64×64 안으로 줄인 RGB(투명은 흰 바탕) — 밝기는 화소 휘도(Rec.709) 평균, 채도는 화소 HSV 채도((최대−최소)/최대) 평균, 둘 다 0~1·소수 3자리.
 *   Vision 콜 없이 결정론($0)이다. sharp는 함수 안에서 불러오고(dHashOf와 같다) 재지 못하면 기록 없이 지나간다.
 * - 문턱(TONE_OUTLIER): 지난 K 라인 시험 잡 이미지로 정했다 — 근거는 이 상수 주석과 PR 본문.
 */

import type sharpModule from 'sharp'

/** 컷 한 장의 평균 밝기·채도(0~1) */
export interface CutTone {
  brightness: number
  saturation: number
}

/** 재는 크기 — 평균만 보므로 작게 줄여 컷당 수 ms */
const TONE_SAMPLE_PX = 64

const round3 = (n: number) => Math.round(n * 1000) / 1000

/** RGB(또는 RGBA) 화소 → 평균 밝기·채도. 화소가 없으면 null */
export function toneFromPixels(data: Uint8Array, channels: number): CutTone | null {
  if (channels < 3) return null
  const count = Math.floor(data.length / channels)
  if (count === 0) return null
  let luma = 0
  let sat = 0
  for (let i = 0; i < count; i++) {
    const r = data[i * channels]
    const g = data[i * channels + 1]
    const b = data[i * channels + 2]
    luma += (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
    const max = Math.max(r, g, b)
    sat += max === 0 ? 0 : (max - Math.min(r, g, b)) / max
  }
  return { brightness: round3(luma / count), saturation: round3(sat / count) }
}

/**
 * 이미지 머리(PNG·JPEG·WebP·GIF)가 있는가 — 없으면 sharp를 부르지 않는다. 이미지 단계는 이 검사를 기다림 없이 먼저 해서, 이미지가 아닌
 * 응답(시험의 가짜 바이트 포함)이 컷 사이 순서·시간에 영향을 주지 않게 한다
 */
export function hasImageSignature(base64: string): boolean {
  const head = Buffer.from(base64.slice(0, 24), 'base64')
  if (head.length < 12) return false
  const png = head[0] === 0x89 && head.toString('latin1', 1, 4) === 'PNG'
  const jpeg = head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff
  const webp = head.toString('latin1', 0, 4) === 'RIFF' && head.toString('latin1', 8, 12) === 'WEBP'
  const gif = head.toString('latin1', 0, 4) === 'GIF8'
  return png || jpeg || webp || gif
}

/** 이미지(base64) → 평균 밝기·채도. 이미지 머리가 없거나 재지 못하면 null(기록 없이 지나간다) */
export async function measureCutTone(base64: string): Promise<CutTone | null> {
  if (!hasImageSignature(base64)) return null
  let sharp: typeof sharpModule
  try {
    const mod = await import('sharp')
    sharp = (mod.default ?? mod) as typeof sharpModule
  } catch {
    return null
  }
  try {
    const { data, info } = await sharp(Buffer.from(base64, 'base64'))
      .flatten({ background: '#ffffff' })
      .resize(TONE_SAMPLE_PX, TONE_SAMPLE_PX, { fit: 'inside' })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true })
    return toneFromPixels(data, info.channels)
  } catch {
    return null
  }
}

/**
 * 페이지 톤에서 벗어난 컷으로 보는 문턱 — 컷 값과 그 페이지 tone 컷들의 중앙값 차(절댓값). 넘으면 경고만(다시 만들지 않는다).
 * 실측(2026-11-09, 지난 K 라인 시험 잡 17개 503컷 — K8 T01~T07 6잡·motion P01~P11 11잡, 저장 이미지 읽기만 $0):
 * 차 |밝기| p50 0.044·p90 0.108·p95 0.152·p99 0.277·최대 0.419, |채도| p50 0.052·p90 0.158·p95 0.215·p99 0.382·최대 0.644.
 * 눈으로 본 8컷: 벗어난 것 = 어두운 회색 배경(밝기 −0.42)·진한 파랑·노랑·주황·하늘·빨강 단색 배경(채도 +0.32~+0.64),
 * 제품 색 탓 = 검은 밴드 클로즈업(밝기 −0.21·채도 −0.22)·화면을 채운 귤(채도 +0.41). 밝기 0.25는 검은 클로즈업을 넘기지 않고 어두운 배경을 잡는다.
 * 채도 0.3은 단색 배경을 모두 잡고 화면을 채운 진한 제품 1장이 함께 걸린다. 이 문턱이면 503컷 중 17컷(3.4%)·17잡 중 7잡이 경고다.
 */
export const TONE_OUTLIER = { brightness: 0.25, saturation: 0.3 } as const

/** 톤을 재는 컷이 들어 있는 기록(section_images 한 항목의 일부) */
export interface ToneCut {
  section: string
  tone?: CutTone
}

export interface ToneOutlier {
  section: string
  brightness: number
  saturation: number
  /** 페이지 중앙값과의 차(부호 있음 — 양수면 더 밝다·더 진하다) */
  dBrightness: number
  dSaturation: number
}

export interface PageToneSpread {
  /** tone이 있는 컷 수 */
  cuts: number
  median: CutTone
  /** 중앙값과의 차 절댓값 최대 */
  maxDelta: CutTone
  /** 문턱을 넘은 컷(경고만) */
  outliers: ToneOutlier[]
}

const median = (values: readonly number[]): number => {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

/** 페이지 편차 — tone이 있는 컷이 2장 아래면 null(비교할 짝이 없다). 문턱을 넘은 컷은 outliers에 남긴다(경고만) */
export function pageToneSpread(
  images: readonly ToneCut[],
  limits: { brightness: number; saturation: number } = TONE_OUTLIER
): PageToneSpread | null {
  const cuts = images.filter((i): i is ToneCut & { tone: CutTone } => Boolean(i.tone))
  if (cuts.length < 2) return null
  const mid: CutTone = {
    brightness: round3(median(cuts.map((c) => c.tone.brightness))),
    saturation: round3(median(cuts.map((c) => c.tone.saturation))),
  }
  let maxB = 0
  let maxS = 0
  const outliers: ToneOutlier[] = []
  for (const c of cuts) {
    const dBrightness = round3(c.tone.brightness - mid.brightness)
    const dSaturation = round3(c.tone.saturation - mid.saturation)
    maxB = Math.max(maxB, Math.abs(dBrightness))
    maxS = Math.max(maxS, Math.abs(dSaturation))
    if (Math.abs(dBrightness) > limits.brightness || Math.abs(dSaturation) > limits.saturation) {
      outliers.push({ section: c.section, ...c.tone, dBrightness, dSaturation })
    }
  }
  return { cuts: cuts.length, median: mid, maxDelta: { brightness: round3(maxB), saturation: round3(maxS) }, outliers }
}

/** 시험 원장 한 칸(toneSpread) — 페이지 편차 요약, 경고 컷 이름. tone 컷이 2장 아래면 null(칸 없음) */
export interface ToneSpreadLedger {
  cuts: number
  median: CutTone
  maxDelta: CutTone
  outliers: number
  outlierSections: string[]
}

export function toneSpreadLedger(images: readonly ToneCut[]): ToneSpreadLedger | null {
  const spread = pageToneSpread(images)
  if (!spread) return null
  return {
    cuts: spread.cuts,
    median: spread.median,
    maxDelta: spread.maxDelta,
    outliers: spread.outliers.length,
    outlierSections: spread.outliers.map((o) => o.section),
  }
}

/** 경고 한 줄 — 넘은 컷이 없으면 null */
export function toneWarningOf(spread: ToneSpreadLedger | null): string | null {
  if (!spread || spread.outliers === 0) return null
  return `톤 경고 ${spread.outliers}컷(${spread.outlierSections.join('·')}) — 페이지 중앙 밝기 ${spread.median.brightness}·채도 ${spread.median.saturation}, 문턱 밝기 ±${TONE_OUTLIER.brightness}·채도 ±${TONE_OUTLIER.saturation}(기록만)`
}
