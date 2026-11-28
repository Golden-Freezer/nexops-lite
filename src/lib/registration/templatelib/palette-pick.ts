/**
 * K 라인 색 조합을 비전 모델이 고르기(결정 카드 c28, 하네스 J26 — 가정 B5). palettepick 스위치(기본 off)를 켠 잡만 쓴다.
 * 고른 컨셉의 조합을 사진 색 순서(rankForPhoto)로 세운 앞 3개를 후보로 내고, 원본 사진 + 견본 3장(조합마다 한 장)을 보여 하나를 고르게 한다.
 * 콜이 실패하거나 답이 틀리면 지금 규칙(pickPalette)의 색을 쓴다. 고른 방식·후보·이유는 templatelib 기록 palette.pick에 남는다.
 * 이 파일은 순수 함수만 둔다(콜·그림 만들기는 agents/registration/pdp-palette-pick-agent).
 */

import { parseLlmJson } from '@/lib/agents/json-parser'
import { colorSetsOf, rankForPhoto, type ColorSet } from './color-sets'
import type { Concept } from './concepts'

/** 비전 모델에 보일 후보 수 */
export const PALETTE_PICK_COUNT = 3
const LABELS = ['A', 'B', 'C'] as const

/** 기록(section_plan.templatelib.palette.pick) — by 'vision'이면 모델이 고름, 'rule'이면 지금 규칙(실패·후보 부족) */
export interface PalettePickRecord {
  by: 'vision' | 'rule'
  /** 보여 준 후보 조합 id(견본 A·B·C 차례) */
  candidates: string[]
  reason?: string
  error?: string
}

/** 후보 — 사진 색에 맞는 순서(rankForPhoto)의 앞 3개. 규칙(pickPalette)과 같은 컨셉·같은 순서에서 고른다 */
export function paletteCandidatesOf(concept: Concept, productHex: string | null): ColorSet[] {
  return rankForPhoto(colorSetsOf(concept).sets, productHex).sets.slice(0, PALETTE_PICK_COUNT)
}

export const PALETTE_PICK_SYSTEM =
  'You are a senior e-commerce art director choosing the color set for a Korean mobile product detail page. ' +
  'Judge only how each color set looks next to the real product photo. Answer with JSON only.'

/** 견본 한 장 — 바탕·옅은 면·강조·짙은 면·본문 글자색을 같은 폭의 띠로(글자 없음 — 글꼴이 없어도 같은 그림) */
export function swatchSvgOf(set: ColorSet, width = 300, height = 200): string {
  const bands = [set.colors.base, set.colors.tint, set.colors.accent, set.colors.deep, set.colors.ink]
  const w = width / bands.length
  const rects = bands.map((fill, i) => `<rect x="${(i * w).toFixed(1)}" y="0" width="${(w + 0.5).toFixed(1)}" height="${height}" fill="${fill}"/>`).join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${rects}</svg>`
}

/** 사진 1장 뒤 견본이 A·B·C 차례로 붙는다는 안내와 후보 값 */
export function buildPalettePickPrompt(input: { product: string; candidates: readonly ColorSet[] }): string {
  const rows = input.candidates.map(
    (set, i) =>
      `${LABELS[i]} = image ${i + 2}: background ${set.colors.base}, light panel ${set.colors.tint}, accent ${set.colors.accent}, deep panel ${set.colors.deep}, text ${set.colors.ink}`,
  )
  return [
    `Product: ${input.product || '(no description)'}`,
    'Image 1 is the original product photo. The next images are color-set swatches; each swatch shows, left to right: background, light panel, accent, deep panel, text color.',
    ...rows,
    'Pick the ONE color set that makes this product photo look most natural and appealing on the page: harmonious with the product colors, no hue clash with the product, ' +
      'the product still stands out. Do not prefer a set only because it matches the product color exactly.',
    `Answer JSON: {"pick": "${LABELS.slice(0, input.candidates.length).join('" | "')}", "reason": "one short Korean sentence"}`,
  ].join('\n')
}

/** 답 → 후보 번호와 이유. 틀리면 던진다(callLlm 파싱 실패 = 콜 실패로 규칙 색) */
export function parsePalettePick(text: string, count: number): { index: number; reason: string } {
  const parsed = parseLlmJson(text) as { pick?: unknown; reason?: unknown } | null
  const pick = typeof parsed?.pick === 'string' ? parsed.pick.trim().toUpperCase() : ''
  const index = (LABELS as readonly string[]).indexOf(pick)
  if (index < 0 || index >= count) throw new Error(`색 고르기 답이 후보 밖: ${String(parsed?.pick ?? '')}`.slice(0, 120))
  const reason = typeof parsed?.reason === 'string' ? parsed.reason.trim().slice(0, 200) : ''
  return { index, reason }
}
