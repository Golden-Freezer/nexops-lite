/**
 * PDP 이미지 단계 — 태스크 목록 구성 + 팔레트 플레이스홀더 치환(순수 함수, LLM 없음).
 * NEXFIT image_generation_agent.py 태스크 조립부(:1661-1672 base 5종 + features/howto/usp +
 * 조건부 + `_generate_pro_images`:1029-1150 Pro 10종)를 §9.1 ③ 실측 축소판(run당 1~2장 순차 생성,
 * Lite/Judge 티어링·Pillow 합성 없음)에 맞춰 이식. pdp-image-stage.ts가 이 목록을 소비해 실제
 * 생성·게이트·저장을 수행한다(오케스트레이션은 그쪽 소관 — 여기는 무엇을 만들지만 결정한다).
 */

import { ALL_IMAGE_MODELS, IMAGE_PROVIDER_BALANCE_LABEL, type ImageModel, type ImageQuality } from '@/lib/agents/image/types'
import type { DesigncutStage, DesignPrompts, DesignPalette, GeneratedImagesMap, HeroKind, PdpJobRow, SectionImage } from './pdp-state'
import { heroKindOf } from './hero-kind'
import { optionSpecOf } from './internalized/persuasion-signals'
import { primaryFormAxis } from './options/option-spec'
import { optionPhotoCoverage, optionPhotoGuard, photographedNames, stripOptionMentions } from './options/option-photo-guard'
import { buildDesigncutPlan, d2FeatureCutsOf, designcut2Enabled, problemcutEnabled } from './internalized/designcut-plan'
import { designcutTaskFilter } from './internalized/designcut-images'
import { buildFrameBrief, buildShotBrief, HANDLED, heroLargeBrief, heroPromiseLine, isHandsOnly, isPetProblem, isProblemObjectCut, isStagedCut, shotRouteOf, usesSetBackground, withoutFaceFocus, type LineShot } from './templatelib/shot-brief'
import { shotvaryEnabled, varyRefsOf, withoutFixedScene, type VaryRefs } from './templatelib/shot-variety'
import { namedIngredientsOf, shotQuantityOf } from './templatelib/input-values'
import { lineHeroKindOf } from './templatelib/product-family'
import { isFactClaimSafe } from './eval/claim-lexicon'
import { sectionTaskFilter } from './internalized/section-task-filter'
import { KOREAN_MODEL_INSTRUCTION } from '@/lib/agents/registration/prompts/pdp-image-prompts'
import { hasEnrichmentFeature, readJobEnrichment } from './enrichment-switch'
import { HERO_MOTION_SECTION } from './motion/pick'
import { heroMotionTaskOf, motionTaskOf, withShowBeat, type MotionTask } from './motion/task'
import { showBeatCutsOf, showBeatFactsOfJob, showBeatLine, showBeatOf, type ShowBeat, type ShowBeatSource } from './templatelib/show-beat'
import { buildSizeSinglePrompt, SIZE_SINGLE_SECTION } from './size-cut'
import { LONG_DETAIL_FEATURE_CAP, longImagesRecorded, longSceneKey, longSceneTags } from './long-sections'
import { designcutDrawnKeys, readExtraShots, shotdivEnabled, shotPurposeOf } from './internalized/shot-diversity'
import { d2PointChapterOf, designcutStageOf } from './pdp-image-scene'
import { singleUnitSentence } from './internalized/single-unit'
import {
  featurePromptMatchJob,
  featureSubjects,
  matchDesignEntries,
  renderAwareJob,
  selectRenderedCuts,
  type CutPlanReport,
} from './internalized/render-aware-cuts'
import type { CopywritingResult } from './editor/types/editor'
import { cutBackgroundOf } from './internalized/designcut-palette'
import { buildPlatePrompt, type PlateTemplate } from '@/lib/agents/registration/prompts/pdp-plate-prompts'
import {
  buildImagePrompts,
  buildFeaturePrompt,
  buildFeaturePromptFromDesign,
  buildHowtoPrompt,
  buildHowtoPromptFromDesign,
  buildUspIconPrompt,
  buildSizeComparisonPrompt,
  buildOptionBundlePrompt,
  buildSoldOutBannerPrompt,
  selectFeaturePrompt,
  selectHowtoPrompt,
  getCategoryDirective,
  getPhotographyContext,
  getPhotographyBase,
  isTextBearingProduct,
  applyTextPolicy,
  textRuleFor,
  PRODUCT_CONSISTENCY_RULES,
  NO_TEXT_INSTRUCTION,
  PROBLEM_SCENE_GUARD,
} from '@/lib/agents/registration/prompts/pdp-image-prompts'
import {
  PRO_IMAGE_PROMPTS,
  buildProImagePrompt,
  buildCertificationBadgePrompt,
  buildEventBannerPrompt,
  buildEmpathySceneProPrompt,
  getProPhotoStyleDirective,
  PRO_PHOTO_PRESET_MAP,
  PRO_HUMAN_SUBJECT_TYPES,
  HUMAN_SUBJECT_QUALITY_RULES,
  type ProImageType,
  type ProImagePromptSlots,
} from '@/lib/agents/registration/prompts/pdp-image-pro-prompts'

/** NEXFIT image_presets.py:322-328 EFFECT_ONLY_TYPES 1:1(base 2종 + pro 5종) — 제품 미등장, 참조·식별카드 불필요. */
export const EFFECT_ONLY_SECTIONS: ReadonlySet<string> = new Set([
  'problem',
  'sold_out_banner',
  'certification_badge',
  'event_banner',
  'empathy_scene',
  'comparison_scene',
  'rating_bg',
])

/** 그래픽/아이콘 컷 — same_product 판정이 의미 없어 Vision 게이트를 생략한다(비용 절감, 결정 없음이 원본에 아예 없던 범주). */
export const GATE_SKIP_SECTIONS: ReadonlySet<string> = new Set([
  'certification_badge',
  'event_banner',
  'rating_bg',
  'sold_out_banner',
])

export interface ImageTask {
  /** section_images[].section 저장 키. 리스트형은 `features:0`처럼 인덱스를 붙인다. */
  section: string
  prompt: string
  /** herotype 잡의 첫 화면 — 고른 유형 */
  heroKind?: HeroKind
  /** herotype 잡의 첫 화면 — 끝까지 내려갔을 때 쓸 원래 프롬프트(실사용·착용일 때만) */
  studioPrompt?: string
  /** 원본 빌더가 반환한 비율 힌트('3:4'|'1:1'|'16:9') — 생성 호출 시 지원 사이즈로 매핑(pdp-image-stage.ts) */
  aspectRatio: string
  effectOnly: boolean
  skipGate: boolean
  /** showbeat 잡의 섹션마다 한 컷(J63) — 컷 지시 Purpose 끝에 붙인 문장. MS 2k 맞추기가 이 문장 때문에 블록을 더 덜면 이미지 단계가 문장만 뺀다 */
  showBeatLine?: string
  /** 그 문장의 사실 출처(J63 2단계) — spec 칸·식별 카드 USE 줄·카피 howTo. 컷 기록 showBeatSource로 남긴다 */
  showBeatSource?: ShowBeatSource
  /** 잡 선택 모델 대신 이 컷만 쓰는 모델 — 저가 컷 강등(개정 5: rating_bg·USP 아이콘 폴백) */
  model?: ImageModel
  /** 잡 품질 대신 이 컷만 쓰는 품질 — 저가 컷 강등(lowCostCut) */
  quality?: ImageQuality
  /** K 컷 지시(shot-brief) — 생성 직전 장면 블록 뒤에 붙어 거리·구도 지시를 이긴다 */
  shotBrief?: string
  /** K 치수 칸 컷(적용 K14) — 사이즈 단독 컷처럼 제품 경계를 잰다 */
  measuresProduct?: boolean
  /** K 컷의 바탕 판단 — 이 섹션 이름의 컷처럼 찍는다. 없으면 자기 키로 판단한다 */
  sceneAs?: string
  /** K 컷 중 바탕이 세트와 일부러 다른 컷 — 게이트가 바탕 차이로 일관성을 깎지 않는다 */
  stagedGate?: boolean
  /**
   * K 라인 컷(대표 컷 포함, 실물 크기 11-05) — 게이트가 구멍·빗살 배열까지 같은 상품인지 묻고, realSize가 있으면 손·흔한 물건 대비 크기도 묻는다.
   * D 라인 태스크에는 없다(운영 게이트 문구 그대로)
   */
  lineGate?: { realSize?: string }
  /**
   * 착용 컷(점검 고침 1, 오너 11-07) — 구도 worn이거나 대표 컷이 착용이고 사람이 보이는 vary 컷. 대표 컷과 함께 재생성 뒤 한 번 더 판정한다
   * (K7 P09: 대표 컷 오류가 사람 착용 컷으로 퍼졌다). K 컷만, 없으면 지금 그대로
   */
  wornCut?: true
  /** 사람·손이 상품을 쓰는 K 컷 — 게이트가 쥐는 곳·작동면·방향·착용 부위(use_correct)를 묻는다(점검 고침 3 게이트 쪽). 없으면 지금 그대로 */
  useGate?: true
  /**
   * GIF 칸(K motion_band, motionband 스위치 잡만 — 세션 B ③ P3) — 있으면 생성 단계가 움직이는 칸(2.6 참조 GIF 또는 옵션 밀기)으로 만든다.
   * 움직이는 칸으로 만든 entry(motion)는 일반 게이트를 건너뛰고 생성 단계 안의 프레임 모음 검사가 대신한다. 정지 컷으로 내려가면 지금 게이트 그대로. 없으면 지금 그대로
   */
  motion?: MotionTask
  /**
   * 사진 다양화(shotvary 잡의 K 컷, 세션 B variety F4) — 대표 컷 참조 안내에 '정체성·옷·빛만 받고 자세·표정·구도는 따르지 않는다'를 덧붙이고,
   * 구도 지문을 기록만 한다(F5). 'person'은 사람이 보이는 Person 줄 컷(사람·옷·빛), 'light'는 그 밖의 컷(빛·색만, 운영 P08 ①-b).
   * 둘 다 첫 장 각도 풀기 안내를 받는다(②-b). 없으면 지금 그대로
   */
  varyRefs?: VaryRefs
  /**
   * 손·착용·사용 컷(K 구도 in_hand·in_use·worn, 점검 고침 3) — 생성 단계가 컷 지시 뒤에 실물 쓰는 법 줄(바르게 쓰기 + 판매자 메모·식별 카드의 쓰는 법 문장)을 붙인다.
   * 식별 카드는 태스크를 만든 뒤 같은 run에서 만들어지므로 글은 생성 시점에 만든다(run마다 같은 글). 없으면 지금 그대로.
   * usefacts 잡(결정 카드 c02)은 사용·착용 대표 컷·대표 칸에도 붙고, 재료가 식별 카드 USE 줄·사용 순서 입력(없으면 카피 howTo)이다
   */
  useCut?: true
  /**
   * 상품 없는 K 컷(목적 problem — 고민 섹션·비교 왼쪽 칸, J49 decide 24) — 이 상품을 쓰기 전 장면이라 상품을 부르는 줄을 붙이지 않는다:
   * 감독 줄은 빛·세트만, 학부모 장면 블록은 '준비된 결과' 없는 판, 게이트는 글자·브랜드만 재생성 사유로 본다(같은 상품·일관성 등은 보지 않음).
   * 기본 고민 프롬프트는 인쇄 상품이어도 일반 글자 금지 판이다. D 라인·다른 컷에는 없다(지금 그대로)
   */
  noProductCut?: true
}

