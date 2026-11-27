/**
 * PDP 파이프라인 5단계(이미지 생성) — Vision 게이트 + 식별카드 + 재생성 지시문 —
 * NEXFIT agents/image_generation_agent.py(`_vision_score_consistency`) + agents/image_identity.py
 * (`IDENTITY_CARD_PROMPT`) + agents/image_gate_policy.py(전체) 번역.
 *
 * 원칙(원본 보존 — 설계문서 §7): 프롬프트 영문 본문은 의미·문구 변경 없이 그대로 옮긴다.
 * Vision 게이트 프롬프트는 원문 자체에 이미 JSON 응답 형식 지시가 내장되어 있어(원본 f-string
 * 말미) Phase 1 thumbnail-gate-prompts.ts처럼 별도로 append할 필요가 없다 — 원문 그대로 보존.
 */

// NEXFIT agents/image_generation_agent.py:446-469 (`_vision_score_consistency` 내부 f-string)
// LLM 콜(`_genai_call`)·이미지 첨부 조립은 호출부(images 단계 에이전트) 책임 — 여기는 텍스트만 조립.
export function buildVisionGatePrompt(cutNames: string[]): string {
  return (
    'You are a product-photo QA judge for a Korean e-commerce detail page.\n' +
    'The FIRST attached image is the REFERENCE product photo. ' +
    `The following ${cutNames.length} images are generated cuts, in this exact order: ` +
    cutNames.join(', ') +
    '.\n' +
    'For EACH generated cut, judge:\n' +
    '- same_product: is it clearly the SAME product as the reference ' +
    '(shape, color, logo, material)? true/false. If the product is not visible in the cut, use true.\n' +
    '- background_tone_hex: the dominant background color of the cut as #RRGGBB.\n' +
    '- consistency: 0.0-1.0 score combining product identity and lighting/background-tone ' +
    'consistency with the reference and with a single cohesive page style.\n' +
    '- has_artifact: true if the cut has ANY of these defects, else false:\n' +
    '   (a) dirty stains, mold-like brown/gray blotches, or grime on the product ' +
    '(critical for a hygiene product);\n' +
    '   (b) a REAL-WORLD brand name or company logo readable on any item ' +
    '(e.g. a real shampoo/cosmetic brand label) — the product itself is unbranded;\n' +
    '   (c) garbled, misspelled, or gibberish Korean/English text rendered in the image;\n' +
    "   (d) printed brand name or a generic word (such as 'WASHBAG', 'BAG') stamped on " +
    "the PRODUCT's own surface / transparent panel — the product must be blank/unbranded.\n" +
    '- artifact_reason: short reason if has_artifact is true, else empty string.\n' +
    'Respond with ONLY a JSON array, no markdown:\n' +
    '[{"cut": "<name>", "same_product": true, "background_tone_hex": "#FFFFFF", ' +
    '"consistency": 0.85, "has_artifact": false, "artifact_reason": ""}]'
  )
}

export interface VisionGateCutScore {
  cut: string
  same_product: boolean
  background_tone_hex: string
  consistency: number
  has_artifact: boolean
  artifact_reason: string
}

// NEXFIT agents/image_identity.py:83-93 — 인라인이었으므로 프롬프트 파일로 승격(§7.0 규칙)
export const IDENTITY_CARD_PROMPT =
  'You are cataloguing a product photo so another image model can redraw the SAME product.\n' +
  'Look at the attached reference photo and describe ONLY what is actually visible.\n' +
  'Prioritise, in this order: (1) handle / grip / cutout shape, (2) opening mechanism and whether ' +
  'it is open or closed, (3) number of tiers, drawers, compartments or set pieces, (4) material and ' +
  'finish, (5) exact colors of each part.\n' +
  'Rules: English only, at most 40 words, one line, comma-separated noun phrases. ' +
  "State counts as numbers (e.g. '2-tier', '1 drawer'). Never guess a feature you cannot see. " +
  'Do not mention background, lighting, branding or marketing language.\n' +
  'Answer with the description only, no preamble.'

// NEXFIT agents/image_identity.py:95 — 식별카드 응답 길이 상한(`_clean_identity_text`가 강제)
export const IDENTITY_CARD_MAX_CHARS = 400

// ─────────────────────────────────────────────────────────────────
// 게이트 미달 재생성 지시문 — NEXFIT agents/image_gate_policy.py 전량
// 순수 텍스트 함수만 둔다 — 다른 모듈에 의존하지 않는다(원본 파일 docstring 원칙 그대로).
// ─────────────────────────────────────────────────────────────────

