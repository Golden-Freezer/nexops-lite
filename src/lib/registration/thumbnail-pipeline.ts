/**
 * 대표이미지 3컷 파이프라인 상태기계 — NEXFIT service.py run() 이식 (run 분할 실행 판).
 *
 * run 1회 = 1스텝(Vercel maxDuration 안): 분석 → cutout → studio → usage → 게이트(+재생성/재판정).
 * 원본 보존 규칙: 참조 전량 첨부 · cutout 체이닝 · 재시도 예산 잡 전체 2컷 · flat_margin_band
 * cutout 미적용 · 3컷 올-오어-낫싱 · 게이트는 차단이 아니라 신호(재판정 실패여도 잡 성공).
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { generateImage } from '@/lib/agents/image/generate'
import { estimateImageCostUsd } from '@/lib/agents/image/types'
import type { RunContext } from '@/lib/agents/types'
import {
  analyzeProduct,
  planImpactConcept,
  fetchImageAsBase64,
  type VisionImage,
} from '@/lib/agents/registration/thumbnail-vision-agent'
import { scoreGate, failedGate } from '@/lib/agents/registration/thumbnail-gate-agent'
import { buildThumbnailPrompts } from '@/lib/agents/registration/prompts/thumbnail-prompts'
import { uploadThumbnailCut } from './storage'
import { getThumbnailJob, updateThumbnailJob } from './jobs'
import {
  THUMBNAIL_CUTS,
  type CutsRecord,
  type ThumbnailCut,
  type ThumbnailJob,
} from './thumbnail-types'

/** 1잡 비용 상한 — NEXFIT kill_switch($3.50/건) 축소 적용(설계문서 §6.4) */
export const JOB_COST_CAP_USD = 2
/** 잡 전체 재생성 예산 — NEXFIT service.py:419 retried_cuts 예산과 동일 */
export const RETRY_BUDGET = 2

const CUT_PROGRESS: Record<ThumbnailCut, number> = { cutout: 45, studio: 65, usage: 80 }

function buildRunContext(
  userId: string,
  job: ThumbnailJob,
  stage: string,
): RunContext {
  return {
    userId,
    ...(job.businessId ? { businessId: job.businessId } : {}),
    stage,
  }
}

/** 재생성을 소비한 컷 수 (생성 실패·게이트 미달 공용 예산) */
export function retriedCount(cuts: CutsRecord): number {
  return THUMBNAIL_CUTS.filter((cut) => cuts[cut]?.retried).length
}

/**
 * 다음 생성 대상 컷 — url 없고 재시도 소진(error+retried)도 아닌 첫 컷.
 * 실패 컷을 건너뛰고 나머지를 계속 생성한다(원본 S6 — 최종 판정은 올-오어-낫싱).
 */
export function nextCutToGenerate(cuts: CutsRecord): ThumbnailCut | null {
  for (const cut of THUMBNAIL_CUTS) {
    const entry = cuts[cut]
    if (entry?.url) continue
    if (entry?.error && entry.retried) continue // 예산 소진 — 스킵
    return cut
  }
  return null
}

/**
 * 게이트 후 재생성 대상 — NEXFIT service.py:453-465:
 * cutout은 전체 미통과 시, studio는 presentation 미통과 시에만(identity 실패는 재시도 안 함).
 * 이미 재생성을 소비한 컷은 제외, 남은 예산 안에서만.
 */
export function gateRetryTargets(cuts: CutsRecord): ThumbnailCut[] {
  const targets: ThumbnailCut[] = []
  const cutoutGate = cuts.cutout?.gate
  const studioGate = cuts.studio?.gate
  if (cutoutGate && !cutoutGate.passed && !cuts.cutout?.retried) targets.push('cutout')
  if (studioGate && !studioGate.presentation.passed && !cuts.studio?.retried) targets.push('studio')
  const remaining = Math.max(RETRY_BUDGET - retriedCount(cuts), 0)
  return targets.slice(0, remaining)
}