/**
 * 컷별 저가 강등(개정 5 — 오너 검수 피드백 2026-08-11): 추상 배경·아이콘류는 품질 요구가 낮다. NEXFIT도 EFFECT_ONLY 컷을
 * flash 계열로 강등했다(cost_tracking.py D4) — 결정 E의 잡 단위 단일 모델 원칙의 명시적 예외.
 * PDP는 Claude·GPT만 쓴다(오너 2026-10-29) → 이전의 gemini-3.1-flash-image 고정을 버리고, 구독(로컬 — codex-image) 잡은
 * 잡 모델 그대로(0원), API 잡은 gpt-image-2 low(장당 $0.011 — 이미지 $0.006 실호출 교차 검산 + 프롬프트 입력, pdp-cost-time-followup)로 강등한다.
 * 대상 컷은 모두 effectOnly라 참조 이미지를 붙이지 않는다(edits 이미지 입력 과금 없음). 아이콘 라이브러리 기존 자산은 그대로.
 */
export const LOW_COST_SECTIONS: ReadonlySet<string> = new Set(['rating_bg'])

export function lowCostCut(job: Pick<PdpJobRow, 'image_model'>): Pick<ImageTask, 'model' | 'quality'> {
  const local = ALL_IMAGE_MODELS.find((m) => m.id === job.image_model)?.provider === 'local'
  return local ? {} : { model: 'gpt-image-2', quality: 'low' }
}

// NEXFIT image_generation_agent.py:254-261 _PALETTE_PLACEHOLDER_MAP
const PALETTE_PLACEHOLDER_MAP: Array<[string, keyof DesignPalette, string]> = [
  ['{palette.primary}', 'primary', '#4f46e5'],
  ['{palette.secondary}', 'secondary', '#818cf8'],
  ['{palette.bgMain}', 'bgMain', '#ffffff'],
  ['{palette.bgSub}', 'bgSub', '#f8fafc'],
  ['{palette.textMain}', 'textMain', '#1e293b'],
  ['{palette.textHighlight}', 'textHighlight', '#4f46e5'],
]

/**
 * `{palette.*}` 토큰을 확정 팔레트로 치환 — NEXFIT `_bind_palette_placeholders`(:264-285) 1:1.
 * 레거시 안전망: 토큰 없이 과거 기본색(#4f46e5/#818cf8)이 그대로 박혀 있어도 실제 팔레트로 교체한다.
 */
export function bindPalettePlaceholders(text: string, palette: DesignPalette | undefined): string {
  if (!text) return text
  const p = palette ?? {}
  let out = text
  for (const [token, key, fallback] of PALETTE_PLACEHOLDER_MAP) {
    if (out.includes(token)) out = out.split(token).join(p[key] || fallback)
  }
  const legacy: Array<[string, string | undefined]> = [
    ['#4f46e5', p.primary],
    ['#818cf8', p.secondary],
  ]
  for (const [oldHex, newVal] of legacy) {
    if (newVal && out.includes(oldHex) && newVal.toLowerCase() !== oldHex) out = out.split(oldHex).join(newVal)
  }
  return out
}

/**
 * design_prompts.section_image_prompts[section].positive(디자인 콜②, 영어 프롬프트)가 있으면
 * 그것을 우선 사용한다 — NEXFIT agent.py:1567-1592 "Premium: DesignPromptAgent 프롬프트 우선 사용"
 * 규약. 팔레트 토큰 치환 후, problem은 PROBLEM_SCENE_GUARD만, 나머지는 PRODUCT_CONSISTENCY_RULES +
 * 텍스트 규칙을 재부착한다(원본은 제품 일관성 규칙이 problem에 부적합하다고 명시적으로 제외).
 * 없으면 buildImagePrompts()의 폴백 프롬프트를 그대로 쓴다.
 */
function selectBaseSectionPrompt(
  section: 'hero' | 'problem' | 'solution' | 'usage' | 'cta',
  designPrompts: DesignPrompts,
  palette: DesignPalette | undefined,
  fallbackPrompt: string,
  textBearing = false
): string {
  const override = designPrompts.section_image_prompts?.[section]?.positive
  if (!override || !override.trim()) return fallbackPrompt
  const bound = bindPalettePlaceholders(override, palette)
  if (section === 'problem') {
    return `${bound}\n\n${PROBLEM_SCENE_GUARD}\n${NO_TEXT_INSTRUCTION}`.trim()
  }
  // NEXFIT image_generation_agent.py:1536-1542 — 제품 등장 컷은 텍스트 보유 상품이면 인쇄 보존 규칙(_text_rule)
  return `${bound}\n\n${PRODUCT_CONSISTENCY_RULES}\n${textRuleFor(textBearing, NO_TEXT_INSTRUCTION)}`.trim()
}

/**
 * 텍스트 보유 상품(스티커·엽서·라벨) 잡인지 — NEXFIT image_generation_agent.py:1976-1981. 카테고리(분석 감지 →
 * 스펙 → household)와 상품명(스펙 이름 + 카피 mainIntro.title)으로 판정한다. 참이면 이미지 프롬프트의 NO_TEXT 일괄
 * 금지가 인쇄 디자인 보존 규칙으로 바뀐다(b90f6c0 A-3).
 */
export function isTextBearingJob(job: PdpJobRow): boolean {
  const category = job.analysis.detected_category || job.spec_sheet.category || 'household'
  const name = [job.spec_sheet.productName, job.copy_sections.final?.mainIntro?.title].filter(Boolean).join(' ')
  return isTextBearingProduct(category, name)
}

/** 카피로 만든 기본 컷 프롬프트(설계 프롬프트가 없을 때의 폴백) — 기본 5컷과 긴 상세페이지 사용 장면 컷이 쓴다. textBearing을 주면 그 판으로(J49 고민 컷) */
function basePromptsOf(job: PdpJobRow, textBearing = isTextBearingJob(job)) {
  const copy = job.copy_sections.final
  return buildImagePrompts({
    productName: job.spec_sheet.productName || copy?.mainIntro?.brandAndName || '제품',
    designPalette: { bgMain: copy?.designPalette?.bgMain },
    problemQuestion: copy?.problem?.question,
    solutionDeclaration: copy?.solution?.declaration,
    heroImageMode: job.spec_sheet.heroImageMode,
    category: job.analysis.detected_category || 'household',
    textBearing,
  })
}

