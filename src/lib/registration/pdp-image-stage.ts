/**
 * PDP 파이프라인 5단계(이미지 생성) run 오케스트레이션 — NEXFIT image_generation_agent.py
 * 이식(§9.1 ③ 실측 축소판: Lite/Judge 티어링·Pillow 합성 없음). 태스크 목록·팔레트 치환은 pdp-image-tasks.ts(순수)
 * 소관, 여기는 참조 로드·Style Charter·식별카드·생성 호출·Vision 게이트·스토리지 저장까지의 오케스트레이션만 담당한다.
 *
 * 동시 생성(속도 개선 1차, 2026-10-28 — NEXFIT image_generation_agent.py hero 선행 후 동시 투입): hero를 먼저 만들고(나머지의
 * 스타일 참조), 나머지는 상한 N(제공자 4, 로컬 2 — pdp-image-pool)으로 끝나는 대로 이어 만든다. 결과는 메모리에 모아 한 줄로
 * 저장한다(잡 갱신은 section_images 전체를 덮어쓴다 — 동시 저장이 서로 지우지 않게). 새 생성·재생성은 run 시간 예산과 run 안
 * 지출 예약 안에서만 시작한다. 게이트 재생성은 같은 run에서 즉시 1회 시도하되, 예산을 넘기면 `pendingRegen` 플래그만 남겨
 * 다음 run이 최우선으로 이어받는다(§6.3 "이월 가능한 구조"). 생성 뒤 시간이 모자라 게이트를 보지 못한 컷도 통과로 치지 않고
 * `gatePending`으로 남겨 다음 run 맨 앞에서 판정한다. 실행기(Vercel run 라우트·작업자)에 매이지 않는다 — 시간 예산과
 * 진행 잠금 기한은 호출자가 넘긴다(ImagesRunOptions).
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { generateImage } from '@/lib/agents/image/generate'
import {
  estimateImageCostUsd,
  honorsImageSize,
  IMAGE_PROVIDER_BALANCE_LABEL,
  ImageContentRejectedError,
  ImagePendingError,
  ImageProviderBalanceError,
  isAsyncImageModel,
  maxReferencesOf,
  type ImagePendingRequest,
} from '@/lib/agents/image/types'
import type { RunContext } from '@/lib/agents/types'
import { fetchImageAsBase64, type VisionImage } from '@/lib/agents/registration/thumbnail-vision-agent'
import { upscaleLowResReference } from './reference-upscale'
import { readIdentityCard, judgeImageGate } from '@/lib/agents/registration/pdp-image-agent'
import { pdpRoute } from './pdp-model-routes'
import { locateAnnotations } from '@/lib/agents/registration/pdp-annotation-agent'
import { buildStyleCharter } from '@/lib/agents/registration/prompts/pdp-image-prompts'
import { applyRegenDirective, classifyGateFailure, gateExpectedUseOf, type GateScoreRow } from '@/lib/agents/registration/prompts/pdp-image-gate-prompts'
import { uploadPdpImage } from './storage'
import { buildMotionCell, heroPosterMotion, isMotionRedo, motionCanStart, motionFallbackNote, motionGateSkip, motionOrStill } from './motion/stage'
import { motionDepsOf, motionEngineValuesOf, motionRefModelOf } from './motion/stage-deps'
import type { MotionTask } from './motion/task'
import { buildImageGroundingBlock } from './corpus'
import { buildInternalizedImageBlock, buildPooledInternalizedImageBlock } from './corpus-v2'
import { audienceOf, persuasionOf, resolveShotGrounding, withAudienceStageSpec } from './pdp-enrichment-stage'
import { buildParentProxyImageBlock, withoutPreparedResult } from './parent-proxy-copy'
import { buildAgeComplianceImageBlock } from './compliance-gate'
import { PDP_MAX_SOURCE_IMAGES, resolveGenerationTrack, withIdentityNote } from './pdp-state'
import { mergeManualStrategy } from './pdp-strategy-contract'
import { hasEnrichmentFeature } from './enrichment-switch'
import { generationExcludedRolesOf, generationSourceUrls, identityRoleLine, photoRoleOf } from './source-photo-roles'
import { tidyImageBrief } from './pdp-image-brief'
import { canonLight } from './pdp-image-light'
import { applyRulePriority } from './rule-priority'
import { HERO_STUDIO_LEVEL, heroKindAt, heroKindBlock } from './hero-kind'
import { withPartsRule } from './parts-rule'
import { measureProductBox, SIZE_SINGLE_SECTION } from './size-cut'
import { hasImageSignature, measureCutTone } from './cut-tone'
import {
  applyD2SceneCut,
  applySceneCut,
  D2_SOLID_REFERENCE_ROLES_TEXT,
  d2PointChapterOf,
  isD2ProductSceneCut,
  isSceneCut,
  REFERENCE_ROLES_TEXT,
  SCENE_STYLE_REF_TEXT,
} from './pdp-image-scene'
import { effectShotFitOf } from './effect-shot-fit'
import { fitMsPrompt, msOverflowMessage } from './ms-prompt-fit'
import { sceneSafetyOf } from './scene-safety'
import { showBeatFit } from './templatelib/show-beat-fit'
import { fitPdpUpload, type PdpUploadImage } from './pdp-upload-fit'
import { buildSceneSet, describeSceneSet, sceneSetInputOf } from './scene-set'
import { buildShotCast, describeShotCast, shotCastInputOf } from './internalized/shot-plan'
import {
  buildImageTasks,
  buildKnownImageTasks,
  allImageTasksFailed,
  designcutStagesOf,
  isGatePending,
  isPlateTask,
  isSectionSettled,
  PDP_PROVIDER_BALANCE_STEP_ERROR,
  isTextBearingJob,
  styleLightingOf,
  withDesigncutCutBackground,
  type ImageTask,
} from './pdp-image-tasks'
import {
  buildDesigncutPlan,
  designcut2Enabled,
  designcutArtDirectionOf,
  designcutEnabled,
} from './internalized/designcut-plan'
import { measureDesigncutPhoto, measureHeroCopyZone } from './designcut-photo'
import {
  applyShotPurpose,
  shotPurposeContextOf,
  planExtraShotsForLength,
  pointCutsOf,
  readExtraShots,
  shotdivEnabled,
  withAngleRetry,
} from './internalized/shot-diversity'
import {
  anglePendingError,
  anglePendingOf,
  dHashOf,
  DHASH_TWIN_MAX,
  findCompositionTwin,
  findLineCompositionTwin,
  isCompositionCut,
  isLineCompositionCut,
} from './shot-composition'
import { shotvaryEnabled, varyReferenceText } from './templatelib/shot-variety'
import { identityCardOthers, printIdentityBlock } from './print-identity'
import {
  copyZoneRetryPending,
  needsCopyZoneRetry,
  settleCopyZoneRetry,
  withCopyZone,
  type CopyZoneMeasure,
} from './internalized/hero-copy-zone'
import { getUspIconLibrary, selectUspIcon } from './usp-icon-library'
import { isUspIconSection, toTransparentInk } from './usp-icon-alpha'
import {
  annotationProgress,
  buildNumberAnnotations,
  imageAspectFromBase64,
  pendingAnnotationTargets,
  validateAnnotations,
  withAnnotationResult,
} from './pdp-annotation-stage'
import { jobUsageContext } from './pdp-cost-pool'
import { fitSourceRefs } from './reference-limit'
import { cutFailureSummary } from './cut-failures'
import { gateRecordOf } from './gate-record'
import { updatePdpJob } from './pdp-jobs'
import { createSpendGate, imageConcurrencyOf, runWithConcurrency, type SpendGate } from './pdp-image-pool'
import { GATE_RESERVE_USD, isFirstGeneration, jobCapCutError, jobCostCapUsd, jobCostHeadroomUsd, type JobCostCapRecord } from './job-cost-cap'
import { optionSpecOf } from './internalized/persuasion-signals'
import { guardedReferences, optionPhotoCoverage, optionPhotoUrls } from './options/option-photo-guard'
import type { DesignPrompts, EditorRegenRecord, PdpJobRow, SectionImage } from './pdp-state'
import { judgeCompositeEligibility } from '@/lib/agents/registration/pdp-composite-eligibility-agent'
import { getLocalCutoutBackend } from './composite/cutout-backend'
import { isCompositeTarget, type CompositeTargetSection } from './composite/composite-types'
import { kCompositeTargets } from './composite/k-composite'
import { sentPromptRecord } from './sent-prompt'
import { handlingFactsOf, handlingLinesOf, handlingLinesOfUseFacts } from './templatelib/handling-facts'
import {
  directorLineFor,
  logNewStage,
  needsDirector,
  needsSlotFactAudit,
  newStageFits,
  recordCost,
  runDirectorStage,
  runSlotFactAuditStage,
} from './pdp-new-stages-stage'
import {
  composeCompositeCuts,
  compositeEnabled,
  loadCompositeImage,
  prepareCompositeSource,
  type CompositeImage,
} from './composite/composite-source'
import {
  buildEditorRegenDirective,
  isEditorRegenPending,
  runEditorRegenFlow,
  settleEditorRegen,
  type GateVerdict,
} from './pdp-image-regen'

/**
 * run 시간 예산(기본) — 이 run의 일이 모두 끝나야 하는 시각(run 시작부터). run 라우트 상한 300초에서 마지막 저장·응답 여유
 * 20초를 뺐다. 새 생성·재생성·장식은 최악 소요가 예산 안에 들 때만 시작하고(품질 무관 — 마지막 생성 시작은 145초), 게이트는
 * 남은 시간만큼만 기다린다. 풀은 끝나는 대로 이어 꺼내므로 느린 한 건이 다른 칸을 붙잡지 않는다.
 */
export const RUN_TIME_BUDGET_MS = 30 * 60_000

/** 강조 장식 1콜의 최악 소요(이미지 받기 25초 + 판독 2시도 × 25초 + 백오프·여유, pdp-annotation-agent) — 예산 안에 들 때만 시작한다 */
const ANNOTATION_ESTIMATE_MS = 80_000
const ANNOTATION_CALLS_PER_RUN = 2

/** hero 스타일 참조 받기 상한 — 같은 스토리지의 hero 한 장이라 기본(25초)보다 짧게. 실패하면 그 컷만 참조 없이 만든다 */
const STYLE_REF_FETCH_MS = 15_000
/**
 * 생성·재생성 1장의 최악 소요 — 스타일 참조 받기 15초 + 제공자 호출 상한 100초(generate.ts PROVIDER_CALL_POLICY.totalMs)
 * + 업로드·저장 여유 20초
 */
export const GENERATION_WORST_MS = 135_000
/** 비동기 공급자(MS 2k)를 기다리는 기한 = run 예산 끝 − 이 몫(받기·업로드·저장 여유, GENERATION_WORST_MS의 업로드·저장 20초와 같다) */
const ASYNC_SAVE_MARGIN_MS = 20_000

/** 게이트(생성 이미지 받기 + Vision 채점)의 기본 최악 소요 — 받기 25초(IMAGE_FETCH_TIMEOUT_MS) + 3시도 × 60초 + 백오프 3초 */
const GATE_FETCH_MS = 25_000
const GATE_FULL_MS = GATE_FETCH_MS + 3 * 60_000 + 3_000
/**
 * 게이트를 시작할 최소 남은 시간(받기 + 채점 1시도 15초). 이보다 적으면 판정하지 않는다 — 통과로 치지 않고 게이트 대기(gatePending)로
 * 남겨 다음 run 맨 앞에서 판정한다(코덱스 컷은 1장 2분 안팎이라 run 끝 무렵에 끝난 컷의 게이트가 여기 걸린다)
 */
const GATE_MIN_MS = GATE_FETCH_MS + 15_000
/** 시간이 모자라 판정하지 못한 게이트의 사유 — 이 사유만 게이트 대기로 남는다(받기·채점 실패는 지금처럼 통과와 같은 처리) */
const GATE_TIME_SHORT = 'run 시간 부족'
/** 새 배치 게이트가 재시도 뒤에도 잘리거나 빈 답 — 통과로 치지 않고 컷 기록에 남긴다(이미지는 둔다, 추가 재생성 없음 — 통합 R03 권장안) */
export const GATE_UNDECIDED_TRUNCATED = '게이트 판정 못 함(응답 잘림·빈 답)'
/**
 * 새 배치 일반 생성의 게이트 채점 호출 실패(시간 초과·API 오류·해석 실패, R12e) — 통과로 치지 않고 게이트 대기(gatePending)로 다음 run
 * 맨 앞에서 다시 판정한다. 다시 판정은 컷마다 이 횟수까지(첫 판정 포함 3번 부름), 그 뒤에도 실패하면 잘림과 같이 이미지는 두고 판정 못 함으로 남긴다
 */
export const GATE_CALL_FAILURE_REJUDGE_MAX = 2
export const GATE_UNDECIDED_CALL_FAILED = `게이트 판정 못 함(채점 호출 실패 ${GATE_CALL_FAILURE_REJUDGE_MAX + 1}번)`
/**
 * 새 배치 일반 생성에서 게이트 한 시도에 줄 최소 시간(R12e) — R13 운영 잡 96872abb 성공 콜 최대 58.8초. run 남은 시간이 모자라 시도 시간이
 * 이보다 짧아지면 부르지 않고 게이트 대기로 넘긴다(짧게 불러 시간 초과로 다시 판정 횟수를 쓰지 않게)
 */
export const GATE_NEW_BATCH_MIN_ATTEMPT_MS = 60_000

/** 게이트 1콜 계획 — 시도 시간·재시도·최악 소요. 새 배치는 route 값(90초 × 2시도), 지금 배치는 route에 값이 없어 지금 상수 그대로 */
function gateCallPlan(): { attemptMs: number; fullMs: number } {
  const route = pdpRoute('images/gate')
  if (route.callTimeoutMs === undefined) return { attemptMs: 60_000, fullMs: GATE_FULL_MS }
  const retries = route.callMaxRetries ?? 2
  // 재시도 백오프는 1초·2초…(agents 공급자 공통)
  const backoffMs = (1000 * retries * (retries + 1)) / 2
  return { attemptMs: route.callTimeoutMs, fullMs: GATE_FETCH_MS + (retries + 1) * route.callTimeoutMs + backoffMs }
}

/** 생성 호출의 에이전트 이름 — 사용량 기록·월 예산(에이전트 한도) 기준. run 안 지출 예약도 같은 이름으로 읽는다 */
const IMAGE_AGENT = 'registration/pdp-image'

/** runImagesStep 실행 옵션 — 실행기(Vercel run 라우트·작업자)가 정한다 */
export interface ImagesRunOptions {
  /** 첫 화면 실패로 멈춘 잡의 재시도(pdp-pipeline) — 사진 없는 첫 화면 항목을 지우고 처음부터 다시 만든다 */
  retryLostHero?: boolean
  /** run 시간 예산(ms). 기본 RUN_TIME_BUDGET_MS */
  budgetMs?: number
  /** 동시 생성 상한. 기본 모델별(imageConcurrencyOf — 제공자 4, 로컬 2) */
  concurrency?: number
  /** 진행 잠금 기한(runPdpStep이 쥔 잠금) — 중간 저장이 잠금을 풀지 않게 updated_at에 그대로 쓴다 */
  leaseUntil?: string
}

// NEXFIT image_generation_agent.py:150 IMAGE_QUALITY_THRESHOLDS["consistency_score_min"]
type GateScore = Awaited<ReturnType<typeof judgeImageGate>>['score']
const CONSISTENCY_SCORE_MIN = 0.7

/**
 * 게이트 미달 판정 — 실행과 재현 H6(__e2e__/stage-repro)이 같은 기준을 쓴다. 크기(size_plausible, K 라인 컷에 치수를 실은 판정만 — 실물 크기 11-05)는
 * 미달 사유가 아니다: 재생성해도 크기를 못 고치고 장수만 2배가 됐다(K5 P01 실측 11-06) — 판정 글만 기록하고 통과(gate-record SCALE_KEPT_NOTE).
 * 다른 사유가 함께 있으면 그 사유로 지금처럼 다시 만든다
 */
export function isGateFailure(score: Pick<NonNullable<GateScore>, 'has_artifact' | 'same_product' | 'consistency' | 'size_plausible'>): boolean {
  return score.has_artifact || score.same_product === false || score.consistency < CONSISTENCY_SCORE_MIN
}

/** K 컷 게이트 참조 원본 수 상한(점검 고침 1, 통합 Q2 = 4) — 원본 사진 대부분 3~4장, 근접 사진이 정면에서 안 보이는 부품을 보여 준다 */
export const GATE_REF_MAX = 4

/** 상품 없는 컷(J49 decide 24)이 재생성하는 사유 — 그림에 생긴 글자·브랜드뿐이다 */
const NO_PRODUCT_REGEN_REASONS: ReadonlySet<string> = new Set(['baked_text', 'brand'])

/**
 * 상품 없는 컷(task.noProductCut — 목적 problem)의 재생성 사유인가 — 글자·브랜드만. 같은 상품·일관성·부품·사용·크기·얼룩은 상품을 견주는 사유라
 * 보지 않는다('Match the reference product' 지시가 상품을 불러온다, P02 462d097d)
 */
export function isNoProductRegenReason(score: GateScoreRow): boolean {
  return NO_PRODUCT_REGEN_REASONS.has(classifyGateFailure(score))
}

/** 상품 없는 컷의 게이트 미달 — 결함 표시(has_artifact)가 있고 그 사유 글이 글자·브랜드일 때만. 상품 비교 칸은 보지 않는다 */
export function isNoProductGateFailure(score: Pick<GateScoreRow, 'artifact_reason'> & { has_artifact?: boolean }): boolean {
  return Boolean(score.has_artifact) && isNoProductRegenReason({ artifact_reason: score.artifact_reason })
}

/** K 컷 미달 — 기본 미달 + 부품(parts_match)·사용(use_correct) false. 칸이 없으면(D·운영 기본 컷) isGateFailure 그대로 */
export function isLineGateFailure(score: Parameters<typeof isGateFailure>[0] & { parts_match?: boolean; use_correct?: boolean }): boolean {
  return isGateFailure(score) || score.parts_match === false || score.use_correct === false
}

type JudgedScore = { same_product?: boolean; parts_match?: boolean; use_correct?: boolean; consistency?: number }
/**
 * 재판정 뒤에도 미달인 두 컷 가운데 나은 쪽(점검 고침 1) — 같은 상품 > 부품 맞음 > 일관성 높음. 모두 같으면 새 컷(지시를 더 받았다).
 * use(usegate 잡의 사용 판정 컷, 결정 카드 c08·J19)면 부품 다음에 사용 맞음을 본다. 없으면 지금 순위 그대로
 */
