/**
 * registration_pdp_jobs CRUD — 상세페이지 6단계 생성 잡. Phase 1 jobs.ts 패턴(untyped
 * SupabaseClient, user_id 격리 강제)을 그대로 따른다.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { ImageModel, ImageQuality } from '@/lib/agents/image/types'
import type { Database } from '@/types/database'
import { splitModelBatchKeys, withModelBatchKeys, type PdpModelBackend, type PdpModelBatch } from './pdp-model-batch'
import { currentPdpSubscriptionStop } from './pdp-model-batch-context'
import type {
  AnalysisResult,
  CopySectionsPayload,
  DesignPrompts,
  GenerationTrack,
  PdpCostPool,
  PdpJobRow,
  PdpMode,
  PdpSpecSheet,
  PdpStep,
  ResearchResult,
  SectionImage,
  SectionPlan,
} from './pdp-state'

const TABLE = 'registration_pdp_jobs'
// 한 줄 리터럴 유지 — 문자열 연결로 넓히면 Supabase 쿼리 타입 파서가 GenericStringError로 떨어진다(Phase 1 함정 기록)
const SELECT =
  'id, user_id, business_id, draft_id, spec_sheet, source_images, image_model, image_quality, mode, generation_track, analysis, research_result, design_prompts, section_plan, copy_sections, section_images, final_html, current_step, progress, error, cost_usd, cost_pool, created_at, updated_at'

interface JobRow {
  id: string
  user_id: string
  business_id: string | null
  draft_id: string | null
  spec_sheet: unknown
  source_images: unknown
  image_model: string
  image_quality: string
  mode: string
  generation_track: string
  analysis: unknown
  research_result: unknown
  design_prompts: unknown
  section_plan: unknown
  copy_sections: unknown
  section_images: unknown
  final_html: string | null
  current_step: string
  progress: number
  error: string | null
  cost_usd: number | string | null
  cost_pool: string | null
  created_at: string
  updated_at: string
}

function asObject<T>(v: unknown, fallback: T): T {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as T) : fallback
}

function toJob(row: JobRow): PdpJobRow {
  // 모델 배치 예약 키는 꺼내 칸으로 옮기고 spec_sheet에서 지운다(프롬프트·편집기가 보지 않게, pdp-model-batch)
  const { spec, present, batch, snapshot, backend, subscriptionStop } = splitModelBatchKeys(
    asObject<PdpSpecSheet>(row.spec_sheet, { productName: '' })
  )
  return {
    id: row.id,
    user_id: row.user_id,
    business_id: row.business_id,
    draft_id: row.draft_id,
    spec_sheet: spec,
    source_images: Array.isArray(row.source_images) ? row.source_images.map(String) : [],
    image_model: row.image_model as ImageModel,
    image_quality: row.image_quality as ImageQuality,
    mode: (row.mode as PdpMode) || 'pro',
    generation_track: row.generation_track === 'internalized' ? 'internalized' : 'standard',
    analysis: asObject<AnalysisResult>(row.analysis, {}),
    research_result: asObject<ResearchResult>(row.research_result, {}),
    design_prompts: asObject<DesignPrompts>(row.design_prompts, {}),
    section_plan: asObject<SectionPlan>(row.section_plan, {}),
    copy_sections: asObject<Partial<CopySectionsPayload>>(row.copy_sections, {}),
    section_images: Array.isArray(row.section_images) ? (row.section_images as SectionImage[]) : [],
    final_html: row.final_html,
    current_step: row.current_step as PdpStep,
    progress: row.progress ?? 0,
    error: row.error,
    cost_usd: Number(row.cost_usd ?? 0),
    cost_pool: row.cost_pool === 'test' ? 'test' : null,
    // 키가 없던 잡(이 기능 전)은 칸도 없다 — 다시 저장할 때 키를 새로 붙이지 않는다(specSheetForSave)
    ...(present ? { model_batch: batch, model_route_snapshot: snapshot } : {}),
    // 구독 표지(R13)는 있을 때만 칸을 둔다 — API 잡의 행 모양은 그대로
    ...(backend === 'subscription' ? { model_backend: backend } : {}),
    // 구독 멈춤 표지(AX-CT-29)도 true일 때만 칸을 둔다 — 없으면 행 모양 그대로
    ...(subscriptionStop ? { subscription_stop: true } : {}),
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

export interface CreatePdpJobInput {
  businessId?: string | null
  draftId?: string | null
  specSheet: PdpSpecSheet
  sourceImages: string[]
  imageModel: ImageModel
  imageQuality: ImageQuality
  mode: PdpMode
  generationTrack: GenerationTrack
  /** 'test'=시험 잡(시험 프로그램 하네스·rerun-job·오너 API) — 없으면 운영 잡 */
  costPool?: PdpCostPool | null
  /**
   * 모델 배치·단계 스냅숏(R03) — 주면 spec_sheet 예약 키로 저장한다. 없으면 지금처럼(키 없음 = 지금 배치).
   * backend 'subscription'(R13 구독 작업자 잡)이면 표지 키도 저장한다 — 없거나 api면 키를 붙이지 않는다(행 바이트 그대로)
   */
  modelBatch?: {
    batch: PdpModelBatch
    snapshot: Record<string, unknown>
    backend?: PdpModelBackend
    /** 구독 멈춤 표지(AX-CT-29) — backend 'subscription'일 때만 저장한다 */
    subscriptionStop?: boolean
  }
}

