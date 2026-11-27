/**
 * PDP 파이프라인 5단계(이미지 생성) 공통 규칙 + base 컷 빌더 — NEXFIT agents/image_presets.py(1,206줄) 중
 * §5.1·§5.2 판정 "이식" 구간(PROMPT-INVENTORY.md) 번역. PRO 전용 11종·게이트·식별카드는 별도 파일 소관.
 *
 * 원칙(원본 보존 — 설계문서 §7): 프롬프트 영문 본문은 의미·문구 변경 없이 그대로 옮기고,
 * f-string 슬롯만 TS 함수 인자로 변환한다. 각 상수/빌더에 원본 파일:행 출처를 남긴다.
 * hero_image_mode는 studio/lifestyle/premium 3-way만 번역한다 — "original"은 Pillow 합성
 * (photo_composite.py) 의존이라 제외한다(개정 4/D-2, HeroImageMode 타입에서도 이미 제외됨).
 * 팔레트 플레이스홀더(`{palette.primary}` 등)는 이 파일의 어떤 빌더에도 등장하지 않는다 — 그
 * 토큰은 pdp-design-prompts.ts(3단계) 소관이고, 치환은 images 단계 별도 함수 소관이다.
 */

import type { DesignPalette, HeroImageMode } from '@/lib/registration/pdp-state'

// ────────────────────────────────────────────────────────────────
// 공통 규칙 상수 (§5.1)
// ────────────────────────────────────────────────────────────────

// NEXFIT agents/image_presets.py:27-48 — 썸네일용(thumbnail-prompts.ts)과 문구가 다른 별개 상수.
export const PRODUCT_CONSISTENCY_RULES = `
PRODUCT CONSISTENCY RULES (ABSOLUTE):
1. SHAPE: If reference is rectangular, generated must be rectangular (same aspect ratio ±5%)
2. COLOR: Match exact color code from reference - no artistic interpretation
3. LOGO/LABEL: Preserve structural design elements, BUT omit any printed brand name or
   generic word text on the product surface (keep it blank/unbranded)
4. MATERIAL: Preserve texture (fabric weave, plastic gloss, metal finish)
5. SIZE RATIO: If product has components (e.g., bottle + cap), maintain their size ratio
6. COMPONENT COUNT & MECHANISM: Keep the number of tiers/levels, drawers, parts and set
   pieces exactly as in the reference. Do NOT invent parts, dials, buttons, handles,
   baskets or extra units that are not visible in the reference. Moving parts (drawers,
   lids, hinges) must stay in the same assembled/closed state shown in the reference —
   do not open, detach or explode them unless the reference shows them that way.

VERIFICATION CHECKLIST BEFORE OUTPUT:
- [ ] Does this look like the SAME product from different angle?
- [ ] Would a customer recognize this as identical item?
- [ ] Are brand elements (logo/text) consistent?
- [ ] Does it have the SAME number of tiers/drawers/parts as the reference, with no invented components?

If ANY checklist fails → REGENERATE
`

// NEXFIT agents/image_presets.py:50
export const NO_TEXT_INSTRUCTION =
  'IMPORTANT: Do NOT include any text, letters, watermarks, brand names, or logos on the generated image. The image should be clean graphics only.'

// NEXFIT agents/image_presets.py:51
export const KOREAN_MODEL_INSTRUCTION =
  'The model must be a Korean adult. Do NOT generate children, babies, or minors.'

// NEXFIT agents/image_presets.py:57-64
export const PROBLEM_SCENE_GUARD =
  "SCENE FOCUS RULE (ABSOLUTE): Center the composition on the PERSON's facial " +
  'expression and body language conveying the everyday frustration or situation. ' +
  'Do NOT depict any product, tool, device, gadget, instrument, or any old / ' +
  'industrial / alternative version of the product as a focal or prominent object. ' +
  'No products displayed on shelves or held up to the camera as the subject. ' +
  'Environment stays as soft, ambient context only — the emotion is the hero.'

// NEXFIT agents/image_presets.py:69-77
export const IP_PROTECTION_RULES =
  'IP PROTECTION RULE (ABSOLUTE): Do NOT depict any copyrighted or trademarked ' +
  'fictional character, mascot, anime/cartoon figure (e.g. Pokemon, Disney, ' +
  'Sanrio, or any licensed brand mascot) anywhere in the image — not as a main ' +
  'subject, prop, background decoration, or printed pattern. Props and ' +
  'decorations must be generic and unbranded. If the reference product itself ' +
  'depicts a licensed character, reproduce the product faithfully but do NOT ' +
  'add any additional licensed character elements beyond what the product photo shows.'

// NEXFIT agents/image_identity.py:62-71 — get_photography_base(text_bearing=True)가 사용
export const PRINTED_DESIGN_PRESERVE_INSTRUCTION =
  "PRINTED DESIGN PRESERVATION (this product's printed content IS the product):\n" +
  '- Reproduce the artwork, lettering, phrases and logos printed ON the product exactly as they ' +
  'appear in the reference image — same wording, same script (Korean stays Korean), same layout, ' +
  'same colors. Do NOT erase, translate, paraphrase or re-letter them.\n' +
  '- Do NOT add any text anywhere else: no captions, labels, watermarks or lettering on the ' +
  'background, props, surfaces or packaging outside the product itself.\n' +
  '- This product is a FLAT PRINTED ITEM. Render it as flat printed material (paper/vinyl sheet) — ' +
  'do NOT turn it into a plate, dish, ceramic, mug, box or any other three-dimensional object.'

// NEXFIT agents/image_identity.py:74-76
export function textRuleFor(textBearing: boolean, noTextInstruction: string): string {
  return textBearing ? PRINTED_DESIGN_PRESERVE_INSTRUCTION : noTextInstruction
}

// ────────────────────────────────────────────────────────────────
// 카테고리별 이미지 디렉티브 (§5.1)
// ────────────────────────────────────────────────────────────────

type CategoryDirectiveKey =
  | 'hero_angle'
  | 'problem_expression'
  | 'problem_scene'
  | 'solution_expression'
  | 'usage_scene'
  | 'usage_expression'
  | 'usage_environment'
  | 'cta_mood'
  | 'lighting_override'
  | 'feature_focus'
  | 'howto_context'

