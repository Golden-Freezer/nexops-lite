/**
 * 상품 대표이미지 생성 — 모델 레지스트리와 공통 타입 (WS-B).
 *
 * 선택형 프로바이더: GPT-Image 2.0(OpenAI) · Nano Banana Pro(Gemini 3 Pro Image). 상세페이지 새 잡 기본은 GPT-Image 2.6 high(오너 2026-11-05 22:5x, 그 전 2.5 high·2026-10-31 R8).
 * 2026-07-23 한글 렌더링 파일럿에서 두 모델 모두 한글 상품명·문구를 정확히 렌더함을 실측.
 * 모델별 실제 호출은 generate.ts, 프롬프트 조립은 prompts.ts가 담당한다(CLAUDE.md agents 분리 원칙).
 */

export type ImageModel =
  | 'gpt-image-2'
  | 'gemini-3-pro-image'
  | 'gemini-3.1-flash-image'
  | 'codex-image'
  | 'gpt-image-2.5-sunburst'
  | 'gpt-image-2.5-flare'
  | 'gpt-image-2.6-sunburst'
  | 'gemini-nano-banana-2.1'
  | 'higgsfield-ms-2k'

/**
 * local: 로컬 프로세스가 등록한 백엔드(local-backend.ts)로만 생성 — Vercel에는 등록이 없다.
 * higgsfield: 힉스필드 API(비동기 제출·폴링, higgsfield-image.ts) — 키(HF_API_KEY_ID·HF_API_KEY_SECRET)가 있는 환경에서만
 */
export type ImageProvider = 'openai' | 'gemini' | 'local' | 'higgsfield'

export interface ImageModelInfo {
  id: ImageModel
  label: string
  provider: ImageProvider
  /** UI 선택 힌트(한 줄) */
  note: string
}

/** 선택 가능한 이미지 모델. UI 드롭다운·검증의 SSOT. */
export const IMAGE_MODELS: ImageModelInfo[] = [
  {
    id: 'gpt-image-2',
    label: 'GPT-Image 2.0',
    provider: 'openai',
    note: '한글 텍스트 정확 · 이커머스 대표이미지에 강함',
  },
  {
    id: 'gemini-3-pro-image',
    label: 'Nano Banana Pro',
    provider: 'gemini',
    note: '프리미엄 톤 · 편집/합성에 강함',
  },
]

/**
 * 내부 전용 저가 모델 포함 전체 레지스트리 — UI 선택지(IMAGE_MODELS)에는 노출하지 않는다.
 * gemini-3.1-flash-image: rating_bg·USP 아이콘 등 저가 컷 강등용(개정 5, 2026-08-11 오너 지시.
 * 지정된 'gemini-3.5-flash-image'는 미출시 실측 — 현행 flash image로 대체).
 * codex-image: 코덱스 구독 이미지(C1, 2026-10-27). 로컬 실행기·실 테스트 하네스만 백엔드를 등록한다.
 * isImageModel이 거부하므로 웹 잡 생성·소싱 이미지 생성 경로는 이 모델을 받지 않는다.
 */