/**
 * herotype 잡의 첫 화면 — 설계 콜 프롬프트는 예시가 스튜디오 고정이라 그대로 두고 블록만 붙이면 앞뒤가 부딪힌다. 실사용·착용이면 스튜디오 말이 없는 생활 기본 프롬프트로
 * 시작하고, 실패해 끝까지 내려가면 원래 프롬프트(studioPrompt)로 돌아간다
 */
function withHeroKind(task: ImageTask, job: PdpJobRow, palette: DesignPalette): ImageTask {
  // K 라인은 스위치와 상관없이 첫 화면 유형을 쓴다 — 첫 칸 구도가 이 값으로 배정돼 있다
  const wanted = hasEnrichmentFeature(job.analysis, 'herotype') || hasEnrichmentFeature(job.analysis, 'templatelib')
  if (task.section !== 'hero' || !wanted) return task
  // K 잡은 계획 기록의 첫 화면 유형을 쓴다 — 첫 칸 구도가 그 값으로 배정돼 있다. 기록이 없으면 K 규칙(lineHeroKindOf, 제품군 줄 포함 — 적용 K6 T1-80 ②)으로 고른다. D는 heroKindOf 그대로
  const line = hasEnrichmentFeature(job.analysis, 'templatelib')
  const recorded = line ? job.section_plan.templatelib?.hero?.kind : undefined
  const choice = recorded
    ? { kind: recorded }
    : (line ? lineHeroKindOf : heroKindOf)(job.spec_sheet, job.analysis.detected_category || job.spec_sheet.category || 'household', isTextBearingJob(job))
  if (choice.kind === 'studio') return { ...task, heroKind: choice.kind }
  const lifestyle = buildImagePrompts({
    productName: job.spec_sheet.productName || job.copy_sections.final?.mainIntro?.brandAndName || '제품',
    designPalette: { bgMain: palette.bgMain },
    heroImageMode: 'lifestyle',
    category: job.analysis.detected_category || 'household',
    textBearing: isTextBearingJob(job),
  }).hero.prompt
  return { ...task, prompt: lifestyle, studioPrompt: task.prompt, heroKind: choice.kind }
}

/**
 * 디자인 컷 계획이 그리는 컷마다 무대 이름(적용 D4 ⓐ, 기록만) — images 단계가 디자인 컷 계획과 함께 section_plan.designcut_stages로 기록한다.
 * 컷 생성과 같은 갈래(D2·scene 스위치·shotdiv 목적)로 고르고 프롬프트는 바꾸지 않는다. K 라인 잡과 계획 없는 잡은 빈 값이다
 */
export function designcutStagesOf(job: PdpJobRow): Record<string, DesigncutStage> {
  const plan = job.section_plan.designcut
  if (!plan || hasEnrichmentFeature(job.analysis, 'templatelib')) return {}
  const d2 = designcut2Enabled(job)
  const scene = hasEnrichmentFeature(job.analysis, 'scene')
  const extra = shotdivEnabled(job) ? readExtraShots(job.section_plan.extra_shots) : null
  return Object.fromEntries(
    [...designcutDrawnKeys(plan)].map((key) => [
      key,
      designcutStageOf(key, { d2, scene, chapter: d2PointChapterOf(plan, key), purpose: shotPurposeOf(extra, key)?.purpose ?? null }),
    ])
  )
}

/**
 * 해결 컷의 얼굴·표정 빼기(problemcut, 재분석 7절 C) — 고민 글 뒤 웃는 얼굴이 고민 사진처럼 읽혔다(P04·P09). 해결 컷 프롬프트 10/10에 표정 지시가 있다.
 * 표정 줄을 지우고 손과 상품 중심으로 바꾼다. 설계 프롬프트에도 사람이 나올 수 있어 마지막에 우선 블록을 붙인다
 */
export function solutionWithoutFace(prompt: string): string {
  const cleaned = prompt.replace(/^- Facial Expression:.*\r?\n?/m, '').replace(KOREAN_MODEL_INSTRUCTION, 'Any hand shown belongs to a Korean adult. Do NOT generate children, babies, or minors.')
  return `${cleaned}\n\nHANDS AND PRODUCT ONLY (this block wins over any person, mood or expression above): frame adult hands and the product at the moment of use. No face or head in the frame, no smile or other facial expression.`
}

function buildBaseTasks(job: PdpJobRow, designPrompts: DesignPrompts): ImageTask[] {
  const copy = job.copy_sections.final
  const palette = copy?.designPalette ?? {}
  const textBearing = isTextBearingJob(job)
  const built = basePromptsOf(job)
  return (['hero', 'problem', 'solution', 'usage', 'cta'] as const).map((section) =>
    withHeroKind(
      {
        section,
        prompt: ((prompt) => (section === 'solution' && problemcutEnabled(job) ? solutionWithoutFace(prompt) : prompt))(
          selectBaseSectionPrompt(section, designPrompts, palette, built[section].prompt, textBearing)
        ),
        aspectRatio: built[section].aspectRatio,
        effectOnly: EFFECT_ONLY_SECTIONS.has(section),
        skipGate: GATE_SKIP_SECTIONS.has(section),
      },
      job,
      palette
    )
  )
}

const FEATURE_CAP = 4
const HOWTO_CAP = 3
const USP_ICON_CAP = 4

/**
 * 긴 상세페이지 이미지 확장(L-2) — 설계 기록 section_plan.long.images(long·설득 플래너 잡, L-2 뒤 설계)만. L-1 기록만 있는 완료 잡은
 * 새 컷 때문에 images 단계로 돌아가지 않는다. 디자인 컷 잡에는 long이 기록되지 않는다
 */
const longImagesOf = (job: PdpJobRow) => longImagesRecorded(job.section_plan)

/** 디테일 근접(L-2) — long 기록이고 골격에 sub_div가 있으면 피처 컷 5·6번(특징 5·6번)을 매크로 컷으로 만든다(long-sections.ts) */
const longDetailOf = (job: PdpJobRow) => longImagesOf(job) && (job.section_plan.section_order ?? []).includes('sub_div')

const LONG_MACRO_SHOT =
  'SHOT (detail close-up): macro view of the exact part that shows this feature — material, mechanism or finish fills the frame, ' +
  'shallow depth of field; a closer, different view from the other feature cuts of this page.'

const LONG_SCENE_FOCUS = (tag: string, i: number, n: number) =>
  `SCENE FOCUS: ${tag} — show the product being used in this situation. Scene ${i + 1} of ${n}: a different place, time of day ` +
  'and framing from the other scene cuts and from the main usage cut of this page.'

/**
 * 사용 장면 모음(L-2) — 페이지에 아직 없는 사용 장면 태그마다 생활 컷 1장(정사각). 카피 기본 사용 컷 프롬프트의 카테고리 장면 줄은
 * 그 태그로, 3:4 비율 줄은 1:1로 바꾸고 장면 초점을 붙인다(세 장이 같은 본문에서 비슷해지지 않게)
 */
function buildLongSceneTasks(job: PdpJobRow): ImageTask[] {
  if (!longImagesOf(job)) return []
  const tags = longSceneTags(job.copy_sections.final?.usageSceneTags, job.section_plan.section_order ?? [])
  if (tags.length === 0) return []
  const usage = basePromptsOf(job).usage
  return tags.map((tag, i) => longSceneTask(usage.prompt, tag, i, tags.length))
}

const longSceneTask = (usagePrompt: string, tag: string, i: number, n: number): ImageTask => ({
  section: longSceneKey(i),
  prompt: `${usagePrompt.replace(/^- Scene: .*$/m, `- Scene: ${tag}`).replace(/^Aspect Ratio: 3:4$/m, 'Aspect Ratio: 1:1')}\n\n${LONG_SCENE_FOCUS(tag, i, n)}`,
  aspectRatio: '1:1',
  effectOnly: false,
  skipGate: false,
})

/**
 * 컷 목적 추가 컷(shotdiv, section_plan.extra_shots.shots) — 디자인 컷 계획이 T10 '자세히 보기' 막에 싣는 컷. POINT 피처 컷·사용 장면
 * 컷이 이미 만드는 키와 계획이 그리지 않는 키(막이 2장 미만이라 없을 때 등)는 건너뛴다 — 기존 섹션의 'features:*' 대체 키가 태스크
 * 필터를 열어 두어도 그리지 않을 컷을 만들지 않는다. 증명 컷(features:N)은 근거 글을 맥락으로 한 피처 컷 프롬프트를 정사각으로(막 안
 * 사진이 같은 비율), 사용 장면은 긴 상세페이지와 같은 장면 컷. 목적 지시는 생성 직전 디자인 컷 장면 블록 뒤에 붙는다(applyShotPurpose).
 * 단품 상품의 증명 컷은 끝에 '정확히 1개' 줄을 붙인다(적용 D5 P2 ①, single-unit) — 사용 장면 컷은 그대로다
 */
