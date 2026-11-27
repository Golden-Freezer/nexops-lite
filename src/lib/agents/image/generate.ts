/**
 * 이미지 생성 프로바이더 호출 (WS-B) — 모델별 실제 API 요청. 순수 생성만 담당(저장·프롬프트 조립 제외).
 *
 * - GPT-Image 2.0: OpenAI Images API(POST /v1/images/generations) → data[0].b64_json
 *   참조 이미지가 있으면 /v1/images/edits(multipart, image[] 필드) — 2026-08-09 실호출 검증
 * - Nano Banana Pro: Gemini generateContent(responseModalities:['IMAGE']) → parts[].inlineData
 *   참조 이미지는 parts에 inlineData 선치(참조 먼저, 프롬프트 마지막) — 2026-08-09 실호출 검증
 * 두 계약 모두 2026-07-23 실 키로 실측 확정.
 *
 * 비용: 호출 성공 시 ai_usage_log에 단가 기록 + 호출 전 월 예산 게이트(checkMonthlyBudget).
 */

import {
  ALL_IMAGE_MODELS,
  estimateImageCostUsd,
  type GenImageInput,
  type GenImageResult,
} from './types'
import { checkMonthlyBudget, logUsage } from '@/lib/agents/budget'

const OPENAI_GENERATIONS_URL = 'https://api.openai.com/v1/images/generations'
const OPENAI_EDITS_URL = 'https://api.openai.com/v1/images/edits'
const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models'

async function generateOpenAI(input: GenImageInput): Promise<GenImageResult> {
  const key = process.env.OPENAI_API_KEY
  if (!key) throw new Error('OPENAI_API_KEY가 설정돼 있지 않습니다.')

  const refs = input.referenceImages ?? []
  let res: Response
  if (refs.length > 0) {
    // edits 엔드포인트는 multipart 전용 — image[]로 참조 전량 첨부
    const form = new FormData()
    form.append('model', 'gpt-image-2')
    form.append('prompt', input.prompt)
    form.append('size', input.size ?? '1024x1024')
    form.append('quality', input.quality ?? 'high')
    form.append('n', '1')
    refs.forEach((ref, i) => {
      const bytes = Buffer.from(ref.base64, 'base64')
      const ext = ref.mimeType === 'image/jpeg' ? 'jpg' : ref.mimeType === 'image/webp' ? 'webp' : 'png'
      form.append('image[]', new Blob([new Uint8Array(bytes)], { type: ref.mimeType }), `ref-${i}.${ext}`)
    })
    res = await fetch(OPENAI_EDITS_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}` },
      body: form,
    })
  } else {
    res = await fetch(OPENAI_GENERATIONS_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-image-2',
        prompt: input.prompt,
        size: input.size ?? '1024x1024',
        quality: input.quality ?? 'high',
        n: 1,
      }),
    })
  }
  const json = (await res.json()) as { data?: { b64_json?: string }[]; error?: { message?: string } }
  if (!res.ok) throw new Error(`OpenAI 이미지 생성 실패(${res.status}): ${json.error?.message ?? 'unknown'}`)
  const b64 = json.data?.[0]?.b64_json
  if (!b64) throw new Error('OpenAI 응답에 이미지가 없습니다.')
  return { base64: b64, mimeType: 'image/png', model: 'gpt-image-2' }
}

interface GeminiPart {
  inlineData?: { data?: string; mimeType?: string }
  inline_data?: { data?: string; mime_type?: string }
}

async function generateGemini(input: GenImageInput): Promise<GenImageResult> {
  const key = process.env.GEMINI_API_KEY
  if (!key) throw new Error('GEMINI_API_KEY가 설정돼 있지 않습니다.')
  const refParts = (input.referenceImages ?? []).map((ref) => ({
    inlineData: { mimeType: ref.mimeType, data: ref.base64 },
  }))
  // 모델 id를 그대로 경로에 사용 — gemini-3-pro-image·gemini-3.1-flash-image 동일 계약(개정 5)
  const res = await fetch(`${GEMINI_BASE}/${input.model}:generateContent?key=${key}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [...refParts, { text: input.prompt }] }],
      generationConfig: { responseModalities: ['IMAGE'] },
    }),
  })
  const json = (await res.json()) as {
    candidates?: { content?: { parts?: GeminiPart[] } }[]
    error?: { message?: string }
  }
  if (!res.ok) throw new Error(`Gemini 이미지 생성 실패(${res.status}): ${json.error?.message ?? 'unknown'}`)
  const parts = json.candidates?.[0]?.content?.parts ?? []
  for (const p of parts) {
    const inline = p.inlineData ?? p.inline_data
    const data = inline?.data
    if (data) {
      const mimeType = (p.inlineData?.mimeType ?? p.inline_data?.mime_type) || 'image/png'
      return { base64: data, mimeType, model: input.model }
    }
  }
  throw new Error('Gemini 응답에 이미지가 없습니다.')
}

/**
 * 선택된 모델로 이미지 1장을 생성한다. base64 바이트를 반환하며 저장은 호출자(라우트)가 한다.
 * 월 예산 소진 시 호출 전에 throw, 성공 시 단가를 ai_usage_log에 기록한다.
 */
export async function generateImage(input: GenImageInput): Promise<GenImageResult> {
  if (!input.prompt?.trim()) throw new Error('프롬프트가 필요합니다.')
  const info = ALL_IMAGE_MODELS.find((m) => m.id === input.model)
  if (!info) throw new Error(`지원하지 않는 이미지 모델: ${input.model}`)
  const start = Date.now()
  const agentName = input.agentName ?? 'image/generate'

  const budget = await checkMonthlyBudget(agentName, input.model)
  if (!budget.allowed) {
    if (budget.degraded) {
      throw new Error(
        `월 AI 예산 조회 실패로 degraded 모드가 적용되어 이미지 모델 ${input.model} 호출이 차단됩니다.`,
      )
    }
    throw new Error(
      `월 AI 예산($${budget.budgetUsd}) 소진 — 당월 지출 $${budget.spentUsd.toFixed(2)}. 이미지 생성이 차단됩니다.`
    )
  }

  try {
    const result = info.provider === 'openai' ? await generateOpenAI(input) : await generateGemini(input)
    const usageLogged = await logUsage({
      agent: agentName,
      model: input.model,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: estimateImageCostUsd(input.model, input.quality ?? 'high'),
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
    throw error
  }
}
