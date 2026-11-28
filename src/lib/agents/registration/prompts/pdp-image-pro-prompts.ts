/**
 * PDP 파이프라인 5단계(이미지 생성) — Pro 전용 프롬프트 — NEXFIT agents/image_presets.py +
 * agents/image_generation_agent.py 번역.
 *
 * 원칙(원본 보존 — 설계문서 §7): 프롬프트 영문 본문은 의미·문구 변경 없이 그대로 옮기고,
 * f-string 슬롯만 TS 함수 인자로 변환한다. 각 상수·함수에 원본 파일:행 출처를 남긴다.
 *
 * `{PRODUCT_CONSISTENCY_RULES}` 슬롯: 원문 상수는 `pdp-image-prompts.ts`(공통 규칙 파일, 형제
 * 세션이 동시 작성 중) 소유이므로 여기서 import하지 않는다 — `buildProImagePrompt()`의
 * `productConsistencyRules` 인자로 문자열을 전달받는다. EFFECT_ONLY 컷(certification_badge·
 * event_banner·empathy_scene·comparison_scene·rating_bg — image_presets.py:322-328)에는
 * 원본이 빈 문자열을 대입한다(agent.py:1145-1147) — 호출부는 이 5종에 대해 빈 문자열을 전달할 것.
 * (남은 5종만 `{PRODUCT_CONSISTENCY_RULES}` 슬롯을 실제로 갖는다: product_exposure·direction_hint·
 * key_benefit_visual·premium_hero·concept_mood.)
 */

import { FIRST_RANK_PATTERN, detectCertType, hasCertWord } from '@/lib/registration/pdp-pro-copy-templates'

export type ProImageType =
  | 'certification_badge'
  | 'event_banner'
  | 'product_exposure'
  | 'empathy_scene'
  | 'direction_hint'
  | 'key_benefit_visual'
  | 'premium_hero'
  | 'concept_mood'
  | 'comparison_scene'
  | 'rating_bg'

interface ProImagePromptTemplate {
  positive: string
  negative: string
}

