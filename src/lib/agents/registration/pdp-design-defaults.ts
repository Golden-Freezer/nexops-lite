/**
 * PDP 파이프라인 3단계(디자인프롬프트) 결정론 폴백 데이터 — NEXFIT design_prompt_agent.py
 * _get_default_section_plan(:1051-1132)·_get_default_prompts(:1134-1199) 1:1 이식.
 * LLM 콜이 재시도 후에도 실패할 때만 쓰인다(정상 경로는 pdp-design-agent.ts 소관) — 그래서
 * 잡을 실패시키지 않는 "폴백 후 계속" 계약의 마지막 안전망이다.
 *
 * NO_TEXT_INSTRUCTION은 원본이 design_prompt_agent.py 로컬에 별도 정의하지만(문구가 미세하게
 * 다름), pdp-design-prompts.ts가 이미 PRODUCT_CONSISTENCY_RULES를 pdp-image-prompts.ts SSOT로
 * 통합한 선례를 따라 이 파일도 pdp-image-prompts.ts의 NO_TEXT_INSTRUCTION을 재사용한다
 * (근접 중복 상수를 새로 만들지 않음 — 인벤토리 §0-6 통합 원칙 연장 적용).
 */

import type { PdpSpecSheet, SectionPlan, DesignPrompts } from '@/lib/registration/pdp-state'
import { PRODUCT_CONSISTENCY_RULES, NO_TEXT_INSTRUCTION } from './prompts/pdp-image-prompts'

/** specSheet 리뷰 존재 신호 — 원본 spec_sheet.reviews bool 대응(리뷰 원문 또는 건수). */
export function hasReviewsSignal(specSheet: PdpSpecSheet): boolean {
  return Boolean(specSheet.reviewsText?.trim()) || (specSheet.reviewCount ?? 0) > 0
}

/**
 * 섹션설계 실패 시 데이터 기반 기본 플랜 — 최소 18개 섹션 보장.
 * design_prompt_agent.py:1051-1132 1:1(무기/프레임 결정 → hero/narrative/social/usp/closing
 * 조립 → 데이터 없는 섹션 필터 → 최소 섹션 수 CTA 앞 보정).
 */
export function getDefaultSectionPlan(essenceType: string, specSheet: PdpSpecSheet): SectionPlan {
  const soldOutInt = specSheet.soldOutCount ?? 0
  const hasReviews = hasReviewsSignal(specSheet)

  let weapon: string
  let frame: string
  if (soldOutInt >= 3) {
    weapon = '실적증거'
    frame = 'wave_mirror'
  } else if (essenceType === 'sensory') {
    weapon = '시각적충격'
    frame = 'studio'
  } else if (essenceType === 'emotional') {
    weapon = '감성연결'
    frame = 'petal'
  } else {
    weapon = '문제공감'
    frame = 'wave_wide'
  }

  const hero = ['hook_3step', 'main_cut', 'certification']
  const narrative = ['problem_raise', 'problem_empathy', 'direction_suggest', 'solution_guide', 'product_exposure']
  const social: string[] = []
  if (soldOutInt > 0) social.push('perf_sales')
  if (hasReviews) social.push('perf_rating', 'perf_reviews')
  const usp = ['key_message', 'concept_desc', 'point_div', 'sub_div', 'sub2_div_page', 'hidden_page']
  const closing = ['compare_div', 'point_list_div', 'petit_div', 'spec_table', 'cta']
  const allSections = [...hero, ...narrative, ...social, ...usp, ...closing]

  const activated: string[] = []
  for (const sec of allSections) {
    if (sec === 'perf_sales' && !soldOutInt) continue
    if ((sec === 'perf_reviews' || sec === 'perf_rating') && !hasReviews) continue
    if (sec === 'petit_div' && !specSheet.colorOptions?.length) continue
    if (sec === 'certification' && !specSheet.certificationInfo) continue
    if (sec === 'event_banner' && !specSheet.eventBannerInfo) continue
    activated.push(sec)
  }

  // 최소 18개 보장 — 부족하면 CTA 앞에 추가 섹션 투입
  const EXTRA_SECTIONS = ['event_bundle', 'event_banner']
  for (const extra of EXTRA_SECTIONS) {
    if (activated.length >= 18) break
    if (!activated.includes(extra)) {
      const ctaIdx = activated.indexOf('cta')
      activated.splice(ctaIdx === -1 ? activated.length : ctaIdx, 0, extra)
    }
  }

  return {
    activated_sections: activated,
    section_order: [...activated],
    section_specs: {},
    design_direction: '기본',
    reasoning: `fallback — ${weapon}, ${activated.length}개 섹션`,
    hook_strategy: {
      strongest_weapon: weapon,
      reasoning: 'fallback 판단',
      first_3_seconds: '',
      hero_frame: frame,
      image_hooking: false,
    },
    layout_selections: {},
    font_scheme: {},
  }
}

