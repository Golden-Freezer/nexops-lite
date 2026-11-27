'use client'

/**
 * Pro 모드 전용 생성 옵션 4종 (결정 F) — heroImageMode·imagePhotoStyle·photographyNote.
 * PdpForm이 mode==='pro'일 때만 렌더한다. image_quality는 잡 컬럼으로 별도 관리(Phase 1 관례).
 */

import type { HeroImageMode, ImagePhotoStyle, PdpSpecSheet } from '@/lib/registration/pdp-state'
import { SectionTitle, SelectField, TextAreaField } from './PdpFormFields'

const HERO_IMAGE_MODE_OPTIONS: Array<{ value: HeroImageMode; label: string }> = [
  { value: 'studio', label: '스튜디오 (깔끔한 배경)' },
  { value: 'lifestyle', label: '라이프스타일 (실사용 연출)' },
  { value: 'premium', label: '프리미엄 (고급 무드)' },
]

const IMAGE_PHOTO_STYLE_OPTIONS: Array<{ value: ImagePhotoStyle; label: string }> = [
  { value: 'studio', label: '스튜디오' },
  { value: 'lifestyle', label: '라이프스타일' },
  { value: 'minimal', label: '미니멀' },
  { value: 'warm_tone', label: '웜톤' },
]

export function PdpFormPro({
  spec,
  onChange,
  disabled,
}: {
  spec: PdpSpecSheet
  onChange: (patch: Partial<PdpSpecSheet>) => void
  disabled?: boolean
}) {
  return (
    <div className="space-y-3 rounded-lg border border-brand-100 bg-brand-50/40 p-3">
      <SectionTitle>Pro 생성 옵션</SectionTitle>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <SelectField
          label="히어로 컷 모드"
          value={spec.heroImageMode ?? 'studio'}
          options={HERO_IMAGE_MODE_OPTIONS}
          onChange={(v) => onChange({ heroImageMode: v })}
          disabled={disabled}
        />
        <SelectField
          label="섹션 이미지 스타일"
          value={spec.imagePhotoStyle ?? 'studio'}
          options={IMAGE_PHOTO_STYLE_OPTIONS}
          onChange={(v) => onChange({ imagePhotoStyle: v })}
          disabled={disabled}
        />
      </div>
      <TextAreaField
        label="촬영 디렉션 메모 (선택)"
        value={spec.photographyNote ?? ''}
        onChange={(v) => onChange({ photographyNote: v })}
        placeholder="예: 원목 소품과 함께, 자연광 느낌으로"
        disabled={disabled}
        rows={2}
      />
    </div>
  )
}
