/**
 * PDP 이미지 단계 전용 LLM 호출 2종 — 식별카드 판독 + Vision 게이트 채점.
 * NEXFIT agents/image_identity.py(build_identity_card) + agents/image_generation_agent.py
 * (`_vision_score_consistency`) 이식. 프롬프트 본문은 pdp-image-gate-prompts.ts 소유 — 여기는
 * callAgent 배선만(CLAUDE.md AI 호출/순수 로직 분리 원칙 — 오케스트레이션은 lib/registration/pdp-image-stage.ts 소관).
 */

import type Anthropic from '@anthropic-ai/sdk'
import type { AgentConfig, RunContext } from '../types'
import { callAgent } from '../_base'
import { parseLlmJson } from '../json-parser'
import {
  buildVisionGatePrompt,
  IDENTITY_CARD_PROMPT,
  IDENTITY_CARD_MAX_CHARS,
  type VisionGateCutScore,
} from './prompts/pdp-image-gate-prompts'
import type { VisionImage } from './thumbnail-vision-agent'

// 판독·판정 정확도가 존재 이유(설계문서 결정 C) — Sonnet 5는 temperature 미설정, thinking은 끈다.
const IDENTITY_CONFIG: AgentConfig = { model: 'claude-sonnet-5', maxTokens: 200, disableThinking: true }
const GATE_CONFIG: AgentConfig = { model: 'claude-sonnet-5', maxTokens: 500, disableThinking: true }

function imageBlock(image: VisionImage): Anthropic.ImageBlockParam {
  return { type: 'image', source: { type: 'base64', media_type: image.mediaType, data: image.data } }
}

// NEXFIT image_identity.py:_clean_identity_text — 길이 상한만 강제(형식은 프롬프트가 규정)
function cleanIdentityText(raw: string): string {
  const trimmed = raw.trim()
  return trimmed.length > IDENTITY_CARD_MAX_CHARS ? trimmed.slice(0, IDENTITY_CARD_MAX_CHARS) : trimmed
}

// NEXFIT image_identity.py:format_identity_card
function formatIdentityCard(description: string): string {
  const cleaned = cleanIdentityText(description)
  if (!cleaned) return ''
  return `PRODUCT IDENTITY (read from the user's reference photo — the generated product must match every detail below): ${cleaned}`
}

/**
 * 참조 이미지 1장 판독 → 식별카드 블록. 실패해도 잡을 실패시키지 않는다 — 빈 문자열 반환,
 * 호출부는 카드 없이 진행(원본 graceful degradation, image_identity.py:134-140).
 */
export async function readIdentityCard(
  reference: VisionImage,
  runContext?: RunContext,
): Promise<{ card: string; costUsd: number }> {
  const result = await callAgent<string>(
    {
      config: IDENTITY_CONFIG,
      system: 'You catalogue product photos for another image model. Answer with the description only.',
      messages: [{ role: 'user', content: [imageBlock(reference), { type: 'text', text: IDENTITY_CARD_PROMPT }] }],
      timeoutMs: 30_000,
      agentName: 'registration/pdp-image-identity',
      runContext,
    },
    (text) => text
  )
  if (!result.success) {
    console.warn('[registration/pdp-image] 식별카드 판독 실패 — 카드 없이 진행:', result.error.message)
    return { card: '', costUsd: result.usage.cost }
  }
  const card = formatIdentityCard(result.data)
  if (!card) console.warn('[registration/pdp-image] 식별카드 판독 결과가 비어 있음 — 카드 없이 진행')
  return { card, costUsd: result.usage.cost }
}

function parseGateRows(text: string, fallbackCut: string): VisionGateCutScore[] {
  const parsed = parseLlmJson(text) as unknown
  let rows: unknown[] | null = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === 'object' && Array.isArray((parsed as { data?: unknown }).data)
      ? (parsed as { data: unknown[] }).data
      : null
  // 단건 호출(cutNames 1개)에서는 모델이 배열 대신 단일 객체를 반환한다(E2E 2026-08-10 전 컷 실측) — 1행으로 수용
  if (!rows && parsed && typeof parsed === 'object') rows = [parsed]
  if (!rows) throw new Error('게이트 채점 응답이 배열이 아닙니다')
  return rows
    .filter((r): r is Record<string, unknown> => !!r && typeof r === 'object')
    .map((r) => ({ ...r, cut: typeof r.cut === 'string' ? r.cut : fallbackCut }) as VisionGateCutScore)
}

/**
 * 컷 1장 채점 — 참조 1장 + 생성 컷 1장을 원본 게이트 프롬프트로 판정(cutNames=[cutName] 단건 호출).
 * 판정 실패는 null(재생성 트리거 없이 통과 처리 — 원본 "채점 호출 실패 → 게이트 통과" 방침).
 */
export async function judgeImageGate(
  reference: VisionImage,
  cutName: string,
  generated: VisionImage,
  runContext?: RunContext,
): Promise<{ score: VisionGateCutScore | null; costUsd: number }> {
  const result = await callAgent<VisionGateCutScore[]>(
    {
      config: GATE_CONFIG,
      system: 'You are a meticulous product-photo QA judge. Respond only with the requested JSON.',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: buildVisionGatePrompt([cutName]) },
            imageBlock(reference),
            imageBlock(generated),
          ],
        },
      ],
      timeoutMs: 60_000,
      agentName: 'registration/pdp-image-gate',
      runContext,
    },
    (text) => parseGateRows(text, cutName)
  )
  if (!result.success) {
    console.warn(`[registration/pdp-image] '${cutName}' 게이트 채점 호출 실패 — 게이트 통과 처리:`, result.error.message)
    return { score: null, costUsd: result.usage.cost }
  }
  const row = result.data.find((r) => r.cut === cutName) ?? result.data[0] ?? null
  return { score: row, costUsd: result.usage.cost }
}
