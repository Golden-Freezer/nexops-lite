/**
 * R2 장면 컷(PDP-DR-PLAN §3) — 잡 스위치 scene(기본 off, Track I)이 켜진 잡의 컷 프롬프트를 다듬는다(pdp-image-stage, 플레이트 제외).
 * - 장면 컷(문제·해결·사용·공감·분위기·비교 장면·사용법)은 헌장의 단색 바탕 대신 헌장 세트(scene-set.ts) 안에서 찍는다
 * - 피처 컷의 'Background: Match design palette <bgSub>' 줄을 뺀다 — 바탕은 헌장 한 곳(bgMain)이 정한다(bgSub·bgMain 이원화 정리)
 * - 상품이 없는 장면 컷(effectOnly)에 붙이는 히어로 참조 안내 — 빛·배경 톤·색감만, 상품은 그리지 않는다
 * - D2(designcut2 잡) 상품 컷도 세트 안 장면 + 역할별 거리(applyD2SceneCut)
 */

import type { DesigncutPlan, DesigncutStage } from './pdp-state'

/** 장면 컷 섹션(리스트형은 앞부분) — 상품 컷(hero·features·detail·cta·size·options)은 헌장의 단색 바탕 그대로 */
export const SCENE_CUT_SECTIONS: ReadonlySet<string> = new Set([
  'problem',
  'solution',
  'usage',
  // 긴 상세페이지 사용 장면 모음(L-2) — 사용 컷과 같은 생활 장면
  'long_scene',
  'empathy_scene',
  'concept_mood',
  'comparison_scene',
  'howto',
])

export function isSceneCut(section: string): boolean {
  return SCENE_CUT_SECTIONS.has(section.split(':')[0])
}

export const SCENE_BACKGROUND_LINE =
  '- Background: the shared set in "Set description" below — this is a scene cut, not a solid backdrop'
export const SCENE_STYLE_REF_TEXT =
  'STYLE REFERENCE: the attached image is the finished HERO cut of this same product page. Use it ONLY for light, ' +
  'background tone and color grading of this scene. Do NOT draw the product or any object from it — this cut shows no product.'

/** 헌장 바탕 줄(buildStyleCharter) */
const CHARTER_BACKGROUND = /^- Background: solid [^\n]*$/m
/** 피처 컷 바탕 줄(buildFeaturePrompt·buildFeaturePromptFromDesign) */
const FEATURE_BACKGROUND = /^[ \t]*- Background: Match design palette [^\n]*(?:\n|$)/gm

export function applySceneCut(prompt: string, section: string): string {
  const out = prompt.replace(FEATURE_BACKGROUND, '')
  return isSceneCut(section) ? out.replace(CHARTER_BACKGROUND, SCENE_BACKGROUND_LINE) : out
}

/**
 * D2 C2(designcut2 잡만, PDP-DR-PLAN §2) — 상품 컷(첫 화면·POINT·마무리)도 헌장 세트(C1 아트 디렉션) 안 장면으로 찍는다. 컷 지시·헌장의
 * 단색 바탕을 세트로 덮어쓰고 역할별 거리(첫 화면 중간, POINT 근접·매크로 교대, 마무리 중간~넓게)를 준다. 장면 컷은 R2와 같다.
 * 편집기 풀폭은 D2-2b
 */
const D2_PRODUCT_SCENE_SECTIONS: ReadonlySet<string> = new Set(['hero', 'features', 'cta'])

export function isD2ProductSceneCut(section: string): boolean {
  return D2_PRODUCT_SCENE_SECTIONS.has(section.split(':')[0])
}

export const D2_PRODUCT_SCENE_LINE =
  '- Background: the shared set in "Set description" below — the product is photographed inside this set, not on a solid backdrop'
export const D2_SCENE_HEADER = '[Set scene]'
/**
 * 덮어쓰기 범위 — 컷 지시(히어로 폴백 'SOLE object·No props')·연출 블록 기본값('product alone'·화면 60% 채움·역할 앵글)이 이 블록보다
 * 위에 붙고, 연출 블록의 우선 문구는 '위의 컷 지시'만 이긴다. 그래서 바탕·소품·단독 피사체·채움 비율·거리를 모두 적는다(D2-2a 검수)
 */
const D2_SCENE_RULE =
  'This block wins over every instruction above for this cut, including the shot direction defaults, about a solid, plain, ' +
  'isolated, gradient or single-color background, "no props", "sole object" or "product alone", a fixed frame-fill share, or a ' +
  'fixed shot distance. Photograph the product inside the shared set from "Set description" — the same floor, wall, window side ' +
  'and props as every other cut of this page. The product stays the one clear subject; set props stay small at the edges and ' +
  'never touch or cover it.'

/**
 * 참조 안내(NEXFIT image_generation_agent.py:1361-1378 _generate_with_reference 역할 지시문) — 첫 장 = 상품 구조 정본, 맨 끝 = hero 스타일 참조.
 * pdp-image-stage에서 옮겼다(글 그대로 — MS 맞추기 ms-prompt-fit이 같은 원문을 읽는다)
 */
