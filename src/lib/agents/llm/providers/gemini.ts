/**
 * Gemini 공급자(신규) — Generative Language REST `models/{model}:generateContent`. callAgent·callOpenAiChat과 같은 계약을 따른다:
 * AgentOutput 판별 유니언, 재시도 기본 2회(파서 실패 포함), 호출 전 월 예산 게이트(checkMonthlyBudget), 시도마다 ai_usage_log 기록
 * (logUsage, 성공·실패 모두). SDK 없이 fetch(image/generate.ts와 같다). 키는 URL이 아니라 x-goog-api-key 헤더로 보낸다.
 *
 * JSON 강제(통합 조건 ②): 공급자 기능(route.json → responseMimeType application/json) → 호출부 관용 파서 → 정규화 순서.
 * 비용: usageMetadata 입력(promptTokenCount) × 입력 단가 + 출력(candidatesTokenCount + thoughtsTokenCount) × 출력 단가.
 * thinking: 레지스트리가 geminiThinkingLevel을 허용한 모델(gemini-4-argon)만 라우트 effort를 thinkingConfig.thinkingLevel로 보낸다. 그 밖의 모델은 보내지 않는다(기본값).
 * deadlineAt이 오면 시도마다 시간 제한을 남은 시간 안으로 줄이고, 남은 시간이 최소 시도 시간보다 적으면 부르지 않는다.
 * 잘림 감지(route.failOnTruncation, R02): finishReason MAX_TOKENS이거나 답 파트가 비면 파서에 넘기지 않고 파싱 실패로 세어 다시 부른다.
 * 비용 합(R12d): 파싱 실패·잘린 시도도 과금되므로 그 합을 spent로 돌려준다(callAgent와 같은 계약 — usage는 마지막 시도, 실패면 0).
 */

import type Anthropic from '@anthropic-ai/sdk'
import { agentLogger } from '@/lib/monitoring/logger'
import { checkMonthlyBudget, logUsage } from '../../budget'
import { variableBlockMessage } from '@/lib/cost/variable-guard-core'
import { attemptTimeoutWithin, deadlineExhaustedMessage } from '../../deadline'
import { addAgentUsage, spentField, ZERO_USAGE } from '../../billed-usage'
import type { AgentError, AgentOutput, AgentUsage } from '../../types'
import { llmCostPer1k, lookupLlmModel } from '../registry'
import type { LlmRequest, LlmRoute } from '../types'

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models'
const MAX_RETRIES = 2
const TIMEOUT_MS = 60_000

type GeminiPart = { text: string } | { inlineData: { mimeType: string; data: string } }

interface GeminiResponse {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string; thought?: boolean }> }; finishReason?: string }>
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number }
  error?: { message?: string }
}

/** Anthropic 메시지 → Gemini contents. 텍스트·base64 이미지 블록만 — 그 밖의 블록은 null */
export function toGeminiContents(
  messages: Anthropic.MessageParam[]
): Array<{ role: 'user' | 'model'; parts: GeminiPart[] }> | null {
  const contents: Array<{ role: 'user' | 'model'; parts: GeminiPart[] }> = []
  for (const m of messages) {
    const role = m.role === 'assistant' ? 'model' : 'user'
    if (typeof m.content === 'string') {
      contents.push({ role, parts: [{ text: m.content }] })
      continue
    }
    const parts: GeminiPart[] = []
    for (const block of m.content) {
      if (block.type === 'text') parts.push({ text: block.text })
      else if (block.type === 'image' && block.source.type === 'base64')
        parts.push({ inlineData: { mimeType: block.source.media_type, data: block.source.data } })
      else return null
    }
    contents.push({ role, parts })
  }
  return contents
}

/** 잘림 감지 — 상한에서 끊겼거나 답 파트가 비면 사유, 아니면 null */
function truncationProblem(finishReason: string | undefined, text: string): string | null {
  if (finishReason === 'MAX_TOKENS') return '응답이 출력 상한에서 잘렸습니다(finishReason MAX_TOKENS)'
  if (!text.trim()) return `빈 응답입니다(finishReason ${finishReason ?? '없음'})`
  return null
}