export async function createPdpJob(db: SupabaseClient, userId: string, input: CreatePdpJobInput): Promise<PdpJobRow> {
  const { data, error } = await db
    .from(TABLE)
    .insert({
      user_id: userId,
      business_id: input.businessId ?? null,
      draft_id: input.draftId ?? null,
      spec_sheet: input.modelBatch
        ? withModelBatchKeys(
            input.specSheet,
            input.modelBatch.batch,
            input.modelBatch.snapshot,
            input.modelBatch.backend,
            input.modelBatch.subscriptionStop
          )
        : input.specSheet,
      source_images: input.sourceImages,
      image_model: input.imageModel,
      image_quality: input.imageQuality,
      mode: input.mode,
      generation_track: input.generationTrack,
      // 운영 잡(null)은 칸을 보내지 않는다
      ...(input.costPool ? { cost_pool: input.costPool } : {}),
    })
    .select(SELECT)
    .single()
  if (error || !data) throw new Error(`PDP 잡 생성 실패: ${error?.message ?? '알 수 없음'}`)
  return toJob(data as JobRow)
}

export async function getPdpJob(db: SupabaseClient, userId: string, id: string): Promise<PdpJobRow | null> {
  const { data, error } = await db.from(TABLE).select(SELECT).eq('user_id', userId).eq('id', id).limit(1)
  if (error) throw new Error(`PDP 잡 조회 실패: ${error.message}`)
  return data && data.length > 0 ? toJob(data[0] as JobRow) : null
}

/**
 * 최근 생성순 목록. before(created_at ISO)를 주면 그보다 앞선 잡만(생성 히스토리 페이지 넘김 커서),
 * track을 주면 generation_track 컬럼(SSOT, 구 행은 DDL 백필 완료)으로 서버에서 거른다.
 */
export async function listPdpJobs(
  db: SupabaseClient,
  userId: string,
  limit = 30,
  options: { before?: string | null; track?: GenerationTrack | null } = {}
): Promise<PdpJobRow[]> {
  let query = db.from(TABLE).select(SELECT).eq('user_id', userId)
  if (options.before) query = query.lt('created_at', options.before)
  if (options.track) query = query.eq('generation_track', options.track)
  const { data, error } = await query
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw new Error(`PDP 잡 목록 조회 실패: ${error.message}`)
  return (data ?? []).map((r) => toJob(r as JobRow))
}

export interface PdpJobPatch {
  specSheet?: PdpSpecSheet
  analysis?: AnalysisResult
  researchResult?: ResearchResult
  designPrompts?: DesignPrompts
  sectionPlan?: SectionPlan
  copySections?: Partial<CopySectionsPayload>
  sectionImages?: SectionImage[]
  finalHtml?: string | null
  currentStep?: PdpStep
  progress?: number
  error?: string | null
  costUsd?: number
  corpusVersion?: string
  /** 진행 잠금 기한 유지 — images 단계의 중간 저장만 넘긴다. 없으면 updated_at = 지금(잠금 해제) */
  leaseUntil?: string
}

