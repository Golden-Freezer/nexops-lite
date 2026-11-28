import type { SupabaseClient } from '@supabase/supabase-js'
import { buildImageTasks, type ImageTask } from './pdp-image-tasks'
import { getPdpJob, updatePdpJob } from './pdp-jobs'
import { PDP_STEP_PROGRESS, type PdpJobRow, type SectionImage } from './pdp-state'

export const RATE_LIMIT_BASE_DELAY_MS = 90_000
export const RATE_LIMIT_MAX_DELAY_MS = 10 * 60_000

export interface RateLimitRetry {
  rateLimitCount: number
  retryAfter: string
}

/** 같은 섹션의 연속 한도 오류에 90초부터 최대 10분까지 지수 백오프를 적용한다. */
export function calculateRateLimitRetry(previousCount = 0, nowMs = Date.now()): RateLimitRetry {
  const rateLimitCount = Math.max(0, previousCount) + 1
  const delayMs = Math.min(
    RATE_LIMIT_BASE_DELAY_MS * 2 ** (rateLimitCount - 1),
    RATE_LIMIT_MAX_DELAY_MS,
  )
  return { rateLimitCount, retryAfter: new Date(nowMs + delayMs).toISOString() }
}

function entryFor(sectionImages: SectionImage[], section: string): SectionImage | undefined {
  return sectionImages.find((entry) => entry.section === section)
}

/**
 * 남은 작업이 전부 미래의 한도 재시도뿐이면 가장 이른 재개 시각을 반환한다.
 * 즉시 처리할 신규 태스크나 게이트 재생성이 하나라도 있으면 null이다.
 */
export function getRateLimitWaitUntil(
  tasks: ImageTask[],
  sectionImages: SectionImage[],
  nowMs = Date.now(),
): string | null {
  const waiting: number[] = []
  for (const task of tasks) {
    const entry = entryFor(sectionImages, task.section)
    if (!entry) return null
    if (!entry.pendingRegen) continue
    const retryAfter = (entry as SectionImage & { retryAfter?: string }).retryAfter
    const retryAt = retryAfter ? Date.parse(retryAfter) : Number.NaN
    if (!Number.isFinite(retryAt) || retryAt <= nowMs) return null
    waiting.push(retryAt)
  }
  return waiting.length > 0 ? new Date(Math.min(...waiting)).toISOString() : null
}

export function countMissingImageTasks(tasks: ImageTask[], sectionImages: SectionImage[]): number {
  return tasks.filter((task) => !entryFor(sectionImages, task.section)?.url).length
}

export function buildMissingImageSummary(tasks: ImageTask[], sectionImages: SectionImage[]): string | null {
  const missingCount = countMissingImageTasks(tasks, sectionImages)
  return missingCount > 0
    ? `이미지 ${missingCount}장을 만들지 못했습니다 — 만든 기록에서 '빠진 이미지 다시 만들기'를 누르세요`
    : null
}

/** URL 없는 예상 섹션만 즉시 실행 가능한 재생성 큐로 되돌린다. */
export function queueMissingImageRegeneration(
  tasks: ImageTask[],
  sectionImages: SectionImage[],
): SectionImage[] {
  const taskBySection = new Map(tasks.map((task) => [task.section, task]))
  const missingSections = new Set(
    tasks.filter((task) => !entryFor(sectionImages, task.section)?.url).map((task) => task.section),
  )
  const next = sectionImages.map((entry) => {
    if (!missingSections.has(entry.section)) return entry
    const task = taskBySection.get(entry.section)
    return {
      section: entry.section,
      url: '',
      prompt: entry.prompt ?? task?.prompt,
      pendingRegen: true,
      regenReason: 'missing' as const,
      retried: false,
    }
  })
  const present = new Set(next.map((entry) => entry.section))
  for (const section of missingSections) {
    if (present.has(section)) continue
    next.push({
      section,
      url: '',
      prompt: taskBySection.get(section)?.prompt,
      pendingRegen: true,
      regenReason: 'missing',
      retried: false,
    })
  }
  return next
}

interface RetryDependencies {
  getJob: typeof getPdpJob
  updateJob: typeof updatePdpJob
}

const DEFAULT_DEPENDENCIES: RetryDependencies = {
  getJob: getPdpJob,
  updateJob: updatePdpJob,
}

/** 완료 잡의 누락 이미지만 큐에 넣고, 재합성을 위해 기존 HTML을 비운다. */
export async function regenerateMissingPdpImages(
  db: SupabaseClient,
  userId: string,
  jobId: string,
  dependencies: RetryDependencies = DEFAULT_DEPENDENCIES,
): Promise<PdpJobRow> {
  const job = await dependencies.getJob(db, userId, jobId)
  if (!job) throw new Error(`PDP 잡을 찾을 수 없습니다: ${jobId}`)
  const tasks = buildImageTasks(job)
  const sectionImages = queueMissingImageRegeneration(tasks, job.section_images)
  if (countMissingImageTasks(tasks, job.section_images) === 0) return job
  return dependencies.updateJob(db, userId, jobId, {
    sectionImages,
    finalHtml: null,
    currentStep: 'images',
    progress: PDP_STEP_PROGRESS.images,
    error: null,
  })
}
