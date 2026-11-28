/**
 * 잡별 모델 배치(R03, 하네스 harness-rollout) — 'now'(지금 배치, 기본) · 'new'(오너 2026-11-08 ② 최종 선택 + ③ 운영 반영 1~4).
 * 순수 값·형식만 둔다(생성 화면도 읽는다). 실행 중인 잡의 배치를 단계 route에 건네는 일은 pdp-model-batch-context.ts(서버 전용).
 *
 * 저장(DDL 없음, 오너 I4-4 9): spec_sheet 예약 키 — 배치 값과 잡 생성 때의 단계 모델 스냅숏, 그리고 구독 표지(R13 modelBackend,
 * 'subscription'일 때만 — 키가 없으면 API). 잡을 읽을 때(pdp-jobs toJob) 꺼내 PdpJobRow 칸으로 옮기고 spec_sheet에서는 지운다 →
 * 프롬프트·편집기가 보지 않는다(generationTrack 선례). spec_sheet를 다시 저장하는 곳(분석 단계)은 withModelBatchKeys로 다시 붙인다.
 */

export const PDP_MODEL_BATCHES = ['now', 'new'] as const
export type PdpModelBatch = (typeof PDP_MODEL_BATCHES)[number]

export function isPdpModelBatch(v: unknown): v is PdpModelBatch {
  return v === 'now' || v === 'new'
}

/** 생성 화면 라디오 글 — 설명의 장당 API는 오너 ② 결정 탭 저장값($7.26)이다 */
export const PDP_MODEL_BATCH_LABELS: Readonly<Record<PdpModelBatch, string>> = {
  now: '지금 배치',
  new: '새 배치',
}

export const MODEL_BATCH_SPEC_KEY = 'modelBatch'
export const MODEL_ROUTE_SNAPSHOT_SPEC_KEY = 'modelRouteSnapshot'
/** 구독 표지(R13) — 'subscription'이면 Railway 구독 작업자가 진행하는 잡이다(값이 다르거나 없으면 API) */
export const MODEL_BACKEND_SPEC_KEY = 'modelBackend'
/**
 * 구독 멈춤 표지(AX-CT-29) — 구독 표지 잡 중 이 키가 true인 잡은 구독이 막혀도 API로 잇지 않고 멈춘다(잡 생성 때 정한다, 키가 없으면
 * 지금과 같다). 구독 표지(modelBackend 'subscription')가 아닌 잡에서는 읽지도 붙이지도 않는다
 */
export const SUBSCRIPTION_STOP_SPEC_KEY = 'subscriptionStop'

/** 잡의 LLM 백엔드 — api(기본, 웹·하네스 그대로) · subscription(구독 작업자 잡, 새 배치만 — pdp-model-routes) */
export type PdpModelBackend = 'api' | 'subscription'

/**
 * spec_sheet에서 예약 키를 꺼낸다 — 키가 없는 잡(이 기능 전 잡 포함)은 present false·지금 배치·스냅숏 없음·API(spec은 같은 객체)
 */
export function splitModelBatchKeys<T extends object>(
  spec: T
): {
  spec: T
  present: boolean
  batch: PdpModelBatch
  snapshot: Record<string, unknown> | null
  backend: PdpModelBackend
  /** 구독 멈춤 표지 — true일 때만 칸이 있다(없으면 지금과 같은 모양) */
  subscriptionStop?: true
} {
  const record = spec as Record<string, unknown>
  if (
    !(MODEL_BATCH_SPEC_KEY in record) &&
    !(MODEL_ROUTE_SNAPSHOT_SPEC_KEY in record) &&
    !(MODEL_BACKEND_SPEC_KEY in record) &&
    !(SUBSCRIPTION_STOP_SPEC_KEY in record)
  ) {
    return { spec, present: false, batch: 'now', snapshot: null, backend: 'api' }
  }
  const {
    [MODEL_BATCH_SPEC_KEY]: rawBatch,
    [MODEL_ROUTE_SNAPSHOT_SPEC_KEY]: rawSnapshot,
    [MODEL_BACKEND_SPEC_KEY]: rawBackend,
    [SUBSCRIPTION_STOP_SPEC_KEY]: rawStop,
    ...rest
  } = record
  const snapshot =
    rawSnapshot && typeof rawSnapshot === 'object' && !Array.isArray(rawSnapshot)
      ? (rawSnapshot as Record<string, unknown>)
      : null
  return {
    spec: rest as T,
    present: true,
    batch: isPdpModelBatch(rawBatch) ? rawBatch : 'now',
    snapshot,
    backend: rawBackend === 'subscription' ? 'subscription' : 'api',
    ...(rawBackend === 'subscription' && rawStop === true ? { subscriptionStop: true as const } : {}),
  }
}

/** 저장할 spec_sheet에 예약 키를 붙인다 — 스냅숏이 없으면 배치 키만, 구독 표지는 'subscription'일 때만 */
export function withModelBatchKeys<T extends object>(
  spec: T,
  batch: PdpModelBatch,
  snapshot: Record<string, unknown> | null | undefined,
  backend: PdpModelBackend = 'api',
  subscriptionStop = false
): T {
  return {
    ...spec,
    [MODEL_BATCH_SPEC_KEY]: batch,
    ...(snapshot ? { [MODEL_ROUTE_SNAPSHOT_SPEC_KEY]: snapshot } : {}),
    ...(backend === 'subscription' ? { [MODEL_BACKEND_SPEC_KEY]: backend } : {}),
    ...(backend === 'subscription' && subscriptionStop ? { [SUBSCRIPTION_STOP_SPEC_KEY]: true } : {}),
  }
}

/**
 * spec_sheet를 다시 저장할 때(분석 단계·작업자 잇기) 잡의 모델 배치 예약 키를 다시 붙인다 — toJob이 지운 값을 잃지 않게.
 * 키가 없던 잡(이 기능 전)은 그대로
 */
export function specSheetForSave<T extends object>(
  job: {
    model_batch?: PdpModelBatch
    model_route_snapshot?: Record<string, unknown> | null
    model_backend?: PdpModelBackend
    subscription_stop?: boolean
  },
  spec: T
): T {
  if (!job.model_batch && !job.model_route_snapshot && job.model_backend !== 'subscription') return spec
  return withModelBatchKeys(
    spec,
    job.model_batch ?? 'now',
    job.model_route_snapshot,
    job.model_backend,
    job.subscription_stop === true
  )
}

/**
 * 새 배치 정지 이미지 모델(오너 ② '정지 이미지 MS 2k', 통합 R03·R05 경계) — 모델 id·공급자 분기는 A R05가 만든다.
 * R05가 아직 없으면 등록된 이미지 모델에 이 id가 없어 새 배치 잡 생성이 명시 오류로 멈춘다(resolveNewBatchImageModel)
 */
export const PDP_NEW_BATCH_IMAGE_MODEL = 'higgsfield-ms-2k'

/** 새 배치 이미지 모델 — 등록된 모델 id 목록에 있으면 그 id, 없으면 사유(조용히 다른 모델로 넘어가지 않는다) */
export function resolveNewBatchImageModel(
  registered: readonly string[]
): { ok: true; model: string } | { ok: false; error: string } {
  if (registered.includes(PDP_NEW_BATCH_IMAGE_MODEL)) return { ok: true, model: PDP_NEW_BATCH_IMAGE_MODEL }
  return {
    ok: false,
    error: `새 배치 이미지 모델(${PDP_NEW_BATCH_IMAGE_MODEL})의 공급자가 아직 없습니다 — 새 배치 잡을 만들 수 없습니다(지금 배치는 그대로 됩니다)`,
  }
}
