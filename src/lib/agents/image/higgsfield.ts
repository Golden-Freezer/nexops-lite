/**
 * 힉스필드(Higgsfield) 이미지 API 클라이언트 — 비교 하네스(scripts/pdp-eval/higgsfield-compare.ts)와 운영 MS 2k 공급자(higgsfield-image.ts, R05 오너 I4-3)가 쓴다.
 * 운영은 submit + pollUntil로 나눠 쓴다 — run 기한 안에 안 끝나면 다음 run이 같은 요청을 이어 받는다(다시 제출하지 않는다).
 * 공식 문서(docs.higgsfield.ai, 2026-11-06 확인):
 * - 인증 헤더는 `Authorization: Key <ID>:<SECRET>`, 기본 URL은 https://api.higgsfield.ai
 * - 비동기 흐름: POST /<모델 경로> → {request_id, status_url} → GET status_url(2초에서 시작해 10초까지 지터를 두고 폴링) → completed면 images[].url
 * - 종료 상태: completed·failed·nsfw·canceled
 * - 참조 이미지: POST /files/generate-upload-url {content_type} → upload_url로 PUT(자격 증명 없이) → public_url을 image_urls에 넣는다
 * 키는 .env.local의 HF_API_KEY_ID·HF_API_KEY_SECRET에서 읽기만 하고, 오류 메시지·로그에 싣지 않는다.
 */

export const HIGGSFIELD_BASE_URL = 'https://api.higgsfield.ai'
export const HIGGSFIELD_TERMINAL = ['completed', 'failed', 'nsfw', 'canceled'] as const
export type HiggsfieldStatus = 'queued' | 'in_progress' | (typeof HIGGSFIELD_TERMINAL)[number]

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>

export interface HiggsfieldClientOptions {
  keyId: string
  keySecret: string
  baseUrl?: string
  fetchImpl?: FetchLike
  sleep?: (ms: number) => Promise<void>
  now?: () => number
  random?: () => number
}

export interface HiggsfieldResult {
  requestId: string
  status: HiggsfieldStatus
  imageUrls: string[]
  /** 완료 응답 전체(키 없음) — 실제 쓴 프롬프트·청구액 칸이 있는지 보려고 그대로 남긴다 */
  raw: unknown
  submittedAt: number
  finishedAt: number
  polls: number
}

/** 제출 결과 — 다음 run이 같은 요청을 이어 받을 때 다시 쓰는 값(키 없음) */
export interface HiggsfieldSubmission {
  requestId: string
  statusUrl: string
  submittedAt: number
  status: string
}

/** 환경에서 키 두 개를 읽는다. 없으면 이름만 담아 오류(값은 싣지 않음) */
export function higgsfieldKeysFromEnv(env: Record<string, string | undefined>): { keyId: string; keySecret: string } {
  const keyId = env.HF_API_KEY_ID?.trim() ?? ''
  let keySecret = env.HF_API_KEY_SECRET?.trim() ?? ''
  // 콘솔이 주는 'ID:SECRET' 한 줄을 SECRET 칸에 그대로 넣은 경우(11-06 1장 확인 401) — 앞의 'ID:'를 뗀다
  if (keyId && keySecret.startsWith(`${keyId}:`)) keySecret = keySecret.slice(keyId.length + 1)
  const missing = [!keyId && 'HF_API_KEY_ID', !keySecret && 'HF_API_KEY_SECRET'].filter(Boolean)
  if (missing.length) throw new Error(`힉스필드 키 없음: ${missing.join(', ')}`)
  return { keyId, keySecret }
}

/** 폴링 간격 — 2초에서 시작해 1.5배씩 10초까지, ±20% 지터(문서 권장) */
export function pollDelayMs(attempt: number, random: () => number = Math.random): number {
  const base = Math.min(10_000, 2_000 * 1.5 ** Math.max(0, attempt))
  return Math.round(base * (0.8 + 0.4 * random()))
}

