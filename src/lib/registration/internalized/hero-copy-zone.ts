/**
 * D2-3 첫 화면 글자 자리(PDP-DR-PLAN §2 C4) — designcut2 잡의 첫 화면 세트 장면 컷은 위 1/3을 글자 없는 저디테일 자리로 비우고
 * 상품을 그 아래에 화면 폭 55% 이상으로 둔다. 편집기가 그 자리에 편집 텍스트 제목을 얹는다(편집기 변형은 #327 뒤).
 * 생성 뒤 그 자리의 밝기 퍼짐·잔결·글자 대비를 재고($0, 측정은 designcut-photo measureHeroCopyZone) 미달이면 지시를 강화해
 * 한 번 다시 만든다(이번 run에 시간이 모자라면 다음 run 맨 앞으로 미룬다). 그래도 미달이면 편집기는 지금 T1을 쓴다.
 * 결과는 hero SectionImage.copyZone(계획 밖 키)에 남긴다.
 * 이 파일은 순수 함수만 둔다(시험은 이 함수들로 한다).
 */

import type { SectionImage } from '../pdp-state'

/** 프롬프트가 비우라고 하는 위쪽 띠(세로 비율) */
export const HERO_COPY_ZONE = { from: 0, to: 0.33 } as const
/** 재는 상자의 아래 끝(세로 비율) — 편집기 첫 화면 겹침(D2-3)은 이 선 위에만 글자를 얹는다(templatesScene) */
export const COPY_ZONE_MEASURE_BOTTOM = 0.3
/** 재는 상자(가로·세로 비율) — 비운 띠에서 상품 윗부분·그림자가 닿을 수 있는 아래 가장자리와 좌우 끝을 뺀다 */
const MEASURE_BOX = { x0: 0.05, x1: 0.95, y0: 0.02, y1: COPY_ZONE_MEASURE_BOTTOM }
/** 시작 문턱 — 밝기 표준편차·이웃 화소 평균 절대차(0~255, 64px 폭)는 이하, 글자 대비(WCAG 비)는 이상. R<n>-D2 측정에서 조정한다 */
export const COPY_ZONE_LIMITS = { std: 28, gradient: 6, contrast: 4.5 } as const
/** 측정 해상도(가로 px) */
export const COPY_ZONE_SAMPLE_PX = 64
/** 글자색 — 짙은 제목색(#1a1a1a)과 흰색의 상대 휘도 */
const DARK_INK_LUMINANCE = luminanceOf(0x1a)
const LIGHT_INK_LUMINANCE = 1

export type CopyZoneReason = 'detail' | 'contrast'

export interface CopyZoneMeasure {
  pass: boolean
  /** 밝기 표준편차(0~255) */
  std: number
  /** 이웃 화소 평균 절대차(0~255) — 잔결·가장자리 */
  gradient: number
  /** 더 잘 읽히는 글자색과 그 글자색에 가장 불리한 화소(어두운 글자는 하위 10%, 흰 글자는 상위 10%) 사이 대비 */
  contrast: number
  /** 그 글자색 — 편집기 변형이 제목 색으로 쓴다 */
  ink: 'dark' | 'light'
  reasons?: CopyZoneReason[]
}

export interface HeroCopyZoneRecord {
  version: 1
  /** 비우라고 한 위쪽 띠 */
  zone: { from: number; to: number }
  /** 이 컷을 만든 지시 — 1 = 첫 지시(게이트·편집기 재생성 포함), 2 = 강화 지시(글자 자리 재생성) */
  attempt: 1 | 2
  /** 잰 값 — 재지 못하면 없고 failed에 사유 */
  measure?: CopyZoneMeasure
  failed?: 'sharp_unavailable' | 'decode_failed'
  /**
   * 처음 컷을 둔 경우의 글자 자리 재생성 상태 — pending 이번 run에 재생성 + 게이트 시간이 모자라 다음 run 맨 앞으로 미룸(뒤 상품 컷도
   * 함께 기다린다), kept 다시 만든 컷이 미달·게이트 미달·판정 못 함·생성 실패, skipped 미룬 run에도 시간이 모자라거나 지출 예약이 막힘
   */
  retry?: 'pending' | 'kept' | 'skipped'
  /** 쓰지 않은 다른 컷의 잰 값(문턱 조정용) */
  other?: CopyZoneMeasure
}

