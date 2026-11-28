/**
 * 이미지 생성 프로바이더 호출 (WS-B) — 모델별 실제 API 요청. 순수 생성만 담당(저장·프롬프트 조립 제외).
 *
 * - GPT-Image 2.0: OpenAI Images API(POST /v1/images/generations) → data[0].b64_json
 *   참조 이미지가 있으면 /v1/images/edits(multipart, image[] 필드) — 2026-08-09 실호출 검증
 * - Nano Banana Pro: Gemini generateContent(responseModalities:['IMAGE']) → parts[].inlineData
 *   참조 이미지는 parts에 inlineData 선치(참조 먼저, 프롬프트 마지막) — 2026-08-09 실호출 검증
 * 두 계약 모두 2026-07-23 실 키로 실측 확정.
 *
 * 시간: 제공자 호출은 재시도 포함 100초 상한, 429·5xx만 짧은 백오프로 다시 부른다(PROVIDER_CALL_POLICY).
 * 비용: 호출 성공 시 ai_usage_log에 단가 기록 + 호출 전 월 예산 게이트(checkMonthlyBudget).
 * 예외 — 로컬 백엔드 모델(codex-image, C1): 구독 한도에서 차감되므로 예산 게이트를 건너뛰고 비용 0으로 기록한다.
 * GPT Image 2.5(실험 갈래): 같은 OpenAI 경로에 모델 id를 그대로 넘기고, 응답 usage로 장당 실비용을 매겨 기록한다(USAGE_PRICED_MODELS).
 * 비용 리스너(registerImageCostListener): 같은 프로세스의 실 테스트 하네스가 장마다 모델·품질·비용을 받는다(원장용).
 * Nano Banana 2.1(블라인드 시험, 2026-11-05): 같은 Gemini 경로에 비율·해상도(imageConfig)를 싣고 usageMetadata로 실비용을 매긴다.
 * Gemini 오류 글은 키를 가리고 자른다(키는 환경 변수에서 읽기만, 출력·로그에 남기지 않는다).
 */

import {
  ALL_IMAGE_MODELS,
  animationRequestError,
  estimateImageCostUsd,
  GEMINI_IMAGE_SIZE,
  geminiAspectOf,
  imageCostFromUsage,
  parseGeminiUsage,
  parseImageUsage,
  USAGE_PRICED_MODELS,
  type GenImageInput,
  type GenImageResult,
  type ImageAnimation,
  type ImageModel,
  type ImageQuality,
  type ImageUsage,
  ImagePendingError,
  maxReferencesOf,
} from './types'
import { generateHiggsfieldImage } from './higgsfield-image'
import {
  getLocalImageBackend,
  LOCAL_BACKEND_SOFT_STOP_MARKER,
  noteLocalBackendSoftStop,
  peekLocalBackendSoftStop,
  softStopReasonOf,
  type LocalImageModel,
} from './local-backend'
import { logUsage } from '@/lib/agents/budget'
import { codexImage, RateLimitedError } from '@/lib/local-codex/image'

const OPENAI_GENERATIONS_URL = 'https://api.openai.com/v1/images/generations'
const OPENAI_EDITS_URL = 'https://api.openai.com/v1/images/edits'
const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models'

/**
 * 제공자 호출 시간 정책(NEXFIT 676209e 이미지 호출 개별 타임아웃 + 9ba3435 429 재시도 이식).
 * 무응답 1건이 run을 Vercel maxDuration(120초)까지 붙잡아 섹션 실패조차 기록되지 않던 것을 막는다.
 * - totalMs: 재시도를 포함한 제공자 호출 전체 상한(run 120초 안쪽). 각 시도의 타임아웃은 남은 시간이다.
 * - 429·5xx만 재시도한다(400·401 등은 즉시 실패). 백오프 뒤에도 minAttemptMs가 남을 때만 다시 부른다 —
 *   남은 시간이 짧은 시도는 끝나기 전에 끊겨 비용만 남길 수 있다.
 */
export interface ProviderCallPolicy {
  totalMs: number
  backoffMs: readonly number[]
  minAttemptMs: number
}