export const ALL_IMAGE_MODELS: ImageModelInfo[] = [
  ...IMAGE_MODELS,
  {
    id: 'gemini-3.1-flash-image',
    label: 'Gemini Flash Image (내부 저가)',
    provider: 'gemini',
    note: '저가 컷 전용 — UI 비노출',
  },
  {
    id: 'codex-image',
    label: '코덱스 구독(로컬)',
    provider: 'local',
    note: '로컬 실행기 전용 — UI 비노출 · 비용 0',
  },
  // GPT Image 2.5(오너 지시 2026-10-30 '실험 갈래로 먼저'). 코덱스 이미지 도구는 gpt-image-2 고정이라 2.5는 OpenAI API로만 쓴다(유료).
  // sunburst는 R8(2026-10-31 — 3상품 평균 v1 79.4·v2 80.0, 코덱스 최고보다 3/3 높음) 뒤 상세페이지 새 잡 기본(PDP_IMAGE_MODELS 첫 항목)이다.
  // 썸네일 스튜디오·소싱 이미지 생성 선택지(IMAGE_MODELS·isImageModel)에는 넣지 않는다. flare는 하네스 실험 갈래 전용 그대로
  {
    id: 'gpt-image-2.5-sunburst',
    label: 'GPT-Image 2.5',
    provider: 'openai',
    note: '상세페이지 기본 · 비용은 장마다 실사용량(usage)으로',
  },
  {
    id: 'gpt-image-2.5-flare',
    label: 'GPT-Image 2.5 flare (실험)',
    provider: 'openai',
    note: '실험 갈래 전용 — UI 비노출 · usage 실비용',
  },
  // GPT Image 2.6(2026-11-04 출시) sunburst — 오너 2026-11-05 22:5x '이미지 모델은 GPT-IMAGE-2.6 HIGH로 바꾸고'로 상세페이지 새 잡 기본.
  // 근거: 이미지 비교 1·2단계(#796, 통합 판정 — 2.5 high와 같은 값에 장면 일관성이 낫다). 같은 OpenAI 경로·같은 토큰 단가라 usage로 계상한다
  {
    id: 'gpt-image-2.6-sunburst',
    label: 'GPT-Image 2.6',
    provider: 'openai',
    note: '상세페이지 기본 · 비용은 장마다 실사용량(usage)으로',
  },
  // Nano Banana 2.1(Gemini, 2026-10-06 출시) — 오너 2026-11-05 22:47 블라인드 갈래 '2.6 high vs Nano Banana 2.1' 시험 전용.
  // 운영 기준은 10-29 오너 방침(상세페이지 Claude·GPT만)이라 생성 폼 선택지(PDP_IMAGE_MODELS)·IMAGE_MODELS에는 넣지 않는다 — 채택은 블라인드 뒤 오너가 정한다
  {
    id: 'gemini-nano-banana-2.1',
    label: 'Nano Banana 2.1 (블라인드 시험)',
    provider: 'gemini',
    note: '시험 하네스 전용 — UI 비노출 · usage 실비용',
  },
  // 힉스필드 Marketing Studio Image(sunburst, GPT Image 2.5 계열) 2k — 오너 I4-3(2026-11-08 09:1x) '새 배치 정지 이미지 MS 2k, 1차 블라인드부터'.
  // 새 배치 잡만 쓴다(잡 배치 고르기 R03이 정한다). 생성 폼 선택지(PDP_IMAGE_MODELS)·IMAGE_MODELS에는 넣지 않는다 — 지금 배치는 2.6 high 그대로
  {
    id: 'higgsfield-ms-2k',
    label: 'MS Image 2k (힉스필드)',
    provider: 'higgsfield',
    note: '새 배치 정지 이미지 — UI 비노출 · 장당 단가표(응답에 청구액 없음)',
  },
]

/**
 * 참조 이미지 상한 — 넘기면 도구·API가 거부한다.
 * - codex-image 5: 실측(코덱스 이미지 도구 '`referenced_image_paths` must contain at most 5 paths', R13 P01 hero 재현 6/6, 2026-11-01)
 * - GPT 이미지 16: 공식 API 참조 Create image edit 'up to 16 images'(모델 값에 gpt-image-2·2.5 sunburst·flare, 2026-11-01 확인. 16장을 실제로 보내 본 적은 없다)
 * - Nano Banana 2.1 10: 공식 이미지 문서 '참조 최대 14장(물체 10·인물 4)' 중 물체 상한(2026-11-05 확인) — 상세페이지 참조는 상품 사진이라 물체로 본다
 * - 그 밖의 Gemini: 상세페이지 새 잡이 쓰지 않아 정하지 않았다(상한 없음으로 다룬다)
 */
export const IMAGE_MAX_REFERENCES: Partial<Record<ImageModel, number>> = {
  'codex-image': 5,
  'gpt-image-2': 16,
  'gpt-image-2.5-sunburst': 16,
  'gpt-image-2.5-flare': 16,
  // 2.6도 같은 편집 엔드포인트(Create image edit)를 쓴다. 비교 하네스에서 참조 3장까지 보냈다(16장은 보내 본 적 없음)
  'gpt-image-2.6-sunburst': 16,
  'gemini-nano-banana-2.1': 10,
  // MS Image 참조 16장(비교 하네스 REF_LIMIT, enhance_prompt 끔 — 2026-11-06 확인)
  'higgsfield-ms-2k': 16,
}

/** 비동기 공급자(제출 → 폴링) 모델인가 — 이미지 단계가 run 기한을 넘기고 이어 받기를 다룬다(R05 MS 2k) */
export function isAsyncImageModel(model: string): boolean {
  return ALL_IMAGE_MODELS.find((m) => m.id === model)?.provider === 'higgsfield'
}

export function maxReferencesOf(model: ImageModel): number {
  return IMAGE_MAX_REFERENCES[model] ?? Number.POSITIVE_INFINITY
}

