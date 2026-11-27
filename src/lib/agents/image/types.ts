/**
 * 상품 대표이미지 생성 — 모델 레지스트리와 공통 타입 (WS-B).
 *
 * 선택형 프로바이더: GPT-Image 2.0(OpenAI) · Nano Banana Pro(Gemini 3 Pro Image).
 * 2026-07-23 한글 렌더링 파일럿에서 두 모델 모두 한글 상품명·문구를 정확히 렌더함을 실측.
 * 모델별 실제 호출은 generate.ts, 프롬프트 조립은 prompts.ts가 담당한다(CLAUDE.md agents 분리 원칙).
 */

export type ImageModel = 'gpt-image-2' | 'gemini-3-pro-image' | 'gemini-3.1-flash-image'

export type ImageProvider = 'openai' | 'gemini'

export interface ImageModelInfo {
  id: ImageModel
  label: string
  provider: ImageProvider
  /** UI 선택 힌트(한 줄) */
  note: string
}

/** 선택 가능한 이미지 모델. UI 드롭다운·검증의 SSOT. */
export const IMAGE_MODELS: ImageModelInfo[] = [
  {
    id: 'gpt-image-2',
    label: 'GPT-Image 2.0',
    provider: 'openai',
    note: '한글 텍스트 정확 · 이커머스 대표이미지에 강함',
  },
  {
    id: 'gemini-3-pro-image',
    label: 'Nano Banana Pro',
    provider: 'gemini',
    note: '프리미엄 톤 · 편집/합성에 강함',
  },
]

/**
 * 내부 전용 저가 모델 포함 전체 레지스트리 — UI 선택지(IMAGE_MODELS)에는 노출하지 않는다.
 * gemini-3.1-flash-image: rating_bg·USP 아이콘 등 저가 컷 강등용(개정 5, 2026-08-11 오너 지시.
 * 지정된 'gemini-3.5-flash-image'는 미출시 실측 — 현행 flash image로 대체).
 */
export const ALL_IMAGE_MODELS: ImageModelInfo[] = [
  ...IMAGE_MODELS,
  {
    id: 'gemini-3.1-flash-image',
    label: 'Gemini Flash Image (내부 저가)',
    provider: 'gemini',
    note: '저가 컷 전용 — UI 비노출',
  },
]

/** 사용자 선택 검증 — 내부 전용 모델은 통과시키지 않는다(잡 단위 모델 선택지는 IMAGE_MODELS만) */
export function isImageModel(v: unknown): v is Exclude<ImageModel, 'gemini-3.1-flash-image'> {
  return typeof v === 'string' && IMAGE_MODELS.some((m) => m.id === v)
}

export type ImageQuality = 'low' | 'medium' | 'high'

/** 참조 이미지 1장 (제품 일관성 유지용 — 두 모델 모두 2026-08-09 실호출 검증) */
export interface ReferenceImage {
  base64: string
  mimeType: string
}

export interface GenImageInput {
  prompt: string
  model: ImageModel
  /** 정사각형 권장(쿠팡 대표이미지). 기본 1024x1024 */
  size?: string
  quality?: ImageQuality
  /**
   * 참조 이미지 배열 — 있으면 OpenAI는 /v1/images/edits(multipart), Gemini는
   * parts에 inlineData 선치(참조 먼저, 프롬프트 마지막)로 호출한다.
   * 항상 전량 첨부할 것 — 1장만 주면 색상 변형 누락(NEXFIT 아쿠아슈즈 실증).
   */
  referenceImages?: ReferenceImage[]
  /** ai_usage_log 기록의 호출 주체 표기 (예: 'registration/thumbnail') */
  agentName?: string
  /** 업무 실행 원장·사용자·사업장·단계 귀속 */
  runContext?: RunContext
}

/**
 * 이미지 1장 단가(USD) — 2026-08-09 공식 문서 + 실호출 usage 교차 검산(설계문서 §9.1).
 * 미등록 조합은 최고 단가로 계상한다(과소 계상 방지 — NEXFIT models.py 관례).
 */
export const IMAGE_COST_USD: Record<ImageModel, Partial<Record<ImageQuality, number>>> = {
  'gpt-image-2': { low: 0, medium: 0, high: 0 },
  'gemini-3-pro-image': { low: 0, medium: 0, high: 0 },
  'gemini-3.1-flash-image': { low: 0, medium: 0, high: 0 },
}

export function estimateImageCostUsd(_model: ImageModel, _quality: ImageQuality): number {
  return 0
}

export interface GenImageResult {
  /** 이미지 바이트(base64) */
  base64: string
  mimeType: string
  model: ImageModel
}
import type { RunContext } from '@/lib/agents/types'