function buildExtraShotTasks(job: PdpJobRow, existing: ReadonlySet<string>, drawn: ReadonlySet<string>): ImageTask[] {
  const plan = shotdivEnabled(job) ? readExtraShots(job.section_plan.extra_shots) : null
  if (!plan) return []
  const copy = job.copy_sections.final
  const bgSub = copy?.designPalette?.bgSub || '#f8fafc'
  const category = job.analysis.detected_category || 'household'
  const textBearing = isTextBearingJob(job)
  const single = singleUnitSentence(job.spec_sheet)
  return plan.shots.flatMap((shot): ImageTask[] => {
    if (existing.has(shot.key) || !drawn.has(shot.key)) return []
    if (shot.purpose === 'scene') {
      const i = Number(shot.key.split(':')[1] ?? '0')
      return [longSceneTask(basePromptsOf(job).usage.prompt, shot.caption ?? '', i, plan.shots.filter((s) => s.purpose === 'scene').length)]
    }
    const entry = buildFeaturePrompt({
      featureTitle: shot.caption ?? '',
      featureDescription: proofTextOf(job, shot.proves) || (shot.caption ?? ''),
      bgSub,
      category,
      textBearing,
    })
    const square = entry.prompt.replace(/^- Aspect Ratio: 3:4$/m, '- Aspect Ratio: 1:1')
    const prompt = single ? `${square}\n\n${single}` : square
    return [{ section: shot.key, prompt, aspectRatio: '1:1', effectOnly: false, skipGate: false }]
  })
}

/** 근거 위치의 글 — detailPoints[j](주장·효익·근거)·spec.size·spec.material·spec.extraSpecs[j]. 모르면 빈 글 */
function proofTextOf(job: PdpJobRow, proves: string | undefined): string {
  const point = /^detailPoints\[(\d+)\]$/.exec(proves ?? '')
  if (point) {
    const p = job.copy_sections.final?.detailPoints?.[Number(point[1])]
    return [p?.claim, p?.benefit, p?.proof].filter(Boolean).join(' ')
  }
  const extra = /^spec\.extraSpecs\[(\d+)\]$/.exec(proves ?? '')
  if (extra) {
    const e = job.spec_sheet.extraSpecs?.[Number(extra[1])]
    return e ? `${e.key}: ${e.value}` : ''
  }
  if (proves === 'spec.size') return job.spec_sheet.size ?? ''
  if (proves === 'spec.material') return job.spec_sheet.material ?? ''
  return ''
}

/**
 * cap — 기본 4. D2(designcut2) 잡은 계획 POINT가 쓰는 만큼 6장까지(designcut-plan d2FeatureCutsOf), 긴 상세페이지 디테일 근접 잡은
 * 6장(5·6번은 매크로 지시를 붙인다 — macroFrom). matchPrompts(persuasion 기록 잡, 디자인 컷 포함)면 컷 i의 주제를 렌더가 그 컷을
 * 붙이는 특징으로 정하고 그 특징과 제목 낱말이 맞는 설계 항목만 쓴다(render-aware-cuts ①). sources에 컷마다 설계·카피 출처를 남긴다
 */
function buildFeatureTasks(
  job: PdpJobRow,
  designPrompts: DesignPrompts,
  cap: number,
  macroFrom = Infinity,
  opts: { matchPrompts?: boolean; sources?: Map<string, 'design' | 'copy'> } = {}
): ImageTask[] {
  const copy = job.copy_sections.final
  const points = (copy?.detailPoints ?? []).slice(0, cap)
  const bgSub = copy?.designPalette?.bgSub || '#f8fafc'
  const category = job.analysis.detected_category || 'household'
  const textBearing = isTextBearingJob(job)
  const subjects = opts.matchPrompts && copy ? featureSubjects(copy as unknown as CopywritingResult, cap) : null
  const entries: unknown[] = Array.isArray(designPrompts?.feature_prompts) ? designPrompts.feature_prompts : []
  const picks = subjects
    ? matchDesignEntries(subjects, entries.map((e) => String((e as { title?: unknown } | null)?.title ?? '')))
    : null
  return points.map((point, i) => {
    // 5·6번(D2만)은 카피 계약상 pointCards에 없는 새 관점이라 설계 단계(카피보다 먼저 돈다)의 같은 번호 프롬프트와 어긋나기 쉽다 —
    // 제목이 맞을 때만 설계 프롬프트, 아니면 카피 폴백(D2-1 검수). 1~4번은 예전 그대로(matchPrompts 잡은 위 맞춤)
    const fromDesign = picks
      ? picks[i] >= 0
        ? selectFeaturePrompt(designPrompts, picks[i], '')
        : null
      : selectFeaturePrompt(designPrompts, i < FEATURE_CAP ? i : -1, point.claim ?? '')
    const boundFromDesign = fromDesign ? bindPalettePlaceholders(fromDesign, copy?.designPalette) : null
    const card = subjects?.[i]?.from === 'card' ? subjects[i] : null
    const entry = boundFromDesign
      ? buildFeaturePromptFromDesign({ designPositive: boundFromDesign, bgSub, category, textBearing })
      : buildFeaturePrompt({
          featureTitle: card ? card.title : (point.claim ?? ''),
          featureDescription: card ? card.description : (point.benefit ?? point.proof ?? ''),
          bgSub,
          imageHint: card ? undefined : point.imageHint,
          category,
          textBearing,
        })
    opts.sources?.set(`features:${i}`, boundFromDesign ? 'design' : 'copy')
    const prompt = i >= macroFrom ? `${entry.prompt}\n\n${LONG_MACRO_SHOT}` : entry.prompt
    return { section: `features:${i}`, prompt, aspectRatio: entry.aspectRatio, effectOnly: false, skipGate: false }
  })
}

function buildHowtoTasks(job: PdpJobRow, designPrompts: DesignPrompts): ImageTask[] {
  const copy = job.copy_sections.final
  const steps = (copy?.howTo ?? []).slice(0, HOWTO_CAP)
  const category = job.analysis.detected_category || 'household'
  const textBearing = isTextBearingJob(job)
  return steps.map((step, i) => {
    const fromDesign = selectHowtoPrompt(designPrompts, i, step.step ?? '')
    const boundFromDesign = fromDesign ? bindPalettePlaceholders(fromDesign, copy?.designPalette) : null
    const entry = boundFromDesign
      ? buildHowtoPromptFromDesign({ designPositive: boundFromDesign, category, textBearing })
      : buildHowtoPrompt({ stepTitle: step.step ?? '', stepDescription: step.description ?? '', category, textBearing })
    return { section: `howto:${i}`, prompt: entry.prompt, aspectRatio: entry.aspectRatio, effectOnly: false, skipGate: false }
  })
}

function buildUspIconTasks(job: PdpJobRow): ImageTask[] {
  const cards = (job.copy_sections.final?.pointCards ?? []).slice(0, USP_ICON_CAP)
  return cards.map((card, i) => {
    const entry = buildUspIconPrompt(card.title || `포인트 ${i + 1}`)
    // 개정 5: 아이콘은 라이브러리 선택이 1순위(pdp-image-stage) — 미적중 폴백 생성도 저가 모델
    return { section: `usp_icons:${i}`, prompt: entry.prompt, aspectRatio: entry.aspectRatio, effectOnly: true, skipGate: true, ...lowCostCut(job) }
  })
}

/** 수량 옵션 묶음 연출 컷의 섹션 키 — 편집기 옵션 섹션(optionGallery quantity_cards)이 generated_images에서 이 키로 찾는다 */
export const OPTION_BUNDLE_SECTION = 'option_bundle'

/**
 * 수량 묶음 컷이 필요한지(05_OPTIONS.md §4 이미지 단계) — 등록 옵션 구조가 수량 축만으로 나뉠 때(형태 축 없음) 1장.
 * 디자인·색상 옵션은 실물 사진을 그대로 쓰므로 생성하지 않는다. options 기록이 없는 잡은 기존 그대로다.
 * 골격에 옵션 섹션(petit_div)이 없으면(플래너가 돌지 않은 잡 등) 쓰일 곳이 없으므로 만들지 않는다.
 */
export function needsOptionBundleCut(job: PdpJobRow): boolean {
  if (!(job.section_plan?.activated_sections ?? []).includes('petit_div')) return false
  const spec = optionSpecOf(job.spec_sheet, job.analysis)
  return spec !== null && primaryFormAxis(spec) === null && spec.axes.some((a) => a.kind === 'quantity')
}

