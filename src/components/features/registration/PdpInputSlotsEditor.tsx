'use client'

/**
 * 입력 칸 편집기(적용 JOB C1·C5) — 줄마다 한 항목을 적는 선택 칸이다. 값은 있을 때만 칸마다 정해진 자리에 쓰인다(자리는 INPUT-SLOTS.md, 아직 그리는 부품이 없는 칸도 있다).
 * 칸 머리 문구는 칸마다 참인 중립 문구다(통합 11-04 03:3x — 옛 '저장만 됩니다'는 일부 칸이 그려진 뒤 틀린 말이 됐다).
 * 입력 중에는 글을 그대로 두고 값만 바꾼다(줄을 지우거나 쓰는 중에 글이 튀지 않게). 정리는 잡 생성 라우트의 normalizeSpecInputs가 한 번 더 한다.
 */

import { useState } from 'react'
import type { PdpSpecSheet } from '@/lib/registration/pdp-state'
import {
  cleanProductColor,
  formatCompareLines,
  formatLayerLines,
  formatMatrixLines,
  formatMetricLines,
  formatNoticeLines,
  formatPhotoLines,
  formatScheduleLines,
  formatStepLines,
  formatSwatchLines,
  cleanCompareSource,
  parseCompareLines,
  parseLayerLines,
  parseMatrixLines,
  parseMetricLines,
  parseNoticeLines,
  parsePhotoLines,
  parseScheduleLines,
  parseStepLines,
  parseSwatchLines,
} from '@/lib/registration/input-slots'
import { TextAreaField, TextField } from './PdpFormFields'

type Patch = Partial<PdpSpecSheet>

const emptyToUndefined = <T,>(value: T[] | null): T[] | undefined => (value && value.length > 0 ? value : undefined)

const FIELDS: ReadonlyArray<{
  key: string
  label: string
  placeholder: string
  rows: number
  format: (spec: PdpSpecSheet) => string
  patch: (raw: string) => Patch
}> = [
  { key: 'notice', label: '주의·보관·관리 (줄마다 80자까지)', placeholder: '주의: …\n보관: …\n관리: …', rows: 3, format: (s) => formatNoticeLines(s.noticeItems), patch: (raw) => ({ noticeItems: emptyToUndefined(parseNoticeLines(raw)) }) },
  { key: 'metric', label: '제품 수치', placeholder: '길이: 7.3cm', rows: 2, format: (s) => formatMetricLines(s.productMetrics), patch: (raw) => ({ productMetrics: emptyToUndefined(parseMetricLines(raw)) }) },
  { key: 'step', label: '사용 순서 (2~5단계)', placeholder: '제목 | 설명', rows: 3, format: (s) => formatStepLines(s.usageSteps), patch: (raw) => ({ usageSteps: emptyToUndefined(parseStepLines(raw)) }) },
  { key: 'matrix', label: '사이즈 표 (첫 줄이 머리, 쉼표로 나눔)', placeholder: '사이즈, 어깨, 가슴\nS, 40, 90', rows: 3, format: (s) => formatMatrixLines(s.sizeMatrix), patch: (raw) => ({ sizeMatrix: parseMatrixLines(raw) ?? undefined }) },
  { key: 'layer', label: '층·단면 (2~5개)', placeholder: '이름 | 설명', rows: 2, format: (s) => formatLayerLines(s.layers), patch: (raw) => ({ layers: emptyToUndefined(parseLayerLines(raw)) }) },
  { key: 'swatch', label: '색상·질감 칩 (2개 이상)', placeholder: '이름: #RRGGBB', rows: 2, format: (s) => formatSwatchLines(s.swatches), patch: (raw) => ({ swatches: emptyToUndefined(parseSwatchLines(raw)) }) },
  { key: 'photo', label: '실제 사진 주소 (산지·제조·재료·보관)', placeholder: '산지: https://… | 설명', rows: 2, format: (s) => formatPhotoLines(s.realPhotos), patch: (raw) => ({ realPhotos: emptyToUndefined(parsePhotoLines(raw)) }) },
  // C5 — 비교는 기존 제품과의 사실만(깎아내리는 말·타사 이름은 빠진다), 주기는 사용·교체·배송 주기만(효과 시간표는 빠진다)
  { key: 'compare', label: '기존 제품과 비교 (1~5줄)', placeholder: '항목: 우리 | 기존', rows: 3, format: (s) => formatCompareLines(s.compareBasis), patch: (raw) => ({ compareBasis: emptyToUndefined(parseCompareLines(raw)) }) },
  { key: 'schedule', label: '사용·교체 주기 (2~6줄)', placeholder: '이름: 기간', rows: 2, format: (s) => formatScheduleLines(s.schedule), patch: (raw) => ({ schedule: emptyToUndefined(parseScheduleLines(raw)) }) },
]

export function PdpInputSlotsEditor({
  spec,
  onChange,
  disabled,
}: {
  spec: PdpSpecSheet
  onChange: (patch: Patch) => void
  disabled?: boolean
}) {
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [colorDraft, setColorDraft] = useState<string | null>(null)
  const [sourceDraft, setSourceDraft] = useState<string | null>(null)
  return (
    <details className="rounded border border-slate-200 px-3 py-2">
      <summary className="cursor-pointer text-xs font-medium text-slate-600">추가 입력 (값이 있을 때만 쓰입니다. 칸마다 쓰이는 자리가 다릅니다)</summary>
      <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
        {FIELDS.map((field) => (
          <TextAreaField
            key={field.key}
            label={field.label}
            placeholder={field.placeholder}
            rows={field.rows}
            value={drafts[field.key] ?? field.format(spec)}
            disabled={disabled}
            onChange={(raw) => {
              setDrafts((prev) => ({ ...prev, [field.key]: raw }))
              onChange(field.patch(raw))
            }}
          />
        ))}
        <TextField
          label="제품 색 (HEX)"
          placeholder="#5A7D5A"
          value={colorDraft ?? spec.productColor ?? ''}
          disabled={disabled}
          onChange={(raw) => {
            setColorDraft(raw)
            onChange({ productColor: cleanProductColor(raw) ?? undefined })
          }}
        />
        <TextField
          label="비교 근거 출처 (40자)"
          placeholder="시험 성적서·자사 측정"
          value={sourceDraft ?? spec.compareSource ?? ''}
          disabled={disabled}
          onChange={(raw) => {
            setSourceDraft(raw)
            onChange({ compareSource: cleanCompareSource(raw) ?? undefined })
          }}
        />
      </div>
    </details>
  )
}
