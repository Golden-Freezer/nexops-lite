/**
 * 대표이미지 3컷 프롬프트 결정론 조립 — NEXFIT server/thumbnail/profiles.py(425줄) 전량 번역.
 *
 * 원칙(원본 보존 — 설계문서 §7): 프롬프트 영문 본문은 의미 변경 없이 그대로 옮기고,
 * f-string 슬롯만 TS 함수 인자로 변환한다. 각 상수에 원본 파일:행 출처를 남긴다.
 * LLM에게 프롬프트 저작을 맡기지 않는다 — 규칙 레일은 항상 이 코드가 감싼다(원본 P4 사고 교훈).
 */

import type { ProductForm, PackageRole, ThumbnailAnalysis, ThumbnailCategory, ThumbnailCut } from '@/lib/registration/thumbnail-types'

interface CategoryProfile {
  categoryScene: string
  studioOverride: string
  usesPerson: boolean
}

// NEXFIT profiles.py:15-75
export const CATEGORY_PROFILES: Record<ThumbnailCategory, CategoryProfile> = {
  fashion: {
    categoryScene:
      'A Korean model wearing the product. The face may be cropped outside the frame. ' +
      'Emphasize fit and natural drape.',
    studioOverride: 'Emphasize natural fabric drape and clearly resolved texture.',
    usesPerson: true,
  },
  food: {
    categoryScene:
      'No person. Show a completed cooking or plated serving scene that looks naturally appetizing.',
    studioOverride:
      'Bright natural daylight, appetizing color, fresh cues. ' +
      'No smoke, mist, dark moody gradient, or dramatic rim lighting.',
    usesPerson: false,
  },
  digital: {
    categoryScene:
      'A hand naturally operating the product, centered on its screen, buttons, and functional surfaces.',
    studioOverride: 'Use a restrained three-quarter angle that clearly presents the functional face.',
    usesPerson: true,
  },
  beauty: {
    categoryScene:
      'A hand demonstrating application, with a close-up view of spread and formula texture.',
    studioOverride: 'Use a clean subtle gradient with a controlled product swatch accent.',
    usesPerson: true,
  },
  stationery: {
    categoryScene: 'A hand writing or naturally using the product at a clean desk.',
    studioOverride: '',
    usesPerson: true,
  },
  packaging: {
    categoryScene: 'A hand using the product in a realistic packing-work scene.',
    studioOverride: '',
    usesPerson: true,
  },
  household: {
    categoryScene: 'A hand and part of the upper body naturally using the product; show no face.',
    studioOverride: '',
    usesPerson: true,
  },
  pet: {
    categoryScene: 'A dog or cat naturally using the product. No person is needed in the scene.',
    studioOverride: '',
    usesPerson: false,
  },
}

// NEXFIT profiles.py:77-83 — food × bulk_goods(원물) 전용 실사용 씬. 플레이팅 씬은
// identity 규칙(흙·질감 보존)과 충돌해 맥락 파탄을 반복했다(원본 2026-07-27 dev 3차 실증).
export const FOOD_BULK_HARVEST_SCENE =
  'The weathered hands of a Korean farmer proudly holding a generous handful of ' +
  'the freshly harvested product, right at the farm where it was pulled from the ' +
  "soil. Softly blurred field or farm background. The product's as-sold state — " +
  'including natural soil residue — belongs in this scene and must not be washed ' +
  'or polished. Do not show the product on a plate, dish, or dining table.'

// NEXFIT agents/design_prompt_agent.py:87
export const KOREAN_MODEL_INSTRUCTION = 'If any person appears, use a Korean adult model only.'

// NEXFIT agents/design_prompt_agent.py:72-84 — 제품 일관성 절대 규칙(원본 품질의 핵심, 원문 유지)
export const PRODUCT_CONSISTENCY_RULES = `
PRODUCT CONSISTENCY RULES (ABSOLUTE):
1. SHAPE: Maintain exact product shape and aspect ratio (±5%)
2. COLOR: Match exact color from reference - no artistic interpretation
3. LOGO/LABEL: If visible, preserve same position and size
4. MATERIAL: Preserve texture (fabric weave, plastic gloss, metal finish)
5. SIZE RATIO: Maintain component ratios (e.g., bottle + cap proportions)
6. COMPONENT COUNT & MECHANISM: Keep the number of tiers/levels, drawers, parts and
   set pieces exactly as in the reference. Do NOT invent parts, dials, buttons, handles,
   baskets or extra units that are not visible in the reference. Moving parts (drawers,
   lids, hinges) must stay in the same assembled/closed state shown in the reference —
   do not open, detach or explode them unless the reference shows them that way.
`