export function betterCutOf(first: JudgedScore, regen: JudgedScore, options: { use?: boolean } = {}): 'first' | 'regen' {
  const rank = (s: JudgedScore) => [
    s.same_product === false ? 0 : 1,
    s.parts_match === false ? 0 : 1,
    ...(options.use ? [s.use_correct === false ? 0 : 1] : []),
    typeof s.consistency === 'number' ? s.consistency : 0,
  ]
  const a = rank(first)
  const b = rank(regen)
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] > b[i] ? 'first' : 'regen'
  return 'regen'
}

/**
 * 크기 칸을 뺀 점수 — 크기와 다른 사유가 함께 미달일 때 실패 사유·재생성 지시가 크기(scale)로 잡히지 않게 한다(재생성으로 못 고침, K5 P01 실측).
 * 크기 칸이 false가 아니면 같은 객체를 돌려준다(D·운영 기본 판정은 칸이 없어 그대로)
 */
export function withoutSizeScore<T extends GateScoreRow>(score: T): T {
  if (score.size_plausible !== false) return score
  const rest = { ...score }
  delete rest.size_plausible
  delete rest.size_reason
  return rest
}

/**
 * 사용 판정 끝 처리(usegate 잡, 결정 카드 c08·J19 — 가정 A3)를 받는 컷인가 — 사용 판정(useGate)이 붙은 K 컷만. 이 컷은 게이트에 기대 쓰는 법을
 * 싣고, 재생성 뒤 다시 판정하고, 끝까지 사용 미달이면 대표 아닌 컷은 뺀다. 꺼진 잡·다른 컷은 false라 게이트·재판정·기록이 지금 그대로다
 */
export function strictUseGateOf(job: Pick<PdpJobRow, 'analysis'>, task: Pick<ImageTask, 'lineGate' | 'useGate'>): boolean {
  return Boolean(task.lineGate && task.useGate) && hasEnrichmentFeature(job.analysis, 'usegate')
}

/** 게이트 판정 문구 옵션 — K 라인 컷만 구멍·빗살 배열과(치수가 있으면) 크기를 묻는다. 아무 옵션도 없으면 undefined(D 라인은 지금과 같다) */
export function gatePromptOptionsOf(task: Pick<ImageTask, 'stagedGate' | 'lineGate'>): { stagedCut?: boolean; lineCut?: boolean; realSize?: string } | undefined {
  const options = {
    ...(task.stagedGate ? { stagedCut: true } : {}),
    ...(task.lineGate ? { lineCut: true, ...(task.lineGate.realSize ? { realSize: task.lineGate.realSize } : {}) } : {}),
  }
  return Object.keys(options).length > 0 ? options : undefined
}

// NEXFIT image_generation_agent.py:288-293 _STYLE_PACK_MOOD_KEYWORDS
const STYLE_PACK_MOOD_KEYWORDS: Record<string, string> = {
  clean_proof: 'clean · trustworthy · precise · bright · uncluttered',
  warm_story: 'cozy · warm · inviting · soft · trustworthy',
  premium_editorial: 'premium · refined · calm · editorial · sophisticated',
  cute_soft: 'soft · playful · adorable · pastel · friendly',
}

// NEXFIT image_generation_agent.py:1361-1378 _generate_with_reference 역할 지시문
/**
 * K 대표 컷·움직이는 칸 참조 안내(점검 고침 2) — 스타일 참조가 없는 상품 컷도 첫 사진이 구조 정본임을 알린다. Refs 줄은 붙인 사진 수.
 * 대표 칸(hero_motion)은 맨 끝에 정지 대표 컷이 더 붙는다(첫 프레임 기준 — motion/stage gifPromptOf가 부른다)
 */
export function productRefRolesText(photoCount: number, heroTail = false): string {
  const n = Math.max(1, photoCount)
  const refs = [`photo 1 = structure master`, ...(n > 1 ? [`photos 2-${n} = the same product from other angles or options`] : []), ...(heroTail ? ['LAST image = this page hero cut (frame 1)'] : [])]
  return (
    "REFERENCE ROLES: the FIRST attached image is the USER'S ORIGINAL PRODUCT PHOTO and it is the single source of truth for the product's structure — " +
    'shape, number of tiers/parts, handles, openings and assembled state. Never add, remove or merge parts that are not in the product photos.\n' +
    `Refs: ${refs.join('; ')}.`
  )
}

/** 참조 안내를 더 붙이는 컷 — K 라인 잡의 대표 컷(hero)과 움직이는 칸(motion 태스크)만, 상품 사진을 붙이고 스타일 참조가 없을 때 */
export const productRefRolesCut = (job: PdpJobRow, task: Pick<ImageTask, 'section' | 'effectOnly' | 'motion'>, styleRef: boolean): boolean =>
  !styleRef && !task.effectOnly && (task.section === 'hero' || Boolean(task.motion)) && hasEnrichmentFeature(job.analysis, 'templatelib') && Boolean(job.section_plan?.templatelib)

/** 스타일 헌장 파생 — NEXFIT `_build_style_charter`(:295-378) 1:1, 파이프라인당 1회 확정용. */
function buildStyleCharterForJob(job: PdpJobRow): string {
  const palette = job.copy_sections.final?.designPalette ?? {}
  // 광원은 디자인 컷 플레이트와 같은 값(pdp-image-tasks styleLightingOf)
  const { direction, shadowAngle, temperature: tempDesc } = styleLightingOf(job)

  const bgHex = palette.bgMain || '#ffffff'
  const propColors = [palette.primary, palette.secondary, palette.bgSub].filter(Boolean).join(', ') || '#4f46e5, #818cf8, #f8fafc'

  const strategyContract = mergeManualStrategy(job.analysis.recommended_strategy_contract ?? {}, job.spec_sheet, [])
  const mood = STYLE_PACK_MOOD_KEYWORDS[strategyContract.visual_style_pack ?? ''] ?? STYLE_PACK_MOOD_KEYWORDS.clean_proof

  const visualPlan = job.design_prompts.visual_plan as Record<string, unknown> | undefined
  const heroVisual = (visualPlan?.hero_visual ?? {}) as Record<string, unknown>
  const bgTone = typeof heroVisual.background_tone === 'string' ? heroVisual.background_tone.trim() : ''
  const lightingMood = typeof heroVisual.lighting === 'string' ? heroVisual.lighting.trim() : ''
  const setParts = [bgTone && `backdrop tone: ${bgTone}`, lightingMood && `lighting mood: ${lightingMood}`].filter(Boolean) as string[]
  // R2 세트 기술 — scene 기록 잡은 결정론 세트(바닥·벽 재질·창 방향·계절감·소품 2~3, scene-set.ts)로 채운다.
  // D2(designcut2) 잡은 계획에 기록한 아트 디렉션 세트(C1, 같은 생성기 — 벽 톤 입력은 컷 바탕색)
  const art = designcutArtDirectionOf(job)
  const setDesc = art
    ? describeSceneSet(art.set)
    : hasEnrichmentFeature(job.analysis, 'scene')
      ? describeSceneSet(buildSceneSet(sceneSetInputOf(job)))
      : setParts.length
        ? setParts.join('; ')
        : 'one continuous studio set shared by every cut of this page'

  // R3 잡 단위 출연 — shotplan 기록 잡은 인물·옷 톤·반려동물·소품을 헌장 한 줄로 고정한다(모든 컷이 같은 값)
  const castDesc = hasEnrichmentFeature(job.analysis, 'shotplan')
    ? describeShotCast(buildShotCast(shotCastInputOf(job, strategyContract, audienceOf(job) !== null)))
    : undefined

  return buildStyleCharter({
    bgHex,
    colorTemp: tempDesc,
    direction,
    shadowAngle,
    propColors,
    mood,
    setDesc,
    photographyNote: job.spec_sheet.photographyNote?.trim(),
    ...(castDesc ? { castDesc } : {}),
  })
}

async function loadValidRefs(urls: string[]): Promise<VisionImage[]> {
  const fetched = await Promise.all(urls.map((u) => fetchImageAsBase64(u)))
  // 긴 변 500px 미만 참조는 생성 전에 500으로 키운다(NEXFIT REFERENCE_MIN_LONG_SIDE) — 식별 카드·게이트도 같은 참조를 본다
  return Promise.all(fetched.filter((f): f is VisionImage => f !== null).map(upscaleLowResReference))
}

/**
 * 생성 원천 사진 주소(결정 카드 c12) — photoroles 기록 잡은 폼이 설명 그림·시험 사진으로 고른 사진을, demoshot만 기록한 잡(J57)은 시험 사진만
 * 뺀다(다 빠지면 그대로). 둘 다 꺼진 잡·역할 없는 잡은 source_images 그대로다
 */
export function generationSourceOf(job: Pick<PdpJobRow, 'source_images' | 'spec_sheet' | 'analysis'>): ReturnType<typeof generationSourceUrls> {
  const excludedRoles = generationExcludedRolesOf({ photoRoles: hasEnrichmentFeature(job.analysis, 'photoroles'), demoShot: hasEnrichmentFeature(job.analysis, 'demoshot') })
  if (excludedRoles.length === 0) return { urls: job.source_images, excluded: [], fallback: false }
  return generationSourceUrls(job.source_images, job.spec_sheet.sourcePhotoRoles, excludedRoles)
}

/**
 * 식별 카드 역할 한 줄(photoroles 잡) — 보내는 사진 sent장의 역할로 만든다. 옵션 사진 가드가 걸렸거나 받은 참조 수가 원천 주소 수와
 * 다르면(받기 실패) 사진 자리가 어긋나므로 null. 옵션 사진이 없어도 null
 */
export function identityRoleLineOf(job: Pick<PdpJobRow, 'source_images' | 'spec_sheet' | 'analysis'>, refCount: number, sent: number): string | null {
  if (!hasEnrichmentFeature(job.analysis, 'photoroles')) return null
  if (optionPhotoCoverage(optionSpecOf(job.spec_sheet, job.analysis)) !== null) return null
  const { urls } = generationSourceOf(job)
  if (refCount !== urls.length) return null
  return identityRoleLine(urls.slice(0, sent).map((url) => photoRoleOf(job.spec_sheet.sourcePhotoRoles, url)))
}

/**
 * 생성 참조(게이트는 첫 장, 식별 카드는 첫 장 — 인쇄물이고 2장 이상이면 최대 4장) — 사진 없는 옵션 가드가 걸린 잡은 실물 사진이
 * 있는 옵션의 사진만 쓴다(R3 ①,
 * guardedReferences). 옵션 기록이 없거나 모든 옵션에 사진이 있는 잡은 상품 사진 그대로다.
 */
export async function loadGenerationRefs(job: PdpJobRow): Promise<VisionImage[]> {
  const spec = optionSpecOf(job.spec_sheet, job.analysis)
  const guarded = optionPhotoCoverage(spec) !== null
  const [sourceRefs, optionRefs] = await Promise.all([
    loadValidRefs(generationSourceOf(job).urls),
    guarded ? loadValidRefs(optionPhotoUrls(spec)) : Promise.resolve([]),
  ])
  return guarded ? guardedReferences(sourceRefs, optionRefs, PDP_MAX_SOURCE_IMAGES) : sourceRefs
}

// gpt-image-2(/v1/images/generations,edits)는 고정 사이즈 3종만 허용 — aspectRatio 힌트를 가장 가까운 값으로 매핑(2.5 실험 모델도 같은 값).
// Gemini 경로(generate.ts)는 size를 소비하지 않으므로 이 매핑은 OpenAI 모델 선택 시에만 의미가 있다.
const ASPECT_TO_SIZE: Record<string, string> = {
  '1:1': '1024x1024',
  '3:4': '1024x1536',
  '16:9': '1536x1024',
  // K 슬롯 비율 — 다른 컷은 쓰지 않는다
  '2:3': '1024x1536',
  '4:3': '1536x1024',
}

function findSectionUrl(sectionImages: SectionImage[], section: string): string | undefined {
  return sectionImages.find((e) => e.section === section && e.url)?.url
}

function upsertSectionImage(list: SectionImage[], entry: SectionImage): SectionImage[] {
  const idx = list.findIndex((e) => e.section === entry.section)
  if (idx === -1) return [...list, entry]
  const next = [...list]
  next[idx] = entry
  return next
}

/**
 * 최종 프롬프트 조립 — 식별카드(제품 등장 컷만) → 인쇄 도안 규칙·인쇄 무늬 보존 줄(제품 등장 컷만, print-identity)
 * → REFERENCE ROLES(스타일 참조 동반 시) → Style Charter
 * → 코퍼스 이미지 그라운딩(결정 H 주입 지점 ③, 스타일 차터 뒤 별도 섹션 — corpus.ts 자체가
 * ANTI_COPY_PREAMBLE·모바일 공통 규칙을 이미 머리에 붙여 반환하므로 여기서는 그대로 append만 한다).
 */
function assemblePrompt(
  basePrompt: string,
  task: ImageTask,
  designPrompts: DesignPrompts,
  hasStyleRef: boolean,
  imageGroundingBlock: string,
  /** R2 — 상품 없는 장면 컷에 히어로를 빛·색 참조로만 붙였는지(상품 컷의 REFERENCE ROLES 대신 이 안내) */
  sceneStyleRef = false,
  /** 상품 컷의 참조 안내 — D2 잡의 단색 바탕 상품 컷은 세트 장면 히어로의 바탕을 따르지 않는 안내 */
  referenceRoles = REFERENCE_ROLES_TEXT,
  /** 상품 정확성 — 인쇄 도안 규칙 또는 인쇄 무늬 보존 줄(print-identity). 식별카드 바로 뒤, 상품 컷만 */
  printBlock: string | null = null
): string {
  let prompt = basePrompt
  if (!task.effectOnly && designPrompts.identity_card) prompt = `${prompt}\n\n${designPrompts.identity_card}`
  if (!task.effectOnly && printBlock) prompt = `${prompt}\n\n${printBlock}`
  if (hasStyleRef) prompt = `${prompt}\n\n${referenceRoles}`
  if (sceneStyleRef) prompt = `${prompt}\n\n${SCENE_STYLE_REF_TEXT}`
  if (designPrompts.style_charter) prompt = `${prompt}\n\n${designPrompts.style_charter}`
  if (imageGroundingBlock) prompt = `${prompt}\n\n${imageGroundingBlock}`
  return prompt
}

interface GenerateContext {
  db: SupabaseClient
  userId: string
  job: PdpJobRow
  designPrompts: DesignPrompts
  sourceRefs: VisionImage[]
  sectionImages: SectionImage[]
  imageGroundingBlock: string
  /** E-4 shots 잡만 — 컷별 그라운딩(null이면 imageGroundingBlock). 없으면 모든 컷이 공통 블록(Track S·구 잡) */
  taskGrounding?: ((task: ImageTask) => string | null) | null
  /** 디자인 컷 플레이트(D1) 전용 덧붙임 — 연령 블록만(없으면 null) */
  plateGrounding?: string | null
  runContext: RunContext
  /** 게이트 재생성 지시문 부착용(§6.4 "재실패는 error 마킹") — 신규 생성이면 undefined. */
  regenScore?: GateScoreRow
  /** 편집기 재생성 요청(pdp-image-regen-api) — 스타일·문구 조정 블록을 맨 끝에 붙인다 */
  editorRegen?: EditorRegenRecord
  /** 첫 생성 실패(retryPending)의 재시도 — 다시 실패하면 표지 없이 error만 남겨 섹션당 1회로 끝낸다(isSectionSettled) */
  errorRetry?: boolean
  /** D2-3 글자 자리 재생성 — 처음 컷의 잰 값(미달 사유를 강화 지시에 붙인다). 신규 생성이면 undefined */
  copyZoneRetry?: CopyZoneMeasure
  /** shotdiv 구도 중복 재생성 — 거의 같은 구도였던 컷(다른 각도 지시에 이름을 붙인다). 신규 생성이면 undefined */
  angleOf?: string
  /** run 시간 예산(ms) — 게이트 재생성 진입 판단 */
  budgetMs: number
  /** run 시작 시각 — GIF 칸 호출 상한(run 남은 시간)을 잰다. 없으면 지금 */
  runStart?: number
  /** run 안 지출 예약 — 게이트 재생성도 같은 예약 안에서 시작한다 */
  spend?: SpendGate
  /** hero 스타일 참조 받기 — 같은 run의 동시 컷이 한 번만 받는다 */
  styleRefs?: Map<string, Promise<VisionImage | null>>
  /** 이미지 공급자 잔액 부족을 run에 알린다(R12c) — 이 run은 새 MS 컷을 시작하지 않고 단계 오류로 끝난다 */
  onProviderBlocked?: (message: string) => void
  /** 이 run에서 이미지 공급자 잔액 부족이 났는가(R12c) — 게이트 재생성은 시작하지 않고 다음 run으로 이월한다 */
  providerHalted?: () => boolean
}

/** 컷 기록이 공급자 잔액 부족 실패인가(R12c) — 끝난 실패 글에도 같은 앞머리(IMAGE_PROVIDER_BALANCE_LABEL)가 남는다 */
function isBalanceFailure(entry: SectionImage): boolean {
  return Boolean(entry.error?.includes(IMAGE_PROVIDER_BALANCE_LABEL))
}

function styleRefOf(ctx: GenerateContext, url: string): Promise<VisionImage | null> {
  if (!ctx.styleRefs) return fetchImageAsBase64(url, STYLE_REF_FETCH_MS)
  let ref = ctx.styleRefs.get(url)
  if (!ref) {
    // 받기 실패(null)는 남기지 않는다 — 한 번의 일시 실패로 이 run의 뒤 컷 전부가 스타일 참조 없이 만들어지지 않게
    ref = fetchImageAsBase64(url, STYLE_REF_FETCH_MS).then((image) => {
      if (!image) ctx.styleRefs?.delete(url)
      return image
    })
    ctx.styleRefs.set(url, ref)
  }
  return ref
}

/**
 * R2 — scene 기록 잡의 상품 없는 사진 장면 컷(그래픽·아이콘·플레이트 제외)은 히어로를 빛·색 참조로 받는다(히어로 뒤에 시작).
 * D2(designcut2) 잡도 같다 — 장면 컷이 세트 바탕을 받으니 히어로 세트 장면의 빛·색도 맞춘다(D2-2a 검수)
 */
function sceneStyleRefCut(job: PdpJobRow, task: ImageTask): boolean {
  return (
    task.effectOnly &&
    !task.skipGate &&
    !isPlateTask(task) &&
    isSceneCut(task.sceneAs ?? task.section) &&
    (hasEnrichmentFeature(job.analysis, 'scene') || designcut2Enabled(job))
  )
}