/**
 * 잡 진행 잠금(속도 개선 1차, DDL 없음) — updated_at을 잠금 기한(미래 시각)으로 쓴다. 쥔 쪽은 중간 저장에 같은 기한을 쓰고
 * (PdpJobPatch.leaseUntil), 단계의 마지막 저장(기한 없음 → 지금)이 푼다. 시각은 서버 Date.now() 하나로 판단한다.
 * - 기한: run 상한 300초 + 여유. 504로 끝난 run의 잠금도 곧 풀린다. 강제 종료가 없는 실행기(작업자)도 images 단계의
 *   시간 예산(RUN_TIME_BUDGET_MS)으로 기한 안에 끝난다. 그래도 넘겨 다른 곳이 쥐면 이 run의 중간 저장은 0행으로 실패한다
 *   (PdpLeaseLostError — 덮어쓰지 않는다)
 * - 판단 여유: updated_at이 지금보다 30초 넘게 미래일 때만 잡혀 있다고 본다 — 방금 끝난 run의 해제 시각(다른 서버 인스턴스의
 *   시계)을 잠금으로 오인하지 않게. 그래서 실제 잠금 시간은 기한 − 여유 = 310초(run 상한보다 길다)
 */
export const PDP_RUN_LEASE_MS = 340_000
const LEASE_ACTIVE_MARGIN_MS = 30_000

/** updated_at에 쓸 값 — 잠금 기한을 유지하거나(leaseUntil) 지금(해제). 잡 갱신의 유일한 updated_at 결정 지점 */
export function jobUpdatedAt(patch: Pick<PdpJobPatch, 'leaseUntil'>, now = Date.now()): string {
  return patch.leaseUntil ?? new Date(now).toISOString()
}

/**
 * 진행 잠금을 잃었다 — 잠금을 실은 저장이 0행(기한이 지나 다른 곳이 쥐었다). 이 run은 더 쓰지 않고 멈춘다
 * (runPdpStep은 실패로 기록하지 않는다 — 기록하면 지금 쥔 쪽의 잠금을 푼다)
 */
export class PdpLeaseLostError extends Error {
  constructor(jobId: string) {
    super(`PDP 잡 진행 잠금을 잃었습니다(다른 곳이 이어 진행 중): ${jobId}`)
    this.name = 'PdpLeaseLostError'
  }
}

/** 다른 곳(탭·작업자)이 이 잡을 진행 중인가 — 잠금 기한이 판단 여유보다 더 남았을 때 */
export function isPdpJobLeased(job: Pick<PdpJobRow, 'updated_at'>, now = Date.now()): boolean {
  const at = Date.parse(job.updated_at)
  return Number.isFinite(at) && at > now + LEASE_ACTIVE_MARGIN_MS
}

/**
 * 잡 진행 잠금을 쥔다 — 읽은 updated_at이 그대로일 때만(조건부 갱신) 잠금 기한을 쓴다. 갱신된 행이 0이면 그사이 다른 곳이
 * 쥐었거나 저장했다(null). 이미 잡혀 있으면 쓰지 않고 null. 기한이 지난 잠금은 가져온다. 기한이 기록되지 않으면(트리거)
 * leaseUntil null — 잠금 없이 진행한다.
 */
