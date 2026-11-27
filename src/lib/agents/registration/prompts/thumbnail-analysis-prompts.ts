/**
 * Vision 분석·임팩트 컨셉 프롬프트 — NEXFIT server/thumbnail/service.py 인라인 프롬프트 번역.
 * Vision은 속성 추출만, 컨셉 콜은 연출 제안만 — 전체 프롬프트 저작은 맡기지 않는다(원본 P4 교훈).
 */

import type { ThumbnailAnalysis } from '@/lib/registration/thumbnail-types'

// NEXFIT service.py:129-136 — JSON 스키마 강제는 callAgent parser가 대신한다(응답 형식 지시 추가)
export function buildVisionAnalysisPrompt(productName?: string | null): string {
  const nameHint = productName?.trim() || 'not provided'
  return (
    'Analyze the attached reference product photos for deterministic downstream prompt assembly.\n' +
    'Return only the requested JSON attributes. Do not write an image-generation prompt.\n' +
    `Optional seller-provided product name: ${nameHint}\n` +
    'Classify product_form as single_item, multi_item_set, bulk_goods, or unknown. ' +
    'Classify package_role independently as none, sellable_unit, incidental, or unknown.\n' +
    'Choose the clearest complete product photo with reference_index, zero-based in attachment order.\n' +
    'Respond with ONLY a JSON object (no markdown fence) with exactly these keys:\n' +
    '{"category": "fashion|food|digital|beauty|stationery|packaging|household|pet", ' +
    '"product_summary": string, "primary_colors": ["#RRGGBB", ...], ' +
    '"has_label_or_logo": boolean, "is_wearable": boolean, ' +
    '"product_form": string, "package_role": string, ' +
    '"reference_index": integer, "confidence": number 0-1}'
  )
}

// NEXFIT service.py:212-241 — 액션을 조건부로 두는 것과 실사용 씬을 함께 넘기는 것이 핵심:
// 무조건 요구하면 정적 상품에 마법 효과를 발명하고(원본 결함 A), 씬을 모르면 같은 이야기로 수렴(결함 C).
export function buildImpactConceptPrompt(
  analysis: Pick<ThumbnailAnalysis, 'product_summary' | 'category' | 'product_form'>,
  usageScene: string
): string {
  const differentStoryRule = usageScene
    ? 'A separate cut in the same set already shows this everyday usage scene: ' +
      `${usageScene}\n` +
      'Your concept must tell a DIFFERENT story with a different composition — ' +
      'not a variation of that scene.\n'
    : ''
  return (
    'You are an art director for Korean e-commerce search thumbnails.\n' +
    `Product: ${analysis.product_summary} ` +
    `(category=${analysis.category}, form=${analysis.product_form})\n` +
    'Propose ONE photo concept that makes a shopper instantly imagine THEMSELVES ' +
    'using this product at its best moment.\n' +
    differentStoryRule +
    "Build the scene around the product's real usage context. Freeze one dynamic, " +
    'physical action element mid-motion ONLY if that action genuinely belongs to ' +
    "this product's own use — water splashing around aqua shoes, steam rising from " +
    'hot food, fabric caught in wind.\n' +
    'If no action is physically natural for this product, propose NO action at all ' +
    'and build impact from dramatic lighting, bold color contrast, a striking angle, ' +
    'or an extreme close-up instead. Never invent effects the product could not ' +
    'cause — no swirling debris, floating objects, or bursting dust.\n' +
    'The product is a LARGE CLOSE-UP hero filling most of the frame, perfectly sharp.\n' +
    'Hands interacting with the product are allowed when they strengthen the usage ' +
    'moment; never show a face.\n' +
    'Constraints: the product itself stays exactly as observed (no restyling or ' +
    'recoloring), no text or graphics.\n' +
    'Write 2-4 concise English sentences describing only the scene.\n' +
    'Respond with ONLY a JSON object: {"concept": string (max 600 chars)}'
  )
}