/**
 * 컷 하나 — GIF 칸(task.motion, motionband 스위치 잡의 motion_band만, 세션 B ③ P3)은 motion/stage.ts가 움직이는 칸으로 만든다.
 * 재생성·재시도·편집기 재생성은 GIF를 다시 만들지 않고 정지 컷이다. 칸을 못 만들거나 예외면 정지 컷으로 내려가고 쓴 비용은 더한다(run을 멈추지 않는다).
 * motion이 없는 태스크는 정지 컷 그대로다
 */
function generateSection(ctx: GenerateContext, task: ImageTask): Promise<{ entry: SectionImage; costUsd: number }> {
  if (task.motion?.role === 'hero') return generateHeroMotion(ctx, task, task.motion)
  return motionOrStill(
    task.motion,
    isMotionRedo(ctx),
    (motion) =>
      buildMotionCell(
        motion,
        motionBasePrompt(ctx, task, 0),
        motionDepsOf({
          db: ctx.db,
          userId: ctx.userId,
          jobId: ctx.job.id,
          section: task.section,
          sourceRefs: ctx.sourceRefs,
          runContext: ctx.runContext,
          runStart: ctx.runStart ?? Date.now(),
          budgetMs: ctx.budgetMs,
          agentName: IMAGE_AGENT,
          ...motionEngineValuesOf(ctx.job),
        })
      ),
    (cell, out) => ({ section: task.section, url: cell.url, prompt: task.prompt, retried: false, motion: cell.motion, ...sentPromptRecord(out.sentPrompt) }),
    () => generateStillSection(ctx, task),
    (message) => console.warn(`[registration/pdp-image] '${task.section}' ${message}`)
  )
}

/**
 * 첫 화면 대표 칸(움직이는 칸 자리 규칙 ①) — 정지 대표 컷을 첫 프레임 기준·맨 끝 참조·포스터로 움직이는 WebP를 만든다.
 * 재생성·재시도이거나 못 만들면 정지 대표 컷을 포스터로 둔 칸(움직임 없음)으로 끝낸다 — 정지 컷을 새로 만들지 않고, 이미 쓴 비용만 더한다.
 * 대표 컷이 없으면(run은 hero 뒤에만 시작한다) 오류 칸이다
 */
async function generateHeroMotion(ctx: GenerateContext, task: ImageTask, motion: MotionTask): Promise<{ entry: SectionImage; costUsd: number }> {
  const warn = (message: string) => console.warn(`[registration/pdp-image] '${task.section}' ${message}`)
  const heroUrl = findSectionUrl(ctx.sectionImages, 'hero')
  const base = { section: task.section, prompt: task.prompt, retried: false }
  if (!heroUrl) return { entry: { ...base, url: '', error: '대표 컷이 없어 대표 칸을 만들지 않음' }, costUsd: 0 }
  const posterOnly = (reason: string, costUsd = 0) => {
    warn(`대표 칸을 정지 대표 컷으로 — ${reason}`)
    return { entry: { ...base, url: heroUrl, motion: heroPosterMotion([reason]) }, costUsd }
  }
  if (isMotionRedo(ctx)) return posterOnly('재생성·재시도는 움직임을 다시 만들지 않음')
  const image = await styleRefOf(ctx, heroUrl)
  if (!image) return posterOnly('정지 대표 컷 받기 실패')
  try {
    const out = await buildMotionCell(
      motion,
      motionBasePrompt(ctx, task, 1),
      motionDepsOf({
        db: ctx.db,
        userId: ctx.userId,
        jobId: ctx.job.id,
        section: task.section,
        sourceRefs: ctx.sourceRefs,
        runContext: ctx.runContext,
        runStart: ctx.runStart ?? Date.now(),
        budgetMs: ctx.budgetMs,
        agentName: IMAGE_AGENT,
        tailRefs: [image],
        ...motionEngineValuesOf(ctx.job),
      }),
      { url: heroUrl, image }
    )
    if (!out.cell) {
      const poster = posterOnly(out.reasons.join(' · ') || '까닭 기록 없음', out.costUsd)
      return { ...poster, entry: { ...poster.entry, ...sentPromptRecord(out.sentPrompt) } }
    }
    const note = motionFallbackNote(out.cell.motion, out.reasons)
    if (note) warn(note)
    return { entry: { ...base, url: out.cell.url, motion: out.cell.motion, ...sentPromptRecord(out.sentPrompt) }, costUsd: out.costUsd }
  } catch (e) {
    return posterOnly(`예외: ${(e instanceof Error ? e.message : String(e)).slice(0, 200)}`)
  }
}

/**
 * 컷 프롬프트(재생성·구도·편집기 지시 전) — 정지 컷과 움직이는 칸이 같이 쓴다(점검 고침 2: 움직이는 칸도 식별 카드·인쇄 규칙·참조 안내·헌장·부품 규칙을 거친다).
 * refs.styleRef = 대표 컷을 스타일 참조로 붙였는가, keptRefs = 붙인 상품 실물 사진 수. 뒤 단계가 쓰는 값을 함께 돌려준다
 */
function cutPromptOf(ctx: GenerateContext, task: ImageTask, refs: { styleRef: boolean; keptRefs: number }) {
  const commonGrounding = ctx.taskGrounding?.(task) ?? ctx.imageGroundingBlock
  // 상품 없는 컷(J49) — 학부모 장면 블록의 '준비된 결과' 예시를 뺀다. 다른 컷·학부모 대리가 아닌 잡은 그대로
  const grounding = task.noProductCut ? withoutPreparedResult(commonGrounding) : commonGrounding
  const d2 = designcut2Enabled(ctx.job)
  // D2 잡의 단색 바탕 상품 컷(세트 장면이 아닌 상품 컷)은 세트 장면 히어로에서 빛·색감만 받는다
  const cutKind = task.sceneAs ?? task.section
  const solidRef = d2 && !isD2ProductSceneCut(cutKind) && !isSceneCut(cutKind)
  // 참조 안내문(REFERENCE ROLES)은 실제로 참조를 붙이는 컷에만 — effectOnly 컷에 붙으면 없는 첨부를 가리킨다
  // herotype 첫 화면 — 실패한 앞 시도가 남긴 단계만큼 내려간다. 끝까지 내려가면 원래 프롬프트로 돌아간다
  const heroLevel = task.heroKind ? (ctx.sectionImages.find((s) => s.section === task.section)?.heroFallback ?? 0) : 0
  const basePrompt = heroLevel >= HERO_STUDIO_LEVEL && task.studioPrompt ? task.studioPrompt : task.prompt
  let prompt = assemblePrompt(
    basePrompt,
    task,
    ctx.designPrompts,
    !task.effectOnly && refs.styleRef,
    grounding,
    task.effectOnly && refs.styleRef,
    // 사진 다양화(shotvary K 컷, F4) — 대표 컷에서 정체성·옷·빛만 받고 자세·표정·구도는 따르지 않는다. 표지가 없는 컷은 지금 문구 그대로
    `${solidRef ? D2_SOLID_REFERENCE_ROLES_TEXT : REFERENCE_ROLES_TEXT}${task.varyRefs ? ` ${varyReferenceText(task.varyRefs)}` : ''}`,
    printIdentityBlock({
      textBearing: isTextBearingJob(ctx.job),
      photoCount: task.effectOnly ? ctx.sourceRefs.length : refs.keptRefs,
      identityCard: ctx.designPrompts.identity_card,
    })
  )
  // K 대표 컷·움직이는 칸(점검 고침 2, 오너 2026-11-07 00:06 승인) — 스타일 참조가 없어 REFERENCE ROLES가 붙지 않던 컷에 '첫 사진 = 상품 구조 정본' 안내와 Refs 줄.
  // K 라인 잡(templatelib 기록)의 hero·motion 태스크만이다 — D·R·Track S 잡과 다른 컷은 바이트 그대로
  if (productRefRolesCut(ctx.job, task, refs.styleRef)) prompt = `${prompt}\n\n${productRefRolesText(refs.keptRefs, task.motion?.role === 'hero')}`
  // 디자인 컷 플레이트(D1): 글자·제품 없는 무대 — 식별카드·참조 안내·스타일 헌장·연출(E-4) 블록 없이 플레이트 지시 + 연령 블록만
  if (isPlateTask(task)) prompt = [task.prompt, ctx.plateGrounding].filter(Boolean).join('\n\n')
  // R2 장면 컷 — scene 스위치가 켜진 잡만(기본 off, 플레이트 제외): 장면 컷은 헌장 단색 바탕 대신 세트, 피처 bgSub 바탕 줄은 뺀다.
  // D2(designcut2 잡, C2)는 상품 컷(첫 화면·POINT·마무리)도 세트 안 장면 + 역할별 거리
  // D2-3 첫 화면 컷은 위 1/3 글자 자리 블록을 더 붙인다(재생성이면 미달 사유를 덧붙인 강화 지시)
  // K 라인 첫 화면은 글이 사진 밖 칸에 있어 글자 자리를 비우지 않는다
  const copyZoneCut = d2 && !isPlateTask(task) && task.section === 'hero' && !hasEnrichmentFeature(ctx.job.analysis, 'templatelib')
  if (!isPlateTask(task) && d2) {
    prompt = applyD2SceneCut(prompt, cutKind, d2PointChapterOf(ctx.job.section_plan.designcut, task.section))
    if (copyZoneCut) prompt = withCopyZone(prompt, task.section, ctx.copyZoneRetry)
  }
  else if (!isPlateTask(task) && hasEnrichmentFeature(ctx.job.analysis, 'scene')) prompt = applySceneCut(prompt, task.section)
  // 컷 목적(shotdiv) — 디자인 컷 장면 블록 뒤라 거리 지시를 이긴다. 기록에 없는 컷은 그대로
  const shotdiv = shotdivEnabled(ctx.job)
  if (shotdiv && !isPlateTask(task)) {
    prompt = applyShotPurpose(prompt, task.section, readExtraShots(ctx.job.section_plan.extra_shots), ctx.job.spec_sheet.size, shotPurposeContextOf(ctx.job))
  }
  // K 컷 지시 — 장면 블록 뒤라 거리·구도 지시를 이긴다. 기록이 없는 잡은 칸이 없다
  if (task.shotBrief) prompt = `${prompt}\n\n${task.shotBrief}`
  // 새 단계 연출 감독(R10) — 감독이 끝난 잡의 지시가 있는 컷만 컷 지시 뒤에 한 줄(빛·세트·컷 지시). 꺼진 잡·지시 없는 컷은 null이라 그대로
  // 상품 없는 컷(J49)은 감독의 컷별 지시 문장 없이 빛·세트만
  const direction = isPlateTask(task) ? null : directorLineFor(ctx.designPrompts, task.section, { lightSetOnly: task.noProductCut === true })
  if (direction) prompt = `${prompt}\n\n${direction}`
  // 손·착용·사용 컷의 실물 쓰는 법(점검 고침 3) — 컷 지시 바로 뒤. 재료는 판매자 메모·식별 카드의 쓰는 법 문장뿐이고 없으면 Use 줄을 빼고 기록한다.
  // 움직이는 칸은 GIF 지시(gifPromptOf)가 같은 바르게 쓰기 문장을 이미 담아 Use 줄만 붙인다.
  // usefacts 잡(결정 카드 c02)은 재료가 식별 카드 USE 줄·사용 순서 입력(없으면 카피 howTo)뿐이다 — 카드 머리말·문장은 쓰지 않는다
  let useMissing = false
  if (task.useCut) {
    const use = hasEnrichmentFeature(ctx.job.analysis, 'usefacts')
      ? handlingLinesOfUseFacts(ctx.designPrompts.identity_use, ctx.job.spec_sheet.usageSteps, ctx.job.copy_sections.final?.howTo)
      : handlingLinesOf(handlingFactsOf(ctx.job.spec_sheet.identityNote, ctx.designPrompts.identity_card))
    const lines = task.motion ? use.lines.filter((line) => !line.startsWith('Correct use:')) : use.lines
    if (lines.length > 0) prompt = `${prompt}\n\n${lines.join('\n')}`
    useMissing = use.missing
  }
  // 상품 컷 부품 수 규칙 — partsrule 기록 잡의 상품 컷만(장면·목적 블록 뒤라 식별 카드 위치와 동작이 부딪힐 때 이긴다)
  if (!isPlateTask(task) && !task.effectOnly && hasEnrichmentFeature(ctx.job.analysis, 'partsrule')) prompt = withPartsRule(prompt)
  // 첫 화면 사진 유형 — 장면·글자 자리 블록 뒤라 거리·세트 지시를 이긴다. 기록 잡의 첫 화면만
  if (task.heroKind) {
    const block = heroKindBlock(task.heroKind, heroLevel)
    if (block) prompt = `${prompt}\n\n${block}`
  }
  // R1 빛·색온도 정본 — light 스위치가 켜진 잡만(기본 off, 플레이트 제외). 헌장이 없는 프롬프트는 그대로다
  if (!isPlateTask(task) && hasEnrichmentFeature(ctx.job.analysis, 'light')) prompt = canonLight(prompt).prompt
  // 규칙 충돌 정리(점검 고침 4) — rulepriority 기록 잡만(기본 off, 플레이트 제외). 모든 블록이 붙은 뒤라 순위 블록이 맨 끝에 온다
  if (!isPlateTask(task) && hasEnrichmentFeature(ctx.job.analysis, 'rulepriority')) prompt = applyRulePriority(prompt).prompt
  // E4·P1-5 브리프 정리 — brief 스위치가 켜진 잡만(기본 off, 플레이트 제외). 게이트·편집기 재생성 지시는 정리 뒤에 붙인다.
  // Gemini는 크기 인자를 받지 않아 비율 줄을 남긴다
  if (!isPlateTask(task) && hasEnrichmentFeature(ctx.job.analysis, 'brief')) {
    // 요청에서 비율을 받는 모델이면 프롬프트의 비율 줄을 뺀다 — Nano Banana 2.1은 imageConfig로 받는다(블라인드 시험 11-05), 그 밖의 Gemini는 지금처럼 남긴다
    const sizeHonored = honorsImageSize(task.model ?? ctx.job.image_model)
    prompt = tidyImageBrief(prompt, { sizeHonored }).prompt
  }
  return { prompt, basePrompt, heroLevel, copyZoneCut, d2, shotdiv, useMissing }
}

/** 움직이는 칸 바탕 지시 — 정지 컷과 같은 조립(식별 카드·인쇄 규칙·참조 안내·헌장·장면·컷 지시·부품 규칙). tail = 맨 끝에 더 붙는 참조 수(대표 칸 1) */
function motionBasePrompt(ctx: GenerateContext, task: ImageTask, tail: number): string {
  // 참조 상한은 그 잡의 움직이는 칸 모델 것 — 꺼진 잡은 2.6(지금 그대로), motioncodex 잡은 구독 이미지 5장(AX-CT-35)
  const keptRefs = fitSourceRefs(ctx.sourceRefs, tail, maxReferencesOf(motionRefModelOf(ctx.job))).kept.length
  return cutPromptOf(ctx, task, { styleRef: false, keptRefs }).prompt
}