export const REFERENCE_ROLES_TEXT =
  "REFERENCE ROLES: the FIRST attached image is the USER'S ORIGINAL PRODUCT PHOTO and it is " +
  "the single source of truth for the product's structure — shape, number of tiers/parts, " +
  'handles, openings and assembled state. ' +
  'STYLE REFERENCE: the LAST attached image is the finished HERO cut of this same product page. ' +
  'Use it ONLY for lighting, background tone, and color grading — match those exactly. ' +
  'Do NOT copy its composition, do NOT duplicate its subject placement, and do NOT copy the ' +
  'product structure or component count from it.'

/**
 * D2 잡의 단색 바탕 상품 컷(디테일·크기·옵션·제품 단독 등)이 받는 참조 안내 — 히어로가 세트 장면이라 기존 안내('빛·배경 톤·색감을
 * 그대로 맞추라', pdp-image-stage REFERENCE_ROLES_TEXT)를 쓰면 헌장의 단색 바탕과 부딪힌다. 빛·색감만 받고 바탕은 헌장을 따른다
 */
export const D2_SOLID_REFERENCE_ROLES_TEXT =
  "REFERENCE ROLES: the FIRST attached image is the USER'S ORIGINAL PRODUCT PHOTO and it is " +
  "the single source of truth for the product's structure — shape, number of tiers/parts, " +
  'handles, openings and assembled state. ' +
  'STYLE REFERENCE: the LAST attached image is the finished HERO cut of this same product page. ' +
  "Use it ONLY for lighting and color grading. It shows the page's set scene — do NOT copy its background: " +
  "keep this cut's solid background from the style charter. " +
  'Do NOT copy its composition, do NOT duplicate its subject placement, and do NOT copy the ' +
  'product structure or component count from it.'

export const D2_SHOT_DISTANCE = {
  hero: 'medium shot — the whole product with some of the set around it',
  close: 'close-up — the feature fills most of the frame, the set softly visible behind',
  macro: 'macro — a tight detail of the feature, the set reduced to a soft background tone',
  cta: 'medium-wide shot — the product in the set with more room around it, a calm closing view',
} as const

/**
 * 상품 장면 컷의 거리 — POINT는 계획의 장 번호(1장 근접, 2장 매크로, …)로 번갈아 준다. 장 번호가 없으면 피처 번호. sub_div가
 * point_div보다 앞에 오면 피처 번호와 장 순서가 달라 같은 거리가 붙어 나올 수 있다(D2-2a 검수). 상품 장면 컷이 아니면 null
 */
export function d2ShotDistanceOf(section: string, chapter?: number | null): string | null {
  const [base, index] = section.split(':')
  if (!D2_PRODUCT_SCENE_SECTIONS.has(base)) return null
  if (base === 'hero') return D2_SHOT_DISTANCE.hero
  if (base === 'cta') return D2_SHOT_DISTANCE.cta
  const order = chapter ? chapter - 1 : Number(index)
  return order % 2 === 0 ? D2_SHOT_DISTANCE.close : D2_SHOT_DISTANCE.macro
}

/** 피처 컷을 POINT로 싣는 계획 섹션의 장 번호 — 계획이 없거나 POINT가 아니면 null */
export function d2PointChapterOf(plan: DesigncutPlan | null | undefined, section: string): number | null {
  return plan?.sections.find((s) => s.role === 'usp_feature' && s.productImageKey === section)?.chapter ?? null
}

export function applyD2SceneCut(prompt: string, section: string, chapter?: number | null): string {
  const out = applySceneCut(prompt, section)
  const distance = d2ShotDistanceOf(section, chapter)
  if (!distance) return out
  const block = [D2_SCENE_HEADER, D2_SCENE_RULE, `Shot distance: ${distance}.`].join('\n')
  return `${out.replace(CHARTER_BACKGROUND, D2_PRODUCT_SCENE_LINE)}\n\n${block}`
}

/**
 * 디자인 컷 컷 하나의 무대 이름(적용 D4 ⓐ, 기록만) — 프롬프트를 바꾸지 않고 컷 생성(pdp-image-stage generateSection)이 고르는 바탕 갈래를
 * 이름으로 적는다. 컷 목적(shotdiv) 블록이 먼저다: 다른 장소 장면 컷은 세트를 떠나고(place) 질감 컷은 매크로(macro). 그다음 D2는 상품 장면
 * 컷의 거리(매크로면 macro, 그 밖 세트 안 life)와 장면 컷(세트 안 life). D2가 아니면 scene 스위치 잡의 장면 컷만 세트(life)다. 나머지는
 * 헌장의 단색 바탕 줄이 그대로 남는 컷(solid) — 헌장은 모든 컷에 붙는다
 */
export function designcutStageOf(section: string, options: { d2: boolean; scene: boolean; chapter?: number | null; purpose?: string | null }): DesigncutStage {
  if (options.purpose === 'scene') return 'place'
  if (options.purpose === 'texture') return 'macro'
  const distance = options.d2 ? d2ShotDistanceOf(section, options.chapter) : null
  if (distance) return distance === D2_SHOT_DISTANCE.macro ? 'macro' : 'life'
  return isSceneCut(section) && (options.d2 || options.scene) ? 'life' : 'solid'
}