export async function claimPdpJobRun(
  db: SupabaseClient,
  userId: string,
  job: Pick<PdpJobRow, 'id' | 'updated_at'>,
  now = Date.now()
): Promise<{ job: PdpJobRow; leaseUntil: string | null } | null> {
  if (isPdpJobLeased(job, now)) return null
  const leaseUntil = new Date(now + PDP_RUN_LEASE_MS).toISOString()
  const { data, error } = await db
    .from(TABLE)
    .update({ updated_at: leaseUntil })
    .eq('user_id', userId)
    .eq('id', job.id)
    .eq('updated_at', job.updated_at)
    .select(SELECT)
  if (error) throw new Error(`PDP 잡 잠금 실패: ${error.message}`)
  if (!data || data.length === 0) return null
  const claimed = toJob(data[0] as JobRow)
  // updated_at을 덮어쓰는 트리거가 있으면 기한이 남지 않는다 — 잠금 없이 진행한다(잠금을 실은 중간 저장이 매번 0행으로 실패하지 않게)
  if (Date.parse(claimed.updated_at) !== Date.parse(leaseUntil)) return { job: claimed, leaseUntil: null }
  return { job: claimed, leaseUntil }
}

/** 잡 갱신 열 — updatePdpJob·updatePdpJobIfUnchanged가 같이 쓴다 */
function patchFields(patch: PdpJobPatch): Record<string, unknown> {
  const fields: Record<string, unknown> = { updated_at: jobUpdatedAt(patch) }
  if (patch.specSheet !== undefined) fields.spec_sheet = patch.specSheet
  if (patch.analysis !== undefined) fields.analysis = patch.analysis
  if (patch.researchResult !== undefined) fields.research_result = patch.researchResult
  if (patch.designPrompts !== undefined) fields.design_prompts = patch.designPrompts
  if (patch.sectionPlan !== undefined) fields.section_plan = patch.sectionPlan
  if (patch.copySections !== undefined) fields.copy_sections = patch.copySections
  if (patch.sectionImages !== undefined) fields.section_images = patch.sectionImages
  if (patch.finalHtml !== undefined) fields.final_html = patch.finalHtml
  if (patch.currentStep !== undefined) fields.current_step = patch.currentStep
  if (patch.progress !== undefined) fields.progress = patch.progress
  if (patch.error !== undefined) fields.error = patch.error
  if (patch.costUsd !== undefined) fields.cost_usd = patch.costUsd
  return fields
}

/**
 * 읽은 뒤 바뀌지 않았을 때만 갱신한다(updated_at 조건, 잠금은 싣지 않는다) — 편집기 요청이 그사이 진행을 쥔 run이나
 * 다른 저장과 엇갈려 덮어쓰지 않게. 0행이면 null(호출자는 busy로 돌려준다).
 */
export async function updatePdpJobIfUnchanged(
  db: SupabaseClient,
  userId: string,
  job: Pick<PdpJobRow, 'id' | 'updated_at'>,
  patch: Omit<PdpJobPatch, 'leaseUntil' | 'corpusVersion'>
): Promise<PdpJobRow | null> {
  const { data, error } = await db
    .from(TABLE)
    .update(patchFields(patch))
    .eq('user_id', userId)
    .eq('id', job.id)
    .eq('updated_at', job.updated_at)
    .select(SELECT)
  if (error) throw new Error(`PDP 잡 갱신 실패: ${error.message}`)
  return data && data.length > 0 ? toJob(data[0] as JobRow) : null
}

export async function updatePdpJob(
  db: SupabaseClient,
  userId: string,
  id: string,
  patch: PdpJobPatch
): Promise<PdpJobRow> {
  return writePdpJob(db, userId, id, patch, 0)
}

/** 멈춤 기록 때문에 0행인 저장을 다시 쓰는 시도 한도(결정 45·46) — 넘으면 전과 같은 꼴로 던진다 */
const HALT_GUARD_WRITE_ATTEMPTS = 3