/** 사용자 선택 검증 — 내부 전용 모델은 통과시키지 않는다(잡 단위 모델 선택지는 IMAGE_MODELS만) */
export function isImageModel(v: unknown): v is Exclude<ImageModel, 'gemini-3.1-flash-image'> {
  return typeof v === 'string' && IMAGE_MODELS.some((m) => m.id === v)
}

/**
 * 상세페이지(PDP) 새 잡의 이미지 모델 선택지 — PDP는 Claude·GPT만 쓴다(오너 2026-10-29, pdp-model-refresh).
 * 첫 항목이 기본이다(PdpForm): GPT-Image 2.6(sunburst) high(오너 2026-11-05 22:5x). 2.5(sunburst, 2026-10-31~11-05 기본)와 gpt-image-2는 선택지로 남긴다.
 * 새 잡 생성(POST /api/registration/pdp)과 PdpForm만 이 목록을 쓴다. 이미 만든 Gemini 잡의 읽기·표시·이미지 재생성은
 * ALL_IMAGE_MODELS로 그대로 동작한다(하위 호환). 썸네일 스튜디오·소싱 이미지 생성은 IMAGE_MODELS 그대로다.
 */
export type PdpImageModel = 'gpt-image-2.6-sunburst' | 'gpt-image-2.5-sunburst' | 'gpt-image-2'
const PDP_IMAGE_MODEL_IDS: readonly PdpImageModel[] = ['gpt-image-2.6-sunburst', 'gpt-image-2.5-sunburst', 'gpt-image-2']

export const PDP_IMAGE_MODELS: ImageModelInfo[] = PDP_IMAGE_MODEL_IDS.flatMap((id) => ALL_IMAGE_MODELS.filter((m) => m.id === id))

export function isPdpImageModel(v: unknown): v is PdpImageModel {
  return typeof v === 'string' && (PDP_IMAGE_MODEL_IDS as readonly string[]).includes(v)
}

/** xhigh·max는 GPT Image 2.5 하네스 실험 갈래 전용 — 상세페이지 새 잡은 medium·high만 받는다(POST /api/registration/pdp, 기본 high) */
export type ImageQuality = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

/** 참조 이미지 1장 (제품 일관성 유지용 — 두 모델 모두 2026-08-09 실호출 검증) */
export interface ReferenceImage {
  base64: string
  mimeType: string
}

export interface GenImageInput {
  prompt: string
  model: ImageModel
  /** 정사각형 권장(쿠팡 대표이미지). 기본 1024x1024 */
  size?: string
  quality?: ImageQuality
  /**
   * 참조 이미지 배열 — 있으면 OpenAI는 /v1/images/edits(multipart), Gemini는
   * parts에 inlineData 선치(참조 먼저, 프롬프트 마지막)로 호출한다.
   * 항상 전량 첨부할 것 — 1장만 주면 색상 변형 누락(NEXFIT 아쿠아슈즈 실증).
   */
  referenceImages?: ReferenceImage[]
  /** ai_usage_log 기록의 호출 주체 표기 (예: 'registration/thumbnail') */
  agentName?: string
  /** 업무 실행 원장·사용자·사업장·단계 귀속 */
  runContext?: RunContext
  /** 움직이는 출력(GIF) — 있으면 output_format gif로 부른다. 2.6만 받는다(ANIMATION_MODELS). 결과 mimeType은 image/gif */
  animation?: ImageAnimation
  /**
   * 비동기 공급자(힉스필드)의 기다림 기한(epoch ms) — 이미지 단계가 run 남은 시간으로 정한다. 기한 안에 안 끝나면 ImagePendingError로
   * 요청 정보를 돌려주고, 다음 run이 resume으로 같은 요청을 이어 받는다. 없으면 PROVIDER_CALL_POLICY.totalMs만큼 기다린다
   */
  deadlineAt?: number
  /** 앞 run이 기한 안에 받지 못한 요청 — 다시 제출하지 않고 이 요청을 폴링만 한다(중복 과금 없음). 월 예산 검사도 하지 않는다(제출 때 이미 셈) */
  resume?: ImagePendingRequest
}