// NEXFIT agents/image_presets.py:83-188
export const CATEGORY_IMAGE_DIRECTIVES: Record<string, Partial<Record<CategoryDirectiveKey, string>>> = {
  food: {
    hero_angle: '45-degree overhead or eye-level, product packaging with appetite-appeal styling, fresh ingredients nearby',
    problem_expression: "Tired, bored expression scrolling delivery apps or staring at empty fridge — 'what should I eat today?' mood",
    problem_scene: 'Kitchen with delivery boxes piled up, or person staring blankly at phone food apps, meal fatigue',
    solution_expression: 'Delighted tasting expression — eyes slightly closed with satisfaction, natural smile while eating/holding product',
    usage_scene: 'Dining table, cooking preparation, lunchbox packing, or outdoor picnic — food being served or consumed',
    usage_expression: 'Genuine enjoyment while eating — natural savoring, sharing food with others, appetite-satisfying moment',
    usage_environment: 'Kitchen, dining room, café, or outdoor setting — warm inviting food atmosphere with tableware and ingredients',
    cta_mood: 'Appetite-triggering final shot — product with fresh ingredients, steam rising, rich warm saturated colors',
    lighting_override: 'Warm tungsten 3200-4000K side lighting to emphasize food texture and steam, appetite-appeal lighting',
    feature_focus: 'Ingredient close-up, texture/freshness detail, nutritional highlight, packaging seal quality',
    howto_context: 'Cooking preparation, plating, serving, or storage — hands preparing or serving food naturally',
  },
  beauty: {
    hero_angle: 'Slight low angle or eye-level, product on clean vanity surface with soft reflection, luminous atmosphere',
    problem_expression: 'Concerned expression examining skin in mirror, touching face with worry, looking at skin imperfections or dull complexion',
    problem_scene: 'Person at vanity mirror examining skin texture, visible pores or dullness, frustrated with makeup not staying',
    solution_expression: 'Confident radiant smile, gently touching glowing skin with satisfaction, self-assured luminous expression',
    usage_scene: 'Skincare routine at vanity, applying product in bright bathroom, morning or evening beauty ritual moment',
    usage_expression: 'Relaxed self-care pampering — gentle application motion, eyes closed enjoying the texture, serene beauty moment',
    usage_environment: 'Clean modern bathroom vanity, bedroom dressing table with mirror — bright soft feminine lighting',
    cta_mood: 'Aspirational beauty shot — product with dewy droplets, luminous skin glow effect, premium packaging radiance',
    lighting_override: 'Soft flattering beauty lighting 5000K, butterfly/clamshell setup, skin-smoothing diffused light',
    feature_focus: 'Texture swatch on skin, ingredient droplet close-up, absorption demonstration, before/after skin detail',
    howto_context: 'Step-by-step skincare application — cleansing, applying, patting, layering routine with gentle hand motions',
  },
  digital: {
    hero_angle: '3/4 angle showing screen or interface, slight elevated perspective to reveal product depth and build quality',
    problem_expression: 'Frustrated expression at slow or old device, squinting at small screen, tangled cables annoyance',
    problem_scene: 'Person struggling with outdated technology, cluttered desk with cables, loading spinner on screen, tech frustration',
    solution_expression: "Impressed 'wow' reaction, pleasantly surprised by speed or quality, focused productive engagement",
    usage_scene: 'Home office desk, living room sofa, commute, or café — device actively being used for its core function',
    usage_expression: 'Focused concentration or relaxed enjoyment — naturally immersed in using the device, tech satisfaction',
    usage_environment: 'Modern workspace with clean desk, living room tech setup, or on-the-go — sleek tech-friendly environment',
    cta_mood: 'Premium tech unboxing feel — product on clean surface with subtle LED accent, tech-aspirational desire',
    lighting_override: 'Cool-neutral 5500-6000K clean LED-style lighting, slight blue accent for modern tech atmosphere',
    feature_focus: 'Screen interface detail, port and button macro, build quality close-up, performance benchmark visualization',
    howto_context: 'Initial setup process, device pairing, settings configuration, first-time use walkthrough',
  },
  fashion: {
    hero_angle: 'Eye-level or slight low angle, product on mannequin/hanger or styled editorial flat lay arrangement',
    problem_expression: 'Indecisive expression in front of open closet, holding up ill-fitting clothes, outfit dissatisfaction',
    problem_scene: 'Messy closet with nothing to wear, pile of rejected outfits on bed, mirror showing unflattering fit',
    solution_expression: 'Confident stylish pose, natural model stance, pleased checking mirror, fashion-editorial satisfied mood',
    usage_scene: 'Street style walking, café entrance, office hallway, or mirror check — product worn in real daily context',
    usage_expression: 'Natural confident stride or candid laughter, stylish effortless pose — fashion editorial casual mood',
    usage_environment: 'Urban street, café terrace, modern building entrance, or natural outdoor — fashion-appropriate backdrop',
    cta_mood: "Wardrobe-desire shot — product beautifully styled or worn, 'I need this' aspirational fashion feeling",
    lighting_override: 'Natural daylight with fill 5200K, fashion editorial lighting, skin-flattering warm tones',
    feature_focus: 'Fabric weave macro, stitch quality detail, hardware/zipper close-up, fit silhouette demonstration',
    howto_context: 'Styling coordination tips, layering technique, care and washing method, folding or hanging storage',
  },
  household: {
    hero_angle: 'Slight overhead or 3/4 angle, product centered on clean domestic countertop or shelf',
    problem_expression: 'Mildly annoyed or tired expression dealing with household chore, slight exasperation at inefficiency',
    problem_scene: 'Messy disorganized space, inefficient old method in progress, time-consuming manual household task',
    solution_expression: "Relieved satisfied expression — 'this is so much easier' moment, pleasant surprise at convenience",
    usage_scene: 'Kitchen counter, bathroom shelf, living room floor, or storage area — product solving a real household task',
    usage_expression: 'Effortless ease and casual comfort while using product — practical no-fuss satisfied attitude',
    usage_environment: 'Modern Korean apartment — kitchen counter, bathroom, living room shelf, laundry area, organized space',
    cta_mood: 'Clean organized life — product in perfectly tidy setting, sense of domestic order and daily satisfaction',
    lighting_override: 'Bright neutral 5500K even domestic lighting, clean practical home atmosphere',
    feature_focus: 'Mechanism or structure close-up, material durability demo, size or capacity comparison, before/after tidiness',
    howto_context: 'Assembly or installation steps, usage technique demonstration, cleaning method, storage organization process',
  },
  packaging: {
    hero_angle: 'Flat lay or slight 3/4 angle showing packaging form, dimensions, and structural quality',
    problem_expression: 'Frustrated handling damaged delivery contents, struggling with flimsy or oversized packaging',
    problem_scene: 'Damaged package with dented contents, tape and scissors mess, overflowing recycling bin of wasted packaging',
    solution_expression: 'Satisfied nod at neat tidy packing result, professional efficient feeling, quality assurance',
    usage_scene: 'Packing station, shipping desk, storage shelf, or gift wrapping — packaging product in practical active use',
    usage_expression: 'Focused practical efficiency — neatly packing, sealing, wrapping, or organizing items',
    usage_environment: 'Home packing area, small business shipping desk, organized storage room — clean functional workspace',
    cta_mood: 'Professional reliable quality — clean stacked arrangement, trust and durability feeling',
    lighting_override: 'Bright neutral 5500K even commercial lighting, maximum product clarity and detail',
    feature_focus: 'Material thickness macro, seal strength close-up, stacking capability demo, size comparison with common items',
    howto_context: 'Folding technique, sealing and taping method, stacking arrangement guide, item-to-box size matching',
  },
  stationery: {
    hero_angle: '45-degree overhead flat lay on desk surface, curated workspace aesthetic arrangement',
    problem_expression: 'Disorganized searching through cluttered desk, pen not working frustration, scattered supplies',
    problem_scene: 'Messy desk with scattered papers, dried-out pens, disorganized supply drawer, unproductive workspace chaos',
    solution_expression: 'Focused creative flow, peaceful neat writing moment, organized desk satisfaction and calm',
    usage_scene: 'Study desk writing, office meeting note-taking, journaling session, or creative workspace — product in active use',
    usage_expression: 'Focused writing or creative concentration, peaceful organized work moment, flow state immersion',
    usage_environment: 'Study room, café table, office desk, or library — clean academic or creative desk setting',
    cta_mood: 'Aesthetic desk flat lay — product as centerpiece of beautifully organized creative workspace',
    lighting_override: 'Warm-neutral 5000K desk lamp accent mixed with natural window light, cozy study atmosphere',
    feature_focus: 'Ink flow on paper close-up, nib or tip macro, mechanism detail, color swatch or palette demonstration',
    howto_context: 'Writing or drawing technique, ink refill or lead replacement, organization method, creative usage demo',
  },
  pet: {
    hero_angle: 'Pet eye-level or slight overhead, product with pet nearby for size context, warm domestic setting',
    problem_expression: 'Worried pet parent expression, concerned watching pet\'s discomfort, picky eating frustration',
    problem_scene: "Pet refusing food bowl, scratching uncomfortably, owner looking worried watching pet's behavior or health",
    solution_expression: 'Warm loving smile watching happy pet enjoy product, tender heartfelt bonding moment, genuine joy',
    usage_scene: 'Living room floor with pet, feeding area, outdoor walk, or grooming session — pet and owner together',
    usage_expression: 'Loving gentle interaction with pet — tender touch, playful engagement, caring feeding moment',
    usage_environment: 'Cozy living room pet corner, sunny park or yard, pet grooming area — warm domestic pet-friendly space',
    cta_mood: 'Heartwarming pet-owner bond — product bringing visible joy to pet, emotional love connection',
    lighting_override: 'Warm golden 4500K soft natural window light, cozy homey inviting atmosphere',
    feature_focus: 'Ingredient or material safety close-up, pet comfort and fit demonstration, durability with pet interaction',
    howto_context: 'Feeding portion guide, fitting and sizing on pet, grooming technique, treat dispensing or toy usage',
  },
}

