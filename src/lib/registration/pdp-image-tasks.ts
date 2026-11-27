/**
 * PDP 이미지 단계 — 태스크 목록 구성 + 팔레트 플레이스홀더 치환(순수 함수, LLM 없음).
 * NEXFIT image_generation_agent.py 태스크 조립부(:1661-1672 base 5종 + features/howto/usp +
 * 조건부 + `_generate_pro_images`:1029-1150 Pro 10종)를 §9.1 ③ 실측 축소판(run당 1~2장 순차 생성,
 * Lite/Judge 티어링·Pillow 합성 없음)에 맞춰 이식. pdp-image-stage.ts가 이 목록을 소비해 실제
 * 생성·게이트·저장을 수행한다(오케스트레이션은 그쪽 소관 — 여기는 무엇을 만들지만 결정한다).
 */

import type { ImageModel } from '@/lib/agents/image/types'
import type { DesignPrompts, DesignPalette, GeneratedImagesMap, PdpJobRow, SectionImage } from './pdp-state'
import {
  buildImagePrompts,
  buildFeaturePrompt,
  buildFeaturePromptFromDesign,
  buildHowtoPrompt,
  buildHowtoPromptFromDesign,
  buildUspIconPrompt,
  buildSizeComparisonPrompt,
  buildSoldOutBannerPrompt,
  selectFeaturePrompt,
  selectHowtoPrompt,
  getPhotographyContext,
  getPhotographyBase,
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
  /** 원본 빌더가 반환한 비율 힌트('3:4'|'1:1'|'16:9') — 생성 호출 시 지원 사이즈로 매핑(pdp-image-stage.ts) */
  aspectRatio: string
  effectOnly: boolean
  skipGate: boolean
  /** 잡 선택 모델 대신 이 컷만 쓰는 모델 — 저가 컷 강등(개정 5: rating_bg·USP 아이콘 폴백) */
  model?: ImageModel
}

/**
 * 컷별 저가 모델 강등(개정 5 — 오너 검수 피드백 2026-08-11): 추상 배경·아이콘류는 품질 요구가
 * 낮아 gemini-3.1-flash-image($0.067)로 고정한다. NEXFIT도 EFFECT_ONLY 컷을 flash 계열로
 * 강등했다(cost_tracking.py D4). 오너 지정 'gemini-3.5-flash-image'는 미출시(모델 목록 실측
 * 2026-08-11)라 현행 flash image로 대체 — 결정 E의 잡 단위 단일 모델 원칙의 명시적 예외.
 */
export const SECTION_MODEL_OVERRIDE: Record<string, ImageModel> = {
  rating_bg: 'gemini-3.1-flash-image',
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
  fallbackPrompt: string
): string {
  const override = designPrompts.section_image_prompts?.[section]?.positive
  if (!override || !override.trim()) return fallbackPrompt
  const bound = bindPalettePlaceholders(override, palette)
  if (section === 'problem') {
    return `${bound}\n\n${PROBLEM_SCENE_GUARD}\n${NO_TEXT_INSTRUCTION}`.trim()
  }
  return `${bound}\n\n${PRODUCT_CONSISTENCY_RULES}\n${NO_TEXT_INSTRUCTION}`.trim()
}

function buildBaseTasks(job: PdpJobRow, designPrompts: DesignPrompts): ImageTask[] {
  const copy = job.copy_sections.final
  const palette = copy?.designPalette ?? {}
  const built = buildImagePrompts({
    productName: job.spec_sheet.productName || copy?.mainIntro?.brandAndName || '제품',
    designPalette: { bgMain: palette.bgMain },
    problemQuestion: copy?.problem?.question,
    solutionDeclaration: copy?.solution?.declaration,
    heroImageMode: job.spec_sheet.heroImageMode,
    category: job.analysis.detected_category || 'household',
  })
  return (['hero', 'problem', 'solution', 'usage', 'cta'] as const).map((section) => ({
    section,
    prompt: selectBaseSectionPrompt(section, designPrompts, palette, built[section].prompt),
    aspectRatio: built[section].aspectRatio,
    effectOnly: EFFECT_ONLY_SECTIONS.has(section),
    skipGate: GATE_SKIP_SECTIONS.has(section),
  }))
}

const FEATURE_CAP = 4
const HOWTO_CAP = 3
const USP_ICON_CAP = 4

function buildFeatureTasks(job: PdpJobRow, designPrompts: DesignPrompts): ImageTask[] {
  const copy = job.copy_sections.final
  const points = (copy?.detailPoints ?? []).slice(0, FEATURE_CAP)
  const bgSub = copy?.designPalette?.bgSub || '#f8fafc'
  const category = job.analysis.detected_category || 'household'
  return points.map((point, i) => {
    const fromDesign = selectFeaturePrompt(designPrompts, i, point.claim ?? '')
    const boundFromDesign = fromDesign ? bindPalettePlaceholders(fromDesign, copy?.designPalette) : null
    const entry = boundFromDesign
      ? buildFeaturePromptFromDesign({ designPositive: boundFromDesign, bgSub, category })
      : buildFeaturePrompt({
          featureTitle: point.claim ?? '',
          featureDescription: point.benefit ?? point.proof ?? '',
          bgSub,
          imageHint: point.imageHint,
          category,
        })
    return { section: `features:${i}`, prompt: entry.prompt, aspectRatio: entry.aspectRatio, effectOnly: false, skipGate: false }
  })
}