/** 비동기 공급자에 제출했지만 기한 안에 받지 못한 요청 — 잡 기록(section_images[].imagePending, 무DDL JSONB)에 남아 다음 run이 이어 받는다 */
export interface ImagePendingRequest {
  provider: 'higgsfield'
  model: ImageModel
  requestId: string
  /** 상태 주소 — 힉스필드 기본 URL 아래만(밖이면 클라이언트가 키를 보내지 않고 오류) */
  statusUrl: string
  /** 제출 시각(ISO) — 너무 오래된 요청은 이어 받지 않고 실패로 끝낸다(IMAGE_PENDING_MAX_MS) */
  submittedAt: string
  /**
   * 이미 받아 사용량을 적은 요청(R08a) — 받은 뒤 저장(업로드)에서 실패해 다음 run이 다시 받기만 한다. 이어 받아도 사용량·비용을
   * 다시 적지 않는다(과금은 처음 받을 때 한 번)
   */
  billed?: true
}

/** 이어 받을 수 있는 최대 시간 — 제출 뒤 이만큼 지나도 안 끝나면 실패로 끝낸다(MS 2k 실측 30~95초의 6배 넘는 여유) */
export const IMAGE_PENDING_MAX_MS = 10 * 60_000

/** 기한 안에 받지 못했다 — 실패가 아니다. 요청은 공급자에서 계속 돌고, pending으로 다음 run에서 이어 받는다 */
export class ImagePendingError extends Error {
  readonly pending: ImagePendingRequest
  constructor(pending: ImagePendingRequest) {
    super(`${pending.model} 요청 ${pending.requestId}이 아직 생성 중 — 다음 run에서 이어 받는다`)
    this.name = 'ImagePendingError'
    this.pending = pending
  }
}

/** 잔액 부족 오류 글의 앞머리 — 컷 기록·잡 단계 오류에서 같은 말로 찾는다(R12c) */
export const IMAGE_PROVIDER_BALANCE_LABEL = '이미지 공급자(힉스필드) 잔액 부족'

/**
 * 이미지 공급자 크레딧 잔액 부족(R12c, 11-09 R11 P07 55182d22 컷 9개) — 컷·지시 탓이 아니고 충전 전에는 다시 내도 같은 실패다.
 * 이미지 단계는 이 오류에 컷 재시도 1번을 쓰지 않고, 그 run의 새 MS 컷을 멈추고, 잡을 단계 오류로 둔다(충전 뒤 다시 시도가 잇는다)
 */
export class ImageProviderBalanceError extends Error {
  readonly provider: 'higgsfield'
  constructor(provider: 'higgsfield', detail: string) {
    super(`${IMAGE_PROVIDER_BALANCE_LABEL}: ${detail}`)
    this.name = 'ImageProviderBalanceError'
    this.provider = provider
  }
}

/**
 * 이미지 공급자가 내용 검사로 거절했다(J60 — 힉스필드 종료 상태 nsfw). 같은 지시로 다시 내면 같은 결과라, 이미지 단계는 이 컷의 재시도 1번을
 * 안전 장면 지시로 부른다(scene-safety nsfwRetryPrompt). 글은 지금 오류 글과 같다(요청 ID·상태·공급자 사유)
 */
export class ImageContentRejectedError extends Error {
  readonly provider: 'higgsfield'
  readonly status: 'nsfw'
  constructor(provider: 'higgsfield', status: 'nsfw', message: string) {
    super(message)
    this.name = 'ImageContentRejectedError'
    this.provider = provider
    this.status = status
  }
}

/**
 * 움직이는 출력(GIF) 요청 — 상세페이지 GIF 칸(오너 2026-11-05 22:45 "제품 이미지를 첨부해서 GIF를 GPT-IMAGE-2.6 높은 추론등급으로").
 * 공식: POST /v1/images/generations + output_format "gif", frame_count 2~16(API 참조. 가이드는 64라 적지만 16을 넘으면 400),
 *   frame_duration_ms 20~2000(10ms 반올림). size는 프레임 한 장 크기이고 프레임 수·크기는 모델 픽셀 한도 안이어야 한다(768²는 9프레임까지 실측,
 *   16은 400. 1024²×9도 400 — GIF_SHEET_MAX_PIXELS).
 * 참조 사진(편집 엔드포인트)으로 GIF를 받는 길은 문서에 없지만 #796 비교 하네스에서 실제로 받았다(26~44초, 768²·9프레임 $0.09~0.14).
 * 응답은 완성된 GIF 하나다(256색). 프레임을 따로·무손실로 받는 칸은 없다.
 */
export interface ImageAnimation {
  frameCount: number
  frameDurationMs: number
  /**
   * 이 GIF 호출의 시간 상한(ms) — 이미지 단계가 run 남은 시간으로 정한다(GIF 칸은 따로 run 예산, 세션 B ③ P3).
   * 없으면 GIF_CALL_POLICY(150초), 있어도 하네스 GIF 정책 상한(300초, GIF_TOTAL_MAX_MS)을 넘기지 않는다
   */
  totalMs?: number
}

