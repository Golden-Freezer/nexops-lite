'use client'

/**
 * PdpForm의 "상품 정보" 섹션 — spec_sheet 핵심 필드 전체(카테고리 셀렉트+직접입력 포함).
 * PdpForm.tsx 300줄 상한 초과를 막기 위해 분리(모듈화 규칙). 상태는 PdpForm이 쥐고 있다.
 * W3(PDP-W2W3 계약 v1): 무게·원산지·추가 스펙 칸, 등록 초안에서 채운 칸의 '(초안)' 표시(고치면 사라짐), 페르소나·톤 자동 작성.
 * 추가 스펙 위에 긴 상세페이지 입력 안내(PdpLongInputHint) — 이 칸들이 확장 섹션 근거라는 것을 알린다.
 */

import { useId } from 'react'
import { THUMBNAIL_CATEGORIES, THUMBNAIL_CATEGORY_LABELS } from '@/lib/registration/thumbnail-types'
import type { PdpSpecSheet } from '@/lib/registration/pdp-state'
import { SPEC_SHORT_TEXT_MAX, type PrefillField } from '@/lib/registration/spec-inputs'
import { autoFillRequestBody, clearDraftMark } from '@/lib/registration/pdp-input-assist'
import { ACHROMATIC_BRAND_COLOR_MESSAGE, isAchromaticExtreme } from '@/lib/registration/reference-image-quality'
import { NumberField, SectionTitle, TagsField, TextAreaField, TextField } from './PdpFormFields'
import { PdpReviewFiles } from './PdpReviewFiles'
import { PdpReferenceFiles } from './PdpReferenceFiles'
import { PdpExtraSpecsEditor } from './PdpExtraSpecsEditor'
import { PdpInputSlotsEditor } from './PdpInputSlotsEditor'
import { PdpLongInputHint } from './PdpLongInputHint'
import { PdpAutoFillButton } from './PdpAutoFillButton'

const CUSTOM_CATEGORY = '__custom'