/** sRGB 8비트 값의 상대 휘도(WCAG) — 회색조 화소는 이 값이 휘도다. K 사진 위 글 바탕 측정(templatelib overlay measureBackdrop)도 이 식을 쓴다 */
export function luminanceOf(value: number): number {
  const c = value / 255
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

/** sRGB 8비트 색 화소의 상대 휘도(WCAG) */
export function rgbLuminance(r: number, g: number, b: number): number {
  return 0.2126 * luminanceOf(r) + 0.7152 * luminanceOf(g) + 0.0722 * luminanceOf(b)
}

/** 두 상대 휘도의 대비(WCAG 비) — 밝은 쪽이 위다 */
export function luminanceContrast(a: number, b: number): number {
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

const round = (n: number, digits: number) => Math.round(n * 10 ** digits) / 10 ** digits

/** 회색조 화소(가로 width, 세로 height)의 위쪽 띠를 잰다. 잴 화소가 모자라면 null */
export function measureCopyZone(gray: Uint8Array, width: number, height: number): CopyZoneMeasure | null {
  const x0 = Math.floor(width * MEASURE_BOX.x0)
  const x1 = Math.ceil(width * MEASURE_BOX.x1)
  const y0 = Math.floor(height * MEASURE_BOX.y0)
  const y1 = Math.ceil(height * MEASURE_BOX.y1)
  if (x1 - x0 < 2 || y1 - y0 < 2 || gray.length < width * height) return null
  const values: number[] = []
  let gradSum = 0
  let gradCount = 0
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const v = gray[y * width + x]
      values.push(v)
      if (x + 1 < x1) {
        gradSum += Math.abs(v - gray[y * width + x + 1])
        gradCount++
      }
      if (y + 1 < y1) {
        gradSum += Math.abs(v - gray[(y + 1) * width + x])
        gradCount++
      }
    }
  }
  const mean = values.reduce((s, v) => s + v, 0) / values.length
  const std = Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length)
  const gradient = gradSum / gradCount
  const sorted = [...values].sort((a, b) => a - b)
  const p10 = sorted[Math.floor(0.1 * (sorted.length - 1))]
  const p90 = sorted[Math.ceil(0.9 * (sorted.length - 1))]
  const darkContrast = (luminanceOf(p10) + 0.05) / (DARK_INK_LUMINANCE + 0.05)
  const lightContrast = (LIGHT_INK_LUMINANCE + 0.05) / (luminanceOf(p90) + 0.05)
  const ink = darkContrast >= lightContrast ? 'dark' : 'light'
  const contrast = Math.max(darkContrast, lightContrast)
  const reasons: CopyZoneReason[] = []
  if (std > COPY_ZONE_LIMITS.std || gradient > COPY_ZONE_LIMITS.gradient) reasons.push('detail')
  if (contrast < COPY_ZONE_LIMITS.contrast) reasons.push('contrast')
  return {
    pass: reasons.length === 0,
    std: round(std, 1),
    gradient: round(gradient, 2),
    contrast: round(contrast, 2),
    ink,
    ...(reasons.length > 0 ? { reasons } : {}),
  }
}

export const COPY_ZONE_HEADER = '[Copy zone]'
/** 글 자리에 두지 않는 것 — D2 첫 화면과 K 사진 위 글(shot-brief Frame 줄)이 같은 말을 쓴다 */
export const COPY_ZONE_KEEP_CLEAR =
  'with no props, no product parts and no strong edges, patterns, shadows or bright highlights in it. ' +
  'The page layout adds its headline there later, so draw no text, letters, numerals, logos or signs in it.'
