/**
 * 힉스필드 MS Image 2k 운영 공급자(하네스 R05, 오너 I4-3·I4-4 12, 2026-11-08) — generate.ts가 provider 'higgsfield' 모델을 여기로 보낸다.
 * - 경로: POST /marketing-studio/image/sunburst { prompt, quality 'high', resolution '2k', aspect_ratio, enhance_prompt false, image_urls }
 *   (비교 하네스 higgsfield-compare-core와 같은 본문 — 오너 블라인드 pack 72c4dd9a39의 MS sunburst 갈래).
 * - 참조: 원본 사진을 힉스필드 업로드 주소에 올린다(오너 I4-3 외부 업로드 허용). 짧은 변이 300px 미만이면 공급자가 거절하므로
 *   짧은 변 512px로 키워 올린다(#892 P08 332×296 거절 사례).
 * - 지시: MS 상한 5000자. 운영 조립 지시는 8.8천~14.3천 자(K8 177컷 실측)라 블록 단위로 정해진 순서대로 덜어 낸다 —
 *   페이지용 블록 → 헌장 → 검수·공통 촬영 규칙 → 일반 일치 규칙. 바탕 장면(첫 블록)·식별 카드·인쇄 표시·참조 역할·컷 지시·부품·쓰는 법·
 *   재생성 지시는 남긴다. 덜어도 넘으면 몰래 자르지 않고 오류(그 컷 실패).
 * - 기다림: 호출자가 준 기한(deadlineAt)까지만 폴링하고, 넘으면 ImagePendingError(요청 ID·상태 주소)로 돌려준다 — 다음 run이
 *   resume으로 같은 요청을 이어 받는다(다시 제출하지 않음 = 중복 과금 없음).
 * - 제출 키(Idempotency-Key): 실제로 보내는 본문(지시·비율·참조 업로드 주소)과 단계로 만든다(R08a). 참조는 제출마다 새로 올려 주소가
 *   바뀌므로 다시 제출하면 새 키다 — 예전 키(지시·참조 바이트 해시)는 다음 run 재제출이 같은 키·다른 본문이 되어 HTTP 422로 끝났다
 *   (R08 P07 잡 80962f2d 3컷). 같은 본문을 다시 보내면 같은 키라 힉스필드가 같은 요청을 돌려준다.
 * - 실패 사유(R12c): failed·nsfw·canceled는 상태 응답의 error 앞 300자(주소 지움)를 오류 글에 붙인다. 크레딧 잔액 부족은
 *   ImageProviderBalanceError로 갈라 던진다 — 이미지 단계가 컷 재시도를 쓰지 않고 run을 멈춘다. nsfw는 ImageContentRejectedError로
 *   갈라 던진다(J60, 글은 같다) — 이미지 단계가 재시도 1번을 안전 장면 지시로 부른다.
 * - 키: HF_API_KEY_ID·HF_API_KEY_SECRET(읽기만, 오류·로그에 값 없음). 없으면 명시 오류 — 이 모델을 쓰는 잡(새 배치)만 실패하고
 *   지금 배치(2.6 high)는 이 파일을 지나지 않는다.
 */

import { createHash } from 'node:crypto'
import type sharpModule from 'sharp'
import { createHiggsfieldClient, higgsfieldKeysFromEnv, type HiggsfieldResult, type HiggsfieldSubmission } from './higgsfield'
import {
  IMAGE_PENDING_MAX_MS,
  ImageContentRejectedError,
  ImagePendingError,
  ImageProviderBalanceError,
  type GenImageInput,
  type ImagePendingRequest,
  type ReferenceImage,
} from './types'

export const MS2K_MODEL_PATH = '/marketing-studio/image/sunburst'
export const HF_PROMPT_MAX = 5000
/** 공급자가 거절하는 짧은 변(미만) — 이보다 작으면 HF_REF_UPSCALE_SIDE로 키운다 */
export const HF_REF_MIN_SIDE = 300
export const HF_REF_UPSCALE_SIDE = 512
/** 기한이 없을 때 기다리는 시간(generate.ts PROVIDER_CALL_POLICY.totalMs와 같다) */
const DEFAULT_WAIT_MS = 100_000

/**
 * 덜어 낼 블록 머리(앞에서부터) — 운영 조립 지시(cutPromptOf)의 블록 머리. 첫 블록(바탕 장면)은 덜지 않는다.
 * 머리가 바뀌면 덜지 못하고 상한 오류로 멈춘다(조용히 다른 블록을 자르지 않는다)
 */
