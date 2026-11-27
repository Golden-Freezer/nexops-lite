/**
 * PDP 파이프라인 5단계(이미지 생성) run 오케스트레이션 — NEXFIT image_generation_agent.py
 * 이식(§9.1 ③ 실측 축소판: Lite/Judge 티어링·Pillow 합성 없음, run당 이미지 1장
 * 순차 생성). 태스크 목록·팔레트 치환은 pdp-image-tasks.ts(순수) 소관, 여기는 참조 로드·Style
 * Charter·식별카드·생성 호출·Vision 게이트·스토리지 저장까지의 오케스트레이션만 담당한다.
 *
 * 로컬 Codex 호출은 오래 걸릴 수 있으므로 게이트 재생성도 `pendingRegen`으로 이월해 다음 run에서
 * 한 장만 처리한다(§6.3 "이월 가능한 구조").
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { generateImage } from '@/lib/agents/image/generate'
import { estimateImageCostUsd } from '@/lib/agents/image/types'
import { RateLimitedError } from '@/lib/local-codex/image'
import type { RunContext } from '@/lib/agents/types'
import { fetchImageAsBase64, type VisionImage } from '@/lib/agents/registration/thumbnail-vision-agent'
import { readIdentityCard, judgeImageGate } from '@/lib/agents/registration/pdp-image-agent'
import { buildStyleCharter, getCategoryDirective } from '@/lib/agents/registration/prompts/pdp-image-prompts'
import { applyRegenDirective, classifyGateFailure, type GateScoreRow } from '@/lib/agents/registration/prompts/pdp-image-gate-prompts'
import { pdpStorageObjectExists, uploadPdpImage } from './storage'
import { buildImageGroundingBlock } from './corpus'
import { buildInternalizedImageBlock } from './corpus-v2'
import { buildAgeComplianceImageBlock } from './compliance-gate'
import { resolveGenerationTrack } from './pdp-state'
import { mergeManualStrategy } from './pdp-strategy-contract'
import { buildImageTasks, type ImageTask } from './pdp-image-tasks'
import { calculateRateLimitRetry, getRateLimitWaitUntil } from './pdp-image-retry'
import { getUspIconLibrary, selectUspIcon } from './usp-icon-library'
import { updatePdpJob } from './pdp-jobs'
import type { DesignPrompts, PdpJobRow, SectionImage } from './pdp-state'

// NEXFIT image_generation_agent.py:150 IMAGE_QUALITY_THRESHOLDS["consistency_score_min"]
const CONSISTENCY_SCORE_MIN = 0.7

// NEXFIT image_generation_agent.py:288-293 _STYLE_PACK_MOOD_KEYWORDS
const STYLE_PACK_MOOD_KEYWORDS: Record<string, string> = {
  clean_proof: 'clean · trustworthy · precise · bright · uncluttered',
  warm_story: 'cozy · warm · inviting · soft · trustworthy',
  premium_editorial: 'premium · refined · calm · editorial · sophisticated',
  cute_soft: 'soft · playful · adorable · pastel · friendly',
}

// NEXFIT image_generation_agent.py:1361-1378 _generate_with_reference 역할 지시문
const REFERENCE_ROLES_TEXT =
  "REFERENCE ROLES: the FIRST attached image is the USER'S ORIGINAL PRODUCT PHOTO and it is " +
  "the single source of truth for the product's structure — shape, number of tiers/parts, " +
  'handles, openings and assembled state. ' +
  'STYLE REFERENCE: the LAST attached image is the finished HERO cut of this same product page. ' +
  'Use it ONLY for lighting, background tone, and color grading — match those exactly. ' +
  'Do NOT copy its composition, do NOT duplicate its subject placement, and do NOT copy the ' +
  'product structure or component count from it.'

/** 스타일 헌장 파생 — NEXFIT `_build_style_charter`(:295-378) 1:1, 파이프라인당 1회 확정용. */
function buildStyleCharterForJob(job: PdpJobRow): string {
  const palette = job.copy_sections.final?.designPalette ?? {}
  const lighting = (job.design_prompts.lighting_params ?? {}) as Record<string, unknown>
  const direction = typeof lighting.direction === 'string' ? lighting.direction : 'top-left'
  const shadowAngle = typeof lighting.shadow_angle === 'number' ? lighting.shadow_angle : 45
  const colorTemp = typeof lighting.color_temperature === 'string' ? lighting.color_temperature : 'warm'

  const category = job.analysis.detected_category || job.spec_sheet.category || 'household'
  const catLighting = getCategoryDirective(category, 'lighting_override')
  const tempDesc =
    catLighting ||
    (colorTemp === 'warm' ? 'warm (~5200K)' : colorTemp === 'cool' ? 'cool-neutral (~5600K)' : `${colorTemp} (5500K daylight balanced)`)

  const bgHex = palette.bgMain || '#ffffff'
  const propColors = [palette.primary, palette.secondary, palette.bgSub].filter(Boolean).join(', ') || '#4f46e5, #818cf8, #f8fafc'

  const strategyContract = mergeManualStrategy(job.analysis.recommended_strategy_contract ?? {}, job.spec_sheet, [])
  const mood = STYLE_PACK_MOOD_KEYWORDS[strategyContract.visual_style_pack ?? ''] ?? STYLE_PACK_MOOD_KEYWORDS.clean_proof

  const visualPlan = job.design_prompts.visual_plan as Record<string, unknown> | undefined
  const heroVisual = (visualPlan?.hero_visual ?? {}) as Record<string, unknown>
  const bgTone = typeof heroVisual.background_tone === 'string' ? heroVisual.background_tone.trim() : ''
  const lightingMood = typeof heroVisual.lighting === 'string' ? heroVisual.lighting.trim() : ''
  const setParts = [bgTone && `backdrop tone: ${bgTone}`, lightingMood && `lighting mood: ${lightingMood}`].filter(Boolean) as string[]
  const setDesc = setParts.length ? setParts.join('; ') : 'one continuous studio set shared by every cut of this page'

  return buildStyleCharter({
    bgHex,
    colorTemp: tempDesc,
    direction,
    shadowAngle,
    propColors,
    mood,
    setDesc,
    photographyNote: job.spec_sheet.photographyNote?.trim(),
  })
}