export const PROVIDER_CALL_POLICY: ProviderCallPolicy = {
  totalMs: 100_000,
  backoffMs: [2_000, 5_000],
  minAttemptMs: 30_000,
}

/**
 * 움직이는 출력(GIF) 호출 정책 — 실측 26~44초(#796, 768²·9프레임·medium)라 정지 컷 상한 100초는 high에서 모자랄 수 있다.
 * 150초 안에서 429·5xx만 한 번 다시 부르되, 다시 부를 때 60초 이상 남아야 한다(끝나기 전에 끊겨 비용만 남지 않게).
 * 상세페이지 run 예산(280초)에서 GIF 칸은 이 상한으로 따로 센다(배선은 이미지 단계에서).
 */
export const GIF_CALL_POLICY: ProviderCallPolicy = {
  totalMs: 150_000,
  backoffMs: [5_000],
  minAttemptMs: 60_000,
}

/** GIF 호출 상한의 끝 — 비교 하네스 GIF 정책(scripts/pdp-eval/image-model-compare.ts GIF_POLICY 300초)과 같다 */
export const GIF_TOTAL_MAX_MS = 300_000

/** 이 GIF 호출의 정책 — 부르는 쪽 상한(animation.totalMs)이 있으면 그 값(300초까지), 없으면 GIF_CALL_POLICY. 다시 부르기 규칙은 같다 */
export const gifCallPolicyOf = (anim: Pick<ImageAnimation, 'totalMs'>): ProviderCallPolicy =>
  anim.totalMs && anim.totalMs > 0 ? { ...GIF_CALL_POLICY, totalMs: Math.min(anim.totalMs, GIF_TOTAL_MAX_MS) } : GIF_CALL_POLICY

