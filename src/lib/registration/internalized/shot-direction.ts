/**
 * E-4 컷별 연출 지시 `buildRoleShotBlock` — docs/plans/pdp-enrichment/00_DESIGN.md §4.4·부록 D. 순수 함수·결정론.
 * Track I(shots 기록 잡) 이미지 그라운딩의 "모든 컷 공통 타이포 수치" 대신 이 컷 역할의 촬영 언어를 영문으로 준다.
 * - 태스크 → 역할(부록 D). 그래픽 컷(rating_bg·certification_badge·event_banner·sold_out_banner·usp_icons)과 표에 없는 태스크는 null.
 * - 역할의 실측 상위 앵글·구도·조명·연출·배경(통제 어휘 키 → 고정 영문 구절), 등급 레버(전문 > 템플릿 격차, style pack 가중),
 *   proof_plan 증거 컷 유형(usp 컷 클로즈업), 모바일 구도 고정 구절. 600자 이하, px·hex 없음.
 * - 컷 프롬프트가 이미 정한 지시가 이긴다: 블록 첫 줄에 우선순위를 밝히고, 차별 지시가 있는 pro 컷(TASK_OWN_AXES)은
 *   그 축을 빼며, 제품이 나오지 않는 컷(EFFECT_ONLY·문제 장면)은 장면형 배경만 준다(제품 축·증거·레버 없음).
 * - 앵글·구도는 역할 대표 컷(FRAMING_LEAD_TASKS)만 받는다 — 같은 역할의 다른 컷에 같은 앵글·구도를 주면 같은 사진이 반복된다.
 * NO_TEXT·일관성 규칙·식별 카드·연령 블록은 이 블록과 별개로 기존 조립 경로가 그대로 붙인다.
 */

import type { StrategyContract } from '../pdp-state'
import type { Role16 } from '../corpus-v2'
import { lookupRoleVocab, type DesignVocabSnapshot, type VocabShotAxis } from '../design-vocab'
import type { PersuasionGrammar } from './persuasion-rules'

export const SHOT_BLOCK_MAX_CHARS = 600

/** 모바일 구도 고정 구절(§4.4) — 폰에서 컷이 약 390px 폭으로 줄고 편집기에서 위아래가 잘린다. */
export const MOBILE_FRAMING_PHRASE =
  'Mobile framing: subject fills at least 60% of the frame, key detail in the vertical middle band (30-70% of height), minimal clutter, clear subject-background brightness contrast.'

/** 연출 블록은 프롬프트 맨 뒤에 붙지만 컷 자체 지시를 이기지 않는다. */
export const SHOT_PRIORITY_NOTE =
  'Pro-page defaults: where the cut instructions above set angle, distance, framing, lighting, background, props or people, follow them.'

const PROBLEM_SCENE_NOTE = 'Scene only — the product does not appear.'

/**
 * 컷 프롬프트가 스스로 정하는 축 — 연출 블록에서 뺀다(pdp-image-pro-prompts.ts). 같은 product_intro 역할이라도
 * hero와 같은 정면·중앙 지시가 차별 컷에 붙으면 "같은 사진 반복"이 되살아난다.
 */
const TASK_OWN_AXES: Record<string, VocabShotAxis[]> = {
  product_exposure: ['angle', 'composition', 'backdrop'], // MANDATORY ANGLE CHANGE, 같은 조명, 깨끗한 배경
  direction_hint: ['angle', 'composition', 'lighting', 'backdrop'], // SHOT DISTANCE(더 넓게), 스튜디오 조명, 그라데이션·흐린 배경
  premium_hero: ['angle', 'composition', 'lighting', 'backdrop'], // MANDATORY CONTRAST: 낮은 앵글·극적 조명·그라데이션/반사 배경
  concept_mood: ['angle', 'composition', 'lighting', 'staging', 'backdrop'], // 위에서 본 비중앙 배치·자연 소재 바닥·소품·따뜻한 조명
}

/** 역할 실측 앵글·구도를 받는 대표 컷 — 같은 역할의 나머지 컷(solution·cta·features:1~·key_benefit_visual 등)은 뺀다. */
const FRAMING_LEAD_TASKS = new Set(['hero', 'features:0', 'howto:0', 'usage', 'size_comparison'])
const FRAMING_AXES: VocabShotAxis[] = ['angle', 'composition']

/** 제품 없는 장면 컷에 줄 수 있는 배경 — 스튜디오·누끼 배경은 일상 장면과 어긋난다. */
const SCENE_BACKDROPS = new Set(['real_space', 'staged_set'])