function buildHowtoTasks(job: PdpJobRow, designPrompts: DesignPrompts): ImageTask[] {
  const copy = job.copy_sections.final
  const steps = (copy?.howTo ?? []).slice(0, HOWTO_CAP)
  const category = job.analysis.detected_category || 'household'
  return steps.map((step, i) => {
    const fromDesign = selectHowtoPrompt(designPrompts, i, step.step ?? '')
    const boundFromDesign = fromDesign ? bindPalettePlaceholders(fromDesign, copy?.designPalette) : null
    const entry = boundFromDesign
      ? buildHowtoPromptFromDesign({ designPositive: boundFromDesign, category })
      : buildHowtoPrompt({ stepTitle: step.step ?? '', stepDescription: step.description ?? '', category })
    return { section: `howto:${i}`, prompt: entry.prompt, aspectRatio: entry.aspectRatio, effectOnly: false, skipGate: false }
  })
}

function buildUspIconTasks(job: PdpJobRow): ImageTask[] {
  const cards = (job.copy_sections.final?.pointCards ?? []).slice(0, USP_ICON_CAP)
  return cards.map((card, i) => {
    const entry = buildUspIconPrompt(card.title || `포인트 ${i + 1}`)
    // 개정 5: 아이콘은 라이브러리 선택이 1순위(pdp-image-stage) — 미적중 폴백 생성도 저가 모델
    return { section: `usp_icons:${i}`, prompt: entry.prompt, aspectRatio: entry.aspectRatio, effectOnly: true, skipGate: true, model: 'gemini-3.1-flash-image' as ImageModel }
  })
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
    })
    tasks.push({ section: 'size_comparison', prompt: entry.prompt, aspectRatio: entry.aspectRatio, effectOnly: false, skipGate: false })
  }
  if ((specSheet.soldOutCount ?? 0) > 0) {
    const entry = buildSoldOutBannerPrompt(copy?.designPalette)
    tasks.push({ section: 'sold_out_banner', prompt: entry.prompt, aspectRatio: entry.aspectRatio, effectOnly: true, skipGate: true })
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
      prompt = `${prompt}\n${getPhotographyBase()}`
      if (PRO_HUMAN_SUBJECT_TYPES.has(type)) prompt = `${prompt}\n${HUMAN_SUBJECT_QUALITY_RULES}`
    }

    // NEXFIT image_generation_agent.py:1017-1023 _generate_pro_single → _generate_with_reference("3:4", ...) 고정
    tasks.push({ section: type, prompt, aspectRatio: '3:4', effectOnly, skipGate: GATE_SKIP_SECTIONS.has(type), model: SECTION_MODEL_OVERRIDE[type] })
  }
  return tasks
}

/**
 * 잡 상태(spec_sheet·mode·analysis·copy_sections.final·design_prompts) 기준 전 이미지 태스크 목록을
 * 순서대로 조립한다 — hero가 항상 첫 항목(이후 컷의 style_ref로 쓰인다, pdp-image-stage.ts 소관).
 * copy_sections.final이 아직 없으면(카피 단계 미완료) 빈 배열 — 파이프라인 전이 규칙이 이 단계 진입을
 * 카피 완료 이후로 보장하므로 방어적 반환일 뿐이다.
 */
export function buildImageTasks(job: PdpJobRow): ImageTask[] {
  if (!job.copy_sections.final) return []
  const designPrompts = job.design_prompts
  const tasks = [
    ...buildBaseTasks(job, designPrompts),
    ...buildFeatureTasks(job, designPrompts),
    ...buildHowtoTasks(job, designPrompts),
    ...buildUspIconTasks(job),
    ...buildConditionalTasks(job),
  ]
  if (job.mode === 'pro') tasks.push(...buildProTasks(job, designPrompts))
  return tasks
}

/**
 * 전 태스크가 시도됐고(url||error) 단 한 장도 성공하지 못했는지 판정 — images 단계 전량 실패 시
 * compose로 잘못 전진하지 않도록 pdp-image-stage.ts가 이 신호로 currentStep='failed'를 택한다(§6.4).
 * 순수 함수라 DB·LLM 모킹 없이 단위 테스트 가능(pdp-pipeline.test.ts).
 */
export function allImageTasksFailed(tasks: ImageTask[], sectionImages: SectionImage[]): boolean {
  if (tasks.length === 0) return false
  const allAttempted = tasks.every((t) => sectionImages.some((e) => e.section === t.section && (e.url || e.error)))
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
    map[key] = arr.filter((u): u is string => Boolean(u))
  }
  return map
}
