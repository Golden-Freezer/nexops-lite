/**
 * 디자인 컷 배경 플레이트 프롬프트(D1) — docs/plans/pdp-enrichment/08_DESIGN_CUTS.md §2.2~§2.4·§3 템플릿별 지시.
 * 플레이트는 글자도 제품도 사람도 없는 "무대"다. 제품은 편집기가 기존 컷을 얹고, 글자는 편집기 실제 텍스트다.
 * 받침 선·글자 안전 띠를 정규화 좌표(이미지 높이 %)로 못 박는다(편집기 크롭 창 §2.3 표와 같은 값). 텍스트 조립만 한다.
 * 2026-10-28 개정: 제품 누끼(알파)가 없는 동안(productAlpha false)은 받침·테이블을 그리지 않는다 — 직사각 제품 카드가 받침 위에
 * 떠 보였다(D P02). 벽은 원천 사진 촬영 배경 계열(photoBackground, 없으면 tint)이고, 광원 방향·색온도는 제품 컷의 스타일 헌장과 같다.
 */

export type PlateTemplate = 'T1' | 'T3a' | 'T3c' | 'T6' | 'T8'

export interface PlatePromptInput {
  template: PlateTemplate
  palette: { accent: string; deep: string; tint: string; photoBackground?: string }
  /** 제품 레이어 누끼 여부 — false면 받침·테이블 없이 벽만(편집기가 직사각 컷을 얹는다) */
  productAlpha?: boolean
  /** 제품 컷 스타일 헌장의 광원(pdp-image-stage buildStyleCharterForJob과 같은 값) — 없으면 왼쪽 위 부드러운 빛 */
  lighting?: { direction: string; shadowAngle: number; temperature: string }
  /** 카테고리 — 장면 맥락(받침 소품)·재질 선택용 */
  category: string | null | undefined
  /** POINT 번호(T3a) — 같은 제품 컷이 반복되므로 장마다 맥락·밝기를 바꾼다 */
  chapter?: number | null
}

/** 장면 맥락(08 §3 T3a) — 소품 2개로만 암시. 장 번호로 돌린다 */
/** 카테고리별 생활 장소 — 플레이트 소품 맥락과 R2 세트(scene-set.ts)의 받침면 장소가 같은 표를 쓴다 */
export const CONTEXTS: Record<string, string[]> = {
  household: ['kitchen counter', 'bathroom shelf', 'laundry room shelf', 'entryway console'],
  food: ['kitchen counter', 'dining table', 'pantry shelf', 'breakfast table'],
  beauty: ['bathroom shelf', 'vanity table', 'bedside table', 'bathroom counter'],
  stationery: ['desk', 'bookshelf', 'study table', 'craft table'],
  digital: ['desk', 'office desk', 'living room side table', 'study table'],
  fashion: ['entryway console', 'dresser top', 'bedroom shelf', 'closet shelf'],
  pet: ['living room floor corner', 'entryway console', 'kitchen counter', 'balcony shelf'],
}
export const DEFAULT_CONTEXTS = ['living room shelf', 'desk', 'kitchen counter', 'entryway console']
/** T3c 재질(08 §3 T3c) */
const MATERIALS: Record<string, string> = {
  food: 'wood grain',
  beauty: 'stone',
  stationery: 'paper',
  fashion: 'linen',
}

const STRICT =
  'STRICT: NO TEXT. no letters, no numerals, no symbols, no logos, no brand marks, no watermarks, no labels, ' +
  'no packaging, no product, no people, no hands. The image must be a clean empty backdrop only.'
const DEFAULT_LIGHT =
  'LIGHT: soft diffuse key light from upper left, gentle falloff, subtle grain, shallow depth of field on props.'
/** 받침·테이블 금지(제품 누끼 없음) — 편집기가 직사각 제품 컷을 얹으므로 받침 위에 뜬 액자가 되지 않게 */
const NO_STAGE =
  'NO podium, NO pedestal, NO table, NO shelf surface, NO floor line, NO horizon line; a seamless wall only.'

const lightOf = (input: PlatePromptInput) =>
  input.lighting
    ? `LIGHT: soft key light from ${input.lighting.direction}, shadows falling at ${input.lighting.shadowAngle} degrees, ${input.lighting.temperature} color temperature — match the product photos on this page; gentle falloff, subtle grain.`
    : DEFAULT_LIGHT

/**
 * 흰 글자가 얹히는 짙은 바탕 템플릿(T3c 분위기·T8 마무리) — 벽을 밝게 하면 흰 글자 대비가 무너진다(verifier: 스크림 위 2.0~3.0)
 */
const DARK_TEXT_TEMPLATES = new Set<PlateTemplate>(['T3c', 'T8'])

/** 누끼 없음: 벽 = 사진 배경 계열, 강조색은 아주 조금. 누끼 있음(향후)·짙은 바탕 템플릿: 짙은 무대 */
function colorOf(input: PlatePromptInput, gradient: 'linear' | 'radial' = 'linear'): string {
  const p = input.palette
  if (input.productAlpha || DARK_TEXT_TEMPLATES.has(input.template))
    return `COLOR: dominant ${p.deep} and ${p.accent}, soft ${gradient} gradient, tint ${p.tint} highlights; no more than 4 hues.`
  const wall = p.photoBackground ?? p.tint
  return `COLOR: dominant ${wall} with ${p.tint}, very soft ${gradient} tonal gradient; ${p.accent} only as a tiny accent if any; no more than 3 hues; keep it light and close to ${wall}.`
}