export function PdpFormProductInfo({
  spec,
  onChange,
  categoryMode,
  onCategoryModeChange,
  disabled,
}: {
  spec: PdpSpecSheet
  onChange: (patch: Partial<PdpSpecSheet>) => void
  categoryMode: 'select' | 'custom'
  onCategoryModeChange: (mode: 'select' | 'custom') => void
  disabled?: boolean
}) {
  const brandColorWarningId = useId()
  const brandColorWarning = isAchromaticExtreme(spec.brandHexColor)
  // 등록 초안에서 채운 칸(draftPrefill)은 이름 뒤에 '(초안)'을 붙이고, 오너가 그 칸을 고치면 표시를 뗀다
  const drafted = (field: PrefillField) => spec.draftPrefill?.includes(field) ?? false
  const mark = (label: string, field: PrefillField) => (drafted(field) ? `${label} (초안)` : label)
  const edit = (field: PrefillField, patch: Partial<PdpSpecSheet>) =>
    onChange(drafted(field) ? { ...patch, draftPrefill: clearDraftMark(spec.draftPrefill, field) } : patch)
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 space-y-3">
      <SectionTitle>상품 정보</SectionTitle>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <TextField
          label={mark('상품명 *', 'productName')}
          value={spec.productName}
          onChange={(v) => edit('productName', { productName: v })}
          placeholder="쿠팡 노출 상품명"
          disabled={disabled}
          maxLength={200}
        />
        <TextField
          label={mark('브랜드명', 'brandName')}
          value={spec.brandName ?? ''}
          onChange={(v) => edit('brandName', { brandName: v || undefined })}
          disabled={disabled}
        />
        <label className="flex flex-col gap-1 text-xs text-slate-500">
          카테고리
          <select
            value={categoryMode === 'custom' ? CUSTOM_CATEGORY : spec.category ?? ''}
            onChange={(e) => {
              if (e.target.value === CUSTOM_CATEGORY) {
                onCategoryModeChange('custom')
                onChange({ category: '' })
              } else {
                onCategoryModeChange('select')
                onChange({ category: e.target.value || undefined })
              }
            }}
            disabled={disabled}
            className="w-full border border-slate-200 rounded px-2 py-1.5 text-sm text-slate-700 focus:outline-none focus:border-brand-400 disabled:opacity-50"
          >
            <option value="">카테고리 자동 감지</option>
            {THUMBNAIL_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {THUMBNAIL_CATEGORY_LABELS[c]}
              </option>
            ))}
            <option value={CUSTOM_CATEGORY}>직접 입력…</option>
          </select>
        </label>
        {categoryMode === 'custom' && (
          <TextField
            label="카테고리 직접 입력"
            value={spec.category ?? ''}
            onChange={(v) => onChange({ category: v })}
            disabled={disabled}
          />
        )}
        <TextField
          label={mark('소재', 'material')}
          value={spec.material ?? ''}
          onChange={(v) => edit('material', { material: v || undefined })}
          disabled={disabled}
        />
        <TextField
          label="사용처/장소"
          value={spec.usageLocation ?? ''}
          onChange={(v) => onChange({ usageLocation: v || undefined })}
          disabled={disabled}
        />
        <TextField
          label={mark('사이즈', 'size')}
          value={spec.size ?? ''}
          onChange={(v) => edit('size', { size: v || undefined })}
          disabled={disabled}
        />
        <TextField
          label={mark('무게', 'weight')}
          value={spec.weight ?? ''}
          onChange={(v) => edit('weight', { weight: v || undefined })}
          placeholder="예: 120g"
          maxLength={SPEC_SHORT_TEXT_MAX}
          disabled={disabled}
        />
        <TextField
          label={mark('원산지', 'origin')}
          value={spec.origin ?? ''}
          onChange={(v) => edit('origin', { origin: v || undefined })}
          placeholder="예: 중국"
          maxLength={SPEC_SHORT_TEXT_MAX}
          disabled={disabled}
        />
        <div className="flex flex-col gap-1">
          <TextField
            label="브랜드 컬러 (HEX)"
            value={spec.brandHexColor ?? ''}
            onChange={(v) => onChange({ brandHexColor: v || undefined })}
            placeholder="#22C55E"
            disabled={disabled}
            describedBy={brandColorWarning ? brandColorWarningId : undefined}
          />
          {/* NEXFIT A-10: 검정·흰색 근처 무채색은 경고만(막지 않음) */}
          {brandColorWarning && (
            <span
              id={brandColorWarningId}
              role="status"
              className="rounded border border-amber-300 bg-amber-50 px-2 py-1 text-[11px] leading-snug text-amber-800"
            >
              {ACHROMATIC_BRAND_COLOR_MESSAGE}
            </span>
          )}
        </div>
        <label className="flex flex-col gap-1 text-xs text-slate-500">
          사용 연령
          <select
            value={spec.minAgeYears ?? ''}
            onChange={(e) => onChange({ minAgeYears: e.target.value ? Number(e.target.value) : undefined })}
            disabled={disabled}
            className="w-full border border-slate-200 rounded px-2 py-1.5 text-sm text-slate-700 focus:outline-none focus:border-brand-400 disabled:opacity-50"
          >
            <option value="">전연령 (어린이 KC 인증 보유 시)</option>
            <option value="14">만 14세 이상 (어린이 KC 인증 없음)</option>
          </select>
          <span className="text-[10px] text-slate-400">
            만 14세 이상 선택 시 카피·이미지에서 어린이 사용 묘사를 차단하고 연령 고지 문구를 넣습니다.
          </span>
        </label>
        <NumberField label="품절 판매수" value={spec.soldOutCount} onChange={(v) => onChange({ soldOutCount: v })} disabled={disabled} />
        <NumberField label="평점" value={spec.rating} onChange={(v) => onChange({ rating: v })} disabled={disabled} />
        <NumberField label="리뷰 수" value={spec.reviewCount} onChange={(v) => onChange({ reviewCount: v })} disabled={disabled} />
      </div>
      <TagsField
        label="핵심 특징 (줄바꿈/쉼표 구분)"
        values={spec.keyFeatures ?? []}
        onChange={(v) => onChange({ keyFeatures: v })}
        placeholder="예: 항균 처리, 초경량, 접이식"
        disabled={disabled}
      />
      <TagsField
        label={mark('색상 옵션 (줄바꿈/쉼표 구분)', 'colorOptions')}
        values={spec.colorOptions ?? []}
        onChange={(v) => edit('colorOptions', { colorOptions: v })}
        placeholder="예: 블랙, 화이트, 베이지"
        disabled={disabled}
      />
      <PdpLongInputHint />
      <PdpExtraSpecsEditor
        rows={spec.extraSpecs ?? []}
        onChange={(rows) => edit('extraSpecs', { extraSpecs: rows.length > 0 ? rows : undefined })}
        draft={drafted('extraSpecs')}
        disabled={disabled}
      />
      <PdpInputSlotsEditor spec={spec} onChange={onChange} disabled={disabled} />
      <PdpAutoFillButton
        productName={spec.productName}
        current={{ targetPersona: spec.targetPersona, brandVoiceGuide: spec.brandVoiceGuide, brandHexColor: spec.brandHexColor }}
        buildRequest={() => autoFillRequestBody(spec)}
        onApply={(patch) => onChange(patch)}
        disabled={disabled}
      />
      <TextAreaField
        label="타겟 페르소나"
        value={spec.targetPersona ?? ''}
        onChange={(v) => onChange({ targetPersona: v || undefined })}
        placeholder="예: 신혼부부, 자취 시작하는 20대"
        disabled={disabled}
        rows={2}
      />
      <TextAreaField
        label="브랜드 톤앤매너 가이드"
        value={spec.brandVoiceGuide ?? ''}
        onChange={(v) => onChange({ brandVoiceGuide: v || undefined })}
        placeholder="미입력 시 쿠팡 로켓그로스 문맥의 기본 톤을 적용합니다."
        disabled={disabled}
        rows={2}
      />
      <PdpReviewFiles spec={spec} onChange={onChange} disabled={disabled} />
      <PdpReferenceFiles spec={spec} onChange={onChange} disabled={disabled} />
      <TextAreaField
        label="리뷰 원문 (붙여넣기)"
        value={spec.reviewsText ?? ''}
        onChange={(v) => onChange({ reviewsText: v || undefined })}
        placeholder="실제 리뷰 원문을 붙여넣으면 인용·요약에 활용됩니다."
        disabled={disabled}
        rows={4}
      />
      <TextAreaField
        label="인증/특허/수상 근거"
        value={spec.certificationInfo ?? ''}
        onChange={(v) => onChange({ certificationInfo: v || undefined })}
        placeholder="없으면 인증 섹션을 생략합니다."
        disabled={disabled}
        rows={2}
      />
      <TextAreaField
        label="이벤트/배너 정보"
        value={spec.eventBannerInfo ?? ''}
        onChange={(v) => onChange({ eventBannerInfo: v || undefined })}
        disabled={disabled}
        rows={2}
      />
    </section>
  )
}