export async function callGemini<T>(
  route: LlmRoute,
  request: LlmRequest,
  parser: (text: string) => T
): Promise<AgentOutput<T>> {
  const { model } = route
  const { agentName, runContext, maxRetries = MAX_RETRIES, timeoutMs = TIMEOUT_MS } = request
  const start = Date.now()
  const zeroUsage = { inputTokens: 0, outputTokens: 0, cost: 0 }
  /** 앞선 실패 시도에서 과금된 사용량 합(R12d) — 0이면 spent를 싣지 않는다 */
  let failedSpent: AgentUsage = ZERO_USAGE
  const fail = (error: AgentError): AgentOutput<T> => ({
    success: false,
    error,
    usage: zeroUsage,
    duration: Date.now() - start,
    ...spentField(failedSpent),
  })
  let lastError: AgentError = { message: 'Unknown error', stage: 'api', attempts: 0 }

  const budget = await checkMonthlyBudget(agentName, model, runContext?.costPool)
  if (!budget.allowed) {
    const degraded = budget.degraded === true
    const agentLimit = budget.limitReason === 'agent'
    const spentUsd = agentLimit ? (budget.agentSpentUsd ?? 0) : budget.spentUsd
    const budgetUsd = agentLimit ? (budget.agentBudgetUsd ?? budget.budgetUsd) : budget.budgetUsd
    agentLogger.warn(
      degraded ? '월 AI 예산 조회 실패 — degraded 모드에서 Gemini 호출 차단' : '월 AI 예산 소진 — Gemini 호출 차단',
      { spentUsd, budgetUsd, agentName, model, degradedReason: budget.degradedReason }
    )
    return fail({
      message:
        variableBlockMessage(budget) ??
        (degraded
          ? `월 AI 예산 조회 실패로 degraded 모드가 적용되어 Gemini 모델 ${model} 호출이 차단됩니다.`
          : `월 AI 예산($${budgetUsd}) 소진 — 당월 지출 $${spentUsd.toFixed(2)}. ${agentName} 호출이 차단됩니다.`),
      stage: 'budget',
      attempts: 0,
    })
  }

  const contents = toGeminiContents(request.messages)
  if (!contents)
    return fail({ message: `Gemini 공급자가 보낼 수 없는 메시지 블록 — ${model}`, stage: 'api', attempts: 0 })
  const key = process.env.GEMINI_API_KEY
  if (!key) return fail({ message: 'GEMINI_API_KEY가 설정돼 있지 않습니다.', stage: 'api', attempts: 0 })

  const info = lookupLlmModel(model)
  const body = JSON.stringify({
    systemInstruction: { parts: [{ text: request.system }] },
    contents,
    generationConfig: {
      maxOutputTokens: route.maxTokens,
      ...(info?.temperature && route.temperature !== undefined ? { temperature: route.temperature } : {}),
      ...(route.json && info?.json === 'native' ? { responseMimeType: 'application/json' } : {}),
      ...(route.effort && info?.geminiThinkingLevel ? { thinkingConfig: { thinkingLevel: route.effort } } : {}),
    },
  })
  const costs = llmCostPer1k(model)

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const attempts = attempt + 1
    const attemptTimeout = attemptTimeoutWithin(request.deadlineAt, timeoutMs)
    if (attemptTimeout === null) {
      return fail({ message: deadlineExhaustedMessage(attempt, lastError.message), stage: 'timeout', attempts: attempt })
    }
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), attemptTimeout)
    try {
      const res = await fetch(`${GEMINI_BASE}/${model}:generateContent`, {
        method: 'POST',
        headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
        body,
        signal: controller.signal,
      })
      const json = (await res.json()) as GeminiResponse
      if (!res.ok) throw new Error(`Gemini 호출 실패(${res.status}): ${json.error?.message ?? 'unknown'}`)

      // 생각(thought) 파트는 산출이 아니다 — 답 파트만 잇는다
      const text = (json.candidates?.[0]?.content?.parts ?? [])
        .filter((p) => !p.thought)
        .map((p) => p.text ?? '')
        .join('')
      const meta = json.usageMetadata ?? {}
      const inputTokens = meta.promptTokenCount ?? 0
      const outputTokens = (meta.candidatesTokenCount ?? 0) + (meta.thoughtsTokenCount ?? 0)
      const usage = {
        inputTokens,
        outputTokens,
        cost: (inputTokens / 1000) * costs.input + (outputTokens / 1000) * costs.output,
      }

      const finishReason = json.candidates?.[0]?.finishReason
      const truncated = route.failOnTruncation ? truncationProblem(finishReason, text) : null
      let parseResult: { ok: true; data: T } | { ok: false; message: string }
      try {
        if (truncated) throw new Error(truncated)
        parseResult = { ok: true, data: parser(text) }
      } catch (parseError) {
        parseResult = { ok: false, message: parseError instanceof Error ? parseError.message : String(parseError) }
      }

      const durationMs = Date.now() - start
      const usageLogged = await logUsage({
        agent: agentName,
        model,
        inputTokens,
        outputTokens,
        costUsd: usage.cost,
        runContext,
        success: parseResult.ok,
        durationMs,
        attempts,
      })
      if (!usageLogged)
        console.error('Gemini 사용량 기록 실패 — API 호출은 재시도하지 않습니다.', { agentName, model, attempts })

      if (!parseResult.ok) {
        failedSpent = addAgentUsage(failedSpent, usage)
        // 잘림 감지를 켠 라우트만 사유를 싣는다(callAgent stopReason과 같은 뜻 — 끄면 실패 객체가 지금과 같다)
        const stopReason = truncated ? (finishReason === 'MAX_TOKENS' ? 'max_tokens' : finishReason) : undefined
        lastError = { message: parseResult.message, stage: 'parse', attempts, ...(stopReason ? { stopReason } : {}) }
        agentLogger.warn(`Gemini parse failed (attempt ${attempts})`, { error: parseResult.message, agentName, finishReason })
        if (attempt < maxRetries) {
          await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)))
          continue
        }
        break
      }

      agentLogger.info('Gemini call completed', {
        model,
        agentName,
        inputTokens,
        outputTokens,
        cost: usage.cost,
        duration: durationMs,
      })
      return { success: true, data: parseResult.data, usage, duration: durationMs, ...spentField(failedSpent, usage) }
    } catch (error) {
      const isAbort = (error as { name?: string } | undefined)?.name === 'AbortError'
      const message = isAbort ? `타임아웃(${attemptTimeout}ms)` : error instanceof Error ? error.message : String(error)
      lastError = { message, stage: isAbort ? 'timeout' : 'api', attempts }
      agentLogger.warn(`Gemini attempt ${attempts} failed`, { error: message, stage: lastError.stage, agentName })
      // 응답 사용량을 알 수 없는 실패도 호출 시도 원장에는 남긴다(callAgent와 같다)
      const usageLogged = await logUsage({
        agent: agentName,
        model,
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 0,
        runContext,
        success: false,
        durationMs: Date.now() - start,
        attempts,
      })
      if (!usageLogged)
        console.error('Gemini 사용량 기록 실패 — API 호출은 재시도하지 않습니다.', { agentName, model, attempts })
      if (attempt < maxRetries) await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)))
    } finally {
      clearTimeout(timer)
    }
  }
  return fail(lastError)
}