/** GIF를 받는 모델 — 2.6만(2.5·gpt-image-2는 output_format gif가 없다) */
export const ANIMATION_MODELS: ReadonlySet<ImageModel> = new Set<ImageModel>(['gpt-image-2.6-sunburst'])

export const ANIMATION_LIMITS = Object.freeze({ minFrames: 2, maxFrames: 16, minFrameMs: 20, maxFrameMs: 2000 })

/**
 * GIF 시트 픽셀 한도 — 2.6은 프레임을 정사각 격자 한 장(가로·세로 올림(√프레임 수)칸)으로 만든다. 400 응답의 'Invalid size'가 그 시트 크기다
 * ("No supported sheet fits 9 GIF frames at size '1024x1024'. Invalid size '3072x3072'. … pixel budget").
 * 실측 두 점: 768²×9 = 시트 2,304²는 됐고(#796), 768²×16·1024²×9 = 시트 3,072²는 400(#796·K5 P04). 상한은 그 사이 어딘가지만
 * 잰 것은 두 점뿐이라 된 값(2,304²)을 넘는 요청은 부르기 전에 막는다(세션 B ③ P6)
 */
export const GIF_SHEET_MAX_PIXELS = 2304 * 2304

/** 프레임 크기('WxH')·프레임 수 → GIF 시트 크기. 크기를 읽지 못하면 null */
export function gifSheetOf(size: string, frameCount: number): { width: number; height: number } | null {
  const m = /^(\d+)x(\d+)$/.exec(size)
  if (!m) return null
  const grid = Math.ceil(Math.sqrt(frameCount))
  return { width: grid * Number(m[1]), height: grid * Number(m[2]) }
}

/** 움직이는 출력 요청 검사 — 맞으면 null, 아니면 이유(부르기 전에 막는다). size는 프레임 한 장 크기(없으면 generateImage 기본과 같은 1024²) */
export function animationRequestError(model: ImageModel, animation: ImageAnimation, size: string = '1024x1024'): string | null {
  if (!ANIMATION_MODELS.has(model)) return `${model}은 움직이는 출력(GIF)을 받지 않습니다 — GPT-Image 2.6만 받습니다.`
  const { frameCount, frameDurationMs } = animation
  const L = ANIMATION_LIMITS
  if (!Number.isInteger(frameCount) || frameCount < L.minFrames || frameCount > L.maxFrames) {
    return `GIF 프레임 수 ${frameCount} — ${L.minFrames}~${L.maxFrames}만 받습니다.`
  }
  if (!Number.isFinite(frameDurationMs) || frameDurationMs < L.minFrameMs || frameDurationMs > L.maxFrameMs) {
    return `GIF 프레임 지연 ${frameDurationMs}ms — ${L.minFrameMs}~${L.maxFrameMs}ms만 받습니다.`
  }
  const sheet = gifSheetOf(size, frameCount)
  if (!sheet) return `GIF 프레임 크기 '${size}' — 'WxH'로 정해야 시트 한도를 볼 수 있습니다.`
  if (sheet.width * sheet.height > GIF_SHEET_MAX_PIXELS) {
    return `GIF 시트 ${sheet.width}x${sheet.height}(프레임 ${size} × ${frameCount}장) — 실측으로 된 시트 2304x2304를 넘어 부르지 않습니다(768²는 9프레임까지).`
  }
  return null
}

/**
 * 이미지 1장 단가(USD) — 2026-08-09 공식 문서 + 실호출 usage 교차 검산(설계문서 §9.1).
 * 미등록 조합은 최고 단가로 계상한다(과소 계상 방지 — NEXFIT models.py 관례).
 */