export const HF_PROMPT_DROP_ORDER = [
  // 페이지(글자·배치)용 — 사진 생성에는 쓰이지 않는다
  '[실측 디자인 레시피',
  '[모바일 판독 기준',
  '아래는 시장 관행 참고 자료다',
  // 페이지 전체 톤 — 컷 사이 일관성은 hero 스타일 참조 사진이 같이 맡는다
  'GLOBAL STYLE CHARTER',
  // 검수·공통 촬영 규칙(비교 하네스 DROP_ORDER와 같은 머리)
  'If ANY checklist fails',
  'VERIFICATION CHECKLIST',
  'Photography setup',
  'Professional e-commerce product photogra',
  'Prop / branding rules',
  'Human Subject Quality Rules',
  'Critical Anti-AI Artifact Rules',
  'Product cleanliness',
  '- NEGATIVE CONSTRAINT',
  // 일반 일치 규칙 — 상품별 식별 카드·부품·참조 역할 블록이 남는다
  'PRODUCT CONSISTENCY RULES',
] as const

export interface HiggsfieldPromptFit {
  prompt: string
  /** 덜어 낸 블록 머리(순서대로) */
  dropped: string[]
  originalLength: number
}

/** 덜어 내기 계획 — 던지지 않는다(재현 표·시험이 같은 셈을 쓴다). blocks = 원래 블록, keptIndex = 남은 블록 번호 */
export interface HiggsfieldPromptPlan extends HiggsfieldPromptFit {
  blocks: string[]
  keptIndex: number[]
  fits: boolean
}

/** MS 상한에 맞춘 지시 계획 — 블록(빈 줄로 나뉜 단락) 단위로 HF_PROMPT_DROP_ORDER 순서대로 덜어 낸다. 넘으면 fits false */
export function planHiggsfieldPrompt(prompt: string, max = HF_PROMPT_MAX): HiggsfieldPromptPlan {
  const originalLength = prompt.length
  const blocks = prompt.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean)
  let kept = blocks.map((_, i) => i)
  // 상한 안이면 원문 그대로 보낸다(블록을 다시 잇지 않는다 — 바이트 그대로)
  if (prompt.length <= max) return { prompt, dropped: [], originalLength, blocks, keptIndex: kept, fits: true }
  const joined = () => kept.map((i) => blocks[i]).join('\n\n')
  const dropped: string[] = []
  for (const head of HF_PROMPT_DROP_ORDER) {
    if (joined().length <= max) break
    const next = kept.filter((i) => i === 0 || !blocks[i].startsWith(head))
    if (next.length < kept.length) {
      dropped.push(head)
      kept = next
    }
  }
  const fitted = joined()
  return { prompt: fitted, dropped, originalLength, blocks, keptIndex: kept, fits: fitted.length <= max }
}

/** 지시를 MS 상한 안으로 — planHiggsfieldPrompt대로 덜어 낸다. 덜어도 넘으면 몰래 자르지 않고 오류 */
export function fitHiggsfieldPrompt(prompt: string, max = HF_PROMPT_MAX): HiggsfieldPromptFit {
  const plan = planHiggsfieldPrompt(prompt, max)
  if (!plan.fits) {
    throw new Error(`MS 지시 ${plan.prompt.length}자 — 블록을 덜어도 힉스필드 상한 ${max}자를 넘어 보내지 않는다(원래 ${plan.originalLength}자, 덜어 낸 블록 ${plan.dropped.length}개)`)
  }
  return { prompt: plan.prompt, dropped: plan.dropped, originalLength: plan.originalLength }
}

/** 요청 크기 → MS 비율. 컷 크기 표(ASPECT_TO_SIZE)의 세 크기만 쓴다 */
export function msAspectOf(size: string | undefined): '2:3' | '3:2' | '1:1' {
  const [w, h] = (size ?? '1024x1024').split('x').map(Number)
  if (!(w > 0 && h > 0) || w === h) return '1:1'
  return w < h ? '2:3' : '3:2'
}

type Sharp = typeof sharpModule
async function loadSharp(): Promise<Sharp> {
  const mod = await import('sharp')
  return (mod.default ?? mod) as Sharp
}

/**
 * 참조 사진 한 장을 올릴 바이트로 — 짧은 변이 300px 미만이면 512px로 키운다(PNG). 크기를 읽지 못하면 그대로 올린다(공급자가 판정).
 * WebP 참조는 같은 픽셀의 PNG로 바꿔 올린다(R08a — 저장 상한을 넘은 MS 컷은 WebP로 저장되고, 그 첫 화면 컷이 뒤 컷의 스타일 참조가 된다.
 * 힉스필드 업로드가 WebP를 받는지는 확인하지 않았다 — 지금까지 올린 형식은 PNG·JPEG뿐)
 */