/** 3컷 올-오어-낫싱 최종 판정 — NEXFIT service.py:532-544 */
export function finalizeCuts(cuts: CutsRecord): { ok: boolean; error: string | null } {
  const missing = THUMBNAIL_CUTS.filter((cut) => !cuts[cut]?.url)
  if (missing.length === 0) return { ok: true, error: null }
  const cutErrors = THUMBNAIL_CUTS.map((cut) => cuts[cut]?.error)
    .filter((e): e is string => !!e)
    .join('; ')
  return {
    ok: false,
    error:
      `3컷 세트가 완성되지 않았습니다(미완성: ${missing.join(', ')})` +
      (cutErrors ? ` — ${cutErrors}` : ''),
  }
}

async function loadSourceImages(urls: string[]): Promise<VisionImage[]> {
  const fetched = await Promise.all(urls.map((u) => fetchImageAsBase64(u)))
  return fetched.filter((f): f is VisionImage => f !== null)
}

async function failJob(
  db: SupabaseClient,
  userId: string,
  jobId: string,
  error: string,
  costUsd?: number
): Promise<ThumbnailJob> {
  return updateThumbnailJob(db, userId, jobId, {
    status: 'failed',
    error,
    ...(costUsd !== undefined ? { costUsd } : {}),
  })
}