export const IMAGE_COST_USD: Record<ImageModel, Partial<Record<ImageQuality, number>>> = {
  // low $0.011 = 이미지 출력 $0.006(공식 이미지 가이드 단가표 1024², 세로·가로 $0.005 — smoke 실측 텍스트 입력 27·이미지 출력 196토큰,
  // $5·$30 per MTok로 $0.0060) + 프롬프트 텍스트 입력 약 1천 토큰 × $5/MTok $0.005(저가 컷 rating_bg 프롬프트 약 3,800자). low는
  // 텍스트 입력 비중이 커서 과소 계상하지 않게 더한다(통합 결정, pdp-cost-time-followup 2026-10-29). medium·high는 이미지 출력만
  'gpt-image-2': { low: 0.011, medium: 0.053, high: 0.211 },
  'gemini-3-pro-image': { low: 0.134, medium: 0.134, high: 0.134 },
  // NEXFIT cost_tracking.py:40 공식 1024px 단가 — quality 파라미터 없음(flat)
  'gemini-3.1-flash-image': { low: 0.067, medium: 0.067, high: 0.067 },
  // 구독 사용 한도에서 차감 — API 과금 없음(설계 §4.9)
  'codex-image': { low: 0, medium: 0, high: 0 },
  // GPT Image 2.5 — 토큰 단가는 gpt-image-2와 같다(텍스트 입력 $5·이미지 입력 $8·이미지 출력 $30 per 1M, OpenAI 가격 페이지 2026-10-30).
  // 실제 계상은 응답 usage로 한다(imageCostFromUsage). 이 표는 생성 전 예약(월 예산 경합 방지 — pdp-image-pool)·usage가 없을 때 계상용이다.
  // 단가 실측(2026-10-30, P02 참조 1장·짧은 지시: medium $0.0229·high $0.0538·xhigh $0.0864·max $0.1772)보다 실제 잡이 비싸다 —
  // R8 잡(참조 여러 장·긴 브리프) 이미지 비용 ÷ 이미지 심사 수: medium $0.04~0.07·high $0.07~0.11·xhigh $0.11~0.17·max(P02) $0.30.
  // 예약은 그 위쪽 값으로 둔다(2026-10-31, 과소 예약 방지). flare는 실측 전이라 sunburst와 같은 값
  'gpt-image-2.5-sunburst': { medium: 0.07, high: 0.12, xhigh: 0.18, max: 0.3 },
  'gpt-image-2.5-flare': { medium: 0.07, high: 0.12, xhigh: 0.18, max: 0.3 },
  // GPT Image 2.6 — 토큰 단가가 2.5와 같다(가격 페이지 2026-11-05: 텍스트 입력 $5·이미지 입력 $8·출력 $30 per 1M, Batch 행 없음).
  // 실측(이미지 비교 1·2단계 #796, 장당 평균): medium $0.063·24초, high $0.070·37초, xhigh $0.103·52초, max $0.192·89초(16건 중 4건 100초 초과).
  // 실제 계상은 usage로 하고, 이 표는 예약용이라 2.5와 같은 위쪽 값을 쓴다(과소 예약 방지)
  'gpt-image-2.6-sunburst': { medium: 0.07, high: 0.12, xhigh: 0.18, max: 0.3 },
  // Nano Banana 2.1 — 공식 가격(aistudio 문서 2026-11-05): 장당 1K $0.0336·2K $0.0504, 입력 $1.50·출력 글·생각 $7.50 per 1M.
  // medium=1K·high=2K(GEMINI_IMAGE_SIZE). 실제 계상은 usage로 하고, 이 표는 예약용 — 참조 사진·긴 브리프 입력(약 7천 토큰)과
  // 생각 토큰(기본 medium, 끌 수 없음)을 더한 위쪽 값(과소 예약 방지)
  'gemini-nano-banana-2.1': { medium: 0.07, high: 0.09 },
  // MS Image 2k — 응답에 청구액이 없어 단가표로 계상한다. 실측(비교 하네스 11-07, 사용량 분석 GET /models/usage): 2k 장당 약 $0.106(1k $0.078).
  // 품질 칸이 없는 고정 단가라 모든 품질에 같은 위쪽 값(과소 계상 방지)
  'higgsfield-ms-2k': { low: 0.11, medium: 0.11, high: 0.11, xhigh: 0.11, max: 0.11 },
}

export function estimateImageCostUsd(model: ImageModel, quality: ImageQuality): number {
  const known = IMAGE_COST_USD[model][quality]
  if (known !== undefined) return known
  return Math.max(...Object.values(IMAGE_COST_USD[model]).filter((v): v is number => v !== undefined))
}

/** 이미지 API usage — 이미지 출력·입력과 텍스트 입력 토큰. textOutputTokens는 Gemini만(출력 글 + 생각 토큰, 이미지 출력과 단가가 다르다) */
export interface ImageUsage {
  inputTokens: number
  outputTokens: number
  textInputTokens: number
  imageInputTokens: number
  textOutputTokens?: number
}

/** OpenAI 이미지 토큰 단가(USD / 1M 토큰) — gpt-image-2·2.5·2.6 공통(2026-10-30·11-05 가격 페이지) */
export const OPENAI_IMAGE_TOKEN_USD_PER_M = { textInput: 5, imageInput: 8, imageOutput: 30 } as const

