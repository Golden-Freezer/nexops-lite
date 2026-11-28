/**
 * 상세페이지 자동 작성 1콜(PDP-W2W3 계약 v1 §2-2) — 라우트 'copy/auto-fill'(카피 계열 Sonnet 5.5, thinking 끔, 폴백 없음,
 * temperature 없음). 사진은 있으면 앞에 붙인다(2장 이하). 응답 JSON 객체를 그대로 돌려주고, 칸 정리·효능 표현 검사는 호출부가
 * 한다(registration/pdp-auto-fill normalizeAutoFillSuggestions).
 * costUsd는 공용 callAgent가 돌려준 값이다 — 모든 시도가 실패하면 0, 성공하면 마지막 시도 비용만(시도별 비용은 ai_usage_log).
 */

import { billedCostOf } from '../billed-usage'
import type { ImageBlockParam } from '@/lib/agents/llm/message-types'
import { callLlm } from '../llm'
import type { AgentError, RunContext } from '@/lib/agents/types'
import type { VisionImage } from './thumbnail-vision-agent'
import { parseRegistrationJson } from './llm-json'
import { AUTO_FILL_SYSTEM, buildAutoFillUserPrompt } from './prompts/pdp-auto-fill-prompts'
import { pdpRoute } from '@/lib/registration/pdp-model-routes'
import { AUTO_FILL_AGENT, type AutoFillRequest } from '@/lib/registration/pdp-auto-fill'

export type AutoFillModelResult =
  | { ok: true; raw: Record<string, unknown>; costUsd: number }
  | { ok: false; error: string; stage: AgentError['stage']; costUsd: number }

/** 사진 1장 원본 상한 — base64로 늘어나도 공급자 이미지 한도(5MB) 안 */
export const AUTO_FILL_IMAGE_MAX_BYTES = 3_750_000

/** 파일 머리 바이트로 형식을 본다(서버가 주는 content-type은 믿지 않는다). jpeg·png·webp만 */
export function sniffImageType(bytes: Uint8Array): VisionImage['mediaType'] | null {
  const at = (i: number, ...sig: number[]) => sig.every((b, k) => bytes[i + k] === b)
  if (at(0, 0xff, 0xd8, 0xff)) return 'image/jpeg'
  if (at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'image/png'
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return 'image/webp'
  return null
}

/**
 * 자동 작성 사진 1장 내려받기 — 실패·시간 초과·jpeg/png/webp가 아님·상한 초과면 null(호출부가 빼고 경고).
 * 형식이 틀린 사진을 그대로 보내면 공급자가 요청 전체를 거절해 "못 읽은 사진은 빼고 쓴다"가 깨진다
 */
export async function fetchAutoFillImage(url: string, timeoutMs: number): Promise<VisionImage | null> {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(timeoutMs) })
    if (!res.ok) return null
    if (Number(res.headers.get('content-length')) > AUTO_FILL_IMAGE_MAX_BYTES) return null
    const bytes = new Uint8Array(await res.arrayBuffer())
    if (bytes.byteLength > AUTO_FILL_IMAGE_MAX_BYTES) return null
    const mediaType = sniffImageType(bytes)
    return mediaType ? { data: Buffer.from(bytes).toString('base64'), mediaType } : null
  } catch {
    return null
  }
}

/** 모델 응답 → JSON 객체(코드 울타리·앞뒤 글은 걷어 낸다). 객체가 없으면 null(파싱 실패) */
export function parseAutoFillResponse(text: string): Record<string, unknown> | null {
  return parseRegistrationJson(text)
}

export async function callAutoFillModel(
  request: AutoFillRequest,
  images: readonly VisionImage[],
  runContext?: RunContext
): Promise<AutoFillModelResult> {
  const imageBlocks: ImageBlockParam[] = images.map((image) => ({
    type: 'image',
    source: { type: 'base64', media_type: image.mediaType, data: image.data },
  }))
  const text = buildAutoFillUserPrompt(request, images.length)
  const result = await callLlm(
    pdpRoute('copy/auto-fill'),
    {
      system: AUTO_FILL_SYSTEM,
      messages: [{ role: 'user', content: imageBlocks.length ? [...imageBlocks, { type: 'text', text }] : text }],
      agentName: AUTO_FILL_AGENT,
      runContext,
      timeoutMs: 30_000,
      maxRetries: 1,
    },
    (out) => {
      const raw = parseAutoFillResponse(out)
      if (!raw) throw new Error('자동 작성 응답을 JSON으로 읽지 못했습니다')
      return raw
    }
  )
  if (!result.success) {
    return { ok: false, error: result.error.message, stage: result.error.stage, costUsd: billedCostOf(result) }
  }
  return { ok: true, raw: result.data, costUsd: billedCostOf(result) }
}