// NEXFIT image_presets.py:331-456 — conversion_cta(:436-444)는 원본이 생성 자체를 스킵하고
// cta 결과를 재사용(§5.3 판정 — 제외)하므로 이식하지 않는다. 나머지 10종.
export const PRO_IMAGE_PROMPTS: Record<ProImageType, ProImagePromptTemplate> = {
  certification_badge: {
    positive:
      // 정품 인증·위조 방지 실(seal)처럼 보이게 하지 않는다 — 입력에 없는 검증 사칭(P0-1b). 장식용 홀로그램 그래픽만
      'Decorative holographic sticker graphic for a Korean e-commerce detail page. ' +
      'Iridescent prismatic square sticker with rainbow light refraction, fine geometric micro-patterns, ' +
      'holographic foil effect with color-shifting surface. Purely decorative, not an authentication or verification seal. ' +
      'Clean dark background (#1a1a1a). ' +
      'No text, no letters, no words — pure holographic graphic pattern only.',
    negative:
      'text, letters, words, numbers, typography, font, characters, writing, cheap, flat, blurry, cartoon, medal, coin',
  },
  event_banner: {
    positive:
      'Eye-catching promotional banner background. Vibrant gradient or geometric pattern. ' +
      'Festive, urgent mood. Sale/event atmosphere. Abstract decorative elements. Premium feel. ' +
      'No text, letters, or typography anywhere in the image.',
    negative: 'text, letters, words, numbers, typography, font, price tag, sale sign, product, human, cheap looking',
  },
  product_exposure: {
    positive:
      'Alternative angle product photography of {product_name}. ' +
      'MANDATORY ANGLE CHANGE: this cut must NOT repeat the hero framing. Shoot it from a ' +
      'clearly different viewpoint — a straight side profile, a top-down flat lay, or a ' +
      'tight three-quarter detail angle — so a viewer instantly sees a new side of the product. ' +
      'Same lighting consistency. Clean background. Studio quality. ' +
      '{PRODUCT_CONSISTENCY_RULES} ' +
      'No text, letters, or typography anywhere in the image.',
    negative: 'text, letters, blurry, distorted product',
  },
  // bundle_arrangement: PRO flow(event_bundle)에 미포함 → 생성 제거(원본 주석 image_presets.py:362, 비용 절감)
  empathy_scene: {
    positive:
      'Relatable everyday scene showing mild inconvenience related to {problem_context}. ' +
      'Product category: {product_context}. ' +
      'Warm, natural color tones — NOT desaturated or cold. Soft warm lighting. ' +
      'Korean adult in a clean, modern setting. ' +
      'Subtle thoughtful expression, relatable body language. No product visible. ' +
      'Commercial product-page quality that harmonizes with bright, premium surrounding images. ' +
      'No text, letters, or typography anywhere in the image.',
    negative: 'text, letters, product, extreme emotion, cold tones, dark, desaturated, gloomy, gray',
  },
  direction_hint: {
    positive:
      'Premium product showcase of {product_name} as THE solution. ' +
      'The actual product must be clearly visible, centered, and the hero of the frame. ' +
      'SHOT DISTANCE: pull back to a wider full-product shot with generous negative space ' +
      'around it — noticeably wider than the hero cut, not another tight centered close-up. ' +
      'Clean, natural studio lighting with soft shadows. ' +
      'Simple gradient or softly blurred neutral background. ' +
      "Aspirational, premium mood — 'this is the answer'. " +
      '{PRODUCT_CONSISTENCY_RULES} ' +
      'No text, letters, or typography anywhere in the image.',
    negative:
      'text, letters, dark, gloomy, cluttered, low quality, blurry product, glow, particle effects, lens flare, halo, bokeh',
  },
  key_benefit_visual: {
    positive:
      'Visual metaphor or close-up demonstrating the key benefit of {product_name}: {key_benefit}. ' +
      'Clear cause-and-effect visual. Studio lighting. Aspirational quality. ' +
      '{PRODUCT_CONSISTENCY_RULES} ' +
      'No text, letters, or typography anywhere in the image.',
    negative: 'text, letters, blurry, abstract',
  },
  premium_hero: {
    positive:
      'Ultra-premium hero shot of {product_name}. ' +
      'MANDATORY CONTRAST WITH THE STANDARD HERO CUT: this must read as a different ' +
      'photograph — use a low camera angle or a tight dramatic crop, AND a different ' +
      'backdrop treatment (deep soft gradient or a reflective surface), never a repeat ' +
      'of the plain frontal studio framing on a flat light background. ' +
      'Low angle, dramatic lighting. Rich shadows and highlights. ' +
      'Magazine-cover quality. Center composition with breathing room. ' +
      '{PRODUCT_CONSISTENCY_RULES} ' +
      'No text, letters, or typography anywhere in the image.',
    negative: 'text, letters, flat lighting, casual',
  },
  concept_mood: {
    positive:
      'Brand concept lifestyle image for {product_name}. {brand_mood} atmosphere. ' +
      'Product resting on a natural surface (wood board, linen cloth, or stone slab) ' +
      'with complementary lifestyle props that reflect the product category: {product_context}. ' +
      'Soft warm studio lighting. Premium flat-lay or 45-degree angle arrangement. ' +
      'COMPOSITION: an off-center editorial arrangement seen from above with props sharing ' +
      'the frame — deliberately different from the centered hero and from the alternative-angle ' +
      'product cut, so no two cuts on this page read as the same photo. ' +
      'Color palette: {palette_colors}. Product must be clearly visible. ' +
      '{PRODUCT_CONSISTENCY_RULES} ' +
      'No text, letters, or typography anywhere in the image.',
    negative:
      'text, letters, fashion model posing, human face, busy background, cluttered, abstract art, unrelated objects',
  },
  comparison_scene: {
    positive:
      'Before/after or comparison scene. Left side: dull, problematic state. ' +
      'Right side: bright, improved state. Split composition or gradual transition. ' +
      'No product. Related to {problem_context}. ' +
      'No text, letters, or typography anywhere in the image.',
    negative: 'text, letters, words, numbers, arrows, labels, before, after, annotation, caption, product',
  },
  rating_bg: {
    positive:
      'Abstract premium background for product rating display. ' +
      'Soft golden bokeh circles, warm ambient light particles. ' +
      'Radiant concentric circles emanating from center. ' +
      'Elegant and luxurious mood, {palette_description}. ' +
      'No text, no product, only atmospheric background. ' +
      'No text, letters, or typography anywhere in the image.',
    negative: 'text, letters, product, human, harsh light, dark, gloomy',
  },
}