// NEXFIT profiles.py:85-90
const NEW_PHOTOGRAPH_BLOCK = (productSummary: string) => `TASK — NEW PHOTOGRAPH
Generate a newly photographed studio image of the same sellable product:
${productSummary}.
The reference images are evidence of product identity only. They are not
the output canvas and no rectangular portion of a reference photograph
may appear in the result.`

// NEXFIT profiles.py:92-103
const UNKNOWN_VIEWPOINT_BLOCK = `VIEWPOINT
Match the reference product orientation.
For a discrete single item: show the same visible faces, with the same yaw,
pitch and roll. Do not rotate, flip, or reveal a product face that is not
visible in the reference.
For loose bulk goods (many similar items): keep only the same camera elevation
and general viewing direction. Do not preserve the exact pile contour,
individual item positions, or occlusion pattern — create a newly arranged
grouping with the same observed distribution.
This viewpoint constraint applies only to the physical product pose.
It does not preserve reference pixels, source crop, image-plane geometry,
background, framing, scale, lighting, shadows, or source-photo borders.`

// NEXFIT profiles.py:105-111
const POSE_MATCH_VIEWPOINT_BLOCK = `VIEWPOINT
Match the reference product orientation.
Show the same visible faces, with the same yaw, pitch and roll. Do not rotate,
flip, or reveal a product face that is not visible in the reference.
This viewpoint constraint applies only to the physical product pose.
It does not preserve reference pixels, source crop, image-plane geometry,
background, framing, scale, lighting, shadows, or source-photo borders.`

// NEXFIT profiles.py:113-119
const BULK_VIEWPOINT_BLOCK = `VIEWPOINT
Keep only the same camera elevation and general viewing direction.
Do not preserve the exact pile contour, individual item positions, or occlusion
pattern — create a newly arranged grouping with the same observed distribution.
This viewpoint constraint applies only to camera elevation and viewing direction.
It does not preserve reference pixels, source crop, image-plane geometry,
background, framing, scale, lighting, shadows, or source-photo borders.`

// NEXFIT profiles.py:121-126
const VIEWPOINT_BLOCKS: Record<ProductForm, string> = {
  single_item: POSE_MATCH_VIEWPOINT_BLOCK,
  multi_item_set: POSE_MATCH_VIEWPOINT_BLOCK,
  bulk_goods: BULK_VIEWPOINT_BLOCK,
  unknown: UNKNOWN_VIEWPOINT_BLOCK,
}

// NEXFIT profiles.py:128-137 — 임팩트컷 전용. 규격컷의 포즈 고정을 물려주면
// "배경만 바뀌고 각도는 그대로"가 된다(원본 아쿠아슈즈 실증). 각도는 열되 날조만 막는다.
const IMPACT_VIEWPOINT_BLOCK = `VIEWPOINT — DYNAMIC
Choose a NEW dynamic camera angle different from the reference photo: a low
hero angle, a tilted action angle, or a dramatic close crop. You may freely
reposition and rotate the product to make the scene feel alive, as long as
every visible face, pattern, and feature exists somewhere in the references.
Never fabricate unseen sides, colors, or details that the references do not
show. This freedom does not preserve reference pixels, crop, framing, or
source-photo borders.`

// NEXFIT profiles.py:139-153
const FORM_PRESERVATION_INSTRUCTIONS: Record<ProductForm, string> = {
  single_item: '\nPreserve the observed physical shape and silhouette from the selected viewpoint.',
  multi_item_set:
    '\nPreserve the exact number and composition of items, including every observed ' +
    'SKU-specific component.',
  bulk_goods:
    '\nPreserve the observed distribution of sizes, shapes, colors, and surface variation. ' +
    'Do not preserve individual item positions. Do not beautify, homogenize, or make the ' +
    'goods more uniform than the reference.',
  unknown: '',
}