/** Nano Banana 2.1 토큰 단가(USD / 1M 토큰) — 입력 전부(글·이미지) $1.50, 출력 이미지 $30, 출력 글·생각 $7.50(aistudio 가격 문서 2026-11-05) */
export const GEMINI_NB21_TOKEN_USD_PER_M = { input: 1.5, imageOutput: 30, textOutput: 7.5 } as const

/** 응답 usage로 실비용을 매기는 모델 — 2.6(상세페이지 기본)·2.5(sunburst·실험 flare)·Nano Banana 2.1(시험)(gpt-image-2는 단가표 그대로, 계상 불변) */
export const USAGE_PRICED_MODELS: ReadonlySet<ImageModel> = new Set<ImageModel>([
  'gpt-image-2.6-sunburst',
  'gpt-image-2.5-sunburst',
  'gpt-image-2.5-flare',
  'gemini-nano-banana-2.1',
])

/**
 * 비율·해상도를 요청에 싣는 Gemini 모델 — 상세페이지 단계가 비율 줄을 프롬프트에서 빼도 된다(sizeHonored).
 * Nano Banana 2.1만: 품질 medium=1K·high=2K(통합 승인 2026-11-05 — 2.6 high와 화질을 맞춘다). 그 밖의 Gemini 모델 요청은 지금 그대로
 */
export const GEMINI_IMAGE_SIZE: Partial<Record<ImageModel, Partial<Record<ImageQuality, '1K' | '2K'>>>> = {
  'gemini-nano-banana-2.1': { low: '1K', medium: '1K', high: '2K' },
}

/** 이 모델이 요청에서 비율을 받는가 — OpenAI는 size, 비율을 싣는 Gemini 모델(GEMINI_IMAGE_SIZE)만 true */
export function honorsImageSize(model: ImageModel): boolean {
  // 모르는 모델은 지금처럼 true(상세페이지 단계의 옛 판정 'provider가 gemini가 아니면'과 같다)
  const info = ALL_IMAGE_MODELS.find((m) => m.id === model)
  return !info || info.provider !== 'gemini' || model in GEMINI_IMAGE_SIZE
}

/** OpenAI 크기 글('1024x1536') → Gemini 비율('2:3'). 지원 비율 중 가장 가까운 값, 모양이 틀리면 null */
const GEMINI_ASPECTS = ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9'] as const
export function geminiAspectOf(size: string | undefined): (typeof GEMINI_ASPECTS)[number] | null {
  const m = /^(\d+)x(\d+)$/.exec(size ?? '')
  if (!m) return null
  const ratio = Number(m[1]) / Number(m[2])
  if (!(ratio > 0) || !Number.isFinite(ratio)) return null
  const value = (a: string) => {
    const [w, h] = a.split(':').map(Number)
    return w / h
  }
  return [...GEMINI_ASPECTS].sort((a, b) => Math.abs(Math.log(value(a) / ratio)) - Math.abs(Math.log(value(b) / ratio)))[0]
}

/**
 * Gemini 응답 usageMetadata 해석(generateContent 공식 칸: promptTokenCount·candidatesTokenCount·thoughtsTokenCount·
 * promptTokensDetails·candidatesTokensDetails[{modality, tokenCount}]). 모양이 틀리면 null(단가표로 계상)
 */
export function parseGeminiUsage(raw: unknown): ImageUsage | null {
  if (!raw || typeof raw !== 'object') return null
  const u = raw as Record<string, unknown>
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null)
  const prompt = n(u.promptTokenCount)
  const candidates = n(u.candidatesTokenCount)
  if (prompt === null || candidates === null) return null
  const byModality = (list: unknown, modality: string) =>
    Array.isArray(list)
      ? list.reduce((sum: number, d) => sum + (d && typeof d === 'object' && (d as { modality?: unknown }).modality === modality ? (n((d as { tokenCount?: unknown }).tokenCount) ?? 0) : 0), 0)
      : null
  const imageIn = byModality(u.promptTokensDetails, 'IMAGE') ?? 0
  // 출력 세부가 없으면 출력 전부를 이미지로 본다(더 비싼 단가라 과소 계상하지 않게)
  const imageOut = Array.isArray(u.candidatesTokensDetails) ? (byModality(u.candidatesTokensDetails, 'IMAGE') ?? 0) : candidates
  const thoughts = n(u.thoughtsTokenCount) ?? 0
  return {
    inputTokens: prompt,
    outputTokens: imageOut,
    textInputTokens: Math.max(0, prompt - imageIn),
    imageInputTokens: imageIn,
    textOutputTokens: Math.max(0, candidates - imageOut) + thoughts,
  }
}