export interface ProImagePromptSlots {
  productName?: string
  /** EFFECT_ONLY 컷은 빈 문자열을 전달할 것(위 파일 헤더 규칙 참조). */
  productConsistencyRules?: string
  problemContext?: string
  productContext?: string
  keyBenefit?: string
  brandMood?: string
  paletteColors?: string
  paletteDescription?: string
}

/** PRO_IMAGE_PROMPTS[imgType].positive의 슬롯을 치환한다(image_generation_agent.py:1136-1148 상당). */
export function buildProImagePrompt(imgType: ProImageType, slots: ProImagePromptSlots): string {
  return PRO_IMAGE_PROMPTS[imgType].positive
    .replace('{product_name}', () => slots.productName ?? '')
    .replace('{PRODUCT_CONSISTENCY_RULES}', () => slots.productConsistencyRules ?? '')
    .replace('{problem_context}', () => slots.problemContext ?? '')
    .replace('{product_context}', () => slots.productContext ?? '')
    .replace('{key_benefit}', () => slots.keyBenefit ?? '')
    .replace('{brand_mood}', () => slots.brandMood ?? '')
    .replace('{palette_colors}', () => slots.paletteColors ?? '')
    .replace('{palette_description}', () => slots.paletteDescription ?? '')
}

/**
 * empathy_scene(09) 전용 가드 append(image_generation_agent.py:1153-1158) — problem과 동종
 * '제품 미등장·인물 중심' pain 컷이라 경쟁/구형 제품이 히어로로 그려지지 않도록 사람·감정 중심
 * 가드를 덧붙인다. comparison_scene(16)은 before/after 분할 구도(인물 불필요)라 대상 아님(원본 주석).
 * PROBLEM_SCENE_GUARD 원문은 pdp-image-prompts.ts 소유 — import하지 않고 인자로 받는다.
 */
export function buildEmpathySceneProPrompt(slots: ProImagePromptSlots, problemSceneGuard: string): string {
  return `${buildProImagePrompt('empathy_scene', slots)}\n${problemSceneGuard}`
}

// ── certification_badge cert_type 4-way 완전 치환 (image_generation_agent.py:1160-1237) ──

export type CertificationType = 'genuine' | 'ranking' | 'award' | 'safety'

/**
 * cert_type 감지 — NEXFIT image_generation_agent.py:1163-1165. 인증 카피 템플릿과 같은 판정을 쓴다(P0-1b: 플랫폼 이름·'인기'·
 * '판매량'만으로는 순위가 아니다 — 입력 '쿠팡 입점'에 No.1 왕관을 그리지 않는다, 영문 약칭은 낱말 경계)
 */
export function detectCertificationType(certificationInfo: string): CertificationType {
  return detectCertType(certificationInfo)
}

// NEXFIT image_generation_agent.py:1183-1190 — 숫자 '1'은 입력에 1위·No.1이 있을 때만(P0-1b)
const RANKING_CERT_PROMPT = (first: boolean) =>
  (first ? 'No.1 crown emblem for best-selling product. ' : 'Laurel wreath emblem for a featured product. ') +
  'Royal crown combined with laurel wreath emblem design, metallic gold finish, ' +
  (first ? "number '1' prominently featured in center. " : 'no numbers. ') +
  'Victory and excellence symbolism. ' +
  'Clean dark background (#1a1a1a). Professional premium quality. ' +
  'No text, no letters, no words — pure graphic emblem only.'

// NEXFIT image_generation_agent.py:1191-1198
const AWARD_CERT_PROMPT =
  'Prestigious design award crystal trophy on dark background. ' +
  'Elegant crystal and metallic trophy with geometric modern design. ' +
  'Award ceremony atmosphere with subtle spotlight glow. ' +
  'Clean dark background (#1a1a1a). Professional premium quality. ' +
  'No text, no letters, no words — pure trophy graphic only.'