// NEXFIT profiles.py:155-166
const PACKAGE_ROLE_INSTRUCTIONS: Record<PackageRole, string> = {
  none: '',
  sellable_unit:
    '\nPreserve the sellable package shape, construction, visible label content, label ' +
    'position, and label proportion.',
  incidental: '\nThe incidental container must not appear in the result.',
  unknown:
    '\nIf visible packaging belongs to the sellable unit, preserve its package ' +
    'design; do not invent packaging.',
}

// NEXFIT profiles.py:168-176
const PRESERVE_PRODUCT_IDENTITY_BLOCK = (
  formInstruction: string,
  packageInstruction: string,
  labelInstruction: string
) => `PRESERVE PRODUCT IDENTITY
Preserve the product type, SKU-specific design, observed colors under neutral
light, material, surface texture, and visible product label/logo
content.${formInstruction}${packageInstruction} Do not add product features that are absent from all references.
If the references show multiple color or design variants of the product,
include EVERY variant exactly once as observed, each as its own complete
matched set (for footwear: a full pair) — never duplicate one variant
in place of another, and never invent a colorway the references do not show.
Do not restyle, recolor, resize, or upgrade the product's apparent grade.${labelInstruction}`

// NEXFIT profiles.py:178-184
const VARIANT_COHERENCE_RULE =
  'If the references show multiple color or design variants: feature EVERY ' +
  'variant in the scene — never omit one. Never mix variants within one ' +
  'worn pair or one in-use unit. Each variant is worn or used as its own ' +
  'complete matched set on a separate person, side by side in the same ' +
  'scene — one variant per person.'

// NEXFIT profiles.py:186-193
const SOURCE_REJECTION_BLOCK = `DISCARD SOURCE-PHOTO ATTRIBUTES
Do not reproduce the source background, source crop, source image border,
table, original lighting, or the original photo's framing.

INVALID OUTPUT
Any result containing a photo, card, poster, screen, or rectangular patch of
the reference photograph is invalid. The output must be one continuous
photograph, not a photo placed on a background.`

// NEXFIT profiles.py:266-274 — NO_TEXT_INSTRUCTION을 그대로 쓰면 모델이 제품 인쇄까지
// 지운다(원본 prod QA: "WASHBAG" 인쇄 소실). 썸네일은 "인쇄 보존 + 추가 금지"로 세분.
const THUMBNAIL_TEXT_RULE = `TEXT RULE
Text, logos, or patterns printed on the product itself in the references are
part of the product — preserve them exactly (same wording, position, size).
Never remove or alter them.
Beyond that, do NOT add any text, letters, numbers, watermarks, logos, badges,
or graphic overlays that the references do not show.`

// NEXFIT profiles.py:276-279
const COMMON_PROMPT_BLOCK = `${THUMBNAIL_TEXT_RULE}
The product must remain instantly recognizable when the image is scaled down
to 120px. Prioritize clear silhouette and color contrast over fine detail.
Square 1:1 composition.`

const HEX_COLOR_RE = /^#?([0-9a-fA-F]{6})$/

/** 첫 유효 hex의 (hue°, saturation) — colorsys.rgb_to_hsv 대응 (V=max, S=(max-min)/max) */
function firstColorHueSaturation(primaryColors: unknown): { degrees: number; saturation: number } | null {
  const colors = Array.isArray(primaryColors) ? primaryColors : []
  for (const value of colors) {
    const match = HEX_COLOR_RE.exec(String(value).trim())
    if (!match) continue
    const raw = match[1]
    const r = parseInt(raw.slice(0, 2), 16) / 255
    const g = parseInt(raw.slice(2, 4), 16) / 255
    const b = parseInt(raw.slice(4, 6), 16) / 255
    const max = Math.max(r, g, b)
    const min = Math.min(r, g, b)
    const saturation = max === 0 ? 0 : (max - min) / max
    let hue = 0
    if (max !== min) {
      const d = max - min
      if (max === r) hue = ((g - b) / d) % 6
      else if (max === g) hue = (b - r) / d + 2
      else hue = (r - g) / d + 4
      hue *= 60
      if (hue < 0) hue += 360
    }
    return { degrees: hue, saturation }
  }
  return null
}