/** 컷 1개 생성 + 업로드. 실패는 throw하지 않고 error가 실린 SectionImage로 흡수(§6.4 — 섹션만 실패). */
async function generateStillSection(ctx: GenerateContext, task: ImageTask): Promise<{ entry: SectionImage; costUsd: number }> {
  // 편집기 '지금 컷을 바탕으로'(P1-4): 지금 컷을 참조 맨 끝에 붙여 그 컷을 고친다. 페이지 스타일은 그 컷이 이미 담고 있고
  // STYLE REFERENCE 안내가 '맨 끝 = hero 컷'이라 hero 스타일 참조는 뺀다. 받지 못하면 예전처럼 만든다(지시문에도 안 쓴다)
  const currentUrl =
    ctx.editorRegen?.useCurrent && !isPlateTask(task)
      ? ctx.sectionImages.find((s) => s.section === task.section && s.url && !s.error)?.url
      : undefined
  const currentRef = currentUrl ? await fetchImageAsBase64(currentUrl, STYLE_REF_FETCH_MS) : null
  const heroUrl = task.section === 'hero' || currentRef ? undefined : findSectionUrl(ctx.sectionImages, 'hero')
  // effectOnly 컷(제품 미등장)은 참조를 첨부하지 않으므로 스타일 참조도 받지 않는다. R2(scene 기록 잡)의 상품 없는 장면 컷만
  // 히어로를 빛·배경 톤·색감 참조로 붙인다(상품 사진은 붙이지 않는다)
  const sceneRefCut = sceneStyleRefCut(ctx.job, task)
  const styleRef = heroUrl && (!task.effectOnly || sceneRefCut) ? await styleRefOf(ctx, heroUrl) : null
  // 개정 5: 저가 컷(rating_bg·USP 아이콘 폴백)은 태스크 지정 모델·품질이 잡 선택값을 이긴다(lowCostCut)
  const model = task.model ?? ctx.job.image_model
  const tailRefs = [...(styleRef ? [styleRef] : []), ...(currentRef ? [currentRef] : [])]
  // 모델 참조 상한 — 넘으면 코덱스 이미지 도구가 컷을 포기한다(R13 P01). 맨 앞(상품 실물)·맨 끝(스타일)은 프롬프트가 자리로 부르므로 지키고 뒤쪽 원천 사진을 뺀다
  const fit = task.effectOnly ? { kept: [], dropped: 0 } : fitSourceRefs(ctx.sourceRefs, tailRefs.length, maxReferencesOf(model))
  if (fit.dropped > 0) {
    console.warn(`[registration/pdp-image] '${task.section}' 참조 상한 ${maxReferencesOf(model)}장(${model}) — 원천 사진 ${ctx.sourceRefs.length}장 중 ${fit.dropped}장 뺌`)
  }
  const refs = [...fit.kept, ...tailRefs]

  const { prompt: cutPrompt, basePrompt, heroLevel, copyZoneCut, d2, shotdiv, useMissing } = cutPromptOf(ctx, task, { styleRef: Boolean(styleRef), keptRefs: fit.kept.length })
  let prompt = cutPrompt
  // 상품 없는 컷(J49)은 글자·브랜드 사유만 지시를 붙이고, 기본 프롬프트가 일반 글자 금지 판이라 인쇄 보존 판 지시를 쓰지 않는다
  if (ctx.regenScore && (!task.noProductCut || isNoProductRegenReason(ctx.regenScore))) {
    prompt = applyRegenDirective(prompt, ctx.regenScore, task.noProductCut ? false : isTextBearingJob(ctx.job))
  }
  if (ctx.angleOf) prompt = withAngleRetry(prompt, ctx.angleOf)
  const editorDirective = ctx.editorRegen
    ? buildEditorRegenDirective(ctx.editorRegen, ctx.job, { currentRef: Boolean(currentRef) })
    : ''
  if (editorDirective) prompt = `${prompt}\n\n${editorDirective}`
  // 장면 안전(J60, MS 2k만) — nsfw로 끝난 첫 시도의 재시도는 욕실 밖 손 구도 지시로, 그 밖에는 샤워·목욕 장면 사람 컷에만 옷 입은 가슴 위
  // 구도 줄을 붙인다. 첫 화면 유형 컷(heroKind)은 자기 단계 내리기(손·손목 → 스튜디오)가 맡는다. 해당 없는 지시는 바이트 그대로
  const nsfwRetry =
    Boolean(ctx.errorRetry) && !task.heroKind && ctx.sectionImages.find((s) => s.section === task.section)?.contentRejected === 'nsfw'
  const sceneSafety = isAsyncImageModel(model) ? sceneSafetyOf(prompt, nsfwRetry) : null
  if (sceneSafety) prompt = sceneSafety.prompt
  // 보여 줄 동작·설계(showbeat 잡, J63, MS 2k만) — 그 문장 때문에 맞추기가 블록을 더 덜거나 5,000자를 넘으면 문장만 빼고 보낸다(J59 켬 k3·k1 실측).
  // 문장이 없는 컷·지금 배치 모델은 지나가지 않는다(바이트 그대로)
  const showBeat = showBeatFit(prompt, task.showBeatLine, isAsyncImageModel(model))
  if (showBeat) prompt = showBeat.prompt
  // 새 배치 MS 2k(R07b) — 상한 5000자 2단 맞추기(덜 블록·짧은 MS 문구, ms-prompt-fit). 재생성·편집기 지시까지 붙인 글에 한다.
  // 지금 배치 모델(2.6 high·NB 등)은 지나가지 않는다 — 지시 바이트 그대로. 끝까지 넘으면 아래 try 첫 줄이 보내지 않고 그 컷을 멈춘다
  // 체감 결과 문장 가드(J65, MS 2k만) — 문장 때문에 블록이 더 덜리거나 상한을 넘으면 그 컷은 문장만 뺀다. 문장 없는 지시는 지금처럼 맞춘다
  const effectFit = isAsyncImageModel(model) ? effectShotFitOf(prompt) : null
  const msFit = effectFit ? effectFit.fit : isAsyncImageModel(model) ? fitMsPrompt(prompt) : null
  if (msFit) prompt = msFit.prompt
  const msFitRecord =
    msFit && (msFit.dropped.length > 0 || msFit.compacted.length > 0)
      ? { dropped: msFit.dropped, originalLength: msFit.originalLength, ...(msFit.compacted.length > 0 ? { compacted: msFit.compacted } : {}) }
      : null
  // 구도 중복 재생성도 컷당 재생성 1회 예산을 쓴다(게이트 재생성과 같은 표지)
  const retried = Boolean(ctx.regenScore || ctx.angleOf)
  // 첫 신규 생성의 실패만 재시도 대기로 남긴다 — 게이트 재생성·재시도의 실패는 끝난 실패. 편집기 재생성은 실패하면 이 항목을
  // 버리고 이전 항목을 둔다(pdp-image-regen runEditorRegenFlow)
  const firstAttempt = !ctx.regenScore && !ctx.errorRetry && !ctx.copyZoneRetry && !ctx.angleOf
  // 비동기 공급자(MS 2k, R05) — 앞 run이 기한 안에 받지 못한 요청이 있으면 다시 제출하지 않고 이어 받는다(첫 생성·그 재시도만 이월한다)
  const priorEntry = ctx.sectionImages.find((s) => s.section === task.section)
  const resume = ctx.errorRetry && priorEntry?.imagePending?.model === model ? priorEntry.imagePending : undefined
  const mayCarry = firstAttempt || Boolean(ctx.errorRetry)

  // 생성 자체가 성공하면 즉시 비용을 확정한다 — 이후 업로드 단계에서 실패해도(네트워크·스토리지 장애)
  // 이미 발생한 생성 비용은 보존해야 한다(§6.4, catch에서도 이 값을 그대로 반환).
  let costUsd = 0
  // 받은 비동기 요청(MS 2k) — 받은 뒤 저장에서 실패하면 이 요청을 남겨 다음 run이 다시 제출하지 않고 받는다(R08a)
  let asyncRequest: ImagePendingRequest | undefined
  try {
    // 맞추기 단계를 모두 써도 넘으면 공급자에 보내지 않고, 남은 블록을 적은 오류로 그 컷을 멈춘다(AX-CT-32 — 공급자 오류는 '덜어 낸 블록 0개'만 남았다)
    if (msFit && !msFit.fits) throw new Error(msOverflowMessage(msFit))
    const result = await generateImage({
      prompt,
      model,
      quality: task.quality ?? ctx.job.image_quality,
      size: ASPECT_TO_SIZE[task.aspectRatio] ?? '1024x1024',
      referenceImages: refs.map((r) => ({ base64: r.data, mimeType: r.mediaType })),
      agentName: 'registration/pdp-image',
      // 비동기 공급자(MS 2k)만 run 기한(마지막 업로드·저장 몫을 뺀 시각)까지 기다린다 — 지금 배치(OpenAI·Gemini) 호출 인자는 그대로
      ...(isAsyncImageModel(model) ? { deadlineAt: (ctx.runStart ?? Date.now()) + ctx.budgetMs - ASYNC_SAVE_MARGIN_MS } : {}),
      ...(resume ? { resume } : {}),
      runContext: {
        ...ctx.runContext,
        stage: ctx.regenScore
          ? `images/${task.section}/regenerate`
          : ctx.editorRegen
            ? `images/${task.section}/editor`
            : ctx.copyZoneRetry
              ? `images/${task.section}/copy-zone`
              : ctx.angleOf
                ? `images/${task.section}/angle`
                : `images/${task.section}`,
      },
    })
    // 실비용 모델(GPT Image 2.5 실험)은 생성 결과의 usage 비용, 그 밖은 지금처럼 단가표
    costUsd = result.costUsd ?? estimateImageCostUsd(model, task.quality ?? ctx.job.image_quality)
    asyncRequest = result.asyncRequest
    // USP 아이콘만 흰 배경을 키잉해 투명 PNG로 — 카드 배경이 비쳐 흰 사각형이 사라진다(변환 못 하면 원본 유지)
    const image = isUspIconSection(task.section) ? await toTransparentInk(result) : result
    // MS 2k(R08a)만 저장 상한(5,000,000바이트)에 맞춘다 — 넘을 때만 WebP로 바꿔 올리고 기록한다. 지금 배치는 받은 바이트 그대로 올린다
    const stored: PdpUploadImage = isAsyncImageModel(model) ? await fitPdpUpload(image) : { base64: image.base64, mimeType: image.mimeType }
    const url = await uploadPdpImage(ctx.db, ctx.userId, ctx.job.id, task.section, stored.base64, stored.mimeType)
    // D2-3 첫 화면 컷은 글자 자리를 잰다($0 — 재지 못하면 사유만 남는다)
    const copyZone = copyZoneCut ? await measureHeroCopyZone(image.base64, ctx.copyZoneRetry ? 2 : 1) : null
    // D2 상품 장면 컷은 실제 가로/세로를 남긴다 — 편집기 장면 모드가 풀폭 사진 높이·글자 자리를 이 비율로 잰다(D2-2b, 장식 단계도 같은 값)
    const imageAspect = d2 && !isPlateTask(task) && isD2ProductSceneCut(task.section) ? imageAspectFromBase64(image.base64) : null
    // shotdiv 잡의 상품 컷은 구도 지문을 남긴다($0 — 재지 못하면 없음, 구도 중복을 판정하지 않는다)
    // shotvary 잡은 대표 컷과 상품이 나오는 K 컷도 지문을 남긴다(F5 — 기록만, 다시 만들지 않는다)
    const lineCut = shotvaryEnabled(ctx.job) && (task.section === 'hero' || (Boolean(task.varyRefs) && !task.effectOnly && isLineCompositionCut(task.section)))
    const dhash = (shotdiv && isCompositionCut(task.section)) || lineCut ? await dHashOf(image.base64) : null
    // 사이즈 단독 컷·K 치수 칸 컷은 제품 경계를 잰다($0 — 재지 못하면 치수선 없이 글자만)
    const productBox = task.section === SIZE_SINGLE_SECTION || task.measuresProduct ? await measureProductBox(image.base64) : null
    // 컷 밝기·채도(결정 카드 c29 — 기록만, $0). 사진 컷만(아이콘·배경 플레이트·GIF는 뺀다), 재지 못하면 없음. 페이지 편차·경고는 원장(pageToneSpread).
    // 이미지 머리가 없으면 기다리지 않고 지나간다(hasImageSignature)
    const toneCut = !isUspIconSection(task.section) && !isPlateTask(task) && image.mimeType !== 'image/gif' && hasImageSignature(image.base64)
    const tone = toneCut ? await measureCutTone(image.base64) : null
    // 코덱스 전용 홈 컷은 재작성 기록을 같이 남긴다(E1 — 재생성으로 url이 바뀌면 항목째 바뀐다)
    return {
      entry: {
        section: task.section,
        url,
        prompt: basePrompt,
        retried,
        // 공급자 상한에 맞춰 덜어 냈으면 실제로 보낸 글과 덜어 낸 블록 머리를 남긴다(MS 2k)
        ...sentPromptRecord(result.sentPrompt ?? prompt),
        // 2단 기록(원래 길이·덜고 바꾼 것)과 공급자 기록(그 뒤에 더 덜어 낸 머리)을 잇는다 — 하나만 있으면 그것
        ...((promptFit) => (promptFit ? { promptFit } : {}))(
          msFitRecord && result.promptFit ? { ...msFitRecord, dropped: [...msFitRecord.dropped, ...result.promptFit.dropped] } : (msFitRecord ?? result.promptFit)
        ),
        ...(useMissing ? { useFacts: 'none' as const } : {}),
        ...(sceneSafety ? { sceneSafety: sceneSafety.kind } : {}),
        ...(showBeat ? { showBeat: showBeat.kind, ...(task.showBeatSource ? { showBeatSource: task.showBeatSource } : {}) } : {}),
        ...(effectFit ? { effectShot: effectFit.effectShot } : {}),
        ...(fit.dropped > 0 ? { refsDropped: fit.dropped } : {}),
        ...(stored.uploadFit ? { uploadFit: stored.uploadFit } : {}),
        ...(result.codexTrace ? { codexTrace: result.codexTrace } : {}),
        ...(task.heroKind ? { heroKind: heroKindAt(task.heroKind, heroLevel), ...(heroLevel > 0 ? { heroFallback: heroLevel } : {}) } : {}),
        ...(copyZone ? { copyZone } : {}),
        ...(imageAspect ? { imageAspect } : {}),
        ...(dhash ? { dhash } : {}),
        ...(productBox ? { productBox } : {}),
        ...(tone ? { tone } : {}),
      },
      costUsd,
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    const prior = priorEntry
    // 기한 안에 받지 못했다(실패 아님) — 첫 생성·그 재시도는 요청을 남겨 다음 run이 이어 받는다. 다른 시도(게이트·각도 재생성·편집기·글자 자리)는
    // 이월 규칙이 따로라 지금처럼 끝난 실패로 둔다(요청 ID를 글에 남긴다)
    if (e instanceof ImagePendingError && mayCarry) {
      console.warn(`[registration/pdp-image] '${task.section}' ${message}`)
      return {
        entry: {
          ...(prior ?? {}),
          section: task.section,
          url: prior?.url ?? '',
          prompt: basePrompt,
          error: `${task.section} 생성 중 — 다음 run에서 이어 받음(${e.pending.requestId})`,
          retried,
          ...sentPromptRecord(prompt),
          ...(msFitRecord ? { promptFit: msFitRecord } : {}),
          retryPending: true,
          imagePending: e.pending,
        },
        costUsd: 0,
      }
    }
    // 받은 뒤 저장(업로드 등)에서 실패했다(R08a, MS 2k) — 다시 제출하면 한 번 더 과금되니 받은 요청을 남겨 다음 run이 받기만 한다
    // (billed: 사용량·비용을 다시 적지 않는다). 첫 생성·그 재시도만 이월하고, 이어 받을 수 있는 시간(IMAGE_PENDING_MAX_MS)이 지나면
    // 공급자가 이어 받지 않고 오류를 내 그 재시도에서 끝난 실패가 된다. 이번에 받은 비용은 그대로 센다
    if (asyncRequest && mayCarry) {
      console.warn(`[registration/pdp-image] '${task.section}' 받은 뒤 저장 실패 — 다음 run에서 같은 요청을 다시 받음: ${message}`)
      return {
        entry: {
          ...(prior ?? {}),
          section: task.section,
          url: prior?.url ?? '',
          prompt: basePrompt,
          error: `${task.section} 받은 뒤 저장 실패 — 다음 run에서 같은 요청을 다시 받음(${asyncRequest.requestId}): ${message}`,
          retried,
          ...sentPromptRecord(prompt),
          ...(msFitRecord ? { promptFit: msFitRecord } : {}),
          retryPending: true,
          imagePending: { ...asyncRequest, billed: true },
        },
        costUsd,
      }
    }
    // 공급자 잔액 부족(R12c) — 컷 탓이 아니고 충전 전에는 다시 내도 같은 실패다. run에 알려 새 MS 컷을 멈추고 단계 오류로 끝낸다.
    // 첫 생성·그 재시도는 재시도 1번을 쓰지 않은 채 대기로 남긴다(providerBlocked → 다음 시도가 첫 시도, 죽은 요청 imagePending은 버린다).
    // 다른 시도(게이트·각도 재생성·편집기·글자 자리)는 아래 끝난 실패 글에 같은 사유가 남는다(게이트 재생성은 gateAndMaybeRegen이 이월한다)
    const balance = e instanceof ImageProviderBalanceError
    if (balance) ctx.onProviderBlocked?.(message)
    if (balance && mayCarry) {
      console.warn(`[registration/pdp-image] '${task.section}' 생성 보류(재시도로 세지 않음): ${message}`)
      const kept: Partial<SectionImage> = { ...(prior ?? {}) }
      delete kept.imagePending
      return {
        entry: {
          ...kept,
          section: task.section,
          url: prior?.url ?? '',
          prompt: basePrompt,
          error: `${task.section} 생성 보류 — ${message}`,
          retried,
          ...sentPromptRecord(prompt),
          ...(msFitRecord ? { promptFit: msFitRecord } : {}),
          retryPending: true,
          providerBlocked: 'balance',
        },
        costUsd,
      }
    }
    // herotype 첫 화면 — 사람이 나오는 컷은 거부될 수 있어 한 단계 내려 다시 시도한다(고른 유형 → 손·손목만 → 스튜디오). 스튜디오까지 실패하면 끝난 실패다.
    // 앞 사진이 있으면(재생성 실패) 그 사진을 둔다
    const heroStepDown = Boolean(task.heroKind) && task.heroKind !== 'studio' && !prior?.url && heroLevel < HERO_STUDIO_LEVEL
    return {
      entry: {
        section: task.section,
        url: prior?.url ?? '',
        prompt: basePrompt,
        error: `${task.section} 생성 실패: ${message}`,
        retried,
        ...sentPromptRecord(prompt),
        // MS 2k 맞추기를 했으면 무엇을 덜고 바꿨는지 남긴다(끝까지 넘은 실패의 진단)
        ...(msFitRecord ? { promptFit: msFitRecord } : {}),
        ...(useMissing ? { useFacts: 'none' as const } : {}),
        ...(fit.dropped > 0 ? { refsDropped: fit.dropped } : {}),
        // 내용 검사 거절(J60) — 첫 시도면 다음 run의 재시도 1번이 안전 장면 지시로 부른다(재시도의 거절은 끝난 실패, 기록만)
        ...(e instanceof ImageContentRejectedError ? { contentRejected: e.status } : {}),
        ...(sceneSafety ? { sceneSafety: sceneSafety.kind } : {}),
        ...(showBeat ? { showBeat: showBeat.kind, ...(task.showBeatSource ? { showBeatSource: task.showBeatSource } : {}) } : {}),
        ...(effectFit ? { effectShot: effectFit.effectShot } : {}),
        ...(firstAttempt || heroStepDown ? { retryPending: true } : {}),
        ...(heroStepDown ? { heroFallback: heroLevel + 1 } : {}),
        // D2-3 이전 컷으로 돌아가면 그 컷의 글자 자리 기록도 남긴다(구도 지문·중복 판정도 그 컷의 것)
        ...(copyZoneCut && prior?.copyZone ? { copyZone: prior.copyZone } : {}),
        ...(prior?.url && prior.dhash ? { dhash: prior.dhash } : {}),
        // 이전 컷으로 돌아가면 그 컷의 제품 경계도 남긴다
        ...(prior?.url && prior.productBox ? { productBox: prior.productBox } : {}),
        ...(prior?.url && prior.compositionTwin ? { compositionTwin: prior.compositionTwin } : {}),
        ...(prior?.url && prior.lineTwin ? { lineTwin: prior.lineTwin } : {}),
      },
      costUsd,
    }
  }
}

/**
 * Vision 게이트 1회 — 게이트 없는 컷은 skip, 판정하지 못한 경우(참조 없음·시간 부족·받기 실패·채점 실패)는 사유를 단 skip
 * (일반 생성은 시간 부족만 게이트 대기로 남기고 나머지는 통과와 같은 처리, 편집기 재생성은 판정 못 한 이미지를 받지 않는다).
 * 미달이면 사유 점수를 돌려준다.
 */
async function judgeSection(
  ctx: GenerateContext,
  task: ImageTask,
  entry: SectionImage,
  runStart: number,
  /** 시도 시간이 이보다 짧으면 부르지 않고 시간 부족으로 돌려준다(새 배치 일반 생성만 — R12e). 없으면 지금처럼 남은 시간만큼 부른다 */
  minAttemptMs?: number
): Promise<GateVerdict> {
  if (task.skipGate) return { verdict: 'skip', costUsd: 0 }
  if (!entry.url) return { verdict: 'skip', unjudged: '이미지 없음', costUsd: 0 }
  if (ctx.sourceRefs.length === 0) return { verdict: 'skip', unjudged: '원천 사진 없음', costUsd: 0 }

  // 남은 시간이 모자라면 이번 run에는 게이트를 보지 않는다(일반 생성은 게이트 대기로 남아 다음 run 맨 앞에서 판정) — 기다리다
  // run 상한(504)을 넘기면 진행 중인 다른 컷의 생성(유료)까지 잃는다. 빠듯하면 시도 상한을 남은 시간에 맞추고 재시도하지 않는다
  const remaining = ctx.budgetMs - (Date.now() - runStart)
  if (remaining < GATE_MIN_MS) {
    console.warn(`[registration/pdp-image] '${task.section}' 게이트 대기 — run 시간 예산 부족(남은 ${remaining}ms), 다음 run 맨 앞에서 판정`)
    return { verdict: 'skip', unjudged: GATE_TIME_SHORT, costUsd: 0 }
  }
  const plan = gateCallPlan()
  const limits =
    remaining >= plan.fullMs ? undefined : { timeoutMs: Math.min(plan.attemptMs, remaining - GATE_FETCH_MS), maxRetries: 0 }
  if (limits && minAttemptMs !== undefined && limits.timeoutMs < minAttemptMs) {
    console.warn(`[registration/pdp-image] '${task.section}' 게이트 대기 — 시도 시간 ${limits.timeoutMs}ms < ${minAttemptMs}ms, 다음 run 맨 앞에서 판정`)
    return { verdict: 'skip', unjudged: GATE_TIME_SHORT, costUsd: 0 }
  }

  const generatedImg = await fetchImageAsBase64(entry.url)
  if (!generatedImg) return { verdict: 'skip', unjudged: '생성 이미지 받기 실패', costUsd: 0 }

  // K 컷(점검 고침 1·3) — 원본 여러 장(상한 4)과 부품 판정, 사람·손 컷은 사용 판정까지 같은 한 번의 호출로 묻는다. D·운영 기본 컷은 지금 그대로(원본 1장)
  const line = Boolean(task.lineGate)
  // 기대 쓰는 법(usegate 잡의 사용 판정 컷, c08·J19) — 식별 카드 USE 줄이 있을 때만. 꺼진 잡은 판정 옵션이 지금과 같다
  const expectedUse = strictUseGateOf(ctx.job, task) ? gateExpectedUseOf(ctx.designPrompts.identity_use) : null
  const { score, costUsd, truncated, callFailed } = await judgeImageGate(
    line ? ctx.sourceRefs.slice(0, GATE_REF_MAX) : ctx.sourceRefs[0],
    task.section,
    generatedImg,
    { ...ctx.runContext, stage: `images/${task.section}/gate` },
    limits,
    line
      ? { ...gatePromptOptionsOf(task), partsCheck: true, ...(task.useGate ? { useCheck: true } : {}), ...(expectedUse ? { expectedUse } : {}) }
      : gatePromptOptionsOf(task)
  )
  if (!score) return { verdict: 'skip', unjudged: truncated ? GATE_UNDECIDED_TRUNCATED : '채점 실패', costUsd, ...(callFailed ? { callFailed } : {}) }

  // 실패 기록은 크기 칸까지 남기고, 사유는 크기를 뺀 점수로 정한다(크기 단독은 위 기준에서 이미 통과)
  // 상품 없는 컷(J49 decide 24)은 같은 상품·일관성 판정을 미달로 보지 않고 글자·브랜드만 본다 — 판정 콜은 지금 그대로
  const failed = task.noProductCut ? isNoProductGateFailure(score) : line ? isLineGateFailure(score) : isGateFailure(score)
  if (failed) return { verdict: 'fail', score, reason: classifyGateFailure(withoutSizeScore(score)), costUsd }
  // 미달 신호가 없어도 점수가 빠진 응답({}·오류 객체)은 통과로 보지 않는다(일반 흐름은 skip도 통과라 동작이 같다)
  if (typeof score.consistency !== 'number') return { verdict: 'skip', unjudged: '채점 응답에 점수 없음', costUsd }
  return { verdict: 'pass', score, costUsd }
}

/**
 * 생성 직후(또는 앞 run이 남긴 게이트 대기의) Vision 게이트 — 미달 시 시간 여유가 있으면 즉시 재생성 1회, 없으면 이월 표시만.
 * 시간이 모자라 판정하지 못하면 게이트 대기(gatePending)로 남긴다 — 통과로 치지 않는다. gate = 이 컷의 판정(로그용)
 */
async function gateAndMaybeRegen(
  ctx: GenerateContext,
  task: ImageTask,
  entry: SectionImage,
  runStart: number
): Promise<{ entry: SectionImage; costUsd: number; gate: GateVerdict }> {
  // GIF 칸 entry는 일반 게이트·shotdiv 쌍·글자 자리 재생성을 타지 않는다 — 3×3 프레임 모음 검사가 이 칸의 게이트다(세션 B ③ P3)
  const motionSkip = motionGateSkip(entry)
  if (motionSkip) return { entry, costUsd: 0, gate: motionSkip }
  // 새 배치 일반 생성(R12e) — 시도 시간을 60초 아래로 줄여 부르지 않고, 채점 호출 실패는 통과로 받지 않는다
  const newBatch = ctx.job.model_batch === 'new'
  const gate = await judgeSection(ctx, task, entry, runStart, newBatch ? GATE_NEW_BATCH_MIN_ATTEMPT_MS : undefined)
  const gateCost = gate.costUsd
  if (gate.verdict === 'skip' && gate.unjudged === GATE_TIME_SHORT) {
    return { entry: { ...entry, gatePending: true }, costUsd: gateCost, gate }
  }
  // 채점 호출 실패 — 상한까지는 게이트 대기로 다음 run 맨 앞에서 다시 판정(실패한 시도의 과금도 잡 비용에 든다 — R12d billedCostOf)
  const callFailures = newBatch && gate.verdict === 'skip' && gate.callFailed ? (entry.gateCallFailures ?? 0) + 1 : 0
  if (callFailures > 0 && callFailures <= GATE_CALL_FAILURE_REJUDGE_MAX) {
    console.warn(`[registration/pdp-image] '${task.section}' 게이트 채점 호출 실패 ${callFailures}번 — 통과로 치지 않음, 다음 run 맨 앞에서 다시 판정`)
    return { entry: { ...entry, gatePending: true, gateCallFailures: callFailures }, costUsd: gateCost, gate }
  }
  // 판정 점수 기록(동작에는 쓰지 않는다) — 통과 점수·재생성 사유를 다시 묻지 않고 볼 수 있게
  const record = gateRecordOf(gate)
  const recorded = record ? { gate: record } : {}
  if (gate.verdict !== 'fail') {
    // 새 배치 게이트가 끝까지 잘림·호출 실패 상한 — 이미지는 두고 컷에 경고를 남긴다(잡 기록 section_images에서 센다, 추가 재생성 없음)
    if (callFailures > 0) console.warn(`[registration/pdp-image] '${task.section}' ${GATE_UNDECIDED_CALL_FAILED} — 이미지 유지, 통과로 치지 않은 표시`)
    const undecided =
      gate.verdict === 'skip' && gate.unjudged === GATE_UNDECIDED_TRUNCATED
        ? { gateUnjudged: GATE_UNDECIDED_TRUNCATED }
        : callFailures > 0
          ? { gateUnjudged: GATE_UNDECIDED_CALL_FAILED, gateCallFailures: callFailures }
          : {}
    const passed = gate.verdict === 'pass' ? { ...entry, pendingRegen: false, ...recorded } : { ...entry, ...undecided }
    const settled = withLineTwin(ctx, passed)
    const twin = shotdivEnabled(ctx.job) ? findCompositionTwin(settled, ctx.sectionImages) : null
    if (!twin) return { entry: settled, costUsd: gateCost, gate }
    const angled = await regenForAngle(ctx, task, settled, twin, runStart)
    return { entry: angled.entry, costUsd: gateCost + angled.costUsd, gate }
  }
  const score = gate.score
  // usegate 잡의 사용 판정 컷(c08·J19) — 끝까지 사용 미달이면 대표 아닌 컷은 빼고, 재생성 뒤 다시 판정하며, 나은 컷 순위에 사용 맞음을 본다
  const strictUse = strictUseGateOf(ctx.job, task)
  const settleOpts = strictUse ? { use: true } : undefined
  if (entry.retried) {
    // 재생성 예산 소진 — 게이트 미달을 기록만 하고 원본 유지(§6.4). K 컷이 상품 불일치면 빼거나(대표 컷은 경고) — 점검 고침 1
    return { entry: settleLineFailure(task, { ...entry, pendingRegen: false, ...recorded }, score, `게이트 미달(재생성 소진, ${gate.reason})`, settleOpts), costUsd: gateCost, gate }
  }

  const model = task.model ?? ctx.job.image_model
  const regenTimeShort = Date.now() - runStart + GENERATION_WORST_MS >= ctx.budgetMs
  // 이 run에 공급자 잔액 부족이 났으면(R12c) 재생성을 시작하지 않고 시간 부족과 같이 이월한다
  const halted = isAsyncImageModel(model) && Boolean(ctx.providerHalted?.())
  const regenReserved = !regenTimeShort && !halted && (!ctx.spend || ctx.spend.tryReserve(model, task.quality ?? ctx.job.image_quality))
  if (!regenTimeShort && !halted && !regenReserved && ctx.spend?.lastBlock === 'job') {
    // 첫 생성 잡의 비용 상한(점검 고침 5) — 다음 run에도 몫이 없으니 이월하지 않고 재생성 소진과 같이 끝낸다
    return {
      entry: settleLineFailure(task, { ...entry, pendingRegen: false, ...recorded }, score, `게이트 미달(${jobCapCutError()} 재생성 안 함, ${gate.reason})`, settleOpts),
      costUsd: gateCost,
      gate,
    }
  }
  // 재생성 최악 소요까지 더했을 때 예산을 넘길 수 있거나(경과 시간만으로 판단하지 않는다) run 안 지출 예약이 바닥나거나 공급자 잔액이
  // 모자라면 — 다음 run이 최우선으로 재생성하도록 이월
  const carry = (extraCostUsd = 0) => ({
    entry: {
      ...entry,
      pendingRegen: true,
      // 크기 단독 미달은 여기 오지 않는다(isGateFailure) — 사유 글은 다음 run 재생성 지시의 사유가 된다
      error: `게이트 미달 — 재생성 대기: ${score.artifact_reason || '일관성 미달'}`,
      ...recorded,
    },
    costUsd: gateCost + extraCostUsd,
    gate,
  })
  if (!regenReserved) return carry()

  const regen = await generateSection({ ...ctx, regenScore: withoutSizeScore(score) }, task)
  // 재생성이 공급자 잔액 부족으로 막혔다(R12c) — 재생성 1회를 쓰지 않고 앞 컷을 둔 채 이월한다
  if (isBalanceFailure(regen.entry)) return carry(regen.costUsd)
  const regenEntry: SectionImage = { ...regen.entry, pendingRegen: false, ...(record ? { gateBefore: record } : {}) }
  // 대표 컷·착용 컷(K)만 재생성 뒤 한 번 더 판정한다(점검 고침 1 — K7 P09 대표 컷 오류가 착용 컷으로 퍼졌다). usegate 잡은 사용 판정 컷도(c08·J19).
  // 그 밖의 컷은 지금처럼 재판정 없음
  const rejudge =
    Boolean(task.lineGate) && (task.section === 'hero' || task.wornCut === true || strictUse) && Boolean(regenEntry.url) && !regenEntry.error
  if (!rejudge) return { entry: { ...regenEntry, ...notRejudgedOf(task) }, costUsd: gateCost + regen.costUsd, gate }
  const again = await judgeSection(ctx, task, regenEntry, runStart)
  const costUsd = gateCost + regen.costUsd + again.costUsd
  const after = gateRecordOf(again)
  if (again.verdict === 'pass') return { entry: { ...regenEntry, ...(after ? { gate: after } : {}), gateRejudge: { before: record, after, kept: 'regen' } }, costUsd, gate }
  // 판정하지 못하면(시간·채점 실패) 지금처럼 새 컷을 재판정 없이 쓴다
  if (again.verdict !== 'fail') return { entry: { ...regenEntry, ...notRejudgedOf(task) }, costUsd, gate }
  // 다시 미달 — 앞 컷과 견줘 나은 쪽(같은 상품 > 부품 > 일관성). 끝까지 상품 불일치면 빼거나(대표 컷은 경고)
  const kept = betterCutOf(score, again.score, settleOpts)
  const chosen: SectionImage = kept === 'first' ? { ...entry, retried: true, pendingRegen: false, ...recorded } : { ...regenEntry, ...(after ? { gate: after } : {}) }
  const finalScore = kept === 'first' ? score : again.score
  const error = `게이트 미달(재판정 뒤, ${kept === 'first' ? gate.reason : again.reason}, ${kept === 'first' ? '앞 컷' : '새 컷'}을 씀)`
  return { entry: settleLineFailure(task, { ...chosen, gateRejudge: { before: record, after, kept } }, finalScore, error, settleOpts), costUsd, gate }
}

/**
 * K 컷이 끝까지 미달로 남을 때(점검 고침 1) — 상품 불일치(same_product false)면 대표 컷은 첫 화면이라 남기고 경고(통합 Q1), 그 밖의 컷은
 * url을 비워 페이지에서 뺀다(그 컷을 쓰는 섹션은 빠진 컷과 같이 그리지 않는다). 그 밖의 미달·D·운영 기본 컷은 지금처럼 error만 남긴다.
 * use(usegate 잡의 사용 판정 컷, 결정 카드 c08·J19 — 가정 A3)면 끝까지 사용 미달(use_correct false)도 같은 길이다 — 대표 컷은 경고, 그 밖은 뺌
 */
export function settleLineFailure(
  task: Pick<ImageTask, 'section' | 'lineGate'>,
  entry: SectionImage,
  score: { same_product?: boolean; artifact_reason?: string | null; use_correct?: boolean; use_reason?: string | null },
  error: string,
  options: { use?: boolean } = {}
): SectionImage {
  if (!task.lineGate || !entry.url) return { ...entry, error }
  if (score.same_product !== false) return options.use && score.use_correct === false ? settleUseFailure(task, entry, score, error) : { ...entry, error }
  const reason = `상품 불일치: ${score.artifact_reason || '원본과 다른 상품'}`.slice(0, 200)
  if (task.section === 'hero') return { ...entry, error, gateWarning: `첫 화면 대표 컷이 재생성 뒤에도 원본과 달라 보임 — 나은 쪽을 씀(${reason})` }
  console.warn(`[registration/pdp-image] '${task.section}' 끝까지 상품 불일치 — 페이지에서 뺌(${reason})`)
  return { ...entry, url: '', error: `${error} — 페이지에서 뺌(${reason})`, droppedForProduct: { url: entry.url, reason } }
}

/** 끝까지 사용 미달(usegate 잡, c08·J19) — 대표 컷은 첫 화면이라 남기고 경고, 그 밖의 사용 판정 컷은 페이지에서 뺀다 */
function settleUseFailure(
  task: Pick<ImageTask, 'section'>,
  entry: SectionImage,
  score: { use_reason?: string | null },
  error: string
): SectionImage {
  const reason = `쓰는 법 미달: ${score.use_reason || '쥐는 곳·작동면·방향·착용 위치가 원본과 다름'}`.slice(0, 200)
  if (task.section === 'hero') return { ...entry, error, gateWarning: `첫 화면 대표 컷이 재생성 뒤에도 쓰는 법이 원본과 달라 보임 — 나은 쪽을 씀(${reason})` }
  console.warn(`[registration/pdp-image] '${task.section}' 끝까지 쓰는 법 미달 — 페이지에서 뺌(${reason})`)
  return { ...entry, url: '', error: `${error} — 페이지에서 뺌(${reason})`, droppedForUse: { url: entry.url, reason } }
}

/**
 * 재생성한 컷은 다시 판정하지 않는다(재판정은 비용) — K 라인 컷만 기록에 표지를 단다(K5 P01: 재생성본도 크기를 못 고쳤는데 기록에 판정이 없어 몰랐다).
 * D·운영 기본 컷은 칸이 없다(기록 그대로)
 */
function notRejudgedOf(task: Pick<ImageTask, 'lineGate'>): { regenNotRejudged?: true } {
  return task.lineGate ? { regenNotRejudged: true } : {}
}

/**
 * K 컷 구도 중복 기록(shotvary 잡, 세션 B variety F5) — 게이트를 넘긴 K 컷이 대표 컷·앞 K 컷과 지문이 거의 같으면 그 짝을 기록만 한다.
 * 다른 각도 재생성은 하지 않는다(비용 — 기록을 보고 켤지 따로 정한다). 꺼진 잡·K 컷이 아닌 컷은 entry 그대로다
 */
function withLineTwin(ctx: GenerateContext, entry: SectionImage): SectionImage {
  if (!shotvaryEnabled(ctx.job)) return entry
  const twin = findLineCompositionTwin(entry, ctx.sectionImages)
  if (!twin) return entry
  console.warn(`[registration/pdp-image] '${entry.section}' K 구도 중복 기록 — '${twin.of}'와 지문 거리 ${twin.distance}(다시 만들지 않음)`)
  return { ...entry, lineTwin: twin }
}

/**
 * shotdiv ③ 구도 중복 — 게이트를 넘긴 상품 컷이 같은 페이지 다른 상품 컷과 지문이 거의 같으면 다른 각도로 한 번 다시 만든다(컷당 재생성
 * 1회 예산). 재생성·게이트 최악 소요까지 더해 run 시간을 넘거나 지출 예약이 막히면 다음 run 맨 앞으로 이월한다(#353 게이트 대기와 같은 규칙).
 * 다시 만든 컷도 게이트를 본다 — 통과를 확인한 컷만 받는다(settleAngleRegen)
 */
async function regenForAngle(
  ctx: GenerateContext,
  task: ImageTask,
  entry: SectionImage,
  twin: { of: string; distance: number },
  runStart: number
): Promise<{ entry: SectionImage; costUsd: number }> {
  const marked = { ...entry, compositionTwin: twin }
  console.warn(`[registration/pdp-image] '${task.section}' 구도 중복 — '${twin.of}'와 지문 거리 ${twin.distance}`)
  if (entry.retried) return { entry: marked, costUsd: 0 }
  const model = task.model ?? ctx.job.image_model
  const angleTimeShort = Date.now() - runStart + GENERATION_WORST_MS + GATE_MIN_MS >= ctx.budgetMs
  const angleReserved = !angleTimeShort && (!ctx.spend || ctx.spend.tryReserve(model, task.quality ?? ctx.job.image_quality))
  // 첫 생성 잡의 비용 상한(점검 고침 5) — 이월하지 않고 기록만 남긴다(재생성을 이미 한 컷과 같다)
  if (!angleTimeShort && !angleReserved && ctx.spend?.lastBlock === 'job') return { entry: marked, costUsd: 0 }
  if (!angleReserved) {
    return { entry: { ...marked, pendingRegen: true, error: anglePendingError(twin.of) }, costUsd: 0 }
  }
  const regen = await generateSection({ ...ctx, angleOf: twin.of }, task)
  const settled = await settleAngleRegen(ctx, task, entry, regen.entry, twin, runStart)
  return { entry: settled.entry, costUsd: regen.costUsd + settled.costUsd }
}

/**
 * 다른 각도로 다시 만든 컷의 게이트 — 통과를 확인한 컷만 받는다. 미달이거나 판정하지 못하거나 만들지 못하면 게이트를 넘겼던 앞 컷을 둔다
 * (구도 중복은 보기 문제이고 상품 정확도가 먼저다). 원천 사진이 없는 잡은 앞 컷도 판정하지 못했으니 새 컷을 받는다(retryCopyZone과 같다)
 */
async function settleAngleRegen(
  ctx: GenerateContext,
  task: ImageTask,
  previous: SectionImage,
  regenerated: SectionImage,
  twin: { of: string; distance: number },
  runStart: number
): Promise<{ entry: SectionImage; costUsd: number }> {
  const produced = Boolean(regenerated.url) && !regenerated.error
  const gate = produced ? await judgeSection(ctx, task, regenerated, runStart) : null
  const unjudged = gate?.verdict === 'skip' && Boolean(gate.unjudged) && ctx.sourceRefs.length > 0
  if (gate && gate.verdict !== 'fail' && !unjudged) {
    // 판정한 점수를 남긴다 — 다시 만든 컷은 이 판정을 거쳐 받았다
    const judged = gateRecordOf(gate)
    return { entry: { ...regenerated, pendingRegen: false, compositionTwin: twin, ...(judged ? { gate: judged } : {}) }, costUsd: gate.costUsd }
  }
  const keptFirst = !gate ? '생성 실패' : gate.verdict === 'fail' ? `게이트 미달(${gate.reason})` : `판정 못 함(${gate.unjudged})`
  console.warn(`[registration/pdp-image] '${task.section}' 다른 각도 컷을 받지 않음 — ${keptFirst}, 앞 컷 유지`)
  return {
    entry: { ...previous, retried: true, pendingRegen: false, error: undefined, compositionTwin: { ...twin, keptFirst } },
    costUsd: gate?.costUsd ?? 0,
  }
}

/** 대기 게이트 판정 결과 한 줄(실 테스트 회차가 로그로 센다 — 대기 게이트가 미달을 잡았는지). prior = 판정 전 컷 */
function deferredGateOutcome(prior: SectionImage, gated: { entry: SectionImage; gate: GateVerdict }): string {
  const { entry, gate } = gated
  if (entry.gatePending) return entry.gateCallFailures ? `다시 대기(채점 호출 실패 ${entry.gateCallFailures}번)` : '다시 대기'
  if (gate.verdict === 'pass') return '통과'
  if (gate.verdict === 'skip' && entry.gateUnjudged) return `${entry.gateUnjudged} — 이미지 유지, 통과로 치지 않은 표시`
  if (gate.verdict === 'skip') return `판정 못 함(${gate.unjudged ?? '게이트 없음'}) — 통과와 같은 처리`
  if (prior.retried) return `미달(${gate.reason}) — 재생성 소진`
  if (entry.pendingRegen) return `미달(${gate.reason}) — 재생성 대기`
  return entry.error ? `미달(${gate.reason}) — 재생성 실패` : `미달(${gate.reason}) — 재생성`
}

/**
 * D2-3 — 게이트를 마친 첫 화면 컷의 글자 자리가 미달이면 지시를 강화해 한 번 다시 만들고 게이트를 한 번 본다(재생성 없음).
 * 다시 만든 컷이 게이트 미달이 아니고 글자 자리를 통과할 때만 바꾼다. 이번 run에 재생성 + 게이트 시간이 모자라면 다음 run 맨 앞으로
 * 미룬다(pending — 뒤 상품 컷도 함께 기다린다), 지출 예약이 막히면 skipped(편집기는 지금 T1). deferred = 미룬 일(시간·지출 예약은
 * 풀의 canStart가 이미 확인했다)
 */
async function retryCopyZone(
  ctx: GenerateContext,
  task: ImageTask,
  entry: SectionImage,
  runStart: number,
  deferred = false
): Promise<{ entry: SectionImage; costUsd: number }> {
  const first = entry.copyZone!
  if (!deferred) {
    if (Date.now() - runStart + GENERATION_WORST_MS + GATE_MIN_MS >= ctx.budgetMs) {
      return { entry: { ...entry, copyZone: { ...first, retry: 'pending' } }, costUsd: 0 }
    }
    if (ctx.spend && !ctx.spend.tryReserve(task.model ?? ctx.job.image_model, task.quality ?? ctx.job.image_quality)) {
      return { entry: { ...entry, copyZone: { ...first, retry: 'skipped' } }, costUsd: 0 }
    }
  }
  const regen = await generateSection({ ...ctx, copyZoneRetry: first.measure }, task)
  const produced = Boolean(regen.entry.url) && regen.entry.url !== entry.url && !regen.entry.error
  const gate = produced ? await judgeSection(ctx, task, regen.entry, runStart) : null
  // 판정하지 못한 게이트(시간·받기·채점 실패)는 채택하지 않는다 — 원천 사진이 없어 처음 컷도 판정하지 못한 잡만 예외
  const unjudged = gate?.verdict === 'skip' && Boolean(gate.unjudged) && ctx.sourceRefs.length > 0
  const verdict = !gate || unjudged ? null : gate.verdict
  return {
    entry: settleCopyZoneRetry(entry, regen.entry, verdict),
    costUsd: regen.costUsd + (gate?.costUsd ?? 0),
  }
}

/**
 * 강조 장식 하위 단계(E-3, images 단계의 마지막) — 번호 배지는 결정론으로 이번 run에 전부, Vision 대상은 run당
 * 최대 2콜을 시간 예산 안에서만. 실패·전부 탈락은 failed·skipped로 기록하고 재생성하지 않는다.
 * 대상이 없는 잡(Track S·구 Track I 잡)은 아무것도 하지 않는다.
 */
export async function annotateSectionImages(
  db: SupabaseClient,
  userId: string,
  job: PdpJobRow,
  sectionImages: SectionImage[],
  costUsd: number,
  runContext: RunContext,
  runStart: number,
  options: Pick<ImagesRunOptions, 'budgetMs' | 'leaseUntil'> & {
    /** 첫 생성 잡의 비용 상한(점검 고침 5) — 지출 + 장식 몫이 이 값에 닿으면 남은 비전 장식을 생략으로 기록한다(다시 고르지 않게) */
    costCapUsd?: number
  } = {}
): Promise<{ sectionImages: SectionImage[]; costUsd: number }> {
  const budgetMs = options.budgetMs ?? RUN_TIME_BUDGET_MS
  const lease = options.leaseUntil ? { leaseUntil: options.leaseUntil } : {}
  const pending = pendingAnnotationTargets({ ...job, section_images: sectionImages })
  if (pending.length === 0) return { sectionImages, costUsd }
  const record = (section: string, result: Parameters<typeof withAnnotationResult>[1]) => {
    const entry = sectionImages.find((e) => e.section === section)
    if (entry) sectionImages = upsertSectionImage(sectionImages, withAnnotationResult(entry, result))
  }

  const numbers = pending.filter((t) => t.mode === 'number')
  for (const t of numbers) record(t.section, { annotations: buildNumberAnnotations(t) })
  if (numbers.length > 0) await updatePdpJob(db, userId, job.id, { sectionImages, costUsd, ...lease })

  let calls = 0
  const vision = pending.filter((x) => x.mode === 'vision')
  for (const [i, t] of vision.entries()) {
    if (options.costCapUsd !== undefined && costUsd + GATE_RESERVE_USD > options.costCapUsd) {
      // 잡 비용 상한 — 남은 비전 장식은 하지 않는다(빈 장식 = 생략). 이월하면 images↔compose를 오가며 끝나지 않는다
      for (const rest of vision.slice(i)) record(rest.section, { annotations: [] })
      console.warn(`[registration/pdp-image] 잡 비용 상한($${options.costCapUsd}) — 비전 장식 ${vision.length - i}개 생략`)
      await updatePdpJob(db, userId, job.id, { sectionImages, costUsd, ...lease })
      break
    }
    if (calls >= ANNOTATION_CALLS_PER_RUN) break
    if (Date.now() - runStart + ANNOTATION_ESTIMATE_MS >= budgetMs) break
    calls++
    const image = await fetchImageAsBase64(t.url)
    if (!image) {
      record(t.section, 'failed')
    } else {
      const kinds = t.kinds.filter((k): k is 'label' | 'leader' | 'zoom' => k !== 'number')
      const { rows, costUsd: callCost } = await locateAnnotations(
        image,
        t.labels.map((l) => l.text),
        kinds,
        { ...runContext, stage: `images/${t.section}/annotation` }
      )
      costUsd += callCost
      record(
        t.section,
        rows ? { annotations: validateAnnotations(rows, t), aspect: imageAspectFromBase64(image.data) } : 'failed'
      )
    }
    // 컷 단위 부분 저장 — 이후 콜에서 504가 나도 이번 결과·비용은 잡에 남는다(§6.4)
    await updatePdpJob(db, userId, job.id, { sectionImages, costUsd, ...lease })
  }
  return { sectionImages, costUsd }
}

/**
 * images 단계 run 1회 실행 — 태스크 목록 조립 → 재생성 대기 큐 우선 → hero → 나머지 동시 생성(시간·지출 예산 안)
 * → 강조 장식 하위 단계 → 전 태스크·장식 완주 시 compose로 전이. job.copy_sections.final이 없으면 호출 자체가
 * 계약 위반(파이프라인이 보장).
 */
export async function runImagesStep(
  db: SupabaseClient,
  userId: string,
  job: PdpJobRow,
  options: ImagesRunOptions = {}
): Promise<PdpJobRow> {
  const runStart = Date.now()
  const budgetMs = options.budgetMs ?? RUN_TIME_BUDGET_MS
  // 진행 잠금 기한 — 중간 저장은 기한을 유지하고, 이 run의 마지막 저장(기한 없음)이 잠금을 푼다
  const lease = options.leaseUntil ? { leaseUntil: options.leaseUntil } : {}
  const sourceRefs = await loadGenerationRefs(job)
  // 원본 합성(묶음 4, composite 기록 잡만): 첫 run 맨 앞에서 한 번 판정한다 — 디자인 컷 계획보다 먼저(계획이 이 기록을 읽을 수 있게).
  // 누끼 백엔드는 로컬 프로세스만 등록한다 — 웹 run은 no_backend로 기록하고 지금처럼 생성한다
  let compositeImage: CompositeImage | null = null
  if (compositeEnabled(job) && !job.section_plan.composite_source) {
    // 기록할 원천 사진 — 참조 첫 장이 source_images[0]일 때만(옵션 사진 가드·받기 실패로 어긋나면 남기지 않는다)
    const guarded = optionPhotoCoverage(optionSpecOf(job.spec_sheet, job.analysis)) !== null
    const sourceUrls = generationSourceOf(job).urls
    const aligned = !guarded && sourceRefs.length === sourceUrls.length
    const prepared = await prepareCompositeSource(sourceRefs[0], aligned ? sourceUrls[0] : undefined, {
      backend: getLocalCutoutBackend(),
      judge: (image) =>
        judgeCompositeEligibility(image, {
          userId,
          ...(job.business_id ? { businessId: job.business_id } : {}),
          stage: 'images/composite-eligibility',
          ...jobUsageContext(job),
        }),
      upload: (section, base64, mimeType) => uploadPdpImage(db, userId, job.id, section, base64, mimeType),
      now: () => new Date().toISOString(),
    })
    compositeImage = prepared.image
    job = await updatePdpJob(db, userId, job.id, {
      sectionPlan: { ...job.section_plan, composite_source: prepared.record },
      costUsd: job.cost_usd + prepared.costUsd,
      ...lease,
    })
  }
  // 디자인 컷 비교군(D1): 첫 run에 계획을 기록한다 — 편집기(D2)가 읽고, 플레이트 태스크 목록이 이 기록을 따른다.
  // 원천 사진 색 측정(08 §4.1)을 계획보다 먼저 같이 기록한다 — 계획(순수)은 이 기록만 읽어 폴백 재계산(pdp-image-tasks)과 같다
  if (!job.section_plan.designcut && designcutEnabled(job)) {
    const designcut_photo = job.section_plan.designcut_photo ?? (await measureDesigncutPhoto(sourceRefs[0]))
    let measured = { ...job, section_plan: { ...job.section_plan, designcut_photo } }
    const templateLine = hasEnrichmentFeature(job.analysis, 'templatelib')
    // 컷 목적(shotdiv) — 계획보다 먼저 기록한다(계획이 shots를 T10 '자세히 보기' 막으로 싣는다). POINT 컷 수는 기록 전 계획으로 잰다.
    // K 라인은 템플릿 칸이 컷을 정해 이 기록으로 컷을 만들지 않지만, 기록은 남는다(하네스 done 확인이 shotdiv 갈래에 요구한다)
    if (shotdivEnabled(measured) && !measured.section_plan.extra_shots) {
      const extra_shots = planExtraShotsForLength(measured, pointCutsOf(measured))
      if (extra_shots) measured = { ...measured, section_plan: { ...measured.section_plan, extra_shots } }
    }
    // 옵션 사진 색(partsbands K 잡만, J54) — K 계획보다 먼저 옵션 실물 사진마다 대표색을 잰다(모델 콜 0). 옵션 색 띠가 이 기록만 읽는다
    if (templateLine && hasEnrichmentFeature(job.analysis, 'partsbands') && !measured.section_plan.option_colors) {
      const [{ measureOptionColors }, { lineInputsOf }] = await Promise.all([import('./option-colors'), import('./templatelib/input-values')])
      const option_colors = await measureOptionColors(lineInputsOf(measured).options)
      measured = { ...measured, section_plan: { ...measured.section_plan, option_colors } }
    }
    if (templateLine) {
      // K 라인(스위치 켠 잡만) — 선택·슬롯 카피 콜을 여기서 한 번 부른다. 계획이 기록되면 다음 run은 부르지 않는다
      const { runTemplateLinePlan } = await import('./pdp-image-kline')
      const startCost = job.cost_usd
      const line = await runTemplateLinePlan(
        withAudienceStageSpec(measured),
        {
          userId,
          ...(job.business_id ? { businessId: job.business_id } : {}),
          stage: 'images/templatelib',
          ...jobUsageContext(job),
        },
        (spent) => updatePdpJob(db, userId, job.id, { costUsd: startCost + spent, ...lease }),
        // 색 조합 비전 고르기(palettepick 잡만, J26) — 색 측정과 같은 원본 사진 첫 장
        sourceRefs[0]
      )
      for (const warning of line.warnings) console.warn('[pdp/templatelib]', warning)
      job = await updatePdpJob(db, userId, job.id, {
        sectionPlan: { ...measured.section_plan, designcut: line.designcut, templatelib: line.templatelib },
        costUsd: job.cost_usd + line.costUsd,
        ...lease,
      })
    } else {
      const designcut = buildDesigncutPlan(measured)
      // 컷마다 무대 이름(적용 D4 ⓐ) — 계획과 함께 기록만 한다. 프롬프트는 읽지 않고 장치 지표 최다 무대가 읽는다
      const designcut_stages = designcut ? designcutStagesOf({ ...measured, section_plan: { ...measured.section_plan, designcut } }) : {}
      job = await updatePdpJob(db, userId, job.id, {
        sectionPlan: { ...measured.section_plan, ...(designcut ? { designcut, designcut_stages } : {}) },
        ...lease,
      })
    }
  }
  // 새 단계 K 칸 카피 뒤 사실 감사(R10) — 새 배치 + newstages 잡의 첫 생성만, K 계획(칸 글) 기록 뒤 한 번. 기록+경고만(칸 글을 고치지 않는다).
  // 이 run에 콜 시간이 모자라면 지금까지를 저장하고(잠금 해제) 다음 run 맨 앞에서 부른다 — run 300초 안
  if (needsSlotFactAudit(job)) {
    const deadlineAt = runStart + budgetMs
    if (!newStageFits('factAudit', deadlineAt)) return updatePdpJob(db, userId, job.id, { costUsd: job.cost_usd })
    const auditContext: RunContext = {
      userId,
      ...(job.business_id ? { businessId: job.business_id } : {}),
      stage: 'images/fact-audit',
      ...jobUsageContext(job),
    }
    const record = await runSlotFactAuditStage(job, auditContext, deadlineAt)
    logNewStage(job.id, record)
    job = await updatePdpJob(db, userId, job.id, {
      sectionPlan: { ...job.section_plan, kslot_fact_audit: record },
      costUsd: job.cost_usd + recordCost(record),
      ...lease,
    })
  }
  let tasks = buildImageTasks(job)
  if (tasks.length === 0) throw new Error('이미지 태스크를 구성할 카피 산출이 없습니다 — 잡 상태 불일치')
  // 편집기 사후 재생성(W5b) — 골격 밖 섹션의 편집기 요청은 아는 섹션 키 전체(lean 전)에서 태스크를 찾는다. 그런 요청이 있을 때만 만든다
  const taskJob = job
  let knownTasks: ImageTask[] | undefined
  const editorTaskOf = (section: string) =>
    tasks.find((t) => t.section === section) ??
    (knownTasks ??= buildKnownImageTasks(taskJob)).find((t) => t.section === section)

  let designPrompts = job.design_prompts
  // 끝낸 실패로 두면 재시도 버튼이 아무것도 부르지 못하고 다시 failed가 된다 — 첫 화면 항목을 지워 처음부터 다시 만든다
  let sectionImages = options.retryLostHero ? job.section_images.filter((e) => e.section !== 'hero' || e.url) : [...job.section_images]
  let costUsd = job.cost_usd
  const runContext: RunContext = {
    userId,
    ...(job.business_id ? { businessId: job.business_id } : {}),
    stage: 'images',
    ...jobUsageContext(job),
  }

  if (!designPrompts.style_charter) {
    // 디자인 컷 잡은 헌장 배경도 컷 바탕(사진 촬영 배경) — withDesigncutCutBackground, 그 밖의 잡은 그대로
    designPrompts = { ...designPrompts, style_charter: buildStyleCharterForJob(withDesigncutCutBackground(job)) }
  }
  if (designPrompts.identity_card === undefined && sourceRefs.length > 0) {
    // 인쇄물은 원천 사진을 최대 4장까지 함께 본다(사진마다 도안이 다를 수 있다 — P01). 그 밖의 상품은 idcardall 잡만 함께 보고, 나머지는 지금처럼 첫 사진만
    const textBearing = isTextBearingJob(job)
    const idcardall = hasEnrichmentFeature(job.analysis, 'idcardall')
    const others = identityCardOthers(sourceRefs, textBearing, idcardall)
    // 상태 구분(펼침·접힘을 상태마다 따로 — 오너 메모 11-06 P05)은 idcardall 잡의 인쇄물이 아닌 카드만. 끄면 호출 인자도 지금과 같다
    const states = idcardall && !textBearing
    const identityContext = { ...runContext, stage: 'images/identity' }
    // 쓰는 법 USE 줄(usefacts 잡, 결정 카드 c02) — 같은 콜에 묻고 카드와 따로 둔다. 꺼진 잡은 호출 인자가 지금과 같다
    const useOpt = hasEnrichmentFeature(job.analysis, 'usefacts') ? { use: true as const } : null
    // 옵션 사진 역할 한 줄(photoroles 잡, 결정 카드 c12) — 여러 장을 보낼 때만, 받은 참조가 원천 주소와 한 장씩 맞을 때만(가드·받기 실패면 안 붙인다).
    // 꺼진 잡·옵션 사진이 없는 잡은 호출 인자가 지금과 같다
    const roleLine = others.length > 0 ? identityRoleLineOf(job, sourceRefs.length, 1 + others.length) : null
    // 두 스위치 표지를 한 옵션으로 — 둘 다 없으면 null이라 아래 호출 인자가 지금과 같다
    const extraOpt = useOpt || roleLine ? { ...useOpt, ...(roleLine ? { roleLine } : {}) } : null
    const {
      card,
      costUsd: idCost,
      uncertain,
      use,
    } = !textBearing && others.length > 0
      ? await readIdentityCard(sourceRefs[0], identityContext, others, { allPhotos: true, ...(states ? { states } : {}), ...extraOpt })
      : states
        ? await readIdentityCard(sourceRefs[0], identityContext, others, { states, ...extraOpt })
        : extraOpt
          ? await readIdentityCard(sourceRefs[0], identityContext, others, extraOpt)
          : await readIdentityCard(sourceRefs[0], identityContext, others)
    designPrompts = {
      ...designPrompts,
      identity_card: withIdentityNote(card, job.spec_sheet.identityNote),
      ...(uncertain ? { identity_uncertain: uncertain } : {}),
      ...(useOpt && use ? { identity_use: use } : {}),
    }
    costUsd += idCost
    // run 상한 도중 504가 나도 이 콜의 산출·비용은 보존한다(§6.4 부분 저장 원칙).
    await updatePdpJob(db, userId, job.id, { designPrompts, costUsd, ...lease })
    // 보여 줄 동작·설계(showbeat 잡, J63 2단계) — 사실 출처에 식별 카드 USE 줄을 읽으므로, 이번 run에 USE 줄이 생겼으면 태스크를 그 카드로 다시 짠다
    // (첫 run 태스크는 카드 전에 짜였다). 꺼진 잡·USE 줄이 없는 잡은 태스크가 그대로다
    if (designPrompts.identity_use && hasEnrichmentFeature(job.analysis, 'showbeat')) tasks = buildImageTasks({ ...job, design_prompts: designPrompts })
  }
  // 새 단계 연출 감독(R10) — 헌장·식별 카드 뒤, 첫 생성 전. 새 배치 + newstages 잡의 첫 생성만 한 번. 콜 시간이 모자라면 헌장·카드까지
  // 저장하고(잠금 해제) 다음 run 맨 앞에서 부른다 — 감독 기록 전에는 컷을 만들지 않는다. 실패도 기록하고 지금 지시로 만든다
  if (needsDirector(job, designPrompts)) {
    const deadlineAt = runStart + budgetMs
    if (!newStageFits('director', deadlineAt)) return updatePdpJob(db, userId, job.id, { designPrompts, costUsd })
    const record = await runDirectorStage(job, designPrompts, { ...runContext, stage: 'images/director' }, deadlineAt)
    logNewStage(job.id, record)
    designPrompts = { ...designPrompts, director: record }
    costUsd += recordCost(record)
    await updatePdpJob(db, userId, job.id, { designPrompts, costUsd, ...lease })
  }

  // Track I(§5 images 행): v2 레시피 블록(역할 전량·환산 px·hex)이 v1 참고 블록을 대체 — 미보유 시 v1 폴백.
  // ENRICHMENT persuasion 잡은 v2가 없는 카테고리도 Track I 블록(pooled 공통 규칙)을 쓴다. shots 잡의 컷별 연출 블록은 아래 taskGrounding.
  const internalizedImageBlock =
    resolveGenerationTrack(job) === 'internalized'
      ? (buildInternalizedImageBlock(job.analysis.detected_category) ??
        (persuasionOf(job) ? buildPooledInternalizedImageBlock() : null))
      : null
  // 연령 컴플라이언스(만 14세 이상 상품): 전 컷 공통 미성년 묘사 금지 지시를 grounding에 강제 append
  // 학부모 대리 구매형(audience 기록 잡만): 어른 손·준비된 답례품만, 아이는 배경에도 없게 — 연령 블록과 같은 자리(전 컷·연출·플레이트)
  const guardImageBlock =
    [buildAgeComplianceImageBlock(job.spec_sheet), buildParentProxyImageBlock(audienceOf(job))].filter(Boolean).join('\n\n') ||
    null
  const imageGroundingBlock = [
    internalizedImageBlock ?? buildImageGroundingBlock(job.analysis.detected_category),
    guardImageBlock,
  ]
    .filter((b): b is string => Boolean(b))
    .join('\n\n')
  const taskGrounding = resolveShotGrounding(
    job,
    mergeManualStrategy(job.analysis.recommended_strategy_contract ?? {}, job.spec_sheet, []),
    guardImageBlock,
    tasks.map((t) => t.section)
  )

  // 개정 5: USP 아이콘은 사전 생성 라이브러리 선택이 1순위 — 생성 슬롯·비용을 쓰지 않고 URL만 기록.
  // 라이브러리 미구축·미적중분은 그대로 남아 아래 신규 태스크 루프에서 저가 모델로 폴백 생성된다.
  const pendingUspTasks = tasks.filter(
    (t) => t.section.startsWith('usp_icons:') && !sectionImages.some((e) => e.section === t.section)
  )
  if (pendingUspTasks.length > 0) {
    const manifest = getUspIconLibrary(userId)
    if (manifest) {
      const cards = job.copy_sections.final?.pointCards ?? []
      let libraryHits = 0
      for (const t of pendingUspTasks) {
        const idx = Number(t.section.split(':')[1] ?? '-1')
        const icon = selectUspIcon(cards[idx]?.title || '', manifest)
        if (icon) {
          sectionImages = upsertSectionImage(sectionImages, { section: t.section, url: icon.url, prompt: `library:${icon.slug}` })
          libraryHits++
        }
      }
      if (libraryHits > 0) await updatePdpJob(db, userId, job.id, { sectionImages, costUsd, ...lease })
    }
  }

  // 원본 합성 컷 — 판정이 cutout·direct면 합성 대상 컷(hero·premium_hero·product_exposure, K 잡은 상품 단독·디테일·포장 라벨 칸 —
  // 결정 카드 c18·J29)을 생성 대신 만든다. 끝난 섹션이 되어 아래 생성 일에서 빠지고, 게이트를 거치지 않는다(원본 화소). 컷마다 실패하면
  // 그 컷만 지금처럼 생성한다
  const compositeRecord = job.section_plan.composite_source
  if (compositeEnabled(job) && compositeRecord && compositeRecord.mode !== 'skip') {
    // hero는 오너가 히어로 모드를 '원본(original)'으로 고른 잡만 합성한다(NEXFIT과 같다 — studio·lifestyle·premium은 생성 장면)
    const heroOriginal = job.spec_sheet.heroImageMode === 'original'
    const open = (section: string) => !sectionImages.some((e) => e.section === section)
    const kTargets = new Map(kCompositeTargets(job, tasks).map((target) => [target.section, target.role]))
    const pending = tasks.filter(
      (t) => open(t.section) && ((isCompositeTarget(t.section) && (t.section !== 'hero' || heroOriginal)) || kTargets.has(t.section))
    )
    const image =
      pending.length > 0
        ? (compositeImage ?? (await loadCompositeImage(compositeRecord, sourceRefs[0], (url) => fetchImageAsBase64(url))))
        : null
    if (image) {
      const { entries, failed } = await composeCompositeCuts({
        record: compositeRecord,
        image,
        targets: pending.map((t) => {
          const kRole = kTargets.get(t.section)
          return kRole ? { section: t.section, style: kRole, kRole } : { section: t.section, style: t.section as CompositeTargetSection }
        }),
        sizeOf: (section) => ASPECT_TO_SIZE[pending.find((t) => t.section === section)?.aspectRatio ?? ''] ?? '1024x1024',
        palette: withDesigncutCutBackground(job).copy_sections.final?.designPalette ?? {},
        // 디자인 컷 잡은 컷 바탕 단색 — 짙은 그라데이션·사진 테두리 색이 컷 바탕과 어긋나지 않게
        solid: designcutEnabled(job),
        upload: (section, base64, mimeType) => uploadPdpImage(db, userId, job.id, section, base64, mimeType),
      })
      for (const entry of entries) sectionImages = upsertSectionImage(sectionImages, entry)
      if (failed.length > 0) {
        // 합성하다 실패한 컷(compose_error)을 기록에 남긴다 — 그 컷은 아래 생성 일이 만든다
        const failedCuts = [...new Set([...(compositeRecord.failedCuts ?? []), ...failed])]
        job = { ...job, section_plan: { ...job.section_plan, composite_source: { ...compositeRecord, failedCuts } } }
      }
      if (entries.length > 0 || failed.length > 0) {
        await updatePdpJob(db, userId, job.id, {
          sectionImages,
          costUsd,
          ...(failed.length > 0 ? { sectionPlan: job.section_plan } : {}),
          ...lease,
        })
      }
    }
  }

  // 첫 생성 잡은 잡당 비용 상한의 남은 몫도 예약한다(점검 고침 5) — 편집기 재생성(editorRegen 기록이 있는 잡)은 상한 밖.
  // 지출은 이 run에서 이미 쓴 돈(식별 카드 등, costUsd)까지 넣은 값이다
  const capStartSpent = costUsd
  const spend = await createSpendGate(IMAGE_AGENT, runContext.costPool, jobCostHeadroomUsd({ section_images: job.section_images, cost_usd: capStartSpent }))
  const styleRefs = new Map<string, Promise<VisionImage | null>>()
  // 이미지 공급자 잔액 부족(R12c) — 처음 난 사유. 나면 이 run은 새 MS 일을 시작하지 않고, 풀이 끝나면 단계 오류로 멈춘다
  // (닫힌 함수가 바꾸므로 칸으로 둔다 — let 지역 변수면 타입이 처음 값 null로 좁혀진다)
  const providerHalt: { reason: string | null } = { reason: null }
  const baseCtx = (): GenerateContext => ({
    db,
    userId,
    job,
    designPrompts,
    sourceRefs,
    sectionImages,
    imageGroundingBlock,
    taskGrounding,
    plateGrounding: guardImageBlock,
    runContext,
    budgetMs,
    runStart,
    spend,
    styleRefs,
    onProviderBlocked: (message) => {
      providerHalt.reason ??= message
    },
    providerHalted: () => providerHalt.reason !== null,
  })
  // 저장은 한 줄로 — 완료마다 그 시점의 최신 상태를 쓴다. 잡 갱신은 section_images 전체를 덮어쓰므로 동시에 쓰면 서로 지운다.
  // 장 단위 부분 저장이라 이후 504가 나도 끝난 장은 잡에 남는다(§6.4). 앞 저장이 실패해도 다음 저장은 시도한다 — 저장마다
  // 전체 상태를 쓰므로 뒤 저장이 성공하면 앞 실패분도 남는다(실패한 저장을 기다린 일은 오류로 풀을 멈춘다)
  let saving: Promise<unknown> = Promise.resolve()
  const save = () => {
    const attempt = saving
      .catch(() => undefined)
      .then(() => updatePdpJob(db, userId, job.id, { sectionImages, costUsd, ...lease }))
    saving = attempt
    return attempt
  }

  // 0) 게이트 대기(앞 run이 시간이 모자라 판정하지 못한 컷) 맨 앞 — 받기·채점뿐이라 생성 예산·지출 예약 없이 시작하고, 미달이면
  //    게이트 재생성 규칙(즉시 1회 또는 이월)을 따른다.
  // 1) 게이트 재생성 대기 큐(이월분) 우선 → 2) 신규 태스크(hero가 항상 먼저 나온다). 첫 생성이 실패한 섹션(retryPending)은
  //    다음 run에서 한 번 더 시도한다 — 일시 오류(5xx·시간 초과·업로드 실패) 1번에 컷이 영구히 빠지지 않게(썸네일 RETRY_BUDGET
  //    방식, 섹션당 1회). 재시도 성공 컷도 게이트 재생성 예산(retried)은 그대로 갖는다.
  //    편집기 재생성 요청(editorRegen pending)도 이 큐로 온다 — 게이트를 거친 새 이미지만 url을 바꾼다(pdp-image-regen).
  //    D2-3 앞 run이 미룬 첫 화면 글자 자리 재생성(copyZone.retry pending)도 이 큐로 온다.
  type Work = {
    task: ImageTask
    gateOf?: SectionImage
    regenOf?: SectionImage
    editorOf?: SectionImage
    zoneOf?: SectionImage
    retry?: boolean
  }
  const works: Work[] = [
    ...sectionImages.flatMap((pending): Work[] => {
      const task = isGatePending(pending) ? tasks.find((t) => t.section === pending.section) : undefined
      return task ? [{ task, gateOf: pending }] : []
    }),
    ...sectionImages.flatMap((pending): Work[] => {
      if (isGatePending(pending)) return []
      if (copyZoneRetryPending(pending)) {
        const task = tasks.find((t) => t.section === pending.section)
        return task ? [{ task, zoneOf: pending }] : []
      }
      if (!pending.pendingRegen) return []
      const editor = isEditorRegenPending(pending)
      const task = editor ? editorTaskOf(pending.section) : tasks.find((t) => t.section === pending.section)
      if (!task) return []
      return editor ? [{ task, editorOf: pending }] : [{ task, regenOf: pending }]
    }),
    ...tasks.flatMap((task) => {
      const existing = sectionImages.find((e) => e.section === task.section)
      // 공급자 잔액 부족으로 보류한 컷(R12c)은 재시도가 아니라 첫 시도로 다시 만든다 — 실패하면 재시도 1번이 그대로 남는다
      return isSectionSettled(existing) ? [] : [{ task, retry: Boolean(existing?.retryPending) && !existing?.providerBlocked }]
    }),
  ]
  // 이번 run에 새로 생기는 항목은 끝난 순서가 아니라 일 순서로 둔다 — 순차 처리 때와 같은 배열(드래프트 상세 이미지·이력
  // 썸네일·미리보기가 이 순서를 쓴다). 이미 있던 항목은 제자리에서 바뀐다
  const priorSections = new Set(sectionImages.map((e) => e.section))
  const workOrder = new Map<string, number>()
  works.forEach((w, i) => workOrder.has(w.task.section) || workOrder.set(w.task.section, i))
  const orderOf = (e: SectionImage) => workOrder.get(e.section) ?? works.length
  const record = (entry: SectionImage, cost: number) => {
    const next = upsertSectionImage(sectionImages, entry)
    const fresh = next.filter((e) => !priorSections.has(e.section)).sort((a, b) => orderOf(a) - orderOf(b))
    sectionImages = [...next.filter((e) => priorSections.has(e.section)), ...fresh]
    costUsd += cost
  }

  // hero 선행 — 제품이 나오는 컷은 이번 run의 hero 일(생성·게이트·재생성)이 끝난 뒤 시작한다(게이트 재생성으로 바뀐 hero가
  // 스타일 참조가 되게). 효과 전용 컷·플레이트는 hero를 쓰지 않아 함께 돈다. hero 일이 없으면(이미 정해짐) 기다리지 않는다.
  // hero가 첫 실패(retryPending)로 끝나면 이번 run은 제품 컷을 시작하지 않는다 — hero 없이 만든 컷은 끝난 것으로 남아 hero가
  // 다음 run에 성공해도 다시 만들지 않는다. hero 재시도까지 실패한 뒤에야 hero 없이 진행한다(순차 처리 때와 같은 결과)
  let heroState: 'wait' | 'open' | 'retry' = works.some((w) => w.task.section === 'hero') ? 'wait' : 'open'
  // 첫 화면 컷을 끝내 못 만들면(재시도까지 실패) 나머지 컷을 만들지 않고 잡을 failed로 끝낸다 — 첫 화면 없는 페이지를 done으로 넘기지 않고, 돈도 더 쓰지 않는다.
  // 편집기 재생성 run은 끝난 잡을 고치는 일이라 판정하지 않는다
  const heroLost = () => {
    if (works.some((w) => w.editorOf) || !tasks.some((t) => t.section === 'hero')) return false
    const hero = sectionImages.find((e) => e.section === 'hero')
    return Boolean(hero) && !hero?.url && isSectionSettled(hero)
  }
  let spendBlocked = false
  // 풀이 멈춘 이유 — 지출 예약이 막혔으면 이번 run에 남은 편집기 요청은 시작할 수 없다(아래에서 failed로 끝낸다)
  let stoppedBySpend = false
  // 첫 생성 잡의 비용 상한에 닿아 멈췄다(점검 고침 5) — 남은 일은 다음 run에도 몫이 없으니 실패 컷으로 정리하고 합성으로 넘어간다
  let stoppedByJobCap = false

  const runWork = async (w: Work) => {
    if (w.gateOf) {
      const entry: SectionImage = { ...w.gateOf }
      delete entry.gatePending
      const gated = await gateAndMaybeRegen(baseCtx(), w.task, entry, runStart)
      console.warn(`[registration/pdp-image] '${w.task.section}' 대기 게이트 판정 — ${deferredGateOutcome(entry, gated)}`)
      record(gated.entry, gated.costUsd)
      await save()
      await maybeRetryCopyZone(w.task, gated.entry)
      return
    }
    if (w.zoneOf) {
      const zoned = await retryCopyZone(baseCtx(), w.task, w.zoneOf, runStart, true)
      record(zoned.entry, zoned.costUsd)
      await save()
      return
    }
    if (w.editorOf) {
      if (!w.task.skipGate && sourceRefs.length === 0) {
        const message = '원천 사진을 받지 못해 정체성 게이트를 판정할 수 없습니다 — 이전 이미지를 유지했습니다'
        record(settleEditorRegen(w.editorOf, 'failed', message, new Date().toISOString()), 0)
        await save()
        return
      }
      const editorRegen = w.editorOf.editorRegen
      const model = w.task.model ?? job.image_model
      const result = await runEditorRegenFlow(w.editorOf, {
        generate: (regenScore) => generateSection({ ...baseCtx(), editorRegen, ...(regenScore ? { regenScore: withoutSizeScore(regenScore) } : {}) }, w.task),
        judge: (entry) => judgeSection(baseCtx(), w.task, entry, runStart),
        // 재생성 뒤 게이트까지 들어갈 때만 — 판정 못 한 재생성본은 받지 않으므로 시간이 모자라면 시작하지 않는다
        canRegen: () =>
          Date.now() - runStart + GENERATION_WORST_MS + GATE_MIN_MS < budgetMs &&
          spend.tryReserve(model, w.task.quality ?? job.image_quality),
        now: () => new Date().toISOString(),
      })
      record(result.entry, result.costUsd)
      await save()
      return
    }
    if (w.regenOf) {
      // 이월된 구도 중복 재생성(shotdiv)은 다른 각도 지시로, 그 밖은 게이트 미달 사유로 다시 만든다
      const angleOf = anglePendingOf(w.regenOf)
      // 크기 미달(K 라인, 실물 크기 11-05)은 기록한 사유 코드로 옮긴다 — 오류 글의 크기 사유가 다른 사유 낱말에 걸리지 않게.
      // 지금 판정은 사유를 'scale'로 남기지 않는다(크기 단독은 통과, 함께면 다른 사유) — 이 갈래는 그 전에 이월된 잡 호환
      const reasonScore: GateScoreRow =
        w.regenOf.gate?.reason === 'scale'
          ? { artifact_reason: '', size_plausible: false }
          : { artifact_reason: w.regenOf.error ?? '', same_product: undefined }
      const regen = await generateSection({ ...baseCtx(), ...(angleOf ? { angleOf } : { regenScore: reasonScore }) }, w.task)
      // 공급자 잔액 부족으로 막혔다(R12c) — 재생성 대기를 그대로 두고(앞 컷 유지) 다음 run이 다시 재생성한다
      if (isBalanceFailure(regen.entry)) {
        record(w.regenOf, regen.costUsd)
        await save()
        return
      }
      const twin = w.regenOf.compositionTwin
      // 이월된 구도 중복 재생성도 바로 만든 경우와 같이 게이트를 본다 — 통과를 확인한 컷만 받는다
      const angled = angleOf
        ? await settleAngleRegen(baseCtx(), w.task, w.regenOf, regen.entry, twin ?? { of: angleOf, distance: DHASH_TWIN_MAX }, runStart)
        : {
            // 이월된 게이트 재생성 — 앞 컷이 미달한 판정을 재생성 사유로 옮긴다(바로 재생성한 경로와 같은 칸)
            entry: {
              ...regen.entry,
              pendingRegen: false,
              ...(twin ? { compositionTwin: twin } : {}),
              ...(w.regenOf.gate ? { gateBefore: w.regenOf.gate } : {}),
              ...notRejudgedOf(w.task),
            },
            costUsd: 0,
          }
      record(angled.entry, regen.costUsd + angled.costUsd)
      await save()
      await maybeRetryCopyZone(w.task, angled.entry)
      return
    }
    const genResult = await generateSection({ ...baseCtx(), errorRetry: w.retry }, w.task)
    record(genResult.entry, genResult.costUsd)
    await save()
    if (genResult.entry.url) {
      const gated = await gateAndMaybeRegen(baseCtx(), w.task, genResult.entry, runStart)
      record(gated.entry, gated.costUsd)
      await save()
      await maybeRetryCopyZone(w.task, gated.entry)
    }
  }
  // D2-3 새로 만든 첫 화면 컷(편집기 재생성 제외)의 글자 자리 재생성 1회 — hero 일 안에서 끝내 뒤 컷들이 바뀐 hero를 스타일 참조로 받는다.
  // 게이트 대기 컷은 다음 run이 게이트를 본 뒤에 고른다(판정 전 컷을 글자 자리 재생성의 처음 컷으로 두지 않는다)
  const maybeRetryCopyZone = async (task: ImageTask, entry: SectionImage) => {
    if (entry.gatePending || !needsCopyZoneRetry(entry)) return
    const zoned = await retryCopyZone(baseCtx(), task, entry, runStart)
    record(zoned.entry, zoned.costUsd)
    await save()
  }

  let pool: { started: Work[]; skipped: Work[] }
  try {
    pool = await runWithConcurrency(works, options.concurrency ?? imageConcurrencyOf(job.image_model), {
      // R2: 히어로를 빛·색 참조로 받는 장면 컷은 효과 전용이어도 hero 뒤에 시작한다
      ready: (w) =>
        w.task.section === 'hero' || (w.task.effectOnly && !sceneStyleRefCut(job, w.task)) || heroState === 'open',
      canStart: (w) => {
        if (heroLost()) return false
        // 게이트 대기는 받기 + 채점 1시도가 들어갈 때만(지출 예약 없음 — 미달 재생성은 gateAndMaybeRegen이 시간·예약을 따로 본다)
        if (w.gateOf) return Date.now() - runStart + GATE_MIN_MS < budgetMs
        // 공급자 잔액 부족이 났다(R12c) — 같은 공급자(MS) 일은 이 run에 더 시작하지 않는다(다음 run·충전 뒤 다시 시도가 잇는다)
        if (providerHalt.reason !== null && isAsyncImageModel(w.task.model ?? job.image_model)) return false
        // 편집기 일·미룬 글자 자리 재생성은 판정 못 한 결과를 받지 않으므로 생성 뒤 게이트 시간까지 남을 때만 시작한다
        // (편집기 일은 다음 run의 대기로 남고, 미룬 글자 자리 재생성은 아래에서 skipped로 끝낸다)
        const gateMs = (w.editorOf && !w.task.skipGate) || w.zoneOf ? GATE_MIN_MS : 0
        // GIF 칸은 따로 센다 — 호출 상한이 run 남은 시간이라 시작 최소(motion/stage MOTION_START_MIN_MS)만 본다. motion이 없는 태스크는 지금 셈 그대로
        const motionFirst = Boolean(w.task.motion) && !w.editorOf && !w.retry && !w.regenOf && !w.zoneOf
        if (motionFirst ? !motionCanStart(Date.now() - runStart, budgetMs) : Date.now() - runStart + GENERATION_WORST_MS + gateMs >= budgetMs) return false
        if (spend.tryReserve(w.task.model ?? job.image_model, w.task.quality ?? job.image_quality)) return true
        if (spend.lastBlock === 'job') {
          stoppedByJobCap = true
          return false
        }
        spendBlocked = true
        stoppedBySpend = true
        return false
      },
      run: async (w) => {
        try {
          await runWork(w)
        } finally {
          if (w.task.section === 'hero') {
            // 글자 자리 재생성·게이트를 다음 run으로 미뤘으면 상품 컷도 기다린다 — 처음 컷(판정 전 컷)을 스타일 참조로 받은 컷이
            // 남지 않게
            const hero = sectionImages.find((e) => e.section === 'hero')
            heroState =
              hero && ((!hero.url && hero.retryPending) || copyZoneRetryPending(hero) || isGatePending(hero)) ? 'retry' : 'open'
          }
        }
      },
    })
    await saving
  } catch (error) {
    // 저장 실패 등으로 멈췄다 — 끝난 컷을 한 번 더 저장해 본다(성공하면 비용이 나간 산출이 잡에 남는다)
    await save().catch(() => undefined)
    throw error
  }
  // 지출 예약이 막혀 시작하지 못한 편집기 요청은 이전 이미지를 둔 채 failed로 끝낸다 — 대기로 남으면 같은 컷을 다시 요청할 수 없다
  // 공급자 잔액 부족으로 시작하지 못한 편집기 요청도 같다(R12c — 끝난 페이지를 단계 오류로 멈추지 않는다)
  const halted = providerHalt.reason !== null
  const blockedEditor = stoppedBySpend || halted ? pool.skipped.filter((w) => w.editorOf) : []
  if (blockedEditor.length > 0) {
    const nowIso = new Date().toISOString()
    for (const w of blockedEditor) {
      const why = halted ? `${IMAGE_PROVIDER_BALANCE_LABEL}으로` : spend.degraded ? 'AI 예산 조회 실패로' : '월 AI 예산 한도로'
      record(settleEditorRegen(w.editorOf!, 'failed', `${why} 다시 만들지 못했습니다 — 이전 이미지를 유지했습니다`, nowIso), 0)
    }
    await save()
  }
  // 미룬 글자 자리 재생성을 이번 run에도 시작하지 못했다(시간·지출 예약) — 더 미루지 않고 skipped로 끝낸다(편집기는 지금 T1).
  // 공급자 잔액 부족으로 멈춘 run은 미룬 채 두고 아래 단계 오류로 끝낸다(R12c — 충전 뒤 다시 시도가 잇는다)
  const blockedZone = halted ? [] : pool.skipped.filter((w) => w.zoneOf)
  if (blockedZone.length > 0) {
    for (const w of blockedZone) record({ ...w.zoneOf!, copyZone: { ...w.zoneOf!.copyZone!, retry: 'skipped' } }, 0)
    await save()
  }
  // 공급자 잔액 부족(R12c) — 보류한 컷·시작하지 않은 일·이월한 재생성을 둔 채 단계 오류로 멈춘다(아래 월 예산 한도와 같은 처리).
  // 끝난 컷은 저장했다. 다음 run·충전 뒤 '다시 시도'가 보류 컷을 첫 시도로 잇는다. 편집기 요청만 있던 run은 위에서 끝내고 그대로 진행한다
  if (halted && works.some((w) => !w.editorOf)) {
    await save()
    const held = sectionImages.filter((e) => e.providerBlocked && e.retryPending).length
    const detail = (providerHalt.reason ?? '').replace(`${IMAGE_PROVIDER_BALANCE_LABEL}: `, '')
    throw new Error(`${PDP_PROVIDER_BALANCE_STEP_ERROR}(보류 컷 ${held}개·시작 안 한 일 ${pool.skipped.length}개) — ${detail}`)
  }
  // 월 한도가 남은 일의 단가보다 작아 하나도 시작하지 못했다 — 조용히 멈추지 않게 단계 실패로 기록한다(pipeline 예산 차단과 같은 처리).
  // 막힌 일이 편집기 요청·미룬 글자 자리 재생성뿐이면 위에서 끝냈으므로 단계는 그대로 진행한다
  if (spendBlocked && pool.started.length === 0 && pool.skipped.some((w) => !w.editorOf && !w.zoneOf)) {
    throw new Error(
      spend.degraded
        ? 'AI 예산 조회 실패 — 이미지 생성을 시작하지 않았습니다(조회가 돌아오면 다시 진행)'
        : '월 AI 예산 한도 — 남은 한도로 이미지 1장도 시작할 수 없습니다'
    )
  }
  // 첫 생성 잡의 비용 상한(점검 고침 5, 통합 Q2) — 시작하지 못한 컷을 실패 컷으로 정리한다(결과 화면 '사진을 만들지 못한 컷' 배너에
  // 사유가 나온다). 이월된 게이트 재생성은 앞 컷을 두고(K 컷이 상품 불일치면 #887 규칙대로 빼거나 대표 컷은 경고), 게이트 대기는
  // 다음 run이 판정한다(예약 없음). 대표 컷이 실패 컷이 되면 아래 heroLost가 지금처럼 잡을 failed로 끝낸다
  const jobCapped = stoppedByJobCap ? pool.skipped.filter((w) => !w.editorOf && !w.zoneOf && !w.gateOf) : []
  // 잡 기록(section_plan.job_cost_cap) — 경고·첫 10장 기록용. 앞 run 기록이 있으면 정리한 컷을 합친다
  let capRecord: JobCostCapRecord | null = null
  if (jobCapped.length > 0) {
    const capError = jobCapCutError()
    const before = job.section_plan.job_cost_cap
    capRecord = {
      capUsd: jobCostCapUsd(),
      spentUsd: Math.round(capStartSpent * 10000) / 10000,
      sections: [...new Set([...(before?.sections ?? []), ...jobCapped.map((w) => w.task.section)])],
      at: new Date().toISOString(),
    }
    for (const w of jobCapped) {
      if (w.regenOf) {
        const gate = w.regenOf.gate
        record(
          settleLineFailure(
            w.task,
            { ...w.regenOf, pendingRegen: false },
            {
              same_product: gate?.same_product ?? undefined,
              artifact_reason: w.regenOf.error ?? '',
              use_correct: gate?.use_correct,
              use_reason: gate?.use_reason,
            },
            `${capError} — 앞 컷 유지(${w.regenOf.error ?? '게이트 미달'})`,
            strictUseGateOf(job, w.task) ? { use: true } : undefined
          ),
          0
        )
        continue
      }
      const existing = sectionImages.find((e) => e.section === w.task.section)
      record({ ...(existing ?? {}), section: w.task.section, url: '', error: capError, retryPending: false, pendingRegen: false }, 0)
    }
    console.warn(`[registration/pdp-image] ${capError} — 컷 ${jobCapped.length}개 정리: ${jobCapped.map((w) => w.task.section).join(', ')}`)
    await save()
  }

  // 지금 태스크에 있는 섹션만 센다 — 생성 범위가 줄면(디자인 컷 미사용 컷) 예전 기록의 재생성 대기가 영원히 남지 않게
  if (heroLost()) {
    const reason = sectionImages.find((e) => e.section === 'hero')?.error ?? ''
    return updatePdpJob(db, userId, job.id, {
      sectionImages,
      designPrompts,
      costUsd,
      ...(capRecord ? { sectionPlan: { ...job.section_plan, job_cost_cap: capRecord } } : {}),
      currentStep: 'failed',
      error: `첫 화면(hero) 컷을 만들지 못했습니다 — ${reason}`,
    })
  }

  const taskSections = new Set(tasks.map((t) => t.section))
  const producedCount = sectionImages.filter((e) => e.url && taskSections.has(e.section)).length
  const allTasksAttempted = tasks.every((t) => isSectionSettled(sectionImages.find((e) => e.section === t.section)))
  // 편집기 사후 재생성(W5b) 대기도 센다 — 시간이 모자라 남은 골격 밖 요청이 다음 run에 이어지게
  const noRegenPending = !sectionImages.some(
    (e) =>
      e.pendingRegen &&
      (taskSections.has(e.section) || (isEditorRegenPending(e) && editorTaskOf(e.section) !== undefined))
  )
  // D2-3 미룬 글자 자리 재생성도 센다 — 다음 run 맨 앞에서 끝내야 장식·합성으로 넘어간다
  const noZonePending = !sectionImages.some((e) => copyZoneRetryPending(e) && taskSections.has(e.section))
  // 게이트 대기도 센다 — 판정 전 컷이 장식·합성으로 넘어가지 않게(다음 run 맨 앞에서 판정)
  const noGatePending = !sectionImages.some((e) => isGatePending(e) && taskSections.has(e.section))
  // 3) 강조 장식 — 생성·재생성·게이트가 끝난 뒤에만(재생성으로 url이 바뀌면 그 컷은 다시 대상이 된다)
  let annotationsLeft = 0
  if (allTasksAttempted && noRegenPending && noZonePending && noGatePending) {
    const annotated = await annotateSectionImages(db, userId, job, sectionImages, costUsd, runContext, runStart, {
      budgetMs,
      ...lease,
      ...(isFirstGeneration(job) ? { costCapUsd: jobCostCapUsd() } : {}),
    })
    sectionImages = annotated.sectionImages
    costUsd = annotated.costUsd
    annotationsLeft = pendingAnnotationTargets({ ...job, section_images: sectionImages }).length
  }
  // allDone은 장식 완료를 포함한다 — compose로 넘어간 뒤 resolveStepToRun이 images로 되돌리는 왕복을 막는다
  const allDone = allTasksAttempted && noRegenPending && noZonePending && noGatePending && annotationsLeft === 0
  const subProgress = tasks.length > 0 ? Math.round((producedCount / tasks.length) * 20) : 0

  if (allImageTasksFailed(tasks, sectionImages)) {
    // 전량 실패 — compose로 전진하면 빈 산출로 합성이 진행된다. 명시적으로 failed 전이(§6.4).
    return updatePdpJob(db, userId, job.id, {
      sectionImages,
      designPrompts,
      costUsd,
      currentStep: 'failed',
      error: `이미지 생성 ${tasks.length}건 전부 실패 — 섹션별 사유는 section_images[].error 참조`,
    })
  }

  // 빠진 컷이 있어도 done까지 간다 — 기록하고 결과 화면이 알린다(PdpPreview). 0건도 쓴다: 다시 돌린 잡의 앞 기록을 지우고, 예전 잡과 가른다
  const failedCuts = allDone ? cutFailureSummary(sectionImages.filter((e) => taskSections.has(e.section))) : null
  if (failedCuts && failedCuts.cutsFailed > 0) {
    console.warn(`[registration/pdp-image] 사진 없는 컷 ${failedCuts.cutsFailed}개로 합성 진행: ${failedCuts.cutsFailedSections.join(', ')}`)
  }
  // K 잡 — 컷이 빠져 못 그리는 섹션을 기록한다. 이 일은 스위치 켠 잡만 라이브러리를 읽는다
  const lineRecord = job.section_plan.templatelib
  const lost = failedCuts && lineRecord ? (await import('./pdp-image-kline')).lostSectionsOf(job, sectionImages) : null
  if (lost && lost.length > 0) console.warn(`[pdp/templatelib] 컷이 빠져 못 그리는 섹션 ${lost.length}개: ${lost.map((row) => row.key).join(', ')}`)
  return updatePdpJob(db, userId, job.id, {
    sectionImages,
    designPrompts,
    costUsd,
    ...(failedCuts || capRecord
      ? {
          sectionPlan: {
            ...job.section_plan,
            ...(failedCuts ? { cuts_failed: { count: failedCuts.cutsFailed, sections: failedCuts.cutsFailedSections } } : {}),
            ...(lost && lineRecord ? { templatelib: { ...lineRecord, lost } } : {}),
            ...(capRecord ? { job_cost_cap: capRecord } : {}),
          },
        }
      : {}),
    currentStep: allDone ? 'compose' : 'images',
    // 장식 run은 별도 진행률(남은 대상이 줄 때마다 전진) — 정체 감지 서명과 겹치지 않게
    progress: allDone ? 95 : annotationsLeft > 0 ? annotationProgress(annotationsLeft) : 75 + subProgress,
  })
}
