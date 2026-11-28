/**
 * K 라인 색 조합 비전 고르기 콜(결정 카드 c28, 하네스 J26) — palettepick 스위치 잡의 K 계획(select-line)만 부른다.
 * 원본 사진 1장 + 후보 견본(templatelib/palette-pick swatchSvgOf를 서버 sharp로 PNG) 3장을 보내 하나를 고르게 한다.
 * 실패는 던지지 않는다 — value null과 까닭을 돌려주면 부르는 쪽이 지금 규칙의 색을 쓴다(계획을 막지 않는다).
 * sharp는 함수 안에서 불러온다(바이너리 로드 실패가 이 모듈을 쓰는 라우트 전체를 죽이지 않게).
 */

import type { ImageBlockParam } from '@/lib/agents/llm/message-types'
import { billedCostOf } from '../billed-usage'
import { callLlm } from '../llm'
import type { RunContext } from '../types'
import type { StepOutcome } from './pdp-template-agent'
import type { VisionImage } from './thumbnail-vision-agent'
import { pdpRoute } from '@/lib/registration/pdp-model-routes'
import type { ColorSet } from '@/lib/registration/templatelib/color-sets'
import { buildPalettePickPrompt, PALETTE_PICK_SYSTEM, parsePalettePick, swatchSvgOf } from '@/lib/registration/templatelib/palette-pick'

const TIMEOUT_MS = 45_000

export type PalettePick = { index: number; reason: string } | null

function imageBlock(image: VisionImage): ImageBlockParam {
  return { type: 'image', source: { type: 'base64', media_type: image.mediaType, data: image.data } }
}

/** 견본 SVG → PNG(VisionImage) */
export async function swatchImageOf(set: ColorSet): Promise<VisionImage> {
  const mod = await import('sharp')
  const sharp = (mod as unknown as { default?: typeof import('sharp') }).default ?? (mod as unknown as typeof import('sharp'))
  const png = await sharp(Buffer.from(swatchSvgOf(set))).png().toBuffer()
  return { data: png.toString('base64'), mediaType: 'image/png' }
}

export async function pickPaletteByVision(
  photo: VisionImage,
  input: { product: string; candidates: readonly ColorSet[] },
  runContext?: RunContext,
  deps: { swatch?: (set: ColorSet) => Promise<VisionImage> } = {},
): Promise<StepOutcome<PalettePick>> {
  const fail = (error: string, costUsd = 0): StepOutcome<PalettePick> => ({ value: null, usedFallback: true, error, costUsd })
  let swatches: VisionImage[]
  try {
    swatches = await Promise.all(input.candidates.map(deps.swatch ?? swatchImageOf))
  } catch (e) {
    return fail(`견본 만들기 실패: ${(e instanceof Error ? e.message : String(e)).slice(0, 120)}`)
  }
  const route = pdpRoute('design/palette-pick')
  const result = await callLlm(
    route,
    {
      system: PALETTE_PICK_SYSTEM,
      messages: [{ role: 'user', content: [imageBlock(photo), ...swatches.map(imageBlock), { type: 'text', text: buildPalettePickPrompt(input) }] }],
      timeoutMs: route.callTimeoutMs ?? TIMEOUT_MS,
      agentName: 'registration/pdp-palette-pick',
      runContext,
    },
    (text) => parsePalettePick(text, input.candidates.length),
  )
  if (!result.success) {
    console.warn('[registration/pdp-palette-pick] 색 고르기 실패 — 규칙 색:', result.error.message)
    return fail(result.error.message, billedCostOf(result))
  }
  return { value: result.data, usedFallback: false, error: null, costUsd: billedCostOf(result) }
}