// NEXFIT image_generation_agent.py:1201-1226 — 인증 키워드별 공식 마크 프롬프트
const SAFETY_CERT_MARK_PROMPTS: Record<string, string> = {
  KC:
    "Korean KC safety certification mark — heart-shaped outline with 'KC' letters inside, " +
    'official Korean government safety standard symbol, clean vector-style on dark background (#1a1a1a).',
  HACCP:
    'HACCP food safety certification logo — official blue and white HACCP emblem, ' +
    'hexagonal shape with checkmark, clean professional certification mark on dark background (#1a1a1a).',
  // 미국 정부 공식 인장은 흉내 내지 않는다(등록을 승인처럼 보이게 하는 사칭 — P0-1b). 약칭 글자만 든 일반 원형 배지
  FDA:
    "Simple circular registration badge with the initials 'FDA' only — generic emblem, not an official government seal, " +
    'no eagle, no agency insignia, clean vector-style on dark background (#1a1a1a).',
  ISO:
    'ISO international standard certification — circular ISO emblem with globe design, ' +
    'blue and silver tones, official standardization mark on dark background (#1a1a1a).',
  GMP:
    'GMP pharmaceutical certification mark — Good Manufacturing Practice official seal, ' +
    'green and blue professional certification emblem on dark background (#1a1a1a).',
  CE:
    'European CE conformity mark — official CE letters in specific proportions, ' +
    'European standard certification symbol on dark background (#1a1a1a).',
}

// NEXFIT image_generation_agent.py:1232-1236 — 매칭 키워드 없을 때 기본값. 정부·기관 공식 인장처럼 보이게 하지 않는다(P0-1b —
// 특허·식약처·KFDA·UL 등 마크가 따로 없는 입력에 기관 인장을 지어내지 않는다)
const DEFAULT_SAFETY_CERT_PROMPT =
  'Simple certification badge — clean generic emblem with a checkmark, ' +
  'not an official government or agency seal, blue and silver tones on dark background (#1a1a1a).'

/** safety 세부 마크(KC/HACCP/FDA/ISO/GMP/CE) 첫 매치 선택 — 원문 dict 순회 순서 그대로, 영문 약칭은 낱말 경계('KCL'은 KC 아님) */
function matchSafetyCertMarkPrompt(certificationInfo: string): string {
  for (const key of Object.keys(SAFETY_CERT_MARK_PROMPTS)) {
    if (hasCertWord(certificationInfo, key)) return SAFETY_CERT_MARK_PROMPTS[key]
  }
  return DEFAULT_SAFETY_CERT_PROMPT
}

/**
 * certification_badge 완전 치환(image_generation_agent.py:1161-1237). genuine 케이스는
 * PRO_IMAGE_PROMPTS.certification_badge.positive와 바이트 동일(원문도 동일 문구 중복 — 원문 보존).
 * certificationInfo가 빈 문자열이면 어떤 키워드도 매치하지 않아 genuine으로 귀결되므로,
 * "certification_info 없으면 기본 사전값 사용" 원본 분기(agent.py:1161 `and certification_info`)와
 * 결과가 동일하다 — 호출부는 이 함수를 항상 불러도 안전하다.
 */
export function buildCertificationBadgePrompt(certificationInfo: string): string {
  const certType = detectCertificationType(certificationInfo)
  switch (certType) {
    case 'genuine':
      return PRO_IMAGE_PROMPTS.certification_badge.positive
    case 'ranking':
      return RANKING_CERT_PROMPT(FIRST_RANK_PATTERN.test(certificationInfo))
    case 'award':
      return AWARD_CERT_PROMPT
    case 'safety':
      // NEXFIT image_generation_agent.py:1237
      return `${matchSafetyCertMarkPrompt(certificationInfo)} No text except the certification mark initials. Professional quality.`
  }
}

// ── event_banner 세일/증정/한정 무드 3분기 append (image_generation_agent.py:1239-1246) ──

const SALE_EVENT_KEYWORDS = ['할인', '세일', 'sale', 'off', '%']
const GIFT_EVENT_KEYWORDS = ['증정', '사은품', '선물', 'gift']
const LIMITED_EVENT_KEYWORDS = ['한정', '마감', 'until', '까지']