/** 부록 D — 태스크(인덱스 앞부분) → 역할. usage는 문법 G4면 target_recommendation, 아니면 how_to_guide. */
const TASK_ROLE: Record<string, Role16 | 'usage'> = {
  hero: 'product_intro',
  premium_hero: 'product_intro',
  product_exposure: 'product_intro',
  direction_hint: 'product_intro',
  solution: 'product_intro',
  cta: 'product_intro',
  problem: 'problem',
  empathy_scene: 'problem',
  usage: 'usage',
  // 긴 상세페이지 사용 장면 모음(L-2) — 사용 컷과 같은 역할
  long_scene: 'usage',
  features: 'usp_feature',
  key_benefit_visual: 'usp_feature',
  comparison_scene: 'usp_feature',
  concept_mood: 'brand_story',
  howto: 'how_to_guide',
  size_comparison: 'size_spec',
}

/** 통제 어휘 키 → 고정 영문 구절. null은 단일 컷 지시로 옮기지 않는 키(여러 컷 분포·그래픽 표식). */
const SHOT_PHRASES: Record<VocabShotAxis, Record<string, string | null>> = {
  angle: {
    front: 'straight-on front view',
    front_closeup: 'front close-up',
    angle45: '45-degree three-quarter view',
    top_down: 'top-down overhead view',
    side: 'side profile view',
    rear: 'rear view',
    low_angle: 'low-angle hero view',
    closeup: 'close-up framing',
    macro: 'macro detail view',
    mixed: null,
  },
  composition: {
    center: 'centered subject',
    thirds: 'rule-of-thirds placement',
    diagonal: 'diagonal composition',
    fill_frame: 'subject filling the frame',
    repeat_row: 'items repeated in a row',
    comparison: 'side-by-side comparison',
    flatlay: 'flat-lay arrangement',
  },
  lighting: {
    soft_even: 'soft even studio light',
    contact_shadow: 'soft contact shadow',
    directional: 'directional key light',
    backlight: 'gentle rim backlight',
    hard_shadow: 'crisp hard shadows',
    reflection: 'subtle surface reflection',
  },
  staging: {
    none: 'product alone',
    props: 'a few relevant props',
    in_use_scene: 'shown in real use',
    model_wearing: 'worn or used by an adult model',
    hand_model: 'held by an adult hand',
    product_state: 'shown in its key working state',
    texture_swatch: 'texture swatch detail',
    multiple: 'several units together',
    graphic_marks: null,
  },
  backdrop: {
    white_cutout: 'clean white background',
    light_studio: 'light seamless studio background',
    real_space: 'real-life space background',
    staged_set: 'styled set background',
    color_backdrop: 'solid color backdrop',
    gradient: 'soft gradient backdrop',
  },
}

/**
 * 등급 레버(전문 > 템플릿) 중 한 컷 지시로 옮길 수 있는 것 → 영문 구절. 역할의 실측 축 값과 부딪히지 않게
 * 대상 역할을 한정한다(roles 없음 = 모든 제품 컷). 배경 레버(그라데이션)는 아래 배경 대안으로만 붙인다.
 */
const LEVERS: Record<string, { phrase: string; roles?: Role16[]; axis?: VocabShotAxis }> = {
  'framing:full_bleed': { phrase: 'edge-to-edge full-bleed framing', axis: 'composition' },
  'photoType:staged': { phrase: 'styled, art-directed look', roles: ['product_intro', 'brand_story'] },
  'angle:macro': { phrase: 'add one macro detail of the key feature', roles: ['usp_feature'], axis: 'angle' },
  'staging:texture_swatch': { phrase: 'visible material texture', roles: ['usp_feature'], axis: 'staging' },
}
const GRADIENT_LEVER_KEYS = new Set(['background:gradient', 'gradient:any'])

/** visual_style_pack → 레버 가중(격차에 더한다) */
const STYLE_PACK_LEVER_BONUS: Record<NonNullable<StrategyContract['visual_style_pack']>, Record<string, number>> = {
  clean_proof: { 'angle:macro': 0.2, 'staging:texture_swatch': 0.2 },
  warm_story: { 'photoType:staged': 0.2 },
  premium_editorial: { 'framing:full_bleed': 0.2, 'photoType:staged': 0.1 },
  cute_soft: { 'photoType:staged': 0.1 },
}

/** proof_plan 증거 컷 유형(자유 한글) → usp 컷 클로즈업 지시 */
const PROOF_CUES: Array<{ pattern: RegExp; phrase: string }> = [
  { pattern: /클로즈업|접착|디테일|마감/, phrase: 'macro close-up that makes the key claim visible' },
  { pattern: /소재|질감|원단|재질/, phrase: 'texture close-up of the material' },
  { pattern: /구조|단면|내부/, phrase: 'clear view of the structure' },
]

export interface ShotContext {
  category: string | null | undefined
  vocab: DesignVocabSnapshot
  grammar?: PersuasionGrammar
  stylePack?: StrategyContract['visual_style_pack']
  proofTypes?: string[]
}

export function shotRoleForTask(task: string, grammar?: PersuasionGrammar): Role16 | null {
  const role = TASK_ROLE[task.split(':')[0]]
  if (!role) return null
  if (role === 'usage') return grammar === 'G4' ? 'target_recommendation' : 'how_to_guide'
  return role
}