function buildConditionalTasks(job: PdpJobRow): ImageTask[] {
  const tasks: ImageTask[] = []
  const specSheet = job.spec_sheet
  const copy = job.copy_sections.final
  if (specSheet.size?.trim()) {
    // 개정 5(오너 검수 피드백 2026-08-11): 비교대상 합성 폐기 — 제품 단독 + 치수 화살표
    const entry = buildSizeComparisonPrompt({
      productName: specSheet.productName || '제품',
      bgMain: copy?.designPalette?.bgMain,
      sizeText: specSheet.size,
      textBearing: isTextBearingJob(job),
    })
    tasks.push({ section: 'size_comparison', prompt: entry.prompt, aspectRatio: entry.aspectRatio, effectOnly: false, skipGate: false })
  }
  if ((specSheet.soldOutCount ?? 0) > 0) {
    const entry = buildSoldOutBannerPrompt(copy?.designPalette)
    tasks.push({ section: 'sold_out_banner', prompt: entry.prompt, aspectRatio: entry.aspectRatio, effectOnly: true, skipGate: true })
  }
  if (needsOptionBundleCut(job)) {
    const entry = buildOptionBundlePrompt({
      productName: specSheet.productName || '제품',
      bgMain: copy?.designPalette?.bgMain,
      textBearing: isTextBearingJob(job),
    })
    tasks.push({ section: OPTION_BUNDLE_SECTION, prompt: entry.prompt, aspectRatio: entry.aspectRatio, effectOnly: false, skipGate: false })
  }
  // 사이즈 단독 컷(D2 잡만, 계획과 같은 조건) — 계획이 그리지 않으면(치수를 못 읽은 상품) 아래 디자인 컷 필터가 뺀다
  if (designcut2Enabled(job) && hasEnrichmentFeature(job.analysis, 'sizecut') && specSheet.size?.trim()) {
    const prompt = buildSizeSinglePrompt({ productName: specSheet.productName || '제품', size: specSheet.size, bgMain: copy?.designPalette?.bgMain })
    tasks.push({ section: SIZE_SINGLE_SECTION, prompt, aspectRatio: '3:4', effectOnly: false, skipGate: false })
  }
  return tasks
}

// PRO_IMAGE_PROMPTS는 이미 conversion_cta 제외 10종만 담고 있다(cta 재사용 — pdp-image-pro-prompts.ts 헤더 주석)
const PRO_TYPES = Object.keys(PRO_IMAGE_PROMPTS) as ProImageType[]

function buildProSlots(job: PdpJobRow, designPrompts: DesignPrompts): ProImagePromptSlots {
  const copy = job.copy_sections.final
  const palette = copy?.designPalette ?? {}
  const productName = copy?.mainIntro?.brandAndName || job.spec_sheet.productName || '제품'
  const category = job.analysis.detected_category || job.spec_sheet.category || ''
  const material = job.spec_sheet.material || ''
  const productContext = [category, material].filter(Boolean).join(', ') || productName
  return {
    productName,
    problemContext: copy?.problem?.question ?? '',
    productContext,
    keyBenefit: copy?.solution?.declaration ?? '',
    brandMood: bindPalettePlaceholders(designPrompts.composition_notes || '프리미엄하고 세련된', palette),
    paletteColors: `${palette.primary ?? ''}, ${palette.secondary ?? ''}`,
    paletteDescription: `color palette of ${palette.primary ?? '#8B6914'} and ${palette.secondary ?? '#D4A017'} with ${palette.bgMain ?? '#FAF7F2'} background`,
  }
}

/**
 * Pro 컷 공통 접미사 — NEXFIT image_generation_agent.py:1989-2002(V4.4/V4.5) "이중 반영" 중
 * ②(개별 컷 접미사) 담당. ①(전 컷 공통 Style Charter 내 `photographyNote` 라인)은
 * pdp-image-stage.ts의 buildStyleCharterForJob이 이미 반영한다 — 원본이 의도적으로 photography_note를
 * 두 지점에 싣는 것과 동일하게, 여기서도 별도로 다시 싣는다(중복이 아니라 원본 설계).
 *
 * 원본은 `image_quality=="pro"`(NEXFIT PlanTier 개념)일 때만 스타일 디렉티브를 붙였으나, NexOps의
 * image_quality는 완전히 다른 축(high/medium 생성 품질)이라 그 게이트가 대응되지 않는다 — 그래서
 * "imagePhotoStyle이 설정돼 있으면(Pro 모드 진입 자체가 전제) 항상 적용"으로 단순화한다(편차 명시).
 */
function buildProPhotoStyleSuffix(specSheet: PdpJobRow['spec_sheet']): string {
  const styleDirective = getProPhotoStyleDirective(specSheet.imagePhotoStyle)
  const noteLine = specSheet.photographyNote?.trim() ? `User composition direction: ${specSheet.photographyNote.trim()}` : ''
  return [styleDirective, noteLine].filter(Boolean).join(' ')
}

function buildProTasks(job: PdpJobRow, designPrompts: DesignPrompts): ImageTask[] {
  const specSheet = job.spec_sheet
  const slots = buildProSlots(job, designPrompts)
  const photoStyleSuffix = buildProPhotoStyleSuffix(specSheet)
  const textBearing = isTextBearingJob(job)
  const tasks: ImageTask[] = []
  for (const type of PRO_TYPES) {
    if (type === 'certification_badge' && !specSheet.certificationInfo) continue
    if (type === 'event_banner' && !specSheet.eventBannerInfo) continue
    const effectOnly = EFFECT_ONLY_SECTIONS.has(type)
    const withRules: ProImagePromptSlots = {
      ...slots,
      productConsistencyRules: effectOnly ? '' : PRODUCT_CONSISTENCY_RULES,
    }
    let prompt: string
    if (type === 'certification_badge') prompt = buildCertificationBadgePrompt(specSheet.certificationInfo || '')
    else if (type === 'event_banner') prompt = buildEventBannerPrompt(specSheet.eventBannerInfo || '')
    else if (type === 'empathy_scene') prompt = buildEmpathySceneProPrompt(withRules, PROBLEM_SCENE_GUARD)
    else prompt = buildProImagePrompt(type, withRules)

    // NEXFIT image_generation_agent.py:1249-1282 — 스타일 접미사는 전 Pro 컷 공통(그래픽/추상 컷 포함),
    // 포토그래피 프리셋·인체 안티아티팩트 규칙은 그래픽/추상 컷(GATE_SKIP_SECTIONS === _GRAPHIC_TYPES) 제외.
    if (photoStyleSuffix) prompt = `${prompt} ${photoStyleSuffix}`
    if (!GATE_SKIP_SECTIONS.has(type)) {
      const presetKey = PRO_PHOTO_PRESET_MAP[type]
      if (presetKey) prompt = `${prompt}\n${getPhotographyContext(presetKey)}`
      prompt = `${prompt}\n${getPhotographyBase(textBearing)}`
      if (PRO_HUMAN_SUBJECT_TYPES.has(type)) prompt = `${prompt}\n${HUMAN_SUBJECT_QUALITY_RULES}`
      // NEXFIT image_generation_agent.py:1236-1237 — 텍스트 보유 상품은 박힌 텍스트 금지를 인쇄 보존 지시로 교체
      prompt = applyTextPolicy(prompt, textBearing)
    }

    // NEXFIT image_generation_agent.py:1017-1023 _generate_pro_single → _generate_with_reference("3:4", ...) 고정
    tasks.push({ section: type, prompt, aspectRatio: '3:4', effectOnly, skipGate: GATE_SKIP_SECTIONS.has(type), ...(LOW_COST_SECTIONS.has(type) ? lowCostCut(job) : {}) })
  }
  return tasks
}

/**
 * 제품 컷 스타일 헌장의 광원(NEXFIT _build_style_charter :295-378) — 방향·그림자 각도·색온도. 스타일 헌장(pdp-image-stage
 * buildStyleCharterForJob)과 디자인 컷 플레이트가 같은 값을 쓴다(플레이트에도 컷과 같은 빛, 2026-10-28).
 */
export function styleLightingOf(job: PdpJobRow): { direction: string; shadowAngle: number; temperature: string } {
  const lighting = (job.design_prompts.lighting_params ?? {}) as Record<string, unknown>
  const direction = typeof lighting.direction === 'string' ? lighting.direction : 'top-left'
  const shadowAngle = typeof lighting.shadow_angle === 'number' ? lighting.shadow_angle : 45
  const colorTemp = typeof lighting.color_temperature === 'string' ? lighting.color_temperature : 'warm'
  const category = job.analysis.detected_category || job.spec_sheet.category || 'household'
  const catLighting = getCategoryDirective(category, 'lighting_override')
  const temperature =
    catLighting ||
    (colorTemp === 'warm' ? 'warm (~5200K)' : colorTemp === 'cool' ? 'cool-neutral (~5600K)' : `${colorTemp} (5500K daylight balanced)`)
  return { direction, shadowAngle, temperature }
}

/**
 * 디자인 컷 배경 플레이트(D1, 08_DESIGN_CUTS.md §2) — designcut 기록 잡만. 글자·제품 없는 무대라 참조 사진 없이(effectOnly)
 * 게이트 없이(skipGate) 만든다. 키는 `plate:<섹션키>`, 비율은 정사각(1:1) 또는 세로(2:3 — 생성 크기 힌트 '3:4' = 1024×1536).
 * 계획은 images 단계가 기록한 section_plan.designcut을 우선하고, 기록 전이면 같은 결정론 계획을 다시 계산한다.
 */