// NEXFIT agents/image_presets.py:191-203 — 알 수 없는 카테고리용 기본값
const DEFAULT_CATEGORY_DIRECTIVES: Record<CategoryDirectiveKey, string> = {
  hero_angle: 'Slight 3/4 angle, product centered, editorial hero composition',
  problem_expression: 'Thoughtful or slightly concerned expression, relatable mild inconvenience',
  problem_scene: 'Relatable everyday situation where the customer feels a common pain point',
  solution_expression: 'Satisfied, relieved expression — pleasant surprise at product effectiveness',
  usage_scene: 'Everyday setting where the product naturally fits — home, office, or outdoor context',
  usage_expression: 'Natural comfortable interaction with product, genuine satisfied engagement',
  usage_environment: 'Clean modern Korean domestic or public setting appropriate for the product',
  cta_mood: 'Premium aspirational final shot — product in clean inviting context, desire to own',
  lighting_override: '',
  feature_focus: 'Key feature close-up, material quality detail, functional mechanism demonstration',
  howto_context: 'Step-by-step product usage — hands interacting with product in practical context',
}

// NEXFIT agents/image_presets.py:206-209
export function getCategoryDirective(category: string, key: CategoryDirectiveKey): string {
  const directives = CATEGORY_IMAGE_DIRECTIVES[category] ?? {}
  return directives[key] ?? DEFAULT_CATEGORY_DIRECTIVES[key] ?? ''
}

// ────────────────────────────────────────────────────────────────
// 전문 포토그래피 디렉티브 + 섹션별 프리셋 (§5.1)
// ────────────────────────────────────────────────────────────────

// NEXFIT agents/image_presets.py:216-244
const PHOTOGRAPHY_BASE_COMMON = `
Professional e-commerce product photography directive:
- Shot with full-frame mirrorless camera, ultra-high detail, 8K equivalent clarity
- Color profile: Adobe RGB, accurate color reproduction
- Lighting: large softbox at 45-degree angle (key), white reflector fill, strip/rim light for edge separation
- Color temperature: 5500K daylight balanced, no color cast
- Post-production: minimal retouching, preserve natural imperfections, accurate white balance
- No HDR effect, no over-sharpening, no artificial bokeh overlay, clean sensor

Critical Anti-AI Artifact Rules:
- Hands must have exactly 5 fingers with natural proportions and joints
- Fabric patterns must maintain consistent repeat without warping
- Symmetrical objects must show true symmetry
- Shadow direction must be consistent across all elements in the scene
- No plastic-like skin sheen on human subjects
- Text on products must be legible and correctly spelled (or omitted entirely)

Product cleanliness (critical):
- The product must be pristine and brand-new — absolutely NO stains, dirt, grime,
  discoloration, brown/gray blotches, or mold-like marks anywhere on it.
- Mesh, fabric, and transparent panels must look clean and clear, never soiled.

Prop / branding rules:
- All props and packaging must be GENERIC and UNBRANDED. Do NOT render any real-world
  company name, brand logo, or recognizable product label (e.g. real shampoo, cosmetics,
  or beverage brands). Bottles and containers should be plain/blank.
- Any text that appears must be generic Korean (Hangul), correctly spelled, or omitted.
- Do NOT include Chinese characters (Hanzi/Kanji), Japanese text, or non-Korean text.
`

// NEXFIT agents/image_presets.py:246-253
const PRODUCT_SURFACE_BLANK_RULE = `
Product surface must be BLANK (critical):
- The product itself must be clean and UNBRANDED — do NOT print any brand name, logo,
  or generic English word (such as "WASHBAG", "BAG", "WATERPROOF") on the product's
  surface, transparent panel, mesh, or fabric. Keep the product face empty.
- Even if a reference photo shows printed lettering on the product, OMIT that lettering
  and render the surface clean.
`

// NEXFIT agents/image_presets.py:255
export const PHOTOGRAPHY_BASE_DIRECTIVE = PHOTOGRAPHY_BASE_COMMON + PRODUCT_SURFACE_BLANK_RULE

/**
 * 포토그래피 기본 디렉티브 — 텍스트 보유 상품(A-3)은 '표면 비우기' 규칙을 보존 규칙으로 교체.
 * NEXFIT agents/image_presets.py:258-266
 */
export function getPhotographyBase(textBearing = false): string {
  if (textBearing) {
    return `${PHOTOGRAPHY_BASE_COMMON}\n${PRINTED_DESIGN_PRESERVE_INSTRUCTION}\n`
  }
  return PHOTOGRAPHY_BASE_DIRECTIVE
}

interface PhotographyPreset {
  lens: string
  composition: string
  lighting: string
  style: string
}

// NEXFIT agents/image_presets.py:268-305
export const PHOTOGRAPHY_PRESETS: Record<string, PhotographyPreset> = {
  hero: {
    lens: '85mm f/1.8',
    composition: 'center-weighted, slight 3/4 angle, shallow DOF with subject in sharp focus',
    lighting: 'large softbox key light, white bounce fill, subtle rim light',
    style: 'editorial product hero — clean, aspirational, immediate product recognition',
  },
  feature: {
    lens: '50mm f/2.0',
    composition: 'flat lay or 45-degree elevated angle, product fills 60% of frame',
    lighting: 'even dual softbox setup, minimal shadows, true color rendering',
    style: 'catalog-style feature — clear, informative, all details visible',
  },
  detail: {
    lens: '100mm f/2.8 macro',
    composition: 'extreme close-up on texture/material, shallow DOF on specific detail',
    lighting: 'ring light or small softbox very close, highlight material texture',
    style: 'macro detail — fabric weave, stitch quality, material grain visible',
  },
  lifestyle: {
    lens: '35mm f/1.4',
    composition: 'environmental portrait, product in use, natural hand positioning',
    lighting: 'natural window light or outdoor golden hour, soft and warm',
    style: 'lifestyle editorial — relatable, warm, authentic usage scenario',
  },
  cta: {
    lens: '85mm f/1.8',
    composition: 'centered product on clean background, generous negative space for text',
    lighting: 'bright, high-key setup, minimal shadows, white background',
    style: 'clean CTA shot — product centered, visually commanding, purchase-ready',
  },
  comparison: {
    lens: '50mm f/2.0',
    composition: 'side-by-side layout, consistent framing, equal visual weight',
    lighting: 'even, flat lighting, no dramatic shadows, true color comparison',
    style: 'comparison lineup — objective, consistent, fair visual treatment',
  },
}