/**
 * 이미지 프롬프트 생성 실패 시 기본 프롬프트 — design_prompt_agent.py:1134-1199 1:1.
 * primaryColor/bgColor/secondaryColor는 호출부가 항상 팔레트 토큰(`{palette.primary}` 등)을
 * 넘긴다 — 원본의 실제 HEX 경로(_ensure_text_contrast 대비 보정)는 이 파이프라인 순서상
 * 도달 불가능한 죽은 분기라 이식하지 않는다(팔레트는 카피라이팅 단계 이후 확정된다).
 */
export function getDefaultDesignPrompts(
  productName: string,
  bgColor: string,
  primaryColor: string,
  secondaryColor: string
): DesignPrompts {
  return {
    section_image_prompts: {
      hero: {
        positive: `Premium studio product photography of ${productName}. Center-placed, 60-70% frame. 30-degree elevated angle. Soft diffused lighting. Clean ${bgColor} background. Sharp edges. ${PRODUCT_CONSISTENCY_RULES} ${NO_TEXT_INSTRUCTION}`,
        negative: 'text, letters, watermark, blurry, cluttered',
        style: 'premium_studio',
      },
      problem: {
        positive: `Empathetic lifestyle scene centered on the CUSTOMER's facial expression and situation, showing everyday frustration. Frame the person and their emotion — do NOT depict any product, tool, device, or any old / alternative version of the product as a focal object. WARM and INVITING mood — soft warm natural lighting, warm color temperature, natural saturated colors. Clean aesthetic composition. Korean adult model. DO NOT include the product. ${NO_TEXT_INSTRUCTION}`,
        negative:
          'any product, any tool, any device as a focal object, old or industrial equipment, products displayed on shelves, product, text, letters, watermark, cool blue tones, gray desaturated mood, gloomy, dark filter, children',
        style: 'empathy',
      },
      solution: {
        positive: `Bright positive lifestyle with ${productName} in use. Warm tones, satisfied expression. Clean background. Korean adult model. ${PRODUCT_CONSISTENCY_RULES} ${NO_TEXT_INSTRUCTION}`,
        negative: 'text, letters, watermark, dark tones, children',
        style: 'solution_hero',
      },
      options: {
        positive: `Clean grid of product variations. Same lighting and angle. ${bgColor} background. ${PRODUCT_CONSISTENCY_RULES} ${NO_TEXT_INSTRUCTION}`,
        negative: 'text, letters, watermark, inconsistent lighting',
        style: 'catalog',
      },
      usage: {
        positive: `Natural lifestyle photo using ${productName} in its natural usage environment inferred from the product type (indoor or outdoor, matching season and place). Authentic interaction. Korean adult model. ${PRODUCT_CONSISTENCY_RULES} ${NO_TEXT_INSTRUCTION}`,
        negative: 'text, letters, watermark, subway, bus, children',
        style: 'lifestyle',
      },
      detail: {
        positive: `Extreme macro close-up of ${productName}. Texture focus. 80% frame fill. Side lighting. White background. ${PRODUCT_CONSISTENCY_RULES} ${NO_TEXT_INSTRUCTION}`,
        negative: 'text, letters, watermark, blurry texture',
        style: 'macro',
      },
      cta: {
        positive: `Premium aspirational display of ${productName}. Golden hour lighting. ${primaryColor} accents. Trust and desire. ${PRODUCT_CONSISTENCY_RULES} ${NO_TEXT_INSTRUCTION}`,
        negative: 'text, letters, watermark, cold tones',
        style: 'emotional',
      },
    },
    feature_prompts: [],
    howto_prompts: [],
    lighting_params: {
      direction: 'top-left',
      intensity: 0.85,
      shadow_angle: 45,
      ambient_level: 0.35,
      color_temperature: 'warm',
    },
    color_params: {
      primary_hex: primaryColor,
      secondary_hex: secondaryColor,
      background_hex: bgColor,
      // 팔레트 토큰 계약 상 항상 토큰 문자열이므로 원본의 실제 대비 보정 분기는 도달하지 않는다.
      text_on_light: primaryColor,
      tone_mapping: 'warm',
      saturation_level: '0.75',
    },
    composition_notes: 'Product as visual hero. Consistent lighting. Cohesive image set.',
  }
}
