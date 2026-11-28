/**
 * palette2 — D2 아트 디렉션 v2의 대상별 팔레트(docs/plans/pdp-enrichment/PALETTE2.md, 오너 지시 2026-10-31).
 * 아동·어린이집·답례 대상 잡(학부모 대리 구매형 판정 또는 상품명·대상 줄·카테고리 낱말)은 밝은 고채도 4색(버터 옐로·코럴 핑크·민트·스카이) 가운데 제품색에 가장 가까운 주색 하나와
 * 짝 표의 보조색 2개를 쓴다. 그 밖의 잡은 calm — 색은 지금 그대로다. 같은 상품은 항상 같은 색(결정론).
 * 대비는 검사기와 같은 WCAG 상대 휘도로 맞춘다 — 강조 글자는 스튜디오 면 위 4.5:1(L*를 2씩 내림), 못 맞추면 잉크.
 */

import { contrastRatio, parseColor } from '../editor/utils/mobileReadability'
import { isAgeRestricted } from '../compliance-gate'
import { readJobAudience } from '../parent-proxy'
import type { DesigncutPalette2, PdpSpecSheet } from '../pdp-state'
import { lchToHex, rgbToLch } from './designcut-palette'

type Swatch = 'butter' | 'coral' | 'mint' | 'sky'

/** 명도대를 맞춘 밝은 고채도 4색(L* 72~86, C* 38~62) — 띠·배지·카드 채움이라 그 위 글자는 진한 잉크다 */
export const SWATCHES: Record<Swatch, { l: number; c: number; h: number }> = {
  butter: { l: 86, c: 62, h: 92 },
  coral: { l: 72, c: 52, h: 28 },
  mint: { l: 82, c: 42, h: 172 },
  sky: { l: 78, c: 38, h: 238 },
}
/** 주색 → 보조색 2(스티커 배지 교대) */
const PAIRS: Record<Swatch, [Swatch, Swatch]> = {
  butter: ['coral', 'sky'],
  coral: ['butter', 'mint'],
  mint: ['coral', 'butter'],
  sky: ['butter', 'coral'],
}
/** 제품색으로 볼 최소 채도 — 못 미치면(흰·회 상품) 버터 옐로 */
const MIN_PRODUCT_CHROMA = 15
const MAX_ADJUST_STEPS = 12

const hueDistance = (a: number, b: number) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b))

/**
 * 아동·어린이집·답례 대상 낱말(오너 지시 '아동·어린이집·선물 대상은 밝고 아기자기하게', 통합 보정 10-31) — 상품명·대상 줄·카테고리에서
 * 찾는다. '선물'·'아이'만으로는 켜지 않는다: 한우·향수 선물세트, 아이 크림(눈가), 반려동물의 '우리 아이' 같은 오탐이 많다(검수 10-31).
 * 아이 선물은 어린이·유아·어린이집 낱말이나 학부모 대리 구매형 판정으로 잡힌다. 판정 모듈의 상품명 낱말(어린이집·유치원·구디백)을 포함한다
 */
const CHILD_TERMS = /어린이집|유치원|구디백|어린이|유아|아동|답례/

/** 톤 근거 — 상품명·대상 줄·카테고리(spec)와 연령 게이트 칸 */
export type PaletteToneInput = Partial<Pick<PdpSpecSheet, 'productName' | 'targetPersona' | 'category' | 'minAgeYears'>>

/**
 * 대상 톤 — 학부모 대리 구매형 판정, 또는 상품명·대상 줄·카테고리에 아동·어린이집·답례 낱말이 있으면 playful, 아니면 calm.
 * 연령 게이트 잡(판정 기록의 ageGate 또는 spec.minAgeYears 경계 이상)은 calm이다(게이트 규칙이 우선 — parent-proxy와 같은 원칙)
 */
export function paletteToneOf(analysis: unknown, spec?: PaletteToneInput | null): Pick<DesigncutPalette2, 'tone' | 'basis'> {
  const audience = readJobAudience(analysis)
  const gated = audience?.ageGate || isAgeRestricted({ productName: spec?.productName ?? '', minAgeYears: spec?.minAgeYears })
  if (gated) return { tone: 'calm', basis: 'default' }
  if (audience) return { tone: 'playful', basis: 'parent_proxy' }
  const text = [spec?.productName, spec?.targetPersona, spec?.category].filter(Boolean).join('\n')
  return CHILD_TERMS.test(text) ? { tone: 'playful', basis: 'target_terms' } : { tone: 'calm', basis: 'default' }
}

/** 제품색(계획 팔레트 accent) 색상각에 가장 가까운 견본 — 무채면 버터 옐로 */
export function primarySwatchOf(productHex: string | undefined): Swatch {
  const rgb = parseColor(productHex)
  const lch = rgb ? rgbToLch(rgb) : null
  if (!lch || lch.c < MIN_PRODUCT_CHROMA) return 'butter'
  return (Object.keys(SWATCHES) as Swatch[]).reduce((best, s) =>
    hueDistance(SWATCHES[s].h, lch.h) < hueDistance(SWATCHES[best].h, lch.h) ? s : best
  )
}

/** on 위 대비가 need 이상이 될 때까지 L*를 2씩 내린다. 실패하면 null */
function darkenOn(start: { l: number; c: number; h: number }, on: string, need: number): string | null {
  const bg = parseColor(on)!
  for (let i = 0; i <= MAX_ADJUST_STEPS; i++) {
    const hex = lchToHex({ ...start, l: start.l - i * 2 })
    if (contrastRatio(parseColor(hex)!, bg) >= need) return hex
  }
  return null
}

/** palette2 기록 — calm이면 톤만, playful이면 색까지. productHex는 계획 팔레트 accent(제품색 파생), ink는 계획 잉크 */
export function buildPalette2(
  analysis: unknown,
  spec: PaletteToneInput | null | undefined,
  productHex: string | undefined,
  ink: string
): DesigncutPalette2 {
  const tone = paletteToneOf(analysis, spec)
  if (tone.tone === 'calm') return tone
  const main = primarySwatchOf(productHex)
  const h = SWATCHES[main].h
  const studio = lchToHex({ l: 97, c: 5, h })
  // 노랑은 같은 색상각으로 어둡게 내리면 올리브·겨자색이 된다(오너 지적 10-31 — 버터 L86 → 강조 글자 #806C02) — 강조 글자·제목·
  // 짙은 색은 잉크로 두고 강조는 버터 형광 띠로 그린다(compose가 강조 글자 = 잉크면 highlight)
  const yellow = main === 'butter'
  return {
    ...tone,
    colors: {
      primary: lchToHex(SWATCHES[main]),
      secondary: PAIRS[main].map((s) => lchToHex(SWATCHES[s])) as [string, string],
      studio,
      accentText: yellow ? ink : (darkenOn({ l: 52, c: Math.min(SWATCHES[main].c, 55), h }, studio, 4.5) ?? ink),
      heading: yellow ? ink : lchToHex({ l: 22, c: 14, h }),
      deep: yellow ? ink : (darkenOn({ l: 34, c: 30, h }, '#FFFFFF', 4.5) ?? ink),
    },
  }
}