function buildPlateTasks(job: PdpJobRow): ImageTask[] {
  const plan = job.section_plan.designcut ?? buildDesigncutPlan(job)
  if (!plan) return []
  const lighting = styleLightingOf(job)
  return plan.sections
    .filter((sec) => sec.plateKey && sec.plateAspect)
    .map((sec) => ({
      section: sec.plateKey!,
      prompt: buildPlatePrompt({
        template: sec.template as PlateTemplate,
        palette: plan.palette,
        category: job.analysis.detected_category,
        chapter: sec.chapter,
        productAlpha: sec.productAlpha,
        lighting,
      }),
      aspectRatio: sec.plateAspect === '1:1' ? '1:1' : '3:4',
      effectOnly: true,
      skipGate: true,
    }))
}

/**
 * 디자인 컷 잡의 제품 컷 배경 — 카피 팔레트 bgMain·bgSub 대신 계획의 컷 바탕(cutBackgroundOf: 사진 촬영 배경, 없으면 tint).
 * 편집기가 같은 색으로 상품 섹션을 칠해 컷이 다른 색 사각형으로 뜨지 않는다(D P02: 분홍 섹션 위 크림 #FDF8F2 컷). 제품 컷 프롬프트와
 * 스타일 헌장(pdp-image-stage)이 이 잡 보기를 쓴다. 디자인 컷이 아닌 잡은 그대로 돌려준다.
 */
export function withDesigncutCutBackground(job: PdpJobRow): PdpJobRow {
  const copy = job.copy_sections.final
  const plan = copy ? (job.section_plan.designcut ?? buildDesigncutPlan(job)) : null
  if (!copy || !plan) return job
  // K 라인은 템플릿 색으로 칠하므로 그 사진 바탕 칸을 쓴다
  const bg = plan.templateColors?.photo ?? cutBackgroundOf(plan.palette)
  return {
    ...job,
    copy_sections: { ...job.copy_sections, final: { ...copy, designPalette: { ...copy.designPalette, bgMain: bg, bgSub: bg } } },
  }
}

/**
 * 잡 상태(spec_sheet·mode·analysis·copy_sections.final·design_prompts) 기준 전 이미지 태스크 목록을
 * 순서대로 조립한다 — hero가 항상 첫 항목(이후 컷의 style_ref로 쓰인다, pdp-image-stage.ts 소관).
 * copy_sections.final이 아직 없으면(카피 단계 미완료) 빈 배열 — 파이프라인 전이 규칙이 이 단계 진입을
 * 카피 완료 이후로 보장하므로 방어적 반환일 뿐이다.
 */
export function buildImageTasks(original: PdpJobRow): ImageTask[] {
  return buildTasks(original, { lean: true }).tasks
}

/**
 * buildImageTasks와 같은 목록 + 원장·로그용 집계(피처 컷의 설계·카피 출처 수, 렌더가 그리지 않아 안 만든 컷 — render-aware-cuts)
 */
export function buildImageTaskPlan(original: PdpJobRow): { tasks: ImageTask[]; report: CutPlanReport } {
  return buildTasks(original, { lean: true })
}

/**
 * 이 잡이 만들 수 있는 이미지 태스크 전체 — 안 쓰는 컷 빼기(lean) 전. 편집기 사후 재생성(W5b)이 골격 밖이어도 아는 섹션 키를
 * 받을 때 쓴다(프롬프트·모델·디자인 컷 필터·옵션 사진 가드는 같다). lean이 아닌 잡은 buildImageTasks와 같다
 */
export function buildKnownImageTasks(original: PdpJobRow): ImageTask[] {
  return buildTasks(original, { lean: false }).tasks
}

/** 쓰는 법 재료(usefacts 잡, 결정 카드 c02) — 사용·착용 대표 컷도 손·착용 컷처럼 쓰는 법 줄을 받는다. 꺼진 잡·스튜디오 대표 컷은 false */
function heroUseCut(job: PdpJobRow): boolean {
  const kind = job.section_plan.templatelib?.hero?.kind
  return Boolean(kind && kind !== 'studio') && hasEnrichmentFeature(job.analysis, 'usefacts')
}

/**
 * 첫 화면 대표 칸(움직이는 칸 자리 규칙 ①, motionband 잡의 계획 기록 templatelib.motion.hero만) — 정지 대표 컷 바로 뒤 태스크.
 * 대표 컷과 같은 프롬프트·비율로 정지 대표 컷에서 시작하는 움직이는 WebP를 만들고, 포스터는 정지 대표 컷 그대로다(새 정지 컷을 만들지 않는다).
 * 일반 게이트는 보지 않는다(프레임 모음 검사 + 첫 프레임 검사). 기록이 없는 잡은 빈 목록이라 태스크가 바이트 그대로다
 */
function heroMotionTasks(job: PdpJobRow, hero: ImageTask | undefined): ImageTask[] {
  const motion = hero ? heroMotionTaskOf(job, hero.aspectRatio) : undefined
  if (!hero || !motion) return []
  // 대표 컷이 쓰는 법 줄을 받으면(usefacts 잡의 사용·착용 대표 컷) 대표 칸도 Use 줄을 받는다 — 바르게 쓰기 문장은 GIF 지시가 담는다
  return [
    {
      section: HERO_MOTION_SECTION,
      prompt: hero.prompt,
      ...(hero.shotBrief ? { shotBrief: hero.shotBrief } : {}),
      aspectRatio: hero.aspectRatio,
      effectOnly: false,
      skipGate: true,
      motion,
      ...(hero.useCut ? { useCut: true as const } : {}),
    },
  ]
}