/** 템플릿별 플레이트 프롬프트(영문) — 화면비는 지시만, 실제 크기는 생성 태스크의 비율 힌트가 정한다 */
export function buildPlatePrompt(input: PlatePromptInput): string {
  const { palette: p } = input
  const category = input.category ?? ''
  const contexts = CONTEXTS[category] ?? DEFAULT_CONTEXTS
  const staged = Boolean(input.productAlpha)
  const wall = p.photoBackground ?? p.tint
  const light = lightOf(input)
  const noStage = staged ? [] : [NO_STAGE]
  switch (input.template) {
    case 'T1':
      return [
        'vertical 2:3 empty stage / backdrop image for a Korean e-commerce detail page.',
        staged
          ? `SCENE: empty premium product-stage backdrop, deep ${p.deep} to ${p.accent} soft vertical gradient wall, a low round podium, faint floor reflection.`
          : `SCENE: empty seamless studio backdrop, a smooth ${wall} wall with a very soft vertical tonal gradient toward ${p.tint}.`,
        staged
          ? 'COMPOSITION: the podium top edge sits at 78% of image height, centered; nothing on the podium; the central 60% width above the podium stays EMPTY for a product placed later; the upper 33% is calm, low-detail, evenly toned negative space reserved for typography.'
          : 'COMPOSITION: the central 60% width of the lower two thirds stays EMPTY for a product photo placed later; the upper 33% is calm, low-detail, evenly toned negative space reserved for typography.',
        ...noStage,
        colorOf(input),
        light,
        'PROPS: none.',
        STRICT,
      ].join('\n')
    case 'T8':
      return [
        'vertical 2:3 empty stage / backdrop image for a Korean e-commerce detail page.',
        staged
          ? `SCENE: empty premium product-stage backdrop, darker than an opening hero: deep ${p.deep} wall with a deeper vignette, a low round podium.`
          : `SCENE: empty seamless studio backdrop for a closing scene, a smooth deep ${p.deep} wall with a soft ${p.accent} glow and a gentle vignette; white typography will sit on it.`,
        staged
          ? 'COMPOSITION: the podium top edge sits at 77.5% of image height, centered; nothing on the podium; the central 60% width above the podium stays EMPTY for a product placed later; the upper 37% is calm, low-detail, evenly toned negative space reserved for typography.'
          : 'COMPOSITION: the central 60% width of the lower two thirds stays EMPTY for a product photo placed later; the upper 37% is calm, low-detail, evenly toned negative space reserved for typography.',
        ...noStage,
        colorOf(input, 'radial'),
        light,
        'PROPS: none.',
        STRICT,
      ].join('\n')
    case 'T3a': {
      const n = Math.max(0, (input.chapter ?? 1) - 1)
      const context = contexts[n % contexts.length]
      const tone = n % 4 < 2 ? 'bright, airy' : 'slightly deeper, warm'
      return [
        'square 1:1 empty stage / backdrop image for a Korean e-commerce detail page.',
        staged
          ? `SCENE: clean tabletop still-life stage, ${context} suggested only by 2 blurred props at the far left and right edges, ${tone} mood.`
          : `SCENE: soft seamless ${wall} backdrop wall, ${context} mood suggested only by 2 blurred props at the far left and right edges, ${tone} mood.`,
        staged
          ? 'COMPOSITION: the surface top edge sits at 79% of image height; the surface is empty; the central 60% width above the surface stays EMPTY for a product placed later.'
          : 'COMPOSITION: the central 60% width stays EMPTY for a product photo placed later.',
        ...noStage,
        colorOf(input),
        light,
        'PROPS: at most 2 context props, only at the far left/right edges outside the central 60%, partially cropped, blurred.',
        STRICT,
      ].join('\n')
    }
    case 'T3c':
      return [
        'vertical 2:3 atmosphere backdrop image for a Korean e-commerce detail page.',
        // 광원 방향은 LIGHT 줄 하나만(헌장 값이 있으면 장면 문구에 고정 방향을 쓰지 않는다)
        `SCENE: moody atmospheric still scene, ${MATERIALS[category] ?? 'linen'} texture close-up with soft window light${input.lighting ? '' : ' from upper left'}, shallow depth of field.`,
        'COMPOSITION: the band from 38% to 69% of image height is calm, low-detail, evenly toned negative space reserved for typography; no focal object.',
        colorOf(input),
        light,
        'PROPS: none.',
        STRICT,
      ].join('\n')
    case 'T6':
      return [
        'square 1:1 backdrop image for a Korean e-commerce detail page.',
        `SCENE: top-down flat seamless surface in ${p.tint}, extremely subtle paper-like texture.`,
        'COMPOSITION: soft even light with no hard shadows; a centered empty area 70% of the width; nothing else.',
        `COLOR: ${p.tint} with a faint ${p.accent} tint at the edges; no more than 2 hues.`,
        'PROPS: none.',
        STRICT,
      ].join('\n')
  }
}