const COPY_ZONE_RULE =
  'Leave the top third of the frame (the top 33%) as a calm, low-detail part of the set — one even tone of wall or softly ' +
  `out-of-focus background, ${COPY_ZONE_KEEP_CLEAR} Place the whole ` +
  'product in the lower two thirds — its top edge below the top third and its width at least 55% of the frame width. This wins ' +
  'over any centered placement or frame-fill share above.'
const RETRY_LINES: Record<CopyZoneReason, string> = {
  detail: 'The previous attempt left too much detail in that top band — make it plainer: one smooth tone with nothing crossing it.',
  contrast:
    'The previous attempt made that top band a mid tone that headline text cannot read on — make it clearly light or clearly dark, in one even tone.',
}

/** 글자 자리 지시 블록 — 강화 지시(재생성)는 처음 컷의 미달 사유를 한 줄씩 덧붙인다 */
export function buildCopyZoneBlock(retry?: CopyZoneMeasure | null): string {
  const lines = (retry?.reasons ?? []).map((r) => RETRY_LINES[r])
  return [COPY_ZONE_HEADER, COPY_ZONE_RULE, ...lines].join('\n')
}

/** 첫 화면 컷에만 글자 자리 블록을 붙인다(D2 잡에서 부르는 쪽이 고른다) */
export function withCopyZone(prompt: string, section: string, retry?: CopyZoneMeasure | null): string {
  return section === 'hero' ? `${prompt}\n\n${buildCopyZoneBlock(retry)}` : prompt
}

/** 글자 자리를 강화 지시로 다시 만들어 볼 컷 — 잰 값이 미달이고, 첫 지시 컷이며, 아직 재생성 결과가 없고, 끝난 오류가 없다 */
export function needsCopyZoneRetry(entry: SectionImage): boolean {
  return retryable(entry) && !entry.copyZone?.retry
}

/** 앞 run이 미룬 글자 자리 재생성 — 다음 run 맨 앞의 일이 된다 */
export function copyZoneRetryPending(entry: SectionImage): boolean {
  return retryable(entry) && entry.copyZone?.retry === 'pending'
}

function retryable(entry: SectionImage): boolean {
  const zone = entry.copyZone
  return (
    entry.section === 'hero' &&
    Boolean(entry.url) &&
    !entry.error &&
    !entry.pendingRegen &&
    zone?.measure?.pass === false &&
    zone.attempt === 1
  )
}

/**
 * 다시 만든 컷을 쓸지 — 생성이 됐고(새 url·오류 없음) 게이트가 미달이 아니며 글자 자리를 통과했을 때만 쓴다. 판정하지 못한 게이트는
 * 부르는 쪽이 null로 넘긴다(정체성을 확인한 처음 컷을 확인 못 한 컷으로 바꾸지 않는다 — 편집기 재생성과 같다). 아니면 처음 컷을 두고
 * 재생성 결과를 kept로 남긴다 — 처음 컷도 미달이라 편집기는 지금 T1을 쓴다
 */
export function settleCopyZoneRetry(
  first: SectionImage,
  retry: SectionImage,
  gateVerdict: 'pass' | 'skip' | 'fail' | null
): SectionImage {
  const produced = Boolean(retry.url) && retry.url !== first.url && !retry.error
  const adopt = produced && gateVerdict !== null && gateVerdict !== 'fail' && retry.copyZone?.measure?.pass === true
  if (adopt) {
    const other = first.copyZone?.measure
    return { ...retry, pendingRegen: false, copyZone: { ...retry.copyZone!, ...(other ? { other } : {}) } }
  }
  const other = produced ? retry.copyZone?.measure : undefined
  return { ...first, copyZone: { ...first.copyZone!, retry: 'kept', ...(other ? { other } : {}) } }
}