export type GateFailureCode = 'baked_text' | 'baked_text_preserve' | 'structure' | 'stain' | 'brand' | 'consistency'

export interface GateScoreRow {
  same_product?: boolean
  artifact_reason?: string | null
}

// NEXFIT image_gate_policy.py:12-22 — 사유 분류 키워드(vision 판정의 artifact_reason, 영문/한글 혼재)
const GATE_TEXT_MARKERS = [
  'text',
  'letter',
  'word',
  'typo',
  'writing',
  'caption',
  'label',
  'korean',
  'hangul',
  'gibberish',
  'garbled',
  'misspell',
  '글자',
  '문자',
  '한글',
]
const GATE_STRUCTURE_MARKERS = [
  'shape',
  'structure',
  'different product',
  'not the same',
  'component',
  'part',
  'count',
  'tier',
  'drawer',
  'handle',
  'missing',
  'extra',
  '구조',
  '형태',
  '부품',
]
const GATE_STAIN_MARKERS = ['stain', 'dirt', 'grime', 'mold', 'blotch', 'discolor', '얼룩', '곰팡이']
const GATE_BRAND_MARKERS = ['brand', 'logo', 'trademark', '브랜드', '로고']

// NEXFIT image_gate_policy.py:24-54
const GATE_DIRECTIVES: Record<GateFailureCode, string> = {
  baked_text:
    'PREVIOUS ATTEMPT FAILED — rendered text appeared in the image. ' +
    'Do NOT draw any characters, words, numbers, captions, labels or watermarks anywhere ' +
    'in this image. No lettering on the product, the props, or the background.',
  baked_text_preserve:
    'PREVIOUS ATTEMPT FAILED — the lettering came out wrong. Reproduce the printed wording ' +
    'and artwork ON THE PRODUCT exactly as it appears in the reference image, character for ' +
    'character, and add no other text anywhere else in the frame.',
  structure:
    'PREVIOUS ATTEMPT FAILED — the product structure did not match the reference. ' +
    'Keep the number of tiers, drawers, parts and set pieces identical to the reference, ' +
    'keep moving parts (drawers, lids, hinges) in the same assembled state, and invent no ' +
    'components that are not visible in the reference.',
  stain:
    'PREVIOUS ATTEMPT FAILED — the product looked soiled. Render the product pristine and ' +
    'brand-new: no stains, dirt, grime, discoloration or mold-like marks anywhere.',
  brand:
    'PREVIOUS ATTEMPT FAILED — a real-world brand name or logo appeared. All props, packaging ' +
    'and surfaces must be generic and unbranded, with no readable company names or logos.',
  consistency:
    'PREVIOUS ATTEMPT FAILED — the generated product drifted from the reference. Match the ' +
    "reference product's shape, proportions, color and material exactly, and keep the page's " +
    'lighting and background tone consistent.',
}

/** 게이트 판정 행 → 사유 코드(baked_text | structure | stain | brand | consistency). image_gate_policy.py:57-72 */
export function classifyGateFailure(scoreRow: GateScoreRow | null | undefined): Exclude<GateFailureCode, 'baked_text_preserve'> {
  const row = scoreRow ?? {}
  const reason = String(row.artifact_reason ?? '').toLowerCase()

  if (GATE_TEXT_MARKERS.some((marker) => reason.includes(marker))) return 'baked_text'
  if (GATE_STAIN_MARKERS.some((marker) => reason.includes(marker))) return 'stain'
  if (GATE_BRAND_MARKERS.some((marker) => reason.includes(marker))) return 'brand'
  if (GATE_STRUCTURE_MARKERS.some((marker) => reason.includes(marker))) return 'structure'
  if (row.same_product === false) return 'structure'
  return 'consistency'
}

/** 재생성 프롬프트에 덧붙일 사유 반영 지시문. 판정 정보가 없으면 빈 문자열. image_gate_policy.py:75-82 */
export function buildRegenDirective(scoreRow: GateScoreRow | null | undefined, textBearing = false): string {
  if (!scoreRow) return ''
  let code: GateFailureCode = classifyGateFailure(scoreRow)
  if (code === 'baked_text' && textBearing) code = 'baked_text_preserve'
  return GATE_DIRECTIVES[code] ?? ''
}

/** 프롬프트 말미에 사유 지시문을 부착(중복 부착 방지). image_gate_policy.py:85-90 */
export function applyRegenDirective(prompt: string, scoreRow: GateScoreRow | null | undefined, textBearing = false): string {
  const directive = buildRegenDirective(scoreRow, textBearing)
  if (!directive || prompt.includes(directive)) return prompt
  return `${prompt}\n\n${directive}`
}