/** 응답 바이트의 실제 형식 — 앞 몇 바이트(매직 넘버)로 판별, 모르면 PNG(OpenAI 기본 출력) */
export function imageMimeOfBase64(b64: string): string {
  const head = Buffer.from(b64.slice(0, 24), 'base64')
  if (head.subarray(0, 4).toString('latin1') === 'GIF8') return 'image/gif'
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'image/jpeg'
  if (head.subarray(0, 4).toString('latin1') === 'RIFF' && head.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp'
  return 'image/png'
}

function isRetryableStatus(status: number | undefined): boolean {
  return status === 429 || (typeof status === 'number' && status >= 500 && status <= 599)
}

function isTimeoutError(e: unknown): boolean {
  return e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError')
}

/**
 * 제공자 1요청(재시도 포함) — 응답 JSON까지 시간 상한 안에서 받는다. 5xx 게이트웨이가 HTML을 돌려줘도
 * 파싱 예외 대신 상태 코드로 판단한다. 시간 초과는 명시 메시지로 던진다(호출부가 섹션 실패로 흡수).
 */
export async function fetchProviderJson<T>(
  label: string,
  url: string,
  makeInit: () => RequestInit,
  policy: ProviderCallPolicy = PROVIDER_CALL_POLICY,
): Promise<{ status: number; ok: boolean; json: T; attempts: number }> {
  const deadline = Date.now() + policy.totalMs
  for (let attempt = 1; ; attempt++) {
    const remaining = deadline - Date.now()
    let res: Response
    let json: T
    try {
      res = await fetch(url, { ...makeInit(), signal: AbortSignal.timeout(Math.max(remaining, 1)) })
      // 본문 수신 중 시간 초과는 그대로 던지고, JSON이 아닌 본문(게이트웨이 HTML 등)만 빈 객체로 본다
      json = (await res.json().catch((e: unknown) => {
        if (isTimeoutError(e)) throw e
        return {}
      })) as T
    } catch (e) {
      if (isTimeoutError(e)) {
        throw new Error(`${label} 시간 초과(${Math.round(policy.totalMs / 1000)}초, ${attempt}회 시도)`)
      }
      throw e
    }
    const backoff = policy.backoffMs[attempt - 1]
    const canRetry =
      !res.ok &&
      isRetryableStatus(res.status) &&
      backoff !== undefined &&
      deadline - Date.now() - backoff >= policy.minAttemptMs
    if (!canRetry) return { status: res.status, ok: res.ok, json, attempts: attempt }
    await new Promise((resolve) => setTimeout(resolve, backoff))
  }
}

interface ProviderOutcome {
  result: GenImageResult
  attempts: number
}

/**
 * 힉스필드 MS 2k(R05) — 제출(또는 이어 받기) → 기한까지 폴링 → 받기. 기한이 지나면 ImagePendingError가 그대로 올라간다.
 * 덜어 낸 지시는 sentPrompt로 돌려 이미지 단계가 실제로 보낸 글을 기록하게 한다
 */
async function generateHiggsfield(input: GenImageInput): Promise<ProviderOutcome> {
  const out = await generateHiggsfieldImage(input)
  return {
    result: {
      base64: out.base64,
      mimeType: out.mimeType,
      model: input.model,
      providerRequestId: out.requestId,
      // 받은 요청 — 저장에 실패하면 이미지 단계가 남겨 다음 run이 다시 받는다(R08a). 이어 받은 요청의 과금 표지(billed)는 그대로 잇는다
      asyncRequest: {
        provider: 'higgsfield',
        model: input.model,
        requestId: out.requestId,
        statusUrl: out.statusUrl,
        submittedAt: out.submittedAt,
        ...(input.resume?.billed ? { billed: true as const } : {}),
      },
      ...(out.fit && out.fit.prompt !== input.prompt ? { sentPrompt: out.fit.prompt, promptFit: { dropped: out.fit.dropped, originalLength: out.fit.originalLength } } : {}),
      ...(out.upscaledRefs > 0 ? { upscaledRefs: out.upscaledRefs } : {}),
    },
    attempts: 1,
  }
}

/** 장당 비용 알림 — 실 테스트 하네스(같은 프로세스)가 원장에 모델·품질·실비용을 남기려고 듣는다 */
export interface ImageCostEvent {
  model: ImageModel
  quality: ImageQuality | undefined
  size: string
  costUsd: number
  usage: ImageUsage | null
  agentName: string
  durationMs: number
  /** 호출 단계(runContext.stage, 예 'images/hero'·'images/k3_photo_0/regenerate') — 원장 컷별 비용용. 없으면 빈 값 */
  stage?: string
}
const costListeners = new Set<(event: ImageCostEvent) => void>()

export function registerImageCostListener(listener: (event: ImageCostEvent) => void): () => void {
  costListeners.add(listener)
  return () => {
    costListeners.delete(listener)
  }
}

/**
 * OpenAI 이미지 1장 — 예산 게이트·사용량 기록 없이 호출만(generateImage가 감싼다). 단가 실측 스크립트도 이 함수를 쓴다.
 * 모델 id는 입력 그대로(gpt-image-2·gpt-image-2.5-*·gpt-image-2.6-sunburst), 응답 usage를 함께 돌려준다
 */
export async function generateOpenAiImage(input: GenImageInput): Promise<ProviderOutcome> {
  return generateOpenAI(input)
}

async function generateOpenAI(input: GenImageInput): Promise<ProviderOutcome> {
  const key = process.env.OPENAI_API_KEY
  if (!key) throw new Error('OPENAI_API_KEY가 설정돼 있지 않습니다.')

  const refs = input.referenceImages ?? []
  const anim = input.animation
  const frameMs = anim ? Math.round(anim.frameDurationMs / 10) * 10 : 0 // 공식: 10ms로 반올림
  const policy = anim ? gifCallPolicyOf(anim) : PROVIDER_CALL_POLICY
  type OpenAiJson = { data?: { b64_json?: string }[]; usage?: unknown; error?: { message?: string } }
  let call: { status: number; ok: boolean; json: OpenAiJson; attempts: number }
  if (refs.length > 0) {
    // edits 엔드포인트는 multipart 전용 — image[]로 참조 전량 첨부(재시도마다 새로 만든다)
    const buildForm = () => {
      const form = new FormData()
      form.append('model', input.model)
      form.append('prompt', input.prompt)
      form.append('size', input.size ?? '1024x1024')
      form.append('quality', input.quality ?? 'high')
      form.append('n', '1')
      if (anim) {
        // 문서 밖 길(편집 + GIF) — #796 하네스와 같은 꼴: multipart라 숫자도 글자로
        form.append('output_format', 'gif')
        form.append('frame_count', String(anim.frameCount))
        form.append('frame_duration_ms', String(frameMs))
      }
      refs.forEach((ref, i) => {
        const bytes = Buffer.from(ref.base64, 'base64')
        const ext = ref.mimeType === 'image/jpeg' ? 'jpg' : ref.mimeType === 'image/webp' ? 'webp' : 'png'
        form.append('image[]', new Blob([new Uint8Array(bytes)], { type: ref.mimeType }), `ref-${i}.${ext}`)
      })
      return form
    }
    call = await fetchProviderJson<OpenAiJson>(
      'OpenAI 이미지 생성',
      OPENAI_EDITS_URL,
      () => ({
        method: 'POST',
        headers: { Authorization: `Bearer ${key}` },
        body: buildForm(),
      }),
      policy,
    )
  } else {
    const body = JSON.stringify({
      model: input.model,
      prompt: input.prompt,
      size: input.size ?? '1024x1024',
      quality: input.quality ?? 'high',
      n: 1,
      ...(anim ? { output_format: 'gif', frame_count: anim.frameCount, frame_duration_ms: frameMs } : {}),
    })
    call = await fetchProviderJson<OpenAiJson>(
      'OpenAI 이미지 생성',
      OPENAI_GENERATIONS_URL,
      () => ({
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body,
      }),
      policy,
    )
  }
  const { json } = call
  if (!call.ok) throw new Error(`OpenAI 이미지 생성 실패(${call.status}): ${json.error?.message ?? 'unknown'}`)
  const b64 = json.data?.[0]?.b64_json
  if (!b64) throw new Error('OpenAI 응답에 이미지가 없습니다.')
  const mimeType = imageMimeOfBase64(b64)
  // GIF를 달라고 했는데 정지 그림이 오면(문서 밖 편집 + GIF 길이 막힌 경우 등) 실패로 본다 — 호출부가 대체 칸으로 간다
  if (anim && mimeType !== 'image/gif') throw new Error(`OpenAI 움직이는 출력 요청에 GIF가 아닌 ${mimeType}이 왔습니다.`)
  const usage = parseImageUsage(json.usage)
  return {
    result: { base64: b64, mimeType, model: input.model, ...(usage ? { usage } : {}) },
    attempts: call.attempts,
  }
}

interface GeminiPart {
  inlineData?: { data?: string; mimeType?: string }
  inline_data?: { data?: string; mime_type?: string }
}

/** Gemini 오류 글 상한 — 응답 본문을 그대로 싣지 않는다 */
const GEMINI_ERROR_MAX_CHARS = 300

/** 오류 글에서 키를 가린다 — 키 값 자체와 'key=…' 꼴(주소가 섞인 오류) 둘 다. 길이도 자른다 */
export function redactGeminiError(text: string, key: string | undefined): string {
  let out = String(text ?? '')
  if (key) out = out.split(key).join('[key]')
  out = out.replace(/([?&]key=)[^&\s"']+/gi, '$1[key]').replace(/AIza[0-9A-Za-z_-]{20,}/g, '[key]')
  return out.length > GEMINI_ERROR_MAX_CHARS ? `${out.slice(0, GEMINI_ERROR_MAX_CHARS)}…` : out
}

/** Gemini 요청 본문 — 비율·해상도는 GEMINI_IMAGE_SIZE에 있는 모델(Nano Banana 2.1)만 싣는다. 그 밖은 지금 본문 그대로 */
export function geminiRequestBody(input: Pick<GenImageInput, 'model' | 'prompt' | 'referenceImages' | 'size' | 'quality'>): string {
  const refParts = (input.referenceImages ?? []).map((ref) => ({
    inlineData: { mimeType: ref.mimeType, data: ref.base64 },
  }))
  const sizes = GEMINI_IMAGE_SIZE[input.model]
  const aspectRatio = sizes ? geminiAspectOf(input.size ?? '1024x1024') : null
  const imageSize = sizes ? (sizes[input.quality ?? 'high'] ?? sizes.high) : undefined
  const imageConfig = sizes ? { ...(aspectRatio ? { aspectRatio } : {}), ...(imageSize ? { imageSize } : {}) } : null
  // 모델 id를 그대로 경로에 사용 — gemini-3-pro-image·gemini-3.1-flash-image 동일 계약(개정 5). 생각 수준은 모델 기본(medium) 그대로
  return JSON.stringify({
    contents: [{ parts: [...refParts, { text: input.prompt }] }],
    generationConfig: { responseModalities: ['IMAGE'], ...(imageConfig ? { imageConfig } : {}) },
  })
}

async function generateGemini(input: GenImageInput): Promise<ProviderOutcome> {
  const key = process.env.GEMINI_API_KEY
  if (!key) throw new Error('GEMINI_API_KEY가 설정돼 있지 않습니다.')
  const body = geminiRequestBody(input)
  let call: Awaited<ReturnType<typeof fetchProviderJson<GeminiJson>>>
  try {
    call = await fetchProviderJson<GeminiJson>('Gemini 이미지 생성', `${GEMINI_BASE}/${input.model}:generateContent?key=${key}`, () => ({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    }))
  } catch (e) {
    // 네트워크 오류 글에 요청 주소(키 포함)가 섞일 수 있다 — 가려서 다시 던진다
    throw new Error(redactGeminiError(e instanceof Error ? e.message : String(e), key))
  }
  const { json } = call
  if (!call.ok) throw new Error(`Gemini 이미지 생성 실패(${call.status}): ${redactGeminiError(json.error?.message ?? 'unknown', key)}`)
  const candidate = json.candidates?.[0]
  const parts = candidate?.content?.parts ?? []
  const usage = USAGE_PRICED_MODELS.has(input.model) ? parseGeminiUsage(json.usageMetadata) : null
  for (const p of parts) {
    const inline = p.inlineData ?? p.inline_data
    const data = inline?.data
    if (data) {
      const mimeType = (p.inlineData?.mimeType ?? p.inline_data?.mime_type) || 'image/png'
      return { result: { base64: data, mimeType, model: input.model, ...(usage ? { usage } : {}) }, attempts: call.attempts }
    }
  }
  // 이미지가 없는 응답(안전 거부 등) — 원장 실패 사유로 남게 끝난 사유를 붙인다
  const reason = candidate?.finishReason ?? json.promptFeedback?.blockReason
  throw new Error(`Gemini 응답에 이미지가 없습니다.${reason ? ` (${redactGeminiError(String(reason), key)})` : ''}`)
}

interface GeminiJson {
  candidates?: { content?: { parts?: GeminiPart[] }; finishReason?: string }[]
  promptFeedback?: { blockReason?: string }
  usageMetadata?: unknown
  error?: { message?: string }
}

/**
 * 로컬 백엔드 모델 생성 — 예산 게이트 없음·비용 0 기록. 등록이 없으면(Vercel) 호출 없이 명시 오류.
 * 한도 소진·시간 초과 오류는 레지스트리에 소프트 종료로 남기고, 메시지에 표지를 붙여 다시 던진다.
 * 소프트 종료 기록이 남아 있으면 하네스가 지울 때까지 백엔드를 부르지 않고 즉시 실패한다(한도·시간 낭비 차단).
 */
async function generateLocal(input: GenImageInput, agentName: string): Promise<GenImageResult> {
  const model = input.model as LocalImageModel
  const backend = getLocalImageBackend(model)
  if (!backend) {
    throw new Error(
      `${model} 로컬 백엔드가 등록돼 있지 않습니다 — 이 모델은 코덱스 구독이 로그인된 PC의 로컬 실행기에서만 생성합니다.`,
    )
  }
  const stopped = peekLocalBackendSoftStop()
  if (stopped?.model === model) {
    throw new Error(`${LOCAL_BACKEND_SOFT_STOP_MARKER} ${stopped.reason}: 소프트 종료 대기 중 — ${stopped.message}`)
  }
  const start = Date.now()
  const record = async (success: boolean) => {
    const usageLogged = await logUsage({
      agent: agentName,
      model,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      runContext: input.runContext,
      success,
      durationMs: Date.now() - start,
      attempts: 1,
    })
    if (!usageLogged) console.error('이미지 사용량 기록 실패 — 생성 결과에는 영향 없음.', { agentName, model })
  }

  try {
    const output = await backend({
      prompt: input.prompt,
      size: input.size ?? '1024x1024',
      quality: input.quality,
      referenceImages: input.referenceImages ?? [],
      agentName,
      runContext: input.runContext,
    })
    if (!output?.base64) throw new Error(`${model} 백엔드가 이미지 없이 반환했습니다.`)
    await record(true)
    return { base64: output.base64, mimeType: output.mimeType || 'image/png', model, ...(output.trace ? { codexTrace: output.trace } : {}) }
  } catch (error) {
    await record(false)
    const reason = softStopReasonOf(error)
    if (!reason) throw error
    const message = error instanceof Error ? error.message : String(error)
    noteLocalBackendSoftStop({ model, reason, message, at: new Date().toISOString() })
    if (message.includes(LOCAL_BACKEND_SOFT_STOP_MARKER)) throw error
    throw new Error(`${LOCAL_BACKEND_SOFT_STOP_MARKER} ${reason}: ${message}`)
  }
}

/**
 * 선택된 모델로 이미지 1장을 생성한다. base64 바이트를 반환하며 저장은 호출자(라우트)가 한다.
 * 월 예산 소진 시 호출 전에 throw, 성공 시 단가를 ai_usage_log에 기록한다.
 */
export async function generateImage(input: GenImageInput): Promise<GenImageResult> {
  if (!input.prompt?.trim()) throw new Error('프롬프트가 필요합니다.')
  if (input.animation) {
    throw new Error('라이트에서는 움직이는 이미지(GIF)를 만들지 않습니다.')
  }
  const agentName = input.agentName ?? 'image/generate'
  const start = Date.now()
  try {
    const generated = await codexImage({
      prompt: input.prompt,
      size: input.size ?? '1024x1024',
      referenceImages: (input.referenceImages ?? []).slice(0, 5),
      timeoutMs: 30 * 60_000,
    })
    const result: GenImageResult = {
      base64: generated.base64,
      mimeType: generated.mimeType,
      model: input.model,
      costUsd: 0,
    }
    const usageLogged = await logUsage({
      agent: agentName,
      model: input.model,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      runContext: input.runContext,
      success: true,
      durationMs: Date.now() - start,
      attempts: 1,
    })
    if (!usageLogged) {
      console.error('이미지 사용량 기록 실패 — 이미지 생성 호출은 재시도하지 않습니다.', {
        agentName,
        model: input.model,
      })
    }
    const event: ImageCostEvent = {
      model: input.model,
      quality: input.quality,
      size: input.size ?? '1024x1024',
      costUsd: 0,
      usage: null,
      agentName,
      durationMs: Date.now() - start,
      ...(input.runContext?.stage ? { stage: input.runContext.stage } : {}),
    }
    for (const listener of costListeners) listener(event)
    return result
  } catch (error) {
    const usageLogged = await logUsage({
      agent: agentName,
      model: input.model,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      runContext: input.runContext,
      success: false,
      durationMs: Date.now() - start,
      attempts: 1,
    })
    if (!usageLogged) {
      console.error('이미지 사용량 기록 실패 — 이미지 생성 호출은 재시도하지 않습니다.', {
        agentName,
        model: input.model,
      })
    }
    // 호출부가 RateLimitedError 이름으로 재개 가능한 한도 실패를 구분할 수 있게 원형을 보존한다.
    if (error instanceof RateLimitedError) throw error
    throw error
  }
}
