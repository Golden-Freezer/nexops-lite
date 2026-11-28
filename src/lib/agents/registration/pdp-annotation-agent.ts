/**
 * 강조 장식(E-3, T4) Vision 위치 판독 — 컷 1장당 1콜. 기존 이미지 게이트와 같은 모델 계열(Sonnet 5.5, thinking 끔),
 * 낮은 maxTokens. 프롬프트는 prompts/pdp-annotation-prompts.ts, 응답 검증·상한은 lib/registration/pdp-annotation-stage.ts
 * 소관(CLAUDE.md AI 호출/순수 로직 분리 원칙). 여기는 모델 계층(callLlm, 단계 images/annotation) 배선과 JSON 배열 수용만 한다.
 */

import { billedCostOf } from '../billed-usage'
import type { ImageBlockParam } from '@/lib/agents/llm/message-types'
import type { RunContext } from '../types'
import { callLlm } from '../llm'
import { pdpRoute } from '@/lib/registration/pdp-model-routes'
import { parseLlmJson } from '../json-parser'
import { buildAnnotationPrompt, type AnnotationPromptKind } from './prompts/pdp-annotation-prompts'
import type { VisionImage } from './thumbnail-vision-agent'

function imageBlock(image: VisionImage): ImageBlockParam {
  return { type: 'image', source: { type: 'base64', media_type: image.mediaType, data: image.data } }
}

function parseRows(text: string): unknown[] {
  const parsed = parseLlmJson(text) as unknown
  if (Array.isArray(parsed)) return parsed
  if (parsed && typeof parsed === 'object') {
    const items = (parsed as { items?: unknown; data?: unknown }).items ?? (parsed as { data?: unknown }).data
    if (Array.isArray(items)) return items
    return [parsed]
  }
  throw new Error('장식 위치 응답이 배열이 아닙니다')
}

/**
 * 컷 1장의 장식 위치 판독. 호출·파싱 실패는 rows=null(호출부가 failed로 기록하고 재생성하지 않는다).
 */
export async function locateAnnotations(
  image: VisionImage,
  labels: string[],
  kinds: AnnotationPromptKind[],
  runContext?: RunContext
): Promise<{ rows: unknown[] | null; costUsd: number }> {
  const result = await callLlm<unknown[]>(
    pdpRoute('images/annotation'),
    {
      system: 'You locate points on product photos. Respond only with the requested JSON.',
      messages: [
        { role: 'user', content: [imageBlock(image), { type: 'text', text: buildAnnotationPrompt(labels, kinds) }] },
      ],
      // run 시간 예산(Vercel 120초) 안에 들도록 최악 2시도 × 25초 — 호출부 ANNOTATION_ESTIMATE_MS와 짝이라 갈래(M) 배율을
      // 곱하지 않는다(곱하면 run이 잡 진행 잠금 기한을 넘는다 — M 갈래에서는 장식 위치가 시간 초과로 빠질 수 있다)
      timeoutMs: 25_000,
      timeoutFixed: true,
      maxRetries: 1,
      agentName: 'registration/pdp-annotation',
      runContext,
    },
    parseRows
  )
  if (!result.success) {
    console.warn('[registration/pdp-annotation] 장식 위치 판독 실패 — 이 컷은 장식 없이 진행:', result.error.message)
    return { rows: null, costUsd: billedCostOf(result) }
  }
  return { rows: result.data, costUsd: billedCostOf(result) }
}