function topPhrase(axis: VocabShotAxis, shares: Array<{ key: string }>): string | null {
  for (const { key } of shares) {
    const phrase = SHOT_PHRASES[axis][key]
    if (phrase) return phrase
  }
  return null
}

const leverAdvantages = (vocab: DesignVocabSnapshot) =>
  Object.values(vocab.platforms).flatMap((p) => p.tierLevers.filter((l) => l.pro > l.template))

function leverPhrases(role: Role16, ctx: ShotContext, ownAxes: readonly VocabShotAxis[]): string[] {
  const best = new Map<string, number>()
  for (const lever of leverAdvantages(ctx.vocab)) {
    const def = LEVERS[lever.key]
    if (!def || (def.roles && !def.roles.includes(role)) || (def.axis && ownAxes.includes(def.axis))) continue
    const score =
      lever.pro - lever.template + (ctx.stylePack ? (STYLE_PACK_LEVER_BONUS[ctx.stylePack][lever.key] ?? 0) : 0)
    best.set(lever.key, Math.max(best.get(lever.key) ?? 0, score))
  }
  return [...best.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 2)
    .map(([key]) => LEVERS[key].phrase)
}

function proofPhrases(proofTypes: string[] | undefined): string[] {
  const out = PROOF_CUES.filter((cue) => (proofTypes ?? []).some((t) => cue.pattern.test(t))).map((cue) => cue.phrase)
  return out.slice(0, 2)
}

/**
 * 태스크 하나의 연출 블록 — 역할이 없거나(그래픽·표 밖) vocab에 역할 분포가 없으면 null.
 * effectOnly(ImageTask.effectOnly — 제품 미등장·참조 없음)면 장면 경로다.
 */
export function buildRoleShotBlock(
  task: string,
  ctx: ShotContext,
  /** planAngle — R3 촬영 계획(shotplan)이 이 컷의 앵글을 정한다: 역할 실측 앵글을 빼서 두 지시가 부딪히지 않게 한다 */
  options: { effectOnly?: boolean; planAngle?: boolean } = {}
): string | null {
  const role = shotRoleForTask(task, ctx.grammar)
  if (!role) return null
  const found = lookupRoleVocab(ctx.category, role, ctx.vocab)
  if (!found) return null
  const shot = found.role.shot
  const scene = options.effectOnly === true || role === 'problem'
  const ownAxes = [
    ...(TASK_OWN_AXES[task.split(':')[0]] ?? []),
    ...(FRAMING_LEAD_TASKS.has(task) ? [] : FRAMING_AXES),
    ...(options.planAngle ? (['angle'] as const) : []),
  ]
  // 장면 컷은 장면형 배경만(인물 중심·분할 구도는 컷 지시 소관), 제품 컷은 컷 지시가 정한 축을 뺀 나머지
  const axes: VocabShotAxis[] = scene
    ? ['backdrop']
    : (['angle', 'composition', 'lighting', 'staging', 'backdrop'] as const).filter((axis) => !ownAxes.includes(axis))
  // 그라데이션 레버 우위 + 역할 배경 분포에 그라데이션이 있으면 제품 컷에 배경 대안으로 덧붙인다(실측 1순위 배경은 유지)
  const gradientAlt =
    !scene &&
    leverAdvantages(ctx.vocab).some((l) => GRADIENT_LEVER_KEYS.has(l.key)) &&
    found.role.background.some((b) => b.key === 'gradient' && b.share > 0)
  const direction = axes
    .map((axis) => {
      const shares = scene ? (shot[axis] ?? []).filter((s) => SCENE_BACKDROPS.has(s.key)) : (shot[axis] ?? [])
      const phrase = topPhrase(axis, shares)
      return axis === 'backdrop' && phrase && gradientAlt && phrase !== SHOT_PHRASES.backdrop.gradient
        ? `${phrase} or a ${SHOT_PHRASES.backdrop.gradient}`
        : phrase
    })
    .filter((p): p is string => Boolean(p))
  const header = `[Shot direction — ${role}${scene ? ' scene' : ''}]`
  const required = [
    header,
    ...(scene ? [PROBLEM_SCENE_NOTE] : []),
    SHOT_PRIORITY_NOTE,
    direction.length ? `${direction.join(', ')}.` : '',
    MOBILE_FRAMING_PHRASE,
  ]
  const optional = scene
    ? []
    : [
        ...(role === 'usp_feature' ? proofPhrases(ctx.proofTypes).map((p) => `Proof: ${p}.`) : []),
        ...leverPhrases(role, ctx, ownAxes).map((p) => `Premium cue: ${p}.`),
      ]
  const lines = required.filter(Boolean)
  for (const line of optional) {
    if ([...lines, line].join('\n').length <= SHOT_BLOCK_MAX_CHARS) lines.push(line)
  }
  return lines.join('\n')
}