/** K 컷 — 기존 프롬프트 위에 컷 지시를 얹는다. 키는 계획이 정했고, 비율은 크기 인자로 보낸다 */
function buildLineShotTasks(job: PdpJobRow, shots: readonly LineShot[]): ImageTask[] {
  const bgSub = job.copy_sections.final?.designPalette?.bgSub || '#f8fafc'
  const category = job.analysis.detected_category || 'household'
  const textBearing = isTextBearingJob(job)
  const built = basePromptsOf(job)
  // 상품 없는 고민 컷(J49 decide 24) — 인쇄 상품이어도 인쇄 보존('참조대로 인쇄 재현') 대신 일반 글자 금지 판. 인쇄 상품이 아니면 같은 글이다
  const problemBase = textBearing ? basePromptsOf(job, false).problem.prompt : built.problem.prompt
  // 수량 컷의 수(적용 K6 R-B7) — 구성 칸 그대로, 없으면 옵션 수량 가운데 가장 큰 수 이하
  const quantity = shotQuantityOf(job.spec_sheet)
  // 제품군 문장(적용 K6 T1-80 ①) — 계획 기록의 제품군, 재료 이름은 입력에 적힌 것만(성분 칸과 같은 규제 표현 거르기)
  const family = job.section_plan.templatelib?.productFamily
  const ingredients = namedIngredientsOf(job.spec_sheet).filter((name) => isFactClaimSafe(name, job.spec_sheet.certificationInfo))
  // 사진 다양화(shotvary 기록 잡) — 계획이 거리·사람 박자를 정한 컷은 사용 기본 프롬프트의 고정 장면·표정·렌즈 줄을 빼고(F2), 대표 컷 참조 안내를 덧붙인다(F4)
  const vary = shotvaryEnabled(job)
  const varied = (shot: LineShot) => vary && Boolean(shot.camera)
  const usageOf = (shot: LineShot) => (varied(shot) ? withoutFixedScene(built.usage.prompt) : built.usage.prompt)
  // 체감 결과 한 장면(effectshot 기록 잡만, J53) — 기능·사용 컷 지시에 한 문장. 꺼진 잡은 컷 지시가 바이트 그대로다
  const effectShot = hasEnrichmentFeature(job.analysis, 'effectshot')
  // 고민 실물 컷(problemobject 기록 잡만, J56) — 고민 섹션 problem 컷은 얼굴 줄·SCENE FOCUS 가드를 뺀 고민 프롬프트 + 낡은 일반 물건 Purpose. 꺼진 잡은 바이트 그대로다
  const problemObjects = hasEnrichmentFeature(job.analysis, 'problemobject')
  const wornHero = job.section_plan.templatelib?.hero?.kind === 'worn'
  // 보여 줄 동작·설계(showbeat 기록 잡만, J63) — 섹션마다 손·사용 컷 하나의 Purpose 끝 한 문장 + Person 단계 '쓰는 중', 움직이는 칸 동작 문구.
  // 사실 글이 없거나 낱말이 안 맞으면 빈 표라 지시가 그대로다. 꺼진 잡은 컷 지시·움직이는 칸이 바이트 그대로다
  const beatFacts = hasEnrichmentFeature(job.analysis, 'showbeat') ? showBeatFactsOfJob(job) : null
  const beatCuts = beatFacts ? showBeatCutsOf(shots, beatFacts) : new Map<string, ShowBeat>()
  return shots.map((shot) => {
    // 치수 칸 — 제품 하나·단색 바탕 컷이어야 경계를 재 선을 긋는다(D 사이즈 단독 컷과 같은 프롬프트). 칸 비율은 크기 인자로 보낸다
    if (shot.sizeCut && job.spec_sheet.size?.trim()) {
      const prompt = buildSizeSinglePrompt({ productName: job.spec_sheet.productName || '제품', size: job.spec_sheet.size, bgMain: job.copy_sections.final?.designPalette?.bgMain })
      return { section: shot.key, prompt: prompt.replace(/^(- )?Aspect Ratio: .*(\r?\n|$)/gm, ''), aspectRatio: shot.aspect, effectOnly: false, skipGate: false, measuresProduct: true }
    }
    const route = shotRouteOf(shot.purpose)
    const motion = withShowBeat(motionTaskOf(job, shot, textBearing), beatFacts ? showBeatOf(shot.show, beatFacts) : null, shot.show)
    const beat = beatCuts.get(shot.key)
    const briefShot: LineShot = beat && shot.person && shot.person.beat !== 'during' ? { ...shot, person: { ...shot.person, beat: 'during' } } : shot
    const prompt =
      route.base === 'feature'
        ? buildFeaturePrompt({ featureTitle: shot.show, featureDescription: shot.show, bgSub, category, textBearing }).prompt
        : route.base === 'problem'
          ? isPetProblem(shot.purpose, category) || isProblemObjectCut(shot, problemObjects)
            ? withoutFaceFocus(problemBase)
            : problemBase
          : isHandsOnly(shot)
            ? solutionWithoutFace(usageOf(shot))
            : usageOf(shot)
    return {
      section: shot.key,
      prompt: prompt.replace(/^(- )?Aspect Ratio: .*(\r?\n|$)/gm, ''),
      aspectRatio: shot.aspect,
      effectOnly: route.effectOnly,
      // 고민 컷도 기존 고민 컷처럼 게이트를 건너뛰지 않는다 — 그래야 첫 화면 컷을 빛·색 참조로 받는다
      skipGate: false,
      shotBrief: buildShotBrief(briefShot, {
        size: job.spec_sheet.size,
        category,
        quantity,
        family,
        ingredients,
        ...(effectShot ? { effectShot } : {}),
        ...(isProblemObjectCut(shot, problemObjects) ? { problemObject: true } : {}),
        ...(beat ? { showBeat: showBeatLine(beat) } : {}),
      }),
      ...(beat ? { showBeatLine: showBeatLine(beat), showBeatSource: beat.source } : {}),
      ...(usesSetBackground(shot) ? { sceneAs: 'usage' } : {}),
      ...(isStagedCut(shot) ? { stagedGate: true } : {}),
      // GIF 칸 — 꺼진 잡·다른 컷은 값이 없어 태스크가 바이트 그대로다
      ...(motion ? { motion } : {}),
      ...(varied(shot) ? { varyRefs: varyRefsOf(shot.person) } : {}),
      // 점검 고침 1·3 게이트 표지 — 착용 컷은 재생성 뒤 재판정, 사람·손이 쓰는 컷은 사용 판정
      ...(shot.composition === 'worn' || (wornHero && varied(shot) && varyRefsOf(shot.person) === 'person') ? { wornCut: true as const } : {}),
      ...(route.base === 'usage' && shot.person?.framing !== 'nobody' ? { useGate: true as const } : {}),
      // 손·착용·사용 컷 — 실물 쓰는 법 줄(점검 고침 3). 다른 구도·D·R 잡은 값이 없어 태스크가 바이트 그대로다.
      // 상품 없는 고민 컷(J49, route.effectOnly)은 사용 구도여도 붙이지 않는다(J61, 스위치 없음) — 쓰는 법 줄이 우리 상품의 손잡이·면·구조를 적어
      // '상품 없는 컷'·'이 상품이 아닌 물건'이 우리 상품을 닮는다(J59 켬 P03 k2_left in_use)
      ...(HANDLED.has(shot.composition) && !route.effectOnly ? { useCut: true as const } : {}),
      // 상품 없는 컷(목적 problem — effectOnly 경로는 problem뿐, J49) — 감독 줄·학부모 블록·게이트가 상품을 부르지 않게
      ...(route.effectOnly ? { noProductCut: true as const } : {}),
    }
  })
}

function buildTasks(original: PdpJobRow, opts: { lean: boolean }): { tasks: ImageTask[]; report: CutPlanReport } {
  if (!original.copy_sections.final) return { tasks: [], report: { design: 0, copy: 0, skipped: [] } }
  const job = withDesigncutCutBackground(original)
  const designPrompts = job.design_prompts
  // K 라인(기록이 있는 잡만) — 대표 컷 + 계획이 적은 컷만 만든다. 기존 컷 필터를 지나지 않는다
  const lineShots = job.section_plan.templatelib?.shots
  if (lineShots) {
    // 첫 칸이 사진 위 글이면 대표 컷도 글 자리를 비운다. 글자 자리 측정·재생성(copyZoneCut)은 열지 않는다 — 위 33%만 재고 미달이면 비용을 더 쓴다
    // 대표 컷도 실물 크기 줄을 싣는다(K4 오너 지적 11-05) — 치수가 없으면 지금과 같다
    const heroAnchor = job.section_plan.templatelib?.hero?.overlayAnchor
    const realSize = job.spec_sheet.size?.trim()
    // 후킹 약속 ↔ 대표 컷(hookhero 잡만, 기본 off — c09·J21) — 계획에 남긴 첫 화면 headline을 컷 지시 끝에 참고로만 붙인다. 꺼진 잡은 지시가 그대로다
    const heroHook = hasEnrichmentFeature(job.analysis, 'hookhero') ? job.section_plan.templatelib?.hero?.hook : undefined
    const heroBrief = heroAnchor ? buildFrameBrief(heroAnchor, realSize) : heroLargeBrief(realSize)
    const hero = buildBaseTasks(job, designPrompts)
      .filter((task) => task.section === 'hero')
      .map((task) => ({
        ...task,
        shotBrief: heroHook ? `${heroBrief}\n${heroPromiseLine(heroHook)}` : heroBrief,
        // 사람 대표 컷(쓰는 장면·착용)은 사용 판정을 받는다(점검 고침 3)
        ...(job.section_plan.templatelib?.hero?.kind && job.section_plan.templatelib.hero.kind !== 'studio' ? { useGate: true as const } : {}),
        // 사용·착용 대표 컷의 쓰는 법 줄(usefacts 잡만, 결정 카드 c02)
        ...(heroUseCut(job) ? { useCut: true as const } : {}),
      }))
    // K 라인 게이트(실물 크기 11-05) — 같은 게이트 콜에 구멍·빗살 배열과 크기 칸을 더한다(추가 호출 없음)
    const lineGate = realSize ? { realSize } : {}
    const tasks = [...hero, ...heroMotionTasks(job, hero[0]), ...buildLineShotTasks(job, lineShots)].map((task) => ({ ...task, lineGate }))
    return { tasks: withOptionPhotoGuard(job, tasks), report: { design: 0, copy: 0, skipped: [] } }
  }
  // 디자인 컷 계획(기록, 없으면 결정론으로 다시) — D2 피처 컷 장 수와 아래 태스크 필터가 쓴다
  const plan = job.section_plan.designcut ?? buildDesigncutPlan(job)
  const longDetail = longDetailOf(job)
  // ① 피처 프롬프트 맞춤은 디자인 컷 잡에도(POINT가 features:i를 쓴다), ② 렌더 인지 컷 빼기는 디자인 컷이 아닌 잡만(아래)
  const renderAware = renderAwareJob(job, Boolean(plan))
  const sources = new Map<string, 'design' | 'copy'>()
  const featureOpts = { matchPrompts: featurePromptMatchJob(job), sources }
  const tasks = [
    ...buildBaseTasks(job, designPrompts),
    ...(designcut2Enabled(job)
      ? buildFeatureTasks(job, designPrompts, d2FeatureCutsOf(plan), Infinity, featureOpts)
      : longDetail
        ? buildFeatureTasks(job, designPrompts, LONG_DETAIL_FEATURE_CAP, FEATURE_CAP, featureOpts)
        : buildFeatureTasks(job, designPrompts, FEATURE_CAP, Infinity, featureOpts)),
    ...buildHowtoTasks(job, designPrompts),
    ...buildUspIconTasks(job),
    ...buildConditionalTasks(job),
    ...buildLongSceneTasks(job),
  ]
  if (job.mode === 'pro') tasks.push(...buildProTasks(job, designPrompts))
  tasks.push(...buildPlateTasks(job))
  tasks.push(...buildExtraShotTasks(job, new Set(tasks.map((t) => t.section)), designcutDrawnKeys(plan)))
  // 디자인 컷 잡: 계획이 그리는 키 + 대체·kept 기존 섹션이 쓰는 키만 만든다(같은 컷 한 번 — designcut-images.ts)
  const needed = plan ? designcutTaskFilter(plan) : null
  if (needed) tasks.splice(0, tasks.length, ...tasks.filter((t) => needed(t.section)))
  // 안 쓰는 컷 빼기(W5) — lean 기록 잡만, 디자인 컷 잡은 위 필터가 이미 같은 일을 한다. 골격이 쓸 키·hero·여분 풀만 만들고,
  // 모르는 섹션 키가 있으면 거르지 않는다(section-task-filter)
  // 편집기는 activated_sections로 렌더하므로 section_order와 합쳐 본다(설득 플래너 골격은 둘이 같다)
  const lean =
    opts.lean && !plan && readJobEnrichment(job.analysis)?.features.includes('lean')
      ? sectionTaskFilter([
          ...new Set([...(job.section_plan.section_order ?? []), ...(job.section_plan.activated_sections ?? [])]),
        ])
      : null
  // 긴 상세페이지 사용 장면 컷은 골격 밖 확장 섹션 몫이라 골격 매핑에 없다 — 남긴다(L-2)
  if (lean) tasks.splice(0, tasks.length, ...tasks.filter((t) => lean(t.section) || t.section.startsWith('long_scene:')))
  // 렌더가 그리지 않을 피처·사용 장면 컷 빼기(render-aware-cuts ②) — lean 기록 중복 정리 잡만. 편집기 사후 재생성 목록(buildKnownImageTasks)은
  // 그대로 둔다. 나머지 후보 컷이 모두 성공했다고 보고 편집기와 같은 중복 정리 계획을 세운다
  const skipped: string[] = []
  if (lean && renderAware) {
    const sceneTags = longImagesOf(job)
      ? longSceneTags(job.copy_sections.final?.usageSceneTags, job.section_plan.section_order ?? [])
      : []
    const drawn = selectRenderedCuts(job, tasks.map((t) => t.section), sceneTags, toGeneratedImagesMap)
    const keepCut = (s: string) =>
      s.startsWith('features:') ? drawn.features.has(s) : s.startsWith('long_scene:') ? drawn.scenes.has(s) : true
    skipped.push(...tasks.filter((t) => !keepCut(t.section)).map((t) => t.section))
    tasks.splice(0, tasks.length, ...tasks.filter((t) => keepCut(t.section)))
  }
  const kept = tasks.filter((t) => sources.has(t.section)).map((t) => sources.get(t.section))
  const report: CutPlanReport = {
    design: kept.filter((s) => s === 'design').length,
    copy: kept.filter((s) => s === 'copy').length,
    skipped,
  }
  return { tasks: withOptionPhotoGuard(job, tasks), report }
}