export async function prepareReference(
  ref: ReferenceImage,
  sharp: () => Promise<Sharp> = loadSharp
): Promise<{ bytes: Uint8Array; contentType: string; upscaled: boolean; converted?: boolean }> {
  const bytes = Buffer.from(ref.base64, 'base64')
  let meta: { width?: number; height?: number; format?: string } = {}
  try {
    meta = await (await sharp())(bytes).metadata()
  } catch {
    return { bytes, contentType: ref.mimeType, upscaled: false }
  }
  const short = Math.min(meta.width ?? 0, meta.height ?? 0)
  const webp = meta.format === 'webp' || ref.mimeType === 'image/webp'
  if ((!(short > 0) || short >= HF_REF_MIN_SIDE) && webp) {
    return { bytes: await (await sharp())(bytes).png().toBuffer(), contentType: 'image/png', upscaled: false, converted: true }
  }
  if (!(short > 0) || short >= HF_REF_MIN_SIDE) return { bytes, contentType: ref.mimeType, upscaled: false }
  const scale = HF_REF_UPSCALE_SIDE / short
  const out = await (await sharp())(bytes)
    .resize(Math.round((meta.width ?? 0) * scale), Math.round((meta.height ?? 0) * scale), { kernel: 'lanczos3' })
    .png()
    .toBuffer()
  return { bytes: out, contentType: 'image/png', upscaled: true }
}

/**
 * 제출 키 — 모델·사용자·run·단계와 실제로 보내는 본문(지시·비율·참조 업로드 주소)으로 만든다(R08a). 본문이 같으면 같은 키(힉스필드가
 * 같은 요청을 돌려준다), 본문이 하나라도 다르면 새 키다 — 같은 키·다른 본문(HTTP 422 'Idempotency-Key was already used with different
 * request parameters')이 생기지 않는다
 */
export function higgsfieldIdempotencyKey(input: Pick<GenImageInput, 'model' | 'runContext'>, body: Record<string, unknown>): string {
  const h = createHash('sha256')
  h.update([input.model, input.runContext?.userId ?? '', input.runContext?.runId ?? '', input.runContext?.stage ?? '', JSON.stringify(body)].join('\u0000'))
  return `nexops-${h.digest('hex').slice(0, 40)}`
}

/** 공급자 실패 사유 글자 수 — 칸 오류에 붙이는 앞부분(R12c) */
export const HF_REASON_MAX = 300

/**
 * 끝난 요청(failed·nsfw·canceled)의 공급자 사유 — 상태 응답의 error(없으면 detail·message)를 앞 300자만, 주소는 지운다(R12c).
 * 이 글이 없으면 칸 오류에 'failed'만 남아 잔액 부족을 간헐 실패로 오판했다(11-09 R11)
 */
export function higgsfieldReasonOf(raw: unknown): string {
  const b = (raw ?? {}) as Record<string, unknown>
  const value = [b.error, b.detail, b.message].find((v) => v !== undefined && v !== null && v !== '')
  if (value === undefined) return ''
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  return text.replace(/https?:\/\/\S+/g, '<주소>').replace(/\s+/g, ' ').trim().slice(0, HF_REASON_MAX)
}

/** 잔액 부족 사유인가 — 실측 문구 'Your credit balance is too low … top up your balance'(11-09 상태 조회 9건)와 비슷한 꼴 */
export function isHiggsfieldBalanceReason(text: string): boolean {
  return /credit balance is too low|top up your balance|insufficient (credits?|balance)/i.test(text)
}

export interface HiggsfieldImageOutcome {
  base64: string
  mimeType: string
  requestId: string
  /** 받은 요청의 상태 주소·제출 시각(ISO) — 받은 뒤 저장에 실패하면 이미지 단계가 이것으로 다음 run에 다시 받는다(R08a) */
  statusUrl: string
  submittedAt: string
  fit: HiggsfieldPromptFit | null
  upscaledRefs: number
  resumed: boolean
}

export interface HiggsfieldDeps {
  env?: Record<string, string | undefined>
  client?: ReturnType<typeof createHiggsfieldClient>
  now?: () => number
  sharp?: () => Promise<Sharp>
}

