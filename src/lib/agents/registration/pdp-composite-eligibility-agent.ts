/**
 * 원본 합성 자격 판정(묶음 4) — 원천 사진 1장에 비전 1콜(라우트 'images/composite-eligibility', 폴백 없음).
 * 호출·파싱 실패는 판정 불가로 돌려준다(error) — 호출부는 이를 '사람 없음·입체물'로 낙관하지 않고 알파 게이트에 맡긴다(NEXFIT과 같다).
 */

import { billedCostOf } from '../billed-usage'
import type Anthropic from '@anthropic-ai/sdk'
import { callLlm } from '../llm'
import type { RunContext } from '@/lib/agents/types'
import type { VisionImage } from './thumbnail-vision-agent'
import { parseRegistrationJson } from './llm-json'
import {
  buildCompositeEligibilityPrompt,
  COMPOSITE_ELIGIBILITY_SYSTEM,
} from './prompts/pdp-composite-eligibility-prompts'
import { pdpRoute } from '@/lib/registration/pdp-model-routes'
import type { CompositeEligibility } from '@/lib/registration/composite/composite-types'

const REASON_MAX_CHARS = 200

/** 모델 응답 → 판정. 키가 정확히 true일 때만 참으로 본다. 객체가 아니면 null(파싱 실패) */
export function parseCompositeEligibility(text: string): CompositeEligibility | null {
  const parsed = parseRegistrationJson(text)
  if (!parsed) return null
  const raw = Array.isArray(parsed) ? parsed[0] : parsed
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  return {
    has_person: r.has_person === true,
    flat_print: r.flat_print === true,
    supplier_marks: r.supplier_marks === true,
    collage: r.collage === true,
    reason: typeof r.reason === 'string' ? r.reason.slice(0, REASON_MAX_CHARS) : '',
  }
}

export async function judgeCompositeEligibility(
  image: VisionImage,
  runContext?: RunContext
): Promise<{ eligibility: CompositeEligibility; costUsd: number }> {
  const imageBlock: Anthropic.ImageBlockParam = {
    type: 'image',
    source: { type: 'base64', media_type: image.mediaType, data: image.data },
  }
  const result = await callLlm(
    pdpRoute('images/composite-eligibility'),
    {
      system: COMPOSITE_ELIGIBILITY_SYSTEM,
      messages: [{ role: 'user', content: [imageBlock, { type: 'text', text: buildCompositeEligibilityPrompt() }] }],
      agentName: 'registration/pdp-composite-eligibility',
      runContext,
      timeoutMs: 30_000,
      maxRetries: 1,
    },
    (text) => {
      const verdict = parseCompositeEligibility(text)
      if (!verdict) throw new Error('자격 판정 응답을 JSON으로 읽지 못했습니다')
      return verdict
    }
  )
  if (!result.success) return { eligibility: { error: result.error.message }, costUsd: billedCostOf(result) }
  return { eligibility: result.data, costUsd: billedCostOf(result) }
}