/** event_banner 분위기 매칭 append — 키워드 미매치면 base를 그대로 반환(원문 조건부 append). */
export function buildEventBannerPrompt(eventBannerInfo: string): string {
  const base = PRO_IMAGE_PROMPTS.event_banner.positive
  if (SALE_EVENT_KEYWORDS.some((kw) => eventBannerInfo.includes(kw))) {
    return `${base} Urgent sale mood with bold energy.`
  }
  if (GIFT_EVENT_KEYWORDS.some((kw) => eventBannerInfo.includes(kw))) {
    return `${base} Generous gift/bonus mood with celebratory feel.`
  }
  if (LIMITED_EVENT_KEYWORDS.some((kw) => eventBannerInfo.includes(kw))) {
    return `${base} Limited-time urgency with countdown feel.`
  }
  return base
}

// ── 포토 프리셋 맵 + 인체 컷 안티아티팩트 (image_generation_agent.py:1253-1282) ──

/** img_type → PHOTOGRAPHY_PRESETS(pdp-image-prompts.ts 소유) 조회 키. 그래픽/추상 컷은 매핑 없음. */
export const PRO_PHOTO_PRESET_MAP: Partial<Record<ProImageType, string>> = {
  product_exposure: 'feature',
  direction_hint: 'hero',
  key_benefit_visual: 'feature',
  premium_hero: 'hero',
  concept_mood: 'lifestyle',
  empathy_scene: 'lifestyle',
  comparison_scene: 'comparison',
  // conversion_cta: 'cta' — 원본에 존재하나(§5.3 제외 판정) conversion_cta 자체를 이식하지 않으므로 제외
}

// NEXFIT image_generation_agent.py:1264 — 그래픽/추상 컷은 포토그래피 디렉티브 불필요
export const PRO_GRAPHIC_IMAGE_TYPES: ReadonlySet<ProImageType> = new Set([
  'certification_badge',
  'event_banner',
  'rating_bg',
  // sold_out_banner: base 컷(pdp-image-prompts.ts 소관)이라 이 파일의 ProImageType에는 없음
])

// NEXFIT image_generation_agent.py:1271 — 인체 등장 가능 컷
export const PRO_HUMAN_SUBJECT_TYPES: ReadonlySet<ProImageType> = new Set([
  'empathy_scene',
  'concept_mood',
  // conversion_cta — §5.3 제외 판정으로 이 파일에는 없음
])

// NEXFIT image_generation_agent.py:1273-1282
export const HUMAN_SUBJECT_QUALITY_RULES =
  'Human Subject Quality Rules:\n' +
  '- Natural pose, accurate hand depiction (exactly 5 fingers per hand)\n' +
  '- Natural skin tone and texture — no plastic-like sheen, realistic pores\n' +
  '- Wrist/finger joints must be anatomically natural\n' +
  '- Shadow direction consistent across all elements\n' +
  '- Hair: individual strand visibility near edges, no helmet effect\n' +
  '- Clothing wrinkles: follow natural fabric physics, no floating folds'

// ── 스타일 디렉티브 (image_generation_agent.py:1993-1998) — Pro 옵션 image_photo_style 반영 지점 ──

export type ProPhotoStyle = 'studio' | 'lifestyle' | 'minimal' | 'warm_tone'

export const PRO_PHOTO_STYLE_DIRECTIVES: Record<ProPhotoStyle, string> = {
  studio: 'Studio setup: large softbox key light at 45 degrees, white reflector fill, clean seamless background.',
  lifestyle:
    'Natural lighting: window light or outdoor golden hour, warm soft ambient, lifestyle environment background.',
  minimal: 'Minimal setup: pure white seamless background, high-key lighting, minimal shadow, maximum product clarity.',
  warm_tone: 'Warm tone: golden hour warm lighting, 5200K color temperature, soft amber tones, inviting atmosphere.',
}

/** image_photo_style 조회 — 미지정·무효값은 studio 폴백(원문 `.get(style, _style_directives["studio"])`). */
export function getProPhotoStyleDirective(style: string | undefined): string {
  return PRO_PHOTO_STYLE_DIRECTIVES[style as ProPhotoStyle] ?? PRO_PHOTO_STYLE_DIRECTIVES.studio
}