/** 응답 본문에서 이미지 주소를 모은다 — images[].url(문서), 없으면 image.url·output 꼴도 받아 준다 */
export function imageUrlsOf(body: unknown): string[] {
  const b = (body ?? {}) as Record<string, unknown>
  const list = Array.isArray(b.images) ? b.images : b.image ? [b.image] : []
  return list
    .map((x) => (typeof x === 'string' ? x : typeof (x as { url?: unknown })?.url === 'string' ? (x as { url: string }).url : ''))
    .filter((u) => /^https:\/\//.test(u))
}

/** 오류 응답에서 짧은 사유만 꺼낸다 — 요청 헤더·키는 담기지 않는다 */
function reasonOf(status: number, text: string): string {
  let detail = text.slice(0, 300)
  try {
    const j = JSON.parse(text) as { detail?: unknown; message?: unknown; error?: unknown }
    detail = String(j.detail ?? j.message ?? j.error ?? detail).slice(0, 300)
  } catch {
    /* 본문이 JSON이 아님 */
  }
  return `HTTP ${status}: ${detail}`
}

export function createHiggsfieldClient(opts: HiggsfieldClientOptions) {
  const base = (opts.baseUrl ?? HIGGSFIELD_BASE_URL).replace(/\/$/, '')
  const doFetch: FetchLike = opts.fetchImpl ?? ((url, init) => fetch(url, init))
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const now = opts.now ?? Date.now
  const auth = `Key ${opts.keyId}:${opts.keySecret}`

  async function api(path: string, init: RequestInit = {}): Promise<unknown> {
    const url = /^https:\/\//.test(path) ? path : `${base}${path.startsWith('/') ? '' : '/'}${path}`
    if (!url.startsWith(`${base}/`)) throw new Error('힉스필드 기본 URL 밖으로는 키를 보내지 않는다')
    const res = await doFetch(url, { ...init, headers: { Authorization: auth, Accept: 'application/json', ...(init.headers ?? {}) } })
    const text = await res.text()
    if (!res.ok) throw new Error(`힉스필드 ${init.method ?? 'GET'} ${new URL(url).pathname} ${reasonOf(res.status, text)}`)
    return text ? JSON.parse(text) : {}
  }

  /** 참조 사진 하나를 올리고 공개 주소를 받는다 — PUT에는 힉스필드 자격 증명을 싣지 않는다 */
  async function uploadReference(bytes: Uint8Array, contentType: string): Promise<string> {
    const slot = (await api('/files/generate-upload-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content_type: contentType }),
    })) as { upload_url?: string; upload_headers?: Record<string, string>; public_url?: string }
    if (!slot.upload_url || !slot.public_url) throw new Error('힉스필드 업로드 주소 응답에 upload_url·public_url이 없다')
    const put = await doFetch(slot.upload_url, {
      method: 'PUT',
      headers: { 'Content-Type': contentType, ...(slot.upload_headers ?? {}) },
      body: new Blob([new Uint8Array(bytes)], { type: contentType }),
    })
    if (!put.ok) throw new Error(`힉스필드 업로드 PUT HTTP ${put.status}`)
    return slot.public_url
  }

  /** 제출만 — 요청 ID·상태 주소를 돌려준다(폴링은 pollUntil). 같은 Idempotency-Key로 다시 제출하면 같은 요청을 돌려받는다(중복 과금 방지) */
  async function submit(modelPath: string, body: Record<string, unknown>, o: { idempotencyKey?: string } = {}): Promise<HiggsfieldSubmission> {
    const submittedAt = now()
    const sub = (await api(modelPath, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(o.idempotencyKey ? { 'Idempotency-Key': o.idempotencyKey } : {}) },
      body: JSON.stringify(body),
    })) as { request_id?: string; status_url?: string; status?: string }
    if (!sub.request_id) throw new Error('힉스필드 제출 응답에 request_id가 없다')
    return { requestId: sub.request_id, statusUrl: sub.status_url ?? `/requests/${sub.request_id}/status`, submittedAt, status: String(sub.status ?? 'queued') }
  }

  /**
   * 기한(deadlineAt, epoch ms)까지 폴링 — 끝나면(completed·failed·nsfw·canceled) 결과, 기한이 지나면 null.
   * null이어도 요청은 힉스필드에서 그대로 돈다(취소하지 않는다 — 처리 중 취소는 400). 다음에 같은 상태 주소로 이어 받는다
   */
  async function pollUntil(sub: HiggsfieldSubmission, deadlineAt: number): Promise<HiggsfieldResult | null> {
    let polls = 0
    let last: Record<string, unknown> = { status: sub.status }
    while (!HIGGSFIELD_TERMINAL.includes(String(last.status) as (typeof HIGGSFIELD_TERMINAL)[number])) {
      const left = deadlineAt - now()
      if (left <= 0) return null
      await sleep(Math.min(pollDelayMs(polls, opts.random), left))
      last = (await api(sub.statusUrl)) as Record<string, unknown>
      polls += 1
    }
    return {
      requestId: sub.requestId,
      status: last.status as HiggsfieldStatus,
      imageUrls: imageUrlsOf(last),
      raw: last,
      submittedAt: sub.submittedAt,
      finishedAt: now(),
      polls,
    }
  }

  /** 제출 → 끝날 때까지 폴링(비교 하네스). 시간 한도를 넘기면 오류(취소하지 않는다 — 이미 처리 중이면 취소가 400) */
  async function generate(modelPath: string, body: Record<string, unknown>, o: { timeoutMs?: number; idempotencyKey?: string } = {}): Promise<HiggsfieldResult> {
    const sub = await submit(modelPath, body, o)
    const limit = o.timeoutMs ?? 300_000
    const result = await pollUntil(sub, sub.submittedAt + limit)
    if (!result) throw new Error(`힉스필드 ${sub.requestId} ${Math.round(limit / 1000)}초 안에 끝나지 않음`)
    return result
  }

  /** 결과 이미지 받기 — 공개 주소라 자격 증명을 싣지 않는다 */
  async function download(url: string): Promise<Buffer> {
    const res = await doFetch(url)
    if (!res.ok) throw new Error(`힉스필드 결과 받기 HTTP ${res.status}`)
    return Buffer.from(await res.arrayBuffer())
  }

  /**
   * 사용량 분석 읽기(GET /models/usage, 읽기만) — 모델별 완료 건수·단가·비용. 청구 기록이 아니라 늦을 수 있다(문서 경고).
   * 시험 하네스가 갈래별 실제 장당 값을 재는 데만 쓴다
   */
  async function usage(startIso: string, endIso: string): Promise<Array<{ bucket: string; model: string; quantity: number; unitPrice: number; cost: number }>> {
    const q = new URLSearchParams({ start: startIso, end: endIso, timeframe: 'day' })
    q.append('expand', 'time_series')
    const body = (await api(`/models/usage?${q}`)) as { time_series?: Array<{ bucket?: string; results?: Array<Record<string, unknown>> }> }
    return (body.time_series ?? []).flatMap((b) =>
      (b.results ?? []).map((r) => ({
        bucket: String(b.bucket ?? ''),
        model: String(r.model ?? ''),
        quantity: Number(r.quantity ?? 0),
        unitPrice: Number(r.unit_price ?? 0),
        cost: Number(r.cost ?? 0),
      }))
    )
  }

  return { uploadReference, submit, pollUntil, generate, download, usage }
}