/** OpenAI 응답 usage 해석 — 모양이 틀리면 null(단가표로 계상) */
export function parseImageUsage(raw: unknown): ImageUsage | null {
  if (!raw || typeof raw !== 'object') return null
  const u = raw as Record<string, unknown>
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null)
  const input = n(u.input_tokens)
  const output = n(u.output_tokens)
  if (input === null || output === null) return null
  const details = (u.input_tokens_details ?? {}) as Record<string, unknown>
  const text = n(details.text_tokens)
  const image = n(details.image_tokens)
  // 세부가 없으면 입력 전부를 텍스트로 본다(더 싼 단가라 과대 계상하지 않게 — 세부가 있으면 그대로)
  return { inputTokens: input, outputTokens: output, textInputTokens: text ?? input - (image ?? 0), imageInputTokens: image ?? 0 }
}

/** usage → USD(소수 6자리). Nano Banana 2.1은 그 모델 단가표(입력 한 단가·출력 글·생각 따로), 그 밖은 OpenAI 단가표 */
export function imageCostFromUsage(usage: ImageUsage, model?: ImageModel): number {
  if (model === 'gemini-nano-banana-2.1') {
    const g = GEMINI_NB21_TOKEN_USD_PER_M
    const usd = (usage.inputTokens * g.input + usage.outputTokens * g.imageOutput + (usage.textOutputTokens ?? 0) * g.textOutput) / 1_000_000
    return Math.round(usd * 1e6) / 1e6
  }
  const p = OPENAI_IMAGE_TOKEN_USD_PER_M
  const usd = (usage.textInputTokens * p.textInput + usage.imageInputTokens * p.imageInput + usage.outputTokens * p.imageOutput) / 1_000_000
  return Math.round(usd * 1e6) / 1e6
}

export interface GenImageResult {
  /** 이미지 바이트(base64) */
  base64: string
  mimeType: string
  model: ImageModel
  /** 이 장의 계상 비용(USD) — 실비용 모델은 usage, 그 밖은 단가표. 로컬 백엔드는 0 */
  costUsd?: number
  /** OpenAI 응답 usage(있을 때) */
  usage?: ImageUsage
  /** 코덱스 구독 이미지(전용 홈)의 재작성 기록 — rollout에서 뽑은 에이전트 프롬프트·최종 프롬프트·참조 수·도구 시간(E1) */
  codexTrace?: CodexTrace
  /** 비동기 공급자(힉스필드)의 요청 ID — 기록·대조용 */
  providerRequestId?: string
  /** 비동기 공급자(힉스필드)의 받은 요청 — 받은 뒤 저장에 실패하면 이미지 단계가 이것을 남겨 다음 run이 다시 제출하지 않고 받는다(R08a) */
  asyncRequest?: ImagePendingRequest
  /** 공급자 상한에 맞춰 덜어 낸 뒤 실제로 보낸 지시(받은 지시와 다를 때만) — 이미지 단계가 sentPrompt 기록에 쓴다 */
  sentPrompt?: string
  /** 덜어 낸 블록 머리와 원래 길이(sentPrompt가 있을 때) */
  promptFit?: { dropped: string[]; originalLength: number }
  /** 짧은 변이 작아 키워 올린 참조 수(힉스필드) */
  upscaledRefs?: number
}

/** 코덱스 에이전트가 이미지 도구에 넘긴 프롬프트(agentPrompt)와 생성 이벤트의 최종 프롬프트(revisedPrompt) — 각 앞 4천 자, 전체 길이는 따로 */
export interface CodexTrace {
  agentPrompt?: string
  agentPromptChars?: number
  revisedPrompt?: string
  revisedPromptChars?: number
  /** 도구에 실제로 넘긴 참조 이미지 수(jsonl rollout만 — thread_history DB에는 없어 null) */
  refs: number | null
  /** 도구 호출부터 결과까지(초, jsonl rollout만) */
  genSec: number | null
  /** 코덱스 턴 전체 시간(초, thread_history DB의 thread_turns.duration_ms — 에이전트 오버헤드 포함) */
  turnSec?: number | null
  /** 이미지 생성 항목 상태(thread_history DB) */
  status?: string
  /** 이 실행의 이미지 도구 호출 수 */
  calls: number
}
import type { RunContext } from '@/lib/agents/types'