function mimeOf(bytes: Buffer): string {
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return 'image/png'
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'image/jpeg'
  if (bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp'
  return 'image/png'
}

/**
 * MS 2k 한 장 — 새 제출(또는 resume 이어 받기) → 기한까지 폴링 → 받기. 기한이 지나면 ImagePendingError, 실패 상태(failed·nsfw·canceled)는 오류.
 * 예산·사용량 기록은 generate.ts가 맡는다(완료 때 한 번)
 */
export async function generateHiggsfieldImage(input: GenImageInput, deps: HiggsfieldDeps = {}): Promise<HiggsfieldImageOutcome> {
  const now = deps.now ?? Date.now
  let keys: { keyId: string; keySecret: string }
  try {
    keys = higgsfieldKeysFromEnv(deps.env ?? process.env)
  } catch (e) {
    throw new Error(`${input.model}(힉스필드) 생성에는 HF_API_KEY_ID·HF_API_KEY_SECRET이 필요합니다 — 키를 등록하기 전 환경에서는 이 모델을 쓰지 않습니다(${e instanceof Error ? e.message : String(e)})`)
  }
  const client = deps.client ?? createHiggsfieldClient({ ...keys, now })
  const deadlineAt = input.deadlineAt ?? now() + DEFAULT_WAIT_MS

  let sub: HiggsfieldSubmission
  let fit: HiggsfieldPromptFit | null = null
  let upscaledRefs = 0
  const resumed = Boolean(input.resume)
  if (input.resume) {
    const age = now() - Date.parse(input.resume.submittedAt)
    if (!(age >= 0) || age > IMAGE_PENDING_MAX_MS) {
      throw new Error(`힉스필드 요청 ${input.resume.requestId}이 ${Math.round(IMAGE_PENDING_MAX_MS / 60_000)}분 안에 끝나지 않아 이어 받지 않음`)
    }
    sub = { requestId: input.resume.requestId, statusUrl: input.resume.statusUrl, submittedAt: Date.parse(input.resume.submittedAt), status: 'in_progress' }
  } else {
    fit = fitHiggsfieldPrompt(input.prompt)
    const imageUrls: string[] = []
    for (const ref of input.referenceImages ?? []) {
      const prepared = await prepareReference(ref, deps.sharp)
      if (prepared.upscaled) upscaledRefs += 1
      imageUrls.push(await client.uploadReference(prepared.bytes, prepared.contentType))
    }
    const body = {
      prompt: fit.prompt,
      quality: 'high',
      resolution: '2k',
      aspect_ratio: msAspectOf(input.size),
      enhance_prompt: false,
      ...(imageUrls.length ? { image_urls: imageUrls } : {}),
    }
    try {
      sub = await client.submit(MS2K_MODEL_PATH, body, { idempotencyKey: higgsfieldIdempotencyKey(input, body) })
    } catch (e) {
      // 제출 응답이 잔액 부족을 HTTP 오류로 줄 때도 같은 갈래로(R12c — 11-09 실측은 제출 뒤 상태 failed였다)
      const message = e instanceof Error ? e.message : String(e)
      if (isHiggsfieldBalanceReason(message)) throw new ImageProviderBalanceError('higgsfield', message)
      throw e
    }
  }

  const result: HiggsfieldResult | null = await client.pollUntil(sub, deadlineAt)
  if (!result) {
    const pending: ImagePendingRequest = {
      provider: 'higgsfield',
      model: input.model,
      requestId: sub.requestId,
      statusUrl: sub.statusUrl,
      submittedAt: new Date(sub.submittedAt).toISOString(),
    }
    throw new ImagePendingError(pending)
  }
  if (result.status !== 'completed') {
    // 끝난 실패의 공급자 사유를 붙인다(R12c). 잔액 부족은 컷 탓이 아니라 이미지 단계가 다르게 다룬다(재시도를 쓰지 않고 run을 멈춘다)
    const reason = higgsfieldReasonOf(result.raw)
    const message = `힉스필드 요청 ${result.requestId} ${result.status}${reason ? ` — ${reason}` : ''}`
    if (isHiggsfieldBalanceReason(reason)) throw new ImageProviderBalanceError('higgsfield', message)
    // 내용 검사 거절(J60) — 글은 그대로, 이미지 단계가 재시도 1번을 안전 장면 지시로 부르게 갈래만 나눈다
    if (result.status === 'nsfw') throw new ImageContentRejectedError('higgsfield', 'nsfw', message)
    throw new Error(message)
  }
  const url = result.imageUrls[0]
  if (!url) throw new Error(`힉스필드 요청 ${result.requestId} 완료 응답에 이미지 주소가 없다`)
  const bytes = await client.download(url)
  return {
    base64: bytes.toString('base64'),
    mimeType: mimeOf(bytes),
    requestId: result.requestId,
    statusUrl: sub.statusUrl,
    submittedAt: new Date(sub.submittedAt).toISOString(),
    fit,
    upscaledRefs,
    resumed,
  }
}