/**
 * 사진 없는 옵션을 지어내지 않게(R2-1 예비 — 원천은 디자인 프롬프트 입력, pdp-design-agent.ts). 제품이 나오는 컷만:
 * 사진 없는 옵션 이름을 지우고 긍정문 규칙을 붙인다. 옵션 기록이 없는 잡(Track S·대조군)은 그대로.
 * K 컷(적용 K6 ③)도 같은 문장·조건이다 — 컷 지시(shotBrief, Show 줄에 카피 글이 든다)의 이름도 같은 함수로 지운다. 컷 지시가 없는 D 태스크는 전과 같다
 */
function withOptionPhotoGuard(job: PdpJobRow, tasks: ImageTask[]): ImageTask[] {
  const coverage = optionPhotoCoverage(optionSpecOf(job.spec_sheet, job.analysis))
  if (!coverage) return tasks
  const guard = optionPhotoGuard(coverage)
  const keep = photographedNames(coverage)
  const strip = (text: string) => stripOptionMentions(text, coverage.unphotographed, keep)
  return tasks.map((t) =>
    t.effectOnly ? t : { ...t, prompt: `${strip(t.prompt)}\n${guard}`, ...(t.shotBrief ? { shotBrief: strip(t.shotBrief) } : {}) }
  )
}

/** 디자인 컷 배경 플레이트 태스크인가 — 플레이트 전용 프롬프트 조립(pdp-image-stage)에 쓴다 */
export function isPlateTask(task: { section: string }): boolean {
  return task.section.startsWith('plate:')
}

/**
 * 섹션 생성이 끝났는지 — url이 있거나, 재시도 대기(retryPending)가 아닌 실패일 때. 첫 생성 실패는 retryPending으로
 * 남아 다음 run에서 한 번 더 시도한다(썸네일 RETRY_BUDGET 방식, 섹션당 1회). 표지가 없는 error(재시도까지 실패,
 * 이 표지 이전에 만들어진 잡)는 끝난 것으로 본다 — 배포 전 잡·완료 잡의 판정은 바뀌지 않는다.
 * images 단계 진입 판정(resolveStepToRun)·run 완료 판정·전량 실패 판정이 모두 이 기준을 쓴다.
 */
export function isSectionSettled(entry: SectionImage | undefined): boolean {
  if (!entry) return false
  return Boolean(entry.url) || (Boolean(entry.error) && !entry.retryPending)
}

/** 이미지 공급자 잔액 부족으로 멈춘 이미지 단계 오류의 앞머리(R12c) — 잡 오류·시험 하네스가 같은 말로 찾는다 */
export const PDP_PROVIDER_BALANCE_STEP_ERROR = `${IMAGE_PROVIDER_BALANCE_LABEL} — 충전 뒤 다시 시도`

/**
 * 잡이 이미지 공급자 잔액 부족으로 멈췄는가(R12c) — 이미지 단계 오류 글, 또는 잔액 부족으로 보류한 컷(providerBlocked + retryPending).
 * 멈췄으면 사유 한 줄, 아니면 null. 시험 하네스는 이것이 한 번이라도 나오면 잡을 멈춘다(충전 전에는 다시 돌려도 같은 실패)
 */
export function providerBalanceHaltOf(job: Pick<PdpJobRow, 'error' | 'section_images'>): string | null {
  if (job.error?.includes(PDP_PROVIDER_BALANCE_STEP_ERROR)) return job.error
  const held = job.section_images.filter((e) => e.providerBlocked === 'balance' && e.retryPending)
  return held.length > 0 ? `${PDP_PROVIDER_BALANCE_STEP_ERROR} — 보류 컷 ${held.length}개(${held.map((e) => e.section).join(', ')})` : null
}

/**
 * 게이트 대기(gatePending) — 생성 뒤 run 시간이 모자라 판정하지 못한 컷. 다음 run 맨 앞에서 게이트를 본다. 재생성 대기(편집기 요청)가
 * 함께 있으면 그 일이 새 컷을 게이트에 거치므로 여기서는 세지 않는다. images 단계 진입 판정(resolveStepToRun)·run 완료 판정이 쓴다
 */
export function isGatePending(entry: SectionImage): boolean {
  return Boolean(entry.gatePending && entry.url && !entry.pendingRegen)
}

/**
 * 전 태스크가 끝났고(isSectionSettled) 단 한 장도 성공하지 못했는지 판정 — images 단계 전량 실패 시
 * compose로 잘못 전진하지 않도록 pdp-image-stage.ts가 이 신호로 currentStep='failed'를 택한다(§6.4).
 * 순수 함수라 DB·LLM 모킹 없이 단위 테스트 가능(pdp-pipeline.test.ts).
 */
export function allImageTasksFailed(tasks: ImageTask[], sectionImages: SectionImage[]): boolean {
  if (tasks.length === 0) return false
  const allAttempted = tasks.every((t) => isSectionSettled(sectionImages.find((e) => e.section === t.section)))
  if (!allAttempted) return false
  return !sectionImages.some((e) => e.url)
}

const LIST_SECTION_KEYS: Record<string, keyof GeneratedImagesMap> = {
  features: 'features',
  howto: 'howToImages',
  usp_icons: 'usp_icons',
}

/**
 * section_images(플랫 배열, 리스트형은 `features:0` 형식 키) → compose 단계가 소비하는 GeneratedImagesMap.
 * buildImageTasks가 정한 키 규약의 역변환이라 이 파일에 둔다(키 형식의 단일 진실 원천).
 * 리스트형은 번호가 곧 자리다 — 실패·없는 번호는 빈 문자열로 남기고 뒤 번호를 당기지 않는다(features:4 실패·features:5 성공이면
 * features[4]는 '', features[5]가 5번 컷). 마지막 성공 번호 뒤는 싣지 않는다
 */
export function toGeneratedImagesMap(sectionImages: SectionImage[]): GeneratedImagesMap {
  const map: GeneratedImagesMap = {}
  const lists: Record<string, string[]> = {}
  for (const entry of sectionImages) {
    if (!entry.url) continue
    const [prefix, indexStr] = entry.section.split(':')
    const listKey = LIST_SECTION_KEYS[prefix]
    if (listKey && indexStr !== undefined) {
      const idx = Number(indexStr)
      if (!lists[listKey]) lists[listKey] = []
      lists[listKey][idx] = entry.url
      continue
    }
    map[entry.section] = entry.url
  }
  for (const [key, arr] of Object.entries(lists)) {
    map[key] = Array.from(arr, (u) => u ?? '')
  }
  return map
}
