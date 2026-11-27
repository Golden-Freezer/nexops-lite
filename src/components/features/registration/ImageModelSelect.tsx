'use client'

/**
 * 이미지 모델·품질 선택기 (결정 E) — 잡 단위 오너 선택, 자동 폴백 없음.
 * 단가(§9.1 실측)와 이번 잡 예상 비용(장수 × 단가)을 함께 보여준다.
 */

import { IMAGE_MODELS, estimateImageCostUsd, type ImageModel, type ImageQuality } from '@/lib/agents/image/types'

export function ImageModelSelect({
  model,
  quality,
  imageCount,
  disabled,
  onModelChange,
  onQualityChange,
}: {
  model: ImageModel
  quality: ImageQuality
  /** 이번 잡의 예상 생성 장수 (대표이미지 3컷 = 3) */
  imageCount: number
  disabled?: boolean
  onModelChange: (model: ImageModel) => void
  onQualityChange: (quality: ImageQuality) => void
}) {
  const unitCost = estimateImageCostUsd(model, quality)
  const estimated = (unitCost * imageCount).toFixed(2)

  return (
    <div className="flex items-center gap-2 flex-wrap text-xs">
      <select
        value={model}
        onChange={(e) => onModelChange(e.target.value as ImageModel)}
        disabled={disabled}
        className="border border-slate-200 rounded px-2 py-1 text-xs text-slate-700 focus:outline-none focus:border-brand-400 disabled:opacity-50"
      >
        {IMAGE_MODELS.map((m) => (
          <option key={m.id} value={m.id}>
            {m.label} — {m.note}
          </option>
        ))}
      </select>
      <select
        value={quality}
        onChange={(e) => onQualityChange(e.target.value as ImageQuality)}
        disabled={disabled || model === 'gemini-3-pro-image'}
        className="border border-slate-200 rounded px-2 py-1 text-xs text-slate-700 focus:outline-none focus:border-brand-400 disabled:opacity-50"
        title={model === 'gemini-3-pro-image' ? 'Gemini는 품질 단일(단가 동일)' : undefined}
      >
        <option value="medium">medium (${estimateImageCostUsd(model, 'medium').toFixed(3)}/장)</option>
        <option value="high">high (${estimateImageCostUsd(model, 'high').toFixed(3)}/장)</option>
      </select>
      <span className="text-[11px] text-slate-400">
        예상 {imageCount}장 × ${unitCost.toFixed(3)} ≈ <b className="text-slate-600">${estimated}</b>
      </span>
    </div>
  )
}