/** run 1스텝 실행. 존재하지 않는 잡이면 null. 내부 예외는 잡 failed로 기록 후 반환(조용히 삼키지 않음). */
export async function runThumbnailStep(
  db: SupabaseClient,
  userId: string,
  jobId: string
): Promise<ThumbnailJob | null> {
  const job = await getThumbnailJob(db, userId, jobId)
  if (!job) return null
  if (job.status === 'done' || job.status === 'failed') return job
  if (job.costUsd >= JOB_COST_CAP_USD) {
    // 3컷이 이미 배달된 상태(게이트 재생성 국면)면 실패로 뒤집지 않고 현 상태로 확정한다
    const delivered = THUMBNAIL_CUTS.every((cut) => job.cuts[cut]?.url)
    if (job.status === 'gating' && delivered) {
      return finalizeJob(db, userId, jobId, job.cuts, job.costUsd)
    }
    return failJob(db, userId, jobId, `1잡 비용 상한($${JOB_COST_CAP_USD}) 초과 — 생성 중단`)
  }

  try {
    switch (job.status) {
      case 'pending':
      case 'analyzing': // 이전 run이 분석 중 중단된 경우 재개
        return await stepAnalyze(db, userId, job)
      case 'generating':
        return await stepGenerate(db, userId, job)
      case 'gating':
        return await stepGate(db, userId, job)
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    return failJob(db, userId, jobId, message)
  }
}

/** 스텝 1: Vision 분석 + 임팩트 컨셉 (NEXFIT S1~S2) */
async function stepAnalyze(db: SupabaseClient, userId: string, job: ThumbnailJob): Promise<ThumbnailJob> {
  await updateThumbnailJob(db, userId, job.id, { status: 'analyzing', progress: 5 })

  const images = await loadSourceImages(job.sourceImages)
  if (images.length === 0) {
    return failJob(db, userId, job.id, '유효한 참조 이미지를 불러오지 못했습니다.')
  }

  const analysisResult = await analyzeProduct(
    images,
    job.productName,
    job.categoryHint,
    buildRunContext(userId, job, 'analyze'),
  )
  let costUsd = job.costUsd + analysisResult.usage.cost
  if (!analysisResult.success) {
    return failJob(db, userId, job.id, `Vision 분석 실패: ${analysisResult.error.message}`, costUsd)
  }
  const analysis = analysisResult.data

  const concept = await planImpactConcept(
    analysis,
    images[analysis.reference_index] ?? images[0],
    buildRunContext(userId, job, 'analyze'),
  )
  costUsd += concept.costUsd

  return updateThumbnailJob(db, userId, job.id, {
    visionAnalysis: { ...analysis, impact_concept: concept.concept },
    status: 'generating',
    progress: 25,
    costUsd,
  })
}

/** 참조 로드 + cutout 체이닝(NEXFIT S5 — cutout 확정 후 downstream 참조에 추가) */
async function loadReferences(job: ThumbnailJob, forCut: ThumbnailCut): Promise<VisionImage[]> {
  const refs = await loadSourceImages(job.sourceImages)
  // 부분 로드면 조용히 축소 생성하지 않고 명시적으로 실패시킨다 — 참조 1장 누락이 색상 변형
  // 누락으로 이어진 원본 실증(아쿠아슈즈) 때문. 일시 장애는 컷 재시도 경로가 흡수한다.
  if (refs.length < job.sourceImages.length) {
    throw new Error(`참조 이미지 로드 실패 (${refs.length}/${job.sourceImages.length}장만 로드됨)`)
  }
  if (refs.length === 0) throw new Error('유효한 참조 이미지를 불러오지 못했습니다.')
  const cutoutUrl = job.cuts.cutout?.url
  if (forCut !== 'cutout' && cutoutUrl) {
    const chained = await fetchImageAsBase64(cutoutUrl)
    if (chained) refs.push(chained)
  }
  return refs
}

/** 스텝 2~4: 컷 1개 생성 (run 1회 = 이미지 1장 — §9.1 타임아웃 실측 기준) */
async function stepGenerate(db: SupabaseClient, userId: string, job: ThumbnailJob): Promise<ThumbnailJob> {
  const analysis = job.visionAnalysis
  if (!analysis) return failJob(db, userId, job.id, '분석 산출이 없습니다 — 잡 상태 불일치')

  const cut = nextCutToGenerate(job.cuts)
  if (cut === null) {
    return updateThumbnailJob(db, userId, job.id, { status: 'gating', progress: 80 })
  }

  const cuts: CutsRecord = { ...job.cuts }
  let costUsd = job.costUsd

  // error가 남은 컷을 다시 받았다 = 이번 시도가 재시도다 — 예산을 여기서 소비한다.
  // (첫 실패는 {error}만 마킹 → 다음 run이 재시도, 재시도 실패 시 {error, retried} → 스킵)
  const entry = cuts[cut]
  if (entry?.error) {
    if (retriedCount(cuts) >= RETRY_BUDGET) {
      // 예산 소진 — 재시도 없이 소진 마킹하고 다음 컷으로
      cuts[cut] = { ...entry, retried: true }
      const skipNext = nextCutToGenerate(cuts)
      return updateThumbnailJob(db, userId, job.id, {
        cuts,
        status: skipNext === null ? 'gating' : 'generating',
      })
    }
    cuts[cut] = { ...entry, retried: true }
  }

  const prompts = buildThumbnailPrompts(analysis, analysis.category, analysis.impact_concept)
  const refs = await loadReferences(job, cut)

  try {
    const result = await generateImage({
      prompt: prompts[cut],
      model: job.imageModel,
      quality: job.imageQuality,
      size: '1024x1024',
      referenceImages: refs.map((r) => ({ base64: r.data, mimeType: r.mediaType })),
      agentName: 'registration/thumbnail-image',
      runContext: buildRunContext(userId, job, `generate/${cut}`),
    })
    costUsd += estimateImageCostUsd(job.imageModel, job.imageQuality)
    const url = await uploadThumbnailCut(db, userId, job.id, cut, result.base64, result.mimeType)
    cuts[cut] = { ...cuts[cut], url, error: undefined }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    cuts[cut] = { ...cuts[cut], error: `${cut} 생성 실패: ${message}` }
  }

  const next = nextCutToGenerate(cuts)
  return updateThumbnailJob(db, userId, job.id, {
    cuts,
    costUsd,
    status: next === null ? 'gating' : 'generating',
    progress: cuts[cut]?.url ? CUT_PROGRESS[cut] : job.progress,
  })
}

/** 스텝 5: 게이트 판정 → 미달 컷 재생성 마킹 → 재생성 → 재판정 → 최종 확정 (NEXFIT S8·S11) */
async function stepGate(db: SupabaseClient, userId: string, job: ThumbnailJob): Promise<ThumbnailJob> {
  const cuts: CutsRecord = { ...job.cuts }
  let costUsd = job.costUsd

  // 게이트는 cutout·studio 둘 다 있을 때만 — 없으면 판정 없이 최종 확정으로 (원본 S8 조건)
  if (!cuts.cutout?.url || !cuts.studio?.url) {
    return finalizeJob(db, userId, job.id, cuts, costUsd)
  }

  // 재생성 대기 컷이 있으면 이번 run은 그 1컷만 재생성한다
  const regenTarget = THUMBNAIL_CUTS.find((c) => cuts[c]?.regen)
  if (regenTarget) {
    const analysis = job.visionAnalysis
    if (!analysis) return failJob(db, userId, job.id, '분석 산출이 없습니다 — 잡 상태 불일치')
    const prompts = buildThumbnailPrompts(analysis, analysis.category, analysis.impact_concept)
    const refs = await loadReferences(job, regenTarget)
    try {
      const result = await generateImage({
        prompt: prompts[regenTarget],
        model: job.imageModel,
        quality: job.imageQuality,
        size: '1024x1024',
        referenceImages: refs.map((r) => ({ base64: r.data, mimeType: r.mediaType })),
        agentName: 'registration/thumbnail-image',
        runContext: buildRunContext(userId, job, `gate/${regenTarget}/regenerate`),
      })
      costUsd += estimateImageCostUsd(job.imageModel, job.imageQuality)
      const url = await uploadThumbnailCut(db, userId, job.id, regenTarget, result.base64, result.mimeType)
      cuts[regenTarget] = { url, retried: true }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      // 재생성 실패 — 기존 컷 유지(원본 retry_cuts: 실패 시 이전 결과 유지), 예산은 소비된 것으로 마킹
      cuts[regenTarget] = { ...cuts[regenTarget], regen: false, retried: true, error: `${regenTarget} 재생성 실패: ${message}` }
    }
    // 남은 재생성이 없으면 두 컷의 게이트를 무효화해 재판정을 트리거한다 (원본 458-465: 재시도 성공 시 재판정)
    if (!THUMBNAIL_CUTS.some((c) => cuts[c]?.regen)) {
      if (cuts.cutout) cuts.cutout = { ...cuts.cutout, gate: undefined }
      if (cuts.studio) cuts.studio = { ...cuts.studio, gate: undefined }
    }
    return updateThumbnailJob(db, userId, job.id, { cuts, costUsd, progress: 90 })
  }

  // 판정 (최초 또는 재생성 후 재판정)
  if (!cuts.cutout.gate || !cuts.studio.gate) {
    const refs = await loadSourceImages(job.sourceImages) // 원본 소스만 — 체이닝 cutout 제외(원본 448행)
    const [cutoutImg, studioImg] = await Promise.all([
      fetchImageAsBase64(cuts.cutout.url),
      fetchImageAsBase64(cuts.studio.url),
    ])
    if (refs.length === 0 || !cutoutImg || !studioImg) {
      // 판정 입력을 못 만들었으면 "게이트 미대상"으로 오인되지 않게 실패 판정을 기록하고 확정
      // (게이트는 신호 — 잡은 이미지 존재 기준으로 확정한다, 원본 failed_gate 방침)
      const failed = failedGate('게이트 입력 이미지 로드 실패 — 판정을 수행하지 못했습니다.')
      cuts.cutout = { ...cuts.cutout, gate: failed.cuts.cutout }
      cuts.studio = { ...cuts.studio, gate: failed.cuts.studio }
      return finalizeJob(db, userId, job.id, cuts, costUsd)
    }

    const { gate, costUsd: gateCost } = await scoreGate(
      refs,
      cutoutImg,
      studioImg,
      buildRunContext(userId, job, 'gate'),
    )
    costUsd += gateCost
    cuts.cutout = { ...cuts.cutout, gate: gate.cuts.cutout }
    cuts.studio = { ...cuts.studio, gate: gate.cuts.studio }

    const targets = gateRetryTargets(cuts)
    if (targets.length > 0) {
      for (const t of targets) cuts[t] = { ...cuts[t], regen: true }
      return updateThumbnailJob(db, userId, job.id, { cuts, costUsd, progress: 85 })
    }
  }

  return finalizeJob(db, userId, job.id, cuts, costUsd)
}

async function finalizeJob(
  db: SupabaseClient,
  userId: string,
  jobId: string,
  cuts: CutsRecord,
  costUsd: number
): Promise<ThumbnailJob> {
  const verdict = finalizeCuts(cuts)
  return updateThumbnailJob(db, userId, jobId, {
    cuts,
    costUsd,
    status: verdict.ok ? 'done' : 'failed',
    progress: verdict.ok ? 100 : 0,
    error: verdict.error,
  })
}