// NEXFIT profiles.py:305-323 — 임팩트컷용 선명 보색 배경(검색 목록에서 튀는 색)
export function mapImpactBackground(primaryColors: unknown): string {
  const hs = firstColorHueSaturation(primaryColors)
  if (!hs) return 'a deep navy blue (#173A5E)'
  if (hs.saturation < 0.12) return 'a deep navy blue (#173A5E)'
  if (hs.degrees >= 330 || hs.degrees <= 90) return 'a deep teal green (#0E5B52)'
  if (hs.degrees >= 150 && hs.degrees <= 300) return 'a warm terracotta orange (#C05B33)'
  return 'a deep navy blue (#173A5E)'
}

// NEXFIT profiles.py:326-333 — 창의 계획 콜 실패 시 결정론 폴백
export function defaultImpactConcept(vividBackground: string): string {
  return (
    `Place the product on ${vividBackground} seamless backdrop with soft ` +
    'dramatic key lighting and a subtle spotlight falloff. Arrange the ' +
    'product on a slight dynamic diagonal with gentle depth of field, and ' +
    'add one small supporting prop that reinforces what the product is.'
  )
}

// NEXFIT profiles.py:336-340
function appendCommonBlock(prompt: string, includeAbsoluteRules: boolean): string {
  const common = includeAbsoluteRules
    ? `${PRODUCT_CONSISTENCY_RULES.trim()}\n${COMMON_PROMPT_BLOCK}`
    : COMMON_PROMPT_BLOCK
  return `${prompt.trim()}\n\n${common.trim()}`
}

// NEXFIT profiles.py:343-349 — 창의 콜에 전달할 실사용컷 씬 요약(같은 이야기 수렴 방지)
export function getUsageSceneSummary(analysis: Pick<ThumbnailAnalysis, 'product_form'>, category: string): string {
  if (!(category in CATEGORY_PROFILES)) return ''
  const key = category as ThumbnailCategory
  if (key === 'food' && analysis.product_form === 'bulk_goods') return FOOD_BULK_HARVEST_SCENE
  return CATEGORY_PROFILES[key].categoryScene
}

// NEXFIT profiles.py:195-211
const buildCutoutPrompt = (blocks: SharedBlocks) => `${blocks.newPhotograph}

${blocks.viewpoint}

${blocks.preserveIdentity}

TARGET IMAGE
A single seamless high-key studio photograph on uniform pure white (#FFFFFF).
The product's physical silhouette is directly surrounded by white.
Product centered with its longer side filling 90-96% of the image — nearly
edge-to-edge — while the ENTIRE product stays fully visible. Never crop the
product: no part of it may touch or extend beyond any image edge. Keep a thin,
even white margin on all four sides. Even, shadowless lighting.
No props, no hands, no incidental shipping carton unless the carton is the
sellable unit.

${blocks.sourceRejection}`

// NEXFIT profiles.py:213-255
const buildImpactPrompt = (
  blocks: SharedBlocks,
  creativeConcept: string,
  studioOverride: string
) => `${blocks.newPhotograph}

${IMPACT_VIEWPOINT_BLOCK}

${blocks.preserveIdentity}

CREATIVE DIRECTION
${creativeConcept}

TARGET IMAGE
A scroll-stopping commercial product photograph for a Korean e-commerce
search-results grid, captured as one continuous in-camera exposure.
The product is a LARGE CLOSE-UP hero filling most of the frame, perfectly
sharp — the viewer should instantly imagine themselves using it.
Follow the creative direction for backdrop, mood, action and composition.
One dynamic physical action element (splash, steam, motion) is encouraged
ONLY when it is physically natural for this product's real use, frozen
mid-motion and clearly CAUSED BY the product's own movement, obeying physics.
Never invent magical or unexplained effects — no floating objects, swirling
debris, or spontaneous dust that the product could not cause. If no action is
natural for this product, create impact through dramatic lighting, bold color
contrast, composition, and close-up instead.
The action element must pass BEHIND or AROUND the product: the product's key
face stays fully visible and unobstructed. Never let water, steam, dust, or
props cover the product.
The product must physically inhabit the scene — real contact with surfaces,
grounded shadows, reflections or wetness where the scene implies them.
It must never look pasted in or floating.
Each variant shown must appear as its complete matched set — for footwear,
BOTH shoes of each pair visible (stacked or offset arrangements welcome).
Never represent a variant with a single shoe or a partial set.
Hands interacting with the product are allowed when they strengthen the
usage moment; never show a face. Props support the product and must never
cover, crowd, or outshine it — everything physically integrated in one
real scene.
The backdrop fills the entire canvas edge-to-edge with natural photographic
depth (lighting falloff, gradient, or environment). No margin, border, empty
band, or rectangular region of any kind may appear.
Strong color contrast between product and backdrop so the product still pops
when the image is scaled down to a small search-grid tile.${studioOverride}
${KOREAN_MODEL_INSTRUCTION}

${blocks.sourceRejection}`

