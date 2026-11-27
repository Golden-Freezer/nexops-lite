/** 기존 이미지 생성 계약을 유지하면서 실제 생성은 로컬 Codex CLI로 실행한다. */

import { ALL_IMAGE_MODELS, type GenImageInput, type GenImageResult } from './types'
import { checkMonthlyBudget, logUsage } from '@/lib/agents/budget'
import { codexImage } from '@/lib/local-codex/image'

export async function generateImage(input: GenImageInput): Promise<GenImageResult> {
  if (!input.prompt?.trim()) throw new Error('프롬프트가 필요합니다.')
  if (!ALL_IMAGE_MODELS.some((model) => model.id === input.model)) {
    throw new Error(`지원하지 않는 이미지 모델: ${input.model}`)
  }

  const start = Date.now()
  const agentName = input.agentName ?? 'image/generate'
  const budget = await checkMonthlyBudget(agentName, input.model)
  if (!budget.allowed) throw new Error('로컬 Codex 이미지 생성 예산 확인에 실패했습니다.')

  try {
    const result = await codexImage({
      prompt: input.prompt,
      size: input.size,
      referenceImages: input.referenceImages,
    })
    await logUsage({
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
    return { ...result, model: input.model }
  } catch (error) {
    await logUsage({
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
    throw error
  }
}