async function writePdpJob(
  db: SupabaseClient,
  userId: string,
  id: string,
  input: PdpJobPatch,
  attempt: number
): Promise<PdpJobRow> {
  let patch = input
  // 구독 멈춤 표지 잡의 run(AX-CT-29)에서만 — 판단은 run 문맥(runWithPdpBatch subscriptionStop)을 맨 먼저 본다. 표지 없는 잡·문맥 밖
  // 저장은 patch를 들여다보지도 않고 조건·읽기를 더하지 않아 지금과 같다.
  // - finishing(결정 46): 잡을 done으로 끝내는 저장은 멈춤 기록이 없을 때만 쓴다. 그사이 웹이 멈춤을 기록했으면(0행) 기록을 지우고
  //   끝내며 그 멈춤의 사건을 닫는 ok 줄을 남긴다(끝난 잡은 이어 할 것이 없다 — finishClearingHalt).
  // - keepHalt(결정 45): section_plan을 통째로 쓰는 단계 저장은 멈춤 기록이 없을 때만 쓴다. 기록이 있으면(0행) 그 기록을 넣어 다시
  //   쓴다(단계 결과는 저장, 잡은 멈춘 채 — '이어 하기'만 푼다, writeKeepingHalt)
  const stopRun = currentPdpSubscriptionStop()
  const finishing = stopRun && patch.currentStep === 'done'
  const keepHalt = stopRun && !finishing && patch.sectionPlan !== undefined && !patch.sectionPlan.subscription_halt
  // 끝내는 저장은 메모리에 남은 멈춤 기록도 싣지 않는다(끝난 잡에 멈춤 기록을 남기지 않는다)
  if (finishing && patch.sectionPlan?.subscription_halt) {
    const { subscription_halt: _memHalt, ...plan } = patch.sectionPlan
    void _memHalt
    patch = { ...patch, sectionPlan: plan }
  }
  const fields = patchFields(patch)
  let query = db.from(TABLE).update(fields).eq('user_id', userId).eq('id', id)
  // 잠금을 쥔 run의 중간 저장은 잠금이 그대로일 때만 — 기한이 지나 다른 곳이 쥐었으면 덮어쓰지 않는다(0행)
  if (patch.leaseUntil) query = query.eq('updated_at', patch.leaseUntil)
  if (finishing || keepHalt) query = query.is('section_plan->>subscription_halt', null)
  const { data, error } = await query.select(SELECT).single()
  if (patch.leaseUntil && !data && (!error || error.code === 'PGRST116')) throw new PdpLeaseLostError(id)
  if ((finishing || keepHalt) && !data && (!error || error.code === 'PGRST116')) {
    const next = attempt + 1
    if (next >= HALT_GUARD_WRITE_ATTEMPTS) {
      throw new Error(`PDP 잡 갱신 실패: 멈춤 기록과 ${HALT_GUARD_WRITE_ATTEMPTS}번 겹쳐 저장하지 못했습니다`)
    }
    return finishing ? finishClearingHalt(db, userId, id, patch, next) : writeKeepingHalt(db, userId, id, patch, next)
  }
  if (error || !data) throw new Error(`PDP 잡 갱신 실패: ${error?.message ?? '알 수 없음'}`)
  const updatedJob = toJob(data as JobRow)

  if (patch.corpusVersion !== undefined) {
    try {
      // 생성 DB Update 타입을 사용하되 버전 기록 실패는 본 잡 갱신과 분리한다.
      const { error: corpusVersionError } = await db
        .from(TABLE)
        .update({
          corpus_version: patch.corpusVersion,
        } satisfies Database['public']['Tables']['registration_pdp_jobs']['Update'])
        .eq('user_id', userId)
        .eq('id', id)
      if (corpusVersionError) throw new Error(corpusVersionError.message)
    } catch (error) {
      console.warn('[pdp-jobs] corpus_version 기록 실패 — 잡 결과는 유지합니다.', {
        jobId: id,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return updatedJob
}

/**
 * updatePdpJob이 멈춤 기록 때문에 0행이었다(구독 멈춤 표지 잡의 run, 결정 45) — 지금 멈춤 기록을 읽어 넣고 다시 쓴다. 넣은 기록이 있으면
 * 조건 없이 쓴다(이 저장이 기록을 지우지 않으므로). 그사이 '이어 하기'가 기록을 지웠으면 처음 patch를 같은 조건으로 한 번 더 쓴다
 * (시도 한도 HALT_GUARD_WRITE_ATTEMPTS — 기록이 거짓 값으로 저장돼도 끝없이 돌지 않는다). 잡이 없으면 지금처럼 실패로 던진다
 */
async function writeKeepingHalt(db: SupabaseClient, userId: string, id: string, patch: PdpJobPatch, attempt: number): Promise<PdpJobRow> {
  const halt = (await readSectionPlan(db, userId, id)).subscription_halt
  if (!halt) return writePdpJob(db, userId, id, patch, attempt)
  return writePdpJob(db, userId, id, { ...patch, sectionPlan: { ...patch.sectionPlan, subscription_halt: halt } }, attempt)
}

/**
 * 잡을 done으로 끝내는 저장이 멈춤 기록 때문에 0행이었다(구독 멈춤 표지 잡의 run, 결정 46) — 잡은 끝났으니 멈춤 기록을 남기지 않는다
 * ('이어 하기'는 끝난 잡을 받지 않아 남기면 사건을 닫을 길이 없다). 읽은 그 기록(같은 at)이 그대로일 때만 기록을 뺀 section_plan으로
 * 끝내고, 그 멈춤의 사건을 닫는 ok 줄(같은 at)을 쓴다. 그사이 기록이 지워졌거나 바뀌었으면 처음 저장부터 다시 한다(시도 한도 같음)
 */
async function finishClearingHalt(db: SupabaseClient, userId: string, id: string, patch: PdpJobPatch, attempt: number): Promise<PdpJobRow> {
  const plan = await readSectionPlan(db, userId, id)
  const halt = plan.subscription_halt
  if (!halt || typeof halt.at !== 'string') return writePdpJob(db, userId, id, patch, attempt)
  const { subscription_halt: _halt, ...sectionPlan } = patch.sectionPlan ?? plan
  void _halt
  let query = db
    .from(TABLE)
    .update(patchFields({ ...patch, sectionPlan }))
    .eq('user_id', userId)
    .eq('id', id)
    .eq('section_plan->subscription_halt->>at', halt.at)
  if (patch.leaseUntil) query = query.eq('updated_at', patch.leaseUntil)
  const { data, error } = await query.select(SELECT).single()
  if (!data && (!error || error.code === 'PGRST116')) {
    if (patch.leaseUntil) throw new PdpLeaseLostError(id)
    const next = attempt + 1
    if (next >= HALT_GUARD_WRITE_ATTEMPTS) {
      throw new Error(`PDP 잡 갱신 실패: 멈춤 기록과 ${HALT_GUARD_WRITE_ATTEMPTS}번 겹쳐 저장하지 못했습니다`)
    }
    return writePdpJob(db, userId, id, patch, next)
  }
  if (error || !data) throw new Error(`PDP 잡 갱신 실패: ${error?.message ?? '알 수 없음'}`)
  console.warn(`[registration/pdp] 구독 멈춤 기록이 있는 잡이 끝났습니다 — 기록을 지우고 사건을 닫습니다(잡 ${id.slice(0, 8)}·${halt.stage})`)
  try {
    // pdp-subscription은 이 모듈을 가져다 쓴다 — 가져오기 순환을 피해 여기서만 늦게 가져온다(이 길은 표지 잡의 드문 경합에서만 탄다)
    const { recordSubscriptionFinishRun } = await import('./pdp-subscription')
    await recordSubscriptionFinishRun(db, userId, id, halt)
  } catch (e) {
    console.warn('[registration/pdp] 멈춤 사건 닫기 줄 기록 실패 — 잡 결과는 유지합니다.', e instanceof Error ? e.message : String(e))
  }
  return toJob(data as JobRow)
}

async function readSectionPlan(db: SupabaseClient, userId: string, id: string): Promise<SectionPlan> {
  const { data, error } = await db.from(TABLE).select('section_plan').eq('user_id', userId).eq('id', id).maybeSingle()
  if (error || !data) throw new Error(`PDP 잡 갱신 실패: ${error?.message ?? '잡을 찾을 수 없습니다'}`)
  return asObject<SectionPlan>((data as { section_plan: unknown }).section_plan, {})
}

export async function deletePdpJob(db: SupabaseClient, userId: string, id: string): Promise<void> {
  const { error } = await db.from(TABLE).delete().eq('user_id', userId).eq('id', id)
  if (error) throw new Error(`PDP 잡 삭제 실패: ${error.message}`)
}