// NEXFIT profiles.py:257-264
const buildUsagePrompt = (
  productSummary: string,
  categoryScene: string,
  modelInstruction: string
) => `Natural usage scene of ${productSummary}, product in sharp focus occupying
55-70% of the frame.
Frame tightly at the body zone where the product is worn or handled (for
footwear: feet level) — the product dominates the frame; full bodies and
faces stay out of frame.
${categoryScene}
${VARIANT_COHERENCE_RULE}
Warm natural lighting. Shallow depth of field. Authentic, unstaged mood.${modelInstruction}`

interface SharedBlocks {
  newPhotograph: string
  viewpoint: string
  preserveIdentity: string
  sourceRejection: string
}

/**
 * 3컷 최종 프롬프트 조립 — NEXFIT profiles.py:352-425 build_thumbnail_prompts 1:1.
 * LLM에게 어떤 텍스트 저작도 맡기지 않는다(임팩트 컨셉만 예외 — 없으면 결정론 폴백).
 */
export function buildThumbnailPrompts(
  analysis: ThumbnailAnalysis,
  category: string,
  impactConcept?: string | null
): Record<ThumbnailCut, string> {
  if (!(category in CATEGORY_PROFILES)) {
    throw new Error(`Unsupported thumbnail category: ${category}`)
  }
  const profile = CATEGORY_PROFILES[category as ThumbnailCategory]

  let productForm: ProductForm = analysis.product_form
  if (!(productForm in VIEWPOINT_BLOCKS)) productForm = 'unknown'
  let packageRole: PackageRole = analysis.package_role
  if (!(packageRole in PACKAGE_ROLE_INSTRUCTIONS)) packageRole = 'unknown'
  const productSummary = String(analysis.product_summary || 'the reference product').trim()

  const labelInstruction =
    analysis.has_label_or_logo === true
      ? '\nKeep label and logo content, position and proportion faithful to the reference.'
      : ''
  let studioOverride = profile.studioOverride || ''
  if (studioOverride) studioOverride = `\n${studioOverride}`

  // food 원물은 플레이팅 씬 대신 수확 씬 — 사람(농부 손)이 등장하므로 한국인 지시도 붙는다.
  let categoryScene = profile.categoryScene
  let usesPerson = profile.usesPerson
  if (category === 'food' && productForm === 'bulk_goods') {
    categoryScene = FOOD_BULK_HARVEST_SCENE
    usesPerson = true
  }
  const modelInstruction = usesPerson ? `\n${KOREAN_MODEL_INSTRUCTION}` : ''

  const blocks: SharedBlocks = {
    newPhotograph: NEW_PHOTOGRAPH_BLOCK(productSummary),
    viewpoint: VIEWPOINT_BLOCKS[productForm],
    preserveIdentity: PRESERVE_PRODUCT_IDENTITY_BLOCK(
      FORM_PRESERVATION_INSTRUCTIONS[productForm],
      PACKAGE_ROLE_INSTRUCTIONS[packageRole],
      labelInstruction
    ),
    sourceRejection: SOURCE_REJECTION_BLOCK,
  }

  // 내부 키는 하위호환을 위해 "studio"를 유지 — 사용자 표기만 "임팩트컷"(원본 관례 동일).
  const concept =
    (impactConcept ?? '').trim() || defaultImpactConcept(mapImpactBackground(analysis.primary_colors))

  return {
    cutout: appendCommonBlock(buildCutoutPrompt(blocks), false),
    studio: appendCommonBlock(buildImpactPrompt(blocks, concept, studioOverride), false),
    usage: appendCommonBlock(buildUsagePrompt(productSummary, categoryScene, modelInstruction), true),
  }
}