// NEXFIT agents/image_presets.py:308-314
export function getPhotographyContext(imageType: string): string {
  const preset = PHOTOGRAPHY_PRESETS[imageType] ?? PHOTOGRAPHY_PRESETS.feature
  return `\nPhotography setup: ${preset.lens} lens, ${preset.composition}, ${preset.lighting}, ${preset.style}`
}

// ────────────────────────────────────────────────────────────────
// Global Style Charter — 순수 빌더 (§5.1)
// 파이프라인당 1회 확정되는 팔레트 추출·조명 파라미터 해석·무드 키워드 매핑은 에이전트 소관
// (pdp-pipeline.ts). 이 함수는 이미 확정된 8개 슬롯을 받아 최종 헌장 문자열만 조립한다.
// NEXFIT agents/image_generation_agent.py:295-378 중 조립부(:366-378)
// ────────────────────────────────────────────────────────────────

export interface StyleCharterArgs {
  bgHex: string
  colorTemp: string
  direction: string
  shadowAngle: number | string
  propColors: string
  mood: string
  setDesc: string
  photographyNote?: string
}

export function buildStyleCharter(args: StyleCharterArgs): string {
  const noteLine = args.photographyNote
    ? `\n- User composition direction (applies to all cuts): ${args.photographyNote}`
    : ''
  return (
    'GLOBAL STYLE CHARTER (identical across ALL images of this product page — ' +
    'deviation from this charter is a failure):\n' +
    `- Background: solid ${args.bgHex}\n` +
    `- Single color temperature for every cut: ${args.colorTemp}\n` +
    `- Single key light direction: ${args.direction} (shadow angle ~${args.shadowAngle} degrees)\n` +
    `- Prop/accent palette (props harmonized ONLY to): ${args.propColors}\n` +
    `- Mood keywords: ${args.mood}\n` +
    `- Set description: ${args.setDesc}${noteLine}\n` +
    'This image is one of many images on a single product page sharing this exact charter.\n' +
    `${IP_PROTECTION_RULES}`
  )
}

// ────────────────────────────────────────────────────────────────
// 프롬프트 소스 선택·정제 — NEXFIT agents/image_prompt_sources.py 전량(108줄) 번역
// 설계 에이전트의 영어 프롬프트를 우선 선택하고, 없을 때만 폴백 빌더를 쓴다(한글 베이킹 차단).
// 순수 텍스트 함수만 — 다른 모듈에 의존하지 않는다.
// ────────────────────────────────────────────────────────────────

// image_prompt_sources.py:23
const HINT_SEPARATORS = ['—', '–', ' - ', '―'] as const

// image_prompt_sources.py:26-30
export const KOREAN_CONTEXT_GUARD =
  'NOTE ON THE CONTEXT LINE ABOVE: it is Korean product copy written for YOU as a scene ' +
  'description. It is NOT a caption. Do NOT render those Korean characters — or any other ' +
  'letters, numbers or words — anywhere in the image.'

// image_prompt_sources.py:33-46
export function sceneContextFromHint(imageHint = '', description = ''): string {
  const hint = (imageHint || '').trim()
  if (hint) {
    for (const sep of HINT_SEPARATORS) {
      if (hint.includes(sep)) {
        const idx = hint.indexOf(sep)
        const tail = hint.slice(idx + sep.length).trim()
        if (tail) return tail
      }
    }
    return hint
  }
  const desc = (description || '').trim()
  if (!desc) return ''
  return desc.includes('.') ? (desc.split('.')[0] ?? '').trim() : desc
}