async function loadValidRefs(urls: string[]): Promise<VisionImage[]> {
  const fetched = await Promise.all(urls.map((u) => fetchImageAsBase64(u)))
  return fetched.filter((f): f is VisionImage => f !== null)
}

// gpt-image-2(/v1/images/generations,edits)는 고정 사이즈 3종만 허용 — aspectRatio 힌트를 가장 가까운 값으로 매핑.
// Gemini 경로(generate.ts)는 size를 소비하지 않으므로 이 매핑은 OpenAI 모델 선택 시에만 의미가 있다.
const ASPECT_TO_SIZE: Record<string, string> = {
  '1:1': '1024x1024',
  '3:4': '1024x1536',
  '16:9': '1536x1024',
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
 * 최종 프롬프트 조립 — 식별카드(제품 등장 컷만) → REFERENCE ROLES(스타일 참조 동반 시) → Style Charter
 * → 코퍼스 이미지 그라운딩(결정 H 주입 지점 ③, 스타일 차터 뒤 별도 섹션 — corpus.ts 자체가
 * ANTI_COPY_PREAMBLE·모바일 공통 규칙을 이미 머리에 붙여 반환하므로 여기서는 그대로 append만 한다).
 */
function assemblePrompt(
  basePrompt: string,
  task: ImageTask,
  designPrompts: DesignPrompts,
  hasStyleRef: boolean,
  imageGroundingBlock: string
): string {
  let prompt = basePrompt
  if (!task.effectOnly && designPrompts.identity_card) prompt = `${prompt}\n\n${designPrompts.identity_card}`
  if (hasStyleRef) prompt = `${prompt}\n\n${REFERENCE_ROLES_TEXT}`
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
  runContext: RunContext
  /** 게이트 재생성 지시문 부착용(§6.4 "재실패는 error 마킹") — 신규 생성이면 undefined. */
  regenScore?: GateScoreRow
}

/** 컷 1개 생성 + 업로드. 실패는 throw하지 않고 error가 실린 SectionImage로 흡수(§6.4 — 섹션만 실패). */
async function generateSection(ctx: GenerateContext, task: ImageTask): Promise<{ entry: SectionImage; costUsd: number }> {
  const heroUrl = task.section === 'hero' ? undefined : findSectionUrl(ctx.sectionImages, 'hero')
  const styleRef = heroUrl ? await fetchImageAsBase64(heroUrl) : null
  const refs = task.effectOnly
    ? []
    : styleRef
      ? [...ctx.sourceRefs.slice(0, 4), styleRef]
      : ctx.sourceRefs.slice(0, 5)

  let prompt = assemblePrompt(task.prompt, task, ctx.designPrompts, Boolean(styleRef), ctx.imageGroundingBlock)
  if (ctx.regenScore) prompt = applyRegenDirective(prompt, ctx.regenScore)

  // 개정 5: 저가 컷(rating_bg·USP 아이콘 폴백)은 태스크 지정 모델이 잡 선택 모델을 이긴다
  const model = task.model ?? ctx.job.image_model

  // 생성 자체가 성공하면 즉시 비용을 확정한다 — 이후 업로드 단계에서 실패해도(네트워크·스토리지 장애)
  // 이미 발생한 생성 비용은 보존해야 한다(§6.4, catch에서도 이 값을 그대로 반환).
  let costUsd = 0
  const prior = ctx.sectionImages.find((section) => section.section === task.section)
  try {
    const result = await generateImage({
      prompt,
      model,
      quality: ctx.job.image_quality,
      size: ASPECT_TO_SIZE[task.aspectRatio] ?? '1024x1024',
      referenceImages: refs.map((r) => ({ base64: r.data, mimeType: r.mediaType })),
      agentName: 'registration/pdp-image',
      runContext: {
        ...ctx.runContext,
        stage: ctx.regenScore
          ? `images/${task.section}/regenerate`
          : `images/${task.section}`,
      },
    })
    costUsd = estimateImageCostUsd(model, ctx.job.image_quality)
    const url = await uploadPdpImage(ctx.db, ctx.userId, ctx.job.id, task.section, result.base64, result.mimeType)
    return { entry: { section: task.section, url, prompt: task.prompt, retried: Boolean(ctx.regenScore) }, costUsd }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    if (e instanceof RateLimitedError) {
      const retry = calculateRateLimitRetry(prior?.rateLimitCount)
      return {
        entry: {
          section: task.section,
          url: prior?.url ?? '',
          prompt: task.prompt,
          error: message,
          pendingRegen: true,
          regenReason: 'rate_limit',
          retried: prior?.retried ?? false,
          ...retry,
        },
        costUsd,
      }
    }
    return {
      entry: { section: task.section, url: prior?.url ?? '', prompt: task.prompt, error: `${task.section} 생성 실패: ${message}`, retried: Boolean(ctx.regenScore) },
      costUsd,
    }
  }
}

/** 생성 직후 Vision 게이트 — 미달 시 시간 여유가 있으면 즉시 재생성 1회, 없으면 이월 표시만. */
async function gateAndMaybeRegen(
  ctx: GenerateContext,
  task: ImageTask,
  entry: SectionImage,
): Promise<{ entry: SectionImage; costUsd: number }> {
  if (task.skipGate || !entry.url || ctx.sourceRefs.length === 0) return { entry, costUsd: 0 }

  const generatedImg = await fetchImageAsBase64(entry.url)
  if (!generatedImg) return { entry, costUsd: 0 }

  const { score, costUsd: gateCost } = await judgeImageGate(
    ctx.sourceRefs[0],
    task.section,
    generatedImg,
    { ...ctx.runContext, stage: `images/${task.section}/gate` },
  )
  if (!score) return { entry, costUsd: gateCost }

  const failed = score.has_artifact || score.same_product === false || score.consistency < CONSISTENCY_SCORE_MIN
  if (!failed) return { entry: { ...entry, pendingRegen: false }, costUsd: gateCost }
  if (entry.retried) {
    // 재생성 예산 소진 — 게이트 미달을 기록만 하고 원본 유지(§6.4)
    const reason = classifyGateFailure(score)
    return { entry: { ...entry, error: `게이트 미달(재생성 소진, ${reason})`, pendingRegen: false }, costUsd: gateCost }
  }

  return {
    entry: {
      ...entry,
      pendingRegen: true,
      regenReason: 'gate',
      error: `게이트 미달 — 재생성 대기: ${score.artifact_reason || '일관성 미달'}`,
    },
    costUsd: gateCost,
  }
}

/**
 * images 단계 run 1회 실행 — 태스크 목록 조립 → 재생성 대기 큐 우선 처리 → 신규 태스크 처리(슬롯 예산 내)
 * → 전 태스크 완주 시 compose로 전이. job.copy_sections.final이 없으면 호출 자체가 계약 위반(파이프라인이 보장).
 */
export async function runImagesStep(db: SupabaseClient, userId: string, job: PdpJobRow): Promise<PdpJobRow> {
  const tasks = buildImageTasks(job)
  if (tasks.length === 0) throw new Error('이미지 태스크를 구성할 카피 산출이 없습니다 — 잡 상태 불일치')

  let designPrompts = job.design_prompts
  let sectionImages = [...job.section_images]
  let costUsd = job.cost_usd
  const runContext: RunContext = {
    userId,
    ...(job.business_id ? { businessId: job.business_id } : {}),
    stage: 'images',
  }

  // 남은 작업이 전부 미래의 한도 재시도라면 참조 로드·식별카드·이미지 생성 모두 건너뛴다.
  const initialWaitUntil = getRateLimitWaitUntil(tasks, sectionImages)
  if (initialWaitUntil) {
    return updatePdpJob(db, userId, job.id, {
      currentStep: 'waiting_rate_limit',
      progress: Math.max(job.progress, 75),
    })
  }

  const sourceRefs = await loadValidRefs(job.source_images)

  if (!designPrompts.style_charter) {
    designPrompts = { ...designPrompts, style_charter: buildStyleCharterForJob(job) }
  }
  if (designPrompts.identity_card === undefined && sourceRefs.length > 0) {
    const { card, costUsd: idCost } = await readIdentityCard(sourceRefs[0], {
      ...runContext,
      stage: 'images/identity',
    })
    designPrompts = { ...designPrompts, identity_card: card }
    costUsd += idCost
    // Vercel maxDuration 도중 504가 나도 이 콜의 산출·비용은 보존한다(§6.4 부분 저장 원칙).
    await updatePdpJob(db, userId, job.id, { designPrompts, costUsd })
  }

  // Track I(§5 images 행): v2 레시피 블록(역할 전량·환산 px·hex)이 v1 참고 블록을 대체 — 미보유 시 v1 폴백.
  const internalizedImageBlock =
    resolveGenerationTrack(job) === 'internalized' ? buildInternalizedImageBlock(job.analysis.detected_category) : null
  // 연령 컴플라이언스(만 14세 이상 상품): 전 컷 공통 미성년 묘사 금지 지시를 grounding에 강제 append
  const ageImageBlock = buildAgeComplianceImageBlock(job.spec_sheet)
  const imageGroundingBlock = [
    internalizedImageBlock ?? buildImageGroundingBlock(job.analysis.detected_category),
    ageImageBlock,
  ]
    .filter((b): b is string => Boolean(b))
    .join('\n\n')

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
        if (icon && await pdpStorageObjectExists(db, icon.storagePath)) {
          sectionImages = upsertSectionImage(sectionImages, { section: t.section, url: icon.url, prompt: `library:${icon.slug}` })
          libraryHits++
        } else if (icon) {
          console.warn(`[registration/pdp-image] USP 아이콘 객체 없음 — 폴백 생성: ${icon.storagePath}`)
        }
      }
      if (libraryHits > 0) await updatePdpJob(db, userId, job.id, { sectionImages, costUsd })
    }
  }

  const slotBudget = 1
  let slotsUsed = 0
  const baseCtx = (): GenerateContext => ({
    db,
    userId,
    job,
    designPrompts,
    sourceRefs,
    sectionImages,
    imageGroundingBlock,
    runContext,
  })

  // 1) 게이트 재생성 대기 큐(이월분) 우선
  for (const pending of sectionImages.filter((e) => e.pendingRegen)) {
    if (slotsUsed >= slotBudget) break
    const retryAt = pending.retryAfter ? Date.parse(pending.retryAfter) : Number.NaN
    if (Number.isFinite(retryAt) && retryAt > Date.now()) continue
    const task = tasks.find((t) => t.section === pending.section)
    if (!task) continue
    const directRetry = pending.regenReason === 'missing'
      || pending.regenReason === 'rate_limit'
      || pending.rateLimitCount !== undefined
      || pending.retryAfter !== undefined
    const reasonScore: GateScoreRow = { artifact_reason: pending.error ?? '', same_product: undefined }
    const regen = await generateSection(
      directRetry ? baseCtx() : { ...baseCtx(), regenScore: reasonScore },
      task,
    )
    sectionImages = upsertSectionImage(sectionImages, regen.entry)
    costUsd += regen.costUsd
    slotsUsed++
    // 장 단위 부분 저장 — 이후 슬롯에서 504가 나도 이번 장은 잡에 남는다(§6.4).
    await updatePdpJob(db, userId, job.id, { sectionImages, costUsd })
    if (directRetry && regen.entry.url && !regen.entry.error) {
      const gated = await gateAndMaybeRegen(baseCtx(), task, regen.entry)
      sectionImages = upsertSectionImage(sectionImages, gated.entry)
      costUsd += gated.costUsd
      await updatePdpJob(db, userId, job.id, { sectionImages, costUsd })
    }
  }

  // 2) 신규 태스크(순서대로 — hero가 항상 먼저 나온다)
  for (const task of tasks) {
    if (slotsUsed >= slotBudget) break
    if (sectionImages.some((e) => e.section === task.section)) continue

    const genResult = await generateSection(baseCtx(), task)
    sectionImages = upsertSectionImage(sectionImages, genResult.entry)
    costUsd += genResult.costUsd
    slotsUsed++
    await updatePdpJob(db, userId, job.id, { sectionImages, costUsd })

    if (genResult.entry.url) {
      const gated = await gateAndMaybeRegen(baseCtx(), task, genResult.entry)
      sectionImages = upsertSectionImage(sectionImages, gated.entry)
      costUsd += gated.costUsd
      await updatePdpJob(db, userId, job.id, { sectionImages, costUsd })
    }
  }

  const producedCount = tasks.filter((task) => findSectionUrl(sectionImages, task.section)).length
  const allTasksAttempted = tasks.every((t) => sectionImages.some((e) => e.section === t.section && (e.url || e.error)))
  const noRegenPending = !sectionImages.some((e) => e.pendingRegen)
  const allDone = allTasksAttempted && noRegenPending
  const subProgress = tasks.length > 0 ? Math.round((producedCount / tasks.length) * 20) : 0

  const waitUntil = getRateLimitWaitUntil(tasks, sectionImages)

  return updatePdpJob(db, userId, job.id, {
    sectionImages,
    designPrompts,
    costUsd,
    currentStep: allDone ? 'compose' : waitUntil ? 'waiting_rate_limit' : 'images',
    progress: allDone ? 95 : 75 + subProgress,
  })
}
