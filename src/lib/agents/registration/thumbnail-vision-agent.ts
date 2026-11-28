/**
 * 대표이미지 Vision 분석·임팩트 컨셉 에이전트 — NEXFIT service.py analyze_product/plan_impact_concept 이식.
 * Vision은 속성 추출만 한다(프롬프트 저작 금지 — 원본 P4 교훈). callAgent 경유(재시도·예산·로그).
 */

import { billedCostOf } from '../billed-usage'
import type Anthropic from '@anthropic-ai/sdk'
import type { AgentConfig, AgentOutput, RunContext } from '../types'
import { callAgent } from '../_base'
import { parseLlmJson } from '../json-parser'
import {
  buildVisionAnalysisPrompt,
  buildImpactConceptPrompt,
} from './prompts/thumbnail-analysis-prompts'
import { getUsageSceneSummary } from './prompts/thumbnail-prompts'
import {
  PRODUCT_FORMS,
  PACKAGE_ROLES,
  THUMBNAIL_CATEGORIES,
  type ProductForm,
  type PackageRole,
  type ThumbnailAnalysis,
  type ThumbnailCategory,
} from '@/lib/registration/thumbnail-types'

export type VisionMediaType = 'image/jpeg' | 'image/png' | 'image/webp'

export interface VisionImage {
  data: string
  mediaType: VisionMediaType
}

// 원본은 gemini-3.1-flash-lite temperature=0 — 구조화 추출은 Haiku로 충분(설계문서 결정 C)
const VISION_CONFIG: AgentConfig = {
  model: 'claude-haiku-4-5-20251001',
  maxTokens: 1000,
  temperature: 0,
}

// 원본 temperature=0.7 (창의 컨셉 제안 — service.py:251)
const CONCEPT_CONFIG: AgentConfig = {
  model: 'claude-haiku-4-5-20251001',
  maxTokens: 500,
  temperature: 0.7,
}

/** 참조·생성 이미지 1장 내려받기 상한 — 무응답 URL 하나가 run(maxDuration 120초)을 다 쓰지 않게 한다 */
export const IMAGE_FETCH_TIMEOUT_MS = 25_000

/** 이미지 URL → base64 (실패·시간 초과 시 null — 호출부가 유효분만 사용, cluster-agent 패턴) */
export async function fetchImageAsBase64(url: string, timeoutMs = IMAGE_FETCH_TIMEOUT_MS): Promise<VisionImage | null> {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(timeoutMs) })
    if (!res.ok) return null
    const buf = await res.arrayBuffer()
    const data = Buffer.from(buf).toString('base64')
    const ct = (res.headers.get('content-type') || '').toLowerCase()
    let mediaType: VisionMediaType = 'image/jpeg'
    if (ct.includes('png')) mediaType = 'image/png'
    else if (ct.includes('webp')) mediaType = 'image/webp'
    return { data, mediaType }
  } catch {
    return null
  }
}

function imageBlock(image: VisionImage): Anthropic.ImageBlockParam {
  return {
    type: 'image',
    source: { type: 'base64', media_type: image.mediaType, data: image.data },
  }
}

/** Vision 산출 정규화 — NEXFIT service.py:149-194 규칙 1:1 */
export function normalizeAnalysis(
  raw: unknown,
  imageCount: number,
  productName?: string | null,
  manualCategory?: string | null
): ThumbnailAnalysis {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>

  let category = String(obj.category ?? '')
  if (!THUMBNAIL_CATEGORIES.includes(category as ThumbnailCategory)) category = 'household'
  if (manualCategory != null) {
    if (!THUMBNAIL_CATEGORIES.includes(manualCategory as ThumbnailCategory)) {
      throw new Error(`Unsupported thumbnail category: ${manualCategory}`)
    }
    category = manualCategory
  }

  let confidence = Number(obj.confidence)
  if (!Number.isFinite(confidence)) confidence = 0
  let referenceIndex = Number(obj.reference_index)
  if (!Number.isInteger(referenceIndex)) referenceIndex = 0

  let productForm = String(obj.product_form ?? 'unknown') as ProductForm
  if (!PRODUCT_FORMS.includes(productForm)) productForm = 'unknown'
  let packageRole = String(obj.package_role ?? 'unknown') as PackageRole
  if (!PACKAGE_ROLES.includes(packageRole)) packageRole = 'unknown'

  const colors = obj.primary_colors
  return {
    category: category as ThumbnailCategory,
    product_summary: String(obj.product_summary || productName || 'the reference product').trim(),
    primary_colors: Array.isArray(colors) ? colors.map(String) : [],
    has_label_or_logo: obj.has_label_or_logo === true,
    is_wearable: obj.is_wearable === true,
    product_form: productForm,
    package_role: packageRole,
    reference_index: Math.min(Math.max(referenceIndex, 0), Math.max(imageCount - 1, 0)),
    confidence: Math.min(Math.max(confidence, 0), 1),
  }
}

/** 1단계: 참조 이미지 → 속성 분석 (NEXFIT analyze_product) */
export async function analyzeProduct(
  images: VisionImage[],
  productName?: string | null,
  manualCategory?: string | null,
  runContext?: RunContext,
): Promise<AgentOutput<ThumbnailAnalysis>> {
  return callAgent<ThumbnailAnalysis>(
    {
      config: VISION_CONFIG,
      system:
        'You are a product photo analyst for Korean e-commerce thumbnails. ' +
        'Extract only classification and attributes; never author an image-generation prompt.',
      messages: [
        {
          role: 'user',
          content: [
            ...images.map(imageBlock),
            { type: 'text', text: buildVisionAnalysisPrompt(productName) },
          ],
        },
      ],
      timeoutMs: 60_000,
      agentName: 'registration/thumbnail-vision',
      runContext,
    },
    (text) => {
      const parsed = parseLlmJson(text)
      if (!parsed) throw new Error('Vision 분석 응답 JSON 파싱 실패')
      return normalizeAnalysis(parsed, images.length, productName, manualCategory)
    }
  )
}

/**
 * 2단계: 임팩트컷 창의 컨셉 (NEXFIT plan_impact_concept).
 * 실패 시 null — 프롬프트 빌더가 결정론 폴백을 쓴다(원본 graceful degradation).
 * usage 비용은 반환값에 실려 파이프라인이 잡 cost_usd에 누적한다.
 */
export async function planImpactConcept(
  analysis: ThumbnailAnalysis,
  reference: VisionImage,
  runContext?: RunContext,
): Promise<{ concept: string | null; costUsd: number }> {
  const usageScene = getUsageSceneSummary(analysis, analysis.category)
  const result = await callAgent<string>(
    {
      config: CONCEPT_CONFIG,
      system: 'You are an art director for Korean e-commerce search thumbnails.',
      messages: [
        {
          role: 'user',
          content: [imageBlock(reference), { type: 'text', text: buildImpactConceptPrompt(analysis, usageScene) }],
        },
      ],
      timeoutMs: 30_000,
      agentName: 'registration/thumbnail-concept',
      runContext,
    },
    (text) => {
      const concept = String((parseLlmJson(text) as { concept?: unknown })?.concept ?? '').trim()
      if (!concept) throw new Error('컨셉이 비어 있습니다.')
      return concept.slice(0, 600)
    }
  )
  if (result.success) return { concept: result.data, costUsd: billedCostOf(result) }
  // 폴백 경로 — 조용히 삼키지 않고 원인은 남긴다(원본 logger.warning 대응)
  console.warn('[registration/thumbnail] 임팩트 컨셉 계획 실패 — 결정론 폴백 사용:', result.error.message)
  return { concept: null, costUsd: billedCostOf(result) }
}