// image_prompt_sources.py:49-54
function positiveOf(entry: unknown): string {
  if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
    const value = (entry as Record<string, unknown>).positive
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

// image_prompt_sources.py:57-58
function normalizeTitle(text: unknown): string {
  return String(text ?? '').replace(/\s+/g, '').toLowerCase()
}

// image_prompt_sources.py:61-85 (_select)
function selectFromEntries(entries: unknown, index: number, title: string, titleKey: string): string | null {
  if (!Array.isArray(entries) || entries.length === 0) return null

  const normalizedTitle = normalizeTitle(title)
  if (normalizedTitle) {
    for (const entry of entries) {
      if (!entry || typeof entry !== 'object') continue
      const candidate = normalizeTitle((entry as Record<string, unknown>)[titleKey])
      if (candidate && candidate === normalizedTitle) {
        const positive = positiveOf(entry)
        if (positive) return positive
      }
    }
  }

  if (index >= 0 && index < entries.length) {
    const positive = positiveOf(entries[index])
    if (positive) return positive
  }
  return null
}

/** design_prompts.feature_prompts[i].positive (영어) 선택. 없으면 null. image_prompt_sources.py:88-94 */
export function selectFeaturePrompt(
  designPrompts: { feature_prompts?: unknown } | null | undefined,
  index: number,
  featureTitle = ''
): string | null {
  if (!designPrompts || typeof designPrompts !== 'object') return null
  return selectFromEntries(designPrompts.feature_prompts, index, featureTitle, 'title')
}

/** design_prompts.howto_prompts[i].positive (영어) 선택. 없으면 null. image_prompt_sources.py:97-103 */
export function selectHowtoPrompt(
  designPrompts: { howto_prompts?: unknown } | null | undefined,
  index: number,
  stepTitle = ''
): string | null {
  if (!designPrompts || typeof designPrompts !== 'object') return null
  return selectFromEntries(designPrompts.howto_prompts, index, stepTitle, 'step')
}

// image_prompt_sources.py:106-108
export function hasKorean(text: unknown): boolean {
  return /[가-힣ㄱ-ㆎ]/.test(String(text || ''))
}

// ────────────────────────────────────────────────────────────────
// base 컷 빌더 (§5.2)
// ────────────────────────────────────────────────────────────────

export interface ImagePromptEntry {
  prompt: string
  aspectRatio: string
}

export interface BuildImagePromptsArgs {
  productName: string
  /** bgMain만 사용(bgSub는 options 컷 전용이었으나 options는 미투입이라 이 함수에서는 쓰이지 않음) */
  designPalette: Pick<DesignPalette, 'bgMain'>
  problemQuestion?: string
  solutionDeclaration?: string
  heroImageMode?: HeroImageMode
  category?: string
  textBearing?: boolean
}

export interface BuildImagePromptsResult {
  hero: ImagePromptEntry
  problem: ImagePromptEntry
  solution: ImagePromptEntry
  usage: ImagePromptEntry
  cta: ImagePromptEntry
}

/**
 * 이미지 타입별 프롬프트 생성 (카테고리별 차별화 포함). NEXFIT image_presets.py:470-736 번역.
 *
 * SSOT 판정(PROMPT-INVENTORY.md §5.2)에 따라 원본의 "options"(사용자 업로드 원본으로 대체)와
 * "detail"(features가 대체) 컷은 실투입되지 않으므로 이식하지 않는다 — 그래서 원본의
 * key_features 파라미터(오직 detail 블록에서만 소비)도 이 시그니처에서 제외했다.
 */
export function buildImagePrompts(args: BuildImagePromptsArgs): BuildImagePromptsResult {
  const {
    productName,
    designPalette,
    problemQuestion = '',
    solutionDeclaration = '',
    heroImageMode = 'studio',
    category = 'household',
    textBearing = false,
  } = args

  const bgMain = designPalette.bgMain || '#ffffff'
  const textRule = textRuleFor(textBearing, NO_TEXT_INSTRUCTION)
  const photoBase = getPhotographyBase(textBearing)

  const catHero = getCategoryDirective(category, 'hero_angle')
  const catProbExpr = getCategoryDirective(category, 'problem_expression')
  const catProbScene = getCategoryDirective(category, 'problem_scene')
  const catSolExpr = getCategoryDirective(category, 'solution_expression')
  const catUsageScene = getCategoryDirective(category, 'usage_scene')
  const catUsageExpr = getCategoryDirective(category, 'usage_expression')
  const catUsageEnv = getCategoryDirective(category, 'usage_environment')
  const catCta = getCategoryDirective(category, 'cta_mood')
  const catLighting = getCategoryDirective(category, 'lighting_override')

  let heroPrompt: string
  if (heroImageMode === 'lifestyle') {
    heroPrompt = `
HERO LIFESTYLE IMAGE:
- Product being actively used in a real-life scene (person using/wearing/eating the product)
- 35mm f/1.4 wide angle, natural light (window light or golden hour)
- Product occupies 40-50% of frame with environmental context
- ${KOREAN_MODEL_INSTRUCTION}
- Environment: realistic usage setting (kitchen/bathroom/office/outdoors as appropriate)
- Mood: natural, warm, relatable, empathetic
- Leave text overlay space at top and bottom of frame
- Must show the COMPLETE product clearly identifiable in the scene
${getPhotographyContext('lifestyle')}

Product: ${productName}
Aspect Ratio: 3:4
${photoBase}
${textRule}
${PRODUCT_CONSISTENCY_RULES}
`.trim()
  } else if (heroImageMode === 'premium') {
    heroPrompt = `
PREMIUM HERO IMAGE:
- Dramatic low-angle shot, looking up at the product — magazine cover quality
- Strong highlight/shadow contrast, cinematic lighting
- Product centered, occupying 50-60% of frame — powerful and commanding presence
- Background: deep gradient or subtle texture, premium dark tones with ${bgMain} accent
- Depth: Very shallow DOF — 85mm f/1.4 lens simulation, razor-sharp product, dreamy background
- Lighting: Dramatic key light from side/below with strong rim light, studio editorial
- Must show the COMPLETE product in its finished/assembled state
${getPhotographyContext('hero')}

Product: ${productName}
Aspect Ratio: 3:4
${photoBase}
${textRule}
${PRODUCT_CONSISTENCY_RULES}
`.trim()
  } else {
    heroPrompt = `
HERO IMAGE REQUIREMENTS:
NEGATIVE: No props, baskets, trays, bowls, plates, decorative items around the product.
Product must be the SOLE object. Clean isolated hero shot on solid background.
No lifestyle elements, no hands, no patterned surfaces.
- Product Position: Center, occupying 50-60% of frame — complete product in finished state
- Angle: ${catHero}
- Lighting: Soft diffused light from top-left (no harsh shadows)
- Background: Solid ${bgMain} with breathing room for text overlay (top/bottom)
- Depth: Shallow DOF — 85mm f/1.8 lens simulation, subject in sharp focus, background softly blurred
- Focus: Product edges must be sharp and clear
- Must show the COMPLETE product in its finished/assembled state (not just contents or parts)
${catLighting ? `- Category lighting: ${catLighting}` : ''}
${getPhotographyContext('hero')}

Product: ${productName}
Aspect Ratio: 3:4
${photoBase}
${textRule}
${PRODUCT_CONSISTENCY_RULES}
`.trim()
  }

  const problemPrompt = `
PROBLEM SCENARIO IMAGE:
Context: ${problemQuestion || 'Common pain point scenario'}
Category-specific scene: ${catProbScene}
Visual Elements:
- The scene should feel WARM and INVITING despite depicting a problem
- Mood: Warm, soft natural lighting — golden hour or warm indoor light
- Tone: Warm color temperature (avoid cool blues/grays), natural saturated colors
- Style: Commercial product-page quality — clean, polished, NOT documentary or gritty
- Facial Expression: ${catProbExpr}
- Composition: Aesthetically pleasing, clean background with warm tones
- This image must harmonize with other bright, premium images on the same product page
${KOREAN_MODEL_INSTRUCTION}

Human Subject Quality Rules (if person included):
- Natural pose, accurate hand depiction (exactly 5 fingers per hand)
- Natural skin tone and texture — no plastic-like sheen, realistic pores
- Wrist/finger joints must be anatomically natural
- Shadow direction consistent across all elements
- Hair: individual strand visibility near edges, no helmet effect
- Clothing wrinkles: follow natural fabric physics, no floating folds

DO NOT show the product itself in this image.
${PROBLEM_SCENE_GUARD}
${getPhotographyContext('lifestyle')}

Aspect Ratio: 3:4
${photoBase}
${textRule}
`.trim()

  const solutionPrompt = `
SOLUTION HERO IMAGE:
Product: ${productName}
Context: ${solutionDeclaration || 'Product as solution'}
Visual Elements:
- The ACTUAL PRODUCT (${productName}) must be clearly visible and recognizable
- Product in USE — someone actively using or holding ${productName}
- NOT random objects (wood, linen, bowls) — the product itself must be the subject
- Mood: Bright, warm tones, high saturation
- Lighting: Enhanced brightness (+20% vs problem image)
- Facial Expression: ${catSolExpr}
- Background: Clean, organized, spacious feeling
${KOREAN_MODEL_INSTRUCTION}
${getPhotographyContext('lifestyle')}

Show the RESULT of using ${productName}. The product must be identifiable.
Aspect Ratio: 3:4
${photoBase}
${textRule}
${PRODUCT_CONSISTENCY_RULES}
`.trim()

  const usagePrompt = `
LIFESTYLE USAGE SHOT:
- ${productName} being used in its intended environment
- Scene: ${catUsageScene}
- Environment: ${catUsageEnv}
- ${KOREAN_MODEL_INSTRUCTION}
- Focus on the interaction moment
- Expression: ${catUsageExpr}
- Mood: Natural, relatable, authentic
- Lens: 35mm f/1.4 wide-angle — environmental context, natural perspective
- Lighting: natural window light or outdoor golden hour, soft and warm
${catLighting ? `- Category lighting: ${catLighting}` : ''}

Human Subject Quality Rules:
- Natural pose, accurate hand depiction (exactly 5 fingers per hand)
- Natural skin tone and texture — no plastic-like sheen, realistic pores
- Model's gaze directed at product or natural direction — NO direct camera stare
- Wrist/finger joints must be anatomically natural when holding/using product
- Shadow direction consistent across all elements
- Hair: individual strand visibility near edges, no helmet effect
- Teeth: natural count and alignment, no extra/merged teeth
- Clothing wrinkles: follow natural fabric physics, no floating folds
- Background objects: consistent perspective with human subject

- NEGATIVE CONSTRAINT: Do NOT use public transportation backgrounds (bus, subway, train) unless explicitly requested.
${getPhotographyContext('lifestyle')}

Aspect Ratio: 3:4
${photoBase}
${textRule}
${PRODUCT_CONSISTENCY_RULES}
`.trim()

  const ctaPrompt = `
FINAL EMOTIONAL CLOSING SHOT:
- Product displayed in premium, aspirational context
- Category mood: ${catCta}
- Lighting: Bright, high-key setup, minimal shadows
${catLighting ? `- Category lighting: ${catLighting}` : ''}
- Composition: Product centered, generous negative space for text overlay
- Background: ${bgMain} — clean, visually commanding, purchase-ready
- Evoke: Trust, satisfaction, desire to own
${solutionDeclaration ? `- Scene context: ${solutionDeclaration}` : ''}
${getPhotographyContext('cta')}

Product: ${productName}
Aspect Ratio: 3:4
${photoBase}
${textRule}
${PRODUCT_CONSISTENCY_RULES}
`.trim()

  return {
    hero: { prompt: heroPrompt, aspectRatio: '3:4' },
    problem: { prompt: problemPrompt, aspectRatio: '3:4' },
    solution: { prompt: solutionPrompt, aspectRatio: '3:4' },
    usage: { prompt: usagePrompt, aspectRatio: '3:4' },
    cta: { prompt: ctaPrompt, aspectRatio: '3:4' },
  }
}

export interface FeaturePromptArgs {
  /** 원본 파라미터에 존재하나 함수 본문에서 소비되지 않는 죽은 인자(원본 그대로 보존) */
  featureTitle: string
  featureDescription: string
  bgSub: string
  imageHint?: string
  tone?: string
  category?: string
  textBearing?: boolean
}

/**
 * detailPoints용 이미지 프롬프트 생성 (카테고리별 포커스 차별화) — 폴백 경로.
 * design_prompts.feature_prompts에 영어 프롬프트가 있으면 이 폴백은 쓰이지 않는다
 * (image_presets.py:739-781).
 */
export function buildFeaturePrompt(args: FeaturePromptArgs): ImagePromptEntry {
  const { featureDescription, bgSub, imageHint = '', tone = '', category = 'household', textBearing = false } = args
  const context = sceneContextFromHint(imageHint, featureDescription)
  const toneLine = tone ? `Style: ${tone}` : ''
  const photoCtx = getPhotographyContext('feature')
  const catFeature = getCategoryDirective(category, 'feature_focus')
  const textRule = textRuleFor(textBearing, NO_TEXT_INSTRUCTION)
  const photoBase = getPhotographyBase(textBearing)
  const koreanGuard = hasKorean(context) ? KOREAN_CONTEXT_GUARD : ''

  return {
    prompt: `
FEATURE HIGHLIGHT IMAGE:
Context (scene description for you, never to be drawn as text): ${context}
Category focus guide: ${catFeature}
Composition:
- Product angle: Focus on the specific product part described in the context above
- Visual Proof: Show that feature in action or close-up
- Example: for a waterproof zipper, show water droplets on the closed zipper
- Aspect Ratio: 3:4
- Background: Match design palette ${bgSub}
${toneLine}
${koreanGuard}
${photoCtx}
${photoBase}
${textRule}
${PRODUCT_CONSISTENCY_RULES}
`.trim(),
    aspectRatio: '3:4',
  }
}

export interface FeaturePromptFromDesignArgs {
  designPositive: string
  bgSub: string
  tone?: string
  category?: string
  textBearing?: boolean
}

/**
 * DesignPromptAgent가 만든 **영어** feature positive를 생성 프롬프트로 감싼다 (A-2).
 * 한글 카피를 전혀 싣지 않는 경로 — 베이킹 위험이 구조적으로 없다. image_presets.py:784-815
 */
export function buildFeaturePromptFromDesign(args: FeaturePromptFromDesignArgs): ImagePromptEntry {
  const { designPositive, bgSub, tone = '', category = 'household', textBearing = false } = args
  const toneLine = tone ? `Style: ${tone}` : ''
  const photoCtx = getPhotographyContext('feature')
  const catFeature = getCategoryDirective(category, 'feature_focus')
  const textRule = textRuleFor(textBearing, NO_TEXT_INSTRUCTION)
  const photoBase = getPhotographyBase(textBearing)

  return {
    prompt: `
FEATURE HIGHLIGHT IMAGE:
${designPositive.trim()}
Category focus guide: ${catFeature}
- Aspect Ratio: 3:4
- Background: Match design palette ${bgSub}
${toneLine}
${photoCtx}
${photoBase}
${textRule}
${PRODUCT_CONSISTENCY_RULES}
`.trim(),
    aspectRatio: '3:4',
  }
}

export interface HowtoPromptFromDesignArgs {
  designPositive: string
  category?: string
  textBearing?: boolean
}

/** DesignPromptAgent가 만든 **영어** howto positive를 생성 프롬프트로 감싼다 (A-2). image_presets.py:818-846 */
export function buildHowtoPromptFromDesign(args: HowtoPromptFromDesignArgs): ImagePromptEntry {
  const { designPositive, category = 'household', textBearing = false } = args
  const photoCtx = getPhotographyContext('lifestyle')
  const catHowto = getCategoryDirective(category, 'howto_context')
  const textRule = textRuleFor(textBearing, NO_TEXT_INSTRUCTION)
  const photoBase = getPhotographyBase(textBearing)

  return {
    prompt: `
USAGE SCENARIO IMAGE:
${designPositive.trim()}
Category context: ${catHowto}
Visual Requirements:
- Show hands/person interacting with product
- Focus on the ACTION moment (not before/after)
- NEGATIVE CONSTRAINT: Do NOT use public transportation backgrounds (bus, subway, train) unless explicitly requested.
- ${KOREAN_MODEL_INSTRUCTION}
${photoCtx}

Aspect Ratio: 1:1
${photoBase}
${textRule}
${PRODUCT_CONSISTENCY_RULES}
`.trim(),
    aspectRatio: '1:1',
  }
}

export interface HowtoPromptArgs {
  stepTitle: string
  stepDescription: string
  category?: string
  textBearing?: boolean
}

/**
 * howTo용 이미지 프롬프트 생성 (카테고리별 맥락 차별화) — 폴백 경로. image_presets.py:849-896
 * A-2: 한글 단계 카피는 캡션이 아니라 '해석용 설명'임을 명시한다(베이킹 차단).
 */
export function buildHowtoPrompt(args: HowtoPromptArgs): ImagePromptEntry {
  const { stepTitle, stepDescription, category = 'household', textBearing = false } = args
  const photoCtx = getPhotographyContext('lifestyle')
  const catHowto = getCategoryDirective(category, 'howto_context')
  const textRule = textRuleFor(textBearing, NO_TEXT_INSTRUCTION)
  const photoBase = getPhotographyBase(textBearing)
  const scenario = sceneContextFromHint('', stepTitle) || stepTitle
  const koreanGuard = hasKorean(`${scenario} ${stepDescription}`) ? KOREAN_CONTEXT_GUARD : ''

  return {
    prompt: `
USAGE SCENARIO IMAGE:
Scenario (description for you, never to be drawn as text): ${scenario}
Action: ${stepDescription}
Category context: ${catHowto}
${koreanGuard}
Visual Requirements:
- Show hands/person interacting with product
- Focus on the ACTION moment (not before/after)
- Include environmental context clues
- NEGATIVE CONSTRAINT: Do NOT use public transportation backgrounds (bus, subway, train) unless explicitly requested.
- Composition: Medium shot (product + partial surroundings)
- ${KOREAN_MODEL_INSTRUCTION}

Human Subject Quality Rules:
- Natural pose, accurate hand depiction (exactly 5 fingers per hand)
- Natural skin tone and texture — no plastic-like sheen, realistic pores
- Wrist/finger joints must be anatomically natural when holding/using product
- Shadow direction consistent across all elements
- Clothing wrinkles: follow natural fabric physics, no floating folds
${photoCtx}

Aspect Ratio: 1:1
${photoBase}
${textRule}
${PRODUCT_CONSISTENCY_RULES}
`.trim(),
    aspectRatio: '1:1',
  }
}

// WCAG 2.1 비텍스트(아이콘·도형) 최소 대비 — 렌더러의 결정론 SVG 폴백이 쓰는 기준.
// 생성 아이콘은 후처리에서 고정 잉크로 칠하므로 이 값을 타지 않는다. image_presets.py:899-901
export const USP_ICON_MIN_CONTRAST = 3.0

/**
 * USP pointCard용 라인 일러스트 아이콘 프롬프트 생성. image_presets.py:904-952
 * palette_color·bg_color는 원본에서 하위호환용으로 남겨두되 쓰이지 않는다(색은 후처리 소관) — 그래서
 * 이 시그니처에도 포함하지 않는다.
 */
export function buildUspIconPrompt(cardTitle: string): ImagePromptEntry {
  return {
    prompt: `
FLAT 2D MONOCHROME LINE ICON — NOT A PHOTO.

Draw a single minimalist line-art pictogram for the concept: "${cardTitle}".

OUTPUT MUST BE:
- A flat 2D vector-style icon in PURE BLACK (#000000) on a PURE WHITE (#FFFFFF) background.
  The background must be perfectly flat white with no tint, texture, vignette or shading —
  it is keyed out to transparency afterwards, so any stray tone becomes a visible artifact.
- BOLD, HEAVY outlined strokes — uniform stroke weight of roughly 1/12 of the icon's width.
  The icon is displayed very small (80x80 pixels), so hairline strokes disappear.
  Err on the side of too thick rather than too thin.
- ONE color only: black strokes. No other hue anywhere.
- Total visual elements: 2 or fewer simple geometric shapes — fewer, larger shapes read better
  at small size than a detailed drawing
- Centered in frame with generous padding (icon occupies ~50% of canvas)
- Style reference: Lucide, Feather, or Material Design outlined icons at their boldest weight
- Examples: a simple shield outline ◇ for "protection", a single leaf stroke 🍃 for "natural"

ABSOLUTELY NO:
- Photographs, product images, 3D renders, realistic objects
- Fills, gradients, shadows, highlights, textures, patterns
- Text, letters, words, labels, watermarks, numbers
- Background elements, decorations, borders, frames
- Multiple colors — single monochrome color only
- Complex detailed illustrations — MAXIMUM 3 simple strokes/shapes

This must look like a simple SVG icon exported as PNG, NOT a photograph or illustration.

${NO_TEXT_INSTRUCTION}
Aspect Ratio: 1:1 (perfect square canvas — the icon is cropped to a circle when displayed)
`.trim(),
    aspectRatio: '1:1',
  }
}

// ────────────────────────────────────────────────────────────────
// 사이즈 비교 · 완판 배너 부속 빌더 (§5.2)
// ────────────────────────────────────────────────────────────────

const LENGTH_UNITS = ['cm', 'mm', 'inch', '인치', 'm'] as const

// image_presets.py:959-962
const NON_LENGTH_SEGMENT = /[\d.]+\s*(?:kg|g|ml|l|리터|미터|개|매|장|구|w|v|hz|ah|mah)\b/gi

// image_presets.py:964-968 — 위치 그룹만 사용(named capture group은 target ES2017에서 문법 오류라 미지원):
// [1]=label [2]=num [3]=unit
const AXIS_TOKEN = /(?:(가로|세로|높이|폭|너비|깊이|두께|길이)\s*[:=]?\s*)?(\d+(?:\.\d+)?)\s*(cm|mm|inch|인치|m)?/gi

// image_presets.py:971-976 (세로는 문맥 의존이라 아래에서 별도 처리)
const LABEL_TO_AXIS: Record<string, 'width' | 'height' | 'depth'> = {
  가로: 'width',
  폭: 'width',
  너비: 'width',
  길이: 'width',
  높이: 'height',
  깊이: 'depth',
  두께: 'depth',
}

/**
 * 치수 문자열에서 (가로, 세로, 깊이) 라벨을 뽑는다. image_presets.py:979-1030 번역.
 * "세로"는 "높이" 동반 여부로 depth/height를 판별한다(가로x세로x높이=깊이, 가로x세로=높이).
 */
function parseSizeLabels(sizeText: string): [string, string, string] {
  if (!sizeText) return ['', '', '']

  const cleaned = sizeText.replace(NON_LENGTH_SEGMENT, ' ')

  const tokens: Array<{ label?: string; num: string; unit?: string }> = []
  for (const m of cleaned.matchAll(AXIS_TOKEN)) {
    const num = m[2]
    if (!num) continue
    tokens.push({ label: m[1], num, unit: m[3] })
  }
  if (tokens.length === 0) return ['', '', '']

  let defaultUnit = tokens.find((t) => t.unit)?.unit
  if (!defaultUnit) {
    const lower = cleaned.toLowerCase()
    defaultUnit = LENGTH_UNITS.find((u) => lower.includes(u)) ?? 'cm'
  }

  const fmt = (num: string, unit: string | undefined) => `${num}${unit || defaultUnit}`

  const labeled = new Set(tokens.map((t) => t.label).filter((l): l is string => Boolean(l)))
  const axes: Partial<Record<'width' | 'height' | 'depth', string>> = {}

  if (labeled.size > 0) {
    const hasHeight = labeled.has('높이')
    for (const { label, num, unit } of tokens) {
      if (!label) continue
      let axis: 'width' | 'height' | 'depth' | undefined = LABEL_TO_AXIS[label]
      if (label === '세로') axis = hasHeight ? 'depth' : 'height'
      if (axis && !axes[axis]) axes[axis] = fmt(num, unit)
    }
  } else {
    const order: Array<'width' | 'height' | 'depth'> = ['width', 'height', 'depth']
    tokens.slice(0, 3).forEach((t, idx) => {
      axes[order[idx]] = fmt(t.num, t.unit)
    })
  }

  return [axes.width || '', axes.height || '', axes.depth || '']
}

export interface SizeComparisonPromptArgs {
  productName: string
  bgMain?: string
  sizeText?: string
  textBearing?: boolean
}

/**
 * 사이즈 이미지 프롬프트 (Premium 전용). image_presets.py:1033-1114 기반이나,
 * 오너 지시(2026-08-11 검수 피드백 — 설계문서 개정 5)로 원본의 비교대상(손·스마트폰·종이컵)
 * 합성 구도를 폐기하고 **제품 단독 + 치수 화살표** 구도로 재작성했다. comparisonObject 슬롯 제거.
 */
export function buildSizeComparisonPrompt(args: SizeComparisonPromptArgs): ImagePromptEntry {
  const { productName, bgMain = '#ffffff', sizeText = '', textBearing = false } = args
  const [widthLabel, heightLabel, depthLabel] = parseSizeLabels(sizeText)

  let dimensionInstruction: string
  if (widthLabel && heightLabel) {
    dimensionInstruction = `SIZE INDICATOR (measures the PRODUCT ONLY — text IS allowed here):
- Thin vertical double-headed arrow (↕) in the empty margin to the FAR LEFT of the product,
  outside the product silhouette.
  It must span exactly the product's own top edge to bottom edge.
  Label at the midpoint OF THAT ARROW: "${heightLabel}" in small clean gray sans-serif font
- Thin horizontal double-headed arrow (↔) directly BELOW the product,
  spanning exactly the product's own left edge to right edge.
  Label at the midpoint OF THAT ARROW: "${widthLabel}" in small clean gray sans-serif font
- Arrow lines: dark gray (#555555), clean and straight, thin 1-2px`
    if (depthLabel) {
      dimensionInstruction += `
- If product has depth, add diagonal indicator labeled "${depthLabel}" `
    }
  } else if (sizeText) {
    // 단일 치수는 화살표 1개만 — 양 축 중복 표기 방지(개정 5 프로브 실측)
    dimensionInstruction = `SIZE INDICATOR:
- Exactly ONE thin double-headed arrow along the product's longest axis, labeled "${sizeText}"
  in small clean gray sans-serif font
- Do NOT draw any other dimension arrow or repeat the label
- Arrow lines: dark gray (#555555), clean and straight`
  } else {
    dimensionInstruction = `SIZE INDICATOR:
- Thin vertical double-headed arrow on RIGHT side showing product height
- Thin horizontal double-headed arrow BELOW product showing width
- Arrow lines: dark gray (#555555), clean and straight`
  }

  const surfaceTextRule = textBearing
    ? '- Reproduce the artwork and lettering printed ON the product exactly as in the\n' +
      '  reference image. The background must stay completely free of\n' +
      '  text, letters, watermarks, or brand names — the only text allowed outside the product\n' +
      '  is the small gray measurement labels on the dimension arrows described above.'
    : '- The product surface and the background must be completely\n' +
      '  free of text, letters, watermarks, or brand names. The ONLY text permitted anywhere\n' +
      '  in the image is the small gray measurement labels on the dimension arrows described\n' +
      '  above — nothing else.'

  return {
    prompt: `PRODUCT SIZE IMAGE:
Purpose: Show EXACT real-world dimensions of ${productName}
Composition:
- CENTER: ${productName} alone (product from reference image, EXACT appearance) —
  no other object, no hand, no props, no size-reference item of any kind
- Generous even margins around the product so the dimension arrows fit outside its silhouette
- Eye-level straight-on angle (not angled or tilted)
- Background: Clean ${bgMain} or light gray studio
- Lighting: Even, soft, no dramatic shadows

${dimensionInstruction}

CRITICAL RULES:
- The product is the ONLY object in the image — never add a hand, phone, cup, coin,
  ruler or any comparison object
- The product must be sharply focused
- No perspective distortion
${surfaceTextRule}
- The only dimension arrows allowed are the ones listed under SIZE INDICATOR above,
  and every one of them belongs to the product.

Aspect Ratio: 3:4
${PRODUCT_CONSISTENCY_RULES}`,
    aspectRatio: '3:4',
  }
}

/**
 * Python round()의 round-half-to-even(banker's rounding)을 재현한다 — JS Math.round는
 * 항상 .5를 올림(round-half-away-from-zero)이라 factor=1.5(accent)에서 홀수 채널마다
 * 어긋난다(예: 51*1.5=76.5 → Python 76, Math.round 77). 입력은 항상 c*factor(c∈[0,255], factor>0)로
 * 음수가 없다.
 */
function pythonRoundNonNegative(x: number): number {
  const floor = Math.floor(x)
  const frac = x - floor
  if (frac < 0.5) return floor
  if (frac > 0.5) return floor + 1
  return floor % 2 === 0 ? floor : floor + 1
}

/** hex를 factor(<1 어둡게, >1 밝게)로 조정. 잘못된 입력은 원본 반환. image_presets.py:1117-1127 */
function shadeHex(hexColor: string, factor: number): string {
  try {
    const h = hexColor.trim().replace(/^#+/, '')
    if (h.length !== 6) return hexColor
    const r = parseInt(h.slice(0, 2), 16)
    const g = parseInt(h.slice(2, 4), 16)
    const b = parseInt(h.slice(4, 6), 16)
    if ([r, g, b].some((v) => Number.isNaN(v))) return hexColor
    const adj = (c: number) => Math.max(0, Math.min(255, pythonRoundNonNegative(c * factor)))
    const toHex = (c: number) => adj(c).toString(16).padStart(2, '0')
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`
  } catch {
    return hexColor
  }
}

/**
 * N차 완판 배너 배경 — 다크 배경 + 팔레트 톤 월계관/엠블럼. image_presets.py:1130-1178
 * 성과/수상 임팩트는 유지하되 골드 대신 브랜드 팔레트 톤으로 렌더해 페이지 톤과 조화시킨다.
 */
export function buildSoldOutBannerPrompt(palette?: Pick<DesignPalette, 'primary' | 'secondary'> | null): ImagePromptEntry {
  const p = palette || {}
  const primary = p.primary || '#8A6FF0'
  const secondary = p.secondary || primary
  const deepDark = shadeHex(primary, 0.14)
  const darkMid = shadeHex(primary, 0.34)
  const laurel = shadeHex(secondary, 1.4)
  const accent = shadeHex(primary, 1.5)

  return {
    prompt: `
SOLD-OUT ACHIEVEMENT BANNER BACKGROUND (premium award look, BRAND-TONED laurel):
Visual Concept: A dramatic "best-seller / N-times sold out" achievement banner —
a laurel wreath / victory emblem, rendered in the PRODUCT'S BRAND palette (NOT gold).
Premium award-ceremony feel on a DARK dramatic backdrop.

Composition:
- A symmetrical laurel wreath arching from both left and right sides, framing the center
- Center area must remain CLEAR and open (empty space for text overlay)
- Optional small restrained emblem/ribbon silhouette at top center

Laurel & Emblem color (critical — brand hue, NOT gold):
- Laurel leaves and emblem in a bright, luminous metallic tint of the brand: ${laurel}
  (e.g. luminous lavender / rose / aqua depending on the palette — absolutely NO gold, NO yellow)
- Soft glow/halo around the wreath in ${accent}

Background & Lighting:
- Deep DARK dramatic gradient: from near-black brand-tinted ${deepDark} to ${darkMid}
- Soft radial light rays emanating from the center behind the wreath
- Faint bokeh particles and cinematic light flare — premium, celebratory

Atmosphere:
- Triumphant, prestigious, premium achievement — reads instantly as "award / best-seller"
- Tonally cohesive with the brand palette (brand-hued, not a gold award cliché)

Technical:
- Aspect ratio: 16:9 (wide banner)
- NO text, NO numbers, NO letters anywhere
- NO product imagery
- Center must be open for text overlay
- Style: Photorealistic with cinematic glow, brand-toned metallic laurel on dark
`.trim(),
    aspectRatio: '16:9',
  }
}
